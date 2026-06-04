# Weekly security audit (red-team) prompt

Paste this body into a scheduled trigger in Claude Code on the web. Recommended
cadence: weekly, overnight (e.g. Sunday 03:00 in the user's local timezone) —
after the bug-bash slot, since this is the deeper, adversarial pass. Iterate on
this prompt over time: every false-positive class you trim here saves morning
triage time, and every confirmed-and-fixed finding can be added to the "already
known / fixed" list so it isn't re-reported.

This run produces a written report (a GitHub issue), **not** code changes — for a
clinical tool, security fixes go through human review (see the v3.28.0 hardening
pass in `SECURITY-AUDIT.md`, which followed exactly this audit → triage → fix-PR
flow).

---

## Prompt to use

You are running an authorised weekly red-team / adversarial security review of the
medicus-suite Chrome MV3 extension, which handles UK GP patient data. This is the
maintainer's own repository and an authorised security exercise. The user is
asleep — this run produces a written report, not code changes.

### What to do

1. **Context first.** Read `CLAUDE.md`, `SECURITY-AUDIT.md`, and skim the latest
   `CHANGELOG.md` "Security" entries. Build a list of already-known / already-fixed
   issues so you don't re-report them. Note the current `manifest.json` version and
   today's date (`YYYY-MM-DD`).

2. **Fan out across attack surfaces.** Launch up to 8 subagents in parallel
   (haiku is fine for the sweep; you, the orchestrator, verify on opus/sonnet),
   one per surface so they don't overlap. Tell each: this is an authorised audit;
   **analysis only, do not modify files**; report `[severity] | title | file:line |
   concrete attacker scenario | recommendation`; realistic exploitation over theory.
   The eight surfaces:
   - **(a) Manifest / permissions / CSP** — least-privilege of `permissions` &
     `host_permissions`; `web_accessible_resources` exposure to `*.medicus.health`;
     the `world:"MAIN"` content-script trust boundary.
   - **(b) Content-script DOM injection / XSS** — `innerHTML`/`insertAdjacentHTML`/
     `outerHTML`/`document.write` fed page- or patient-derived data;
     `shared/chip-renderer.js`, `content-scripts/`.
   - **(c) Cross-context messaging & trust** — `chrome.runtime.onMessage` sender
     validation; the MAIN-world ↔ isolated-world `CustomEvent` bridge
     (`triage-lens/page-world.js` ↔ `content.js`); `service-worker.js`; pusher relay.
   - **(d) Storage & PII/PHI** — what patient data is persisted to
     `chrome.storage.local` (plaintext on disk); `console.*` leakage; hardcoded
     secrets; data minimisation.
   - **(e) Backup/restore import** — `shared/io/*`, `engine/ruleset-io.js`,
     `options/options.js`: prototype pollution, schema/type validation, and
     **imports that could silently disable or detune a clinical safety alert**
     (patient-safety critical).
   - **(f) Network / API / exfiltration / supply chain** — `engine/api-client.js`,
     `engine/data-fetcher.js`, `shared/*-api.js`, `shared/update-checker.js`
     (GitHub): SSRF via interpolated hosts, credential handling, whether anything
     remote is fetched and applied.
   - **(g) Visualiser & vendored libs** — `visualiser-core.*`; `vendor/` pdf.js /
     d3 / chart.js versions vs known CVEs (cross-check `vendor-versions.json`);
     untrusted PDF / snapshot-bridge data into DOM.
   - **(h) Rules / triage engine & clinical-safety logic** — `engine/rules-engine.js`,
     extractors, normalisers: ReDoS from dynamic `RegExp`, numeric type coercion in
     thresholds, and **false-negative suppression of monitoring alerts** (treat a
     silently-missed drug-monitoring alert as High, not cosmetic).

3. **Verify before reporting (critical).** Automated agents over-rate severity —
   for every finding, open the cited file and confirm it holds on the current
   `main` tip, and confirm **real attacker reachability**. Key facts for this
   codebase: there is **no `externally_connectable`**, so arbitrary web pages and
   other extensions **cannot** reach `chrome.runtime.onMessage` (only intra-extension
   senders and, indirectly, a compromised Medicus page via the MAIN-world bridge can).
   A "nonce" on the MAIN-world bridge is theatre (the page shares that world). Reject
   or **downgrade** anything that: cites code that doesn't exist / wrong lines; was
   already fixed (check `SECURITY-AUDIT.md` / CHANGELOG); is a duplicate; overstates
   reachability; or is intent-ambiguous. Be ruthless — false positives erode trust.

4. **Rank surviving findings** by *verified* severity (Critical/High/Medium/Low),
   each with file:line, a concrete attacker scenario, and a recommendation.

### Output

1. Search existing issues on `davetriska02-collab/medicus-suite` for an open one
   titled like `Weekly security audit` from the last 10 days. If one exists, add a
   comment instead of opening a duplicate.
2. Otherwise open ONE issue titled `Weekly security audit — YYYY-MM-DD`, labelled
   `security-audit` and `automated`, with this structure:

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

3. **Heartbeat:** if there are no new findings after verification, still open a
   short issue stating the audit ran clean (with the `main` sha audited), so there
   is a visible signal the routine is working. Do NOT open fix PRs — the user
   triages and decides; to remediate, they (or a follow-up session) fix on a branch
   + PR, as in the v3.28.0 pass.

### What NOT to do

- Do NOT push commits, open PRs, or modify any file (this is a report-only run).
- Do NOT comment on unrelated PRs or issues.
- Do NOT re-report issues already listed as fixed in `SECURITY-AUDIT.md` /
  CHANGELOG, unless you find a genuine regression (say so explicitly).
- Do NOT pad the report with style nits, refactors, or "while you're here" items —
  exploitable security weaknesses and patient-safety logic flaws only.
