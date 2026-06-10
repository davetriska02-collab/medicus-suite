# Changelog

All notable changes to Medicus Suite are documented here.

## [v3.48.0] — 2026-06-10

### Feature: Action Packs — copy-ready blood forms, recall SMS/letters and tasks per chip

Sentinel chips now carry copy-ready action text so clinicians can act on alerts
without hand-writing every communication.

- New `side-panel/modules/shared/action-packs.js` (pure ES module, no chrome/DOM):
  exports `buildChipActions(chip, patient)` and `buildPatientActions(chips, patient)`.
  Generates per-chip packs with `bloodForm` (only due tests, drug, status, source
  citation), `sms` (first recall ≤320 chars, NHS Behavioural Insights pattern),
  `smsEscalation` (consequence-transparent, CQC-aligned: prescriber informed /
  prescription may be paused), `letter` (~120 word behaviourally-informed body),
  and `task` (pharmacist/admin line with NHS number and order set). QOF indicator
  chips produce review SMS/letter/task. Vaccine chips produce offer SMS + task.
  Non-action chips return `null`.
- `buildPatientActions` aggregates across all action-needed chips: deduplicates
  blood-form lines, combines a single recall SMS listing all items, and produces a
  combined task block.
- UI: each action-needed chip in the Sentinel side-panel now has an "Actions"
  button below it. Clicking opens a modal titled with the chip name, showing
  labelled sections (Blood form, Recall SMS, Escalation SMS, Letter, Task) each
  with a per-section "Copy" / "Copied ✓" clipboard button.
- "Copy all actions" button added to the Sentinel footer (next to "Appts summary")
  — opens a combined modal with deduplicated blood forms, combined SMS, and
  combined task block.
- New CSS prefix `sent-act-` in `sentinel.css` for all action-pack UI elements.
- 61-assertion test suite in `test-action-packs.js` covering: overdue
  methotrexate chip (FBC+LFT overdue, U&E in-date → bloodForm lists only FBC+LFT),
  SMS ≤400 chars, escalation SMS mentions prescriber, QOF DM review SMS, vaccine
  offer SMS, non-action chip → null, `buildPatientActions` deduplication.

## [v3.47.0] — 2026-06-10

Four workstreams landed together: extraction-drift detection, clinical-coverage
expansion, a per-patient evaluation audit trail, and engineering hygiene.

### Feature: Live extraction-health drift detection

The extension now self-detects when Medicus UI changes silently degrade DOM
extraction — previously a missing-chip failure mode with no warning.

- New `shared/extraction-health.js`: pure drift-detection module. Keeps a
  rolling per-view baseline (40 samples) of medication/observation/problem/
  demographic **counts** in `chrome.storage.local` (`sentinel.extractionBaseline`
  — zero PII by schema, enforced by test; deliberately excluded from backups
  as machine-local telemetry).
- Drift fires only on a sustained signature (≥4 of last 5 samples zero on a
  metric whose historical median ≥3, after a 10-sample cold-start gate) — a
  single sparse patient never alarms.
- Amber dismissible banner ("Alerts may be incomplete — this is NOT an
  all-clear") in both the in-page Sentinel HUD and the side-panel Sentinel
  module; dismissal mutes both surfaces for 24h. Drift detection can never
  break chip publication (fail-safe wrapped).

### Feature: Per-patient evaluation audit trail ("Why?" + exportable log)

- `engine/rules-engine.js` gains an opt-in trace sink (`options.trace`): for
  every rule considered it records fired/skipped, the skip reason
  (age/sex/problem filter, no drug match, register precondition, disabled…),
  the exact matched med/problem string and match term, the interval arithmetic
  (last test date + interval → due date), and the rule's source citation.
  Hot path is byte-identical when tracing is off.
- New `drugMatchDetail` and `listUnmatchedMedicationsDetailed`: unmatched meds
  now distinguish "no rule covers this" from "suppressed by an exclude term",
  shown with an amber annotation in the panel — exclude-term suppression is
  no longer silent.
- Evidence panel gains a plain-language "Why?" block per chip (e.g. matched
  term, last test date, interval, due date) plus the rule's source.
- New "Export evaluation log" button produces a per-patient JSON trace for
  audit/assurance (DCB0129/0160-style). The trace lives in memory per
  snapshot only — patient-identifiable data is never written to storage;
  export is an explicit user action.

### Clinical: QOF HF009 enabled (four-pillar HFrEF therapy)

- New `medication-all-of` indicator kind in the rules engine; `qof-hf009`
  flipped to enabled. Empty med list → `no_data` (extraction failure is not
  "not on therapy"); populated list missing a pillar → `not_met` with the
  missing class named.
- First engine-level regression tests for `observation-bundle` (DM037 8/8
  care processes) included.

### Clinical: Vaccine rules — bug fix + Green Book adult schedule expansion

- **Bug fix (safety):** vaccine status terms are now checked
  declined-before-given per record — previously a coded "Influenza
  vaccination declined" matched the given-stem "flu vaccin" and showed as
  GIVEN. Regression-tested.
- New `schedule: "once"` support for one-off (non-seasonal) vaccines, and a
  fail-closed `bornOnOrAfter` eligibility gate.
- New rules: pneumococcal PPV23 (65+, one-off), shingles/Shingrix (70–79 plus
  the phased born-on/after-1-Sept-1958 cohort; cannot verify 2-dose
  completion — noted), RSV (75–79, one-off). Pertussis-in-pregnancy
  deliberately omitted (engine has no per-pregnancy/gestation gate; omission
  documented in the rule file so it isn't "helpfully" added later).

### Clinical: Visualiser PINCER expansion

- `computePINCER` extended toward the classic PINCER indicator set: NSAID or
  antiplatelet with peptic-ulcer/GI-bleed history without gastroprotection,
  NSAID ≥65 without gastroprotection (PINCER #1), anticoagulant+antiplatelet
  without gastroprotection (PINCER #13), dual antiplatelet without PPI
  (PINCER #8), and ACEi/ARB or loop diuretic at ≥75 without recent U&E.
  Age-gated flags fail closed when age is unknown. Every flag now carries a
  `source` citation. LABA-without-ICS and COCP+VTE deferred pending complete
  UK brand lists; oestrogen-HRT/intact-uterus permanently omitted
  (undetectable from the record).

### Feature: Rule-currency automation

- `shared/rule-currency.js` gains a **red** level (QOF-year mismatch, ended
  vaccine season, >540 days old) alongside amber; Options card and Sentinel
  footer show it.
- New `scripts/check-rule-currency.js` + weekly GitHub Actions workflow
  (`rule-currency.yml`, Mondays 06:00 UTC + manual dispatch): 120-day early
  warning that opens/updates a single `rule-currency` tracking issue and
  closes it when rules are current again.

### Engineering hygiene

- **Vendor integrity:** `scripts/verify-vendor.js` verifies sha256 of every
  `vendor/` lib against `vendor-versions.json` in CI (plus uncatalogued-file
  and pdf.js/worker version-pairing checks).
- **Test runner:** CI migrated to `node --test` (fail-closed, zero test-file
  rewrites; `node test-foo.js` still works). `npm test` added.
- **Lint/format:** ESLint flat config + Prettier, tuned so existing code
  passes (no reformatting); pre-commit hook on staged files; lint CI job.
- **Drift-guards for duplicated logic:** characterisation tests pin the
  KDIGO/NICE thresholds duplicated between Trends and the visualiser, and
  the deliberately-divergent sweep/sentinel instruction wording.
- **Dedup:** identical chip-instruction helpers extracted to
  `side-panel/modules/shared/chip-instructions.js`; sentinel summary logic
  moved to a pure, Node-testable `sentinel-core.js`.

Test suite: 42 files, all passing (7 new test files; ~460 new assertions).

## [v3.46.0] — 2026-06-10

### Feature: Triage Lens — major baseline-rule expansion (52 new rules) + defaults migration

A clinically verified expansion of the shipped Triage Lens rule set, covering
the highest-value silent-miss presentations in UK GP total triage. Researched
across 8 clinical domains, then adversarially verified (dedupe, severity
calibration, over-broad pattern pruning, NICE-anchor checking) before
implementation. `defaults.json` schema version bumped to 2.

**New red rules (17):** stroke/TIA (FAST), sepsis (fever+deterioration combos),
anaphylaxis, meningitis/non-blanching rash, AAA/dissection, testicular torsion,
PE/DVT/acute limb ischaemia, acute surgical abdomen, fever in infant <3m
(NG143), paediatric respiratory distress, seizure (first/febrile/ongoing),
pregnancy bleeding/pain (?ectopic/miscarriage), reduced fetal movements
(GTG57 → maternity triage), pre-eclampsia symptoms, sudden visual loss
(detachment/GCA), septic arthritis, psychosis (first-episode).

**New amber rules (27):** NG12 2WW flags (visible haematuria, post-menopausal
bleeding, breast lump/change, dysphagia + persistent hoarseness, testicular
lump, adult jaundice), diabetes problems (DKA/HHS/hypo red flags + sick-day
rules), child dehydration, infant bilious/projectile vomiting, head injury
(NG232 incl. anticoagulant→CT), limping child, neonatal jaundice (NG98),
chickenpox/shingles in pregnancy, emergency contraception (time windows +
Pharmacy First), mastitis (feeding-context only — de-conflicted from breast
2WW), heavy menstrual bleeding (NG88), postpartum bleeding/infection, painful
red eye (gated on pain/photophobia/vision), sudden hearing loss (SSNHL),
significant epistaxis, gout (NG219), cellulitis, medication side effects,
acute confusion/delirium, alcohol misuse, eating disorders (MEED), perinatal
mental health.

**New info rules (8):** dental signposting, blood-result queries, referral
chasing, letter/report requests, travel health, weight-loss-injection requests
(GLP-1, current NICE TA status), DNACPR/ACP/LPA admin, memory concerns.

**Modified existing rules:** `sore-throat` no longer owns persistent dysphagia
(moved to the 2WW rule); `cough-resp` gains reliever-overuse/poor-control
patterns + an RCP-3-Questions / acute-severity action note; `mh-crisis` gains
postpartum-psychosis and thoughts-of-harming-baby patterns.

**Engine improvements:**
- **Defaults migration (the big one):** a stored config previously shadowed
  shipped defaults forever, so existing users would never have received new
  builtin rules without a destructive reset. `loadConfig` (content script and
  options page) now performs a version-gated, non-destructive merge: appends
  shipped builtin rules the user doesn't have, plus missing
  threshold/pref/systemChip keys; never overwrites user customisations.
  Builtins the user deliberately deleted are tombstoned (`removedBuiltins`)
  and stay deleted.
- **Severity-ordered chips:** rule chips now render red → amber → info instead
  of config order, so a red can never trail an info chip.

**New regression test:** `test-triage-rule-patterns.js` compiles every shipped
pattern under the engine's exact wrapping semantics (the engine silently skips
invalid regexes — a silent clinical miss), pins schema invariants, and asserts
~90 positive/negative match examples for the high-risk rules (including
guards against over-broad stems: "confused about my medication", "hangover",
"my eye is red", "fell out with my sister" must not fire).

## [v3.45.1] — 2026-06-10

### UX: Triage Lens — LLM rule generator moves inside the "New rule" form

The "Generate a rule with an LLM" section is now hidden until the user clicks
**New rule** (or **Edit** on an existing rule). It appears as a collapsible
"Or generate with an LLM" block below the manual builder form, and collapses
automatically when the form is cancelled, saved, or navigated away from.
Previously the block was always visible below the rule list.

## [v3.45.0] — 2026-06-10

### Feature: Sentinel — "Appts summary" button for admin handoff

Adds an **Appts summary** button to the Sentinel footer. Clicking it opens a
small overlay showing a plain-text summary of all action-needed monitoring items
for the current patient, formatted for copy-paste directly into a Medicus
internal message so admin can arrange the bookings without the clinician
narrating each item verbally.

Format mirrors the Sweep reception handout logic:

- Drug-monitoring gaps → "Book a blood test: FBC, U&E (methotrexate monitoring overdue)"
- Physical checks (BP, weight, ECG…) → "Book a check-up: …"
- Mixed → "Book a blood test and check: …"
- QOF gaps → "Book a [condition] review"
- Vaccines → "Offer to book: [vaccine]"
- Alerts/combos/composites → "Flag to duty clinician"

Duplicate booking types are merged into a single line (e.g. two QOF diabetes
gaps → one "Book a diabetes review"). The textarea auto-focuses on open; a
"Copy to clipboard" button completes the workflow. If all monitoring is in date,
the message says so — safe to send either way.

## [v3.44.2] — 2026-06-10

### Fix: Triage Lens LLM rule authoring was hidden in the wrong tab

Triage Lens has had the suite-standard LLM flow (copy prompt → paste JSON →
validate → import disabled) since v0.5 — but the block lived collapsed at the
bottom of **Backup & restore**, after the raw-JSON editor, where nobody
authoring a rule would find it. Moved to the **Rules** tab beneath the rule
list, retitled "Generate a rule with an LLM" to match the other modules. No
logic changes — the prompt, validation and force-disabled import are untouched.

## [v3.44.1] — 2026-06-10

### Fix: Sweep reception handout — broken date, wrong "blood test" wording, redundant lines

Three issues spotted in the first printed handout:

- **`[object Object]` title / "Invalid Date"** — the sweep stored `runAt` as a
  `Date` object, but `chrome.storage.local` serialises `Date` to `{}`, so the
  handout (which reads `runAt` back from storage) had no usable timestamp. Now
  stored as an ISO string; `fmtTs` tolerates either.
- **"Book a blood test appointment: BP, Weight"** — blood pressure, weight and
  pulse are HCA checks, not blood tests, so reception was told to book the
  wrong slot. `chipInstruction` now classifies each due test and says
  "Book a check-up appointment" (checks only), "Book a blood test appointment"
  (bloods only), or "Book a blood test and check appointment" (mixed).
- **Redundant booking lines** — a patient with several QOF gaps that resolve to
  the same booking (e.g. three indicators → "Book a review appointment" ×3)
  printed one line each. `buildHandout` now groups by booking action and merges
  the reasons into a single line, so reception books once.

5 new regression checks in `test-sweep-core.js`.

## [v3.44.0] — 2026-06-10

### Feature: Sweep — printable reception handout

The Sweep results header gains a **"Print reception handout"** button: it opens
a print-first page (`handout.html`, full tab) listing every action-needed
patient in **appointment-time order** with tick-boxes and a literal,
non-clinical instruction per alert:

- Drug monitoring → "Book a blood test appointment: FBC, U&E — methotrexate
  monitoring overdue" (named tests, in-date tests excluded).
- QOF indicators → mapped to plain bookings ("Book a blood pressure check",
  "Book a diabetes review", …) with the indicator code in the detail line;
  unmapped codes fall back to "Book a review appointment".
- Vaccines → "Offer to book: Flu vaccine".
- Everything that needs clinical judgement (alerts, event counts, registers,
  combos) → "Flag to the duty clinician" — reception books and flags, never
  decides.

The page prints (or saves as PDF) via the browser print dialog, carries a
patient-identifiable confidentiality banner that also prints, and a footer
making clear it is a booking/flagging worklist, not a clinical instruction.
Duplicate instructions are deduplicated per patient; the "hidden Sentinel
alerts" note is carried through. Handover to the tab uses a transient
`sweep.handout` key (overwritten each print; allowlisted). Pure logic
(`chipInstruction`/`buildHandout` in sweep-core.js) is covered by 18 new
checks in `test-sweep-core.js`.

### Fix: flu/COVID "VAX DUE" chips showing out of season (patient-safety noise)

Eligible-but-unvaccinated patients were showing **VAX DUE all year round** —
the season config had a start (1 Sep / 1 Oct) but no end, so from April to
August every eligible patient carried a stale amber chip (as seen in Sweep,
Sentinel and Reception). A jab that cannot be given is not actionable, and a
chip that is wrong for five months trains staff to ignore it in October.

- `rules/vaccine-rules.json`: both seasons now carry a campaign end
  (`endMonth: 3, endDay: 31` — flu 1 Sep–31 Mar, COVID autumn 1 Oct–31 Mar).
- `engine/rules-engine.js`: new `seasonEnd()`; outside the campaign window no
  vaccine chips fire at all (DUE, GIVEN and DECLINED — there is nothing to do
  out of season). Rules without `endMonth` keep the old year-round behaviour.
- Fixes the chips everywhere the engine runs: Sentinel panel, Reception
  quick-wins, Sweep, content scripts.
- 8 new regression checks in `test-qof-year.js` (campaign boundaries, GIVEN
  unaffected in season, back-compat without endMonth, shipped rules carry the
  end dates).

## [v3.43.0] — 2026-06-10

### Feature: Practice Profile v2 — central practice management from the shared folder

The shared-folder Practice Profile system (drop `practice-profile.json` next to
the extension files; every PC applies it) has been finished and modernised so a
practice manager can push settings — and extension updates — to the whole
practice with one click.

**Engine (`shared/io/practice-profile.js`, rewritten):**
- Per-module apply modes: `"merge"` (fill gaps — never touches anything a user
  set; arrays merge by id, Knowledge also skips near-duplicate titles) or
  `"replace"` (enforce practice-wide). v1 profiles (`mode` +
  array `modules`) still work unchanged.
- Coverage extended from 5 to 11 modules: now includes **Knowledge**,
  **Reception**, Triage Capacity Alerts, Referrals (config only),
  Request Monitor, and practice code/feedback email. Validation delegates to
  the same `*-io.js` import functions as backups, so a crafted profile can't
  smuggle malformed data.
- Per-install attestations are never pushable in any mode:
  `disclaimerAcceptedAt`, `noticeAcknowledgedAt`, `alertLibraryAcknowledged`.
  Personal display prefs, tab order, pop-out state and locally discovered
  referral data are never pushed either.
- Per-module errors are isolated (one bad section can't block the rest) and
  recorded in the apply history.

**Propagation (service-worker.js):**
- New `pp-check` alarm: every 15 minutes (configurable 5–1440 via
  `apply.checkEveryMinutes`) each PC re-reads the profile from the shared
  folder with `cache: 'no-store'` — changes land while browsers stay open, not
  just on restart.
- **Self-updating code**: the same check compares the on-disk `manifest.json`
  version with the running version; when the admin drops new extension files
  in the shared folder, each PC reloads itself the next time it's been idle
  for 2 minutes (never mid-use; notification after repeated deferrals; new
  `idle` permission). This replaces the previous (incorrect) assumption that
  Edge reloads unpacked extensions on file changes.

**Publishing UX (Options → Backup & Restore):**
- "Generate profile" replaced by **Publish to shared folder**: per-module
  tick-list with plain-English "Fill gaps only / Enforce for everyone" choice,
  auto-bumped `profileVersion` (date + counter — no hand-editing), label and
  publisher pre-filled, and the file saved directly over
  `practice-profile.json` via the file picker — which is remembered, so
  subsequent publishes are one click. Picker state persists per publisher PC
  (`suite.practiceProfile.publisher`, allowlisted — not user config).
- Status card now shows when this PC last checked for profile updates.
- The shared-folder setup guide rewritten end-to-end for non-technical users:
  exact click-paths for Edge and Chrome, one-time shared-drive setup, 2-minute
  per-PC install, 1-minute publish walkthrough, what staff see, and a
  troubleshooting checklist. No JSON editing anywhere.

**Tests:** new `test-practice-profile.js` (65 checks: v1 back-compat, version
gating, merge/replace semantics per module, attestation stripping, error
isolation, bookkeeping). Several shared utils/io files gained
service-worker-compatible export guards (`self` instead of `window`).

## [v3.42.3] — 2026-06-10

### Knowledge: starter-pack prompt refocused on the local and the quirky

Feedback on v3.42.2: clinicians don't need cards for things they already know
(standard 2WW routes, national guidance). `kbSchemaPrompt()` now explicitly
excludes those and targets what a knowledge base is actually for:

- **Discovery is research-led, not a questionnaire**: the LLM asks only for
  practice name/town/postcode, then (where it can browse) works out the local
  landscape itself — finds the acute trusts' "information for GPs" / GP-zone
  referral repositories, identifies the community services provider and its
  single point of access, the mental health trust / Talking Therapies provider
  / crisis line, ICB referral-support pages, self-referral routes, and the
  odd-but-vital services (SDEC/hot clinics, DVT pathway, community ultrasound,
  ear care, wheelchair services). It asks the practice only what it genuinely
  cannot find.
- **Coverage**: community landscape contacts, funny local pathways and
  unusual referral routes (SPAs, not-in-e-RS services, per-trust form quirks)
  — explicitly NOT standard 2WW or routine specialty referrals. Each trust's
  GP-information repository gets its own entry so staff can find source pages
  later.

## [v3.42.2] — 2026-06-10

### Knowledge: starter-pack prompt rewritten — discovery-first, comprehensive, localised

The Options → Knowledge starter-pack prompt (`kbSchemaPrompt()`) now works in
two phases instead of generating generic content blind:

- **Phase 1 — discovery**: the LLM must first ask the practice about its ICB,
  usual acute trust(s), community providers (DN, MSK, Talking Therapies,
  mental health crisis, palliative), local self-referral routes, in-house/PCN
  services, and the things the team looks up most — and, where the LLM has web
  browsing, verify routes/numbers on the named provider sites (citing the page
  in each entry's `url`).
- **Phase 2 — generation**: an explicit coverage checklist (2WW per major
  suspected-cancer pathway, urgent and routine referral routes, A&G, full
  contacts set including safeguarding adults+children and crisis lines, every
  discovered self-referral route, Pharmacy First, admin pathways), aiming for
  40–60 entries rather than the previous 10–20 sampler.
- Localisation rule hardened: real numbers/names only when confirmed from the
  practice's answers, pasted documents, or a checked source — everything else
  stays a `[placeholder]`.

The single-card prompt (`kbSingleEntryPrompt()`) is unchanged. New regression
checks pin the two-phase structure, discovery questions, browsing instruction
and coverage checklist.

## [v3.42.1] — 2026-06-10

### Knowledge: create a single card from pasted text via LLM (on the tab)

The **+ Add** form now has a collapsible **"Create from text with an LLM…"**
block: copy a single-card prompt (`kbSingleEntryPrompt()` in
`shared/knowledge-utils.js`), paste it into any external LLM followed by your
copied text / screenshot transcript, then paste the JSON reply back — it
**pre-fills the add form** rather than importing directly, so:

- the near-duplicate title check fires before anything is saved (anti-bloat),
- the user sees and can correct every field, and
- on Save the entry keeps AI provenance (`source: llm, reviewed: false`) and
  is badged **Unreviewed — AI-generated** until marked reviewed — the same
  rule as the Options starter-pack import.

A PHI heuristic warns at fill time if the JSON contains NHS-number/DOB-shaped
content. Arrays / `{ entries: [...] }` replies are tolerated by taking the
first entry (packs belong in Options → Knowledge).

## [v3.42.0] — 2026-06-10

### Feature: Knowledge tab — practice-owned reference base

New **Knowledge** module (side panel + pop-out): a small practice-owned
reference base for referral criteria, key contacts and phone numbers, internal
pathways/protocols and templates. Reference material only — explicitly not
clinical decision support, with a first-open notice saying so.

- **On-tab add/edit/search** — a permanent **+ Add** button on the tab opens an
  inline form (title, category, plain-text content, phone, link, tags,
  review-by date); cards are searchable and filterable by category, with
  copy buttons for phone numbers and content.
- **Anti-bloat near-duplicate guard** — as you type a title, existing entries
  with similar titles are surfaced ("edit that instead") via token-normalised
  matching in `shared/knowledge-utils.js` (`findSimilar`): boilerplate words
  (referral/criteria/pathway/…) ignored, so "Cardiology chest pain referral"
  matches "Referral criteria — chest pain (cardiology)". Warns, doesn't block.
- **LLM starter pack** (Options → Knowledge) — same external copy-paste flow
  as Reception pathways: copy a self-contained prompt (optionally appending
  local documents), paste the JSON back, validate & import. Imported entries
  are forced to `source: llm, reviewed: false` and badged
  **Unreviewed — AI-generated** until a human marks each one reviewed;
  near-duplicate titles are skipped on import; a PHI heuristic (NHS-number /
  DOB patterns) warns if patient-looking data was pasted in.
- **Review-due chip** — entries carry an optional review-by date and show a
  "Review due" badge once it passes.
- Storage keys `knowledge.items` / `knowledge.categories` / `knowledge.config`
  ride the suite backup via new `shared/io/knowledge-io.js` (scope `knowledge`
  in the envelope, per-module export card, preview summary line). Imports are
  validated and whitelist-sanitised; `noticeAcknowledgedAt` is per-install and
  never imported (same rule as Reception's disclaimer).
- Tests: `test-knowledge-utils.js` (schema, dedupe matcher, PHI heuristics,
  prompt example round-trip), `test-knowledge-io.js` (backup round-trip,
  crafted-backup rejection).

## [v3.41.0] — 2026-06-10

### Feature: organise Reception capture tiles — colour, A–Z sort, drag-and-drop

As practices author more capture pathways, the picker grid grows. Reception now
has an **"Organise tiles"** mode (toggle in the capture card toolbar) so staff
can lay the tiles out the way they work:

- **Colour-code** — each tile carries an optional colour label (a palette of 9
  hues plus "none"), shown as a coloured left edge on the tile. Tap the dot in
  organise mode to set it.
- **Sort A–Z** — a Manual / A–Z toggle. A–Z sorts by title (case-insensitive);
  Manual restores the saved hand-ordered layout.
- **Drag-and-drop reorder** — in Manual order, drag tiles into any order. The
  reconcile logic mirrors `tab-order.js`: a newly-added pathway appends at the
  end and a removed one drops out — a tile is never duplicated or lost.

Design / safety notes:
- Colours and order are **organising only and explicitly not a clinical flag**
  (the UI says so); they never change which pathways are enabled and never gate
  clinical content. Launching a capture is disabled while organising so a tile
  click can't start a call flow by accident.
- New `reception.tilePrefs` storage key `{ sortMode, order, colours }`, edited
  from the panel itself and synced live between the panel and pop-out. It rides
  the existing suite backup via `shared/io/reception-io.js`
  (`receptionExport`/`receptionImport`), validated/sanitised through
  `sanitiseTilePrefs` (unknown sort modes, non-id-shaped keys → dropped;
  prototype-pollution-safe).
- Pure logic (`orderTiles`, `tileColourFor`, `sanitiseTilePrefs`,
  `TILE_COLOUR_KEYS`) lives in `shared/reception-pathway-utils.js` with new
  regression tests in `test-reception-pathway-utils.js`.

## [v3.40.3] — 2026-06-10

### Fix: Sweep clinician dropdown empty before first run; clinician column never shown

Two bugs in the v3.40.2 clinician filter:

1. The dropdown was only populated inside `runSweep()`, so it showed only
   "All clinicians" until a full sweep was completed — the user couldn't
   pre-select a clinician before running. Fixed: `preloadClinicians()` now
   fires non-blocking in `init()`, fetching the appointment book in the
   background and populating the dropdown immediately on module load.

2. `patient.clinician` was pushed to the per-patient result objects but
   `summariseSweep` (sweep-core.js) never forwarded it to the output SweepRow,
   so `patientRowHtml` always received `row.clinician = undefined` and the
   clinician column was invisible. Fixed: `clinician` is now propagated through
   both error rows and normal rows in `summariseSweep`.

### Feature: Sequential sweep past 40-patient cap

Previously, large practices (>40 booked patients) had the first 40 silently
checked with a warning notice about the cap. Now:

- `extractBookedPatients` accepts `{ limit: null }` to return all patients
  without capping. Callers that do not pass `limit` retain the existing
  `MAX_SWEEP_PATIENTS` (40) default — no behaviour change for other consumers.
- `sweep.js` fetches the full patient list upfront and processes it in batches
  of `BATCH_SIZE` (40). After each batch, results show "Checked X of Y booked
  patients — N remaining" and a **"Check next N patients"** button.
- Clicking Continue processes the next batch from cached state (no re-fetch of
  the appointment book). Cumulative results (all batches combined, sorted
  worst-first) are shown after each batch.
- The Run sweep button always starts a fresh sweep (new fetch, reset offset).
  Cancel mid-batch shows how many patients were not checked and prompts restart.

## [v3.40.2] — 2026-06-10

### Fix: Sweep found zero patients — wrong appointment feed (per-clinician, not practice)

Sweep fetched `/scheduling/data/homepage/my-appointments`, which only covers
the logged-in user's OWN booked diary — anyone without a personally-booked
clinic that day got an empty schedule, and the empty case fell through
silently to "No action-needed alerts found across 0 patients". This is the
same root cause as the Condor waiting-room fix in v3.36.2 ("my-appointments
is per-clinician only").

- Sweep now reads the practice-wide appointment book
  (`/scheduling/data/appointment-book/embedded-overview` via the shared
  `fetchSchedulingOverview`, fresh fetch per run), parsing
  `staffSchedules[].schedule[].entries[]`. Cancelled appointments excluded.
- New clinician filter: "All clinicians" by default, or sweep a single
  clinician's list (dropdown populates from the appointment book; patient
  rows now show the clinician).
- Fail-visible zero states (H-005): an empty appointment book, an empty
  clinician filter, or an unreadable feed each render an explicit message —
  a bare "0 patients, nothing to action" can no longer appear.
- Limitation 26 updated; test-sweep-core.js migrated to the appointment-book
  shape with regression guards for the silent-zero path, cancelled exclusion,
  and the clinician filter.

Diagnosed by three parallel investigation agents; root cause corroborated by
the v3.36.2 changelog entry.

## [v3.40.1] — 2026-06-10

### Fix: Condor "Task inbox not configured" shown for a configured Request Monitor

Condor's data layer fetched a non-existent endpoint
(`/admin/data/request-monitor/{assigneeId}` — invented during the Condor
build), so the request always 404'd and the Task Age card claimed the inbox
was "not configured" even when Request Monitor was fully set up. Condor now
reads the cached poll state the service worker already maintains
(`suite.requestMonitor.state` — the SW alarm stays the single owner of task
polling, and the cached items are already initials-only per F2 data
minimisation). The card also now distinguishes the three states: not
configured ("enable in Settings"), configured-but-unavailable ("Task inbox
unavailable: <reason> — check Medicus sign-in"), and data. Day Score treats
"unavailable" like "unknown" (never penalised), and the PPI urgent count
already degrades to 0 with the error recorded in fetchErrors. New regression
test `test-condor-rm-state.js`.

## [v3.40.0] — 2026-06-10

### Feature: drag-and-drop reorderable suite tabs

Suite nav tabs can be dragged left/right to reorder, like browser tabs, so
favourites sit on the left. Order persists in a new `suite.tabOrder` key (one
global preference shared by the side panel and pop-out; each shell reconciles
against its own tab set, so the pop-out simply ignores tabs it doesn't have)
and rides the existing suite backup/export. New modules added later append in
their default position; unknown/removed ids are ignored — never dropped or
duplicated (`side-panel/tab-order.js` `reconcileTabOrder`, unit-tested in
`test-tab-order.js`). A drag never triggers a tab switch. Keyboard-driven
reordering is not yet implemented (tabs remain keyboard-activatable for
switching); mouse/pointer drag only.

### Feature: author rules with an LLM (Reception, Sentinel, Triage Lens)

Each of the three rule-authoring surfaces gains a "Copy LLM prompt" button and
a paste-JSON import box, so a user can ask an external LLM ("make me a
cellulitis pathway") and import the result directly:

- **Reception** — `pathwaySchemaPrompt()` in `shared/reception-pathway-utils.js`;
  import validates via the existing `validatePathway`/`sanitisePathway` and adds
  the pathway **disabled** (never auto-enabled — the off-by-default + disclaimer
  gate still applies).
- **Sentinel monitoring** — `customRuleSchemaPrompt()` in `shared/io/sentinel-io.js`
  (covers all five custom-rule types); import validates via the existing
  `validateCustomRule`, forces `enabled:false`, prefixes `custom-`, de-dupes ids.
- **Triage Lens** — `triageRuleSchemaPrompt()` plus a refactor of the inline rule
  checks into a reusable `validateTriageRule()` (now used by both the rule
  builder and the importer); imported rules get a fresh id, `builtin:false`,
  `enabled:false`.

Each schema prompt embeds a worked example between stable markers, and a unit
test extracts that example and runs it through the real validator — so a
documented schema can never drift from what the validator accepts. All imports
accept a single object, an array, or a `{rules:[…]}`/`{pathways:[…]}` wrapper;
validate every candidate and import nothing from a failing one; and escape all
status text (LLM output is untrusted). Imported clinical content always arrives
inactive, pending human review.

All 30 test files pass.

## [v3.39.1] — 2026-06-10

### Reception: security hardening + clinical escalation re-tiering (post-audit)

Follows the red-team audit of the Reception module. Two code findings fixed,
plus a clinical re-tiering pass on the DRAFT capture pathways.

**Security (verified findings):**
- **Disclaimer gate is now defence-in-depth, not UI-only.**
  `resolveEffectivePathways()` gates its `enabled` set on `disclaimerAccepted`
  (strict `true`); absent/falsy ⇒ empty enabled set (fail-safe). The panel and
  all three options call sites pass it, so a direct storage write or imported
  backup can no longer surface capture pathways the practice never accepted.
- **Acceptance timestamp is no longer importable.** `receptionImport()`
  validates `disclaimerAcceptedAt`'s shape but never writes it — acceptance is
  a per-install attestation set only by an in-browser admin click, so a backup
  cannot forge a review-accepted state on another install.
- **Flag-map key whitelist (prototype-pollution defence-in-depth).** Import now
  rejects `enabledPathways`/`hiddenChipRules` keys that don't match the pathway/
  rule id shape (e.g. `__proto__`).
- **Clipboard escalation fallback never hides the level** — if an escalation
  text lookup misses, the generated block now states `ACTION (level 999/duty)`.
- **Asked/denied summary line disambiguates colliding short labels** with a
  `(#n)` suffix (the loud positive block was already unambiguous).

The two headline audit claims — a "critical" panel XSS and a backup
preview-warning "evasion" — were verified as false positives (output is escaped;
overrides don't enable pathways) and not actioned.

**Clinical (DRAFT pathways — `rules/reception-pathways.json`, still pre-CSO):**
Escalation re-tiering — several time-critical presentations were promoted from
duty to 999 (erring toward more escalation, the safe direction):
- **urinary** — new urosepsis 999 flag (fever/chills + confusion / can't keep
  fluids, NICE NG51); confusion promoted to 999.
- **backpain** — cauda equina (saddle anaesthesia, bladder/bowel) → 999 ("A&E
  now"); spinal-infection wording (IVDU/immunosuppression) added.
- **cough** — haemoptysis split (large/with breathlessness → 999, minor streak
  → duty); new PE 999 flag.
- **general** — new lay sepsis 999 flag; self-harm split (attempt/means → 999,
  ideation → duty).
- **earache** — facial droop flag added. **rash** — necrotising-fasciitis → 999;
  SJS/TEN mucosal wording. **headache** — anticoagulant + head injury → 999.
  **feverish-child** — NICE NG143 <3-month high-risk caveat note added.

`specVersion` → v1.1; DRAFT marker retained. Backup/restore wiring re-verified
end to end. All 29 test files pass (451 reception assertions).

## [v3.39.0] — 2026-06-10

### Reception module: full configurability, disclaimer-gated pathways, RAG status pill

Follow-up hardening and configurability pass on the v3.38.0 Reception module:

- **All capture pathways now ship DISABLED.** A practice administrator must
  click through an explicit disclaimer in Options → Reception (confirming
  CSO/GP review of the content and staff briefing) before anything can be
  enabled; pathways can then be toggled individually or all at once. The
  Reception tab tells staff to ask an administrator when everything is off.
- **Pathway editor in Options.** Practices can edit the questions and red
  flags of bundled pathways (stored as overrides — one click restores the
  bundled original) and author new custom pathways. Validation is enforced by
  shared code (`shared/reception-pathway-utils.js`): a pathway cannot be saved
  without red flags, every red flag needs a 999/duty escalation level, and
  invalid edits are flagged with the bundled original kept active — never
  silently dropped. Saving never auto-enables.
- **Quick-wins box replaced with a single green/amber/red status pill** that
  expands on click to the detailed list. Practices choose which
  monitoring/QOF/vaccine rules are counted there (Options → Reception); when
  active alerts are filtered out the expanded view says so — filtering is
  never silent. Custom chips are managed in Sentinel as before.
- **Removed the "Recent appointments" card** (and its day-by-day appointment
  book scan) introduced in v3.38.0.
- **New storage keys with full backup ceremony:** `reception.config`,
  `reception.customPathways`, `reception.pathwayOverrides` via
  `shared/io/reception-io.js`; scope registered in suite-envelope; import is
  validated + whitelist-sanitised through the same shared validator as the
  editor, and the import preview WARNS when a backup would enable pathways
  (same concern class as the hidden-chips warning). Limitation 27 updated.
- New tests: `test-reception-pathway-utils.js` (41), `test-reception-io.js`
  (19); reception core/pathway tests updated. Backup key coverage holds.

## [v3.38.0] — 2026-06-10

### Feature: Reception module — guided capture + recent appointments + opportunity summary

New "Reception" side-panel tab (panel + pop-out) designed for non-clinical
front-desk staff:

- **Guided capture.** Fixed question sets per presenting problem
  (`rules/reception-pathways.json`: sore throat, earache, adult cough, urinary
  symptoms in women 16–64, adult headache, low back pain, feverish child,
  rash/skin, plus a general catch-all — NICE CKS / NG143-derived, lay-phrased).
  Red-flag questions come first and every one must be explicitly answered
  (unanswered ≠ "no"); any YES shows an immediate 999-level or duty-clinician
  escalation banner and stamps the flag + instruction into the output. The
  result is a same-every-time plain-text history block with a copy-to-clipboard
  button for pasting into the Medicus triage entry, ending with a "not a
  clinical assessment — clinician to review" footer. When a patient record is
  open, the patient's name/DOB is embedded in the header so a wrong-record
  paste is detectable. Unanswered questions render as "not recorded", never
  blank. Pharmacy First suitability hints are age-gated against the open
  record and fail towards "clinician to confirm" when age is unknown.
  **The pathway set ships marked DRAFT and requires CSO sign-off before live
  use** (limitation 27 added to docs/CLINICAL-SAFETY-NOTICE.md); structure is
  CI-guarded by `test-reception-pathways.js` (433 assertions).
- **Recent appointments.** "Who did you last see" support: manual-trigger scan
  of the practice appointment book backwards (up to 6 weeks, 7-day batches,
  early-stop at 3 hits), matched strictly by patient UUID — never by name
  (wrong-patient hazard H-001). Days that fail to load are explicitly counted
  as unread; the card states it shows booked practice appointments only.
- **Opportunity summary.** Compact red/amber counts of the open patient's
  Sentinel chips ("while they're on the phone: 1 overdue, 2 due soon") with a
  jump to the Monitoring tab, so reception can offer to book overdue checks.
- Nothing is stored: answers, output text, and taker initials are in-memory
  only — no new chrome.storage keys, so no backup/IO changes.
- The Rules status card in Options now also tracks the reception pathway
  file's age/version. New `test-reception-core.js` covers the text builder,
  red-flag evaluation, UUID-only appointment matching, and chip summarising.

## [v3.37.0] — 2026-06-10

Five user-aiding features from the high-impact development review.

### Feature: Pre-clinic Monitoring Sweep — new "Sweep" side-panel tab

Runs the Sentinel rules engine across the logged-in user's booked patients for
today (same `/scheduling/data/homepage/my-appointments` feed as the waiting-room
strip; same `fetchAll → normaliseAll → evaluatePatient` path as the live Sentinel
module) and renders a worst-first worklist of patients with action-needed
monitoring/QOF/vaccine chips, so recalls and bloods can be arranged before
clinic. Manual trigger only; sequential per-patient fetches with a 250 ms gap
and a 40-patient cap; results are ephemeral (no new storage keys). Fail-visible
by design: any per-patient endpoint failure renders an explicit "could not read
record" row — a patient with partial data can never appear as "clear".
`sentinel.hiddenRules` suppressions are intentionally NOT applied (a
per-workstation dismissal must not drop a patient from a recall list); rows
including hidden alerts are flagged. New limitation 26 added to
docs/CLINICAL-SAFETY-NOTICE.md. New module registered in both panel and pop-out;
pure logic in `sweep-core.js` covered by `test-sweep-core.js`.
**Note for CSO review:** the sweep is a new clinical surface and should receive
hazard-log review before deployment; HAZARD-LOG.md deliberately not edited here.

### Safety: dismissed Sentinel chips resurface on status escalation (H-021 / limitation 22)

Permanent chip dismissals now record `statusAtDismissal` and `dismissedAt` in
`sentinel.hiddenRules`. A permanently hidden chip automatically resurfaces (with
a visible RESURFACED badge) when its current status becomes more severe than it
was at dismissal (colour rank: red > amber > neutral > green; unknown statuses
rank red — fail-safe). Legacy entries without a recorded status keep the old
always-hidden behaviour to avoid flooding existing users; they are labelled in
the review screen. The hidden-alerts list in Sentinel options now shows
dismissal date, age and status-at-dismissal. Backup import validation accepts
(and validates) the new optional fields. New `test-hidden-resurfacing.js`;
import-hardening tests extended.

### Safety: "Meds without a monitoring rule" audit view

New `listUnmatchedMedications()` in the rules engine surfaces medications not
matched by any enabled drug-monitoring rule — making the documented
silent-failure mode (an unlisted brand never alerts) visible instead of silent.
Rendered as a collapsed informational section in both the in-page Sentinel HUD
and the side-panel tab, with a "report a possible missing brand" mailto link
when a feedback address is configured. New `test-unmatched-meds.js`.

### Feature: rule-currency status (options card + Sentinel footer)

New `shared/rule-currency.js` assesses the four bundled rule files:
amber when a file is >365 days old, when the QOF year has rolled over
(file year vs 1 April boundary), or when the vaccine season file predates the
current season (1 September boundary). Rendered as a "Rules status" card in
Options and a one-line footer in the Sentinel tab. `vaccine-rules.json` and
`alert-library.json` gain top-level `lastUpdated`/`specVersion` metadata
(rule content untouched); `test-rule-schema.js` now asserts metadata on all
four files. New `test-rule-currency.js` includes a live check against the
bundled files, so CI starts failing when the shipped rules genuinely go stale.

### Feature: one-click "Verify in Medicus" (H-007 automation-bias mitigation)

The Sentinel side-panel patient banner and every chip's evidence panel gain a
"Verify in Medicus ↗" button that focuses the source Medicus tab (never
navigates it), making verify-before-acting a one-click action. Shows a brief
"Medicus tab not found" note if the tab has closed.

## [v3.36.4] — 2026-06-09

### Fix: seasonStart() UTC safety (engine/rules-engine.js)

Rewritten to compare date-part strings instead of constructing `new Date(year,
month-1, day)` in local time — under BST (or any non-UTC host timezone) the
vaccine season start could drift a day early. Season-start dates are now exactly
the configured month/day regardless of timezone. Regression tests added to
`test-qof-year.js`.

### Fix: BP pairing ±1-day tolerance (engine/normalisers.js)

Split systolic/diastolic readings recorded a day apart (common when a practice
workflow records results on different days) now synthesise a "Blood pressure"
observation, taking the systolic reading's date. Same-date pairs are still
preferred (pass 1); ±1-day fallback only used for unpaired systolic readings;
each diastolic may pair at most once. Regression tests added to
`test-extraction-health.js`.

### Fix: Dash folding in normaliseDrugString (engine/rules-engine.js)

Dashes and underscores in drug names and match/exclude terms are now normalised
to spaces before whitespace collapse, so "Neo-Mercazole" matches the exclude
term "neo mercazole" and vice versa. No MUST_NOT collision detected. Two new
test cases added to `test-drug-brand-coverage.js`.

### Test: test-rule-schema.js — rule-file structural integrity guard

New test validates all four bundled rule files: check.kind against the
implemented set, vaccine statusTerms.given and season.startMonth, event-count
windowMonths positivity, observation-bundle non-empty observations, and no
duplicate IDs across files. All 47 assertions pass against current rules.

### Safety: custom-rule validation extended (shared/io/sentinel-io.js)

`observation-bundle` added to `ALLOWED_CHECK_KINDS` for custom QOF indicator
rules; validation rejects an empty `check.observations` array (vacuously
"achieved"). Unknown check.kind and empty-bundle cases covered by new tests in
`test-custom-rules.js`.

### Security: update-checker downloadUrl host validation (shared/update-checker.js)

`allowGithubUrl()` helper added; both `downloadUrl` and `releaseUrl` from GitHub
releases are now rejected unless the URL parses as https with hostname
`github.com`, `api.github.com`, or `*.githubusercontent.com`. New tests in
`test-update-checker.js`.

### Chore: submissions-io practiceCode single ownership

`suite.practiceCode` is now exported only by `shared/io/suite-io.js`.
`submissions-io.js` no longer exports it; legacy standalone submissions backups
that carry `practiceCode` are still imported (with a one-line comment). Tests
updated in `test-suite-io.js`. Backup coverage still passes.

### Chore: vaccine-rules.json — remove dead DM1 register token

No `DM1` QOF register exists; diabetics are covered by `DM`. The dead token was
removed from the flu-vaccine eligibility registers array.

### Chore: qof-rules.json — stale DM037 cross-reference note

The smoking-status indicator's notes claimed DM037 was "currently disabled
pending observation-bundle engine support"; DM037 is enabled and the engine
supports observation-bundle. Note updated.

### Chore: cross-reference comments for site-code regex

One-line `// keep in sync with ...` comments added at the `PRACTICE_CODE_RE`
definition in `shared/request-monitor.js` and `_SITE_CODE_RE` in
`shared/medicus-api.js` to make the two independent definitions visible to
future editors.

## [v3.36.3] — 2026-06-09

### Safety: null-date fail-safe in Sentinel rules engine

`daysBetween()` returns `null` for unparseable dates. Downstream comparisons
(`null > x`) are always false, so a malformed observation date would silently
fall through to the safest-looking status (`in_date` / no chip) — masking a
missing-monitoring situation as "all good". Guards added:

- Drug-monitoring test evaluation: garbage `obs.date` now returns `status:
  'no_data'` (same as a missing observation), never `in_date`.
- `observation-alert` QOF indicator: unparseable date now returns `[]` (consistent
  with the existing stale-gate and the "do not alert on bad data" design).

Regression tests added to `test-monitoring-chip.js` and `test-alert-builder.js`.

### Test: inverse brand-coverage check in test-drug-brand-coverage.js

The existing test only iterated the `EXPECTED` map forward, so a new
drug-monitoring rule with no `EXPECTED` entry would pass silently. Added an
inverse check: every enabled `drug-monitoring` rule in `drug-rules.json` must
have at least one entry in `EXPECTED`. All 24 current rules are covered.

### Safety: transactional backup restore with rollback

`applyEnvelope()` previously used `Promise.all`, so a failure in one module
import left partially-written storage. Rewritten to use `applyWithRollback()`
(added to `shared/io/suite-envelope.js`): tasks run sequentially; on any throw,
keys written during the run are removed and the pre-import snapshot is restored.
The error message includes the original cause and states "no changes were applied"
(surfaced verbatim by the options-page status banner).

Rollback scenario regression test added to `test-suite-io.js`.

### Test: test-backup-coverage.js — storage key-coverage guard

New static analysis test: scans app source for `chrome.storage.local` string
literals and verifies every key is captured by a `shared/io/*-io.js` file or an
explicit allowlist. Guards against keys silently disappearing from backups when a
module is added or a key renamed. Prints audited key counts on each run.

### Fix: Condor request-monitor stream was silently dead

`condor-data.js` read `suite.requestMonitor.config` as a single object key, but
request-monitor settings are stored as individual keys
(`suite.requestMonitor.enabled` / `.assigneeId` / …), so the config was always
`undefined` and the Condor dashboard never fetched the request-monitor stream.
Found by the new backup key-coverage audit. Now reads the real keys.

### Chore: remove orphaned acrtrend / bptrend modules

`side-panel/modules/acrtrend` and `side-panel/modules/bptrend` were not
registered in any `MODULES` map or nav tab in `panel.js` or `pop-out.js`.
Dead code removed (`git rm -r`).

## [v3.36.2] — 2026-06-09

### Condor: practice-wide waiting room via appointment-book endpoint

Condor's waiting room now sources its data from the `appointment-book/embedded-overview`
endpoint (already fetched for slot counts) rather than `my-appointments`.
`my-appointments` is per-clinician only, so arrived counts were always 0 for
users with no personally-booked clinic.

`fetchSlots` and `fetchWaitingRoom` are merged into a single `fetchSlotsAndWaitingRoom`
function — one fetch, two data extractions, no extra API call. The waiting room
card now shows the responsible clinician's surname alongside each patient row.

## [v3.36.1] — 2026-06-09

### Fix: waiting-room arrived detection was always returning zero

`displayStatus.isArrived` does not exist on the Medicus API response. The actual
field is `displayStatus.value`, which equals `"arrived"` when a patient has
checked in. The old check (`displayStatus?.isArrived === true`) was silently
false for every entry, so arrived counts were always 0 across Condor, the panel
WR strip, and the Sentinel waiting-room block.

Additionally, the entry list was not filtered by `diaryEntryType`, so slot entries
(which carry no patient or displayStatus) were included in the appointment set,
making the pending count wrong.

Fixed in `condor-data.js`, `panel.js`, and `sentinel.js`:
- Filter entries to `diaryEntryType.value === 'appointment'` before mapping
- Check `displayStatus.value === 'arrived'` instead of `displayStatus.isArrived`
- Also corrected `deliveryMode` extraction in condor to unwrap `.value` consistently

Note: `my-appointments` is per-clinician. Condor's waiting room card shows the
logged-in user's patients only — a practice-wide view requires a different
endpoint (under investigation).

## [v3.36.0] — 2026-06-09

### Condor UX: clearer Demand/Capacity card, live WR appointments, refresh timestamp

**Demand / Capacity card** — replaced the confusing `26.2×` ratio (requests ÷
remaining slots) with a plain-English status: "Over capacity", "At capacity",
"Capacity sufficient", or "No slots left". The request and slot counts are shown
in a sub-line; the Medical/Admin/AM/PM breakdown is preserved below a divider.

**Waiting Room card** — when no patients have arrived yet the card was a dead
`0 arrived` number with no context. It now falls through to a "Booked today"
list showing the next booked appointments (name, mode, scheduled time) so the
card is useful at the start of a session before anyone has checked in.

**Practice Pressure freshness** — added a `Live · updated HH:MM:SS` timestamp
below the PPI gauge so it is obvious the data is actively refreshing even when
the PPI score itself is stable.

## [v3.35.3] — 2026-06-09

### Fix: Condor slots-remaining ignored the Slots tab's hidden types

Condor's Demand/Capacity card counted *every* future slot type, so triage and
holding slots inflated "slots remaining" (e.g. 123) well above the bookable
count the user actually tracks in the Slots tab (e.g. 36).

`fetchSlots` now reads `slots.hiddenTypes` (the same key the Slots tab writes
when you untick a type) and excludes those appointment types from the AM/PM
remaining counts, so the figure — and the Demand/Capacity ratio derived from
it — matches the ticked slots in the Slots counter.

## [v3.35.2] — 2026-06-09

### Fix: Condor demand/velocity/PPI showed the entire task backlog

`fetchSubmissions` in `condor-data.js` queried the task-list endpoint with
`startDate`/`endDate`, but that endpoint filters on `createdAt_startDate`/
`createdAt_endDate`. The wrong parameter names were silently ignored, so the
API returned the **entire open-task backlog** instead of today's submissions.
This single bug inflated three places at once:

- **Demand / Capacity** — "open requests" showed tens of thousands (e.g. 42495)
  and an absurd ratio (354.1×).
- **Submission Velocity** — "Total today" showed the whole backlog (e.g. 83019),
  with the histogram smeared across every hour of the day regardless of date.
- **Practice Pressure Index** — the queue component saturated, so the PPI value
  was driven almost entirely by the bogus backlog count.

Fixes:
- Use `createdAt_startDate` / `createdAt_endDate` (matching the working
  Submissions module) so only today's submissions are counted.
- `todayISO()` now uses the **local** calendar date instead of UTC
  (`toISOString()` would query the wrong day in the early/late hours).
- Relabelled the Demand/Capacity figure from "open requests" to "requests today"
  to reflect what it actually measures.

### Removed: Condor referral-rate card

Removed the per-clinician referral-rate card and its data plumbing from the
Condor dashboard (low signal). The standalone Referrals tab is unchanged.

## [v3.35.1] — 2026-06-09

### Fix: restore unified Trends tab

The v3.35.0 Condor merge was branched from a base predating the v3.34.0
trends unification, so merging it reverted the side-panel/pop-out nav back to
the pre-unification layout — the amalgamated **Trends** tab disappeared and the
old separate **BP Trend** and **ACR Trend** tabs reappeared, dropping the
HbA1c, Cholesterol and Weight toggle views in the process.

- Re-registered the unified `trends` module and removed the orphaned
  `bptrend` / `acrtrend` nav entries in `side-panel/panel.html`,
  `side-panel/panel.js`, `pop-out/pop-out.html` and `pop-out/pop-out.js`.
- The `trends` module itself was untouched by the regression — all five views
  (BP, Renal, HbA1c, Cholesterol, Weight) are restored by re-wiring the nav.

## [v3.35.0] — 2026-06-08

### Condor: core shell, data layer, CSS, nav registration

Introduces the Condor tab — a new practice operational intelligence module.

- `side-panel/modules/condor/condor-data.js` — parallel data fetch layer (slots, waiting room, submissions, request monitor, activity, capacity preset)
- `side-panel/modules/condor/condor.js` — orchestrator: init/cleanup pattern, 15-second poll, dynamic card loading via Promise.allSettled imports
- `side-panel/modules/condor/condor.css` — full layout and component styles (card, pill, bar, SVG helpers)
- `side-panel/panel.html` / `pop-out/pop-out.html` — Condor nav tab added
- `side-panel/panel.js` / `pop-out/pop-out.js` — MODULES registry entries added


## [v3.34.0] — 2026-06-08

### Merge Renal and BP Trend tabs into unified Trends tab

The three separate navigation tabs (Renal, BP Trend, Trends) have been consolidated into a single **Trends** tab with an in-module picker: **BP | Renal | HbA1c | Cholesterol | Weight**.

- `side-panel/modules/trends/trends.js` — merged BP and Renal logic in; picker now offers all five views. BP and Renal logic is identical to the removed modules — no behavioural change. `selectedView` state is in-memory only (no storage key).
- `side-panel/modules/trends/trends.css` — merged in all CSS from `bptrend.css` and `acrtrend.css`, including the shared `tc-*` chart primitives.
- `side-panel/panel.html` / `pop-out/pop-out.html` — removed `acrtrend` and `bptrend` nav tab buttons.
- `side-panel/panel.js` / `pop-out/pop-out.js` — removed `acrtrend` and `bptrend` from MODULES registry.
- `side-panel/modules/bptrend/` and `side-panel/modules/acrtrend/` — source files retained on disk but no longer registered or loaded.

## [v3.33.0] — 2026-06-07

### Per-module extraction breakdown + SOUP register

Two transparency/robustness improvements; no change to clinical rule logic, data flow, permissions, or network behaviour.

**Per-module extraction health (H-005 detection improvement).** The Sentinel side panel now shows what the extension actually read from the current record — `Extracted: N meds · N obs · N problems` — with any zero count amber-flagged for verification.

- `content-scripts/sentinel.js` — `assessExtractionHealth()` now returns a `modules: { medications, observations, problems, demographics }` breakdown alongside the existing `degraded`/`reason` signal. The hard `degraded` semantics are unchanged byte-for-byte (the across-the-board blank that means our scrapers stopped matching the page); the breakdown is published on the snapshot via `publishSnapshot()`.
- `side-panel/modules/sentinel/sentinel.js` — renders the breakdown in the `data` state only (the `degraded`/`unavailable` warning paths and `classifySnapshot` are untouched). This is **informational only**: a per-module zero is amber-tinted to prompt a manual check but is *never* treated as an alarm, since a record can legitimately have no observations or no problems. It narrows the gap between the whole-record `degraded` banner and a *partial* scraper failure (e.g. meds populated but observations silently empty after a Medicus change) without adding false-reassurance or alert-fatigue risk.
- Tests: `test-extraction-health.js` gains six checks for the `modules` shape/counts and the "per-module zero never alarms" contract; `test-sentinel-panel-state.js` gains two checks confirming the new field does not perturb snapshot classification. Full `node test-*.js` suite green.
- `docs/HAZARD-LOG.md` — H-005 updated with control (j); document synchronised to v3.33.0 (doc v3.4).

**SOUP register (`docs/SOUP.md`).** New IEC 62304-style Software of Unknown Provenance register for the vendored visualiser libraries (PDF.js 3.11.174 + worker, Chart.js 4.4.1, D3.js 7.8.5). Records each item's function in the product, known anomalies (incl. CVE-2024-4367 and its `isEvalSupported:false` mitigation, and the deferred NF6 PDF.js upgrade), and risk disposition. References `vendor-versions.json` as the checksum-of-record so the two cannot drift, and is cross-linked from `docs/HAZARD-LOG.md`.

## [v3.32.1] — 2026-06-07

### Fix six bugs found in weekly bug bash

**`engine/rules-engine.js`** — two fixes:
- Vaccine history filter: changed `!pt.date || pt.date >= seasonStartIso` to `pt.date && pt.date >= seasonStartIso` in both the `given` and `declined` branches of `matchVaccineHistory`. Undated history entries (data-quality gaps) were previously treated as in-season, potentially suppressing a current-season vaccine alert for patients whose old undated record was found first.
- Vaccine sex-eligibility check: added a `sex &&` guard before `clause.sex !== sex[0]` so patients with an empty-string sex field are no longer silently excluded from female-specific eligibility clauses (e.g. cervical-cancer-screening, HPV).

**`content-scripts/referrals-discovery.js`** — changed `if (dataCaptured)` to `if (dataCaptured && configCaptured)` in `scanEntries`. If a data URL resolved before the config URL appeared in a later PerformanceObserver callback, the config was permanently skipped, silently breaking referrals discovery on cache-ordered page loads.

**`visualiser-core.js`** — analyte trend reference band now uses the most-recent data point's `low`/`high` values (`pts[pts.length-1]`) instead of the oldest (`pts[0]`), so age-adjusted or lab-updated reference intervals are reflected correctly.

**`sentinel-options/options.js`** — two fixes:
- `addAllLibraryEntries`: tracks the count of rules dropped by `validateCustomRule` and appends `, N skipped (invalid)` to the completion toast so the user knows if any library entries were rejected.
- `dcOpenForm`: converted the `chrome.storage.local.get` callback to `async/await` so form fields are fully populated before control returns to the user, eliminating a narrow race where typing could begin before stored rule values were loaded.

## [v3.32.0] — 2026-06-07

### Security hardening — second pass (NF1–NF5 from the 2026-06-07 red-team audit)

Full write-up in `SECURITY-AUDIT.md`. No evidence of active exploitation; these
changes close latent weaknesses found in the second scheduled audit pass. The most
important fix closes a patient-safety gap where a crafted backup file could silently
suppress all drug-monitoring chips without any preview warning.

- **NF1 + NF3 (High / Medium) — `sentinel.hiddenRules` backup import hardened.**
  The per-chip hide/snooze feature (v3.26.3) stores suppressions in
  `sentinel.hiddenRules`. The import path previously accepted any object for this
  key without validating entry structure, and `previewEnvelope()` had no logic to
  warn about suppressed chips — so a crafted backup could silently hide all
  drug-monitoring alerts with no visible indication before or after import.
  Two fixes:
  1. `shared/io/sentinel-io.js` — `sentinelImport()` now validates each entry is
     `{ until: null | "YYYY-MM-DD" }` and rejects malformed values.
  2. `shared/io/suite-envelope.js` — `previewEnvelope()` now emits a `WARNING`
     line listing the count and a sample of hidden rule IDs when a backup contains
     suppressed alerts, mirroring the existing `enabled:false` rule warning.

- **NF2 (Medium) — OB register disabled pending engine support.**
  The QOF Obesity register (`qof-reg-ob`, v3.29.0) was enabled by default but
  documented in its own rule comment as a BMI-problem-label approximation that
  "will miss obese patients who have a recorded BMI but no obesity problem label".
  An enabled-by-default register that silently under-counts is a false-confidence
  baseline. Set `enabled: false` until the engine supports observation-based
  register membership (BMI observation lookup). The two dependent indicators
  (OB004, OB005) remain disabled pending CSO confirmation regardless.

- **NF4 (Low) — `popout:closed` message handler gains `sender.id` guard.**
  `side-panel/panel.js` — the one `chrome.runtime.onMessage` listener without a
  `sender.id !== chrome.runtime.id` check now has it, consistent with the two
  other listeners in the same file and the service-worker/sentinel handlers.

- **NF5 (Low) — `activeTab` permission removed.**
  `manifest.json` — `activeTab` was declared but never exercised: all tab queries
  use `chrome.tabs.query()`, which requires only the `tabs` permission (already
  present). Removing `activeTab` reduces the declared permission surface.

- **NF6 (tracked follow-up) — PDF.js 3.11.174 upgrade deferred.**
  CVE-2024-4367 (arbitrary JS via PDF FontMatrix) affects PDF.js < 4.2.67;
  the exploit is mitigated by the existing `isEvalSupported: false` setting
  (`visualiser-core.js:640`). Upgrading the vendored binary is tracked as a
  follow-up (requires downloading and verifying the new build).

## [v3.31.2] — 2026-06-06

### Add proprietary copyright header to source files

Prepended a one-line `© 2026 Graysbrook Ltd. Proprietary — all rights reserved.
See LICENSE.` notice to the shipping first-party source (67 JS/CSS files across
side-panel, pop-out, shared, engine, content-scripts, options, sentinel-options,
sidebar, plus `service-worker.js` and `visualiser-core.js`). Vendored third-party
files, JSON/rule files, test harnesses, and build scripts were deliberately left
untouched. Comment-only change — no functional effect; full test suite green.

## [v3.31.1] — 2026-06-06

### Add explicit proprietary LICENCE

Added a root `LICENSE` file: strict proprietary, all-rights-reserved. No grant of
any right to use, copy, modify, redistribute, fork, or make commercial use of the
code; explicit clauses that public GitHub visibility is not a waiver or a release
to the public domain, that no commercial entity (including any EPR provider) may
use it, and that the code may not be used to train machine-learning models.
Third-party components (e.g. PDF.js, Apache-2.0, per `vendor-versions.json`)
retain their own upstream licences. The README licence section now points to it.
Previously the repository had only informal licence statements in the README and
disclaimer and no top-level LICENSE file.

## [v3.31.0] — 2026-06-06

### New module: Observation Trends (HbA1c / cholesterol / weight)

Adds a single **Trends** tab (side panel + pop-out) with a metric picker for
HbA1c, total cholesterol and weight. Reuses the shared `lineChart` and the
existing `getTrendData` bridge — the same `observationHistory` already powering
the BP and Renal trend tabs — so no new data path or storage key is introduced.

Strictly **display only**, consistent with the suite's passive intended purpose:
it plots recorded values with the latest reading, a neutral (non-RAG) change
arrow, and the reading count/date range. It renders **no clinical thresholds,
target zones, or interpretation text**. Metric selection is in-memory (no
storage key → no backup/IO changes). Each metric isolates its observation row by
name substring with look-alike exclusions (e.g. cholesterol excludes HDL/LDL/
ratio/non-HDL).

## [v3.30.0] — 2026-06-06

### Reliability: global "Medicus UI changed?" canary banner

The Sentinel extraction-health signal (`assessExtractionHealth` → the `degraded`
flag on the snapshot) is now surfaced as a **global amber banner across every
side-panel module**, not just the Monitoring tab. When a patient record is on
screen but the extension can extract no medications, problems, observations or
demographics — the signature of a Medicus layout change — the banner appears and
warns that this is **not** an "all clear" and that the patient must be verified
directly in Medicus. It includes a one-click **Check for update** button (reuses
the existing `UpdateChecker`, with the same `https://github.com/` release-URL
validation used on the About tab).

This converts a silent failure mode (an empty Monitoring panel read as "nothing
to flag") into a visible prompt no matter which tab the clinician is on. The
banner polls every 30 s, refreshes immediately on `sentinel:snapshot-updated`,
and clears automatically once extraction recovers. No new storage keys; no change
to the underlying clinical signal (already regression-tested by
`test-extraction-health.js`).

## [v3.29.3] — 2026-06-05

### Fix: options page now reloads after import so restored settings are visible

After confirming a backup restore (suite-wide or per-module), the options page now reloads itself after 1.5 s. Previously the form kept displaying pre-import values even though the data was correctly written to storage — causing the triage monitor UUID, slot alert rules, and all other restored settings to appear missing until the page was manually reloaded.

## [v3.29.2] — 2026-06-05

### Tab order and rename

Renamed "ACR Trend" tab to "Renal Monitoring" (module key `acrtrend` unchanged). Reordered nav tabs in both panel and pop-out to: Slots → Monitoring → Renal → BP Trend → Forecast → Submissions → Activity → Referrals.

## [v3.29.1] — 2026-06-04

### Prescribing safety — completed the UK oral NSAID set (The Keeper)

The Keeper run found the NSAID drug lists were missing several UK-marketed oral NSAIDs, so a patient
on one of them **silently never fired any NSAID prescribing flag** (gastroprotection, NSAID +
anticoagulant/antiplatelet, triple-whammy/AKI). Completed the set in **both** places that matter:

- **`content-scripts/triage-lens/content.js`** — the `NSAIDS` regex in `evaluatePrescribingFlags`,
  which fires the *built-in* prescribing-flag chips. Added tenoxicam, sulindac, dexketoprofen,
  tiaprofenic acid, tolfenamic acid and fenoprofen (nabumetone was already present).
- **`rules/alert-library.json`** — the shared NSAID `drugSet` used by all NSAID-combo starter rules
  (PINCER #1–#4, #6, #12). All six sets are now the complete, uniform UK oral NSAID list (also adding
  dexibuprofen where it was missing).

Regression-locked with seven new assertions in `test-prescribing-flags.js` (22 pass). NSAID list
corroborated via search; pending primary-source confirmation. Verification note: the *shipping* gap
was in `content.js`, not just the JSON library the scan first flagged — both are now fixed.

## [v3.29.0] — 2026-06-04

### QOF — new 2026/27 Obesity clinical area (The Keeper, DRAFT pending confirmation)

The Keeper rule-currency run found that `rules/qof-rules.json` was missing the **new Obesity
clinical area introduced in QOF 2026/27** (NHS England PRN02356), despite the file claiming full
26/27 coverage. Added:

- **OB register** (`qof-reg-ob`, enabled) — Obesity register, approximated by substring
  problem-matching. The true QOF register is BMI-driven (BMI ≥30, or ≥27.5 for listed ethnic
  backgrounds, recorded in the last 12 months), so this approximation will miss obese patients who
  have a recorded BMI but no `obesity` problem label; proper membership needs a BMI-observation
  register (engine extension). Excludes family-history / negated labels.
- **OB004 and OB005 indicators** — shipped **disabled** as drafts, mirroring the existing
  placeholder convention (DM037/HF009). OB004 (offer of weight-management referral) and OB005
  (weight-management pharmacotherapy / shared decision-making) carry corroborated points/thresholds
  (5 pts @ 10–30%; 13 pts @ 50–80%) that are **pending confirmation against PRN02356** before being
  enabled. OB005 is relevant to this dispensing practice's GLP-1 weight-loss prescribing.

OB register membership is regression-tested in `test-qof-indicator-filters.js`. Values were
corroborated via search only (primary NHS England guidance was not fetchable in the run environment)
— the Clinical Safety Officer should confirm OB004/OB005 points and thresholds against PRN02356 and
flip them enabled.

## [v3.28.1] — 2026-06-04

### Drug-monitoring rules — brand-completeness pass (The Keeper)

First run of the new **The Keeper** rule-currency skill (`.claude/skills/the-keeper/`). A
brand-completeness sweep of `rules/drug-rules.json` against dm+d/emc found monitored drugs whose
`drug.match` lists were missing currently- or recently-marketed UK brands. Because matching is
case-insensitive substring (`engine/rules-engine.js`), a prescription written under a missing brand
**silently never fires its monitoring alert** — a patient-safety gap, not a cosmetic one. Added:

- **amiodarone** — `cordarone` (the rule previously listed *no* brand, so "Cordarone X" never fired
  TFT/LFT/CXR monitoring for a drug with thyroid/hepatic/pulmonary toxicity).
- **allopurinol** — `caplenal`, `uricto` (previously only `zyloric`). `hamarin` was investigated but
  held out pending confirmation of current UK marketing.
- **azathioprine** — `azapress` (Ennogen).
- **sulfasalazine** — `sulazine` (Sulazine EC, Teva).
- **methotrexate** — `maxtrex` (discontinued Pfizer oral brand that persists on repeats).

All additions are regression-locked in `test-drug-brand-coverage.js` (264 assertions pass). Brands
were corroborated via dm+d/emc search; the source citations in the rule file note they are pending
primary-source (BNF/dm+d) confirmation by the Clinical Safety Officer.

## [v3.28.0] — 2026-06-04

### Security

Hardening pass from an adversarial code review (red-team audit). Full write-up in
`SECURITY-AUDIT.md`. No evidence of any active compromise or data exfiltration was found;
these changes close latent weaknesses, the most important being a patient-safety one.

- **Ruleset import can no longer silently weaken clinical safety alerts (F1, High).**
  `engine/ruleset-io.js` now hard-validates imported override objects: every numeric `check.*`
  threshold (`red`/`amber`/`threshold`/`thresholdSystolic`/`thresholdDiastolic`/`minDelta`/
  `minPoints`/`withinDays`/`withinMonths`) must be a finite number (`Number.isFinite`), array
  fields must be arrays, and `kind`/`operator`/`comparator`/`direction` must be in their known
  enum sets. `intervalDays`/`dueSoonDays` now reject `NaN`/`Infinity`. Previously a malformed or
  malicious backup could set a string threshold, causing `NaN` comparisons that silently
  suppressed an alert. `mergeRules` also strips `__proto__`/`constructor`/`prototype` keys before
  merging (defence-in-depth). The import **preview now warns** when a file disables monitoring
  rules ("Disables N monitoring rule(s): …"). New regression suite `test-import-hardening.js`.
- **Patient data minimised at rest (F2, Medium).** `shared/request-monitor.js` no longer
  persists full patient names to `chrome.storage.local` (plaintext on disk) — only initials are
  stored. Desktop notifications (`service-worker.js`) now show counts/initials rather than full
  names.
- **Tightened extension resource exposure (F3, Medium).** `web_accessible_resources` trimmed from
  17 broad globs to the 5 files content scripts actually load (`sidebar/*`, the three
  `rules/*.json`), so the engine code and shared utilities are no longer readable by Medicus-page
  scripts. (The rule JSON must remain accessible because content scripts fetch it; moving rule
  loading to the service worker is a tracked follow-up.)
- **Untrusted MAIN-world bridge hardened (F4/F5, Low–Med).** The `ch-task-list-data` bridge in
  `content-scripts/triage-lens/content.js` now bounds row counts, validates row/UUID shape, and
  rate-limits (sliding window + debounce) so a compromised page can't fan forged events out into
  unbounded API calls. `chrome.runtime.onMessage` handlers in `service-worker.js`, `sentinel.js`,
  `panel.js` and `pop-out.js` now reject messages where `sender.id !== chrome.runtime.id`.
- **Supply-chain & permission hygiene (F6/F7/F8, Low).** Added `vendor-versions.json` (library
  versions + SHA-256 for the vendored PDF.js/Chart.js/D3 bundles); import now rejects files
  >10 MB before parsing; the GitHub host permission narrowed from `api.github.com/*` to the
  single repo path used by the update checker; practice-code/site-ID values are format-validated
  before being interpolated into fetch URLs.

## [v3.27.0] — 2026-06-03

### Changed
- **Suite-wide UK brand-name coverage for built-in drug-monitoring rules.** Following the lithium/methylphenidate/methotrexate fixes, every remaining monitored drug class was researched against the BNF / dm+d / emc and its current UK proprietary brands added to `drug.match`, so brand-prescribed items fire the same monitoring as their generics. Only UK-marketed brands were added (legacy/discontinued ones retained, since repeat prescriptions persist); non-UK names were deliberately excluded. Highlights:
  - **DMARDs**: leflunomide (`arava`); hydroxychloroquine (`quinoric`, `plaquenil`) / chloroquine (`avloclor`); azathioprine (`imuran`); sulfasalazine (`salazopyrin`).
  - **Carbamazepine**: `carbagen`. **Carbimazole**: `neo-mercazole` / `neomercazole`.
  - **ACE inhibitors / ARBs**: full set incl. `tritace`, `zestril`, `carace`, `coversyl`, `innovace`, `capoten`, `noyada`, `gopten`, `staril`, `cozaar`, `hyzaar`, `arbli`, `amias`, `diovan`, `exforge`, `aprovel`, `karvea`, `micardis`, `pritor`, `tolura`, `olmetec`, `sevikar`, `edarbi`, plus thiazide-combination brands (`zestoretic`, `innozide`, `triapin`).
  - **SGLT2 inhibitors** incl. metformin/DPP-4 combinations: `forxiga`, `xigduo`, `qtern`, `jardiance`, `synjardy`, `glyxambi`, `invokana`, `vokanamet`, `steglatro`, `segluromet`, `steglujan`.
  - **DOACs**: `eliquis`, `xarelto`, `lixiana`, `pradaxa`.
  - **Statins**: `lipitor`, `atozet`, `inegy`, `crestor`, `enebium`, `lipostat`, `lescol`, `livazo`.
  - **Antipsychotics** incl. long-acting depots: `zyprexa`, `zalasta`, `zypadhera`, `risperdal`, `okedi`, `seroquel`, `atrolak`, `biquelle`, `zaluron`, `abilify`, `serenace`, `dozic`, `haldol`, `largactil`, `solian`, `invega`, `xeplion`, `trevicta`, `byannli`, `latuda`, `sycrest`, `reagila`. (Clozapine remains excluded — national CPMS protocol.)
  - **Others**: spironolactone/eplerenone (`aldactone`, `inspra`); allopurinol/febuxostat (`zyloric`, `adenuric`); mirabegron (`betmiga`); levothyroxine/liothyronine (`eltroxin`, `euthyrox`, `tertroxin`); GLP-1 legacy brands (`xultophy`, `lyxumia`, `byetta`, `bydureon`); systemic HRT (`progynova`, `zumenon`, `climaval`, `estraderm`, `nuvelle`) — local vaginal oestrogens still excluded.

### Added
- **`test-drug-brand-coverage.js` extended to every drug-monitoring rule** (258 assertions): each monitored generic/brand must fire its rule, plus negative controls (clozapine must not match the antipsychotic rule, vaginal oestrogens must not match systemic HRT, unrelated drugs must not match). A cross-rule collision check confirms no added brand token fires an unrelated rule.

## [v3.26.7] — 2026-06-03

### Added
- **Brand-coverage regression test** (`test-drug-brand-coverage.js`) asserting, via the real `drugMatchesRule`, that every monitored generic/brand fires its rule (and unrelated drugs don't). Guards against the *silent* under-matching failure mode where a brand-prescribed med never triggers its alert.
- **CLAUDE.md SOP** — new "Editing drug-monitoring rules" section: substring-match semantics, list-all-UK-brands expectation, `exclude` caution, and the requirement to extend the coverage test when adding drugs/brands.

## [v3.26.6] — 2026-06-03

### Changed
- **Methotrexate monitoring now also covers injectable forms.** Removed the `methotrexate 50mg/2ml` / `methotrexate injection` exclusions from the `methotrexate-maintenance` rule so that any patient on parenteral methotrexate (uncommon in primary care, but possible) still gets FBC/U&E/LFT monitoring rather than being silently skipped.

## [v3.26.5] — 2026-06-03

### Changed
- **Expanded brand-name coverage for built-in drug-monitoring rules** so that proprietary/brand prescriptions trigger the same monitoring as their generic names:
  - **Lithium**: added `priadel`, `camcolit`, `liskonum`, `li-liquid`. (`lithium carbonate` / `lithium citrate` were already matched via the `lithium` substring.)
  - **Methylphenidate (ADHD stimulant, paediatric + adult rules)**: added `tranquilyn`, `affenid`, `atenza`, `kixel`, `matoride`, `xaggitin`, `focusim`, `meflynate`, `metyrol` (joining the existing `ritalin`, `concerta`, `equasym`, `medikinet`, `xenidate`, `delmosart`).
  - **Methotrexate**: added `metoject`, `jylamvo`, `nordimet`, `zlatal`, `methofill` (oral and shared-care brands). Injectable high-dose exclusions (`methotrexate 50mg/2ml`, `methotrexate injection`) are unchanged.

## [v3.26.4] — 2026-06-02

### Fixed
- **HRT hysterectomy detection**: "Vaginal hysterectomy" (and other procedure-coded hysterectomies stored as ended/past problems) was not detected by the HRT progestogen-coverage check. The normaliser now captures ended problems separately as `pastProblems`; the HRT context builder checks both active and past problems for hysterectomy terms, so the chip correctly shows "Hysterectomy — progestogen not required" instead of the false "No progestogen or hysterectomy recorded" warning.

## [v3.26.3] — 2026-06-02
### Added
- **Per-rule hide / snooze for monitoring chips** — each chip in the monitoring panel now carries an unobtrusive dismiss (×) button, visible on hover at the top-right, that does not interfere with click-to-expand evidence.
  - **Vaccine chips** snooze until the season start (`seasonStartIso`) and auto-resurface once that date passes.
  - **Drug-monitoring and QOF indicator chips** hide permanently (until cleared).
  - Suppressions are stored in `chrome.storage.local` under `sentinel.hiddenRules` (`{ ruleId: { until: ISODate|null } }`); a rule is hidden while the key exists and `until` is null or a future date.
  - Sentinel settings (Display tab) gains a **Hidden / Snoozed Alerts** section listing every suppressed rule with an Enable button, plus a **Manage Alerts** section that hard-toggles the bundled vaccine rules on/off.
  - The panel re-renders live on `sentinel.hiddenRules` changes, and `sentinel.hiddenRules` is now included in suite backups (`sentinel-io.js`).

## [v3.26.2] — 2026-06-02
### Fixed
- **QOF chips missing on care record view** — `detectMedicusContext` had a negative lookahead `(?!.*care-record)` on the `/patient/{uuid}` URL regex that explicitly excluded URLs of the form `/patient/{uuid}/care-record/...`. This meant the care record URL never yielded a `patientUuid` directly, falling through to the DOM banner scraper; if that failed, `dom-fallback` was used with empty `observationHistory`, causing all QOF indicators to resolve as `no_data` and disappear. Document task views worked because they use a separate `resolveTaskToPatient()` path. Fix: removed the negative lookahead — one character change in `engine/api-client.js:45`.

## [v3.26.1] — 2026-06-02
### Fixed
- **Flu chip false positive on all patients** — `matchVaccineEligibility` register clause was calling `patientOnRegister()` which returns `{matched: false}` (a truthy object), not a boolean. The old `.some()` check treated this truthy object as a hit, causing the flu chip to fire for every patient via the "Clinical risk group (QOF register)" clause. Fixed by converting to an explicit loop with `if (res && res.matched)` check. Same fix applied to `conditional-register` clause.
- **Chip too wordy** — "DOUBLE-CHECK ELIGIBILITY" disclaimer and source text moved into a native `<details>` block collapsed by default. Compact view shows only displayName + status badge + eligibility reason + season. Disclaimer visible on expand (ⓘ Details).
- **No provenance shown** — `matchVaccineEligibility` now captures and returns the specific matched evidence: which problem, which register + problem, which medication, or which observation value triggered eligibility. Shown in the expanded chip detail.

## [v3.26.0] — 2026-06-02
### Added
- **Vaccination eligibility alerts** (flu + COVID) — new `vaccine` rule type and `rules/vaccine-rules.json`. The monitoring panel now surfaces a "Vaccinations" group with DUE / GIVEN / DECLINED chips. Eligibility is derived from age, QOF registers, active problems, current medications, and BMI observation using JCVI/UKHSA 2025/26 criteria.
  - **Flu**: age 65+, all 2–17yo, pregnancy, clinical risk registers (DM/CKD/COPD/CHD/HF/Stroke-TIA/AF/PAD), asthma on inhaled/systemic steroids, chronic liver/neurological disease, immunosuppression, asplenia, BMI ≥40 (Green Book Chapter 19).
  - **COVID**: age 75+, care home residents, and immunosuppressed only — clinical risk groups are no longer eligible as of 2025/26.
  - Status (DUE/GIVEN/DECLINED) is inferred from coded problems, observations, and journal entries within the current season window (flu from 1 Sep, COVID autumn from 1 Oct). All chips carry a prominent "DOUBLE-CHECK ELIGIBILITY" note as status may be incomplete if vaccination was given outside the practice.

## [v3.25.3] — 2026-06-02
### Fixed
- **BP Trend tab still blank after v3.25.2** — added a fallback path in `bptrend.js` that merges separate "Systolic blood pressure" / "Diastolic blood pressure" entries from `observationHistory` by date when no parseable combined "Blood pressure" entry is found. This handles all API shapes: combined row (primary path), synthesised combined entry from v3.25.2 (primary path), and raw split rows that reach bptrend without synthesis (fallback path). Also added `Blood pressure` history entries to mock data (`engine/data-fetcher.js`) so the trend tab can be verified in mock mode.

## [v3.25.2] — 2026-06-02
### Fixed
- **BP Trend tab showing "No blood pressure readings found"** — `normaliseObservationHistory` was emitting separate "Systolic blood pressure" / "Diastolic blood pressure" entries with scalar `rawValue` ("120", "80"). The bptrend module matched the systolic row first, `parseBp("120")` failed the slash regex, and all history points filtered to empty. Fix: added same systolic/diastolic date-pairing synthesis to `normaliseObservationHistory`, producing a `"Blood pressure"` entry prepended to `observationHistory` with `rawValue: "120/80"` per date. `unshift` ensures it is found before the raw split rows on substring match.

## [v3.25.1] — 2026-06-02
### Fixed
- **BP chips not surfacing** — Medicus API emits blood pressure as separate "Systolic blood pressure" and "Diastolic blood pressure" investigation rows. `parseBp()` in the rules engine requires combined "NNN/NN" slash format, so it previously returned null for every BP reading and all enabled BP indicators (CD001, CD002, HYP010, HYP011) resolved to `no_data`. Fix: `normaliseObservations` now runs a post-processing pass after the per-row loop that pairs same-date systolic + diastolic rows and injects a synthetic `{ name: "Blood pressure", value: "NNN/NN mmHg", ... }` observation, making existing chip evaluation work with no rules changes.

## [v3.25.0] — 2026-06-02
### Added
- **BP Trend tab** (`bptrend`) — shows systolic/diastolic history as a dual-line SVG chart with condition-specific target lines (130/80 for CKD+ACR>70, 150/90 for HYP≥80, 140/90 standard). Target derived from achieved QOF register chips. AT TARGET / ABOVE TARGET pill. Paediatric caveat note for under-18s (adult thresholds shown; centile charts required for accurate paediatric assessment).
- **ACR Trend tab** (`acrtrend`) — shows ACR history with A1/A2/A3 KDIGO threshold band shading, eGFR co-display with G-stage bands, KDIGO G×A monitoring frequency cell, and action banners for ACR ≥70 (referral), ACR doubling, and category crossing.
- **`getTrendData` content-script bridge** — new message action in `sentinel.js` exposes `observationHistory`, `problems`, `patientContext`, and achieved register chips to panel modules. `_lastTrendData` is written in lockstep with `_lastSnapshot` and cleared in `invalidateSnapshot` to prevent cross-patient data render.
- **`shared/trend-chart.js`** — shared SVG line chart utility (`lineChart`, `parseBp`, `bpTarget`, `fmtDate`, `esc`) used by both trend modules. Hand-coded SVG — no Chart.js dependency in panel shells.

### Notes
- BP `value` in observationHistory is NaN for "120/80" strings; bptrend parses `rawValue` via `parseBp`.
- Trend data only available after the Medicus investigation dashboard has loaded for the patient.
- No chrome.storage keys added — no IO backup wiring needed.

## [v3.24.0] — 2026-06-02
### Added
- **ADHD stimulant monitoring (paediatric)** (`adhd-stimulant-paediatric`, age ≤17) — 6-monthly BP, pulse/HR, weight, height. Covers methylphenidate (Ritalin/Concerta/Equasym/Medikinet/Xenidate/Delmosart), lisdexamfetamine (Elvanse), dexamfetamine (Dexedrine/Amfexa). First rule to exercise `ageRange` on drug-monitoring rules.
- **ADHD stimulant monitoring (adult)** (`adhd-stimulant-adult`, age ≥18) — 6-monthly BP, pulse/HR, weight. Same drug match, no height (not clinically indicated in adults).
- **Atomoxetine monitoring** (`atomoxetine-maintenance`) — 6-monthly BP, pulse/HR, weight; annual LFT (hepatotoxicity). Notes cover MHRA suicidality warning (first month) and paediatric growth.
- **Guanfacine monitoring** (`guanfacine-maintenance`) — 3-monthly BP, pulse/HR, weight (stricter CV interval vs stimulants; hypotension/bradycardia risk). Notes cover tapering requirement and CYP3A4 interaction.
- **New test match patterns**: pulse/HR (`["pulse", "heart rate", "hr", "resting heart rate"]`, SNOMED 78564009) and height (`["height", "body height"]`, SNOMED 248335003) — both new to the rule suite.

## [v3.23.0] — 2026-06-02
### Added
- **Smoking status due chips** — new `observation-recent` QOF indicators for all relevant disease registers: SMI (MH011), Asthma, COPD, Diabetes, CHD, Stroke/TIA, CKD, Heart Failure, PAD (all SMOK001). New SMI register added (`qof-reg-smi`) covering schizophrenia, bipolar disorder, and other psychoses.
- **Carbamazepine drug monitoring** (`carbamazepine-maintenance`) — 6-monthly FBC, LFT, U&E/Sodium, carbamazepine level; annual lipid profile. Match terms include `tegretol`. Notes cover SIADH/hyponatraemia, enzyme-induction effects on lipids, and contraceptive/teratogenicity considerations.
- **`observation-bundle` engine support** — new check kind in `rules-engine.js`; evaluates each observation group against the QOF year window and returns `achieved` (all met) / `not_met` (partial) / `no_data` (none found), with a `X/N care processes` value label. `evidenceCtx.bundleResults` carries per-group detail for the chip renderer.
- **DM037 enabled** — all 8 diabetes care processes indicator now live (was disabled pending engine support).

## [v3.22.1] — 2026-06-02
### Fixed
- **HRT progestogen context**: added `"hormone releasing intrauterine"` and `"insertion of hormone releasing"` to `iusProblemTerms` so that a problem entry of "Insertion of hormone releasing intrauterine contraceptive device" is now recognised as an IUS for endometrial-protection context on HRT chips.

## [v3.22.0] — 2026-06-01
### Fixed (custom rule creator ↔ engine parity — from the two-agent review)

The custom rule builder was wired correctly end-to-end (all five types save, merge, evaluate, render, back up) but several builder forms had drifted behind the engine, so some saved rules silently behaved differently than configured. Closed the gaps:

- **qof-indicator cohort fields now reachable**: the builder exposes free-text **`requiresProblem`** (all-of), **`requiresAnyProblem`** (any-of), free-text **`excludeIfProblem`** (alongside the frailty preset), and **`sex`**. Previously a clinician could not build a DM021/DM035-style stratified indicator — any attempt fired for the whole register with the wrong denominator (the over-trigger the engine work had just fixed for canonical rules). `validateQofIndicatorRule` now type-checks all four. (`sentinel-options/options.html`, `sentinel-options/options.js`, `shared/io/sentinel-io.js`)
- **`medicationExclude` no longer a no-op**: the qof `medication-present` check ignored `medicationExclude` even though the builder saved it. The engine now applies it (an excluded med can't satisfy the indicator). (`engine/rules-engine.js`)
- **drug-monitoring patient filters + SNOMED**: the builder now exposes `ageRange`, `sex`, `requiresProblem`/`excludesProblem`, and per-test SNOMED codes — the gating/coding the engine already applied but the form couldn't set. Validated in `validateDrugMonitoringRule`. (`sentinel-options/*`, `shared/io/sentinel-io.js`)
- **drug-combo `mustNotBePresent`**: the "must NOT be co-prescribed" drug-absence gate (engine-supported, validator-allowed) is now a form field. (`sentinel-options/*`)
- **Rule-builder live preview now matches runtime for trend / event-count(observations)**: the mock patient built a flat `observationHistory`, but the engine reads entries grouped per investigation type with a nested newest-first `history[]`. The preview now mirrors the normaliser shape, so "would this fire?" matches production. (`sentinel-options/options.js`)
- Extended `test-qof-indicator-filters.js` (now 39 assertions) covering `medicationExclude` and the new validator fields.

## [v3.21.3] — 2026-06-01
### Fixed (cosmetic / dead-code / consistency — from the codebase audit)

- **CHOL004 LDL priority (F9)**: `findLatestObservation` now uses a same-date tiebreak that prefers earlier-listed `match`/`observation` terms, and CHOL004 lists LDL before non-HDL — so when both are recorded on the same date, LDL takes priority (as the rule note specifies) instead of depending on dashboard row order. (`engine/rules-engine.js`, `rules/qof-rules.json`)
- **Dead message handlers removed (E4)**: deleted the `openTriageLensOptions` service-worker case (no sender) and the `toggleSidebar` SW→tab round-trip plus its no-op listener in `sentinel.js` (suite mode has no floating sidebar to toggle). (`service-worker.js`, `content-scripts/sentinel.js`)
- **Triage-lens options fallback path (D1)**: the `openOptionsPage`-unavailable fallback opened `getURL('options.html')`; the file is at `options/options.html`. (`content-scripts/triage-lens/content.js`)
- **Dead script load removed from pop-out (B5)**: `pop-out.html` loaded `shared/request-monitor.js` but the pop-out never uses `RequestMonitor`. (`pop-out/pop-out.html`)
- **Submissions date-picker race (B6)**: date-change callbacks are now registered synchronously in a map keyed by input id instead of via `setTimeout(0)`, so a change fired immediately after render can't be dropped. (`side-panel/modules/submissions/submissions.js`)
- **SubRag strip diagnostics (E5)**: the submissions-RAG strip now fetches via `ApiDiag.fetch`, so its errors/latency appear in the Debug panel like the other strips. (`side-panel/panel.js`)
- **Docs**: documented that `visualiser`/`about` are intentionally panel-only tabs (not mirrored in the pop-out) and clarified the pop-out message-relay (B4). (`CLAUDE.md`, `pop-out/pop-out.js`)

## [v3.21.2] — 2026-06-01
### Fixed (robustness / lifecycle — from the codebase audit)

- **Triage-lens route watcher no longer stacks uncancellable re-evaluations (A1)**: the 1200ms "slow rerender" timer in `onRoute` was fire-and-forget, so rapid SPA navigation (journal-search churn, queue scrolling) queued a `run(true)` — and a full 4-endpoint fetch cascade — per change. It's now stored and cleared alongside the 250ms timer. (`content-scripts/triage-lens/content.js`)
- **Rule edits now take effect immediately in the side panel (A4)**: the `storage.onChanged` handler only watched `sentinel.config` and called the suite-mode no-op `refresh()`, so editing a rule in Options didn't change the panel until the next navigation. It now also watches `sentinel.rules`/`orgRules`/`customRules`, invalidates the rules cache, and re-publishes. (`content-scripts/sentinel.js`)
- **`loadRules()` is cached (A6)**: it previously did 2× `fetch` + 1× `storage.get` on every evaluation (including the 800ms journal-search re-eval). The canonical ruleset is fetched once and the merged result cached, invalidated on rule-key changes. (`content-scripts/sentinel.js`)
- **Same-patient nav guard works on DOM-fallback views (A5)**: `patientContext.patientUuid` is now resolved (URL, then single-patient DOM banner) on the DOM-fallback path, so journal searches / tab switches on those views no longer invalidate + re-fetch the snapshot on every URL change. (`engine/data-fetcher.js`)
- **Pop-out tab switching has a sequence guard (B1)**: `pop-out.js switchModule` now mirrors `panel.js`'s `switchSeq` guard, so a fast tab switch can't leak the previous module's timers/listeners or lose its cleanup. (`pop-out/pop-out.js`)
- **Sentinel side-panel `refresh()` coalesces concurrent calls (B2)**: it had no in-flight guard despite being driven by the 10s poll, tab events, the snapshot-updated message and the refresh button — concurrent calls raced their round-trips and clobbered each other's DOM. Also removed a duplicate per-render refresh-button listener (the delegated handler already covers it). (`side-panel/modules/sentinel/sentinel.js`)
- **"No practice code" message now shows (B3)**: `fetchWaitingRoom` called `render({state:'loaded'})` — an unhandled state that threw (swallowed) — instead of updating the pinned waiting-room block. (`side-panel/modules/sentinel/sentinel.js`)
- **Toolbar badge has a single owner (E1)**: the waiting-room count was written independently by both `panel.js` and the Sentinel module, racing/clobbering each other when the Sentinel tab was active. The badge is now owned solely by `panel.js`'s strip. (`side-panel/modules/sentinel/sentinel.js`)
- **Strip poll timers are torn down on `pagehide` (E2)**: `wrPollTimer`/`subRagPollTimer` were never cleared, risking duplicate timers if the panel document is recreated. (`side-panel/panel.js`)
- **Pusher relay releases the old channel handler before rebinding and resets its wait budget (E3)**: prevents a stale closure firing on a dead channel and the relay going permanently silent after a late reconnect. (`content-scripts/pusher-relay.js`)

## [v3.21.1] — 2026-06-01
### Fixed (backup/restore data loss — from the codebase audit)

- **`suite.display` now survives backup/restore (C3)** and **`suite.*` keys are no longer handled raw in `doFullExport`/`applyEnvelope` (C1)**: added `shared/io/suite-io.js` (`suiteExport`/`suiteImport`) owning `suite.display` (theme / text size / colourblind), `suite.practiceCode` and `suite.feedbackEmail`, per the CLAUDE.md convention. `doFullExport`/`applyEnvelope` now delegate to it instead of reading/writing those keys inline; `suite.display` (previously captured nowhere) is now backed up, and the envelope preview lists it. (`shared/io/suite-io.js`, `options/options.js`, `options/options.html`, `shared/io/suite-envelope.js`)
- **Sentinel alert-library acknowledgement now backed up (C2)**: `sentinel.alertLibrary.acknowledged` was written by the Sentinel options page but absent from `sentinel-io.js`, so a restore re-locked the alert library and re-prompted the user. Added it to `SENTINEL_KEYS` and the export/import shape. (`shared/io/sentinel-io.js`)
- **Per-module export cards for Triage Capacity Alerts and Pop-out (C4/C5)**: both scopes were fully wired in the IO/envelope layer but had no card in Options, so their standalone export/import was unreachable. Added the cards. (`options/options.html`)
- Added `test-backup-keys.js` (round-trip tests with an in-memory `chrome.storage` mock).

## [v3.21.0] — 2026-06-01
### Fixed

- **Journal-coded QOF indicators now fire in the side panel (F1)**: the suite-mode publish path (`evaluateAndPublish`) never augmented observations with consultation/journal-coded entries — that augmentation lived only in the floating HUD's `refresh()`, which is dead in suite mode. So indicators whose evidence lives only in the journal (AST007 asthma review, COPD010, HF007, DM014 structured education, AF006 CHA2DS2-VASc) always read `no_data` in the panel even when done. `evaluateAndPublish` now calls `fetchJournalObservations` (best-effort, generation-guarded so a journal fetch can't publish stale chips after a navigation). Also fixed the patient-id resolution in the HUD path to use the canonical `patientContext.patientUuid` field (it previously looked for `patientId`/`id`/`uuid`, none of which the normaliser sets, so journal augmentation silently skipped on care-record URLs). (`content-scripts/sentinel.js`)

## [v3.20.0] — 2026-06-01
### Fixed (clinical correctness — from the multi-agent codebase audit)

- **QOF indicator age filter now fails OPEN (F2)**: `evaluateQofIndicatorRule` previously returned no chip when a patient's age couldn't be extracted *and* the indicator had an `ageRange` — silently hiding age-gated indicators (HYP010/011, CD001/002, DM034/036, trend rules) whenever DOB scraping failed. It now uses the shared fail-open `passesAgeFilter` (suppress only when the patient is *positively* out of range), consistent with drug-monitoring and register evaluators. (`engine/rules-engine.js`)
- **`requiresProblem` / `requiresAnyProblem` now honoured by QOF indicators (F3)**: the QOF indicator evaluator ignored both, so **DM021** (frailty-stratified HbA1c) and **DM035** (CVD secondary-prevention statin) fired for *every* diabetic, showing the wrong target. The engine now supports `requiresProblem` (all-of) and a new `requiresAnyProblem` (any-of), both negation-aware. **DM021** migrated from `requiresProblem` → `requiresAnyProblem` (moderate **or** severe frailty); **HF009** (disabled) likewise migrated for its HFrEF synonyms. (`engine/rules-engine.js`, `rules/qof-rules.json`)
- **Problem matching is negation-aware (F6)**: `excludeIfProblem` used naive `.includes()`, so "no evidence of moderate frailty" wrongly excluded a patient. It now uses `problemLabelMatchesTerm`. (`engine/rules-engine.js`)
- **STIA register matches "TIA" abbreviations (F4)**: the register used space-padded `" tia "`, missing "TIA", "post TIA", "TIA 2024", "history of TIA" → no STIA/CD001/CD002 chips. Register match terms now use word-boundary matching (`registerTermInLabel`), which matches "TIA" without false-matching "iniTIAte". (`engine/rules-engine.js`, `rules/qof-rules.json`)
- **DM register no longer false-positives on "pre-diabetic" (F5)**: added hyphenated `"pre-diabetic"` to the DM register `problemExclude`. (`rules/qof-rules.json`)
- **HRT review chip gated on co-prescribed oestrogen (F10)**: a standalone progestogen or LNG-IUS (Mirena, Levosert, etc.) used for **contraception** triggered a false "HRT BP+weight review" chip (e.g. a 25-year-old with a Mirena). The chip now fires only when a systemic oestrogen / HRT agent (estradiol, conjugated oestrogens, tibolone…) is prescribed; a co-prescribed LNG-IUS/progestogen is reported as the progestogen-coverage component instead, and duplicate HRT chips are avoided. (`engine/rules-engine.js`, `rules/drug-rules.json`)
- Added `test-qof-indicator-filters.js` (30 assertions) covering all of the above.

## [v3.19.15] — 2026-06-01
### Fixed

- **QOF chips no longer vanish on journal search — the real cause (supersedes v3.19.14)**: the side-panel snapshot was published as a *side effect* of a global monkeypatch on `window.SentinelRules.evaluatePatient`. That engine global is shared with the triage-lens HUD (`content-scripts/triage-lens/content.js:1448`, `:2092`), which re-evaluates with a **drug-rules-only** ruleset on every care-record route tick — including journal searches. Each HUD evaluation overwrote `_lastSnapshot` with QOF-less chips, so the QOF rules flashed up (from the suite's full-ruleset evaluation) then got overwritten (by the HUD's drug-only one). The v3.19.14 `_lastPatientUuid` URL guard couldn't help because triage-lens wrote the snapshot entirely outside that observer. Fix: removed the monkeypatch and made `evaluateAndPublish` capture the chips and publish them directly via a new `publishSnapshot()`, so **only** the suite's full merged drug+QOF evaluation can write the side-panel snapshot. Also added a monotonic evaluation-generation guard (`_evalGen`) so a slow/stale fetch during journal-search churn can't publish chips over a newer evaluation. (`content-scripts/sentinel.js`, `test-snapshot-bridge.js`)

## [v3.19.14] — 2026-06-01
### Fixed

- **QOF chips no longer wiped when searching the patient journal**: in suite mode the side-panel snapshot is published by the `bootDataOnly` nav watcher in `content-scripts/sentinel.js`, which invalidated the snapshot on *every* SPA URL change. A patient-journal search (and care-record tab switches / filters) updates the URL while staying on the same patient, so the watcher kept calling `invalidateSnapshot()` — blanking the panel to "Loading…" then re-evaluating — making the QOF rules "flash up briefly then get overwritten" on each keystroke. The watcher now resolves the patient UUID from the new URL (`resolveUrlPatientUuid`, mirroring `detectMedicusContext`) and, when it matches the patient last evaluated (`_lastPatientUuid`), leaves the existing chips untouched. Genuine patient changes (different or unresolvable UUID) still invalidate immediately, preserving the wrong-patient safety guard. (`content-scripts/sentinel.js`)

## [v3.19.13] — 2026-06-01
### Fixed

- **HRT progestogen context now recognises Mirena/IUS on the problem list**: `buildHrtContext` previously only searched the medications list for IUS coverage, so problem-list entries like "Introduction of Mirena coil" or "Replacement of intrauterine system" were ignored, causing the "No progestogen or hysterectomy recorded" warning to fire incorrectly. The engine now also checks the problems list using `iusProblemTerms` (new field in `hrtContext`) plus the existing `iusTerms`. (`engine/rules-engine.js`, `rules/drug-rules.json`)

## [v3.19.12] — 2026-06-01
### Fixed

- **Prediabetes / non-diabetic hyperglycaemia no longer triggers QOF diabetes monitoring**: the `qof-reg-dm` register matched the term `"diabetic"` as a substring, which caused "non-diabetic hyperglycaemia" and similar problem-list entries to be treated as diabetes register members. Added `"non-diabetic"`, `"prediabetes"`, and `"prediabetic"` to `problemExclude` in `rules/qof-rules.json`.
- **Oestrogen pessaries no longer flagged for overdue BP/weight**: the `hrt-systemic` drug rule's exclude list only matched `"vaginal pessary"` as a compound phrase. Prescriptions written as "estradiol 10mcg pessary" (no "vaginal" prefix) bypassed the exclusion. Added standalone `"pessary"` to the drug exclude list in `rules/drug-rules.json`.

## [v3.19.11] — 2026-05-31
### Removed

- **Deleted the orphaned toolbar popup**: removed `popup.html` and `popup.js` and their `web_accessible_resources` entries. The icon now opens the side panel directly via `openPanelOnActionClick` (no `default_popup`), so the popup waiting-room page was dead code. (`popup.html`, `popup.js`, `manifest.json`)

## [v3.19.10] — 2026-05-31
### Fixed

- **Restored try/catch around `importScripts` (registration safety)**: the v3.19.9 simplification dropped the try/catch that the last-known-working v3.17.2 had. Without it, an error in any imported module propagates uncaught and fails the whole service-worker registration ("status code: 2"), discarding the worker — and with it the `setPanelBehavior` line. Restored the try/catch and added the documented `onInstalled` re-assertion of `openPanelOnActionClick: true` (belt-and-braces; fires on every reload). The worker now matches the proven-working v3.17.2 structure, minus the popup. (`service-worker.js`)

## [v3.19.9] — 2026-05-31
### Changed

- **Side-panel-on-icon-click rewritten from first principles — simple and robust**: the feature is now exactly what Chrome documents and nothing more — `"side_panel": { "default_path": ... }` in the manifest (no `default_popup`) plus a single declarative line as the **first statement** of the service worker: `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`. Chrome opens the panel on icon click natively (same path as the right-click "Open side panel" menu). Removed all the accumulated complexity: the manual `action.onClicked` handler, `setPopup`, per-tab `setOptions`, the guarded wrapper function, lifecycle re-assertions, and diagnostic badges. Module `importScripts` calls remain string literals. (`service-worker.js`, `manifest.json`)

## [v3.19.8] — 2026-05-31
### Fixed

- **THE service-worker registration failure (status code 2) — dynamic `importScripts`**: v3.19.5 refactored the module loads into `[...].forEach(src => importScripts(src))`. In an MV3 service worker, `importScripts()` must be called with **string literals** — Chrome statically analyses the worker to determine its script resources, and a variable argument can't be resolved, failing the entire registration with "status code: 2" (uncatchable by the surrounding try/catch). This had been masking every other fix since v3.19.5: the worker never registered, so `openPanelOnActionClick` never took effect and the icon did nothing. Reverted to four literal `importScripts('…')` calls, each in its own try/catch. (`service-worker.js`)

## [v3.19.7] — 2026-05-31
### Changed

- **Removed the toolbar popup — clicking the icon opens the side panel directly, no popup**: now that the service worker registers correctly again (v3.19.5 fixed the status-2 crash) and asserts `openPanelOnActionClick: true` at top-level, `onInstalled`, and `onStartup` (so the persisted flag can't get stuck), the declarative icon-click → side-panel behaviour finally works. Removed `default_popup` from the manifest. One click on the icon opens the suite side panel; no popup, no chooser. (`manifest.json`)

## [v3.19.6] — 2026-05-31
### Changed

- **Restored the toolbar popup so the icon reliably does something — independent of the service worker**: re-added `default_popup: popup.html` to the manifest. The popup runs in its own page context and does not depend on the service worker registering, so clicking the icon always works. The popup now **auto-opens the side panel on load** (the icon click is a user gesture) and closes itself, so there's no chooser — it goes straight to the suite. If a Chrome build won't allow the programmatic open, the popup falls back to showing the waiting-room view with an "Open Suite" button (a fresh click gesture, which always works). (`manifest.json`, `popup.js`)

## [v3.19.5] — 2026-05-31
### Fixed

- **THE actual cause of "Service worker registration failed. Status code: 2"**: the v3.19.4 service worker called `chrome.action.setPopup({ popup: '' }).then(...)` at the top level. `chrome.action.setPopup()` does not reliably return a Promise across Chrome builds — when it returns `undefined`, `.then()` throws `TypeError` synchronously during the worker's initial evaluation, outside any try/catch. An uncaught top-level throw aborts the entire service-worker registration (status code 2), so no listeners ever registered and the icon did nothing. Rewrote the side-panel setup to: (1) sit **before** `importScripts` so a module-load failure can't affect it; (2) never assume an API returns a Promise (guard with `typeof r.catch === 'function'`); (3) never throw at the top level (wrapped in try/catch); (4) use the simple declarative `openPanelOnActionClick: true` that worked in v3.17.2, removing the `setPopup`/`setOptions`/`onClicked` surface area entirely. Also isolated each `importScripts` in its own try/catch. Verified by simulation that the worker now evaluates without throwing even when every sidePanel/action API returns `undefined`. (`service-worker.js`)

## [v3.19.4] — 2026-05-31
### Fixed

- **Root cause of "service worker registration failed (status 2)"**: `shared/request-monitor.js` and `shared/update-checker.js` both ended their IIFE with `})(typeof window !== 'undefined' ? window : global)`. In a Chrome service worker, `window` is undefined AND `global` does not exist — evaluating `global` throws `ReferenceError: global is not defined`, aborting the import and causing Chrome to mark the service worker registration as failed. Fixed both files to use `globalThis` (universally available in Chrome 71+, service workers, popup pages, and content scripts). This is why clicking the toolbar icon did nothing: the service worker never successfully registered, so no event listeners were ever active. (`shared/request-monitor.js`, `shared/update-checker.js`)
- **Also**: call `chrome.action.setPopup({ popup: '' })` explicitly on each SW start to clear any cached popup association from older builds. (`service-worker.js`)

## [v3.19.3] — 2026-05-31
### Fixed

- **Toolbar icon click: add `setOptions(enabled:true)` before `open()`** — some Chrome builds require the panel to be explicitly enabled per-tab even when `default_path` is set in the manifest. If `open()` still fails, a red `ERR` badge appears on the icon so the failure is visible without opening the service-worker inspector. (`service-worker.js`)

## [v3.19.2] — 2026-05-31
### Changed

- **Side-panel icon click switched to an explicit, observable handler**: after the declarative `openPanelOnActionClick` approach kept failing on a real install, the toolbar-icon click now uses an explicit `chrome.action.onClicked` → `chrome.sidePanel.open({ windowId })` handler, with `openPanelOnActionClick` asserted `false` at top-level and in `onInstalled`/`onStartup` so the persisted flag can't desync from the handler. Added service-worker console logging on click and open so the behaviour can be diagnosed via chrome://extensions → "Inspect views: service worker". (`service-worker.js`)

## [v3.19.1] — 2026-05-31
### Fixed

- **Toolbar icon now reliably opens the side panel (root cause fixed)**: `openPanelOnActionClick` is a flag Chrome **persists** across reloads. v3.18.3 had set it to `false`; v3.18.4 set it back to `true` but only via a single top-level call whose rejection was swallowed, so on some installs the stale `false` survived and — with no `onClicked` handler — the icon did nothing (while the native right-click "Open side panel" still worked, since that ignores the flag). The behaviour is now asserted to `true` in `onInstalled` (fires on every update/reload) and `onStartup` as well as at top-level, and errors are logged rather than swallowed, so the stale value is reliably overwritten. Reload the extension once to apply. (`service-worker.js`)

## [v3.19.0] — 2026-05-31
### Added

- **Rising HbA1c trend monitor (Sentinel, enabled by default, diabetics only)**: mirrors the eGFR/PSA trend mechanism — fires when HbA1c rises ≥10 mmol/mol across ≥3 readings within 24 months, but only for patients on the diabetes (DM) register, so it never fires for non-diabetics. Flags deteriorating glycaemic control for clinical review (adherence, lifestyle, intercurrent illness, treatment intensification per NICE NG28/NG17). The ≥10 mmol/mol rise is a pragmatic, locally-adjustable review threshold; shows `no_data` until multi-point HbA1c history exists. (`rules/qof-rules.json`)

## [v3.18.5] — 2026-05-31
### Fixed

- **Trend evidence panel now shows the underlying readings even when a trend can't fire**: previously, when fewer than `minPoints` observations fell inside the trend window (e.g. a falling-eGFR chip with only 2 readings in 24 months), expanding the chip showed a bare "insufficient data" line with no values. The evaluator now populates `trendSeries` with the readings it found — in-window if available, otherwise the most recent few from history — so the evidence panel always shows the dated values (provenance). Direction/Span are shown only when ≥2 points are available; the builder is guarded against null delta/span. Affects all `observation-trend` rules (eGFR, PSA, and any custom trend). (`engine/rules-engine.js`)

## [v3.18.4] — 2026-05-31
### Fixed

- **Toolbar icon opens side panel with a single click**: replaced the manual `action.onClicked` + `sidePanel.open()` approach (which was silently failing) with `openPanelOnActionClick: true` — Chrome's own built-in mechanism, identical to the right-click "Open side panel" menu item and the most reliable option available. (`service-worker.js`)

## [v3.18.3] — 2026-05-31
### Fixed

- **Toolbar icon now reliably opens the side panel**: after removing `default_popup` in v3.18.2 the declarative `openPanelOnActionClick` did not always open the panel (the icon appeared to do nothing). Added an explicit `chrome.action.onClicked` handler that calls `chrome.sidePanel.open({ windowId })` and set `openPanelOnActionClick: false` (required for `onClicked` to fire), so a single click opens the suite even after a service-worker restart. (`service-worker.js`)

## [v3.18.2] — 2026-05-31
### Fixed

- **Icon click no longer shows popup chooser**: removed `default_popup` from the manifest `action` object so clicking the toolbar icon directly opens the side panel via `chrome.sidePanel.setPanelBehavior`. (`manifest.json`)
- **Alert Library unlock button**: made the handler synchronous — `applyLockState()` now fires immediately on click so the disclaimer overlay and `lib-locked` CSS class are removed at once, unblocking the Add and Add All buttons without waiting for the storage write to return. (`sentinel-options/options.js`)
- **eGFR trend window extended to 24 months**: the previous 12-month window typically captured only 1-2 annual GP eGFR readings, preventing the required `minPoints: 3` from being met. Extended to 24 months so three readings are reliably available; the NICE NG203 12-month clinical criterion is unchanged — only the data-search window has been widened. (`rules/qof-rules.json`)

## [v3.18.1] — 2026-05-31
### Added

- **Custom-rule UI for `observation-alert`**: the Sentinel custom-indicator form can now author RAG-banded observation safety alerts (match terms, dangerous direction, amber/red thresholds, unit, recency window), with live engine preview and edit support — mirrors the observation-trend form. (`sentinel-options/options.html`, `sentinel-options/options.js`)

## [v3.18.0] — 2026-05-31
### Added

- **Falling eGFR trend monitor (Sentinel, enabled by default)**: fires when eGFR falls >=15 mL/min/1.73m2 across >=3 readings within 12 months for any adult (NICE NG203 accelerated CKD progression). Mirrors the Rising PSA trend mechanism; shows `no_data` until multi-point eGFR history is available. Promoted from the opt-in alert library to a shipped default. (`rules/qof-rules.json`)
- **Raised potassium / hyperkalaemia alert (Sentinel, enabled by default)**: RAG-banded alert on the latest serum potassium — amber 5.5-5.9 mmol/L (mild; exclude pseudohyperkalaemia, review contributing drugs), red >=6.0 mmol/L (moderate/severe; urgent same-day assessment + ECG, >=6.5 = emergency). NICE CKS / UK Kidney Association advice surfaced in the chip notes. (`rules/qof-rules.json`)
- **New `observation-alert` check kind** in the rules engine: a clinical-safety threshold that reads the latest matching observation and fires amber/red bands (via `caution`/`alert` statuses), returning no chip when the value is in the safe range, stale, or absent — so safety thresholds don't add green-"MET" noise like QOF achievement indicators. (`engine/rules-engine.js`, `shared/io/sentinel-io.js`)

## [v3.17.3] — 2026-05-31
### Added — Falling eGFR trend sentinel library rule (NICE NG203)

- **Falling eGFR trend (Sentinel alert library)**: new `trend-2` library rule mirroring the Rising PSA trend — fires when eGFR falls ≥15 mL/min/1.73m² across ≥3 readings within 12 months (NICE NG203 accelerated CKD progression). Importable from the Sentinel options Alert Library; uses the existing `observation-trend` engine, so no code changes. Shows `no_data` until multi-point eGFR history is available. (`rules/alert-library.json`)

## [v3.17.2] — 2026-05-30
### Fixed — Wire the extraction-health canary to the side panel + invalidate stale snapshots (H-005, clinical safety)

The v3.17.0 silent-failure canary (`assessExtractionHealth`) was only consulted
by the **in-page HUD** renderer (`renderGroupedChips`), which suite mode never
mounts — the side panel boots via `bootDataOnly()`. So on the surface clinicians
actually use, a Medicus DOM/API drift that extracted nothing still rendered the
benign **"No chips for this patient"** — exactly the false "all clear" H-005 was
written to prevent. Two fixes:

- **Canary now reaches the side panel.** `evaluateAndPublish` computes
  `assessExtractionHealth` and the snapshot bridge stamps a `degraded`/`reason`
  flag onto the snapshot the side panel reads. The Sentinel side-panel module
  now renders a prominent **"⚠ Couldn't read this record"** warning for a
  degraded snapshot instead of a benign empty state.
- **Stale snapshots are invalidated.** `_lastSnapshot` previously updated *only*
  on a successful evaluation, so a thrown fetch/rules-load (the swallowed
  `catch` paths) left the **previous patient's** chips in place — and the panel
  rendered them with no patient-identity guard (wrong-patient risk on
  navigation). The snapshot is now invalidated the instant the SPA navigates and
  whenever an extraction fails; the panel treats an invalidated snapshot as
  "refreshing", never as data.

New pure helper `classifySnapshot` in the side-panel module with
`test-sentinel-panel-state.js` (10 assertions) guarding that a degraded or
invalidated snapshot can never be classified as renderable data. `docs/HAZARD-LOG.md`
H-005 updated with mitigations (g)/(h) recording that the canary now reaches the
side panel and the wrong-patient/stale-snapshot guard.

## [v3.17.1] — 2026-05-30
### Changed — Tighten `web_accessible_resources` exposure (security hardening)

Removed `<all_urls>` from the `web_accessible_resources` `matches` array in
`manifest.json`, leaving only `https://*.medicus.health/*`. The extension's
content scripts only run on `medicus.health`, and the suite's own pages
(options, side panel, pop-out, visualiser) load these resources from the
extension origin — which is not subject to `web_accessible_resources` matching
— so the `<all_urls>` entry granted no needed access. Dropping it stops any
arbitrary web origin from probing for these bundled resources (a fingerprinting
surface), without changing behaviour on Medicus pages.

## [v3.17.0] — 2026-05-30
### Added — Silent-failure detection + defaults-integrity tooling (continuous improvement)

**Extraction health check (turns silent failure into a visible warning — H-005).**
When the Sentinel panel renders zero results on a *live patient view* where a
patient was identified but nothing at all could be extracted (no medications,
problems, observations, or demographics — the signature of a Medicus DOM/API
change), it now shows a prominent **"⚠ Couldn't read this record"** warning
instead of the benign "No active alerts" — explicitly stating this is *not* an
"all clear" and to verify in Medicus. The decision is a pure, unit-tested helper
`assessExtractionHealth` (`content-scripts/sentinel.js`); a genuinely sparse
record (which still has demographics) is not flagged. New `test-extraction-health.js`
(10 assertions). A companion weekly **extraction-drift canary** scheduled task
was added (`.claude/scheduled-tasks/weekly-extraction-canary.md`).

**Triage Lens defaults — 3-copy integrity (removes a recurring footgun).**
- New `scripts/regen-defaults.js` regenerates the two *derived* copies
  (`content-scripts/triage-lens/defaults.json` and the `EMBEDDED_DEFAULTS`
  literal) from the source-of-truth root `defaults.json`, with a `--check` mode.
  This ends hand-editing of the embedded literal (the backslash-doubling that
  has caused regen bugs).
- `test-triage-defaults.js` now also pins the **root `defaults.json`** (previously
  untested despite being the copy loaded at runtime) and runs the regen `--check`.
- New CI **`.github/workflows/test.yml`** runs the full suite + the defaults
  `--check` + syntax checks on every push/PR and fails closed — making the
  "release gating runs the test suite" control in the safety case actually true
  (the release workflow previously built/released without running tests).
- The release build now excludes `scripts/` and `.claude/` from the shipped zip.

## [v3.16.0] — 2026-05-30
### Added — Custom Alert Builder live preview: all five rule types (Phases 2–5)
Completes the engine-backed live preview started in v3.15.0. The editable
mock-patient + real-engine preview (and validate-on-save via `validateCustomRule`)
now cover **every** Sentinel rule type:
- **drug-combo** and **event-count** — new preview wired via a shared
  `wireFormPreview` helper (mock panel + delegated, debounced re-evaluation).
- **qof-indicator** — replaced the cosmetic preview with the real engine across
  all four `check.kind` branches; a new `ciGetFormRuleFull` assembles the
  observation-trend check (previously only built at save time) so trend rules
  preview correctly.
- **composite** — preview resolves the **referenced child rules** (cached when
  the rule selector builds) and passes them to the engine, so an AND/OR
  composite shows whether it fires given its children.

The **"Auto-fill from rule"** seeder now understands every type — including
event-count (seeds N+1 events in the window), qof thresholds/recency/trend
(seeds crossing values / a trending series), and composites (seeds from the
child rules) — so one click produces a firing example.

All five save handlers now route through the shared `validateCustomRule`
(replacing hand-rolled checks), and the removed cosmetic status dropdowns are
gone. `test-alert-builder.js` now covers the full form-object → validate →
engine-fires round-trip for all five types (18 assertions, incl. composite
AND-firing); full suite passes.

### Docs — Clinical safety case synchronised to v3.16.0
Updated the safety case (`docs/HAZARD-LOG.md` → v3.2, `docs/CLINICAL-SAFETY-NOTICE.md`
→ v3.2, `docs/INTENDED-PURPOSE.md` → v3.16.0) to cover this session's
safety-relevant changes: new hazard **H-019** (Triage Lens record-panel STOPP/START
prescribing prompts, Pharmacy First signposting, risk-tool signpost links); H-002
updated for the v3.12.1 applicability-filter fail-open fix (prevents silent
suppression of demographic-gated safety alerts) + sturdier patient-context
extraction + the added Dementia register; H-003/H-004 updated for the five rule
types and the engine-backed live-preview / validate-on-save controls; H-007
extended to the new prompt surfaces; test count refreshed.

## [v3.15.0] — 2026-05-30
### Added — Custom Alert Builder: engine-backed live preview (Phase 1 of 5)
The Sentinel custom-rule builder (`sentinel-options/`) gains a **real
"would this fire?" preview** driven by the actual exported engine
(`SentinelRules.evaluatePatient`) — the same function the runtime uses — instead
of the previous cosmetic chip render. New shared infrastructure (reused by the
remaining rule-type forms in later phases):
- An **editable mock patient** panel (medications / observations / problems /
  age / sex / "as of" date) with an **"Auto-fill from rule"** button that seeds a
  firing example from the rule under construction.
- `runEnginePreview` / `renderEnginePreview` show **fire / no-fire + the engine's
  own evidence** (status, summary, facts), so parity with production is guaranteed.
- **Live validation**: the preview and Save now both route through the shared
  `validateCustomRule`, surfacing schema errors inline instead of the old
  hand-rolled checks.

This phase wires it into the **drug-monitoring** form (the engine `<script>` is
now loaded in the builder page). The other four rule types reuse the identical
infrastructure in subsequent phases. New `test-alert-builder.js` (7 assertions)
pins the form-object → validate → engine-fires round-trip and the documented
mock-patient parse shape.

## [v3.14.0] — 2026-05-30
### Added — STOPP/START prescribing flags + risk-tool signposting
Two competitor-gap "quick wins" from the EMIS/SystmOne market review.

**STOPP/START-style prescribing-safety flags** (record MEDS tile). A new
deterministic, pure `evaluatePrescribingFlags(meds, age)` helper adds review
prompts for well-established, low-false-positive medication combinations:
- **NSAID + anticoagulant** (or antiplatelet) — GI bleed risk
- **Triple whammy** — NSAID + ACEi/ARB + diuretic — AKI risk (PINCER/STOPP)
- **Benzodiazepine / Z-drug in age ≥80** — falls & sedation (STOPP)

Detection is medication-name based (topical NSAIDs are excluded), age-gated only
where the threshold is known, and surfaced via a new amber `record.stoppStart`
header chip. Worded as review prompts — decision support, verify against record.

**Risk-tool signpost chip** (`record.riskScores`, info). On adult records
(age ≥25) a "Risk tools" chip offers one-click links to the official **QRISK3**,
**QCancer**, and **eFI** calculators plus a note listing the inputs each needs.
Deliberately **signpost-only** — Medicus does not compute the scores (the
extractors can't supply cholesterol ratio / smoking / ethnicity, and an
unvalidated reimplementation would be a medical-device concern).

Added `test-prescribing-flags.js` (15 assertions, vm-extracted pure helper):
fires on the real combinations, ignores topical NSAIDs, respects the anticoag>
antiplatelet precedence, the age-≥80 gate (incl. unknown age), and clean lists.
Updated all three synced defaults copies; drift guard + full suite pass.
SNOMED code-suggestion actions were dropped from the roadmap.

## [v3.13.0] — 2026-05-30
### Added — Pharmacy First signposting across all 7 clinical pathways
Triage Lens now signposts to NHS Pharmacy First (England) for every one of the
seven national clinical pathways, addressing a competitor gap (PATCHS/Klinik
signpost lower-acuity demand away from GP slots).

- Added a **NHS Pharmacy First link + an eligibility/safety-net referral
  snippet** to the three existing matching rules: `uti`, `sore-throat`,
  `otitis`. Snippets state the pathway's age/sex gateway ("if eligible") and
  red-flag safety-netting — they assert *consideration*, not eligibility, since
  the patient's age/sex can't always be read.
- Added **four new amber detection rules** for the previously-uncovered
  pathways, each with the same Pharmacy First actions:
  - `sinusitis` — acute sinusitis (age 12+)
  - `insect-bite` — infected insect bite (age 1+)
  - `impetigo` — impetigo (age 1+)
  - `shingles` — shingles / herpes zoster (age 18+)

All four ship with lay + clinical detection patterns, verified against a
match/no-match spot-check (e.g. does not fire on "sinus rhythm", "my dog bit
me", or "crusty cough"). Updated all three synced defaults copies
(`defaults.json`, `content-scripts/triage-lens/defaults.json`,
`EMBEDDED_DEFAULTS`); drift guard and full suite pass.

(SNOMED code-suggestion actions were scoped out of this release.)

## [v3.12.1] — 2026-05-30
### Fixed — Applicability filters silently suppressed alerts on unknown demographics
A user reported the MHRA valproate alert never firing (even after pasting the
exact drug string into the rule's match list) and QOF rules "not firing at all."

**Root cause:** v3.1.8 ("applicability filter audit") made the engine start
*enforcing* `sex`/`ageRange` filters that were previously ignored — but
`passesAgeFilter`/`passesSexFilter` failed **closed** when the patient's age or
sex couldn't be determined. Patient sex/age are scraped from the page
(`patient-context.js`) and are frequently `null` depending on the record
layout, so any rule with a sex/age gate (e.g. valproate = female 12–55, and the
age-gated QOF indicators) silently never fired. For a red teratogenicity alert,
failing closed on *unknown* sex is the dangerous direction.

**Fixes:**
- `engine/rules-engine.js` — `passesAgeFilter`/`passesSexFilter` now **fail
  open** on unknown demographics: they exclude only when the patient is
  *positively known* to be out of scope. A known male still won't get the
  valproate alert; a patient whose sex/age can't be read now will (clinician
  verifies applicability).
- `engine/extractors/patient-context.js` — sturdier extraction: sex is now read
  from a labelled "Sex/Gender: …" field (dedicated element → patient-info text →
  whole-page fallback), and age falls back to an explicit "Age: 35"/"(35y)"/
  "35 yrs old" token and a page-wide DOB scan when the info container has none.
- `rules/qof-rules.json` — added the **Dementia (DEM) QOF register** (it was
  never shipped; the user's dementia example couldn't fire for that reason).

Added `test-applicability-filters.js` (16 assertions) covering fail-open on
unknown sex/age, correct suppression for *known* out-of-scope patients, the new
dementia register, and the patient-context extraction fallbacks. Full suite
passes.

## [v3.12.0] — 2026-05-30
### Improved — Triage Lens base rule detection (much higher recall)
Substantially expanded the detection phrases for all 20 built-in Triage Lens
rules so the baseline capture is far stronger on real, lay, patient-written
request text. Total shipped patterns grew from **106 → 620** (~5.8×).

For each rule we added: lay/patient phrasings ("water infection", "my back
hurts", "worst headache of my life"), clinical synonyms, common abbreviations
(SOB, COPD, MTX, DOAC, AOM), British **and** American spellings
(melaena/melena, haematemesis/hematemesis, oestrogen/estrogen,
anaesthesia/anesthesia), medication brand names (Eliquis, Xarelto, Pradaxa,
Priadel, Metoject, Evorel, Oestrogel…), common misspellings, and
hyphen/space variants.

Precision was preserved alongside recall:
- Rules that needed safe abbreviations or word-boundary control were switched
  from plain-text to `regex` mode, with every existing pattern rewritten to
  keep its original stem behaviour (e.g. `cough` → `cough\w*`,
  `depress` → `depress\w*`) — so the trailing word boundary can't silently
  drop suffix matches.
- Fixed the long-standing `fit-note` "med ?3" pattern that, in plain-text
  mode, never actually matched "med3"/"med 3" (the `?` was treated literally);
  it now uses `med[- ]?3`.
- `UTI` is now `\bUTI\b` (regex) so it no longer mis-fires on "utility";
  `repeat-meds` "out of my" now uses a negative lookahead so it captures
  "out of my amlodipine" but not "out of my mind"; `post-discharge` drops the
  bare noun "discharge" (kept "discharged" + "discharge summary") so it no
  longer fires on "vaginal/ear discharge"; assorted over-broad stems removed
  (`my back`, `irritab\w*`, accidental-injury phrasings in mh-crisis).

Every rule's new patterns were generated with per-rule expansion and then
gated by an automated harness (compiling patterns exactly as `content.js`
does) against `shouldMatch`/`shouldNotMatch` controls — **0 compile errors,
0 control failures** across ~90 assertions. All three synced copies
(`defaults.json`, `content-scripts/triage-lens/defaults.json`, and the
`EMBEDDED_DEFAULTS` fallback) were regenerated together; the drift guard
(`test-triage-defaults.js`) and full test suite pass.

## [v3.11.1] — 2026-05-30
### Fixed — Bug-bash findings (verified)
A parallel code audit (8 fast-model sweeps, verified by review) surfaced a
handful of real bugs; the rest were false positives. Fixes:

- **Capacity backup — merge import dropped settings (data loss).** A
  `merge: true` import early-returned after writing presets, silently discarding
  `activePresetId`, `viewMode`, and `showWeekends`. The merge path now falls
  through and persists all scalar settings. (`shared/io/capacity-io.js`)
- **Side panel — display popover leaked document listeners.** Each
  re-render of the display popover (including every in-popover click) added a new
  `document` click handler that was only removed on an outside click. Now tracked
  in a single module-level ref and removed before re-adding. (`side-panel/panel.js`)
- **Service worker — unhandled startup rejections.** `onInstalled` /
  `onStartup` fired async init tasks (`runMigration`, `initialiseRequestMonitor`,
  `initialiseUpdateChecker`) without `.catch()`, so storage failures were
  silently swallowed. Wrapped each in a `runStartupTask` guard that logs
  failures. (`service-worker.js`)
- **Submissions — "NaNd" subtitle.** `daysBetween()` returned `NaN` when a
  date `<input>` was cleared; now guarded. (`side-panel/modules/submissions/submissions.js`)
- **Capacity — null deref on "copy Mon".** `querySelector('input[data-day="mon"]').value`
  had no null check; now optional-chained with an early bail.
  (`side-panel/modules/capacity/capacity.js`)
- **Triage Lens — drag handler lingered on lost mouseup.** If a HUD drag was
  interrupted by an alt-tab (no `mouseup`), the `mousemove` listener stayed live
  and the HUD jittered on later mouse moves. Drag now also ends on window `blur`
  and tears down all transient listeners. (`content-scripts/triage-lens/content.js`)
- **Triage Lens — removed dead `injectTaskListInterceptor` no-op** and its two
  call sites (left over from the MAIN-world `page-world.js` refactor).
  (`content-scripts/triage-lens/content.js`)
- **Referrals — removed dead no-op line** in the `last3m` date preset
  (`end.setMonth(end.getMonth())`); range was already correct.
  (`shared/referrals-api.js`)

Notable **false positives** dismissed during verification: a hallucinated
16-site Visualiser XSS class (the `esc()` helper is applied everywhere), an
"inverted" QOF trend status (correct by design), and a request-monitor backup
"asymmetry" (symmetric in practice).

## [v3.11.0] — 2026-05-30
### Removed — Document-context lens (dead feature)
Removed the Triage Lens **document-context lens** in full — the v3.8.0 lens
(`detail.docEntries` / `detail.docUrgent` / `detail.docAction` chips fed by the
`/clinical/document/entries/` + `/document/modals/version/preview/`
interceptor) **and** the v3.9.0 PDF body-extraction pipeline built on top of it.
The whole feature is gone. The separate, DOM-sourced document **metadata** chips
(`detail.docType`, `detail.docSpecialty` — read from the document task card in
`extractDocumentTaskInfo`, not via any interceptor) and the queue monitoring
chips are unaffected.

- **Chips removed:** `detail.docEntries` (info, "Filed notes ×N"),
  `detail.docUrgent` (red), `detail.docAction` (amber) — from `defaults.json`,
  `content-scripts/triage-lens/defaults.json`, the embedded defaults and the
  settings catalogue. (`content-scripts/triage-lens/content.js`,
  `content-scripts/triage-lens/options.js`)
- **Content-script logic removed:** `_docCtx` state, the `ch-doc-entries`
  listener, `runDocContextChips`, the `injectDocContextInterceptor` stub and its
  init call, plus the v3.9.0 body machinery (`requestDocPdfText`, the
  covering-message text matching, `DOC_URGENT_RE` / `DOC_ACTION_RE` and the
  negation guard). (`content-scripts/triage-lens/content.js`)
- **PDF pipeline removed:** the offscreen document (`offscreen.html` /
  `offscreen.js`), the service-worker `sentinelDocPdfText` handler and its
  offscreen helpers, the `offscreen` manifest permission, and the offscreen
  web-accessible resources. (`service-worker.js`, `manifest.json`)
- **Interceptor narrowed:** `page-world.js` now intercepts **only** the queue
  `/tasks/data/{slug}/task-list` endpoint (`ch-task-list-data`); all
  document-context interception (`ch-doc-entries` / `ch-doc-preview`,
  `handleDoc`, the entries/preview regexes) is removed.
  (`content-scripts/triage-lens/page-world.js`)
- **Scratch files removed:** `doc-body-plan.md`, `doc-body-probe2.js`,
  `doc-body-discovery.js`.
- No `chrome.storage` keys, `shared/io/*` files, or backup envelopes were
  involved (the feature was deliberately ephemeral), so suite backups are
  unaffected. `vendor/pdf.min.js` / `pdf.worker.min.js` are retained — still
  used by the Patient Record Visualiser.

## [v3.10.0] — 2026-05-30
### Fixed — Network interceptors blocked by Medicus CSP (the real root cause)
- **This is why the queue monitoring chips and document-context lens never
  worked.** Both relied on wrapping `window.fetch`/`XMLHttpRequest` by injecting
  an inline `<script>` element from the isolated content script — but Medicus
  ships a strict Content-Security-Policy (`script-src 'self'`, no
  `'unsafe-inline'`), so the browser **blocked every inline-script injection**.
  The interceptors never installed; no task-list or document data was ever
  captured (the side-panel Monitoring module was unaffected — it uses a
  different data path). The earlier fetch-vs-XHR fixes (v3.9.3 / v3.9.4) were
  correct but moot because nothing was injecting at all.
- **Fix:** the interceptors now live in a dedicated `page-world.js` registered as
  a **`"world": "MAIN"` content script** (run_at `document_start`). The browser
  injects MAIN-world content scripts itself, so they run in the page's JS context
  **exempt from the page CSP**, and communicate back to the isolated content
  script via the same `ch-task-list-data` / `ch-doc-entries` / `ch-doc-preview`
  `CustomEvent`s. One file now wraps both fetch and XHR for both the queue
  task-list and the document-context endpoints. (`content-scripts/triage-lens/page-world.js`, `manifest.json`)
- The old `injectTaskListInterceptor` / `injectDocContextInterceptor` inline
  injectors in `content.js` are now no-ops (kept as named functions so existing
  call sites are harmless), which also removes the CSP-violation console spam.

## [v3.9.4] — 2026-05-30
### Fixed — Queue task-list interceptor now wraps XHR (superseded by v3.10.0)
- Rewrote `injectTaskListInterceptor` to wrap both `window.fetch` and
  `XMLHttpRequest` (Medicus loads the task list via Axios/XHR), read rows from
  `body.tasks`, and extract the task UUID robustly. Note: this was still injected
  inline and so remained CSP-blocked until v3.10.0 moved it to a MAIN-world
  content script. (`content-scripts/triage-lens/content.js`)

## [v3.9.3] — 2026-05-30
### Fixed — Queue monitoring chips never appeared (task-list never captured)
- The queue monitoring overlay captured task-row UUIDs by wrapping `window.fetch`
  only — but Medicus loads the task list via **Axios (XMLHttpRequest)**, so the
  task-list response was never seen, `ch-task-list-data` never fired, and no
  queue chips were ever injected (the side-panel Monitoring module worked because
  it uses a different data path). The interceptor now wraps **both** `window.fetch`
  AND `XMLHttpRequest`, mirroring the document-context interceptor. (`content-scripts/triage-lens/content.js`)
- It also now reads the rows from `body.tasks` (the actual Medicus task-list
  array key) in addition to `data`/`results`/`rows`/bare-array, and extracts the
  task UUID robustly (known `taskUuid`/`taskId`/`uuid`/`id` keys first, then a
  guarded scan of task/id-ish keys, never a patient id). Diagnostic `console`
  logging is emitted if the array or a row UUID can't be found, so any remaining
  shape mismatch is visible.
- The interceptor is now installed **early at content-script init** (not only in
  `runQueue`), because the task-list XHR fires during SPA navigation into the
  queue before `runQueue` runs — same fix already applied to the document-context
  interceptor. Idempotent via the `window.__chIntercepted` page-world guard.

## [v3.9.2] — 2026-05-30
### Changed — Monitoring overlays now flag "no monitoring on record" (red)
- A high-risk drug with **no recognised monitoring tests on record at all**
  (engine status `no_data`) is now surfaced as a **red** monitoring chip, across
  the queue, detail, and record overlays. Previously `selectMonitoringDue` only
  counted substantiated `overdue`/`stale`/`due_soon` and silently dropped
  `no_data`, so e.g. a patient on leflunomide with no FBC/U&E/LFT we could find
  produced no chip — arguably the most concerning case. (`content-scripts/triage-lens/content.js`)
- **Honest wording (no false "overdue"):** the per-drug detail names the
  *specific* tests with no value on record — e.g. *"Leflunomide — no recent BP,
  Weight"* — rather than a blanket "no bloods". This matters because some rules
  (leflunomide wants BP + weight, lithium wants TFT/calcium) include tests a
  practice may simply not code, so a patient with perfect FBC/U&E/LFT but no
  coded weight is described accurately instead of being mislabelled. Bare chips
  with no per-test breakdown fall back to "no monitoring on record".
- DMARDs covered by the monitoring ruleset: methotrexate, leflunomide,
  hydroxychloroquine, azathioprine, sulfasalazine (plus lithium, amiodarone,
  carbimazole/PTU, and others — 19 rules total in `rules/drug-rules.json`).
- Tests updated to lock the new behaviour: `no_data` now counts toward the chip,
  is always red, and its detail names only the missing tests. (`test-monitoring-chip.js`, 20 passing)

## [v3.9.1] — 2026-05-30
### Fixed — Triage Lens settings showed no options for newer chips
- Both the Triage Lens settings page and the content script fetch their chip
  defaults via `chrome.runtime.getURL('defaults.json')`, which resolves to the
  **extension-root** `defaults.json` — not `content-scripts/triage-lens/defaults.json`.
  The root copy had silently drifted (28 chips vs 35) across several releases
  because the drift test only guarded the triage-lens copy. As a result the
  settings page read stale defaults missing the document-context chips
  (`detail.docEntries/docUrgent/docAction`), the queue monitoring chips
  (`queue.monitoringDue*`), and `detail.docType/docSpecialty`. Synced the root
  copy to the canonical version and extended `test-triage-defaults.js` to assert
  the two stay identical (now 8 checks).
- **Document-body PDF request never fired:** `requestDocPdfText` referenced a
  bare `API` symbol that wasn't in scope (it is `window.SentinelApiClient`), so
  `detectMedicusContext` was never called and the request silently bailed. Now
  resolves `API` from `window.SentinelApiClient`, matching the queue path.

## [v3.9.0] — 2026-05-30

### Added
- **Triage Lens — document-body PDF text extraction (Phase 2).** Completes the
    body-extraction phase begun in v3.8.0 (Phase 1, phased rollout): the document
    body is downloaded as a server-converted PDF and parsed with PDF.js to extract
    its prose, which is fed into the EXISTING `detail.docUrgent` (red) and
    `detail.docAction` (amber) chips. No new chips were added — this is purely a
    new text source for the existing two.
  - **Architecture:** PDF.js runs in an MV3 **offscreen document**
    (`offscreen.html` / `offscreen.js`, reason `WORKERS`) because the service
    worker cannot run PDF.js reliably. The service worker resolves the file UUID
    via the document overview endpoint, downloads the PDF from the same Medicus
    api host the page already uses, forwards the bytes to the offscreen document
    for extraction, then closes the offscreen document.
  - **Default OFF / opt-in:** the PDF is fetched and parsed only when at least
    one of `detail.docUrgent` / `detail.docAction` is enabled (both default off).
  - **Ephemeral & private:** PDF bytes and extracted text live only transiently in
    the service worker / offscreen document / content-script `_docCtx`; they are
    never written to `chrome.storage` or any backup, and never leave the browser.
    Staleness-token guarded and bound to the current document (cleared on
    navigation) so prose from one document can never match on another.
  - **Graceful degradation:** scanned / image-only PDFs with no text layer, or
    documents whose server-side conversion is still pending/failed, yield no text
    and therefore no chip (never a false "all clear").

## [v3.8.0] — 2026-05-30
### Added — Document-context lens (Phase 1 of a phased rollout)
Triage Lens now surfaces the cheap JSON text already loaded when a GP opens a
document task (`/tasks/data/document/overview/{taskUuid}`), as HUD chips. This
is **Phase 1**: it uses only the data the Medicus SPA already fetches — the
filed care-record entries (`/clinical/document/entries/`) and the electronic
covering message (`inboundMessage` from `/document/modals/version/preview/`).
Extracting the document *body* PDF (`download-file`) needs PDF.js and is a
deliberate later phase — not touched here.

- New page-world interceptor `injectDocContextInterceptor()` passively wraps
  both `window.fetch` AND `XMLHttpRequest` (the document calls come through
  Axios/XHR, so a fetch-only wrapper would miss them) and re-dispatches the JSON
  text back to the content script as `ch-doc-entries` / `ch-doc-preview`
  CustomEvents. Guarded by `window.__chDocIntercepted`; installed once, early at
  init (the XHRs fire during SPA navigation into the document, before
  `runDetail`). No new network calls; nothing leaves the browser; the combined
  text is held only in an ephemeral in-memory variable and is never persisted to
  chrome.storage or any suite backup.
- Three new system chips (`detail.docEntries`, `detail.docUrgent`,
  `detail.docAction`), configurable in Triage Lens settings:
  - **Filed notes ×N** (info) — defaults **on**; purely descriptive, reflects
    coding already filed by the GP.
  - **Urgent: …** (red) and **Action: …** (amber) — both default **OFF**
    (opt-in), keyword-matched with a negation guard ("no", "not", "denies",
    "ruled out", etc.) to reduce false positives against the GP's own coding.
- Staleness token guard applied before any chip is injected to prevent
  wrong-document / wrong-patient display. If no text is available, no chip is
  shown (never a false "all clear").

## [v3.7.2] — 2026-05-29
### Fixed — Code-review fixes: document task lens + queue monitoring chips
**Document task lens (7 fixes):**
- `extractDocumentTaskInfo.getCardText` now delegates to the shared `findCardByTitle` helper (handles both `.m-card-v2` and legacy `.m-card`); previously the private selector returned empty strings on newer card markup
- `field()` now uses a line-anchored regex instead of `indexOf` — prevents `'Type'` matching `'Document Type'` or `'Author'` matching `'Authorisation'` mid-string
- `codes` extraction replaced lazy `[\s\S]*?suggestions` glob (could over-strip real coded items) with line-by-line `^…` replacements using the `m` flag
- Author-strip regex in `comments` now uses `^…` (multiline) anchoring and allows hyphens/apostrophes (`O'Brien`, `Al-Hassan`); also prevents false-positive matches on capitalised clinical terms followed by `•`
- `pageReady` now includes `findCardByTitle('Document Details')` — the most document-task-specific card and the most reliable render-complete signal
- Chip ordering when `detail.docType` is disabled: replaced `splice(1,0,...)` with a batch `unshift(...newChips)` so specialty chip always lands at position 0 when docType chip is suppressed

**Queue monitoring chips (8 fixes):**
- **Critical:** `refreshQueueChips` now calls `scheduleQueueMonitoring()` after each redecoration — previously AG Grid row recycling on scroll permanently destroyed monitoring chips
- **Critical:** `scheduleQueueMonitoring` now uses a generation counter (`_queueMonGeneration`) — when new task-list data arrives while a run is in progress, the running loop detects the stale generation and a fresh run starts on completion (previously new-data events were silently dropped)
- **Critical:** `runQueue` now clears `_queueRowUuids` before setting up the new queue, and prunes cache entries older than 2×TTL — prevents stale UUIDs from a previous queue injecting chips onto wrong rows
- `injectTaskListInterceptor` guard now relies entirely on `window.__chIntercepted` (the DOM `data-ch-interceptor` attribute was never matchable after immediate `s.remove()`); adds `{once:true}` `beforeunload` handler to clear the flag on SPA navigation that resets `window.fetch`
- UUID extraction now prefers `item.uuid` and `item.taskId` before `item.id` to avoid numeric surrogate-key false-positives; UUID regex anchored with `^…$`
- `_queueMonCache` entries now carry a `ts` timestamp; `scheduleQueueMonitoring` treats results older than 5 minutes as stale (forces recompute); `runQueue` prunes entries older than 10 minutes
- `computeQueueRowMonitoring` now logs each silent-failure path via the existing `log()` helper, making debugging possible when chips don't appear
- `clone.json().catch()` now logs a warning instead of swallowing parse errors silently

## [v3.7.1] — 2026-05-29
### Added — Triage Lens queue monitoring chips via fetch intercept
- Per-row **monitoring chips** on the AG Grid task queue, surfacing high-risk drug monitoring that is overdue (red) or due soon (amber) directly on each queue row. (`content-scripts/triage-lens/content.js`)
- Because AG Grid's JavaScript data model is opaque across the isolated-world boundary, row UUIDs are captured by injecting a page-world `<script>` element that intercepts `window.fetch` and watches for `/tasks/data/{slug}/task-list` responses; it fires a `CustomEvent('ch-task-list-data')` with the row UUIDs and task-type slug back to the content script.
- `runQueue` now calls `injectTaskListInterceptor()` (installs once per page load) and `scheduleQueueMonitoring()` (processes up to 8 rows per load with 200ms spacing). Results are session-cached per patient UUID so re-renders don't re-fetch.
- Two new system chips — `queue.monitoringDueRed` and `queue.monitoringDueAmber` — default **off** (these trigger a network request per row; users opt in via Options › System chips). (`content-scripts/triage-lens/defaults.json`, `content-scripts/triage-lens/options.js`)
- `refreshQueueChips` now also removes `.ch-q-mon` elements when AG Grid recycles rows, preventing stale chips on recycled row nodes.

## [v3.7.0] — 2026-05-29
### Added — Triage Lens document task lens
- The Triage Lens HUD now correctly extracts context from document task pages (`/tasks/data/document/overview/{UUID}`), which have a different card layout to regular tasks. (`content-scripts/triage-lens/content.js`)
- Introduced `isDocumentTask()` (URL test) and `extractDocumentTaskInfo()` which reads the four relevant `.m-card` elements: "Task Overview" (status/priority/created), "Document Details" (type/date/author/specialty), "Codes & Actions" (GP-coded items), and "Internal Comments" (admin routing notes).
- `runDetail` now branches on `isDocumentTask()`: document tasks use the new extractor to build `taskDetails` and `initialReq` from document metadata + internal comments + coded items; regular tasks continue to use the existing `extractTaskDetails` / `extractInitialRequest` path.
- Two new system chips — `detail.docType` (document type, e.g. "Clinical letter") and `detail.docSpecialty` (clinical specialty or sender) — are surfaced on document task HUDs, configurable in Options › System chips. (`content-scripts/triage-lens/defaults.json`, `content-scripts/triage-lens/options.js`)
- `pageReady` now also waits for the "Task Overview" card so document task pages are not polled prematurely.

## [v3.6.0] — 2026-05-29
### Added — Triage Lens "Monitoring due" overlay chip
- The Triage Lens HUD now surfaces a configurable **"Monitoring due"** chip on single-patient views (record / detail only — never the queue), flagging high-risk-drug monitoring that is overdue, severely overdue, or due soon, with what tests and how overdue. Click the chip for a per-drug breakdown. (`content-scripts/triage-lens/content.js`)
- The chip reuses the **Sentinel drug-monitoring engine** end to end: it calls `window.SentinelDataFetcher.fetchPatientData` and `window.SentinelRules.evaluatePatient` against the canonical `rules/drug-rules.json` and computes nothing clinical itself — it only filters the engine's `drug-monitoring` chips (status `overdue`/`stale`/`due_soon`) and formats them. Red when anything is overdue/severely overdue, amber when only due-soon.
- Toggleable per page/severity via four new system chips (`record`/`detail` × Red/Amber) that appear in **Options › System chips** with enable toggles; disabling a chip stops it fetching. (`content-scripts/triage-lens/defaults.json`, `content-scripts/triage-lens/options.js`)
- **Safety:** the chip is decision-support only — it reflects the rules engine's computed statuses from real observation data, ends every detail listing with "Decision support — verify against the record.", and emits NO chip if Sentinel is unavailable, the fetch fails, or there is no usable data (never a false "all clear", never a false "overdue"). An async staleness guard discards any result whose patient/page changed during the fetch, so a chip is never shown against the wrong patient.
## [v3.5.0] — 2026-05-29
### Added — Patient-record viewer LTC features
- **Monitoring-due card (Snapshot)**: surfaces high-risk drugs whose monitoring is overdue, with the required tests and the last monitoring date — showing "No record" in red where none is held (never invented) — or a green "all up to date" when nothing is due. (`visualiser-core.js`, `visualiser-core.html`)
- **Contacts calendar heatmap (Timeline)**: a year × month grid of dated consultation contacts using a colour-blind-safe single-hue Blues ramp, native cell tooltips, a legend, and an empty state; reuses the existing `computeTimeline` aggregation. (`visualiser-core.js`, `visualiser-core.html`)
- **Multimorbidity + Charlson Comorbidity Index (Snapshot)**: a Comorbidity card showing the LTC-register count and a flat-weight Charlson index (with the standard decade age banding and a negation guard against family-history / "no evidence" mentions); flags "age unknown" rather than assuming an age. (`visualiser-core.js`, `visualiser-core.html`)
- **Condition summary cards (Recalls)**: per-register cards for analyte-bearing conditions (diabetes/HbA1c, hypertension/systolic BP, CKD/eGFR) showing the latest tracked value, a mini-trend sparkline, the target, an on/off-target chip, and a shared review-due badge — or "no recent value" when no dated result exists. (`visualiser-core.js`, `visualiser-core.html`)
- Safety: all four features are deterministic and keyword-derived display-only decision-support; they flag missing inputs ("No record" / "no recent value" / "age unknown") instead of inventing clinical values, and the Charlson index carries no mortality-percentage mapping.

## [v3.4.2] — 2026-05-29
### Changed — Slots page number polish
- Aligned the Slots module's numeric styling with the rest of the suite: `font-variant-numeric: tabular-nums` is now set on every numeric class (hero total, AM/PM chips, per-type and per-clinician breakdowns), so digits sit in fixed-width columns. (`side-panel/modules/slots/slots.css`)
- Widened numeric column `min-width`s so 3-digit counts no longer break row alignment (`.slot-count-ampm` 18→24px, `.slot-count-total` 20→28px), and gave the expanded clinician detail total (`.staff-type-total`) a mono font, fixed width, and right alignment. (`side-panel/modules/slots/slots.css`)
- Normalised AM/PM count font-size to 12px across the hero chips, per-type rows, and per-clinician rows (previously 15/11/10px). (`side-panel/modules/slots/slots.css`)
- Hero total and header AM/PM counts now render via `toLocaleString('en-GB')` for thousands separators, matching the referrals and activity modules. (`side-panel/modules/slots/slots.js`)
- Each "By type" row now shows its share of the visible day total as a muted `%` annotation. (`side-panel/modules/slots/slots.js`, `side-panel/modules/slots/slots.css`)
- The slot alert ribbon now emphasises the count and pluralises ("3 slots remaining" / "1 slot remaining"). (`side-panel/modules/slots/slots.js`, `side-panel/modules/slots/slots.css`)

## [v3.4.1] — 2026-05-29
### Changed — Configurable feedback recipient
- The feedback button's recipient email is now configurable in **Options › Suite** (`suite.feedbackEmail`), saved alongside the practice code. The About-tab button reads it at send time and falls back to the default (`davetriska02@gmail.com`) when unset. (`options/options.html`, `options/options.js`, `side-panel/panel.js`)
- The setting is included in suite backup/restore (export, import, and preview). (`options/options.js`, `shared/io/suite-envelope.js`)

## [v3.4.0] — 2026-05-29
### Added — Feedback / feature request / bug report
- New **Feedback** section in the side-panel About tab. A type selector (Feedback / Feature request / Bug report), subject, and details compose a pre-filled email to the developer via `mailto:` — no GitHub account, login, or backend required. Suite version, browser, and timestamp are appended automatically as diagnostics. (`side-panel/panel.js`, `side-panel/panel.css`)
- The form carries an explicit warning not to include patient-identifiable information, and opens the email client via a transient anchor click so the panel is never navigated away.

## [v3.3.1] — 2026-05-29
### Removed — Triage Lens read-time chips
- Removed the "2m read" / "5m read" / "10m+ read" queue chips and the detail-page read-time chip. A word-count-bucketed reading estimate added no triage value and cluttered the queue. Dropped the chips, the `estimateReadTime` helper, and its callers. (`content-scripts/triage-lens/content.js`, `defaults.json`, `options.js`)

### Changed — Triage Lens defaults de-duplicated
- The system-chip defaults were maintained as a hand-written `SYS_CHIP_DEFAULTS` object that had to be kept in sync with `EMBEDDED_DEFAULTS` (and with `defaults.json`) by hand — the source of past green/amber drift. `SYS_CHIP_DEFAULTS` is now derived from the parsed `EMBEDDED_DEFAULTS`, so there is a single source of truth inside `content.js`.
- Added `test-triage-defaults.js`, which parses both `defaults.json` and the embedded copy and asserts they are identical, so the remaining file↔string duplication can't silently drift again.

## [v3.3.0] — 2026-05-29
### Added — Clinical Safety settings tab
- New **Clinical Safety** tab in suite settings. Sets out, in plain terms, that the software is built and released by a single GP developer on a best-effort basis, with a maintained clinical safety case but no warranty — a supplementary aid, not a medical device, and not a substitute for clinical judgement or the live record.
- Direct links to the full clinical safety case documents (Intended Purpose, Clinical Safety Notice, Hazard Log, Full Disclaimer & Terms). Links point to the public repository, which is regenerated weekly from the current codebase, so they always reflect the latest release and render as formatted markdown. (`options/options.html`)
- Drive-by fix: `button.ghost:hover` and the new doc-link hover referenced an undefined `--bg-hover` variable on the options page; switched to the defined `--bg-mid`.

## [v3.2.5] — 2026-05-29
### Fixed — time-based wording on non-time-based custom alerts
- Drug-combo, event-count, and composite alerts fire on presence / count / threshold, not on a recall interval, but `severityToStatus` mapped their severity onto the recall vocabulary — so a QTc-prolonging drug combination or a ">3 UTIs" count showed **"DUE SOON"** (amber) or **"OVERDUE"** (red), which is meaningless for a non-time-based flag.
- Introduced dedicated statuses for these alert types: `red → ALERT`, `amber → CAUTION`, `info → NOTED`. They keep the same red / amber / neutral colour and the same sort/filter ranking as their time-based peers, so nothing else changes — only the wording now reads correctly. (`engine/rules-engine.js`, `shared/chip-renderer.js`, `side-panel/modules/sentinel/sentinel.js`, `content-scripts/sentinel.js`)
- Added regression tests for the severity→status mapping and the new labels/colours/ranks. (`test-custom-rules.js`)

## [v3.2.4] — 2026-05-29
### Fixed — "Test connection" and "Check for updates" button styling
- Both buttons used a `.ghost` class that had no base CSS definition in `options/options.html`, causing the browser to render them as unstyled system buttons that clashed with the rest of the UI. Added a proper `button.ghost` rule matching the same font, weight, letter-spacing, border-radius, and padding family as `button.primary`. (`options/options.html`)

## [v3.2.3] — 2026-05-29
### Fixed / improved — alert library UX
- Added **"+ Add all"** button at the top of the alert library body. Shows a count of unadded entries; hides itself once everything has been added. (`sentinel-options/options.html`, `sentinel-options/options.js`)
- Fixed annoying auto-scroll when adding an individual library entry. The view now stays on the library list so the next entry can be clicked immediately — the newly added card still flashes in the rules section below, but the page no longer jumps to it. (`sentinel-options/options.js`)

## [v3.2.2] — 2026-05-29
### Changed — clearer wording for the "stale" recall status
- Clinicians found the "STALE" chip label confusing. Renamed the user-facing label for this status (data older than 2× the recall interval — a tier worse than overdue) to **"SEVERELY OVERDUE"** across the sentinel chips, in-page summary counts, evidence phrasing, and the rule-preview status dropdown.
- The internal status key (`stale`) is unchanged, so saved rules, filters, and backups are unaffected. (`shared/chip-renderer.js`, `side-panel/modules/sentinel/sentinel.js`, `content-scripts/sentinel.js`, `engine/rules-engine.js`, `sentinel-options/options.html`)

## [v3.2.1] — 2026-05-29
### Fixed — illegible sentinel evidence panels
- The sentinel chip evidence panel referenced CSS variables (`--surface-1/2/3`) that are not defined by the suite theme, so its background always fell back to a hard-coded dark colour. Under the default light theme this rendered dark `--text-*` colours on a dark background, making the evidence text unreadable when a chip was clicked.
- Remapped the panel, sparkline, and hover backgrounds to the real theme tokens (`--bg-elev`, `--bg-deep`, `--bg-hover`) so the panel is theme-aware and legible in both light and dark themes. (`side-panel/modules/sentinel/sentinel.css`)

## [v3.2.0] — 2026-05-28
### Added — chip provenance (click-to-see-evidence)
Side-panel sentinel chips are now clickable and surface the exact data the rules
engine matched to fire each alert. Clinicians can validate an alert before
acting on it — "this fired because <X happened on <date>>".

**Engine — `evidence` field on every chip:**
- Each evaluator now attaches `chip.evidence = { summary, facts[], refs?, series? }` built from the variables already in scope (no new data fetches). Shape is flat so one renderer handles all rule types.
- Drug-monitoring evidence: matched medication + start date; per-test name, last result + date + days-ago, interval threshold, status; "we looked for: …" rows for tests with no data; HRT context note when present.
- Drug-combo evidence: per-set matched drugs; patient age/sex; required problems matched (with coded date); excluded problems and `mustNotBePresent` list confirming none matched.
- QOF-indicator evidence: matched observation + value + date + days-ago, or "not found" with the search-terms list; threshold + operator + unit; QOF year / rolling window context; register precondition (which problem made the patient eligible); medication-present details.
- QOF-register evidence: register name + matched problem label + coded date.
- Event-count evidence: count vs threshold; window cutoff date; match/exclude terms; up to 15 matched items with date and raw value.
- Composite evidence: operator, "N of M sub-rules fired", per-sub-rule label + fired/not-fired status. Sub-rule refs are **clickable** in the panel — clicking drills into that sub-chip's own evidence (scroll + open).
- Observation-trend evidence: full point series (date + value, oldest → newest), delta, direction, span months, threshold.

**Renderer — `ChipRenderer.renderEvidencePanel(evidence)`:**
- New flat-list renderer in `shared/chip-renderer.js` used by all chip types.
- Inline SVG sparkline for observation-trend evidence — coloured by trigger direction (rising = red if rule is "rising"; falling = blue; steady = grey), tooltips on each point with date + value.
- Every clickable chip now carries `data-rule-id` + `data-evidence-key` + a small ⓘ affordance + `role="button"` / `aria-expanded`. Chips without evidence render exactly as before (backwards-compat).

**Side-panel sentinel module:**
- Inline panel appears directly under the clicked chip — no modal, no floating popover. Click to toggle, Esc to close, Enter / Space to activate from keyboard.
- Open state survives the 10-second poll re-render: the panel restores itself after each refresh as long as the chip is still in the snapshot.
- Composite sub-rule drill-through: click a fired sub-rule ref → previous panel closes, target chip opens, scrolls into view.
- One delegated click handler at the container level (idempotent across re-renders).
- Cleanup on module unmount removes document-level Esc handler and resets state.

**Scope of v1:**
- Side-panel + pop-out only. In-page sentinel HUD and full-tab visualiser unchanged (chip data carries `evidence` and they can adopt the renderer later without engine changes).
- No-data chips still render evidence ("we looked for X, found nothing").
- Inapplicable-chip leaks were closed in v3.1.8 first so the evidence panel lands on a clean baseline.

## [v3.1.8] — 2026-05-28
### Fixed — applicability filter audit (engine + bundled rules)
Pre-evidence-feature audit by adversarial agent. Closes silent filter holes
where rules could fire for clinically inappropriate patients.

**Engine — filter enforcement gaps closed:**
- `evaluateDrugRule` now applies `rule.sex`, `rule.ageRange`, `rule.requiresProblem`, `rule.excludesProblem`. Previously these schema fields were silently ignored — any user-added drug-monitoring rule with sex/age/problem filters fired universally.
- `evaluateQofIndicatorRule` now applies `rule.sex` (previously only `ageRange` was checked).
- `evaluateQofRegisterRule` now applies `rule.sex` and `rule.ageRange` (registers like cervical-screening-eligible / AAA-screen-eligible inherit applicability from the patient).

**Engine — `passesProblemFilters` helper with negation awareness:**
- New shared helper extracted from `evaluateDrugComboRule` and used by all evaluators. Substring matches on problem labels now reject negation/history prefixes: a problem labelled `"no heart failure"`, `"family history of heart failure"`, `"history of heart failure"`, `"resolved heart failure"`, `"at risk of HF"`, `"?heart failure"` no longer satisfies `requiresProblem: ["heart failure"]`.

**Engine — drug-combo distinct-meds guard:**
- When `drugSets` overlap (e.g. QTc-prolonging drug A and B share the same list), a single matched medication previously satisfied every set. Engine now requires the matched meds across sets to resolve to distinct medications (greedy assignment). Fixes `prescribing-qtc-combination` firing on monotherapy.

**Bundled alert library — applicability tightening:**
- `trend-1` Rising PSA trend: added `sex: "M"` and `ageRange: { min: 40 }`. Previously could fire on any patient with a PSA value recorded.
- `event-count-1` Recurrent UTI: added `"symptoms"`, `"luts"`, `"outflow"` to exclude so LUTS codes are not counted as UTI episodes.
- `pincer-9` Metformin renal: added combo brand names (`glucophage`, `janumet`, `komboglyze`, `eucreas`, `xigduo`, `synjardy`, `vipdomet`, `jentadueto`) — patients on combo products now get the annual eGFR monitoring alert.
- `pincer-12` Lithium + NSAID: added `["shampoo","topical","gel","cream"]` to Lithium drugSet exclude (guards against the rare lithium succinate shampoo formulation).
- `mhra-isotretinoin-ppg`: removed dead `"tretinoin oral"` match token (never appeared in formulary strings — `"isotretinoin"` / `"roaccutane"` cover oral retinoid prescribing).

## [v3.1.7] — 2026-05-28
### Fixed — final brand-name scrub + custom-rule card display
- `rules/alert-library.json`: renamed five `libId` values that still embedded vendor brand names (`ardens-1..4`, `pcit-1`) to neutral guideline-source slugs (`mhra-valproate-ppg`, `nice-lithium-monitoring`, `mhra-sglt2-dka`, `mhra-isotretinoin-ppg`, `prescribing-qtc-combination`). New adds from the library now generate clean rule IDs.
- `sentinel-options/options.js` `renderCrList` (drug-monitoring) and `ciRenderList` (qof-indicator): card titles now prefer `rule.label` / `rule.indicatorName` over `rule.id`. Already-stored rules with legacy brand-name IDs in user storage now show their human-readable label (e.g. "Lithium — monitoring overdue") instead of `custom-ardens-2-…`.

## [v3.1.6] — 2026-05-28
### Added — feature-list hotlink in About tab + weekly auto-generator
- New card at the top of the side-panel **About** tab linking to the latest `docs/feature-list.docx` on GitHub (raw download) and the Markdown source.
- `.claude/scheduled-tasks/weekly-feature-list.md` — prompt for a scheduled Claude Code on the web trigger that regenerates `docs/feature-list.md` and `docs/feature-list.docx` once a week. No-op commit when the feature surface hasn't changed (avoids weekly noise commits).
- Placeholder `docs/feature-list.md` shipped so the About link works immediately before the first scheduled run lands.

## [v3.1.5] — 2026-05-28
### Added — Alert Library alpha-feature acknowledgement gate
- Library cards are dimmed and `+ ADD` buttons inert until the user clicks "I understand — enable the library" on a warning banner.
- The banner explains that the bundled alerts are starter templates from published guidelines (PINCER / NICE / MHRA), have not been clinically validated, may match incorrectly, and that the user is responsible for reviewing each rule before clinical use.
- Acknowledgement is stored in `chrome.storage.local` under `sentinel.alertLibrary.acknowledged` — one-time, persists across sessions and re-renders.
- `storage.onChanged` listener picks up the flag from any window (so acknowledging in the side panel popout or one tab unlocks every open instance).
- Defensive: `addLibraryEntry` short-circuits and shows a toast if called before acknowledgement (e.g. via DevTools); the click is already blocked by `pointer-events:none` on the locked cards.

## [v3.1.4] — 2026-05-28
### Fixed — 6-agent code review of v3.1.2 (real bugs only)

**Alert library "+ ADD" silent failure (Nick's report):**
- `sentinel-options/options.js` `isAlreadyAdded`: now checks `entry.rule.label` and `entry.rule.indicatorName` in addition to `entry.title`. For composite-1 those strings differ, so the button never greyed out and the user got no visible confirmation that the rule had been added.
- Composite library entries with placeholder `ruleIds` (`custom-replace-with-…`) now show a follow-up toast warning that the composite must be edited to select the actual rules to combine.

**Drug-combo evaluator crash + false-positive:**
- `engine/rules-engine.js`: `set.match.some(...)` threw `TypeError` if any drugSet had no `match` array. Added `Array.isArray` guard.
- Empty/missing `drugSets` caused `[].some()` to return false, so the rule fired for every patient. Added early-return guard.

**Triage Lens (`content-scripts/triage-lens/content.js`):**
- `requestPanel`: read `rs.categories.length` but `computeRequestSignals` never returns `categories`. TypeError crashed HUD rendering on every detail page.
- `buildFieldsData`: `safe(data.meds.*, 'name')` looked for a `.name` property on raw strings — meds field was always empty, so methotrexate/lithium/anticoag rules never fired from the meds field.
- `refreshQueueChips`: disconnected the queue MutationObserver then re-attached only if it already existed, leaving it dead after any config change. Now delegates to `setupQueueObserver()` which handles both the initial-create and re-bind paths.
- Care-plan ACP check hardcoded `frailtyHits.length >= 3`; now uses configurable `TH('frailtyHitsRed')` for consistency with the amber arm.

**Referrals discovery (`content-scripts/referrals-discovery.js`):**
- `isDataResponse`: accepted empty arrays (`length >= 0`); first config-variant empty response was cached as the data endpoint, so the real one was never captured. Now requires at least one element.
- `captureUrl`: bare `fetch` with no abort signal; a slow server held the function indefinitely and racing scans could fire duplicate fetches for the same URL. Added 8s `AbortController` timeout and in-flight URL set.

**Sentinel content script (`content-scripts/sentinel.js`):**
- `setupNavWatcher`: patched `history.pushState`/`replaceState` without idempotency guard. On cached-page re-injection the wrapped function was wrapped again, firing `locationchange` twice per nav. Added `window.__sentinelNavWatcherInstalled` flag.
- `bootDataOnly`: `MutationObserver` on `document.body` was never stored, so re-injection stacked observers indefinitely. Now stored on window and gated.

**Capacity module (`side-panel/modules/capacity/capacity.js`):**
- `selfWriteInProgress` flag was set true before `await chrome.storage.local.set()`; a storage rejection left it stuck true forever, silencing all cross-window preset sync. Wrapped in `try/finally`.

**Submissions chart (`side-panel/modules/submissions/submissions.js`):**
- `parseTime` regex assumed `"HH:MM"` at end of string; ISO 8601 timestamps (Z-suffixed) bucketed every task to midnight or returned null entirely. Now handles ISO 8601 first.
- `parseDate` regex assumed `"DD Mon YYYY"` format; ISO dates returned null and every bucket stayed at zero. Now parses ISO `YYYY-MM-DD` prefix first.

**Side-panel XSS hardening (`side-panel/panel.js`):**
- `releaseUrl` from the GitHub releases API was interpolated unescaped into `innerHTML`; a spoofed `html_url` could deliver `javascript:` or markup. Now validates against `^https://github.com/` and escapes before injection. Added `rel="noopener noreferrer"`.
- Module-load error path: `err.message` was injected raw — escaped with existing `escStrip()` helper.

**Referrals stale-timestamp button (`side-panel/modules/referrals/referrals.js`):**
- The "Refresh?" button injected via `innerHTML` on staleness transition was never wired to a click handler. Clicking did nothing. Added `addEventListener` after the innerHTML write.

**Triage backup (`shared/io/triage-io.js`):**
- `chrome.storage.local.remove('config')` ran unconditionally on every import; the bare `'config'` key is a generic name that any future module might own. Gated on the key actually existing first.

**Chip renderer XSS (`shared/chip-renderer.js`):**
- `chip.points` was interpolated raw into the badge span. Custom rules validate it as a number, but `orgRules` skip validation. Now escaped.

**Service worker (`service-worker.js`):**
- Alarm handler called `pollRequestMonitor()` without `await` or `.catch()`; unhandled rejections silently dropped. Now logs failures.
- `chrome.notifications.create()` called without callback; notification-permission and runtime errors silently dropped. Added `chrome.runtime.lastError` check.

**Options page capacity preset (`options/options.js`):**
- `parseInt(value, 10) || 75` substituted the default if the user typed `0`. Replaced with `Number.isFinite` check so 0 is preserved (and rejected as invalid further down).

**Sentinel options composite-reference safety (`sentinel-options/options.js`):**
- Deleting any non-composite rule (drug-monitoring, qof-indicator, drug-combo, event-count) didn't check whether composites referenced it. Composites silently stopped firing and showed the raw deleted-rule id in the card meta. New `confirmDeleteWithRefs()` helper warns the user and lists every composite that would break before deletion proceeds.

**Custom-rules import (`sentinel-options/options.js`):**
- `crImportFile` appended every incoming rule without running `validateCustomRule()`; malformed input corrupted storage and the next backup/restore cycle threw. Now validates each rule individually, reports rejected entries to the user, and only persists valid ones.

**Event-count edge cases (`engine/rules-engine.js`):**
- `(rule.windowMonths || 12)` accepted 0 → window collapsed and rule silently never fired. Now requires positive finite value.
- Unknown `operator` value (typo like `==`) silently left `fires=false`. Now logs a warning so misconfigured rules are visible in DevTools.

**Source attribution (rules/alert-library.json + sentinel-options):**
- All `source` fields and library subtitle now reference upstream guidelines (PINCER, NICE, MHRA, crediblemeds.org) directly. Ardens and Primary Care IT references removed across alert library, options.js `sourceBadgeClass`, and options.html CSS.

## [v3.1.2] — 2026-05-28
### Maintenance — remaining nits from the 4-agent code review
- `engine/normalisers.js`: extracted `keyToIsoDate(key)` helper to eliminate duplicated `dataYYYYMMDD` slice offsets between `normaliseObservations` and `normaliseObservationHistory`. One place owns the format assumption now.
- `engine/normalisers.js`: documented that `observationHistory[].history[].value` is numeric (parseObservationValue output), unlike `observations[].value` which is a display string with unit. Future maintainers won't trip on the type difference.
- `engine/normalisers.js`: replaced `localeCompare` date sort with plain string comparison — ISO YYYY-MM-DD sorts lexicographically identical to chronologically, without any risk of locale-collation surprises.
- `engine/rules-engine.js`: documented the 30.4375-days-per-month window arithmetic in `evaluateEventCountRule` — explains why event-count windows are approximate (not calendar-aligned) and consistent with observation-trend, but different from drug-monitoring's `daysBetween`.
- `engine/rules-engine.js`: documented inclusive boundary semantics on the event-count window.
- `engine/rules-engine.js`: documented `minDelta: 0` default semantics on observation-trend (means "any movement in named direction fires"; flat lines blocked by the strict-inequality direction check).

### Functional changes
None — pure code clarity and maintainability pass.

## [v3.1.1] — 2026-05-28
### Fixed
Four-agent code review of v3.0/v3.1 turned up real bugs. All fixed in this patch.

**Trend evaluator (v3.1.0 bugs):**
- `observation-trend` rule used `.find()` to pick a history series — would silently pick the first match if multiple existed (e.g. "PSA" and "PSA free/total ratio"). Now uses `.filter()` and picks the series with the most data points.
- Flat-line readings (delta = 0) used to fire as a "rising" trend because `0 >= 0` was true. Now requires strict directional movement: rising needs `delta > 0`, falling needs `delta < 0`. Combined with the existing `minDelta` check.
- `!isNaN(pt.value)` let `Infinity` through. Now `isFinite()` — matches author's stated intent.

**Side-panel rendering (v3.0 carryover):**
- `event-count`, `drug-combo`, and `composite` chips were computed correctly but **never rendered** in the side panel — they weren't in `typeOrder`, so any GP using the v3.0 alert library was seeing nothing for those types. Added them under labels "Recurrent Events", "Drug Combinations", "Composite Alerts".
- `shared/chip-renderer.js`: added `renderDrugComboChip`, `renderEventCountChip`, `renderCompositeChip`. Surfaces drug-set summary, count vs threshold, fired-rules count.
- `content-scripts/sentinel.js` `chipHtml`: new branches for the three chip types, delegating to the shared renderer.
- `manifest.json`: added `shared/chip-renderer.js` to content_scripts so the delegation actually resolves.

**Value parsing edge cases:**
- `parseObservationValue` now strips Unicode `≤` and `≥` operators (not just ASCII `<` / `>`). A PSA recorded as "≥10" was silently NaN before.
- European comma-decimal `"3,5"` → 3.5 instead of silently truncating to 3.

**Mock / error paths:**
- `MOCK_PATIENT` now includes a 4-point HbA1c history so trend/event-count rules are actually testable in mock mode.
- `fetchPatientData` error fallback now includes `observationHistory: []` for consistency with all other return paths.

### Backward compatibility
Four-agent review confirmed zero regressions. All v3.0 and earlier rule types (drug-monitoring, qof-register, qof-indicator with the three pre-existing check kinds, drug-combo with `sourceKind: "problems"`) evaluate through unmodified code paths.

## [v3.1.0] — 2026-05-28
### Added — Multi-point observation history
The observation-history extractor that v3.0 alerts depended on. Two alert types that previously always returned "no data" now actually fire:

- **`observation-trend` rules** (Rising PSA, falling eGFR, etc.) — now evaluates the last N observations within a configurable window and fires when the direction matches with optional minimum delta.
- **`event-count` rules with `sourceKind: "observations"`** (e.g. "≥4 abnormal LFTs in 12 months") — now counts real historical observations instead of just the latest.

### Under the hood
- `engine/normalisers.js`: new `parseObservationValue()` helper handles `<5`, `120/80` (takes systolic), text values, etc. New `data.observationHistory` array surfaces every recorded date for every investigation type, newest-first. `data.observations` (latest-only) unchanged for backward compat.
- `engine/data-fetcher.js`: wires `observationHistory` through to the engine's evaluation context.
- `engine/rules-engine.js`: `evaluateEventCountRule` (observations branch) now uses real history; `evaluateQofIndicatorRule` `observation-trend` branch implements first-vs-last comparison (last-in-window vs newest), checks `minPoints`, `minDelta`, and `direction`. BP-style values use systolic for trend calc.
- `content-scripts/sentinel.js`: passes `observationHistory` to the engine in both evaluation paths.

### Still coming — consultation-diagnoses extractor
The feasibility scout found that the existing patient-journal endpoint already returns consultation-level coded entries — `fetchJournalObservations` in `content-scripts/sentinel.js` just filters them out at the `entryType === 'observation'` check. To enable "≥3 UTIs coded in consultations in 12 months" we need to know the exact `entryType` value Medicus uses for a coded diagnosis (likely `'problem'`, `'diagnosis'`, or `'coded-entry'` — needs one real network capture to confirm). Tracking as v3.1.1 / v3.2.

## [v3.0.0] — 2026-05-28
### Added — Alert Builder UI (v3.0 headline feature)
The user-facing half of the alert builder. Combined with the v2.6.0 backend, GPs can now browse a curated library of 22 starter alerts (PINCER + Ardens + MHRA + PCIT) and one-click add them, or build their own alerts from scratch via dedicated form sections — no JSON editing.

- **Alert Library panel** at the top of Settings → Monitoring → Custom Rules. Collapsed by default. Cards grouped by category (Prescribing safety, Drug monitoring, Recurrent events, etc.) with colour-coded source badges. Click [+ Add to my alerts] to copy a starter alert into your custom rules — editable afterwards. Already-added alerts show "✓ Added" and the button greys out.
- **Drug-Combo Alerts** section — build rules like "Warfarin + NSAID concurrent" using repeating drug-set cards. Patient filters (age min/max, sex, requires/excludes problem) collapsed behind a chevron to keep the common case clean.
- **Event-Count Alerts** section — build rules like ">3 UTIs in 12 months for female <65". Source-kind toggle (Problems / Observations) with inline warning explaining the observation-history caveat.
- **Composite Alerts** section — combine other custom rules via AND/OR. Multi-select listbox of all your non-composite rules; blocks selecting a composite (no recursion).
- **Observation-trend** check kind added to the QOF Indicator form (4th radio: Rising/Falling, min data points, within months, optional min delta).
- **Smart routing** — clicking [+ Add] from the library scrolls to the right section's list and briefly flashes the new entry so users find it.

### Coming in v3.1
- Consultation-diagnoses extractor (needed for accurate recurrent-acute-condition alerts like recurrent UTI from coded encounter diagnoses, not just problem list)
- Multi-point observation history (needed to make observation-trend and event-count-on-observations fire meaningfully)

## [v2.6.0] — 2026-05-28
### Added — Alert builder backend (rules engine + library)
Backend foundation for the v3.0 user-configurable alert builder. UI to follow.
- **Three new rule types** in `engine/rules-engine.js` and `shared/io/sentinel-io.js`:
  - `drug-combo` — fires when patient is concurrently on drugs from N sets you define, with optional age/sex/problem filters. Covers PINCER prescribing-safety patterns (warfarin + NSAID, beta-blocker in asthma, etc.). Optional `mustNotBePresent` field for "drug X present AND drug Y absent" patterns (e.g. NSAID without PPI).
  - `event-count` — fires when N matching items in problems (or observations) within a time window meet a threshold. Covers ">3 UTIs in 12 months" style alerts. (Observation history limited to latest per test until v3.1 adds history endpoint — chips note the caveat.)
  - `composite` — fires when other rules combine via AND/OR. Composite rules cannot reference other composites (recursion guard). Missing referenced rules are skipped silently.
- **New check kind `observation-trend`** under `qof-indicator` for rising/falling trends across N observations. Emits `no_data` until observation history endpoint lands.
- **`rules/alert-library.json`** — 22 curated starter alerts:
  - All 13 PINCER prescribing-safety indicators
  - 5 Ardens / MHRA entries: valproate pregnancy prevention, lithium monitoring, SGLT2 + DKA awareness, isotretinoin PPP, dual antiplatelet
  - 1 Primary Care IT QTc-prolonging combination
  - 2 event-count examples: recurrent UTI (≥3 in 12mo, female <65), recurrent falls (≥2 in 12mo, age ≥65)
  - 1 composite template, 1 observation-trend (rising PSA)
- Engine helpers added: `severityToStatus()`, `passesAgeFilter()`, `passesSexFilter()`. New module-level constants for valid severities, sexes, operators, and source kinds.

## [v2.5.1] — 2026-05-28
### Added
- **Manual "Check for updates" button** in Settings → Suite. Previously the extension only checked GitHub for new releases once every 24h on its own schedule; now you can force a fresh check on demand. Button shows current state (up to date / update available / last check failed) and how long ago the last check ran. Bypasses the 23h cooldown when clicked.

## [v2.5.0] — 2026-05-28
### Added — Practice Profile (shared-folder managed deployment)
- New **Practice Profile** system for practices running the extension from a shared network folder. Drop a `practice-profile.json` file into the extension folder alongside the other files and it propagates default settings automatically to every PC that loads the extension — no manual steps for users after initial install.
- **Service worker** reads the profile on every browser start (`onInstalled` + `onStartup`). If `profileVersion` has changed since it was last applied, new settings are merged/applied automatically.
- **Three apply modes** controlled by the practice admin in the JSON file:
  - `mergeMissing` (default) — only writes settings the user hasn't already configured; safe, never overwrites user customisation
  - `forceOverride` — always replaces — use to push a mandatory rule change to all users
  - `firstRunOnly` — seeds new installs only; ignores version bumps after first apply
- **Settings → Backup & Restore** now shows a Practice Profile card: file status, version last applied, timestamp, and whether an update is available. Buttons: *Check for update*, *Apply now* (manual force), and **Generate profile from current settings** — configure one PC exactly how you want then generate a ready-to-use `practice-profile.json` in one click.
- **Full setup guide** embedded in a collapsible panel in the Settings page: step-by-step instructions for creating the file, editing the header, choosing a mode, pushing updates, and first-time install on each PC.
- Desktop notification (silent, one per version) when a new profile version is applied, if the admin enables `notifyUserOnApply`.
- Application history stored in `suite.practiceProfile` (last 10 applies) for auditability.
- New file `shared/io/practice-profile.js` — self-contained, loads in both service worker and options page contexts.

## [v2.0.5] — 2026-05-28
### Added
- Settings → Suite tab now includes a "Support development" card with a Buy Me a Coffee link (`buymeacoffee.com/davetriska`). Short note explaining the suite is built in spare time and given away free, AI tokens cost money out of pocket, and 100% of donations go straight back into development. Card sits at the bottom of the Suite section so it's visible from the default landing tab but never gets in the way.

## [v2.0.4] — 2026-05-28
### Changed
- Thematic alignment: Sentinel/Monitoring options (`sentinel-options/`), Triage Lens options (`content-scripts/triage-lens/options.*`), and Patient Record Visualiser (`visualiser-core.*`) all now follow the global `suite.display` theme/size/colour-blind preference, matching the light-default main panel. Each page reads `suite.display` on load and listens for live storage changes so toggling in the main panel takes effect immediately without a reload.

## [v2.0.3] — 2026-05-28
### Fixed
- Settings page and pop-out window now follow the theme/size/colour-blind preference set in the main panel. Both were still hard-coded to dark. Settings page `:root` changed to light palette with `[data-theme="dark"]` override; pop-out boot now reads `suite.display` from storage before loading the first module. Both also react live if you toggle the preference while they are open.

## [v2.0.2] — 2026-05-28
### Fixed
- Levothyroxine monitoring chip now correctly labels the test as **TSH** rather than **TFT**. The recorded value Medicus surfaces is the TSH number alone (full TFTs aren't routinely run for stable replacement), so the previous "TFT · 3.2" was misleading. Match terms still cover TSH/TFT/thyroid function so existing observations continue to be detected. Notes updated to reflect TSH-only monitoring per NICE NG145.

## [v2.0.1] — 2026-05-28
### Added
- HRT monitoring chip now surfaces progestogen coverage context for oestrogen-triggered chips:
  - **Hysterectomy recorded** → green line "Hysterectomy — progestogen not required"
  - **IUS in situ** (Mirena, Levosert, etc.) → green line "IUS in situ — Mirena 52mg"
  - **Oral/patch progestogen** (Utrogestan, norethisterone, etc.) → green line "Progestogen: Utrogestan"
  - **None of the above** → amber warning "No progestogen or hysterectomy recorded" — flags potential unopposed oestrogen
  - Context only shows on oestrogen-triggered chips; IUS/progestogen-only chips (standalone prescriptions) are unaffected.

## [v2.0.0] — 2026-05-28
### Changed
- **Light mode is now the default theme.** Dark mode remains available as an option. The CSS variable baseline (`:root`) is now the light palette; dark mode is applied via `[data-theme="dark"]` override.
- Display settings (theme, text size, colour-blind mode) moved from the Monitoring module into the main suite nav bar — a sun ☀ icon appears in the top-right, visible on all tabs. This was previously only accessible while on the Monitoring tab.

### Added
- v1.11.0 features are carried forward unchanged (HRT IUS recognition, display prefs).

## [v1.11.0] — 2026-05-28
### Added
- Display preferences for the entire panel, accessible via the ⚙ button in the Monitoring header. Settings persist to `suite.display` storage and apply immediately:
  - **Light / Dark theme** — full light-mode palette with appropriate contrast ratios for clinical use in bright rooms.
  - **Text size S / M / L** — scales the whole panel via CSS zoom; S = 85%, M = 100% (default), L = 125%. Resolves legibility issues on high-DPI screens or for users who need larger text.
  - **Colour-blind mode** — replaces red (→ orange #ea580c) and green (→ blue #2563eb) globally across all chips, badges, and test rows. Designed for the most common deuteranopia/protanopia profiles.
- HRT monitoring rule now recognises Mirena coil / LNG-IUS (Mirena, Levosert, Jaydess, Kyleena, levonorgestrel intrauterine system). Patients with an IUS documented as a medication will now show the annual HRT review chip, correctly reflecting its role as the progestogen component of HRT in perimenopausal women using systemic oestrogen.

## [v1.10.0] — 2026-05-28
### Added
- Slot Counter now visually distinguishes AM from PM appointments. Under the day-total hero are two chips — `AM 14` and `PM 9` — and every "By type" and "By clinician" row shows the same breakdown inline (`8 am · 4 pm · 12`). Lets a clinician see at a glance whether the day still has morning capacity, afternoon capacity, or both, instead of just a single combined number. AM is `startDateTime` hour < 12; PM is 12:00 onward.

## [v1.9.0] — 2026-05-28
### Fixed
- Settings page version badges now read the live extension version instead of a hard-coded `v1.4.2` that had not been updated since the first release.
- Triage Lens custom settings are no longer wiped on suite restore when the backup file pre-dates the user's customisations. Previously, importing a suite backup containing `triage: {config: {}}` would overwrite `triagelens.config` with `{}`, deleting the user's rules. `triageImport` now skips writes for empty config objects.

### Changed
- Suite-scope import preview now lists every known module — present ones show their content, absent ones explicitly say `— not in this backup`. This clears up the confusion where Request Monitor and Triage Lens looked "missing" from a restored backup just because they pre-dated those modules being wired into suite-level export (the data was simply not in that backup file). Per-module scope previews are unchanged.
- Preview line for envelope's extension version now reads `Backup created with extension version: v1.6.0` rather than the bare `Extension version: v1.6.0`, to distinguish it from the currently-installed version.

## [v1.8.9] — 2026-05-28
### Added
- HbA1c chips now show the value with unit: e.g. `NOT MET · 62 mmol/mol · 12 Mar 2025`. Applies to DM020 (≤58, non-frail), DM021 (≤75, frail), and the retired DM007/DM008 rules. Previously the number appeared without unit, making it ambiguous to the clinician.
- Non-HDL / LDL cholesterol chip (CHOL004) now shows the value with unit: e.g. `MET · 2.4 mmol/L · 12 Mar 2025`.
- Engine: `observation-threshold` rules can now declare a `"unit"` field in their check definition; the engine appends it to `valueText` automatically. Custom rules created in the Options page can use this field too.

## [v1.8.8] — 2026-05-28
### Added
- Monitoring chips now show the recorded value, not just the date. For drug-monitoring tests (U&E, LFTs, etc.) the latest result appears between the status badge and the date: e.g. `IN DATE · 4.5 · 12 Mar 2025 · 89d`. For QOF `observation-recent` indicators (HRT review, BMI, smoking status, etc.) the value appears beside the date too — closing the gap where in-date chips showed _when_ but never _what_. Values are trimmed and capped at 30 characters to stay on one row.

## [v1.8.7] — 2026-05-28
### Fixed
- Monitoring (Sentinel) panel now auto-refreshes the instant the patient changes. Content script broadcasts `sentinel:snapshot-updated` after every re-evaluation; side panel re-renders on receipt instead of waiting up to 10 s for its poll.
- Removed the `document.visibilityState` guard on the sentinel refresh path — Chrome was marking the side panel hidden while the user clicked in the main tab, silently skipping auto-refreshes. The refresh is just IPC (no API call), so the guard wasn't saving anything.

## [v1.8.6] — 2026-05-27
### Fixed
- Request-monitor infinite loop: `chrome.storage.onChanged` listener no longer reacts to writes the poller itself makes (`state`, `notifMap`). Only true user-config changes trigger re-initialisation.
- Request-monitor double-poll on every re-init: removed the synchronous `pollRequestMonitor()` that fired alongside the alarm's immediate-trigger.
- Request-monitor concurrent-write race: `shared/request-monitor.js` now deduplicates in-flight Promises so the service-worker alarm path and the side-panel UI path share a single poll.
- Sign-in (401/403) no longer burns API calls indefinitely: poller pauses for 5 minutes on auth failure and clears when the user changes config.
- `engine/api-client.js` patient-data fetch: concurrent calls for the same patient now share a single in-flight Promise, eliminating redundant network requests on rapid SPA navigation.
- `content-scripts/sentinel.js` `fetchJournalObservations`: added 8-second `AbortController` timeout (other endpoints already had this via `safeFetch`).
- `shared/medicus-api.js` scheduling cache: keyed by practice code, so switching practices no longer serves stale data from the previous practice.
- `content-scripts/referrals-discovery.js`: diff before write — no longer writes storage on every page load when discovered data is unchanged.
- Submissions module: anonymous `chrome.storage.onChanged` listener was never removed in cleanup, accumulating one listener per tab switch. Now uses a named reference removed in `cleanup()`.
- Side-panel `switchModule` tab-switch race: previous module's in-flight fetch could overwrite the new module's DOM. Added a monotonic `switchSeq` guard and explicit cleanup before clearing `content`.
- Capacity module double-fetch on preset save: `savePreset` and `onStorageChange` both triggered `loadVisibleDates`; guarded with a `selfWriteInProgress` flag.
- SubRag strip `setInterval` return value was discarded; timer ID is now stored.
- Update-checker now sends `If-None-Match` ETag header and writes `checkedAt` on 403 (rate-limit) so the 23-hour cooldown engages correctly.
- Request-monitor notification map: clicked notifications are now removed from `suite.requestMonitor.notifMap`, preventing the map drifting toward its 50-entry cap with dead entries.
### Changed
- Sentinel module: poll interval slowed from 3 s to 10 s; skips polling when `document.hidden`.
- Side-panel demand strips (WR / RM / SubRag): skip polling when the panel is not visible (`document.visibilityState !== 'visible'`); refresh immediately on visibility return.
- Slots / activity / referrals / submissions refresh buttons: disabled during in-flight fetches to prevent rapid-click concurrent fetches racing on shared module state.

## [v1.8.5] — 2026-05-27
### Fixed
- Backup gaps: `referrals.*`, `popout.activeModule`, `suite.requestMonitor.*` now captured in full-suite export/restore.
- `submissions.config` no longer overwritten with a partial object when saving practice code.
- Pusher `waiting:refresh` no longer fires twice per appointment update.
- Referrals discovery messages now properly handled; live updates work.
- Sentinel module: module-level `document.addEventListener('click', …)` moved into `init()` and removed in `cleanup()` — eliminates listener accumulation on module reload.
### Removed
- `side-panel/modules/triage/` directory deleted (module decommissioned in v1.5.3; files were left behind).
- `shared/waiting-room-api.js` deleted (logic duplicated inline; no consumers).
- Legacy `config` storage key removed during triage migration.

## [v1.8.4] — 2026-05-26
### Changed
- Side-panel demand banner (`#rmStrip` — medical/admin request alerts): increased size by ~25% (padding, font-size, pill dimensions) for improved legibility.

## [v1.8.3] — 2026-05-26
### Fixed
- Activity tab: relabelled "Urgent Rx" to "Non-routine" in legend and column headers to match the field's actual meaning (non-routine prescription requests).

## [v1.8.2] — 2026-05-26
### Fixed
- Capacity Forecast: Options page preset editor now exposes per-weekday minimums (Mon–Sun) instead of the legacy single "Daily minimum" field, matching the side-panel editor. Editing a preset from Options previously collapsed all weekdays to one number, silently overwriting any per-day settings.
- Options page preset cards now summarise minimums the same way the side-panel does (`Min N/weekday` when uniform, otherwise `Min N/week`).
- Saving a preset from Options now stores `minimumByDay` and drops the legacy `minimumPerDay` field; existing presets are migrated on edit by spreading their old `minimumPerDay` across Mon–Fri.

## [v1.8.1] — 2026-05-22
### Changed
- Monitoring tab moved to second position in nav (immediately after Slots) in both side panel and pop-out

## [v1.8.0] — 2026-05-22
### Added — Visualiser Tier 2 & Tier 3 (filters, swim-lane, eFI, drugs, PINCER, QOF review)
Substantial follow-up to v1.7.0. Continuity view scroll/filter problem fixed by giving every tab a single shared filter model; Timeline replaced with a true D3 swim-lane; engine-layer features added for frailty, polypharmacy, prescribing safety and review compliance.

#### Global filter bar (every tab)
- **Date-range brush** above the tab content — D3 brush over the full record's date extent, plus `All / 5y / 3y / 1y` preset buttons. The brush *is* the filter — all tabs re-render against the selected window. Solves the "ribbon is rainbow noise with 1029 consults squashed in 900px" problem from v1.7.0.
- **Clinician filter** — single-select dropdown listing every practitioner with their entry count. Hard-filters the entry stream; bars, ribbon, swim-lane all collapse to just that clinician.
- **Problem spotlight** — single-select dropdown listing every active and past problem. Does NOT hard-filter; instead highlights matching entries in the swim-lane (others dimmed), and the "what's new" / Active Problems list.
- Active problems on the Snapshot tab are now clickable — click to spotlight that problem across all views (toggles).
- Clinician bars on the Continuity tab are clickable; click any practitioner row, bar, or ribbon-legend swatch to set the clinician filter. Click again to clear.
- Register cards on the Registers tab are clickable — click a register to spotlight that condition across the swim-lane, snapshot etc.
- `Clear` button resets everything; `Showing N of M entries` summary stays live.

#### Timeline tab — D3 swim-lane
- Replaced stacked-bar + monthly heatmap with a horizontal swim-lane: one lane per bucket (consultation, communication, investigation, document, note, recall, referral), one dot per event, scaled to the filtered date range.
- Hover any dot for a tooltip showing date / type / practitioner / code / linked problems. Click a dot to spotlight its first linked problem across all tabs.
- Problem spotlight: matching events get a 2px orange stroke; others fade to 0.18 opacity, so the story of "everything that happened for diabetes" is immediately legible.
- Lanes with zero events in the current selection are auto-hidden. Volume-by-year bar chart preserved underneath for quick "which years were busy".

#### Investigations tab — sortable, filterable Latest values
- Text filter ("Filter analyte name…") — debounced live filter without re-rendering the whole tab; preserves input focus.
- "Only abnormal" toggle — filter to high/low rows only.
- Click any column header to sort by analyte / value / flag / Δ / date; click again to flip direction. Sort glyphs show current state.
- Click any row to open that analyte in the trend chart above (auto-scrolls to it).

#### Medications & Monitoring (new tab)
- 14-drug high-risk panel (methotrexate, azathioprine, lithium, amiodarone, warfarin, DOACs, ACEi/ARB, loop / thiazide diuretics, long-term NSAIDs, statins, digoxin, levothyroxine, metformin, strong opioids).
- Per drug: last-seen date, occurrences in record, last monitoring test date, days since monitoring, overdue badge based on NICE / BNF recommended intervals (e.g. methotrexate FBC/U&E/LFT every 3 months).
- Stats row: total drug families seen / active in last 18m / monitoring overdue / PINCER flags.
- Detection: regex scan of each entry's body + code text — caveat banner explains this is a screen, not a definitive medication review.

#### Snapshot — eFI gauge + PINCER red flags
- **Electronic Frailty Index (eFI)**: 36-deficit Clegg index computed from the problem list, with polypharmacy taken from the drug detector. Semicircle gauge coloured by category (Fit / Mild / Moderate / Severe). Shows count, score (0.00–1.00) and first 4 ticked deficits.
- **PINCER-style flags card**: applies drug-disease and monitoring-overdue rules (NSAID + CKD, NSAID + heart failure, NSAID + oral anticoag, beta-blocker + asthma, ACEi/ARB + CKD with overdue U&E, every overdue high-risk drug monitor). Shown with red border when flags present; green border + "no flags detected" otherwise. Full list also on the Medications tab.

#### Registers & Recalls — last-review enrichment
- Every QOF register card now shows "Last review: 17 Mar 2026 · 6m ago" with green / amber / red badge based on the recommended review interval (12m for most, 6m for cancer, 3m for palliative care).
- Cards sort overdue-first; overdue registers get an orange left border.
- Click a register card to spotlight its condition across the rest of the visualiser.

#### Internals
- `_s.filter` shared state — `dateFrom`, `dateTo`, `preset`, `clinician`, `problem`. Hard filter for date+clinician; spotlight for problem.
- `filteredEntries()` helper; `rebuildAll()` recomputes analytics under filter and re-renders every tab. Called from buildApp on load and from every filter change.
- `computeEFI`, `computeDrugMonitoring`, `computePINCER`, `enrichRegistersWithReview` engine functions.
- Tab switch + window resize re-render the swim-lane so it picks up the correct width when the tab becomes visible.

## [v1.7.0] — 2026-05-22
### Added — Visualiser Tier 1 clinical-UX upgrades
Five evidence-led upgrades drawn from a multi-agent research pass (Plaisant Lifelines2, Epic Results Review, KDIGO 2024, NICE NG28/NG136, RCV literature PMC10197470, JAMIA four-techniques study). Each chosen for high clinical value at low build cost.

- **"What's new since last consultation" card** on the Snapshot tab. Identifies the most recent face-to-face consultation, lists every event dated after it, groups by bucket, and flags any investigation with abnormal results. The first thing a GP wants to see before consulting.
- **Practitioner ribbon** on the Continuity tab. Thin band of cells (one per consultation, left = older → right = newer) coloured by practitioner; a second strip below shows days since previous contact (height-encoded, capped 90d). Long gaps surface as wide bars; fragmented care shows as a rainbow run; continuity shows as a monochrome run.
- **Reference Change Value (RCV) delta flags** on the Latest values table. New "Δ vs prior" column; arrow doubles and turns red when the inter-result change exceeds the analyte's literature RCV (creatinine 14%, eGFR 14%, HbA1c 12%, Hb 8%, Na 1.3%, K 5%, TSH 45%, etc.).
- **Inline sparklines** on the Latest values table. 70×20 SVG polyline per analyte, with the reference band shaded in green and the last-point dot coloured red when out of range. Trend direction now scannable without expanding a chart.
- **Clinical zone bands on the analyte trend chart**. Replaces the flat reference lines with KDIGO-staged eGFR zones (G1→G5), NICE/QOF HbA1c thresholds (normal / pre-diabetes / target / suboptimal / poor control), and NICE BP staging. Falls back to a translucent reference-range band for other analytes. Y-axis padded to include the reference range so abnormals visually escape it (lab-UX anti-pattern fix). Out-of-range data points rendered in red.

## [v1.6.4] — 2026-05-22
### Fixed
- **pdf.worker.min.js was corrupted**: in v1.6.3 the worker source was extracted with `awk` from a JS template literal (`` var _workerSrc = `...` ``), so the file ended up containing literal `` \` ``, `\${`, and `\\` escape sequences instead of the real `` ` ``, `${`, `\` characters. Browser threw `Uncaught SyntaxError: Invalid or unexpected token`, pdf.js fell back to fake-worker mode, `WorkerMessageHandler` never materialised, and text extraction died with "Cannot read properties of undefined". Re-extracted the worker by evaluating the template literal in Node so all escape sequences collapse correctly. All four vendor files now parse cleanly under `new Function(...)`.
- Use `chrome.runtime.getURL('vendor/pdf.worker.min.js')` for `GlobalWorkerOptions.workerSrc` so pdf.js loads a real Worker (fast) instead of the "fake worker" fallback. Falls back to a relative URL if `chrome.runtime` isn't present.

## [v1.6.3] — 2026-05-22
### Fixed
- **Visualiser actually runs now**: extracted all inline `<script>` blocks (pdf.js, Chart.js, D3.js, worker setup, app code) to external files under `vendor/` and `visualiser-core.js`. Under MV3 the default extension-page CSP is `script-src 'self'` — inline scripts were silently blocked, so no JS ran at all and the file picker had no `change` handler attached. The pdf.js worker is now shipped as `vendor/pdf.worker.min.js` and loaded by relative URL, so no `blob:` URLs and no `eval`.
- Cleaned up the embedded-as-string worker bootstrap (the old `Blob` + `URL.createObjectURL` dance) — no longer needed.

## [v1.6.2] — 2026-05-22
### Fixed
- **Visualiser file selection now works**: removed the obsolete `visualiser.html` iframe wrapper. The wrapper was a leftover from when `visualiser-core.html` lived under `manifest.sandbox.pages` (v1.5.4 fixed that); its `sandbox="..."` attribute on the iframe was still in force and was silently blocking the file input's `change` event from doing anything useful. Callers in `popup.js` and `side-panel/panel.js` now open `visualiser-core.html` directly; the wrapper file has been deleted.
- Added stage-by-stage `console.log('[Visualiser] ...')` diagnostics through the PDF load pipeline so future silent failures can be diagnosed without source diving.

## [v1.6.1] — 2026-05-22
### Fixed
- **Visualiser "Choose PDF file" button**: replaced `<button>` + programmatic `fi.click()` with a native `<label for="file-input">` element — the programmatic click was silently blocked inside the sandboxed iframe; the label→input binding uses the browser's native activation and is not subject to the same restriction

## [v1.6.0] — 2026-05-22
### Added
- **Patient Record Visualiser — complete rewrite**: new pop-health dashboard built around real Medicus EPR export PDF structure; 6 tabs — Snapshot (demographics, active/past problems, open recalls), Continuity (UPC index, Bice-Boxerman index, clinician bar chart + detail table), Timeline (year stacked bar + 5-year monthly heatmap), Investigations (analyte trend selector with Chart.js line + reference bands, latest values table), Registers & Recalls (QOF register auto-detection from problem list, open/cancelled/completed recalls with overdue badges), Letters (specialty bar chart + searchable document list); replaces the previous 3,600-line kitchen-sink implementation
- **Suite backup refresh**: `doFullExport`/`applyEnvelope` in `options.js` now delegates entirely to per-module IO files — eliminates drift between backup and storage. Previously missing keys now captured: `slots.alertRules`, `submissions.thresholds`, `suite.triageAlert.rules`, `popout.windowState`
- `submissions-io.js`: now exports/imports `submissions.thresholds`
- `suite-envelope.js`: added `triageAlerts` and `popout` scopes; richer preview lines for slots, submissions, triage alerts, popout; version bumped to 1.6.0; added inline convention comment
- `options/options.html`: all per-module IO scripts now loaded
- `CLAUDE.md`: new developer guide documenting module structure, storage-key backup convention, alert strip pattern, version bumping, git workflow

## [v1.5.4] — 2026-05-22
### Fixed
- Patient Record Viewer: removed `visualiser-core.html` from `manifest.json` `sandbox.pages` — the manifest sandbox gave the page an opaque (null) origin, causing `URL.createObjectURL` to produce `blob:null/…` URLs that Chrome refuses to load as Web Worker scripts; removing the sandbox restores extension origin so the pdf.js worker initialises correctly

## [v1.5.3] — 2026-05-21
### Changed
- Nav: removed redundant "Alerts" tab (`data-module="triage"`) from side panel and pop-out — triage capacity alerts remain active via the rm-strip; triage lens overlay unaffected
### Fixed
- Patient Record Viewer: PDFs with text items missing `transform` (type 3 fonts, some Medicus print layouts) no longer throw an uncaught TypeError in `reconstructLines` — items without a transform matrix are now skipped
- Patient Record Viewer: null guard added on the investigations yearly chart canvas element in `buildInvestigationsView`
- Patient Record Viewer: error dialog now reports which processing stage failed (loading PDF / extracting text / parsing entries / building views) for easier diagnosis

## [v1.5.2] — 2026-05-21
### Added
- Submissions: configurable RAG thresholds for medical and admin request tiles — amber/red tint + coloured dot on tile when today's total reaches threshold; Options → Submissions → Workload thresholds
- Global demand strip (visible on every panel tab, polls every 60s) — shows amber/red pill for medical/admin when threshold crossed; "Submissions →" button navigates to the module

## [v1.5.1] — 2026-05-21
### Added
- Referrals: "Rate" chart tab — referrals as a proportion of consultations per clinician (referrals ÷ consultations, shown as %) sorted by rate descending; cyan bar colour, tooltip shows raw ref/consult counts; clinician search applies; show-all toggle works
- Referrals: parallel-fetches `window.ActivityApi.fetchActivityReport` alongside referral data; activity fetch failure is isolated (amber notice in Rate tab only, other tabs unaffected)

## [v1.5.0] — 2026-05-21
### Added
- Slots: alert ribbon — configurable per-type thresholds; amber/red ribbon when count ≤ threshold; Options → Slot Counter to manage rules
- Slots: alert rules included in backup/restore export
- Pop-out window — ⊞ button in panel nav opens a free-floating popup window; position/size persisted; `chrome.windows` permission added
- Triage alerts — `engine/triage-alert-engine.js` evaluates request monitor bucket counts against user-defined thresholds; rm-strip highlights amber/red; desktop notification on threshold crossing (once per session per bucket); Options → Suite → Triage capacity alerts
- `shared/io/triage-alert-io.js`, `shared/popout-manager.js`, `shared/io/popout-io.js`

## [v1.4.16] — 2026-05-20
### Added
- Referrals: "Show all N clinicians/specialties/hospitals" toggle below each chart (expands past top-15 cap)
- Referrals: real-time clinician name search filter above the By Clinician chart
- Referrals: CSV export button — downloads all raw referrals with date, patient, clinician, specialty, hospital, priority, status, e-referral/manual flags
- Referrals: Priority (Routine/Urgent/2WW) and Status (Completed/Incomplete/Cancelled) chip filters — re-aggregates instantly, no re-fetch
- Referrals: live "Updated Xm ago" staleness label; turns amber with inline Refresh link after 30 min

## [v1.4.15] — 2026-05-20
### Fixed
- Nav bar: add left scroll arrow (‹) with `has-overflow-left` class and nudge-left animation
- Nav bar: both arrows now have border + `--text-2` colour for improved visibility
- Nav bar: left fade gradient via `::before` pseudoelement
- `normalisePriority`: use `startsWith('twoweek')` to correctly handle `'Two Week Wait (2WW)'` response values

## [v1.4.14] — 2026-05-20
### Fixed
- Referrals: 2WW priority count showing as 0 — API returns `'Two Week Wait (2WW)'` (spaced/parenthetical); added `normalisePriority()` to strip non-alpha chars and map all variants to canonical key

## [v1.4.13] — 2026-05-20
### Fixed
- Referrals: HTTP 400 — `buildUrlFromTemplate` was appending `referralStartDate`/`referralEndDate` on top of existing `startDate`/`endDate` params; now detects which date-param convention the URL uses and sets only those
- Referrals: full pagination loop (PAGE_SIZE=2000, MAX_PAGES=10) — was only fetching first 100 rows

## [v1.4.12] — 2026-05-20
### Changed
- Referrals: switch to URL template replay — captures exact discovery URL verbatim, only rewrites date/pagination params
- Referrals: add diagnostic panel (collapsed) showing discovery URL, config URL, priority/status values, last attempted URL

## [v1.4.11] — 2026-05-20
### Fixed
- Referrals: HTTP 400 — use actual priority/status values from stored config (`priorityOptions[*].value`) instead of hardcoded strings; removed spurious `limit=2000` param

## [v1.4.10] — 2026-05-20
### Fixed
- Referrals: HTTP 404 — read base URL from `referrals.discovery` / `referrals.config` storage (captured by discovery content script) instead of constructing from practice code; show discovery prompt when no URL available

## [v1.4.9] — 2026-05-20
### Added
- Referrals Tracker v1.0 — full visualisation module: summary card (total, priority tiles), status breakdown, stacked bar charts by clinician/specialty/hospital, date range controls with presets, progress indicator during paginated fetch

## [v1.4.6] — 2026-05-20
### Fixed
- Various code review bug fixes

## [v1.4.5] — 2026-05-20
### Fixed
- Visualiser CSP issue resolved via sandbox page

## [v1.4.3] — 2026-05-20
### Added
- Visualiser as labelled nav tab
- Check for Updates button in About panel

## [v1.4.2] — 2026-05-19
### Added
- Activity module with date range controls and stacked bar charts by task type
- `qofYearStart` UTC fix in rules engine
- `shared/activity-api.js`
