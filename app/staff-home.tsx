"use client";
import { useState } from "react";
import { ArrowUpRight, Camera, Check, ChevronRight, FileText, LoaderCircle, Plus, Upload, WalletCards } from "lucide-react";
import { isConfirmed, canCreateCard, type Medication, type Profile } from "@/lib/medication";
import type { StaffIdentityHeader } from "@/lib/clinic-identity";
import "./staff.css";

type CardSummary={id:string;recipient:string;patient_name:string;created_at:string};
type Props={profiles:Profile[];profileId:string;medications:Medication[];cards:CardSummary[];loading:boolean;signIn:string;error:string;busy:boolean;processing:boolean;identityHeader:StaffIdentityHeader|null;identityBusy:boolean;onProfile:(id:string)=>void;onNewProfile:()=>void;onImport:()=>void;onCamera:()=>void;onUpload:()=>void;onManual:()=>void;onReview:(medication:Medication)=>void;onCreateCard:()=>void;onOpenCard:(id:string)=>void;onDemo:()=>void;onLoadSyntheticHeader:()=>void;onShowHelperHeader:()=>void};
function formatDob(dob:string){const [y,m,d]=dob.split("-").map(Number);if(!y||!m||!d)return dob;return new Date(Date.UTC(y,m-1,d)).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"});}
function formatAppointment(startsAt:string,timezone:string){try{return new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short",timeZone:timezone}).format(new Date(startsAt));}catch{return startsAt;}}
export default function StaffHome(p:Props){
  const [adding,setAdding]=useState(false),[history,setHistory]=useState(false);
  const pending=p.medications.filter(m=>!isConfirmed(m)).length;
  const header=p.identityHeader;
  return <main className="staff-home">
    <header className="staff-header"><a className="brand" href="/"><span className="brand-icon"><WalletCards size={22}/></span>MedCarry</a><span className="staff-label">Staff workspace</span></header>
    <div className="staff-content"><div className="staff-title"><div><h1>Medication lists</h1><p>Test version · Demo records only</p></div></div>
      {p.signIn?<div className="staff-empty"><h2>Sign in to continue.</h2><a className="button primary" href={p.signIn} target="_top">Sign in with ChatGPT<ChevronRight size={18}/></a></div>
      :p.loading?<p className="loading-state"><LoaderCircle className="spin"/>Opening list…</p>:<>
        {header&&<section className="staff-identity-header" aria-label="Patient identity for this appointment">
          <div className="staff-identity-kicker">Protected patient detail · synthetic fixture</div>
          <div className="staff-identity-grid">
            <div><h2>{header.patient.legalName}</h2><p>DOB {formatDob(header.patient.dob)}{header.patient.postalCode?` · ZIP ${header.patient.postalCode}`:""}</p></div>
            <div><strong>Appointment</strong><p>{formatAppointment(header.appointment.startsAt,header.appointment.timezone)} · {header.appointment.providerName}</p><p>{header.appointment.serviceName}</p></div>
            <div><strong>External ID</strong><p>{header.externalMapping?`${header.externalMapping.sourceSystem}: ${header.externalMapping.externalPatientId}`:"None on file"}</p><p className="staff-identity-status">{header.matchingStatus.replaceAll("_"," ")}</p></div>
            <div><strong>Completed by</strong><p>{header.respondent?`${header.respondent.completionLabel}: ${header.respondent.displayName}`:"Not selected"}</p>{header.respondent&&header.respondent.completionRole!=="patient"&&<p>{header.respondent.relationship}</p>}</div>
            <div><strong>Submission</strong><p>Not started · no clinic delivery</p><p>Baseline: none imported</p></div>
          </div>
        </section>}
        <div className="staff-list-picker"><label className="field">Selected list<select value={p.profileId} onChange={e=>e.target.value==="new"?p.onNewProfile():p.onProfile(e.target.value)} disabled={p.processing||p.busy}>{!p.profiles.length&&<option value="">New medication list</option>}{p.profiles.map(profile=><option key={profile.id} value={profile.id}>{profile.name}</option>)}<option value="new">+ New list</option></select></label><a className="staff-patient-link" href={p.profileId?`/patient?profile=${p.profileId}`:"/patient"}>Open patient view<ArrowUpRight size={18}/></a></div>
        <div className="staff-toolbar"><button className="button primary" disabled={p.processing||p.busy} onClick={p.onImport}><FileText size={19}/>Import a list</button><button className="button secondary" aria-expanded={adding} disabled={p.processing||p.busy} onClick={()=>setAdding(!adding)}><Plus size={19}/>Add medication</button></div>
        {adding&&<div className="staff-add-options"><button className="button secondary" onClick={p.onCamera}><Camera size={18}/>Take picture</button><button className="button secondary" onClick={p.onUpload}><Upload size={18}/>Choose picture</button><button className="button secondary" onClick={p.onManual}>Type it in</button></div>}
        <div className="staff-list-heading"><h2>{history?"Saved lists":"Medications"} <span>{history?p.cards.length:p.medications.length}</span></h2><button className="text-button" onClick={()=>setHistory(!history)}>{history?"Back to medications":"Saved lists"}</button></div>
        {history?<section>{p.cards.length?p.cards.map(card=><button className="saved-card" disabled={p.busy} key={card.id} onClick={()=>p.onOpenCard(card.id)}><FileText size={25}/><span><strong>{card.patient_name}</strong><span>{new Date(card.created_at).toLocaleDateString()} · {card.recipient}</span></span><ChevronRight size={20}/></button>):<p className="staff-empty">No saved lists yet.</p>}</section>
        :<section>{p.medications.length?<div className="staff-medications">{p.medications.map(m=><article className="staff-medication" key={m.id}><div><h3>{m.productName||"Unnamed medication"}</h3><p>{m.strengthUnknown?"Strength unsure":m.strength||"Strength missing"} · {m.formulation}</p><span className={`status ${isConfirmed(m)?"confirmed":"pending"}`}>{isConfirmed(m)?<Check size={13}/>:null}{isConfirmed(m)?"Confirmed":"Needs review"}</span>{(m.actualUseUnknown||m.strengthUnknown||m.status==="unsure")&&<p className="staff-uncertainty">Unsure details · clinic review needed</p>}</div><button className="button secondary" disabled={p.busy} onClick={()=>p.onReview(m)}>Review<ChevronRight size={17}/></button></article>)}</div>:<div className="staff-empty"><FileText size={30}/><h3>No medications yet.</h3><p>Import an old list or add one medication.</p></div>}
          {p.medications.length>0&&<div className="staff-list-footer"><p>{pending?`${pending} medication${pending===1?"":"s"} to confirm`:"All medications confirmed"}</p><button className="button primary" disabled={!canCreateCard(p.medications)||p.busy} onClick={p.onCreateCard}>Save reviewed list<ChevronRight size={18}/></button></div>}
        </section>}
        <details className="staff-testing"><summary>Testing tools</summary><button className="text-button" disabled={p.processing||p.identityBusy} onClick={p.onDemo}>Try a fictional label</button><button className="text-button" disabled={p.processing||p.identityBusy} onClick={p.onLoadSyntheticHeader}>{p.identityBusy?"Loading synthetic header…":"Load synthetic appointment header"}</button><button className="text-button" disabled={p.processing||p.identityBusy||!p.identityHeader} onClick={p.onShowHelperHeader}>Show helper as respondent</button><a href="/wireframes">Design study<ArrowUpRight size={15}/></a></details>
      </>}
      {p.error&&<div className="alert error" role="alert">{p.error}</div>}
    </div>
  </main>;
}
