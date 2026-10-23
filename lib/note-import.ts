import { emptyMedication, parseLabel, type MedicationFields } from "./medication.ts";

export type NoteCandidate = { key: string; fields: MedicationFields; warnings: string[] };
export const noteMedicationKey = (m: Pick<MedicationFields,"productName"|"strength">) => `${m.productName.toLowerCase().replace(/\s+/g," ").trim()}|${m.strength.toLowerCase().replace(/\s+/g," ").trim()}`;
const strengthPattern = /\b\d+(?:\.\d+)?(?:\s*[-/]\s*\d+(?:\.\d+)?)*\s*(?:mcg|mg|g|IU|units?|%)(?:\s*\/\s*(?:\d+(?:\.\d+)?\s*)?mL)?\b/i;

/** Conservative proposals from an explicitly selected medication section, never a full-note NLP claim. */
export function parseMedicationSection(raw: string, sourceDocument: string, sourceDate: string): NoteCandidate[] {
  if (raw.length > 24000) throw new Error("Copy only the medication section, up to 24,000 characters.");
  const lines = raw.replace(/\r/g,"").split("\n").map(l=>l.trim()).filter(l=>l && !/^(?:current\s+)?(?:medications?|medicine list|medication list|active medications?)\s*:?$/i.test(l));
  if (!lines.length) throw new Error("Paste one medication per line from the medication section.");
  if (lines.length > 40) throw new Error("Review up to 40 lines at a time. Copy only the medication section.");
  const seen = new Set<string>();
  return lines.map((original, index) => {
    if (original.length > 1600) throw new Error("A line is too long. Put each medication on its own line.");
    const line = original.replace(/^(?:[-*•]\s*|\d+[.)]\s+)/, "");
    const fields = emptyMedication(); const warnings:string[]=[];
    fields.formulation="other"; fields.doseUnit="other";
    fields.source="note"; fields.sourceDocument=sourceDocument.trim(); fields.sourceDate=sourceDate;
    fields.sourceText=original; fields.status="unsure"; fields.actualUseUnknown=true;
    const match = strengthPattern.exec(line);
    if (match && match.index > 0) {
      fields.productName=line.slice(0,match.index).replace(/[\s,;:-]+$/g,"").trim().slice(0,180);
      fields.strength=match[0];
    } else {
      fields.productName=line.slice(0,180); warnings.push("Name or strength needs checking. This may not be a medication line.");
    }
    if (line.length > 180 && !match) warnings.push("The proposed name was shortened; compare the complete source line.");
    if (/\b(?:tablets?|tabs?)\b/i.test(line)) {fields.formulation="tablet";fields.doseUnit="tablets";}
    else if (/\b(?:capsule|capsules|caps)\b/i.test(line)) {fields.formulation="capsule";fields.doseUnit="capsules";}
    else if (/\b(?:inhale|inhaler|puffs?)\b/i.test(line)) {fields.formulation="inhaler";fields.doseUnit="puffs";}
    else if (/\b(?:injection|inject)\b/i.test(line)) {fields.formulation="injection";fields.doseUnit="units";}
    else if (/\b(?:cream|ointment|topical)\b/i.test(line)) {fields.formulation="topical";fields.doseUnit="applications";}
    else if (/\bpatch(?:es)?\b/i.test(line)) {fields.formulation="patch";fields.doseUnit="patches";}
    else if (/\b(?:eye drops?|ear drops?|ophthalmic|instill)\b/i.test(line)) {fields.formulation="drops";fields.doseUnit="drops";}
    else if (/\b(?:oral solution|oral suspension|by mouth.*mL)\b/i.test(line)) {fields.formulation="liquid";fields.doseUnit="mL";}
    if (/\b(?:by mouth|orally|PO)\b/i.test(line)) fields.route="By mouth";
    if (/\b(?:supplement|vitamin|fish oil|magnesium|creatine|multivitamin)\b/i.test(line)) {
      fields.category="supplement"; warnings.push("Check the exact product and ingredient panel; category is only a proposal.");
    }
    if (/\b(?:discontinued|stopped|hold|held|not taking|no longer|never started|does not take|do not take|taper|then|alternating|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i.test(line)) warnings.push("Historical status or variable instructions: do not assume current use.");
    if (line.match(strengthPattern) && (line.match(/\b(?:mcg|mg|g|IU|units?)\b/gi)||[]).length > 1) warnings.push("Multiple quantities or ingredients: check the complete strength and formulation.");
    if (/\d\s*[-/]\s*\d/.test(fields.strength)) warnings.push("Combination or ratio strength: preserve the full expression and verify the components.");
    const key=noteMedicationKey(fields);if(seen.has(key))warnings.push("Duplicate proposed name and strength in this import.");seen.add(key);
    return {key:`line-${index}`,fields,warnings};
  });
}

/** Propose only explicitly stated quantity and unit; a product strength never implies one tablet. */
export function historicalUseProposal(fields: MedicationFields): MedicationFields {
  if(fields.source!=="note" || !fields.sourceText || fields.status!=="unsure") return {...fields};
  const line=fields.sourceText;
  const dose=line.match(/\b(?:take|give|use|inject|inhale|apply|instill)\b.*$/i)
    || line.match(/\b(?:\d+(?:\.\d+)?|\d+\s*\/\s*\d+|half|one-half|one|two)\s+(?:tablets?|tabs?|capsules?|caps?|mL|puffs?|units?|patches?|drops?|scoops?)\b(?!\s*\/).*$/i);
  if(!dose || /\b(?:discontinued|stopped|held|hold|not taking|no longer|never started|does not take|do not take)\b/i.test(line)) return {...fields};
  let directions=dose[0];if(!/^(?:take|give|use|inject|inhale|apply|instill)\b/i.test(directions))directions=`Take ${directions}`;
  const parsed=parseLabel(`${fields.productName} ${fields.strength}\n${directions}`).fields;
  if(!parsed.actualDose || parsed.frequency==="unknown" || parsed.frequency==="custom" || parsed.frequency==="prn")return {...fields};
  return {...fields,actualDose:parsed.actualDose,formulation:fields.formulation==="other"?parsed.formulation:fields.formulation,doseUnit:fields.doseUnit==="other"?parsed.doseUnit:fields.doseUnit,frequency:parsed.frequency,timing:parsed.timing,status:"taking",actualUseUnknown:false};
}
