# Product plan — Medicus Rota Manager

*Written 2026-06-10, after a three-stream research phase (see docs/research/). This plan was
executed for v1.0.0; later sections are the roadmap.*

## Positioning

The rota market's defining failure is that **the rota and the clinical-system appointment book are
two systems kept in sync by hand**. RotaMaster, Lantum, RotaCloud, Rotageek and Patchwork have no
GP appointment-book integration at all; Tempo (the lone exception) does a batch import into
SystmOne only. Medicus is cloud-native and API-first, and the Medicus Suite proved the appointment
book is cleanly readable per clinician per day. **A rota manager that knows what the appointment
book actually says — live — wins the category.**

Form factor: Chrome MV3 extension (full-tab app). Chosen over a desktop product because Medicus
API access rides the user's logged-in browser session — the extension inherits authentication,
needs no server, stores no patient data, and reuses the Medicus Suite's proven conventions.

## v1.0.0 (shipped)

1. Staff registry with GP-domain contracts: roles (incl. ARRS), employment types
   (partner/salaried/registrar/locum), contracted sessions, duty/supervisor/prescriber flags,
   session-based leave entitlements, Medicus display-name mapping.
2. Repeating week-pattern templates + roll-forward generation with leave punch-out.
3. Week rota grid with inline editing and colour-coded session types.
4. Leave workflow: request → guardrails (balance, simultaneous caps, duty impact) → approve →
   cover worklist; SFE week-3 sickness flags.
5. Rules engine: duty cover, registrar supervision, HCA cover, capacity benchmark, duty fairness.
6. Fair duty auto-assignment.
7. Live reconciliation vs the Medicus appointment book + clinician import.
8. Dashboard, settings, backup envelope, demo dataset, full engine test suite.

## v1.x — near-term

- **Cover pipeline**: vacancy → ranked internal options (contracted-but-not-rostered staff, recent
  locums) → mark covered with named person; locum session log for invoicing/pension Form A.
- **Sickness-day assistant**: mark someone sick today → show broken constraints (duty? supervisor?
  capacity?) → ranked cover options → start the SFE clock.
- **Bank holidays + seasonal leave caps** (school-holiday/Christmas rules from BMA guidance).
- **Multi-site / PCN dimension** on entries; enhanced-access "GP physically present across the
  PCN" rule.
- **Registrar niceties**: immovable VTS half-day, auto-attached debrief time on the supervisor's
  session, stage-dependent capacity weighting.
- Icons, options page, Chrome Web Store packaging workflow.

## v2 — the moats deepen

- **Write-back**: create/cancel session templates in the Medicus appointment book from the rota
  (requires partnering with Medicus — they are "APIs open by default" with an integration
  ecosystem; no public self-serve portal yet). This turns reconciliation into true two-way sync.
- **Demand-driven planning**: forecast demand by day/hour from the practice's own appointment and
  task history (the Suite's activity/task endpoints), propose session mixes; Monday is ~60–70%
  busier than Friday — surface that.
- **Workload-aware fairness**: blend the activity report (consultations, scripts, results per
  clinician) into duty/extra-session allocation.
- **Staff self-service** (separate lightweight surface): swaps, leave requests, "my week" with
  actual clinic list.
- Payroll/timesheet export; NHS pension forms (Type 2 / locum A&B).

## Non-goals (for now)

- Patient-facing anything. No patient data persistence, ever.
- Locum marketplace (Lantum's transactional-fee model breeds resentment; we integrate, not
  intermediate).
- Secondary-care junior-doctor contract compliance (Allocate/Patchwork territory).
