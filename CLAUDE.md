# Medicus Suite — Developer Guide for Claude Code

## Project layout

| Path | Purpose |
|---|---|
| `side-panel/` | Side-panel shell (`panel.html`, `panel.js`, `panel.css`) + per-module subdirectories |
| `side-panel/modules/<name>/` | Each module: `<name>.js` (ES module), `<name>.css` |
| `pop-out/` | Floating pop-out window shell (mirrors panel nav) |
| `shared/` | APIs, utilities, IO helpers used by multiple contexts |
| `shared/io/` | Per-module backup/restore IO files |
| `engine/` | Business logic (rules engine, extractors, triage engine) |
| `content-scripts/` | Injected into Medicus pages |
| `options/` | Settings page |
| `visualiser.html` / `visualiser-core.html` | Patient record visualiser (opens as full tab) |

## Adding a new side-panel module

1. Create `side-panel/modules/<name>/<name>.js` (ES module, exports `init(container)` and optionally `cleanup()`)
2. Create `side-panel/modules/<name>/<name>.css`
3. Add `<button class="nav-tab" data-module="<name>">` to `side-panel/panel.html` AND `pop-out/pop-out.html`
4. Add `<name>: { js: () => import('./modules/<name>/<name>.js'), css: '...' }` to `MODULES` in `side-panel/panel.js` AND `pop-out/pop-out.js`
5. Follow the backup convention below

> **Panel-only tabs (intentional exceptions):** `visualiser` and `about` exist in `side-panel/panel.html` but NOT in `pop-out/pop-out.html`. `visualiser` is special-cased in `panel.js` (opens a full browser tab, not a module) and `about` renders inline static text — neither makes sense in the floating pop-out, so they are deliberately omitted there. All *real* modules must still appear in both.

## chrome.storage.local keys — backup convention

**When you add a new storage key to an existing module:**
1. Update `shared/io/<module>-io.js` — add the key to both the `*Export()` and `*Import()` functions.
2. That's all. `options/options.js`'s `doFullExport()` delegates to those functions, so the new key is captured automatically in suite backups.

**When you add a brand-new module with its own storage keys:**
1. Create `shared/io/<module>-io.js` with `async function <module>Export()` and `async function <module>Import(data)`
2. Add the scope name to `VALID_SCOPES` in `shared/io/suite-envelope.js`
3. Add the module to `doFullExport()` and `applyEnvelope()` in `options/options.js`
4. Add a preview summary line in `previewEnvelope()` in `suite-envelope.js`
5. Add `<script src="../shared/io/<module>-io.js">` to `options/options.html`
6. Add a per-module export card in `options/options.html`

**Do NOT add raw storage keys to `doFullExport` in options.js** — it delegates entirely to the IO files. Hard-coding keys there is what caused the backup to drift out of sync.

## Global demand / alert strips

Three permanent strips live in `side-panel/panel.html` outside `<main>`, polled independently by `panel.js`:
- `#wrStrip` — waiting room patients (`wr-strip-*` CSS)
- `#rmStrip` — new medical/admin requests (`rm-strip-*` CSS)
- `#subRagStrip` — submissions RAG threshold alerts (`sub-rag-strip-*` CSS)

Pattern: each strip has a hidden class, polls on load + interval, shows amber/red state when threshold crossed. If you add another global alert, follow this same pattern.

## Injecting chips into the live Medicus queue (mechanics — copy the pattern, don't rediscover)

The queue is a **Vue + AG-Grid SPA** that re-renders constantly and **strips foreign DOM
nodes** on every render. Three chip families are injected into it
(`content-scripts/triage-lens/content.js`), by two strategies — pick the right one or
chips flash-and-vanish:

- **Age/decoration (`.ch-queue-chips`)** — *DOM-driven*: `decorateOneRow` reads what it
  needs from the row's own cells and is rebuilt on every refresh. No async, no external
  state → inherently durable. **This is the template; copy it.**
- **Monitoring (`.ch-q-mon`) / result-triage (`.ch-q-result`)** — *fetch-driven*: they
  need data not on the row (drug record / lab values), fetched per row from the API and
  cached (`_queueResultCache`, keyed by **taskUuid**).

Non-negotiable rules (each cost a debugging session):

1. **PREPEND, never append** — `insertBefore(node, target.firstChild)`. Appended (trailing)
   nodes get reconciled away by Vue on its next render. (Append was the v3.67.0 regression.)
2. **Host:** the master/detail **preview row** if present (`findQueuePreviewRow`), else the
   `[col-id="patientName"]` cell. Width-cap inline chips (`.ch-q-result-inline`) so they
   don't push the patient name out of the fixed-width cell.
3. **Re-inject on every `refreshQueueChips`** (fired by the queue MutationObserver) — one
   inject never survives the SPA's re-renders.
4. **Re-injection must not depend on `_queueRowUuids`.** `runQueue` clears that
   rowIndex→taskUuid map on every queue (re)entry, and the SPA churn triggers `runQueue`
   constantly — so gating re-injection on it (`if (_queueRowUuids.size > 0)`) loses the
   chips (they inject then get wiped with nothing to replace them). Keep a **durable
   `_durableRowMap` (rowIndex→taskUuid) written ONLY by the bridge task-list event**,
   never cleared by `runQueue`. `reinjectCachedResultChips()` iterates it, looks up the
   cached severity in `_queueResultCache` (keyed by taskUuid), and re-injects via the
   **row-index** path on every refresh — the result-chip equivalent of `decorateOneRow`.
   The transient `_queueRowUuids` is only for scheduling the initial *fetch* of
   not-yet-cached rows. **`row-id` is NOT the task UUID on real Medicus — do not key off
   it** (that no-op shipped as v3.69.0; the durable map fixed it in v3.70.0).
5. **CSS token scope:** the chip's top-level class must be in the `hud.css` token-block
   selector list (`#medicus-clinical-hud, .ch-queue-chips, .ch-q-result, .ch-q-mon, …`) or
   `var(--red-dim)` etc. resolve to nothing and it renders as an unstyled "white rectangle".
6. Inject functions **de-dupe** (`target.querySelector('.ch-q-result')`), so re-injection
   is idempotent — safe to call on every refresh.

## Debugging injected queue chips on the live Medicus page (capture first)

The queue chips — age/decoration (`.ch-queue-chips`), monitoring (`.ch-q-mon`),
result-triage (`.ch-q-result`) — are injected by `content-scripts/triage-lens/content.js`
into Medicus's **Vue + AG-Grid** DOM. When a user reports chips "not firing",
flashing-then-vanishing, or rendering wrong, **do not reason in the abstract and do not
trust the eye** — the inject→wipe race is faster than a human can see. Reach for a
**page-console capture** every time; remember this technique for this repo.

Why a page-console capture (and its limits): the content script runs in the **isolated
world**, so the page console (MAIN world) **cannot** read its `CONFIG`/closure state. But
from the page console you *can*: count injected DOM (shared), read shared-origin
`localStorage`, do **credentialed `fetch`** (the page shares the extension's cookie auth,
so you can replay the exact API path), and read `window.__chPageWorld` (the MAIN-world
bridge flag set by `page-world.js`). Build diagnostics around those.

The toolkit, in order:
1. **Presence + counts** — `window.__chPageWorld` and counts of `.ch-chip`,
   `.ch-queue-chips`, `.ch-q-mon`, `.ch-q-result`. Distinguishes *not injecting* vs
   *decoration works but triage doesn't* vs *injected-then-wiped*.
2. **Timed lifecycle poll** — sample those counts over ~20s and record **peak** and
   **final**. `peak>0, final=0` = injected then wiped (persistence/re-inject bug);
   `peak=0` = never injected (event/rules/host problem). This is what catches the flash.
3. **Data-path replay** — `fetch` `/tasks/data/{slug}/task-list` then each row's
   `overviewURL`, normalise, and run the rule yourself. Separates *rule wrong* from
   *pipeline broken* (the values are reachable from the queue via the overview endpoint).
4. **The content script's own logs** — `localStorage.setItem('ch-debug','1')` + reload
   turns on `[ClinHUD]` pipeline logging (`DEBUG` reads that flag). Shows `triage start,
   rows=`, per-report `sev=`, `chip injected`, `refreshQueueChips`.

Hard rules learned the slow way:
- **Inject by PREPEND (`insertBefore(node, target.firstChild)`), never `appendChild`.**
  Medicus's Vue reconciler strips *trailing* foreign nodes on its next re-render;
  prepended nodes survive. (Appending was the v3.67.0 regression — chips vanished
  instantly; fixed v3.68.0.)
- **CSS-variable scope:** injected chips only get the design tokens if their top-level
  class is in the `hud.css` token-block selector list. A class left out renders as an
  unstyled "white rectangle" (`.ch-q-result`/`.ch-q-mon` had this until v3.67.0).
- **Host-app noise is not us:** `MInput.vue` warnings and `sentry.io` `429`s in the
  console are Medicus's own Vue app + telemetry, not the extension.

## Editing drug-monitoring rules (`rules/drug-rules.json`)

Drug matching in `engine/rules-engine.js` (`drugMatchesRule`) is **case-insensitive substring** matching against the `drug.match` list. Two consequences you must keep in mind, because the failure mode is **silent** — a med that doesn't match simply never fires its alert; there is no error, just a missing chip (a patient-safety risk, not a cosmetic one):

- A **generic** term auto-covers its qualified generic forms — `"lithium"` already matches `"lithium carbonate"` / `"lithium citrate"`, so those don't need listing.
- Every **distinct brand** must be listed explicitly or it will never match. When adding or editing a rule, enumerate the *complete* current UK brand set (check the BNF / dm+d), not just the generic plus a couple of common brands. Brand-list completeness is the default expectation.
- **`drug.exclude` is sharp.** An exclude string silently drops *every* med whose name contains it, including legitimate ones. Use it only to suppress genuine false positives, and whenever you add one ask: "could a real patient who *needs* this monitoring match this string?" (e.g. the injectable-methotrexate exclusion was dropping valid parenteral-MTX patients.)

After changing `match`/`exclude`, run `node test-drug-brand-coverage.js` and add the new drug/brands to its `EXPECTED` map so the coverage is regression-guarded. This converts "a clinician notices a missing alert months later" into "CI fails on the PR".

## Version bumping

Bump `manifest.json` `version` for every pushed change. Use semantic versioning:
- **patch** (1.x.y → 1.x.y+1): bug fix, config update
- **minor** (1.x.0 → 1.x+1.0): new feature or tab
- **major** (1.x.0 → 2.0.0): major architecture change

Always add a `CHANGELOG.md` entry on the same commit.

## Shipped-config (`defaults.json`) version — bump when you change shipped rules/chips

`defaults.json` carries its **own integer `"version"`** at the top (separate from the
manifest semver). It gates `mergeShippedDefaults` in BOTH
`content-scripts/triage-lens/content.js` **and** `content-scripts/triage-lens/options.js`:
the migration that propagates newly-shipped config to an existing install only runs when
this integer is **higher** than the version stored in that user's saved config.

**Whenever you change any migration-propagated content in `defaults.json` — `rules`,
`thresholds`, `prefs`, `systemChips`, or `resultRules` — bump this integer `"version"`**,
or the change silently never reaches anyone who already has a saved config. (This is how
the v3.75.0 `Urgent:` chip-label change and the bowel-screening rule were stranded — see
CHANGELOG v3.75.2.)

- A **changed existing value** needs more than the bump to land: the merge is
  `{ ...shipped, ...cfg }`, so the user's stored value wins. New *keys* arrive; changed
  *values* do not. For chip labels, add the old value to **`RETIRED_CHIP_LABELS`** (kept
  in lock-step in content.js + options.js) so it un-sticks on migration.
- After editing `defaults.json`: run `node scripts/regen-defaults.js` (propagates the two
  derived copies) **and** `node scripts/defaults-config-lock.js` (refreshes the version
  lock). The lock script **refuses** to bless a content change that wasn't version-bumped,
  and CI (`scripts/defaults-config-lock.js --check`, also `test-defaults-config-lock.js`)
  fails closed on it — so "silently doesn't ship" becomes "CI tells you".

## Running the tests

- **Run all tests:** `npm test` (or `node --test --test-concurrency=1 test-*.js`)
- **Run one test file:** `node test-foo.js` — direct invocation still works unchanged
- The test suite uses `node --test`; each file is an independent exit-code-driven script (no `node:test` API required). The test job in CI is npm-free.

## Tooling (ESLint / Prettier / pre-commit hook)

Run once after cloning (or when `package.json` changes):
```
npm install
```
This installs ESLint + Prettier devDeps and activates the `.githooks/pre-commit` hook
(`git config core.hooksPath .githooks`) which lints and format-checks staged JS files only.

- **Lint:** `npm run lint` (or `npx eslint .`)
- **Format check:** `npm run format:check` (or `npx prettier --check .`)
- **Format a file:** `npx prettier --write <file>` then re-stage

**The lint config is intentionally lenient** — several rules are set to `'off'` for
existing code. Do not reformat whole files with Prettier; the two `defaults.json` copies
and `content-scripts/triage-lens/content.js` are excluded because tests match their
exact content. `node_modules/` is never committed (excluded from the release zip).

## Git workflow

- Dev branches are created per session and merged to `main` via PR when complete
- Never force-push main
- Before commit: check `git status` for patient data files — nothing from `uploads/`, `data/sars/`, or `output/` should ever be committed
