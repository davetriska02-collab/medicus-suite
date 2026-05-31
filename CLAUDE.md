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

## Version bumping

Bump `manifest.json` `version` for every pushed change. Use semantic versioning:
- **patch** (1.x.y → 1.x.y+1): bug fix, config update
- **minor** (1.x.0 → 1.x+1.0): new feature or tab
- **major** (1.x.0 → 2.0.0): major architecture change

Always add a `CHANGELOG.md` entry on the same commit.

## Git workflow

- Dev branches are created per session and merged to `main` via PR when complete
- Never force-push main
- Before commit: check `git status` for patient data files — nothing from `uploads/`, `data/sars/`, or `output/` should ever be committed
