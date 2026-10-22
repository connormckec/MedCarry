/**
 * Clinic identity helpers for additive patient / appointment / respondent models.
 * Matching proposes candidates only — never auto-merges or authenticates.
 */

export type VerificationStatus = "unverified" | "verified" | "needs_review";
export type CompletionRole = "patient" | "helper" | "staff_assisted";
export type AuthorizationStatus = "active" | "expired" | "revoked";
export type StaffRole = "staff";

export type PatientRecord = {
  id: string;
  practiceId: string;
  legalName: string;
  dob: string;
  postalCode: string | null;
};

export type MatchProposal =
  | { status: "none"; patientIds: [] }
  | { status: "unique"; patientIds: [string]; reason: "external_id" | "name_dob" }
  | { status: "ambiguous"; patientIds: string[]; reason: "name_dob" | "conflicting_external" };

export class ClinicIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClinicIdentityError";
  }
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Accept calendar date-only values; reject timestamps and impossible days. */
export function parseDateOnly(value: unknown): string {
  if (typeof value !== "string" || !DATE_ONLY.test(value.trim())) {
    throw new ClinicIdentityError("Date of birth must be a calendar date (YYYY-MM-DD).");
  }
  const dob = value.trim();
  const [, y, m, d] = dob.match(DATE_ONLY)!;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new ClinicIdentityError("Date of birth is not a valid calendar date.");
  }
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new ClinicIdentityError("Date of birth is not a valid calendar date.");
  }
  return dob;
}

/** Store postal codes as strings so leading zeros survive; blank becomes null. */
export function normalizePostalCode(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new ClinicIdentityError("Postal code must be text.");
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 16 || /\s{2,}/.test(trimmed)) {
    throw new ClinicIdentityError("Check the postal code.");
  }
  return trimmed;
}

export function normalizeLegalName(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 120) {
    throw new ClinicIdentityError("Legal name is required.");
  }
  return value.trim().replace(/\s+/g, " ");
}

export function namesMatch(a: string, b: string): boolean {
  return normalizeLegalName(a).toLowerCase() === normalizeLegalName(b).toLowerCase();
}

/**
 * Propose a patient match for staff review. Never authenticates and never merges.
 * Prefer a verified external ID; name+DOB may propose a unique candidate or ambiguity.
 */
export function proposePatientMatch(input: {
  patients: PatientRecord[];
  legalName?: string;
  dob?: string;
  postalCode?: string | null;
  externalPatientId?: string | null;
  mappings?: { patientId: string; externalPatientId: string; verificationStatus: VerificationStatus }[];
}): MatchProposal {
  const mappings = input.mappings || [];
  if (input.externalPatientId) {
    const hits = mappings.filter(
      (m) => m.externalPatientId === input.externalPatientId && m.verificationStatus === "verified",
    );
    if (hits.length === 1) {
      return { status: "unique", patientIds: [hits[0].patientId], reason: "external_id" };
    }
    if (hits.length > 1) {
      return {
        status: "ambiguous",
        patientIds: [...new Set(hits.map((h) => h.patientId))],
        reason: "conflicting_external",
      };
    }
  }

  if (!input.legalName || !input.dob) {
    return { status: "none", patientIds: [] };
  }
  const dob = parseDateOnly(input.dob);
  const nameHits = input.patients.filter(
    (p) => namesMatch(p.legalName, input.legalName!) && p.dob === dob,
  );
  if (nameHits.length === 0) return { status: "none", patientIds: [] };
  if (nameHits.length === 1) {
    return { status: "unique", patientIds: [nameHits[0].id], reason: "name_dob" };
  }
  return {
    status: "ambiguous",
    patientIds: nameHits.map((p) => p.id),
    reason: "name_dob",
  };
}

/** ZIP is secondary evidence only — never sufficient to choose among ambiguous name/DOB hits. */
export function postalCodeSupportsMatch(
  patient: PatientRecord,
  postalCode: string | null | undefined,
): boolean {
  const zip = normalizePostalCode(postalCode ?? null);
  if (!zip || !patient.postalCode) return false;
  return patient.postalCode === zip;
}

export function assertActiveAuthorization(status: AuthorizationStatus): void {
  if (status !== "active") {
    throw new ClinicIdentityError("This helper authorization is no longer active.");
  }
}

export function completionLabel(role: CompletionRole): string {
  if (role === "patient") return "Patient";
  if (role === "helper") return "Authorized helper";
  return "Staff-assisted";
}

export type StaffIdentityHeader = {
  practice: { id: string; name: string };
  patient: {
    id: string;
    legalName: string;
    dob: string;
    postalCode: string | null;
  };
  externalMapping: {
    sourceSystem: string;
    externalPatientId: string;
    verificationStatus: VerificationStatus;
    matchMethod: string;
  } | null;
  appointment: {
    id: string;
    providerName: string;
    serviceName: string;
    startsAt: string;
    timezone: string;
    externalAppointmentId: string | null;
  };
  respondent: {
    id: string;
    displayName: string;
    relationship: string;
    completionRole: CompletionRole;
    completionLabel: string;
    authorizationStatus: AuthorizationStatus;
  } | null;
  matchingStatus: "unverified_mapping" | "verified_mapping" | "needs_review" | "no_external_mapping";
  /**
   * Patient/clinic delivery view for this appointment.
   * not_started | submitted_pending_receipt | received | reviewed
   * Local snapshots alone never count as received.
   */
  submissionStatus: "not_started" | "submitted_pending_receipt" | "received" | "reviewed";
  /** Aprima handling — no write-back in MVP. */
  aprimaStatus: "not_entered" | "entered_manually";
  baselineStatus: "none";
};

export function buildMatchingStatus(
  mapping: { verificationStatus: VerificationStatus } | null,
): StaffIdentityHeader["matchingStatus"] {
  if (!mapping) return "no_external_mapping";
  if (mapping.verificationStatus === "verified") return "verified_mapping";
  if (mapping.verificationStatus === "needs_review") return "needs_review";
  return "unverified_mapping";
}
