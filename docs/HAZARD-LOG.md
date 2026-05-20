# Medicus Suite — Hazard Log

**Version:** 1.4.16  
**Date:** May 2026  
**Author:** Dr Dave Triska, Graysbrook Ltd  
**Clinical Safety Officer:** Dr Dave Triska (GMC 7534932)  
**Status:** Live — reviewed at each release

---

## Risk scoring

**Likelihood:** 1 = Rare / 2 = Unlikely / 3 = Possible / 4 = Likely / 5 = Almost certain  
**Severity:** 1 = Negligible / 2 = Minor / 3 = Moderate / 4 = Major / 5 = Catastrophic  
**Risk score:** Likelihood × Severity. Scores ≥12 require additional control before distribution.

---

## Hazards

### H-001: Rules engine produces false-negative clinical alert

**Description:** A drug-monitoring interval or QOF indicator that should be flagged as overdue is not displayed, or is displayed as current, when it should not be.

**Cause:** QOF business rule implemented incorrectly; threshold value set incorrectly; API data extraction failure; Medicus API response shape change; user-edited threshold diverges from guidance; QOF specification updated but rule file not refreshed.

**Effect:** Clinician does not see an alert that would have prompted action. Patient may miss monitoring review or QOF-required intervention.

**Likelihood:** 2 — Unlikely. Rules are tested in CI; known limitations are documented; drug-monitoring intervals are stable.  
**Severity:** 3 — Moderate. Clinician retains independent responsibility for reviewing the record; Medicus itself surfaces overdue items through its own workflows.  
**Risk score:** 6 — Acceptable with controls.

**Mitigating controls:**
- Automated test suite (228+ tests) runs on every commit covering QOF year logic, threshold comparisons, and coordinate accuracy
- Sentinel displays only what it finds — absence of a chip means no data retrieved, not necessarily a clear result; this is documented in the disclaimer
- QOF 2025/26 specification reference is pinned in rules files; annual review required
- Known limitation H-001(d) (incomplete indicator set) is disclosed in sentinel-DISCLAIMER.txt section 6
- User retains full clinical responsibility for reviewing the source record — not Sentinel — before acting

**Residual risk:** 6 — Acceptable

---

### H-002: Rules engine produces false-positive clinical alert

**Description:** A drug-monitoring interval or QOF indicator is flagged as overdue when it should not be.

**Cause:** QOF register membership incorrectly matched (substring, not SNOMED refset); threshold misconfigured; date logic error; data from incorrect patient loaded into cache.

**Effect:** Clinician may take unnecessary action (e.g. repeating a test already done, or querying a QOF claim that was correctly made). Administrative burden, potential patient inconvenience. No direct patient harm anticipated — over-investigation is possible but clinician judgement would normally intercept.

**Likelihood:** 3 — Possible. Register matching by substring is an acknowledged limitation.  
**Severity:** 2 — Minor. Clinical verification of source record before action is required by the disclaimer.  
**Risk score:** 6 — Acceptable with controls.

**Mitigating controls:**
- Substring register matching limitation explicitly disclosed in sentinel-DISCLAIMER.txt section 6(a)
- User must verify against source record before acting — required by disclaimer
- QOF register matching is conservative (problem label must contain the expected substring) rather than expansive

**Residual risk:** 6 — Acceptable

---

### H-003: Data extraction failure — stale or wrong patient data displayed

**Description:** Sentinel displays cached data from a previous patient while the clinician has navigated to a different patient's record.

**Cause:** Patient navigation event not detected by the extension; browser caching; race condition between navigation and data fetch; Medicus URL structure change.

**Effect:** Clinician sees clinical data for a different patient without realising it. Risk of wrong-patient clinical action.

**Likelihood:** 2 — Unlikely. Patient UUID is used as cache key; navigation detection is implemented via URL monitoring.  
**Severity:** 4 — Major. Wrong-patient data is a significant patient safety event.  
**Risk score:** 8 — Acceptable with controls, but monitored closely.

**Mitigating controls:**
- Cache is keyed by patient UUID, not session — a new patient UUID clears the cache
- URL change detection triggers data refresh
- Patient name is displayed in the Medicus UI header at all times; clinician can cross-check
- Sentinel side panel is visually distinct from the Medicus record — clinician must actively look at it
- The disclaimer requires the clinician to verify all values against the source record

**Residual risk:** 8 — Acceptable. Any report of wrong-patient display should be treated as a significant event and reported to the author immediately.

---

### H-004: Extension interferes with Medicus UI or workflow

**Description:** The extension modifies, obscures, or disrupts the Medicus interface in a way that causes a clinician error in the source record.

**Cause:** CSS injection affecting Medicus layout; JavaScript event handling conflict; extension consuming excessive browser resources causing slowdown; side panel blocking part of the record.

**Effect:** Clinician makes an error in the Medicus record (wrong field edited, submission missed) attributable to UI disruption caused by the extension.

**Likelihood:** 2 — Unlikely. The extension uses Shadow DOM for UI isolation; it does not inject CSS globally into Medicus pages.  
**Severity:** 3 — Moderate.  
**Risk score:** 6 — Acceptable with controls.

**Mitigating controls:**
- Side panel is rendered in an isolated DOM context (Chrome side panel API) — does not overlay or modify the Medicus page DOM
- Content scripts use Shadow DOM to avoid CSS leakage
- Extension performs read-only API calls — no write path exists
- User can close the side panel entirely if it causes any distraction

**Residual risk:** 6 — Acceptable

---

### H-005: Update introduces regression in clinical rule logic

**Description:** A software update changes the behaviour of a clinical rule in a way that produces incorrect output.

**Cause:** Code change introduces bug in rules engine; threshold default changed incorrectly; QOF year date logic regressed; API normaliser broken by endpoint change.

**Effect:** Any of H-001, H-002, or H-003 effects, arising from a code change rather than a design limitation.

**Likelihood:** 2 — Unlikely. Automated tests cover rules logic; CI runs on every commit.  
**Severity:** 3 — Moderate.  
**Risk score:** 6 — Acceptable with controls.

**Mitigating controls:**
- 228+ automated tests must all pass before a release tag is pushed (enforced in CI)
- GitHub Actions release workflow fails if tests fail
- Version number is surfaced in the extension UI and in the update notification banner — users can verify they are on a known version
- Release notes (CHANGELOG.md) document every change to rules logic
- Users should report any unexpected change in extension behaviour after an update

**Residual risk:** 6 — Acceptable

---

### H-006: Clinician overtrusts the extension and does not verify source record

**Description:** Clinician treats a Sentinel chip or panel value as the definitive clinical record rather than as a display aid, and takes clinical action without verifying against the source Medicus record.

**Cause:** Human factors — normalisation of automation bias; time pressure; complacency after repeated correct outputs.

**Effect:** Clinical action taken on the basis of a displayed value that is incorrect (for any reason listed in H-001 to H-005).

**Likelihood:** 3 — Possible. Automation bias is a well-documented human factors risk.  
**Severity:** 3 — Moderate.  
**Risk score:** 9 — Acceptable with controls, but the most important human-factors risk in this system.

**Mitigating controls:**
- Disclaimer is mandatory reading; installation constitutes acceptance
- The extension is visually presented as an overlay — not as the primary record
- The "not the record" principle is stated in the sentinel-DISCLAIMER.txt and README
- User training: the CLINICAL-SAFETY-NOTICE.md distributed with the extension explicitly addresses this risk
- No chip or indicator produced by the extension claims to be the patient record

**Residual risk:** 9 — Acceptable. This is the primary residual risk in the system and should be the focus of any future safety review.

---

### H-007: Data egress — patient data transmitted outside the browser

**Description:** Patient data is transmitted to an external server without the clinician's knowledge or consent.

**Cause:** Code vulnerability; malicious code injection via supply chain; extension update containing malicious payload.

**Effect:** Potential UK GDPR data breach; ICO notification obligation; reputational harm to the practice.

**Likelihood:** 1 — Rare. No network calls to non-Medicus endpoints are made with patient data; update checker transmits version string only.  
**Severity:** 5 — Catastrophic (from an IG perspective).  
**Risk score:** 5 — Acceptable with controls.

**Mitigating controls:**
- Extension makes no outbound calls containing patient data — verified by code review
- The update checker (shared/update-checker.js) transmits only the version string to api.github.com — no patient or practice identifiers
- UPDATE_CHECK_ENABLED can be set to 0 to disable all outbound calls entirely
- All API calls go to Medicus endpoints under the user's own authenticated session — no third-party endpoints
- SECURITY.md documents all network behaviour
- GitHub repository is private; only named collaborators can access source

**Residual risk:** 5 — Acceptable

---

## Hazard summary

| ID | Hazard | Initial score | Residual score | Status |
|----|--------|--------------|----------------|--------|
| H-001 | False-negative alert | 6 | 6 | Acceptable |
| H-002 | False-positive alert | 6 | 6 | Acceptable |
| H-003 | Wrong-patient data | 8 | 8 | Acceptable — monitor |
| H-004 | UI interference | 6 | 6 | Acceptable |
| H-005 | Update regression | 6 | 6 | Acceptable |
| H-006 | Automation bias | 9 | 9 | Acceptable — primary residual risk |
| H-007 | Data egress | 5 | 5 | Acceptable |

No hazard exceeds a risk score of 12. No hazard has a residual score requiring additional control before this distribution.

---

## Review and reporting

This log must be reviewed:
- At each major or minor release
- On any user report of unexpected clinical output
- On any change to the QOF specification
- On any Medicus API change that affects data extraction

Any user who observes unexpected or potentially incorrect clinical output must report it to the author (dave@graysbrook.co.uk) immediately and cease use of the affected module until the issue is investigated. Any event meeting the definition of a patient safety incident under the practice's significant event analysis process must be handled through that process, with notification to the author.

---

## Version history

| Date | Version | Change |
|------|---------|--------|
| May 2026 | 1.0 | Initial hazard log — produced for limited distribution to named GP users |
