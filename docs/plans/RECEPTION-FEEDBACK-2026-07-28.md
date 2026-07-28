# Reception feedback build plan — 2026-07-28

**What this is:** the build plan for the feedback from the reception team's
evening session with the prescribing walk-through (2026-07-27/28). Five asks,
in the team's own words, mapped onto what the codebase actually has. Three
recon passes were done on 2026-07-28 — reception/messaging internals,
slots/booking internals, and a clinical web-research sweep (Pharmacy First
Oct-2025 pathway refresh, NG12/NG126/NG225-derived question sets, NHSE care
navigation + HEE competency framework, MPS delegated-authority conditions).

**A virtual-Dave verdict pass was applied 2026-07-28** and materially changed
this plan: a governance Phase 0 was added (the Clinical Safety Notice and
Intended Purpose statement currently assert "no write path" and
"clinicians-only users" — both become false claims the moment reception
booking ships); the C "no send primitive" claim was corrected (the booking
payload's `bookingConfirmationRecipients` already fires patient
SMS/email today); E's guardrails were moved out of editable pathway data
into frozen engine constants; D gained open-record gating, red-flag
suppression, and name+DOB read-back; B's mental-health pathway lost its
disposition card entirely and gained a no-draft-autosave rule; and the
sequencing was re-ordered (booking-core extraction early as a pure refactor,
disposition engine before any reception Book button exists).

The five asks:

| # | Ask (as fed back) | Verdict | Effort |
|---|---|---|---|
| A | GP→Reception message presets: book registrar / first-contact physio / MHP; medication review / DOAC review / CVD review; "add to jobs list" | Config + one migration mechanism — the composer shipped in v3.197.0 already does the rest | S |
| B | New structured-question pathways: genito-urinary (male), genito-urinary/gynae (female), mental health | Data-only for the panel + synonym maps + CSO gate | M |
| C | ~~In-line "message the patient (reply-able) / ask for a photo" button~~ | **DROPPED — Dave, 2026-07-28.** See the stub in section C for what survives (booking-confirmation channel control in D; inbound photo filing already shipped) | — |
| D | Slots-page-style appointment search + booking inside the reception view (type × specific day / 1–4 week windows) | Extract shared booking core (3rd copy is forbidden), add window search, gate hard on identity | M/L |
| E | If-this-then-that disposition routing (Pharmacy First / ANP / paramedic / GP), editable for practice-authored packs, MH always to triage doctor | Schema + engine + editor; guardrails frozen in engine code, NOT in data | M |

**Order (post-review, C dropped): 0 → A → D1 → B → E → D2/D3.**
D1 (the booking-core extraction + slots retrofit) is a pure refactor that
closes an existing gap — lowest-risk item on the list, ship it early. E lands
*before* the reception Book button exists, because a Book button under a
"no red flags" capture with no guardrail layer is the worst automation-bias
configuration buildable — and E is what makes reception booking defensible
("reception booked what the clinician-agreed rule allowed, and it's
recorded"). E without D2 is inert; inert is the safe direction.

---

## Phase 0 — governance resync (BLOCKS phase D)

The safety case currently says things this plan will make false:

- `docs/CLINICAL-SAFETY-NOTICE.md` §6.2/6.3: *"The software has no write
  path to Medicus… does not submit any data to Medicus… does not assign
  tasks."* Already false at v3.197.1 (`createAppointment` in booking-inline
  and slots, task-inline, routine-rx, lab filing — H-043 itself names the
  booking write paths). D extends the write surface further.
- `docs/INTENDED-PURPOSE.md` repeats the no-write claim inside the
  **frozen** statement and restricts intended users to "Qualified
  clinicians". Reception hands a write path to non-clinical staff.
- `docs/DPIA.md` contains the word "reception" zero times, while the
  reception module persists special-category free text on shared
  front-desk workstations.

Phase 0 deliverables: (a) rewrite CSN §6.2/6.3 to describe the actual write
paths and their controls; (b) re-freeze the intended-purpose statement — a
new version + CSO signature, not an edit — and amend the intended-user
section to name non-clinical staff operating under practice delegated
authority; (c) add a reception section to the DPIA (special-category data,
draft persistence, shared-workstation processing); (d) update
`docs/cso-review-ledger.json`. If MPS ever asks what the safety case said
the software could do when a receptionist booked the wrong patient, the
answer must not be "it said it couldn't do that".

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
  Add a label-length assertion to `test-quick-actions-core.js` so no future
  preset silently clamps at `QA_LIMITS.label`.
- **`when`** — shipped list already covers Today → Within 4 weeks; no change.

**The real work is the migration.** `DEFAULT_CONFIG` is deep-frozen
(`version: 1`) and has no version-gated merge: any user with a stored
`triagelens.quickActions` never receives new shipped presets (same failure
class as the stranded v3.75.0 chip labels, minus the fix). Approach:

1. Bump `DEFAULT_CONFIG.version` to 2 and add `mergeShippedPresets(cfg)` in
   `quick-actions-core.js`: when stored `version < shipped`, union in
   shipped entries not already present (match on normalised label), never
   remove or reorder user entries, stamp the new version. **The merge must
   run in BOTH consumers of the storage key, in lock-step** — the widget
   load path (`reception-quick-actions.js`) *and* the options editor
   (`options/options.js` `initQuickActions`) — or the editor writes back a
   v1-shaped config and un-migrates the user on their next save. Same
   two-file doctrine as `mergeShippedDefaults`/`RETIRED_CHIP_LABELS`.
   Tests: user entries intact, new entries appended, idempotent on re-run,
   both-surface parity.
2. "Restore shipped defaults" alone — rejected: silently discards
   practice-added names.

**User add/remove is a first-class requirement (Dave, 2026-07-28), and it's
mostly already there:** the options Quick Actions editor edits all four
lists (actions / who / when / fallbacks), and the widget's `+ name` chip
adds `who` entries in-flow. Two things to make it actually easy:

- **One-click remove per entry in the options editor**, per list, with the
  live example sentence updating so the effect is visible before save.
- **Removals must survive migrations.** A naive union merge would
  resurrect every shipped preset the practice deliberately deleted, on
  every version bump. `mergeShippedPresets` keeps a `removedShipped`
  tombstone list (normalised labels the user deleted from the shipped
  set); the union skips tombstoned entries, and re-adding one manually
  clears its tombstone. Test: delete shipped entry → migrate → still gone.

**"Jobs list": does not exist** — anywhere in the codebase or the observed
Medicus API surface. `Add to jobs list` as a free-text action label works
today exactly like the shipped `Add to duty list` (a human reads it and does
the thing). If the practice wants a *real* jobs list, the only existing write
primitive is a Medicus **general task**
(`POST /patient/workflow/general-task/create`, `shared/task-api.js`) assigned
to a team — a separate, later decision, C4-v2-shaped
(`TRIAGE-NORTHSTAR-2026-07-22.md`). **Open question for Dave:** is "jobs
list" a Medicus team/task queue at your practice, or a paper/board concept?
Label-only ships now either way.

---

## B. Three new capture pathways

Panel-side this is data-only: append to `pathways[]` in
`rules/reception-pathways.json` (schema enforced by
`shared/reception-pathway-utils.js` `validatePathway`), bump `lastUpdated` +
`specVersion`, run `test-reception-pathways.js`. No per-pathway code in the
panel. Things that bite silently if skipped:

1. **`engine/reception-match.js` synonym maps.** A pathway absent from
   `SYNONYM_TERMS` / `RED_FLAG_TOPIC_TERMS` gets a panel tile but is never
   offered by the live queue chip — silently. Add entries for all three,
   and add the missing coverage test (`test-reception-pathway-coverage.js`:
   every shipped pathway id must have a synonym entry — the
   `test-drug-brand-coverage.js` pattern applied here). **Pin the GU
   tie-break in the same test:** "uti" / "waterworks" / "urine infection"
   will legitimately match both `urinary` and `gu-male`; `matchPathways`
   returning both (offer both, never auto-pick) is the *intended* behaviour
   — assert it so nobody "fixes" it into first-match-wins.
2. **The double gate is a feature, not a bug.** New pathways ship OFF and
   stay invisible until the practice enables them in options — correct for
   CSO-gated clinical content. But add a "new pathways available" nudge in
   the options Reception section (a `NEW` badge on unenabled bundled
   pathways), or practices will never know they arrived.
3. **`urinary` retitle.** With male GU landing, retitle the existing
   "Urinary symptoms (woman 16–64)" tile contextually — but
   `reception.pathwayOverrides` is a whole-object fork: a practice that
   edited `urinary` keeps their fork; leave the id alone.
4. **Schema additions this phase needs** (all validated in
   `reception-pathway-utils.js` and propagated into `pathwaySchemaPrompt()`
   so LLM-authored packs know them):
   - `safeguarding: true` on a red flag — renders with the practice's
     configured safeguarding-lead contact and bypasses all routing (this is
     the mechanism behind E's guardrail 3; without it that guardrail is an
     unevidenceable claim).
   - `sensitive: true` on a pathway — **skips draft autosave entirely**
     (one guard at the `scheduleDraftSave` call site). Suicidal-ideation
     free text must not sit in `chrome.storage.local` for four hours on a
     shared front-desk profile (H-029 territory). DPIA line in Phase 0
     covers it. Sensitive pathways also make `takerInitials` mandatory.
   - **No conditional escalations.** `escalate` is a single enum; drafts
     like "999 if injury urgent, else duty" must be split into two flags
     with unambiguous lay wording, or authors will quietly pick one level.
5. **New shared closing question** (all pathways): *"Am I speaking to the
   patient, or someone calling on their behalf? (relationship)"* — nothing
   currently captures caller-vs-patient, and parents/carers/care-home staff
   are half a reception day. Load-bearing for MH, safeguarding, and E's
   confirmed-age rule.

### Draft content (CSO review required before enable — starting draft, not
### signed-off clinical content)

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

**`mental-health` — "Mental health / emotional distress"** (`sensitive: true`)
Design note that must survive into the JSON `sources` and a code comment:
**NG225 explicitly advises against risk-stratification tools and scales.**
This pathway is a minimal capture-and-escalate script — binary red-flag
triggers exactly like every other pathway, deliberately few questions, no
scoring, escalate readily. **It renders no disposition card at all — not
even a clinician-shaped one** (a category label on a distress call is a
stratification output by another name); it closes instead with a hard-coded
line carrying the practice's configured crisis route (111 option 2 / local
crisis line, practice-editable text). The existing `general` pathway's two
MH red flags move up to the top of this pathway and STAY in `general` too
(callers don't announce the right pathway).
Red flags (conditionals split per B.4): in danger right now / overdose
taken / serious injury / someone else at risk (999); thoughts of ending
life with plan and means available now (999); self-harmed today and the
injury itself needs urgent treatment (999); self-harmed today, injury not
urgent (duty); hearing/seeing/believing things others say aren't real,
acutely worsening and unable to cope (999); same, present but not acutely
escalating (duty); child or vulnerable adult at risk
(`safeguarding: true`, duty/safeguarding lead — immediate, bypasses all
routing); no safe place / nobody with them and in distress (duty).
Questions: are you safe right now; what's happening today (own words —
capture, don't interpret); thoughts of harming yourself (direct ask, per
CKS depression); anyone with you; already known to a MH team or crisis
service; what they were hoping for today (never overrides red flags).

**Disposition posture for all three (feeds section E):** `gu-male` and
`gyn-female` are clinician-only destinations; `mental-health` renders no
disposition output at all. None of the three is ever protocol-routed to
Pharmacy First / ANP / paramedic.

---

## C. Patient messaging — DROPPED (Dave, 2026-07-28)

The "message the patient (reply-able) / ask for a photo" ask is dropped
from this programme. Recorded so nobody resurrects it without the context:
no reply-able send endpoint has ever been captured (the communication-thread
model is readable but write-less to us; the transactional API has no
messaging op), a real send would be an H-043-class wrong-patient hazard
**worse than booking** (PHI leaves the building), and the reception team's
underlying needs are partly met elsewhere.

Two facts from the C investigation survive and stay in scope:

1. **The extension already messages patients as a side effect of booking.**
   The create payload sets `bookingConfirmationRecipients` to **every**
   channel the create-form offers (slots.js and booking-inline.js both),
   firing Medicus's SMS/email booking confirmations. Managed in D3.5
   (show and control channels at confirm, match Medicus's own default).
2. **Photo *inbound* is already solved** — `document-file-inline.js` files
   patient-submitted photos into the record.

If this ever reopens, the entry point is a timeboxed capture spike
(`scripts/booking-flow-capture.js` against Medicus's own "message patient"
flow), and the prepare-only `lab-file-button.js` `fileAndMessage` pattern
is the only pre-sanctioned shape.

---

## D. Slot search + booking inside reception

What the team asked for is the slots-page booking flow, in the reception
view, with **window search** ("type X on a specific day / within 1, 2, 3, 4
weeks") — which doesn't exist anywhere yet (both existing booking surfaces
are single-day). Split into D1 (refactor, early) and D2/D3 (new surface,
after E).

**Prerequisite ruling — no third copy.** Two divergent copies of the
booking flow already exist (`side-panel/modules/slots/booking-api.js` +
`slots.js` UI, and the copy-pasted `content-scripts/booking-inline.js`),
and they already disagree on the load-bearing safety control. A third copy
is how the next H-043 ships.

### D1 — booking-core extraction (pure refactor, ships early)

1. **Extract `shared/booking-core.js`** — the six endpoint functions move
   out of `slots/booking-api.js` (which becomes a re-export shim so
   slots.js is untouched), dual-mode export (ES + `window.BookingCore`) so
   `booking-inline.js` can adopt it later. First CI coverage for this write
   path (`test-booking-core.js`).
2. **The core never self-detects the patient.** Two identity sources exist
   today and can disagree: reception resolves the *active* tab; booking-api
   resolves the *first matching* Medicus tab, active or not. Wire that
   naively and reception books the patient from tab 2 while showing the
   patient from tab 1 — and the re-verify passes because it re-checks the
   same wrong source. `booking-core` takes `{apiBase, patientId,
   identitySource}` explicitly from the caller and **exports no
   tab-detection**; `detectMedicusTab`/`detectPatientId` stay in the slots
   shim. Test: core throws when called without an explicit `patientId`.
3. **`keepalive` moves into the core's release path** — today
   `releaseReservation` has no `keepalive`, and slots calls it from
   `cleanup()`, so panel-close releases are already being dropped. Fixing
   it in the extraction closes a live slots bug for free.
4. **Window-search caps live in the core, not the UI** (the UI is the
   thing that gets copied): max 4 weeks, concurrency ≤ 4, abort on first
   429/5xx, per-minute throttle. Eight desks × 28 credentialed calls on a
   phone-latency surface is a self-inflicted DoS on the practice scheduler.
5. **slots.js gets the commit-time wrong-patient re-check retrofitted in
   the same PR** — ~15 lines once the core exists; closing a known gap,
   not scope creep.

### D2 — window search

Add `findSlotsInWindow(apiBase, {appointmentTypeId, providerId, fromDate,
days, skipWeekends, limit})`. **Before** building the N-sequential-calls
loop, spend 30 minutes with `booking-flow-capture.js` confirming whether
`available-appointment-places-between-range` accepts an end/`maxDateTime`
param — the endpoint name says "between-range", the client reads exactly
one `availablePlaces[date]` key; if the server does ranges, the feature is
one call instead of up to 28. If it must be N calls: pooled per D1.4,
weekends skipped, stop early at `limit`, results grouped by day,
earliest-first. **While the capture is running, also record what Medicus's
own booking UI pre-selects for confirmation recipients** (feeds D3.5).

### D3 — the reception booking panel (after E)

1. A `booking-panel` component (`side-panel/modules/shared/`), mounted as a
   third `rcp-card` under the capture form. Type select (from
   `fetchAppointmentFinder`), date mode chips (`Specific day · 1wk · 2wk ·
   3wk · 4wk`), slot list, confirm step with **reason pre-filled from the
   active pathway title**. **No pre-selected appointment type, no
   auto-picked earliest slot** — type and slot are the receptionist's
   choice, and the chosen type lands in the capture text so the clinician
   sees what was booked. Renders into its own sub-container (reception
   renders per-card, not whole-module).
2. **Hard-gated on an open record.** Reception capture deliberately works
   with no record open; the booking card must render disabled with "open
   the caller's record in Medicus first". Never book against an ambient
   record.
3. **Suppressed on any positive OR unanswered red flag** —
   `evaluateRedFlags` already returns both. A duty-escalation banner with a
   Book button under it is the exact automation-bias failure H-024
   describes. Same gate as E's guardrail 1; write it once, use it twice.
4. **Name + DOB read-back at confirm.** Booking is a write; fineprint is
   not enough. Confirm step shows patient name + DOB + the slot with an
   explicit tick before `createAppointment` fires — on top of the
   commit-time re-verification (the `booking-inline.js` H-043 control,
   **not** slots.js's weaker capture-once), which re-resolves the panel's
   patient context immediately before create and aborts on mismatch.
   Reception's `_patientCardGen` token discipline extends to booking.
5. **Confirmation-recipient control.** Show the recipient channels at the
   confirm step and default to whatever Medicus's own UI pre-selects
   (recorded during the D2 capture) — not "all channels", which is what
   both existing surfaces silently do today.
6. Reservation release on **every** reception exit path: pathway-tile
   navigation, picker re-render on storage change, module `cleanup()`,
   panel close (`keepalive` release via the core).
7. No booking/slot/patient state ever persisted to `chrome.storage`
   (draft autosave stays capture-fields-only).
8. **Pop-out ruling:** booking is **panel-only**. Reception renders in the
   floating pop-out too, and a slot list + write flow in a narrow floating
   window that can sit over the wrong Medicus tab is exactly the identity
   hazard D1.2 exists to kill. The pop-out shows the capture flow as today
   and a "booking lives in the docked panel" note — recorded deliberately,
   same convention as the strips.
9. Hazard-log entry before ship; Phase 0 doc posture is a prerequisite.

**C4 alignment:** `TRIAGE-NORTHSTAR` C4 (next-green-day disposition assist,
GP-side, deliberately never books) consumes the same extraction. Build
booking-core once; C4 and reception both sit on it.

**v0 escape hatch** if D3 must wait: the leaflets-style handoff (write
`slots.pendingSearch`, click the slots nav tab) is ~30 lines. Stopgap only.

---

## E. If-this-then-that disposition routing (editable)

The ask: after a capture with no red flags, the tool suggests where the
patient can safely go — Pharmacy First / ANP or minor-illness nurse /
paramedic practitioner / GP — for the minor-illness packs; serious domains
always go to the triage doctor; and practices authoring their own packs get
the same mechanism.

**Posture (the clinically load-bearing sentence): the engine *suggests*, a
human *decides*, and every suggestion carries the offer-a-clinician
fallback.** That matches the NHSE care-navigation guidance (urgency rules
clinician-agreed; navigation recorded; safety-netting explicit), the MPS
delegated-authority condition (reception never makes standalone clinical
judgements), and the suite's prepare-only doctrine.

### Schema — a `disposition` block per pathway

```json
"disposition": {
  "domain": "minor_infection | msk | gu_male | gyn_female | mental_health | other",
  "allowed": ["pharmacy_first", "anp", "paramedic", "gp_routine"],
  "rules": [
    { "when": { "pharmacyFirstEligible": true }, "suggest": "pharmacy_first" }
  ],
  "default": "gp_routine"
}
```

### Guardrails — frozen in engine code, applied AFTER override resolution

The first draft of this plan claimed the guardrails were "not expressible
in data"; the review showed that as written they *were* data — `domain`
lives in the pathway object, and `reception.pathwayOverrides` accepts any
valid whole-object fork, so a fork of `mental-health` declaring
`domain: "other"` would have walked straight past them. Corrected design:

1. **Red-flag gate:** any positive **or unanswered** red flag → the
   disposition card never renders (the card sits inside the form, where
   unanswered is the normal state — gate on
   `unanswered.length === 0 && positives.length === 0`). Shared with D3.3.
2. **Frozen clinician-only sets:** `CLINICIAN_ONLY_IDS` (bundled pathway
   ids: `mental-health`, `gu-male`, `gyn-female`, `general`) and
   `CLINICIAN_ONLY_DOMAINS` (`mental_health`, `gu_male`, `gyn_female`) are
   **constants in engine code**, keyed on the *bundled* id and applied
   after override resolution — a fork cannot downgrade them.
   `validatePathway` additionally rejects any override that lowers a
   bundled pathway's domain. Adversarial test fixture: a `mental-health`
   fork claiming `domain: "other", allowed: ["pharmacy_first"]` must
   still produce clinician-only output. `mental-health` itself renders
   **no disposition card at all** (see B).
3. **Safeguarding:** a red flag with `safeguarding: true` (schema added in
   B.4) routes to duty/safeguarding lead immediately and bypasses
   everything. Without that schema field this guardrail would be an
   unevidenceable claim in a safety document — the field is the mechanism.
4. **Age floor, hard-coded:** age < 1 → clinician-only, no protocol
   destination, ever. Age < 5 → no `anp`/`paramedic` unless the pathway
   explicitly declares paediatric competence. (NG143: febrile under-3-months
   is red by definition; nothing in editable data may route an infant to a
   paramedic.) Pharmacy First suggestions re-check the existing
   `pharmacyFirstEligibility` gates (fails closed on unknown age) — the
   Oct-2025 refresh changed pharmacy-side gateway mechanics but not the
   age/inclusion criteria the tool encodes.
5. **Confirmed age only:** `evaluateDisposition` takes an age the
   receptionist **explicitly confirmed on the call** (confirm-age control
   on the disposition card; the caller-vs-patient closing question from
   B.5 backs it) and fails closed to `gp_routine` on unknown/unconfirmed.
   It never inherits `ageYears` from the ambient open-record snapshot —
   wrong record open → adult age → "Pharmacy First, sore throat, 5+" for a
   three-year-old caller is the unsafe direction.
6. **Custom/edited packs default clinician-only.** Non-clinician
   destinations on any custom or edited pathway are OFF until unlocked by
   a second options toggle with its own attestation, separate from
   `disclaimerAcceptedAt`. **Decision (Dave, 2026-07-28): the attester is
   the CSO or a partner** — the attestation records name, role
   (CSO/partner), and timestamp, and the options UI says so explicitly
   ("routing sign-off: CSO or partner only").
7. **Fallback line, in the artefact:** every rendered suggestion includes
   *"Or a clinician callback if the patient prefers — always offer it."*
   — in the **pasted capture text**, not just on screen.

### Where it lands

- `evaluateDisposition(pathway, answers, confirmedAge)` in
  `reception-core.js` (pure, testable — `test-reception-disposition.js`
  with a truth table per guardrail, including the adversarial-override and
  age-floor fixtures).
- Schema validation in `reception-pathway-utils.js` (unknown destination /
  malformed `when` → pathway invalid, never silently wrong). The LLM
  authoring prompt (`pathwaySchemaPrompt`) gains the block WITH the
  guardrail semantics spelled out.
- Suggestion renders as a card between the (absent) escalation banner and
  Generate summary; chosen/overridden route goes into the capture text:
  `Suggested route: Pharmacy First (acute sore throat, age 7 confirmed, no
  red flags) — receptionist confirmed / overrode to: …`. **Withheld
  dispositions are recorded too** (`Disposition withheld: red flag
  positive` / `guardrail: clinician-only pathway`) so an SEA can
  reconstruct what the tool did and didn't say. The NHSE
  record-the-navigation requirement lands in the paste-into-Medicus text.
- Options pathway editor gains a Disposition section (domain select,
  allowed-destination checkboxes, simple rule rows); clinician-only
  domains grey out non-clinician destinations with a note; custom packs
  show the attestation state.
- Anything E persists (attestation record, disposition prefs) goes into
  `shared/io/reception-io.js` export/import per the backup convention;
  transient PHI-bearing state joins the `test-backup-coverage.js`
  allowlist.
- **Hazard entry H-050 — "reception disposition suggestion acted on
  without clinician review"** — cross-referencing H-007 (automation bias)
  and H-024 (reception over-reliance). E decides who the patient sees; its
  hazard outranks D's.
- Shipped packs get conservative blocks: PF-eligible pathways
  (sore-throat, earache, sinusitis, urinary, rash) suggest `pharmacy_first`
  only via the eligibility gate; cough/backpain get
  `anp`/`paramedic`/`gp_routine`; `feverish-child` is age-floored by
  guardrail 4 (under-1 clinician-only, under-5 no ANP/paramedic without
  declared paediatric competence); the three new pathways and `general`
  are clinician-only. **All disposition blocks are CSO-review content.**

Editable custom packs inherit all of this for free: same schema, same
validator, same frozen guardrails, same editor.

---

## Sequencing, versioning, safety programme

| Phase | Ships | Version | Gates |
|---|---|---|---|
| 0 | Governance resync (CSN §6.2/6.3, INTENDED-PURPOSE re-freeze, DPIA reception section, review ledger) | patch | CSO signature on the re-frozen statement |
| 1 | A (presets + version-gated merge in both surfaces) | minor | test-quick-actions-core update incl. label-length assertion |
| 2 | D1 (booking-core extraction, no self-detection, keepalive release, caps; slots re-verify retrofit; test-booking-core) | minor | hazard-log note (control improvement, no new surface) |
| 3 | B (3 pathways, schema additions, synonym maps + coverage test, caller-relationship closing question, options NEW badge) | minor | **CSO sign-off before any practice enables**; Keeper verifies CKS wording |
| 4 | E (disposition engine, frozen guardrails, editor, attestation, shipped blocks) | minor | H-050 + CSO sign-off on shipped blocks; guardrail truth-table tests |
| 5 | D2/D3 (window search + reception booking panel, panel-only) | minor | Phase 0 complete; hazard-log entry; CSO |

(C dropped 2026-07-28 — see section C stub.)

Every phase: manifest bump + CHANGELOG on the same commit. `defaults.json`
is untouched by all of this (reception pathways are not part of it).

**Open questions for Dave (none block Phases 0–2):**
1. "Jobs list" — Medicus team-task queue, or a label for humans? (A ships
   label-only either way; the task-write version is a C4-v2-shaped decision.)
2. Appointment-type names for registrar/FCP/MHP bookings are
   practice-specific strings in Medicus — confirm the exact names so D3's
   type filter can surface them from the finder enumeration (no
   pre-selection either way).
(Resolved 2026-07-28: patient messaging dropped entirely; custom-routing
attestation is signed by the CSO or a partner, with name + role + timestamp
recorded.)
