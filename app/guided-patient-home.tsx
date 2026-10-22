"use client";
import { useEffect, useState } from "react";
import { Camera, Check, ChevronRight, LoaderCircle, Pill, ShieldCheck, Upload, WalletCards } from "lucide-react";
import { isConfirmed, type Medication } from "@/lib/medication";
import "./patient/patient.css";

type Props={medications:Medication[];loading:boolean;signIn:string;error:string;processing:boolean;finished:boolean;onCamera:()=>void;onUpload:()=>void;onManual:()=>void;onReview:(m:Medication)=>void;onDone:()=>void;onViewList:()=>void;onChangeList:()=>void};
export default function GuidedPatientHome(p:Props){
  const [adding,setAdding]=useState(false);
  const pending=p.medications.filter(m=>!isConfirmed(m));
  useEffect(()=>{setAdding(false);},[p.medications]);
  const capture=!p.finished&&(!p.medications.length||adding);
  return <main className="patient-home">
    <header className="patient-brand"><span className="brand-icon"><WalletCards size={22}/></span><strong>MedCarry</strong><ShieldCheck size={22}/></header>
    <div className="patient-testing">Test version · Demo records only</div>
    <section className="patient-body">
      {p.signIn?<div className="patient-access"><h1>Open your list.</h1><p>Sign in with ChatGPT to try this version.</p><a className="patient-primary" href={p.signIn} target="_top">Sign in<ChevronRight size={22}/></a></div>
      :p.loading?<p className="patient-loading" role="status"><LoaderCircle className="spin"/>Opening your list…</p>
      :p.finished?<>
        <div className="patient-success"><Check size={34}/></div><h1>You're done.</h1><p>Your list is saved for your visit.</p>
        <p className="patient-small">It has not been sent to the clinic.</p>
        <button className="patient-primary" disabled={p.processing} onClick={p.onViewList}>View my list<ChevronRight size={22}/></button>
        <button className="patient-text" onClick={()=>{setAdding(false);p.onChangeList();}}>Add or change a medication</button>
      </>:<>
        <h1>{capture?"Add a medication.":pending.length?"Check your medicines.":"Anything else?"}</h1>
        <p className="patient-intro">{capture?"Photograph the name and directions.":pending.length?"Check one medicine at a time.":"Include vitamins and supplements."}</p>
        {capture?<div className="patient-capture">
          <button className="patient-primary" disabled={p.processing} onClick={p.onCamera}><Camera size={24}/>Take a picture</button>
          <details className="patient-alternatives"><summary>Other ways to add it</summary><button className="patient-secondary" disabled={p.processing} onClick={p.onUpload}><Upload size={21}/>Choose a picture</button><button className="patient-secondary" disabled={p.processing} onClick={p.onManual}>Type it in</button></details>
          {p.medications.length>0&&<button className="patient-text" onClick={()=>setAdding(false)}>Back to my list</button>}
        </div>:<>
          {pending.length>0?<><div className="patient-count">{p.medications.length-pending.length} of {p.medications.length} checked</div><button className="patient-primary" disabled={p.processing} onClick={()=>p.onReview(pending[0])}>Check next medication<ChevronRight size={22}/></button></>
          :<button className="patient-primary" disabled={p.processing} onClick={p.onDone}><Check size={23}/>I've added all my medications</button>}
          <button className="patient-secondary" disabled={p.processing} onClick={()=>setAdding(true)}><Camera size={22}/>Add another medication</button>
        </>}
        {p.medications.length>0&&<details className="patient-list"><summary>View my medications ({p.medications.length})</summary>{p.medications.map(m=><button key={m.id} className="patient-med" disabled={p.processing} onClick={()=>p.onReview(m)}><span className="patient-med-icon"><Pill size={24}/></span><span><strong>{m.productName||"Medication to finish"}</strong><span>{m.strengthUnknown?"Strength unsure":m.strength||"Check strength"}</span><b>{isConfirmed(m)?(m.actualUseUnknown||m.strengthUnknown||m.status==="unsure"?"Checked · some details unsure":"Checked"):"Needs checking"}</b></span><ChevronRight size={21}/></button>)}</details>}
      </>}
      {p.error&&<div className="patient-error" role="alert">{p.error}</div>}
    </section>
  </main>;
}
