# CQC P0 — Cohort-enumeration feasibility spike

Status: **investigation only — no product files changed.** Answers the P0 gate in
`CQC-EVIDENCE-PACK-BUILD-PLAN.md` §4 / `CQC-EVIDENCE-PACK-SCOPING.md` §5.

**The question:** can the Medicus Suite, read-only, enumerate a clinical COHORT — e.g.
"all registered patients currently on methotrexate, with each one's most recent
FBC/U&E/LFT date" — WITHOUT opening each patient record one at a time?

---

## VERDICT

**(c) NOT reachable read-only as a true population query — but (b) a BOUNDED cohort is
already proven reachable by the `sweep` module's enumerate-then-fan-out pattern.**

There are two distinct sub-questions hiding in P0, and they have different answers:

1. **"Enumerate the whole register filtered by drug" (a single population/search call):**
   **Not reachable.** No endpoint the suite knows about returns a drug- or
   criterion-filtered patient list. Every population-shaped endpoint we call returns
   *events/tasks/referrals/appointments* or *per-clinician activity counts*, never a
   queryable patient register. (VERIFIED against the code; the existence/absence of a
   Medicus medication-search endpoint is INFERENCE — see "Honesty" below.)

2. **"Evaluate monitoring across a defined set of patients without manually opening each
   record" (enumerate a cohort, then fan out per-patient fetches):** **Already built and
   shipping** — that is exactly what `side-panel/modules/sweep/` does. But its cohort
   *source* is "today's appointment book", not "everyone on drug X". The blocker for P2 is
   **not** the per-patient fan-out (proven) — it is the **absence of a way to seed the
   cohort from a drug/clinical criterion** instead of from a day's bookings.

So: the *machinery* P2 needs exists and is read-only-safe. The *seed list* — "who is on
methotrexate" — is the missing piece, and nothing in the codebase or documented endpoints
provides it.

---

## 1. How Sentinel gets patient data today — VERIFIED per-open-patient

The live monitoring path is strictly **one patient at a time, resolved from the page in
focus**:

- `engine/api-client.js:23` `detectMedicusContext()` derives a **single** `patientUuid`
  from the page URL (`/care-record/{uuid}`, `/patient/{uuid}`, `?patientId=`), or from an
  encounter/task UUID resolved via overview endpoints (`resolveEncounterToPatient`
  `:215`, `resolveTaskToPatient` `:240`).
- `findPatientUuidFromDom()` (`:100`) has a **STRICT SAFETY GUARD**: it returns a UUID only
  if **exactly one** distinct patient UUID is on the page; on a multi-patient list view it
  returns `null` and refuses to guess (`:117`, `:131`). This is an explicit anti-population
  design choice for wrong-patient safety.
- `fetchAll(apiBase, uuid)` (`:290`) fetches **four per-patient endpoints**, all keyed by a
  single patient UUID:
  - `/patient/data/patient/patient-banner/{uuid}` (`:163`)
  - `/clinical/data/medication/medication-regimen/{uuid}` (`:166`)
  - `/clinical/data/problem/listing/{uuid}` (`:169`)
  - `/care-record/data/investigation/dashboard/{uuid}` (`:172`)
- The rules engine (`engine/rules-engine.js`, invoked at `sweep.js:304`,
  `content.js:1647`) takes **one patient's** medications + observations and returns chips.
  Per-patient by construction.

The page-world bridge (`content-scripts/triage-lens/page-world.js`) only **observes** the
queue `task-list` response to learn row→taskUuid mappings; it reads, never queries. The
queue "result-triage" chips still fan out **per task** to a per-task overview endpoint
(`fetchInvestigationReport`, `api-client.js:181`).

**Conclusion:** confirmed — Sentinel/Triage Lens is per-open-patient (or per-task), driven
by the record/task in focus. There is no population read anywhere in the live path.

---

## 2. Population/search endpoints the suite already calls — all event-shaped, none patient-register

Full inventory of `*.api.england.medicus.health` paths the suite knows
(`grep` of the repo), classified:

| Endpoint | File | Returns | Patient-register? Drug filter? |
|---|---|---|---|
| `/referrals/data/clinical-audit-report/filter-outbound-nhs-referrals` | `shared/referrals-api.js:317` | **Referral rows** (referralId, date, service, clinician, priority, status, patient name) | No register; no drug filter. Filters by date/priority/status only. |
| `/referrals/data/outbound-nhs-referrals-audit` | `referrals-api.js:293` | Config (priority/status options) — **not data** | n/a |
| `/reporting/data/activity/report` | `shared/activity-api.js:60` | **Per-clinician activity counts** (consultations, Rx tasks, reviews, documents, results) | No patients at all — staff rows only. |
| `/tasks/data/{type}/task-list` | `condor-data.js:92`, `submissions.js`, `today.js:186`, `request-monitor.js:124` | **Task rows** for a type (medical/admin/Rx/investigation), filtered by `createdAt` date | Tasks, not registered patients; no drug filter. |
| `/scheduling/data/appointment-book/embedded-overview` | `condor-data.js:17`, `slots.js`, `medicus-api.js:34` | **Practice-wide booked appointments + slots** for one date | Booked patients only (a bounded subset); no drug filter. |
| `/scheduling/data/homepage/my-appointments` | `sentinel.js:676`, `today.js:117` | The signed-in clinician's diary | Per-clinician diary; no register. |
| `/patient/data/...`, `/clinical/data/...`, `/care-record/data/...` | `api-client.js:163-172` | **Single patient** record slices, keyed by one UUID | The per-patient endpoints — require a UUID you already have. |

**None** of these let you enumerate or filter by **drug** or by a **clinical criterion**,
and **none** returns the **registered-patient list**. The referrals "clinical audit report"
*is* a genuine population enumeration — but its population is *referrals in a date window*,
not *patients matching a clinical query*. It cannot be repurposed to find "everyone on
lithium".

---

## 3. Documented endpoint discoveries — no register / search / medication-search endpoint

`docs/learnings-referrals-tracker.md` documents the **URL-template-replay discovery
pattern** (intercept the page's own API call, store the exact URL, replay it with new
date/pagination params) and confirms the referrals endpoint facts. It documents **no**
patient-search, register, QOF-register, medication-search, or cohort-export endpoint.

A full repo grep for `cohort|register|population|search|patient-list|medication-search`
against endpoint construction turns up **nothing** beyond the event/task/referral endpoints
above. The suite has no knowledge of a Medicus population-query API.

`docs/INTENDED-PURPOSE.md` frames the entire product as operating on "data already present
in the Medicus system **for the patient or session the clinician is actively viewing**" —
i.e. the per-open-patient scope is a deliberate, frozen intended-purpose constraint, not an
accident.

---

## 4. The referrals pattern as precedent — and the stronger precedent: `sweep`

**Referrals precedent (population enumeration, read-only):** `referrals-api.js` proves the
suite can read a **whole-practice list** read-only: it discovers the page's own audit URL,
then paginates `startRow`/`endRow` at PAGE_SIZE 2000 up to MAX_PAGES 10 (`:84-138`) — a
~3,600-referral practice is ~2 fetches. This is the template for "read a big list the page
already exposes". **But it only works because Medicus *has* a referrals-audit report
endpoint.** There is no analogous "medication audit" / "clinical search" / "patient
register" report endpoint known to the suite. Whether Medicus exposes one is **unknown**
(INFERENCE — see Honesty).

**The stronger, directly-relevant precedent — `side-panel/modules/sweep/`:** this module
**already does cohort monitoring read-only**, and it is the exact shape P2 wants:

- It fetches a **bounded cohort** — the practice-wide appointment book for one date
  (`fetchSchedulingOverview` → `extractBookedPatients`, `sweep.js:394-405`).
- It then **fans out per-patient**, calling the *same four endpoints* via
  `evaluatePatient` → `apiClient.fetchAll` (`sweep.js:282`) and runs the *same rules
  engine*, producing a per-patient overdue-monitoring worklist.
- It is **read-only and API-polite by design**: manual trigger only, **sequential**
  per-patient fetches with a ~250 ms gap, **BATCH_SIZE = 40** patients per run
  (`MAX_SWEEP_PATIENTS`, `sweep-core.js:17`), with a "Check next N" continue button for
  larger lists (`sweep.js:9-19`, `:388-439`). Results are ephemeral / in-memory.

**This is the proof that enumerate-then-fan-out works read-only on Medicus.** P2's
remaining gap is purely the **seed list**: sweep seeds from *appointments*; P2 needs to seed
from *a drug/clinical criterion across the register*, and no endpoint provides that seed.

---

## 5. Constraints (verified)

- **Read-only / no-write:** frozen intended purpose (`INTENDED-PURPOSE.md` ll.33-39):
  "does not write to, modify, or submit any data". All fetches are GET with
  `credentials: 'include'` (`api-client.js:142`, `referrals-api.js:111`,
  `condor-data.js:18`). The cohort approach must stay GET-only.
- **Credentialed fetch via host_permissions / MV3:** works because the extension fetches
  same-origin to `*.api.england.medicus.health` reusing the page's session cookie. Verified
  throughout. No tokens are constructed; the URL-template-replay learning warns explicitly
  **never to construct Medicus API URLs from scratch** (`learnings-referrals-tracker.md`
  ll.5-12) — param names/pagination vary per deployment.
- **Rate / volume reality for a whole practice:** this is the decisive practical blocker for
  a register-wide fan-out even *if* a seed list existed. Sweep deliberately caps at **40
  patients/batch with 250 ms gaps** to be "polite to the API". A real practice register is
  **8,000–12,000+ patients**; even a single-drug cohort (e.g. methotrexate ≈ 0.5–1% of
  list ≈ 50–120 patients) means 50–120 sequential per-patient fan-outs (×4 endpoints each
  = 200–480 GETs) — minutes of throttled fetching, plus FBC/U&E/LFT dates come from the
  per-patient `investigation/dashboard`, so there's no shortcut. A *whole-register* monitor
  (thousands × 4) is **not realistic** as a foreground, credentialed, single-session task.

---

## Recommended approach (if P2 is attempted) + make-or-break live unknowns

The honest path is **NOT** "build a population monitor". It is: **find or discover a
Medicus report endpoint that returns a drug-/criterion-seeded patient list** (the seed),
then reuse the **proven sweep fan-out** (per-patient `fetchAll` + rules engine) to attach
the last FBC/U&E/LFT date per patient — bounded, batched, throttled exactly as sweep is.

**Make-or-break unknowns that can ONLY be settled on a live Medicus instance (cannot be
tested here):**

1. **Does Medicus expose any drug/medication/register/QOF search or audit report endpoint
   at all?** Method: on a live instance, open Medicus's own reporting/search/QOF/medication-
   review screens with `ch-debug` and a PerformanceObserver-style capture (same technique as
   `referrals-discovery.js`) and inventory the API calls. If one returns a patient list
   filtered by drug or clinical code, P2 is reachable; if not, it is not.
2. **If such an endpoint exists, what does it return?** Crucially: does it return enough to
   seed the cohort (patient UUIDs + the matched drug), or only aggregate counts? Counts-only
   would give "N on methotrexate" but **not** the per-patient last-monitoring date P2/the
   reconciliation hook need.
3. **Does the per-patient `investigation/dashboard` reliably carry FBC/U&E/LFT dates** in a
   form the existing normalisers parse for a *sampled* cohort? (Sweep already relies on this
   for booked patients — likely yes, but verify across a drug cohort.)
4. **Volume/rate ceiling:** how large can a batched, throttled cohort fan-out get before
   Medicus rate-limits or the session times out? Determines whether even a single-drug
   cohort is feasible in one sitting, and whether it must be chunked across sessions.

If unknown (1) comes back **negative** (no seed endpoint), stop — do not build register
fan-out from scratch; it would be slow, fragile, and arguably outside the frozen intended
purpose.

---

## If NOT reachable — what P2 should fall back to (so P1 remains the ceiling)

This is the likely outcome unless live discovery finds a seed endpoint. Fallbacks, in
preference order:

1. **Per-open-patient + bounded-cohort evidence the clinician generates** (the honest,
   already-built capability):
   - **Sweep over a defined clinic/day** already produces a real, dated, per-patient
     overdue-monitoring worklist — usable as *sampled* supporting evidence ("on {date},
     across {N} booked patients, {x} had overdue monitoring"), with its cohort definition
     stated. This is genuine Outcomes-flavoured evidence without a register query.
   - Sentinel per-open-patient remains the verification mechanism for any named patient.
2. **Processes-led pack only (P1):** rule-currency / Keeper provenance, the monitoring
   rule inventory + coverage manifest, the disclaimer — none of which need cohort
   enumeration. This is what `CQC-EVIDENCE-PACK-BUILD-PLAN.md` §8 already recommends as the
   first build, and P1 is endorsed and shipped (§10). **P1 stays the ceiling.**
3. **Reconciliation hook instead of counts (Req 1 / Janet & Eileen's ask):** rather than the
   suite *producing* the population count, it states the **reproducible cohort definition**
   the practice runs in Medicus's own search/QOF tooling to get the count — honest, and it
   sidesteps the missing endpoint entirely. The suite supplies the *definition + coverage
   caveat*, the practice's system supplies the *number*. (`CQC-EVIDENCE-PACK-BUILD-PLAN.md`
   Req 1 already names this hook.)

Per the plan's own governance gate (§7 A8(i)): if live discovery shows coded data is too
inconsistent (or no seed endpoint exists) for reliable enumeration, the
**drop-vs-caveated-ship decision is a clinician sign-off, not a product one.**

---

## Honesty — verified vs inferred

- **VERIFIED in code:** the per-open-patient/per-task data path; the four per-patient
  endpoints; the strict single-UUID DOM guard; the full inventory of endpoints the suite
  calls and that none filter by drug or return a register; the read-only/credentialed/GET
  nature of every fetch; the `sweep` enumerate-then-fan-out pattern, its appointment-book
  seed, and its 40/250 ms throttle; the referrals pagination ceiling; the
  URL-template-replay discovery learning.
- **INFERENCE about Medicus's API (NOT verified — we cannot hit a live instance here):**
  whether Medicus exposes *any* drug-search / medication-review / QOF-register / population
  report endpoint. The suite has no knowledge of one and the frozen intended purpose is
  per-open-patient, but **absence of evidence in this repo is not proof one doesn't exist
  on the server.** Live discovery (unknown #1 above) is the only way to settle it. Treat the
  whole "(b) plausibly reachable via discovery" branch as unproven until that capture is
  done.
