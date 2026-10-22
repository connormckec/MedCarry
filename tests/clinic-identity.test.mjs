import test from "node:test";
import assert from "node:assert/strict";
import {
  parseDateOnly,
  normalizePostalCode,
  proposePatientMatch,
  postalCodeSupportsMatch,
  completionLabel,
  assertActiveAuthorization,
  buildMatchingStatus,
  ClinicIdentityError,
} from "../lib/clinic-identity.ts";
import { SYNTHETIC } from "../lib/synthetic-clinic.ts";

const aliceA = {
  id: SYNTHETIC.patients.aliceA.id,
  practiceId: SYNTHETIC.practiceId,
  legalName: SYNTHETIC.patients.aliceA.legalName,
  dob: SYNTHETIC.patients.aliceA.dob,
  postalCode: SYNTHETIC.patients.aliceA.postalCode,
};
const aliceB = {
  id: SYNTHETIC.patients.aliceB.id,
  practiceId: SYNTHETIC.practiceId,
  legalName: SYNTHETIC.patients.aliceB.legalName,
  dob: SYNTHETIC.patients.aliceB.dob,
  postalCode: SYNTHETIC.patients.aliceB.postalCode,
};
const bob = {
  id: SYNTHETIC.patients.bob.id,
  practiceId: SYNTHETIC.practiceId,
  legalName: SYNTHETIC.patients.bob.legalName,
  dob: SYNTHETIC.patients.bob.dob,
  postalCode: SYNTHETIC.patients.bob.postalCode,
};

test("DOB is date-only and rejects impossible calendar days", () => {
  assert.equal(parseDateOnly("1948-03-12"), "1948-03-12");
  assert.throws(() => parseDateOnly("1948-03-12T00:00:00Z"), ClinicIdentityError);
  assert.throws(() => parseDateOnly("2026-02-30"), ClinicIdentityError);
});

test("postal codes stay strings and keep leading zeros", () => {
  assert.equal(normalizePostalCode("02115"), "02115");
  assert.equal(normalizePostalCode("  10001 "), "10001");
  assert.equal(normalizePostalCode(""), null);
  assert.equal(normalizePostalCode(null), null);
});

test("same legal name with different DOBs remain separate patients", () => {
  const proposal = proposePatientMatch({
    patients: [aliceA, aliceB, bob],
    legalName: "Alice Example",
    dob: "1948-03-12",
  });
  assert.equal(proposal.status, "unique");
  assert.deepEqual(proposal.patientIds, [aliceA.id]);
});

test("identical name and DOB across multiple charts stays ambiguous for staff", () => {
  const twin = { ...aliceA, id: "a2222222-2222-4222-8222-222222222299" };
  const proposal = proposePatientMatch({
    patients: [aliceA, twin],
    legalName: "Alice Example",
    dob: "1948-03-12",
    postalCode: "02115",
  });
  assert.equal(proposal.status, "ambiguous");
  assert.equal(proposal.patientIds.length, 2);
  assert.equal(postalCodeSupportsMatch(aliceA, "02115"), true);
  assert.equal(
    postalCodeSupportsMatch(aliceA, "02115") && proposal.status === "ambiguous",
    true,
    "ZIP must not resolve ambiguity automatically",
  );
});

test("unverified external mappings never authenticate or auto-attach", () => {
  const proposal = proposePatientMatch({
    patients: [aliceA, aliceB],
    externalPatientId: SYNTHETIC.mappingAliceA.externalPatientId,
    mappings: [
      {
        patientId: aliceA.id,
        externalPatientId: SYNTHETIC.mappingAliceA.externalPatientId,
        verificationStatus: "unverified",
      },
    ],
  });
  assert.equal(proposal.status, "none");
  assert.equal(buildMatchingStatus({ verificationStatus: "unverified" }), "unverified_mapping");
});

test("verified external ID can propose a unique candidate without merging", () => {
  const proposal = proposePatientMatch({
    patients: [aliceA, aliceB],
    externalPatientId: "SYN-APRIMA-1001",
    mappings: [
      {
        patientId: aliceA.id,
        externalPatientId: "SYN-APRIMA-1001",
        verificationStatus: "verified",
      },
    ],
  });
  assert.equal(proposal.status, "unique");
  assert.equal(proposal.reason, "external_id");
  assert.deepEqual(proposal.patientIds, [aliceA.id]);
});

test("helpers are labeled distinctly from the patient", () => {
  assert.equal(completionLabel("patient"), "Patient");
  assert.equal(completionLabel("helper"), "Authorized helper");
  assert.equal(completionLabel("staff_assisted"), "Staff-assisted");
  assert.throws(() => assertActiveAuthorization("revoked"), ClinicIdentityError);
  assert.throws(() => assertActiveAuthorization("expired"), ClinicIdentityError);
});

test("list-name style input alone cannot invent a patient match", () => {
  const proposal = proposePatientMatch({
    patients: [aliceA, aliceB, bob],
    legalName: "My medication list",
  });
  assert.equal(proposal.status, "none");
});
