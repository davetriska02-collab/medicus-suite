# Pen-test engagement report — template

Outcome-led: every attempted attack is listed with its result. "We tried X and
the control held" is a deliverable.

```
# Pen-test simulation — <YYYY-MM-DD>

**Target:** medicus-suite Chrome MV3 extension
**Version:** <manifest version>   **Tip:** <branch/main short SHA>
**Engagement type:** Authorised, executable red-team simulation (developer-initiated)
**Method:** In-process exploit harnesses driven against the real `engine/` and
`shared/` modules with synthetic malicious inputs. No network egress.
**Disclaimer:** Internal simulation — not a substitute for a formal third-party
pen-test / SOC2 assessment.

## Engagement summary
1-2 sentences on posture. Scenarios run: N. **BLOCKED: x · EXPLOITED: y · N/A: z.**

## Scenario results
| ID | Surface | Attack | Result | Note |
|----|---------|--------|--------|------|
| A1 | import  | proto-pollution via override key | BLOCKED | DANGEROUS_KEYS stripped |
| ...| ...     | ...    | ...    | ...  |

## Exploited (confirmed vulnerabilities — PoC included)
For each EXPLOITED row:
- **<ID> — <title>** — `file:line`
  - Attacker position: <how they deliver the input>
  - Payload: `<exact input>`
  - Observed: <what the real code did>
  - Impact: <data / clinical-safety / integrity>
  - Repro: `node .../pentest-harness.js` (scenario <ID>)
  - Fix idea: <one line>
(If none: "No scenarios were exploited.")

## Downgraded / false positives (transparency)
- <harness EXPLOITED that didn't survive real-path triage> → why it doesn't hold.

## Controls confirmed holding (regression guards that survived)
- <BLOCKED scenarios mapped to the finding they guard, e.g. A2 → F1/NF1 import validation>

## Residual risks (acknowledged, mitigation re-confirmed)
- PDF.js CVE-2024-4367 — `isEvalSupported:false` still in place.
- Plaintext `chrome.storage.local` (non-PHI config) — no new PHI persisted.
- "Load unpacked" install — local dev-mode only, not a remote vector.
```
