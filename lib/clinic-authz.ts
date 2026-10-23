/**
 * Server-side staff / patient / helper authorization.
 * Client headers such as X-Medcarry-View never grant access.
 */

import type { CompletionRole } from "./clinic-identity.ts";

export class AuthzError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "AuthzError";
  }
}

export type ProfileActor = "legacy_owner" | "staff" | "patient" | "helper" | "staff_assisted";

export type ProfileAccess = {
  profile: { id: string; name: string; created_at: string; owner_id: string };
  /** Storage owner for medications/uploads/snapshots — preserved profile owner_id. */
  dataOwnerId: string;
  actor: ProfileActor;
  practiceId: string | null;
  patientId: string | null;
  respondentId: string | null;
  /** Create lists, note import, NLM staff search, clinic staff tools. */
  canManageStaffTools: boolean;
};

type LinkRow = {
  patient_id: string;
  practice_id: string;
};

type RespondentRow = {
  id: string;
  completion_role: CompletionRole;
  authorization_status: string;
};

async function staffMembership(
  db: D1Database,
  practiceId: string,
  principalId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      "SELECT id FROM staff_memberships WHERE practice_id=? AND principal_id=? AND role='staff' LIMIT 1",
    )
    .bind(practiceId, principalId)
    .first<{ id: string }>();
  return Boolean(row);
}

export async function hasAnyStaffMembership(
  db: D1Database,
  principalId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      "SELECT id FROM staff_memberships WHERE principal_id=? AND role='staff' LIMIT 1",
    )
    .bind(principalId)
    .first<{ id: string }>();
  return Boolean(row);
}

export async function hasActiveRespondentBinding(
  db: D1Database,
  principalId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      "SELECT id FROM respondents WHERE principal_id=? AND authorization_status='active' LIMIT 1",
    )
    .bind(principalId)
    .first<{ id: string }>();
  return Boolean(row);
}

/**
 * Patient/helper-only sessions cannot use staff, import, or list-management APIs.
 * Legacy Sites owners with no clinic respondent binding keep prototype staff tools.
 * Staff membership always allows staff tools.
 */
export async function assertStaffToolsAllowed(
  db: D1Database,
  principalId: string,
): Promise<void> {
  if (await hasAnyStaffMembership(db, principalId)) return;
  if (await hasActiveRespondentBinding(db, principalId)) {
    throw new AuthzError(
      403,
      "Patient or helper sessions cannot use staff list, import, or clinic tools.",
    );
  }
}

/**
 * Authorize access to a medication list (profile).
 * Unlinked profiles: Sites owner only (legacy).
 * Linked profiles: practice staff membership or active respondent for that patient.
 */
export async function authorizeProfileAccess(
  db: D1Database,
  principalId: string,
  profileId: string,
): Promise<ProfileAccess> {
  const profile = await db
    .prepare("SELECT id,name,created_at,owner_id FROM profiles WHERE id=?")
    .bind(profileId)
    .first<{ id: string; name: string; created_at: string; owner_id: string }>();
  if (!profile) {
    throw new AuthzError(404, "This medication list was not found.");
  }

  const link = await db
    .prepare(
      `SELECT l.patient_id AS patient_id, p.practice_id AS practice_id
       FROM profile_patient_links l
       JOIN patients p ON p.id = l.patient_id
       WHERE l.profile_id=?`,
    )
    .bind(profileId)
    .first<LinkRow>();

  if (!link) {
    if (profile.owner_id !== principalId) {
      throw new AuthzError(404, "This medication list was not found.");
    }
    return {
      profile,
      dataOwnerId: profile.owner_id,
      actor: "legacy_owner",
      practiceId: null,
      patientId: null,
      respondentId: null,
      canManageStaffTools: true,
    };
  }

  if (await staffMembership(db, link.practice_id, principalId)) {
    return {
      profile,
      dataOwnerId: profile.owner_id,
      actor: "staff",
      practiceId: link.practice_id,
      patientId: link.patient_id,
      respondentId: null,
      canManageStaffTools: true,
    };
  }

  const respondent = await db
    .prepare(
      `SELECT id, completion_role, authorization_status
       FROM respondents
       WHERE practice_id=? AND patient_id=? AND principal_id=?
       LIMIT 1`,
    )
    .bind(link.practice_id, link.patient_id, principalId)
    .first<RespondentRow>();

  if (!respondent) {
    throw new AuthzError(404, "This medication list was not found.");
  }
  if (respondent.authorization_status !== "active") {
    throw new AuthzError(403, "This helper authorization is no longer active.");
  }

  const actor: ProfileActor =
    respondent.completion_role === "helper"
      ? "helper"
      : respondent.completion_role === "staff_assisted"
        ? "staff_assisted"
        : "patient";

  return {
    profile,
    dataOwnerId: profile.owner_id,
    actor,
    practiceId: link.practice_id,
    patientId: link.patient_id,
    respondentId: respondent.id,
    canManageStaffTools: false,
  };
}

/** Authorize a photo by resolving its profile, not by trusting client role headers. */
export async function authorizeUploadAccess(
  db: D1Database,
  principalId: string,
  uploadId: string,
): Promise<ProfileAccess & { upload: { id: string; object_key: string; mime_type: string; profile_id: string; owner_id: string } }> {
  const upload = await db
    .prepare(
      "SELECT id,object_key,mime_type,profile_id,owner_id FROM uploads WHERE id=?",
    )
    .bind(uploadId)
    .first<{
      id: string;
      object_key: string;
      mime_type: string;
      profile_id: string;
      owner_id: string;
    }>();
  if (!upload) throw new AuthzError(404, "Photo not found.");
  const access = await authorizeProfileAccess(db, principalId, upload.profile_id);
  if (upload.owner_id !== access.dataOwnerId) {
    throw new AuthzError(404, "Photo not found.");
  }
  return { ...access, upload };
}

/** Profiles visible in bootstrap: owned legacy lists plus clinic-linked authorized lists. */
export async function listAccessibleProfiles(
  db: D1Database,
  principalId: string,
): Promise<{ id: string; name: string; created_at: string }[]> {
  const owned = await db
    .prepare(
      "SELECT id,name,created_at FROM profiles WHERE owner_id=? ORDER BY created_at LIMIT 12",
    )
    .bind(principalId)
    .all<{ id: string; name: string; created_at: string }>();

  const linked = await db
    .prepare(
      `SELECT pr.id, pr.name, pr.created_at
       FROM profile_patient_links l
       JOIN patients pat ON pat.id = l.patient_id
       JOIN profiles pr ON pr.id = l.profile_id
       WHERE EXISTS (
         SELECT 1 FROM staff_memberships s
         WHERE s.practice_id = pat.practice_id AND s.principal_id = ? AND s.role = 'staff'
       )
       OR EXISTS (
         SELECT 1 FROM respondents r
         WHERE r.practice_id = pat.practice_id
           AND r.patient_id = pat.id
           AND r.principal_id = ?
           AND r.authorization_status = 'active'
       )
       ORDER BY pr.created_at
       LIMIT 12`,
    )
    .bind(principalId, principalId)
    .all<{ id: string; name: string; created_at: string }>();

  const seen = new Set<string>();
  const out: { id: string; name: string; created_at: string }[] = [];
  for (const row of [...owned.results, ...linked.results]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
    if (out.length >= 12) break;
  }
  return out;
}
