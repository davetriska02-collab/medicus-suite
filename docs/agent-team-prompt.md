# Claude Code "agent teams" — ready-to-run prompt for this repo

Claude Code's experimental **agent teams** feature lets a team lead spawn several
peer agents that share a task list and message each other directly (unlike
subagents, which only report back to one orchestrator). Official docs:
https://code.claude.com/docs/en/agent-teams

**Enable it:** Claude Code v2.1.32+, then in `settings.json`:

```json
{ "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" } }
```

Restart, and confirm `claude --version` ≥ 2.1.32.

## When to use it here

Use a team for a **new side-panel module** — the one task in this repo with
genuinely parallel, separable workstreams (data/engine vs UI/shell) plus a
natural QA gate. For incremental, sequential, or safety-sensitive slices, the
ordinary single-agent (orchestrator) flow is cheaper and keeps one decision-maker
on the clinical-safety invariants. Teams cost ~3–4× the tokens (each teammate is a
full independent instance).

## Design rules baked into the prompt

- **Ownership is partitioned by file, not by topic** — the shared shell/
  registration files (`panel.js`, `pop-out.js`, the HTMLs, `options.*`) all belong
  to ONE teammate, so two peers never edit the same file.
- **`manifest.json` + `CHANGELOG.md` are owned by QA only**, applied last — no
  fighting over the version bump.
- **QA writes no product code** — it runs the gates and messages fixes back.

## The prompt (fill the three `<...>` placeholders, then paste whole)

```
GOAL: Add a new side-panel module to the Medicus Suite extension called
"<MODULE_NAME>" that <ONE-SENTENCE DESCRIPTION OF WHAT IT SHOWS/DOES>.
Data source: <Medicus API endpoint or existing shared API>. It is a PASSIVE
DISPLAY surface — read-only, never writes to the patient record, never sends
data outside the browser. Read CLAUDE.md and .claude/skills/ui-design/DOCTRINE.md
+ TOKENS.md before writing anything.

Create a team of 3 teammates using Sonnet. Keep these ownership boundaries
strict — two teammates must never edit the same file.

TEAMMATE 1 — "engine" (data + logic + backup IO). OWNS:
  - engine/ and shared/ files for this module (the API fetch + normalisers)
  - shared/io/<MODULE_NAME>-io.js  (export + import fns per the CLAUDE.md
    "backup convention")
  - shared/io/suite-envelope.js    (add the scope to VALID_SCOPES + a preview line)
  - test-<MODULE_NAME>.js           (unit tests for the normaliser/logic)
  DELIVERABLE: a working data layer with a documented return shape, the IO
  backup pair, and passing unit tests. Plain-language exports.
  MESSAGES: teammate 2 with the exact module-data return shape and the IO
  export function name; teammate 3 when tests are written.

TEAMMATE 2 — "ui" (module + all shell/registration wiring). OWNS:
  - side-panel/modules/<MODULE_NAME>/<MODULE_NAME>.js and .css (init/cleanup,
    Atelier tokens only — no raw hex; both light + dark + colourblind must work)
  - the registration edits in side-panel/panel.html, pop-out/pop-out.html,
    side-panel/panel.js, pop-out/pop-out.js (the MODULES registry + nav button)
  - options/options.html + options/options.js (the per-module export card +
    the doFullExport/applyEnvelope delegation to teammate 1's IO file)
  DELIVERABLE: the module renders in BOTH the panel and the pop-out, registered
  everywhere, consuming teammate 1's data shape. CLINICAL SAFETY: never dim or
  recolour an amber/red alert state; do not touch content.js or either
  defaults.json for styling.
  MESSAGES: teammate 1 if the data shape needs a change; teammate 3 when the
  module renders.

TEAMMATE 3 — "qa" (gate + integration; writes NO product code). OWNS:
  - manifest.json (version bump) and CHANGELOG.md (entry) — applied LAST
  RESPONSIBILITIES, run after 1 and 2 report done:
  - run: npm test, npx eslint ., npx prettier --check on changed files,
    node test-backup-coverage.js  (the new storage key MUST be covered)
  - verify the module appears in BOTH panel.html AND pop-out.html (CLAUDE.md
    rule: real modules live in both)
  - render the module headlessly via .claude/skills/design-crit/harness.mjs
    in light + dark and read the PNGs for broken/clipped/invisible states
  - if anything fails: MESSAGE the owning teammate (engine or ui) with the exact
    failure and send it back; do not fix it yourself
  - once everything is green: bump manifest.json (minor) + add the CHANGELOG
    entry describing the design intent, then report DONE to the team lead
  MESSAGES: teammate 1 for data/test/IO failures; teammate 2 for UI/registration/
  lint failures.

COORDINATION: engine and ui build in parallel against the agreed data shape;
qa holds until both report done, then gates and bounces failures back to the
owner until green. Nobody bumps the version except qa. Stop when qa reports
all gates green in one clean pass.
```

## Notes

- Adjust teammate count to the work: add a separate "rules" teammate (owning
  `rules/*.json` + `node test-drug-brand-coverage.js`) only if the module ships
  new clinical rules — and route any clinical-rule change through The Keeper, not
  a freehand teammate.
- The same partition-by-file discipline applies to any team you spin up here:
  decide who owns each file before they start, and give shared touch-points
  (`manifest.json`, `CHANGELOG.md`, the shell registries) a single owner.
