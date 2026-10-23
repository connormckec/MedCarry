# MedCarry

A private, authenticated medication-capture prototype. Patients capture or upload printed English labels, review extracted drafts, confirm each medication, and create dated provider-card snapshots. Manual entry is a complete first-class path.

## Working MVP

- `/patient` uses short screens, a three-step medication editor, and **I've added all my medications** to save a dated list. It has no staff navigation. It is the working guided interface, connected to the same authenticated medication API, source photos, OCR, records, and confirmation gates as the staff view. It uses platform sign-in for private testing; real patient text-link enrollment is still a separate integration.
- `/` contains staff/test tools. Select the intended test list, choose **Import a list**, paste only its medication section or read a photo of that section, check the proposed rows, and import up to 20 selected historical drafts. The fictional example exercises the same parser and import API.
- Historical drafts preserve the document name, date (or unknown), and exact original line. Imported directions are not represented as current bottle directions or established current use. Patients must review each entry; explicit old quantities can be proposed during review, while ambiguous, negative, variable, and PRN use stays uncertain.
- Add a fresh label photo while reviewing an existing medicine to update that same record and retain the historical source. Dated snapshots keep the original evidence and the current patient report distinct.
- Import writes are transactional and idempotent. Repeated import requests do not duplicate the batch. Exact existing name/strength duplicates and repeated rows are rejected for review rather than silently merged.

See [`docs/MVP_WORKFLOW.md`](docs/MVP_WORKFLOW.md) for the current workflow, no-API import alternatives, scope, and validation limits.

## Patient journey wireframes and Cursor

Visit `/wireframes` for an interactive 17-screen design study aimed at patients who need a simpler phone experience. The default opens on the visit greeting. The SMS screen represents the phone's Messages app and is available as an external-entry illustration, not an extra patient web page. Identity verification (demo code `123456`), active sessions, expired links, and sharing remain simulated here. Use **All screens** to inspect the design, or **Patient view** to hide the annotations. The wireframes use in-memory demo state and do not touch the real medication backend. No SMS or real patient authentication is implemented by these screens.

See [`docs/CURSOR_HANDOFF.md`](docs/CURSOR_HANDOFF.md) for clean-clone setup, the architecture map, prioritized work, a ready-to-use Cursor task, and GitHub instructions. [`docs/WIREFRAMES.md`](docs/WIREFRAMES.md) records the flow and usability plan. `AGENTS.md` and `.cursor/rules/medcarry.mdc` carry project guidance into coding tools.

[`docs/TEXT_LINK_PATIENT_FLOW.md`](docs/TEXT_LINK_PATIENT_FLOW.md) defines the proposed secure patient session, clinic enrollment, appointment reminder outbox, and security checks for the browser-based version.

## Working features

- Live camera capture with a mobile file-capture fallback; JPEG/PNG/WebP upload, including up to four views of one label.
- Same-origin Tesseract OCR assets. Image recognition runs in the browser; the original source photos are stored in an owner-authorized R2 bucket. The server parses proposed label fields conservatively and retains original directions.
- D1-backed separate lists, medication drafts and versions, confirmation timestamps, source references, snapshot history, and audit events.
- Tablet fractions, liquids, inhalers, injections, topicals, patches, drops, powders, supplements, PRN and variable schedules. Complex regimens can be represented in full text; coverage is not a claim of validated extraction for every product.
- Individual confirmation gates. Every edit invalidates confirmation. Card creation atomically verifies the current complete list, including concurrent changes. Duplicate card requests are idempotent.
- Private source-image viewing, optional NLM RxNorm name matching, explicit unknown fields, dated self-reported missed-dose information, print/PDF, text download and native share/copy.

## Runtime and development

Vinext / React on Cloudflare Workers with Sites-owned authentication. `.openai/hosting.json` declares `DB` and `BUCKET`. Identity comes from the platform, never a client-supplied account ID. All read and mutation routes enforce ownership. Mutations also validate request origin, inputs, current revisions and source-photo ownership. Images have bounded uploads, byte-signature checks, private no-store delivery and no public bucket URLs.

Exact local setup, mock sign-in limits, synthetic fixtures, and staging notes: **[`docs/LOCAL_DEV.md`](docs/LOCAL_DEV.md)**.

```sh
npm install --global pnpm@11.25.0
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm dev   # http://localhost:5173 — loopback mock auth only
```

`pnpm build` copies pinned OCR assets into ignored `public/ocr`, then builds. `pnpm db:generate` appends Drizzle migrations; Sites applies hosted migrations on publish. Additive clinic-identity tables ship in `drizzle/0002_clinic_identity_foundation.sql` without changing existing medication records.

Staff workspace **Testing tools → Load synthetic appointment header** seeds fictional practice/patient/appointment/respondent rows (local mock principal only) and shows the minimal staff identity header. Matching proposes candidates; it never auto-merges or authenticates.

## Scope and limits

This is a testing prototype, not a clinically validated medication-reconciliation system or a representation of HIPAA readiness. Test with demo or non-identifying labels. OCR is fallible and optimized for readable printed English; manual completion is available on failures. A photograph is evidence of a label, not evidence of contents, current prescribed directions, or ingestion. Patient confirmation does not replace clinical reconciliation. No treatment or splitting recommendations are made.

Provider cards are private dated snapshots that the user can print/download/share themselves. The prototype does not send directly to a clinic, integrate with an EHR, issue prescriptions, create a native Apple Wallet pass, or provide provider/proxy accounts. Entries marked uncertain remain visibly uncertain. Before clinical deployment, establish the required privacy/security arrangements, retention/deletion policy, clinical evaluation, accessibility and device testing, provider access controls, and supported integration contracts.

Browser preview is supervised by Sites. The managed preview does not simulate sign-in; do not weaken production authentication to work around an absent preview session. Publish with the native Sites source and deployment workflow and preserve owner-private access.
