# The Keeper — Sentinel rule-change proposal

**Practice:** Witley and Milford Surgery  
**Generated:** 17 June 2026  
**Extension version:** 3.114.0 → 3.114.0  
**Rule files touched:** none  
**Tests:** ✅ passing (full suite (node --test test-*.js), test-term-coverage.js, test-acb-scores.js, test-stopp-start.js, test-chip-contract.js, check-doc-versions.js)

> **How to read this.** The Keeper compares the suite’s clinical rule sets against their authoritative UK sources and proposes only verified, sourced changes. Every change links to the source it was checked against. Changes are rated 🔴 Red (a current patient-safety drift — usually a silent monitoring/alerting gap), 🟠 Amber (update to stay current) or 🟢 Green (housekeeping). **This is a proposal for the Clinical Safety Officer to review — clinical rule changes are not auto-merged.** Anything that could *reduce* alerting is collected in the sign-off box below.

## ⚠️ Changes needing CSO sign-off

_None. No proposed change reduces alerting; all changes are additive or housekeeping._

## Action this run (Red)

| Rule | Domain | Change | Test lock-in |
|------|--------|--------|--------------|
| `vax-rsv` | vaccines | RSV eligibility may have expanded to 80+ and care-home residents (HELD — verify JCVI letter) | none (no vaccine-cohort regression test exists) |

## Medicines monitoring
<sub>`rules/drug-rules.json`</sub>

_No changes this run._

## QOF registers and indicators
<sub>`rules/qof-rules.json`</sub>

### 🟠 Amber — HF009 four-pillar RAAS class may omit fosinopril (HELD)

- **Rule:** `qof-hf009`
- **Now:** qof-hf009 RAAS group lists 13 agents but not fosinopril.
- **Proposed:** IF confirmed appropriate: add 'fosinopril' to the RAAS medicationMatch list. NOT APPLIED — open question whether the rule intends all UK ACE-Is or only trial-proven agents.
- **Why it matters:** Fosinopril is a licensed UK ACE inhibitor; a patient on it as their sole RAAS agent would not satisfy the four-pillar RAAS pillar (silent under-match). But the rule may intentionally list only trial-proven agents — needs CSO judgement. WebSearch-corroborated only.
- **Regression lock-in:** none (HF009 has no coverage test yet)
- **Source:** NICE NG106 (Sep 2025) / NHS England QOF 2026/27 PRN02356 — <https://www.nice.org.uk/guidance/ng106> (2025-09)
- **Verified evidence:** Held — clinical-scope question + unverifiable this run.
- **Provenance:** verified by orchestrator (held) on 17 June 2026 — WebSearch-corroborated; source page NOT fetched (HTTP 403), confidence medium.

## Vaccine eligibility
<sub>`rules/vaccine-rules.json`</sub>

### 🔴 Red — RSV eligibility may have expanded to 80+ and care-home residents (HELD — verify JCVI letter)

- **Rule:** `vax-rsv`
- **Now:** vax-rsv eligibility is age 75–79 (ageMin 75, ageMax 79). The rule's own notes state the 80+ cohort is NOT eligible (initial-year transition offer ended 31 Aug 2025).
- **Proposed:** IF confirmed: remove the upper age bound (age 75+) and add adult care-home residents. NOT APPLIED this run.
- **Why it matters:** If the expansion is real, the rule silently misses every eligible 80+ patient — a vulnerable cohort. HOWEVER this directly contradicts the file's deliberately-documented boundary, was WebSearch-corroborated only (WebFetch 403 — source page not verified), and so must be confirmed by the CSO against the actual JCVI letter before any change.
- **Regression lock-in:** none (no vaccine-cohort regression test exists)
- **Source:** JCVI advice (claimed Feb 2026) / RSV programme expansion letter — <https://www.gov.uk/government/publications/rsv-vaccination-for-older-adults-expansion-of-eligibility> (2026-02)
- **Verified evidence:** VACCINES scanner reported a claimed 1 April 2026 RSV expansion to 80+ and care-home residents. Unverifiable against source this run; conflicts with the rule's documented boundary. Held for CSO.
- **Provenance:** verified by orchestrator (held) on 17 June 2026 — WebSearch-corroborated; source page NOT fetched (HTTP 403), confidence medium.

### 🟠 Amber — Flu — add people experiencing homelessness (16+) cohort (HELD)

- **Rule:** `vax-flu`
- **Now:** vax-flu does not include a homelessness cohort.
- **Proposed:** IF confirmed: add a problem-coded homelessness cohort (16+). NOT APPLIED. Practical yield is low — homelessness is rarely coded in GP records.
- **Why it matters:** Possible new eligible cohort effective 1 Oct 2026. WebSearch-corroborated only; future-dated; low coding yield. Held for CSO confirmation against the flu letter.
- **Source:** JCVI advice (claimed June 2024); 2026/27 flu letter amendment — <https://www.gov.uk/government/publications/national-flu-immunisation-programme-plan-2026-to-2027> (2026-06)
- **Verified evidence:** Held — unverifiable this run.
- **Provenance:** verified by orchestrator (held) on 17 June 2026 — WebSearch-corroborated; source page NOT fetched (HTTP 403), confidence medium.

### 🟢 Green — Pneumococcal routine 65+ may have moved PPV23 → PCV20 (HELD — doc/source only)

- **Rule:** `vax-pneumo-ppv23`
- **Now:** Rule id vax-pneumo-ppv23, displayName 'Pneumococcal vaccine (PPV23)', source cites PPV23 at 65+.
- **Proposed:** IF confirmed: relabel to PCV20 and update source note; eligibility (65+) unchanged. NOT APPLIED.
- **Why it matters:** Documentation/source relabel only, no eligibility change. WebSearch-corroborated; held for CSO confirmation.
- **Source:** Change-of-vaccine letter (claimed early 2026); Green Book Ch.25 — <https://www.gov.uk/government/publications/change-of-vaccine-for-the-routine-adult-pneumococcal-vaccination-programme-and-individuals-at-increased-clinical-risk> (2026-02)
- **Verified evidence:** Held — unverifiable this run.
- **Provenance:** verified by orchestrator (held) on 17 June 2026 — WebSearch-corroborated; source page NOT fetched (HTTP 403), confidence medium.

## Prescribing-safety alerts
<sub>`rules/alert-library.json`</sub>

_No changes this run._

## Medication-review instruments (ACB / STOPP-START / PINCER)
<sub>`engine/acb-scores.js, engine/stopp-start.js, visualiser-core.js`</sub>

_No changes this run._

## Reception pathways and clinical thresholds
<sub>`rules/reception-pathways.json + threshold constants`</sub>

_No changes this run._

---

## Appendix: scan transparency

**Sources checked:** BNF monitoring requirements + summary of changes; MHRA Drug Safety Update (May–June 2026); NHS England QOF guidance 2026/27 (PRN02356); NICE indicator menu / NICE NG106 / NG181 / NG87; UKHSA Green Book + JCVI advice + 2026/27 flu letter; PINCER indicators (PRIMIS); NICE Key Therapeutic Topics; Boustani ACB scale / ACBcalc; STOPP/START v3 (O'Mahony 2023); NICE CKS red-flag lists / NG12 / NG143 / NG253-255 / Pharmacy First / KDIGO / NG136 / NG28.

**Rule-file baseline at start of run:**
- `drug-rules.json`: 2026-06-14 (Jayempi + brand pass)
- `qof-rules.json`: QOF 2026/27 (PRN02356)
- `vaccine-rules.json`: 2026/27 season
- `alert-library.json`: 1.2 / 2026-06-14
- `reception-pathways.json`: v1.3 / 2026-06-14 (CSO-signed-off, 5x duty→999 promotions)
- `acb-scores.js + stopp-start.js`: v3.114.0 (single ACB scorer; full UK NSAID/aspirin term parity)
- `clinical-thresholds`: test-clinical-thresholds-sync.js pin set

**Candidates excluded as low relevance:** 1.

**⚠️ Sources that could not be reached this run:** WebFetch HTTP 403 to every external source this run (BNF/gov.uk/NICE/CKS/ACBcalc) — same as the 2026-06-14 run; NICE CKS additionally UK-geo-restricted. All scanner findings are WebSearch-corroborated only, none page-verified, so per The Keeper's verification discipline NO rule-file change was applied. The four candidates above are HELD for CSO verification.. _Treat the affected rules as unchecked this run._

**Out of scope:** local ICB formularies and shared-care boundaries are not covered by this national scan. Paste a local formulary line into a run to fold it in.

**Disclaimer:** The Keeper keeps Sentinel's approximations of the source guidance current. It is a memory aid, not the official QOF business rules, the BNF, or a prescribing system. The CSO reviews and approves every clinical rule change.
