# MedCarry local development

Reproducible setup for the Sites prototype plus the additive clinic-identity foundation. This is **not** patient authentication and **not** Gate B/C staging.

## Prerequisites

- Node `>=22.13` (Node 24 LTS preferred)
- `pnpm@11.25.0` (pinned in `package.json`)

```sh
npm install --global pnpm@11.25.0
pnpm install --frozen-lockfile
```

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm typecheck` | TypeScript (`tsc --noEmit`) |
| `pnpm test` | Medication, storage, API, clinic-identity tests (in-memory D1/R2 adapters) |
| `pnpm build` | Production build (copies OCR assets into ignored `public/ocr`) |
| `pnpm dev` | Portable local app on **http://localhost:5173** |
| `pnpm db:generate` | Append-only Drizzle migrations from `db/schema.ts` |

## Local mock auth (loopback only)

The Vite Sites plugin enables mock sign-in **only** when the request host and remote address are loopback (`localhost` / `127.0.0.1` / `::1`).

- Mock principal id: `local_seedy`
- Mock email: `seedy@sites.test`
- Cookie name: `__sites_local_auth`
- Sign-in path: `/signin-with-chatgpt` (local only)

Do **not** expose this mock on a LAN IP or tunnel. A phone on the network is not localhost. Use the existing owner-private hosted Site for phone tests, or a separately authenticated HTTPS staging deployment.

## Storage bindings (no secrets in repo)

Declared in `.openai/hosting.json`:

| Binding | Role |
| --- | --- |
| `DB` | Cloudflare D1 (SQLite) |
| `BUCKET` | Cloudflare R2 (private source photos) |

Local `pnpm dev` uses the Cloudflare Vite plugin with placeholder D1/R2 names from `vite.config.ts`. Do not commit `.env*`, `.dev.vars*`, `.wrangler/`, or `.sites-runtime/`.

## Migrations

SQL lives under `drizzle/` (`0000_…`, `0001_…`, `0002_clinic_identity_foundation.sql`, …).

- Automated tests apply every `drizzle/*.sql` file to an in-memory database.
- Hosted Sites applies migrations during publication.
- After schema edits: `pnpm db:generate`, review the new SQL, commit it.

Existing medication tables are preserved. Clinic identity tables are **additive**.

## Synthetic clinic fixtures

Fictional Innovation Cardiology records (not real PHI):

1. Sign in locally (loopback mock).
2. Open `/` (staff workspace).
3. Under **Testing tools**, choose **Load synthetic appointment header**.

That calls:

- `POST /api/clinic/seed-synthetic` — allowed only for principal `local_seedy` (and blocked for patient/helper sessions)
- `GET /api/clinic/staff-header?appointment=<synthetic-id>`

Also available:

- `POST /api/clinic/match-proposal` — staff-only; proposes matches, never auto-merges

Seed also creates a **linked** medication profile for Alice (`SYNTHETIC.aliceProfileId`) and binds test principals:

| Principal | Role |
| --- | --- |
| `local_seedy` | Staff (loopback mock) |
| `local_patient_alice` | Active patient respondent (API tests) |
| `local_helper_dana` | Active helper respondent (API tests) |

Authorization is server-enforced: practice staff membership or an **active** respondent binding. Patient/helper sessions cannot call profile create, note import, NLM search, or clinic staff tools. `X-Medcarry-View` never grants privileges. Unlinked legacy profiles remain owner-only.

Fixture IDs and sample demographics: `lib/synthetic-clinic.ts`.

## Useful URLs (local)

| URL | Notes |
| --- | --- |
| http://localhost:5173/wireframes | In-memory design study (no medication API) |
| http://localhost:5173/ | Staff/test workspace (mock sign-in required for API) |
| http://localhost:5173/patient | Guided patient UI (same owner API; not clinic enrollment) |

## Authenticated HTTPS staging (what Connor still needs)

Local mock auth cannot be “opened to the phone.” For phone/staging tests:

1. Keep using the existing owner-private Sites URL for Gate A fictional checks, **or**
2. Choose a staging runtime with clinic IT/privacy: independent identity + Worker/D1/R2 **or** clinic-approved Postgres if ready.
3. Deploy over HTTPS with real auth (Sites-owned or clinic-approved MFA for staff; clinic-approved patient enrollment later).
4. Apply D1 migrations in that environment; seed only synthetic fixtures there.
5. Do not weaken owner-private access or publish mock sign-in.

GitHub push does not deploy the Site. Publication remains the Sites (or chosen staging) workflow.
