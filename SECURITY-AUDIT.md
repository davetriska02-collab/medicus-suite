# Security Audit — Medicus Suite

**Version audited:** 3.27.0
**Date:** 2026-06-04
**Type:** Red-team / adversarial code review (authorised, developer-initiated)
**Method:** 8 parallel automated agents swept distinct attack surfaces; every load-bearing
finding was then manually verified against source before rating. Severities in this document
are the **verified, adjusted** ratings — two findings initially flagged "critical" were
downgraded after verification (see §6).

---

## 1. Scope & threat model

Medicus Suite is a Manifest V3 Chrome extension for the Medicus Health (UK GP) platform. It
runs content scripts on `*.medicus.health`, reads patient clinical data from the page and the
`*.api.england.medicus.health` API, evaluates drug-monitoring / QOF safety rules, and renders
alerts in a side panel, pop-out, and full-tab visualiser.

Verified attacker reachability:

| Attacker | Can reach the extension? | Notes |
|---|---|---|
| Arbitrary website | **No** | No `externally_connectable`; content scripts limited to `*.medicus.health`. |
| Another installed extension | **No** | `chrome.runtime.onMessage` only receives intra-extension; no `onMessageExternal`. |
| Compromised / XSS'd Medicus page (MAIN world) | **Yes** | Via the `CustomEvent` bridge to the isolated content script. |
| User tricked into importing a malicious backup/ruleset | **Yes** | Highest-value path. |
| Local malware / other process reading the Chrome profile | **Yes** | `chrome.storage.local` is plaintext on disk. |

## 2. Overall posture

Strong foundations. The extension avoids the classic high-severity mistakes: no hardcoded
secrets, no telemetry or third-party exfiltration, patient demographics held in memory rather
than persisted, comprehensive HTML-escaping in the visualiser, `isEvalSupported:false` on
PDF.js, no `eval`/`new Function`/`srcdoc` anywhere, a closed shadow root for the Sentinel
sidebar, and — importantly — no `externally_connectable`, which removes a whole class of
web-page-driven attacks.

The material exposure is the **configuration / ruleset import path**, where a well-formed
backup file can silently degrade clinical safety alerts. For a tool whose purpose is firing
drug-monitoring alerts, that is the finding that matters most.

## 3. Findings (ranked, verified severity)

| ID | Severity | Finding | Location |
|---|---|---|---|
| F1 | **High** | Malicious ruleset import can silently disable / weaken safety alerts. The import whitelist permits `enabled:false` and `check` overrides; `check.red/amber/threshold` are never type-validated, so a string threshold yields `NaN` comparisons and the alert never fires. Unknown fields are only *warned* and applied as-is. | `engine/ruleset-io.js:80-108`, `engine/rules-engine.js:888-892` |
| F2 | **Medium** | Patient names persisted unencrypted in `suite.requestMonitor.state` (`chrome.storage.local`, plaintext on disk) and shown in desktop notifications. Data-minimisation / GDPR concern. | `shared/request-monitor.js:131-137`, `service-worker.js:360-389` |
| F3 | **Medium** | Over-broad `web_accessible_resources` exposes all of `engine/*`, `shared/*`, `rules/*`, `defaults.json` to any script on a Medicus page → reverse-engineer the full alert ruleset (craft records that evade monitoring) and fingerprint the extension. | `manifest.json` |
| F4 | **Low–Med** | Unauthenticated MAIN-world ↔ isolated `CustomEvent` bridge. A compromised Medicus page can forge `ch-task-list-data` events → spurious monitoring API calls (nuisance DoS), or observe task UUIDs. | `content-scripts/triage-lens/page-world.js:59`, `content-scripts/triage-lens/content.js` |
| F5 | **Low–Med** | No `sender` validation on `chrome.runtime.onMessage` handlers. Realistic impact is forced-refresh / DoS (gated behind F4), **not** the data-exfil originally claimed — see §6. Worth fixing as defence-in-depth. | `service-worker.js:32-50`, `content-scripts/sentinel.js:1095`, `side-panel/panel.js:463,579`, `pop-out/pop-out.js` |
| F6 | **Low** | Vendored libraries (`pdf.min.js`, `d3.min.js`, `chart.min.js`) carry no version pin / checksum manifest — supply-chain hygiene gap. PDF.js is otherwise securely configured. | `vendor/`, `visualiser-core.html` |
| F7 | **Low** | No file-size cap before `JSON.parse` on import (OOM/DoS); no integrity check on backups. | `options/options.js:494`, `shared/io/suite-envelope.js` |
| F8 | **Low** | `api.github.com/*` host permission is broader than the single release endpoint used; practice-code / siteId interpolated into fetch URLs without re-validation at fetch time. | `manifest.json`, `shared/update-checker.js`, `shared/request-monitor.js:93` |

## 4. Findings in detail

### F1 — Ruleset import can silently weaken clinical safety alerts (High)
`validateImport()` (`engine/ruleset-io.js:80-108`) accepts override objects keyed by rule id.
The field whitelist permits `enabled`, `check`, `tests`, `thresholds`, etc. Only
`tests[].intervalDays` / `dueSoonDays` are numerically validated, and even those allow `NaN` /
`Infinity` (`typeof NaN === 'number'`). The `check` object — which carries the actual clinical
thresholds (`red`, `amber`, `threshold`, `thresholdSystolic/Diastolic`, …) — receives no
nested type validation. Unknown fields are surfaced only as a *warning* and "applied as-is".

`mergeRules()` (`engine/ruleset-io.js:137-156`) then shallow-`Object.assign`s the override onto
the canonical rule. At evaluation time (`engine/rules-engine.js:~888`), comparisons such as
`v >= check.red` against a string threshold coerce to `NaN`, so the alert silently never fires;
and an `enabled:false` override (`rules-engine.js:~1191`) silently disables the rule entirely.

**Attack:** a clinician is sent a "compatibility patch" / "optimised rules" backup file. It
passes validation, imports cleanly, and silently disables (or detunes) e.g. methotrexate FBC/LFT
monitoring. No error, no visible warning, no audit trail.

### F2 — Patient names persisted unencrypted & shown in notifications (Medium)
`shared/request-monitor.js:131-137` maps live tasks into `items[]` including
`patient: t.patientName`, and persists the whole structure to `chrome.storage.local` under
`suite.requestMonitor.state`. `chrome.storage.local` is unencrypted on disk; the names are also
rendered into desktop notification text (`service-worker.js:360-389`), exposing them on
lock-screens, notification history, and screen shares.

### F3 — Over-broad web-accessible resources (Medium)
`web_accessible_resources` exposes `engine/*`, `shared/*`, `rules/*`, `defaults.json` and more
to `https://*.medicus.health/*`. Any script on a Medicus page can fetch and read the complete
drug-monitoring ruleset (match/exclude terms, thresholds, intervals), enabling an attacker to
craft records that evade monitoring, plus reliable extension fingerprinting via the exposed ID.

### F4 / F5 — Cross-context messaging trust (Low–Med)
The MAIN-world `page-world.js` dispatches `ch-task-list-data` CustomEvents to the isolated
content script with no integrity control, and the intra-extension `onMessage` handlers don't
check `sender`. A compromised Medicus page can forge bridge events to trigger spurious
authenticated API calls (nuisance DoS) or observe task UUIDs it already has. Note: because
MAIN world is shared with the page, a "nonce" provides no real protection — the correct
mitigations are defensive validation, treating bridged data as untrusted (only ever using it to
trigger trusted API re-fetches, never rendering it), and rate-limiting / coalescing.

### F6 / F7 / F8 — Hygiene (Low)
Vendored libs lack a version/checksum manifest; imports aren't size-capped or integrity-checked;
the GitHub host permission and fetch-URL construction could be tightened.

## 5. Confirmed safe (preserve these)

- No hardcoded secrets, tokens or API keys.
- No PHI written to `console.*`.
- No outbound exfiltration: all clinical data is same-origin to Medicus; GitHub is read-only,
  repo-pinned, banner-only (no auto-update / code download).
- Patient context (NHS number / DOB / name) held in memory only, never persisted.
- No `eval` / `new Function` / `srcdoc` / inline script.
- Visualiser escapes all rendered fields via `esc()`; PDF.js text-extraction only, `isEvalSupported:false`.
- Sentinel sidebar isolated in a **closed** shadow root.
- No patient-data sample files committed; `.gitignore` covers `uploads/`, `data/sars/`, `output/`.

## 6. Claims downgraded after verification

Recorded for transparency — two were initially rated "critical" and do not hold:

- **"Prototype pollution via `Object.assign`" → Low.** `mergeRules` does a *shallow*
  `Object.assign(merged, importedData)`. A `__proto__` key in parsed JSON reassigns only that
  one object's prototype via the setter; it does **not** pollute global `Object.prototype`
  (which would require a recursive deep-merge). Localised, low impact. A defensive key filter is
  still cheap and worthwhile.
- **"ReDoS via dynamic `RegExp`" at `rules-engine.js:177` → non-issue.** The proof-of-concept
  pattern isn't reachable: `t.replace(/\s+/g,'\\s+')` collapses whitespace runs to a single
  `\s+`, and the term is constrained to `[a-z0-9 ]+`, so the produced pattern has no nested
  quantifier and matches linearly.
- **"Patient-data exfiltration to any web page / other extension via `onMessage`" → Low.** With
  no `externally_connectable`, neither web pages nor other extensions can reach
  `chrome.runtime.onMessage`. The residual risk is forced refreshes via the F4 bridge — a
  nuisance, not PHI exfiltration.

## 7. Remediation status

| ID | Action | Status |
|---|---|---|
| F1 | Type-validate `check.*` numerics; reject/strip unknown override fields; `Number.isFinite` on intervals; surface "disables N rules" in import preview; defensive proto-key strip in merge; regression tests. | See CHANGELOG |
| F2 | Stop persisting full patient names; minimise notification text. | See CHANGELOG |
| F3 | Trim `web_accessible_resources` to least privilege. | See CHANGELOG |
| F4/F5 | Defensive validation + rate-limiting of the bridge; `sender.id` guards on message handlers. | See CHANGELOG |
| F6 | `vendor-versions.json` checksum manifest. | See CHANGELOG |
| F7 | Import file-size cap before parse. | See CHANGELOG |
| F8 | Narrow GitHub host permission; validate practice-code at fetch time. | See CHANGELOG |
