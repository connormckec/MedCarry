export class MedicationValidationError extends Error {}
export const formulations = ["tablet", "capsule", "liquid", "inhaler", "injection", "topical", "patch", "drops", "powder", "other"] as const;
export const frequencies = { daily: "Once daily", twice: "Twice daily", three: "Three times daily", four: "Four times daily", weekly: "Once weekly", alternate: "Every other day", prn: "As needed", custom: "Other / variable schedule", unknown: "Not sure" };
export const units = ["tablets", "capsules", "mL", "puffs", "units", "patches", "drops", "scoops", "applications", "other"] as const;
export type MedicationFields = {
  productName: string; category: "prescription" | "otc" | "supplement"; strength: string; strengthUnknown: boolean;
  formulation: typeof formulations[number]; route: string; labelDirections: string;
  actualDose: string; doseUnit: typeof units[number]; frequency: keyof typeof frequencies; timing: string;
  actualInstructions: string; actualUseUnknown: boolean; status: "taking" | "held" | "stopped" | "unsure";
  supplementFacts: string; uncertaintyNote: string; adherenceReportedAt: string; adherence: "not_reported" | "none_reported" | "some_missed" | "unsure";
  rxCui: string; referenceName: string; source: "manual" | "photo" | "demo" | "note";
  sourceDocument: string; sourceDate: string; sourceText: string;
};
export type Medication = MedicationFields & { id: string; profileId: string; sourceIds: string[]; revision: number; confirmedRevision: number | null; confirmedAt: string | null; createdAt: string; updatedAt: string; };
export type Profile = { id: string; name: string; created_at?: string };
export type Snapshot = { id: string; recipient: string; patientName: string; createdAt: string; medications: Medication[]; };
export const emptyMedication = (): MedicationFields => ({ productName: "", category: "prescription", strength: "", strengthUnknown: false, formulation: "tablet", route: "", labelDirections: "", actualDose: "", doseUnit: "tablets", frequency: "unknown", timing: "", actualInstructions: "", actualUseUnknown: false, status: "taking", supplementFacts: "", uncertaintyNote: "", adherenceReportedAt: "", adherence: "not_reported", rxCui: "", referenceName: "", source: "manual", sourceDocument: "", sourceDate: "", sourceText: "" });

export function quantity(value: string): number | null {
  const fractions: Record<string,number> = {"½":0.5,"¼":0.25,"¾":0.75};
  const mixed = value.trim().match(/^(\d+)\s*([½¼¾])$/);
  if (mixed) {const n=Number(mixed[1])+fractions[mixed[2]];return n>0&&n<=20000?n:null;}
  const v = value.trim().replace("½", "0.5").replace("¼", "0.25").replace("¾", "0.75");
  if (/^\d+\s+\d+\/\d+$/.test(v)) { const [whole, frac] = v.split(/\s+/); const part = quantity(frac); return part === null || Number(whole)+part>20000 ? null : Number(whole) + part; }
  if (/^\d+\s*\/\s*\d+$/.test(v)) { const [n, d] = v.split("/").map(Number); return d > 0 && n / d > 0 && n / d <= 20000 ? n / d : null; }
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(v)) return null;
  const n = Number(v); return Number.isFinite(n) && n > 0 && n <= 20000 ? n : null;
}

export function validateFields(input: unknown, confirming = false): MedicationFields {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new MedicationValidationError("Medication details are required.");
  const x = input as Record<string, unknown>; const clean = emptyMedication();
  const limits: Record<string, number> = { productName: 180, strength: 100, route: 80, labelDirections: 1600, actualDose: 40, timing: 300, actualInstructions: 1600, supplementFacts: 2500, uncertaintyNote: 800, adherenceReportedAt: 40, rxCui: 20, referenceName: 300, sourceDocument: 120, sourceDate: 10, sourceText: 1600 };
  for (const [key, limit] of Object.entries(limits)) {
    if (x[key] !== undefined && typeof x[key] !== "string") throw new MedicationValidationError(`Invalid ${key}.`);
    const value = ((x[key] as string) || "").trim(); if (value.length > limit) throw new MedicationValidationError(`${key} is too long.`);
    (clean as unknown as Record<string, unknown>)[key] = value;
  }
  const enums: Record<string, readonly string[]> = { category: ["prescription", "otc", "supplement"], formulation: formulations, doseUnit: units, frequency: Object.keys(frequencies), status: ["taking", "held", "stopped", "unsure"], adherence: ["not_reported", "none_reported", "some_missed", "unsure"], source: ["manual", "photo", "demo", "note"] };
  for (const [key, values] of Object.entries(enums)) {
    if (x[key] !== undefined && !values.includes(x[key] as string)) throw new MedicationValidationError(`Invalid ${key}.`);
    if (x[key] !== undefined) (clean as unknown as Record<string, unknown>)[key] = x[key];
  }
  for (const key of ["strengthUnknown", "actualUseUnknown"] as const) {
    if (x[key] !== undefined && typeof x[key] !== "boolean") throw new MedicationValidationError(`Invalid ${key}.`);
    clean[key] = x[key] === true;
  }
  if (clean.rxCui && !/^\d{1,20}$/.test(clean.rxCui)) throw new MedicationValidationError("Invalid medication reference.");
  if (clean.sourceDate && (!/^\d{4}-\d{2}-\d{2}$/.test(clean.sourceDate) || !Number.isFinite(Date.parse(clean.sourceDate)) || new Date(clean.sourceDate).toISOString().slice(0,10)!==clean.sourceDate)) throw new MedicationValidationError("Use a valid source date, or leave it unknown.");
  if (clean.actualDose && quantity(clean.actualDose) === null) throw new MedicationValidationError("Use a positive amount such as 1, 0.5, or 1/2. For a variable dose, use the other / variable schedule option and describe it.");
  if (confirming) {
    if (!clean.productName) throw new MedicationValidationError("Enter the medication or product name before confirming.");
    if (!clean.strength && !clean.strengthUnknown) throw new MedicationValidationError("Enter the strength, or mark it as not known.");
    if (clean.status === "taking" && !clean.actualUseUnknown) {
      if (clean.frequency === "unknown") throw new MedicationValidationError("Choose how often you take it, or mark your current use as uncertain.");
      if (clean.frequency === "custom") { if (!clean.actualInstructions) throw new MedicationValidationError("Describe your variable schedule before confirming."); }
      else if (!clean.actualDose) throw new MedicationValidationError("Enter how much you take each time, or mark your current use as uncertain.");
      if (clean.doseUnit === "other" && !clean.actualInstructions) throw new MedicationValidationError("Describe the amount and unit in your instructions.");
    }
  }
  return clean;
}

export function isConfirmed(m: Pick<Medication, "revision" | "confirmedRevision" | "confirmedAt">) { return m.confirmedRevision === m.revision && !!m.confirmedAt; }
export function canCreateCard(meds: Pick<Medication, "revision" | "confirmedRevision" | "confirmedAt">[]) { return meds.length > 0 && meds.every(isConfirmed); }
export function useSummary(m: MedicationFields): string {
  if (m.status === "stopped") return "Patient reports no longer taking";
  if (m.status === "held") return "Patient reports currently on hold";
  if (m.status === "unsure" || m.actualUseUnknown) return "Current use uncertain · clinic review needed";
  if (m.frequency === "custom") return m.actualInstructions || "Variable schedule";
  if (!m.actualDose) return "Current amount not entered";
  const n = quantity(m.actualDose); const unit = n === 1 || n === 0.5 ? ({tablets:"tablet",capsules:"capsule",puffs:"puff",patches:"patch",drops:"drop",scoops:"scoop",applications:"application",units:"unit",mL:"mL",other:""}[m.doseUnit]) : m.doseUnit;
  return `${m.actualDose} ${unit} · ${frequencies[m.frequency].toLowerCase()}${m.timing ? ` · ${m.timing}` : ""}`;
}
export function reportedAmount(m: MedicationFields): string | null {
  if (m.actualUseUnknown || m.status !== "taking" || m.frequency === "custom") return null;
  const n = quantity(m.actualDose); if (n === null) return null;
  const s = m.strength.trim();
  if ((m.formulation === "tablet" && m.doseUnit === "tablets") || (m.formulation === "capsule" && m.doseUnit === "capsules")) {
    const match = s.match(/^(\d+(?:\.\d+)?)\s*(mg|mcg|g|IU)\s*(?:per\s+(?:tablet|capsule))?$/i);
    if (match) return `${Number((Number(match[1]) * n).toFixed(6))} ${match[2]} per reported dose`;
  }
  if (m.formulation === "liquid" && m.doseUnit === "mL") {
    const match = s.match(/^(\d+(?:\.\d+)?)\s*(mg|mcg|g)\s*\/\s*(\d+(?:\.\d+)?)?\s*mL$/i);
    if (match && Number(match[3] || 1) > 0) return `${Number((Number(match[1]) / Number(match[3] || 1) * n).toFixed(6))} ${match[2]} per reported dose`;
  }
  return null;
}

export function parseLabel(raw: string): { fields: MedicationFields; notices: string[] } {
  const text = raw.slice(0,12000).replace(/\r/g, ""); const lines = text.split("\n").map(l=>l.trim()).filter(Boolean);
  const fields = emptyMedication(); fields.source = "photo"; const notices: string[] = [];
  const strengthPattern = /\b\d+(?:\.\d+)?\s*(?:mcg|mg|grams?|g|IU|units?|%)(?:\s*\/\s*(?:\d+(?:\.\d+)?\s*)?(?:mL|tablet|capsule))?\b/i;
  const isInstruction = (l: string) => /^(?:directions\s*:?\s*)?(?:take|give|use|inject|inhale|apply|instill|chew|dissolve)\b/i.test(l);
  const candidate = lines.find(l => strengthPattern.test(l) && !isInstruction(l) && !/^(?:each|dose|serving|amount|contains|per\b|active ingredient|supplement facts)/i.test(l));
  if (candidate) {
    fields.strength = candidate.match(strengthPattern)?.[0] || "";
    fields.productName = candidate.replace(strengthPattern, "").replace(/\b(?:tablets?|tabs?|capsules?|caps?|oral|USP|qty\s*:?\s*\d+)\b/gi, "").replace(/^[\s:.,-]+|[\s:.,-]+$/g, "").replace(/\s+/g, " ").slice(0,180);
  } else notices.push("The product name or strength could not be read. Enter them from the label.");
  const i = lines.findIndex(isInstruction);
  if (i >= 0) {
    fields.labelDirections = lines.slice(i,i+3).filter((l,n)=>n===0 || !/^(?:refill|prescriber|pharmac|rx\s*#|discard|expir|quantity|qty|\d{3}[- .]\d{3})/i.test(l)).join(" ").slice(0,1600);
  }
  const combined = `${candidate || ""} ${fields.labelDirections}`;
  if (/\b(?:inhale|inhaler|puffs?)\b/i.test(combined)) { fields.formulation="inhaler";fields.doseUnit="puffs"; }
  else if (/\b(?:inject|injection)\b/i.test(combined)) { fields.formulation="injection";fields.doseUnit="units"; }
  else if (/\b(?:apply|cream|ointment|gel)\b/i.test(combined)) { fields.formulation="topical";fields.doseUnit="applications"; }
  else if (/\b(?:patch)\b/i.test(combined)) { fields.formulation="patch";fields.doseUnit="patches"; }
  else if (/\b(?:drops?|instill)\b/i.test(combined)) { fields.formulation="drops";fields.doseUnit="drops"; }
  else if (/\b(?:mL|solution|suspension)\b/i.test(combined)) { fields.formulation="liquid";fields.doseUnit="mL"; }
  else if (/\b(?:capsules?|caps?)\b/i.test(combined)) { fields.formulation="capsule";fields.doseUnit="capsules"; }
  if (/\b(?:by mouth|orally)\b/i.test(fields.labelDirections)) fields.route="By mouth";
  const directions=fields.labelDirections.toLowerCase();
  const amount = directions.match(/\b(?:take|give|use|inject|inhale|apply|instill|chew|dissolve)\s+(one-half|one half|half|one|two|three|four|\d+\s*\/\s*\d+|\d+(?:\.\d+)?)\s*(?:tablets?|tabs?|capsules?|caps?|m[l1]|puffs?|units?|patch(?:es)?|drops?|scoops?)\b/);
  if (amount) { const words: Record<string,string>={"one-half":"0.5","one half":"0.5",half:"0.5",one:"1",two:"2",three:"3",four:"4"}; fields.actualDose=words[amount[1]] || amount[1].replace(/\s/g,""); }
  if (/\b(?:as needed|when needed|prn)\b/.test(directions)) fields.frequency="prn";
  else if (/\b(?:every other day|alternate days)\b/.test(directions)) fields.frequency="alternate";
  else if (/\b(?:once (?:a )?week|weekly|every week)\b/.test(directions)) fields.frequency="weekly";
  else if (/\b(?:four times|4 times|qid)\b/.test(directions)) fields.frequency="four";
  else if (/\b(?:three times|3 times|tid)\b/.test(directions)) fields.frequency="three";
  else if (/\b(?:twice|two times|2 times|bid)\b/.test(directions)) fields.frequency="twice";
  else if (/\b(?:daily|every day|once a day|once per day|qd)\b/.test(directions)) fields.frequency="daily";
  const complex = /\b(?:then|taper|except|alternat(?:e|ing) doses?|for \d+ days?|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(directions) || (!/as needed|prn/.test(directions) && /every\s+\d+\s+hours?/.test(directions));
  if (complex) { fields.frequency="custom";fields.actualDose="";notices.push("This schedule needs a manual check. Preserve the full instructions, including dates or different doses."); }
  fields.actualInstructions=complex?fields.labelDirections:"";
  fields.timing = ["morning", "evening", "bedtime", "with food", "with meals", "before meals", "on an empty stomach"].filter(s=>directions.includes(s)).join(", ");
  if (/supplement facts/i.test(text)) { fields.category="supplement";fields.supplementFacts=text.slice(text.toLowerCase().indexOf("supplement facts"),text.toLowerCase().indexOf("supplement facts")+2500); fields.rxCui="";notices.push("Check the serving size and ingredient panel. Suggested label use is not evidence of your actual use."); }
  if (!fields.labelDirections) notices.push("Directions were not readable. Enter your current use, or explicitly mark it as uncertain.");
  if (!fields.actualDose && !complex) notices.push("The amount per dose needs your review.");
  if (lines.filter(l=>strengthPattern.test(l)&&!isInstruction(l)).length>2) notices.push("Check that these photos show one product. Separate medications need separate entries.");
  return { fields, notices };
}

export function snapshotText(card: Snapshot): string {
  return [`MEDICATION LIST — ${card.patientName}`,`Prepared for: ${card.recipient}`,`Patient-confirmed snapshot: ${new Date(card.createdAt).toLocaleString()}`,"For clinician reconciliation; not a prescription.","",...card.medications.flatMap((m,i)=>[`${i+1}. ${m.productName} — ${m.strengthUnknown?"Strength not known":m.strength}`,`Reported use: ${useSummary(m)}`,m.sourceDocument?`Historical source: ${m.sourceDocument} · ${m.sourceDate||"date unknown"}`:"",m.sourceText?`Original historical entry (not current instructions): ${m.sourceText}`:"",`Label directions: ${m.labelDirections||"Not recorded"}`,m.actualInstructions?`Additional reported instructions: ${m.actualInstructions}`:"",m.uncertaintyNote?`Uncertainty: ${m.uncertaintyNote}`:"",m.supplementFacts?`Supplement label: ${m.supplementFacts}`:"",`Missed doses (self-reported${m.adherenceReportedAt ? `; 7 days before ${new Date(m.adherenceReportedAt).toLocaleDateString()}` : ""}): ${m.adherence.replaceAll("_"," ")}`,`Confirmed: ${m.confirmedAt}`,""] .filter(Boolean))].join("\n");
}
