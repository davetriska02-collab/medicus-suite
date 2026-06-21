# The Practice — Slots + Sentinel re-appraisal — 2026-06-21

> **This panel is synthetic.** Every reaction below is from a structured
> fictional persona, not a real clinician — a heuristic device, not user
> research, and no line is evidence that "a GP said X". Findings are verified
> against source or pixels where they drive a decision. Rendered from the real
> product at **v3.126.1** (Slots and Sentinel in light / dark / colourblind via
> the design-crit harness, realistic volume: 12 clinicians, 30 free slots, a
> 6-patient waiting room). Fixes below shipped as **v3.126.2**.

Scope: **Slots + Sentinel** (re-run after the v3.126.1 quick wins). Panel cast
for these two surfaces: the technophobe partner (Margaret), the nurse and
pharmacist who own Monitoring (Eileen, Raj), the daily GP (Tom), the cold locum
(Sam) and the manager who plans capacity (Janet).

---

## 1 · Verdict

**Slots is the strongest surface in the suite; Sentinel's idle state is honest
but its waiting-room block was still mis-reading as a clinical alert — and that
finding corrected the v3.126.1 fix.** The panel confirmed the earlier Sentinel
container reframe helped, but four of six personas independently said the
**per-row wait-time minutes were still clinical red/amber and read as
"overdue/act now"**. That is the real cross-talk: a tired clinician could read a
red waiting-room minute as a fired monitoring alert while Sentinel is idle and
has checked nobody. Acted on in v3.126.2 — the minutes now carry emphasis by
weight, not clinical hue, so inside the Monitoring tab red means only a genuine
overdue check.

Slots scored 9/9/~9/6 (Sam/Margaret/Tom/Janet). The only asks were small and
convergent: say the count is **"free"**, and give the manager an **"as at HH:MM"**
and a **practice-wide** label so she can quote it. All three shipped in v3.126.2.

---

## 2 · The panel

| # | Handle | Role | Band | Surface | Ease /10 | The one ask |
|---|--------|------|------|---------|----------|-------------|
| 1 | Dr Margaret Aldous | Senior partner | technophobe | both | Slots 9 / Sentinel 6 | Drop clinical red from waiting-room minutes |
| 3 | Sister Eileen Cobb | Practice nurse | reluctant | Sentinel | 6 | Red should only mean a real check is overdue |
| 5 | Dr Tom Hollis | Salaried GP | pragmatist | both | 7 | Don't headline a waiting list under "Monitoring" |
| 6 | Dr Sam Okonkwo | Locum (cold) | pragmatist | Slots | 9 | Put "free" in the headline |
| 8 | Janet Briggs | Practice manager | reluctant-capable | Slots | 6 | "As at HH:MM" on the tile so I can quote it |
| 9 | Raj Patel | Clinical pharmacist | savvy + domain | Sentinel | 7 | Footer should prove coverage, not just count it |

---

## 3 · Findings and rulings

### Adopted and shipped in v3.126.2

- **F1 · Sentinel waiting-room minutes read as a clinical alert.** *Severity:
  major (patient-safety-adjacent). Convergence: Eileen, Raj, Margaret, Tom (4/6).*
  The v3.126.1 container reframe (amber bar → accent) helped, but the red/amber
  **minutes** still signalled "overdue". Eileen trusted the colourblind render
  most precisely because red wasn't carrying meaning there. **Shipped:** the
  per-row wait minutes now use weight + a muted neutral tone, not clinical
  red/amber; red inside Monitoring is reserved for a genuine overdue check. The
  ordering and the "not a monitoring result" caption are unchanged. *(This is a
  non-alert that was mis-styled as an alert, so calming it raises safety — it
  does not lower an alert signal.)*
- **F2 · Slots count didn't say "free".** *Severity: minor. Convergence: Sam,
  Janet, Margaret (3/6).* "9 free or 9 total?" — the headline said "slots
  remaining", the chips repeated nothing. **Shipped:** hero now reads "free
  slots remaining today".
- **F3 · No defensible point-in-time on Slots.** *Severity: major for the
  manager. Janet (blocker).* A live capacity figure with no "as at" is not
  quotable to partners. **Shipped:** a muted "practice-wide · as at HH:MM" line
  on the hero — parity with the Condor as-at added in v3.126.1. Also resolves
  the Margaret/Tom "is 30 mine or the practice's?" ambiguity.

### Noted, not changed this run

- **F4 · Sentinel footer proves currency, not coverage.** *Severity: major
  (feature gap). Eileen, Raj.* "27 drug rules · 63 QOF indicators" is a count,
  not an assurance the right 27 (brands, intervals) are present — where silent
  false negatives hide. Unchanged: this is the roadmap item R4 from the
  whole-suite run; rule content stays with `the-keeper`. The proposed UI is a
  "rules last clinically reviewed" date plus a drill-down to the covered drugs.
- **F5 · Slots by-clinician list / "is 30 mine?"** Janet could not tie the
  headline to the per-clinician rows because they run past the fold. Low
  priority; the "practice-wide" label (F3) answers the headline-scope question,
  and the CSV export already lets her reconcile off-screen.

### Standout strengths (protect)

- **Slots is best-of-type.** Sam (cold locum) and Margaret (technophobe) both
  scored it 9: one huge number, AM/PM split and by-type counts that both
  reconcile to it (27+3 = 9+9+6+6 = 30), zero setup, zero clicks. Janet credited
  the clean reconciliation and the CSV.
- **Sentinel's idle honesty.** All Monitoring personas credited the twice-stated
  "the waiting room is not a monitoring result" and the dated rule-currency
  footer — the suite's signature self-describing state.

---

## 4 · Judgement calls (reversible)

- **The global waiting-room strip at the very top of the panel was left red.**
  Raj and Tom noted the top strip's red minutes also flirt with "alert". That
  strip (`#wrStrip`) is the suite's deliberate always-on demand alert with
  user-configurable amber/red thresholds — a real demand signal, not the
  Monitoring tab — so its salience is correct and was not touched. The F1 fix is
  scoped to the in-module Sentinel block, where the clinical-monitoring context
  is what made red ambiguous. *To revisit: if the top strip is also judged a
  misread, recolour `wr-strip-*` — but that demotes a deliberate demand alert.*
- **Sentinel "v0.5.1" / naming.** Margaret and Tom flagged the sub-1.0 version
  and "Sentinel" vs "Monitoring" naming. Cosmetic; deferred, not in this batch.

---

## 5 · Reproduce

- **Surfaces shot:** `slots` and `sentinel` in light / dark / colourblind
  (`/tmp/the-practice/slots-sentinel-2026-06-21/`); after-fix verification in
  `/tmp/the-practice/slots-sentinel-after-2026-06-21/`. Practice code `a3f2b1`,
  12 clinicians, 30 free slots, 6-patient waiting room. Rendered via
  `.claude/skills/design-crit/harness.mjs`, Playwright 1.56.1.
- **Cast:** personas 1, 3, 5, 6, 8, 9 from `PERSONAS.md`; one subagent each,
  screenshots-only, no source access; Margaret on haiku, the rest on sonnet.
- **Diffs against:** `PRACTICE-whole-suite-2026-06-21.md` (v3.126.0). The G2
  waiting-room finding there was only partly resolved by v3.126.1 (container);
  this run closed it at the wait-minute level (v3.126.2). Slots F2/F3 are new,
  surfaced by shooting Slots with a manager and a cold locum in the cast.
