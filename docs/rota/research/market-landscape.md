# Research: rota software market landscape

*Web research, 2026-06-10. Focus: UK general practice. Sources: vendor sites, Capterra/G2 reviews,
G-Cloud listings, Digital Health News, NHS England.*

## The field

- **GP-native tier**: RotaMaster (the incumbent; 25+ yrs, rule-driven auto-fill, full HR/payroll,
  but reviews flag a **clunky interface** and slow support; no EHR integration; opaque pricing).
  Lantum (rota + 30k-clinician locum marketplace + staff bank, pension forms automated; ~10%
  marketplace fee breeds resentment; no EHR integration). **Tempo by GPnetworks** — the only
  product found that round-trips rota designs with a clinical system, but **SystmOne-only and
  batch**, small vendor. Niche: Surgery Rota, GPRota, Rotify, Practice Buddy, Practice Index
  Rotas, Agilio iTeam.
- **NHS secondary-care tier**: RLDatix/Allocate Optima (enterprise gold standard; the BMA had to
  force corrections of LTFT pay errors in eRota — rota-derived pay must be auditable), Patchwork
  Health (launched **AI preference-based rostering** Feb 2026; trial cut unfilled shifts 97%),
  Locum's Nest (collaborative banks, has entered primary care at federation scale).
- **Generic SMB tier**: RotaCloud (best-in-class ease of use, "live in a day", ~£1/emp/mo; weak
  reporting/integrations), Deputy (good AI scheduling + mobile), Rotageek (ML demand forecasting
  in 15-min increments — the demand-led UX pattern to copy), When I Work, Sling, Planday. None
  speak GP (no sessions, duty doctor, study leave, pension forms) — instant disqualification.

## The market's biggest hole

**Nobody connects the staff rota to the GP appointment book live.** EMIS/SystmOne session
templates are rebuilt by hand to mirror the external rota (double-keying). Slot-consuming
integrations (Accurx, Anima, GP Connect bookers) only read slots, with up to 1-hour latency.
Tempo's SystmOne batch import is the only partial precedent. Medicus itself is FHIR-first,
"APIs open by default", with an integration-partner posture and **no rostering product of its
own** — the gap this product fills.

## Ten features that would make a new Medicus-native rota manager clearly best

1. Live two-way appointment-book sync (v1 ships read + diff; write-back is the v2 moat)
2. Demand-driven session planning from real Medicus appointment/task history
3. Capacity-vs-demand conflict engine (leave approval shows patient-facing impact)
4. One-click gap-to-locum pipeline
5. AI auto-rota honouring preference + equity rules
6. GP-native leave management incl. rebooking assistance on sickness
7. Sessional finance: timesheets verified against actual EHR activity, pension forms
8. Self-service staff app showing the clinician's real clinic list
9. PCN/multi-site federation view (enhanced-access cover)
10. Continuity & safe-staffing analytics competitors can't reach

## Pain points to avoid (kept as product principles)

- Double-keying into the appointment book — the moat; never ship a feature that adds keystrokes.
- Clunky UI (RotaMaster's #1 complaint) — RotaCloud's "live in a day" is the usability bar.
- Opaque pricing, feature-gated essentials, transactional locum fees.
- Unreliable notifications/slow mobile; batch/laggy sync — "live" is the headline differentiator.
- Pay/compliance calculation errors (Allocate eRota saga) — anything money-adjacent must be
  auditable.
