/**
 * Persist immutable clinic submissions, outbox ack → inbox, and staff updates.
 */

import type { Medication } from "./medication.ts";
import {
  RECEIVING_CLINIC_NAME,
  appointmentCalendarDate,
  buildChangeSummary,
  type AprimaStatus,
  type DeliveryStatus,
  type DuplicateFlagSummary,
  type StaffReviewStatus,
  type SubmissionChangeSummary,
} from "./clinic-submission.ts";

export type ClinicSubmissionRow = {
  id: string;
  owner_id: string;
  profile_id: string;
  practice_id: string;
  patient_id: string;
  appointment_id: string;
  respondent_id: string | null;
  recipient_clinic_name: string;
  idempotency_key: string;
  payload_json: string;
  medication_revisions_json: string;
  change_summary_json: string;
  empty_list_attested: number;
  delivery_status: string;
  staff_status: string;
  aprima_status: string;
  submitted_at: string;
  received_at: string | null;
  reviewed_at: string | null;
  reviewer_principal_id: string | null;
  created_at: string;
};

export type ClinicInboxRow = {
  id: string;
  practice_id: string;
  submission_id: string;
  appointment_id: string;
  patient_id: string;
  appointment_starts_at: string;
  appointment_timezone: string;
  patient_legal_name: string;
  patient_dob: string;
  delivery_status: string;
  staff_status: string;
  aprima_status: string;
  summary_json: string;
  created_at: string;
};

export function submissionFromRow(row: ClinicSubmissionRow) {
  return {
    id: row.id,
    profileId: row.profile_id,
    practiceId: row.practice_id,
    patientId: row.patient_id,
    appointmentId: row.appointment_id,
    respondentId: row.respondent_id,
    recipientClinicName: row.recipient_clinic_name,
    emptyListAttested: row.empty_list_attested === 1,
    deliveryStatus: row.delivery_status as DeliveryStatus,
    staffStatus: row.staff_status as StaffReviewStatus,
    aprimaStatus: row.aprima_status as AprimaStatus,
    submittedAt: row.submitted_at,
    receivedAt: row.received_at,
    reviewedAt: row.reviewed_at,
    reviewerPrincipalId: row.reviewer_principal_id,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    medicationRevisions: JSON.parse(row.medication_revisions_json) as { id: string; revision: number }[],
    changeSummary: JSON.parse(row.change_summary_json) as SubmissionChangeSummary,
  };
}

export function inboxItemFromRow(row: ClinicInboxRow) {
  return {
    id: row.id,
    practiceId: row.practice_id,
    submissionId: row.submission_id,
    appointmentId: row.appointment_id,
    patientId: row.patient_id,
    appointmentStartsAt: row.appointment_starts_at,
    appointmentTimezone: row.appointment_timezone,
    patientLegalName: row.patient_legal_name,
    patientDob: row.patient_dob,
    deliveryStatus: row.delivery_status as DeliveryStatus,
    staffStatus: row.staff_status as StaffReviewStatus,
    aprimaStatus: row.aprima_status as AprimaStatus,
    summary: JSON.parse(row.summary_json) as SubmissionChangeSummary["counts"] & {
      emptyListAttested?: boolean;
    },
    createdAt: row.created_at,
  };
}

export async function createImmutableSubmission(
  db: D1Database,
  args: {
    ownerId: string;
    profileId: string;
    practiceId: string;
    patientId: string;
    appointmentId: string;
    respondentId: string | null;
    idempotencyKey: string;
    medications: Medication[];
    emptyListAttested: boolean;
    duplicateFlags: DuplicateFlagSummary[];
    identity: Record<string, unknown>;
  },
): Promise<{ submission: ReturnType<typeof submissionFromRow>; replayed: boolean }> {
  const existing = await db
    .prepare("SELECT * FROM clinic_submissions WHERE owner_id=? AND idempotency_key=?")
    .bind(args.ownerId, args.idempotencyKey)
    .first<ClinicSubmissionRow>();
  if (existing) {
    if (existing.profile_id !== args.profileId || existing.appointment_id !== args.appointmentId) {
      throw new Error("SUBMISSION_IDEMPOTENCY_CONFLICT");
    }
    return { submission: submissionFromRow(existing), replayed: true };
  }

  const now = new Date().toISOString();
  const submissionId = crypto.randomUUID();
  const changeSummary = buildChangeSummary(args.medications, args.duplicateFlags);
  const revisions = args.medications.map((m) => ({ id: m.id, revision: m.revision }));
  const payload = {
    id: submissionId,
    recipientClinicName: RECEIVING_CLINIC_NAME,
    submittedAt: now,
    emptyListAttested: args.emptyListAttested,
    identity: args.identity,
    medications: args.medications,
    changeSummary,
    note: "Immutable patient report for clinician reconciliation. Not a prescription. Not an Aprima write-back.",
  };

  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO clinic_submissions (
            id, owner_id, profile_id, practice_id, patient_id, appointment_id, respondent_id, recipient_clinic_name,
            idempotency_key, payload_json, medication_revisions_json, change_summary_json, empty_list_attested,
            delivery_status, staff_status, aprima_status, submitted_at, received_at, reviewed_at, reviewer_principal_id, created_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending', 'not_reviewed', 'not_entered', ?, NULL, NULL, NULL, ?)`,
        )
        .bind(
          submissionId,
          args.ownerId,
          args.profileId,
          args.practiceId,
          args.patientId,
          args.appointmentId,
          args.respondentId,
          RECEIVING_CLINIC_NAME,
          args.idempotencyKey,
          JSON.stringify(payload),
          JSON.stringify(revisions),
          JSON.stringify(changeSummary),
          args.emptyListAttested ? 1 : 0,
          now,
          now,
        ),
      db
        .prepare(
          `INSERT INTO submission_outbox (id, submission_id, idempotency_key, status, attempts, last_error, created_at, acked_at)
           VALUES (?,?,?, 'pending', 0, NULL, ?, NULL)`,
        )
        .bind(crypto.randomUUID(), submissionId, `outbox:${args.idempotencyKey}`, now),
    ]);
  } catch (e) {
    const retry = await db
      .prepare("SELECT * FROM clinic_submissions WHERE owner_id=? AND idempotency_key=?")
      .bind(args.ownerId, args.idempotencyKey)
      .first<ClinicSubmissionRow>();
    if (retry && retry.profile_id === args.profileId && retry.appointment_id === args.appointmentId) {
      return { submission: submissionFromRow(retry), replayed: true };
    }
    throw e;
  }

  const row = await db
    .prepare("SELECT * FROM clinic_submissions WHERE id=?")
    .bind(submissionId)
    .first<ClinicSubmissionRow>();
  return { submission: submissionFromRow(row!), replayed: false };
}

/**
 * Durable receive: pending outbox → inbox item + mark submission received.
 * This is the clinic receiving service for MVP (no external Aprima/fee-ticket).
 */
export async function processSubmissionOutbox(
  db: D1Database,
  submissionId: string,
): Promise<{ received: boolean; inboxItemId: string | null }> {
  const submission = await db
    .prepare("SELECT * FROM clinic_submissions WHERE id=?")
    .bind(submissionId)
    .first<ClinicSubmissionRow>();
  if (!submission) return { received: false, inboxItemId: null };

  const existingInbox = await db
    .prepare("SELECT id FROM clinic_inbox_items WHERE submission_id=?")
    .bind(submissionId)
    .first<{ id: string }>();
  if (existingInbox && submission.delivery_status === "received") {
    return { received: true, inboxItemId: existingInbox.id };
  }

  const outbox = await db
    .prepare("SELECT * FROM submission_outbox WHERE submission_id=? ORDER BY created_at LIMIT 1")
    .bind(submissionId)
    .first<{ id: string; status: string; attempts: number }>();
  if (!outbox) return { received: false, inboxItemId: null };

  const appointment = await db
    .prepare("SELECT starts_at, timezone FROM appointments WHERE id=?")
    .bind(submission.appointment_id)
    .first<{ starts_at: string; timezone: string }>();
  const patient = await db
    .prepare("SELECT legal_name, dob FROM patients WHERE id=?")
    .bind(submission.patient_id)
    .first<{ legal_name: string; dob: string }>();
  if (!appointment || !patient) {
    await db
      .prepare("UPDATE submission_outbox SET attempts=attempts+1, last_error=? WHERE id=?")
      .bind("Appointment or patient missing for inbox delivery.", outbox.id)
      .run();
    return { received: false, inboxItemId: null };
  }

  const now = new Date().toISOString();
  const inboxId = existingInbox?.id || crypto.randomUUID();
  const summary = {
    ...(JSON.parse(submission.change_summary_json) as SubmissionChangeSummary).counts,
    emptyListAttested: submission.empty_list_attested === 1,
  };

  if (!existingInbox) {
    try {
      await db
        .prepare(
          `INSERT INTO clinic_inbox_items (
            id, practice_id, submission_id, appointment_id, patient_id, appointment_starts_at, appointment_timezone,
            patient_legal_name, patient_dob, delivery_status, staff_status, aprima_status, summary_json, created_at
          ) VALUES (?,?,?,?,?,?,?,?,?, 'received', ?, ?, ?, ?)`,
        )
        .bind(
          inboxId,
          submission.practice_id,
          submissionId,
          submission.appointment_id,
          submission.patient_id,
          appointment.starts_at,
          appointment.timezone,
          patient.legal_name,
          patient.dob,
          submission.staff_status,
          submission.aprima_status,
          JSON.stringify(summary),
          now,
        )
        .run();
    } catch {
      const raced = await db
        .prepare("SELECT id FROM clinic_inbox_items WHERE submission_id=?")
        .bind(submissionId)
        .first<{ id: string }>();
      if (!raced) throw new Error("INBOX_INSERT_FAILED");
    }
  }

  await db.batch([
    db
      .prepare("UPDATE clinic_submissions SET delivery_status='received', received_at=? WHERE id=? AND delivery_status='pending'")
      .bind(now, submissionId),
    db
      .prepare("UPDATE submission_outbox SET status='acked', attempts=attempts+1, acked_at=?, last_error=NULL WHERE id=?")
      .bind(now, outbox.id),
    db
      .prepare("UPDATE clinic_inbox_items SET delivery_status='received' WHERE submission_id=?")
      .bind(submissionId),
  ]);

  const inbox = await db
    .prepare("SELECT id FROM clinic_inbox_items WHERE submission_id=?")
    .bind(submissionId)
    .first<{ id: string }>();
  return { received: true, inboxItemId: inbox?.id || null };
}

export async function listInboxForPracticeDate(
  db: D1Database,
  practiceId: string,
  dateOnly: string,
): Promise<{
  appointments: {
    appointmentId: string;
    patientId: string;
    patientLegalName: string;
    patientDob: string;
    patientPostalCode: string | null;
    providerName: string;
    serviceName: string;
    startsAt: string;
    timezone: string;
    submission: ReturnType<typeof submissionFromRow> | null;
    inboxItem: ReturnType<typeof inboxItemFromRow> | null;
  }[];
}> {
  const appointments = await db
    .prepare(
      `SELECT a.id, a.patient_id, a.provider_name, a.service_name, a.starts_at, a.timezone,
              p.legal_name, p.dob, p.postal_code
       FROM appointments a
       JOIN patients p ON p.id = a.patient_id
       WHERE a.practice_id=?
       ORDER BY a.starts_at ASC
       LIMIT 200`,
    )
    .bind(practiceId)
    .all<{
      id: string;
      patient_id: string;
      provider_name: string;
      service_name: string;
      starts_at: string;
      timezone: string;
      legal_name: string;
      dob: string;
      postal_code: string | null;
    }>();

  const dayAppts = appointments.results.filter(
    (a) => appointmentCalendarDate(a.starts_at, a.timezone) === dateOnly,
  );

  const result = [];
  for (const a of dayAppts) {
    const sub = await db
      .prepare(
        "SELECT * FROM clinic_submissions WHERE appointment_id=? AND practice_id=? ORDER BY submitted_at DESC LIMIT 1",
      )
      .bind(a.id, practiceId)
      .first<ClinicSubmissionRow>();
    const inbox = sub
      ? await db
          .prepare("SELECT * FROM clinic_inbox_items WHERE submission_id=?")
          .bind(sub.id)
          .first<ClinicInboxRow>()
      : null;
    result.push({
      appointmentId: a.id,
      patientId: a.patient_id,
      patientLegalName: a.legal_name,
      patientDob: a.dob,
      patientPostalCode: a.postal_code,
      providerName: a.provider_name,
      serviceName: a.service_name,
      startsAt: a.starts_at,
      timezone: a.timezone,
      submission: sub ? submissionFromRow(sub) : null,
      inboxItem: inbox ? inboxItemFromRow(inbox) : null,
    });
  }
  return { appointments: result };
}

export async function updateSubmissionStaffStatus(
  db: D1Database,
  submissionId: string,
  practiceId: string,
  staffStatus: StaffReviewStatus,
  reviewerPrincipalId: string,
): Promise<ClinicSubmissionRow | null> {
  const now = new Date().toISOString();
  const reviewedAt = staffStatus === "reviewed" || staffStatus === "needs_clarification" ? now : null;
  await db
    .prepare(
      "UPDATE clinic_submissions SET staff_status=?, reviewed_at=?, reviewer_principal_id=? WHERE id=? AND practice_id=?",
    )
    .bind(staffStatus, reviewedAt, reviewerPrincipalId, submissionId, practiceId)
    .run();
  await db
    .prepare("UPDATE clinic_inbox_items SET staff_status=? WHERE submission_id=? AND practice_id=?")
    .bind(staffStatus, submissionId, practiceId)
    .run();
  return db.prepare("SELECT * FROM clinic_submissions WHERE id=?").bind(submissionId).first<ClinicSubmissionRow>();
}

export async function updateSubmissionAprimaStatus(
  db: D1Database,
  submissionId: string,
  practiceId: string,
  aprimaStatus: AprimaStatus,
): Promise<ClinicSubmissionRow | null> {
  await db
    .prepare("UPDATE clinic_submissions SET aprima_status=? WHERE id=? AND practice_id=?")
    .bind(aprimaStatus, submissionId, practiceId)
    .run();
  await db
    .prepare("UPDATE clinic_inbox_items SET aprima_status=? WHERE submission_id=? AND practice_id=?")
    .bind(aprimaStatus, submissionId, practiceId)
    .run();
  return db.prepare("SELECT * FROM clinic_submissions WHERE id=?").bind(submissionId).first<ClinicSubmissionRow>();
}

export async function latestSubmissionForAppointment(
  db: D1Database,
  appointmentId: string,
): Promise<ClinicSubmissionRow | null> {
  return db
    .prepare("SELECT * FROM clinic_submissions WHERE appointment_id=? ORDER BY submitted_at DESC LIMIT 1")
    .bind(appointmentId)
    .first<ClinicSubmissionRow>();
}
