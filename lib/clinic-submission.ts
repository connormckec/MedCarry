/**
 * Immutable clinic submissions and appointment inbox helpers.
 * Local snapshots are not clinic delivery. Receipt requires durable receive/ack.
 */

import { isConfirmed, type Medication, type MedicationFields } from "./medication.ts";

export class ClinicSubmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClinicSubmissionError";
  }
}

export const RECEIVING_CLINIC_NAME = "Innovation Cardiology";

export const DELIVERY_STATUSES = ["pending", "received"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const STAFF_REVIEW_STATUSES = ["not_reviewed", "needs_clarification", "reviewed"] as const;
export type StaffReviewStatus = (typeof STAFF_REVIEW_STATUSES)[number];

export const APRIMA_STATUSES = ["not_entered", "entered_manually"] as const;
export type AprimaStatus = (typeof APRIMA_STATUSES)[number];

export const PATIENT_SUBMIT_STATUSES = ["submitted"] as const;

export type DuplicateFlagSummary = {
  id: string;
  flagType: string;
  explanation: string;
  status: string;
  medicationAId: string;
  medicationBId: string;
};

export type SubmissionChangeSummary = {
  added: { id: string; productName: string; strength: string; source: string }[];
  stopped: { id: string; productName: string; strength: string }[];
  held: { id: string; productName: string; strength: string }[];
  uncertain: { id: string; productName: string; strength: string; reasons: string[] }[];
  duplicates: DuplicateFlagSummary[];
  counts: {
    added: number;
    stopped: number;
    changed: number;
    duplicate: number;
    uncertain: number;
  };
};

/** Empty-list attestation is explicit — never inferred from an empty database alone. */
export function canSubmitClinic(
  meds: Pick<Medication, "revision" | "confirmedRevision" | "confirmedAt">[],
  emptyListAttested: boolean,
): boolean {
  if (emptyListAttested) return meds.length === 0;
  return meds.length > 0 && meds.every(isConfirmed);
}

export function assertCanSubmitClinic(
  meds: Pick<Medication, "revision" | "confirmedRevision" | "confirmedAt">[],
  emptyListAttested: boolean,
): void {
  if (emptyListAttested && meds.length > 0) {
    throw new ClinicSubmissionError(
      "Clear or remove medications before attesting that you take none.",
    );
  }
  if (!emptyListAttested && meds.length === 0) {
    throw new ClinicSubmissionError(
      "Add medications, or explicitly attest that you take no medications or supplements.",
    );
  }
  if (!emptyListAttested && !meds.every(isConfirmed)) {
    throw new ClinicSubmissionError(
      "Confirm every medication's current version before sending your list to the clinic.",
    );
  }
}

export function uncertaintyReasons(m: MedicationFields): string[] {
  const reasons: string[] = [];
  if (m.strengthUnknown) reasons.push("Strength unsure");
  if (m.actualUseUnknown) reasons.push("Current use unsure");
  if (m.status === "unsure") reasons.push("Not sure if taking");
  if (m.uncertaintyNote.trim()) reasons.push("Patient note for clinic");
  return reasons;
}

/**
 * Group visible change/uncertainty signals for staff review.
 * Without an Aprima baseline, note-sourced rows are treated as historical baseline;
 * patient-entered rows are "added"; stopped/held/uncertain/duplicate are explicit.
 */
export function buildChangeSummary(
  meds: Medication[],
  duplicateFlags: DuplicateFlagSummary[] = [],
): SubmissionChangeSummary {
  const added: SubmissionChangeSummary["added"] = [];
  const stopped: SubmissionChangeSummary["stopped"] = [];
  const held: SubmissionChangeSummary["held"] = [];
  const uncertain: SubmissionChangeSummary["uncertain"] = [];
  let changed = 0;

  for (const m of meds) {
    if (m.status === "stopped") {
      stopped.push({ id: m.id, productName: m.productName, strength: m.strengthUnknown ? "Strength unsure" : m.strength });
    } else if (m.status === "held") {
      held.push({ id: m.id, productName: m.productName, strength: m.strengthUnknown ? "Strength unsure" : m.strength });
    } else if (m.source === "note") {
      // Historical baseline entry the patient confirmed with current-use detail.
      if (m.actualDose || m.frequency !== "unknown" || m.actualUseUnknown) changed += 1;
    } else {
      added.push({
        id: m.id,
        productName: m.productName,
        strength: m.strengthUnknown ? "Strength unsure" : m.strength,
        source: m.source,
      });
    }
    const reasons = uncertaintyReasons(m);
    if (reasons.length) {
      uncertain.push({
        id: m.id,
        productName: m.productName,
        strength: m.strengthUnknown ? "Strength unsure" : m.strength,
        reasons,
      });
    }
  }

  const openDupes = duplicateFlags.filter((f) => f.status === "open" || f.status === "unsure");
  return {
    added,
    stopped,
    held,
    uncertain,
    duplicates: openDupes,
    counts: {
      added: added.length,
      stopped: stopped.length + held.length,
      changed,
      duplicate: openDupes.length,
      uncertain: uncertain.length,
    },
  };
}

export function parseStaffReviewStatus(value: unknown): StaffReviewStatus {
  if (value === "not_reviewed" || value === "needs_clarification" || value === "reviewed") return value;
  throw new ClinicSubmissionError("Choose not reviewed, needs clarification, or reviewed.");
}

export function parseAprimaStatus(value: unknown): AprimaStatus {
  if (value === "not_entered" || value === "entered_manually") return value;
  throw new ClinicSubmissionError("Aprima handling is not entered or entered manually — there is no write-back.");
}

export function deliveryLabel(status: DeliveryStatus): string {
  return status === "received" ? "Received by the clinic" : "Submitted — waiting for clinic receipt";
}

export function staffStatusLabel(status: StaffReviewStatus): string {
  switch (status) {
    case "not_reviewed":
      return "Not reviewed";
    case "needs_clarification":
      return "Needs clarification";
    case "reviewed":
      return "Reviewed";
  }
}

export function aprimaStatusLabel(status: AprimaStatus): string {
  return status === "entered_manually" ? "Entered manually in Aprima" : "Not entered in Aprima";
}

/** Calendar date YYYY-MM-DD for an appointment instant in its timezone. */
export function appointmentCalendarDate(startsAt: string, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(startsAt));
    const y = parts.find((p) => p.type === "year")?.value;
    const m = parts.find((p) => p.type === "month")?.value;
    const d = parts.find((p) => p.type === "day")?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    /* fall through */
  }
  return startsAt.slice(0, 10);
}

export function isValidDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
