# CQC evidence pack — what the suite could produce (research synthesis & scoping)

Status: **research + scoping, report-only.** From 5 haiku web-research agents (CQC
Single Assessment Framework, the Safe key question, Well-led/governance, medicines
optimisation, and evidence-pack format/credibility), synthesised against what the
Medicus Suite actually does. Sources are in the agent transcripts; key CQC pages cited
inline. **Not a build.**

## 1. Verdict

There is a strong, natural fit — the suite already computes most of the *medicines and
clinical-monitoring* evidence CQC looks for under **Safe**, and the operational-oversight
evidence under **Well-led**. A "CQC Evidence Pack" generator (a sibling to the Practice
Report) is feasible and distinctive. But it must be **honestly bounded**, and one
feasibility question is make-or-break (cohort enumeration — §5).

**The honest boundary (state it up front, in the pack itself):** CQC's Single Assessment
Framework scores each quality statement across **six evidence categories** — people's
experience, feedback from staff/leaders, feedback from partners, observation, **processes**,
and **outcomes**. A read-only tool on top of Medicus can only ever supply the last two —
**Processes** and **Outcomes** — and only for the **Safe / Effective / Well-led** ends.
It cannot supply patient experience, staff/partner feedback, or observation. So the
product is *supporting evidence that slots into the practice's wider pack* — **never proof
of compliance**, and it can't be the whole pack. This mirrors the suite's existing honesty
ethos ("no alert ≠ all clear").

## 2. The CQC anchor (what the pack must align to)

- **Single Assessment Framework** (Jan 2024, replacing KLOEs): 5 key questions, **18
  quality statements** for GP/primary medical services, **6 evidence categories**, 1–4
  scoring with "safety limiters" (one inadequate statement caps the key-question rating).
- A practice supplies evidence via a **Provider Information Return (PIR)** and on-site;
  there is **no mandatory GP template**, so a well-structured, credibility-stamped pack is
  genuinely useful.
- **Structure the pack by quality statement / key question, not by document type** —
  that is how inspectors score. (Source: CQC SAF; evidence-pack practitioner guidance.)

## 3. Where the suite can play — capability map (verified against the repo)

| CQC evidence need (Safe / Well-led) | Suite capability today | Derivable now? |
|---|---|---|
| High-risk drug monitoring — lithium / DMARDs / amiodarone / anticoagulants overdue + in-date counts | Sentinel `rules/drug-rules.json` + monitoring eval (per open patient) | **Per-patient yes; practice-level roll-up = §5** |
| Safety-monitoring flags (eGFR/HbA1c trend, hyperkalaemia) | #140 "Safety Monitoring" section (`qof-rules.json`, `sentinel.js`) | Per-patient yes; roll-up = §5 |
| Hazardous prescribing (PINCER 13: triple-whammy, NSAID+anticoag, etc.) | PINCER/triple-whammy logic in `visualiser-core.js` (82 refs) | Per-patient yes; **practice-level count = new** |
| Anticholinergic burden in older patients | `engine/acb-scores.js` (Boustani/ACBcalc) | Per-patient yes; cohort count = new |
| Potentially inappropriate prescribing / deprescribing | `engine/stopp-start.js` (STOPP/START v3) | Per-patient yes; cohort count = new |
| QOF achievement / registers | `rules/qof-rules.json` + Sentinel QOF | Yes |
| **System kept current vs BNF / NICE / MHRA** | `shared/rule-currency.js` + **The Keeper** (dated rule provenance) | **Yes — distinctive** (evidences a *maintained* safety system) |
| Demand / capacity / activity oversight ("use data to run the practice") | **Practice Report (Condor)** — already built | Yes |
| Valproate pregnancy-prevention (PPP) tracking | not a dedicated rule yet | **Gap / candidate** |
| MHRA / CAS / National Patient Safety Alert response log | **none** | **Gap / candidate feature** |
| Significant events / LFPSE, training, IPC, safeguarding policies | n/a (process evidence, not EPR-derivable by this tool) | Out of scope — say so |

**Distinctive strength:** the suite's **rule-currency + The Keeper** story is itself
strong CQC evidence — it shows the monitoring rule-set is actively maintained against
BNF/NICE/MHRA with dated provenance. Most practices struggle to evidence "our safety
checks are up to date"; the suite already times-stamps exactly that.

## 4. Proposed deliverable

A **"CQC Evidence Pack" generator** — a new printable report (sibling to the Practice
Report, reusing its print + credibility plumbing), organised **by quality statement**,
producing the Processes + Outcomes evidence the suite can derive. It opens with the
honest-bounds disclaimer and a coverage map (which quality statements it touches and which
it deliberately doesn't).

**Mandatory credibility features on every figure (from the format research — these are
what make an inspector trust an auto-generated document):**
- **"As at HH:MM, DD/MM/YYYY"** snapshot stamp (the suite already does this).
- **Source + rule-set versions/dates** — "from Medicus, drug rules v…, QOF 2026/27,
  evaluated …" (the rule-currency footer already exists — reuse it).
- **Cohort / inclusion definition per figure** — so an inspector can *reproduce* the
  search ("patients with an active methotrexate prescription; last FBC > 3 months ago").
- **Suite + report version**, and a **named owner / sign-off** field.
- **Explicit limitations + the "supporting evidence, not proof" line**, plus a
  data-quality caveat (it reflects *coded* Medicus data only).

**What it must NOT do:** claim compliance; claim completeness; replace the four human
evidence categories; present a number without its cohort + date. (Same discipline as the
Practice Report's "omit what you can't derive" + the staff aggregate-only rule.)

## 5. The make-or-break feasibility question

CQC's strongest medicines evidence is **practice-level Outcomes**: "N patients on lithium,
X with an in-date level, Y overdue." Sentinel today evaluates monitoring **per open
patient**. A pack needs the **cohort roll-up** — enumerate *all* patients on drug X and
their monitoring status **without opening each record**. Whether that is possible depends
on whether Medicus exposes a **searchable cohort / population endpoint** the extension can
read (read-only). This is the same class of problem as the referrals headless-discovery
spike, and it determines the ceiling:
- **If cohort search is reachable:** the pack can carry the headline Outcomes counts
  (high-value, the PINCER/monitoring numbers inspectors want).
- **If not:** the pack is limited to **Processes + rule-currency + operational-governance**
  evidence (still genuinely useful and honest, but not the population counts) — plus
  whatever per-patient evidence a clinician generates by opening records.

**Recommendation: a short feasibility spike on cohort enumeration first** — it decides the
whole shape. Do not promise population counts until that's confirmed.

## 6. Suggested phasing

- **P0 — feasibility spike:** can the extension enumerate "all patients on drug X + last
  monitoring date" from Medicus read-only? (Gates everything below.)
- **P1 — Processes + currency pack (no cohort dependency, high trust):** rule-currency /
  Keeper provenance, the rule-set the practice runs, the Safety-Monitoring categories, and
  the operational-governance section (reuse the Practice Report). Credibility-stamped,
  by-quality-statement. Shippable regardless of P0.
- **P2 — Outcomes counts (if P0 succeeds):** high-risk drug monitoring roll-ups
  (lithium/DMARD/amiodarone/anticoag in-date vs overdue), QOF achievement.
- **P3 — hazardous-prescribing + polypharmacy counts:** PINCER 13, ACB high-burden cohort,
  STOPP/START candidates (aggregate the existing per-patient engines).
- **P4 — new clinical features (route via The Keeper):** valproate PPP tracking; an
  MHRA/CAS/NPSA **alert-response log** (received → disseminated → actioned, dated) — the
  one clear net-new capability CQC explicitly wants and the suite lacks.

## 7. Bottom line

Worth building, and it plays to the suite's strengths (Sentinel monitoring + dated
rule-currency + the Practice Report's report engine). The intellectually honest framing —
"strong Processes & Outcomes evidence for the Safe and Well-led ends, to slot into your
wider pack; supporting evidence, never proof" — is also the *defensible* one. The cohort-
enumeration spike (§5) is the first thing to settle; clinical-rule additions go through
The Keeper.
