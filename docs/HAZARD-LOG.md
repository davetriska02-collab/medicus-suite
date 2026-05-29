# Medicus Suite — Clinical Safety Hazard Log

**Document reference:** MS-CSO-HL-001  
**Software product:** Medicus Suite (Chrome extension)  
**Product version:** 3.4.1  
**Document version:** 3.1  
**Date issued:** 2026-05-29  
**Author:** Dr Dave Triska, Graysbrook Ltd  
**Clinical Safety Officer:** Dr Dave Triska (GMC 7534932), registered GP  
**Status:** Live — reviewed at each minor or major release  
**Applicable standards:** Drafted in the style of DCB0129 (Manufacturer) with consideration of DCB0160 (Deploying Organisation) responsibilities, noting that Medicus Suite is not a Health IT system under the formal scope of those standards but is voluntarily managed against them by the author.

---

## 1. Purpose

This hazard log records the clinical safety hazards identified for Medicus Suite, the controls in place to mitigate them, and the residual risk borne by users of the software. It is maintained by the Clinical Safety Officer (CSO) and reviewed at every release.

The log is intended to be read alongside:

- `docs/CLINICAL-SAFETY-NOTICE.md` — the user-facing safety notice
- `docs/sentinel-DISCLAIMER.txt` — the binding terms of use
- `docs/INTENDED-PURPOSE.md` — the frozen intended-purpose statement

## 2. Scope

This hazard log applies to all functional modules of Medicus Suite v3.4.1, namely:

- **Monitoring (Sentinel)** — HUD display of practice-authored clinical rules, QOF indicators, drug-monitoring intervals, waiting-room list
- **Slot Counter** — display of appointment slot availability
- **Capacity Forecast** — display of historical session/slot usage
- **Submissions Tracker** — display of daily task volume counts
- **Triage Lens** — overlay HUD on Medicus triage pages
- **Activity Report** — display of staff activity counts
- **Referrals Tracker** — display of referral audit data drawn from Medicus
- **Waiting Room / Request Monitor** — live demand display with configurable thresholds
- **Patient Record Visualiser** — offline PDF-based multi-tab clinical dashboard, including: continuity-of-care indices, investigation trends with clinical zone bands, high-risk drug monitoring compliance, Electronic Frailty Index (eFI), PINCER-style prescribing safety flags, QOF register review status, swim-lane event timeline

It covers hazards arising from the technical operation of the extension, from the human factors of its use by trained GP practice staff, and from foreseeable failure modes of the surrounding environment (browser, network, Medicus platform).

It does **not** cover:

- Hazards arising from the underlying Medicus EPR itself — the responsibility of Medicus Health Ltd
- Hazards arising from the practice's own clinical processes — the responsibility of the deploying GP practice
- Hazards arising from use of the extension outside its frozen intended-purpose statement — explicitly out of scope per the disclaimer

## 3. Hazard identification methodology

Hazards were identified using the following techniques, applied iteratively across development sprints:

1. **Functional decomposition** — each module was decomposed into its data sources, transformations, and display outputs; each step was examined for foreseeable failure.
2. **HAZOP-style "what if" prompts** — applied to each data flow ("what if the patient changes mid-fetch?", "what if the API returns an empty array?", "what if a rule is misconfigured?", "what if the PDF is six months old?", "what if a drug appears under a brand name?").
3. **Human factors review** — consideration of automation bias, alert fatigue, misinterpretation, out-of-context display, and point-in-time data reuse.
4. **Code review and security review** — examination of network calls, storage, permissions, and supply chain.
5. **Incident learning** — any reported anomaly or near-miss is reviewed and the log updated.

Hazards are recorded against the frozen intended-purpose statement. Hazards arising from out-of-purpose use are noted but not assigned residual scores, as such use is excluded by the disclaimer.

## 4. Risk scoring matrix

Risk is scored as **Severity × Likelihood** on the matrices below.

### Severity (1–5)

| Score | Label | Definition (patient safety) |
|-------|-------|------------------------------|
| 1 | Negligible | No clinical impact; user inconvenience only |
| 2 | Minor | Brief delay or unnecessary effort; no harm to patient |
| 3 | Moderate | Possible unnecessary investigation, missed administrative deadline, or short-lived clinical inconvenience; no lasting harm |
| 4 | Major | Plausible delayed diagnosis, missed monitoring, or wrong-patient action that would normally be intercepted by other controls |
| 5 | Catastrophic | Severe or permanent harm to a patient, or major information governance breach |

### Likelihood (1–5)

| Score | Label | Definition |
|-------|-------|------------|
| 1 | Rare | Not expected during the lifetime of the product |
| 2 | Unlikely | Could occur but would be unusual |
| 3 | Possible | Could occur from time to time |
| 4 | Likely | Will probably occur in normal use |
| 5 | Almost certain | Will occur frequently |

### Risk acceptability

| Risk score | Acceptability |
|------------|---------------|
| 1–4 | Broadly acceptable |
| 5–9 | Acceptable with documented controls (ALARP) |
| 10–14 | Tolerable only with additional controls; CSO sign-off required |
| 15–25 | Unacceptable — distribution must be suspended until mitigated |

A residual score of 12 or above blocks release. A residual score of 10 or 11 requires explicit written CSO acceptance recorded against the hazard.

---

## 5. Hazard register

### H-001 — Stale or wrong-patient data displayed

| Field | Value |
|-------|-------|
| **Hazard ID** | H-001 |
| **Description** | Monitoring (Sentinel), Triage Lens, or Referrals Tracker displays clinical data belonging to a previously-viewed patient while the clinician has navigated to a different patient's record. |
| **Potential causes** | Patient-change navigation event not detected (Medicus uses client-side routing); race condition between URL change and asynchronous API fetch; in-memory cache not invalidated; Medicus URL pattern changes after a release; tab restored from browser session with prior state. |
| **Affected users / components** | Clinicians and any user viewing patient-specific data. Components: `content-scripts/sentinel.js`, `engine/data-fetcher.js`, `engine/extractors/patient-context.js`. |
| **Initial severity** | 4 (Major — wrong-patient clinical action) |
| **Initial likelihood** | 3 (Possible without controls) |
| **Initial risk** | 12 |
| **Controls / mitigations** | (a) Cache keyed by patient UUID extracted from URL — a UUID change clears prior state. (b) URL-change watcher triggers re-fetch and clears prior chips. (c) Patient name remains visible in the native Medicus header at all times; clinician can cross-check. (d) Side panel is visually distinct from the Medicus record and not mistakable for it. (e) Disclaimer mandates verification of every displayed value against the source record before any clinical action. (f) Loading state is rendered before chips appear so a clinician cannot see stale chips superimposed on a new patient. |
| **Residual severity** | 4 |
| **Residual likelihood** | 2 |
| **Residual risk** | 8 — Acceptable (ALARP) |
| **Acceptability** | Accepted. Any report of wrong-patient display is treated as a significant safety event and triggers immediate CSO review and a hot-fix release. |

---

### H-002 — False-negative clinical indicator (missing alert)

| Field | Value |
|-------|-------|
| **Hazard ID** | H-002 |
| **Description** | A drug-monitoring interval that is overdue, or a QOF indicator that is unachieved, is not surfaced by Monitoring when it should be. |
| **Potential causes** | QOF register membership not matched (substring miss); rule omitted from curated rule set; Medicus API response shape change breaks normaliser; encounter-coded entry not present on the investigation dashboard endpoint; rule disabled by practice configuration; user-edited threshold diverges from current guidance. |
| **Affected users / components** | Clinicians using Monitoring for monitoring or QOF review. Components: `engine/rules-engine.js`, `engine/normalisers.js`, `rules/*`. |
| **Initial severity** | 3 (Moderate — missed monitoring, eventually caught by Medicus's own workflows) |
| **Initial likelihood** | 3 (Possible — curated rule set is intentionally a subset) |
| **Initial risk** | 9 |
| **Controls / mitigations** | (a) Monitoring is positioned as a memory aid, not the system of record — see `CLINICAL-SAFETY-NOTICE.md`. (b) Absence of a chip is documented as "no data retrieved or no rule defined", not "clear". (c) The disclaimer explicitly discloses incomplete coverage. (d) Medicus itself surfaces overdue monitoring and QOF items independently of the extension. (e) 230+ unit tests cover threshold and date logic. (f) Annual QOF specification review is a documented release checklist item. |
| **Residual severity** | 3 |
| **Residual likelihood** | 2 |
| **Residual risk** | 6 — Acceptable (ALARP) |
| **Acceptability** | Accepted. The clinician remains responsible for reviewing the Medicus record. |

---

### H-003 — False-positive clinical indicator (spurious alert)

| Field | Value |
|-------|-------|
| **Hazard ID** | H-003 |
| **Description** | A drug-monitoring interval or QOF indicator is shown as overdue or unachieved when it has in fact been completed or is not applicable to the patient. |
| **Potential causes** | Substring register match catches an unintended problem label; date arithmetic error around year boundaries; user-misconfigured rule; threshold edited locally and not reverted; coded entry present but on a different endpoint than the rule queries. |
| **Affected users / components** | Clinicians and QOF leads. Components: `engine/rules-engine.js`, `rules/*`, `sentinel-options/*`. |
| **Initial severity** | 2 (Minor — repeat test or unnecessary clinical attention) |
| **Initial likelihood** | 3 (Possible) |
| **Initial risk** | 6 |
| **Controls / mitigations** | (a) Substring matching limitation explicitly disclosed. (b) Verification against source record required by disclaimer before any action. (c) Register match logic is intentionally conservative (label must contain the expected substring). (d) Test suite includes false-positive regression cases (`test-custom-rules.js`, `test-qof-year.js`). (e) Practice-authored custom rules are constrained to three supported check shapes via the form builder — arbitrary logic is not exposed. |
| **Residual severity** | 2 |
| **Residual likelihood** | 3 |
| **Residual risk** | 6 — Acceptable (ALARP) |
| **Acceptability** | Accepted. Over-investigation risk exists but is intercepted by clinician verification of the source record. |

---

### H-004 — Practice-authored rule is clinically incorrect

| Field | Value |
|-------|-------|
| **Hazard ID** | H-004 |
| **Description** | A rule authored by the practice (in the Monitoring form builder or via custom-indicator import) produces clinically incorrect output because the rule itself is wrong, not because the extension malfunctioned. |
| **Potential causes** | Author misreads current guidance; threshold value mis-typed; register substring is too broad or too narrow; rule not reviewed when guidance changes; rule copied from another practice without review; multiple rule revisions cause stale rule to be active. |
| **Affected users / components** | Clinicians relying on practice-authored rules. Components: `sentinel-options/*`, `shared/io/*`, rule import/export. |
| **Initial severity** | 3 (Moderate) |
| **Initial likelihood** | 3 (Possible — depends on practice rule-authoring discipline) |
| **Initial risk** | 9 |
| **Controls / mitigations** | (a) The deploying practice is responsible for clinical validity of its own rules — stated in `CLINICAL-SAFETY-NOTICE.md` and in the disclaimer. (b) The form builder constrains rule logic to three engine-supported shapes (observation-threshold, medication-present, observation-recent) — arbitrary decision logic is not exposed. (c) Custom rules are visually labelled "Custom" in the UI. (d) Custom rules are explicitly not QOF rules; their points field is metadata only. (e) Backup/restore of rule sets allows the practice to review historical configurations. (f) The CSO recommends practices nominate a rules owner who reviews custom rules at each guidance update. |
| **Residual severity** | 3 |
| **Residual likelihood** | 2 |
| **Residual risk** | 6 — Acceptable (ALARP), with explicit deploying-organisation duty |
| **Acceptability** | Accepted, subject to the practice fulfilling its DCB0160-style duties as described in `CLINICAL-SAFETY-NOTICE.md`. |

---

### H-005 — Silent failure of the extension

| Field | Value |
|-------|-------|
| **Hazard ID** | H-005 |
| **Description** | The extension fails to load, or one of its modules stops functioning, without producing a visible error — leading users to assume the absence of chips or alerts means an "all clear" result. |
| **Potential causes** | Chrome update breaks the extension; manifest permission revoked; content script failed to inject; Medicus DOM changes such that selectors no longer match; uncaught exception in the rules engine; service worker terminated and not revived; user disabled the extension in `chrome://extensions` without realising. |
| **Affected users / components** | All users. Components: `service-worker.js`, `manifest.json`, all content scripts. |
| **Initial severity** | 3 (Moderate — false reassurance leads to missed action) |
| **Initial likelihood** | 3 (Possible — browser and Medicus both evolve) |
| **Initial risk** | 9 |
| **Controls / mitigations** | (a) The user-facing safety notice states explicitly that absence of a chip is not equivalent to "all clear". (b) The extension icon in the toolbar is the primary "alive" indicator; the popup shows version and status. (c) The Options page version banner identifies the running version and the latest available version. (d) Logging of fetch failures and rule-engine exceptions is available via the developer console. (e) Medicus surfaces overdue items independently of the extension — Monitoring is not the only line of defence. (f) Users are instructed to stop relying on the extension and verify the source record if a module appears blank or behaves unexpectedly. |
| **Residual severity** | 3 |
| **Residual likelihood** | 2 |
| **Residual risk** | 6 — Acceptable (ALARP) |
| **Acceptability** | Accepted. Independent Medicus workflows remain the primary safety net. |

---

### H-006 — Update introduces a regression in clinical logic

| Field | Value |
|-------|-------|
| **Hazard ID** | H-006 |
| **Description** | A new release of Medicus Suite changes the behaviour of a clinical rule or data extractor in a way that produces incorrect output that was not present in the prior release. |
| **Potential causes** | Bug introduced in rule engine; default threshold inadvertently changed; date logic regressed at year boundary; normaliser broken by refactor; supply-chain change in a dependency. |
| **Affected users / components** | All users on the affected version. Components: any code path under `engine/`, `content-scripts/`, `rules/`. |
| **Initial severity** | 3 (Moderate) |
| **Initial likelihood** | 2 (Unlikely — CI gates) |
| **Initial risk** | 6 |
| **Controls / mitigations** | (a) The full automated test suite (230+ tests at v3.4.1) must pass before a release tag is pushed; CI release workflow fails closed. (b) Test files cover rule engine, QOF year logic, custom indicators, IO, update checker, and request monitor. (c) `CHANGELOG.md` documents every change. (d) Version number is surfaced in the Options page and popup. (e) The auto-update mechanism alerts users to new versions but does not auto-install. (f) A CSO-approved hot-fix release can be cut within hours. |
| **Residual severity** | 3 |
| **Residual likelihood** | 2 |
| **Residual risk** | 6 — Acceptable (ALARP) |
| **Acceptability** | Accepted. |

---

### H-007 — Clinician automation bias (over-trust of displayed values)

| Field | Value |
|-------|-------|
| **Hazard ID** | H-007 |
| **Description** | A clinician treats a Monitoring chip, a Triage Lens summary, a Referrals Tracker row, or a Patient Record Visualiser output as the definitive clinical record and takes clinical action without verifying the underlying Medicus record. |
| **Potential causes** | Time pressure; complacency after repeated correct outputs; visual prominence of chips; pattern of "green = done"; alert fatigue causing inverse trust ("if it's not red I won't check"); junior staff assuming the extension is authoritative; Visualiser eFI or PINCER output treated as a clinical assessment rather than a prompt to review. |
| **Affected users / components** | All clinical users. Components: any display module. |
| **Initial severity** | 3 (Moderate — clinical action based on incorrect display) |
| **Initial likelihood** | 4 (Likely — automation bias is a well-documented human factors phenomenon) |
| **Initial risk** | 12 |
| **Controls / mitigations** | (a) The "single most important rule" in `CLINICAL-SAFETY-NOTICE.md` explicitly requires verification of every value against the source record before any clinical action. (b) The disclaimer makes verification a binding condition of use. (c) The side panel is visually positioned as an overlay — not styled to imitate the Medicus record. (d) No chip uses language that asserts clinical truth. (e) The Clinical Safety Notice is required reading before installation. (f) The deploying practice is asked to brief users at induction on the "not the record" principle. (g) Custom indicators are visually labelled "Custom". (h) Visualiser eFI and PINCER outputs are explicitly labelled as supplementary screening aids with disclosed limitations. |
| **Residual severity** | 3 |
| **Residual likelihood** | 3 |
| **Residual risk** | 9 — Acceptable (ALARP); identified as the **primary residual risk** in the system |
| **Acceptability** | Accepted. This is the most important residual risk and is the focus of safety messaging. Any future safety review must revisit this hazard. |

---

### H-008 — Patient identification error in the Referrals Tracker

| Field | Value |
|-------|-------|
| **Hazard ID** | H-008 |
| **Description** | The Referrals Tracker displays a row attributing a referral to the wrong patient, clinician, specialty, or hospital, leading a user to investigate the wrong record or act on the wrong information. |
| **Potential causes** | Column mis-mapping after a Medicus clinical-audit-report API change; sort/filter applied to one column but rendered against another; pagination boundary error; identically-named patients confused on display. |
| **Affected users / components** | Practice managers, QOF/referral leads, clinicians reviewing referrals. Components: `side-panel/modules/referrals/*`, `content-scripts/referrals-discovery.js`. |
| **Initial severity** | 3 (Moderate — admin re-work, very low probability of clinical action without further verification) |
| **Initial likelihood** | 2 (Unlikely) |
| **Initial risk** | 6 |
| **Controls / mitigations** | (a) Referral records are not stored persistently — each refresh re-fetches from Medicus. (b) The tracker is positioned as an admin/audit tool; clicking into a record returns the user to Medicus. (c) Patient name is shown alongside referral metadata so the user can cross-check. (d) Column mappings are derived from the Medicus API response keys, not from positional indexing. (e) Any reported mis-attribution triggers immediate CSO review. |
| **Residual severity** | 3 |
| **Residual likelihood** | 2 |
| **Residual risk** | 6 — Acceptable (ALARP) |
| **Acceptability** | Accepted. |

---

### H-009 — Patient data egress (data leaves the browser)

| Field | Value |
|-------|-------|
| **Hazard ID** | H-009 |
| **Description** | Patient-identifiable data is transmitted to a server outside the user's authenticated Medicus session, contrary to the intended-purpose statement. |
| **Potential causes** | Code defect creates an unintended outbound request; supply-chain compromise; hostile extension update; user installs a forked or modified copy from an unofficial source; copy-paste error placing patient data in an outbound update-check request. |
| **Affected users / components** | All users and their patients. Information governance impact for the deploying practice. Components: `service-worker.js`, `shared/update-checker.js`, `engine/api-client.js`. |
| **Initial severity** | 5 (Catastrophic from an IG perspective; reportable to ICO) |
| **Initial likelihood** | 2 (Unlikely) |
| **Initial risk** | 10 |
| **Controls / mitigations** | (a) The manifest's `host_permissions` are restricted to `*.medicus.health/*`, `*.api.england.medicus.health/*`, and `api.github.com/*` — outbound calls to any other host require a manifest change and a new release. (b) The update checker transmits only the version string to the GitHub releases API — no patient or practice identifiers. (c) Update checks can be disabled entirely via the Options page. (d) All Medicus API calls reuse the user's existing session cookies — no separate credentials are stored. (e) Code review and CI inspect `manifest.json` and outbound fetch calls at every release. (f) The repository is private; releases are built via the GitHub Actions release workflow. (g) Users are instructed never to install from an unofficial source. (h) The Visualiser processes PDFs entirely in-memory; no PDF content is transmitted externally. |
| **Residual severity** | 5 |
| **Residual likelihood** | 1 |
| **Residual risk** | 5 — Acceptable (ALARP) |
| **Acceptability** | Accepted. Any suspicion of egress triggers immediate suspension of distribution and CSO investigation. |

---

### H-010 — Data displayed out of context (misinterpretation)

| Field | Value |
|-------|-------|
| **Hazard ID** | H-010 |
| **Description** | A correctly-extracted value is displayed without the contextual qualifiers that change its clinical meaning (e.g. an HbA1c result from before a diagnostic change of treatment; a BP recorded under unusual conditions; a referral whose "open" status reflects an administrative backlog rather than clinical reality). |
| **Potential causes** | Monitoring chips show single most-recent values without surrounding history; the API response does not include qualifiers; referrals appear "open" when actually awaiting administrative closure; waiting-room times reflect login state, not clinical urgency. |
| **Affected users / components** | All users. Components: all display modules. |
| **Initial severity** | 3 (Moderate) |
| **Initial likelihood** | 3 (Possible) |
| **Initial risk** | 9 |
| **Controls / mitigations** | (a) Monitoring chips link back to the Medicus record where full context is visible. (b) The Clinical Safety Notice states explicitly that the extension reorganises data already in Medicus — it does not interpret it. (c) Threshold checks are described in the disclaimer as arithmetic, not clinical. (d) No chip applies clinical language that asserts meaning beyond the threshold check. (e) The deploying practice's induction is asked to cover the "in-context vs out-of-context" distinction. |
| **Residual severity** | 3 |
| **Residual likelihood** | 2 |
| **Residual risk** | 6 — Acceptable (ALARP) |
| **Acceptability** | Accepted. |

---

### H-011 — Browser or platform compatibility failure

| Field | Value |
|-------|-------|
| **Hazard ID** | H-011 |
| **Description** | The extension behaves incorrectly on an unsupported browser, browser version, operating system, or screen configuration — for example silently dropping a module, mis-rendering a chip, or producing layout overlap with Medicus. |
| **Potential causes** | User installs on a Chromium-derivative (Edge, Brave) rather than supported Chrome; Manifest V3 API behaviour differs between Chrome channels; high-DPI scaling; very small viewport; OS-level accessibility settings; corporate group policy disables side panel API. |
| **Affected users / components** | Users on non-standard browsers or screen configurations. Components: all UI surfaces, `manifest.json`. |
| **Initial severity** | 2 (Minor — usability impact) |
| **Initial likelihood** | 3 (Possible) |
| **Initial risk** | 6 |
| **Controls / mitigations** | (a) Supported browser stated as Google Chrome stable channel (README). (b) Manifest V3 conformant; side panel API used in the recommended way. (c) Shadow DOM isolates extension CSS from Medicus CSS. (d) If a layout overlap is reported, user can close the side panel without losing Medicus state. (e) Practice IT is asked to confirm Chrome is the standard browser before deployment. |
| **Residual severity** | 2 |
| **Residual likelihood** | 2 |
| **Residual risk** | 4 — Broadly acceptable |
| **Acceptability** | Accepted. |

---

### H-012 — Alert fatigue and inhibition of independent verification

| Field | Value |
|-------|-------|
| **Hazard ID** | H-012 |
| **Description** | Repeated low-value or false-positive alerts cause users to dismiss Monitoring or Triage Lens chips without due attention, including dismissing alerts that on a given occasion are genuinely meaningful — or cause users to bypass their normal verification step because "the extension would have flagged it". |
| **Potential causes** | Practice-authored rule set is too broad; bundled rule set produces excessive chips for some patient cohorts; chips persist across sessions; visual prominence too aggressive; no way to dismiss-with-reason. |
| **Affected users / components** | All clinical users. Components: Monitoring display logic, Triage Lens HUD, `sentinel-options/*`. |
| **Initial severity** | 3 (Moderate) |
| **Initial likelihood** | 3 (Possible) |
| **Initial risk** | 9 |
| **Controls / mitigations** | (a) The deploying practice is asked to curate its rule set rather than enabling everything by default. (b) Custom rules can be disabled individually via the Options page. (c) Chips are colour-coded so that the user's eye is drawn to the most clinically relevant. (d) The Clinical Safety Notice frames the extension as a memory aid, not a workflow gate. (e) The CSO recommends that practices monitor for "alert fatigue" anecdotally and adjust rule sets accordingly. |
| **Residual severity** | 3 |
| **Residual likelihood** | 2 |
| **Residual risk** | 6 — Acceptable (ALARP) |
| **Acceptability** | Accepted, with deploying-organisation duty to curate rule sets. |

---

### H-013 — Patient Record Visualiser — PDF snapshot staleness

| Field | Value |
|-------|-------|
| **Hazard ID** | H-013 |
| **Description** | The Patient Record Visualiser is loaded with an EPR export PDF that was generated at some point in the past. Clinical information displayed — including medications, investigations, problems, frailty score, prescribing flags, and monitoring compliance — may not reflect the patient's current clinical status if the PDF is outdated. |
| **Potential causes** | User re-uses a PDF exported at a prior consultation; PDF generated days or weeks before the current session; multiple clinical events have occurred since export (medications changed, investigations resulted, problems resolved or added); user shares a PDF with a colleague who analyses it later. |
| **Affected users / components** | Any user of the Patient Record Visualiser. Components: `visualiser-core.html`, `visualiser-core.js`. |
| **Initial severity** | 4 (Major — clinical decision based on stale data) |
| **Initial likelihood** | 3 (Possible — PDF workflow naturally introduces a lag between export and analysis) |
| **Initial risk** | 12 |
| **Controls / mitigations** | (a) PDF export date is extracted from the document and displayed prominently in the patient banner at the top of the Visualiser. (b) User instructions state that the most recently exported PDF should be used. (c) The Visualiser is positioned as an audit and analytical tool, not a substitute for the live record. (d) Verification against the current live Medicus record is required by the disclaimer before any clinical action. (e) The Visualiser opens in a separate browser tab, visually distinct from the live Medicus session — the two cannot be confused. (f) Clinical Safety Notice section 7 explicitly lists PDF staleness as a known limitation. |
| **Residual severity** | 4 |
| **Residual likelihood** | 2 |
| **Residual risk** | 8 — Acceptable (ALARP) |
| **Acceptability** | Accepted. Any clinical action informed by the Visualiser must be verified against the current Medicus record before it is taken. |

---

### H-014 — Patient Record Visualiser — silent partial data omission during PDF parsing

| Field | Value |
|-------|-------|
| **Hazard ID** | H-014 |
| **Description** | The PDF text extraction layer fails to parse some entries from the record — for example entries on pages with unusual layout, items rendered as images, or sections using non-standard fonts — and the Visualiser displays a dashboard that silently omits those entries. |
| **Potential causes** | pdf.js returning text items without `transform` data (certain font types or print drivers); non-text PDF elements (images, form fields, scanned pages); encrypted or DRM-protected PDFs; Medicus changing its PDF export layout after a Visualiser release; very large PDFs; page-level parse errors in the `reconstructLines` function. |
| **Affected users / components** | All Visualiser users. Components: `visualiser-core.js` `parsePDF()`, `reconstructLines()`. |
| **Initial severity** | 3 (Moderate — analytical conclusions may be based on an incomplete record) |
| **Initial likelihood** | 2 (Unlikely — item-level `transform` guard prevents crash; standard Medicus PDF exports are text-based) |
| **Initial risk** | 6 |
| **Controls / mitigations** | (a) `reconstructLines()` includes a guard (`!item.transform`) that skips malformed text items rather than crashing, preventing silent partial display from becoming a complete failure. (b) Stage-aware error messages in the catch block identify which parsing stage failed (v1.8.0). (c) `[Visualiser]` prefixed warnings are logged to the browser console for any parse anomaly. (d) Entry counts are displayed throughout the Visualiser (e.g. filter bar "Showing N of M entries") so a user can detect implausibly low counts. (e) Verification against the live Medicus record is required before any clinical action. |
| **Residual severity** | 3 |
| **Residual likelihood** | 2 |
| **Residual risk** | 6 — Acceptable (ALARP) |
| **Acceptability** | Accepted. |

---

### H-015 — eFI score inaccuracy (frailty under- or over-estimated)

| Field | Value |
|-------|-------|
| **Hazard ID** | H-015 |
| **Description** | The Electronic Frailty Index (eFI) score computed by the Visualiser is inaccurate — either overstating frailty (leading to unnecessary frailty-pathway intervention or labelling) or understating it (leading to frailty being overlooked in clinical planning). The Charlson Comorbidity Index and the condition-summary cards (v3.5.0) share this same keyword-matching limitation and are likewise display-only indicators, not diagnostic outputs. |
| **Potential causes** | Deficit detection relies on substring matching of problem-list text against a 36-deficit reference list; non-standard or abbreviated problem coding may miss deficits; historical problems (inactive but still listed) may over-count; the 36-deficit set is based on the Clegg 2016 academic index and may not exactly replicate the eFI as calculated from SNOMED refsets in GP clinical systems; very sparse problem lists (new patients, recently registered patients) will produce artifactually low scores. |
| **Affected users / components** | Clinicians using the Snapshot tab. Components: `visualiser-core.js` `computeEFI()`, `EFI_DEFICITS` constant. |
| **Initial severity** | 3 (Moderate — frailty status is a screening indicator used to inform care planning; it is not a diagnostic label and clinical frailty assessment requires clinical synthesis) |
| **Initial likelihood** | 3 (Possible — problem-list coding variability is common in GP records) |
| **Initial risk** | 9 |
| **Controls / mitigations** | (a) eFI is displayed alongside the detected deficit count (e.g. "8/36 deficits detected") so the user can see the basis for the score. (b) The gauge category labels (Fit / Mild / Moderate / Severe) are from the published Clegg index and are standard frailty categories, not novel clinical labels. (c) The Visualiser is an analytical aid, not a diagnostic system; the eFI is one data point in the Snapshot tab alongside the full problem list. (d) Clinical frailty classification must be validated by the clinician against the full clinical picture and direct patient assessment. (e) The disclaimer and Clinical Safety Notice (section 7, limitation 12) explicitly state that the eFI is an arithmetic approximation. (f) No clinical workflow or referral pathway is triggered by the eFI score in the software — it is display only; the v3.5.0 Charlson index and condition-summary cards are likewise display-only, show the contributing coded problems, flag missing inputs (e.g. "age unknown", "no recent value"), and carry no mortality-percentage mapping. |
| **Residual severity** | 3 |
| **Residual likelihood** | 3 |
| **Residual risk** | 9 — Acceptable (ALARP) |
| **Acceptability** | Accepted. Clinician retains full responsibility for frailty classification and any frailty-pathway decisions. |

---

### H-016 — PINCER / drug-monitoring false-negative (prescribing safety hazard missed)

| Field | Value |
|-------|-------|
| **Hazard ID** | H-016 |
| **Description** | The Visualiser fails to surface a PINCER prescribing safety flag or a high-risk drug monitoring overdue indicator when one should be present — for example, a patient is taking an NSAID and has heart failure, or is on methotrexate with monitoring now overdue, but no flag appears in the Medications tab or Snapshot. |
| **Potential causes** | Drug name in the PDF text is a brand name, abbreviation, or coding variant not matched by the drug-family regex; disease label does not contain the expected substring; the drug-disease combination is not in the implemented PINCER rule set (5 combinations at v3.4.1); monitoring investigation uses a local or abbreviated name not matched to the expected panel name; the PDF section containing the drug or problem was not extracted (see H-014); historical prescribing not visible in the export window. |
| **Affected users / components** | Clinicians using the Medications tab or Snapshot PINCER card. Components: `visualiser-core.js` `computePINCER()`, `computeDrugMonitoring()`, `HIGH_RISK_DRUGS` constant, `PINCER_RULES` constant. |
| **Initial severity** | 4 (Major — a clinically significant prescribing safety hazard is not surfaced) |
| **Initial likelihood** | 3 (Possible — regex-based detection; limited PINCER rule set at v3.4.1) |
| **Initial risk** | 12 |
| **Controls / mitigations** | (a) The PINCER implementation is explicitly documented as a subset of the full PINCER tool — it is supplementary to Medicus's own prescribing safety systems, which remain the primary clinical safety gate. (b) The implemented PINCER rules and drug families are listed in `INTENDED-PURPOSE.md` and the known limitations section of the Clinical Safety Notice. (c) Absence of a PINCER flag is explicitly documented as not a guarantee of prescribing safety (Clinical Safety Notice section 7, limitation 13). (d) Drug-family regex is designed to capture common brand names and generic variants for each family, but cannot cover all possible nomenclature variants. (e) Medicus's own drug interaction and contraindication checking system operates independently of this extension. (f) Verification against the live Medicus record is required by the disclaimer before any clinical action. |
| **Residual severity** | 4 |
| **Residual likelihood** | 2 |
| **Residual risk** | 8 — Acceptable (ALARP) |
| **Acceptability** | Accepted, with the express condition that PINCER flags in the Visualiser are supplementary prompts only and that Medicus's own prescribing safety systems remain the primary clinical control. |

---

### H-017 — PINCER / drug-monitoring false-positive (spurious prescribing safety flag)

| Field | Value |
|-------|-------|
| **Hazard ID** | H-017 |
| **Description** | A PINCER prescribing safety flag or drug monitoring overdue badge is shown when no clinical hazard exists — for example, a drug is no longer prescribed but appears in the historical medication list in the PDF, or a disease label matches the substring but the condition is resolved, or a monitoring test was performed recently but was not detected in the PDF text. |
| **Potential causes** | PDF export includes historical medications that are no longer active and are not clearly labelled as discontinued; problem list contains historically-coded problems now resolved; monitoring test uses a locally-abbreviated name not matched to the expected investigation name; date parsing error causes a recent test to appear older than it is. |
| **Affected users / components** | All Visualiser users. Components: `visualiser-core.js` `computePINCER()`, `computeDrugMonitoring()`. |
| **Initial severity** | 2 (Minor — unnecessary clinical review; no harm to patient) |
| **Initial likelihood** | 3 (Possible — PDF-based extraction cannot reliably distinguish active from historical medications in all Medicus export formats) |
| **Initial risk** | 6 |
| **Controls / mitigations** | (a) Verification against the live Medicus record is required before any clinical action — a false-positive flag leads to a brief unnecessary check, not patient harm. (b) The Medications tab displays the source context (drug name as detected in the PDF) alongside the flag, allowing the clinician to judge its currency. (c) The disclaimer and Clinical Safety Notice frame flags as prompts to check, not clinical decisions. (d) False-positive flags are a minor inconvenience, not a safety hazard in themselves — they prompt verification rather than preventing it. |
| **Residual severity** | 2 |
| **Residual likelihood** | 3 |
| **Residual risk** | 6 — Acceptable (ALARP) |
| **Acceptability** | Accepted. |

---

### H-018 — Patient-identifiable data entered into the feedback email

| Field | Value |
|-------|-------|
| **Hazard ID** | H-018 |
| **Description** | The in-app Feedback / feature request / bug report control composes an email to the developer via the user's own mail client. A user could type or paste patient-identifiable information (name, NHS number, date of birth, clinical detail) into the subject or body, causing it to be transmitted outside the authenticated Medicus session to the configured recipient inbox. |
| **Potential causes** | User pastes record content to illustrate a bug; user describes a specific patient rather than the behaviour; misunderstanding that the channel is internal/anonymised. |
| **Affected users / components** | The reporting user and any patient they reference; information-governance impact for the deploying practice. Components: `side-panel/panel.js` (feedback composer), Options › Suite (`suite.feedbackEmail` recipient). |
| **Initial severity** | 4 (Major — confidentiality breach, but bounded: single known recipient, user-initiated, requires deliberate text entry) |
| **Initial likelihood** | 2 (Unlikely) |
| **Initial risk** | 8 |
| **Controls / mitigations** | (a) The feedback form displays an explicit warning not to include patient-identifiable information (names, NHS numbers, dates of birth). (b) The extension auto-attaches only non-clinical diagnostics — suite version, browser user-agent, and timestamp; it never auto-includes any record data. (c) The email opens pre-filled in the user's own mail client and must be reviewed and sent manually — the extension transmits nothing itself and has no server endpoint (`mailto:` only). (d) The recipient address is configurable (Options › Suite), so a practice may direct feedback to an internal, IG-approved mailbox rather than an external one. (e) The Clinical Safety Notice instructs users that feedback must never contain patient data. |
| **Residual severity** | 4 |
| **Residual likelihood** | 1 |
| **Residual risk** | 4 — Acceptable (ALARP) |
| **Acceptability** | Accepted. Any report received containing patient-identifiable data is to be deleted and the sender reminded of the rule. |

---

## 6. Hazard summary

| ID | Hazard | Initial S×L | Initial risk | Residual S×L | Residual risk | Status |
|----|--------|-------------|-------------|--------------|---------------|--------|
| H-001 | Wrong-patient data (live panel) | 4×3 | 12 | 4×2 | 8 | Accepted (ALARP) — monitor |
| H-002 | False-negative indicator | 3×3 | 9 | 3×2 | 6 | Accepted (ALARP) |
| H-003 | False-positive indicator | 2×3 | 6 | 2×3 | 6 | Accepted (ALARP) |
| H-004 | Practice-authored rule incorrect | 3×3 | 9 | 3×2 | 6 | Accepted (ALARP) |
| H-005 | Silent failure | 3×3 | 9 | 3×2 | 6 | Accepted (ALARP) |
| H-006 | Update regression | 3×2 | 6 | 3×2 | 6 | Accepted (ALARP) |
| H-007 | Automation bias | 3×4 | 12 | 3×3 | 9 | Accepted (ALARP) — **primary residual risk** |
| H-008 | Referral mis-attribution | 3×2 | 6 | 3×2 | 6 | Accepted (ALARP) |
| H-009 | Patient data egress | 5×2 | 10 | 5×1 | 5 | Accepted (ALARP) |
| H-010 | Out-of-context display | 3×3 | 9 | 3×2 | 6 | Accepted (ALARP) |
| H-011 | Browser/platform compatibility | 2×3 | 6 | 2×2 | 4 | Broadly acceptable |
| H-012 | Alert fatigue | 3×3 | 9 | 3×2 | 6 | Accepted (ALARP) |
| H-013 | Visualiser PDF staleness | 4×3 | 12 | 4×2 | 8 | Accepted (ALARP) — monitor |
| H-014 | Visualiser silent data omission | 3×3 | 9 | 3×2 | 6 | Accepted (ALARP) |
| H-015 | eFI score inaccuracy | 3×3 | 9 | 3×3 | 9 | Accepted (ALARP) |
| H-016 | PINCER/drug-monitoring false-negative | 4×3 | 12 | 4×2 | 8 | Accepted (ALARP) — monitor |
| H-017 | PINCER/drug-monitoring false-positive | 2×3 | 6 | 2×3 | 6 | Accepted (ALARP) |
| H-018 | PID in feedback email | 4×2 | 8 | 4×1 | 4 | Accepted (ALARP) |

No hazard has a residual risk score exceeding 9. No hazard at residual score 10 or above is open. The release of v3.4.1 is approved by the Clinical Safety Officer on the basis of this hazard log.

## 7. Review and reporting

This log is reviewed:

- At every minor or major release of Medicus Suite
- On any reported safety incident, near-miss or anomalous output
- On any annual QOF specification refresh
- On any change to Medicus's APIs that affects data extraction
- On any change to UK regulatory guidance on software as a medical device
- On any change to NICE, BNF, or KDIGO guidance affecting implemented clinical thresholds or monitoring intervals

Reports of suspected hazardous behaviour must be sent to the CSO at **dave@graysbrook.co.uk** with sufficient detail to investigate (date, time, version, module, observed output, expected output). Patient-identifiable data must not be sent by email — use the practice's own information governance channels.

If an incident meeting the threshold of a patient safety incident is identified, it must be managed under the practice's own significant event analysis (SEA) process and reported to the CSO in parallel.

## 8. Version history

| Date | Version | Author | Change |
|------|---------|--------|--------|
| 2026-05 | 1.0 | DT | Initial hazard log — limited distribution to named GP users |
| 2026-05-20 | 2.0 | DT | Reformatted to DCB0129 style; expanded to 12 hazards; added severity/likelihood matrix; added explicit acceptability thresholds; aligned with `CLINICAL-SAFETY-NOTICE.md` v2.0 |
| 2026-05-22 | 3.0 | DT | Updated to v1.8.1; expanded scope to include Patient Record Visualiser; added H-013 (PDF staleness), H-014 (silent data omission), H-015 (eFI inaccuracy), H-016 (PINCER false-negative), H-017 (PINCER false-positive); updated H-007 to include Visualiser automation bias; updated test count to 213+; aligned with `CLINICAL-SAFETY-NOTICE.md` v3.0 |
| 2026-05-29 | 3.1 | DT | Synchronised to v3.4.1; added H-018 (patient-identifiable data in feedback email) following the new in-app feedback channel; updated test count to 230+; aligned with `CLINICAL-SAFETY-NOTICE.md` v3.1 |

## 9. Clinical Safety Officer sign-off

I confirm that I have reviewed each hazard recorded in this log, that the controls described are in place at v3.4.1, and that the residual risks are acceptable for limited distribution to named GP users who have read and accepted the Clinical Safety Notice and the full disclaimer.

**Dr Dave Triska, GMC 7534932**  
**Clinical Safety Officer, Medicus Suite**  
**Graysbrook Ltd**  
**Date:** 2026-05-29
