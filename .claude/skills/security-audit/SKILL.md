---
name: security-audit
description: >-
  Red-team / adversarial security audit of the medicus-suite Chrome MV3 extension
  (handles UK GP patient data). Fans out subagents across the extension's attack
  surfaces — manifest/permissions, content-script XSS, cross-context messaging,
  storage/PII, backup import, network/exfiltration, visualiser/PDF, and
  rules/clinical-safety logic — verifies every finding against source to strip
  over-rated claims, and produces a severity-ranked report. Use when the user asks
  to security-review, red-team, pentest, or audit this extension, or for the
  scheduled weekly security review. Report-only by default: it does not modify code
  or open fix PRs unless the user explicitly asks.
---

# Security audit (red-team) skill

Run an authorised adversarial security review of the medicus-suite Chrome MV3
extension. This is the maintainer's own repository and an authorised exercise.

**Default mode is report-only** — produce findings, do not change code. Only
implement fixes if the user explicitly asks ("fix it", "remediate"), and then do
it on a branch + PR for review (security changes to a clinical tool go through
review — see `SECURITY-AUDIT.md` for the v3.28.0 pass that followed this flow).

If the user passed an argument, use it to scope the run:
- a subsystem/path (e.g. `engine`, `visualiser`) → focus the sweep there;
- `quick` → skip the fan-out, do a single focused pass on recently-changed files;
- otherwise → the full 8-surface sweep below.

## 1. Context first

Read `CLAUDE.md`, `SECURITY-AUDIT.md`, and skim the latest `CHANGELOG.md`
"Security" entries. Build a list of already-known / already-fixed issues so you
don't re-report them (call out genuine regressions explicitly). Note the current
`manifest.json` version, the `main` short SHA being audited, and today's date.

## 2. Fan out across attack surfaces

Launch up to 8 subagents in parallel (haiku is fine for the sweep; you, the
orchestrator, verify on a stronger model). One agent per surface so they don't
overlap. Tell each agent: this is an authorised audit; **analysis only, do not
modify files**; report `[severity] | title | file:line | concrete attacker
scenario | recommendation`; prioritise realistic exploitation over theory; end
with a ranked summary.

- **(a) Manifest / permissions / CSP** — least-privilege of `permissions` &
  `host_permissions`; `web_accessible_resources` exposure to `*.medicus.health`;
  the `world:"MAIN"` content-script trust boundary.
- **(b) Content-script DOM injection / XSS** — `innerHTML` / `insertAdjacentHTML` /
  `outerHTML` / `document.write` fed page- or patient-derived data;
  `shared/chip-renderer.js`, `content-scripts/`.
- **(c) Cross-context messaging & trust** — `chrome.runtime.onMessage` sender
  validation; the MAIN-world ↔ isolated-world `CustomEvent` bridge
  (`triage-lens/page-world.js` ↔ `content.js`); `service-worker.js`; pusher relay.
- **(d) Storage & PII/PHI** — what patient data is persisted to
  `chrome.storage.local` (plaintext on disk); `console.*` leakage; hardcoded
  secrets; data minimisation.
- **(e) Backup/restore import** — `shared/io/*`, `engine/ruleset-io.js`,
  `options/options.js`: prototype pollution, schema/type validation, and **imports
  that could silently disable or detune a clinical safety alert** (patient-safety
  critical).
- **(f) Network / API / exfiltration / supply chain** — `engine/api-client.js`,
  `engine/data-fetcher.js`, `shared/*-api.js`, `shared/update-checker.js` (GitHub):
  SSRF via interpolated hosts, credential handling, whether anything remote is
  fetched and applied.
- **(g) Visualiser & vendored libs** — `visualiser-core.*`; `vendor/` pdf.js / d3 /
  chart.js versions vs known CVEs (cross-check `vendor-versions.json`); untrusted
  PDF / snapshot-bridge data into the DOM.
- **(h) Rules / triage engine & clinical-safety logic** — `engine/rules-engine.js`,
  extractors, normalisers: ReDoS from dynamic `RegExp`, numeric type coercion in
  thresholds, and **false-negative suppression of monitoring alerts** (treat a
  silently-missed drug-monitoring alert as High, not cosmetic).

## 3. Verify before reporting (critical)

Automated agents over-rate severity. For every finding, open the cited file and
confirm it holds on the current `main` tip, and confirm **real attacker
reachability**. Codebase-specific facts to apply:

- There is **no `externally_connectable`**, so arbitrary web pages and other
  extensions **cannot** reach `chrome.runtime.onMessage` — only intra-extension
  senders, and (indirectly) a compromised Medicus page via the MAIN-world bridge.
- A "nonce" on the MAIN-world bridge is **theatre** — the page shares that world
  and can read it. The real mitigations are defensive validation + rate-limiting.

Reject or **downgrade** anything that: cites code that doesn't exist / wrong
lines; was already fixed (check `SECURITY-AUDIT.md` / CHANGELOG); is a duplicate;
overstates reachability; or is intent-ambiguous. Be ruthless — false positives
erode trust. Keep a short list of what you downgraded and why.

## 4. Rank & report

Rank surviving findings by **verified** severity (Critical / High / Medium / Low),
each with file:line, a concrete attacker scenario, and a recommendation. Treat a
silently-missed drug-monitoring alert as a patient-safety (High) issue, not cosmetic.

### Output mode

- **Interactive** (a person asked in-session): present the ranked report in chat —
  executive summary + counts by severity, the findings table, detail for each
  High/Critical, the verified-and-downgraded list, and a "confirmed safe" section.
  Then offer to fix the top issue(s) on a branch + PR. Do not change code unasked.
- **Unattended** (scheduled weekly run, or the user says "open an issue"): search
  open issues on `davetriska02-collab/medicus-suite` for a `Weekly security audit`
  from the last 10 days — comment on it if found, else open ONE issue titled
  `Weekly security audit — YYYY-MM-DD`, labelled `security-audit` and `automated`,
  using the structure below. If there are no new findings after verification, still
  open a short heartbeat issue stating the audit ran clean (with the audited `main`
  sha). Do NOT open fix PRs — the user triages.

```
## Summary
Overall posture in 1-2 sentences. Counts by severity. Review tip: <main short sha>.

## Critical / High
- **`path/to/file.js:42`** — concrete attacker scenario.
  Fix: one-line idea.

## Medium
...

## Low
...

## Verified-and-downgraded (transparency)
- Claim → why it doesn't hold / real severity.

## Confirmed safe / good practices observed
- ...
```

## What NOT to do

- Do NOT modify files, push commits, or open PRs unless the user explicitly asks
  for remediation (and then: branch + PR, never a direct push to `main`).
- Do NOT comment on unrelated PRs or issues.
- Do NOT re-report issues already recorded as fixed in `SECURITY-AUDIT.md` /
  CHANGELOG unless it's a genuine regression (say so).
- Do NOT pad with style nits, refactors, or "while you're here" items — exploitable
  security weaknesses and patient-safety logic flaws only.
