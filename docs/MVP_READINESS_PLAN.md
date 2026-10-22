# MedCarry: Cursor handoff and MVP readiness plan

Prepared for Connor McKechnie, Innovation Cardiology, October 22, 2026.

This is a proposed implementation plan. It does not implement patient demographics, new access controls, medication duplicate detection, SMS, a fee-ticket integration, or an Aprima connection. The source baseline is commit `0ee247ac88fa42d09fc54a75894b92f44f14c083`. Any additional work in Cursor should begin by inspecting the actual current repository.

## 1. What the MVP should accomplish

An enrolled patient opens a clinic link, checks an existing medication list, photographs only new or changed products, confirms what they actually take, and submits a dated report to an authorized staff queue. Staff verify the patient and respondent, review changes and uncertainty, and reconcile the result into Aprima. No app installation should be required.

The staff workspace is an appointment-oriented reconciliation inbox. The patient task is a short pre-visit check. Both use the same medication rules, but their privileges and screens must be separate.

Use three release gates:

| Gate | Allowed use | Evidence required |
| --- | --- | --- |
| A: Phone prototype | Connor/staff try fictional records on phones | Camera/upload/manual paths and layouts work; current private access remains intact |
| B: End-to-end staging | Test staff and test patients use synthetic appointments and messages | Real authentication, authorization, draft recovery, delivery receipts, patient matching, and review workflow pass |
| C: Limited clinical pilot | A small, approved group of actual clinic patients | Clinic privacy/security arrangements, named operational owners, tested clinical workflow, monitoring and recovery, plus all staging acceptance gates |

Do not equate a passing build, a collection of unit tests, or a private URL with Gate C.

## 2. What is already present

The current code has React/TypeScript patient screens and a staff workspace, camera access, upload and manual alternatives, browser OCR, private source-photo storage, structured medication fields, source evidence, prior-note paste/photo import, explicit per-medication confirmation, revision checks, and immutable dated snapshots. The existing automated suite has 70 tests covering medication validation, imports, ownership, transactions, and snapshot gates. These are not a real-label accuracy benchmark or a complete phone end-to-end test.

Important gaps found in code:

- `profiles` stores a list ID, owner ID, name, and creation date. It has no DOB, postal code, clinic patient mapping, appointment, respondent, or real staff/patient role model.
- RxNorm is a manually initiated `getDrugs` lookup. It saves a selected RxCUI/reference name. It does not yet normalize each record or detect medication duplicates.
- Import rejects repeated normalized name-plus-strength strings. This is not brand/generic or ingredient-aware duplicate review.
- Patient removal already exists under **More options** in the editor. The API deletes the current medication row and records a removal event; prior snapshots retain their copies. It is not yet the retained, undoable removal workflow proposed below.
- Patients can report stopped/held/unsure status. Those reports are distinct from a clinician changing a prescription.
- The finish button currently saves a snapshot using the list name and a demonstration recipient. It does not deliver a clinical submission to a practice inbox or update Aprima.
- Saved records persist; incomplete in-editor work is not a complete autosave/resume workflow.
- Staff and patient routes share an owner-authenticated backend. Removing navigation links did not implement separate roles.
- The empty-list snapshot gate currently rejects zero entries. An explicit, reviewed **I take no medications or supplements** submission needs its own representation.

## 3. Patient identity and the person completing the form

Create separate records for the patient and the respondent. A patient's daughter completing a form is not the same entity as the patient. A typed respondent name is an attestation, not verified authentication.

### Staff display

In the protected patient detail header, show:

- Patient legal name and DOB, formatted clearly.
- Aprima patient ID/MRN when verified and available.
- Primary-address ZIP as optional supporting context, with source and last-updated date.
- Appointment date/time and provider.
- Completed by: patient, authorized helper, or staff-assisted; respondent name and relationship when relevant.
- Submitted time, source baseline date, and matching/review status.

The queue row needs only name, DOB, appointment, submission status, and changes/flags. Put ZIP and respondent details in the expanded record to keep the workspace small.

### Matching rules

1. Create a stable internal patient UUID. Record external identifiers with their clinic and source-system namespace. A unique key should include clinic, source system, and external patient ID.
2. Prefer a verified Aprima identifier. Conflicting demographics still require review; a source ID is not a reason to ignore a DOB mismatch.
3. If no source ID exists, normalized name plus exact DOB may propose a match. Staff must resolve ambiguous, missing, or conflicting identifiers. Preserve original spelling and support corrected names.
4. ZIP is secondary evidence. An address changes, people share ZIPs, and a missing ZIP must not stop an otherwise verified patient. Store postal codes as strings so leading zeros survive.
5. DOB is a date-only value, not a timestamp. Do not shift it across time zones. Clinic appointment times use America/New_York with daylight-saving handling.
6. A phone number, DOB, ZIP, or a matching name does not authenticate a patient. Bind access to the server-authorized patient and appointment established by enrollment and authentication.
7. Send uncertain matches to a **Needs matching** queue. Never silently attach or merge clinical history based on fuzzy demographics.
8. Correcting a mistaken match must preserve an audit trail and review affected submissions. Do not silently relabel an already submitted clinical document as belonging to another patient.

For the patient, use the enrollment data already known to the clinic. Do not make them recreate an entire demographic profile at each visit. Display identity information only after appropriate authentication; provide a clear wrong-person/help route.

## 4. Removal and stopped medications

Use patient language that records their report:

- **I no longer take this**: retains the medication and marks a patient-reported change for clinic review.
- **I added this by mistake**: removes an accidental entry from the active draft, with Undo.
- **This is listed twice**: opens a duplicate comparison without deciding treatment.

Keep these actions under a predictable **Change** action for each medicine. Avoid displaying a delete icon beside every medication on the home screen.

Replace current-row deletion in the clinical workflow with retained change/removal records. Record actor, reason, time, source record, revision, and prior values. An accidental draft entry can be suppressed; an imported chart medicine remains visible in the staff changes view. Old snapshots stay immutable. Undo restores the appropriate draft state and invalidates stale confirmation.

Never label the action **Stop taking**. The app is recording what the patient reports, not issuing instructions or discontinuing an Aprima prescription. Clinicians retain reconciliation responsibility.

Acceptance: a patient can report a stopped medication in a few taps; staff can see the original chart entry and proposed change; accidental removal is recoverable; concurrent changes do not silently overwrite each other.

## 5. RxNorm and duplicate review

RxNorm is a terminology foundation. Duplicate logic must be implemented around it; identity matching is not an interaction checker or prescribing decision.

### Normalization service

1. Preserve the original name, strength, formulation, source text/photo, and dates.
2. Produce a search query from the product name plus known strength and formulation. Send only medication terminology to NLM, never patient demographics, a full note, or label OCR containing identifiers.
3. Try exact/normalized lookup before approximate matching. Use approximate results to propose candidates; a ranking score is not a clinically calibrated probability.
4. Retrieve the selected concept and its relevant generic/ingredient/form relationships. Distinguish ingredient, clinical drug, branded drug, and pack concepts. Do not compare arbitrary RxCUIs as if they always describe the same level of specificity.
5. Store the selected RxCUI, appropriate generic clinical-drug mapping, ingredient components, strengths with units/concentration denominator, dosage form, and release characteristics where supported. Preserve source-specific salt/strength semantics rather than guessing equivalence.
6. Store mapping status, match method, terminology version/date, and reviewer. States include unresolved, candidate, confirmed, and unmatched/manual.
7. Verify reference identity on the server. The present numeric-string check is insufficient. Editing identity fields invalidates prior normalization and confirmation.
8. Cache terminology responses by non-patient query/concept, handle timeouts, and support manual continuation. Plan for inactive/remapped concepts and refresh behavior.

### Flag types

| Relationship | MVP behavior |
| --- | --- |
| Same confirmed generic clinical product, same strength/form/release, repeated records | Possible duplicate entry; compare evidence and instructions |
| Brand and generic mapped to the same clinical product | Same duplicate comparison, preserving original label names |
| Same ingredient, different strength or schedule | Review flag; may be an intentional regimen |
| Same ingredient, different formulation or release | Review flag; do not combine |
| Ingredient overlap with a combination product | Ingredient-overlap flag for staff; not an instruction to stop or merge |
| No dependable code or supplement match | Keep manual data and uncertainty; do not claim the list was cleared of duplicates |

Example test cases should include Eliquis/apixaban at the same strength/form, metoprolol tartrate versus succinate extended release, two intentional strengths used on different days, and an OTC ingredient appearing in a combination product. Use verified NLM fixtures rather than invented RxCUIs.

Compare records within the authorized patient's list. Do not flag an updated photo of the same stable medication record as a second medication. Run review after an addition/import, after an identity edit, and before submission.

Patient copy: **This may already be on your list.** Show both names/strengths with **I take both**, **I added one twice**, and **I'm not sure**. Capture the answer and preserve both sources. Staff review unresolved flags; do not block a patient forever because they are unsure. Do not silently merge or remove records.

Supplements stay label-based in the MVP. A separate reference source such as NIH's Dietary Supplement Label Database could be evaluated later. It does not turn supplement composition into a fully validated duplicate or safety check.

Acceptance: exact repeated products can be flagged; different strengths and release forms remain distinct; unresolved cases remain visible; NLM downtime cannot lose a draft or force a guessed identity; staff can explain why each flag appeared.

## 6. Aprima input without assuming an API

CGM publishes an Aprima-capable FHIR guide and an EHI export guide. The FHIR guide documents MedicationRequest and a registration/connector process through the account executive. The EHI guide documents an Active Medication CSV with patient identity, medication dates, NDC, product, strength, formulation, quantity, route, and frequency. These published capabilities do not establish what Innovation Cardiology has enabled, the current cost, permitted access mode, or workflow speed.

Recommended discovery sequence:

1. Have the clinic's Aprima administrator identify the deployed version, enabled connectors, export permissions, and current reminder service.
2. Obtain a synthetic/example medication export and inspect the actual headers and value conventions. Ask whether a medication-only export with patient IDs is available, and how much staff time it takes.
3. Ask CGM whether the practice can enable the documented FHIR access for this workflow. Verify patient-facing authorization versus staff/backend access, required scopes, any bulk access, sandbox access, onboarding, terms, charges, and operational support. Do not assume appointment scheduling or write-back is included.
4. Pick one baseline adapter for the first pilot: practical medication CSV export if available; otherwise the existing pasted note section. A reviewed C-CDA medication section is another candidate when the practice can readily export it.
5. Treat all imported chart data as a dated baseline. An EHR prescription/order and the patient's current use remain separate. Preserve inactive dates, status, direction text, and source IDs. Missing fields remain missing.

Do not ingest a full EHI archive merely to obtain medications if a narrower export is practical. The documented export can contain unrelated sensitive fields, including Social Security numbers. Use an allowlist of needed fields and a controlled retention policy. If a full archive is necessary for a test adapter, perform selection in the approved environment, restrict archive formats/paths/expanded size, and discard unneeded content appropriately.

The first pilot output can be a clearly labeled change summary and medication report manually reconciled into Aprima by authorized clinic staff. This is a working receiving process, not automatic EHR write-back. Track who entered/reconciled it and when. FHIR integration can follow once access is confirmed.

## 7. How to connect the digital fee ticket

The saved September 26 fee-ticket brief is a proposed extension, not proof of the current repository's behavior. It describes sample Aprima schedule PDFs with names and DOBs but no visible MRN or source appointment IDs. The brief also warns that an existing patients table may not be a durable cross-visit identity registry. Inspect `ICG-Fee-Ticket` before relying on its schema or identity model. No current medication feed was established by this review.

Use the fee ticket as the visit launch point and status consumer:

1. Import/verify the appointment and patient mapping.
2. Open **Medication check** from that visit. Pass an internal reference through an authorized server integration, not patient name/DOB in a browser URL.
3. MedCarry creates or resumes the appointment-bound review and consumes a separately sourced chart medication baseline.
4. On submission, send a versioned event with stable IDs, submission ID, time, and status to the fee-ticket server. Do not duplicate full medication data into every realtime event.
5. Show Not started, In progress, Submitted, and Staff reviewed as distinct states. A viewed link is not submission; submission is not clinical reconciliation.

Suggested contract: clinic ID, stable patient ID, verified external mapping reference, internal appointment ID, source system, external appointment ID if actually available, appointment revision, and submission ID. Do not invent source IDs when a PDF lacks them.

Preserve separate echo and provider appointment records. A medication submission may be reused as a dated report under clinic policy, but completing the medication task must not check in, finish, cancel, charge, or merge either appointment or fee ticket. Handle cancellation, rescheduling, duplicate events, retries, stale versions, and correction of a patient link.

Keep MedCarry independently usable if the fee ticket is paused. Reuse a verified identity contract and approved infrastructure where useful; avoid making a medication check depend on a billing-system rewrite.

## 8. Staff workspace and submission

Start on today's appointment inbox, with one primary **Review** action per submitted report. Show counts and a small set of filters only when they help staff find work.

The detail page should show the identity/respondent header, a dated baseline, the patient's report, and grouped changes: added, patient says stopped/held, different amount/schedule, possible duplicate, and unsure. Preserve the original source beside the changed field rather than silently overwriting it.

Keep three state sets separate:

- Patient review: not started, in progress, submitted.
- Staff reconciliation: not reviewed, needs clarification, reviewed.
- Aprima handling: not entered, entered/attached manually, or later a verified integration result.

In the clinical version, name the receiving clinic. **Send my list to Innovation Cardiology** should create an immutable submission and a durable inbox item atomically or through an idempotent outbox. Show **Received by the clinic** only after the relevant receiving service acknowledges receipt; reserve **Reviewed** for an actual authorized staff action. Retry safely without duplicate inbox items.

The patient can submit explicitly acknowledged uncertainty for staff help. Every included entry still needs current-revision confirmation. Record the empty-list attestation when the patient reports taking no medications, OTC products, vitamins, or supplements. Preserve removed baseline entries in the change report.

## 9. Data model additions

These are proposed entities; exact tables and migrations should follow the selected runtime/database and existing code.

| Entity | Minimum purpose |
| --- | --- |
| Practices and memberships | Clinic boundary; staff roles and access |
| Patients | Stable ID, legal names, date-only DOB, optional primary-address postal code |
| External patient mappings | Clinic/source namespace, Aprima ID, match provenance, reviewer, verification time |
| Contacts and communication preferences | Verified contact, shared-phone handling, consent/preferences and opt-out |
| Respondents and proxy authorizations | Authenticated actor, patient relationship, permission scope and lifecycle |
| Appointments | Independent stable ID, patient, provider/service, time/timezone, source reference and revision |
| Review episodes | Patient/visit binding, baseline version, draft progress, none-reported attestation |
| Source medication evidence | Original chart/label values, source record, dates and retained source text/photo |
| Reported medications and revisions | Product identity separately from label directions and patient-reported use |
| Terminology mappings | RxCUI/generic concept, structured identity, mapping status, version and reviewer |
| Removal/change events | Retained original values, reason, actor, timestamp, Undo history |
| Duplicate flags and decisions | Compared record revisions, relationship/reason, response and staff resolution |
| Submissions and submission items | Immutable patient/visit/identity snapshot, exact medication revisions and recipient |
| Clinical review events | Authorized reviewer, clarifications, reconciliation and Aprima handling |
| Invitations, sessions and outbox | Scoped access and reliable reminders/delivery |

Use additive migrations. Map existing prototype profiles explicitly into the new patient model; do not auto-promote arbitrary list names into verified patient identities. Preserve existing snapshot data and source ownership.

## 10. Runtime and authorization decision

Cursor is the editor and GitHub stores source. Neither replaces application hosting, storage, authentication, or deployment.

Retain the React/TypeScript UI and medication validation. Isolate platform dependencies behind identity, data, source-storage, terminology, and messaging services before considering a framework rewrite.

For an external clinical runtime, select infrastructure with the clinic's IT/privacy owner. Two reasonable paths are keeping the Worker/SQL/object-storage model with an appropriate independent identity service, or adapting persistence to the clinic-approved Postgres stack used by the fee ticket if that infrastructure is actually ready. Do not select a vendor or migrate databases merely because an earlier prototype used it. Check service/plan-specific contracts, access, backup, support, and costs before committing.

The current local development plugin provides loopback-only mock sign-in in the portable development profile. It is intentionally not a public patient identity system. A phone on the LAN is not localhost, and simply adding a tunnel does not produce a valid deployment of the protected app. Do not weaken that restriction to make a demo work. Use the existing hosted private URL for immediate phone tests, or deploy a properly authenticated HTTPS staging environment.

Real patient/staff separation needs a server-verified principal, clinic membership, patient/proxy binding, and role checks on every endpoint and photo read. Hiding staff links is only UI separation. Staff accounts should use the clinic-approved identity system and appropriate MFA; patient access must use the clinic-approved enrollment/authentication approach.

## 11. Invitations, recovery, and minimal patient work

Use the practice's approved reminder channel if it can carry the correct link. A future dedicated sender should use a generic practice-branded message with no medication names or demographics.

- Bind high-entropy invitations server-side to clinic, patient/authorized respondent, appointment, allowed action, expiry, and revocation. Store token digests.
- Keep the invitation lifetime separate from short-lived authentication challenges and sessions. Preview scanners must not authenticate, disclose records, consume invitations, or trigger message bursts.
- DOB/ZIP are matching context, not sufficient access secrets. A link plus a code to the same phone is not two independent authentication factors. Resolve shared phones, changed numbers, and authorized helpers with the clinic's identity policy.
- Use server-managed Secure/HttpOnly cookies, CSRF/origin protections, no-store responses, replay protection, bounded attempts, rate limits, and audit records.
- Autosave drafts at useful step boundaries and after meaningful edits. Show a small Saved/retry state. Resume only within an authenticated patient/visit session.
- Handle expired links, denied camera permissions, cancelled pickers, failed uploads, unreadable labels, lost connectivity, and session expiry without sending the patient back to re-enter everything.
- Ask adherence questions only as optional follow-up; do not put them in the critical path to submitting a medication list.

The detailed existing `docs/TEXT_LINK_PATIENT_FLOW.md` is the starting security design, not an implemented SMS feature.

## 12. Exact Cursor setup

1. Download and extract the source bundle. Open its `MedCarry` folder in Cursor. The new plan is included as `docs/MVP_READINESS_PLAN.md`.
2. Read `AGENTS.md`, `README.md`, `docs/CURSOR_HANDOFF.md`, `docs/MVP_WORKFLOW.md`, and this plan. Keep `.cursor/rules/medcarry.mdc` in the project.
3. Use Node 24 or another verified version meeting the project's minimum. Install the package manager version pinned by the project:

   ```sh
   npm install --global pnpm@11.25.0
   pnpm install --frozen-lockfile
   pnpm typecheck
   pnpm test
   pnpm dev
   ```

4. Open `http://localhost:5173/wireframes` for the self-contained design study. Local protected-app work also needs the supported mock sign-in/local database setup; that behavior is not patient authentication.
5. Set up a private GitHub repository. The download has no Git history, so initialize Git if opening that extracted folder. Do not copy runtime secrets or databases into it. Replace the remote placeholder with the exact empty repository URL from your own GitHub account:

   ```sh
   git init -b main
   git add .
   git commit -m "Import MedCarry prototype and MVP readiness plan"
   git remote add origin <exact-private-repository-URL>
   git push -u origin main
   ```

   If you already have a GitHub checkout, make a feature branch and import the reviewed source changes instead of reinitializing Git or overwriting that repository blindly.
6. Choose and document the target staging runtime and independent identity boundary before asking Cursor to deploy outside Sites. A GitHub push does not automatically update the currently hosted Site.
7. Use synthetic fixtures in code, issue descriptions, screenshots, AI prompts, and CI. Keep real clinic exports out of source control and coding-assistant context unless a separately approved arrangement explicitly covers them.
8. Work in small branches/changes with the acceptance gates below. Preserve the existing design and clinical-data distinctions.

### First prompt to paste into Cursor

> Read AGENTS.md, README.md, docs/CURSOR_HANDOFF.md, docs/MVP_WORKFLOW.md, docs/TEXT_LINK_PATIENT_FLOW.md, and docs/MVP_READINESS_PLAN.md. Inspect the current medication API, schema, tests, identity implementation, and source storage. Preserve the existing three-step patient UI and all ownership/revision/snapshot gates. First report which parts are tied to Sites and what a separately authenticated HTTPS staging deployment requires. Implement only the first bounded foundation slice after that inspection: additive, synthetic-data patient/appointment/respondent models and the minimal staff identity header, with explicit unverified external mappings and no automatic merges. Do not connect real Aprima, SMS, the fee ticket, or clinical records in this slice. Do not remove authentication, expose mock sign-in publicly, or rewrite the UI/framework. Add meaningful authorization/matching/date tests where behavior is introduced, run the existing checks, and report precisely what is implemented, tested, and still blocked. Subsequent slices follow the numbered work plan and their acceptance gates.

## 13. Ordered implementation work

| Order | Bounded task | Dependency | Done when |
| --- | --- | --- | --- |
| 0 | Test current private site on phone with fictional labels | Existing owner account | Camera/upload/manual routes and completion observed; device defects recorded |
| 1 | Inventory runtime dependencies; choose approved staging architecture | Clinic technical owner | Identity, database, storage, SMS, deployment and rollback choices documented |
| 2 | Add practice/patient/appointment/respondent records and mappings | 1 | DOB/date/ZIP rules and ambiguity tests pass; no list-name-based identity promotion |
| 3 | Enforce staff/patient/proxy authorization | 2 | Cross-patient/clinic/photo access rejected; patient cannot call staff/import/list endpoints |
| 4 | Add autosave/resume and retained removal/change history | 2-3 | Lost connection and Undo preserve evidence; edits invalidate confirmation |
| 5 | Implement one reviewed Aprima baseline adapter | Actual synthetic export and 2-3 | Same file re-import is idempotent; mismatches stop import; provenance survives |
| 6 | Normalize medication identity through RxNorm and flag duplicates | 4-5 | Reference fixtures and distinct-strength/release cases pass; manual outage path works |
| 7 | Build immutable submissions and the appointment-oriented staff inbox | 3-6 | Receipt follows durable delivery; every change/uncertainty visible; empty-list attestation works |
| 8 | Add enrolled patient invitation/session flow and real reminder service | 3, 7 and approved communications | Expiry/replay/shared-phone/cancel/reschedule/opt-out tests pass |
| 9 | Add fee-ticket launch/status adapter | Verified fee-ticket schema/IDs and 7 | Retried events do not duplicate reports or change visit/billing progress |
| 10 | Run device/usability/operational evaluation and restore drill | 0-9 | Defined pilot entry criteria signed off; monitoring/fallback and rollback work |

Steps 5 and 9 must not be blocked forever waiting for a full FHIR contract. A reviewed pasted baseline and an independent staff inbox can support the limited first workflow while integration discovery proceeds.

## 14. Verification matrix

### Identity and access

- Two patients with identical names and different DOBs remain separate.
- Identical name/DOB with multiple candidate charts requires staff resolution.
- Missing ZIP works; ZIP leading zeros and changed addresses survive.
- A name/DOB/ZIP match cannot open another patient's list.
- Patient/proxy sessions cannot reach staff APIs or other patients' photos.
- A helper is not mislabeled as the patient; expired/revoked authorization stops access.
- A cross-practice reference fails even when a record ID is known.

### Medication evidence and changes

- A product strength alone never becomes an amount taken.
- Half tablets, liquids/concentrations, inhalers, injections, patches, drops, topicals, powder, complex/PRN schedules, combinations, and supplements preserve the reported detail.
- Same brand/generic product can be flagged, while different strengths/release forms are not auto-merged.
- Stopped status is a patient report; original baseline and source dates remain visible.
- Removal/Undo and newer source photos preserve history and invalidate confirmation as appropriate.
- Ambiguous OCR, a failed RxNorm lookup, and an unrecognized supplement can remain explicitly unresolved.
- Repeated imports and submissions do not create duplicates; stale edits and stale confirmation fail safely.

### Phone and recovery

- Safari on an actual iPhone and Chrome on an actual Android, with large text and a screen reader spot check.
- Camera allowed/denied/unavailable; photo picker cancellation; rotation; keyboard opened; low light and blur.
- Test HEIC and other real phone photo paths; unsupported formats get a usable fallback rather than a stuck screen.
- Partial/failed upload, spotty connectivity, back navigation, tab close/reopen, and session expiry.
- A patient can correct an entry, return to the list, confirm all current revisions, and submit once.
- Submit zero medications only with explicit none-reported attestation; do not infer it from an empty database.

### Receiving workflow and operations

- Received, reviewed, and entered into Aprima remain distinct.
- Duplicate/reordered events and offline staff sessions converge without overwriting reviews.
- A patient edit after submission creates a clearly newer report; earlier snapshots stay immutable.
- Cancelled/rescheduled/completed visits suppress inappropriate reminders.
- Restore a backup in a test environment and verify records, private photos and audit linkage.
- Confirm who handles unmatched patients, uncertainty, failed reminders, suspected wrong-patient attachments, and outages.

## 15. Pilot conditions and measures

Before handling real patient data, identify the practice owner, staff reviewer, technical owner, support route, and required privacy/security arrangements. Confirm service-specific BAAs where applicable, risk assessment, retention/deletion, least-privilege staff access, encryption, backup/restore, audit logging, incident handling, and approved use of any external OCR/AI/messaging service. HTTPS and a paid hosting plan are not sufficient evidence of readiness.

First conduct supervised usability sessions with fictional records and people representative of the target population. Then, after clinic approval, start a small live pilot with an explicit fallback to normal reconciliation. Do not withdraw the usual process merely because a patient completed the web check.

Proposed targets to calibrate against a measured baseline:

- At least 8 of 10 representative usability participants finish without staff taking the phone; record where help was needed.
- An unchanged list takes roughly two minutes or less to review; separately measure adding a full list from scratch.
- Median MA reconciliation time improves meaningfully, with a proposed initial target of 30% relative to the clinic's measured baseline.
- No wrong-patient attachments; every removal and uncertain item remains visible to staff.
- Staff can tell within a few seconds who completed the report, for whom, when, and whether Aprima reconciliation has occurred.
- Report false duplicate alerts and missed duplicates against reviewed test cases; do not infer performance from a few demonstrations.

These are proposed product success criteria, not established performance or guarantees. A small pilot does not prove zero clinical risk.

## 16. Effort and scope

Phone testing of the current fictional-data prototype can begin immediately from its existing HTTPS link. Opening source in Cursor should be a short setup task once local dependencies are installed.

For a narrowly scoped, single-practice clinical MVP with one reviewed baseline input and manual Aprima reconciliation, a planning allowance of roughly 4-8 full-time engineering weeks plus clinic testing/vendor/IT lead time is reasonable. This is a judgment estimate, not a delivery commitment. Part-time solo development can take substantially longer. Real authentication, recovery, identity matching, and operational testing are likely to consume more effort than screen changes. Full FHIR access or automatic write-back can add a separate, unpredictable vendor-dependent track.

Keep native apps, Wallet/NFC, video recognition, comprehensive supplement matching, interaction/prescribing recommendations, and automatic Aprima medication changes outside the first pilot. They are not required to test whether pre-visit patient review reduces staff work.

## 17. Immediate next actions

1. Connor tests the current private patient link on a phone using the fictional label and records friction.
2. Open the included source in Cursor and establish a private GitHub home.
3. Obtain a synthetic/example Aprima medication export and ask the administrator/CGM about the documented CSV/FHIR routes and identifiers.
4. Inspect the current fee-ticket repository for durable patient IDs, DOBs, appointment IDs and actual authorization. Do not infer those from old planning notes.
5. Choose the staging identity/runtime with the clinic's technical owner.
6. Build the patient/appointment/respondent and authorization foundation before adding live reminder links or clinical records.
7. Implement retained removal, RxNorm normalization and conservative duplicate flags; then the staff receiving workflow.

## 18. References and evidence

Public vendor documentation was checked October 22, 2026. Publication dates and installed product capabilities can differ; verify the practice's actual configuration.

- CGM FHIR API Documentation Guide, April 2024, registration and MedicationRequest sections: https://www.cgm.com/_Resources/Persistent/aaa2e921f29934f6e308b73daadaf3e94a3b21d5/fhir-api-documentation-guide.pdf
- CGM Aprima EHI Export guide, Active Medication CSV section: https://www.cgm.com/usa_en/data/downloads/cgm-aprima/ehi-export-documentation-cgm-aprima.html
- NLM RxNorm overview: https://www.nlm.nih.gov/research/umls/rxnorm/overview.html
- NLM approximate matching API: https://lhncbc.nlm.nih.gov/RxNav/APIs/api-RxNorm.getApproximateMatch.html
- NLM related concepts API: https://lhncbc.nlm.nih.gov/RxNav/APIs/api-RxNorm.getRelatedByType.html
- HHS cloud computing guidance: https://www.hhs.gov/hipaa/for-professionals/special-topics/health-information-technology/cloud-computing/index.html
- NIST SP 800-63B-4, authentication/session guidance; apply with a practice-specific risk assessment rather than treating this as a healthcare-specific certification: https://pages.nist.gov/800-63-4/sp800-63b.html
- Cursor project rules: https://cursor.com/docs/rules

Internal evidence: current MedCarry source/schema/routes at the baseline commit; `ICG_Echo_Schedule_Cursor_Brief.md`, September 26, 2026, read in full. The latter is explicitly a proposed extension based on samples and historical notes, not a current fee-ticket source audit.
