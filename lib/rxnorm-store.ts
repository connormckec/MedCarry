/**
 * Persist RxNorm terminology and explainable duplicate flags (additive; never merges meds).
 */

import type { MedicationFields } from "./medication.ts";
import {
  applyTerminologyToFields,
  findDuplicateFlags,
  normalizeFromFixture,
  terminologyForOutage,
  type DuplicateCandidate,
  type NormalizedTerminology,
} from "./rxnorm.ts";

export type TerminologyRow = {
  id: string;
  owner_id: string;
  profile_id: string;
  medication_id: string;
  original_product_name: string;
  original_strength: string;
  original_formulation: string;
  query_text: string;
  rx_cui: string;
  reference_name: string;
  tty: string;
  clinical_drug_rx_cui: string;
  clinical_drug_name: string;
  ingredient_rx_cuis: string;
  ingredient_names: string;
  strength_value: string;
  strength_unit: string;
  dosage_form: string;
  release_characteristic: string;
  mapping_status: string;
  match_method: string;
  terminology_version: string;
  terminology_date: string;
  notes_json: string;
  reviewer_principal_id: string | null;
  created_at: string;
  updated_at: string;
};

export type DuplicateFlagRow = {
  id: string;
  owner_id: string;
  profile_id: string;
  medication_a_id: string;
  medication_b_id: string;
  flag_type: string;
  explanation: string;
  evidence_json: string;
  status: string;
  respondent_principal_id: string | null;
  responded_at: string | null;
  created_at: string;
  updated_at: string;
};

export function terminologyFromRow(row: TerminologyRow): NormalizedTerminology & { medicationId: string; id: string } {
  return {
    id: row.id,
    medicationId: row.medication_id,
    originalProductName: row.original_product_name,
    originalStrength: row.original_strength,
    originalFormulation: row.original_formulation,
    queryText: row.query_text,
    rxCui: row.rx_cui,
    referenceName: row.reference_name,
    tty: row.tty,
    clinicalDrugRxCui: row.clinical_drug_rx_cui,
    clinicalDrugName: row.clinical_drug_name,
    ingredientRxCuis: JSON.parse(row.ingredient_rx_cuis) as string[],
    ingredientNames: JSON.parse(row.ingredient_names) as string[],
    strengthValue: row.strength_value,
    strengthUnit: row.strength_unit,
    dosageForm: row.dosage_form,
    releaseCharacteristic: row.release_characteristic,
    mappingStatus: row.mapping_status as NormalizedTerminology["mappingStatus"],
    matchMethod: row.match_method as NormalizedTerminology["matchMethod"],
    terminologyVersion: row.terminology_version,
    terminologyDate: row.terminology_date,
    notes: JSON.parse(row.notes_json) as string[],
  };
}

export function duplicateFlagFromRow(row: DuplicateFlagRow) {
  return {
    id: row.id,
    profileId: row.profile_id,
    medicationAId: row.medication_a_id,
    medicationBId: row.medication_b_id,
    flagType: row.flag_type,
    explanation: row.explanation,
    evidence: JSON.parse(row.evidence_json) as Record<string, unknown>,
    status: row.status,
    respondentPrincipalId: row.respondent_principal_id,
    respondedAt: row.responded_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function upsertTerminology(
  db: D1Database,
  args: {
    ownerId: string;
    profileId: string;
    medicationId: string;
    terminology: NormalizedTerminology;
    reviewerPrincipalId?: string | null;
  },
): Promise<NormalizedTerminology & { medicationId: string; id: string }> {
  const now = new Date().toISOString();
  const existing = await db
    .prepare("SELECT id, created_at FROM medication_terminology WHERE medication_id=?")
    .bind(args.medicationId)
    .first<{ id: string; created_at: string }>();
  const id = existing?.id || crypto.randomUUID();
  const createdAt = existing?.created_at || now;
  const t = args.terminology;
  const values = [
    id,
    args.ownerId,
    args.profileId,
    args.medicationId,
    t.originalProductName,
    t.originalStrength,
    t.originalFormulation,
    t.queryText,
    t.rxCui,
    t.referenceName,
    t.tty,
    t.clinicalDrugRxCui,
    t.clinicalDrugName,
    JSON.stringify(t.ingredientRxCuis),
    JSON.stringify(t.ingredientNames),
    t.strengthValue,
    t.strengthUnit,
    t.dosageForm,
    t.releaseCharacteristic,
    t.mappingStatus,
    t.matchMethod,
    t.terminologyVersion,
    t.terminologyDate,
    JSON.stringify(t.notes),
    args.reviewerPrincipalId ?? null,
    createdAt,
    now,
  ];
  if (existing) {
    await db
      .prepare(
        `UPDATE medication_terminology SET owner_id=?, profile_id=?, original_product_name=?, original_strength=?, original_formulation=?,
         query_text=?, rx_cui=?, reference_name=?, tty=?, clinical_drug_rx_cui=?, clinical_drug_name=?, ingredient_rx_cuis=?, ingredient_names=?,
         strength_value=?, strength_unit=?, dosage_form=?, release_characteristic=?, mapping_status=?, match_method=?, terminology_version=?,
         terminology_date=?, notes_json=?, reviewer_principal_id=?, updated_at=? WHERE id=?`,
      )
      .bind(
        args.ownerId,
        args.profileId,
        t.originalProductName,
        t.originalStrength,
        t.originalFormulation,
        t.queryText,
        t.rxCui,
        t.referenceName,
        t.tty,
        t.clinicalDrugRxCui,
        t.clinicalDrugName,
        JSON.stringify(t.ingredientRxCuis),
        JSON.stringify(t.ingredientNames),
        t.strengthValue,
        t.strengthUnit,
        t.dosageForm,
        t.releaseCharacteristic,
        t.mappingStatus,
        t.matchMethod,
        t.terminologyVersion,
        t.terminologyDate,
        JSON.stringify(t.notes),
        args.reviewerPrincipalId ?? null,
        now,
        id,
      )
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO medication_terminology (
          id, owner_id, profile_id, medication_id, original_product_name, original_strength, original_formulation, query_text,
          rx_cui, reference_name, tty, clinical_drug_rx_cui, clinical_drug_name, ingredient_rx_cuis, ingredient_names,
          strength_value, strength_unit, dosage_form, release_characteristic, mapping_status, match_method, terminology_version,
          terminology_date, notes_json, reviewer_principal_id, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(...values)
      .run();
  }
  return { ...t, id, medicationId: args.medicationId };
}

export async function refreshDuplicateFlags(
  db: D1Database,
  ownerId: string,
  profileId: string,
): Promise<DuplicateCandidate[]> {
  const rows = await db
    .prepare("SELECT id, data FROM medications WHERE owner_id=? AND profile_id=? AND list_state='active' LIMIT 100")
    .bind(ownerId, profileId)
    .all<{ id: string; data: string }>();
  const termRows = await db
    .prepare("SELECT * FROM medication_terminology WHERE owner_id=? AND profile_id=?")
    .bind(ownerId, profileId)
    .all<TerminologyRow>();
  const byMed = new Map(termRows.results.map((r) => [r.medication_id, terminologyFromRow(r)]));

  const list = rows.results.map((r) => {
    const fields = JSON.parse(r.data) as MedicationFields;
    return {
      id: r.id,
      productName: fields.productName,
      strength: fields.strength,
      formulation: fields.formulation,
      frequency: fields.frequency,
      terminology: byMed.get(r.id) || null,
    };
  });

  const proposed = findDuplicateFlags(list);
  const existing = await db
    .prepare("SELECT * FROM duplicate_flags WHERE owner_id=? AND profile_id=?")
    .bind(ownerId, profileId)
    .all<DuplicateFlagRow>();
  const existingMap = new Map(
    existing.results.map((r) => [`${r.medication_a_id}|${r.medication_b_id}|${r.flag_type}`, r]),
  );
  const proposedKeys = new Set(proposed.map((p) => `${p.medicationAId}|${p.medicationBId}|${p.flagType}`));
  const now = new Date().toISOString();

  for (const flag of proposed) {
    const key = `${flag.medicationAId}|${flag.medicationBId}|${flag.flagType}`;
    const prior = existingMap.get(key);
    if (prior) {
      // Keep patient/staff response; refresh explanation/evidence.
      await db
        .prepare("UPDATE duplicate_flags SET explanation=?, evidence_json=?, updated_at=? WHERE id=?")
        .bind(flag.explanation, JSON.stringify(flag.evidence), now, prior.id)
        .run();
    } else {
      await db
        .prepare(
          `INSERT INTO duplicate_flags (
            id, owner_id, profile_id, medication_a_id, medication_b_id, flag_type, explanation, evidence_json,
            status, respondent_principal_id, responded_at, created_at, updated_at
          ) VALUES (?,?,?,?,?,?,?,?, 'open', NULL, NULL, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          ownerId,
          profileId,
          flag.medicationAId,
          flag.medicationBId,
          flag.flagType,
          flag.explanation,
          JSON.stringify(flag.evidence),
          now,
          now,
        )
        .run();
    }
  }

  // Close flags that no longer apply only if still open (preserve answered history by marking staff_dismissed? Keep rows but set status).
  for (const row of existing.results) {
    const key = `${row.medication_a_id}|${row.medication_b_id}|${row.flag_type}`;
    if (!proposedKeys.has(key) && row.status === "open") {
      await db
        .prepare("UPDATE duplicate_flags SET status='staff_dismissed', explanation=?, updated_at=? WHERE id=?")
        .bind(`${row.explanation} (No longer proposed after the latest terminology review.)`, now, row.id)
        .run();
    }
  }

  return proposed;
}

/** Offline-safe normalize using fixtures; optional outage marker when caller reports NLM down. */
export function normalizeMedicationFields(
  fields: MedicationFields,
  options?: { nlmUnavailable?: boolean; queryText?: string },
): { terminology: NormalizedTerminology; fields: MedicationFields } {
  if (options?.nlmUnavailable) {
    const terminology = terminologyForOutage(fields, options.queryText || "");
    return { terminology, fields };
  }
  const terminology = normalizeFromFixture(fields);
  return { terminology, fields: applyTerminologyToFields(fields, terminology) };
}

export async function listTerminologyForProfile(db: D1Database, ownerId: string, profileId: string) {
  const rows = await db
    .prepare("SELECT * FROM medication_terminology WHERE owner_id=? AND profile_id=?")
    .bind(ownerId, profileId)
    .all<TerminologyRow>();
  return rows.results.map(terminologyFromRow);
}

export async function listDuplicateFlagsForProfile(db: D1Database, ownerId: string, profileId: string) {
  const rows = await db
    .prepare("SELECT * FROM duplicate_flags WHERE owner_id=? AND profile_id=? ORDER BY created_at DESC LIMIT 100")
    .bind(ownerId, profileId)
    .all<DuplicateFlagRow>();
  return rows.results.map(duplicateFlagFromRow);
}
