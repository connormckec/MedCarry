"use client";
export async function recognizeLabels(images: Blob[], progress: (message: string) => void, signal: AbortSignal): Promise<string> {
  const { createWorker, PSM } = await import("tesseract.js");
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const aborted = new Promise<never>((_,reject) => {
    if(signal.aborted) reject(new Error("Text recognition skipped."));
    signal.addEventListener("abort",()=>reject(new Error("Text recognition skipped.")),{once:true});
    timer=setTimeout(()=>reject(new Error("Text recognition took too long. Enter the label manually.")),90000);
  });
  const run = async () => {
    progress("Preparing text recognition…");
    const pending=createWorker("eng",1,{
      workerPath:new URL("/ocr/worker.min.js",location.origin).href,
      corePath:new URL("/ocr/core",location.origin).href,
      langPath:new URL("/ocr/lang",location.origin).href,
      workerBlobURL:false,cacheMethod:"none",
      logger:m=>{if(finished)return;if(m.status==="recognizing text")progress(`Reading label… ${Math.round((m.progress||0)*100)}%`);else if(m.status.includes("loading"))progress("Loading the label reader…");},
    });
    const created=await pending;
    if(finished||signal.aborted){await created.terminate().catch(()=>{});throw new Error("Text recognition skipped.");}
    worker=created;
    await worker.setParameters({tessedit_pageseg_mode:PSM.AUTO});
    const texts:string[]=[];
    for(let i=0;i<images.length;i++) {if(signal.aborted)throw new Error("Text recognition skipped.");progress(`Reading photo ${i+1} of ${images.length}…`);const {data}=await worker.recognize(images[i]);texts.push(data.text);}
    return texts.join("\n\n").slice(0,12000);
  };
  try{return await Promise.race([run(),aborted]);}finally{finished=true;if(timer)clearTimeout(timer);if(worker)await worker.terminate().catch(()=>{});}
}

export async function preparePhoto(file: Blob): Promise<Blob> {
  if(file.size>24*1024*1024)throw new Error("Choose a photo smaller than 24 MB.");
  const url=URL.createObjectURL(file);
  try {
    const img=await new Promise<HTMLImageElement>((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(new Error("This image could not be opened. Use the camera or choose a JPG, PNG, or WebP photo."));im.src=url;});
    if(img.naturalWidth<80||img.naturalHeight<80)throw new Error("This photo is too small to read. Take a closer, sharper photo of the label.");
    const ratio=Math.min(1,2200/Math.max(img.naturalWidth,img.naturalHeight));const canvas=document.createElement("canvas");canvas.width=Math.round(img.naturalWidth*ratio);canvas.height=Math.round(img.naturalHeight*ratio);const ctx=canvas.getContext("2d");if(!ctx)throw new Error("Image processing is unavailable. Please use manual entry.");ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
    return await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error("The photo could not be prepared.")),"image/jpeg",.93));
  } finally {URL.revokeObjectURL(url);}
}
