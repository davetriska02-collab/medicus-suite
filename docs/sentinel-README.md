# Sentinel

**A read-only clinical context sidebar for a single clinician's personal use within the Medicus EHR.**

Sentinel renders, in a sidebar adjacent to the patient record, the most recent recorded values relevant to (a) published drug-monitoring guidance for medications the patient is taking, and (b) the QOF 2025/26 indicator criteria for clinical registers the patient is on. It is a memory aid. It performs no clinical reasoning, makes no recommendations, writes nothing to any record, transmits nothing to any third party, and is not clinical decision support software.

| | |
|---|---|
| **Version** | 0.3.1 |
| **Status** | Personal pilot. Not certified clinical software. Not distributed. |
| **User** | Single clinician. |
| **Deployment** | Local Chrome extension, unpacked, loaded only on the user's own workstation. |
| **Data flow** | All processing happens locally in the user's browser. No data is transmitted to any external service. The extension consumes the same Medicus REST endpoints already in use by the rendered web page, using the user's existing authenticated session. |
| **Regulatory position** | Out of scope of MHRA medical device regulation under the manufacturer's analysis: software which provides no diagnosis, no treatment recommendation, no triage and no automation, and which merely re-displays values already present in the patient record. Sits at most as a Class I administrative tool. No CE/UKCA mark claimed. |
| **License** | All rights reserved by author. Not distributed. |

---

## Intended purpose (frozen statement)

> Software that displays, against the patient's active medication list, active problem list, and recent observations as already recorded in the Medicus electronic patient record, the most recent recorded values relevant to published drug-monitoring guidance and to QOF 2025/26 indicator criteria, and indicates whether those values fall within the recommended interval or whether the relevant QOF indicator is achieved.
>
> The software does not recommend clinical actions, does not order investigations, does not write to the patient record, does not modify QOF claims data, does not transmit any data outside the user's browser, does not analyse images, does not generate synthetic data, and does not constitute clinical decision support.
>
> It is a passive display tool for use by the clinician as a memory aid. All clinical decisions, including verification of any displayed value against the source record, remain the responsibility of the clinician.

This statement is the regulatory anchor. Any feature change that would extend the software beyond this statement requires a fresh regulatory and clinical safety review before being shipped.

---

## What Sentinel does

For each patient page the user opens in Medicus, Sentinel:

1. Identifies the patient from the URL (UUID) and from the patient banner data already returned by the Medicus API.
2. Fetches four Medicus JSON endpoints already in use by the page rendering (patient banner, medication regimen, active problem listing, investigation dashboard).
3. Matches the patient's medications against a curated set of drug-monitoring rules (e.g. methotrexate FBC/U&E/LFT every 12 weeks).
4. Matches the patient's active problems against the QOF 2025/26 register definitions to determine register membership.
5. For each register the patient is on, evaluates the relevant QOF indicators against the patient's most recent recorded values.
6. Displays the results as colour-coded chips grouped by type (drug monitoring / QOF registers / QOF indicators), with each chip showing the value, date and source.

## What Sentinel does not do

Sentinel does not:

- recommend any clinical action;
- order any investigation;
- send any message to any patient, colleague, third party or external system;
- write, modify or delete anything in the Medicus record;
- modify any QOF claim;
- transmit any patient data outside the local browser;
- store any patient data persistently between sessions;
- attempt to bypass any authentication, access control or security control of the Medicus system;
- access patient data that the logged-in user is not already authorised to see;
- replace the clinician's own review of the patient record.

## What Sentinel cannot do reliably

Even within its intended purpose, Sentinel has known limitations. The user must be aware of these:

- **Register membership is determined by substring matching** on problem labels, not by SNOMED refset membership. This will produce false positives where a problem label coincidentally contains a register keyword, and false negatives where a problem is coded using a synonym the rule list does not include. Each chip shows the matched problem label so the user can verify.
- **The investigation dashboard endpoint does not include all clinical observations.** Coded entries that live in the journal/encounter record (e.g. asthma annual review codes, smoking status entries, depression questionnaires) will not appear and indicators that rely on those will report "no data".
- **The QOF 25/26 rules included are a curated subset**, not the full QOF specification. They prioritise the nine CVD-prevention indicators where 141 points were concentrated in the 25/26 contract, plus a small number of high-utility non-CVD indicators (DM006/007/008, AF006, AST007). Practices and clinicians using Sentinel for QOF income optimisation must validate against the official BSO business rules.
- **Threshold edits made by the user override the defaults.** A "modified" badge appears on edited rules. Sentinel does not detect annual QOF changes; the rule file's `lastUpdated` field must be reviewed each contract year.
- **Sentinel does not handle exception coding.** A patient who is QOF-exempted for a given indicator will still show as "not met" if their value does not meet the threshold. Exception coding logic belongs in the EHR.
- **Sentinel is Medicus-only.** It performs no useful work outside Medicus pages. The DOM fallback path is present in the code but is a defensive measure for transient API failures, not an EMIS/SystmOne adapter.

---

## Architecture

```
sentinel/
├── manifest.json
├── background.js              service worker; handles toolbar click + openOptions
├── content-script.js          sidebar mount, refresh, render, settings apply
├── engine/
│   ├── api-client.js          REST client for the four Medicus endpoints
│   ├── normalisers.js         API JSON -> internal medications/observations/problems
│   ├── rules-engine.js        evaluates drug + QOF rules against normalised data
│   ├── data-fetcher.js        orchestrator: API-first, DOM-fallback, mock, discovery
│   └── extractors/            v0.2 DOM extractors, retained as fallback
│       ├── patient-context.js
│       ├── medications.js
│       ├── observations.js
│       └── problems.js
├── rules/
│   ├── drug-rules.json        curated drug-monitoring rules
│   └── qof-rules.json         QOF 2025/26 registers and indicators
├── sidebar/
│   ├── sidebar.html
│   └── sidebar.css
├── options/
│   ├── options.html           Display / Drug Rules / QOF Rules / Advanced
│   └── options.js
├── icons/
├── README.md                  this file
└── DISCLAIMER.txt             standalone regulatory and liability statement
```

**Data flow (live mode):**

```
Medicus page (already loaded for clinician)
    |
    | reads same-origin cookies, hits 4 endpoints in parallel
    v
api-client.js  ----- 60s in-memory cache keyed by patient UUID
    |
    v
normalisers.js  (raw API JSON -> internal shape)
    |
    v
data-fetcher.js  (returns { patientContext, medications, observations, problems })
    |
    v
rules-engine.js  (evaluates curated drug + QOF rules)
    |
    v
content-script.js  (renders into a shadow-DOM sidebar)
```

Nothing leaves this loop. Every value displayed is sourced from the same authenticated session the clinician is already using.

**Endpoints consumed:**

| Endpoint | Returns |
|---|---|
| `GET /patient/data/patient/patient-banner/{uuid}` | identity, age, NHS, gender, badges, named GP |
| `GET /clinical/data/medication/medication-regimen/{uuid}` | every medication category with Medicus's own overdue flags |
| `GET /clinical/data/problem/listing/{uuid}` | active and ended problems with significance |
| `GET /care-record/data/investigation/dashboard/{uuid}` | every recorded investigation/observation as a date × test matrix |

These are the same endpoints the Medicus web client itself calls. No undocumented or hidden endpoints are accessed.

---

## QOF 2025/26 coverage

Registers detected (by substring match on problem labels):

DM (Diabetes), HYP (Hypertension), AF (Atrial fibrillation), CHD (Coronary heart disease), HF (Heart failure), STIA (Stroke/TIA), CKD (Chronic kidney disease, stages 3-5), PAD (Peripheral arterial disease), ASTHMA, COPD.

Indicators evaluated:

| Code | Description | Points (25/26) |
|---|---|---|
| HYP008 | BP ≤140/90 in HYP age <80 | 38 |
| HYP009 | BP ≤150/90 in HYP age ≥80 | 14 |
| CHD015 | BP ≤140/90 in CHD age <80 | 33 |
| CHD016 | BP ≤150/90 in CHD age ≥80 | 14 |
| STIA014 | BP ≤140/90 in STIA age <80 | 8 |
| STIA015 | BP ≤150/90 in STIA age ≥80 | 6 |
| DM036 | BP ≤140/90 in DM age <80 without moderate or severe frailty | 27 |
| CHOL003 | On a statin (or alternative lipid-lowering therapy) where on CVD/CKD register | 38 |
| CHOL004 | LDL ≤2.0 or non-HDL ≤2.6 mmol/L where on CVD register | 44 |
| DM006 | HbA1c ≤58 mmol/mol in DM | 16 |
| DM007 | HbA1c ≤64 mmol/mol in DM | 8 |
| DM008 | HbA1c ≤75 mmol/mol in DM | 10 |
| AF006 | On a DOAC or warfarin if on AF register (CHA2DS2-VASc approximation) | 12 |
| AST007 | Asthma review within 12 months | 20 |

Indicators not included in this release: the remainder of the diabetes process indicators (DM012, DM014, DM018, DM019, DM020, DM021), all dementia indicators, the depression indicators, the cancer indicators, the mental health indicators (MH002, MH021), vaccination indicators, learning disability indicators, and the smoking domain. These may be added in a later version once their data sources are validated against the Medicus API.

---

## Installation

1. Open Chrome and navigate to `chrome://extensions`.
2. Enable Developer mode (top right toggle).
3. Click **Load unpacked** and select the `sentinel/` folder.
4. Pin the extension icon to the toolbar.
5. Open a patient record in Medicus. Click the Sentinel icon to open the sidebar. Click it again to close.

The sidebar appears as a fixed panel on the right (or left, if configured) of the page, isolated from the host page via shadow DOM.

---

## User configuration

Right-click the toolbar icon and choose Options, or click the gear icon in the sidebar header, to open the settings page. The page has four tabs.

**Display.** Eighteen settings covering chip colour style (subtle / bold / minimal), sort order (status / name / points), grouping, density, font size, sidebar width and side, which sections to show, auto-refresh behaviour and refresh debounce, and default data mode. Changes apply live to any open sidebar via storage change listener.

**Drug Rules.** Per-rule enable/disable. Per-test interval edits (interval days and due-soon window). Reset to defaults. A "modified" badge appears on rules with user overrides.

**QOF 25/26 Rules.** Per-register and per-indicator enable/disable. Per-rule reset to defaults.

**Advanced.** Raw JSON override editor (for users who want to add custom match terms to register lists). Clear all overrides. The intended-purpose statement is also reproduced here.

All settings persist to `chrome.storage.local`. Nothing is written to disk outside the browser's own profile directory.

---

## Hazard register (DCB0129-style)

This is a personal pilot, not a deployed clinical safety case, but the hazard analysis below has been performed by the author to inform safe personal use. If Sentinel is ever extended beyond the author's own use, a full DCB0129 hazard log and clinical safety case must be prepared.

| Hazard | Likelihood | Severity | Score | Mitigation |
|---|---|---|---|---|
| Wrong-patient hazard: stale data shown after navigation | Low | High | Med | Auto-refresh on URL / title change; debounced rebuild; patient banner reverifies identity on every refresh; in-memory cache keyed by patient UUID so a different patient cannot reuse cached data. |
| Register false positive (substring match catches wrong problem) | Med | Med | Med | Each chip shows the matched problem label for clinician verification. Approximation disclaimed in chip notes. Substring match list is conservative. |
| Register false negative (problem coded with synonym not matched) | Med | Med | Med | Comprehensive match list for each register, user-editable in Options. Indicator chip will not appear if register membership is not detected, which is detectable by absence. |
| Indicator achievement masked by single recent in-target value despite worsening trend | Low | Med | Low | Chip always shows the latest value and date so trend is visible. Sentinel does not interpret trends. |
| Stale observation displayed as current | Low | High | Med | Every chip shows the date of the value. Drug-monitoring rules categorise as "stale" once observation date exceeds twice the interval. |
| Threshold edit by user causes inappropriate "achieved" status | Low | Low | Low | "Modified" badge on any edited rule. Edits persist to local storage only. Defaults always recoverable. |
| Annual QOF spec change not reflected | High (annual) | Med | Med | `lastUpdated` field in rules JSON. Options page surfaces this. User must review each contract year. |
| Vendor takes objection to API consumption | Med | Low | Low | Read-only same-origin same-cookie access to the user's own session. No automation of write operations. Author would liaise with Medicus before any non-personal use. |
| API endpoint shape changes silently | Med | Med | Med | Each normaliser is defensive (null checks, optional chaining). DOM fallback path remains as a defensive measure. Status line indicates fallback in use. |
| Site rendering disrupted by injected sidebar | Low | Low | Low | Shadow DOM isolation. No global event or style leakage. Fixed-position sidebar does not overlap interactive Medicus elements at default width. |
| Cached data from a previous patient shown after switch | Low | High | Med | Cache key includes patient UUID. Cache cleared on patient change. Dismissals cleared on patient change. |
| Data exfiltration via extension manifest update | Low | High | Med | Personal pilot, not distributed. Manifest is the author's own. No remote update channel. |
| Unauthorised use of authenticated session | Low | High | Med | Extension only operates while user is logged into Medicus. No background activity outside user-initiated page loads. |

The hazard register is reviewed by the author at each version increment.

---

## Data handling and privacy

- No patient data is transmitted to any external service.
- No patient data is written to disk outside the browser's own profile directory (which is the same place Medicus itself stores cached session data).
- No telemetry. No analytics. No remote logging. No error reporting service.
- The 60-second in-memory cache exists in volatile browser memory only. It is cleared when the tab is closed or when the user navigates to a different patient.
- The extension does not request or store any credentials.
- The extension's `host_permissions` is `<all_urls>` to allow the sidebar to be opened anywhere; only the Medicus origin returns data, all other origins return nothing useful.
- Settings stored in `chrome.storage.local` contain no patient data: only user preferences (display options, rule overrides).

Sentinel does not act as a data controller or processor. It does not move, copy or transform patient data outside the rendering of the existing Medicus session inside the same browser tab the clinician is already using.

---

## Vendor and regulatory considerations

**Medicus relationship.** Sentinel consumes the Medicus REST API surface that the user's own authenticated browser session is already using. This is not undocumented access; the endpoints are the same ones the Medicus web client itself calls. However, automated client-side consumption of vendor APIs sits differently from rendering-only DOM observation. The author has not sought formal endorsement from Medicus. Personal use by a single clinician on their own workstation, with their own credentials, for their own clinical memory aid, falls within the user's reasonable use of their own authenticated session. Any use beyond this scope must be discussed with Medicus first.

**NHS regulatory positioning.** Under the MHRA's guidance on software as a medical device (latest version applicable at time of use), a tool whose sole function is to re-display values already present in the source record, without recommendation, ranking, calculation that changes meaning, or workflow automation, is generally outside the medical device regulations. Sentinel is positioned in that out-of-scope category. The author makes no claim of conformity to MDR / UK MDR / EU MDR and no CE / UKCA mark is asserted.

**DCB0129 / DCB0160.** As a personal pilot used by the manufacturing clinician on themselves, the deployment-side DCB0160 standard is not engaged. The manufacturer-side DCB0129 standard would apply if the software were deployed to others; this is not the current scope. The hazard register above represents the author's good-faith analysis to inform safe personal use.

**Information Governance.** No personal data leaves the local browser. The Caldicott principles are respected by virtue of the read-only, no-export design.

**Professional standards.** The user's GMC duty to verify clinical information against the source record before acting is unchanged. Sentinel cannot reduce that duty. Use of Sentinel does not constitute reliance on automated decision-making.

---

## User responsibilities

By installing and using Sentinel, the clinician accepts that:

1. They will verify every value displayed by Sentinel against the source Medicus record before taking any clinical action.
2. They retain full clinical responsibility for every decision made about every patient. Sentinel produces no recommendation; the clinician produces every decision.
3. They will not represent Sentinel output as evidence of QOF achievement, clinical pathway compliance, or any other regulated process. Sentinel is a memory aid only.
4. They will not share, copy, redistribute, fork or modify the extension without the author's written permission. Any modification creates a derivative work for which the modifier is the manufacturer and bears the corresponding regulatory and clinical safety responsibility.
5. They will not install Sentinel on any workstation other than their own personal workstation, and will not log in as any user other than themselves.
6. They will review the rule files (`drug-rules.json`, `qof-rules.json`) at least annually, particularly at QOF contract refresh, and will accept that out-of-date rules may produce out-of-date evaluations.
7. They will cease using Sentinel immediately if Medicus, their employer, their commissioning body, the ICB, or any regulatory body raises a concern about its use.

---

## Development and testing

The codebase includes a smoke test (`test-smoke.js`) covering:

- URL parsing and Medicus context detection
- API normalisers (banner, medications, problems, observations including per-group aggregates)
- DOM extractors (medications, observations, problems, patient context)
- Rules engine: drug-monitoring evaluation, QOF register membership, QOF indicator evaluation (BP thresholds, HbA1c thresholds, statin presence)
- End-to-end: API responses through normalisers into the rules engine into chips

Tests pass before each version increment. The test file is not shipped in the distribution zip.

Run tests with `node test-smoke.js` from the `sentinel/` folder. Requires `jsdom` to be present in a sibling `node_modules` directory during development.

---

## Out of scope (explicit)

The following are not part of Sentinel and will not be added without a separate scope statement and a fresh clinical safety review:

- Writing to the patient record
- Submitting QOF claims
- Sending messages to patients, colleagues or services
- Issuing prescriptions
- Modifying access permissions
- Multi-user synchronisation
- Cloud sync
- Telemetry / usage analytics
- Patient-facing UI
- Mobile UI
- Non-Medicus EHR support
- AI generation or transformation of clinical content
- Risk stratification or scoring of patients
- Cohort identification across multiple patients
- Population health analytics

If a use case requires any of the above, Sentinel is the wrong tool.

---

## Version history

| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-05 | Initial drug-monitoring sidebar. DOM extraction. Single-view (prescription overview). 13 drug rules. |
| 0.2 | 2026-05 | Multi-view DOM extraction. Active problem extraction. QOF 25/26 registers and indicators added. Schema v2 rule format with `type` discriminator. |
| 0.3 | 2026-05 | API-first data source via four Medicus REST endpoints. DOM extraction retained as fallback. View-independent: full clinical picture regardless of current Medicus tab. |
| 0.3.1 | 2026-05 | Per-investigation-group aggregate observations so panel-level monitoring rules (U&E, LFT, FBC, TFT) match correctly. Eighteen user-configurable display settings including bold chip colour style. Settings tab "Display" added. |

---

## Footer

This software is a personal memory aid. It is read-only. It is not clinical decision support. Every value it displays must be verified by the clinician against the source patient record before any clinical action is taken. The clinician retains full and undivided responsibility for clinical decisions.

See DISCLAIMER.txt for the standalone regulatory and liability statement.

---

## v1.1.0 — What is new

### Custom drug-monitoring rules (Sentinel)

The Sentinel options page now has a **Custom Rules** tab. Users can author drug-monitoring rules for drugs not in the bundled set, including shared-care drugs managed locally. The form builder accepts:

- Drug names and exclude names (substring match, same logic as bundled rules)
- Drug class and shared-care flag
- One or more tests, each with name, match terms, monitoring interval, and due-soon window
- Notes (shown on chip hover) and a source reference URL

Rules are stored under `sentinel.customRules` in `chrome.storage.local`. They are appended to the merged canonical + override rule set in `loadRules()` and evaluated by the existing engine without modification. No new clinical logic is introduced.

Custom rules carry a `custom-` ID prefix. They appear with a purple "Custom" tag in the sidebar.

A live chip preview renders all six status states before saving, using synthetic observation dates. This allows the user to verify the rule shape before it fires on a real patient.

Known limitations in v1.1:

- Custom rules are drug-monitoring only. QOF indicators require a separate builder deferred to v1.2.
- Custom rules are individual-scoped. Sharing across the practice uses the existing export/import mechanism.
- Backup/restore captures custom rules in the `sentinel.customRules` key.

### Suite-wide Backup and Restore

The main Options page now has a **Backup and Restore** tab. A single click exports the entire suite configuration as a JSON file in the `medicus-suite-backup` envelope format (format version 1). Restoring from a file shows a preview of what is in the backup before writing anything to storage.

Per-module quick export/import buttons are available for Sentinel, Capacity Forecast, Triage Lens, Slot Counter, and Submissions Tracker.

A double-confirmed reset-to-defaults button clears all extension storage.

### Capacity Forecast preset export/import

The preset row in the Capacity side panel now includes export (⬆) and import (⬇) buttons. Import supports two modes: Replace all (installs the imported preset set, discarding existing) and Merge (appends new presets, resolving conflicts individually with Keep mine / Use imported / Add as copy options).

### Triage Lens storage key migration

The Triage Lens previously used the unnamespaced key `config` in `chrome.storage.local`. This collided with the submissions config and prevented suite-wide backup from distinguishing them. The key is now `triagelens.config`. Migration runs automatically and is idempotent: if `triagelens.config` already exists, the migration is a no-op.

### Hazard register additions

| Hazard | Likelihood | Severity | Mitigation |
|---|---|---|---|
| User authors a custom rule that fails to match anything (wrong drug term) | Med | Low | Live preview shows no_data status before save; testable on real patient |
| User authors a custom rule with too-aggressive interval creating chip noise | Med | Low | UI guidance: intervals shown as weeks/months; defaults are conservative |
| Custom rule conflicts with canonical rule ID | Low | Low | Custom IDs auto-prefixed custom-; uniqueness validated at save |
| Importing a backup overwrites configuration silently | Med | Med | Preview-and-confirm step mandatory before write; per-module merge option |
| Backup file from older version missing fields | Med | Low | Validator emits warnings, defaults missing fields, does not reject |
| Backup file edited maliciously | Low | Med | Schema validation on import; format/scope required |
| Triage Lens migration runs twice | Low | Low | Idempotent migration: no-op if triagelens.config already exists |
| User confused about custom vs canonical rules | Med | Low | Custom rules tagged Custom in chip render; listed separately in options |

### Version history addition

| Version | Date | Change |
|---|---|---|
| 1.1.0 | 2026-05 | Custom drug-monitoring rule builder. Suite-wide backup/restore. Capacity preset import/export with merge. Triage Lens storage key migration (config -> triagelens.config). 131 tests green. |


---

## v1.2.0 — What is new

### Hotfix: practice code no longer hardcoded

v1.0.1 and v1.1.0 shipped with the developer's practice code (`560b6c`) baked into five files that make API calls. Practices other than the developer's own would set their practice code in Options but the modules ignored that setting and continued making requests to the original API endpoint, which correctly returned 403 because the user had no access there.

In v1.2.0:

- All five modules (Sentinel, Capacity Forecast, Slot Counter, Waiting Room popup, side-panel WR strip) now read the practice code from `chrome.storage.local['suite.practiceCode']` at request time
- A shared resolver `shared/practice-code.js` is the single source of truth
- No hardcoded fallback exists anywhere in functional code — modules render a friendly "Practice code not set" message when the code is missing
- Storage-change listeners react to practice code updates immediately, so changing the code in Options no longer requires reloading the extension

If you previously had to repeatedly re-enter your practice code or saw 403 errors after a fresh install, this is the fix.

### Custom Clinical Indicators (Sentinel)

The Custom Rules tab now includes a second section for custom clinical indicators alongside the drug-monitoring rules introduced in v1.1.

Indicators support three check kinds:

- **Observation against a threshold.** A single threshold with operator (≤, <, ≥, >, =) for tests like HbA1c, cholesterol, eGFR, or a dual systolic/diastolic threshold for blood pressure.
- **Medication presence.** Fires when the patient is currently prescribed a medication matching the given terms (e.g. "on a statin").
- **Observation within window.** Fires when an observation with matching terms has been recorded inside the configured time window (e.g. annual frailty review).

Each indicator can be scoped to a bundled QOF register (DM, HYP, CHD, HF, STIA, CKD, PAD, ASTHMA, COPD, AF) or left as "Any patient". Optional age range and moderate/severe frailty exclusion are available.

Window semantics are explicit: either the QOF year boundary (1 April to 31 March) or a user-configured rolling N-day window. The form explains the QOF year behaviour in plain English.

### Visual distinction from official QOF

Custom indicators are visibly separated from bundled QOF in the side panel:

- Purple "Custom" tag replaces the QOF year label
- Points are hidden by default unless the user explicitly sets them
- Notes and source reference are surfaced on chip hover via the title attribute, so anyone looking at the chip can see at a glance who authored it and why

Custom indicators never contribute to QOF total point calculations anywhere in the UI. This is enforced at the render layer, not just by convention.

### Shared chip renderer

`shared/chip-renderer.js` now renders both drug-monitoring and QOF indicator chips. The side panel delegates to this renderer for both types, eliminating drift between the live chip in Sentinel and the live preview in the options form.

### Engine: useQofYearFloor flag

QOF indicator rules now accept a top-level `useQofYearFloor` boolean. Default is `true` (current behaviour). When set to `false`, the rolling `withinDays` window applies instead of the QOF year boundary. The flag is exposed to users through the indicator form's Window radio buttons.

### Version history addition

| Version | Date | Change |
|---|---|---|
| 1.2.0 | 2026-05 | Practice code hotfix. Custom clinical indicators with three check kinds. Shared QOF chip renderer with hover-surfaced notes/source. useQofYearFloor engine flag. 180 tests green. |

