/**
 * Patient-reported medication changes. Recording use is not discontinuing a prescription.
 */

export const CHANGE_REASONS = [
  "no_longer_take",
  "added_by_mistake",
  "undo_no_longer_take",
  "undo_added_by_mistake",
] as const;

export type ChangeReason = (typeof CHANGE_REASONS)[number];

export class MedicationChangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MedicationChangeError";
  }
}

export function parseChangeReason(value: unknown): "no_longer_take" | "added_by_mistake" {
  if (value === "no_longer_take" || value === "added_by_mistake") return value;
  throw new MedicationChangeError(
    "Choose whether you no longer take this medicine or added it by mistake.",
  );
}

/** Patient-facing copy — never “Stop taking”. */
export function changeReasonLabel(reason: ChangeReason): string {
  switch (reason) {
    case "no_longer_take":
      return "I no longer take this";
    case "added_by_mistake":
      return "I added this by mistake";
    case "undo_no_longer_take":
      return "Undo: no longer take";
    case "undo_added_by_mistake":
      return "Undo: added by mistake";
  }
}

export type EditorDraftPayload = {
  fields: unknown;
  sourceIds: string[];
  step?: number;
  medicationRevision?: number | null;
};

export function parseEditorDraft(value: unknown): EditorDraftPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MedicationChangeError("Draft details are required.");
  }
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.sourceIds) || raw.sourceIds.length > 4) {
    throw new MedicationChangeError("Use up to four photos for one medication.");
  }
  const sourceIds = raw.sourceIds.filter((id): id is string => typeof id === "string");
  if (sourceIds.length !== raw.sourceIds.length) {
    throw new MedicationChangeError("Check the saved photos on this draft.");
  }
  const step =
    raw.step === undefined
      ? undefined
      : Number.isInteger(raw.step) && Number(raw.step) >= 1 && Number(raw.step) <= 3
        ? Number(raw.step)
        : (() => {
            throw new MedicationChangeError("Draft step must be 1, 2, or 3.");
          })();
  const medicationRevision =
    raw.medicationRevision === undefined || raw.medicationRevision === null
      ? raw.medicationRevision ?? null
      : Number.isInteger(raw.medicationRevision) && Number(raw.medicationRevision) >= 1
        ? Number(raw.medicationRevision)
        : (() => {
            throw new MedicationChangeError("Draft medication version is invalid.");
          })();
  return { fields: raw.fields, sourceIds, step, medicationRevision };
}
