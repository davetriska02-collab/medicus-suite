# Medicus Resource Publishing API — embedded reference

> Source: https://build.medicus.health/transactional-api/resource-publishing
> (extracted 2026-08; embedded here so code can be written against it offline).
> If behaviour observed against staging disagrees with this document, the live docs and
> the platform win — update this file when that happens.

Resource Publishing is the part of the Medicus **Transactional API** for managing clinical
content that is published and distributed to practices:

- Data Entry Templates
- Document Form Templates
- Communication Templates
- Patient Questionnaire Templates
- Custom Dashboards
- Future Action Rules
- Content Packages
- Custom Reports
- Patient Query Language
- Code Lists

It builds on the base Transactional API — same authentication and base URL.

## Base URL

```
https://{tenantId}.api.england.medicus.health/transactional-api/<endpoint>
```

Staging:

```
https://{tenantId}.api.staging.england.medicus.health/transactional-api/<endpoint>
```

Endpoints are **flat verb-named paths** (e.g. `create-data-entry-template`), not REST-style
nested resources.

## Authentication (shared with the whole Transactional API)

- Every request carries a short-lived **RS256 JWT** as a Bearer token
  (`Authorization: Bearer <jwt>`).
- Token lifetime **≤ 60 seconds**. Mint per request; do not cache long.
- You sign with your private key; Medicus verifies against your registered **JWKS**.
- Required claims: `iss` (applicationIdentifier), `sub`, `iat`, `exp`.
- Two modes:
  - **Application-restricted:** `sub = iss`.
  - **User-restricted (attributed):** `sub = userId`, plus `azp`.
- Endpoint access is granted **individually during onboarding**
  (e.g. `create-data-entry-template:application-restricted`).
- Practice administrators must enable your application for their tenant.

Full auth details: `/transactional-api/authentication` on build.medicus.health.
This repo already implements the JWT/JWKS flow server-side — see
`docs/TRANSACTIONAL-API-INTEGRATION.md` (the extension never holds the signing key; a
backend proxy mints the ≤60s JWT).

## Core lifecycle (applies to almost every resource type)

1. **Create** the parent resource → `201` `{ "id": "<uuid>" }`
2. **Create a version** (starts as `draft`) with content + `versionNumber` → `201` `{ "id": "<uuid>" }`
3. (Optional) **Update** the draft version
4. **Publish** the version → status becomes **`active`**
5. `get-*-version` responses report `status: "draft" | "active"` — the published state is
   **`"active"`, never `"published"`**. Do not write client code expecting `"published"`.

Resources can also be **archived**; draft versions can be **deleted**.

## Endpoint catalogue

### Data Entry Templates

| Method | Endpoint | Notes |
|--------|----------|-------|
| POST | `create-data-entry-template` | Body: `{ "name": "string" }` → 201 `{ "id": "uuid" }` |
| POST | `create-data-entry-template-version` | Body: `{ "templateId", "versionNumber", "content" }` |
| POST | `update-data-entry-template-version` | Body: `{ "versionId", "content" }` |
| POST | `publish-data-entry-template-version` | Body: `{ "templateId", "versionId" }` → `{ "status": "ok" }` |
| GET | `get-data-entry-template-version?versionId=` | Returns `status: "draft" \| "active"` + content |
| GET | `list-data-entry-templates` | Array of `{ id, name, status, currentVersionId }` |
| POST | `archive-data-entry-template` | Body: `{ "templateId" }` |
| POST | `delete-data-entry-template-version` | Body: `{ "versionId" }` |

### Communication Templates

Same eight-endpoint pattern: `create-communication-template`,
`create-communication-template-version`, `update-...-version`, `publish-...-version`,
`get-...-version`, `list-communication-templates`, `archive-...`, `delete-...-version`.

Create body example: `{ "name": "string", "description": "string" }`

### Document Form Templates

- `create-document-form-template` — body includes `type` (e.g. `"referral-form"`)
- `create-document-form-template-version`
- `publish-document-form-template-version`
- `get-document-form-template-version`
- `list-document-form-templates`
- **Naming quirk:** some related endpoints use the shorter name `document-template`
  (archive / update / delete). Check the exact path per endpoint rather than assuming
  symmetry.

### Patient Questionnaire Templates

Identical lifecycle pattern to Data Entry Templates. Version content can be an **object**
(not only a string). This repo has extensive prior art on questionnaire XML — see the
`medicus-template-creator` skill and `docs/SNOMED-API-GUIDE.md`.

### Custom Dashboards

- `create-custom-dashboard` — body: `name`, `identifier`, `type` (e.g. `"mmt"`)
- `create-custom-dashboard-version` — includes `content`
- Full set of publish / update / get / list / archive / delete version endpoints.

### Future Action Rules

- `create-future-action-rule` — body: `name`, `identifier`, `description`
- `create-future-action-rule-version` — body uses a **`ruleDefinition` object** instead of
  `content`
- `update-future-action-rule-version` — body: `{ "versionId", "ruleDefinition": {} }`
- Publish / get / list / archive / delete equivalents.

### Content Packages

Slightly different lifecycle (no per-version publish in the same way):

- `create-content-package` — body:
  `{ "name", "availability": "all_healthcare_organisations" | "specific_organisations", "description?", "availableToTenants?": [uuids] }`
- `update-content-package`
- `set-content-package-items` — body:
  `{ "packageId", "type": "data-entry-template" | "patient-questionnaire" | "document-template" | "communication" | "custom-dashboard" | "future-action-rule", "ids": [uuids] }`
- `publish-content-package`
- `get-content-package`
- `list-content-packages`
- `archive-content-package`

### Custom Reports, Patient Query Language, Code Lists

These appear in the docs sidebar but have fewer (or differently structured) endpoints in
the current public reference / Postman collection. Investigation-report endpoints exist
but belong more to the Core API. Treat these three as **to be confirmed with Medicus**
before writing client code against them. (Code Lists are strategically important for the
Sentinel port — see the porting guide — so getting their real schema from Tim is an early
action item.)

## Common patterns and errors

- Successful creates → **201** with `{ "id": "uuid" }`
- Publish / update / set-items / archive → **200** `{ "status": "ok" }`
- Error envelope is consistent:

  ```json
  {
    "errors": [
      { "code": "missing-required-field", "description": "..." }
    ]
  }
  ```

  Known codes include `missing-required-field`, `invalid-operation`, `invalid-field`,
  plus auth `403`s.

## Content / payload notes

- `content` is usually a **string** — frequently XML for data-entry / document /
  communication templates.
- Future Action Rules use a `ruleDefinition` **object**.
- Patient Questionnaire versions can take an object.
- The internal schemas for `content` / `ruleDefinition` are **not fully expanded in the
  public docs** — they are resource-specific. Treat them as opaque pass-through values
  unless/until Medicus supplies the per-type schema. **Do not invent or hallucinate these
  schemas**; request them via Tim.

## Recommended client architecture

1. One shared authenticated client: JWT minting (≤60s, RS256, JWKS-registered key) +
   tenant-scoped base URL. In this repo's architecture the signing key lives server-side
   only (see `docs/TRANSACTIONAL-API-INTEGRATION.md`); keep that property.
2. Model the universal lifecycle once (create → draft version → optional update →
   publish) and reuse it per resource type.
3. Thin per-resource wrappers using the exact endpoint names above.
4. Pass `content` / `ruleDefinition` through opaquely until the concrete schema for the
   specific template type is confirmed.
5. Expect and branch on `"active"` (not `"published"`) after publishing.
