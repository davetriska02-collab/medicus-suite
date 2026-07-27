# Medicus developer platform (build.medicus.health) — API knowledge notes

> **Provenance & trust level (read first):** `https://build.medicus.health/` is
> an access-controlled developer portal — it 403s anonymous requests and is
> unindexed by search engines, so Claude Code sessions **cannot fetch it
> directly**. This document is a curated capture of a third-party AI scrape
> (Grok, 2026-07-27) supplied by Dave, **not independently verified against
> the live docs**. Treat it as a good orientation map, not ground truth: the
> individual endpoint pages and the official Postman collection
> (`https://build.medicus.health/postman/medicus-transactional-api.postman_collection.json`,
> also auth-gated) are the definitive source for request/response shapes and
> 400-error cases. Do not invent endpoints or schemas beyond what's here —
> when detail is missing, say so and point at the live docs.
>
> **Scope note for this repo:** Medicus Suite (this extension) mostly replays
> Medicus's _internal_ browser APIs (`/clinical/data/...`,
> `/tasks/data/...` etc.), captured live via HAR — those are NOT the APIs
> documented here. This file covers the _official partner-facing_ APIs. Useful
> for: understanding what an official integration could replace an internal
> replay with, webhook/JWT patterns, bulk-extract schemas, and onboarding
> conversations with Medicus.

The portal is a Docusaurus-style knowledge base (~100 pages, mostly per-
endpoint references under `/transactional-api/`). No public OpenAPI/Swagger is
published; the Postman collection is generated from the same source as the
docs.

## 1. The three products

1. **Transactional API** (REST — the primary product). Clinical integration:
   create notes/documents/encounters/observations/referrals, retrieve care
   records & documents, find/match/manage patients, book/cancel/check-in
   appointments, staff lists, webhooks, investigation-report filing workflow,
   and extensive resource publishing (templates, dashboards, content
   packages, future-action rules).
2. **Bulk Data Extracts (IM1)**. Scheduled bulk CSV exports (full + delta) of
   practice data for analytics/population health/reporting. Delivered via
   SFTP or MESH. Strict data-protection, UK-only processing, and
   sensitive-data exclusion rules.
3. **Patient Facing Services (IM1 / GP Connect PFS)**. Implements the
   national NHS GP Connect PFS spec (NHS Login / NHS App: structured record
   view, documents, repeat requests, …). **All onboarding/assurance is
   managed by NHS England** — Medicus runs no separate process.

## 2. Onboarding & assurance (common path)

1. Complete the Integration Request form (`/integration-request`) and email
   it to `partners@medicus.health`. Must name a First-of-Type customer. For
   Transactional: choose application-restricted vs user-restricted model,
   provide a kebab-case `applicationIdentifier`, a JWKS URL, a
   clinical-facing description, and the list of required endpoints.
2. If approved → partner agreement.
3. Medicus adds you to **Staging** and configures the application.
4. Develop & test.
5. Submit DDQ (Due Diligence Questionnaire) + demo videos (happy + unhappy
   paths).
6. First-of-Type controlled pilot with one practice.
7. General availability.

IM1-programme integrations are assured by NHS England, not Medicus.

- Staging base host: `https://{tenantId}.api.staging.england.medicus.health`
- Production: `https://{tenantId}.api.england.medicus.health`

Each practice (tenant) must separately enable your application (self-service
by practice admins). Endpoint access is granted individually as
`<endpoint>:<mode>` (e.g. `create-note:application-restricted`).

## 3. Authentication (Transactional API)

Every request carries a **short-lived RS256 JWT** as a Bearer token
(`Authorization: Bearer <jwt>`):

- You hold the private key; Medicus verifies against your registered **JWKS**
  URL (public keys only). JWKS may contain multiple keys (rotation); Medicus
  caches it ~1 hour.
- Token lifetime ≤ 60 seconds (`exp - iat ≤ 60`) — mint fresh per request or
  short burst.
- Required claims: `iss` (applicationIdentifier), `sub`, `iat`, `exp`.
  `kid` header required (must match a key in your JWKS).
- **Application-restricted** (`sub = iss`): the app acts as itself. Optional
  `act` claim for audit (practitioner + organisation).
- **User-restricted** (`sub ≠ iss`): the app acts on behalf of a staff
  member. Requires prior browser authorisation (12-hour window) via redirect
  to `https://england.medicus.health/{tenantId}/staff/authorise?app=...&redirect=...`
  (staging host differs). `azp` claim required.
- 403 errors return `{ "error": "<message>" }` (missing header,
  invalid/expired JWT, missing claims, app not enabled for tenant, endpoint
  not granted, user not currently authorised, …).

## 4. Getting started

1. Register application + JWKS + endpoint grants + tenant enablement.
2. Mint a short-lived JWT.
3. `GET /transactional-api/ping` — simplest health/auth check.
4. Postman collection:
   `https://build.medicus.health/postman/medicus-transactional-api.postman_collection.json`

Base path pattern:
`https://{tenantId}.api.[staging.]england.medicus.health/transactional-api/<endpoint>`
with `Accept`/`Content-Type: application/json`.

## 5. Transactional API endpoint catalogue (from Postman + docs)

**System**

- `GET /ping` — auth + context check
- `GET /terminology-versions` — SNOMED CT + dm+d versions

**Patients**

- `POST /find-patient` (free-text search)
- `GET /patient/:patientId/demographics`
- `POST /match-patient` (demographics → patientId)

**Care record**

- Creates: `POST /create-document`, `/create-encounter`, `/create-note`,
  `/create-observation`, `/create-outbound-referral`
- Retrieves: `POST /list-documents`, `/retrieve-care-record`,
  `/retrieve-confidential-care-record`
- `GET /retrieve-document/Binary/:documentId`
- Several return FHIR STU3 Bundles/Binary.

**Appointments**

- `POST /book-appointment`, `/cancel-appointment`,
  `/find-appointments-for-check-in`, `/list-available-slots`,
  `/mark-patient-as-arrived`
- `GET /appointment/get-metadata`, `/list-called-in-appointments/:siteId`,
  `/list-sites`

**Staff**

- `GET /list-staff`

**Front Door**

- `POST /appointment/create-booking-link` (public self-service booking URL)
- List called-in appointments (also under Appointments)

**Workflow (investigation-report filing)**

- `GET` list unfiled investigation reports
- `GET` get investigation report
- `GET` list unfulfilled investigation requests
- `POST` file investigation report
- Typical flow: list unfiled → get detail → (optional) list unfulfilled
  requests → file.

**Resource publishing (~50+ endpoints)** — full draft → publish lifecycle
for: communication templates, consultation templates, document form
templates, patient questionnaire templates, custom dashboards, future action
rules, content packages. Operations: create, create-version, update-version,
publish-version, archive, delete-version, list, get-version,
set-content-package-items, etc.

**Webhooks**

- Events: `record.opened`, `consultation.started`,
  `callin.notification.shown`, `callin.notification.removed`.
- Delivery: POST of a **raw JWT** (`Content-Type: application/jwt`) to your
  registered HTTPS URL. Short-lived, signed by Medicus — verify against the
  tenant JWKS at `/transactional-api/jwks`.
- **No automatic retries** — treat as hints. Use `jti` for deduplication.

## 6. Bulk Data Extracts (IM1)

**Allowed use cases**: targeted reporting (e.g. CH-IS), broad
warehouse/population-health extracts, direct-care planning where a
legitimate relationship exists. **Not for**: third-party direct care (use
Transactional), patient-facing (use PFS), data migration.

**Obligations**: DPIA, ISO 27001 (UKAS), Cyber Essentials Plus, DSP Toolkit
"Standards Exceeded", UK-only processing + no secondary transfers without
approval, NIST AAL2 auth, encryption at rest after download, Type-1 opt-out
handling, sensitive-data exclusions (gender reassignment, sexuality, HIV,
termination of pregnancy, assisted fertilisation, RCGP sensitive sets;
free text and documents are never included).

**Delivery**:

- **SFTP** (consumer-hosted): Medicus public ed25519 keys + source IPs
  provided for UAT/Staging/Prod.
- **MESH**: workflow ID `GFTD_INIT`, from the local org mailbox.
- Optional GPG (OpenPGP) encryption of the ZIP.

**File format**: one ZIP per run containing CSVs (one per query/table),
prefixed with the ODS code. Full vs delta extracts (`change_type`:
added/updated/removed); the initial run is always full.

**Schema tables** (CSV columns fully documented on the portal):

- `patient` (id, nhs_number, DOB, names, addresses, clinical_sex, deceased,
  named_gp, contact details, …)
- `patient-registration`
- `coded-entry` (SNOMED, values, body site, route, practitioner, …)
- `prescription` + `prescription-issue`
- `appointment` + `appointment-practitioner` + `appointment-service` +
  `appointment-type`
- `site` + `room`

Primary key = record UUID. Dates as `YYYY-MM-DD` / `YYYY-MM-DD HH:MM:SS`.

## 7. Fair usage policy

Applies to all three APIs: reasonable concurrency, no unnecessary
polling/duplication, schedule heavy work outside core hours. Medicus may
monitor, request optimisations, or impose rate limits / suspend for abuse.
GDPR / s251 / patient-safety / key-security obligations rest with the
consumer. Use cases must be pre-agreed.

## 8. Limitations & gotchas

- No documented rate limits/quotas (fair usage applies).
- Webhooks are best-effort (no retries).
- JWTs are deliberately short-lived (≤ 60 s).
- Practice enablement is required per tenant, endpoint grants per endpoint.
- Sensitive clinical free text/documents are never in bulk extracts; all
  bulk processing must stay in the UK.
- The Postman collection is the most complete machine-readable inventory of
  current endpoints; individual endpoint pages hold the definitive
  request/response shapes and 400 cases.
