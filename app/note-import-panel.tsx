"use client";
import { useEffect, useRef, useState } from "react";
import { Check, ImagePlus, LoaderCircle, ArrowRight } from "lucide-react";
import { parseMedicationSection, noteMedicationKey, type NoteCandidate } from "@/lib/note-import";
import { api } from "@/lib/client-api";
import { preparePhoto, recognizeLabels } from "@/lib/ocr";
import type { Medication, MedicationFields } from "@/lib/medication";

const sample=`Metoprolol tartrate 25 mg tablet; take 1 tablet by mouth twice daily.
Lisinopril 10 mg tablet; take 0.5 tablets by mouth once daily.
Apixaban 5 mg tablet; take 1 tablet by mouth twice daily.
Vitamin D3 1000 IU capsule; take 1 capsule daily.`;

export default function NoteImportPanel({existing,ensureProfile,onSaved,onBusy}:{existing:Medication[];ensureProfile:()=>Promise<string>;onSaved:(profile:string)=>Promise<void>;onBusy:(busy:boolean)=>void}){
  const [step,setStep]=useState(1);
  const [raw,setRaw]=useState("");const [document,setDocument]=useState("Prior cardiology note");const [sourceDate,setSourceDate]=useState("");
  const [rows,setRows]=useState<NoteCandidate[]>([]);const [selected,setSelected]=useState<string[]>([]);const [reviewed,setReviewed]=useState(false);
  const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [progress,setProgress]=useState("");
  const heading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{heading.current?.focus();},[step]);
  const requestKey=useRef("");const imageInput=useRef<HTMLInputElement>(null);
  const existingKeys=new Set(existing.map(noteMedicationKey));
  const pending=rows.filter(r=>selected.includes(r.key));
  function invalidate(){requestKey.current="";setReviewed(false);setError("");}
  function editRow(index:number,key:keyof MedicationFields,value:string){invalidate();setRows(old=>old.map((r,i)=>i===index?{...r,fields:{...r.fields,[key]:value}}:r));}
  function preview(){invalidate();try{setRows(parseMedicationSection(raw,document,sourceDate));setSelected([]);setStep(3);}catch(e){setError((e as Error).message);}}
  function working(value:boolean){setBusy(value);onBusy(value);}
  async function readImage(file:File){working(true);setError("");try{const photo=await preparePhoto(file);const text=await recognizeLabels([photo],setProgress,new AbortController().signal);setRaw(text);setRows([]);setSelected([]);invalidate();}catch(e){setError((e as Error).message);}finally{working(false);setProgress("");}}
  async function importRows(){
    if(!reviewed||!pending.length)return;working(true);setError("");
    try{const profileId=await ensureProfile();if(!requestKey.current)requestKey.current=crypto.randomUUID();
      await api("note-import","POST",{profileId,sourceDocument:document,sourceDate,rows:pending.map(r=>r.fields),reviewed:true,idempotencyKey:requestKey.current});
      await onSaved(profileId);
    }catch(e){setError((e as Error).message);}finally{working(false);}
  }
  return <div className="note-import-panel">
    <p className="import-step">{step} of 3</p>
    <h3 ref={heading} tabIndex={-1}>{step===1?"Add the old list.":step===2?"Where is it from?":"Check the medications."}</h3>
    {step===1?<>
      <label className="field">Paste medication lines<textarea rows={7} value={raw} maxLength={24000} disabled={busy} placeholder="One medication per line" onChange={e=>{setRaw(e.target.value);setRows([]);setSelected([]);invalidate();}}/></label>
      <button className="button secondary" disabled={busy} onClick={()=>imageInput.current?.click()}><ImagePlus size={18}/>Use a picture instead</button>
      <details><summary>Try an example</summary><button className="text-button" disabled={busy} onClick={()=>{setRaw(sample);setDocument("Fictional cardiology note");setSourceDate("2026-07-01");setRows([]);setSelected([]);invalidate();}}>Use fictional medications</button></details>
    </>:step===2?<>
      <label className="field">Source document<input value={document} maxLength={120} disabled={busy} onChange={e=>{setDocument(e.target.value);invalidate();}}/></label>
      <label className="field">Note date · leave blank if unknown<input type="date" value={sourceDate} disabled={busy} onChange={e=>{setSourceDate(e.target.value);invalidate();}}/></label>
    </>:<>
      <p>{document} · {sourceDate||"Date unknown"}. Select each checked medication.</p>
      <div className="note-import-rows">{rows.map((row,index)=>{
        const duplicate=existingKeys.has(noteMedicationKey(row.fields));
        return <article key={row.key} className="note-import-row">
          <p className="import-source">{row.fields.sourceText}</p>
          <label className="checkbox-row"><input type="checkbox" checked={selected.includes(row.key)} disabled={busy||(duplicate&&!selected.includes(row.key))} onChange={e=>{invalidate();setSelected(old=>e.target.checked?[...old,row.key]:old.filter(k=>k!==row.key));}}/><span>{row.fields.productName} · {row.fields.strength||"Strength unknown"}{duplicate?" · Already listed":""}</span></label>
          <details><summary>Edit details</summary><div className="field-grid"><label className="field">Medication name<input value={row.fields.productName} disabled={busy} maxLength={180} onChange={e=>editRow(index,"productName",e.target.value)}/></label><label className="field">Strength<input value={row.fields.strength} disabled={busy} maxLength={100} onChange={e=>editRow(index,"strength",e.target.value)}/></label></div><label className="field">Type<select value={row.fields.category} disabled={busy} onChange={e=>editRow(index,"category",e.target.value)}><option value="prescription">Prescription</option><option value="otc">Over the counter</option><option value="supplement">Supplement</option></select></label></details>
          {row.warnings.map((warning,i)=><p className="note-import-warning" key={i}>{warning}</p>)}
        </article>;
      })}</div>
      <label className="checkbox-row note-import-ack"><input type="checkbox" checked={reviewed} disabled={busy} onChange={e=>setReviewed(e.target.checked)}/><span>I checked each selected medication against the source.</span></label>
      <p>Saved as older records. Patient confirmation is still required.</p>
      {pending.length>20&&<p className="note-import-warning" role="alert">Select up to 20 medications at a time.</p>}
    </>}
    <input ref={imageInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(file)void readImage(file);}}/>
    {progress&&<p className="import-progress" role="status"><LoaderCircle className="spin" size={18}/>{progress}</p>}
    {error&&<div className="alert error" role="alert">{error}</div>}
    <div className="note-import-actions">
      {step>1&&<button className="button secondary" disabled={busy} onClick={()=>{setError("");setStep(step-1);}}>Back</button>}
      {step===1?<button className="button primary" disabled={busy||!raw.trim()} onClick={()=>{setError("");setStep(2);}}>Next<ArrowRight size={18}/></button>
      :step===2?<button className="button primary" disabled={busy||!document.trim()} onClick={preview}>Check medications<ArrowRight size={18}/></button>
      :<button className="button primary" disabled={busy||!reviewed||!pending.length||pending.length>20||!document.trim()} onClick={()=>void importRows()}>{busy?<LoaderCircle className="spin" size={18}/>:<Check size={18}/>}Import {pending.length} medication{pending.length===1?"":"s"}</button>}
    </div>
  </div>;
}
