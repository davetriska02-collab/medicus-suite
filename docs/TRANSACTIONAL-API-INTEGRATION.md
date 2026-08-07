# Transactional API integration

Medicus Suite can source the patient bundle from the **official Medicus
Transactional API** (JWT/JWKS auth) instead of the internal session APIs. The
integration is **dormant by default** (`txn.integrationMode = 'session'`) —
shipping it changes no behaviour until a practice opts in.

## Architecture

The Transactional API is **server-to-server**: the extension never holds the
signing key and never calls `.../transactional-api/...` directly. Instead:

```
content script (engine/data-fetcher.js)
   │  chrome.runtime message: txn:fetchPatientBundle  (no credential in page world)
   ▼
service worker (service-worker.js txnFetchPatientBundle — owns txn.callerKey)
   │  POST {proxyUrl}/proxy   Authorization: Bearer <caller key>
   ▼
backend proxy (Supabase edge function, London — separate private repo)
   │  verifies caller, checks endpoint allowlist, signs ≤60s Medicus JWT
   ▼
Medicus Transactional API → retrieve-care-record (GP Connect FHIR) + demographics
   ▼
shared/fhir-normaliser.js + shared/immunisation-bridge.js → the SAME bundle the
rules engine already consumes. Engines unchanged.
```

Any transactional failure falls straight back to the existing session feed
(`fetchLive()`); the transactional feed can never make the extension show less
than today. Reads only — no write endpoint is wired.

## Settings (chrome.storage.local)

| Key                   | Default     | Meaning                                                                            |
| --------------------- | ----------- | ---------------------------------------------------------------------------------- |
| `txn.integrationMode` | `'session'` | `'session'` (off) / `'hybrid'` (txn first, session fallback) / `'transactional'`   |
| `txn.environment`     | `'staging'` | Medicus environment the proxy targets                                              |
| `txn.proxyUrl`        | `''`        | Backend proxy base, e.g. `https://<proj>.supabase.co/functions/v1`                 |
| `txn.callerKey`       | `''`        | **SECRET** proxy credential — service-worker only, **excluded from suite backups** |
| `txn.userEmail`       | `''`        | Optional clinician email for user-restricted (attributed) calls                    |

Set via the service-worker console until the options UI lands:

```js
chrome.storage.local.set({
  'txn.integrationMode': 'hybrid',
  'txn.proxyUrl': 'https://<proj>.supabase.co/functions/v1',
  'txn.callerKey': '<practice caller key>',
});
```

The tenant comes from the existing `suite.practiceCode` detection.

## Safety gate

`test-txn-shadow.js` runs the **real** engines (rules engine, result severity,
triage matcher + alert engine) on the FHIR feed in CI:

- **Parity** — identical chips/severity/alerts vs a legacy bundle with the same
  content.
- **Divergence** — a narrower API record (GP Connect excludes RCGP-excluded /
  confidential-from-third-parties items) is **flagged as a regression**, never
  silent. Before flipping any practice to `hybrid`, run shadow-compare on real
  patients and require `safe: true`.
- **Vaccine uplift** — structured `Immunization` data resolves false "due"
  states via `shared/immunisation-bridge.js`, with no engine change.

## What does NOT port (stays on the session feed)

Scheduling/capacity (Slots, Capacity, Sweep, Today, Condor), task/workload
(Request Monitor, Submissions, Activity) and the referrals audit have **no
Transactional equivalent** — the API has no appointment-book/task-list/reporting
endpoints. They keep using the internal session APIs regardless of
`txn.integrationMode`.

## Prerequisites before real use

1. Medicus onboarding complete: our JWKS URL registered, `client_id` assigned,
   endpoint permissions granted (staging first).
2. Backend proxy deployed (see the `medicus-suite-private` repo: token service,
   Supabase proxy, provisioning script) and a practice caller key provisioned.
3. Governance sign-off for PID through the proxy (DPIA addendum, residency,
   monitoring) — tracked in `medicus-suite-private/docs/`.
