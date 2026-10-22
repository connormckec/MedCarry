import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

export const profiles = sqliteTable("profiles", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(),
  name: text("name").notNull(), createdAt: text("created_at").notNull(),
}, t => [index("profiles_owner").on(t.ownerId)]);

export const uploads = sqliteTable("uploads", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(),
  profileId: text("profile_id").notNull().references(() => profiles.id),
  objectKey: text("object_key").notNull(), mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(), createdAt: text("created_at").notNull(),
}, t => [index("uploads_owner").on(t.ownerId, t.profileId), uniqueIndex("uploads_object").on(t.objectKey)]);

export const medications = sqliteTable("medications", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(),
  profileId: text("profile_id").notNull().references(() => profiles.id),
  data: text("data").notNull(), sourceIds: text("source_ids").notNull(),
  revision: integer("revision").notNull().default(1),
  confirmedRevision: integer("confirmed_revision"), confirmedAt: text("confirmed_at"),
  /** active | suppressed — mistake suppressions keep the row for history/Undo. */
  listState: text("list_state").notNull().default("active"),
  createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, t => [index("medications_owner").on(t.ownerId, t.profileId), index("medications_list_state").on(t.ownerId, t.profileId, t.listState)]);

export const snapshots = sqliteTable("snapshots", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(),
  profileId: text("profile_id").notNull().references(() => profiles.id),
  recipient: text("recipient").notNull(), patientName: text("patient_name").notNull(),
  data: text("data").notNull(), idempotencyKey: text("idempotency_key").notNull(),
  createdAt: text("created_at").notNull(),
}, t => [index("snapshots_owner").on(t.ownerId, t.profileId), uniqueIndex("snapshot_request").on(t.ownerId, t.idempotencyKey)]);

export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(),
  profileId: text("profile_id").notNull(), entityId: text("entity_id").notNull(),
  action: text("action").notNull(), revision: integer("revision"),
  createdAt: text("created_at").notNull(),
}, t => [index("audit_owner").on(t.ownerId, t.profileId)]);

export const noteImports = sqliteTable("note_imports", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(),
  profileId: text("profile_id").notNull().references(() => profiles.id),
  idempotencyKey: text("idempotency_key").notNull(), payloadHash: text("payload_hash").notNull(),
  medicationIds: text("medication_ids").notNull(), createdAt: text("created_at").notNull(),
}, t => [uniqueIndex("note_import_request").on(t.ownerId,t.idempotencyKey)]);

/** Additive clinic identity tables. Do not auto-promote profile list names into patients. */
export const practices = sqliteTable("practices", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
});

export const staffMemberships = sqliteTable("staff_memberships", {
  id: text("id").primaryKey(),
  practiceId: text("practice_id").notNull().references(() => practices.id),
  principalId: text("principal_id").notNull(),
  role: text("role").notNull(),
  createdAt: text("created_at").notNull(),
}, t => [
  uniqueIndex("staff_membership_principal").on(t.practiceId, t.principalId),
  index("staff_memberships_principal").on(t.principalId),
]);

export const patients = sqliteTable("patients", {
  id: text("id").primaryKey(),
  practiceId: text("practice_id").notNull().references(() => practices.id),
  legalName: text("legal_name").notNull(),
  /** Date-only YYYY-MM-DD; never a timezone-shifted timestamp. */
  dob: text("dob").notNull(),
  /** Optional primary-address postal code stored as text so leading zeros survive. */
  postalCode: text("postal_code"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, t => [
  index("patients_practice").on(t.practiceId),
  index("patients_practice_name_dob").on(t.practiceId, t.legalName, t.dob),
]);

export const externalPatientMappings = sqliteTable("external_patient_mappings", {
  id: text("id").primaryKey(),
  practiceId: text("practice_id").notNull().references(() => practices.id),
  patientId: text("patient_id").notNull().references(() => patients.id),
  sourceSystem: text("source_system").notNull(),
  externalPatientId: text("external_patient_id").notNull(),
  /** unverified | verified | needs_review — never auto-promote unverified. */
  verificationStatus: text("verification_status").notNull(),
  matchMethod: text("match_method").notNull(),
  reviewerId: text("reviewer_id"),
  verifiedAt: text("verified_at"),
  createdAt: text("created_at").notNull(),
}, t => [
  uniqueIndex("external_patient_namespace").on(t.practiceId, t.sourceSystem, t.externalPatientId),
  index("external_mappings_patient").on(t.patientId),
]);

export const respondents = sqliteTable("respondents", {
  id: text("id").primaryKey(),
  practiceId: text("practice_id").notNull().references(() => practices.id),
  patientId: text("patient_id").notNull().references(() => patients.id),
  displayName: text("display_name").notNull(),
  relationship: text("relationship").notNull(),
  /** patient | helper | staff_assisted — distinct from the patient identity. */
  completionRole: text("completion_role").notNull(),
  /** active | expired | revoked */
  authorizationStatus: text("authorization_status").notNull(),
  principalId: text("principal_id"),
  createdAt: text("created_at").notNull(),
}, t => [
  index("respondents_patient").on(t.patientId),
  index("respondents_principal").on(t.principalId),
]);

export const appointments = sqliteTable("appointments", {
  id: text("id").primaryKey(),
  practiceId: text("practice_id").notNull().references(() => practices.id),
  patientId: text("patient_id").notNull().references(() => patients.id),
  providerName: text("provider_name").notNull(),
  serviceName: text("service_name").notNull(),
  startsAt: text("starts_at").notNull(),
  timezone: text("timezone").notNull(),
  sourceSystem: text("source_system"),
  /** Null when the source export has no durable appointment ID — do not invent one. */
  externalAppointmentId: text("external_appointment_id"),
  revision: integer("revision").notNull().default(1),
  createdAt: text("created_at").notNull(),
}, t => [
  index("appointments_practice_starts").on(t.practiceId, t.startsAt),
  index("appointments_patient").on(t.patientId),
]);

/** Explicit optional link only — never created from a profile list name alone. */
export const profilePatientLinks = sqliteTable("profile_patient_links", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").notNull().references(() => profiles.id),
  patientId: text("patient_id").notNull().references(() => patients.id),
  linkedBy: text("linked_by").notNull(),
  createdAt: text("created_at").notNull(),
}, t => [uniqueIndex("profile_patient_link").on(t.profileId)]);

/**
 * Retained patient-reported changes. Never silently discontinue a prescription —
 * "no_longer_take" keeps the row; "added_by_mistake" suppresses with Undo.
 */
export const medicationChangeEvents = sqliteTable("medication_change_events", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  profileId: text("profile_id").notNull().references(() => profiles.id),
  medicationId: text("medication_id").notNull().references(() => medications.id),
  actorPrincipalId: text("actor_principal_id").notNull(),
  /** no_longer_take | added_by_mistake | undo_no_longer_take | undo_added_by_mistake */
  reason: text("reason").notNull(),
  priorData: text("prior_data").notNull(),
  priorSourceIds: text("prior_source_ids").notNull(),
  priorRevision: integer("prior_revision").notNull(),
  priorConfirmedRevision: integer("prior_confirmed_revision"),
  priorConfirmedAt: text("prior_confirmed_at"),
  priorListState: text("prior_list_state").notNull(),
  undoneAt: text("undone_at"),
  createdAt: text("created_at").notNull(),
}, t => [
  index("change_events_profile").on(t.ownerId, t.profileId),
  index("change_events_medication").on(t.medicationId),
]);

/** In-progress editor drafts for authenticated resume (not clinic delivery). */
export const editorDrafts = sqliteTable("editor_drafts", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  profileId: text("profile_id").notNull().references(() => profiles.id),
  principalId: text("principal_id").notNull(),
  /** Empty string for a new medication draft. */
  medicationId: text("medication_id").notNull(),
  draftJson: text("draft_json").notNull(),
  updatedAt: text("updated_at").notNull(),
}, t => [
  uniqueIndex("editor_draft_unique").on(t.ownerId, t.profileId, t.principalId, t.medicationId),
  index("editor_drafts_principal").on(t.principalId, t.profileId),
]);

/**
 * RxNorm normalization beside the medication row. Original label/source fields stay on medications.data.
 * mapping_status: unresolved | candidate | confirmed | unmatched | unavailable
 */
export const medicationTerminology = sqliteTable("medication_terminology", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  profileId: text("profile_id").notNull().references(() => profiles.id),
  medicationId: text("medication_id").notNull().references(() => medications.id),
  originalProductName: text("original_product_name").notNull(),
  originalStrength: text("original_strength").notNull(),
  originalFormulation: text("original_formulation").notNull(),
  queryText: text("query_text").notNull(),
  rxCui: text("rx_cui").notNull(),
  referenceName: text("reference_name").notNull(),
  tty: text("tty").notNull(),
  clinicalDrugRxCui: text("clinical_drug_rx_cui").notNull(),
  clinicalDrugName: text("clinical_drug_name").notNull(),
  ingredientRxCuis: text("ingredient_rx_cuis").notNull(),
  ingredientNames: text("ingredient_names").notNull(),
  strengthValue: text("strength_value").notNull(),
  strengthUnit: text("strength_unit").notNull(),
  dosageForm: text("dosage_form").notNull(),
  releaseCharacteristic: text("release_characteristic").notNull(),
  mappingStatus: text("mapping_status").notNull(),
  matchMethod: text("match_method").notNull(),
  terminologyVersion: text("terminology_version").notNull(),
  terminologyDate: text("terminology_date").notNull(),
  notesJson: text("notes_json").notNull(),
  reviewerPrincipalId: text("reviewer_principal_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, t => [
  uniqueIndex("medication_terminology_med").on(t.medicationId),
  index("medication_terminology_profile").on(t.ownerId, t.profileId),
]);

/** Non-patient terminology response cache (query hash only — never patient IDs). */
export const rxnormQueryCache = sqliteTable("rxnorm_query_cache", {
  queryHash: text("query_hash").primaryKey(),
  queryText: text("query_text").notNull(),
  responseJson: text("response_json").notNull(),
  fetchedAt: text("fetched_at").notNull(),
  expiresAt: text("expires_at").notNull(),
});

/**
 * Immutable clinic medication submissions. Local snapshots are not clinic delivery.
 * delivery_status: pending | received — receipt only after durable inbox ack.
 * staff_status: not_reviewed | needs_clarification | reviewed
 * aprima_status: not_entered | entered_manually (no write-back)
 */
export const clinicSubmissions = sqliteTable("clinic_submissions", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  profileId: text("profile_id").notNull().references(() => profiles.id),
  practiceId: text("practice_id").notNull().references(() => practices.id),
  patientId: text("patient_id").notNull().references(() => patients.id),
  appointmentId: text("appointment_id").notNull().references(() => appointments.id),
  respondentId: text("respondent_id"),
  recipientClinicName: text("recipient_clinic_name").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  payloadJson: text("payload_json").notNull(),
  medicationRevisionsJson: text("medication_revisions_json").notNull(),
  changeSummaryJson: text("change_summary_json").notNull(),
  emptyListAttested: integer("empty_list_attested").notNull(),
  deliveryStatus: text("delivery_status").notNull(),
  staffStatus: text("staff_status").notNull(),
  aprimaStatus: text("aprima_status").notNull(),
  submittedAt: text("submitted_at").notNull(),
  receivedAt: text("received_at"),
  reviewedAt: text("reviewed_at"),
  reviewerPrincipalId: text("reviewer_principal_id"),
  createdAt: text("created_at").notNull(),
}, t => [
  uniqueIndex("clinic_submission_request").on(t.ownerId, t.idempotencyKey),
  index("clinic_submissions_appointment").on(t.appointmentId),
  index("clinic_submissions_practice").on(t.practiceId, t.submittedAt),
]);

/** Durable staff inbox item created when the receiving outbox acks a submission. */
export const clinicInboxItems = sqliteTable("clinic_inbox_items", {
  id: text("id").primaryKey(),
  practiceId: text("practice_id").notNull().references(() => practices.id),
  submissionId: text("submission_id").notNull().references(() => clinicSubmissions.id),
  appointmentId: text("appointment_id").notNull().references(() => appointments.id),
  patientId: text("patient_id").notNull().references(() => patients.id),
  appointmentStartsAt: text("appointment_starts_at").notNull(),
  appointmentTimezone: text("appointment_timezone").notNull(),
  patientLegalName: text("patient_legal_name").notNull(),
  patientDob: text("patient_dob").notNull(),
  deliveryStatus: text("delivery_status").notNull(),
  staffStatus: text("staff_status").notNull(),
  aprimaStatus: text("aprima_status").notNull(),
  summaryJson: text("summary_json").notNull(),
  createdAt: text("created_at").notNull(),
}, t => [
  uniqueIndex("clinic_inbox_submission").on(t.submissionId),
  index("clinic_inbox_practice_starts").on(t.practiceId, t.appointmentStartsAt),
]);

/** Idempotent outbox for durable clinic receive/ack (not fee-ticket, not SMS). */
export const submissionOutbox = sqliteTable("submission_outbox", {
  id: text("id").primaryKey(),
  submissionId: text("submission_id").notNull().references(() => clinicSubmissions.id),
  idempotencyKey: text("idempotency_key").notNull(),
  /** pending | acked */
  status: text("status").notNull(),
  attempts: integer("attempts").notNull(),
  lastError: text("last_error"),
  createdAt: text("created_at").notNull(),
  ackedAt: text("acked_at"),
}, t => [
  uniqueIndex("submission_outbox_key").on(t.idempotencyKey),
  index("submission_outbox_status").on(t.status, t.createdAt),
]);

/**
 * Explainable duplicate / review flags. Never auto-merge or remove medications.
 * status: open | take_both | added_twice | unsure | staff_dismissed
 */
export const duplicateFlags = sqliteTable("duplicate_flags", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  profileId: text("profile_id").notNull().references(() => profiles.id),
  medicationAId: text("medication_a_id").notNull().references(() => medications.id),
  medicationBId: text("medication_b_id").notNull().references(() => medications.id),
  flagType: text("flag_type").notNull(),
  explanation: text("explanation").notNull(),
  evidenceJson: text("evidence_json").notNull(),
  status: text("status").notNull(),
  respondentPrincipalId: text("respondent_principal_id"),
  respondedAt: text("responded_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, t => [
  uniqueIndex("duplicate_flag_pair_type").on(t.profileId, t.medicationAId, t.medicationBId, t.flagType),
  index("duplicate_flags_profile").on(t.ownerId, t.profileId),
]);
