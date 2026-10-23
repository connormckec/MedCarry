import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import {
  assertStaffToolsAllowed,
  authorizeProfileAccess,
  AuthzError,
} from "../lib/clinic-authz.ts";
import { ensureSyntheticClinic } from "../lib/clinic-api.ts";
import {
  LOCAL_MOCK_PRINCIPAL_ID,
  SYNTHETIC,
  SYNTHETIC_PATIENT_PRINCIPAL_ID,
} from "../lib/synthetic-clinic.ts";

const migrations = new URL("../drizzle/", import.meta.url);
const ddl = readdirSync(migrations)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(new URL(f, migrations), "utf8"))
  .join("\n");

function db() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(ddl);
  const DB = {
    prepare(sql) {
      return {
        bind(...args) {
          const s = sqlite.prepare(sql);
          return {
            async first() {
              return s.get(...args) || null;
            },
            async all() {
              return { results: s.all(...args) };
            },
            async run() {
              const r = s.run(...args);
              return { meta: { changes: Number(r.changes) } };
            },
          };
        },
      };
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const s of statements) results.push(await s.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
  };
  return { DB, sqlite };
}

test("legacy unlinked profiles remain owner-only", async () => {
  const { DB, sqlite } = db();
  const now = new Date().toISOString();
  sqlite
    .prepare("INSERT INTO profiles (id,owner_id,name,created_at) VALUES (?,?,?,?)")
    .run("a9999999-9999-4999-8999-999999999901", "owner", "Private list", now);
  const access = await authorizeProfileAccess(
    DB,
    "owner",
    "a9999999-9999-4999-8999-999999999901",
  );
  assert.equal(access.actor, "legacy_owner");
  assert.equal(access.canManageStaffTools, true);
  await assert.rejects(
    () =>
      authorizeProfileAccess(DB, "stranger", "a9999999-9999-4999-8999-999999999901"),
    (e) => e instanceof AuthzError && e.status === 404,
  );
  sqlite.close();
});

test("linked profile requires staff membership or active respondent", async () => {
  const { DB, sqlite } = db();
  await ensureSyntheticClinic(DB, LOCAL_MOCK_PRINCIPAL_ID);
  const staff = await authorizeProfileAccess(
    DB,
    LOCAL_MOCK_PRINCIPAL_ID,
    SYNTHETIC.aliceProfileId,
  );
  assert.equal(staff.actor, "staff");
  const patient = await authorizeProfileAccess(
    DB,
    SYNTHETIC_PATIENT_PRINCIPAL_ID,
    SYNTHETIC.aliceProfileId,
  );
  assert.equal(patient.actor, "patient");
  assert.equal(patient.canManageStaffTools, false);
  await assert.rejects(
    () => assertStaffToolsAllowed(DB, SYNTHETIC_PATIENT_PRINCIPAL_ID),
    (e) => e instanceof AuthzError && e.status === 403,
  );
  sqlite.close();
});
