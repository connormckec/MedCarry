# MedCarry contributor brief

Read `README.md`, `docs/CURSOR_HANDOFF.md`, and `docs/MVP_WORKFLOW.md` before changing the product. Patient review at `/patient` (also `/`), staff workspace and portal inbox at `/staff`, and demonstration wireframes at `/wireframes` are separate experiences in the same repository.

## Product rules

- Design for patients who need help using a phone. Use one primary action per step, plain language, large patient text, visible focus, and large touch targets.
- Keep staff navigation, import, list switching, and test tools on `/staff` only — never on `/patient`. Use the three-step editor by default; reserve the detailed editor for an explicit staff action. Patient completion is **I've added all my medications**, followed by a saved-copy receipt, never a claim of clinic delivery.
- Keep product strength, label directions, and patient-reported use distinct. Never infer ingestion, a current prescription, or adherence from a photograph.
- Every medication requires explicit confirmation at its current revision. Edits invalidate confirmation. Preserve backend ownership, revision, confirmation, and snapshot gates.
- Uncertainty remains visible. Never silently fill missing strength, dose, route, schedule, or supplement composition.
- Imported historical entries retain original source/date/text, remain unconfirmed, and cannot establish current use. Preserve transactional/idempotent imports and server-retained provenance when attaching newer evidence or editing reported use.
- Do not recommend treatment, tablet splitting, or dose changes. Record existing patient-reported use.
- Camera access has upload and manual alternatives. Validate uploads and keep source photos private.
- Demo state, example labels, simulated sharing, and real patient data must remain clearly separated. Do not let wireframe actions contact clinics or mutate the real medication API.
- Do not claim HIPAA readiness, clinical validation, actual clinic delivery, EHR integration, native Wallet support, or caregiver accounts without implementing and verifying those capabilities.
- Preserve Sites-owned authentication and existing owner-private publication. Missing local sign-in is not a reason to bypass auth.

## Development

- React + TypeScript + Vinext + Cloudflare Workers; D1 and R2 provide storage. Reuse the existing architecture and validation.
- Do not commit credentials, tokens, `.env*`, `.dev.vars*`, patient records, uploaded photos, generated build output, or checkout-local runtime state.
- Do not add dependencies without a concrete need. The lockfile is committed.
- Run `pnpm typecheck` for typed changes. Run `pnpm test` for medication, API, storage, or confirmation behavior changes. Run `pnpm build` before a deployable handoff.
- Use browser QA for the changed patient journey, including uncertainty, permission failure, manual entry, and returning to review after an edit. Actual iPhone and Android checks are still needed.
- Report implemented behavior, simulation boundaries, verification, and remaining work accurately.
