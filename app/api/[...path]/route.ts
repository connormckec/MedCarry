import { env } from "cloudflare:workers";
import { getChatGPTUser, chatGPTSignInPath } from "@/app/chatgpt-auth";
import { MedicationValidationError, emptyMedication, validateFields, parseLabel, canCreateCard, type Medication, type MedicationFields } from "@/lib/medication";
import { ClinicApiError, ensureSyntheticClinic, getStaffIdentityHeader } from "@/lib/clinic-api";
import { ClinicIdentityError, proposePatientMatch, type PatientRecord } from "@/lib/clinic-identity";
import { SYNTHETIC } from "@/lib/synthetic-clinic";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };
type Row = { id: string; owner_id: string; profile_id: string; data: string; source_ids: string; revision: number; confirmed_revision: number | null; confirmed_at: string | null; created_at: string; updated_at: string };
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
async function profile(owner: string, value: unknown) { const pid=id(value);const p=await db().prepare("SELECT id,name,created_at FROM profiles WHERE id=? AND owner_id=?").bind(pid,owner).first<{id:string;name:string;created_at:string}>();if(!p)throw new ApiError(404,"This medication list was not found.");return p; }
async function medication(owner: string,value: unknown) { const row=await db().prepare("SELECT * FROM medications WHERE id=? AND owner_id=?").bind(id(value),owner).first<Row>();if(!row)throw new ApiError(404,"This medication was not found.");return row; }
function event(owner:string,pid:string,entity:string,action:string,revision:number|null=null) { return db().prepare("INSERT INTO audit_events (id,owner_id,profile_id,entity_id,action,revision,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),owner,pid,entity,action,revision,new Date().toISOString()); }
async function sources(owner:string,pid:string,value:unknown) {if(!Array.isArray(value)||value.length>4)throw new ApiError(400,"Use up to four photos for one medication.");const ids=[...new Set(value.map(id))];for(const sid of ids){const found=await db().prepare("SELECT id FROM uploads WHERE id=? AND owner_id=? AND profile_id=?").bind(sid,owner,pid).first();if(!found)throw new ApiError(400,"A source photo does not belong to this list.");}return ids;}
function revision(value:unknown){if(!Number.isInteger(value)||Number(value)<1)throw new ApiError(400,"A current record version is required.");return Number(value);}
function text(value:unknown,max:number,required=false){if(typeof value!=="string"||value.trim().length>max||(required&&!value.trim()))throw new ApiError(400,"Check the text you entered.");return value.trim();}
async function handle(req:Request,ctx:Context){
  try {
    const user=await getChatGPTUser();if(!user)return json({error:"Sign in to access your medication list.",signInUrl:chatGPTSignInPath(req.headers.get("x-medcarry-view")==="patient"?"/patient":"/")},401);
    const owner=user.userId;const parts=(await ctx.params).path;const url=new URL(req.url);const route=parts.join("/");
    if(req.method!=="GET"){
      if(req.headers.get("x-medcarry-request")!=="1")throw new ApiError(403,"This action must originate from the app.");
      const origin=req.headers.get("origin");
      if(origin && new URL(origin).host!==url.host && new URL(origin).host!==req.headers.get("host"))throw new ApiError(403,"Cross-site actions are not allowed.");
      if(!origin && req.headers.get("sec-fetch-site")!=="same-origin")throw new ApiError(403,"The request origin could not be verified.");
    }
    if(req.method==="GET"&&route==="bootstrap"){
      const ps=await db().prepare("SELECT id,name,created_at FROM profiles WHERE owner_id=? ORDER BY created_at LIMIT 12").bind(owner).all();
      return json({profiles:ps.results,displayName:user.fullName?.split(" ")[0]||"Your account"});
    }
    if(req.method==="POST"&&route==="clinic/seed-synthetic"){
      const result=await ensureSyntheticClinic(db(),owner);
      return json({...result,practiceId:SYNTHETIC.practiceId},result.seeded?201:200);
    }
    if(req.method==="GET"&&route==="clinic/staff-header"){
      const header=await getStaffIdentityHeader(db(),owner,url.searchParams.get("appointment"),url.searchParams.get("respondent")||undefined);
      return json({header});
    }
    if(req.method==="POST"&&route==="clinic/match-proposal"){
      const b=await body(req);const practiceId=id(b.practiceId);
      const membership=await db().prepare("SELECT id FROM staff_memberships WHERE practice_id=? AND principal_id=? AND role='staff' LIMIT 1").bind(practiceId,owner).first();
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
      const b=await body(req);const name=text(b.name,80,true);const count=await db().prepare("SELECT COUNT(*) AS n FROM profiles WHERE owner_id=?").bind(owner).first<{n:number}>();if((count?.n||0)>=12)throw new ApiError(400,"You can create up to 12 separate lists.");
      const pid=crypto.randomUUID(),now=new Date().toISOString();await db().batch([db().prepare("INSERT INTO profiles (id,owner_id,name,created_at) VALUES (?,?,?,?)").bind(pid,owner,name,now),event(owner,pid,pid,"profile_created")]);return json({profile:{id:pid,name,created_at:now}},201);
    }
    if(req.method==="GET"&&route==="list"){
      const p=await profile(owner,url.searchParams.get("profile"));const rows=await db().prepare("SELECT * FROM medications WHERE owner_id=? AND profile_id=? ORDER BY created_at DESC LIMIT 100").bind(owner,p.id).all<Row>();
      const cards=await db().prepare("SELECT id,recipient,patient_name,created_at FROM snapshots WHERE owner_id=? AND profile_id=? ORDER BY created_at DESC LIMIT 15").bind(owner,p.id).all();return json({medications:rows.results.map(med),cards:cards.results});
    }
    if(req.method==="POST"&&route==="upload"){
      const p=await profile(owner,url.searchParams.get("profile"));const bytes=await boundedBytes(req,6*1024*1024);if(bytes.length<12)throw new ApiError(400,"This file is empty or not a supported photo.");
      let mime="";if(bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)mime="image/jpeg";
      if([137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))mime="image/png";
      if(new TextDecoder().decode(bytes.slice(0,4))==="RIFF"&&new TextDecoder().decode(bytes.slice(8,12))==="WEBP")mime="image/webp";
      if(!mime)throw new ApiError(415,"Use a JPG, PNG, or WebP photo. You can also use manual entry.");
      const count=await db().prepare("SELECT COUNT(*) AS n FROM uploads WHERE owner_id=?").bind(owner).first<{n:number}>();if((count?.n||0)>=400)throw new ApiError(400,"This prototype has reached its photo limit.");
      const uid=crypto.randomUUID(),key=`${owner}/${p.id}/${uid}`,now=new Date().toISOString();await bucket().put(key,bytes,{httpMetadata:{contentType:mime}});
      try {await db().batch([db().prepare("INSERT INTO uploads (id,owner_id,profile_id,object_key,mime_type,size,created_at) VALUES (?,?,?,?,?,?,?)").bind(uid,owner,p.id,key,mime,bytes.length,now),event(owner,p.id,uid,"photo_uploaded")]);}catch(e){await bucket().delete(key);throw e;}
      return json({id:uid,url:`/api/upload/${uid}`,size:bytes.length},201);
    }
    if(req.method==="GET"&&parts[0]==="upload"&&parts.length===2){
      const found=await db().prepare("SELECT object_key,mime_type FROM uploads WHERE id=? AND owner_id=?").bind(id(parts[1]),owner).first<{object_key:string;mime_type:string}>();if(!found)throw new ApiError(404,"Photo not found.");const obj=await bucket().get(found.object_key);if(!obj)throw new ApiError(404,"Photo not found.");return new Response(obj.body,{headers:{...baseHeaders,"Content-Type":found.mime_type,"Content-Disposition":"inline","Content-Security-Policy":"default-src 'none'; sandbox"}});
    }
    if(req.method==="DELETE"&&parts[0]==="upload"&&parts.length===2){
      const uid=id(parts[1]);const used=await db().prepare("SELECT id FROM medications WHERE owner_id=? AND source_ids LIKE ? LIMIT 1").bind(owner,`%${uid}%`).first();const shared=await db().prepare("SELECT id FROM snapshots WHERE owner_id=? AND data LIKE ? LIMIT 1").bind(owner,`%${uid}%`).first();if(used||shared)throw new ApiError(409,"This photo is part of a saved record.");const found=await db().prepare("SELECT object_key FROM uploads WHERE id=? AND owner_id=?").bind(uid,owner).first<{object_key:string}>();if(found){await bucket().delete(found.object_key);await db().prepare("DELETE FROM uploads WHERE id=? AND owner_id=?").bind(uid,owner).run();}return json({deleted:true});
    }
    if(req.method==="POST"&&route==="parse") {const b=await body(req);const label=text(b.text,12000,true);return json(parseLabel(label));}
    if(req.method==="POST"&&route==="note-import"){
      const b=await body(req,128000),p=await profile(owner,b.profileId),key=id(b.idempotencyKey);
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
      const existing=await db().prepare("SELECT data FROM medications WHERE owner_id=? AND profile_id=? LIMIT 100").bind(owner,p.id).all<{data:string}>();
      if(existing.results.length+fields.length>100)throw new ApiError(400,"This list supports up to 100 medication entries.");
      const identity=(m:MedicationFields)=>`${m.productName.toLowerCase().replace(/\s+/g," ").trim()}|${m.strength.toLowerCase().replace(/\s+/g," ").trim()}`;
      const seen=new Set(existing.results.map(r=>identity(JSON.parse(r.data))));
      for(const f of fields){if(seen.has(identity(f)))throw new ApiError(409,`Already listed or repeated: ${f.productName} ${f.strength}. Review it instead of importing a duplicate.`);seen.add(identity(f));}
      const ids=fields.map(()=>crypto.randomUUID()),now=new Date().toISOString();
      const statements=[db().prepare("INSERT INTO note_imports (id,owner_id,profile_id,idempotency_key,payload_hash,medication_ids,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),owner,p.id,key,hash,JSON.stringify(ids),now)];
      fields.forEach((f,i)=>{statements.push(db().prepare("INSERT INTO medications (id,owner_id,profile_id,data,source_ids,revision,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)").bind(ids[i],owner,p.id,JSON.stringify(f),"[]",now,now));statements.push(event(owner,p.id,ids[i],"historical_note_imported",1));});
      try{await db().batch(statements);}catch(e){const retry=await db().prepare("SELECT profile_id,payload_hash,medication_ids FROM note_imports WHERE owner_id=? AND idempotency_key=?").bind(owner,key).first<{profile_id:string;payload_hash:string;medication_ids:string}>();if(retry&&retry.profile_id===p.id&&retry.payload_hash===hash)return json({ids:JSON.parse(retry.medication_ids),replayed:true});throw e;}
      return json({ids,unconfirmed:true},201);
    }
    if(req.method==="GET"&&route==="search"){
      const q=text(url.searchParams.get("q")||"",180,true);if(q.length<3)throw new ApiError(400,"Enter at least three characters to search.");
      const result=await fetch(`https://rxnav.nlm.nih.gov/REST/drugs.json?name=${encodeURIComponent(q)}`,{signal:AbortSignal.timeout(8000),headers:{Accept:"application/json"}}).catch(()=>{throw new ApiError(502,"The NLM medication reference is unavailable. You can continue manually.");});
      if(!result.ok)throw new ApiError(502,"The NLM medication reference is unavailable. You can continue manually.");
      const data=await result.json() as {drugGroup?:{conceptGroup?:{tty?:string;conceptProperties?:{rxcui:string;name:string}[]}[]}};
      const groups=data.drugGroup?.conceptGroup||[];const allowed=groups.filter(g=>["SCD","SBD","GPCK","BPCK"].includes(g.tty||""));
      const seen=new Set<string>();const results=allowed.flatMap(g=>g.conceptProperties||[]).filter(c=>{if(seen.has(c.rxcui))return false;seen.add(c.rxcui);return true;}).slice(0,12).map(c=>({rxCui:c.rxcui,name:c.name}));return json({results,source:"NLM RxNorm",note:"Reference matches do not establish your directions or current use."});
    }
    if(req.method==="POST"&&route==="medication"){
      const b=await body(req),p=await profile(owner,b.profileId),fields=validateFields(b.fields);fields.adherenceReportedAt=fields.adherence==="not_reported"?"":new Date().toISOString();const sourceIds=await sources(owner,p.id,b.sourceIds||[]);
      const count=await db().prepare("SELECT COUNT(*) AS n FROM medications WHERE owner_id=? AND profile_id=?").bind(owner,p.id).first<{n:number}>();if((count?.n||0)>=100)throw new ApiError(400,"This prototype supports up to 100 entries in a list.");
      const mid=crypto.randomUUID(),now=new Date().toISOString();await db().batch([db().prepare("INSERT INTO medications (id,owner_id,profile_id,data,source_ids,revision,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)").bind(mid,owner,p.id,JSON.stringify(fields),JSON.stringify(sourceIds),now,now),event(owner,p.id,mid,"medication_created",1)]);return json({medication:med((await medication(owner,mid)))},201);
    }
    if(req.method==="PUT"&&parts[0]==="medication"&&parts.length===2){
      const row=await medication(owner,parts[1]),b=await body(req),rev=revision(b.revision),fields=validateFields(b.fields);const previous=JSON.parse(row.data);if(previous.sourceDocument){fields.sourceDocument=previous.sourceDocument;fields.sourceDate=previous.sourceDate||"";fields.sourceText=previous.sourceText||"";}fields.adherenceReportedAt=fields.adherence==="not_reported"?"":b.adherenceReviewed===true||fields.adherence!==previous.adherence?new Date().toISOString():(previous.adherenceReportedAt||"");const sourceIds=await sources(owner,row.profile_id,b.sourceIds||[]);const now=new Date().toISOString();
      const result=await db().prepare("UPDATE medications SET data=?,source_ids=?,revision=revision+1,confirmed_revision=NULL,confirmed_at=NULL,updated_at=? WHERE id=? AND owner_id=? AND revision=?").bind(JSON.stringify(fields),JSON.stringify(sourceIds),now,row.id,owner,rev).run();if(result.meta.changes!==1)throw new ApiError(409,"This entry changed in another session. Reload the list before editing again.");await event(owner,row.profile_id,row.id,"medication_updated",rev+1).run();return json({medication:med(await medication(owner,row.id))});
    }
    if(req.method==="POST"&&parts[0]==="confirm"&&parts.length===2){
      const row=await medication(owner,parts[1]),b=await body(req),rev=revision(b.revision);if(b.acknowledged!==true)throw new ApiError(400,"Explicitly confirm this medication after reviewing it.");if(rev!==row.revision)throw new ApiError(409,"This entry changed. Please review its latest version.");validateFields(JSON.parse(row.data),true);const now=new Date().toISOString();
      const result=await db().prepare("UPDATE medications SET confirmed_revision=revision,confirmed_at=?,updated_at=? WHERE id=? AND owner_id=? AND revision=?").bind(now,now,row.id,owner,rev).run();if(result.meta.changes!==1)throw new ApiError(409,"This entry changed. Please review its latest version.");await event(owner,row.profile_id,row.id,"medication_confirmed",rev).run();return json({medication:med(await medication(owner,row.id))});
    }
    if(req.method==="DELETE"&&parts[0]==="medication"&&parts.length===2){
      const row=await medication(owner,parts[1]),b=await body(req),rev=revision(b.revision);const result=await db().prepare("DELETE FROM medications WHERE id=? AND owner_id=? AND revision=?").bind(row.id,owner,rev).run();if(result.meta.changes!==1)throw new ApiError(409,"This entry changed. Reload before removing it.");await event(owner,row.profile_id,row.id,"medication_removed",rev).run();return json({deleted:true});
    }
    if(req.method==="POST"&&route==="card"){
      const b=await body(req),p=await profile(owner,b.profileId);const recipient=text(b.recipient,120,true),patientName=text(b.patientName,120,true),key=id(b.idempotencyKey);
      const existing=await db().prepare("SELECT id,profile_id FROM snapshots WHERE owner_id=? AND idempotency_key=?").bind(owner,key).first<{id:string;profile_id:string}>();if(existing){if(existing.profile_id!==p.id)throw new ApiError(409,"This card request belongs to another list.");return json({id:existing.id});}
      const rows=await db().prepare("SELECT * FROM medications WHERE owner_id=? AND profile_id=? ORDER BY created_at LIMIT 100").bind(owner,p.id).all<Row>();const list=rows.results.map(med);
      if(!canCreateCard(list))throw new ApiError(409,"Confirm every medication's current version before creating a provider card.");for(const m of list)validateFields(m,true);
      const cid=crypto.randomUUID(),now=new Date().toISOString();const data=JSON.stringify({id:cid,recipient,patientName,createdAt:now,medications:list});
      const exact=JSON.stringify(list.map(m=>({id:m.id,revision:m.revision})));
      const sql=`INSERT INTO snapshots (id,owner_id,profile_id,recipient,patient_name,data,idempotency_key,created_at) SELECT ?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM medications WHERE owner_id=? AND profile_id=?)=? AND NOT EXISTS (SELECT 1 FROM medications AS m WHERE owner_id=? AND profile_id=? AND (confirmed_revision IS NULL OR confirmed_revision!=revision OR confirmed_at IS NULL OR NOT EXISTS (SELECT 1 FROM json_each(?) AS expected WHERE json_extract(expected.value,'$.id')=m.id AND json_extract(expected.value,'$.revision')=m.revision)))`;
      let result;
      try {result=await db().prepare(sql).bind(cid,owner,p.id,recipient,patientName,data,key,now,owner,p.id,list.length,owner,p.id,exact).run();}catch(e){const duplicate=await db().prepare("SELECT id FROM snapshots WHERE owner_id=? AND idempotency_key=?").bind(owner,key).first<{id:string}>();if(duplicate)return json({id:duplicate.id});throw e;}
      if(result.meta.changes!==1)throw new ApiError(409,"The list changed while the card was being created. Review and confirm the latest entries.");await event(owner,p.id,cid,"provider_card_created").run();return json({id:cid},201);
    }
    if(req.method==="GET"&&parts[0]==="card"&&parts.length===2){const row=await db().prepare("SELECT data FROM snapshots WHERE id=? AND owner_id=?").bind(id(parts[1]),owner).first<{data:string}>();if(!row)throw new ApiError(404,"This card was not found.");return json({card:JSON.parse(row.data)});}
    throw new ApiError(404,"This action was not found.");
  } catch(e){
    if(e instanceof ApiError)return json({error:e.message},e.status);
    if(e instanceof ClinicApiError)return json({error:e.message},e.status);
    if(e instanceof ClinicIdentityError)return json({error:e.message},400);
    if(e instanceof MedicationValidationError)return json({error:e.message},400);
    return json({error:"The action could not be completed. Please try again. Reload the list before retrying a save."},500);
  }
}
export const GET=handle;export const POST=handle;export const PUT=handle;export const DELETE=handle;
