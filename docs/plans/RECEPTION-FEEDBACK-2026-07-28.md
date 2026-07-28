# Reception feedback build plan — 2026-07-28

**What this is:** the build plan for the feedback from the reception team's
evening session with the prescribing walk-through (2026-07-27/28). Five asks,
in the team's own words, mapped onto what the codebase actually has. Three
recon passes were done on 2026-07-28 — reception/messaging internals,
slots/booking internals, and a clinical web-research sweep (Pharmacy First
Oct-2025 pathway refresh, NG12/NG126/NG225-derived question sets, NHSE care
navigation + HEE competency framework, MPS delegated-authority conditions) —
and a virtual-Dave verdict pass was applied before this doc was committed.

The five asks:

| # | Ask (as fed back) | Verdict | Effort |
|---|---|---|---|
| A | GP→Reception message presets: book registrar / first-contact physio / MHP; medication review / DOAC review / CVD review; "add to jobs list" | Config + one migration mechanism — the composer shipped in v3.197.0 already does the rest | S |
| B | New structured-question pathways: genito-urinary (male), genito-urinary/gynae (female), mental health | Data-only for the panel + synonym maps + CSO gate | M |
| C | In-line "message the patient (reply-able) / ask for a photo" button inside every pathway | **No send primitive exists.** Discovery spike first; prepare-only fallback exists | Spike → M/L |
| D | Slots-page-style appointment search + booking inside the reception view (type × specific day / 1–4 week windows) | Extract shared booking core (3rd copy is forbidden), add window search | M/L |
| E | If-this-then-that disposition routing (Pharmacy First / ANP / paramedic / GP), editable for practice-authored packs, MH always to triage doctor | Schema + engine + editor; hard-coded guardrails | M |

Recommended order: **A → B → D → E → C-spike** (C's spike can run any time;
its build waits on what the spike finds).

---

## A. GP → Reception quick-action presets

The v3.197.0 composer (`shared/quick-actions-core.js`,
`content-scripts/reception-quick-actions.js`) already composes
`{action} with {who}, {when}.` lines into the task Internal comment,
append-only, never auto-submits. Everything asked for is a list entry:

- **`who` additions** — `Registrar`, `First-contact physio`,
  `Mental health practitioner`. Roles go in `who`, not `actions`
  (28-char action label cap: "Book mental health practitioner" is 31 chars
  and would clamp mid-word). Each new generic role needs a `WHO_RENDER`
  entry (`quick-actions-core.js:101`) so it reads mid-sentence
  ("with the registrar", "with a first-contact physio", "with a mental
  health practitioner"), and `test-quick-actions-core.js` pins the composed
  sentences verbatim — preset change = two-file edit + test update, by design.
- **`actions` additions** — `Book medication review`, `Book DOAC review`,
  `Book CVD review`, `Add to jobs list`. Verb-first, ≤28 chars (all fit).
- **`when`** — shipped list already covers Today → Within 4 weeks; no change.

**The real work is the migration.** `DEFAULT_CONFIG` is deep-frozen and has
no version-gated merge: any user with a stored `triagelens.quickActions`
never receives new shipped presets (same failure class as the stranded
v3.75.0 chip labels, minus the fix). Two options:

1. *(recommended)* Add `version: 2` to `DEFAULT_CONFIG` and a
   `mergeShippedPresets(cfg)` in `quick-actions-core.js`: when stored
   `version < shipped version`, union in shipped entries not already present
   (match on normalised label), never remove or reorder user entries, then
   stamp the new version. Mirrors the `mergeShippedDefaults` +
   `RETIRED_CHIP_LABELS` doctrine. Test: stored-v1-config × merge →
   user entries intact, new entries appended, idempotent on re-run.
2. Do nothing and tell practices to "Restore shipped defaults" — rejected:
   it silently discards practice-added names.

**"Jobs list": does not exist** — anywhere in the codebase or the observed
Medicus API surface. `Add to jobs list` as a free-text action label works
today exactly like the shipped `Add to duty list` (a human reads it and does
the thing). If the practice wants a *real* jobs list, the only existing write
primitive is a Medicus **general task**
(`POST /patient/workflow/general-task/create`, `shared/task-api.js`) assigned
to a team — that's a separate, later decision and is exactly the C4 v2
posture in `TRIAGE-NORTHSTAR-2026-07-22.md`. **Open question for Dave:** is
"jobs list" a Medicus team/task queue at your practice, or a paper/board
concept? Label-only ships now either way.

---

## B. Three new capture pathways

Panel-side this is data-only: append to `pathways[]` in
`rules/reception-pathways.json` (schema enforced by
`shared/reception-pathway-utils.js` `validatePathway`), bump `lastUpdated` +
`specVersion`, run `test-reception-pathways.js`. No per-pathway code in the
panel. But three things bite silently if skipped:

1. **`engine/reception-match.js` synonym maps.** A pathway absent from
   `SYNONYM_TERMS` / `RED_FLAG_TOPIC_TERMS` gets a panel tile but is never
   offered by the live queue chip — silently. Add entries for all three,
   and add the missing coverage test (`test-reception-pathway-coverage.js`:
   every shipped pathway id must have a synonym entry — the
   `test-drug-brand-coverage.js` pattern applied here).
2. **The double gate is a feature, not a bug.** New pathways ship OFF and
   stay invisible until the practice enables them in options — correct for
   CSO-gated clinical content. But add a "new pathways available" nudge in
   the options Reception section (a `NEW` badge on unenabled bundled
   pathways whose id postdates the stored acceptance), or practices will
   never know they arrived.
3. **`urinary` retitle.** The existing pathway is "Urinary symptoms (woman
   16–64)". With male GU landing, retitle its tile contextually — but
   remember `reception.pathwayOverrides` is a whole-object fork: a practice
   that edited `urinary` keeps their fork; leave the id alone.

### Draft content (CSO review required before enable — this section is a
### starting draft, not signed-off clinical content)

Sourced from NICE CKS (UTI lower — men; prostatitis — acute; scrotal
problems; vaginal discharge), NG12 (urological + gynae cancer criteria),
NG110, NG126 (ectopic), NG225 (self-harm), CKS depression, lay-phrased for
telephone use by non-clinical staff. **Research caveats:** primary NICE pages
could not be fetched this session (secondary-source snippets only); the
reported April-2026 NG12 refresh and CA125 age-banded thresholds are
UNVERIFIED — and irrelevant here anyway: **no lab thresholds are encoded in
reception pathways.** The Keeper's next pass should verify the CKS wording
against primary pages before CSO sign-off.

**`gu-male` — "Urinary / genital problems (male)"** (no Pharmacy First —
male UTI is excluded by the service spec; this pathway must not carry a
`pharmacyFirst` block).
Red flags: sudden severe testicular pain, especially onset within hours,
± nausea/vomiting (999 — torsion; HSSIB/NCEPOD time-critical); cannot pass
urine at all with painful full bladder (999 — acute retention); fever with
rigors/confusion/very unwell with urinary or testicular symptoms (999 —
sepsis, NG253-255 cluster); fever + loin pain with urinary symptoms (duty);
visible blood in urine (duty — NG12 45+ criterion captured in the summary,
not gated by the receptionist); painless testicular lump / change in shape
or texture (duty — NG12).
Questions: problem area (waterworks / testicle / other), dysuria, blood in
urine, fever/unwell, perineal or rectal-area pain, LUTS (frequency, weak
stream, hesitancy, nocturia), testicular pain/swelling + speed of onset,
known prostate problems or PSA history.

**`gyn-female` — "Gynae / urinary problems (female)"** (complements, not
replaces, the existing `urinary` UTI pathway; capture form should
cross-reference it for classic cystitis symptoms).
Red flags: possible pregnancy + faint/dizzy/severe or sudden one-sided pain
(999 — ectopic, NG126); possible pregnancy + shoulder-tip pain (999 —
NG126); early pregnancy + heavy bleeding (soaking a pad an hour) or passing
tissue (999); sudden severe one-sided pelvic pain with vomiting or faintness
(999 — torsion/cyst accident); postmenopausal bleeding not explained by HRT
(duty — NG12); repeated post-coital bleeding (duty); persistent bloating /
early satiety / appetite loss most days ≥3 weeks, especially 50+ (duty —
NG12 ovarian symptom cluster).
Questions: pregnancy possibility / missed period, current bleeding vs normal
period, pain (onset, side, severity), discharge (colour/smell/itch),
menopausal status / last period, bleeding after sex, ovarian symptom screen,
fever/faint/unwell.

**`mental-health` — "Mental health / emotional distress"**
Design note that must survive into the JSON `sources` and a code comment:
**NG225 explicitly advises against risk-stratification tools and scales.**
This pathway is a minimal capture-and-escalate script — binary red-flag
triggers exactly like every other pathway, deliberately few questions, no
scoring, escalate readily. The existing `general` pathway's two MH red
flags (attempt-in-progress/plan+means → 999; thoughts without plan → duty)
move up to be the top of this pathway and STAY in `general` too (callers
don't announce the right pathway).
Red flags: in danger right now / overdose taken / serious injury / someone
else at risk (999); thoughts of ending life with plan and means available
now (999); self-harm today needing physical treatment (999 if injury
urgent, else duty); hearing/seeing/believing things others say aren't
real and struggling to cope (duty, 999 if acute and escalating); child or
vulnerable adult at risk (duty/safeguarding lead — immediate, bypasses all
routing); no safe place / nobody with them and in distress (duty).
Questions: are you safe right now; what's happening today (own words —
capture, don't interpret); thoughts of harming yourself (direct ask, per
CKS depression); anyone with you; already known to a MH team or crisis
service; what they were hoping for today (never overrides red flags).

**Disposition posture for all three (feeds section E):** `gu-male`,
`gyn-female` and `mental-health` are **never** protocol-routed to Pharmacy
First / ANP / paramedic. MH routes to duty/triage clinician only.

---

## C. In-pathway "message the patient / ask for a photo" button

**Honest status: the extension has no way to send a patient a message.**
The recon was exhaustive: the communication-thread task's reply/attachment
model is *readable* (`download-attachment` endpoint, reply-from-requester
cards already parsed by triage-lens), but no send/write endpoint has ever
been captured, and the transactional API has no messaging op. Two real
options, one fake one:

- **C-spike (do first, timeboxed):** run `scripts/booking-flow-capture.js`
  (the MAIN-world recorder that reverse-engineered the six booking
  endpoints) against Medicus's own "message patient" flow on a live
  session, and find out what a `/communication/…` send actually looks like
  — payload, recipient resolution, reply-thread creation, attachment-request
  semantics. Outcome is a go/no-go note in `docs/`.
- **C-v1 (buildable regardless of spike):** the **prepare-only** pattern
  that already has hazard-log sanction (`lab-file-button.js`
  `fileAndMessage`): a button on the capture form that composes the ask
  ("Please reply to this message with a photo of the affected area…",
  template per pathway) and — on the Medicus task page — selects the native
  "message patient" next step and pre-fills the body, **never sends**.
  In the side panel (no task page under it), the same button copies the
  composed message + shows "paste into Medicus → Message patient". Weak,
  but shippable and safe.
- **C-v2 (only if the spike lands a clean endpoint):** real send with
  reply-able thread + photo request. This is a new clinical write surface:
  new hazard entry (wrong-patient send is an H-043-class hazard **worse
  than booking** — PHI leaves the building), pin-and-re-verify discipline,
  CSO sign-off before enable, default OFF.

Do not promise C-v2 to the reception team until the spike reports.
Photo *inbound* is already solved — `document-file-inline.js` files
patient-submitted photos into the record.

---

## D. Slot search + booking inside reception

What the team asked for is the slots-page booking flow, in the reception
view, with **window search** ("type X on a specific day / within 1, 2, 3, 4
weeks") — which doesn't exist anywhere yet (both existing booking surfaces
are single-day).

**Prerequisite ruling — no third copy.** There are already two divergent
copies of the booking flow (`side-panel/modules/slots/booking-api.js` +
`slots.js` UI, and the copy-pasted `content-scripts/booking-inline.js`), and
they already disagree on the load-bearing safety control. A third copy is
how the next H-043 ships. So:

1. **Extract `shared/booking-core.js`** — the six endpoint functions move
   out of `slots/booking-api.js` (which becomes a re-export shim so slots.js
   is untouched), dual-mode export (ES + `window.BookingCore`) so
   `booking-inline.js` can adopt it later. First CI coverage for this write
   path (`test-booking-core.js`: payload shape, reservation-release paths,
   window-search date fan-out).
2. **Window search:** add `findSlotsInWindow(apiBase, {appointmentTypeId,
   providerId, fromDate, days, skipWeekends, limit})`. **Before** building
   the N-sequential-calls loop, spend 30 minutes with
   `booking-flow-capture.js` confirming whether
   `available-appointment-places-between-range` accepts an end/`maxDateTime`
   param — the endpoint name says "between-range" and the current client
   reads exactly one `availablePlaces[date]` key; if the server already does
   ranges, the whole feature is one call instead of up to 28 credentialed
   calls per search on a phone-call-latency surface. If it must be N calls:
   `fetchManyDates`-style pooling (concurrency 5), weekends skipped, stop
   early at `limit` results, and present results grouped by day with
   earliest-first.
3. **UI:** a `booking-panel` component (`side-panel/modules/shared/`),
   mounted as a third `rcp-card` under the capture form. Type select (from
   `fetchAppointmentFinder`), date mode chips (`Specific day · 1wk · 2wk ·
   3wk · 4wk`), slot list, confirm step with **reason pre-filled from the
   active pathway title**. Reuses the slots `.bk-*` flow structure but
   renders into its own sub-container (reception renders per-card, not
   whole-module).
4. **Safety, non-negotiable:**
   - Commit-time wrong-patient re-verification (the `booking-inline.js`
     H-043 control, **not** slots.js's weaker capture-once) — re-resolve the
     panel's patient context immediately before `createAppointment`, abort
     on mismatch. Reception's patient card already has the
     `_patientCardGen` token discipline; extend it to booking.
   - Reservation release on **every** reception exit path: pathway-tile
     navigation, picker re-render on storage change, module `cleanup()`,
     panel close (`keepalive: true` release, as booking-inline).
   - No booking/slot/patient state ever persisted to `chrome.storage`
     (draft autosave stays capture-fields-only).
   - Hazard-log entry before ship; slots.js gets the commit-time re-check
     retrofitted in the same PR (it's ~15 lines once booking-core exists —
     closing a known gap, not scope creep).
5. **C4 alignment:** `TRIAGE-NORTHSTAR` C4 (next-green-day disposition
   assist, GP-side, deliberately never books) consumes the same extraction.
   Build booking-core once; C4 and reception both sit on it.

**v0 escape hatch** if D must wait: the leaflets-style handoff (write
`slots.pendingSearch`, click the slots nav tab) is ~30 lines and gives
reception *something* while booking-core lands. Ship it only as a stopgap.

---

## E. If-this-then-that disposition routing (editable)

The ask: after a capture with no red flags, the tool suggests where the
patient can safely go — Pharmacy First / ANP or minor-illness nurse /
paramedic practitioner / GP — for the minor-illness packs; serious domains
always go to the triage doctor; and practices authoring their own packs get
the same mechanism.

**Posture (this is the clinically load-bearing sentence): the engine
*suggests*, a human *decides*, and every suggestion carries the
offer-a-clinician fallback.** That matches the NHSE care-navigation
guidance (urgency rules clinician-agreed; safety-netting recorded), the MPS
delegated-authority condition (reception must never make standalone
clinical judgements), and the suite's existing prepare-only doctrine.

### Schema — a `disposition` block per pathway

```json
"disposition": {
  "domain": "minor_infection | msk | gu_male | gyn_female | mental_health | other",
  "allowed": ["pharmacy_first", "anp", "paramedic", "gp_routine"],
  "rules": [
    { "when": { "pharmacyFirstEligible": true }, "suggest": "pharmacy_first" },
    { "when": { "ageUnder": 1 },                 "suggest": "gp_routine" }
  ],
  "default": "gp_routine"
}
```

**Hard-coded guardrails in the engine, NOT expressible in data** (this is
the part practices cannot edit away, and the reason the block is safe to
hand to the pathway editor):

1. Any positive red flag → escalation banner wins; disposition never renders.
2. `domain: mental_health` (or any pathway flagged `alwaysClinician: true`)
   → the only outputs are duty/triage-clinician; `allowed` is ignored.
3. Safeguarding trigger → duty/safeguarding lead, bypasses everything.
4. Pharmacy First suggestions re-check the existing `pharmacyFirstEligibility`
   logic (age gates, fails closed on unknown age) — the Oct-2025 pathway
   refresh changed pharmacy-side gateway mechanics but **not** the
   age/inclusion criteria the tool encodes, so current gates stand.
5. Every rendered suggestion includes the fixed fallback line: *"Or a
   clinician callback if the patient prefers — always offer it."*

### Where it lands

- `evaluateDisposition(pathway, answers, patientAge)` in
  `reception-core.js` (pure, testable — `test-reception-disposition.js`
  with a truth table per guardrail).
- Validation of the block in `reception-pathway-utils.js`
  `validatePathway` (unknown destination / malformed `when` → pathway
  invalid, never silently wrong). The LLM authoring prompt
  (`pathwaySchemaPrompt`) gains the block WITH the guardrail semantics
  spelled out so generated packs can't smuggle routing past them.
- Suggestion renders as a card between the escalation banner (absent, by
  definition) and Generate summary; chosen/overridden route goes into the
  capture text: `Suggested route: Pharmacy First (acute sore throat, age 7,
  no red flags) — receptionist confirmed / overrode to: …` — the NHSE
  record-the-navigation requirement lands in the paste-into-Medicus text.
- Options pathway editor gains a Disposition section (domain select,
  allowed-destination checkboxes, simple rule rows). `mental_health`
  domain selection greys out the non-clinician destinations with a note.
- Shipped packs get conservative blocks: PF-eligible pathways
  (sore-throat, earache, sinusitis, urinary, rash) suggest `pharmacy_first`
  only via the existing eligibility gate; cough/feverish-child/headache/
  backpain get `anp`/`paramedic`/`gp_routine` options; the three new
  section-B pathways and `general` are clinician-only. **All disposition
  blocks are CSO-review content** — same gate as the pathways themselves.

Editable custom packs inherit all of this for free: same schema, same
validator, same hard guardrails, same editor.

---

## Sequencing, versioning, safety programme

| Phase | Ships | Version | Gates |
|---|---|---|---|
| 1 | A (presets + version-gated merge) | minor | test-quick-actions-core update |
| 2 | B (3 pathways, synonym maps, coverage test, options NEW badge) | minor | **CSO sign-off before any practice enables**; Keeper verifies CKS wording |
| 3 | D (booking-core extraction + reception booking panel + window search) | minor | hazard-log entry + CSO; slots.js re-check retrofit in same PR |
| 4 | E (disposition engine + editor + shipped blocks) | minor | CSO sign-off on shipped blocks; guardrail truth-table tests |
| 5 | C-spike → C-v1 (prepare-only) → C-v2 decision | v1 minor | C-v2 requires new hazard entry + CSO, default OFF |

Every phase: manifest bump + CHANGELOG on the same commit. `defaults.json`
is untouched by all of this (reception pathways are not part of it) —
**except** if E's Pharmacy First posture changes any `resultRules`/chips,
which it currently does not.

**Open questions for Dave (none block Phase 1):**
1. "Jobs list" — Medicus team-task queue, or a label for humans? (A ships
   label-only either way; the task-write version is a C4-v2-shaped decision.)
2. Appointment-type names for registrar/FCP/MHP bookings are
   practice-specific strings in Medicus — confirm the exact names so D's
   type filter can pre-select them from the finder enumeration.
3. C-v2 appetite: if the spike finds a clean send endpoint, do you want
   real patient messaging in the extension at all, given the hazard class?
