# Medicus Suite — Clinical Safety Notice

**For all users before installation**  
**Version:** 1.4.16 | **Date:** May 2026

---

This notice must be read before installing or using Medicus Suite. It summarises the most important safety information. The full disclaimer is in `docs/sentinel-DISCLAIMER.txt`. Both documents are binding conditions of use.

---

## What this software does

Medicus Suite is a Chrome extension that displays, in a side panel alongside your Medicus session, a reorganised view of data that is already in the patient record. It applies arithmetic threshold checks (e.g. "last HbA1c was 114 days ago; the monitoring interval is 90 days; this is overdue") and displays the result as a colour-coded indicator.

It does not diagnose. It does not recommend. It does not write anything. It does not send patient data anywhere.

---

## What it does not do — and what you must do instead

**It does not replace reading the record.**

Every value the extension displays must be verified against the source Medicus record before you take any clinical action based on it. The extension can be wrong. Reasons it might be wrong are documented in the hazard log — they include incorrect register matching, stale API data, rules that have not been updated since the QOF specification changed, and user-configured thresholds that diverge from current guidance.

**The source of truth is Medicus. Not this extension.**

---

## The single most important rule

Do not take a clinical action — ordering a test, making a referral, adjusting a medication, coding a QOF indicator — on the basis of what this extension shows without first checking the underlying record.

This is not a suggestion. It is a condition of use, and it is the primary patient safety control for this software.

---

## Known limitations you must accept

- QOF register membership is determined by problem label matching, not SNOMED refsets. False positives and false negatives occur.
- Not all QOF indicators are covered. A blank panel does not mean all indicators are achieved — it may mean the indicator is not in the implemented set.
- If Medicus changes its API, the extension may show incomplete or no data until updated.
- User-edited thresholds override the defaults. If you change a threshold, verify it against the current published guidance.
- The extension only works in Medicus. It produces nothing useful on any other system.

---

## Data and privacy

No patient data leaves your browser. The extension reads data from your authenticated Medicus session and displays it in your browser. Nothing is stored externally. Nothing is transmitted to any server except version-check requests to GitHub (which carry only the version number — no patient or practice data). This can be disabled entirely via the Options page.

---

## If something looks wrong

If the extension displays something that appears clinically incorrect — a chip that shouldn't be there, a missing indicator you'd expect to see, data that looks like it belongs to a different patient — stop using the affected module, check the source record, and report it to:

**dave@graysbrook.co.uk**

Do not assume the extension is right. Report it promptly so the issue can be investigated and fixed before other users are affected.

---

## This software is not

- A medical device (no CE/UKCA mark is claimed)
- Clinical decision support software
- Endorsed by Medicus, NHS England, MHRA, or any other body
- A substitute for your clinical judgement or your professional duty to your patient

---

## Acceptance

By installing this extension you confirm that you have read this notice and the full disclaimer in `docs/sentinel-DISCLAIMER.txt`, that you accept both documents as binding conditions of use, and that you understand and accept the limitations described in `docs/HAZARD-LOG.md`.

If you do not accept these terms, do not install the extension.

---

*Medicus Suite is developed and distributed by Dr Dave Triska, Graysbrook Ltd. It is not a commercial product. It is shared with named GP colleagues on the basis that they read and accept this notice and the full disclaimer before use.*
