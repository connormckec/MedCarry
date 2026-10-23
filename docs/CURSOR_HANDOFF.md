# MedCarry: development handoff

## Start here

The product helps patients photograph or manually enter prescription medicines, OTC products, and supplements; confirm each medication and their actual routine; and prepare a dated list for a clinician to reconcile.

The intended audience includes patients who need assistance setting up tools such as Kardia. Successful first use may involve clinic staff or an authorized caregiver. The interface should minimize decisions and recover gracefully when a patient is uncertain.

**Current source has two deliberately separate surfaces:**

| Route | Behavior |
| --- | --- |
| `/` | Working private prototype: camera, source upload, browser OCR, manual entry, stored medication records, confirmation, immutable provider-card snapshots |
| `/patient` | Working guided UI using the same authenticated API and storage; camera, upload, manual entry, review, confirmation and snapshot preparation |
| `/wireframes` | Clickable design study: 17 screens, text reminder entry, simulated private access and link recovery, first/return visits, example labels, dose editing, manual entry, help, and simulated sharing. All medication state stays in component memory. |

Hosted site: https://medcarry-connor.pearlymap1024.chatgpt.site

The staff workspace is minimal; import uses three steps, and manual entry uses the same short editor as the patient page. Extra fields expand on demand, and the staff-only detailed editor retains NLM lookup. Patient screens have no staff navigation. Historical medication import is implemented in the staff view. Read `docs/MVP_WORKFLOW.md`. It supports pasting an old medication section or reading an image into editable text, staff selection/correction, a transactional idempotent import, historical-source evidence, and subsequent guided patient review. No EHR API is required for that input path. It is not a validated full-note extractor.

The wireframe route does not call medication APIs. A selected image remains a temporary browser object URL and leads to manual entry. It is not passed through OCR. “Use an example label” loads explicitly fictional values. Refresh clears wireframe progress. Screen selection in the design sidebar seeds examples for inspection and is not patient navigation.

The existing medication model can explicitly represent acknowledged uncertainty. The wireframe takes a conservative path: choosing “I'm not sure” leaves the item unconfirmed for help. Preserve the server's representation of uncertainty; agree how an office should receive an acknowledged uncertain report before changing that contract.

**The default patient entry is now an appointment text link, with no app installation.** Read `docs/TEXT_LINK_PATIENT_FLOW.md` for enrollment, authorization, reminders, security requirements, and implementation checks. The wireframe code `123456` and active-session toggle are clearly marked simulation controls. They must never authorize real API access. The real patient identity/session and SMS service remain unimplemented. Reuse the clinic's approved communication channel when feasible; do not remove the current Site's owner-private access to make a public patient portal.

## Open in Cursor

Use Node 24 LTS (project minimum is Node 22.13). In a clean clone or extracted source folder:

```sh
npm install --global pnpm@11.25.0
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://localhost:5173/wireframes`. The checkout's portable development script selects port 5173. The guided view is available with `?view=patient`. The interactive wireframe does not need production credentials, a clinic connection, or patient data.

Clean clones use the portable execution profile. Do not copy `.sites-runtime`, `.wrangler`, `.env`, or `node_modules` from another machine. The private working app depends on platform identity and D1/R2; it should not be expected to act as a production clinic app from an unauthenticated clone. Validate real authentication and persistence in the supported Sites environment.

`.cursor/rules/medcarry.mdc` contains a project rule with `alwaysApply: true`. `AGENTS.md` supplies the repository brief. Rules are development context; tests and server checks enforce product invariants.

## Suggested first Cursor task

> Read AGENTS.md, docs/MVP_WORKFLOW.md, docs/TEXT_LINK_PATIENT_FLOW.md, and the current medication/import API and tests. Preserve the working `/patient` flow and staff note importer. Next, evaluate the clinic's supported CSV or C-CDA export format and design an adapter with explicit patient matching, status/date preservation, and reviewed import. Separately implement patient enrollment, identity, and real SMS only in an approved environment; the existing owner-private Site is not a public patient portal. Preserve current-version confirmation, provenance, and ownership gates. Run relevant tests, type checks, and a build, and report signed-in/device verification limits.

## Architecture map

| Area | Files |
| --- | --- |
| Current patient app | `app/medication-app.tsx`, `app/globals.css` |
| Wireframe study | `app/wireframes/page.tsx`, `app/wireframes/wireframes.tsx`, `app/wireframes/wireframes.css` |
| Working guided UI | `app/patient/`, `app/guided-patient-home.tsx`, shared `app/medication-app.tsx` |
| Historical import | `app/note-import-panel.tsx`, `lib/note-import.ts`, `POST /api/note-import`, `note_imports` table |
| Medication model and validation | `lib/medication.ts` |
| Browser OCR and photo preparation | `lib/ocr.ts`, `scripts/prepare-ocr.mjs` |
| HTTP entrypoint | `app/api/[...path]/route.ts` |
| Server handlers and database | `app/api/[...path]/route.ts`, `db/`, `drizzle/` |
| Worker and hosting | `worker/index.ts`, `vite.config.ts`, `.openai/hosting.json` |
| Regression checks | `tests/medication.test.mjs`, `tests/storage.test.mjs`, `tests/api.test.mjs` |

## Implementation priorities

1. **Validate the guided MVP:** Capture/review and staff note import now reuse the real uploads/OCR, API and database. Verify the signed-in flow on actual phones and representative labels. Evaluate the new three-step editor with patients; preserve formulation coverage and uncertainty.
2. **Durable save and recovery:** Autosave drafts through the existing authenticated API, handle conflicts, and resume unfinished work. The wireframe's in-memory state does not satisfy this requirement.
3. **Formulation coverage:** Tablet shortcuts are only one path. Support liquids, inhalers, injections, patches, eye/ear drops, powders, PRN/variable schedules, and multi-ingredient supplements using the existing richer model.
4. **Safe review and snapshots:** Preserve the server's atomic complete-list/current-revision gate. An edit or list change cannot reuse prior confirmation. Clearly distinguish patient confirmation from clinical reconciliation.
5. **Enrollment and assistance:** Design practice-linked enrollment, recovery, and separately authorized proxy access. Define clinic identity matching before implementing invitations. Do not remove platform authentication from this prototype.
6. **Clinic sharing contract:** Select a real receiving workflow and authorized recipient. Define pending, delivered, failed, expired, revoked, and clinically reviewed states. Patient consent must name the recipient and disclosure scope. The demo receipt is not a delivery implementation.

## Checks and handoff

```sh
pnpm typecheck
pnpm test
pnpm build
```

The current backend has medication-logic, storage/concurrency, and request-handler tests. Test changes to those invariants rather than snapshotting visual markup. Check the patient flow in a browser and on actual iPhone/Android devices. Check large text, screen readers, focus, file cancellation, denied permissions, unreadable labels, half-tablet reports, uncertainty, and returning after interruption.

The current prototype is not clinically validated or HIPAA-ready. No EHR integration, native Apple Wallet pass, clinic delivery, provider portal, or caregiver account system exists. Evaluate privacy/security arrangements, retention/deletion, clinical performance, accessibility, and receiving workflow before real patient deployment.

## GitHub and source control

The Sites source repository is already versioned. A separate push to the user's GitHub account requires that account's connection. No GitHub URL or successful GitHub push should be assumed from the Sites Git remote.

If using the downloadable source archive instead, create an **empty private** GitHub repository (suggested name: `medcarry`), extract this folder, then run the following, replacing the remote with the exact URL GitHub gives you:

```sh
git init -b main
git add .
git commit -m "Add MedCarry prototype and patient wireframes"
git remote add origin <your-private-GitHub-repository-URL>
git push -u origin main
```

The archive contains tracked source and the lockfile, not Git history, dependencies, source photos, local databases, build output, or credentials. Keep the ZIP as a starter only; after cloning GitHub, use Git for subsequent changes. A GitHub push does not itself deploy the Site. Use the existing Sites publication workflow for this hosted project.

Cursor rule format reference: https://cursor.com/docs/rules
