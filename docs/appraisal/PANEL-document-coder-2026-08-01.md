# Panel review — Document Coder (concept stage, pre-build)

**Date:** 2026-08-01 · 20 synthetic reviewers (10 GPs, 10 clinical coders/admin staff)
reacting to the Document Coder concept: anchored-pattern extraction from letter/attachment
text, SNOMED suggestions in three confidence tiers via Medicus's own concept index,
delta-vs-record view, action flags, one-click accept through Medicus's own controls,
local-only processing, full audit ledger.

> **Synthetic panel.** Role-played personas, a structured heuristic to surface
> clinical-safety and workflow gaps before real clinicians hit them. NOT real user
> research; do not quote as "a GP said X". Run as a 20-agent panel (Sonnet), structured
> output, full transcript in the session workflow journal.

## Verdict

Everyone wants it — letter/inbox coding is named as the drudgery-plus-danger centre of the
week by all 20 — but **nobody wants the feature as sketched**. The sketch is a coding
card; the panel demands a *coverage-honesty system* with a coding card attached. The
single most repeated point (17/20, both panels, independently) is that the difference
between "read, nothing found" and "could not read / did not assess" is the entire safety
case: a blank card on a scanned-image PDF that looks like a clean card is, in five
separate personas' words, *worse than no tool*. The second near-universal theme (10/20)
is that the real-world killer is not extraction accuracy but **wrong-patient/mis-filed
letters** — a confident suggestion card on a mis-attached letter "lends false authority
to a filing error". Scores now vs with-top-ask: GPs 5.6 → 8.1, coders 5.3 → 8.4.

## Scores (adoption /10 for "someone like me")

| Reviewer | Now | With top ask |
|---|---|---|
| GP trainer / IT lead (champion) | 7 | 9 |
| Senior partner (40+ docs/day) | 6 | 8 |
| Salaried pragmatist | 6 | 8 |
| GP registrar (ST3) | 6 | 8 |
| GP, deprived list / safeguarding-heavy | 6 | 8 |
| LTC/QOF clinical lead | 6 | 9 |
| Part-time GP (safety-netting anxious) | 6 | 9 |
| Long-term locum (6 practices) | 5 | 8 |
| Rural dispensing single-hander | 4 | 7 |
| Digital sceptic, 61 | 4 | 7 |
| QOF/ES lead coder | 6 | 9 |
| Band-3 workflow admin (150–200 docs/day) | 6 | 9 |
| Senior clinical coder (22 yrs) | 6 | 8.5 |
| Data-quality / GP2GP summariser | 6 | 8.5 |
| PCN coding standardisation lead | 6 | 9 |
| Reception/inbox triage lead | 5 | 8 |
| Practice manager (CQC) | 5 | 8 |
| Deputy PM (complaints/SARs) | 5 | 8 |
| Apprentice coder (6 weeks in) | 4 | 7.5 |
| Caldicott-minded senior admin | 4 | 8 |

## Prioritised consensus wishlist (frequency × safety weight)

### P1 — The four-state honesty model, loud and persisted *(17/20; the headline)*
Every document must carry exactly one of four visually unmistakable states — **ASSESSED,
N candidates** / **ASSESSED, nothing anchored (with a coverage figure)** / **COULD NOT
READ (image/garbled)** / **NOT RUN** — where the two negative states visually *dominate*
the positive ones, are colour-blind-safe, wordy not colour-only, and are stamped into
the audit ledger per document so "did anyone look?" is answerable months later. Several
personas independently asked for a per-letter **coverage meter** ("3 of 5 numbered
problems anchored, 2 lines unassessed") and a live "N not assessed" count visible from
the task list before the task can be closed.

### P2 — Wrong-patient guard rails *(10/20)*
Patient name/DOB/NHS number pinned to the top of every card in the same visual weight as
the suggestions; suggestions never render before a patient-context check passes; the
mis-filed-letter scenario (locum dictation, GP2GP merge, scan-batch mis-split) appeared
as the war story in seven independent reviews. "A slick delta card on the WRONG patient's
letter looks exactly as trustworthy as a correct one."

### P3 — Batch/worklist mode, keyboard-first *(9/20)*
A triage list across the whole inbox with a one-line collapsed verdict per document
(nothing new / N unmatched / not assessed / could not read), sortable worst-first,
keyboard-driven. The Band-3 admin processing 150–200 docs/day: "if this is
mouse-and-click-per-card it will be slower than what I do today even if it's smarter."
The rural single-hander: "if your card doesn't collapse to one line I can trust, you've
just given me a second inbox to drown in."

### P4 — Negation, temporality and status-conflict handling *(8/20)*
The recurring nine-diagnosis discharge summary war story in three variants: ruled-out
items ("?PE — excluded on CTPA") inside the numbered list; historical items ("previous
MI 2019") coded as active; and the **stage-change trap** — "CKD stage 3b, deterioration
from 3a" rendered as "already coded, nothing to do" because CKD is on the list. The
delta must diff *qualifiers* (stage, laterality, certainty, active/resolved), and
letter-status-vs-record-status conflicts must surface as their own flag. The apprentice's
case — right breast "?malignant" vs left breast "benign cyst" — requires laterality and
certainty to stay bound to their source sentence.

### P5 — Governance-grade, exportable audit *(9/20, every manager/coder persona)*
Per-suggestion provenance (anchor sentence, tier, ancestor path, concept id), per-coder
per-tier acceptance reports the practice manager can pull unaided, a one-click
"export this patient's Document Coder history" for SAR/complaint bundles, and survival
beyond one browser profile (the existing per-machine Event Ledger is explicitly *not
enough* for the PM, deputy PM, Caldicott and PCN personas).

### P6 — Action flags as workflow state, not card decoration *(6/20)*
2WW-outcome and "GP to action" flags must (a) be visible from the inbox triage view
before the coding card is ever opened (reception lead), and (b) persist on the task,
visible to whoever covers the list, until explicitly actioned (part-time GP: "not a card
that closes — a state that outlives me being in the building").

## Hard veto lines (any one of these loses the reviewer permanently)

1. Any write without an explicit human confirmation inside Medicus's own control (20/20, in some form).
2. A blank/quiet card on an unreadable document that resembles "nothing to code" (17/20).
3. Confidence tiers distinguished by colour alone; hint-combined accepted as casually as hierarchy-proofed (8/20 — demand shape + wording + position distinction, and extra deliberate action for tier (c)).
4. Pre-filling Medicus's coding screen with today's date instead of the letter's clinical event date — "will quietly corrupt QOF achievement dates and I will turn it off practice-wide" (QOF lead).
5. Suggestions rendering for non-clinical/filing-only staff on sensitive letters (mental health, safeguarding, HIV) — "an admin filing task becomes an unintended clinical disclosure" (Caldicott).
6. Audit ledger locked to one machine with no export (PM, deputy PM, PCN, Caldicott).
7. An accept flow slower than current keyboard coding (Band-3 admin, partner, rural).

## War-story register (design must survive every one)

- Nine-diagnosis discharge summary; new AF at item 5/7 missed for weeks–months (5 independent variants — the canonical test case).
- "GP to arrange anticoagulation review" in a sub-paragraph *below* the numbered list (sceptic, PM) — anchored-only extraction rebuilds this exact trap; action-flag patterns must scan the whole text, escalate-only.
- 2WW outcome buried in paragraph four of prose, misfiled as routine (reception lead).
- Letter filed to the wrong patient via GP2GP/name mismatch; suggestions make it *more* convincing (salaried GP, deprived-list GP, DQ lead, locum, deputy PM).
- Old-practice diagnosis coded under a retired concept; naive "not on problem list" flag causes a duplicate (DQ lead) — requires walking retirement/replacement chains before claiming absence.
- Resolved/historical items coded as active off a numbered list; surfaces years later in an insurance/DVLA complaint (deputy PM, PCN lead, Band-3 admin).
- OCR of scanned letters dropping "no" from "no evidence of malignancy" (PCN lead) — OCR-sourced text is a different risk class; v1 must not OCR.
- Apprentice + cancer-adjacent hint-tier suggestion: mandatory read-back (source sentence beside SNOMED term, laterality/certainty highlighted) before accept enables; one-click escalate-to-supervisor.

## Wants we explicitly decline (with reasons) 

- **Prose-wide diagnosis NLP** (QOF lead wants HbA1c-implies-diabetes inference): stays out — that is clinical inference, the exact line the suite does not cross. The gap is *named on the card* (coverage meter) instead of silently absent.
- **OCR of image PDFs in v1**: the PCN lead's negation-drop case is disqualifying; image PDFs render COULD NOT READ, loudly.
- **Auto-escalation messaging on unactioned 2WW flags** (part-time GP's full ask): the persistent task-level banner ships; automated messaging/scheduling stays Medicus's job (intended purpose).
