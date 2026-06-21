# The Keeper — QOF currency check vs primary source PRN02356 — 2026-06-21

> Source: **NHS England, "Quality and Outcomes Framework guidance for 2026/27",
> PRN02356** (the official PDF, supplied by the maintainer; 82 pages, text
> extracted locally). This is the PRIMARY source the earlier Keeper run
> (2026-06-21, web-blocked) could not reach. Scope: `rules/qof-rules.json`
> enabled indicators. Every figure below was read directly from the indicator
> wording table and cross-checked against the per-indicator detail section.

## Headline

- **DM036 is CORRECT — the held discrepancy is resolved, no change.**
- **24 of 26 enabled indicators match the official source exactly.**
- **One real currency drift found: the smoking-status / SMI mental-health
  indicator family is on a PRE-26/27 model** (`MH011` mislabelled; `SMOK001`
  does not exist in 26/27; `SMOK002` and `SMOK004` missing). This is a
  CSO-review change, not an auto-merge.

## 1. DM036 — RESOLVED (no change)

PRN02356 (NICE **IND249**) defines DM036 as: *"the percentage of patients with
diabetes, on the register, **aged 70 years and under**, without moderate or
severe frailty in whom the last blood pressure reading ... is 140/90 mmHg or
less"* — **27 points, 38–90%**. The file's `ageRange.max: 70`, `points: 27`,
`thresholds: 38–90` are **all correct**. The "≤79" secondary snippet that
prompted the hold conflated the indicator's own age band with its NG17 rationale
note ("type 1 diabetes aged 79 or under with ACR ≥70 mg/mmol"). The conservative
hold was the right call; the file was right. **No change to DM036.**

## 2. Confirmed correct (no change) — 24 indicators

Verified identical (points, thresholds) to PRN02356: CD001 (41, 40–90), CD002
(20, 46–90), HYP010 (38, 40–85), HYP011 (14, 40–85), CHD005 (7, 56–96), STIA007
(4, 57–97), CHOL003 (20, 70–95), CHOL004 (44, 20–50), AF006 (12, 40–95), AF008
(12, 70–95), DM006 (3, 57–97), DM014 (11, 40–90), DM020 (17, 35–75), DM021
(10, 52–92), DM034 (8, 50–90), DM035 (8, 50–90), **DM036 (27, 38–90)**, DM037
(10, 35–75), HF007 (7, 50–90), HF008 (6, 50–90), HF009 (12, 20–50), AST007
(20, 45–70), AST012 (15, 45–80), COPD010 (9, 50–90). No drift.

## 3. DRIFT — the smoking-status / SMI indicator family (CSO change proposal)

The file models smoking status on a **pre-26/27 structure** that PRN02356 has
consolidated. Verified against the official wording table (lines cited from the
extracted text):

| What the file has | What PRN02356 26/27 says |
|---|---|
| `MH011` = "Smoking status recorded in SMI", **5 pts, 40–90%** | **`MH011` = lipid profile in SMI** (record of a lipid profile in preceding 12 months) — **7 pts, 50–90%**. MH011 is NOT a smoking indicator in 26/27. |
| `SMOK001` ×8 per-register ("Smoking status recorded in Asthma / COPD / Diabetes / CHD / Stroke-TIA / CKD / HF / PAD"), **4 pts each, 40–90%** | **`SMOK001` does not exist.** Smoking status is now a single indicator **`SMOK002` (NICE IND97)** = "patients with any of CHD, PAD, stroke/TIA, hypertension, diabetes, COPD, CKD, asthma, **schizophrenia, bipolar, other psychoses** whose notes record smoking status in the preceding 12 months" — **25 pts, 50–90%**. It already INCLUDES SMI. |
| (missing) | **`SMOK004` (NICE IND99)** = "patients aged 15+ recorded as current smokers who have a record of an offer of support and treatment within the preceding 24 months" — **12 pts, 40–90%**. Not in the file. |

### Patient-safety read
- `MH011` currently **displays the wrong indicator** (smoking, not lipid) with
  the wrong points/threshold. An SMI patient's lipid-profile QOF status is not
  surfaced at all, and a "MH011 smoking" prompt is factually incorrect for 26/27.
- The per-register `SMOK001` model under-represents the consolidated SMOK002 and
  omits SMI from the smoking cohort and omits SMOK004 entirely.

### Recommended change set (verified, conservative)
1. **Re-map `MH011`** → lipid profile in SMI: name "Cholesterol/lipid profile
   recorded in SMI (preceding 12 months)", **7 pts, 50–90%**, source "QOF 26/27
   MH011 (NICE IND-series, PRN02356 p.39-ff)".
2. **Replace the 8× `SMOK001`** per-register rules with a single **`SMOK002`**
   (NICE IND97), conditions = CHD, PAD, stroke/TIA, hypertension, diabetes, COPD,
   CKD, asthma, schizophrenia/bipolar/psychoses; **25 pts, 50–90%**. (For
   Sentinel's per-patient display, SMOK002 should fire on any of those registers
   — confirm the engine's per-register fan-out before collapsing the rules.)
3. **Add `SMOK004`** (NICE IND99), **12 pts, 40–90%**.

### Why this is NOT auto-applied here
This is a **structural** QOF change (8 rules → 1 + 1, plus a re-map), and it
alters which indicators Sentinel surfaces per patient. Per Keeper doctrine a
clinical-rule change is never auto-merged; it needs (a) review of how
`engine/`/`sentinel.js` consume `indicatorCode` for per-patient display, and
(b) regression-test updates (the QOF indicator set / `test-clinical-thresholds-
sync.js`). It is a verified, primary-source-confirmed proposal ready to
implement on sign-off.

## 4. Provenance

The file header may now record that QOF values were confirmed against the
**primary PRN02356 PDF on 2026-06-21** (superseding the earlier corroboration-
only status), with the smoking/MH011 drift logged as the one open change.

## Recommendation

Apply (1)–(3) as a single reviewed commit with the test updates, or keep this as
the change proposal. DM036 needs nothing. Everything else is current.

---

## APPLIED — 2026-06-21 (primary-source verified)

The change set was implemented in `rules/qof-rules.json` (full suite 113/113):

1. **MH011 re-mapped** to lipid profile in SMI (`requiresRegister: SMI`,
   observation = lipid/cholesterol panel within 365 days, **7 pts, 50–90%**).
2. **SMOK001 ×8 replaced by SMOK002 ×9** — the official register set CHD, PAD,
   stroke/TIA, **hypertension**, diabetes, COPD, CKD, asthma, **SMI** (the stale
   **HF** entry was dropped — HF is not in SMOK002), each **25 pts, 50–90%**,
   modelled as one per-register check (the schema gates by a single register).
3. **SMOK004 added, shipped disabled** — its cohort ("current smokers aged 15+")
   is not a disease register and is not expressible in the current schema; values
   (12 pts, 40–90%, NICE IND99) recorded for when a smoking-status cohort gate
   lands. Engine follow-up.

DM036 left unchanged (confirmed correct).
