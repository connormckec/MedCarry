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
