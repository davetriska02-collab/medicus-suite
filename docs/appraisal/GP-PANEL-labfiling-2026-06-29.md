# GP panel review — Lab Results Auto-Filing (v3.141.0)

**Date:** 2026-06-29 · 11 synthetic GP reviewers reacting to the real rendered UI
(profile list, authoring form incl. Parameters editor, LLM builder) + the verbatim
in-Medicus button/dialog behaviour.

> **Synthetic panel.** These are role-played GP personas, a structured heuristic to
> surface clinical-safety and workflow gaps before real clinicians hit them. NOT real
> user research; do not quote as "a GP said X".

## Verdict

The concept is wanted by everyone — routine-normal filing is high-volume, low-value
drudgery — and the safety architecture (confirm-not-auto, fail-closed on
cultures/free-text/unmatched, disabled-until-reviewed, per-analyte parameters) earns
real credibility even from the sceptic. But there is a **single, near-unanimous
clinical-safety gap that caps adoption: the tool judges a snapshot, not a trajectory.**
Eight of eleven reviewers independently named "show me the previous value and the
trend at the point of filing" as their #1 ask — a creatinine of 96 (was 60), an eGFR
drifting 64→57, an HbA1c climbing 38→46 are all "normal" yet clinically significant,
and one-click filing risks automation bias burying them. Fix that and scores jump from
a ~5.5 mean to a consistent 7–9.

## Scores (adoption /10 for "someone like me")

| Reviewer | Now | With their top ask |
|---|---|---|
| Senior partner (high-volume) | 7 | 9 |
| Salaried pragmatist | 7 | 9 (bulk filing) |
| Rural single-hander | 7 | — |
| Registrar (ST3) | 7 | — |
| Newly-qualified | 6 | — |
| Diabetes / LTC lead | 6 | 8.5 (trends) |
| Power-user / IT lead | 6 | (3 without practice-push) |
| Part-time / safety-netting | 5 | (shared audit) |
| Meds-management lead | 4 | 7 (drug-aware) |
| Locum | 3 | 7 (parameter visibility) |
| Sceptic / luddite | 3 | "possibly, with supervision" |

## Prioritised wishlist (consensus, ranked by frequency × safety weight)

### P1 — Trend / previous-value at the point of filing  *(8/11; the headline)*
Show each analyte's **previous value, date and delta** inline in the confirm dialog;
**flag (and optionally block) on a significant delta** — configurable per analyte
(e.g. eGFR fall >10%, creatinine rise >20%). This is both the biggest clinical-safety
fix and the top adoption lever. *Feasible now:* the normalised report already carries
per-result history (`r.history`, newest-first) — the data is in hand.

### P2 — Show the actual values + your thresholds at the offer/confirm  *(5/11)*
Replace "every value is within range" + a name list with the **numbers and the limits
beside them**: "HbA1c 43 / ≤47 ✓ · eGFR 67 / ≥60 ✓ · Na 139 ✓". Counters automation
bias, builds the right habit, and lets a trainer/locum see the reasoning. *Feasible now*
(the macro has the values; extend `buildFilingConfirmMessage`).

### P3 — Drug-monitoring & recall awareness  *(4/11; meds-safety critical)*
Do **not** auto-offer for a patient on a monitored drug (methotrexate, lithium,
DMARDs, amiodarone, ACEi+diuretic…) or with a review/recall due — or show a prominent
"monitored drug — file manually" banner. The suite **already has drug-monitoring
rules**; integrate them. Add **interval-since-last-test** awareness and an optional
**recall-on-file** ("set next blood in N months?"). Plus a simple per-profile
"don't offer if on [drugs]" exclusion as a quick win.

### P4 — Bulk / inbox-level filing  *(2/11, but the biggest time lever)*
Review all-normal-eligible results from the inbox as a **batch list (with values),
confirm once.** The per-result button leaves the "open each of 40 results" bottleneck
untouched — bulk is what turns minutes saved into a Tuesday afternoon back.

### P5 — Per-patient "never auto-file" watch-list  *(3/11)*
A flag/list to exclude named patients (active CKD, oncology, anyone being watched)
regardless of profile. Small to build, high safety value.

### P6 — Practice-visible audit + a note in the Medicus record  *(4/11; governance)*
The machine-local audit is a blind spot in shared/part-time inboxes. Write a
structured note into the Medicus record ("Reviewed all-normal, no action — filed via
Lab Filing, profile X, by [GP], [time]"), and/or a shared digest; add an in-extension
**audit-log viewer** (exportable CSV/PDF) and a daily filed-results summary.

### P7 — Practice deployment & governance tooling  *(power-user; blocks team rollout)*
Practice-level **profile push/sync** ("practice standard" profiles for everyone),
**per-profile export/share**, **dry-run/preview** ("what would this file?"), firing
**analytics** per profile, and **versioning** (who edited, when).

### P8 — Profile transparency on the card  *(locum #1)*
Show the **parameters and provenance** (who set it, last reviewed) on the profile
card, so a clinician can see what they're trusting without opening edit mode.

### P9 — Safety-netting hooks  *(part-time)*
"Patient was told they'd be contacted" exclusion; "who requested this test" awareness
(warn before filing on another clinician's request); reopen/recall a recent filing.

### P10 — Smaller asks
`requireRangeForAll` **on by default** (or a loud risk-acknowledgement to turn off);
**supervised/trainee mode** (tag filings for trainer review); **guidance links** at
threshold-setting (NICE target tooltips); LLM-built profiles **badged "AI-suggested,
not clinically validated"** with a value-by-value confirm; **time-of-day gate**;
**undo/unfile**; a practice **kill switch**; and (sceptic) a documented **DCB0129
clinical-safety case** before live use.

## What already partly meets these
- "Why wasn't it offered" → the amber **"Auto-file not offered — review manually"** hint exists (P-near-registrar/sceptic), but should be richer.
- Fail-closed on cultures/free-text/unmatched, no full-auto, confirm gate, disabled-until-reviewed, per-analyte parameters + requireRangeForAll, local audit — all present; the asks above extend them.

## Recommended next build (highest value × feasibility)
**P1 (trend/previous value at confirm) + P2 (values & thresholds in the dialog)** —
both are the top consensus asks, both are clinical-safety wins, and the data is already
available in the fetched report. Then **P5 (per-patient suppress)** and **P3 (drug-aware
block)** as the next safety layer; **P4 (bulk)** as the efficiency unlock.

## Reproduce
Surfaces: `/tmp/the-practice/labfiling-gp/{list,form-edit,form-add-llm}.png`. Panel of
11 GP personas spanning partner→trainee, technophobe→power-user, locum, LTC/diabetes
lead, meds-management lead, rural single-hander, part-time/safety-netting, sceptic.
