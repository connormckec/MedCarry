/**
 * Fictional Innovation Cardiology fixtures for local development and tests.
 * Not real patients. Do not treat as verified Aprima records.
 */

export const LOCAL_MOCK_PRINCIPAL_ID = "local_seedy";
/** Test-only patient/helper principals (not Sites mock cookies; used in API tests). */
export const SYNTHETIC_PATIENT_PRINCIPAL_ID = "local_patient_alice";
export const SYNTHETIC_HELPER_PRINCIPAL_ID = "local_helper_dana";

export const SYNTHETIC = {
  practiceId: "a1111111-1111-4111-8111-111111111111",
  practiceName: "Innovation Cardiology (synthetic)",
  /** Second practice for cross-clinic denial tests (created by tests when needed). */
  otherPracticeId: "a1111111-1111-4111-8111-111111111122",
  aliceProfileId: "a7777777-7777-4777-8777-777777777701",
  aliceProfileLinkId: "a8888888-8888-4888-8888-888888888801",
  patients: {
    aliceA: {
      id: "a2222222-2222-4222-8222-222222222201",
      legalName: "Alice Example",
      dob: "1948-03-12",
      postalCode: "02115",
    },
    aliceB: {
      id: "a2222222-2222-4222-8222-222222222202",
      legalName: "Alice Example",
      dob: "1955-07-04",
      postalCode: "10001",
    },
    bob: {
      id: "a2222222-2222-4222-8222-222222222203",
      legalName: "Bob Example",
      dob: "1948-03-12",
      postalCode: null as string | null,
    },
  },
  mappingAliceA: {
    id: "a5555555-5555-4555-8555-555555555501",
    sourceSystem: "aprima",
    externalPatientId: "SYN-APRIMA-1001",
    verificationStatus: "unverified" as const,
    matchMethod: "synthetic_fixture",
  },
  appointmentAliceA: {
    id: "a3333333-3333-4333-8333-333333333301",
    providerName: "Dr. Demo Cardiologist",
    serviceName: "Office follow-up",
    startsAt: "2026-11-03T14:30:00-05:00",
    timezone: "America/New_York",
    sourceSystem: "synthetic",
    externalAppointmentId: null as string | null,
  },
  respondentSelf: {
    id: "a4444444-4444-4444-8444-444444444401",
    displayName: "Alice Example",
    relationship: "self",
    completionRole: "patient" as const,
    authorizationStatus: "active" as const,
  },
  respondentHelper: {
    id: "a4444444-4444-4444-8444-444444444402",
    displayName: "Dana Example",
    relationship: "daughter",
    completionRole: "helper" as const,
    authorizationStatus: "active" as const,
    patientIdKey: "aliceA" as const,
  },
  staffMembershipId: "a6666666-6666-4666-8666-666666666601",
} as const;
