/**
 * RxNorm terminology normalization and explainable duplicate flags.
 * Sends only medication terminology to NLM — never patient identifiers or full notes.
 * Never auto-merges or removes medications.
 */

import {
  RXNORM_FIXTURE_DATE,
  RXNORM_FIXTURE_VERSION,
  RXNORM_FIXTURES,
  fixtureByRxCui,
  type FixtureConcept,
} from "./rxnorm-fixtures.ts";
import type { MedicationFields } from "./medication.ts";

export class RxNormError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RxNormError";
  }
}

export const MAPPING_STATUSES = [
  "unresolved",
  "candidate",
  "confirmed",
  "unmatched",
  "unavailable",
] as const;
export type MappingStatus = (typeof MAPPING_STATUSES)[number];

export const MATCH_METHODS = ["exact", "approximate", "fixture", "manual", "none"] as const;
export type MatchMethod = (typeof MATCH_METHODS)[number];

export const DUPLICATE_FLAG_TYPES = [
  "possible_duplicate",
  "different_strength_or_schedule",
  "different_formulation_release",
  "ingredient_overlap",
] as const;
export type DuplicateFlagType = (typeof DUPLICATE_FLAG_TYPES)[number];

export const DUPLICATE_RESPONSES = [
  "open",
  "take_both",
  "added_twice",
  "unsure",
  "staff_dismissed",
] as const;
export type DuplicateResponse = (typeof DUPLICATE_RESPONSES)[number];

export type NormalizedTerminology = {
  originalProductName: string;
  originalStrength: string;
  originalFormulation: string;
  queryText: string;
  rxCui: string;
  referenceName: string;
  tty: string;
  clinicalDrugRxCui: string;
  clinicalDrugName: string;
  ingredientRxCuis: string[];
  ingredientNames: string[];
  strengthValue: string;
  strengthUnit: string;
  dosageForm: string;
  releaseCharacteristic: string;
  mappingStatus: MappingStatus;
  matchMethod: MatchMethod;
  terminologyVersion: string;
  terminologyDate: string;
  notes: string[];
};

export type DuplicateCandidate = {
  medicationAId: string;
  medicationBId: string;
  flagType: DuplicateFlagType;
  explanation: string;
  evidence: Record<string, unknown>;
};

export type DrugGroupResponse = {
  drugGroup?: {
    conceptGroup?: {
      tty?: string;
      conceptProperties?: { rxcui: string; name: string; synonym?: string; tty?: string }[];
    }[];
  };
};

export type RelatedGroupResponse = {
  relatedGroup?: {
    conceptGroup?: {
      tty?: string;
      conceptProperties?: { rxcui: string; name: string; synonym?: string; tty?: string }[];
    }[];
  };
};

const FORMULATION_HINTS: Record<string, string[]> = {
  tablet: ["tablet", "tab"],
  capsule: ["capsule", "cap"],
  liquid: ["solution", "suspension", "syrup", "liquid", "ml"],
  inhaler: ["inhaler", "inhalation"],
  injection: ["injection", "injectable"],
  topical: ["cream", "ointment", "gel", "topical"],
  patch: ["patch"],
  drops: ["drop"],
  powder: ["powder"],
  other: [],
};

/** Collapse whitespace/punctuation for conservative string compare. */
export function normalizeTerm(value: string): string {
  return value
    .toLowerCase()
    .replace(/[®™]/g, "")
    .replace(/[^a-z0-9./]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Build an NLM query from medication terminology only.
 * Never include patient names, DOB, MRN, note text, or OCR dumps.
 */
export function buildTerminologyQuery(
  fields: Pick<MedicationFields, "productName" | "strength" | "strengthUnknown" | "formulation" | "category">,
): string {
  if (fields.category === "supplement") {
    throw new RxNormError("Supplement labels stay as entered. RxNorm coverage is not comprehensive.");
  }
  const name = fields.productName.trim().replace(/\s+/g, " ");
  if (name.length < 3) throw new RxNormError("Enter at least three characters of a medication name.");
  if (name.length > 180) throw new RxNormError("Medication name is too long for a terminology lookup.");
  // Reject obvious non-terminology payloads (full notes / identifiers).
  if (/\b(?:dob|ssn|mrn|patient|date of birth)\b/i.test(name)) {
    throw new RxNormError("Send only the medication name, strength, and form — not patient identifiers.");
  }
  if (name.includes("\n") || name.length > 120 && /take\b/i.test(name)) {
    throw new RxNormError("Send only medication terminology to NLM, never a full note or directions block.");
  }
  const parts = [name];
  if (!fields.strengthUnknown && fields.strength.trim()) {
    const strength = fields.strength.trim().replace(/\s+/g, " ").slice(0, 100);
    parts.push(strength);
  }
  if (fields.formulation && fields.formulation !== "other") {
    parts.push(fields.formulation);
  }
  return parts.join(" ").slice(0, 180);
}

export function hashQuery(queryText: string): string {
  // Deterministic non-crypto fingerprint for cache keys (terminology only).
  let h = 2166136261;
  const normalized = normalizeTerm(queryText);
  for (let i = 0; i < normalized.length; i++) {
    h ^= normalized.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function strengthTokens(value: string): string[] {
  return (value.toLowerCase().match(/\d+(?:\.\d+)?\s*(?:mg|mcg|g|iu|%)/g) || []).map((t) =>
    t.replace(/\s+/g, ""),
  );
}

function conceptMatchesStrength(conceptName: string, strength: string, strengthUnknown: boolean): boolean {
  if (strengthUnknown || !strength.trim()) return true;
  const wanted = strengthTokens(strength);
  if (!wanted.length) return true;
  const have = strengthTokens(conceptName);
  return wanted.every((w) => have.includes(w));
}

function conceptMatchesFormulation(conceptName: string, formulation: MedicationFields["formulation"]): boolean {
  const hints = FORMULATION_HINTS[formulation] || [];
  if (!hints.length) return true;
  const n = normalizeTerm(conceptName);
  if (formulation === "tablet" && /\bextended release\b|\ber\b/.test(n) && !hints.includes("extended")) {
    // Still a tablet dosage form — allow; release is compared separately for duplicates.
  }
  return hints.some((h) => n.includes(h));
}

function parseRelease(name: string): string {
  const n = normalizeTerm(name);
  if (/\b24 hr\b/.test(n) || /\bextended release\b/.test(n) || /\ber\b/.test(n)) {
    if (/\b24 hr\b/.test(n)) return "24 HR Extended Release";
    return "Extended Release";
  }
  return "";
}

function parseDosageForm(name: string): string {
  const match = name.match(
    /\b((?:Extended Release\s+)?Oral (?:Tablet|Capsule|Solution|Suspension)|Chewable Tablet|Delayed Release Oral Tablet|Powder for Oral Suspension|Tablet for Oral Suspension|Injection|Patch|Cream|Ointment|Gel)\b/i,
  );
  return match?.[1] || "";
}

function parseStrengthParts(name: string): { value: string; unit: string } {
  const match = name.match(/(\d+(?:\.\d+)?)\s*(MG|MCG|G|IU|%)/i);
  if (!match) return { value: "", unit: "" };
  return { value: match[1], unit: match[2].toUpperCase() };
}

export function emptyTerminology(
  fields: Pick<MedicationFields, "productName" | "strength" | "formulation">,
  status: MappingStatus,
  method: MatchMethod,
  notes: string[] = [],
  queryText = "",
): NormalizedTerminology {
  return {
    originalProductName: fields.productName,
    originalStrength: fields.strength,
    originalFormulation: fields.formulation,
    queryText,
    rxCui: "",
    referenceName: "",
    tty: "",
    clinicalDrugRxCui: "",
    clinicalDrugName: "",
    ingredientRxCuis: [],
    ingredientNames: [],
    strengthValue: "",
    strengthUnit: "",
    dosageForm: "",
    releaseCharacteristic: "",
    mappingStatus: status,
    matchMethod: method,
    terminologyVersion: "",
    terminologyDate: "",
    notes,
  };
}

function fromFixture(
  fields: Pick<MedicationFields, "productName" | "strength" | "formulation">,
  concept: FixtureConcept,
  method: MatchMethod,
  queryText: string,
  status: MappingStatus = "candidate",
): NormalizedTerminology {
  return {
    originalProductName: fields.productName,
    originalStrength: fields.strength,
    originalFormulation: fields.formulation,
    queryText,
    rxCui: concept.rxCui,
    referenceName: concept.synonym || concept.name,
    tty: concept.tty,
    clinicalDrugRxCui: concept.clinicalDrugRxCui,
    clinicalDrugName: concept.clinicalDrugName,
    ingredientRxCuis: [...concept.ingredientRxCuis],
    ingredientNames: [...concept.ingredientNames],
    strengthValue: concept.strengthValue,
    strengthUnit: concept.strengthUnit,
    dosageForm: concept.dosageForm,
    releaseCharacteristic: concept.releaseCharacteristic,
    mappingStatus: status,
    matchMethod: method,
    terminologyVersion: RXNORM_FIXTURE_VERSION,
    terminologyDate: RXNORM_FIXTURE_DATE,
    notes: ["Matched against verified NLM RxNorm fixtures. Confirm against the label before relying on it."],
  };
}

/** Prefer exact fixture / known RxCUI before approximate name matching. */
export function normalizeFromFixture(
  fields: Pick<
    MedicationFields,
    "productName" | "strength" | "strengthUnknown" | "formulation" | "category" | "rxCui" | "referenceName"
  >,
  catalog: FixtureConcept[] = RXNORM_FIXTURES,
): NormalizedTerminology {
  if (fields.category === "supplement") {
    return emptyTerminology(fields, "unmatched", "none", [
      "Supplements stay label-based in the MVP. No RxNorm duplicate claim is made.",
    ]);
  }

  let queryText = "";
  try {
    queryText = buildTerminologyQuery(fields);
  } catch (e) {
    return emptyTerminology(fields, "unresolved", "none", [(e as Error).message]);
  }

  if (fields.rxCui) {
    const known = catalog.find((c) => c.rxCui === fields.rxCui) || fixtureByRxCui(fields.rxCui);
    if (known) return fromFixture(fields, known, "manual", queryText, "confirmed");
    // Unknown CUI: keep as candidate identity without inventing relationships.
    const strength = parseStrengthParts(fields.referenceName || fields.productName);
    return {
      ...emptyTerminology(fields, "candidate", "manual", [
        "Selected RxCUI is retained. Related clinical-drug mapping was not available offline.",
      ], queryText),
      rxCui: fields.rxCui,
      referenceName: fields.referenceName || fields.productName,
      strengthValue: strength.value,
      strengthUnit: strength.unit,
      dosageForm: parseDosageForm(fields.referenceName || ""),
      releaseCharacteristic: parseRelease(fields.referenceName || fields.productName),
      terminologyVersion: RXNORM_FIXTURE_VERSION,
      terminologyDate: RXNORM_FIXTURE_DATE,
    };
  }

  const needle = normalizeTerm(fields.productName);
  const wantEr = /\b(extended|succinate|er|xl|xr|24\s*hr)\b/i.test(`${fields.productName} ${fields.strength}`);
  const scored = catalog
    .map((c) => {
      const names = [c.name, c.synonym, c.brandName].filter(Boolean).map((n) => normalizeTerm(String(n)));
      const brandHit = !!c.brandName && (needle === normalizeTerm(c.brandName) || needle.includes(normalizeTerm(c.brandName)));
      const ingredientHit = c.ingredientNames.some((ing) => {
        const i = normalizeTerm(ing);
        return needle === i || needle.includes(i) || needle.split(" ").includes(i);
      });
      // Prefer salt-aware tokens when present (tartrate vs succinate).
      const saltTokens = ["tartrate", "succinate", "hct", "hydrochlorothiazide"];
      const saltMismatch = saltTokens.some(
        (tok) => needle.includes(tok) && !names.some((n) => n.includes(tok)) && !(c.synonym && normalizeTerm(c.synonym).includes(tok)),
      );
      if (saltMismatch) return null;
      const nameHit = names.some(
        (n) => n === needle || n.startsWith(needle + " ") || needle.startsWith(n) || (needle.length >= 4 && n.includes(needle)),
      );
      if (!brandHit && !ingredientHit && !nameHit) return null;
      if (!conceptMatchesStrength(c.name, fields.strength, fields.strengthUnknown)) return null;
      if (!conceptMatchesFormulation(c.name, fields.formulation)) return null;
      const isEr = !!c.releaseCharacteristic;
      if (wantEr !== isEr && /metoprolol/i.test(fields.productName)) return null;
      let score = 0;
      if (brandHit) score += 40;
      if (nameHit) score += 30;
      if (ingredientHit) score += 10;
      if (c.tty === "SCD") score += 5;
      if (c.tty === "SBD" && brandHit) score += 8;
      return { c, score };
    })
    .filter((x): x is { c: FixtureConcept; score: number } => !!x)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) {
    return emptyTerminology(fields, "unmatched", "fixture", [
      "No dependable RxNorm fixture match. Keep the label text and continue manually.",
    ], queryText);
  }

  const chosen = scored[0].c;
  return fromFixture(fields, chosen, "fixture", queryText, "candidate");
}

/** Map a getDrugs concept list into a candidate without inventing ingredient links. */
export function normalizeFromDrugGroup(
  fields: Pick<MedicationFields, "productName" | "strength" | "strengthUnknown" | "formulation" | "category">,
  data: DrugGroupResponse,
  options?: { related?: RelatedGroupResponse; version?: string; date?: string },
): NormalizedTerminology {
  let queryText = "";
  try {
    queryText = buildTerminologyQuery(fields);
  } catch (e) {
    return emptyTerminology(fields, "unresolved", "none", [(e as Error).message]);
  }

  const groups = data.drugGroup?.conceptGroup || [];
  const allowed = groups.filter((g) => ["SCD", "SBD", "GPCK", "BPCK"].includes(g.tty || ""));
  const concepts = allowed.flatMap((g) =>
    (g.conceptProperties || []).map((c) => ({
      rxcui: c.rxcui,
      name: c.name,
      synonym: c.synonym || "",
      tty: (c.tty || g.tty || "") as string,
    })),
  );

  const filtered = concepts.filter(
    (c) =>
      conceptMatchesStrength(c.name, fields.strength, fields.strengthUnknown) &&
      conceptMatchesFormulation(c.name, fields.formulation),
  );
  if (!filtered.length) {
    return emptyTerminology(fields, "unmatched", "exact", [
      "NLM returned no clinical/branded drug match for this terminology query.",
    ], queryText);
  }

  const needle = normalizeTerm(fields.productName);
  filtered.sort((a, b) => {
    const aExact = normalizeTerm(a.name).includes(needle) ? 0 : 1;
    const bExact = normalizeTerm(b.name).includes(needle) ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    const order = { SCD: 0, SBD: 1, GPCK: 2, BPCK: 3 } as Record<string, number>;
    return (order[a.tty] ?? 9) - (order[b.tty] ?? 9);
  });
  const top = filtered[0];
  const strength = parseStrengthParts(top.name);

  let clinicalDrugRxCui = top.tty === "SCD" ? top.rxcui : "";
  let clinicalDrugName = top.tty === "SCD" ? top.name : "";
  const ingredientRxCuis: string[] = [];
  const ingredientNames: string[] = [];

  const relatedGroups = options?.related?.relatedGroup?.conceptGroup || [];
  for (const g of relatedGroups) {
    for (const c of g.conceptProperties || []) {
      if (g.tty === "SCD" && !clinicalDrugRxCui) {
        clinicalDrugRxCui = c.rxcui;
        clinicalDrugName = c.name;
      }
      if (g.tty === "IN") {
        ingredientRxCuis.push(c.rxcui);
        ingredientNames.push(c.name);
      }
    }
  }

  // Enrich from fixtures when the live CUI is one we already verified.
  const fixture = fixtureByRxCui(top.rxcui) || (clinicalDrugRxCui ? fixtureByRxCui(clinicalDrugRxCui) : undefined);
  if (fixture) {
    return {
      ...fromFixture(fields, { ...fixture, rxCui: top.rxcui, name: top.name, tty: top.tty as FixtureConcept["tty"], synonym: top.synonym }, "exact", queryText, "candidate"),
      terminologyVersion: options?.version || RXNORM_FIXTURE_VERSION,
      terminologyDate: options?.date || new Date().toISOString().slice(0, 10),
      notes: ["Normalized from NLM getDrugs; relationships confirmed via verified fixture where available."],
    };
  }

  return {
    originalProductName: fields.productName,
    originalStrength: fields.strength,
    originalFormulation: fields.formulation,
    queryText,
    rxCui: top.rxcui,
    referenceName: top.synonym || top.name,
    tty: top.tty,
    clinicalDrugRxCui,
    clinicalDrugName,
    ingredientRxCuis,
    ingredientNames,
    strengthValue: strength.value,
    strengthUnit: strength.unit,
    dosageForm: parseDosageForm(top.name),
    releaseCharacteristic: parseRelease(top.name),
    mappingStatus: clinicalDrugRxCui || ingredientRxCuis.length ? "candidate" : "candidate",
    matchMethod: "exact",
    terminologyVersion: options?.version || "",
    terminologyDate: options?.date || new Date().toISOString().slice(0, 10),
    notes: [
      filtered.length > 1
        ? `NLM returned ${filtered.length} candidates; the top match is proposed for review, not auto-selected as clinical truth.`
        : "NLM returned a terminology candidate. Confirm it against the label.",
    ],
  };
}

export type ListMedForDuplicates = {
  id: string;
  productName: string;
  strength: string;
  formulation: string;
  frequency?: string;
  terminology: Pick<
    NormalizedTerminology,
    | "clinicalDrugRxCui"
    | "clinicalDrugName"
    | "ingredientRxCuis"
    | "ingredientNames"
    | "strengthValue"
    | "strengthUnit"
    | "dosageForm"
    | "releaseCharacteristic"
    | "mappingStatus"
    | "rxCui"
    | "referenceName"
    | "tty"
  > | null;
};

function orderedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function sameIngredients(a: string[], b: string[]): boolean {
  if (a.length !== b.length || !a.length) return false;
  const sa = [...a].sort().join(",");
  const sb = [...b].sort().join(",");
  return sa === sb;
}

function overlapIngredients(a: string[], b: string[]): string[] {
  const setB = new Set(b);
  return a.filter((x) => setB.has(x));
}

/**
 * Propose explainable duplicate / review flags only.
 * Different strengths, formulations, release characteristics, or schedules stay distinct.
 * Never merges or removes records.
 */
export function findDuplicateFlags(meds: ListMedForDuplicates[]): DuplicateCandidate[] {
  const flags: DuplicateCandidate[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < meds.length; i++) {
    for (let j = i + 1; j < meds.length; j++) {
      const left = meds[i];
      const right = meds[j];
      const tA = left.terminology;
      const tB = right.terminology;
      if (!tA || !tB) continue;
      if (tA.mappingStatus === "unmatched" || tB.mappingStatus === "unmatched") continue;
      if (tA.mappingStatus === "unavailable" || tB.mappingStatus === "unavailable") continue;
      if (tA.mappingStatus === "unresolved" || tB.mappingStatus === "unresolved") continue;

      const [idA, idB] = orderedPair(left.id, right.id);
      const pairKey = `${idA}|${idB}`;

      const push = (flagType: DuplicateFlagType, explanation: string, evidence: Record<string, unknown>) => {
        const key = `${pairKey}|${flagType}`;
        if (seen.has(key)) return;
        seen.add(key);
        flags.push({ medicationAId: idA, medicationBId: idB, flagType, explanation, evidence });
      };

      if (tA.clinicalDrugRxCui && tB.clinicalDrugRxCui && tA.clinicalDrugRxCui === tB.clinicalDrugRxCui) {
        const brandGeneric =
          (tA.tty === "SBD" && tB.tty === "SCD") ||
          (tB.tty === "SBD" && tA.tty === "SCD") ||
          (normalizeTerm(left.productName) !== normalizeTerm(right.productName) &&
            normalizeTerm(tA.clinicalDrugName) === normalizeTerm(tB.clinicalDrugName));
        push(
          "possible_duplicate",
          brandGeneric
            ? `Brand and generic map to the same clinical product (${tA.clinicalDrugName}). Compare both sources; do not auto-merge.`
            : `Same clinical product (${tA.clinicalDrugName}) appears more than once. Compare evidence and instructions.`,
          {
            clinicalDrugRxCui: tA.clinicalDrugRxCui,
            clinicalDrugName: tA.clinicalDrugName,
            left: { id: left.id, productName: left.productName, strength: left.strength, rxCui: tA.rxCui, tty: tA.tty },
            right: { id: right.id, productName: right.productName, strength: right.strength, rxCui: tB.rxCui, tty: tB.tty },
            brandGeneric,
          },
        );
        continue;
      }

      const ingsA = tA.ingredientRxCuis || [];
      const ingsB = tB.ingredientRxCuis || [];
      if (!ingsA.length || !ingsB.length) continue;

      if (sameIngredients(ingsA, ingsB)) {
        const strengthDiff =
          `${tA.strengthValue}${tA.strengthUnit}`.toLowerCase() !==
          `${tB.strengthValue}${tB.strengthUnit}`.toLowerCase();
        const releaseDiff =
          normalizeTerm(tA.releaseCharacteristic || "") !== normalizeTerm(tB.releaseCharacteristic || "") ||
          normalizeTerm(tA.dosageForm || "") !== normalizeTerm(tB.dosageForm || "");
        const scheduleDiff =
          !!left.frequency &&
          !!right.frequency &&
          left.frequency !== "unknown" &&
          right.frequency !== "unknown" &&
          left.frequency !== right.frequency;

        if (releaseDiff) {
          push(
            "different_formulation_release",
            `Same ingredient (${tA.ingredientNames.join(", ") || "shared"}) with different formulation or release ` +
              `(${tA.dosageForm || left.formulation}${tA.releaseCharacteristic ? ` · ${tA.releaseCharacteristic}` : ""}` +
              ` vs ${tB.dosageForm || right.formulation}${tB.releaseCharacteristic ? ` · ${tB.releaseCharacteristic}` : ""}). May be intentional — do not combine.`,
            {
              ingredients: tA.ingredientNames,
              ingredientRxCuis: ingsA,
              left: { id: left.id, productName: left.productName, form: tA.dosageForm, release: tA.releaseCharacteristic },
              right: { id: right.id, productName: right.productName, form: tB.dosageForm, release: tB.releaseCharacteristic },
            },
          );
        } else if (strengthDiff || scheduleDiff) {
          push(
            "different_strength_or_schedule",
            `Same ingredient (${tA.ingredientNames.join(", ")}) with different strength or schedule ` +
              `(${left.strength || tA.strengthValue + " " + tA.strengthUnit} · ${left.frequency || "schedule not entered"}` +
              ` vs ${right.strength || tB.strengthValue + " " + tB.strengthUnit} · ${right.frequency || "schedule not entered"}). May be an intentional regimen.`,
            {
              ingredients: tA.ingredientNames,
              ingredientRxCuis: ingsA,
              left: { id: left.id, productName: left.productName, strength: left.strength, frequency: left.frequency },
              right: { id: right.id, productName: right.productName, strength: right.strength, frequency: right.frequency },
            },
          );
        }
        continue;
      }

      const overlap = overlapIngredients(ingsA, ingsB);
      if (overlap.length && (ingsA.length > 1 || ingsB.length > 1)) {
        const names = [
          ...new Set([
            ...tA.ingredientNames.filter((_, idx) => overlap.includes(ingsA[idx])),
            ...tB.ingredientNames.filter((_, idx) => overlap.includes(ingsB[idx])),
          ]),
        ];
        push(
          "ingredient_overlap",
          `Ingredient overlap (${names.join(", ") || overlap.join(", ")}) between a single-ingredient product and a combination product. Staff review only — not an instruction to stop or merge.`,
          {
            overlapRxCuis: overlap,
            overlapNames: names,
            left: { id: left.id, productName: left.productName, ingredients: tA.ingredientNames },
            right: { id: right.id, productName: right.productName, ingredients: tB.ingredientNames },
          },
        );
      }
    }
  }

  return flags;
}

export function parseDuplicateResponse(value: unknown): Exclude<DuplicateResponse, "open"> {
  if (value === "take_both" || value === "added_twice" || value === "unsure" || value === "staff_dismissed") {
    return value;
  }
  throw new RxNormError("Choose I take both, I added one twice, I'm not sure, or dismiss for staff review.");
}

export function duplicateFlagLabel(type: DuplicateFlagType): string {
  switch (type) {
    case "possible_duplicate":
      return "Possible duplicate";
    case "different_strength_or_schedule":
      return "Different strength or schedule";
    case "different_formulation_release":
      return "Different formulation or release";
    case "ingredient_overlap":
      return "Ingredient overlap";
  }
}

export function patientDuplicatePrompt(): string {
  return "Looks similar to another medicine on your list.";
}

/** Manual outage path: keep originals, mark unavailable, never invent identity. */
export function terminologyForOutage(
  fields: Pick<MedicationFields, "productName" | "strength" | "formulation">,
  queryText = "",
): NormalizedTerminology {
  return emptyTerminology(
    fields,
    "unavailable",
    "none",
    [
      "The NLM medication reference is unavailable. Your entered name and strength are kept. Continue manually — no identity was guessed.",
    ],
    queryText,
  );
}

export function applyTerminologyToFields(
  fields: MedicationFields,
  terminology: NormalizedTerminology,
): MedicationFields {
  if (!terminology.rxCui) return fields;
  if (terminology.mappingStatus === "unavailable" || terminology.mappingStatus === "unmatched") return fields;
  return {
    ...fields,
    rxCui: terminology.rxCui,
    referenceName: terminology.referenceName || fields.referenceName,
    // Preserve patient/source product name as entered.
    productName: fields.productName,
    strength: fields.strength,
  };
}

export { RXNORM_FIXTURES, RXNORM_FIXTURE_VERSION, RXNORM_FIXTURE_DATE, fixtureByRxCui };
