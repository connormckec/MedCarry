"use client";

import {
  isWeakOcrText,
  normalizeOcrText,
  pickBestOcrCandidate,
  type OcrCandidate,
} from "@/lib/ocr-text";

export type OcrResult = {
  text: string;
  confidence: number;
  weak: boolean;
};

const MAX_EDGE = 2200;
const MIN_OCR_EDGE = 1200;
const OCR_TIMEOUT_MS = 90_000;

function isHeicLike(file: Blob): boolean {
  const type = (file.type || "").toLowerCase();
  if (type.includes("heic") || type.includes("heif")) return true;
  const name = "name" in file && typeof (file as File).name === "string" ? (file as File).name.toLowerCase() : "";
  return /\.heic$|\.heif$/i.test(name);
}

async function loadBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      // Prefer EXIF-aware decode when the runtime supports it (mobile photos).
      return await createImageBitmap(file, { imageOrientation: "from-image" } as unknown as ImageBitmapOptions);
    } catch {
      /* fall through to <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () =>
        reject(
          new Error(
            isHeicLike(file)
              ? "This phone photo format (HEIC) could not be opened here. Take a new picture in the app, or choose a JPG/PNG."
              : "This image could not be opened. Use the camera or choose a JPG, PNG, or WebP photo.",
          ),
        );
      im.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function sizeOf(img: ImageBitmap | HTMLImageElement): { w: number; h: number } {
  if ("naturalWidth" in img && img.naturalWidth) return { w: img.naturalWidth, h: img.naturalHeight };
  return { w: img.width, h: img.height };
}

function drawScaled(
  img: ImageBitmap | HTMLImageElement,
  maxEdge: number,
  minEdge: number,
): HTMLCanvasElement {
  const { w, h } = sizeOf(img);
  if (w < 80 || h < 80) {
    throw new Error("This photo is too small to read. Take a closer, sharper photo of the label.");
  }
  const longest = Math.max(w, h);
  let scale = Math.min(1, maxEdge / longest);
  if (longest * scale < minEdge && longest >= 80) {
    scale = Math.min(maxEdge / longest, minEdge / longest);
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Image processing is unavailable. Please use manual entry.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Contrast / grayscale enhancement for OCR only — evidence photo stays natural color. */
export function enhanceForOcr(source: HTMLCanvasElement, mode: "contrast" | "sharp"): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return source;
  ctx.drawImage(source, 0, 0);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = image.data;
  let min = 255;
  let max = 0;
  for (let i = 0; i < d.length; i += 4) {
    const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (y < min) min = y;
    if (y > max) max = y;
  }
  const span = Math.max(18, max - min);
  for (let i = 0; i < d.length; i += 4) {
    let y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    y = ((y - min) / span) * 255;
    if (mode === "sharp") {
      // Mild unsharp via local exaggeration toward black/white for label ink.
      y = y < 110 ? y * 0.82 : y > 160 ? Math.min(255, y * 1.08) : y;
    }
    const v = Math.max(0, Math.min(255, Math.round(y)));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement, quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The photo could not be prepared."))), "image/jpeg", quality);
  });
}

/** Prepare a private evidence photo (color JPEG). OCR enhancement happens separately. */
export async function preparePhoto(file: Blob): Promise<Blob> {
  if (file.size > 24 * 1024 * 1024) throw new Error("Choose a photo smaller than 24 MB.");
  if (isHeicLike(file)) {
    // Try decode anyway (Safari often can); otherwise give a clear recovery path.
    try {
      const img = await loadBitmap(file);
      const canvas = drawScaled(img, MAX_EDGE, 0);
      if ("close" in img && typeof img.close === "function") img.close();
      return await canvasToBlob(canvas, 0.93);
    } catch {
      throw new Error(
        "This phone photo format (HEIC) could not be opened here. Take a new picture in the app, or choose a JPG/PNG.",
      );
    }
  }
  const img = await loadBitmap(file);
  try {
    const canvas = drawScaled(img, MAX_EDGE, 0);
    return await canvasToBlob(canvas, 0.93);
  } finally {
    if ("close" in img && typeof img.close === "function") img.close();
  }
}

async function blobsForOcr(image: Blob): Promise<{ blob: Blob; label: string }[]> {
  const img = await loadBitmap(image);
  try {
    const base = drawScaled(img, MAX_EDGE, MIN_OCR_EDGE);
    const contrast = enhanceForOcr(base, "contrast");
    const sharp = enhanceForOcr(base, "sharp");
    const [b0, b1, b2] = await Promise.all([
      canvasToBlob(base, 0.95),
      canvasToBlob(contrast, 0.95),
      canvasToBlob(sharp, 0.95),
    ]);
    return [
      { blob: b1, label: "contrast" },
      { blob: b2, label: "sharp" },
      { blob: b0, label: "color" },
    ];
  } finally {
    if ("close" in img && typeof img.close === "function") img.close();
  }
}

function meanConfidence(data: { confidence?: number; words?: { confidence: number }[] }): number {
  if (typeof data.confidence === "number" && Number.isFinite(data.confidence)) return data.confidence;
  const words = data.words || [];
  if (!words.length) return 0;
  return words.reduce((s, w) => s + (w.confidence || 0), 0) / words.length;
}

/**
 * Browser OCR via same-origin Tesseract assets.
 * Tries contrast-enhanced variants and a second page-seg mode when the first pass is weak.
 * Photos stay on-device for recognition; no third-party OCR API (avoids sending label PHI off-site).
 */
export async function recognizeLabels(
  images: Blob[],
  progress: (message: string) => void,
  signal: AbortSignal,
): Promise<OcrResult> {
  const { createWorker, PSM } = await import("tesseract.js");
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const aborted = new Promise<never>((_, reject) => {
    if (signal.aborted) reject(new Error("Text recognition skipped."));
    signal.addEventListener("abort", () => reject(new Error("Text recognition skipped.")), { once: true });
    timer = setTimeout(
      () => reject(new Error("Text recognition took too long. Enter the label manually.")),
      OCR_TIMEOUT_MS,
    );
  });

  const run = async (): Promise<OcrResult> => {
    progress("Preparing text recognition…");
    const pending = createWorker("eng", 1, {
      workerPath: new URL("/ocr/worker.min.js", location.origin).href,
      corePath: new URL("/ocr/core", location.origin).href,
      langPath: new URL("/ocr/lang", location.origin).href,
      workerBlobURL: false,
      cacheMethod: "none",
      logger: (m) => {
        if (finished) return;
        if (m.status === "recognizing text") progress(`Reading label… ${Math.round((m.progress || 0) * 100)}%`);
        else if (m.status.includes("loading")) progress("Loading the label reader…");
      },
    });
    const created = await pending;
    if (finished || signal.aborted) {
      await created.terminate().catch(() => {});
      throw new Error("Text recognition skipped.");
    }
    worker = created;

    const pageTexts: string[] = [];
    let confidenceSum = 0;
    let confidenceN = 0;

    for (let i = 0; i < images.length; i++) {
      if (signal.aborted) throw new Error("Text recognition skipped.");
      progress(`Reading photo ${i + 1} of ${images.length}…`);
      const variants = await blobsForOcr(images[i]);
      const candidates: OcrCandidate[] = [];

      // First pass: contrast + AUTO (best default for phone label photos).
      await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
      const first = await worker.recognize(variants[0].blob);
      candidates.push({
        text: first.data.text || "",
        confidence: meanConfidence(first.data),
        source: `${variants[0].label}/auto`,
      });

      // If weak, try sharp + single-block (common for dense pharmacy labels).
      if (isWeakOcrText(candidates[0].text, candidates[0].confidence)) {
        progress(`Trying a clearer read of photo ${i + 1}…`);
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
        const second = await worker.recognize(variants[1].blob);
        candidates.push({
          text: second.data.text || "",
          confidence: meanConfidence(second.data),
          source: `${variants[1].label}/block`,
        });
        // Last resort: original color + sparse text (helps when AUTO merges columns badly).
        if (isWeakOcrText(second.data.text || "", meanConfidence(second.data))) {
          await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
          const third = await worker.recognize(variants[2].blob);
          candidates.push({
            text: third.data.text || "",
            confidence: meanConfidence(third.data),
            source: `${variants[2].label}/sparse`,
          });
        }
      }

      const best = pickBestOcrCandidate(candidates);
      if (best) {
        pageTexts.push(best.text);
        confidenceSum += best.confidence;
        confidenceN += 1;
      }
    }

    const text = normalizeOcrText(pageTexts.join("\n\n")).slice(0, 12000);
    const confidence = confidenceN ? confidenceSum / confidenceN : 0;
    return { text, confidence, weak: isWeakOcrText(text, confidence) };
  };

  try {
    return await Promise.race([run(), aborted]);
  } finally {
    finished = true;
    if (timer) clearTimeout(timer);
    if (worker) await worker.terminate().catch(() => {});
  }
}
