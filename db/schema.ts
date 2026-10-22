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
  createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, t => [index("medications_owner").on(t.ownerId, t.profileId)]);

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
