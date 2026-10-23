"use client";
import { useEffect, useState } from "react";
import { ArrowUpRight, ChevronRight, FileText, LoaderCircle, WalletCards } from "lucide-react";
import { isConfirmed, type Medication, type Profile } from "@/lib/medication";
import { STAFF_INBOX_INTRO } from "@/lib/clinic-submission";
import { SYNTHETIC } from "@/lib/synthetic-clinic";
import { api } from "@/lib/client-api";
import NoteImportPanel from "./note-import-panel";
import "./staff.css";

type InboxRow={
  appointmentId:string;patientLegalName:string;patientDob:string;startsAt:string;timezone:string;providerName:string;serviceName:string;
  queue:{submissionStatus:string;changeCounts:{added:number;stopped:number;changed:number;duplicate:number;uncertain:number}};
  detail:{patientPostalCode:string|null;respondentId:string|null;aprimaStatus:string};
  submission:{id:string}|null;
};
type ClinicPatient={id:string;legalName:string;dob:string;postalCode:string|null;profileId:string|null};
type Props={
  profiles:Profile[];profileId:string;medications:Medication[];loading:boolean;signIn:string;error:string;busy:boolean;processing:boolean;
  identityBusy:boolean;
  inboxDate:string;inboxRows:InboxRow[];inboxBusy:boolean;
  onProfile:(id:string)=>void;onManual:()=>void;onReview:(medication:Medication)=>void;
  onLoadInbox:()=>void;onInboxDate:(date:string)=>void;onReviewSubmission:(submissionId:string)=>void;
  onDemo:()=>void;onSeedClinic:()=>void;
  ensureProfile:()=>Promise<string>;
  onImportSaved:(profileId:string)=>Promise<void>;
  onBusy:(busy:boolean)=>void;
};
function formatDob(dob:string){const [y,m,d]=dob.split("-").map(Number);if(!y||!m||!d)return dob;return new Date(Date.UTC(y,m-1,d)).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"});}
function formatAppointment(startsAt:string,timezone:string){try{return new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short",timeZone:timezone}).format(new Date(startsAt));}catch{return startsAt;}}
function statusLabel(status:string){
  if(status==="received")return "Received";
  if(status==="reviewed")return "Reviewed";
  if(status==="submitted_pending_receipt")return "Pending receipt";
  return "Not started";
}
export default function StaffHome(p:Props){
  const [mode,setMode]=useState<"import"|"inbox">("import");
  const [patients,setPatients]=useState<ClinicPatient[]>([]);
  const [patientId,setPatientId]=useState("");
  const [patientsBusy,setPatientsBusy]=useState(false);
  const [patientsError,setPatientsError]=useState("");
  const [creating,setCreating]=useState(false);
  const [newName,setNewName]=useState("");
  const [newDob,setNewDob]=useState("");
  const [importKey,setImportKey]=useState(0);
  const [expanded,setExpanded]=useState<string|null>(null);
  const selected=patients.find(pt=>pt.id===patientId)||null;
  const linkedProfileId=selected?.profileId||"";

  async function loadPatients(preferPatientId?:string){
    setPatientsBusy(true);setPatientsError("");
    try{
      await api("clinic/seed-synthetic","POST",{});
      const r=await api<{patients:ClinicPatient[]}>(`clinic/patients?practiceId=${SYNTHETIC.practiceId}`);
      setPatients(r.patients);
      const prefer=preferPatientId||patientId;
      const next=r.patients.find(pt=>pt.id===prefer)||r.patients.find(pt=>pt.profileId===p.profileId)||r.patients.find(pt=>pt.id===SYNTHETIC.patients.aliceA.id)||r.patients[0];
      if(next){
        setPatientId(next.id);
        if(next.profileId&&next.profileId!==p.profileId)p.onProfile(next.profileId);
      }else setPatientId("");
    }catch(e){setPatientsError((e as Error).message);}
    finally{setPatientsBusy(false);}
  }

  useEffect(()=>{if(!p.signIn&&!p.loading)void loadPatients();},[p.signIn,p.loading]);

  function selectPatient(id:string){
    if(id===patientId)return;
    const next=patients.find(pt=>pt.id===id);
    setPatientId(id);
    setImportKey(k=>k+1); // Changing patient clears/restarts pending import.
    if(next?.profileId)p.onProfile(next.profileId);
  }

  async function createPatient(){
    setPatientsBusy(true);setPatientsError("");
    try{
      await api("clinic/seed-synthetic","POST",{});
      const r=await api<{patient:{id:string};profile:{id:string}}>("clinic/patients","POST",{
        practiceId:SYNTHETIC.practiceId,
        legalName:newName,
        dob:newDob,
      });
      setCreating(false);setNewName("");setNewDob("");
      setImportKey(k=>k+1);
      await loadPatients(r.patient.id);
      p.onProfile(r.profile.id);
    }catch(e){setPatientsError((e as Error).message);}
    finally{setPatientsBusy(false);}
  }

  return <main className="staff-home">
    <header className="staff-header">
      <a className="brand" href="/staff"><span className="brand-icon"><WalletCards size={22}/></span>MedCarry</a>
      <span className="staff-label">Staff workspace</span>
      {mode==="import"&&<button type="button" className="button secondary staff-inbox-link" disabled={p.busy} onClick={()=>{setMode("inbox");p.onLoadInbox();}}>Inbox</button>}
      {mode==="inbox"&&<button type="button" className="button secondary staff-inbox-link" disabled={p.busy} onClick={()=>setMode("import")}>Import</button>}
    </header>
    <div className="staff-content">
      {p.signIn?<div className="staff-empty"><h2>Sign in to continue.</h2><a className="button primary" href={p.signIn} target="_top">Sign in with ChatGPT<ChevronRight size={18}/></a></div>
      :p.loading?<p className="loading-state"><LoaderCircle className="spin"/>Opening workspace…</p>
      :mode==="inbox"?<>
        <div className="staff-title"><div><h1>Clinic inbox</h1><p>{STAFF_INBOX_INTRO}</p></div></div>
        <div className="staff-inbox-toolbar">
          <label className="field">Appointment date<input type="date" value={p.inboxDate} onChange={e=>p.onInboxDate(e.target.value)} disabled={p.inboxBusy||p.busy}/></label>
          <button className="button secondary" disabled={p.inboxBusy||p.busy} onClick={p.onLoadInbox}>{p.inboxBusy?"Loading…":"Refresh"}</button>
        </div>
        <section className="staff-inbox" aria-label="Appointment inbox">
          {p.inboxRows.length===0?<div className="staff-empty"><FileText size={30}/><h3>No appointments for this date.</h3><p>Choose another day, or use Testing tools to load the demo appointment.</p></div>
          :p.inboxRows.map(row=>{
            const counts=row.queue.changeCounts;
            const canReview=!!row.submission&&(row.queue.submissionStatus==="received"||row.queue.submissionStatus==="reviewed");
            return <article className="staff-inbox-row" key={row.appointmentId}>
              <div className="staff-inbox-main">
                <h3>{row.patientLegalName}</h3>
                <p>DOB {formatDob(row.patientDob)} · {formatAppointment(row.startsAt,row.timezone)}</p>
                <p className="staff-inbox-status">{statusLabel(row.queue.submissionStatus)} · {row.providerName}</p>
                <p className="staff-uncertainty">Added {counts.added} · Stopped/held {counts.stopped} · Changed {counts.changed} · Duplicate {counts.duplicate} · Uncertain {counts.uncertain}</p>
              </div>
              <div className="staff-inbox-actions">
                <button className="button primary" disabled={!canReview||p.busy} onClick={()=>row.submission&&p.onReviewSubmission(row.submission.id)}>Review<ChevronRight size={17}/></button>
                <button className="text-button" onClick={()=>setExpanded(expanded===row.appointmentId?null:row.appointmentId)}>{expanded===row.appointmentId?"Hide detail":"Show detail"}</button>
              </div>
              {expanded===row.appointmentId&&<div className="staff-inbox-detail">
                <p>ZIP {row.detail.patientPostalCode||"not on file"}</p>
                <p>Respondent id {row.detail.respondentId||"not selected"}</p>
                <p>Aprima {row.detail.aprimaStatus.replaceAll("_"," ")}</p>
                <p>{row.serviceName}</p>
              </div>}
            </article>;
          })}
        </section>
        <details className="staff-testing"><summary>Testing tools</summary><button className="text-button" disabled={p.processing||p.identityBusy} onClick={p.onSeedClinic}>{p.identityBusy?"Loading…":"Load demo appointment"}</button><a href="/wireframes">Design study<ArrowUpRight size={15}/></a></details>
      </>
      :<>
        <div className="staff-title"><div><h1>Import medications</h1><p>Choose a clinic patient, then import an older medication section.</p></div></div>
        <section className="staff-patient-panel" aria-label="Patient for import">
          <label className="field">Patient
            <select value={patientId} disabled={patientsBusy||p.busy} onChange={e=>{
              if(e.target.value==="__create"){setCreating(true);return;}
              selectPatient(e.target.value);
            }}>
              {!patients.length&&<option value="">Select a patient</option>}
              {patients.map(pt=><option key={pt.id} value={pt.id}>{pt.legalName} · DOB {formatDob(pt.dob)}{pt.profileId?"":" · needs list link"}</option>)}
              <option value="__create">+ Create patient</option>
            </select>
          </label>
          {selected&&<div className="staff-patient-header">
            <h2>{selected.legalName}</h2>
            <p>DOB {formatDob(selected.dob)}{selected.postalCode?` · ZIP ${selected.postalCode}`:""}</p>
            <p className="staff-uncertainty">{selected.profileId?"Linked medication list ready for import.":"This patient has no linked medication list. Create a patient record that includes a list, or pick another patient."}</p>
          </div>}
          {creating&&<div className="staff-create-patient">
            <h3>Create patient</h3>
            <p className="staff-uncertainty">Creates a new patient and linked medication list. Same name and date of birth do not merge with an existing patient.</p>
            <label className="field">Legal name<input value={newName} maxLength={120} disabled={patientsBusy} onChange={e=>setNewName(e.target.value)}/></label>
            <label className="field">Date of birth<input type="date" value={newDob} disabled={patientsBusy} onChange={e=>setNewDob(e.target.value)}/></label>
            <div className="staff-create-actions">
              <button className="button primary" disabled={patientsBusy||!newName.trim()||!newDob} onClick={()=>void createPatient()}>Create and continue</button>
              <button className="text-button" disabled={patientsBusy} onClick={()=>setCreating(false)}>Cancel</button>
            </div>
          </div>}
          {(patientsError||p.error)&&<div className="alert error" role="alert">{patientsError||p.error}</div>}
          {patientsBusy&&!selected&&<p className="loading-state"><LoaderCircle className="spin"/>Loading patients…</p>}
        </section>

        {selected&&selected.profileId?<>
          <section className="staff-import-workspace" aria-label="Medication import">
            <h2>Import medication section</h2>
            <p>Next: paste or read the older list for {selected.legalName}.</p>
            <NoteImportPanel
              key={`${importKey}:${selected.id}:${selected.profileId}`}
              patientId={selected.id}
              existing={p.medications}
              ensureProfile={async()=>{
                if(!selected.profileId)throw new Error("Select a patient with a linked medication list before importing.");
                if(selected.profileId!==p.profileId)p.onProfile(selected.profileId);
                return selected.profileId;
              }}
              onBusy={p.onBusy}
              onSaved={p.onImportSaved}
            />
          </section>
          {p.medications.length>0&&<section className="staff-medications" aria-label="Medications on this list">
            <h2>On this list <span>{p.medications.length}</span></h2>
            {p.medications.map(m=><article className="staff-medication" key={m.id}><div><h3>{m.productName||"Unnamed medication"}</h3><p>{m.strengthUnknown?"Strength unsure":m.strength||"Strength missing"} · {m.formulation}</p><span className={`status ${isConfirmed(m)?"confirmed":"pending"}`}>{isConfirmed(m)?"Confirmed":"Needs review"}</span></div><button className="button secondary" disabled={p.busy} onClick={()=>p.onReview(m)}>Review<ChevronRight size={17}/></button></article>)}
            <button className="text-button" disabled={p.busy} onClick={p.onManual}>Type in one medicine</button>
            {linkedProfileId&&<a className="staff-patient-link" href={`/patient?profile=${linkedProfileId}`}>Open patient view<ArrowUpRight size={18}/></a>}
          </section>}
        </>
        :selected&&!selected.profileId?<div className="staff-empty"><h3>Import blocked</h3><p>This patient has no linked medication list. Create a new patient (which creates a linked list), or choose a different patient.</p></div>
        :!creating&&<div className="staff-empty"><h3>Select a patient to import.</h3><p>Import binds to the patient record and linked medication list — not a display list name alone.</p></div>}

        <details className="staff-testing"><summary>Testing tools</summary>
          <button className="text-button" disabled={p.processing||p.identityBusy} onClick={()=>void loadPatients()}>Reload patients</button>
          <button className="text-button" disabled={p.processing||p.identityBusy} onClick={p.onDemo}>Try a fictional label</button>
          <button className="text-button" disabled={p.processing||p.identityBusy} onClick={p.onSeedClinic}>{p.identityBusy?"Loading…":"Load demo appointment"}</button>
          <a href="/wireframes">Design study<ArrowUpRight size={15}/></a>
        </details>
      </>}
      {p.error&&mode==="inbox"&&<div className="alert error" role="alert">{p.error}</div>}
    </div>
  </main>;
}
