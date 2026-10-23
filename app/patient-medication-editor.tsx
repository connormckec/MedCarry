"use client";
import { useEffect, useRef, useState } from "react";
import { Camera, Check, ChevronRight, LoaderCircle } from "lucide-react";
import { formulations, frequencies, units, useSummary, validateFields, type MedicationFields } from "@/lib/medication";

type Props={
  fields:MedicationFields;sourceIds:string[];notices:string[];existing:boolean;quick:boolean;busy:boolean;error:string;saveState?:""|"saving"|"saved"|"error";
  onField:<K extends keyof MedicationFields>(key:K,value:MedicationFields[K])=>void;onForm:(form:MedicationFields["formulation"])=>void;onSave:(confirm:boolean)=>void;
  onNoLongerTake:()=>void;onAddedByMistake:()=>void;onCamera:()=>void;onAdvanced?:()=>void;
};
const formNames:Record<MedicationFields["formulation"],string>={tablet:"Tablet",capsule:"Capsule",liquid:"Liquid",inhaler:"Inhaler",injection:"Injection",topical:"Cream / ointment",patch:"Patch",drops:"Drops",powder:"Powder",other:"Other / not sure"};

export default function PatientMedicationEditor(p:Props){
  const [step,setStep]=useState(p.quick?3:1),[stepError,setStepError]=useState("");
  const heading=useRef<HTMLHeadingElement>(null);
  const f=p.fields;
  useEffect(()=>{heading.current?.focus();},[step]);
  function go(next:number){
    setStepError("");
    if(next>step){
      if(step===1&&(!f.productName.trim()||(!f.strength.trim()&&!f.strengthUnknown))){setStepError("Enter the name and strength, or mark the strength unsure.");return;}
      if(step===2){try{validateFields(f,true);}catch(e){setStepError((e as Error).message);return;}}
    }
    setStep(next);
  }
  const evidence=<details className="patient-extra"><summary>{p.sourceIds.length?"See the label":"Label details"}</summary>
    {p.sourceIds.length>0&&<div className="source-images">{p.sourceIds.map(id=><a href={`/api/upload/${id}`} key={id} target="_blank" rel="noopener noreferrer"><img src={`/api/upload/${id}`} alt="Open medication label"/></a>)}</div>}
    <label className="field">Type<select value={f.category} disabled={p.busy} onChange={e=>p.onField("category",e.target.value as MedicationFields["category"])}><option value="prescription">Prescription medicine</option><option value="otc">Over the counter</option><option value="supplement">Vitamin / supplement</option></select></label>
    <label className="field">Directions on the label<textarea value={f.labelDirections} maxLength={1600} disabled={p.busy} rows={2} onChange={e=>p.onField("labelDirections",e.target.value)}/></label>
    <label className="field">How it is given<input value={f.route} maxLength={80} disabled={p.busy} placeholder="For example, by mouth" onChange={e=>p.onField("route",e.target.value)}/></label>
    {f.category==="supplement"&&<label className="field">Ingredients and serving size<textarea value={f.supplementFacts} maxLength={2500} rows={3} disabled={p.busy} onChange={e=>p.onField("supplementFacts",e.target.value)}/></label>}
    {p.sourceIds.length<4&&<button className="button secondary full" disabled={p.busy} onClick={p.onCamera}><Camera size={20}/>Add a label picture</button>}
  </details>;
  return <>
    <div className="editor-content patient-editor">
      <p className="patient-step">{step} of 3{p.saveState==="saving"?" · Saving…":p.saveState==="saved"?" · Saved":""}</p>
      <h3 ref={heading} tabIndex={-1}>{step===1?"What is the name?":step===2?"How do you take it?":"Does this look right?"}</h3>
      {step===1?<>
        <label className="field">Medicine or supplement name<input autoComplete="off" value={f.productName} maxLength={180} disabled={p.busy} onChange={e=>p.onField("productName",e.target.value)}/></label>
        <label className="field">Strength on the label<input value={f.strength} maxLength={100} placeholder="For example, 25 mg" disabled={p.busy||f.strengthUnknown} onChange={e=>p.onField("strength",e.target.value)}/></label>
        <label className="checkbox-row"><input type="checkbox" checked={f.strengthUnknown} disabled={p.busy} onChange={e=>p.onField("strengthUnknown",e.target.checked)}/><span>I'm not sure of the strength</span></label>
        <label className="field">What kind?<select value={f.formulation} disabled={p.busy} onChange={e=>p.onForm(e.target.value as MedicationFields["formulation"])}>{formulations.map(form=><option value={form} key={form}>{formNames[form]}</option>)}</select></label>
        {evidence}
      </>:step===2?<>
        <p className="patient-medicine-name">{f.productName}</p>
        <label className="field">Do you take it now?<select value={f.status} disabled={p.busy} onChange={e=>p.onField("status",e.target.value as MedicationFields["status"])}><option value="taking">Yes</option><option value="stopped">No, I no longer take it</option><option value="held">It is on hold</option><option value="unsure">I'm not sure</option></select></label>
        {f.status==="taking"&&<>
          <label className="checkbox-row"><input type="checkbox" checked={f.actualUseUnknown} disabled={p.busy} onChange={e=>p.onField("actualUseUnknown",e.target.checked)}/><span>I'm not sure how much or how often</span></label>
          {!f.actualUseUnknown&&<>
            <label className="field">How often?<select value={f.frequency} disabled={p.busy} onChange={e=>p.onField("frequency",e.target.value as MedicationFields["frequency"])}>{Object.entries(frequencies).map(([value,label])=><option value={value} key={value} disabled={value==="unknown"}>{value==="unknown"?"Choose how often":label}</option>)}</select></label>
            {f.frequency!=="custom"&&<div className="field"><label htmlFor="patient-dose">How much each time?</label><div className="amount-input"><input id="patient-dose" value={f.actualDose} maxLength={40} inputMode="decimal" disabled={p.busy} placeholder="For example, 1 or 1/2" onChange={e=>p.onField("actualDose",e.target.value)}/><select aria-label="Amount unit" disabled={p.busy} value={f.doseUnit} onChange={e=>p.onField("doseUnit",e.target.value as MedicationFields["doseUnit"])}>{units.map(unit=><option value={unit} key={unit}>{unit}</option>)}</select></div>{f.doseUnit==="tablets"&&<div className="quantity-chips" aria-label="Amount shortcuts">{["1/2","1","2"].map(amount=><button type="button" disabled={p.busy} key={amount} aria-pressed={f.actualDose===amount} onClick={()=>p.onField("actualDose",amount)}>{amount==="1/2"?"½":amount}</button>)}</div>}</div>}
            {(f.frequency==="custom"||f.frequency==="prn"||f.doseUnit==="other")&&<label className="field">Describe how you take it<textarea value={f.actualInstructions} maxLength={1600} rows={3} disabled={p.busy} placeholder="Include timing, different amounts, or as-needed limits." onChange={e=>p.onField("actualInstructions",e.target.value)}/></label>}
          </>}
        </>}
        <details className="patient-extra"><summary>More instructions or notes</summary>
          <label className="field">Timing or food instructions<input value={f.timing} maxLength={300} disabled={p.busy} onChange={e=>p.onField("timing",e.target.value)}/></label>
          {f.frequency!=="custom"&&f.frequency!=="prn"&&f.doseUnit!=="other"&&<label className="field">Other instructions<textarea value={f.actualInstructions} rows={2} maxLength={1600} disabled={p.busy} onChange={e=>p.onField("actualInstructions",e.target.value)}/></label>}
          <label className="field">Anything you want the clinic to know?<textarea value={f.uncertaintyNote} maxLength={800} rows={2} disabled={p.busy} onChange={e=>p.onField("uncertaintyNote",e.target.value)}/></label>
          <label className="field">Missed doses in the past 7 days<select value={f.adherence} disabled={p.busy} onChange={e=>p.onField("adherence",e.target.value as MedicationFields["adherence"])}><option value="not_reported">Skip this question</option><option value="none_reported">None</option><option value="some_missed">Some</option><option value="unsure">I'm not sure</option></select></label>
        </details>
      </>:<>
        <div className="patient-review-row"><div><h4>{f.productName}</h4><p>{f.strengthUnknown?"Strength unsure":f.strength} · {formNames[f.formulation]}</p></div><button className="patient-edit" aria-label="Change medication details" disabled={p.busy} onClick={()=>go(1)}>Change</button></div>
        <div className="patient-review-row"><div><h4>How you take it</h4><p>{useSummary(f)}</p>{f.actualInstructions&&f.frequency!=="custom"&&<p>{f.actualInstructions}</p>}</div><button className="patient-edit" aria-label="Change how you take it" disabled={p.busy} onClick={()=>go(2)}>Change</button></div>
        {(f.actualUseUnknown||f.strengthUnknown||f.status==="unsure")&&<p className="patient-uncertain">Unsure details will be marked for clinic review.</p>}
        {f.uncertaintyNote&&<p className="patient-review-note">{f.uncertaintyNote}</p>}{f.adherence!=="not_reported"&&<p className="patient-review-note">Missed doses: {f.adherence==="none_reported"?"None":f.adherence==="some_missed"?"Some":"Unsure"}</p>}
        {f.supplementFacts&&<details className="patient-extra"><summary>Supplement ingredients</summary><p className="patient-review-note">{f.supplementFacts}</p></details>}
        {evidence}
        <p className="patient-confirm-copy">Confirm the details, including anything marked unsure.</p>
      </>}
      {f.sourceDocument&&<details className="patient-extra"><summary>From an older record</summary><p className="patient-review-note">{f.sourceDocument} · {f.sourceDate||"Date unknown"}</p><blockquote>{f.sourceText}</blockquote><p className="patient-small">Check what you take now. Reporting a change does not stop a prescription.</p></details>}
      {p.notices.length>0&&((!f.productName.trim()||(!f.strength.trim()&&!f.strengthUnknown))?<div className="notice-box" role="status"><strong>Check what the label reader found</strong>{p.notices.map((notice,i)=><p className="patient-review-note" key={i}>{notice}</p>)}</div>:<details className="patient-extra"><summary>Label reader notes</summary>{p.notices.map((notice,i)=><p className="patient-review-note" key={i}>{notice}</p>)}</details>)}
      {(stepError||p.error)&&<div className="patient-error" role="alert">{stepError||p.error}</div>}
      <details className="patient-extra patient-edit-options"><summary>Change this medication</summary>
        <button className="patient-text" disabled={p.busy} onClick={()=>p.onSave(false)}>Save for later</button>
        {p.onAdvanced&&<button className="patient-text" disabled={p.busy} onClick={p.onAdvanced}>Detailed editor</button>}
        {p.existing&&<>
          <button className="patient-text" disabled={p.busy} onClick={p.onNoLongerTake}>I no longer take this</button>
          <button className="patient-text" disabled={p.busy} onClick={p.onAddedByMistake}>I added this by mistake</button>
          <p className="patient-small">These choices keep a record for the clinic. They do not discontinue a prescription.</p>
        </>}
      </details>
    </div>
    <div className="dialog-bottom patient-editor-footer">
      {step>1&&<button className="button secondary" disabled={p.busy} onClick={()=>go(step-1)}>Back</button>}
      <button className="button primary" disabled={p.busy} onClick={()=>step===3?p.onSave(true):go(step+1)}>{p.busy?<LoaderCircle className="spin" size={21}/>:step===3?<Check size={21}/>:null}{step===3?"Yes, this is correct":"Next"}{step<3&&<ChevronRight size={21}/>}</button>
    </div>
  </>;
}
