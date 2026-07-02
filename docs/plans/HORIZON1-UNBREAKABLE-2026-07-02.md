# Horizon 1 — Unbreakable: DOM-contract canaries & recorded-fixture CI — 2026-07-02

**Problem, evidenced:** three of the last six mainline fixes (v3.143.1 OIR
checkboxes, v3.143.2 assignee picker, and the v3.134.x-era selector work)
were regressions caused by Medicus silently changing frontend components.
Each was discovered by a clinician in clinic — for a safety tool that means
periods where features silently didn't fire and nobody knew. The current
defence (129+ unit-test files) covers pure logic; every one of these failures
was integration-shaped: a DOM contract broke.

**Goal:** the suite knows when Medicus has changed before a user does, and CI
knows before the suite does.

Target release: **v3.146.0** (minor). Read-only; no clinical-record writes;
no new tabs.

## Part 1 — DOM contract registry (single source of truth)

`shared/dom-contracts.js` — a declarative registry of every DOM selector
contract the suite depends on. Per contract:

- `id`, `description`, `feature` (owning feature + what degrades when broken)
- `pageMatch` (URL pattern / page kind where the contract applies)
- `anchor` (selector proving the surface is present and populated — e.g.
  "OIR rows exist")
- `target` (the selector the feature actually needs — e.g. the checkbox
  inside a row), plus `legacy` fallback selectors where the code keeps them
  (m-checkbox vs q-checkbox pattern from v3.143.1)
- `probe` semantics: FAIL only when `anchor` matches ≥1 and `target` matches
  0. Anchor absent → NOT_APPLICABLE (page empty/not loaded — never a false
  alarm).

Initial coverage (mine these from the code, don't guess): OIR rows/checkboxes
(`outstanding-match` / annotate/tick paths), routine-rx assignee picker
(`routine-rx-button.js` — `m-simple-select`, `[id^="select-item-"]`,
`[role="option"]`), lab-file filing controls (`lab-file-button.js`), queue
chip hosts (preview row / `[col-id="patientName"]`), booking-inline and
task-inline mount points and pickers, sentinel sidebar mount, and the
task-list/overview API-adjacent DOM the triage lens keys off.

**content.js constraint:** `content-scripts/triage-lens/content.js` must not
be edited (tests pin exact content). Its selectors are MIRRORED in the
registry, and `test-dom-contracts-sync.js` greps content.js for each mirrored
literal — if a future content.js change renames a selector without updating
the registry, CI fails. Consumers OUTSIDE content.js (outstanding-match /
OIR annotate+tick, routine-rx-button, lab-file-button, booking-inline,
task-inline) migrate to read their selectors FROM the registry so contract
and code cannot drift.

## Part 2 — Recorded-fixture integration tests

- `fixtures/medicus/*.html` — sanitised static snapshots of the Medicus DOM
  surfaces the contracts describe. Seed set is SYNTHESISED from the markup
  the code demonstrably handles today (both current `m-*` and legacy Quasar
  `q-*` variants, per the v3.143.1/.2 fixes and existing fake-DOM tests).
  Zero patient data: placeholder names/UUIDs only, and a comment header
  stating provenance ("synthesised from vX.Y.Z selector expectations").
- `test-dom-contracts.js` — for every contract: fixture exists, anchor
  matches, target matches; legacy fixtures still satisfied by fallbacks;
  probe semantics verified (anchor-present/target-absent → FAIL,
  anchor-absent → NOT_APPLICABLE). Use the repo's existing fake-DOM harness
  style (`test-lab-file-macro.js`) — no new test dependencies.
- `scripts/capture-fixture.js` — a page-console capture helper (the repo
  already has a page-console diagnostics culture, see CLAUDE.md): paste into
  the Medicus console on the target page, it clones the relevant subtree,
  strips text content/attributes that could carry PHI (names, dates, NHS
  numbers → placeholders), and downloads an HTML fixture ready to drop into
  `fixtures/medicus/`. This is how real fixtures replace synthesised ones
  over time; the README header in fixtures/ explains the workflow.

## Part 3 — Runtime canaries + suite-health surface

- `shared/contract-canary.js` — content-script-side prober: on page-ready
  and on the existing DOM-observer-hub's settled events (reuse
  `dom-observer-hub.js`, do NOT add new MutationObservers), evaluate the
  registry contracts whose `pageMatch` fits the current page. Debounced,
  cheap (querySelector counts only), never reads text content. Results
  written to `health.contracts` in chrome.storage.local: per contract
  {lastProbe, status: ok|degraded|not_applicable, sinceTs}. Machine-local,
  excluded from backup (extraction-health precedent — check how its keys are
  classified in the backup coverage tests).
- **Degraded = anchor present, target absent, persisting across ≥2 probes**
  (hysteresis so a mid-render never alarms).
- **Surface:**
  - Side panel: a calm one-line strip (same pattern family as the existing
    global strips in panel.html — follow the wr/rm/subRag strip conventions
    in CLAUDE.md) shown ONLY when ≥1 contract is degraded: "Medicus may have
    changed — [feature] degraded. Details in Options → Suite health." Must
    appear in pop-out too.
  - Options: "Suite health" card — table of contracts (feature, status, last
    checked, what degrades), refresh note, plain-English explanation that
    this is self-diagnosis of the extension's integration points, not a
    Medicus fault report.
- Ledger: one `health` event (patientRef null) when a contract transitions
  ok→degraded or degraded→ok, deduped per contract per day.

## Batching
1. **Batch H1 (pure/no-UI):** registry + fixtures + capture helper +
   test-dom-contracts.js + test-dom-contracts-sync.js + migrate the
   non-content.js consumers to read selectors from the registry (behaviour
   identical — regression-covered by existing tests, esp.
   test-outstanding-match.js and test-lab-file-macro.js).
2. **Batch H2 (runtime + surface):** contract-canary.js + storage +
   hysteresis + panel/pop-out degraded strip + Options Suite-health card +
   ledger events + backup-classification.
3. **Finisher:** manifest 3.145.0 → 3.146.0, CHANGELOG, tour check (no new
   steps expected — the strip is exceptional-state UI), full npm test +
   eslint + prettier, push.

## Ground rules (as previous batches, plus)
- Do NOT edit content-scripts/triage-lens/content.js or either defaults.json.
- Migration must be behaviour-preserving: same selectors, same fallback
  order — the registry is a relocation of truth, not a redesign. Existing
  tests must pass unmodified except where they hard-code file paths.
- Canary must never touch or store text content from the page (PHI risk) —
  counts and booleans only.
- False-positive discipline beats coverage: a contract that can't be probed
  without false alarms ships as fixture-tested only (registry flag
  `runtime: false`), documented why.
- New storage key `health.contracts` → machine-local exclusion path in
  backup coverage (extraction-health/ledger precedent).
