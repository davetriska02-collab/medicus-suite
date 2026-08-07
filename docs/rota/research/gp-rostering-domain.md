# Research: how rotas actually work in UK general practice

*Web research, 2026-06-10. Key sources: BMA salaried GP model contract & safe-working guidance,
NHS England Enhanced Access DES FAQs, CQC Regulation 18, RCGP/deanery supervision guidance,
Practice Index, GP World, Bradford VTS, Wessex LMCs.*

## Structure of GP work

- **The session is the atomic unit** (~4h10m; BMA model contract: 37.5h FT = 9 nominal sessions;
  everyday usage: full-time = 8 sessions = 4 days). Model `contractedSessions` per person, never a
  global constant. Most GPs are part-time (4–6 sessions).
- Of a session, ≤3h should be patient-facing (BMA safe working) ⇒ ~18×10-min or 12×15-min
  appointments; BMA recommends ≤25 patient contacts per GP per day (widely exceeded; soft warning).
- Session activity types: routine surgery, telephone/triage, **duty doctor (on-call)**, home
  visits, admin, CPD, tutorial/supervision, meetings, enhanced access.
- **Duty doctor**: one per AM and PM session is the norm; allocation fairness convention is
  **pro-rata to sessions worked**. BMA recommends capping the duty list at calculated capacity.
- Core hours 8:00–18:30 Mon–Fri. Enhanced Access DES: 60 min appointments /1,000 patients/week,
  18:30–20:00 weekdays + Sat 9–5, **a GP physically present at one practice in the PCN
  throughout** — a cross-practice rota dimension.
- Employment types differ materially: partners (deed-governed), salaried (BMA model contract
  mandatory in GMS), locums (per-session, own T&Cs, **cannot supervise trainees**), registrars
  (40h/10 nominal sessions FT, ~70/30 clinical/educational, immovable VTS half-day, appointment
  lengths taper ST1→ST3).

## Supervision = first-class rostering constraint

- **Registrars**: named clinical supervisor on the timetable **every clinical session**, physically
  on site, partner or regular salaried GP (never a locum). Debrief time is real (≈20–30 min per
  surgery).
- **HCAs**: supervising registered professional must be in the building for delegated procedures.
- ANPs are autonomous — documented supervision arrangement, not per-session (don't hard-require).
- ARRS roles each carry defined supervision (pharmacists, FCPs, PAs with named supervising GP).

## Leave

- Salaried GPs: **6 weeks AL** + ~1 week study + 4h/week CPD (BMA model contract); registrars
  27/32 days + up to 30 days study; partners per deed.
- **Count leave in sessions** — the BMA publishes a calculator because day-counting breaks for
  part-timers. Leave year April–March.
- Common local policy: max N same-role staff off simultaneously; seasonal caps (≤4 wks school
  holidays, ≤1 wk Christmas/Easter, ≤2 wks summer per person). Policy, not law → settings.
- **Sickness**: SFE locum reimbursement kicks in after 2 weeks (≈£2,152/wk cap from Apr 2025, max
  52 wks) — tracking episode length has direct cash value.

## Compliance

- CQC Reg 18: "sufficient suitably qualified staff at all times" — no fixed ratio; practices must
  evidence their own safe-staffing logic (a rota tool can generate that evidence).
- Working Time Regulations for employed staff. "Last man standing" risk: warn when duty burden
  concentrates on one or two partners.

## Today's workflow (the pain)

- Excel grids maintained by the practice manager, separate from leave records.
- **Rota and appointment book are kept in sync by hand** — classic failures: rota says Dr X is in
  but no clinic built (lost capacity); clinic built for someone on leave (ghost clinic, mass
  rebooking). This is the #1 acknowledged daily pain point.
- Same-day sickness scramble: check duty cover → redistribute patients → phone locums → edit the
  appointment book. Entirely manual.

## Heuristics for semi-automation

- Most clinicians have fixed weekly patterns; practices run 1/2/4-week repeating templates.
- Demand: **Monday ~60–70% busier than Wed–Fri**, Tuesday ~30% (NHSE capacity-alignment guidance).
- Access benchmark: **~72 GP-type appointments per 1,000 patients per week**.
- The five highest-value semi-automations (all implemented or roadmapped here):
  template roll-forward with leave punch-out · leave-request guardrails · fair duty auto-assign ·
  **rota↔appointment-book diff** · sickness-day cover assistant.
