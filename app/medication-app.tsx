"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Camera, Upload, Plus, WalletCards, Check, X, FileText, ChevronRight, ShieldCheck, Search, LoaderCircle, AlertCircle, Printer, Download, ScanLine, CircleHelp } from "lucide-react";
import { emptyMedication, formulations, frequencies, units, isConfirmed, useSummary, reportedAmount, validateFields, snapshotText, type MedicationFields, type Medication, type Profile, type Snapshot } from "@/lib/medication";
import { SYNTHETIC } from "@/lib/synthetic-clinic";
import { recognizeLabels, preparePhoto } from "@/lib/ocr";
import { ocrExcerpt } from "@/lib/ocr-text";
import { api } from "@/lib/client-api";
import { historicalUseProposal } from "@/lib/note-import";
import GuidedPatientHome from "./guided-patient-home";
import PatientMedicationEditor from "./patient-medication-editor";
import StaffHome from "./staff-home";

type CardSummary = {id:string;recipient:string;patient_name:string;created_at:string};
type EditorDraft = {id:string;medicationId:string|null;updatedAt:string;draft:{fields:MedicationFields;sourceIds:string[];step?:number}};
type Editor = {fields:MedicationFields;sourceIds:string[];id?:string;revision?:number;notices:string[];newSources:string[];quick?:boolean;advanced?:boolean;adherenceTouched?:boolean;cleanupFocus?:boolean};
type CleanupPair = {medicationAId:string;medicationBId:string}|null;
type UndoHint = {medicationId:string;revision:number;changeEventId:string;label:string};
type DuplicateFlag = {id:string;medicationAId:string;medicationBId:string;flagType:string;explanation:string;status:string;evidence:Record<string,unknown>};
type InboxRow = {
  appointmentId:string;patientLegalName:string;patientDob:string;startsAt:string;timezone:string;providerName:string;serviceName:string;
  queue:{submissionStatus:string;changeCounts:{added:number;stopped:number;changed:number;duplicate:number;uncertain:number}};
  detail:{patientPostalCode:string|null;respondentId:string|null;aprimaStatus:string};
  submission:{id:string}|null;
};
type ReviewDetail = {
  submission:{id:string;deliveryStatus:string;staffStatus:string;aprimaStatus:string;emptyListAttested:boolean;changeSummary:Record<string,unknown>;payload: {medications?:Medication[];identity?:Record<string,unknown>}};
  patient:{legalName:string;dob:string;postalCode:string|null}|null;
  respondent:{display_name:string;relationship:string;completion_role:string}|null;
  deliveryLabel:string;receivingClinic:string;
};
function quickReview(fields:MedicationFields){try{validateFields(fields,true);return true;}catch{return false;}}
function date(value:string|null){return value?new Date(value).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"}):"Not yet confirmed";}
function Modal({title,children,onClose,wide=false,locked=false}:{title:string;children:ReactNode;onClose:()=>void;wide?:boolean;locked?:boolean}){
  const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{ref.current?.showModal();},[]);
  return <dialog ref={ref} aria-label={title} className={`dialog ${wide?"dialog-wide":""}`} onCancel={e=>{e.preventDefault();if(!locked)onClose();}}><div className="dialog-head"><div><div className="eyebrow">MEDCARRY</div><h2>{title}</h2></div><button type="button" className="icon-button" aria-label="Close dialog" disabled={locked} onClick={onClose}><X size={21}/></button></div>{children}</dialog>;
}

export default function MedicationApp({guided=false}:{guided?:boolean}){
  const [profiles,setProfiles]=useState<Profile[]>([]),[profileId,setProfileId]=useState(""),[meds,setMeds]=useState<Medication[]>([]),[cards,setCards]=useState<CardSummary[]>([]);
  const [loading,setLoading]=useState(true),[error,setError]=useState(""),[signIn,setSignIn]=useState("");
  const [editor,setEditor]=useState<Editor|null>(null),[busy,setBusy]=useState(false),[formError,setFormError]=useState(""),[toast,setToast]=useState("");
  const [processing,setProcessing]=useState(false),[processMessage,setProcessMessage]=useState(""),[camera,setCamera]=useState(false),[cameraError,setCameraError]=useState(""),[cameraReady,setCameraReady]=useState(false);
  const [importBusy,setImportBusy]=useState(false);
  const [creatingProfile,setCreatingProfile]=useState(false),[newProfileName,setNewProfileName]=useState("");
  const [card,setCard]=useState<Snapshot|null>(null);
  const [clinicReceipt,setClinicReceipt]=useState<{id:string;deliveryStatus:"pending"|"received";deliveryLabel:string;receivingClinic:string;emptyListAttested:boolean;payload?:Snapshot&{medications:Medication[]}}|null>(null);
  const [identityBusy,setIdentityBusy]=useState(false);
  const [searching,setSearching]=useState(false),[matches,setMatches]=useState<{rxCui:string;name:string}[]>([]),[searchMessage,setSearchMessage]=useState("");
  const [openDrafts,setOpenDrafts]=useState<EditorDraft[]>([]),[saveState,setSaveState]=useState<""|"saving"|"saved"|"error">("");
  const [undoHint,setUndoHint]=useState<UndoHint|null>(null);
  const [duplicateFlags,setDuplicateFlags]=useState<DuplicateFlag[]>([]);
  const [duplicatePrompt,setDuplicatePrompt]=useState("Looks similar to another medicine on your list.");
  const [cleanupPair,setCleanupPair]=useState<CleanupPair>(null);
  const [inboxDate,setInboxDate]=useState("2026-11-03"),[inboxRows,setInboxRows]=useState<InboxRow[]>([]),[inboxBusy,setInboxBusy]=useState(false),[reviewDetail,setReviewDetail]=useState<ReviewDetail|null>(null);
  const labelTarget=useRef<Editor|null>(null);
  const uploadRef=useRef<HTMLInputElement>(null),captureRef=useRef<HTMLInputElement>(null),videoRef=useRef<HTMLVideoElement>(null),streamRef=useRef<MediaStream|null>(null),ocrAbort=useRef<AbortController|null>(null),listRequest=useRef(0),cardRequest=useRef(""),submitRequest=useRef(""),cameraSession=useRef(0),draftTimer=useRef<ReturnType<typeof setTimeout>|null>(null),editorRef=useRef<Editor|null>(null);
  const selected=profiles.find(pr=>pr.id===profileId);
  useEffect(()=>{editorRef.current=editor;},[editor]);
  useEffect(()=>{void bootstrap();return()=>{streamRef.current?.getTracks().forEach(t=>t.stop());ocrAbort.current?.abort();if(draftTimer.current)clearTimeout(draftTimer.current);};},[]);
  useEffect(()=>{if(toast){const timer=setTimeout(()=>setToast(""),4500);return()=>clearTimeout(timer);}},[toast]);
  useEffect(()=>{if(undoHint){const timer=setTimeout(()=>setUndoHint(null),12000);return()=>clearTimeout(timer);}},[undoHint]);
  useEffect(()=>{
    if(!cleanupPair)return;
    const a=meds.some(m=>m.id===cleanupPair.medicationAId);
    const b=meds.some(m=>m.id===cleanupPair.medicationBId);
    if(!a||!b)setCleanupPair(null);
  },[meds,cleanupPair]);
  useEffect(()=>{
    if(!editor||!profileId||busy)return;
    if(draftTimer.current)clearTimeout(draftTimer.current);
    draftTimer.current=setTimeout(()=>{void autosaveDraft();},1200);
    return()=>{if(draftTimer.current)clearTimeout(draftTimer.current);};
  },[editor?.fields,editor?.sourceIds,editor?.id,profileId,busy]);
  async function bootstrap(){
    setLoading(true);setError("");
    try{
      const r=await api<{profiles:Profile[]}>("bootstrap");
      setProfiles(r.profiles);
      const requested=new URLSearchParams(window.location.search).get("profile");
      // Prefer the linked synthetic Alice list so /patient and /staff share one demo patient.
      const alice=r.profiles.find(p=>p.id===SYNTHETIC.aliceProfileId);
      const first=r.profiles.find(p=>p.id===requested)||alice||r.profiles[0];
      if(first){setProfileId(first.id);await loadList(first.id);}
    }catch(e){const err=e as Error&{signInUrl?:string};if(err.signInUrl)setSignIn(err.signInUrl);else setError(err.message);}
    finally{setLoading(false);}
  }
  async function loadList(pid:string){const seq=++listRequest.current;const r=await api<{medications:Medication[];cards:CardSummary[];openDrafts?:EditorDraft[];duplicateFlags?:DuplicateFlag[];duplicatePrompt?:string}>(`list?profile=${pid}`);if(seq!==listRequest.current)return;setMeds(r.medications);setCards(r.cards);setOpenDrafts(r.openDrafts||[]);setDuplicateFlags(r.duplicateFlags||[]);setDuplicatePrompt(r.duplicatePrompt||"This may already be on your list.");}
  async function respondDuplicate(flagId:string,response:"take_both"|"added_twice"|"unsure"|"staff_dismissed"){
    setBusy(true);setError("");
    try{
      const flag=duplicateFlags.find(f=>f.id===flagId);
      const r=await api<{note?:string}>(`duplicate-flag/${flagId}/respond`,"POST",{response});
      await loadList(profileId);
      if(response==="added_twice"&&flag){
        setCleanupPair({medicationAId:flag.medicationAId,medicationBId:flag.medicationBId});
        setToast("Both stay on your list. Open the extra one and choose “I added this by mistake.”");
      }else{
        if(response!=="added_twice")setCleanupPair(null);
        setToast(response==="take_both"?"Saved: you take both.":response==="staff_dismissed"?"Flag dismissed for staff.":r.note||"Saved: not sure. Clinic can still review.");
      }
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function switchProfile(pid:string){setProfileId(pid);setMeds([]);setCards([]);setOpenDrafts([]);setLoading(true);setError("");try{await loadList(pid);}catch(e){setError((e as Error).message);}finally{setLoading(false);}}
  async function ensureProfile(){if(profileId)return profileId;const r=await api<{profile:Profile}>("profile","POST",{name:"My medication list"});setProfiles(p=>[...p,r.profile]);setProfileId(r.profile.id);return r.profile.id;}
  async function makeProfile(){setBusy(true);setFormError("");try{const r=await api<{profile:Profile}>("profile","POST",{name:newProfileName});setProfiles(p=>[...p,r.profile]);setProfileId(r.profile.id);setMeds([]);setCards([]);setOpenDrafts([]);setCreatingProfile(false);setNewProfileName("");}catch(e){setFormError((e as Error).message);}finally{setBusy(false);}}
  function openManual(){setClinicReceipt(null);setFormError("");setMatches([]);setSearchMessage("");setSaveState("");setEditor({fields:{...emptyMedication(),formulation:"other",doseUnit:"other"},sourceIds:[],notices:[],newSources:[]});}
  function openEditor(m:Medication,opts?:{cleanup?:boolean}){setClinicReceipt(null);setFormError("");setMatches([]);setSearchMessage("");setSaveState("");const fields=guided&&m.source==="note"&&!isConfirmed(m)?historicalUseProposal(m):{...m};setEditor({fields,sourceIds:m.sourceIds,id:m.id,revision:m.revision,notices:[],newSources:[],quick:opts?.cleanup?false:quickReview(fields),cleanupFocus:!!opts?.cleanup});}
  function resumeDraft(d:{id:string;medicationId:string|null;updatedAt:string;draft:{fields:Partial<MedicationFields>;sourceIds:string[]}}){setClinicReceipt(null);setFormError("");setMatches([]);setSearchMessage("");setSaveState("saved");const med=d.medicationId?meds.find(m=>m.id===d.medicationId):undefined;setEditor({fields:{...emptyMedication(),...d.draft.fields},sourceIds:d.draft.sourceIds||[],id:med?.id,revision:med?.revision,notices:[],newSources:[],quick:false});}
  function field<K extends keyof MedicationFields>(key:K,value:MedicationFields[K]){setEditor(e=>e?{...e,...(key==="adherence"?{adherenceTouched:true}:{}),fields:{...e.fields,[key]:value,...(["productName","strength","strengthUnknown","route"].includes(key)?{rxCui:"",referenceName:""}:{}),...(key==="strength"&&String(value).trim()?{strengthUnknown:false}:{})}}:e);setFormError("");setSaveState("");}
  function changeForm(value:MedicationFields["formulation"]){const map:Record<string,MedicationFields["doseUnit"]>={tablet:"tablets",capsule:"capsules",liquid:"mL",inhaler:"puffs",injection:"units",topical:"applications",patch:"patches",drops:"drops",powder:"scoops",other:"other"};setEditor(e=>e?{...e,fields:{...e.fields,formulation:value,doseUnit:map[value],rxCui:"",referenceName:""}}:e);setSaveState("");}
  async function autosaveDraft(){
    const current=editorRef.current;if(!current||!profileId)return;
    if(!current.fields.productName.trim()&&!current.sourceIds.length)return;
    setSaveState("saving");
    try{
      await api("draft","PUT",{profileId,medicationId:current.id||"",draft:{fields:current.fields,sourceIds:current.sourceIds,medicationRevision:current.revision??null}});
      if(editorRef.current===current)setSaveState("saved");
    }catch{if(editorRef.current===current)setSaveState("error");}
  }
  async function closeEditor(){if(busy)return;labelTarget.current=null;const orphan=editor?.newSources||[];setEditor(null);setFormError("");setSaveState("");for(const uid of orphan){try{await api(`upload/${uid}`,"DELETE");}catch{/* Saved photos are intentionally retained. */}}}
  async function save(confirm:boolean,overrides?:Partial<MedicationFields>){if(!editor)return;setBusy(true);setFormError("");try{
    const fields=validateFields({...editor.fields,...overrides},confirm);const pid=await ensureProfile();
    const r=editor.id?await api<{medication:Medication}>(`medication/${editor.id}`,"PUT",{fields,sourceIds:editor.sourceIds,revision:editor.revision,adherenceReviewed:editor.adherenceTouched===true}):await api<{medication:Medication}>("medication","POST",{profileId:pid,fields,sourceIds:editor.sourceIds});
    setEditor(e=>e?{...e,id:r.medication.id,revision:r.medication.revision,fields,newSources:[]}:e);
    if(confirm)await api(`confirm/${r.medication.id}`,"POST",{revision:r.medication.revision,acknowledged:true});
    await loadList(pid);const next=guided&&confirm&&editor.id?meds.find(m=>m.id!==editor.id&&!isConfirmed(m)):undefined;if(next)openEditor(next);else setEditor(null);setToast(guided?(confirm?overrides?.status==="unsure"?"Saved as not sure — clinic can review.":"Medication checked.":"Saved. Check it when you return."):(confirm?"Medication confirmed.":"Draft saved. Confirmation is still needed."));
  }catch(e){setFormError((e as Error).message);if((e as {status?:number}).status===409&&profileId){await loadList(profileId).catch(()=>{});}}finally{setBusy(false);}}
  async function reportChange(reason:"no_longer_take"|"added_by_mistake"){
    if(!editor?.id)return;
    await reportChangeFor(editor.id,editor.revision,reason,editor.fields.productName||"this medicine");
  }
  async function undoChange(){
    if(!undoHint)return;setBusy(true);setError("");
    try{
      await api(`medication/${undoHint.medicationId}/undo-change`,"POST",{revision:undoHint.revision,changeEventId:undoHint.changeEventId});
      await loadList(profileId);setUndoHint(null);setToast("Change undone. Check that medicine again before finishing.");
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function lookup(){if(!editor)return;setSearching(true);setSearchMessage("");try{const r=await api<{results:{rxCui:string;name:string}[]}>(`search?q=${encodeURIComponent(editor.fields.productName)}`);setMatches(r.results);if(!r.results.length)setSearchMessage("No exact name matches found. You can keep the name from your label and continue manually.");}catch(e){setSearchMessage((e as Error).message);}finally{setSearching(false);}}
  function chooseMatch(match:{rxCui:string;name:string}){setEditor(e=>e?{...e,fields:{...e.fields,rxCui:match.rxCui,referenceName:match.name}}:e);setMatches([]);setSearchMessage("");}
  async function processFiles(files:Blob[],target?:Editor){if(!files.length)return;setClinicReceipt(null);if(files.length+(target?.sourceIds.length||0)>4){setError("Choose up to four photos of the same medication. Add different medications separately.");return;}setError("");setProcessing(true);setProcessMessage("Preparing your photo…");const saved:string[]=[];let opened=false;
    try{const pid=await ensureProfile();const images:Blob[]=[];
      for(let i=0;i<files.length;i++){setProcessMessage(`Saving photo ${i+1} of ${files.length}…`);const image=await preparePhoto(files[i]);const r=await api<{id:string}>(`upload?profile=${pid}`,"POST",image,true);saved.push(r.id);images.push(image);}
      const abort=new AbortController();ocrAbort.current=abort;let fields=emptyMedication();fields.source="photo";let notices:string[]=[];
      try{
        const ocr=await recognizeLabels(images,setProcessMessage,abort.signal);
        if(ocr.text.trim().length<6)throw new Error("No readable text was found. The photos are saved; enter the details from the label.");
        setProcessMessage("Organizing the label details…");
        const r=await api<{fields:MedicationFields;notices:string[];spellingCorrected?:boolean;ambiguous?:boolean;categoryNeedsAsk?:boolean}>("parse","POST",{text:ocr.text,profileId:pid});
        fields=r.fields;notices=r.notices;
        notices.unshift(`Text read from the photo (check against the label): ${ocrExcerpt(ocr.text)}`);
        if(r.spellingCorrected)notices.unshift("Suggested name spelling is in the draft — check it against the bottle.");
        if(r.ambiguous)notices.unshift("More than one possible medicine matched. Check the name and strength on the bottle.");
        if(r.categoryNeedsAsk)notices.push("Confirm whether this is a prescription, over-the-counter medicine, or vitamin/supplement.");
        if(ocr.weak||!fields.productName.trim())notices.push("The label reader was unsure. Keep what looks right, fix the rest, or mark details unsure before confirming.");
        if(fields.category==="supplement"&&fields.productName.trim().length>=3){
          try{
            setProcessMessage("Checking the NIH supplement catalog…");
            const q=new URLSearchParams({q:fields.productName.slice(0,120)});
            if(fields.strength.trim())q.set("strength",fields.strength.slice(0,100));
            const dsld=await api<{matches:{id:string;fullName:string;brandName:string;servingSummary:string}[];available:boolean;note:string}>(`dsld/search?${q}`);
            if(!dsld.available)notices.push(dsld.note||"Supplement catalog unavailable. Enter label details manually.");
            else if(dsld.matches.length===1){
              const hit=dsld.matches[0];
              const label=`${hit.brandName?hit.brandName+" ":""}${hit.fullName}`.trim();
              notices.push(`NIH DSLD match proposed: ${label}. Confirm brand and serving size on the bottle.`);
              if(hit.servingSummary&&!fields.supplementFacts.includes(hit.servingSummary)){
                fields={...fields,supplementFacts:`Label serving size: ${hit.servingSummary} (per serving on the label — not your reported use)\nBrand/product: ${label}\nSource: NIH DSLD ${hit.id}${fields.supplementFacts?`\n\n${fields.supplementFacts}`:""}`.slice(0,2500),referenceName:`DSLD:${hit.id} ${hit.fullName}`.slice(0,300)};
              }
            }else if(dsld.matches.length>1){
              notices.push("Several supplement products matched. Confirm the brand and form on the bottle, or enter Supplement Facts manually.");
            }else{
              notices.push("No NIH DSLD match. Enter the product from the label, including Supplement Facts if needed.");
            }
          }catch{notices.push("Supplement catalog lookup failed. Enter the label details manually.");}
        }
      }catch(e){notices=[(e as Error).message,"Your photos are saved. Complete the fields manually before confirming."];}
      if(target){fields={...fields,sourceDocument:target.fields.sourceDocument,sourceDate:target.fields.sourceDate,sourceText:target.fields.sourceText};notices.unshift(`New label for the existing entry: ${target.fields.productName} ${target.fields.strength}. Compare the identity and strength before saving.`);}setEditor({fields,sourceIds:[...(target?.sourceIds||[]),...saved],id:target?.id,revision:target?.revision,notices,newSources:[...(target?.newSources||[]),...saved],quick:quickReview(fields)});setFormError("");setMatches([]);setSearchMessage("");opened=true;
    }catch(e){setError((e as Error).message);}finally{setProcessing(false);ocrAbort.current=null;if(!opened)for(const uid of saved){await api(`upload/${uid}`,"DELETE").catch(()=>{});}}
  }
  function markCameraReady(){
    const video=videoRef.current;
    if(video&&video.videoWidth>0&&video.readyState>=2)setCameraReady(true);
  }
  function closeCamera(){
    cameraSession.current++;
    streamRef.current?.getTracks().forEach(t=>t.stop());
    streamRef.current=null;
    if(videoRef.current)videoRef.current.srcObject=null;
    setCamera(false);setCameraReady(false);setCameraError("");
  }
  async function startCamera(target?:Editor){
    labelTarget.current=target||null;
    const session=++cameraSession.current;
    setCamera(true);setCameraReady(false);setCameraError("");
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw new Error("Camera is unavailable. Choose a picture or type it in.");
      const stream=await navigator.mediaDevices.getUserMedia({
        video:{facingMode:{ideal:"environment"},width:{ideal:1280},height:{ideal:720}},
        audio:false,
      });
      if(session!==cameraSession.current){stream.getTracks().forEach(t=>t.stop());return;}
      streamRef.current=stream;
      if(!videoRef.current)await new Promise<void>(r=>requestAnimationFrame(()=>r()));
      const video=videoRef.current;
      if(video&&session===cameraSession.current){
        video.srcObject=stream;
        video.onloadedmetadata=()=>markCameraReady();
        video.onplaying=()=>markCameraReady();
        await video.play();
        markCameraReady();
      }else stream.getTracks().forEach(t=>t.stop());
    }catch(e){
      if(session===cameraSession.current){
        streamRef.current?.getTracks().forEach(t=>t.stop());
        streamRef.current=null;
        setCameraReady(false);
        setCameraError((e as Error).name==="NotAllowedError"
          ?"Camera access is off. Choose a picture or type it in."
          :"We couldn't open the camera. Choose a picture or type it in.");
      }
    }
  }
  async function snap(){
    const video=videoRef.current;
    if(!video||!cameraReady||!video.videoWidth||video.readyState<2)return;
    const canvas=document.createElement("canvas");
    canvas.width=video.videoWidth;canvas.height=video.videoHeight;
    canvas.getContext("2d")?.drawImage(video,0,0);
    const blob=await new Promise<Blob|null>(r=>canvas.toBlob(r,"image/jpeg",.95));
    if(blob){const target=labelTarget.current;labelTarget.current=null;closeCamera();await processFiles([blob],target||undefined);}
  }
  function openPhotoPath(target?:Editor){
    // Prefer in-app camera when available; native picker remains on the camera sheet.
    void startCamera(target);
  }
  async function reportChangeFor(medicationId:string,revision:number|undefined,reason:"no_longer_take"|"added_by_mistake",productLabel:string){
    const copy=reason==="no_longer_take"
      ?"Record that you no longer take this? This keeps the medicine in your history for clinic review. It does not discontinue a prescription."
      :"Remove this from your active list as added by mistake? You can Undo. Older records stay available.";
    if(!window.confirm(copy))return;
    setBusy(true);setError("");
    try{
      const r=await api<{changeEventId:string;medication?:Medication;revision?:number}>(`medication/${medicationId}/change`,"POST",{revision,reason});
      await loadList(profileId);
      setEditor(null);
      if(reason==="added_by_mistake"){
        setCleanupPair(null);
        setUndoHint({medicationId,revision:r.revision||((revision||1)+1),changeEventId:r.changeEventId,label:`Removed ${productLabel}.`});
        setToast("Removed from your list. Undo is available.");
      }else{
        setUndoHint({medicationId,revision:r.medication?.revision||((revision||1)+1),changeEventId:r.changeEventId,label:`Marked ${productLabel} as no longer taking.`});
        setToast("Saved: you no longer take this. Confirm again if you undo.");
      }
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function demo(){setProcessing(true);setProcessMessage("Adding a fictional example label…");try{
    const canvas=document.createElement("canvas");canvas.width=1400;canvas.height=1050;const c=canvas.getContext("2d")!;c.fillStyle="#fff";c.fillRect(0,0,1400,1050);c.fillStyle="#173f50";c.fillRect(0,0,1400,160);c.fillStyle="#fff";c.font="bold 58px Arial";c.fillText("DEMO PHARMACY",70,102);c.fillStyle="#111";c.font="32px Arial";c.fillText("FICTIONAL LABEL · FOR PRODUCT TESTING",70,230);c.font="bold 56px Arial";c.fillText("METOPROLOL TARTRATE 25 MG TABLETS",70,370);c.font="44px Arial";c.fillText("Take 1 tablet by mouth twice daily.",70,480);c.fillText("With meals.",70,550);c.font="30px Arial";c.fillText("This is a demo label, not a prescription.",70,780);const blob=await new Promise<Blob|null>(r=>canvas.toBlob(r,"image/png"));if(blob){setProcessing(false);await processFiles([blob]);}
  }catch(e){setError((e as Error).message);setProcessing(false);}}
  async function openCard(cid:string){setError("");setBusy(true);try{const r=await api<{card:Snapshot}>(`card/${cid}`);setCard(r.card);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function sendToClinic(opts:{emptyListAttested:boolean}){
    setBusy(true);setError("");
    try{
      if(!submitRequest.current)submitRequest.current=crypto.randomUUID();
      const pid=await ensureProfile();
      const r=await api<{submission:{id:string;deliveryStatus:"pending"|"received";emptyListAttested:boolean;payload:Snapshot&{medications:Medication[]}};deliveryLabel:string;receivingClinic:string;received:boolean}>("clinic/submit","POST",{
        profileId:pid,
        appointmentId:SYNTHETIC.appointmentAliceA.id,
        idempotencyKey:submitRequest.current,
        emptyListAttested:opts.emptyListAttested,
      });
      setClinicReceipt({id:r.submission.id,deliveryStatus:r.submission.deliveryStatus,deliveryLabel:r.deliveryLabel,receivingClinic:r.receivingClinic,emptyListAttested:r.submission.emptyListAttested,payload:r.submission.payload});
      submitRequest.current="";
      await loadList(pid);
      setToast(r.received?"Received by the clinic.":r.deliveryLabel);
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  function downloadCard(){if(!card)return;const blob=new Blob([snapshotText(card)],{type:"text/plain;charset=utf-8"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="medication-list-local-only.txt";a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}
  async function loadSyntheticHeader(){setIdentityBusy(true);setError("");try{await api("clinic/seed-synthetic","POST",{});await api(`clinic/staff-header?appointment=${SYNTHETIC.appointmentAliceA.id}`);setToast("Demo appointment loaded.");}catch(e){setError((e as Error).message);}finally{setIdentityBusy(false);}}
  async function loadInbox(date=inboxDate){
    setInboxBusy(true);setError("");
    try{
      await api("clinic/seed-synthetic","POST",{});
      const r=await api<{appointments:InboxRow[]}>(`clinic/inbox?date=${encodeURIComponent(date)}`);
      setInboxRows(r.appointments);setInboxDate(date);
    }catch(e){setError((e as Error).message);}finally{setInboxBusy(false);}
  }
  async function openReview(submissionId:string){
    setBusy(true);setError("");
    try{
      const r=await api<ReviewDetail>(`clinic/submission/${submissionId}`);
      setReviewDetail(r);
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function markReviewed(status:"reviewed"|"needs_clarification"){
    if(!reviewDetail)return;setBusy(true);
    try{
      await api(`clinic/submission/${reviewDetail.submission.id}/review`,"POST",{staffStatus:status});
      await openReview(reviewDetail.submission.id);await loadInbox();setToast(status==="reviewed"?"Marked reviewed.":"Marked needs clarification.");
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function markAprima(status:"not_entered"|"entered_manually"){
    if(!reviewDetail)return;setBusy(true);
    try{
      await api(`clinic/submission/${reviewDetail.submission.id}/aprima`,"POST",{aprimaStatus:status});
      await openReview(reviewDetail.submission.id);await loadInbox();setToast(status==="entered_manually"?"Tracked as entered manually in Aprima.":"Tracked as not entered in Aprima.");
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <div className={guided?"guided-session":"staff-session"}>
    {guided?<GuidedPatientHome medications={meds} loading={loading} signIn={signIn} error={error} processing={processing||busy} clinicReceipt={clinicReceipt} resumeDraft={openDrafts[0]||null} duplicateFlags={duplicateFlags.filter(f=>f.status==="open")} duplicatePrompt={duplicatePrompt} cleanupPair={cleanupPair} onDuplicateRespond={(id,response)=>void respondDuplicate(id,response)} onCleanupDismiss={()=>setCleanupPair(null)} onPhoto={()=>void openPhotoPath()} onUpload={()=>{labelTarget.current=null;uploadRef.current?.click();}} onManual={openManual} onReview={openEditor} onRemove={(m,reason)=>void reportChangeFor(m.id,m.revision,reason,m.productName||"this medicine")} onResumeDraft={d=>resumeDraft(d)} onSendToClinic={opts=>void sendToClinic(opts)} onViewReceipt={()=>{if(clinicReceipt?.payload)setCard({id:clinicReceipt.id,recipient:clinicReceipt.receivingClinic,patientName:(clinicReceipt.payload as {identity?:{patient?:{legalName?:string}}}).identity?.patient?.legalName||selected?.name||"Patient",createdAt:new Date().toISOString(),medications:clinicReceipt.payload.medications||[]});}} onChangeList={()=>{setClinicReceipt(null);submitRequest.current="";}}/>
    :<StaffHome profiles={profiles} profileId={profileId} medications={meds} loading={loading} signIn={signIn} error={error} busy={busy||importBusy} processing={processing} identityBusy={identityBusy} inboxDate={inboxDate} inboxRows={inboxRows} inboxBusy={inboxBusy} onProfile={pid=>void switchProfile(pid)} onManual={openManual} onReview={openEditor} onLoadInbox={()=>void loadInbox()} onInboxDate={d=>{setInboxDate(d);void loadInbox(d);}} onReviewSubmission={id=>void openReview(id)} onDemo={()=>void demo()} onSeedClinic={()=>void loadSyntheticHeader()} ensureProfile={ensureProfile} onImportSaved={async pid=>{await loadList(pid);setToast("Historical drafts imported. Patient still needs to check each medicine.");}} onBusy={setImportBusy}/>}
    <input ref={uploadRef} type="file" accept="image/*" multiple hidden onChange={e=>{const files=Array.from(e.target.files||[]);e.target.value="";const target=labelTarget.current;labelTarget.current=null;void processFiles(files,target||undefined);}}/>
    <input ref={captureRef} type="file" accept="image/*" capture="environment" hidden onChange={e=>{const files=Array.from(e.target.files||[]);e.target.value="";const target=labelTarget.current;labelTarget.current=null;closeCamera();void processFiles(files,target||undefined);}}/>
    {processing&&<Modal title="Reading your label" onClose={()=>{}} locked><div className="processing-content"><div className="scanner-symbol"><ScanLine size={37}/></div><h3 aria-live="polite">{processMessage}</h3><p>Keep this page open. Check the details next.</p><button className="button secondary" onClick={()=>ocrAbort.current?.abort()} disabled={!ocrAbort.current}>Type it in instead</button></div></Modal>}
    {camera&&<div className="camera-sheet" role="dialog" aria-modal="true" aria-label="Take a picture">
      <div className="camera-sheet-bar">
        <button type="button" className="camera-sheet-close" aria-label="Close camera" onClick={closeCamera}><X size={24}/></button>
        <strong>Take a picture</strong>
        <span className="camera-sheet-spacer"/>
      </div>
      <p className="camera-sheet-help">Show the name and directions on one bottle.</p>
      <div className="camera-sheet-view">
        <video ref={videoRef} playsInline muted autoPlay onLoadedMetadata={markCameraReady} onPlaying={markCameraReady}/>
        {!cameraReady&&!cameraError&&<span className="camera-sheet-status"><LoaderCircle className="spin"/>Opening camera…</span>}
      </div>
      {cameraError&&<div className="camera-sheet-error" role="alert">{cameraError}</div>}
      <div className="camera-sheet-actions">
        {!cameraError&&<button type="button" className="button primary" disabled={!cameraReady} onClick={()=>void snap()}><Camera size={22}/>Take picture</button>}
        <button type="button" className={`button ${cameraError?"primary":"secondary"}`} onClick={()=>captureRef.current?.click()}><Upload size={20}/>Choose a picture</button>
        <button type="button" className="patient-text" onClick={()=>{const target=labelTarget.current;labelTarget.current=null;closeCamera();if(target)setEditor({...target,quick:false});else openManual();}}>Type it in instead</button>
      </div>
    </div>}
    {editor&&!camera&&!processing&&<Modal title={editor.advanced?"Medication details":editor.cleanupFocus?"Clean up this medication":editor.id?"Check this medication":"Add a medication"} onClose={()=>void closeEditor()} wide={!!editor.advanced} locked={busy}>{guided||!editor.advanced?<div className="guided-session"><PatientMedicationEditor key={`${editor.id||"new"}:${editor.sourceIds.join(",")}:${editor.cleanupFocus?"cleanup":"edit"}`} fields={editor.fields} sourceIds={editor.sourceIds} notices={editor.notices} existing={!!editor.id} quick={!!editor.quick} cleanupFocus={!!editor.cleanupFocus} busy={busy} error={formError} saveState={saveState} onField={field} onForm={changeForm} onSave={confirm=>void save(confirm)} onUnsure={()=>void save(true,{status:"unsure"})} onNoLongerTake={()=>void reportChange("no_longer_take")} onAddedByMistake={()=>void reportChange("added_by_mistake")} onCamera={()=>void startCamera(editor)} onAdvanced={guided?undefined:()=>setEditor(e=>e?{...e,advanced:true,quick:false}:e)}/></div>:<><div className="editor-content">
      <div className="source-strip">{editor.sourceIds.length?<><div className="source-images">{editor.sourceIds.map(uid=><a key={uid} href={`/api/upload/${uid}`} target="_blank" rel="noopener noreferrer"><img src={`/api/upload/${uid}`} alt="Open the original medication label"/></a>)}</div><div><strong>Your source label</strong><p>Tap a photo to compare the original.</p></div></>:<><span className="section-icon"><FileText size={21}/></span><div><strong>{editor.fields.source==="note"?"Imported historical entry":"Manual entry"}</strong><p>Use the product label and your current routine.</p></div></>}</div>
      {editor.id&&editor.sourceIds.length<4&&<button className="button secondary full" disabled={busy} onClick={()=>void startCamera(editor)}><Camera size={19}/>Add a photo of this medicine</button>}
      {editor.fields.sourceDocument&&<div className="historical-source"><strong>Older record: {editor.fields.sourceDocument||"Imported note"} · {editor.fields.sourceDate||"date unknown"}</strong><p>{editor.fields.sourceText}</p><small>This is historical information. Check the medicine and report how you take it now.</small></div>}
      {editor.notices.length>0&&<div className="notice-box"><AlertCircle size={17}/><div><strong>Check the draft against your label.</strong>{editor.notices.map((n,i)=><p key={i}>{n}</p>)}</div></div>}
      {editor.quick&&<div className="quick-review"><div className="quick-identity"><span className="category">{editor.fields.category}</span><h3>{editor.fields.productName}</h3><p>{editor.fields.strengthUnknown?"Strength not known":editor.fields.strength} · {editor.fields.formulation}{editor.fields.route?` · ${editor.fields.route}`:""}</p></div><div className="quick-detail"><span>LABEL DIRECTIONS</span><p>{editor.fields.labelDirections||"Not recorded"}</p></div><div className="quick-actual"><span>{editor.fields.source==="note"&&!editor.fields.actualUseUnknown?"CHECK THIS PROPOSED CURRENT USE":"YOUR REPORTED USE"}</span><strong>{useSummary(editor.fields)}</strong>{reportedAmount(editor.fields)&&<p>{reportedAmount(editor.fields)}</p>}{editor.fields.actualInstructions&&<p>{editor.fields.actualInstructions}</p>}</div>{editor.fields.supplementFacts&&<div className="quick-detail"><span>SUPPLEMENT LABEL</span><p>{editor.fields.supplementFacts}</p></div>}{editor.fields.adherence!=="not_reported"&&<div className="quick-detail"><span>OPTIONAL MISSED-DOSE REPORT</span><p>{editor.fields.adherence.replaceAll("_"," ")}{editor.fields.adherenceReportedAt?` · reported ${date(editor.fields.adherenceReportedAt)}`:""}</p></div>}{editor.fields.uncertaintyNote&&<div className="quick-detail"><span>NOTES / UNCERTAINTY</span><p>{editor.fields.uncertaintyNote}</p></div>}<p className="field-help">Is this how you take it now? Check every detail before confirming.</p><button className="button secondary full" onClick={()=>setEditor(e=>e?{...e,quick:false}:e)}>Edit amount, schedule, or other details<ChevronRight size={16}/></button></div>}
      <div hidden={!!editor.quick}>
      <div className="form-section"><div className="section-title"><span>1</span><h3>What is the medication?</h3></div><div className="field-grid"><label className="field span-2">Medication or product name<input value={editor.fields.productName} maxLength={180} placeholder="e.g. Metoprolol tartrate" onChange={e=>field("productName",e.target.value)}/></label><label className="field">Category<select value={editor.fields.category} onChange={e=>field("category",e.target.value as MedicationFields["category"])}><option value="prescription">Prescription</option><option value="otc">Over the counter</option><option value="supplement">Supplement</option></select></label><label className="field">Form<select value={editor.fields.formulation} onChange={e=>changeForm(e.target.value as MedicationFields["formulation"])}>{formulations.map(v=><option key={v} value={v}>{v[0].toUpperCase()+v.slice(1)}</option>)}</select></label><label className="field">Strength / concentration<input value={editor.fields.strength} placeholder={editor.fields.formulation==="liquid"?"e.g. 5 mg / 5 mL":"e.g. 25 mg per tablet"} maxLength={100} disabled={editor.fields.strengthUnknown} onChange={e=>field("strength",e.target.value)}/></label><label className="field">Route<input value={editor.fields.route} maxLength={80} placeholder="e.g. By mouth" onChange={e=>field("route",e.target.value)}/></label></div><label className="checkbox-row"><input type="checkbox" checked={editor.fields.strengthUnknown} onChange={e=>field("strengthUnknown",e.target.checked)}/><span>I don't know the strength / concentration.</span></label>
        <details className="reference-details"><summary><Search size={15}/>Look up a medication name in NLM RxNorm</summary><p>Match the name and formulation to your label. This reference does not supply your personal dosing instructions.</p><button className="button secondary small" disabled={searching||editor.fields.productName.length<3||editor.fields.category==="supplement"} onClick={()=>void lookup()}>{searching?<LoaderCircle className="spin" size={15}/>:<Search size={15}/>}Search this name</button>{editor.fields.category==="supplement"&&<p>Supplement labels are kept as entered. RxNorm coverage is not comprehensive.</p>}{searchMessage&&<p role="status">{searchMessage}</p>}<div className="reference-matches">{matches.map(m=><button key={m.rxCui} onClick={()=>chooseMatch(m)}>{m.name}<Plus size={14}/></button>)}</div>{editor.fields.referenceName&&<p className="reference-selected"><Check size={14}/>Selected reference: {editor.fields.referenceName}</p>}</details>
      </div>
      <div className="form-section"><div className="section-title"><span>2</span><h3>What does the label say?</h3></div><label className="field">Label directions<textarea rows={2} value={editor.fields.labelDirections} maxLength={1600} placeholder="Keep the original directions, including food, timing, or as-needed limits." onChange={e=>field("labelDirections",e.target.value)}/></label>{editor.fields.category==="supplement"&&<label className="field">Supplement Facts / ingredients<textarea rows={3} maxLength={2500} value={editor.fields.supplementFacts} placeholder="Include serving size, ingredients, and amounts when known." onChange={e=>field("supplementFacts",e.target.value)}/></label>}</div>
      <div className="form-section"><div className="section-title"><span>3</span><h3>How do you actually take it?</h3></div><p className="field-help">Report your current use, even if it differs from the label. This does not change your prescription.</p><label className="field">Current status<select value={editor.fields.status} onChange={e=>field("status",e.target.value as MedicationFields["status"])}><option value="taking">Currently taking</option><option value="held">Currently on hold</option><option value="stopped">No longer taking</option><option value="unsure">Not sure if I'm taking this</option></select></label>{editor.fields.status==="taking"&&<><label className="checkbox-row"><input type="checkbox" checked={editor.fields.actualUseUnknown} onChange={e=>field("actualUseUnknown",e.target.checked)}/><span>I'm not sure of my current amount or schedule.</span></label>{!editor.fields.actualUseUnknown&&<><div className="field-grid"><label className="field">How often?<select value={editor.fields.frequency} onChange={e=>field("frequency",e.target.value as MedicationFields["frequency"])}>{Object.entries(frequencies).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label><label className="field">Timing / food instructions<input value={editor.fields.timing} maxLength={300} placeholder="e.g. Morning and evening, with meals" onChange={e=>field("timing",e.target.value)}/></label></div>{editor.fields.frequency!=="custom"&&<div className="field-grid"><div className="field"><label htmlFor="actual-dose">Amount each time</label><div className="amount-input"><input id="actual-dose" value={editor.fields.actualDose} maxLength={40} inputMode="decimal" placeholder="e.g. 1 or 1/2" onChange={e=>field("actualDose",e.target.value)}/><select aria-label="Dose unit" value={editor.fields.doseUnit} onChange={e=>field("doseUnit",e.target.value as MedicationFields["doseUnit"])}>{units.map(v=><option key={v} value={v}>{v}</option>)}</select></div>{["tablets","capsules"].includes(editor.fields.doseUnit)&&<div className="quantity-chips">{["1/2","1","2"].map(n=><button type="button" key={n} aria-pressed={editor.fields.actualDose===n} onClick={()=>field("actualDose",n)}>{n==="1/2"?"½":n}</button>)}</div>}</div><div className="reported-dose">{reportedAmount(editor.fields)&&<><span>Calculated from your report</span><strong>{reportedAmount(editor.fields)}</strong><small>Confirm that the product strength and amount above are correct.</small></>}</div></div>}<label className="field">{editor.fields.frequency==="custom"?"Describe the full schedule":"Additional current-use instructions"}{editor.fields.frequency!=="custom"&&<span className="optional">Optional</span>}<textarea rows={2} maxLength={1600} value={editor.fields.actualInstructions} placeholder={editor.fields.frequency==="custom"?"Include different days, variable amounts, taper steps, or dates.":"Include as-needed limits or other details you follow."} onChange={e=>field("actualInstructions",e.target.value)}/></label></>}</>}
        {(editor.fields.actualUseUnknown||editor.fields.strengthUnknown||editor.fields.status==="unsure")&&<div className="uncertainty-box"><CircleHelp size={18}/><p>This uncertainty will be included on the provider card for clinic review.</p></div>}
        <details className="optional-details"><summary>Missed doses & notes <span>Optional</span></summary><label className="field">Missed planned doses in the past 7 days<select value={editor.fields.adherence} onChange={e=>field("adherence",e.target.value as MedicationFields["adherence"])}><option value="not_reported">Prefer not to report / not applicable</option><option value="none_reported">None reported</option><option value="some_missed">Some missed doses</option><option value="unsure">Not sure</option></select></label><label className="field">Notes for your care team<textarea rows={2} maxLength={800} value={editor.fields.uncertaintyNote} placeholder="Questions, difficulties, or anything you couldn't confirm." onChange={e=>field("uncertaintyNote",e.target.value)}/></label></details>
      </div>
      </div>
      <div className="confirmation-box"><ShieldCheck size={20}/><p>By confirming, you acknowledge that you reviewed this medication's identity, strength, and your reported use, including any uncertainty marked above.</p></div>{formError&&<div className="alert error" role="alert"><AlertCircle size={17}/>{formError}</div>}
    </div><div className="dialog-bottom"><div className="dialog-actions">{editor.id&&<><button className="text-button" disabled={busy} onClick={()=>void reportChange("no_longer_take")}>I no longer take this</button><button className="text-button" disabled={busy} onClick={()=>void reportChange("added_by_mistake")}>Added by mistake</button></>}</div><div className="dialog-actions"><button className="button secondary" disabled={busy} onClick={()=>void save(false)}>Save draft</button><button className="button primary" disabled={busy} onClick={()=>void save(true)}>{busy?<LoaderCircle className="spin" size={17}/>:<Check size={17}/>}Confirm this medication</button></div></div></>}</Modal>}
    {!guided&&creatingProfile&&<Modal title="Create a separate list" onClose={()=>setCreatingProfile(false)} locked={busy}><div className="simple-form"><p>Keep each person's medications in a separate list under your account.</p><label className="field">List name<input value={newProfileName} maxLength={80} placeholder="e.g. My medication list" onChange={e=>setNewProfileName(e.target.value)}/></label>{formError&&<div className="alert error" role="alert">{formError}</div>}<button className="button primary full" disabled={busy||!newProfileName.trim()} onClick={()=>void makeProfile()}>Create list<Plus size={17}/></button></div></Modal>}
    {reviewDetail&&<Modal title="Review submission" onClose={()=>setReviewDetail(null)} wide locked={busy}><div className="editor-content">
      <p className="field-help">{reviewDetail.deliveryLabel} · {reviewDetail.receivingClinic}</p>
      {reviewDetail.patient&&<div className="quick-identity"><h3>{reviewDetail.patient.legalName}</h3><p>DOB {reviewDetail.patient.dob}{reviewDetail.patient.postalCode?` · ZIP ${reviewDetail.patient.postalCode}`:""}</p></div>}
      {reviewDetail.respondent&&<p className="field-help">Respondent: {reviewDetail.respondent.display_name} · {reviewDetail.respondent.relationship} · {reviewDetail.respondent.completion_role}</p>}
      <p className="field-help">Status: {reviewDetail.submission.staffStatus.replaceAll("_"," ")} · Aprima: {reviewDetail.submission.aprimaStatus.replaceAll("_"," ")}</p>
      {reviewDetail.submission.emptyListAttested&&<p className="uncertainty-box">Patient attested: I take no medications or supplements.</p>}
      <div className="form-section"><h3>Changes & uncertainty</h3>
        <p>Added {(reviewDetail.submission.changeSummary as {counts?:{added?:number}}).counts?.added??0} · Stopped/held {(reviewDetail.submission.changeSummary as {counts?:{stopped?:number}}).counts?.stopped??0} · Changed {(reviewDetail.submission.changeSummary as {counts?:{changed?:number}}).counts?.changed??0} · Duplicate {(reviewDetail.submission.changeSummary as {counts?:{duplicate?:number}}).counts?.duplicate??0} · Uncertain {(reviewDetail.submission.changeSummary as {counts?:{uncertain?:number}}).counts?.uncertain??0}</p>
        {(reviewDetail.submission.changeSummary as {uncertain?:{productName:string;reasons:string[]}[]}).uncertain?.map((u,i)=><p key={i} className="field-help">{u.productName}: {u.reasons.join("; ")}</p>)}
        {(reviewDetail.submission.changeSummary as {duplicates?:{explanation:string}[]}).duplicates?.map((d,i)=><p key={`d${i}`} className="field-help">{d.explanation}</p>)}
      </div>
      <div className="form-section"><h3>Medications on this report</h3>
        {(reviewDetail.submission.payload.medications||[]).map(m=><div className="provider-med" key={m.id}><div><h3>{m.productName}</h3><p>{m.strengthUnknown?"Strength unsure":m.strength} · {useSummary(m)}</p></div></div>)}
        {!reviewDetail.submission.payload.medications?.length&&!reviewDetail.submission.emptyListAttested&&<p>No medications on this report.</p>}
      </div>
      <div className="dialog-actions"><button className="button primary" disabled={busy||reviewDetail.submission.deliveryStatus!=="received"} onClick={()=>void markReviewed("reviewed")}>Mark reviewed</button><button className="button secondary" disabled={busy} onClick={()=>void markReviewed("needs_clarification")}>Needs clarification</button></div>
      <div className="dialog-actions" style={{marginTop:12}}><button className="button secondary" disabled={busy} onClick={()=>void markAprima("entered_manually")}>Aprima entered manually</button><button className="text-button" disabled={busy} onClick={()=>void markAprima("not_entered")}>Aprima not entered</button></div>
    </div></Modal>}
    {card&&<Modal title={guided?"What the clinic received":"Local snapshot"} onClose={()=>setCard(null)} wide><div className="provider-card"><div className="provider-banner"><div><div className="eyebrow">{guided?"CLINIC SUBMISSION":"LOCAL SNAPSHOT"}</div><h2>{card.patientName}</h2><p>{guided?`Sent to ${card.recipient}`:`Prepared for ${card.recipient}`}</p></div><WalletCards size={35}/></div><div className="provider-meta"><span>Created {new Date(card.createdAt).toLocaleString()}</span><span>{card.medications.length} confirmed</span></div>{card.medications.map((m,i)=><div className="provider-med" key={m.id}><div className="provider-number">{String(i+1).padStart(2,"0")}</div><div><div className="provider-med-head"><h3>{m.productName}</h3><span>{m.category}</span></div><p className="provider-strength">{m.strengthUnknown?"Strength not known":m.strength} · {m.formulation}{m.route?` · ${m.route}`:""}</p><div className="provider-use"><strong>Reported use</strong><p>{useSummary(m)}</p></div><div className="provider-label"><strong>Label directions</strong><p>{m.labelDirections||"Not recorded"}</p></div>{m.actualInstructions&&<div className="provider-label"><strong>Current-use details</strong><p>{m.actualInstructions}</p></div>}{m.supplementFacts&&<div className="provider-label"><strong>Supplement label</strong><p>{m.supplementFacts}</p></div>}{m.sourceDocument&&<p className="provider-meta">Historical source: {m.sourceDocument} · {m.sourceDate||"date unknown"}. Original entry: {m.sourceText}</p>}{m.uncertaintyNote&&<div className="provider-label"><strong>Notes / uncertainty</strong><p>{m.uncertaintyNote}</p></div>}<div className="provider-foot">Confirmed {date(m.confirmedAt)} · Missed doses: {m.adherence.replaceAll("_"," ")} (self-reported{m.adherenceReportedAt?`; 7 days before ${date(m.adherenceReportedAt)}`:""})</div></div></div>)}</div>{guided?<div className="dialog-bottom no-print patient-portal-receipt"><button className="button primary" onClick={()=>setCard(null)}>Done</button></div>:<div className="dialog-bottom no-print"><div className="dialog-actions"><button className="button secondary" onClick={downloadCard}><Download size={16}/>Download</button><button className="button secondary" onClick={()=>window.print()}><Printer size={16}/>Print / PDF</button></div></div>}</Modal>}
    {undoHint&&<div className="toast undo-toast" role="status"><span>{undoHint.label}</span><button className="text-button" disabled={busy} onClick={()=>void undoChange()}>Undo</button></div>}
    {toast&&!undoHint&&<div className="toast" role="status"><Check size={17}/>{toast}</div>}
  </div>;
}
