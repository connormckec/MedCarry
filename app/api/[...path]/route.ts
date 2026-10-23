import { env } from "cloudflare:workers";
import { getChatGPTUser, chatGPTSignInPath } from "@/app/chatgpt-auth";
import { MedicationValidationError, emptyMedication, validateFields, parseLabel, canCreateCard, type Medication, type MedicationFields } from "@/lib/medication";
import { ClinicApiError, ensureSyntheticClinic, getStaffIdentityHeader } from "@/lib/clinic-api";
import { ClinicIdentityError, proposePatientMatch, type PatientRecord } from "@/lib/clinic-identity";
import {
  AuthzError,
  assertStaffToolsAllowed,
  authorizeProfileAccess,
  authorizeUploadAccess,
  listAccessibleProfiles,
  type ProfileAccess,
} from "@/lib/clinic-authz";
import { MedicationChangeError, parseChangeReason, parseEditorDraft } from "@/lib/medication-changes";
import { SYNTHETIC } from "@/lib/synthetic-clinic";
import {
  RxNormError,
  buildTerminologyQuery,
  hashQuery,
  normalizeFromDrugGroup,
  normalizeFromFixture,
  parseDuplicateResponse,
  patientDuplicatePrompt,
  applyTerminologyToFields,
  terminologyForOutage,
} from "@/lib/rxnorm";
import {
  listDuplicateFlagsForProfile,
  listTerminologyForProfile,
  normalizeMedicationFields,
  refreshDuplicateFlags,
  upsertTerminology,
  duplicateFlagFromRow,
  type DuplicateFlagRow,
} from "@/lib/rxnorm-store";
import {
  ClinicSubmissionError,
  RECEIVING_CLINIC_NAME,
  assertCanSubmitClinic,
  deliveryLabel,
  isValidDateOnly,
  parseAprimaStatus,
  parseStaffReviewStatus,
} from "@/lib/clinic-submission";
import {
  createImmutableSubmission,
  inboxItemFromRow,
  latestSubmissionForAppointment,
  listInboxForPracticeDate,
  processSubmissionOutbox,
  submissionFromRow,
  updateSubmissionAprimaStatus,
  updateSubmissionStaffStatus,
  type ClinicInboxRow,
  type ClinicSubmissionRow,
} from "@/lib/clinic-submission-store";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };
type Row = { id: string; owner_id: string; profile_id: string; data: string; source_ids: string; revision: number; confirmed_revision: number | null; confirmed_at: string | null; list_state: string; created_at: string; updated_at: string };
class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
const baseHeaders = { "Cache-Control":"private, no-store", "X-Content-Type-Options":"nosniff", "Referrer-Policy":"no-referrer" };
function json(data: unknown, status=200) { return Response.json(data, {status, headers:baseHeaders}); }
function id(value: unknown): string { if (typeof value!=="string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new ApiError(400,"Invalid record identifier."); return value; }
function db() { if (!env.DB) throw new ApiError(503,"Record storage is not available. Please try again shortly."); return env.DB; }
function bucket() { if (!env.BUCKET) throw new ApiError(503,"Photo storage is not available. Manual entry is still supported."); return env.BUCKET; }
function med(row: Row): Medication { return {...emptyMedication(),...JSON.parse(row.data),id:row.id,profileId:row.profile_id,sourceIds:JSON.parse(row.source_ids),revision:row.revision,confirmedRevision:row.confirmed_revision,confirmedAt:row.confirmed_at,createdAt:row.created_at,updatedAt:row.updated_at}; }
async function boundedBytes(req: Request, limit: number) {
  const declared = Number(req.headers.get("content-length")||0); if (declared>limit) throw new ApiError(413,"This upload is too large.");
  if (!req.body) throw new ApiError(400,"The request body is empty.");
  const reader=req.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  try { while(true) { const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new ApiError(413,"This upload is too large.");}chunks.push(value); } } finally {reader.releaseLock();}
  const out=new Uint8Array(size);let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.length;}return out;
}
async function body(req: Request,limit=48000): Promise<Record<string,unknown>> { if(!req.headers.get("content-type")?.includes("application/json"))throw new ApiError(415,"Send a JSON request.");try { const value=JSON.parse(new TextDecoder().decode(await boundedBytes(req,limit)));if(!value||typeof value!=="object"||Array.isArray(value))throw new Error();return value; } catch(e) {if(e instanceof ApiError)throw e;throw new ApiError(400,"The request could not be read.");} }
async function requireProfile(principal: string, value: unknown): Promise<ProfileAccess> {
  return authorizeProfileAccess(db(), principal, id(value));
}
async function requireMedication(principal: string, value: unknown): Promise<{ row: Row; access: ProfileAccess }> {
  const row = await db().prepare("SELECT * FROM medications WHERE id=?").bind(id(value)).first<Row>();
  if (!row) throw new ApiError(404, "This medication was not found.");
  const access = await authorizeProfileAccess(db(), principal, row.profile_id);
  if (row.owner_id !== access.dataOwnerId) throw new ApiError(404, "This medication was not found.");
  return { row, access };
}
function event(owner:string,pid:string,entity:string,action:string,revision:number|null=null) { return db().prepare("INSERT INTO audit_events (id,owner_id,profile_id,entity_id,action,revision,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),owner,pid,entity,action,revision,new Date().toISOString()); }
async function sources(dataOwnerId:string,pid:string,value:unknown) {if(!Array.isArray(value)||value.length>4)throw new ApiError(400,"Use up to four photos for one medication.");const ids=[...new Set(value.map(id))];for(const sid of ids){const found=await db().prepare("SELECT id FROM uploads WHERE id=? AND owner_id=? AND profile_id=?").bind(sid,dataOwnerId,pid).first();if(!found)throw new ApiError(400,"A source photo does not belong to this list.");}return ids;}
function revision(value:unknown){if(!Number.isInteger(value)||Number(value)<1)throw new ApiError(400,"A current record version is required.");return Number(value);}
function text(value:unknown,max:number,required=false){if(typeof value!=="string"||value.trim().length>max||(required&&!value.trim()))throw new ApiError(400,"Check the text you entered.");return value.trim();}
async function handle(req:Request,ctx:Context){
  try {
    const user=await getChatGPTUser();if(!user)return json({error:"Sign in to access your medication list.",signInUrl:chatGPTSignInPath(req.headers.get("x-medcarry-view")==="patient"?"/patient":"/")},401);
    const principal=user.userId;const parts=(await ctx.params).path;const url=new URL(req.url);const route=parts.join("/");
    if(req.method!=="GET"){
      if(req.headers.get("x-medcarry-request")!=="1")throw new ApiError(403,"This action must originate from the app.");
      const origin=req.headers.get("origin");
      if(origin && new URL(origin).host!==url.host && new URL(origin).host!==req.headers.get("host"))throw new ApiError(403,"Cross-site actions are not allowed.");
      if(!origin && req.headers.get("sec-fetch-site")!=="same-origin")throw new ApiError(403,"The request origin could not be verified.");
    }
    if(req.method==="GET"&&route==="bootstrap"){
      const profiles=await listAccessibleProfiles(db(),principal);
      return json({profiles,displayName:user.fullName?.split(" ")[0]||"Your account"});
    }
    if(req.method==="POST"&&route==="clinic/seed-synthetic"){
      await assertStaffToolsAllowed(db(),principal);
      const result=await ensureSyntheticClinic(db(),principal);
      return json({...result,practiceId:SYNTHETIC.practiceId,profileId:SYNTHETIC.aliceProfileId},result.seeded?201:200);
    }
    if(req.method==="GET"&&route==="clinic/staff-header"){
      await assertStaffToolsAllowed(db(),principal);
      const header=await getStaffIdentityHeader(db(),principal,url.searchParams.get("appointment"),url.searchParams.get("respondent")||undefined);
      return json({header});
    }
    if(req.method==="POST"&&route==="clinic/match-proposal"){
      await assertStaffToolsAllowed(db(),principal);
      const b=await body(req);const practiceId=id(b.practiceId);
      const membership=await db().prepare("SELECT id FROM staff_memberships WHERE practice_id=? AND principal_id=? AND role='staff' LIMIT 1").bind(practiceId,principal).first();
      if(!membership)throw new ApiError(403,"Staff access is required for patient matching.");
      const rows=await db().prepare("SELECT id,practice_id,legal_name,dob,postal_code FROM patients WHERE practice_id=?").bind(practiceId).all<{id:string;practice_id:string;legal_name:string;dob:string;postal_code:string|null}>();
      const patients:PatientRecord[]=rows.results.map(r=>({id:r.id,practiceId:r.practice_id,legalName:r.legal_name,dob:r.dob,postalCode:r.postal_code}));
      const mappings=await db().prepare("SELECT patient_id,external_patient_id,verification_status FROM external_patient_mappings WHERE practice_id=?").bind(practiceId).all<{patient_id:string;external_patient_id:string;verification_status:"unverified"|"verified"|"needs_review"}>();
      const proposal=proposePatientMatch({
        patients,
        legalName:typeof b.legalName==="string"?b.legalName:undefined,
        dob:typeof b.dob==="string"?b.dob:undefined,
        postalCode:typeof b.postalCode==="string"?b.postalCode:null,
        externalPatientId:typeof b.externalPatientId==="string"?b.externalPatientId:null,
        mappings:mappings.results.map(m=>({patientId:m.patient_id,externalPatientId:m.external_patient_id,verificationStatus:m.verification_status})),
      });
      return json({proposal,note:"Matching proposes candidates for staff review. It does not authenticate or attach records."});
    }
    if(req.method==="POST"&&route==="profile"){
      await assertStaffToolsAllowed(db(),principal);
      const b=await body(req);const name=text(b.name,80,true);const count=await db().prepare("SELECT COUNT(*) AS n FROM profiles WHERE owner_id=?").bind(principal).first<{n:number}>();if((count?.n||0)>=12)throw new ApiError(400,"You can create up to 12 separate lists.");
      const pid=crypto.randomUUID(),now=new Date().toISOString();await db().batch([db().prepare("INSERT INTO profiles (id,owner_id,name,created_at) VALUES (?,?,?,?)").bind(pid,principal,name,now),event(principal,pid,pid,"profile_created")]);return json({profile:{id:pid,name,created_at:now}},201);
    }
    if(req.method==="GET"&&route==="list"){
      const access=await requireProfile(principal,url.searchParams.get("profile"));
      const rows=await db().prepare("SELECT * FROM medications WHERE owner_id=? AND profile_id=? AND list_state='active' ORDER BY created_at DESC LIMIT 100").bind(access.dataOwnerId,access.profile.id).all<Row>();
      const cards=await db().prepare("SELECT id,recipient,patient_name,created_at FROM snapshots WHERE owner_id=? AND profile_id=? ORDER BY created_at DESC LIMIT 15").bind(access.dataOwnerId,access.profile.id).all();
      const draftMedId=url.searchParams.get("draftMedication")||"";
      const draft=await db().prepare("SELECT id,medication_id,draft_json,updated_at FROM editor_drafts WHERE owner_id=? AND profile_id=? AND principal_id=? AND medication_id=?")
        .bind(access.dataOwnerId,access.profile.id,principal,draftMedId).first<{id:string;medication_id:string;draft_json:string;updated_at:string}>();
      const openDrafts=await db().prepare("SELECT id,medication_id,draft_json,updated_at FROM editor_drafts WHERE owner_id=? AND profile_id=? AND principal_id=? ORDER BY updated_at DESC LIMIT 5")
        .bind(access.dataOwnerId,access.profile.id,principal).all<{id:string;medication_id:string;draft_json:string;updated_at:string}>();
      const changes=await db().prepare("SELECT id,medication_id,actor_principal_id,reason,prior_revision,prior_list_state,undone_at,created_at FROM medication_change_events WHERE owner_id=? AND profile_id=? ORDER BY created_at DESC LIMIT 40")
        .bind(access.dataOwnerId,access.profile.id).all();
      const suppressed=access.canManageStaffTools
        ? (await db().prepare("SELECT * FROM medications WHERE owner_id=? AND profile_id=? AND list_state='suppressed' ORDER BY updated_at DESC LIMIT 40").bind(access.dataOwnerId,access.profile.id).all<Row>()).results.map(med)
        : [];
      const [terminology,duplicateFlags]=await Promise.all([
        listTerminologyForProfile(db(),access.dataOwnerId,access.profile.id),
        listDuplicateFlagsForProfile(db(),access.dataOwnerId,access.profile.id),
      ]);
      return json({
        medications:rows.results.map(med),
        cards:cards.results,
        changeEvents:changes.results,
        suppressedMedications:suppressed,
        terminology,
        duplicateFlags,
        duplicatePrompt:patientDuplicatePrompt(),
        editorDraft:draft?{id:draft.id,medicationId:draft.medication_id||null,updatedAt:draft.updated_at,draft:JSON.parse(draft.draft_json)}:null,
        openDrafts:openDrafts.results.map(d=>({id:d.id,medicationId:d.medication_id||null,updatedAt:d.updated_at,draft:JSON.parse(d.draft_json)})),
        access:{actor:access.actor,practiceId:access.practiceId,patientId:access.patientId},
      });
    }
    if(req.method==="PUT"&&route==="draft"){
      const b=await body(req),access=await requireProfile(principal,b.profileId);
      const medicationId=typeof b.medicationId==="string"&&b.medicationId?id(b.medicationId):"";
      if(medicationId){const row=await db().prepare("SELECT id,owner_id,list_state FROM medications WHERE id=?").bind(medicationId).first<{id:string;owner_id:string;list_state:string}>();if(!row||row.owner_id!==access.dataOwnerId||row.list_state!=="active")throw new ApiError(404,"This medication was not found.");}
      const payload=parseEditorDraft(b.draft);validateFields(payload.fields,false);
      for(const sid of payload.sourceIds){const found=await db().prepare("SELECT id FROM uploads WHERE id=? AND owner_id=? AND profile_id=?").bind(sid,access.dataOwnerId,access.profile.id).first();if(!found)throw new ApiError(400,"A source photo does not belong to this list.");}
      const now=new Date().toISOString();
      const existing=await db().prepare("SELECT id FROM editor_drafts WHERE owner_id=? AND profile_id=? AND principal_id=? AND medication_id=?")
        .bind(access.dataOwnerId,access.profile.id,principal,medicationId).first<{id:string}>();
      const draftBody=JSON.stringify(payload);
      if(existing){
        await db().prepare("UPDATE editor_drafts SET draft_json=?,updated_at=? WHERE id=?").bind(draftBody,now,existing.id).run();
        return json({id:existing.id,medicationId:medicationId||null,updatedAt:now,saved:true});
      }
      const did=crypto.randomUUID();
      await db().prepare("INSERT INTO editor_drafts (id,owner_id,profile_id,principal_id,medication_id,draft_json,updated_at) VALUES (?,?,?,?,?,?,?)")
        .bind(did,access.dataOwnerId,access.profile.id,principal,medicationId,draftBody,now).run();
      return json({id:did,medicationId:medicationId||null,updatedAt:now,saved:true},201);
    }
    if(req.method==="DELETE"&&route==="draft"){
      const b=await body(req),access=await requireProfile(principal,b.profileId);
      const medicationId=typeof b.medicationId==="string"&&b.medicationId?id(b.medicationId):"";
      await db().prepare("DELETE FROM editor_drafts WHERE owner_id=? AND profile_id=? AND principal_id=? AND medication_id=?")
        .bind(access.dataOwnerId,access.profile.id,principal,medicationId).run();
      return json({deleted:true});
    }
    if(req.method==="POST"&&route==="upload"){
      const access=await requireProfile(principal,url.searchParams.get("profile"));const bytes=await boundedBytes(req,6*1024*1024);if(bytes.length<12)throw new ApiError(400,"This file is empty or not a supported photo.");
      let mime="";if(bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)mime="image/jpeg";
      if([137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))mime="image/png";
      if(new TextDecoder().decode(bytes.slice(0,4))==="RIFF"&&new TextDecoder().decode(bytes.slice(8,12))==="WEBP")mime="image/webp";
      if(!mime)throw new ApiError(415,"Use a JPG, PNG, or WebP photo. You can also use manual entry.");
      const count=await db().prepare("SELECT COUNT(*) AS n FROM uploads WHERE owner_id=?").bind(access.dataOwnerId).first<{n:number}>();if((count?.n||0)>=400)throw new ApiError(400,"This prototype has reached its photo limit.");
      const uid=crypto.randomUUID(),key=`${access.dataOwnerId}/${access.profile.id}/${uid}`,now=new Date().toISOString();await bucket().put(key,bytes,{httpMetadata:{contentType:mime}});
      try {await db().batch([db().prepare("INSERT INTO uploads (id,owner_id,profile_id,object_key,mime_type,size,created_at) VALUES (?,?,?,?,?,?,?)").bind(uid,access.dataOwnerId,access.profile.id,key,mime,bytes.length,now),event(access.dataOwnerId,access.profile.id,uid,"photo_uploaded")]);}catch(e){await bucket().delete(key);throw e;}
      return json({id:uid,url:`/api/upload/${uid}`,size:bytes.length},201);
    }
    if(req.method==="GET"&&parts[0]==="upload"&&parts.length===2){
      const access=await authorizeUploadAccess(db(),principal,id(parts[1]));const obj=await bucket().get(access.upload.object_key);if(!obj)throw new ApiError(404,"Photo not found.");return new Response(obj.body,{headers:{...baseHeaders,"Content-Type":access.upload.mime_type,"Content-Disposition":"inline","Content-Security-Policy":"default-src 'none'; sandbox"}});
    }
    if(req.method==="DELETE"&&parts[0]==="upload"&&parts.length===2){
      const access=await authorizeUploadAccess(db(),principal,id(parts[1]));const uid=access.upload.id;const used=await db().prepare("SELECT id FROM medications WHERE owner_id=? AND source_ids LIKE ? LIMIT 1").bind(access.dataOwnerId,`%${uid}%`).first();const shared=await db().prepare("SELECT id FROM snapshots WHERE owner_id=? AND data LIKE ? LIMIT 1").bind(access.dataOwnerId,`%${uid}%`).first();if(used||shared)throw new ApiError(409,"This photo is part of a saved record.");await bucket().delete(access.upload.object_key);await db().prepare("DELETE FROM uploads WHERE id=? AND owner_id=?").bind(uid,access.dataOwnerId).run();return json({deleted:true});
    }
    if(req.method==="POST"&&route==="parse") {const b=await body(req);const label=text(b.text,12000,true);return json(parseLabel(label));}
    if(req.method==="POST"&&route==="note-import"){
      await assertStaffToolsAllowed(db(),principal);
      const b=await body(req,128000),access=await requireProfile(principal,b.profileId),key=id(b.idempotencyKey);
      const owner=access.dataOwnerId,p=access.profile;
      const document=text(b.sourceDocument,120,true),sourceDate=text(b.sourceDate||"",10);
      if(b.reviewed!==true)throw new ApiError(400,"Review the selected medication lines before importing.");
      if(!Array.isArray(b.rows)||b.rows.length<1||b.rows.length>20)throw new ApiError(400,"Select between 1 and 20 reviewed medication lines.");
      const fields=b.rows.map(raw=>{
        if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new ApiError(400,"Check each selected medication.");
        const r=raw as Record<string,unknown>;
        const f=validateFields({...r,source:"note",sourceDocument:document,sourceDate,sourceText:text(r.sourceText,1600,true),status:"unsure",actualUseUnknown:true,actualDose:"",frequency:"unknown",timing:"",actualInstructions:"",labelDirections:"",strengthUnknown:false,rxCui:"",referenceName:"",adherence:"not_reported",adherenceReportedAt:""});
        if(!f.productName)throw new ApiError(400,"Each selected line needs a medication name.");return f;
      });
      const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify({profile:p.id,fields})));
      const hash=Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,"0")).join("");
      const previous=await db().prepare("SELECT profile_id,payload_hash,medication_ids FROM note_imports WHERE owner_id=? AND idempotency_key=?").bind(owner,key).first<{profile_id:string;payload_hash:string;medication_ids:string}>();
      if(previous){if(previous.profile_id!==p.id||previous.payload_hash!==hash)throw new ApiError(409,"This import request changed. Review it and start a new import.");return json({ids:JSON.parse(previous.medication_ids),replayed:true});}
      const existing=await db().prepare("SELECT data FROM medications WHERE owner_id=? AND profile_id=? AND list_state='active' LIMIT 100").bind(owner,p.id).all<{data:string}>();
      if(existing.results.length+fields.length>100)throw new ApiError(400,"This list supports up to 100 medication entries.");
      const identity=(m:MedicationFields)=>`${m.productName.toLowerCase().replace(/\s+/g," ").trim()}|${m.strength.toLowerCase().replace(/\s+/g," ").trim()}`;
      const seen=new Set(existing.results.map(r=>identity(JSON.parse(r.data))));
      for(const f of fields){if(seen.has(identity(f)))throw new ApiError(409,`Already listed or repeated: ${f.productName} ${f.strength}. Review it instead of importing a duplicate.`);seen.add(identity(f));}
      const ids=fields.map(()=>crypto.randomUUID()),now=new Date().toISOString();
      const statements=[db().prepare("INSERT INTO note_imports (id,owner_id,profile_id,idempotency_key,payload_hash,medication_ids,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),owner,p.id,key,hash,JSON.stringify(ids),now)];
      fields.forEach((f,i)=>{statements.push(db().prepare("INSERT INTO medications (id,owner_id,profile_id,data,source_ids,revision,list_state,created_at,updated_at) VALUES (?,?,?,?,?,1,'active',?,?)").bind(ids[i],owner,p.id,JSON.stringify(f),"[]",now,now));statements.push(event(owner,p.id,ids[i],"historical_note_imported",1));});
      try{await db().batch(statements);}catch(e){const retry=await db().prepare("SELECT profile_id,payload_hash,medication_ids FROM note_imports WHERE owner_id=? AND idempotency_key=?").bind(owner,key).first<{profile_id:string;payload_hash:string;medication_ids:string}>();if(retry&&retry.profile_id===p.id&&retry.payload_hash===hash)return json({ids:JSON.parse(retry.medication_ids),replayed:true});throw e;}
      for(let i=0;i<fields.length;i++){
        const {terminology}=normalizeMedicationFields(fields[i]);
        await upsertTerminology(db(),{ownerId:owner,profileId:p.id,medicationId:ids[i],terminology,reviewerPrincipalId:principal});
      }
      await refreshDuplicateFlags(db(),owner,p.id);
      return json({ids,unconfirmed:true},201);
    }
    if(req.method==="GET"&&route==="search"){
      await assertStaffToolsAllowed(db(),principal);
      // Terminology-only query: never patient demographics, full notes, or OCR dumps.
      const rawName=text(url.searchParams.get("q")||"",180,true);
      const strength=text(url.searchParams.get("strength")||"",100);
      const formulation=(url.searchParams.get("formulation")||"other") as MedicationFields["formulation"];
      const q=buildTerminologyQuery({productName:rawName,strength,strengthUnknown:!strength,formulation:["tablet","capsule","liquid","inhaler","injection","topical","patch","drops","powder","other"].includes(formulation)?formulation:"other",category:"prescription"});
      const qHash=hashQuery(q);
      const cached=await db().prepare("SELECT response_json,expires_at FROM rxnorm_query_cache WHERE query_hash=?").bind(qHash).first<{response_json:string;expires_at:string}>();
      let data: {drugGroup?:{conceptGroup?:{tty?:string;conceptProperties?:{rxcui:string;name:string;synonym?:string;tty?:string}[]}[]}};
      if(cached && cached.expires_at > new Date().toISOString()){
        data=JSON.parse(cached.response_json);
      } else {
        const result=await fetch(`https://rxnav.nlm.nih.gov/REST/drugs.json?name=${encodeURIComponent(q)}`,{signal:AbortSignal.timeout(8000),headers:{Accept:"application/json"}}).catch(()=>{throw new ApiError(502,"The NLM medication reference is unavailable. You can continue manually.");});
        if(!result.ok)throw new ApiError(502,"The NLM medication reference is unavailable. You can continue manually.");
        data=await result.json() as typeof data;
        const now=new Date().toISOString();
        const expires=new Date(Date.now()+6*60*60*1000).toISOString();
        await db().prepare("INSERT INTO rxnorm_query_cache (query_hash,query_text,response_json,fetched_at,expires_at) VALUES (?,?,?,?,?) ON CONFLICT(query_hash) DO UPDATE SET response_json=excluded.response_json,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at,query_text=excluded.query_text")
          .bind(qHash,q,JSON.stringify(data),now,expires).run();
      }
      const groups=data.drugGroup?.conceptGroup||[];const allowed=groups.filter(g=>["SCD","SBD","GPCK","BPCK"].includes(g.tty||""));
      const seen=new Set<string>();const results=allowed.flatMap(g=>g.conceptProperties||[]).filter(c=>{if(seen.has(c.rxcui))return false;seen.add(c.rxcui);return true;}).slice(0,12).map(c=>({rxCui:c.rxcui,name:c.name}));return json({results,source:"NLM RxNorm",query:q,note:"Reference matches do not establish your directions or current use."});
    }
    if(req.method==="POST"&&route==="normalize"){
      const b=await body(req);const {row,access}=await requireMedication(principal,b.medicationId);
      if(row.list_state!=="active")throw new ApiError(409,"This medication is not on the active list.");
      const fields=validateFields(JSON.parse(row.data));
      let terminology;
      let queryText="";
      try{queryText=buildTerminologyQuery(fields);}catch{/* supplements / short names handled below */}
      if(fields.category==="supplement"){
        terminology=normalizeFromFixture(fields);
      } else if(b.nlmUnavailable===true){
        terminology=terminologyForOutage(fields,queryText);
      } else if(b.preferLive===true){
        try{
          const q=queryText||buildTerminologyQuery(fields);
          const qHash=hashQuery(q);
          const cached=await db().prepare("SELECT response_json,expires_at FROM rxnorm_query_cache WHERE query_hash=?").bind(qHash).first<{response_json:string;expires_at:string}>();
          let drugData;
          if(cached && cached.expires_at > new Date().toISOString()) drugData=JSON.parse(cached.response_json);
          else {
            const result=await fetch(`https://rxnav.nlm.nih.gov/REST/drugs.json?name=${encodeURIComponent(q)}`,{signal:AbortSignal.timeout(8000),headers:{Accept:"application/json"}});
            if(!result.ok)throw new Error("nlm");
            drugData=await result.json();
            const now=new Date().toISOString();
            await db().prepare("INSERT INTO rxnorm_query_cache (query_hash,query_text,response_json,fetched_at,expires_at) VALUES (?,?,?,?,?) ON CONFLICT(query_hash) DO UPDATE SET response_json=excluded.response_json,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at,query_text=excluded.query_text")
              .bind(qHash,q,JSON.stringify(drugData),now,new Date(Date.now()+6*60*60*1000).toISOString()).run();
          }
          terminology=normalizeFromDrugGroup(fields,drugData);
        }catch{
          terminology=terminologyForOutage(fields,queryText);
        }
      } else {
        terminology=normalizeFromFixture(fields);
      }
      const nextFields=applyTerminologyToFields(fields,terminology);
      // Keep original source evidence on the medication row; only attach selected reference codes.
      if(nextFields.rxCui!==fields.rxCui || nextFields.referenceName!==fields.referenceName){
        const now=new Date().toISOString();
        await db().prepare("UPDATE medications SET data=?,updated_at=? WHERE id=? AND owner_id=? AND list_state='active'")
          .bind(JSON.stringify(nextFields),now,row.id,access.dataOwnerId).run();
      }
      const saved=await upsertTerminology(db(),{ownerId:access.dataOwnerId,profileId:row.profile_id,medicationId:row.id,terminology,reviewerPrincipalId:principal});
      const flags=await refreshDuplicateFlags(db(),access.dataOwnerId,row.profile_id);
      await event(access.dataOwnerId,row.profile_id,row.id,"medication_normalized").run();
      return json({
        terminology:saved,
        medication:med((await requireMedication(principal,row.id)).row),
        duplicateFlags:await listDuplicateFlagsForProfile(db(),access.dataOwnerId,row.profile_id),
        proposedFlagCount:flags.length,
        note:"Normalization proposes terminology only. Medications are never auto-merged or removed.",
      });
    }
    if(req.method==="POST"&&route==="duplicates/review"){
      const b=await body(req),access=await requireProfile(principal,b.profileId);
      // Re-normalize active meds from fixtures (offline-safe) then refresh flags.
      const rows=await db().prepare("SELECT * FROM medications WHERE owner_id=? AND profile_id=? AND list_state='active' LIMIT 100").bind(access.dataOwnerId,access.profile.id).all<Row>();
      for(const r of rows.results){
        const fields=validateFields(JSON.parse(r.data));
        const {terminology,fields:next}=normalizeMedicationFields(fields,{nlmUnavailable:b.nlmUnavailable===true});
        if(next.rxCui!==fields.rxCui || next.referenceName!==fields.referenceName){
          await db().prepare("UPDATE medications SET data=?,updated_at=? WHERE id=? AND owner_id=?").bind(JSON.stringify(next),new Date().toISOString(),r.id,access.dataOwnerId).run();
        }
        await upsertTerminology(db(),{ownerId:access.dataOwnerId,profileId:access.profile.id,medicationId:r.id,terminology,reviewerPrincipalId:principal});
      }
      await refreshDuplicateFlags(db(),access.dataOwnerId,access.profile.id);
      return json({
        terminology:await listTerminologyForProfile(db(),access.dataOwnerId,access.profile.id),
        duplicateFlags:await listDuplicateFlagsForProfile(db(),access.dataOwnerId,access.profile.id),
        duplicatePrompt:patientDuplicatePrompt(),
        note:"Flags are explainable proposals only. Uncertain and unmatched entries remain on the list.",
      });
    }
    if(req.method==="POST"&&parts[0]==="duplicate-flag"&&parts[2]==="respond"&&parts.length===3){
      const flagId=id(parts[1]);const b=await body(req);const response=parseDuplicateResponse(b.response);
      const flag=await db().prepare("SELECT * FROM duplicate_flags WHERE id=?").bind(flagId).first<DuplicateFlagRow>();
      if(!flag)throw new ApiError(404,"This duplicate flag was not found.");
      const access=await authorizeProfileAccess(db(),principal,flag.profile_id);
      if(flag.owner_id!==access.dataOwnerId)throw new ApiError(404,"This duplicate flag was not found.");
      if(response==="staff_dismissed" && !access.canManageStaffTools)throw new ApiError(403,"Staff access is required to dismiss this flag.");
      const now=new Date().toISOString();
      await db().prepare("UPDATE duplicate_flags SET status=?, respondent_principal_id=?, responded_at=?, updated_at=? WHERE id=?")
        .bind(response,principal,now,now,flagId).run();
      // Never auto-merge or remove: "added_twice" records the answer only.
      const updated=await db().prepare("SELECT * FROM duplicate_flags WHERE id=?").bind(flagId).first<DuplicateFlagRow>();
      return json({
        flag:duplicateFlagFromRow(updated!),
        note:response==="added_twice"
          ?"Recorded that one may have been added twice. Both entries stay visible until someone uses I added this by mistake / Undo."
          :response==="take_both"
            ?"Recorded that both are taken. Both entries remain on the list."
            :"Recorded. The clinic can still review this flag.",
      });
    }
    if(req.method==="POST"&&route==="medication"){
      const b=await body(req),access=await requireProfile(principal,b.profileId),fields=validateFields(b.fields);fields.adherenceReportedAt=fields.adherence==="not_reported"?"":new Date().toISOString();const sourceIds=await sources(access.dataOwnerId,access.profile.id,b.sourceIds||[]);
      const count=await db().prepare("SELECT COUNT(*) AS n FROM medications WHERE owner_id=? AND profile_id=? AND list_state='active'").bind(access.dataOwnerId,access.profile.id).first<{n:number}>();if((count?.n||0)>=100)throw new ApiError(400,"This prototype supports up to 100 entries in a list.");
      const {terminology,fields:normalizedFields}=normalizeMedicationFields(fields);
      const mid=crypto.randomUUID(),now=new Date().toISOString();await db().batch([db().prepare("INSERT INTO medications (id,owner_id,profile_id,data,source_ids,revision,list_state,created_at,updated_at) VALUES (?,?,?,?,?,1,'active',?,?)").bind(mid,access.dataOwnerId,access.profile.id,JSON.stringify(normalizedFields),JSON.stringify(sourceIds),now,now),event(access.dataOwnerId,access.profile.id,mid,"medication_created",1)]);
      await upsertTerminology(db(),{ownerId:access.dataOwnerId,profileId:access.profile.id,medicationId:mid,terminology,reviewerPrincipalId:principal});
      await refreshDuplicateFlags(db(),access.dataOwnerId,access.profile.id);
      await db().prepare("DELETE FROM editor_drafts WHERE owner_id=? AND profile_id=? AND principal_id=? AND medication_id=''").bind(access.dataOwnerId,access.profile.id,principal).run();
      return json({medication:med((await requireMedication(principal,mid)).row),terminology,duplicateFlags:await listDuplicateFlagsForProfile(db(),access.dataOwnerId,access.profile.id)},201);
    }
    if(req.method==="PUT"&&parts[0]==="medication"&&parts.length===2){
      const {row,access}=await requireMedication(principal,parts[1]);if(row.list_state!=="active")throw new ApiError(409,"This medication is not on the active list. Undo the change first if needed.");
      const b=await body(req),rev=revision(b.revision),fields=validateFields(b.fields);const previous=JSON.parse(row.data);if(previous.sourceDocument){fields.sourceDocument=previous.sourceDocument;fields.sourceDate=previous.sourceDate||"";fields.sourceText=previous.sourceText||"";}fields.adherenceReportedAt=fields.adherence==="not_reported"?"":b.adherenceReviewed===true||fields.adherence!==previous.adherence?new Date().toISOString():(previous.adherenceReportedAt||"");const sourceIds=await sources(access.dataOwnerId,row.profile_id,b.sourceIds||[]);const now=new Date().toISOString();
      const {terminology,fields:normalizedFields}=normalizeMedicationFields(fields);
      const result=await db().prepare("UPDATE medications SET data=?,source_ids=?,revision=revision+1,confirmed_revision=NULL,confirmed_at=NULL,updated_at=? WHERE id=? AND owner_id=? AND revision=? AND list_state='active'").bind(JSON.stringify(normalizedFields),JSON.stringify(sourceIds),now,row.id,access.dataOwnerId,rev).run();if(result.meta.changes!==1)throw new ApiError(409,"This entry changed in another session. Reload the list before editing again.");await event(access.dataOwnerId,row.profile_id,row.id,"medication_updated",rev+1).run();
      // Identity edits re-run fixture normalization and invalidate prior mapping certainty via fresh terminology row.
      await upsertTerminology(db(),{ownerId:access.dataOwnerId,profileId:row.profile_id,medicationId:row.id,terminology,reviewerPrincipalId:principal});
      await refreshDuplicateFlags(db(),access.dataOwnerId,row.profile_id);
      await db().prepare("DELETE FROM editor_drafts WHERE owner_id=? AND profile_id=? AND principal_id=? AND medication_id=?").bind(access.dataOwnerId,row.profile_id,principal,row.id).run();
      return json({medication:med((await requireMedication(principal,row.id)).row),terminology,duplicateFlags:await listDuplicateFlagsForProfile(db(),access.dataOwnerId,row.profile_id)});
    }
    if(req.method==="POST"&&parts[0]==="medication"&&parts[2]==="change"&&parts.length===3){
      const {row,access}=await requireMedication(principal,parts[1]),b=await body(req),rev=revision(b.revision),reason=parseChangeReason(b.reason);
      if(row.revision!==rev)throw new ApiError(409,"This entry changed. Reload before updating it.");
      if(row.list_state!=="active")throw new ApiError(409,"This medication is already off the active list.");
      const now=new Date().toISOString();const prior=JSON.parse(row.data) as MedicationFields;
      const changeId=crypto.randomUUID();
      if(reason==="no_longer_take"){
        const next={...prior,status:"stopped" as const,actualUseUnknown:false,actualDose:"",frequency:"unknown" as const};
        const result=await db().prepare("UPDATE medications SET data=?,revision=revision+1,confirmed_revision=NULL,confirmed_at=NULL,updated_at=? WHERE id=? AND owner_id=? AND revision=? AND list_state='active'")
          .bind(JSON.stringify(next),now,row.id,access.dataOwnerId,rev).run();
        if(result.meta.changes!==1)throw new ApiError(409,"This entry changed. Reload before updating it.");
        await db().batch([
          db().prepare("INSERT INTO medication_change_events (id,owner_id,profile_id,medication_id,actor_principal_id,reason,prior_data,prior_source_ids,prior_revision,prior_confirmed_revision,prior_confirmed_at,prior_list_state,undone_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,?)")
            .bind(changeId,access.dataOwnerId,row.profile_id,row.id,principal,"no_longer_take",row.data,row.source_ids,row.revision,row.confirmed_revision,row.confirmed_at,row.list_state,now),
          event(access.dataOwnerId,row.profile_id,row.id,"medication_no_longer_take",rev+1),
        ]);
        await db().prepare("DELETE FROM editor_drafts WHERE owner_id=? AND profile_id=? AND medication_id=?").bind(access.dataOwnerId,row.profile_id,row.id).run();
        return json({medication:med((await requireMedication(principal,row.id)).row),changeEventId:changeId,reason,note:"Recorded that the patient no longer takes this. This does not discontinue a prescription."});
      }
      const result=await db().prepare("UPDATE medications SET list_state='suppressed',revision=revision+1,confirmed_revision=NULL,confirmed_at=NULL,updated_at=? WHERE id=? AND owner_id=? AND revision=? AND list_state='active'")
        .bind(now,row.id,access.dataOwnerId,rev).run();
      if(result.meta.changes!==1)throw new ApiError(409,"This entry changed. Reload before updating it.");
      await db().batch([
        db().prepare("INSERT INTO medication_change_events (id,owner_id,profile_id,medication_id,actor_principal_id,reason,prior_data,prior_source_ids,prior_revision,prior_confirmed_revision,prior_confirmed_at,prior_list_state,undone_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,?)")
          .bind(changeId,access.dataOwnerId,row.profile_id,row.id,principal,"added_by_mistake",row.data,row.source_ids,row.revision,row.confirmed_revision,row.confirmed_at,row.list_state,now),
        event(access.dataOwnerId,row.profile_id,row.id,"medication_added_by_mistake",rev+1),
      ]);
      await db().prepare("DELETE FROM editor_drafts WHERE owner_id=? AND profile_id=? AND medication_id=?").bind(access.dataOwnerId,row.profile_id,row.id).run();
      return json({suppressed:true,changeEventId:changeId,reason,medicationId:row.id,revision:rev+1,note:"Removed from the active list as added by mistake. Undo is available. History is preserved."});
    }
    if(req.method==="POST"&&parts[0]==="medication"&&parts[2]==="undo-change"&&parts.length===3){
      const {row,access}=await requireMedication(principal,parts[1]),b=await body(req),rev=revision(b.revision);
      if(row.revision!==rev)throw new ApiError(409,"This entry changed. Reload before undoing.");
      const changeId=typeof b.changeEventId==="string"?id(b.changeEventId):null;
      const change=changeId
        ? await db().prepare("SELECT * FROM medication_change_events WHERE id=? AND medication_id=? AND owner_id=? AND undone_at IS NULL").bind(changeId,row.id,access.dataOwnerId).first<{id:string;reason:string;prior_data:string;prior_source_ids:string;prior_revision:number;prior_confirmed_revision:number|null;prior_confirmed_at:string|null;prior_list_state:string}>()
        : await db().prepare("SELECT * FROM medication_change_events WHERE medication_id=? AND owner_id=? AND undone_at IS NULL AND reason IN ('no_longer_take','added_by_mistake') ORDER BY created_at DESC LIMIT 1").bind(row.id,access.dataOwnerId).first<{id:string;reason:string;prior_data:string;prior_source_ids:string;prior_revision:number;prior_confirmed_revision:number|null;prior_confirmed_at:string|null;prior_list_state:string}>();
      if(!change)throw new ApiError(404,"No reversible change was found for this medication.");
      const now=new Date().toISOString();
      const undoReason=change.reason==="no_longer_take"?"undo_no_longer_take":"undo_added_by_mistake";
      const restoreData=change.prior_data;
      const restoreSources=change.prior_source_ids;
      const restoreList=change.reason==="added_by_mistake"?"active":change.prior_list_state||"active";
      // Undo restores prior values but bumps revision and clears confirmation so the patient must re-check.
      const result=await db().prepare("UPDATE medications SET data=?,source_ids=?,list_state=?,revision=revision+1,confirmed_revision=NULL,confirmed_at=NULL,updated_at=? WHERE id=? AND owner_id=? AND revision=?")
        .bind(restoreData,restoreSources,restoreList,now,row.id,access.dataOwnerId,rev).run();
      if(result.meta.changes!==1)throw new ApiError(409,"This entry changed. Reload before undoing.");
      const undoId=crypto.randomUUID();
      await db().batch([
        db().prepare("UPDATE medication_change_events SET undone_at=? WHERE id=?").bind(now,change.id),
        db().prepare("INSERT INTO medication_change_events (id,owner_id,profile_id,medication_id,actor_principal_id,reason,prior_data,prior_source_ids,prior_revision,prior_confirmed_revision,prior_confirmed_at,prior_list_state,undone_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,?)")
          .bind(undoId,access.dataOwnerId,row.profile_id,row.id,principal,undoReason,row.data,row.source_ids,row.revision,row.confirmed_revision,row.confirmed_at,row.list_state,now),
        event(access.dataOwnerId,row.profile_id,row.id,undoReason,rev+1),
      ]);
      return json({medication:med((await requireMedication(principal,row.id)).row),undoneChangeEventId:change.id,changeEventId:undoId,reason:undoReason,note:"Change undone. Confirm the medication again before finishing your list."});
    }
    if(req.method==="POST"&&parts[0]==="confirm"&&parts.length===2){
      const {row,access}=await requireMedication(principal,parts[1]);if(row.list_state!=="active")throw new ApiError(409,"This medication is not on the active list.");
      const b=await body(req),rev=revision(b.revision);if(b.acknowledged!==true)throw new ApiError(400,"Explicitly confirm this medication after reviewing it.");if(rev!==row.revision)throw new ApiError(409,"This entry changed. Please review its latest version.");validateFields(JSON.parse(row.data),true);const now=new Date().toISOString();
      const result=await db().prepare("UPDATE medications SET confirmed_revision=revision,confirmed_at=?,updated_at=? WHERE id=? AND owner_id=? AND revision=? AND list_state='active'").bind(now,now,row.id,access.dataOwnerId,rev).run();if(result.meta.changes!==1)throw new ApiError(409,"This entry changed. Please review its latest version.");await event(access.dataOwnerId,row.profile_id,row.id,"medication_confirmed",rev).run();
      await db().prepare("DELETE FROM editor_drafts WHERE owner_id=? AND profile_id=? AND principal_id=? AND medication_id=?").bind(access.dataOwnerId,row.profile_id,principal,row.id).run();
      return json({medication:med((await requireMedication(principal,row.id)).row)});
    }
    if(req.method==="DELETE"&&parts[0]==="medication"&&parts.length===2){
      // Soft-suppress as "added by mistake" — hard deletes are not used for clinical history.
      const {row,access}=await requireMedication(principal,parts[1]),b=await body(req),rev=revision(b.revision);
      if(row.list_state!=="active")throw new ApiError(409,"This medication is already off the active list.");
      if(row.revision!==rev)throw new ApiError(409,"This entry changed. Reload before removing it.");
      const now=new Date().toISOString(),changeId=crypto.randomUUID();
      const result=await db().prepare("UPDATE medications SET list_state='suppressed',revision=revision+1,confirmed_revision=NULL,confirmed_at=NULL,updated_at=? WHERE id=? AND owner_id=? AND revision=? AND list_state='active'")
        .bind(now,row.id,access.dataOwnerId,rev).run();
      if(result.meta.changes!==1)throw new ApiError(409,"This entry changed. Reload before removing it.");
      await db().batch([
        db().prepare("INSERT INTO medication_change_events (id,owner_id,profile_id,medication_id,actor_principal_id,reason,prior_data,prior_source_ids,prior_revision,prior_confirmed_revision,prior_confirmed_at,prior_list_state,undone_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,?)")
          .bind(changeId,access.dataOwnerId,row.profile_id,row.id,principal,"added_by_mistake",row.data,row.source_ids,row.revision,row.confirmed_revision,row.confirmed_at,row.list_state,now),
        event(access.dataOwnerId,row.profile_id,row.id,"medication_added_by_mistake",rev+1),
      ]);
      return json({suppressed:true,changeEventId:changeId,reason:"added_by_mistake"});
    }
    if(req.method==="POST"&&route==="card"){
      const b=await body(req),access=await requireProfile(principal,b.profileId);const owner=access.dataOwnerId,p=access.profile;const recipient=text(b.recipient,120,true),patientName=text(b.patientName,120,true),key=id(b.idempotencyKey);
      const existing=await db().prepare("SELECT id,profile_id FROM snapshots WHERE owner_id=? AND idempotency_key=?").bind(owner,key).first<{id:string;profile_id:string}>();if(existing){if(existing.profile_id!==p.id)throw new ApiError(409,"This card request belongs to another list.");return json({id:existing.id});}
      const rows=await db().prepare("SELECT * FROM medications WHERE owner_id=? AND profile_id=? AND list_state='active' ORDER BY created_at LIMIT 100").bind(owner,p.id).all<Row>();const list=rows.results.map(med);
      if(!canCreateCard(list))throw new ApiError(409,"Confirm every medication's current version before creating a provider card.");for(const m of list)validateFields(m,true);
      const cid=crypto.randomUUID(),now=new Date().toISOString();const data=JSON.stringify({id:cid,recipient,patientName,createdAt:now,medications:list});
      const exact=JSON.stringify(list.map(m=>({id:m.id,revision:m.revision})));
      const sql=`INSERT INTO snapshots (id,owner_id,profile_id,recipient,patient_name,data,idempotency_key,created_at) SELECT ?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM medications WHERE owner_id=? AND profile_id=? AND list_state='active')=? AND NOT EXISTS (SELECT 1 FROM medications AS m WHERE owner_id=? AND profile_id=? AND list_state='active' AND (confirmed_revision IS NULL OR confirmed_revision!=revision OR confirmed_at IS NULL OR NOT EXISTS (SELECT 1 FROM json_each(?) AS expected WHERE json_extract(expected.value,'$.id')=m.id AND json_extract(expected.value,'$.revision')=m.revision)))`;
      let result;
      try {result=await db().prepare(sql).bind(cid,owner,p.id,recipient,patientName,data,key,now,owner,p.id,list.length,owner,p.id,exact).run();}catch(e){const duplicate=await db().prepare("SELECT id FROM snapshots WHERE owner_id=? AND idempotency_key=?").bind(owner,key).first<{id:string}>();if(duplicate)return json({id:duplicate.id});throw e;}
      if(result.meta.changes!==1)throw new ApiError(409,"The list changed while the card was being created. Review and confirm the latest entries.");await event(owner,p.id,cid,"provider_card_created").run();return json({id:cid},201);
    }
    if(req.method==="GET"&&parts[0]==="card"&&parts.length===2){
      const snap=await db().prepare("SELECT profile_id,owner_id,data FROM snapshots WHERE id=?").bind(id(parts[1])).first<{profile_id:string;owner_id:string;data:string}>();
      if(!snap)throw new ApiError(404,"This card was not found.");
      const access=await authorizeProfileAccess(db(),principal,snap.profile_id);
      if(snap.owner_id!==access.dataOwnerId)throw new ApiError(404,"This card was not found.");
      return json({card:JSON.parse(snap.data),note:"Local snapshot only — not clinic delivery."});
    }
    if(req.method==="POST"&&route==="clinic/submit"){
      const b=await body(req),access=await requireProfile(principal,b.profileId);
      const emptyListAttested=b.emptyListAttested===true;
      const key=id(b.idempotencyKey);
      const link=await db().prepare("SELECT patient_id FROM profile_patient_links WHERE profile_id=?").bind(access.profile.id).first<{patient_id:string}>();
      if(!link)throw new ApiError(400,"This list is not linked to a clinic patient. Link the list before sending to the clinic.");
      const patient=await db().prepare("SELECT id,practice_id,legal_name,dob,postal_code FROM patients WHERE id=?").bind(link.patient_id).first<{id:string;practice_id:string;legal_name:string;dob:string;postal_code:string|null}>();
      if(!patient)throw new ApiError(404,"Linked patient was not found.");
      const practice=await db().prepare("SELECT id,name FROM practices WHERE id=?").bind(patient.practice_id).first<{id:string;name:string}>();
      if(!practice)throw new ApiError(404,"Practice was not found.");
      let appointmentId=typeof b.appointmentId==="string"&&b.appointmentId?id(b.appointmentId):"";
      if(!appointmentId){
        const next=await db().prepare("SELECT id FROM appointments WHERE patient_id=? AND practice_id=? ORDER BY starts_at DESC LIMIT 1").bind(patient.id,practice.id).first<{id:string}>();
        if(!next)throw new ApiError(400,"No appointment is available for this patient. Clinic delivery requires an appointment.");
        appointmentId=next.id;
      }
      const appointment=await db().prepare("SELECT id,practice_id,patient_id,provider_name,service_name,starts_at,timezone,revision FROM appointments WHERE id=?").bind(appointmentId).first<{id:string;practice_id:string;patient_id:string;provider_name:string;service_name:string;starts_at:string;timezone:string;revision:number}>();
      if(!appointment||appointment.patient_id!==patient.id||appointment.practice_id!==practice.id)throw new ApiError(404,"This appointment was not found for the linked patient.");
      let respondentId:string|null=typeof b.respondentId==="string"&&b.respondentId?id(b.respondentId):null;
      if(!respondentId){
        const self=await db().prepare("SELECT id FROM respondents WHERE patient_id=? AND practice_id=? AND principal_id=? AND authorization_status='active' LIMIT 1").bind(patient.id,practice.id,principal).first<{id:string}>();
        respondentId=self?.id||null;
        if(!respondentId){
          const fallback=await db().prepare("SELECT id FROM respondents WHERE patient_id=? AND practice_id=? AND completion_role='patient' AND authorization_status='active' ORDER BY created_at LIMIT 1").bind(patient.id,practice.id).first<{id:string}>();
          respondentId=fallback?.id||null;
        }
      } else {
        const respondent=await db().prepare("SELECT id FROM respondents WHERE id=? AND patient_id=? AND practice_id=? AND authorization_status='active'").bind(respondentId,patient.id,practice.id).first();
        if(!respondent)throw new ApiError(404,"This respondent was not found or is not authorized.");
      }
      const rows=await db().prepare("SELECT * FROM medications WHERE owner_id=? AND profile_id=? AND list_state='active' ORDER BY created_at LIMIT 100").bind(access.dataOwnerId,access.profile.id).all<Row>();
      const list=rows.results.map(med);
      assertCanSubmitClinic(list,emptyListAttested);
      if(!emptyListAttested)for(const m of list)validateFields(m,true);
      const flags=await listDuplicateFlagsForProfile(db(),access.dataOwnerId,access.profile.id);
      const exact=JSON.stringify(list.map(m=>({id:m.id,revision:m.revision})));
      // Concurrency gate: active list must still match confirmed revisions at submit time.
      if(!emptyListAttested){
        const gate=await db().prepare(`SELECT COUNT(*) AS n FROM medications AS m WHERE owner_id=? AND profile_id=? AND list_state='active' AND (confirmed_revision IS NULL OR confirmed_revision!=revision OR confirmed_at IS NULL OR NOT EXISTS (SELECT 1 FROM json_each(?) AS expected WHERE json_extract(expected.value,'$.id')=m.id AND json_extract(expected.value,'$.revision')=m.revision))`).bind(access.dataOwnerId,access.profile.id,exact).first<{n:number}>();
        if((gate?.n||0)>0)throw new ApiError(409,"The list changed. Confirm the latest entries before sending to the clinic.");
        const countGate=await db().prepare("SELECT COUNT(*) AS n FROM medications WHERE owner_id=? AND profile_id=? AND list_state='active'").bind(access.dataOwnerId,access.profile.id).first<{n:number}>();
        if((countGate?.n||0)!==list.length)throw new ApiError(409,"The list changed. Confirm the latest entries before sending to the clinic.");
      }
      const respondentRow=respondentId?await db().prepare("SELECT id,display_name,relationship,completion_role FROM respondents WHERE id=?").bind(respondentId).first<{id:string;display_name:string;relationship:string;completion_role:string}>():null;
      const identity={
        practice:{id:practice.id,name:practice.name},
        patient:{id:patient.id,legalName:patient.legal_name,dob:patient.dob,postalCode:patient.postal_code},
        appointment:{id:appointment.id,providerName:appointment.provider_name,serviceName:appointment.service_name,startsAt:appointment.starts_at,timezone:appointment.timezone,revision:appointment.revision},
        respondent:respondentRow?{id:respondentRow.id,displayName:respondentRow.display_name,relationship:respondentRow.relationship,completionRole:respondentRow.completion_role}:null,
        receivingClinic:RECEIVING_CLINIC_NAME,
      };
      let created;
      try{
        created=await createImmutableSubmission(db(),{
          ownerId:access.dataOwnerId,
          profileId:access.profile.id,
          practiceId:practice.id,
          patientId:patient.id,
          appointmentId:appointment.id,
          respondentId,
          idempotencyKey:key,
          medications:list,
          emptyListAttested,
          duplicateFlags:flags.map(f=>({id:f.id,flagType:f.flagType,explanation:f.explanation,status:f.status,medicationAId:f.medicationAId,medicationBId:f.medicationBId})),
          identity,
        });
      }catch(e){
        if(e instanceof Error && e.message==="SUBMISSION_IDEMPOTENCY_CONFLICT")throw new ApiError(409,"This submit request changed. Start a new send.");
        throw e;
      }
      // Durable receive: outbox → clinic inbox ack (not a local snapshot; not Aprima write-back).
      const ack=await processSubmissionOutbox(db(),created.submission.id);
      const row=await db().prepare("SELECT * FROM clinic_submissions WHERE id=?").bind(created.submission.id).first<ClinicSubmissionRow>();
      const submission=submissionFromRow(row!);
      await event(access.dataOwnerId,access.profile.id,submission.id,created.replayed?"clinic_submission_replayed":"clinic_submission_created").run();
      return json({
        submission,
        received:ack.received,
        deliveryLabel:deliveryLabel(submission.deliveryStatus),
        receivingClinic:RECEIVING_CLINIC_NAME,
        replayed:created.replayed,
        note:submission.deliveryStatus==="received"
          ?"Received by the clinic. Staff review and Aprima entry are separate steps."
          :"Submitted. Waiting for durable clinic receipt — a local snapshot is not delivery.",
      },created.replayed?200:201);
    }
    if(req.method==="GET"&&route==="clinic/inbox"){
      await assertStaffToolsAllowed(db(),principal);
      const date=text(url.searchParams.get("date")||"",10,true);
      if(!isValidDateOnly(date))throw new ApiError(400,"Use a valid appointment date (YYYY-MM-DD).");
      const practiceId=url.searchParams.get("practiceId")?id(url.searchParams.get("practiceId")):SYNTHETIC.practiceId;
      const membership=await db().prepare("SELECT id FROM staff_memberships WHERE practice_id=? AND principal_id=? AND role='staff' LIMIT 1").bind(practiceId,principal).first();
      if(!membership)throw new ApiError(403,"Staff access is required for the clinic inbox.");
      const inbox=await listInboxForPracticeDate(db(),practiceId,date);
      return json({
        date,
        practiceId,
        receivingClinic:RECEIVING_CLINIC_NAME,
        appointments:inbox.appointments.map(a=>({
          ...a,
          queue:{
            patientLegalName:a.patientLegalName,
            patientDob:a.patientDob,
            appointmentStartsAt:a.startsAt,
            submissionStatus:a.submission
              ?a.submission.staffStatus==="reviewed"?"reviewed":a.submission.deliveryStatus==="received"?"received":"submitted_pending_receipt"
              :"not_started",
            changeCounts:a.submission?.changeSummary.counts||{added:0,stopped:0,changed:0,duplicate:0,uncertain:0},
          },
          detail:{
            patientPostalCode:a.patientPostalCode,
            respondentId:a.submission?.respondentId||null,
            aprimaStatus:a.submission?.aprimaStatus||"not_entered",
          },
        })),
        note:"Primary action is Review on a received submission. ZIP and respondent stay in expanded detail.",
      });
    }
    if(req.method==="GET"&&parts[0]==="clinic"&&parts[1]==="submission"&&parts.length===3){
      const submissionId=id(parts[2]);
      const row=await db().prepare("SELECT * FROM clinic_submissions WHERE id=?").bind(submissionId).first<ClinicSubmissionRow>();
      if(!row)throw new ApiError(404,"This submission was not found.");
      let allowed=false;
      try{
        const access=await authorizeProfileAccess(db(),principal,row.profile_id);
        if(row.owner_id===access.dataOwnerId)allowed=true;
      }catch{
        /* staff path below */
      }
      if(!allowed){
        await assertStaffToolsAllowed(db(),principal);
        const membership=await db().prepare("SELECT id FROM staff_memberships WHERE practice_id=? AND principal_id=? AND role='staff' LIMIT 1").bind(row.practice_id,principal).first();
        if(!membership)throw new ApiError(403,"Staff access is required.");
        allowed=true;
      }
      if(!allowed)throw new ApiError(404,"This submission was not found.");
      const inbox=await db().prepare("SELECT * FROM clinic_inbox_items WHERE submission_id=?").bind(submissionId).first<ClinicInboxRow>();
      const patient=await db().prepare("SELECT legal_name,dob,postal_code FROM patients WHERE id=?").bind(row.patient_id).first<{legal_name:string;dob:string;postal_code:string|null}>();
      const respondent=row.respondent_id?await db().prepare("SELECT id,display_name,relationship,completion_role FROM respondents WHERE id=?").bind(row.respondent_id).first():null;
      return json({
        submission:submissionFromRow(row),
        inboxItem:inbox?inboxItemFromRow(inbox):null,
        deliveryLabel:deliveryLabel(row.delivery_status as "pending"|"received"),
        patient:patient?{legalName:patient.legal_name,dob:patient.dob,postalCode:patient.postal_code}:null,
        respondent,
        receivingClinic:row.recipient_clinic_name,
      });
    }
    if(req.method==="POST"&&parts[0]==="clinic"&&parts[1]==="submission"&&parts[3]==="review"&&parts.length===4){
      await assertStaffToolsAllowed(db(),principal);
      const submissionId=id(parts[2]);const b=await body(req);const staffStatus=parseStaffReviewStatus(b.staffStatus);
      const row=await db().prepare("SELECT * FROM clinic_submissions WHERE id=?").bind(submissionId).first<ClinicSubmissionRow>();
      if(!row)throw new ApiError(404,"This submission was not found.");
      if(row.delivery_status!=="received")throw new ApiError(409,"Review is available only after the clinic has received the submission.");
      const membership=await db().prepare("SELECT id FROM staff_memberships WHERE practice_id=? AND principal_id=? AND role='staff' LIMIT 1").bind(row.practice_id,principal).first();
      if(!membership)throw new ApiError(403,"Staff access is required.");
      const updated=await updateSubmissionStaffStatus(db(),submissionId,row.practice_id,staffStatus,principal);
      return json({submission:submissionFromRow(updated!),note:"Staff review is separate from Aprima entry and from patient confirmation."});
    }
    if(req.method==="POST"&&parts[0]==="clinic"&&parts[1]==="submission"&&parts[3]==="aprima"&&parts.length===4){
      await assertStaffToolsAllowed(db(),principal);
      const submissionId=id(parts[2]);const b=await body(req);const aprimaStatus=parseAprimaStatus(b.aprimaStatus);
      const row=await db().prepare("SELECT * FROM clinic_submissions WHERE id=?").bind(submissionId).first<ClinicSubmissionRow>();
      if(!row)throw new ApiError(404,"This submission was not found.");
      const membership=await db().prepare("SELECT id FROM staff_memberships WHERE practice_id=? AND principal_id=? AND role='staff' LIMIT 1").bind(row.practice_id,principal).first();
      if(!membership)throw new ApiError(403,"Staff access is required.");
      const updated=await updateSubmissionAprimaStatus(db(),submissionId,row.practice_id,aprimaStatus);
      return json({submission:submissionFromRow(updated!),note:"Aprima handling is tracked as not entered or entered manually. There is no write-back."});
    }
    if(req.method==="GET"&&route==="clinic/submission-status"){
      const access=await requireProfile(principal,url.searchParams.get("profile"));
      const appointmentId=url.searchParams.get("appointment")?id(url.searchParams.get("appointment")):"";
      let row:ClinicSubmissionRow|null=null;
      if(appointmentId)row=await latestSubmissionForAppointment(db(),appointmentId);
      else {
        row=await db().prepare("SELECT * FROM clinic_submissions WHERE owner_id=? AND profile_id=? ORDER BY submitted_at DESC LIMIT 1").bind(access.dataOwnerId,access.profile.id).first<ClinicSubmissionRow>();
      }
      if(!row||row.owner_id!==access.dataOwnerId)return json({submission:null,deliveryLabel:null,receivingClinic:RECEIVING_CLINIC_NAME});
      return json({submission:submissionFromRow(row),deliveryLabel:deliveryLabel(row.delivery_status as "pending"|"received"),receivingClinic:row.recipient_clinic_name});
    }
    throw new ApiError(404,"This action was not found.");
  } catch(e){
    if(e instanceof ApiError)return json({error:e.message},e.status);
    if(e instanceof AuthzError)return json({error:e.message},e.status);
    if(e instanceof ClinicApiError)return json({error:e.message},e.status);
    if(e instanceof ClinicIdentityError)return json({error:e.message},400);
    if(e instanceof MedicationChangeError)return json({error:e.message},400);
    if(e instanceof MedicationValidationError)return json({error:e.message},400);
    if(e instanceof RxNormError)return json({error:e.message},400);
    if(e instanceof ClinicSubmissionError)return json({error:e.message},400);
    return json({error:"The action could not be completed. Please try again. Reload the list before retrying a save."},500);
  }
}
export const GET=handle;export const POST=handle;export const PUT=handle;export const DELETE=handle;
