import {
  buildMatchingStatus,
  completionLabel,
  type AuthorizationStatus,
  type CompletionRole,
  type StaffIdentityHeader,
  type VerificationStatus,
} from "./clinic-identity.ts";
import {
  LOCAL_MOCK_PRINCIPAL_ID,
  SYNTHETIC,
  SYNTHETIC_HELPER_PRINCIPAL_ID,
  SYNTHETIC_PATIENT_PRINCIPAL_ID,
} from "./synthetic-clinic.ts";

export class ClinicApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ClinicApiError";
  }
}

function uuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new ClinicApiError(400, "Invalid record identifier.");
  }
  return value;
}

async function requireStaff(
  db: D1Database,
  practiceId: string,
  principalId: string,
): Promise<void> {
  const row = await db
    .prepare(
      "SELECT id FROM staff_memberships WHERE practice_id=? AND principal_id=? AND role='staff' LIMIT 1",
    )
    .bind(practiceId, principalId)
    .first<{ id: string }>();
  if (!row) throw new ClinicApiError(403, "Staff access is required for this clinic record.");
}

/**
 * Idempotent synthetic seed. Only the local loopback mock principal may seed via API.
 * Production Sites principals are never `local_seedy`.
 */
export async function ensureSyntheticClinic(
  db: D1Database,
  principalId: string,
): Promise<{ seeded: boolean; appointmentId: string }> {
  if (principalId !== LOCAL_MOCK_PRINCIPAL_ID) {
    throw new ClinicApiError(
      403,
      "Synthetic fixtures can only be seeded by the local mock sign-in principal.",
    );
  }

  const existing = await db
    .prepare("SELECT id FROM practices WHERE id=?")
    .bind(SYNTHETIC.practiceId)
    .first<{ id: string }>();
  const now = new Date().toISOString();
  if (existing) {
    await db
      .prepare(
        "INSERT OR IGNORE INTO staff_memberships (id,practice_id,principal_id,role,created_at) VALUES (?,?,?,?,?)",
      )
      .bind(crypto.randomUUID(), SYNTHETIC.practiceId, principalId, "staff", now)
      .run();
    await ensureLinkedAliceProfile(db, principalId, now);
    return { seeded: false, appointmentId: SYNTHETIC.appointmentAliceA.id };
  }

  const { patients, mappingAliceA, appointmentAliceA, respondentSelf, respondentHelper } = SYNTHETIC;
  await db.batch([
    db.prepare("INSERT INTO practices (id,name,created_at) VALUES (?,?,?)").bind(
      SYNTHETIC.practiceId,
      SYNTHETIC.practiceName,
      now,
    ),
    db
      .prepare(
        "INSERT INTO staff_memberships (id,practice_id,principal_id,role,created_at) VALUES (?,?,?,?,?)",
      )
      .bind(SYNTHETIC.staffMembershipId, SYNTHETIC.practiceId, principalId, "staff", now),
    db
      .prepare(
        "INSERT INTO patients (id,practice_id,legal_name,dob,postal_code,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
      )
      .bind(
        patients.aliceA.id,
        SYNTHETIC.practiceId,
        patients.aliceA.legalName,
        patients.aliceA.dob,
        patients.aliceA.postalCode,
        now,
        now,
      ),
    db
      .prepare(
        "INSERT INTO patients (id,practice_id,legal_name,dob,postal_code,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
      )
      .bind(
        patients.aliceB.id,
        SYNTHETIC.practiceId,
        patients.aliceB.legalName,
        patients.aliceB.dob,
        patients.aliceB.postalCode,
        now,
        now,
      ),
    db
      .prepare(
        "INSERT INTO patients (id,practice_id,legal_name,dob,postal_code,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
      )
      .bind(
        patients.bob.id,
        SYNTHETIC.practiceId,
        patients.bob.legalName,
        patients.bob.dob,
        patients.bob.postalCode,
        now,
        now,
      ),
    db
      .prepare(
        "INSERT INTO external_patient_mappings (id,practice_id,patient_id,source_system,external_patient_id,verification_status,match_method,reviewer_id,verified_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        mappingAliceA.id,
        SYNTHETIC.practiceId,
        patients.aliceA.id,
        mappingAliceA.sourceSystem,
        mappingAliceA.externalPatientId,
        mappingAliceA.verificationStatus,
        mappingAliceA.matchMethod,
        null,
        null,
        now,
      ),
    db
      .prepare(
        "INSERT INTO appointments (id,practice_id,patient_id,provider_name,service_name,starts_at,timezone,source_system,external_appointment_id,revision,created_at) VALUES (?,?,?,?,?,?,?,?,?,1,?)",
      )
      .bind(
        appointmentAliceA.id,
        SYNTHETIC.practiceId,
        patients.aliceA.id,
        appointmentAliceA.providerName,
        appointmentAliceA.serviceName,
        appointmentAliceA.startsAt,
        appointmentAliceA.timezone,
        appointmentAliceA.sourceSystem,
        appointmentAliceA.externalAppointmentId,
        now,
      ),
    db
      .prepare(
        "INSERT INTO respondents (id,practice_id,patient_id,display_name,relationship,completion_role,authorization_status,principal_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        respondentSelf.id,
        SYNTHETIC.practiceId,
        patients.aliceA.id,
        respondentSelf.displayName,
        respondentSelf.relationship,
        respondentSelf.completionRole,
        respondentSelf.authorizationStatus,
        SYNTHETIC_PATIENT_PRINCIPAL_ID,
        now,
      ),
    db
      .prepare(
        "INSERT INTO respondents (id,practice_id,patient_id,display_name,relationship,completion_role,authorization_status,principal_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        respondentHelper.id,
        SYNTHETIC.practiceId,
        patients.aliceA.id,
        respondentHelper.displayName,
        respondentHelper.relationship,
        respondentHelper.completionRole,
        respondentHelper.authorizationStatus,
        SYNTHETIC_HELPER_PRINCIPAL_ID,
        now,
      ),
    db
      .prepare("INSERT INTO profiles (id,owner_id,name,created_at) VALUES (?,?,?,?)")
      .bind(SYNTHETIC.aliceProfileId, principalId, "Alice Example — synthetic list", now),
    db
      .prepare(
        "INSERT INTO profile_patient_links (id,profile_id,patient_id,linked_by,created_at) VALUES (?,?,?,?,?)",
      )
      .bind(
        SYNTHETIC.aliceProfileLinkId,
        SYNTHETIC.aliceProfileId,
        patients.aliceA.id,
        "synthetic_fixture",
        now,
      ),
  ]);
  return { seeded: true, appointmentId: SYNTHETIC.appointmentAliceA.id };
}

async function ensureLinkedAliceProfile(
  db: D1Database,
  staffPrincipalId: string,
  now: string,
): Promise<void> {
  await db
    .prepare("UPDATE respondents SET principal_id=? WHERE id=?")
    .bind(SYNTHETIC_PATIENT_PRINCIPAL_ID, SYNTHETIC.respondentSelf.id)
    .run();
  await db
    .prepare("UPDATE respondents SET principal_id=? WHERE id=?")
    .bind(SYNTHETIC_HELPER_PRINCIPAL_ID, SYNTHETIC.respondentHelper.id)
    .run();
  await db
    .prepare("INSERT OR IGNORE INTO profiles (id,owner_id,name,created_at) VALUES (?,?,?,?)")
    .bind(SYNTHETIC.aliceProfileId, staffPrincipalId, "Alice Example — synthetic list", now)
    .run();
  await db
    .prepare(
      "INSERT OR IGNORE INTO profile_patient_links (id,profile_id,patient_id,linked_by,created_at) VALUES (?,?,?,?,?)",
    )
    .bind(
      SYNTHETIC.aliceProfileLinkId,
      SYNTHETIC.aliceProfileId,
      SYNTHETIC.patients.aliceA.id,
      "synthetic_fixture",
      now,
    )
    .run();
}

export async function getStaffIdentityHeader(
  db: D1Database,
  principalId: string,
  appointmentIdRaw: unknown,
  respondentIdRaw?: unknown,
): Promise<StaffIdentityHeader> {
  const appointmentId = uuid(appointmentIdRaw);
  const appointment = await db
    .prepare(
      "SELECT id,practice_id,patient_id,provider_name,service_name,starts_at,timezone,external_appointment_id FROM appointments WHERE id=?",
    )
    .bind(appointmentId)
    .first<{
      id: string;
      practice_id: string;
      patient_id: string;
      provider_name: string;
      service_name: string;
      starts_at: string;
      timezone: string;
      external_appointment_id: string | null;
    }>();
  if (!appointment) throw new ClinicApiError(404, "This appointment was not found.");

  await requireStaff(db, appointment.practice_id, principalId);

  const practice = await db
    .prepare("SELECT id,name FROM practices WHERE id=?")
    .bind(appointment.practice_id)
    .first<{ id: string; name: string }>();
  if (!practice) throw new ClinicApiError(404, "This practice was not found.");

  const patient = await db
    .prepare("SELECT id,legal_name,dob,postal_code FROM patients WHERE id=? AND practice_id=?")
    .bind(appointment.patient_id, appointment.practice_id)
    .first<{ id: string; legal_name: string; dob: string; postal_code: string | null }>();
  if (!patient) throw new ClinicApiError(404, "This patient was not found.");

  const mapping = await db
    .prepare(
      "SELECT source_system,external_patient_id,verification_status,match_method FROM external_patient_mappings WHERE patient_id=? AND practice_id=? ORDER BY created_at LIMIT 1",
    )
    .bind(patient.id, appointment.practice_id)
    .first<{
      source_system: string;
      external_patient_id: string;
      verification_status: VerificationStatus;
      match_method: string;
    }>();

  let respondent: {
    id: string;
    display_name: string;
    relationship: string;
    completion_role: CompletionRole;
    authorization_status: AuthorizationStatus;
  } | null = null;

  if (respondentIdRaw) {
    const rid = uuid(respondentIdRaw);
    respondent = await db
      .prepare(
        "SELECT id,display_name,relationship,completion_role,authorization_status FROM respondents WHERE id=? AND patient_id=? AND practice_id=?",
      )
      .bind(rid, patient.id, appointment.practice_id)
      .first();
    if (!respondent) throw new ClinicApiError(404, "This respondent was not found.");
  } else {
    respondent = await db
      .prepare(
        "SELECT id,display_name,relationship,completion_role,authorization_status FROM respondents WHERE patient_id=? AND practice_id=? AND completion_role='patient' AND authorization_status='active' ORDER BY created_at LIMIT 1",
      )
      .bind(patient.id, appointment.practice_id)
      .first();
  }

  const mappingView = mapping
    ? {
        sourceSystem: mapping.source_system,
        externalPatientId: mapping.external_patient_id,
        verificationStatus: mapping.verification_status,
        matchMethod: mapping.match_method,
      }
    : null;

  return {
    practice: { id: practice.id, name: practice.name },
    patient: {
      id: patient.id,
      legalName: patient.legal_name,
      dob: patient.dob,
      postalCode: patient.postal_code,
    },
    externalMapping: mappingView,
    appointment: {
      id: appointment.id,
      providerName: appointment.provider_name,
      serviceName: appointment.service_name,
      startsAt: appointment.starts_at,
      timezone: appointment.timezone,
      externalAppointmentId: appointment.external_appointment_id,
    },
    respondent: respondent
      ? {
          id: respondent.id,
          displayName: respondent.display_name,
          relationship: respondent.relationship,
          completionRole: respondent.completion_role,
          completionLabel: completionLabel(respondent.completion_role),
          authorizationStatus: respondent.authorization_status,
        }
      : null,
    matchingStatus: buildMatchingStatus(mappingView),
    ...(await resolveSubmissionHeader(db, appointment.id)),
    baselineStatus: "none" as const,
  };
}

async function resolveSubmissionHeader(
  db: D1Database,
  appointmentId: string,
): Promise<{
  submissionStatus: StaffIdentityHeader["submissionStatus"];
  aprimaStatus: StaffIdentityHeader["aprimaStatus"];
}> {
  const row = await db
    .prepare(
      "SELECT delivery_status, staff_status, aprima_status FROM clinic_submissions WHERE appointment_id=? ORDER BY submitted_at DESC LIMIT 1",
    )
    .bind(appointmentId)
    .first<{ delivery_status: string; staff_status: string; aprima_status: string }>();
  if (!row) return { submissionStatus: "not_started", aprimaStatus: "not_entered" };
  const aprimaStatus =
    row.aprima_status === "entered_manually" ? ("entered_manually" as const) : ("not_entered" as const);
  if (row.staff_status === "reviewed") return { submissionStatus: "reviewed", aprimaStatus };
  if (row.delivery_status === "received") return { submissionStatus: "received", aprimaStatus };
  return { submissionStatus: "submitted_pending_receipt", aprimaStatus };
}
