# Phase E — Lab Filing on the Lab Result Catalogue

**Status:** DESIGN AGREED IN PRINCIPLE (Nick + virtual Dave, 2026-09-22). BUILT so far: whitelist matching fix (v3.265.1), test-card layout (v3.265.2), per-result x lab x code ranges + enable + own approval, data and screen (v3.266.0). NOT built: safety guards / filing controls columns, the "never offer to file" strip, per lab-group comment whitelist, the adapter / union-only gate / shadow log, migration. Depends on v3.265.0 (Phase D) being merged.
**Related:** `docs/plans/LAB-RESULT-CATALOGUE-DATA-MODEL-2026-09-19.md` (§5.1), `docs/plans/PHASE-D-OUTSTANDING-MATCHER-ON-CATALOGUE-2026-09-22.md`, hazards H-073, H-074, H-075 (existing); H-080 / H-081 proposed (below).

---

## 1. The conceptual framework (Nick, 2026-09-22)

This is the model every later decision hangs from.

**Building block: individual results / analytes** (haemoglobin, ALT, HbA1c).
- Per result, accommodate different lab handling — e.g. differing normal ranges between labs.
- Also different acceptable ways of reporting — e.g. HbA1c NGSP (%) vs IFCC (mmol/mol).
- Within the GP system, different SNOMED codes may be used for the same result.

**Request groupings.** In the GP system we order "FBC" for convenience. This is *not a thing* — it is shorthand for a group of tests we want run.

**Lab report groupings.** The lab takes that shorthand and runs some or all of the tests, then sends them back as groups of results. Each group is, too, *not a thing* — a convenient way of bundling results. Groups matter only to the extent that:
- they correspond to request groupings, for marking requests as completed; and
- they can carry **comments**, which may relate to the whole group or to an individual result within it.

### What follows from it
| Belongs to… | Because |
|---|---|
| the **result** (per lab, per reporting form) | normal ranges, unit, trend limit — the lab does not process ALP differently for a "Bone profile" than for an "LFT" |
| the **lab + report group** | whitelisted lab comments — a comment arrives as one lab-generated package for a lab-defined group, and only *sometimes* names a result |
| request / report groupings | recognition and "mark request completed" (Phase D, done) — nothing else |

So **a practice normal range is stored once per (result × lab × SNOMED code)** — the unit is carried by the code (HbA1c IFCC and NGSP are different codes), so it is not entered separately —, never per test or per group. Editing ALP's range in "LFTs" and seeing it change in "Bone profile" is *correct* — it is one result. (The catalogue already stores results once; the Investigations page says "Used by N tests".)

## 2. What is stored today (so the gap is clear)

- Legacy filing profiles (`labfiling.profiles`) each carry their own free-text `parameters[]` (analyte name + low/high/unit) matched **by name text**. ALP in an LFT profile and ALP in a Bone profile are two unrelated entries; nothing is per lab.
- The lab's own reference range and high/low flag arrive with every report and are used at filing time (`r.low`, `r.high`, `isAbove`, `isBelow`). Nothing is stored from them. A practice range is an optional override (`paramsOverrideLabFlags`) or a substitute for an un-ranged result.
- Catalogue results have no range field yet. Needed: `ranges: [{ lab, unit (or code), low, high }]` on the result.

## 3. Design

### 3.1 Data (all in the catalogue overlay; inert until approved)
- **Result × lab filing setup** (one row of the table): practice range low/high (+ unit/reporting form), trend limit, safety-guard set, filing controls (visible text of the "Normal result, no action required" option / File button — defaults as today), `assisted filing enabled` flag, own **filing approval** (separate from the test-matching approval; approving one never approves the other).
- **Lab × report-group comment whitelist**: `[{ lab, groupHeading, phrase }]` — whole lab-generated comment text.
- **Decided (Nick, 2026-09-22):** `excludeIfMeds` is **per result**. "Block if the comment says…" (`suppressIfText`) and the comment whitelist are **per lab group** — only because that is how comments are sent; they usually name one result but parsing that is too unreliable, so the whole report is blocked unless the comment is whitelisted.
- **A report is offered for one-click filing only if:** every result in it is recognised by code (H-074 generalised), has an enabled + approved filing setup for that lab, passes its own range/trend/guards, and every comment residue is fully covered by that group's whitelist. One combined-bloods task passes only if *every* result passes — so "strictest-wins merging" stops being special code: each result carries its own guard and the whole task is blocked if any one blocks.

### 3.2 Whitelisted comments — matching rule (a safety change, see §5) — **matching rule, size floor and no-truncation IMPLEMENTED 2026-09-22 in `shared/lab-filing-utils.js` (tests in `test-lab-filing-utils.js`); per lab × group keying and practice-level approval still to do**
Real samples so far (2026-09-22): the lab's LFT note (≈304 characters, 45 words, 5 sentences); the eGFR/NICE note in its G2 variant (≈597 characters, 97 words, 6 sentences); and Nick's two stored entries — the G1 eGFR note and one entry that is two AKI-risk comments joined into one phrase (a single-comment residue is no longer excused by that joined entry: whitelist each comment separately).
- **Matching:** the whole comment residue must be explained by whitelisted text (one phrase, or several tiling it). No "residue *contains* phrase" and no "phrase contains residue". A whitelisted phrase + appended warning must **not** be excused.
- **Storage limit:** `allowComments` items used to be silently truncated to 500 characters. Nick's own stored entries are all under that (the G1 eGFR note is ~350–460 characters), but the longer G2 variant of the same lab note ("Mildly reduced eGFR, this may be appropriate…") is ~600 characters and could not have been stored whole; containment matching would have let a truncated copy still match. Limit raised to 2 000; **reject, never truncate**.
- **Minimum size (guard-rail, secondary to the rule above):** at least 6 words and 30 characters; reject entries made only of generic words (`normal`, `no action`, `within normal limits`). The generic-word list is to be reviewed if imaging (X-ray) reports ever trigger it regularly (unlikely assisted filing candidates).
- **Converting existing rules:** when the existing assisted filing rules are converted, their whitelisted comments are converted as they are and are EXPECTED TO FAIL (truncated / partial entries no longer excuse the whole comment) — that proves the tightened logic; they are then re-whitelisted from the real residue.
- **Who decides:** whitelisting is a practice-level decision. A local entry that is not in the practice-approved set does not act; a practice decision overrides local ones. Turning on is per **clinician**, not per machine.

### 3.3 Sync / approval (deferred — recorded so it is not lost)
Approvals maintained and enforced at practice level and polled out (same mechanics as code-cleanup); a central review/approval dashboard before anything polls out. Per-PC re-enabling of dozens of profiles is explicitly rejected as unworkable; current force-disabled-on-arrival stays until the practice-level mechanism exists.

### 3.4 Screen (Options → Investigations, each test card)
Row 1 (two columns): *How it is requested in Medicus* | *How it comes back from the lab*.
Then full-width rows: the two different "never" strips — **"Never counts as this test"** (matching, unchanged) and **"Never offer to file when…"** (filing, in the assisted filing colour) — then **one SNOMED table** (Name | Code | Core/Optional | Wordings | Units | Lab) with a differently coloured assisted filing section (practice range min | max | Safety guards | Filing controls | Enable assisted filing). Guards/controls open the existing Lab Filing panes; defaults "File results" / "Normal result, no action required". List filter and card tag: assisted filing enabled / disabled. A change to a range withdraws that result's filing approval.

### 3.5 Revisions agreed 2026-09-22 (later) — supersede anything above that says otherwise
- **Assisted filing is switched on and approved for a TEST at a LAB, never per result.** Medicus files a whole report group at once. The on/off switch lives on the lab x report-group entry (`filing.groups[].enabled`); ONE approval (`approveFilingForTest`) covers the report group(s) that identify the test, the practice ranges and safety guards of the test's results at that lab, the group's lab-comment settings, and the Medicus wording if changed. Any later change reopens only the item changed. The list badge ("assisted filing — awaiting approval") opens the test at its assisted filing bar; approval is only ever given there, where what it covers is shown.
- **Trend guard has a direction:** never offer to file if it has changed / increased / decreased by more than X% (an eGFR that rises or a creatinine that falls is good news; the opposite is not).
- **Medicus filing-screen wording is not lab-specific:** one practice-wide setting, pre-filled with the standard wording ("Normal result, no action required", "File results"), stored only if changed, needing approval only if changed. It never changes what is written to the record: the macro finds these controls on the live screen by their visible text, so it only has to match what Medicus shows (a Medicus wording change would otherwise make the macro fail closed).

## 4. Rollout (agreed)
- **E0** pure adapter + golden/differential tests + migration proposals with a **parity test** (every legacy `analytes` entry maps to a catalogue result, or the migration refuses and the legacy profile keeps running). Unwired.
- **E1** the catalogue may only ADD blockers to the live gate (union-only); a **separate, mandatory shadow log** (names, codes, blocker reasons, counts — never values) records where the catalogue would have unblocked something legacy blocks.
- **E2** opt-in `filingEngine` pref (default legacy, practice-profile published), per-result-and-lab enable, filing approval. `defaults.json` version bump + regen + lock.
- **E3** replacing legacy gates only after a stated period with no "would have unblocked" cases — CSO decision.
- Audit records engine + catalogue version + approval state at file time.

## 5. Gates that must never be weakened
Numeric-only "every numeric result needs a lab or practice range" (text results need none); unreadable-row block; parameter-ambiguity block (goes away with code-keyed ranges once dual-running stops); unit agreement; comparator-censored (">47") fail-closed and never clears a lab flag; H-074 "every result must be recognised"; `commitMode` manual|confirm only (in *manual* the person presses File; in *confirm* the person confirms a dialog listing every value and the macro then presses File); inert until reviewed and enabled.
**Existing weakness to fix first:** `_commentAllowedByProfile` matches by containment in both directions with no minimum length (H-073 open review item) — see §3.2.

## 6. Proposed hazards (not yet in `docs/HAZARD-LOG.md`)
- **H-080** — Catalogue-driven filing offers a wrong one-click "all normal". Controls: union-only, separate mandatory shadow, per-result-and-lab enable, separate filing approval, fail-closed code-based recognition, human confirm.
- **H-081 (revised)** — A practice range or guard attached to a result acts where it does not belong: a different lab, a different reporting form or unit (HbA1c %, mmol/mol; eGFR equation), or a result mis-identified as that analyte. Controls: key = (result × lab × unit/reporting form); unit must positively match; a range edit withdraws approval; code-based identification; range shown beside the lab's own range.
- **Amend H-073** (whitelist now per lab × group, matching rule, practice-level) and **H-074** (recognition by code / catalogue membership).
