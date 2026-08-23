# Architecture Evolution Plan — 2026-08-22

**Status:** in progress — Phase 0–1 shipped (v3.236.27–.28); Phase 2 complete (v3.236.29–.30); Phase 3.1/3.2/3.5 shipped. Remaining: Phase 3.3–3.4 inversions, Phase 4 god-file stranglers, Phase 5.1–5.3.
**Scope:** the whole suite (side-panel, pop-out, content-scripts, engine, rules, shared, options, full-tab apps, rota)
**Baseline:** v3.236.25 (`main` @ 7816ffc)
**Method:** four-phase repo audit (discovery → evidence-based findings → strategy → phased plan), evidence gathered by parallel subsystem surveys of the shell, the write path, engine/rules/tests, and the shared/IO layers, cross-checked against `docs/CLINICAL-SAFETY-NOTICE.md`, `docs/INTENDED-PURPOSE.md`, `manifest.json`, and the CI workflows.

---

## Executive summary

**Health grade: B+.** For a no-build MV3 extension of this scale (20 side-panel modules,
~45 content scripts, 21 enumerated write surfaces, ~211 test files) the suite is in
unusually good shape where it matters most: the safety invariants are *real, enumerated,
and CI-enforced*, not aspirational. The debt is concentrated in one structural fact and
its consequences.

**The organizing insight: the test suite is the load-bearing architecture.** Because the
dual module system (classic IIFE scripts in content-script/options/visualiser contexts
vs ES modules in the panel/pop-out/rota) prevents code sharing across contexts, the suite
has settled on *CI-guarded duplication* instead of structural sharing — the `-sync`
tests, the write-path grep, the defaults config-lock, the three-copy `defaults.json`.
This was the right trade at the time and the tests say so explicitly
(`test-clinical-thresholds-sync.js:13–16`: "FUTURE OPTION… Extract a shared module…
deferred"). But every new module adds to the duplicated surface, and each sync pair is a
latent silent-drift hazard *between* the moment someone edits one copy and the moment CI
runs. The evolution path below therefore follows one rule everywhere: **strengthen the
guard first, then consolidate the duplication into a shared module, then retire the sync
test into a cheaper consumption test — never the reverse order.**

**Top 3 risks (today):**

1. **`content-scripts/triage-lens/content.js` (8,108 lines)** — ten responsibilities in
   one file that is excluded from Prettier, pinned by exact-content tests, and hosts the
   queue-injection invariants that have caused three shipped regressions
   (v3.67.0 append, v3.69.0 row-id keying, v3.204.x layout). Every change to any of its
   responsibilities risks all of them.
2. **Write-path inventory grep is narrower than the claim it guards.**
   `test-write-path-inventory.js:38` matches only the literal `method: 'POST'` /
   `method: "POST"`. A `PUT`/`PATCH`/`DELETE`, a method held in a variable, or a POST in
   a tree outside the scan list would ship without a CSN W-id — silently breaking the
   §6.1 claim "if a capability is not in this table, the software cannot do it."
3. **Registration sprawl** — a new module touches 10–16 files across 8 hand-maintained
   lists; the two `MODULES` maps (`panel.js:120–150`, `pop-out/pop-out.js:19–87`) have
   **no parity test** (the HTML navs do). The failure mode is a module that silently
   doesn't exist in one shell.

**Top 3 opportunities:**

1. **The dual-mode IIFE pattern is already the escape hatch.** `shared/write-core.js`
   and `shared/extraction-health.js` prove a single file can serve classic scripts *and*
   Node tests. Most `-sync`-guarded duplication (STATUS_RANK, KDIGO thresholds, pill
   palette JS, negation guards, PINCER tables) can collapse into dual-mode single
   sources without touching the module system at all.
2. **`rota/` is the finished article.** A self-contained ESM app with a genuinely pure
   engine (no DOM/`chrome.*`/`fetch`), its isolation verified: nothing in `rota/`
   imports suite files. It is the internal proof that the target layering works in this
   repo; suite `engine/` can converge on it incrementally.
3. **The registry pattern already half-exists.** `tab-catalog.js` is a single source of
   truth with a CI parity guard, and the command palette derives its commands from live
   DOM instead of a third list. Extending the catalog into a full module registry
   collapses 8 lists into 1 + generated artifacts.

---

## Repo map (what the architecture actually is)

**Purpose.** A Chrome MV3 "thin augmentation layer" over the Medicus EPR for UK GP
practices: read-and-overlay by default, with a small enumerated set of user-initiated,
confirmed writes through Medicus's own endpoints/controls (CSN §6.1, W1–W21). Local-only
by default; every egress exception is named (`manifest.json:7–14`: Medicus origins,
GitHub version check, NHS A-Z, SNOMED term browser, optional Supabase for the dormant
transactional proxy and opt-in task presence).

**Contexts and module systems** (the fact that shapes everything — there is no bundler,
and that is deliberate):

| Context | Module system | How shared code arrives |
|---|---|---|
| Content scripts (5 manifest groups) | Classic scripts, ordered | `manifest.json` `js:` lists (engine + shared files listed directly) |
| Side panel / pop-out | ESM (`panel.js`, module dirs) after ~40 classic `<script>` tags | classic globals (`window.ChipRenderer`…) + a few ESM imports (`medicus-api`, `booking-core`, `panel-txn-feed`) |
| Options / sentinel-options / visualiser / duplicate-checker | Classic scripts | `<script src>` lists in the HTML |
| Service worker | `importScripts` | txn + presence stack only |
| Full-tab apps (practice-report, cqc-readiness) | Classic APIs + ESM controller | mixed; `practice-report.js` ESM-imports **into** `side-panel/modules/condor/` |
| `rota/` | Pure ESM, own `package.json` | self-contained; nothing imports suite files |
| Node tests | `require()` | the same files, via dual-mode IIFE exports |

**Layers as they exist:** `rules/*.json` (data) → `engine/` (evaluators — *mostly* pure,
plus impure adapters: `api-client`, `data-fetcher`, `extractors/`, `normalisers`) →
`shared/` (~62 files: pure `*-core`, API clients, txn migration stack, storage/IO, UI
helpers, safety infra — a grab-bag by folder but with **no upward imports** into
side-panel or content-scripts) → surfaces (panel modules, content scripts, full-tab
apps). `shared/io/` (~24 files) implements the backup envelope convention, coverage-
guarded by `test-backup-coverage.js` (120 keys used / 81 covered / 56 allowlisted).

**Safety invariants and where they live** (all must survive every phase):

| Invariant | Enforcement |
|---|---|
| Every Medicus write has a CSN §6.1 W-row | `test-write-path-inventory.js` (source grep, fail-closed) |
| Identity pin + commit-time re-verify (H-043) | per-surface code + CSN table; convention, partially test-pinned |
| No completion claims on unconfirmed writes | `shared/write-core.js` + `test-reception-quick-actions-ui.js` string grep |
| Wrong-patient display protection | serialized module loader (`module-loader.js:55–61`), sentinel snapshot invalidation + `test-sentinel-nav-detection.js` |
| Local-only default / no PHI at rest beyond named working copies | `scripts/check-no-patient-data.js` + `test-no-patient-data-guard.js` (commit-time), event-ledger UUID sanitisation |
| Shipped-config reaches existing installs | `defaults.json` integer version + `scripts/defaults-config-lock.js --check` (fail-closed) |
| Clinical rule content pinned | `test-drug-brand-coverage.js`, `test-alert-library-coverage.js`, `test-rule-currency.js` (live date check), weekly `rule-currency.yml` |
| Cross-copy consistency | the `-sync` family: `status-rank`, `clinical-thresholds`, `pill-palette`, `dom-contracts`, `pincer-parity`, defaults 3-copy regen check |
| Queue-injection durability | `test-queue-injection-smoke.js` + CLAUDE.md non-negotiables (PREPEND, durable row map, token scope) |
| Shell registration parity | `test-tab-catalog.js`, `test-tab-help-coverage.js`, `test-module-lifecycle.js`, `test-tour-steps.js` |

**What surprised the audit** (facts, not judgments): the panel now has **six** alert
strips plus a roll-up (`panel.html:608–620`) while CLAUDE.md documents four;
`docs/sentinel-README.md` still describes a floating read-only sidebar that no longer
exists; `WriteCore` — extracted precisely so the v3.236.3 class of bug "cannot be
re-copied as a one-off" — is consumed by exactly one canvas; the `txn` storage prefix is
not in `test-backup-coverage.js` `KEY_PREFIXES`, so `txn.*` keys are invisible to the
coverage scanner; and `docs/TRANSACTIONAL-API-INTEGRATION.md:37` describes hybrid mode
as "txn first, session fallback" while the code (`engine/data-fetcher.js:334–342`) is
session-first with a txn shadow.

---

## Audit findings (evidence-based, severity-rated)

Facts are cited; severity is a judgment of clinical-regression + growth-friction risk.

### High

**F1. `triage-lens/content.js` is a 8,108-line god file hosting ten separable
responsibilities** — boot/config, date/threshold helpers, page routing, DOM extractors,
signal computation, monitoring overlay, HUD UI, OIR matcher, queue decoration +
monitoring chips, result-triage fetch/cache/inject, status bar/keyboard triage, sort
canary/SPA routing. It is Prettier-excluded, and multiple tests pin its exact content
(`test-dom-contracts-sync.js` greps its selectors verbatim). The queue-injection
invariants that produced three shipped regressions live here. *Why it matters:* every
new chip family or triage feature edits this file; blast radius is the entire in-page
surface. Precedent for the fix already exists in-repo: `queue-pulse.js`,
`lab-file-button.js`, `routine-rx-button.js` are companion classic scripts in the same
world.

**F2. The write-path grep under-matches its claim.** `test-write-path-inventory.js:38`
(`/method:\s*['"]POST['"]/`) misses: non-POST mutating verbs; `method` held in a
variable or built dynamically; writes in trees outside the scan list (`engine/` is
scanned only for one file; root-level JS like `cqc-readiness.js` not at all —
currently harmless, but the scan list is hand-maintained). The CSN §6.1 completeness
claim is the single most important safety statement in the product; its guard should be
strictly stronger than the ways a write can be expressed.

**F3. Registration sprawl: 8 hand-maintained lists, 10–16 files to add one module.**
Lists: `panel.js` `MODULES`, `pop-out.js` `MODULES`, `panel.html` nav, `pop-out.html`
nav, `tab-catalog.js`, `shared/tab-help.js`, tour steps/overview set, plus optional
`G_CHORD_MAP` (`panel.js:407–422`), About cards (~9 cards vs 19 modules — already
stale), options IO wiring (6 more touch points per `suite-envelope.js:19–25`). The two
JS `MODULES` maps have **no parity test**. *Why it matters:* this is the direct cost of
"easier to add modules without risking regressions" — today the risk is a missed list,
and one of the eight is unguarded.

### Medium

**F4. Sync-guarded duplication is growing, not shrinking.** Current inventory:
`STATUS_RANK` (`engine/rules-engine.js` ↔ `sentinel-core.js:24–28`), KDIGO/clinical
thresholds (trends ↔ visualiser), pill palette (3 places incl. CSS), negation guards
(`engine/result-severity.js:222–239` reimplements `rule-match.js` "in lock-step"),
PINCER (visualiser ↔ content.js, `test-pincer-parity.js`), rota validation
(`shared/io/rota-io.js:50–54` ↔ `rota/engine/validate.js`), `RETIRED_CHIP_LABELS`
(content.js ↔ options.js), `defaults.json` ×3. Each is individually rational; the *set*
scales linearly with features and each pair is only safe between CI runs, not between
keystrokes.

**F5. Cross-module sibling imports create hidden hubs.** `sentinel.js` imports
`../followups/followups.js` (a module *entry point*, not a core), plus followups-core,
sweep-core, patient-alerts-core; `today.js` imports five sibling cores; `record` →
sentinel-core; `signing`/`condor` → submissions-core; and `panel.js` itself imports
module cores for its strips. Two direction inversions: `side-panel/modules/shared/booking-panel.js`
→ `../slots/booking-api.js` (shared → specific module), and `practice-report.js` (a
full-tab app) → `side-panel/modules/condor/…` internals. *Why it matters:* "module"
currently means "tab", not "unit with a boundary". Removing or reworking followups,
sweep, submissions, or slots silently breaks four other tabs plus the shell.

**F6. `engine/` is not the pure layer its position implies.** Impure members:
`api-client.js` (fetch/DOM + requires `shared/dom-contracts.js` — the one downward
leak), `data-fetcher.js` (DOM + `chrome.*`), `extractors/*` (DOM walkers),
`normalisers.js` (soft DOM fallback), `cqc-evidence.js` (getURL/fetch helpers). The
pure majority (`rules-engine`, `result-severity`, `result-rules`,
`triage-alert-engine`, `acb-scores`, `stopp-start`, `eval-cache`, …) is not marked or
enforced as such — unlike `rota/engine/`, whose purity is documented in
`eslint.config.mjs:58–61` and holds. *Why it matters:* consumers (SW, tests, future
surfaces) cannot assume any engine file is context-free, and nothing stops a future
edit adding `fetch` to an evaluator.

**F7. Cross-context messaging is ~25 ad-hoc strings with hand-rolled sender gates.** No
constants module, no schema; `sender.id !== chrome.runtime.id` guards are repeated per
handler and their absence in a new handler is invisible to CI. A name collision or a
missed gate is a real (if modest) injection surface, already noted in the SW's own
comments.

**F8. Backup coverage scanner blind spots.** `txn` prefix absent from `KEY_PREFIXES`
(`test-backup-coverage.js:93–128`) — the documented backup-exclusion of
`txn.callerKey` is enforced only by omission, not by the drift test. Scope/key naming
is inconsistent (`triage` scope vs `triagelens.*` keys; `pdc.*` vs scope
`problemDescriptionCleanup`). Low blast radius today; grows with every new namespace.

### Low

**F9. Doc drift on load-bearing docs.** CLAUDE.md says four strips (there are six +
roll-up); `sentinel-README.md` describes retired architecture;
`TRANSACTIONAL-API-INTEGRATION.md` hybrid description contradicts
`data-fetcher.js:334–342`. In a repo whose safety case leans on docs matching code,
drift in *developer-facing* docs is how conventions stop being followed.

**F10. `WriteCore` adopted by one of many write canvases.** The helper exists to make
the "settled ≠ landed" rule un-recopyable, but nothing requires new Finalise surfaces to
use it — the string-grep test covers only reception quick-actions.

**F11. `panel.js` (2,478 lines) is shell + six strips + roll-up bus + keyboard + About.**
Each new strip grows the shell and imports more module internals into it.

### Strengths (kept short, per the audit method)

Serialized module loader with documented wrong-patient rationale; tab catalog +
help/tour/lifecycle parity tests; the IO/backup envelope with a coverage scanner;
fail-closed CI (patient-data guard, config locks, doc-version check, vendored-lib
hashes, Playwright CSP gate); the txn migration as a reversible, shadow-verified seam
with the credential isolated in the SW; `dom-contracts` + runtime canary;
`dom-observer-hub` with honest "efficiency-only" contract; rota's isolation; and a
hazard-log culture that records honest gaps instead of papering over them.

---

## Improvement strategy — four themes

**T1. Make the guards stronger than the failure modes** (feeds F2, F3, F7, F8, F10).
Target state: every invariant the safety case claims has a guard that fails closed on
*every* way of violating it, not just the common way. Principle: in this codebase, a
guard is cheaper and safer than a refactor — so guards land first, always.

**T2. One registry, generated surfaces** (feeds F3, F11). Target state: adding a module
= one directory + one registry entry (+ one IO file if it stores). Everything else —
both `MODULES` maps, both navs, help/tour/catalog parity, G-chords, About cards — is
either derived from the registry at boot or parity-tested against it. Principle: the
palette already proved derive-from-source beats maintain-a-copy.

**T3. Collapse sync-pairs into dual-mode single sources** (feeds F4, F6, F10). Target
state: each `-sync` test becomes a consumption assertion ("both consumers import the
shared module") and the constants live once, in a dual-mode IIFE file loadable from
every context. Principle: the repo already invented its own solution
(`write-core.js`, `extraction-health.js`) — apply it to the remaining pairs, and mark +
enforce engine purity the way rota does.

**T4. Strangle the god files along proven seams** (feeds F1, F5, F11). Target state:
`content.js` becomes a thin orchestrator over companion classic scripts (the
`queue-pulse.js` precedent); `panel.js` strips become self-registering ES modules with
a common strip contract; sibling-module imports go through `*-core.js` files only.
Principle: extraction PRs move code verbatim and never change behavior in the same PR.

**What we are deliberately NOT doing, and why:**

- **No bundler, no TypeScript migration.** The no-build property is load-bearing: tests
  grep shipped source, the CSP story stays trivial, and a clinician-auditable 1:1
  mapping between repo files and shipped files is part of the safety posture. The
  dual-mode IIFE tax is real but bounded; a build step would invalidate dozens of
  guards at once.
- **No rewrite of `rules-engine.js` or the evaluators.** 2,590 lines but pure, heavily
  tested, and clinically pinned. Splitting it buys nothing the tests don't already
  provide.
- **No elimination of the `defaults.json` triple copy.** The embedded copy is a
  deliberate offline bootstrap; `regen-defaults.js --check` already makes drift
  impossible. Cost of removal exceeds the (zero, post-guard) risk.
- **No merging of `rota/` into suite trees.** Its isolation is the model, not the
  problem. The compact-panel companion importing `rota/engine` is an accepted,
  test-covered public surface.
- **No change to any write-surface UX or control** (confirm flows, identity pins,
  commit copy). This plan moves code around writes; it never touches what a write does.

---

## Phased plan

Ordering rule: each phase makes the next one safer. Phases are independently valuable;
stopping after any phase leaves the repo strictly better. Effort: S <2h, M half-day,
L 1–2 days of focused agent/engineer work, XL needs its own breakdown — used here as
sizing of scope, not calendar commitments.

### Phase 0 — Safety net: make the guards stronger before moving anything

*Theme T1. Everything here is additive (new tests, list entries, doc fixes) — no
product code moves.*

| # | Task | Files | Effort |
|---|---|---|---|
| 0.1 | **Widen the write-path grep**: match `method` with any of POST/PUT/PATCH/DELETE, flag `method:` with a non-literal value for manual mapping, and assert the scan-tree list covers every dir that `manifest.json`/HTML pages load product JS from (auto-derive, don't hand-list) | `test-write-path-inventory.js` | M |
| 0.2 | **MODULES parity test**: parse both shells' `MODULES` maps (same technique as `test-module-lifecycle.js`) and assert same keys modulo the documented panel-only set | new `test-modules-parity.js` | S |
| 0.3 | **Referenced-files-exist test**: every path in `manifest.json` `js`/`css`/WAR and every `<script src>`/`<link href>` in shipped HTML resolves on disk — the prerequisite that makes later file moves safe | new `test-load-graph.js` | S |
| 0.4 | **Backup scanner**: add `txn` to `KEY_PREFIXES`; add explicit ALLOWLIST entries (with reasons) for deliberately-excluded keys like `txn.callerKey` so exclusion is a recorded decision, not an omission | `test-backup-coverage.js` | S |
| 0.5 | **WriteCore adoption guard**: source-grep test that any file staging a multi-row Finalise (heuristic: uses the confirm-copy strings or a landed-list diff) references `WriteCore`; seed with current canvases | new test | S |
| 0.6 | **Message-string inventory test**: enumerate `action:`/`type:` literals in `sendMessage` calls and handlers; assert every handled string is sent and vice versa; assert every `onMessage` handler file contains a sender gate | new `test-message-contract.js` | M |
| 0.7 | **Doc re-sync**: CLAUDE.md strips 4→6+roll-up; `sentinel-README.md` architecture; `TRANSACTIONAL-API-INTEGRATION.md` hybrid = session-display + shadow | docs | S |

**Risk analysis — Phase 0: LOW.** Additive guards can't regress runtime behavior. Two
real risks: (a) *the new guards find existing violations* — that is the purpose; triage
each finding as fix-or-allowlist-with-reason before merging the guard; (b) *0.6 false
positives* on dynamically-built message strings — start warn-listed, tighten after one
release. Rollback: delete the new test. **Done signals:** CI fails on a synthetic
`method: 'PUT'` write without a W-id; CI fails on a module present in one shell's
`MODULES` only; CI fails on a manifest path that doesn't resolve.

### Phase 1 — One module registry

*Theme T2. Collapse the 8 registration lists.*

| # | Task | Files | Effort |
|---|---|---|---|
| 1.1 | Extend `tab-catalog.js` entries with: `css`/`entry` paths, `shells: ['panel','popout']`, `special` (full-tab opener kind), `gChord`, and move help text in from `shared/tab-help.js` (or link by id) | `side-panel/tab-catalog.js` | M |
| 1.2 | Derive both `MODULES` maps from the registry (import-path strings → `() => import(...)` thunks built at boot); keep static nav HTML but make `test-tab-catalog.js` assert nav ↔ registry both shells (it half-does this today) | `panel.js`, `pop-out.js`, tests | M |
| 1.3 | Derive `G_CHORD_MAP` and the About cards from the registry (About card body can stay hand-written per module, keyed by id, with a coverage assertion) | `panel.js` | S |
| 1.4 | Update CLAUDE.md "Adding a new side-panel module" to the new (shorter) checklist | docs | S |

**Risk analysis — Phase 1: MEDIUM.** This touches the shell boot path of both shells.
Failure modes: a registry-derived import path typo (caught by `test-module-lifecycle.js`
+ 0.3's load-graph test); a panel-only tab leaking into the pop-out (caught by the
existing `test-tab-help-coverage.js` parity + 0.2). The loader itself
(`module-loader.js`) — which carries the wrong-patient-display serialization invariant —
is **not modified**. No clinical logic, no content scripts, no write path touched.
Mitigation: land as two PRs (registry shape first with both old maps asserted equal to
the derived map; then delete the old maps). Rollback: revert to literal maps — the
registry remains as the catalog it already was. **Done signals:** adding a test module
requires touching exactly 1 registry entry + module dir (+ IO if storing);
`test-modules-parity.js` becomes vacuous and is retired.

### Phase 2 — Collapse the sync-pairs

*Theme T3. One pair per PR, always in this order: extract byte-identical shared module →
point both consumers at it → convert the sync test to a consumption test → only then
allow the values to change.*

| # | Pair | New single source | Effort |
|---|---|---|---|
| 2.1 | `STATUS_RANK` (rules-engine ↔ sentinel-core) | `shared/status-rank.js` (dual-mode; ESM consumers read the global set by the classic script already loaded in panel.html — same trick `booking-core` uses in reverse) | S |
| 2.2 | KDIGO / clinical thresholds (trends ↔ visualiser) | `shared/clinical-thresholds.js` — **flagged to CSO as a no-value-change refactor**; `test-clinical-thresholds-sync.js` retires into a consumption + value-pin test | M |
| 2.3 | Pill palette JS copies | `shared/pill-palette.js`; the CSS copy keeps a slim sync test (CSS can't import JS) | S |
| 2.4 | Negation guards (`result-severity` ↔ `rule-match`) | extract to `engine/negation-terms.js`, loaded before both in every context (manifest + HTML order; verified by 0.3) | M |
| 2.5 | `RETIRED_CHIP_LABELS` / `RETIRED_RESULTRULE_FIELDS` (content.js ↔ triage options.js) | move into `defaults.json` itself (it already carries the version lock) or a shared classic script; config-lock covers it | M |
| 2.6 | PINCER tables (visualiser ↔ content.js) | `engine/pincer-tables.js`; `test-pincer-parity.js` becomes the consumption test | M |
| 2.7 | rota-io validation ↔ `rota/engine/validate.js` | leave duplicated (classic ↔ ESM boundary is real here); document as the accepted exception | — |

**Risk analysis — Phase 2: MEDIUM, concentrated in 2.2 and 2.4–2.6 because the values
are clinical.** Failure modes: (a) *load-order regression* — a consumer runs before the
new shared file loads; mitigated by 0.3's load-graph test plus each consumer keeping a
hard throw (not a silent fallback) if the global is absent; (b) *accidental value drift
during extraction* — mitigated by keeping the old sync test in place during the
extraction PR (it now compares consumer copies to the shared source) and deleting it
only in the follow-up PR; (c) 2.5 touches `defaults.json`, so the config-lock version
bump rules apply — follow them, don't fight them. Each pair is independently
revertable. **Done signals:** grep for `RETIRED_CHIP_LABELS` finds one definition;
the `-sync` test family asserts imports, not parallel literals; a threshold change is a
one-file diff + CSO review, not a two-file synchronized edit.

### Phase 3 — Layering: mark and enforce purity; fix the inversions

*Themes T3/T1. No mass file moves — boundaries by lint + test, the way rota does it,
because `manifest.json` and a dozen HTML files hard-code current paths.*

| # | Task | Files | Effort |
|---|---|---|---|
| 3.1 | **Engine purity manifest**: a declared list of pure engine files; new test asserts none of them contains `document.`, `chrome.`, `fetch(`, `localStorage` (same discipline `rota/engine` gets from `eslint.config.mjs:58–61`); impure members (`api-client`, `data-fetcher`, `extractors/`, `normalisers`, `cqc-evidence` I/O half) are named as **adapters** in the same file with reasons | new `test-engine-purity.js`, eslint config | M |
| 3.2 | **shared/ level tags**: adopt the naming convention already half-present (`*-core` = pure, `*-api` = network, `*-io` = storage, UI helpers) as a documented table in CLAUDE.md + a purity test for every `*-core.js` file | docs, new test | M |
| 3.3 | **Fix the shared→module inversion**: move `slots/booking-api.js`'s shim surface so `modules/shared/booking-panel*` no longer imports from a sibling module; this file is W1-mapped, so the same PR updates `test-write-path-inventory.js` `FILE_TO_WIDS` and the CSN table's "where it lives" cell — Phase 0.1's stronger guard makes a silent miss impossible | `side-panel/modules/shared/`, inventory test, CSN | M |
| 3.4 | **Fix the full-tab inversion**: extract the condor report-data functions `practice-report.js` imports into a shared core (pure), leaving condor importing it too | `side-panel/modules/condor/`, `practice-report.js` | M |
| 3.5 | **Sibling-import rule**: lint boundary — a module may import another module's `*-core.js` but never its entry file; fix the one violation (`sentinel.js` → `followups/followups.js`: move `addFollowup` into `followups-core.js`) | eslint config, sentinel, followups | M |

**Risk analysis — Phase 3: MEDIUM-LOW.** 3.1/3.2 are pure guards (LOW — same rollback
story as Phase 0). 3.3 is the riskiest single task in the phase because it moves a
**write-surface file (W1/W12)**: mitigations — the move is a re-export shim first
(old path re-exports new path for one release), the CSN "where it lives" column and the
inventory map update in the same commit, and `test-write-path-inventory.js` +
`test-load-graph.js` both fail closed on a miss. 3.5 touches Sentinel's imports but not
its logic; `test-module-lifecycle.js` and the sentinel tests cover it. **Done signals:**
CI fails on `fetch(` added to `rules-engine.js`; no module imports another module's
entry file; `practice-report.js` imports nothing under `side-panel/modules/`.

### Phase 4 — Strangle the god files

*Theme T4. Verbatim-move extractions only; behavior changes always in separate PRs.
This phase is where the "add modules without risking Sentinel/write-path regressions"
goal is finally structural rather than test-enforced.*

| # | Task | Approach | Effort |
|---|---|---|---|
| 4.1 | **`panel.js` strips → `side-panel/strips/<name>.js`** (six strips + roll-up bus), each an ES module with a common contract (`initStrip(el, bus)` → cleanup), shell keeps orchestration; strips that import module cores keep doing so — the coupling becomes visible per-strip instead of pooled in the shell | ESM extraction, panel-only | L |
| 4.2 | **`content.js` extraction, stage 1 — pure logic**: date/threshold helpers, signal computation, chip ranking → companion classic scripts loaded *before* `content.js` in the manifest (the `rule-match.js`/`queue-pulse.js` precedent). Tests that grep `content.js` for these regions re-point at the new files | classic-script extraction | L |
| 4.3 | **`content.js` stage 2 — OIR matcher + observer** (lines ~3024–3625) → `triage-lens/oir-adapter.js` | classic-script extraction | L |
| 4.4 | **`content.js` stage 3 — result-triage queue layer** (~4774–6164): fetch/cache/inject including `_durableRowMap` + `_queueResultCache`. **The queue-injection invariants move as one unit, never split**; `test-queue-injection-smoke.js` runs against the new file; verify on live Medicus with the page-console capture playbook from CLAUDE.md before release | classic-script extraction | XL → break down at the time |
| 4.5 | **`content.js` stage 4 — HUD UI** (~2058–2915) vs orchestration; `content.js` ends as boot + routing + orchestration (~1.5–2k lines) | classic-script extraction | L |
| 4.6 | **`options/options.js` (4,873 lines)**: split backup orchestration (`doFullExport`/`applyEnvelope`/preview) from per-feature settings sections; backup half becomes the natural home for a future registry-driven IO loop | classic-script extraction | L |

**Risk analysis — Phase 4: HIGH for 4.2–4.5, MEDIUM for 4.1/4.6 — this phase is why
Phases 0–3 exist.** Specific failure modes and mitigations:

- *Load-order breakage* (a helper referenced before its new file loads): every
  extraction adds the file to the manifest **above** `content.js`; 0.3's load-graph
  test plus `node --check` in CI; each new file throws loudly if its dependencies are
  absent rather than soft-failing (a soft-fail here is a silent loss of clinical chips —
  the exact failure class CLAUDE.md's debugging section documents).
- *Invariant fragmentation*: the PREPEND/durable-map/token-scope rules and their state
  stay in one file (4.4), never divided; the smoke test and the CSS token-scope
  selector list are updated in the same commit.
- *Test-pin churn*: tests that grep `content.js` content are re-pointed in the same PR
  as each move, so a regression window never opens.
- *Release verification*: each content.js stage ships as its own patch release and is
  verified on live Medicus with the timed lifecycle poll (peak/final chip counts)
  before the next stage starts. If a stage regresses, revert is a single-PR revert.
- *Prettier/lint*: extracted files are new files — they enter the normal lint/format
  regime, shrinking the Prettier-excluded surface with every stage.

**Done signals:** `content.js` < 2,000 lines and no longer Prettier-excluded as a
whole; a new chip family is a new companion file + token-scope entry, not a content.js
edit; `panel.js` < 1,200 lines; a new strip is a new file conforming to the strip
contract.

### Phase 5 — Platform seams for the next 20 modules (optional, prioritize on demand)

| # | Task | Effort |
|---|---|---|
| 5.1 | Promote 0.6's message inventory into `shared/messages.js` (named constants + a `gatedListener(handler)` helper that enforces the sender check); adopt incrementally — the test from 0.6 keeps raw strings and constants in lock-step during the transition | M |
| 5.2 | Registry-driven backup IO: `suite-envelope.js` + `options.js` derive the exporter loop from a declared scope→IO-module table, collapsing the 6-touch-point checklist to 2 (IO file + table entry + HTML card) | M |
| 5.3 | Observer-hub adoption for the remaining private MutationObservers where the hub's contract fits (`appointment-organise-canvas.js`); Sentinel's dedicated observer stays — it is intentional and latency-sensitive | S |
| 5.4 | A `scripts/new-module.js` scaffolder that writes the module dir, registry entry, IO file skeleton, and help/tour stubs — turning the CLAUDE.md checklist into code | M |

**Risk analysis — Phase 5: LOW-MEDIUM.** 5.1's risk is a missed rename breaking a
message route — mitigated by 0.6's inventory test failing on any string not in the
constants list. 5.2 touches the backup path: land with a fixture-based round-trip test
(export → import → deep-equal) across all scopes before switching the loop. 5.3/5.4 are
additive.

---

## How each stated requirement is preserved

- **Every safety invariant / local-only principle:** Phase 0 strengthens their guards
  before anything moves; no phase edits a confirm flow, an identity pin, an egress
  path, or a storage posture. Where a write-surface *file* moves (3.3), the CSN, the
  inventory test, and the code move in one commit under a guard that now catches every
  mutating verb.
- **Reduced coupling as the suite grows:** Phase 1 removes the O(8-lists) registration
  cost; Phase 3 makes layer and sibling boundaries lint-enforced; Phase 4 turns the two
  god files into bounded units; Phase 5 makes messages and backup registry-driven.
- **Easier to add modules without Sentinel/write-path risk:** post-Phase 1, a new module
  is 1 entry + 1 directory; post-Phase 3, it physically cannot import Sentinel's entry
  file or add an unguarded write; post-Phase 4, in-page features stop sharing a file
  with the queue-injection invariants.
- **Thin augmentation layer intact:** nothing here adds a build step, a framework, a
  server, or a byte of new egress. The plan reorganizes the same shipped files the
  clinician-auditable model depends on.

## Open questions for Dave / CSO

1. **Phase 2.2 (clinical thresholds single-source)** is a no-value-change refactor of
   clinically pinned constants — should it go through the CSO review ledger like a rule
   change, even though the values are byte-identical? (Recommend: yes, as a
   lightweight entry; it sets the precedent for 2.5/2.6.)
2. **Phase 4 stage releases**: is a live-Medicus verification pass per content.js stage
   (the page-console capture playbook) something you can do on cadence, or should the
   stages be batched to fewer verification windows?
3. **W1 booking-api move (3.3)**: fold into the already-planned booking-core
   retrofit noted at CSN W1, or keep separate?
4. The About cards (~9 of 19 modules) — regenerate from the registry in Phase 1, or is
   the curated subset intentional?
