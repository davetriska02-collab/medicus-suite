# Patient Record Viewer — Feature Roadmap & Data-Source Decision

**Status:** Draft for discussion · **Date:** 2026-05-29 · **Scope:** `visualiser-core.html` / `visualiser-core.js`

This document captures the research, the codebase reality, and the resulting
recommendation for evolving the patient-record visualiser — the full-tab view
that today loads an exported EPR **PDF** and renders attendances, continuity
indices, investigation trends and a timeline. The focus is **long-term
condition (LTC) / chronic-disease care** and viewing the patient journey
through multiple lenses.

It is grounded in (a) eight parallel web-research sweeps across the relevant
domains, and (b) two codebase investigations: one mapping the current viewer,
one mapping live patient-data availability.

---

## 1. Executive recommendation

1. **Adopt a hybrid data model, not a rewrite.** Keep the PDF importer as the
   source of truth for the **longitudinal / attendance / journey** lenses, and
   add the **existing live API client** as the source for the **snapshot**
   lenses (problems, meds, observations, demographics, risk scores).
2. **Build new features against the normalised internal shapes** (`_s.problems`,
   `_s.entries`, observation analytes, etc.), so the same render code works
   whether data arrived from a PDF parse or a live fetch.
3. **Ship a thin vertical slice first** — the contacts calendar heatmap — to
   de-risk the approach before broader investment.
4. **Stay inside the existing tech envelope:** vanilla JS, no build step,
   bundled vendor libs (Chart.js, D3, PDF.js). No new vendor libraries, no
   manifest/API changes required for Phase 1.

---

## 2. The data-source decision (settled by code evidence)

The single most important question was: *should this be done from the PDF, or
live from an open patient?* The answer is **both, split by lens**, and the split
is forced by what the live API can and cannot return.

### What the live API **can** supply (already wired in `engine/api-client.js`)

| Lens | Live? | Endpoint |
|---|---|---|
| Demographics | ✅ | `/patient/data/patient/patient-banner/{uuid}` |
| Medications (8 buckets, doses, history) | ✅ | `/clinical/data/medication/medication-regimen/{uuid}` |
| Problems (coded, dated) | ✅ | `/clinical/data/problem/listing/{uuid}` |
| Observations / labs (date×test matrix) | ✅ mostly | `/care-record/data/investigation/dashboard/{uuid}` |
| Consultation-coded observations | ⚠️ partial | `/clinical/data/patient-journal/overview/{patientId}` — observations only, **hardcoded 400-day window** (`sentinel.js:357`) |

Auth is inherited from the signed-in Medicus session via same-origin cookies
(`credentials: 'include'`, `api-client.js:141–145`). DOM extractors
(`engine/extractors/*`) exist only as a **fallback** when the API fails
(`data-fetcher.js:131–229`).

### What the live API **cannot** supply (confirmed by spike)

The **longitudinal consultation / attendance history** — the data behind the
frequency graphs, UPC/BICE continuity indices and the practitioner ribbon — is
**not reachable live in bulk**. Three pieces of code evidence:

- **No consultation/encounter normaliser.** `normaliseAll()`
  (`engine/normalisers.js:270–279`) covers only banner, meds, problems,
  observations. Nothing turns journal/encounter data into a contact list.
- **No encounter *listing* endpoint.** Only single-lookup
  `/clinical/data/encounter/overview/{encounterUuid}` exists
  (`api-client.js:181–196`). There is no "all consultations since X".
- **The activity report is counts-only** (`shared/activity-api.js`) —
  aggregates with no dates or clinician-level detail.

Plus `docs/sentinel-README.md:62` notes the investigation-dashboard endpoint
*excludes* consultation-coded entries living in the journal/encounter record.

**Conclusion:** multi-year attendance/journey data is **PDF-bound today**. The
PDF export is not merely helpful — for those lenses it is currently
*load-bearing*. Everything else should lean live.

### Resulting per-feature source map

| Feature | Best source | Rationale |
|---|---|---|
| Contacts calendar heatmap | **PDF** | needs full consultation list — live can't |
| Continuity (UPC/BICE), practitioner ribbon | **PDF** | already PDF-driven; no live equivalent |
| Multimorbidity / Charlson | **Live** | pure problem list |
| Monitoring-bloods-due | **Live** | meds + obs dates both live |
| Observation sparklines / trends | **Live** (PDF fallback) | dashboard endpoint covers most |
| Condition summary cards | **Hybrid** | obs/problems live; review-due dates from PDF |
| Care-process checklist | **Hybrid** | labs live; foot-exam/review codes are consultation-coded → PDF |

---

## 3. Current state of the viewer (don't rebuild these)

From the codebase map. The viewer is already substantial:

- **PDF.js** parsing via regex line-reconstruction (`loadPDF`/`parseAll`,
  `visualiser-core.js:603–644`, `467–599`). Brittle to format drift.
- **Chart.js** investigation trends with a custom `zoneBandsPlugin` drawing
  clinical reference bands (`renderAnalyteTrend`, ~1701). One chart instance at
  a time (`_s.invChart`, ~257).
- **D3** swim-lane event timeline (`renderSwimLane`, ~1429), full re-render on
  filter change.
- **Continuity analytics**: UPC and Bice-Boxerman indices, top-clinician bar
  chart, practitioner activity ribbon, volume-by-year (`buildContinuity`/
  `computeTimeline`, ~1260–1426).
- **eFI gauge** (semicircle SVG, `buildSnapshot`, ~1063).
- **QOF register** matching + review dates (~740–770).
- **High-risk drug** monitoring list (~167).
- **Filter bar**: date presets + D3 brush, clinician, problem (~879–920).

**Gaps** worth filling: no contacts heatmap, no condition summary cards, no
multimorbidity/Charlson, no care-process checklist, no polypharmacy/ACB lens,
no sparkline overview, no milestone markers / density mini-map on the timeline.

---

## 4. Phased feature plan

Rated **Value (H/M/L)**, **Effort** (per codebase constraints), **Source**.

### Phase 1 — Quick wins (Easy, reuse existing functions)

| # | Feature | Value | Effort | Source | Slots into |
|---|---|---|---|---|---|
| 1 | **Contacts calendar heatmap** (month×year matrix) | H | Easy | PDF | new view in Timeline tab; reuse `computeTimeline` aggregation |
| 2 | **Condition summary cards** (latest value + trend + target band + review-due) | H | Easy–Med | Hybrid | reuse QOF match + `CLINICAL_ZONES` |
| 3 | **Multimorbidity count + Charlson** beside eFI gauge | H | Easy | Live | extend `buildSnapshot`; add weighted lookup const |
| 4 | **Care-process checklist** (e.g. diabetes 9 processes) | H | Med | Hybrid | match analytes + dates to a per-condition process list |
| 5 | **Monitoring-bloods-due flags** for high-risk drugs | H | Easy | Live | surface "overdue" from existing monitoring reqs (~167) |
| 6 | **Sparkline overview strip** across key observations | M | Easy | Live | new header strip; inline SVG, no new lib |

### Phase 2 — Deeper lenses (Medium)

| # | Feature | Value | Effort | Source | Notes |
|---|---|---|---|---|---|
| 7 | Timeline upgrades: milestone markers, density mini-map, semantic zoom | H | Med | PDF | enrich `renderSwimLane`; cap ~500 events |
| 8 | Medication / polypharmacy lens: med timeline + polypharmacy count + anticholinergic burden (ACB) | M–H | Med | Live | ACB needs a drug→score lookup; full STOPP/START rule-engine is Hard — defer |
| 9 | Rolling 12-month contact rate vs patient's own prior year | M | Med | PDF | "vs practice baseline" needs a baseline we lack — use self-comparison |
| 10 | Multi-analyte side-by-side compare | M | Med | Live | refactor single `_s.invChart` holder to an array |

### Phase 3 — Data-gated / avoid

- **DNA rate, ED/admission frequent-attender flags** (NHS High Intensity Use:
  5-in-12-months) — high value, but **verify the PDF actually contains the
  data** before building. Not in the live API.
- **Proprietary risk engines** (QRISK3, QDiabetes, QFracture, KFRE) — advisory
  badges only; flag missing biomarkers in red; never compute silently.
- **Live API integration for the *full* record, cross-org timelines,
  full-text search/IndexedDB** — architectural; out of scope.

### Recommended shortlist (if nothing else)

Features **#1, #2, #3, #4+#5** — all high-value, mostly data-ready, reuse
existing code, no new libraries/build/manifest changes.

---

## 5. Clinical-safety guardrails

- Compute only **deterministic, coded-data** scores (eFI, Charlson, counts,
  trend-decline flags). Treat proprietary scores as **advisory** and label them.
- **Flag missing inputs in red** rather than assuming them (e.g. no UACR → do
  not infer CKD risk).
- Use **stepped lines** for irregularly-sampled labs (no misleading
  interpolation), **colour-blind-safe palettes + shape markers**, and
  **target-range shading** (the `zoneBandsPlugin` already does the last).
- Live data depends on an active signed-in session; always provide the PDF
  path as a fallback and show clearly which source is in use.

---

## 6. Open questions / future spikes

- **Journal depth spike (settled, negative):** confirmed no bulk
  consultation/encounter listing endpoint exists; journal is a 400-day
  observations-only window. Revisit only if Medicus ships such an endpoint.
- **DNA / ED data presence:** does a real EPR export PDF contain DNAs and
  A&E/admission events? Decides whether Phase 3 attendance flags are buildable.
- **Source-agnostic render layer:** small refactor so render functions consume
  normalised shapes regardless of origin — prerequisite for cleanly mixing PDF
  and live data.

---

## 7. Research sources

Collated from the eight domain sweeps. UK primary-care focused.

**LTC / chronic-disease dashboards**
- QOF online database — https://qof.digital.nhs.uk/
- NICE NG56 Multimorbidity — https://www.nice.org.uk/guidance/ng56
- NICE NG115 COPD — https://www.nice.org.uk/guidance/ng115
- Ardens chronic-disease risk stratification — https://support-ew.ardens.org.uk/support/solutions/articles/31000158350
- National CKD audit (BJGP) — https://bjgp.org/content/68/673/356
- NHS England QOF guidance 2025–26 — https://www.england.nhs.uk/wp-content/uploads/2025/03/quality-outcomes-framework-guidance-for-2025-26.pdf

**Attendance / utilisation analytics**
- Consultation patterns in UK primary care (PMC) — https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8718478/
- RCEM frequent attenders in the ED — https://rcem.ac.uk/wp-content/uploads/2021/10/Frequent_Attenders_in_the_ED_Aug2017.pdf
- NHS High Intensity Use Programme — https://www.england.nhs.uk/high-intensity-use-programme/
- Inter-contact interval study (BMC Primary Care) — https://bmcprimcare.biomedcentral.com/articles/10.1186/1471-2296-14-162
- Reducing DNAs (BJGP) — https://bjgp.org/content/71/702/e31
- Heatmaps in healthcare (PMC) — https://pmc.ncbi.nlm.nih.gov/articles/PMC6166481/

**Timeline / journey visualisation UX**
- LifeLines (PubMed) — https://pubmed.ncbi.nlm.nih.gov/9929185/
- LifeLines2 (UMD HCIL) — http://www.cs.umd.edu/projects/hcil/lifelines2/
- KNAVE-II — https://www.semanticscholar.org/paper/026cc6255e3184cb87ff7080157823aa991de923
- HistoriView (PMC) — https://pmc.ncbi.nlm.nih.gov/articles/PMC10990596/
- Health Timeline insight study (PMC) — https://pmc.ncbi.nlm.nih.gov/articles/PMC6704521/
- EventLines (arXiv) — https://arxiv.org/pdf/2507.17320

**Clinical data-visualisation best practice**
- Tufte, sparkline theory & practice — https://www.edwardtufte.com/notebook/sparkline-theory-and-practice-edward-tufte/
- NHS Wales data-visualisation toolkit — https://performanceandimprovement.nhs.wales/functions/quality-safety-and-improvement/improvement/improvement-cymru-academy/resource-library/academy-toolkit-guides/data-visualisation-toolkit-guide/
- Visualising patient-generated health data (PMC) — https://pmc.ncbi.nlm.nih.gov/articles/PMC10665122/
- Run & control charts for QI (AAP) — https://publications.aap.org/hospitalpediatrics/article/14/1/e83/196276
- Visualising reference ranges — https://www.danielsarmiento.com/posts/visualizing-reference-ranges/
- Colour-blind data-viz guide — https://deficiencyview.com/blog/color-blind-data-visualization-accessible-charts-guide

**Risk stratification / frailty / multimorbidity**
- eFI2 validation (BJGP) — https://bjgp.org/content/75/755/249
- Charlson index in primary care (PMC) — https://pmc.ncbi.nlm.nih.gov/articles/PMC4458584/
- QRISK3 vs alternatives — https://www.iatrox.com/blog/qrisk3-vs-ascvd-vs-score2-which-cvd-risk-calculator-should-you-use-2026
- NHS risk stratification (Arden GEM CSU) — https://www.ardengemcsu.nhs.uk/services/business-intelligence/risk-stratification/
- KFRE & eGFR trajectory (PMC) — https://pmc.ncbi.nlm.nih.gov/articles/PMC10103205/
- Multimorbidity & readmission (PMC) — https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9761223/

**Medication / polypharmacy / SMR**
- NHS England Structured Medication Reviews — https://www.england.nhs.uk/primary-care/pharmacy/smr/
- NHS SPS person-centred polypharmacy — https://www.sps.nhs.uk/articles/a-person-centred-approach-to-polypharmacy-and-medication-review/
- STOPP/START v3 (PMC) — https://pmc.ncbi.nlm.nih.gov/articles/PMC10447584/
- ACB scale (GPnotebook) — https://gpnotebook.com/pages/neurology/anticholinergic-cognitive-burden-acb-scale
- High-risk medication monitoring — https://coreprescribingsolutions.co.uk/high-risk-medication-monitoring/

**Care gaps / guideline adherence / recall**
- NICE QS28 Hypertension (+ QS209 Diabetes) — https://www.nice.org.uk/guidance/qs28/
- Cervical screening call & recall — https://www.gov.uk/government/publications/cervical-screening-call-and-recall-administration-best-practice/
- AAA screening programme — https://digital.nhs.uk/services/screening-services/abdominal-aortic-aneurysm-screening
- Ardens disease management — https://ardens.org.uk/solutions/disease-management

**Competitive / product scan**
- EMIS Web care-history trends — https://www.herohealthsoftware.net/primary-care/emis-support/article/how-do-you-view-and-interpret-trends-in-patient-data-using-the-graphical-and-tabular-trend-options-in-emis-web-s-care-history
- Epic Storyboard — https://www.arhfoundation.org/what-is-storyboard-in-epic
- Ardens chronic-disease templates — https://support-ew.ardens.org.uk/support/solutions/articles/31000155438
- NHS Summary Care Record — https://digital.nhs.uk/services/summary-care-records-scr
- Graphnet CareCentric shared care — https://www.graphnethealth.com/solutions/shared-care
- Cerner HealtheIntent — https://www.softwaresuggest.com/cerner-healtheintent
- TPP SystmOne — https://tpp-uk.com/products/
