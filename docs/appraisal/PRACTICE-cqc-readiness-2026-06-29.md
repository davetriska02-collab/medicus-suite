# The Practice — CQC Inspection Readiness appraisal (2026-06-29)

**Scope:** the CQC Inspection Readiness surface (`cqc-readiness.html` / `cqc-render.js` / `engine/cqc-evidence.js`) and the 7-item improvement proposal from the 3-agent review.
**Method:** six synthetic personas, screenshots-only, one subagent each, rating the live-rendered states (resting, readiness-check light/dark, export-gated, export-confirmed, colourblind).

> **These personas are synthetic.** Their reactions are a structured heuristic for surfacing UX/feature gaps cheaply — they are NOT real user research and no quote is a real clinician's. Every factual claim below was verified against the rendered page or source before being adopted; persona embellishments are flagged and discounted.

## 1 · Verdict

The bones are right and the honesty is right — the panel is frustrated by *packaging*, not *principle*. Every persona credited the "never proof of compliance" framing, the readiness/export split, and the confirm-gate attestation; the reconciliation "run-this-search-yourself, write your count" worksheet was independently named the best idea on the page by the manager, the pharmacist and the nurse. The single biggest thing **holding it back**: the page leads with a multi-screen alphabetical wall of matched drug names and buries the actual answer (the RAG verdict, the currency dates, the reconciliation worksheet) far below the fold — so the technophobe partner closes it in 10 seconds and the manager can't find what she'd hand an inspector. The single biggest thing **carrying it**: that reconciliation worksheet, once it's promoted to the headline. Average ease-of-use **5.2/10**.

## 2 · The panel

| Handle | Role | Band | Score | Single biggest ask |
|---|---|---|---|---|
| Dr Margaret Aldous | Senior partner | technophobe | **3/10** | One plain-English yes/no verdict at the very top |
| Dr Tom Hollis | Salaried GP | pragmatist | **5/10** | A five-second traffic-light summary above the prose |
| Sister Eileen Cobb | Practice nurse | reluctant | **5/10** | "Floor not a ceiling — verify your own count" bold at the top |
| Maureen Castle | Secretary / admin | technophobe | **6/10** | Make the Download CSV button actually work |
| Janet Briggs | Practice manager | reluctant-capable | **6/10** | Reconciliation worksheet + RAG summary first, drug list in an appendix |
| Raj Patel | Clinical pharmacist | savvy+domain | **6/10** | Disclose every exclude string beside every match term |

## 3 · Findings by bucket

### Universal friction (ranks first)
- **U1 — The matched-terms wall buries the answer. [MAJOR]** Margaret, Janet, Tom, Eileen all hit it. The alphabetical drug-name list dominates the top of both readiness and export views (`renderMatchedTerms`, no count shown); the verdict/currency/reconciliation sit below the fold. *Verified.* Fix: collapse it into a counted, expandable appendix ("Monitors N drug terms — expand"), lead with the summary.
- **U2 — No landing verdict. [MAJOR]** Margaret wants a one-sentence yes/no; Tom a traffic-light; Janet "the answer first". An "Overall readiness" banner *does* exist (`cqc-render.js:127`) but it isn't landing as a plain-English verdict because the wall follows it immediately. Fix: a bold one-liner + count of items needing attention, framed as **monitoring-system** readiness, never "practice is compliant".
- **U3 — "Updated" should be "verified". [MAJOR]** All six. "Verified on {date} against BNF/NICE/MHRA" carries governance weight "updated" doesn't. = proposal **C**. Per-drug where possible (Eileen, Raj).
- **U4 — The undercount caveat is buried. [MAJOR / clinical-safety]** All six want "coded data only — a floor not a ceiling" bold and at the top, not mid-page. = proposal **D**.

### Tech-literacy gradient (loses the technophobe floor)
- **G1 — Jargon with no expansion. [MAJOR]** "Processes", "Well-led", "matched terms" (matched against *what*?), "reconciliation" (reads as accountancy — Eileen), "RAG", "baseline" all stalled Margaret/Maureen/Eileen. Fix: plain-language section intros, expand acronyms, a one-line "what this is / how to use it" header. Margaret could not explain the page in one sentence — that is the floor failing.

### Role-specific needs
- **Manager (Janet):** reconciliation worksheet as headline (**B**); a defensible source behind every figure; an MHRA alert-response log (**G**, raised *unprompted* as her scariest gap). Actively wants QOF/**E** kept OUT — "an inspector will start asking about actual QOF achievement, which this document is not for."
- **Pharmacist (Raj):** disclose exactly which PINCER combinations / which ACB scale / which STOPP-START version (**F**, his #1); **and disclose the `exclude` strings beside the match terms** (his single biggest ask — *not in the proposal*). His trap: a green "Safe" statement built on a manifest that hides its exclude logic can assert monitoring the practice doesn't have (e.g. an over-broad `"injection"` exclude silently dropping parenteral-methotrexate patients) — "not an amber finding, a Section 31 conversation."
- **Nurse (Eileen):** a dated, sourced *per-drug* currency stamp ("verified against BNF/MHRA on [date], next review due"); brand-completeness worry (Neoral vs ciclosporin, Priadel vs lithium); caveat at the top.
- **Admin (Maureen):** the broken CSV (**A**) is her only blocker; wants the print/export order-of-operations made obvious.
- **Salaried GP (Tom):** honest low engagement — "a manager page with a thin sliver of clinical utility"; would open it only if the manager asked before an inspection.

### Standout strengths (protect — don't regress)
- The **confirm-gate attestation** ("I have reviewed these figures") — Janet: "makes it my attestation, not the software's."
- The **readiness vs evidence-export** two-mode split.
- The **"never proof of compliance"** framing — universally credited; must not be removed.
- The **reconciliation worksheet** concept (trust-but-verify) — the best idea on the page per three personas; just buried.
- **RAG badges carry text labels** (`GREEN`/`AMBER`/`RED`, `cqc-render.js:34`), so the rating is not colour-only — *corrects Raj's "colourblind collapse" overstatement.*

## 4 · Prioritised path (ranked by what the team actually wants)

UX items → route through `design-crit` for this single surface. Clinical-disclosure items → verify accuracy via `the-keeper`. Effort: S <2h · M half-day · L 1–2 days.

1. **Lead with the answer [M].** Top-line plain-English verdict (U2) + reconciliation worksheet (**B**) above the fold; demote the drug-name wall to a counted, collapsible appendix (U1). *Unblocks Janet, Eileen, Tom, Margaret.*
2. **"Verified on {date} against BNF/NICE/MHRA" [S–M], per-drug where possible (C + U3 + Eileen/Raj per-row stamp).** *Unblocks all six.*
3. **Undercount caveat bold and at the top; vaccines labelled "surveillance"; show a red "not ready" example [S–M] (D).** *Clinical-safety; all six.*
4. **Fix the broken Download CSV [S] (A).** Confirmed defect: `downloadCsvFile` reads `csv.text` but `buildReadinessCsv` returns `{suffix, sections}`, so the button silently no-ops; filename also reads `asAt` (engine emits `generatedAt`). *Unblocks Maureen.*
5. **Disclose which PINCER combos / which ACB scale / which STOPP-START version — AND the exclude strings beside match terms [M] (F + Raj's exclude-disclosure).** *Pharmacist #1; closes the silent-false-negative trap.*
6. **Plain-language pass [M] (G1):** expand acronyms, add a "what this is / how to use it" intro. *Holds the technophobe floor.*
7. **MHRA/CAS/NPSA alert-response log [L] (G).** Validated bigger bet — the Well-led artefact CQC asks for first, raised unprompted by Janet; partly answers the deeper "this evidences capability, not practice" critique (Margaret, Raj).

## 5 · Judgement calls (reversible)
- **Demote proposal E (Effective/QOF statement) out of the inspector pack.** I proposed it; the panel's primary user (Janet) actively pushed back and the clinicians were indifferent. *Reverse by:* adding a single Effective statement **internal-readiness-only**, scoped "rule-set in use, not achievement", never in the export. Worth revisiting only if a future user explicitly asks to evidence Effective.
- **Colourblind severity downgraded.** Badges carry text labels, so not colour-only. Open check: the standalone page's `applyTheme` honours only dark theme, so confirm the suite's colourblind display mode actually propagates here. *Low severity.*

## 5b · Iterate-to-8 loop (2026-06-29)

The panel was then run as a closed loop on Opus: implement → re-render → re-appraise,
until every persona scored the surface ≥ 8/10. Five iterations, shipped as
v3.135.0 → v3.135.2.

| Persona | R1 | R2 | R3 | R4 | R5 |
|---|---|---|---|---|---|
| Janet (practice manager) | 6 | 5 | 7 | 8 | **8** |
| Margaret (partner, technophobe) | 3 | 4 | 7 | 8 | **8** |
| Tom (salaried GP) | 5 | 5 | 7 | 8 | **8** |
| Raj (clinical pharmacist) | 6 | 7 | 7 | 8 | **8** |
| Maureen (admin, technophobe) | 6 | 4 | 6 | 7 | **8** |
| Eileen (practice nurse) | 5 | 6 | 7 | 7.5 | **8** |
| **Average** | **5.2** | 5.2 | 6.8 | 7.75 | **8.0** |

What each iteration changed:
- **iter 1 (v3.135.0 part):** answer-first headline verdict + RAG legend; collapsed the
  matched-term wall; fixed the dead CSV export; plain-language glosses.
- **iter 2 (appraisal only):** revealed that promoting the blank reconciliation worksheet
  backfired (manager/partner read empty "your count" cells as "unfinished homework"), and
  surfaced developer noise leaking into the document ("WebFetch 403").
- **iter 3 (v3.135.0):** verdict separates "rules current" from "patients monitored";
  reconciliation demoted below Safe/Well-led + reframed as a by-design worksheet; spec
  strings sanitised; internal codes removed.
- **iter 4 (v3.135.1):** disclosed each rule's `drug.exclude` strings (Raj's silent-false-
  negative trap); humanised provenance (no file paths); per-card "System currency" label;
  collapse-on-screen / force-open-in-print; one-click "Print inspector copy".
- **iter 5 (v3.135.2):** unambiguous two-step print hint; de-scared the confirm gate;
  explained why excludes exist; de-duplicated the coded-data caveat.

Key learning: the deepest blocker (manager/partner demanding auto-populated patient counts)
was NOT solved by building toward it — it is an architectural honesty boundary (read-only,
no cohort enumeration). It was resolved by stating that boundary plainly and reframing the
worksheet as deliberately blank. Honesty, surfaced well, converted the blocker into trust.

Residual "9-item" asks (none blocking 8; out of scope for this pass): per-exclude inline
reasons (Eileen) and worksheet count pre-fill (Janet) — both need data-model changes; naming
the PINCER/ACB/STOPP-START source versions (Raj); a dedicated clinician-view toggle (Tom).

## 5c · The 9-items (push from 8 → 9), 2026-06-29

After the loop hit 8.0, the four personas who had named a "what would make it a 9"
item were re-engaged on Opus until each rated their item ≥ 9. Shipped v3.136.0 →
v3.136.2.

| 9-item | Persona | Final |
|---|---|---|
| Per-exclude clinical reasons (each dropped term shows why) | Eileen | **9** |
| Named clinical-source versions — PINCER (Avery 2012), ACB (Boustani/ACBcalc), STOPP/START v3 (2023) | Raj | **9** |
| Clinician view (verdict + coverage only) | Tom | **9** |
| Fillable / persistable worksheet counts + live total + provenance line | Janet | **9** |

Honesty boundaries held throughout: no fabricated patient counts (the worksheet
sums only the practice's own typed figures), no clinical-rule or threshold changes
(disclosure surfaces what the rule files already contain), engine-method sets
(ACB, STOPP/START) flagged as NOT part of the rule-currency check, and the amber
"coded data only — floor not a ceiling" safety caveat kept visible even where a
clinician asked to collapse it (Tom endorsed this on review).

Residual 10-items (genuine, but out of scope for this pass): fillable+dated
"entered by" fields with a last-saved stamp (Janet); a "last reviewed against
source" date on the engine-method rows (Raj); clicking "monitored under the X
rule" to jump there (Eileen); folding the two grey page footers into the
collapsed tail (Tom).

## 6 · Reproduce
States rendered via `.claude/skills/design-crit/harness.mjs` to `/tmp/the-practice/cqc/`: resting-light, resting-dark, readiness-light, readiness-dark, export-gated, export-confirmed, readiness-colourblind. Panel cast: personas 1, 2, 3, 5, 8, 9 from `.claude/skills/the-practice/PERSONAS.md`.
