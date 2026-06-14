# The Keeper — Sentinel rule-change proposal

**Practice:** Witley and Milford Surgery  
**Generated:** 14 June 2026  
**Extension version:** 3.80.0 → (unbumped — proposal only, no rule files edited)  
**Rule files touched:** none  
**Tests:** ✅ passing

> **How to read this.** The Keeper compares the suite’s clinical rule sets against their authoritative UK sources and proposes only verified, sourced changes. Every change links to the source it was checked against. Changes are rated 🔴 Red (a current patient-safety drift — usually a silent monitoring/alerting gap), 🟠 Amber (update to stay current) or 🟢 Green (housekeeping). **This is a proposal for the Clinical Safety Officer to review — clinical rule changes are not auto-merged.** Anything that could *reduce* alerting is collected in the sign-off box below.

## ⚠️ Changes needing CSO sign-off

These changes could *reduce* what Sentinel flags (longer interval, removed test, narrower match, new exclude, disabled/retired rule, or higher threshold). Each needs explicit CSO approval before merge.

| Rule | Change | Source says | RAG |
|------|--------|-------------|-----|
| `feverish-child / rf-under3m` (pathways) | CSO to set the local escalation route for <3m fever. NICE NG143 makes <3m fever a high-risk (red) feature warranting urgent assessment; whether that is 999 or an urgent same-day duty pathway is a local-policy decision. The Keeper does NOT change an escalation tier unilaterally. | NG143 classes <3m fever as high-risk; the file already flags the 999-vs-duty route as a CSO decision. Conflicting subagent reads — treated as a sign-off item, not an auto-edit. | 🟠 Amber |
| `reception escalation tiers (multiple flags)` (pathways) | CSO to review each of these tiers as part of the existing DRAFT sign-off. The Keeper does NOT change an escalation tier. Note for several (bilateral leg weakness, floppy child) the better fix may be sharper wording (distinguish pain vs motor weakness; define 'floppy') rather than a blanket tier change. | Multiple subagents flagged these duty->999 candidates, but all from secondary sources; CKS pages were unreachable (403/geo-block). Surfaced for CSO, not applied. | 🟠 Amber |

## Action this run (Red)

| Rule | Domain | Change | Test lock-in |
|------|--------|--------|--------------|
| `ACEI_TERMS / ARB_TERMS` | medreview | STOPP/START ACEi/ARB term lists are shorter than the rest of the suite (8 agents missing) | test-stopp-start.js — add a case with drugs:['trandolapril'] (and one ARB e.g. telmisartan) asserting it is recognised as an ACEi/ARB. |
| `HIGH_RISK_DRUGS.betaBlocker (line 516)` | medreview | PINCER beta-blocker term list misses several UK beta-blockers (asthma flag can silently miss) | test-visualiser-pincer.js — add a celiprolol + asthma case asserting the beta-blocker hazard fires. |

## Medicines monitoring
<sub>`rules/drug-rules.json`</sub>

### 🟠 Amber — Add Jayempi (azathioprine 10mg/ml oral suspension) to the azathioprine match list

- **Rule:** `azathioprine-maintenance`
- **Now:** drug.match = ["azathioprine", "imuran", "azapress"].
- **Proposed:** Add "jayempi" to drug.match.
- **Why it matters:** Jayempi is the licensed UK azathioprine oral suspension (MA PLGB 13581/0005, Feb 2024). If prescribed by brand, 'jayempi' does not contain 'azathioprine' so the 12-weekly FBC/LFT/U&E monitoring rule never fires — a silent gap for an immunosuppressed patient. (Generic 'azathioprine ... suspension' prescriptions still match.)
- **Regression lock-in:** Add 'Jayempi 10mg/ml oral suspension' to EXPECTED['azathioprine-maintenance'] in test-drug-brand-coverage.js.
- **Source:** emc SmPC (Jayempi 10mg/ml oral suspension, Nova Laboratories) / NHSBSA Drug Tariff — <https://www.medicines.org.uk/emc/product/12745/smpc> (2024-02)
- **Verified evidence:** emc + NHSBSA confirm Jayempi as the licensed UK azathioprine 10mg/ml oral suspension, Nova Laboratories, available since Feb 2024.
- **Provenance:** verified by orchestrator (WebSearch corroborated) on 14 June 2026 — corroborated, confidence high.

## QOF registers and indicators
<sub>`rules/qof-rules.json`</sub>

### 🟠 Amber — OB (obesity) register / OB004-OB005 — CSO decision on going live for 26/27

- **Rule:** `qof-reg-ob`
- **Now:** OB register + OB004/OB005 are shipped disabled as drafts 'pending CSO confirmation'.
- **Proposed:** CSO to decide whether to enable the OB register and OB004/OB005 for 2026/27. The Keeper does NOT enable a clinical register unilaterally; flagged for sign-off.
- **Why it matters:** Obesity is a new 26/27 clinical area; whether to switch the register live (and at what point/threshold encoding) is a CSO call, especially as point allocations were still draft in-file.
- **Regression lock-in:** none until enabled.
- **Source:** NHS England QOF 2026/27 guidance — <https://www.england.nhs.uk/gp/investment/gp-contract/> (2026-03)
- **Verified evidence:** QOF 26/27 lists obesity as a new clinical area; the file flags OB indicators as draft pending CSO confirmation.
- **Provenance:** verified by orchestrator (WebSearch corroborated) on 14 June 2026 — corroborated, confidence medium.

### 🟢 Green — Add HF003 and HF006 as disabled, to preserve the year-on-year diff convention

- **Rule:** `qof-hf003 / qof-hf006`
- **Now:** HF009 (4-pillar HFrEF) is present and notes it replaces HF003/HF006, but HF003/HF006 are absent from the file entirely (other retired indicators are kept enabled:false for diff visibility).
- **Proposed:** Add qof-hf003 and qof-hf006 as enabled:false, matching how DM007/DM008, HYP008/HYP009 etc. are retained.
- **Why it matters:** Housekeeping/convention only — makes the 25/26->26/27 retirement of HF003/HF006 visible in the diff. No behaviour change.
- **Regression lock-in:** test-qof-indicator-filters.js — assert HF003/HF006 present and disabled.
- **Source:** NHS England QOF 2026/27 guidance (PRN02356) — <https://www.england.nhs.uk/gp/investment/gp-contract/> (2026-03)
- **Verified evidence:** QOF 26/27 introduces HF009 (4-pillar) replacing HF003/HF006; the file already keeps other retired indicators disabled for diff visibility.
- **Provenance:** verified by orchestrator (WebSearch corroborated) on 14 June 2026 — corroborated, confidence medium.

## Vaccine eligibility
<sub>`rules/vaccine-rules.json`</sub>

### 🟢 Green — Refresh vaccine specVersion/source to 2026/27 (cohorts confirmed unchanged)

- **Rule:** `vax-flu / vax-covid`
- **Now:** specVersion 'JCVI/UKHSA 2025/26 season'; flu/COVID source citations reference 2025 documents.
- **Proposed:** Bump specVersion to 2026/27 and update the source notes to the JCVI 2026/27 statements. Make NO cohort change — flu and COVID eligible groups are confirmed unchanged for 2026/27.
- **Why it matters:** Metadata currency only. CSO/Keeper should confirm the exact JCVI statement URLs before editing (scanner-supplied dated PDF links were not page-verifiable here).
- **Regression lock-in:** none.
- **Source:** JCVI statements on flu and COVID vaccination 2026/27 — <https://www.gov.uk/government/groups/joint-committee-on-vaccination-and-immunisation> (2025-07)
- **Verified evidence:** Search indicates JCVI confirmed no flu/COVID cohort changes for 2026/27; the file's cohorts are correct, only the version/citation is stale. Exact source URLs need CSO confirmation.
- **Provenance:** verified by orchestrator (WebSearch corroborated) on 14 June 2026 — corroborated, confidence medium.

## Prescribing-safety alerts
<sub>`rules/alert-library.json`</sub>

### 🟠 Amber — GLP-1 / dual GLP-1-GIP agonists — strengthened acute-pancreatitis warning (MHRA DSU)

- **Rule:** `(new) glp1-acute-pancreatitis`
- **Now:** Library has an SGLT2 DKA reminder but no GLP-1 pancreatitis awareness alert.
- **Proposed:** Add an awareness alert on GLP-1 / dual GLP-1-GIP agonists (semaglutide, dulaglutide, liraglutide, exenatide, tirzepatide) prompting clinicians/patients to watch for severe persistent abdominal pain (acute, incl. necrotising/fatal, pancreatitis).
- **Why it matters:** Real MHRA DSU (confirmed) strengthening pancreatitis warnings after necrotising/fatal Yellow Card reports. A high-prescribing-volume drug class in a dispensing practice; no current alert prompts the counselling point.
- **Regression lock-in:** test-custom-rules.js — add a GLP-1 patient case asserting the new alert fires.
- **Source:** MHRA Drug Safety Update — GLP-1/GIP receptor agonists: strengthened warnings on acute pancreatitis — <https://www.gov.uk/drug-safety-update/glp-1-receptor-agonists-and-dual-glp-1-slash-gip-receptor-agonists-strengthened-warnings-on-acute-pancreatitis-including-necrotising-and-fatal-cases> (2026)
- **Verified evidence:** gov.uk DSU page confirmed via search: strengthened acute-pancreatitis warnings (necrotising/fatal) for GLP-1 and GLP-1/GIP agonists; 1,296 Yellow Card pancreatitis reports to Oct 2025.
- **Provenance:** verified by orchestrator (WebSearch corroborated) on 14 June 2026 — corroborated, confidence high.

## Medication-review instruments (ACB / STOPP-START / PINCER)
<sub>`engine/acb-scores.js, engine/stopp-start.js, visualiser-core.js`</sub>

### 🔴 Red — STOPP/START ACEi/ARB term lists are shorter than the rest of the suite (8 agents missing)

- **Rule:** `ACEI_TERMS / ARB_TERMS`
- **Now:** stopp-start.js ACEI_TERMS = [ramipril, lisinopril, perindopril, enalapril, captopril] and ARB_TERMS = [candesartan, losartan, irbesartan, valsartan, olmesartan] — 5 + 5. visualiser-core.js already lists 18 (adds trandolapril, fosinopril, quinapril, imidapril, cilazapril, telmisartan, azilsartan, eprosartan).
- **Proposed:** Add trandolapril, fosinopril, quinapril, imidapril, cilazapril to ACEI_TERMS and telmisartan, azilsartan, eprosartan to ARB_TERMS so the STOPP/START term lists match visualiser-core.js and the live drug rules.
- **Why it matters:** Same case-insensitive substring matching as drug.match: any STOPP/START criterion keyed off these lists silently misbehaves for a patient on one of the 8 missing ACEi/ARBs (e.g. a triple-whammy STOPP check fails to fire, or START-12 spuriously recommends starting an ACEi/ARB the patient already takes as trandolapril). All 8 are real UK-licensed agents. Verified directly against the two repo files.
- **Regression lock-in:** test-stopp-start.js — add a case with drugs:['trandolapril'] (and one ARB e.g. telmisartan) asserting it is recognised as an ACEi/ARB.
- **Source:** Internal-consistency check vs visualiser-core.js (line 405-426) + BNF ACE inhibitor / ARB lists — <https://bnf.nice.org.uk/treatment-summaries/hypertension/> (2026-06)
- **Verified evidence:** Confirmed by direct grep: stopp-start.js lists 5+5 ACEi/ARB terms; visualiser-core.js lists 18. The 8 missing are all UK-licensed ACEi/ARBs.
- **Provenance:** verified by orchestrator (repo cross-check) on 14 June 2026 — fetched source page, confidence high.

### 🔴 Red — PINCER beta-blocker term list misses several UK beta-blockers (asthma flag can silently miss)

- **Rule:** `HIGH_RISK_DRUGS.betaBlocker (line 516)`
- **Now:** betaBlocker terms (line 516) = [atenolol, bisoprolol, propranolol, metoprolol, carvedilol, sotalol, nebivolol, labetalol]. Confirmed by grep.
- **Proposed:** Add acebutolol, celiprolol, nadolol, oxprenolol (and consider pindolol, timolol oral) so PINCER #9 (beta-blocker in asthma) cannot silently miss a patient on one of them.
- **Why it matters:** A patient on celiprolol or nadolol with asthma would not trigger the beta-blocker-in-asthma contraindication flag — a silent prescribing-safety gap. celiprolol is still UK-prescribed. Beta-blocker list confirmed incomplete by direct grep.
- **Regression lock-in:** test-visualiser-pincer.js — add a celiprolol + asthma case asserting the beta-blocker hazard fires.
- **Source:** BNF beta-adrenoceptor blocking drugs; PINCER indicator #9 — <https://bnf.nice.org.uk/treatment-summaries/beta-adrenoceptor-blocking-drugs/> (2026-06)
- **Verified evidence:** grep of visualiser-core.js line 516 confirms the 8-term list; acebutolol/celiprolol/nadolol/oxprenolol are UK-licensed beta-blockers absent from it.
- **Provenance:** verified by orchestrator (repo cross-check) on 14 June 2026 — fetched source page, confidence high.

### 🟠 Amber — Add pitavastatin (Livazo) to the statin term list

- **Rule:** `HIGH_RISK_DRUGS.statin`
- **Now:** statin terms = [atorvastatin, simvastatin, rosuvastatin, pravastatin, fluvastatin].
- **Proposed:** Add "pitavastatin" (brand "livazo"). Do NOT add lovastatin — it is not UK-licensed.
- **Why it matters:** Pitavastatin (Livazo) is UK-licensed; omission means a pitavastatin patient is not picked up in statin-related detection. The scanner's paired suggestion of lovastatin is rejected — lovastatin is not marketed in the UK.
- **Regression lock-in:** test-visualiser-pincer.js / test-prescribing-flags.js — add a pitavastatin case.
- **Source:** emc / MHRA (pitavastatin Livazo, UK-licensed since 2010) — <https://www.medicines.org.uk/emc/search?q=pitavastatin> (2026-06)
- **Verified evidence:** Search confirms pitavastatin (Livazo) MHRA-approved/UK-marketed; lovastatin not found as a UK-marketed statin.
- **Provenance:** verified by orchestrator (WebSearch corroborated) on 14 June 2026 — corroborated, confidence medium.

### 🟠 Amber — STOPP anticholinergic-burden-in-elderly criterion not implemented (engine work)

- **Rule:** `(new) stopp-anticholinergic-elderly`  ⚙️ _needs rules-engine extension — ship disabled with placeholder_
- **Now:** computeStoppStart() implements ~13 criteria; no anticholinergic-burden-in-age>=65 criterion, though an ACB table already exists in engine/acb-scores.js.
- **Proposed:** Add a STOPP criterion flagging high anticholinergic burden in age >=65 by reusing the ACB table + an age gate. Needs a rules-engine addition (not a data-only edit), so ship disabled with a placeholder.
- **Why it matters:** High-value, low-effort once engined: the ACB instrument is already in the codebase. Closes a known STOPP gap (anticholinergic drugs in the elderly — falls, cognition, retention).
- **Regression lock-in:** test-stopp-start.js — add the criterion once engined.
- **Source:** STOPP/START v3 (O'Mahony et al, 2023) — <https://academic.oup.com/ageing/article/52/5/afad143/7191153> (2023)
- **Verified evidence:** STOPP/START v3 includes anticholinergic-burden criteria; suite already ships an ACB table (engine/acb-scores.js) usable as the drug set.
- **Provenance:** verified by orchestrator (WebSearch corroborated) on 14 June 2026 — corroborated, confidence medium.

### 🟢 Green — ACB table: amoxapine (TCA) reportedly omitted — score 2

- **Rule:** `amoxapine`
- **Now:** amoxapine not present in the ACB table.
- **Proposed:** If amoxapine is genuinely UK-prescribed for your population, add { amoxapine: 2 } per the Boustani/ACBcalc scale. Low UK prevalence — CSO to weigh whether it is worth carrying.
- **Why it matters:** ACB is cumulative-substring; a missing anticholinergic under-counts burden. But amoxapine is uncommon in current UK practice, so this is low-yield housekeeping rather than a pressing gap.
- **Regression lock-in:** test-acb-scores.js — add amoxapine -> 2 if adopted.
- **Source:** Boustani ACB scale / ACBcalc — <https://www.acbcalc.com/> (2008/2024)
- **Verified evidence:** ACBcalc lists amoxapine as an anticholinergic; UK marketing/usage is limited, so adoption is a CSO judgement on local relevance.
- **Provenance:** verified by orchestrator (WebSearch corroborated) on 14 June 2026 — corroborated, confidence medium.

## Reception pathways and clinical thresholds
<sub>`rules/reception-pathways.json + threshold constants`</sub>

### 🟠 Amber — Escalation tier for fever in an infant <3 months — CSO decision (999 vs urgent duty)

- **Rule:** `feverish-child / rf-under3m`
- **Now:** rf-under3m ('baby under 3 months with any fever') escalates to 'duty'. The file's own notes already say the CSO must confirm whether the local route is 999 or urgent duty.
- **Proposed:** CSO to set the local escalation route for <3m fever. NICE NG143 makes <3m fever a high-risk (red) feature warranting urgent assessment; whether that is 999 or an urgent same-day duty pathway is a local-policy decision. The Keeper does NOT change an escalation tier unilaterally.
- **Why it matters:** A potential UNDER-escalation if local policy expects 999. Flagged for explicit CSO sign-off — and note the file is still DRAFT pending CSO review of the whole pathway set.
- **Regression lock-in:** test-reception-pathways.js — pin whichever tier the CSO confirms.
- **Source:** NICE NG143 (Fever in under 5s) — traffic-light red features — <https://www.nice.org.uk/guidance/ng143> (2026-06)
- **Verified evidence:** NG143 classes <3m fever as high-risk; the file already flags the 999-vs-duty route as a CSO decision. Conflicting subagent reads — treated as a sign-off item, not an auto-edit.
- **Provenance:** verified by orchestrator (WebSearch corroborated) on 14 June 2026 — corroborated, confidence medium.

### 🟠 Amber — Bundle of duty-vs-999 escalation-tier reviews for the CSO (NOT page-verified — CKS was geo-blocked)

- **Rule:** `reception escalation tiers (multiple flags)`
- **Now:** Several red flags currently escalate to 'duty' that subagents flagged as possible 999 promotions: rash SJS/TEN (rf-blistering), UTI sepsis-with-rigors, backpain bilateral leg weakness (rf-bothlegs), feverish-child 'floppy', earache mastoiditis, headache painful-red-eye-with-halos (acute angle-closure glaucoma).
- **Proposed:** CSO to review each of these tiers as part of the existing DRAFT sign-off. The Keeper does NOT change an escalation tier. Note for several (bilateral leg weakness, floppy child) the better fix may be sharper wording (distinguish pain vs motor weakness; define 'floppy') rather than a blanket tier change.
- **Why it matters:** Potential under-escalation of several time-critical presentations. IMPORTANT: CKS is geo-restricted and returned HTTP 403 to every fetch this run, so these are secondary-source flags, NOT verified against the CKS pages — exactly the kind of clinical-tier change that must not be auto-applied. The file is already DRAFT pending CSO sign-off of its escalation re-tiering.
- **Regression lock-in:** test-reception-pathways.js — pin whichever tiers the CSO confirms.
- **Source:** NICE CKS / NG51 / NG143 (secondary-source corroboration only) — <https://cks.nice.org.uk/> (2026-06)
- **Verified evidence:** Multiple subagents flagged these duty->999 candidates, but all from secondary sources; CKS pages were unreachable (403/geo-block). Surfaced for CSO, not applied.
- **Provenance:** verified by orchestrator (subagent secondary-source review) on 14 June 2026 — corroborated, confidence low.

### 🟢 Green — Headache pathway cites NICE NG150 — correct the reference to NG228

- **Rule:** `headache (sourceNotes)`
- **Now:** Headache sourceNotes reference NG150 (which is not the headache/SAH guideline).
- **Proposed:** Replace the NG150 citation with NICE NG228 (subarachnoid haemorrhage). Documentation only — the thunderclap red flag itself is correct and unchanged.
- **Why it matters:** Provenance tidy-up; no clinical behaviour change.
- **Regression lock-in:** none.
- **Source:** NICE NG228 (subarachnoid haemorrhage) — <https://www.nice.org.uk/guidance/ng228> (2022-11)
- **Verified evidence:** Two subagents independently noted the NG150 citation is wrong for headache; NG228 is the SAH guideline underpinning the thunderclap flag.
- **Provenance:** verified by orchestrator (WebSearch corroborated) on 14 June 2026 — corroborated, confidence medium.

### 🟢 Green — Sepsis citation is stale: NICE NG51 has been split into NG253 (16+) and NG254 (<16s)

- **Rule:** `sourceNotes (sepsis citation)`
- **Now:** sourceNotes cite NICE NG51 (sepsis) for urosepsis/sepsis escalation.
- **Proposed:** Update the citation to NICE NG253 (suspected sepsis 16+, updated Nov 2025) and NG254 (suspected sepsis under 16s). No reception red-flag wording change is required — the lay red flags (fever+rigors+confusion, mottled/ashen, non-blanching rash) are unchanged; the NEWS2-based stratification in NG253 is hospital-facing, not reception-facing.
- **Why it matters:** Provenance currency: the file points to a superseded guideline. Independently corroborated by several subagents. Citation-only fix; flagged so the CSO re-checks the reception sepsis red flags against NG253/NG254 at the next sign-off.
- **Regression lock-in:** none.
- **Source:** NICE NG253 / NG254 (replacing NG51) — <https://www.nice.org.uk/guidance/ng253> (2024 (NG253 updated 2025-11))
- **Verified evidence:** Multiple independent searches confirm NG51 split into NG253 (16+, updated Nov 2025) and NG254 (<16s) in 2024; CKS cauda-equina red flags also revised to early/subtle micturition/saddle features — relevant to the backpain pathway review.
- **Provenance:** verified by orchestrator (WebSearch corroborated, multi-source) on 14 June 2026 — corroborated, confidence medium.

---

## Appendix: scan transparency

**Sources checked:** BNF monitoring requirements / treatment summaries (WebSearch only — bnf.nice.org.uk 403 to fetch); MHRA Drug Safety Update (gov.uk); emc / dm+d / NHSBSA Drug Tariff; NHS England QOF 2026/27 guidance (PRN02356); NICE indicator menu + NICE NG106/NG196/TA1026; JCVI flu & COVID 2026/27 statements / UKHSA Green Book; PINCER indicators (PRIMIS, Nottingham); Boustani ACB scale / ACBcalc; STOPP/START v3 (O'Mahony 2023); NICE CKS topic red-flags + NG12/NG51/NG143/NG228 (geo-blocked — secondary sources only); NHS Pharmacy First clinical pathways.

**Rule-file baseline at start of run:**
- `drug-rules.json`: 2026-06-04
- `qof-rules.json`: QOF 2026/27 (2026-06-10)
- `vaccine-rules.json`: JCVI/UKHSA 2025/26 season (2026-06-10)
- `alert-library.json`: v1.2 / 2026-06-11
- `reception-pathways.json`: v1.1 DRAFT / 2026-06-10
- `acb-scores.js + stopp-start.js`: starter set — CSO verification outstanding
- `clinical-thresholds`: test-clinical-thresholds-sync.js pin set

**Candidates excluded as low relevance:** 6.

**Candidates killed during verification (not applied):**
- `kill-001`: drug ziprasidone/Zeldox: has a dm+d/BNF code but is NOT marketed/licensed in the UK (search-confirmed) — adding it to the antipsychotic match list is not a real gap.
- `kill-002`: statin lovastatin: not UK-marketed (search could not confirm UK availability); only pitavastatin from that candidate survives (medrev-003).
- `kill-003`: drug discontinuation 'notes' (fluphenazine/Modecate, Uloric, Twynsta) and Rybelsus-reformulation / semaglutide-generic 'watch' items: market-intelligence notes, not match-list deltas; no rule change and the generics have no UK brand to add yet. Re-flag semaglutide generics when a UK brand actually lands.
- `kill-004`: alert finasteride depression/sexual-dysfunction and falls NG249 50-64 expansion: plausible but not page-verified here, and NG249 needs risk-stratification engine work. Left for CSO confirmation rather than shipped on corroboration-only evidence.

**⚠️ Sources that could not be reached this run:** WebFetch returned HTTP 403 to EVERY URL this run (bnf.nice.org.uk, gov.uk, nice.org.uk, cks.nice.org.uk, acbcalc.com, even wikipedia) — all findings are WebSearch-corroborated only, none page-verified. NICE CKS is additionally UK-geo-restricted. Per The Keeper's own discipline, corroborated-only evidence is NOT sufficient to apply a clinical-rule change, so NOTHING was applied this run — every item is a proposal for the CSO to confirm against its source.. _Treat the affected rules as unchecked this run._

**Out of scope:** local ICB formularies and shared-care boundaries are not covered by this national scan. Paste a local formulary line into a run to fold it in.

**Disclaimer:** The Keeper keeps Sentinel's approximations of the source guidance current. It is a memory aid, not the official QOF business rules, the BNF, or a prescribing system. The CSO reviews and approves every clinical rule change.
