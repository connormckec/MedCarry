# Working MVP: prior-note import and guided medication capture

## Current entry points

- `/`: private staff/test tools and historical medication import.
- `/patient`: working guided medication review, camera/upload/manual capture, saved records, individual confirmation, and snapshot preparation.
- `/patient?profile=<owned-profile-id>`: select an existing owned test list. This parameter is not a credential. Every API and photo read still requires the platform-authenticated owner.
- `/wireframes`: a separate in-memory design study. The website starts on the visit greeting. The clinic-text screen illustrates the external phone Messages app only.

Actual SMS sending, appointment scheduling/import, patient enrollment, provider/proxy identity and clinic receiving workflows remain separate implementation work. The current hosted project stays owner-private. These routes are for demonstration records, not a live clinical deployment.

## Staff import

1. Sign in and select the intended test list. Create a separate list when necessary; the selected list is the import destination.
2. Choose **Import a list**.
3. In step 1, paste only the medication section, one medicine per line. Alternatively read a JPG/PNG/WebP photo of that section with the existing browser OCR engine, then inspect and correct the resulting text. Direct PDF/C-CDA/CSV import is not implemented in this iteration.
4. In step 2, enter the source document and its date, or leave the date unknown. Never substitute today's date for an unknown historic note date.
5. In step 3, inspect proposed names, strengths, categories, and original text. Corrections are under **Edit details**. Exclude headers, other note content, duplicates and non-medication lines. Select only checked rows and acknowledge the review.
6. Import up to 20 selected rows. The API writes an all-or-nothing batch, reserves a unique per-owner request key, and stores a payload digest. Retries with the same content return the original IDs; changed content with that key conflicts.

The deterministic parser is deliberately conservative. It is not a validated clinical NLP service and will not interpret arbitrary full cardiology notes. Wrapped lines, uncommon units, combination products, abbreviations, multilingual labels, and multi-column OCR can require correction. Exact string duplicates are detected; semantic equivalence across brands/generics is not a solved merge rule.

## Minimal patient and staff screens

Both surfaces use the existing navy/white palette. The patient page has no links to staff tools, list switching, import, design studies, or demo-label tools. The staff page owns list selection, import, and test tools. This is UI separation inside the existing owner-private prototype, not a new staff/patient authorization system.

Manual entry on both surfaces has three short steps: name/strength/form, current use, and explicit confirmation. Label details, extra instructions, missed doses, and draft/remove controls expand only when needed. The staff-only detailed editor retains NLM reference lookup. Uncertainty remains explicit, and original source/date/text remains available. A confirmed entry opens on its short review screen; editing still requires current-version confirmation.

Once all entries are confirmed, **I've added all my medications** creates the dated snapshot directly using the selected list name and the current demonstration clinic, Innovation Cardiology. Success appears only after the existing server snapshot gate succeeds. **You're done** means the copy is saved; it has not been sent to the clinic. The patient can view, share, print, or download that copy. Adding/changing records returns to review. Actual clinic enrollment will need to provide the verified patient/recipient rather than this prototype's list/clinic defaults.

## Patient review

The guided view reads the actual saved list and offers the next unconfirmed medication. Historical sources and original wording remain visible. A source entry with an explicit uncomplicated amount/unit and schedule may be proposed for the patient to check; a product strength alone never implies one tablet. Unknown, stopped/negative, variable, and PRN source instructions require clarification instead of automatic active-use proposals.

Reviewing an existing medication can add a new source-label photo to that same record. The existing camera, bounded/private upload, browser OCR, and server parser prepare proposed fields. The historical document/date/original line is retained, and changes require current-revision confirmation. Failure to read the image leaves a manual path; it never establishes current use automatically.

Patient identity/strength, label directions, patient-reported use, and historical evidence remain separate. The current backend allows explicitly acknowledged uncertainty to be reported as uncertain. Patient confirmation is not clinician reconciliation. A snapshot is a dated copy, and direct clinic delivery is not implemented.

## Medication reference

The existing authenticated reference search uses NLM RxNorm's `getDrugs` service for clinical/branded drug and pack concepts. It returns candidate names with stable RxCUIs; a selected reference is stored with the record. Candidates require comparison with the label. The reference does not establish patient dose, frequency, adherence, or current prescribing status.

Custom/unmatched medications and supplements remain possible through manual entry and original label evidence. NIH DSLD is a candidate supplementary label reference; it is not connected in this MVP. A clinically validated terminology service, comprehensive supplement matching, interactions, and prescribing advice are outside this implementation.

## No-EHR-API options

| Input path | When it helps | Current support |
| --- | --- | --- |
| Copy medication section from the chart/note | Small pilot and a selectable chart section | Working paste-and-review import |
| Screenshot/photo of the medication section | Image-only note or blocked text selection | Working browser OCR to editable text, then reviewed import |
| Selectable PDF medication section | Clinic can print/export an old note | Copy text from the PDF into the importer; direct PDF extraction pending |
| CSV medication report | EHR exposes a medication report or administrative export | Candidate next adapter; confirm vendor fields and patient matching |
| C-CDA/CCD summary | EHR can export a machine-readable clinical summary | Candidate next adapter; preserve status, dates, codes, nulls, and provenance |
| No baseline available | Patient is new or note cannot be retrieved | Working bottle-first camera/upload/manual path |

A document export can avoid needing a live EHR API, but availability and permission depend on the EHR and clinic configuration. Keep patient matching and source selection explicit. Do not screen-scrape or automate live chart access without a separately approved integration.

## Architecture and validation

- Existing React/Vinext/Workers app; logical `DB` and `BUCKET` bindings remain unchanged.
- Medication data JSON gains historical-source fields with backward-compatible empty defaults. A new schema-only migration adds the `note_imports` idempotency table.
- `POST /api/note-import` enforces authenticated owner/profile, origin checks, bounded payloads, reviewed selection, names/dates/field validation, list limits, duplicate checks, atomic batch insertion, and replay handling. It overwrites any client-supplied current-use/confirmation proposals with unconfirmed historical uncertainty.
- Source-image ownership and snapshot confirmation/concurrency checks are reused. Plaintext full-note content is never sent to NLM. Only the medication reference query is sent when the user explicitly searches a name.
- Tests cover import uncertainty, bad dates, product-strength/dose separation, concentrations, negative/variable instructions, duplicates, owner isolation, retry/conflict behavior, transactional rollback, and updating an imported record with a photo/current report while preserving evidence.

The managed preview has no authenticated platform session for a full signed-in browser test. The simplified home/editor/import components were also exercised with isolated fictional fixtures, removed before packaging; those checks do not establish signed-in persistence or real-device camera behavior. Do not bypass authentication to make that preview work. Real-device camera permissions, signed-in capture/import/review, OCR on representative labels, and patient/staff usability sessions remain required verification.

References: https://lhncbc.nlm.nih.gov/RxNav/APIs/api-RxNorm.getDrugs.html ; https://www.hl7.org/cda/us/ccda/StructureDefinition-MedicationsSection.html ; https://dsld.od.nih.gov/
