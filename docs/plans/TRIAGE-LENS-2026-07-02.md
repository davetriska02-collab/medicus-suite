# Triage Lens Improvement Plan — 2026-07-02

Merged from three proposal rounds on the triage surface (`content-scripts/triage-lens/*`,
`engine/result-severity.js`, `engine/result-rules.js`, `engine/triage-alert-engine.js`,
the triage-lens options page and the lab-file / routine-rx macros):

- **Track A — safety & foundations** (engineering ten): fail-visible states, unit
  guard, write auditing, engine gaps, test gaps, single-source-of-truth debt.
- **Track B — lab/results screens** (GP-workflow ten): status bar, row tint, chip
  popovers, trend arrows, verdict continuity, fileable markers.
- **Track C — patient-request screens** (GP-workflow ten): match evidence,
  negation, symptom×context rules, Pharmacy First divert, ask-back templates.

Derived from four full-file audits (content.js, result-severity/result-rules,
options + macros, tests/docs/CHANGELOG survey) plus a virtual-Dave verdict pass.
Cross-checked against CHANGELOG through v3.147.0 and the shipped plans
(TOP10-USER-VALUE, CLASS-LEADERS, HORIZON1-UNBREAKABLE) so nothing already
shipped is re-proposed. **Excluded by standing decision:** alert snooze /
temporal suppression (gated on a hidden-resurfacing safety argument), rebuilds
of the DOM-contract canary or Clinical Event Ledger (shipped v3.145–3.146 —
this plan *reuses* both).

Item IDs carry their source (A/B/C + rank) so the three original lists remain
traceable. Effort: S / M / L.

---

## Phase 0 — Guardrails first (tests + one-line safety fixes)

Protects every later phase; nothing here changes what a GP sees except one
false-amber fix.

| # | Item | Source | Effort |
|---|---|---|---|
| 0.1 | **Live-grid injection smoke harness**: inject → Vue/AG-Grid churn → survive, against a fake grid. The chip-injection layer is the most-regressed surface in the suite (v3.67 append, v3.69 row-id) and is guarded today only by source-greps + static fixtures — the CHANGELOG itself flags this gap twice. Every new injected element in Phases 1–4 rides on this. | A8 | M |
| 0.2 | **Engine/macro test gaps**: `triage-alert-engine.js` `evaluate()` has zero tests (amber/red boundary, `threshold*2`, invalid-threshold skip); routine-rx macro untested (lab-file has `test-lab-file-macro.js`); `test-triage-rule-patterns.js` re-implements `compileRule` instead of importing `rule-match.js` (latent divergence). | A8 | S |
| 0.3 | **Blood-culture negation data fix**: bare `"candida"` / `"gram negative"` in `abnormalText` (defaults.json ~4387–4407) force false amber on explicitly negative reports ("Candida species NOT isolated"). One-line data fix; needs defaults version bump + un-stick entry. | A5 (split) | S |
| 0.4 | **Cheap attack-surface fixes**: `executeAction` opens `action.url` with no scheme check (content.js:1935) — allowlist http/https; backup import validates only `Array.isArray(rules)` (options.js:1004, 1047) — run the existing validators over imported content. | A6 (split) | S |
| 0.5 | **Analyte-matcher extraction**: the match/exclude/specimen logic is triplicated inside result-severity.js (129, 268, 339); extract one internal `analyteMatches()` + export the sub-evaluators for direct unit tests. Pure, low-risk; prerequisite hygiene for Phase 3 engine work. | A9 (low-risk half) | S/M |

## Phase 1 — Trust: the screen never lies

The single theme GPs feel most: today "not assessed", "fetch failed", and
"genuinely normal" all render identically.

| # | Item | Source | Effort |
|---|---|---|---|
| 1.1 | **Fail-visible "not assessed" states**: HUD shows "No flags" whether extraction failed or patient is clear (content.js:2026); a failed result fetch leaves a blank row (3391); the monitoring chip clears on most transient nulls (1648–1729, only the meds-fetch path preserves it); `findCardByTitle` exact `===` drops whole cards on a label change (656). Deliver: grey "not assessed" states + per-row status affordance (✓ assessed-normal / ○ not assessed / ⚠ couldn't check), conservative chip retention on transient error, normalised card matching with one-time warning. | A1 + B7 | L |
| 1.2 | **Triage status bar** replacing the passive legend (content.js:2725): "3 red · 7 amber · 22 normal · 8 still checking…" with live progress while chips fetch, **jump-to-next-red**, red/amber filter toggle. Covers both chip families (results + request rules). | B1 | M |
| 1.3 | **Severity row tint**: 2–3px red/amber left-edge tint on the row, re-applied on every `refreshQueueChips`. Pre-attentive queue scanning. | B2 | S |
| 1.4 | **Confirm/undo/audit for machine writes**: OIR auto-tick clears outstanding-request rows server-side with no confirm, undo, or audit entry (content.js:2583–2590 — only bulk is audited); routine-rx `auto` commit has no trail (routine-rx-button.js:348). Deliver: undoable toast listing auto-ticks, audit both into the Event Ledger. **Hazard-log entry required.** | A3 | M |

## Phase 2 — Evidence & next step at the chip (client-side, no new clinical content)

| # | Item | Source | Effort |
|---|---|---|---|
| 2.1 | **Match-evidence capture + highlight**: `rule-match.js` returns boolean only; return match offsets, show the matched sentence on chip hover and highlight trigger phrases in the opened submission. Shared with the options preview (parity test already pins the shared matcher). | C1 | M |
| 2.2 | **Result-chip detail popover**: value, reference range, sample date, prior value, and which rule fired — the evaluated report is fetched per row and currently discarded after grading. | B3 | M |
| 2.3 | **Surface the 78 alert rules' existing actions on queue chips**: every shipped rule already carries actions (notes/snippets/links) reachable only via the HUD; make queue rule-chips clickable with a popover. Pure surfacing of data already in `CONFIG`. | C6 | S/M |
| 2.4 | **Detail verdict banner**: opening a task re-shows the queue verdict ("2 abnormal: K⁺ 6.2 ↑ · eGFR 38 ↓") from the already-cached evaluation (`_queueResultCache` by taskUuid). Zero extra fetches. | B6 | S/M |
| 2.5 | **Rank & collapse multi-fire request chips**: top-severity chip + "+n", full list on hover (the lab side got de-dupe/stacking in v3.7x; requests never did). | C8 | S |
| 2.6 | **Trend arrow on result chips**: "Hb 82 ↓ (was 104, Mar)" from the per-result history the normaliser already builds (normalisers.js:546–570). Display only — no grading change. | B4 | M |
| 2.7 | **Guidance actions on result rules**: alert rules have actions, result rules don't; add the field + editor support so a K⁺ chip can carry the local hyperkalaemia pathway link / snippet. | B5 | M |

## Phase 3 — Smarter grading (engine + shipped config)

Everything here changes clinical behaviour: **Keeper-style source verification
+ CSO review per item**, and every changed shipped value needs the defaults
integer version bump **plus** a `RETIRED_*` un-stick entry (the v3.75.2 lesson
— merge is `{...shipped, ...cfg}`, changed values never reach existing installs
otherwise).

| # | Item | Source | Effort |
|---|---|---|---|
| 3.1 | **Unit-mismatch guard**: thresholds currently apply to the parsed number regardless of reported unit (`rule.unit` is display-only). Skip-and-flag when both units present and disagree; **fail open when the result has no unit** (Medicus often omits it — a naive check mass-suppresses rules). | A2 | M |
| 3.2 | **Close the qualitative fall-through**: unflagged non-numeric results ("Positive", "Detected") matched by no text rule score `none` → no chip (result-severity.js:249); text rules are amber-max so a positive blood culture can never be red (189). Surface unclassified qualitative results; allow designated text rules to reach red. | A4 | M |
| 3.3 | **Coverage-led calibration pass** on shipped resultRules: missing analytes lead (hypernatraemia, absolute creatinine/AKI, glucose, LFTs, high CRP/WCC, K⁺ 6.0–6.5 amber band) — those are missed alerts; then noise trims (HbA1c ≥48 red→amber: diagnostic, not urgent). | A5 (rest) | M/L |
| 3.4 | **Negation/history demotion for request rules**: "no chest pain" / "denies" / "last year" currently fire like "chest pain now". Detect negators in a window before the match and *demote visually* (grey outline "chest pain — negated?"), never suppress — escalate-only stance holds. | C2 | M |
| 3.5 | **Patient-context plumbing**, one job two faces: pass banner age/sex into `evaluateReportSeverity` (FIB-4 ≥2.67 over-calls >65s — guidance ~3.25; sex-blind Hb) **and** add optional AND-conditions to request rules (age band / sex / meds / problems) so "UTI + child", "UTI + male", "infection + methotrexate" can escalate. Fields are OR'd today; age is already extracted for the child/elder chips. | A10 + C3 | L |
| 3.6 | **Trend/delta rule kind**: rising creatinine (AKI), falling Hb, rising K⁺ — grading on the history 2.6 already surfaces. Biggest single build in the plan; deliberately after the hole-plugs. | A7 | L |

## Phase 4 — Workload off the GP

| # | Item | Source | Effort |
|---|---|---|---|
| 4.1 | **Pharmacy First divert chip**: `rules/reception-pathways.json` (CSO-signed 2026-06-14) already encodes per-pathway Pharmacy First eligibility with age bounds; match the submission → green "Pharmacy First eligible" chip + prepare-only templated redirect reply. | C4 | M |
| 4.2 | **Missing-info ask-back**: same file's red-flag question sets; compare submission text → "not mentioned: fever, loin pain, pregnancy" → one-click prepare (never send) a templated ask-back for exactly those gaps. | C5 | M/L |
| 4.3 | **Green routine rule set**: shipped rules are 25 red / 42 amber / 11 info — nothing marks *confidently routine* (med query → pharmacist, sick-note extension, admin). Mark the safe end so the green tail can be swept in one pass. **CSO review.** | C9 | S/M |
| 4.4 | **"All-normal, fileable" queue marker**: run the lab-file gate (already computes all-normal-no-blockers) from the queue and green-tick qualifying rows — reds first, batch the ticks. | B8 | M |
| 4.5 | **Repeat-contact chip**: tier 1 — "2 open requests from this patient" straight from current task-list bridge data (S); tier 2 — "3rd contact in 14 days" via light local history (M). | C7 | S→M |
| 4.6 | **Keyboard triage**: j/k row navigation, Enter open, n = next red/amber; pairs with the status bar. | B9 | S/M |
| 4.7 | **"Seen" session dimming**: dim rows opened this session; visual only, session-local, auto-undims on any severity change so it can never hide an escalation. **Hazard-log line stating it suppresses nothing** (lives near the gated snooze territory). | B10 | S/M |
| 4.8 | **Photo-missing prompt** for skin/rash/lump rules + ask-back template. Gated on a live-Medicus check that attachment presence is visible in task data. | C10 | S/M |

## Phase 5 — Debt & polish (background, interleave as capacity allows)

| # | Item | Source | Effort |
|---|---|---|---|
| 5.1 | **Migration machinery de-dup**: `mergeShippedDefaults` + RETIRED tables duplicated line-for-line options.js:95–201 vs content.js:369–497, hand-synced by comment. Highest-risk refactor in the plan — separate, test-gated job with `defaults-config-lock` green throughout. | A9 (high-risk half) | M/L |
| 5.2 | **`HIGH_RISK_DRUGS` consolidation**: content.js:1165 second source of truth vs `rules/drug-rules.json` (ACB was already consolidated; this wasn't). | A9 | S |
| 5.3 | **Remaining hardening sweep**: LLM alert-rule import gets the preview result-rule import already has; threshold red/amber ordering validation; `saveConfig` failures surfaced; macro `findByText` exact-match for commit controls; `STEP_RADIO_SELECTORS` narrowed; OIR cache TTLs. | A6 (rest) | M |
| 5.4 | **"What fired" Event Ledger viewer** in options — chip-fire history for alert-fatigue tuning (extends 1.4's ledger writes). | A7-adjacent | M |
| 5.5 | **Performance**: dedupe cross-flow `fetchAll` (monitoring vs result-suppress), scope the whole-DOM extract scans, coalesce the 250/1200ms double-run. | A-below | M |
| 5.6 | **Options UX**: unsaved-edits warning on tab switch; broaden Live preview beyond the `request` field. | A-below | S |

---

## Cross-cutting constraints

- **Shipped-config changes** (0.3, 2.7 defaults, 3.2, 3.3, 4.3): integer
  `version` bump in defaults.json, `node scripts/regen-defaults.js`,
  `node scripts/defaults-config-lock.js`; **changed values** additionally need a
  `RETIRED_*` un-stick entry or they strand on existing installs.
- **content.js edits**: `EMBEDDED_DEFAULTS` is byte-pinned to defaults.json
  (regen propagates); `test-dom-contracts-sync.js` greps mirrored selector
  literals — new injected elements should add contracts + fixtures to
  `shared/dom-contracts.js`, and 0.1's harness must cover them.
- **Clinical safety gates**: 1.4 (machine writes), all of Phase 3 (grading
  changes), 4.1/4.3 (diversion + green set), 4.7 (hazard-log line). Keeper
  verification for any new/changed rule content.
- **Version mapping**: Phase 0 → patch; Phases 1, 2, 3, 4 → one minor release
  each (or split; each phase is independently shippable). CHANGELOG entry per
  release as usual.

## Sequencing rationale

Phase 0 is a week of insurance: the smoke harness guards every injected element
that follows, and the two one-line safety fixes (candida false-amber, URL
scheme) shouldn't wait for anything. Phase 1 changes what the queue *feels*
like — honest, scannable, auditable — without touching clinical grading, so it
ships fast. Phase 2 is pure client-side value on data already fetched: no CSO
cycle needed, high GP-visible payoff. Phase 3 is where clinical sign-off
concentrates, deliberately after the trust/evidence groundwork so new grading
lands on a surface that can explain itself. Phase 4 converts trust into
workload reduction. Phase 5 interleaves.

**Suggested first fortnight: Phase 0 + Phase 1** (with 1.3 the day-one visible
win), then 2.1 + 2.2 + 2.3 as the first evidence slice.
