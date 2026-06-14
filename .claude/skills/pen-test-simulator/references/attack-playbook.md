# Attack playbook — medicus-suite pen-test simulator

Each scenario below is mapped to a **real entry point**, a **malicious-input
recipe**, and the **oracle** that decides BLOCKED vs EXPLOITED. The standing
harness (`scripts/pentest-harness.js`) implements the core of these; section 3 of
the skill is about extending them.

Threat model anchors (apply when triaging — see SKILL.md §4):
- No `externally_connectable`: web pages / other extensions can't post to
  `chrome.runtime.onMessage`. Attacker positions are: (a) a malicious **backup
  file** a user is socially-engineered into importing; (b) a **compromised
  Medicus page** reaching the isolated world via the MAIN-world bridge; (c)
  **page/patient-derived strings** rendered into chips; (d) a **MITM/typosquat**
  on a URL the extension fetches or renders.

---

## A. Backup-import battery — `engine/ruleset-io.js`, `shared/io/*`, `shared/io/suite-envelope.js`

Attacker = a crafted `.sentinel-config.json` / suite backup the user imports.

| # | Attack | Recipe | Oracle |
|---|---|---|---|
| A1 | **Prototype pollution via override key** | override doc with `drugRuleOverrides: { "__proto__": { polluted: 1 } }` (and `constructor`, `prototype`) → `mergeRules` | EXPLOITED if `({}).polluted` is set after merge; BLOCKED if `DANGEROUS_KEYS` stripped (`ruleset-io.js:248`). |
| A2 | **Clinical-alert suppression via type confusion** | override `check.red`/`check.threshold` as a **string** (`"5"`) or `intervalDays: NaN`/`Infinity` → `validateImport` | EXPLOITED if accepted (a string `>=` always false → chip never fires); BLOCKED if `validateImport` rejects (F1/NF1). |
| A3 | **Unknown / spoofed envelope scope** | suite envelope with `scope: "__proto__"` or an unlisted scope → `unwrap`/`validateImport` | EXPLOITED if it routes into an importer; BLOCKED if rejected against `VALID_SCOPES` (`suite-envelope.js:33,89`). |
| A4 | **Operational-alert suppression** | submissions/triage-alert backup with `threshold: "10"` / `0` / negative → `submissionsImport` / `TriageAlertIO.importData` | EXPLOITED if a non-finite/≤0 threshold is stored (RAG/triage strip silently never fires — TF2); BLOCKED if `Number.isFinite && >0` enforced. |
| A5 | **Disabled-rule smuggling** | override doc that flips a monitoring rule `enabled:false` for many rules → `previewEnvelope` | "BLOCKED" here = the preview **warns** "Disables N monitoring rules" so the user sees it; EXPLOITED if it imports silently. Patient-safety. |

## B. Cross-context messaging — `service-worker.js`, MAIN↔isolated bridge

| # | Attack | Recipe | Oracle |
|---|---|---|---|
| B1 | **Foreign-sender message injection** | message with `sender.id !== chrome.runtime.id` | BLOCKED if handler early-returns (`service-worker.js:111`); EXPLOITED if it acts on it. (Can't truly socket this in Node — assert the guard exists and unit-drive the listener with a spoofed sender object.) |
| B2 | **Compromised-page bridge flood / malformed event** | drive the isolated-world `CustomEvent` handler with attacker JSON (missing fields, huge arrays, throwing getters) | BLOCKED if it validates shape + is rate-limited and doesn't throw/hang; EXPLOITED if it crashes the pipeline or trusts unvalidated fields. |

## C. DOM / XSS — `shared/chip-renderer.js`, content scripts

| # | Attack | Recipe | Oracle |
|---|---|---|---|
| C1 | **Stored XSS via patient/page string** | `renderDrugChip({ drugName: '<img src=x onerror=alert(1)>' })`, and `"` / `</span>` breakout into attribute sinks via `ruleId`, `dateText`, `valueText` | BLOCKED if output contains no raw `<`,`>`,`"` breakout (all routed through `escHtml`/`escAttr`); EXPLOITED if an executable tag/attribute survives. |
| C2 | **Escaping bypass** | unicode/entity tricks (`&lt;`, NULs, `<\0script>`), nested encodings into the same sinks | BLOCKED if `escHtml` neutralises; EXPLOITED if a sink reconstructs an executable token. |

## D. Network / SSRF / open-redirect — `shared/update-checker.js`, `engine/api-client.js`

| # | Attack | Recipe | Oracle |
|---|---|---|---|
| D1 | **Open-redirect / SSRF via release URL** | feed `allowGithubUrl` hostile URLs: `https://github.com.evil.com`, `https://evil.com/github.com`, `http://github.com`, `https://api.github.com@evil.com`, `javascript:alert(1)`, `https://evilgithub.com` | BLOCKED if it returns `''` for all (only `github.com`/`api.github.com`/`*.githubusercontent.com` over HTTPS pass); EXPLOITED if any hostile URL is returned and would be fetched/rendered. |
| D2 | **Practice-code / host interpolation injection** | crafted practice code / slug with path-traversal or host chars into any interpolated fetch URL in `api-client.js` / `data-fetcher.js` | BLOCKED if validated before interpolation; EXPLOITED if it can redirect the request off-origin. |

## E. Rules / triage engine — `engine/rules-engine.js`, extractors

| # | Attack | Recipe | Oracle |
|---|---|---|---|
| E1 | **ReDoS via dynamic RegExp** | term/label inputs designed for catastrophic backtracking into any `new RegExp(userInput)` path | BLOCKED if dynamic regexes are anchored/guarded (e.g. `^[a-z0-9 ]+$` gate at `rules-engine.js:260`, else `String.includes`) and eval completes <50ms; EXPLOITED if a crafted input blows up evaluation time. |
| E2 | **Numeric coercion false-negative** | thresholds/observations as `"5 "`, `"5mg"`, `null`, `NaN` → does the rule still correctly fire/withhold? | EXPLOITED if coercion makes a *should-fire* alert silently not fire; BLOCKED if normalised/withheld safely. |

## F. Residual-risk confirmation (don't re-derive — just verify mitigation holds)

| # | Item | Check |
|---|---|---|
| F-pdf | PDF.js CVE-2024-4367 | `vendor/pdf*.js` still constructed with `isEvalSupported:false`; confirm no new eval-capable path. |
| F-store | plaintext config in `chrome.storage.local` | confirm no *PHI* newly persisted (data-minimisation) — non-PHI config plaintext is accepted. |
| F-unpacked | "load unpacked" install | acknowledge: requires local dev-mode; not a remote attacker vector. |

---

## Oracle conventions for the harness

- `BLOCKED` = the security control rejected, stripped, escaped, or safely
  neutralised the attack. This is the desired outcome and, for a previously-fixed
  finding, proves the **regression guard is holding**.
- `EXPLOITED` = the attack succeeded against the real code path → a confirmed
  vulnerability with the printed payload as PoC. Exit non-zero.
- `N/A` = the surface can't be driven in-process (e.g. a real socket); assert the
  guard's presence in source instead and note the limitation.
