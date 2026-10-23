/** Pure OCR text helpers — no DOM / Tesseract. Safe for Node tests. */

const STRENGTH =
  /\b\d+(?:\.\d+)?\s*(?:mcg|mg|grams?|g|IU|units?|%)(?:\s*\/\s*(?:\d+(?:\.\d+)?\s*)?(?:mL|ml|tablet|capsule))?/i;
const INSTRUCTION =
  /\b(?:take|give|use|inject|inhale|apply|instill|chew|dissolve)\b/i;
const PHARMACY_NOISE =
  /(?:pharmacy|prescriber|refill|qty\s*:|rx\s*#|npi|dea|expir|discard|patient|dob|phone|tel\.?|www\.|https?:)/i;

export type OcrCandidate = { text: string; confidence: number; source?: string };

/** Light OCR cleanup without inventing clinical content. */
export function normalizeOcrText(raw: string): string {
  return raw
    .replace(/\r/g, "")
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, " ")
    .replace(/[|¦]/g, "I")
    .replace(/\b(\d+)\s*[oO]\s*(mg|mcg|g|iu|ml)\b/gi, "$1 $2")
    .replace(/\b(\d+)\s*(rnq|rng|rnc)\b/gi, "$1 mg")
    .replace(/\b(\d+)\s*m[l1]\b/gi, "$1 mL")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Score OCR output for medication-label usefulness.
 * Prefers strength + directions signals and rejects pharmacy-header-only dumps.
 */
export function scoreLabelText(text: string, confidence = 0): number {
  const normalized = normalizeOcrText(text);
  if (normalized.length < 4) return 0;
  const lines = normalized.split("\n").map((l) => l.trim()).filter(Boolean);
  let score = Math.min(35, confidence * 0.35);
  score += Math.min(20, normalized.length / 40);
  if (STRENGTH.test(normalized)) score += 28;
  if (INSTRUCTION.test(normalized)) score += 22;
  if (/\b(?:tablet|capsule|inhaler|patch|drops?|by mouth|orally|daily|twice|prn)\b/i.test(normalized)) {
    score += 10;
  }
  const noisy = lines.filter((l) => PHARMACY_NOISE.test(l)).length;
  score -= Math.min(18, noisy * 4);
  if (lines.length === 1 && normalized.length < 24 && !STRENGTH.test(normalized)) score -= 15;
  return Math.max(0, score);
}

export function pickBestOcrCandidate(candidates: OcrCandidate[]): OcrCandidate | null {
  let best: OcrCandidate | null = null;
  let bestScore = -1;
  for (const c of candidates) {
    const text = normalizeOcrText(c.text);
    if (!text) continue;
    const score = scoreLabelText(text, c.confidence);
    if (score > bestScore) {
      bestScore = score;
      best = { ...c, text };
    }
  }
  return best;
}

/** True when OCR text is unlikely to yield name/strength/directions. */
export function isWeakOcrText(text: string, confidence = 0): boolean {
  return scoreLabelText(text, confidence) < 28;
}

/** Short excerpt for patient notices — not stored as clinical sourceText. */
export function ocrExcerpt(text: string, max = 280): string {
  const t = normalizeOcrText(text).replace(/\n+/g, " · ");
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trim()}…`;
}
