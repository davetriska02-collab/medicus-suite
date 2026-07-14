# The Practice — whole-suite DREAM-FEATURE panel — 2026-07-07

> **This panel is synthetic.** Every reaction below is from a structured
> fictional persona, not a real clinician, and none of it is user research.
> It is a heuristic device for surfacing feature wants cheaply. No line here
> is evidence that "a GP asked for X". **Method note:** unlike the standard
> appraisal runs, this run briefed each persona on the suite's full v3.159.0
> capability set in text (so they wish _beyond_ what exists rather than
> re-asking for shipped features) instead of re-rendering all screenshots —
> the lens here is blue-sky wants, not pixels. Technophobe/plain-language
> bands ran on haiku; domain/power bands on sonnet. Full 10-persona roster,
> one subagent each, no cross-talk.

Scope: **whole suite**, lens: **dream features** (per Dave's ask: "what's
their dream feature list"). Diffs against the 2026-07-03 wishlist run
(`PRACTICE-wishlist-whole-suite-2026-07-03.md`, v3.151.0) — since which the
Signing Queue (that run's item #17), the renal join slice of #18, the W1/W2
plain-English Sweep slices, the leaflet joins and the demand-undercount fix
have all shipped.

---

## 1 · Verdict

**The panel has moved from "show me my work" to "remember my work".** With
the day's visible piles now instrumented (queue, signing, sweep, demand), the
dominant dream across seven of ten personas is memory and loop-closure: the
suite should hold the IOUs every role currently carries in their head or on
paper — the GP's "chase if no result by Friday", the nurse's lost blood tube,
the locum's handover, the pharmacist's taper plan, the secretary's "ring Mrs
Patel Thursday" — and surface the broken chains by name. The second
convergent front is a **new modality: documents** — the two highest-clinical-
value personas independently made letters/discharge summaries their #1 (Tom's
Letter Lens, Raj's Discharge Delta), and it is the strongest patient-safety
case on the sheet (post-discharge med rec is where the real harm lives). The
third is **history**: now that the day-ledger exists, every analytic persona
wants baselines ("95th percentile of the last 8 Mondays"), trajectories (QOF
runway to 31 March in £), and evidence (rota vs actual demand). Notably, the
2026-07-03 top ask (project alerts onto today's list) barely re-appeared —
because it shipped. The panel's wants are getting structurally harder — more
substrate, more scoping — which is itself evidence the easy value is landing.

---

## 2 · The panel and their headline dream

| #   | Handle             | Role                | Band              | #1 dream (their words, compressed)                                       |
| --- | ------------------ | ------------------- | ----------------- | ------------------------------------------------------------------------ |
| 1   | Dr Margaret Aldous | Senior partner      | technophobe       | Handover Brief at 4:45pm — what's hanging, in 90 seconds                 |
| 2   | Maureen Castle     | Medical secretary   | technophobe       | Hospital status feed per referral (stop ringing Nottingham)              |
| 3   | Sister Eileen Cobb | Practice nurse      | reluctant         | The Not-Booked List — overdue patients with NO future appointment, named |
| 4   | Chloe Danvers      | Receptionist        | savvy-consumer    | "What did they mean?" plain-English explainer on calls                   |
| 5   | Dr Tom Hollis      | Salaried GP         | pragmatist        | Letter Lens — the 6pm Docman pile, diffed against the record             |
| 6   | Dr Sam Okonkwo     | Locum               | pragmatist        | Cold Start Card — functional in 10 minutes at a strange practice         |
| 7   | Dr Priya Nair      | Registrar           | savvy             | "Why did that fire?" — every alert expandable to its guideline           |
| 8   | Janet Briggs       | Practice manager    | reluctant-capable | QOF Runway — trajectory to year-end, "43 more patients by January"       |
| 9   | Raj Patel          | Clinical pharmacist | savvy + domain    | Discharge Delta — discharge meds diffed against the repeat list          |
| 10  | Dr Geoff Pellew    | Partner / tinkerer  | power user        | The Workbench — query builder over everything the suite sees             |

---

## 3 · The dream list, synthesised

### D1 · The IOU Ledger — one loop-closure primitive, many faces

_Converged on by 7 of 10 personas (1, 2, 3, 5, 6, 8-adjacent, 9) — the
strongest convergence any run has produced._
One local, UUID-keyed store of "things awaited": what, for whom, expected by
when, raised from one keypress or an existing action (recall raised, bloods
taken, referral chased, taper agreed). Never written to the record; surfaced
when the linked thing happens **or the date passes with nothing** — the
broken chain is the product. The faces per role, all the same primitive:

- **GP safety-net ledger** (Tom): "MSU pending, chase Friday" logged with one
  key mid-consultation, resurfacing in Today when the result lands or the
  date lapses.
- **Nurse loop-closer** (Eileen): sample taken → result received → reviewed →
  patient told; every broken chain by name, Friday reckoning view.
- **Deprescribing ledger** (Raj): intended taper steps with due dates,
  chipped when the patient next appears anywhere.
- **Day-end handover brief** (Margaret, Sam): what's still hanging at 4:45pm,
  drafted for the duty doctor / the locum's handover email — prepare-only,
  copy-paste, never sent.
- **Call-notes sticky + callback prompt** (Maureen): "rang, promised
  Thursday" pinned to the referral.
  Safety framing: display-and-reminder only; a lapsed IOU is an amber prompt,
  never an auto-action. Needs a hazard-log entry (over-trust: "the suite will
  remind me" must never replace recording in Medicus — every face carries the
  honest-state line). Substrate exists (event-ledger, storage, resolved UUIDs).
  **Size: XL as a programme, but the primitive itself is M and each face is
  S–M on top of it. This is the panel's clear #1.**

### D2 · The documents modality — Letter Lens / Discharge Delta

_Tom #1, Raj #1, Maureen #3 — and the sheet's biggest patient-safety claim._
When a clinic letter / discharge summary is open in Medicus, parse what
Medicus itself displays and diff it against the current record: STARTED /
STOPPED / DOSE-CHANGED / UNMATCHED (flag loudest, never guess), plus "GP to
arrange" actions as chips with one-click task creation. Post-discharge med
rec is the classic harm surface (duplicated anticoagulation, hospital-stopped
drug re-issued); Tom prices the letters pile at ~20 min/day. **Blocked on
scoping**: what the documents view exposes in DOM/API is unknown — same
verdict as 07-03's item #20, but it has now graduated from one persona's #5
to two personas' #1. Scope it next; if the meds section is machine-readable,
this is the flagship build of the next cycle. Clinical surface → hazard log +
CSO review; UNMATCHED must fail loud, and the diff never auto-updates
anything. **Size: XL, scoping first.**

### D3 · Memory & baselines — the analytics grow a history

_Geoff #2/#1, Janet #1/#2/#3, echoes of 07-03's W3 (third run running)._

- **Baselines & Bands** (Geoff): every displayed metric gets a rolling
  same-weekday baseline and a tunable band; strips say "14 waiting — 90th
  percentile for a Tuesday 10am". The submissions day-ledger (shipped
  v3.153.0) is exactly the substrate; extend the pattern to WR/slots/
  pressure. **M–L, high leverage, no new safety surface.**
- **QOF Runway** (Janet): standing QOF position with trajectory — "at
  current recall rate, hypertension lands at 71%; 43 more patients by
  January". Needs register-level denominators (see D4 scoping) plus the £
  projection already ruled feasible on 07-03. Janet's poison test applies:
  every figure reconcilable or the tool dies. **L–XL.**
- **Rota vs Reality** (Janet): capacity calendar overlaid with actual
  demand+activity per weekday — "Thursdays carry 22% more demand than
  capacity". Data all exists in-suite. **M–L.**
- **Partners' Pack builder** (Janet): a fourth Practice Report audience
  (partners' meeting) with consistent period boundaries and labelled paste-in
  slots. **M.**

### D4 · Whole-register sweeps — from booked lists to cohorts

_Eileen #1 (Not-Booked List), #4 (Campaign Board); Raj #5 (Audit Loom);
feeds Janet's QOF Runway._
The Sweep checks people who booked; the nurse's terror is the patient who
didn't. Sweep the register/cohort and name every patient overdue with **no
future appointment**; same engine, different denominator. The Campaign Board
(flu/COVID cohort, one column per state, live countdown) and Raj's standing
audit denominators (PINCER indicators, shared-care without agreement,
long-term opioids without review) are the same capability pointed at
different cohorts. **Gate: can the extension enumerate a register/cohort
from what Medicus exposes?** Unknown — needs endpoint scoping before any of
D4/QOF-Runway is promised. If enumeration isn't reachable, an honest partial
exists: accumulate cohorts opportunistically from records touched (Raj's
"surveillance not archaeology" framing accepts this explicitly). **Scoping
task: S. Build: XL.**

### D5 · Rule transparency — "why did that fire?" + test bench

_Priya #1, Eileen #5 ("Chapter and Verse"), Geoff #3 — three bands, same
want: trust through traceability._

- Every chip gets an expandable "workings" view: the rule clause that
  matched, the source guideline reference, the actual dates/values — "BNF:
  lithium levels 3-monthly; her last level 4 March; that's 17 weeks".
  Rules already carry the data; this is presentational. Eileen's framing is
  the safety case: an untraceable alert gets obeyed blindly or ignored
  quietly, both dangerous. **M, high trust-yield, no new clinical logic.**
- **Rule Test Bench** (Geoff): dry-run any authored rule against today's
  list (and any held history) before enabling — match count, matching rows,
  which clause tripped. Kills both the fires-on-forty problem and the
  silent-miss problem at authoring time. **M–L; pairs naturally with the
  existing custom alert builder.**

### D6 · The trainee layer — a genuine market differentiator

_Priya's whole sheet; nothing else on the market attempts trainee-shaped
output._
Debrief Builder (anonymised end-of-surgery sheet: what fired, what wasn't
actioned — shown to the trainee first), Portfolio Harvest (identifier-free
learning-event log tagged to RCGP capabilities), QIP Workbench (baseline/
re-audit from any rule — overlaps Geoff's Workbench and Raj's Audit Loom).
Identifier-free **by design, enforced at the data layer** (slot numbers, no
names/DOBs/NHS numbers), or not built. The Debrief Builder doubles as every
new-starter's safety net, not just trainees'. **L each; the "why did that
fire" layer (D5) is its prerequisite and first slice.**

### D7 · Locum cold-start

_Sam #1 (Cold Start Card), #4 (Ask-Box) — sharpened from 07-03's locum brief._
One panel screen, minute one at a strange practice: duty doctor, team,
pharmacy arrangements, how THIS practice does 2WW/DVT/same-day-paeds, and —
the honest part — "UNKNOWN, ask reception" for whatever the practice never
filled in. Knowledge-base extension plus a first-run detector; the Ask-Box is
Knowledge search given a keyboard shortcut and an honest empty state. The
Locum Ledger and Handover Forge are D1 faces. **M.**

### D8 · Signing Queue: beyond monitoring

_Tom #4 (anomaly flags), Margaret #3 (cross-med warning at signing), Raj #2
(Shared-Care Sentinel), #3 (sick-day cluster)._
The queue ranks by monitoring currency; the personas want the other reasons a
script needs a record-open surfaced the same way: early request (days-early
chip), quantity mismatch vs last issue, item not on repeat, synced-batch
hint; drug-combination rule hits (engine already evaluates them — they're
filtered out of signing verdicts today); shared-care governance currency (is
there an agreement coded, a specialist letter in date — the "orphaned DMARD"
that ends at an inquest); and the AKI cluster fired by an acute NSAID request
landing on top of ACEi+diuretic. Combination/shared-care/cluster chips are
clinical surfaces → `the-keeper` + CSO + hazard-log (H-038 extension);
early/quantity flags are workflow, not clinical. **M–L in slices; highest
near-term clinical value after D2.**

### D9 · Front-desk within doctrine

_Chloe #1–#5, constrained hard by intended purpose (the suite never triages,
never gives clinical advice)._
Adoptable shapes: **drug/condition → NHS leaflet join** on the open call
("what's atrial fibrillation" → the NHS page, read verbatim — Tier 1 leaflet
search already holds the index); **sick-note and common-request templates**
as Knowledge starter-pack content; **repeat-caller context** (recent task
history for the open patient — data the suite already sees); booking-keyword
nudges only as pointers to the existing practice-approved pathway scripts,
never free-standing urgency judgements. The side-effect checker as asked
("is a headache normal on this tablet?") is clinical advice and is **not
adoptable** beyond signposting to the leaflet. **S–M each.**

### Magic wands (recorded, not planned)

Every persona's wand breaks the same two walls, which is worth recording as
market intel: **cross-organisation truth** (hospital status feeds, community
pharmacy PMR, "what happened elsewhere" — Maureen, Eileen, Raj) and
**off-machine agency** (email me after hours, send the handover, a local API
/ headless runs — Margaret, Sam, Geoff, Tom's ambient scribe). The first is
the NHS interoperability frontier, not an extension feature; the second is
the known P7 wall. Geoff's **Scheduled Drops** is the one wand fragment that
IS feasible (persistent directory handle, browser-open hours only) and is
adopted into D3's orbit.

---

## 4 · Prioritised path (dream → plan)

**Scope first (S, do immediately — they gate the two biggest builds):**

1. Documents-view scoping: what do letters/discharge summaries expose in
   DOM/API? Gates D2. (One live-Medicus probe session with Dave.)
2. Register/cohort enumeration scoping: gates D4 + QOF Runway.

**Quick wins (S–M):** 3. 2WW countdown framing on the safety-net worklist (Maureen — presentational
over existing watch/overdue thresholds). 4. Drug/condition → leaflet join for reception calls (Chloe; Tier-1 index
exists). 5. Sick-note / common-request templates in the Knowledge starter pack (Chloe). 6. "Why did that fire?" workings view on drug-monitoring chips (D5 slice one;
Eileen/Priya/Geoff).

**The next flagship (pick one, M–XL):** 7. **D1 IOU Ledger** — primitive + GP safety-net face + day-end brief face
first (Tom, Margaret, Sam); nurse loop-closer needs result-linkage design. 8. **D2 Letter Lens / Discharge Delta** — if scoping says yes, this
outranks everything on patient-safety and is Raj's + Tom's shared #1. 9. **D8 Signing slices** — early-request + quantity flags (workflow) first;
combination/shared-care chips behind CSO review.

**Substrate growth (M–L, steady):** 10. Baselines & Bands over the day-ledger (Geoff #2 — his evangelism pick,
"turns every rota argument into data"). 11. Rota vs Reality + Partners' Pack audience (Janet). 12. Rule Test Bench in the alert builder (Geoff #3). 13. Locum Cold Start Card (Sam; Knowledge extension).

**Differentiators (L–XL, choose deliberately):** 14. Trainee layer (Priya) — no competitor attempts it; D5 is its first slice. 15. QOF Runway (Janet's evangelism pick) — behind scoping task #2. 16. Audit Loom / Workbench / QIP Workbench — one query-and-cohort engine
wearing three hats (Geoff, Raj, Priya); design once.

---

## 5 · Judgement calls & constraint rulings

- **Chloe's side-effect checker: overruled** as asked — answering "is this
  symptom normal on this drug" is clinical advice, outside the frozen
  intended-purpose statement. Adopted only as leaflet signposting. Reverse
  by: revising INTENDED-PURPOSE.md through clinical-safety review (not
  recommended).
- **Chloe's booking keyword flag: adapted** — never a free-standing urgency
  judgement; only a pointer into the existing manager-signed pathway scripts.
- **Maureen's Hospital Status Feed: recorded as wand-class** — hospital-side
  data isn't in Medicus; nothing local can conjure it. The countdown badge
  (#2) is the adoptable fragment.
- **Margaret's pharmacist→GP flag: adapted** — the suite has no cross-seat
  channel (P7); the existing create-task flow through Medicus IS the channel.
  The residual ask is a "questions for me" filtered view of tasks: note for
  Today-tab scoping.
- **Margaret's cross-med warning at signing / Raj's cluster+shared-care
  chips: adopted into D8 but explicitly gated** on `the-keeper` + CSO + H-038
  extension — combination logic exists in the engine; SURFACING it in a
  signing context changes its hazard profile (automation bias at the moment
  of authorisation).
- **All off-machine wands (email, auto-send, headless, local API): held at
  the P7 wall**, except Scheduled Drops (feasible, adopted into D3 orbit).
- **D1 over-trust hazard named now**: an IOU ledger that clinicians treat as
  the safety-net system becomes a single point of failure the suite never
  claimed to be. Every face ships with the honest-state line and a
  hazard-log entry before build.
- **Clinical-safety salience:** nothing recommended quieter; no feature
  recommended for deletion.

---

## 6 · Reproduce

- **Method:** full 10-persona roster, one subagent each, no cross-talk;
  bands 1/2/4 on haiku, rest on sonnet. Each briefed with a v3.159.0
  capability summary + the standing hard limits, and asked for: day pains,
  5 ranked dream features, one magic wand, one evangelism pick. No
  screenshots this run (wishlist lens, not pixels) — deviation noted in the
  header.
- **Diffed against:** `PRACTICE-wishlist-whole-suite-2026-07-03.md`. Shipped
  since and correctly absent from this run's asks: Signing Queue (+eGFR,
  +collection flags), Sweep plain-English + named skips, open-patient status
  from any tab, leaflet joins, demand-undercount ledger, Monitoring
  create-task. Recurring third-run+ theme: history/baselines (W3 → D3).
- **Next runs can diff against:** the D1–D9 labels above.
