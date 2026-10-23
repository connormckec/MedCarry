"use client";
import { useEffect, useState } from "react";
import { Camera, Check, ChevronRight, FileText, LoaderCircle, Pill, ShieldCheck, WalletCards } from "lucide-react";
import { isConfirmed, type Medication, type MedicationFields } from "@/lib/medication";
import { PATIENT_SEND_CTA, PATIENT_SEND_INTRO, patientReceiptCopy } from "@/lib/clinic-submission";
import "./patient/patient.css";

type ResumeDraft={id:string;medicationId:string|null;updatedAt:string;draft:{fields:Partial<MedicationFields>&{productName?:string};sourceIds:string[]}};
type DuplicateFlag={id:string;medicationAId:string;medicationBId:string;flagType:string;explanation:string;status:string};
type CleanupPair={medicationAId:string;medicationBId:string}|null;
type ClinicReceipt={deliveryStatus:"pending"|"received";deliveryLabel:string;receivingClinic:string;emptyListAttested?:boolean}|null;
type Props={
  medications:Medication[];loading:boolean;signIn:string;error:string;processing:boolean;
  clinicReceipt:ClinicReceipt;resumeDraft:ResumeDraft|null;duplicateFlags?:DuplicateFlag[];duplicatePrompt?:string;
  cleanupPair?:CleanupPair;
  onDuplicateRespond?:(id:string,response:"take_both"|"added_twice"|"unsure")=>void;
  onCleanupDismiss?:()=>void;
  onPhoto:()=>void;onUpload:()=>void;onManual:()=>void;
  onReview:(m:Medication,opts?:{cleanup?:boolean})=>void;
  onRemove:(m:Medication,reason:"added_by_mistake"|"no_longer_take")=>void;
  onResumeDraft:(d:ResumeDraft)=>void;
  onSendToClinic:(opts:{emptyListAttested:boolean})=>void;onViewReceipt:()=>void;onChangeList:()=>void;
};
export default function GuidedPatientHome(p:Props){
  const [adding,setAdding]=useState(false);
  const [readyToSend,setReadyToSend]=useState(false);
  const [removeId,setRemoveId]=useState<string|null>(null);
  const pending=p.medications.filter(m=>!isConfirmed(m));
  const next=pending[0];
  const openDupes=(p.duplicateFlags||[]).filter(f=>f.status==="open");
  const finished=!!p.clinicReceipt;
  const receipt=p.clinicReceipt?patientReceiptCopy(p.clinicReceipt.deliveryStatus,p.clinicReceipt.receivingClinic):null;
  useEffect(()=>{setAdding(false);setRemoveId(null);},[p.medications]);
  useEffect(()=>{if(pending.length>0)setReadyToSend(false);},[pending.length]);
  const capture=!finished&&(!p.medications.length||adding);
  const askMissing=!finished&&!capture&&pending.length===0&&p.medications.length>0&&!readyToSend;
  const sendStep=!finished&&!capture&&pending.length===0&&p.medications.length>0&&readyToSend;
  function medLabel(id:string){const m=p.medications.find(x=>x.id===id);return m?`${m.productName||"Medication"}${m.strength?` ${m.strength}`:""}`:"Medication";}
  function medById(id:string){return p.medications.find(x=>x.id===id);}
  const listDetails=p.medications.length>0&&!capture&&<div className="patient-med-list">
    <h2>Your medicines ({p.medications.length})</h2>
    {p.medications.map(m=>{
      const similar=openDupes.find(f=>f.medicationAId===m.id||f.medicationBId===m.id);
      const otherId=similar?(similar.medicationAId===m.id?similar.medicationBId:similar.medicationAId):"";
      const removing=removeId===m.id;
      return <div className="patient-med-row" key={m.id}>
        <button type="button" className="patient-med" disabled={p.processing} onClick={()=>p.onReview(m)}>
          <span className="patient-med-icon"><Pill size={24}/></span>
          <span>
            <strong>{m.productName||"Medication to finish"}</strong>
            <span>{m.strengthUnknown?"Strength unsure":m.strength||"Check strength"}</span>
            <b>{isConfirmed(m)?(m.actualUseUnknown||m.strengthUnknown||m.status==="unsure"?"Checked · some details unsure":m.status==="stopped"?"Checked · no longer take":"Checked"):"Needs checking"}</b>
            {similar&&<em className="patient-similar">Looks similar to {medLabel(otherId)}</em>}
          </span>
          <span className="patient-med-edit">Edit<ChevronRight size={21}/></span>
        </button>
        {!removing?<button type="button" className="patient-remove" disabled={p.processing} onClick={()=>setRemoveId(m.id)}>Remove</button>
        :<div className="patient-remove-reasons" role="group" aria-label={`Why remove ${m.productName||"this medicine"}?`}>
          <p>Why remove it?</p>
          <button type="button" className="patient-secondary" disabled={p.processing} onClick={()=>p.onRemove(m,"added_by_mistake")}>Added by mistake</button>
          <button type="button" className="patient-secondary" disabled={p.processing} onClick={()=>p.onRemove(m,"no_longer_take")}>I no longer take it</button>
          <button type="button" className="patient-text" disabled={p.processing} onClick={()=>setRemoveId(null)}>Cancel</button>
        </div>}
      </div>;
    })}
  </div>;
  return <main className="patient-home">
    <header className="patient-brand"><span className="brand-icon"><WalletCards size={22}/></span><strong>MedCarry</strong><ShieldCheck size={22}/></header>
    <div className="patient-testing">Test version · Demo records only</div>
    <section className="patient-body">
      {p.signIn?<div className="patient-access"><h1>Open your list.</h1><p>Sign in with ChatGPT to try this version.</p><a className="patient-primary" href={p.signIn} target="_top">Sign in<ChevronRight size={22}/></a></div>
      :p.loading?<p className="patient-loading" role="status"><LoaderCircle className="spin"/>Opening your list…</p>
      :finished&&receipt&&p.clinicReceipt?<>
        <div className="patient-success"><Check size={34}/></div>
        <h1>{receipt.headline}</h1>
        <p>{receipt.detail}</p>
        {(receipt.portalNote||p.clinicReceipt.emptyListAttested)&&<p className="patient-small">{receipt.portalNote}{p.clinicReceipt.emptyListAttested?(receipt.portalNote?" ":"")+"You attested that you take no medications.":""}</p>}
        <button className="patient-primary" disabled={p.processing} onClick={p.onViewReceipt}>View what was received<ChevronRight size={22}/></button>
        <button className="patient-text" onClick={()=>{setAdding(false);setReadyToSend(false);p.onChangeList();}}>Add or change a medication</button>
      </>
      :<>
        {!capture&&p.resumeDraft&&<button className="patient-secondary" disabled={p.processing} onClick={()=>p.onResumeDraft(p.resumeDraft!)}>Continue unfinished medication{p.resumeDraft.draft.fields.productName?`: ${p.resumeDraft.draft.fields.productName}`:""}<ChevronRight size={21}/></button>}
        {!capture&&p.cleanupPair&&medById(p.cleanupPair.medicationAId)&&medById(p.cleanupPair.medicationBId)&&<div className="patient-cleanup" role="status">
          <h2>Clean up a duplicate</h2>
          <p>Both stay on your list until you choose. Open the one added by mistake, then choose <strong>I added this by mistake</strong>.</p>
          <button className="patient-secondary" disabled={p.processing} onClick={()=>p.onReview(medById(p.cleanupPair!.medicationAId)!,{cleanup:true})}>Open {medLabel(p.cleanupPair.medicationAId)}<ChevronRight size={21}/></button>
          <button className="patient-secondary" disabled={p.processing} onClick={()=>p.onReview(medById(p.cleanupPair!.medicationBId)!,{cleanup:true})}>Open {medLabel(p.cleanupPair.medicationBId)}<ChevronRight size={21}/></button>
          <p className="patient-small">If you take both, leave them. If you stopped one, open it and choose “I no longer take this” — that does not cancel a prescription.</p>
          {p.onCleanupDismiss&&<button className="patient-text" disabled={p.processing} onClick={p.onCleanupDismiss}>I'll fix this later</button>}
        </div>}
        {!capture&&openDupes.length>0&&p.onDuplicateRespond&&<div className="patient-duplicate" role="status">
          <h2>{p.duplicatePrompt||"Looks similar to another medicine on your list."}</h2>
          {openDupes.slice(0,3).map(flag=><div className="patient-duplicate-card" key={flag.id}>
            <p><strong>{medLabel(flag.medicationAId)}</strong> and <strong>{medLabel(flag.medicationBId)}</strong></p>
            <p className="patient-small">{flag.explanation}</p>
            <div className="patient-duplicate-actions">
              <button className="patient-secondary" disabled={p.processing} onClick={()=>p.onDuplicateRespond!(flag.id,"take_both")}>I take both</button>
              <button className="patient-secondary" disabled={p.processing} onClick={()=>p.onDuplicateRespond!(flag.id,"added_twice")}>I added one twice</button>
              <button className="patient-text" disabled={p.processing} onClick={()=>p.onDuplicateRespond!(flag.id,"unsure")}>I'm not sure</button>
            </div>
            <p className="patient-small">Nothing is removed automatically. You choose keep, mistake, or no longer take.</p>
          </div>)}
        </div>}
        {capture?<>
          <h1>Add a medicine.</h1>
          <p className="patient-intro">Choose one way.</p>
          <div className="patient-capture patient-add-choices">
            <button className="patient-primary" disabled={p.processing} onClick={p.onPhoto}><Camera size={24}/>Take or upload a picture</button>
            <button className="patient-secondary" disabled={p.processing} onClick={p.onManual}><FileText size={21}/>Type it in</button>
            {p.medications.length>0&&<button className="patient-text" onClick={()=>setAdding(false)}>Back to my list</button>}
            {!p.medications.length&&<button className="patient-text" disabled={p.processing} onClick={()=>p.onSendToClinic({emptyListAttested:true})}>I take no medications or supplements</button>}
          </div>
        </>
        :askMissing?<>
          <div className="patient-success"><Check size={34}/></div>
          <h1>Anything missing?</h1>
          <p className="patient-intro">Medicines, vitamins, or supplements that are not on your list yet?</p>
          <div className="patient-count">{p.medications.length} checked</div>
          <button className="patient-primary" disabled={p.processing} onClick={()=>setAdding(true)}><Camera size={22}/>Add a medicine</button>
          <button className="patient-secondary" disabled={p.processing} onClick={()=>setReadyToSend(true)}>Nothing missing<ChevronRight size={22}/></button>
          {listDetails}
        </>
        :sendStep?<>
          <h1>Send to Innovation Cardiology</h1>
          <p className="patient-intro">{PATIENT_SEND_INTRO}</p>
          <div className="patient-count">{p.medications.length} medicine{p.medications.length===1?"":"s"} ready</div>
          <button className="patient-primary" disabled={p.processing} onClick={()=>p.onSendToClinic({emptyListAttested:false})}><Check size={23}/>{PATIENT_SEND_CTA}</button>
          <button className="patient-secondary" disabled={p.processing} onClick={()=>setAdding(true)}><Camera size={22}/>Add a medicine</button>
          <button className="patient-text" disabled={p.processing} onClick={()=>setReadyToSend(false)}>Back</button>
          {listDetails}
        </>
        :<>
          <h1>Check your medicines.</h1>
          <p className="patient-intro">One at a time.</p>
          <div className="patient-count">{p.medications.length-pending.length} of {p.medications.length} checked</div>
          {next&&<div className="patient-next-med" aria-live="polite">
            <span className="patient-med-icon"><Pill size={28}/></span>
            <div>
              <strong>{next.productName||"Medication to finish"}</strong>
              <span>{next.strengthUnknown?"Strength unsure":next.strength||"Check strength"}</span>
            </div>
          </div>}
          <button className="patient-primary" disabled={p.processing||!next} onClick={()=>next&&p.onReview(next)}>Check this medicine<ChevronRight size={22}/></button>
          {listDetails}
        </>}
        {p.error&&<div className="patient-error" role="alert">{p.error}</div>}
      </>}
    </section>
  </main>;
}
