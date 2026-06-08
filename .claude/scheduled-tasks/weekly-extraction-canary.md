# Weekly Medicus extraction-drift canary

Paste this body into a scheduled trigger in Claude Code on the web. Recommended
cadence: **weekly** (e.g. Monday 05:00).

> **Why this exists.** The suite reads the live record by scraping the Medicus
> DOM and intercepting its API responses. When Medicus ships a layout or API
> change, those scrapers can stop matching and the extension fails **silently** —
> a blank panel reads as a false "all clear" (HAZARD-LOG H-005, and the
> root cause of the v3.12.1 valproate/QOF miss). This canary watches for that
> drift early.
>
> **Honest constraint.** A scheduled run has **no access to a live, authenticated
> Medicus session** (network policy + per-user auth). It therefore cannot probe
> production. Its job is (a) fixture/unit verification, (b) a fragility review of
> the selector code, and (c) a standing reminder for a human to spot-check against
> live Medicus. It must not claim the extractors "work on live Medicus" — only the
> human spot-check can establish that.

---

## Prompt to use

You are running the weekly Medicus extraction-drift canary for the Medicus Suite
Chrome extension. Work on a branch; open a PR/issue, do not push to `main`.

1. **Run the guards.** Execute the full test suite (`for t in test-*.js; do node
   "$t"; done`) and `node scripts/regen-defaults.js --check`. Pay special
   attention to `test-extraction-health.js` and the extractor tests. Report any
   failure verbatim.

2. **Review the Medicus-facing extraction surface for fragility.** Read the
   selector / parsing code the live path depends on:
   - `engine/extractors/patient-context.js` (DOM selectors for name, NHS, DOB, sex)
   - `engine/extractors/{medications,observations,problems}.js`
   - `engine/data-fetcher.js`, `engine/api-client.js`, `shared/api-diag.js`
   - the page-type routing and DOM scraping in `content-scripts/sentinel.js` and
     `content-scripts/triage-lens/content.js`
   Flag any selector that is brittle (positional, single-class, no fallback),
   any API-shape assumption without a guard, and any place a parse failure would
   return empty rather than surface a visible warning. Cross-check against the
   `assessExtractionHealth` heuristic in `content-scripts/sentinel.js` — does it
   still cover the realistic "everything blank" failure mode?

3. **Check the health-signal is still wired.** Confirm `assessExtractionHealth`
   is still called in the zero-result render path and that the degraded banner is
   reachable. If a refactor has disconnected it, that is a P1 finding.

4. **Diff since last run.** Recover durable state first — this loop is
   report-only, so its state rides in the last canary artefact's body as a
   `loop-state` footer. Parse the most recent `weekly extraction canary` PR/issue
   to learn `lastRunMainSha`:
   ```
   node .claude/scheduled-tasks/scripts/loop-state.js parse < /tmp/last-canary.md
   ```
   Then summarise commits **since `lastRunMainSha`** (`git log
   <lastRunMainSha>..origin/main` — on bootstrap fall back to the past week) that
   touched the extraction surface or Medicus selectors, and whether they added or
   removed a fallback/guard.

5. **Output.** Open a short PR or issue titled `weekly extraction canary <date>`
   with: test/`--check` status, a prioritised list of fragile selectors/guards
   (most fragile first, with file:line), and an explicit **action for a human**:
   "Spot-check the extension against a live Medicus record this week and confirm
   the side panel populates; if it shows the ⚠ 'Couldn't read this record'
   banner or a blank panel on a real record, treat as a Medicus drift incident
   and report to the CSO." If everything is clean, say so plainly — a green week
   is a valid result, not a no-op.

   Append the durable-state footer as the last line of the PR/issue body
   (invisible in the render, parsed by step 4 next week):
   ```
   SHA=$(git rev-parse --short origin/main)
   echo "{\"lastRunMainSha\":\"$SHA\",\"outcome\":\"issue-opened\",\"output\":\"<PR/issue ref>\",\"window\":{\"testsGreen\":true}}" \
     | node .claude/scheduled-tasks/scripts/loop-state.js footer weekly-extraction-canary
   ```
   Set `"testsGreen":false` and `"outcome":"tests-red"` if the guards in step 1
   failed, so a red week is visible in the next run's state read.

Do **not** assert that extraction works on live Medicus; only the human
spot-check in step 5 can establish that.
