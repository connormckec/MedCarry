import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import ts from 'typescript';
import * as medicationLogic from '../lib/medication.ts';
import * as clinicApi from '../lib/clinic-api.ts';
import * as clinicIdentity from '../lib/clinic-identity.ts';
import * as clinicAuthz from '../lib/clinic-authz.ts';
import * as medicationChanges from '../lib/medication-changes.ts';
import * as rxnorm from '../lib/rxnorm.ts';
import * as rxnormStore from '../lib/rxnorm-store.ts';
import {LOCAL_MOCK_PRINCIPAL_ID,SYNTHETIC,SYNTHETIC_HELPER_PRINCIPAL_ID,SYNTHETIC_PATIENT_PRINCIPAL_ID} from '../lib/synthetic-clinic.ts';
const source=readFileSync(new URL('../app/api/[...path]/route.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const migrations=new URL('../drizzle/',import.meta.url);
const ddl=readdirSync(migrations).filter(f=>f.endsWith('.sql')).sort().map(f=>readFileSync(new URL(f,migrations),'utf8')).join('\n');
function fixture(){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec(ddl);const objects=new Map();let user={userId:'owner',email:'owner@example.test',fullName:'Fictional Test'};
  const DB={
    prepare(sql){
      return {bind(...args){
        const s=sqlite.prepare(sql);
        return {
          async first(){return s.get(...args)||null},
          async all(){return {results:s.all(...args)}},
          async run(){const r=s.run(...args);return {meta:{changes:Number(r.changes)}}}
        };
      }};
    },
    async batch(statements){
      sqlite.exec('BEGIN');
      try{const results=[];for(const s of statements)results.push(await s.run());sqlite.exec('COMMIT');return results}
      catch(e){sqlite.exec('ROLLBACK');throw e}
    }
  };
  const BUCKET={async put(k,bytes,o){objects.set(k,{bytes:new Uint8Array(bytes),type:o.httpMetadata.contentType})},async get(k){const o=objects.get(k);return o?{body:new Blob([o.bytes]).stream()}:null},async delete(k){objects.delete(k)}};
  const clinicBindings={
    ClinicApiError:clinicApi.ClinicApiError,
    ensureSyntheticClinic:clinicApi.ensureSyntheticClinic,
    getStaffIdentityHeader:clinicApi.getStaffIdentityHeader,
    ClinicIdentityError:clinicIdentity.ClinicIdentityError,
    proposePatientMatch:clinicIdentity.proposePatientMatch,
    AuthzError:clinicAuthz.AuthzError,
    assertStaffToolsAllowed:clinicAuthz.assertStaffToolsAllowed,
    authorizeProfileAccess:clinicAuthz.authorizeProfileAccess,
    authorizeUploadAccess:clinicAuthz.authorizeUploadAccess,
    listAccessibleProfiles:clinicAuthz.listAccessibleProfiles,
    MedicationChangeError:medicationChanges.MedicationChangeError,
    parseChangeReason:medicationChanges.parseChangeReason,
    parseEditorDraft:medicationChanges.parseEditorDraft,
    SYNTHETIC,
    ...rxnorm,
    ...rxnormStore,
  };
  const names=['env','getChatGPTUser','chatGPTSignInPath',...Object.keys(medicationLogic),...Object.keys(clinicBindings)];
  const values=[{DB,BUCKET},async()=>user,()=>'/signin-with-chatgpt?return_to=%2F',...Object.values(medicationLogic),...Object.values(clinicBindings)];
  const handlers=new Function(...names,`${compiled}\nreturn {GET,POST,PUT,DELETE};`)(...values);
  async function request(path,method='GET',payload,headers={}){
    const h={'Origin':'https://medcarry.test','X-Medcarry-Request':'1',...headers};if(payload!==undefined&&!(payload instanceof Uint8Array))h['Content-Type']='application/json';
    const req=new Request('https://medcarry.test/api/'+path,{method,headers:h,body:payload===undefined?undefined:payload instanceof Uint8Array?payload:JSON.stringify(payload)});
    const res=await handlers[method](req,{params:Promise.resolve({path:path.split('?')[0].split('/')})});
    const isJSON=res.headers.get('content-type')?.includes('json');return {status:res.status,data:isJSON?await res.json():await res.arrayBuffer(),headers:res.headers};
  }
  return {request,sqlite,objects,setUser(v){user=v}};
}
const valid=()=>({...medicationLogic.emptyMedication(),productName:'Fictional tablet',strength:'25 mg',actualDose:'1',frequency:'daily'});
async function setup(f){const p=await f.request('profile','POST',{name:'Fictional list'});assert.equal(p.status,201);return p.data.profile.id;}
async function add(f,p,fields=valid(),sourceIds=[]){const r=await f.request('medication','POST',{profileId:p,fields,sourceIds});assert.equal(r.status,201);return r.data.medication;}
test('all record APIs require authenticated request identity',async()=>{const f=fixture();f.setUser(null);assert.equal((await f.request('bootstrap')).status,401);assert.equal((await f.request('profile','POST',{name:'x'})).status,401);f.sqlite.close();});
test('cross-origin mutations are blocked',async()=>{const f=fixture();assert.equal((await f.request('profile','POST',{name:'x'},{Origin:'https://other.test'})).status,403);f.sqlite.close();});
test('manual entry persists and cannot be shared until individually confirmed',async()=>{const f=fixture(),p=await setup(f),m=await add(f,p);const payload={profileId:p,recipient:'Demo clinic',patientName:'Fictional',idempotencyKey:crypto.randomUUID()};assert.equal((await f.request('card','POST',payload)).status,409);assert.equal((await f.request('confirm/'+m.id,'POST',{revision:1,acknowledged:false})).status,400);assert.equal((await f.request('confirm/'+m.id,'POST',{revision:1,acknowledged:true})).status,200);const card=await f.request('card','POST',payload);assert.equal(card.status,201);const detail=await f.request('card/'+card.data.id);assert.equal(detail.data.card.medications[0].productName,'Fictional tablet');const retry=await f.request('card','POST',payload);assert.equal(retry.data.id,card.data.id);f.sqlite.close();});
test('edits clear confirmation, old editor writes conflict, and snapshots remain unchanged',async()=>{const f=fixture(),p=await setup(f),m=await add(f,p);await f.request('confirm/'+m.id,'POST',{revision:1,acknowledged:true});const original=await f.request('card','POST',{profileId:p,recipient:'Demo',patientName:'Fictional',idempotencyKey:crypto.randomUUID()});const changed=await f.request('medication/'+m.id,'PUT',{fields:{...valid(),actualDose:'1/2'},sourceIds:[],revision:1});assert.equal(changed.status,200);assert.equal(changed.data.medication.confirmedRevision,null);assert.equal((await f.request('medication/'+m.id,'PUT',{fields:valid(),sourceIds:[],revision:1})).status,409);assert.equal((await f.request('confirm/'+m.id,'POST',{revision:1,acknowledged:true})).status,409);const old=await f.request('card/'+original.data.id);assert.equal(old.data.card.medications[0].actualDose,'1');assert.equal((await f.request('card','POST',{profileId:p,recipient:'Demo',patientName:'Fictional',idempotencyKey:crypto.randomUUID()})).status,409);f.sqlite.close();});
test('confirmation validates the fields again on the server',async()=>{const f=fixture(),p=await setup(f),m=await add(f,p,{...valid(),actualDose:''});const r=await f.request('confirm/'+m.id,'POST',{revision:1,acknowledged:true});assert.equal(r.status,400);assert.match(r.data.error,/how much/);f.sqlite.close();});
test('photo bytes are persisted and only returned to the owning user',async()=>{const f=fixture(),p=await setup(f);const png=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);const up=await f.request('upload?profile='+p,'POST',png,{'Content-Type':'image/png'});assert.equal(up.status,201);assert.equal(f.objects.size,1);const image=await f.request('upload/'+up.data.id);assert.equal(image.status,200);assert.equal(image.headers.get('cache-control'),'private, no-store');assert.equal(image.data.byteLength,png.length);f.setUser({userId:'other',email:'other@example.test'});assert.equal((await f.request('upload/'+up.data.id)).status,404);f.sqlite.close();});
test('unsupported files and declared oversized bodies are rejected',async()=>{const f=fixture(),p=await setup(f);assert.equal((await f.request('upload?profile='+p,'POST',new TextEncoder().encode('<svg>not-an-image</svg>'),{'Content-Type':'image/svg+xml'})).status,415);assert.equal((await f.request('upload?profile='+p,'POST',new Uint8Array(12),{'Content-Length':String(7*1024*1024)})).status,413);f.sqlite.close();});
test('photos and medication records cannot cross patient-list boundaries',async()=>{const f=fixture(),p=await setup(f);const p2=(await f.request('profile','POST',{name:'Other list'})).data.profile.id;const image=await f.request('upload?profile='+p,'POST',new Uint8Array([255,216,255,0,0,0,0,0,0,0,0,0]));const r=await f.request('medication','POST',{profileId:p2,fields:valid(),sourceIds:[image.data.id]});assert.equal(r.status,400);f.sqlite.close();});
test('saved photos cannot be silently removed and cross-owner reads are denied',async()=>{const f=fixture(),p=await setup(f);const image=await f.request('upload?profile='+p,'POST',new Uint8Array([255,216,255,0,0,0,0,0,0,0,0,0]));const m=await add(f,p,valid(),[image.data.id]);assert.equal((await f.request('upload/'+image.data.id,'DELETE')).status,409);f.setUser({userId:'other',email:'other@example.test'});assert.equal((await f.request('list?profile='+p)).status,404);assert.equal((await f.request('confirm/'+m.id,'POST',{revision:1,acknowledged:true})).status,404);assert.equal((await f.request('medication/'+m.id,'DELETE',{revision:1})).status,404);f.sqlite.close();});
const importBody=(p,changes={})=>({profileId:p,sourceDocument:'Fictional prior note',sourceDate:'2026-07-01',reviewed:true,idempotencyKey:crypto.randomUUID(),rows:[{...valid(),sourceText:'Fictional tablet 25 mg; take 1 tablet daily.'}],...changes});
test('note import forces historical uncertainty and leaves all entries unconfirmed',async()=>{const f=fixture(),p=await setup(f);const r=await f.request('note-import','POST',importBody(p));assert.equal(r.status,201);const list=await f.request('list?profile='+p);const m=list.data.medications[0];assert.equal(m.source,'note');assert.equal(m.sourceDate,'2026-07-01');assert.equal(m.actualUseUnknown,true);assert.equal(m.status,'unsure');assert.equal(m.actualDose,'');assert.equal(m.labelDirections,'');assert.equal(m.confirmedRevision,null);assert.equal((await f.request('card','POST',{profileId:p,recipient:'Demo',patientName:'Fictional',idempotencyKey:crypto.randomUUID()})).status,409);f.sqlite.close();});
test('repeating an import is idempotent and changed content conflicts',async()=>{const f=fixture(),p=await setup(f),payload=importBody(p);const one=await f.request('note-import','POST',payload);const retry=await f.request('note-import','POST',payload);assert.equal(retry.status,200);assert.deepEqual(one.data.ids,retry.data.ids);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM medications').get().n,1);assert.equal((await f.request('note-import','POST',{...payload,sourceDate:'2026-08-01'})).status,409);f.sqlite.close();});
test('import duplicate detection and date validation happen before any writes',async()=>{const f=fixture(),p=await setup(f);const payload=importBody(p);assert.equal((await f.request('note-import','POST',{...payload,sourceDate:'2026-02-30'})).status,400);assert.equal((await f.request('note-import','POST',{...payload,rows:[payload.rows[0],payload.rows[0]]})).status,409);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM medications').get().n,0);await add(f,p);assert.equal((await f.request('note-import','POST',payload)).status,409);f.sqlite.close();});
test('imports require staff review and cannot cross owner or profile boundaries',async()=>{const f=fixture(),p=await setup(f);assert.equal((await f.request('note-import','POST',importBody(p,{reviewed:false}))).status,400);assert.equal((await f.request('note-import','POST',importBody(p,{rows:Array(21).fill(valid())}))).status,400);f.setUser({userId:'other',email:'other@example.test'});assert.equal((await f.request('note-import','POST',importBody(p))).status,404);f.setUser(null);assert.equal((await f.request('note-import','POST',importBody(p))).status,401);f.sqlite.close();});
test('a database failure rolls back imported rows and its idempotency reservation',async()=>{const f=fixture(),p=await setup(f);f.sqlite.exec("CREATE TRIGGER reject_import BEFORE INSERT ON medications BEGIN SELECT RAISE(ABORT, 'fixture failure'); END");const payload=importBody(p);assert.equal((await f.request('note-import','POST',payload)).status,500);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM note_imports').get().n,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM medications').get().n,0);f.sqlite.exec('DROP TRIGGER reject_import');assert.equal((await f.request('note-import','POST',payload)).status,201);f.sqlite.close();});
test('imported medicine can receive a photo and current report without losing historical evidence',async()=>{const f=fixture(),p=await setup(f);const imported=await f.request('note-import','POST',importBody(p));const mid=imported.data.ids[0];const photo=await f.request('upload?profile='+p,'POST',new Uint8Array([255,216,255,0,0,0,0,0,0,0,0,0]));const before=(await f.request('list?profile='+p)).data.medications[0];const updated=await f.request('medication/'+mid,'PUT',{revision:1,sourceIds:[photo.data.id],fields:{...before,source:'photo',sourceDate:'2026-10-22',sourceText:'This must not replace the original evidence',status:'taking',actualUseUnknown:false,actualDose:'1/2',frequency:'daily'}});assert.equal(updated.status,200);assert.equal(updated.data.medication.sourceText,before.sourceText);assert.equal(updated.data.medication.sourceDate,'2026-07-01');assert.equal(updated.data.medication.revision,2);assert.equal((await f.request('confirm/'+mid,'POST',{revision:1,acknowledged:true})).status,409);assert.equal((await f.request('confirm/'+mid,'POST',{revision:2,acknowledged:true})).status,200);const made=await f.request('card','POST',{profileId:p,recipient:'Demo',patientName:'Fictional',idempotencyKey:crypto.randomUUID()});assert.equal(made.status,201);const snapshot=await f.request('card/'+made.data.id);assert.equal(snapshot.data.card.medications[0].actualDose,'1/2');assert.equal(snapshot.data.card.medications[0].sourceDate,'2026-07-01');assert.equal(f.sqlite.prepare('SELECT count(*) n FROM medications').get().n,1);f.sqlite.close();});
test('synthetic clinic seed is limited to the local mock principal',async()=>{
  const f=fixture();
  assert.equal((await f.request('clinic/seed-synthetic','POST',{})).status,403);
  f.setUser({userId:LOCAL_MOCK_PRINCIPAL_ID,email:'seedy@sites.test',fullName:'Seedy'});
  const seeded=await f.request('clinic/seed-synthetic','POST',{});
  assert.equal(seeded.status,201);
  assert.equal(seeded.data.appointmentId,SYNTHETIC.appointmentAliceA.id);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM patients').get().n,3);
  assert.equal(f.sqlite.prepare("SELECT verification_status s FROM external_patient_mappings").get().s,'unverified');
  const again=await f.request('clinic/seed-synthetic','POST',{});
  assert.equal(again.status,200);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM patients').get().n,3);
  f.sqlite.close();
});
test('staff identity header requires membership and keeps helper distinct from patient',async()=>{
  const f=fixture();
  f.setUser({userId:LOCAL_MOCK_PRINCIPAL_ID,email:'seedy@sites.test',fullName:'Seedy'});
  await f.request('clinic/seed-synthetic','POST',{});
  const header=await f.request('clinic/staff-header?appointment='+SYNTHETIC.appointmentAliceA.id);
  assert.equal(header.status,200);
  assert.equal(header.data.header.patient.legalName,'Alice Example');
  assert.equal(header.data.header.patient.dob,'1948-03-12');
  assert.equal(header.data.header.patient.postalCode,'02115');
  assert.equal(header.data.header.externalMapping.verificationStatus,'unverified');
  assert.equal(header.data.header.matchingStatus,'unverified_mapping');
  assert.equal(header.data.header.respondent.completionRole,'patient');
  assert.equal(header.data.header.submissionStatus,'not_started');
  const helper=await f.request('clinic/staff-header?appointment='+SYNTHETIC.appointmentAliceA.id+'&respondent='+SYNTHETIC.respondentHelper.id);
  assert.equal(helper.status,200);
  assert.equal(helper.data.header.respondent.completionRole,'helper');
  assert.equal(helper.data.header.respondent.completionLabel,'Authorized helper');
  assert.notEqual(helper.data.header.respondent.displayName,helper.data.header.patient.legalName);
  f.setUser({userId:'stranger',email:'stranger@example.test'});
  assert.equal((await f.request('clinic/staff-header?appointment='+SYNTHETIC.appointmentAliceA.id)).status,403);
  f.sqlite.close();
});
test('match proposal is staff-only and does not auto-attach on name alone',async()=>{
  const f=fixture();
  f.setUser({userId:LOCAL_MOCK_PRINCIPAL_ID,email:'seedy@sites.test',fullName:'Seedy'});
  await f.request('clinic/seed-synthetic','POST',{});
  const unique=await f.request('clinic/match-proposal','POST',{practiceId:SYNTHETIC.practiceId,legalName:'Alice Example',dob:'1948-03-12'});
  assert.equal(unique.status,200);
  assert.equal(unique.data.proposal.status,'unique');
  const ambiguousSeed=f.sqlite.prepare('INSERT INTO patients (id,practice_id,legal_name,dob,postal_code,created_at,updated_at) VALUES (?,?,?,?,?,?,?)');
  ambiguousSeed.run('a2222222-2222-4222-8222-222222222299',SYNTHETIC.practiceId,'Alice Example','1948-03-12','02115',new Date().toISOString(),new Date().toISOString());
  const ambiguous=await f.request('clinic/match-proposal','POST',{practiceId:SYNTHETIC.practiceId,legalName:'Alice Example',dob:'1948-03-12',postalCode:'02115'});
  assert.equal(ambiguous.data.proposal.status,'ambiguous');
  f.setUser({userId:'stranger',email:'stranger@example.test'});
  assert.equal((await f.request('clinic/match-proposal','POST',{practiceId:SYNTHETIC.practiceId,legalName:'Alice Example',dob:'1948-03-12'})).status,403);
  f.sqlite.close();
});
test('patient sessions cannot use staff import, list create, search, or clinic tools',async()=>{
  const f=fixture();
  f.setUser({userId:LOCAL_MOCK_PRINCIPAL_ID,email:'seedy@sites.test',fullName:'Seedy'});
  await f.request('clinic/seed-synthetic','POST',{});
  f.setUser({userId:SYNTHETIC_PATIENT_PRINCIPAL_ID,email:'alice@example.test',fullName:'Alice Example'});
  assert.equal((await f.request('profile','POST',{name:'Hijack list'})).status,403);
  assert.equal((await f.request('note-import','POST',{profileId:SYNTHETIC.aliceProfileId,sourceDocument:'x',reviewed:true,idempotencyKey:crypto.randomUUID(),rows:[{...valid(),sourceText:'Fictional tablet 25 mg'}]})).status,403);
  assert.equal((await f.request('search?q=metoprolol')).status,403);
  assert.equal((await f.request('clinic/staff-header?appointment='+SYNTHETIC.appointmentAliceA.id)).status,403);
  assert.equal((await f.request('clinic/seed-synthetic','POST',{})).status,403);
  f.sqlite.close();
});
test('authorized patient can read and mutate their linked list but not another patient photo',async()=>{
  const f=fixture();
  f.setUser({userId:LOCAL_MOCK_PRINCIPAL_ID,email:'seedy@sites.test',fullName:'Seedy'});
  await f.request('clinic/seed-synthetic','POST',{});
  const png=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);
  const up=await f.request('upload?profile='+SYNTHETIC.aliceProfileId,'POST',png,{'Content-Type':'image/png'});
  assert.equal(up.status,201);
  const med=await f.request('medication','POST',{profileId:SYNTHETIC.aliceProfileId,fields:valid(),sourceIds:[up.data.id]});
  assert.equal(med.status,201);
  f.setUser({userId:SYNTHETIC_PATIENT_PRINCIPAL_ID,email:'alice@example.test',fullName:'Alice Example'});
  const list=await f.request('list?profile='+SYNTHETIC.aliceProfileId);
  assert.equal(list.status,200);
  assert.equal(list.data.access.actor,'patient');
  assert.equal((await f.request('upload/'+up.data.id)).status,200);
  const edited=await f.request('medication/'+med.data.medication.id,'PUT',{revision:1,sourceIds:[up.data.id],fields:{...valid(),actualDose:'1/2'}});
  assert.equal(edited.status,200);
  assert.equal(edited.data.medication.confirmedRevision,null);
  // Second linked patient list for Bob — patient Alice must not read it
  const now=new Date().toISOString();
  f.sqlite.prepare('INSERT INTO profiles (id,owner_id,name,created_at) VALUES (?,?,?,?)').run('a7777777-7777-4777-8777-777777777702',LOCAL_MOCK_PRINCIPAL_ID,'Bob list',now);
  f.sqlite.prepare('INSERT INTO profile_patient_links (id,profile_id,patient_id,linked_by,created_at) VALUES (?,?,?,?,?)').run('a8888888-8888-4888-8888-888888888802','a7777777-7777-4777-8777-777777777702',SYNTHETIC.patients.bob.id,'test',now);
  f.setUser({userId:LOCAL_MOCK_PRINCIPAL_ID,email:'seedy@sites.test',fullName:'Seedy'});
  const bobPhoto=await f.request('upload?profile=a7777777-7777-4777-8777-777777777702','POST',png,{'Content-Type':'image/png'});
  assert.equal(bobPhoto.status,201);
  f.setUser({userId:SYNTHETIC_PATIENT_PRINCIPAL_ID,email:'alice@example.test',fullName:'Alice Example'});
  assert.equal((await f.request('list?profile=a7777777-7777-4777-8777-777777777702')).status,404);
  assert.equal((await f.request('upload/'+bobPhoto.data.id)).status,404);
  f.sqlite.close();
});
test('helper access is distinct and revoked authorization stops photo reads',async()=>{
  const f=fixture();
  f.setUser({userId:LOCAL_MOCK_PRINCIPAL_ID,email:'seedy@sites.test',fullName:'Seedy'});
  await f.request('clinic/seed-synthetic','POST',{});
  const png=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);
  const up=await f.request('upload?profile='+SYNTHETIC.aliceProfileId,'POST',png,{'Content-Type':'image/png'});
  f.setUser({userId:SYNTHETIC_HELPER_PRINCIPAL_ID,email:'dana@example.test',fullName:'Dana Example'});
  const list=await f.request('list?profile='+SYNTHETIC.aliceProfileId);
  assert.equal(list.status,200);
  assert.equal(list.data.access.actor,'helper');
  assert.equal((await f.request('upload/'+up.data.id)).status,200);
  assert.equal((await f.request('note-import','POST',{profileId:SYNTHETIC.aliceProfileId,sourceDocument:'x',reviewed:true,idempotencyKey:crypto.randomUUID(),rows:[{...valid(),sourceText:'line'}]})).status,403);
  f.sqlite.prepare("UPDATE respondents SET authorization_status='revoked' WHERE id=?").run(SYNTHETIC.respondentHelper.id);
  assert.equal((await f.request('upload/'+up.data.id)).status,403);
  assert.equal((await f.request('list?profile='+SYNTHETIC.aliceProfileId)).status,403);
  f.sqlite.close();
});
test('cross-clinic staff membership cannot open another practice linked list',async()=>{
  const f=fixture();
  f.setUser({userId:LOCAL_MOCK_PRINCIPAL_ID,email:'seedy@sites.test',fullName:'Seedy'});
  await f.request('clinic/seed-synthetic','POST',{});
  const now=new Date().toISOString();
  f.sqlite.prepare('INSERT INTO practices (id,name,created_at) VALUES (?,?,?)').run(SYNTHETIC.otherPracticeId,'Other Clinic',now);
  f.sqlite.prepare('INSERT INTO staff_memberships (id,practice_id,principal_id,role,created_at) VALUES (?,?,?,?,?)').run(crypto.randomUUID(),SYNTHETIC.otherPracticeId,'other_staff','staff',now);
  f.setUser({userId:'other_staff',email:'other@example.test',fullName:'Other Staff'});
  assert.equal((await f.request('list?profile='+SYNTHETIC.aliceProfileId)).status,404);
  assert.equal((await f.request('clinic/staff-header?appointment='+SYNTHETIC.appointmentAliceA.id)).status,403);
  f.sqlite.close();
});
test('client view header cannot escalate a patient into staff tools',async()=>{
  const f=fixture();
  f.setUser({userId:LOCAL_MOCK_PRINCIPAL_ID,email:'seedy@sites.test',fullName:'Seedy'});
  await f.request('clinic/seed-synthetic','POST',{});
  f.setUser({userId:SYNTHETIC_PATIENT_PRINCIPAL_ID,email:'alice@example.test',fullName:'Alice Example'});
  assert.equal((await f.request('profile','POST',{name:'x'},{'X-Medcarry-View':'staff'})).status,403);
  assert.equal((await f.request('search?q=aspirin', 'GET', undefined, {'X-Medcarry-View':'staff'})).status,403);
  f.sqlite.close();
});
test('no longer take retains the medication and invalidates confirmation',async()=>{
  const f=fixture(),p=await setup(f),m=await add(f,p);
  await f.request('confirm/'+m.id,'POST',{revision:1,acknowledged:true});
  const changed=await f.request('medication/'+m.id+'/change','POST',{revision:1,reason:'no_longer_take'});
  assert.equal(changed.status,200);
  assert.equal(changed.data.medication.status,'stopped');
  assert.equal(changed.data.medication.confirmedRevision,null);
  assert.equal(changed.data.reason,'no_longer_take');
  const list=await f.request('list?profile='+p);
  assert.equal(list.data.medications.length,1);
  assert.equal(list.data.medications[0].status,'stopped');
  assert.equal(list.data.changeEvents[0].reason,'no_longer_take');
  assert.equal((await f.request('card','POST',{profileId:p,recipient:'Demo',patientName:'Fictional',idempotencyKey:crypto.randomUUID()})).status,409);
  f.sqlite.close();
});
test('added by mistake suppresses with Undo restoring active list and clearing confirmation',async()=>{
  const f=fixture(),p=await setup(f),m=await add(f,p);
  await f.request('confirm/'+m.id,'POST',{revision:1,acknowledged:true});
  const suppressed=await f.request('medication/'+m.id+'/change','POST',{revision:1,reason:'added_by_mistake'});
  assert.equal(suppressed.status,200);
  assert.equal(suppressed.data.suppressed,true);
  assert.equal((await f.request('list?profile='+p)).data.medications.length,0);
  assert.equal(f.sqlite.prepare("SELECT list_state s FROM medications WHERE id=?").get(m.id).s,'suppressed');
  const undone=await f.request('medication/'+m.id+'/undo-change','POST',{revision:2,changeEventId:suppressed.data.changeEventId});
  assert.equal(undone.status,200);
  assert.equal(undone.data.medication.confirmedRevision,null);
  assert.equal((await f.request('list?profile='+p)).data.medications.length,1);
  assert.match(undone.data.note,/Confirm/i);
  f.sqlite.close();
});
test('editor draft autosave resumes and clears after confirm',async()=>{
  const f=fixture(),p=await setup(f);
  const saved=await f.request('draft','PUT',{profileId:p,medicationId:'',draft:{fields:valid(),sourceIds:[],step:2}});
  assert.equal(saved.status,201);
  const list=await f.request('list?profile='+p);
  assert.equal(list.data.openDrafts.length,1);
  assert.equal(list.data.openDrafts[0].draft.fields.productName,'Fictional tablet');
  const m=await add(f,p);
  await f.request('draft','PUT',{profileId:p,medicationId:m.id,draft:{fields:{...valid(),actualDose:'1/2'},sourceIds:[],medicationRevision:1}});
  await f.request('confirm/'+m.id,'POST',{revision:1,acknowledged:true});
  const after=await f.request('list?profile='+p);
  assert.equal(after.data.openDrafts.filter(d=>d.medicationId===m.id).length,0);
  f.sqlite.close();
});
test('DELETE medication soft-suppresses instead of erasing history',async()=>{
  const f=fixture(),p=await setup(f),m=await add(f,p);
  const r=await f.request('medication/'+m.id,'DELETE',{revision:1});
  assert.equal(r.status,200);
  assert.equal(r.data.suppressed,true);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM medications').get().n,1);
  assert.equal(f.sqlite.prepare("SELECT list_state s FROM medications").get().s,'suppressed');
  f.sqlite.close();
});
test('RxNorm normalize flags brand/generic duplicates without merging',async()=>{
  const f=fixture(),p=await setup(f);
  const brand=await add(f,p,{...valid(),productName:'Eliquis',strength:'5 mg',actualDose:'1',frequency:'twice'});
  const generic=await add(f,p,{...valid(),productName:'apixaban',strength:'5 mg',actualDose:'1',frequency:'twice'});
  assert.equal(brand.rxCui,'1364447');
  assert.equal(generic.rxCui,'1364445');
  const list=await f.request('list?profile='+p);
  assert.equal(list.status,200);
  assert.ok(list.data.terminology.length>=2);
  const dup=list.data.duplicateFlags.find(d=>d.flagType==='possible_duplicate'&&d.status==='open');
  assert.ok(dup);
  assert.match(dup.explanation,/Brand and generic|clinical product/i);
  assert.equal(list.data.medications.length,2);
  const responded=await f.request('duplicate-flag/'+dup.id+'/respond','POST',{response:'take_both'});
  assert.equal(responded.status,200);
  assert.equal(responded.data.flag.status,'take_both');
  assert.equal((await f.request('list?profile='+p)).data.medications.length,2);
  f.sqlite.close();
});
test('distinct strength and release cases do not propose possible_duplicate',async()=>{
  const f=fixture(),p=await setup(f);
  await add(f,p,{...valid(),productName:'apixaban',strength:'5 mg'});
  await add(f,p,{...valid(),productName:'apixaban',strength:'2.5 mg'});
  await add(f,p,{...valid(),productName:'metoprolol tartrate',strength:'50 mg'});
  await add(f,p,{...valid(),productName:'metoprolol succinate',strength:'50 mg'});
  const list=await f.request('list?profile='+p);
  assert.equal(list.data.medications.length,4);
  assert.equal(list.data.duplicateFlags.some(d=>d.flagType==='possible_duplicate'&&d.status==='open'),false);
  assert.ok(list.data.duplicateFlags.some(d=>d.flagType==='different_strength_or_schedule'));
  assert.ok(list.data.duplicateFlags.some(d=>d.flagType==='different_formulation_release'));
  f.sqlite.close();
});
test('manual NLM outage path keeps drafts usable without inventing RxCUI',async()=>{
  const f=fixture(),p=await setup(f);
  const m=await add(f,p,{...valid(),productName:'Eliquis',strength:'5 mg'});
  const outage=await f.request('normalize','POST',{medicationId:m.id,nlmUnavailable:true});
  assert.equal(outage.status,200);
  assert.equal(outage.data.terminology.mappingStatus,'unavailable');
  assert.equal(outage.data.terminology.rxCui,'');
  assert.equal(outage.data.medication.productName,'Eliquis');
  const draft=await f.request('draft','PUT',{profileId:p,medicationId:m.id,draft:{fields:{...valid(),productName:'Eliquis',strength:'5 mg'},sourceIds:[]}});
  assert.equal(draft.status,201);
  f.sqlite.close();
});
