/**
 * Context-aware label identity resolver for patient photo capture.
 * Corrects misspelled product names into the draft when evidence supports it.
 * Never invents dose, frequency, or current use. RxNorm scores are ranks, not probabilities.
 */

import { emptyMedication, parseLabel, type MedicationFields } from "./medication.ts";
import {
  applyTerminologyToFields,
  buildTerminologyQuery,
  normalizeFromDrugGroup,
  normalizeFromFixture,
  normalizeTerm,
  type DrugGroupResponse,
  type NormalizedTerminology,
} from "./rxnorm.ts";
import { RXNORM_FIXTURES, type FixtureConcept } from "./rxnorm-fixtures.ts";

export type LabelSegment =
  | "product"
  | "strength"
  | "formulation"
  | "directions"
  | "pharmacy_noise"
  | "supplement_facts"
  | "other";

export type SegmentedLine = { line: string; segment: LabelSegment };

export type PriorMedHint = {
  productName: string;
  strength: string;
  formulation: string;
  category: MedicationFields["category"];
  rxCui?: string;
  referenceName?: string;
};

export type ResolveOptions = {
  /** Prior authorized medications on the same list — may rank, never override contradictory label evidence. */
  priorMeds?: PriorMedHint[];
  /** Optional live NLM getDrugs payload (already fetched server-side). */
  liveDrugGroup?: DrugGroupResponse | null;
  /** When true, skip live ranking even if a payload is present. */
  preferOffline?: boolean;
};

export type ResolveResult = {
  fields: MedicationFields;
  notices: string[];
  terminology: NormalizedTerminology | null;
  /** True when productName was updated from OCR text to a reference spelling. */
  spellingCorrected: boolean;
  /** True when more than one plausible product remains. */
  ambiguous: boolean;
  categoryNeedsAsk: boolean;
};

const STRENGTH = /\b\d+(?:\.\d+)?\s*(?:mcg|mg|grams?|g|IU|units?|%)(?:\s*\/\s*(?:\d+(?:\.\d+)?\s*)?(?:mL|ml|tablet|capsule))?/i;
const FORMULATION =
  /\b(?:tablets?|tabs?|capsules?|caps?|softgels?|gummies?|inhaler|injection|patch(?:es)?|drops?|cream|ointment|gel|solution|suspension|powder|liquid)\b/i;
const DIRECTIONS = /\b(?:take|give|use|inject|inhale|apply|instill|chew|dissolve|by mouth|orally|as needed|prn|daily|twice)\b/i;
const PHARMACY =
  /(?:pharmacy|prescriber|refill|qty\s*:|rx\s*#|npi|dea|expir|discard|patient|dob|phone|tel\.?|www\.|https?:|address)/i;
const OTC_HINT =
  /\b(?:otc|over[\s-]?the[\s-]?counter|nonprescription|non-prescription|pain reliever|antacid|allergy relief|cough|cold|fever reducer)\b/i;
const RX_HINT = /\b(?:rx\s*#|prescription|prescriber|refill|dispense|ndc)\b/i;
const SUPPLEMENT_HINT =
  /\b(?:supplement facts|dietary supplement|vitamin|multivitamin|mineral|probiotic|omega[\s-]?3|fish oil|herbal)\b/i;

/** Segment OCR lines by nearby label structure — product vs strength vs directions vs noise. */
export function segmentLabelLines(raw: string): SegmentedLine[] {
  const lines = raw
    .slice(0, 12000)
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.map((line) => {
    if (/supplement facts/i.test(line) || /^serving size\b/i.test(line)) {
      return { line, segment: "supplement_facts" as const };
    }
    if (PHARMACY.test(line) && !STRENGTH.test(line) && !DIRECTIONS.test(line)) {
      return { line, segment: "pharmacy_noise" as const };
    }
    if (DIRECTIONS.test(line)) return { line, segment: "directions" as const };
    if (STRENGTH.test(line) && !/[A-Za-z]{4,}/.test(line.replace(STRENGTH, ""))) {
      return { line, segment: "strength" as const };
    }
    if (STRENGTH.test(line) && FORMULATION.test(line)) return { line, segment: "product" as const };
    if (STRENGTH.test(line)) return { line, segment: "product" as const };
    if (FORMULATION.test(line) && line.length < 40) return { line, segment: "formulation" as const };
    if (/^(?:drug|medication|medicine|product)\s*name\s*:?/i.test(line)) {
      return { line, segment: "product" as const };
    }
    if (/^strength\s*:?/i.test(line)) return { line, segment: "strength" as const };
    return { line, segment: "other" as const };
  });
}

/** Lightweight edit distance for OCR misspellings (token length capped). */
export function editDistance(a: string, b: string): number {
  const s = a.slice(0, 48);
  const t = b.slice(0, 48);
  const m = s.length;
  const n = t.length;
  if (!m) return n;
  if (!n) return m;
  const row = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[n];
}

function titleCaseDrug(name: string): string {
  return name
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function displayNameFromConcept(c: FixtureConcept): string {
  if (c.brandName) return c.brandName;
  const salt = c.clinicalDrugName.match(
    /^([A-Za-z][A-Za-z\-]+(?:\s+(?:tartrate|succinate|besylate|hydrochloride|hcl))?)/i,
  );
  if (salt) return titleCaseDrug(salt[1].trim());
  if (c.ingredientNames[0]) return titleCaseDrug(c.ingredientNames[0]);
  return (
    (c.synonym || c.name).replace(/\s+\d+(?:\.\d+)?\s*(?:MG|MCG|G|IU).*$/i, "").trim() || c.name
  );
}

type Ranked = {
  concept: FixtureConcept;
  score: number;
  method: "exact" | "normalized" | "fuzzy" | "prior" | "live";
  correctedName: string;
};

function scoreFixture(
  fields: MedicationFields,
  segments: SegmentedLine[],
  concept: FixtureConcept,
  priorMeds: PriorMedHint[],
): Ranked | null {
  const needle = normalizeTerm(fields.productName);
  if (needle.length < 3) return null;
  const names = [concept.name, concept.synonym || "", concept.brandName || "", ...concept.ingredientNames]
    .filter(Boolean)
    .map((n) => normalizeTerm(String(n)));
  const productLines = segments
    .filter((s) => s.segment === "product" || s.segment === "other")
    .map((s) => normalizeTerm(s.line));

  let score = 0;
  let method: Ranked["method"] = "fuzzy";
  let correctedName = displayNameFromConcept(concept);

  const exact = names.some((n) => n === needle || n.startsWith(needle + " ") || needle === normalizeTerm(concept.brandName || ""));
  if (exact) {
    score += 100;
    method = "exact";
  } else {
    // Token / substring normalized match.
    const tokenHit = names.some(
      (n) =>
        (needle.length >= 5 && n.includes(needle)) ||
        (n.length >= 5 && needle.includes(n)) ||
        needle.split(" ").filter((t) => t.length >= 4).some((t) => n.includes(t) && editDistance(t, n.split(" ").find((x) => x.includes(t) || t.includes(x)) || t) <= 2),
    );
    if (tokenHit) {
      score += 70;
      method = "normalized";
    } else {
      // Fuzzy against ingredient / brand tokens for OCR misspellings (e.g. TARTRTE → tartrate).
      let bestDist = 99;
      let bestToken = "";
      for (const n of names) {
        for (const tok of n.split(" ").filter((t) => t.length >= 5)) {
          for (const pt of needle.split(" ").filter((t) => t.length >= 5)) {
            const d = editDistance(pt, tok);
            const maxLen = Math.max(pt.length, tok.length);
            if (d < bestDist && d <= Math.max(2, Math.floor(maxLen * 0.34))) {
              bestDist = d;
              bestToken = tok;
            }
          }
        }
        const dFull = editDistance(needle, n.split(" ").slice(0, 3).join(" "));
        if (dFull < bestDist && dFull <= 4 && needle.length >= 8) {
          bestDist = dFull;
          bestToken = n;
        }
      }
      // Also compare product-line OCR blobs.
      for (const pl of productLines) {
        for (const n of names) {
          const d = editDistance(pl.slice(0, 40), n.slice(0, 40));
          if (d < bestDist && d <= 5 && pl.length >= 8) {
            bestDist = d;
            bestToken = n;
          }
        }
      }
      if (bestDist > 4 || !bestToken) return null;
      score += 55 - bestDist * 6;
      method = "fuzzy";
    }
  }

  // Strength / formulation / release evidence from the label.
  const labelStrengthNum = (fields.strength.match(/\d+(?:\.\d+)?/) || [""])[0];
  const strengthOk =
    fields.strengthUnknown ||
    !fields.strength.trim() ||
    !concept.strengthValue ||
    labelStrengthNum === concept.strengthValue;
  // Keep name candidates even when strength differs — caller must not attach that RxCUI as identity.
  if (fields.strength.trim() && strengthOk) score += 22;
  else if (fields.strength.trim() && concept.strengthValue && !strengthOk) score -= 35;

  const formHints: Record<string, string[]> = {
    tablet: ["tablet", "tab"],
    capsule: ["capsule", "cap", "softgel"],
    liquid: ["solution", "suspension", "syrup", "liquid"],
    inhaler: ["inhaler", "inhalation"],
    injection: ["injection"],
    topical: ["cream", "ointment", "gel"],
    patch: ["patch"],
    drops: ["drop"],
    powder: ["powder"],
    other: [],
  };
  const hints = formHints[fields.formulation] || [];
  const formName = normalizeTerm(concept.dosageForm || concept.name);
  if (hints.length && hints.some((h) => formName.includes(h))) score += 12;
  else if (hints.length && fields.formulation !== "other") score -= 8;

  const wantEr = /\b(extended|succinate|er|xl|xr|24\s*hr)\b/i.test(`${fields.productName} ${fields.strength}`);
  const isEr = !!concept.releaseCharacteristic;
  if (wantEr !== isEr && /metoprolol/i.test(fields.productName + concept.name)) {
    return null;
  }
  if (wantEr && isEr) score += 10;

  // Multi-ingredient concepts must not win when the label only shows one ingredient.
  if (concept.ingredientNames.length > 1) {
    const mentioned = concept.ingredientNames.filter((ing) => {
      const i = normalizeTerm(ing);
      return (
        needle.includes(i) ||
        needle.split(" ").some((t) => t.length >= 4 && (i.includes(t) || editDistance(t, i) <= 2))
      );
    }).length;
    if (mentioned < 2) score -= 80;
  }

  // Prefer salt tokens present on the label (tartrate vs succinate).
  for (const salt of ["tartrate", "succinate", "besylate"]) {
    const labelHas = needle.includes(salt) || needle.split(" ").some((t) => editDistance(t, salt) <= 2);
    const conceptHas = names.some((n) => n.includes(salt));
    if (labelHas && conceptHas) score += 20;
    if (labelHas && !conceptHas) score -= 15;
  }

  // Prior authorized list may boost rank but cannot rescue a strength contradiction (already excluded).
  for (const prior of priorMeds) {
    if (prior.rxCui && prior.rxCui === concept.rxCui) score += 8;
    else if (
      normalizeTerm(prior.productName) &&
      names.some(
        (n) =>
          n.includes(normalizeTerm(prior.productName)) ||
          normalizeTerm(prior.productName).includes(n.split(" ")[0] || ""),
      )
    ) {
      score += 5;
    }
  }

  // Prefer clinical drug display for patient draft spelling.
  if (concept.brandName && (normalizeTerm(fields.productName).includes(normalizeTerm(concept.brandName)) || method === "exact")) {
    correctedName = concept.brandName;
  } else if (concept.ingredientNames.length === 1) {
    const saltMatch = concept.clinicalDrugName.match(
      /^([A-Za-z][A-Za-z\-]+(?:\s+(?:tartrate|succinate|besylate|hydrochloride|hcl))?)/i,
    );
    if (saltMatch) correctedName = titleCaseDrug(saltMatch[1].trim());
    else correctedName = titleCaseDrug(concept.ingredientNames[0]);
  } else {
    correctedName = displayNameFromConcept(concept);
  }

  return { concept, score, method, correctedName };
}

export function proposeCategory(
  text: string,
  fields: Pick<MedicationFields, "category" | "supplementFacts" | "productName">,
): { category: MedicationFields["category"]; needsAsk: boolean; notice?: string } {
  const blob = `${text}\n${fields.productName}\n${fields.supplementFacts}`.toLowerCase();
  if (/supplement facts|dietary supplement/.test(blob) || fields.supplementFacts.trim()) {
    return { category: "supplement", needsAsk: false };
  }
  const hasSupp = SUPPLEMENT_HINT.test(blob);
  const hasOtc = OTC_HINT.test(blob);
  const hasRx = RX_HINT.test(blob);
  if (hasSupp && !hasOtc && !hasRx) {
    // Vitamin/mineral language without Supplement Facts — propose but ask when unclear.
    if (/\b(?:vitamin|multivitamin|omega|probiotic|fish oil)\b/i.test(blob)) {
      return {
        category: "supplement",
        needsAsk: true,
        notice: "This may be a vitamin or supplement. Confirm the type, or keep it as entered.",
      };
    }
  }
  if (hasOtc && !hasSupp) return { category: "otc", needsAsk: false };
  if (hasRx) return { category: "prescription", needsAsk: false };
  if (hasOtc && hasSupp) {
    return {
      category: "otc",
      needsAsk: true,
      notice: "Type is unclear from the label. Choose prescription, over-the-counter, or vitamin/supplement.",
    };
  }
  return { category: fields.category || "prescription", needsAsk: !hasRx && !hasOtc && hasSupp };
}

/**
 * Resolve OCR/parse draft against fixtures (and optional live RxNorm payload).
 * Runs in the patient photo path via /api/parse.
 */
export function resolveLabelDraft(rawText: string, options: ResolveOptions = {}): ResolveResult {
  const parsed = parseLabel(rawText);
  const segments = segmentLabelLines(rawText);
  const priorMeds = options.priorMeds || [];
  let fields = { ...parsed.fields };
  const notices = [...parsed.notices];
  let spellingCorrected = false;
  let ambiguous = false;
  let terminology: NormalizedTerminology | null = null;

  const category = proposeCategory(rawText, fields);
  fields.category = category.category;
  if (category.notice) notices.push(category.notice);

  if (fields.category === "supplement") {
    // Supplements stay label-based; RxNorm is not applied.
    terminology = normalizeFromFixture(fields);
    return {
      fields,
      notices,
      terminology,
      spellingCorrected: false,
      ambiguous: false,
      categoryNeedsAsk: category.needsAsk,
    };
  }

  const ranked = RXNORM_FIXTURES.map((c) => scoreFixture(fields, segments, c, priorMeds))
    .filter((x): x is Ranked => !!x)
    .sort((a, b) => b.score - a.score);

  // Live approximate only when offline fixture match is weak and a payload was provided.
  if (
    options.liveDrugGroup &&
    !options.preferOffline &&
    (!ranked.length || ranked[0].score < 70)
  ) {
    try {
      const live = normalizeFromDrugGroup(fields, options.liveDrugGroup);
      if (live.rxCui && live.mappingStatus === "candidate") {
        terminology = { ...live, matchMethod: "approximate", notes: [...live.notes, "Approximate NLM match ranked against label strength and form. Not a probability."] };
        const liveName = (live.referenceName || "").replace(/\s+\d+(?:\.\d+)?\s*(?:MG|MCG|G|IU).*$/i, "").trim();
        if (liveName && normalizeTerm(liveName) !== normalizeTerm(fields.productName)) {
          const dist = editDistance(normalizeTerm(fields.productName), normalizeTerm(liveName));
          if (dist > 0 && dist <= 5) {
            notices.push(`Suggested spelling from the medication reference: ${liveName}. Check the bottle.`);
            fields = {
              ...fields,
              productName: titleCaseDrug(liveName).slice(0, 180),
              rxCui: live.rxCui,
              referenceName: live.referenceName,
            };
            spellingCorrected = true;
          } else {
            fields = applyTerminologyToFields(fields, live);
            notices.push(`Reference match proposed: ${live.referenceName}. Confirm the name on your bottle.`);
            ambiguous = true;
          }
        } else {
          fields = applyTerminologyToFields(fields, live);
        }
        return {
          fields,
          notices,
          terminology,
          spellingCorrected,
          ambiguous,
          categoryNeedsAsk: category.needsAsk,
        };
      }
    } catch {
      /* keep offline path */
    }
  }

  if (!ranked.length) {
    terminology = normalizeFromFixture(fields);
    if (!fields.productName.trim()) {
      notices.push("No medication name match yet. Enter the name from the label.");
    }
    return {
      fields,
      notices,
      terminology,
      spellingCorrected: false,
      ambiguous: false,
      categoryNeedsAsk: category.needsAsk,
    };
  }

  const top = ranked[0];
  const second = ranked[1];
  if (
    second &&
    top.score - second.score < 12 &&
    top.concept.clinicalDrugRxCui !== second.concept.clinicalDrugRxCui
  ) {
    ambiguous = true;
    notices.push(
      `More than one possible match (${top.correctedName} vs ${second.correctedName}). Check the bottle name and strength.`,
    );
  }
  // Same clinical drug under brand vs generic is not ambiguity for the patient draft.
  if (
    second &&
    top.concept.clinicalDrugRxCui &&
    top.concept.clinicalDrugRxCui === second.concept.clinicalDrugRxCui
  ) {
    ambiguous = false;
  }

  const labelStrengthNum = (fields.strength.match(/\d+(?:\.\d+)?/) || [""])[0];
  const strengthAligned =
    fields.strengthUnknown ||
    !fields.strength.trim() ||
    !top.concept.strengthValue ||
    labelStrengthNum === top.concept.strengthValue;

  // Confident name correction can apply even when strength differs; RxCUI only when strength aligns.
  const confidentName = top.score >= 40 && (top.method !== "fuzzy" || top.score >= 45);
  const confidentIdentity = confidentName && strengthAligned && !ambiguous && top.score >= 55;

  terminology = normalizeFromFixture({
    ...fields,
    productName: top.correctedName,
    rxCui: confidentIdentity ? top.concept.rxCui : "",
    referenceName: confidentIdentity ? top.concept.synonym || top.concept.name : "",
  });

  if (confidentName && normalizeTerm(top.correctedName) !== normalizeTerm(fields.productName)) {
    notices.push(
      top.method === "fuzzy"
        ? `Corrected spelling from the label reader: ${top.correctedName}. Check the bottle.`
        : `Matched name: ${top.correctedName}. Check the bottle.`,
    );
    if (!strengthAligned && fields.strength.trim()) {
      notices.push("Strength on the label does not match the closest reference strength. Kept your label strength.");
    }
    fields = {
      ...fields,
      productName: top.correctedName.slice(0, 180),
      rxCui: confidentIdentity ? top.concept.rxCui : "",
      referenceName: confidentIdentity ? top.concept.synonym || top.concept.name : "",
      strength: parsed.fields.strength,
      strengthUnknown: parsed.fields.strengthUnknown,
    };
    spellingCorrected = true;
  } else if (confidentIdentity) {
    fields = applyTerminologyToFields(fields, terminology);
    // Prefer brand casing from the reference when the OCR name is the brand.
    if (top.concept.brandName && normalizeTerm(fields.productName) === normalizeTerm(top.concept.brandName)) {
      fields = { ...fields, productName: top.concept.brandName };
    }
  } else if (ambiguous) {
    // Leave OCR name; attach no silent substitute. Patient clarifies.
    fields = { ...fields, rxCui: "", referenceName: "" };
    terminology = normalizeFromFixture(fields);
  } else if (confidentIdentity === false && terminology.referenceName) {
    notices.push(`Possible match: ${terminology.referenceName}. Confirm against the label — not applied as a silent substitute.`);
  } else if (strengthAligned && top.score >= 55) {
    fields = applyTerminologyToFields(fields, terminology);
  }

  // Safety: never copy dose/frequency from usual patterns / DB — parseLabel already drafted from SIG only.
  return {
    fields,
    notices,
    terminology,
    spellingCorrected,
    ambiguous,
    categoryNeedsAsk: category.needsAsk,
  };
}

/** Build a safe terminology query string for optional live lookup (product fields only). */
export function liveQueryFromDraft(fields: MedicationFields): string | null {
  if (fields.category === "supplement") return null;
  try {
    return buildTerminologyQuery(fields);
  } catch {
    return null;
  }
}

export function emptyResolve(): ResolveResult {
  return {
    fields: emptyMedication(),
    notices: [],
    terminology: null,
    spellingCorrected: false,
    ambiguous: false,
    categoryNeedsAsk: false,
  };
}
