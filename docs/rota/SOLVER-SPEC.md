# Auto-rota solver — specification (v2)

## Scope and philosophy

The solver optimises **session-type assignment over a fixed presence matrix**. It never moves
anyone's working days (those are contractual); it decides what people do in the slots they
already work. Primary job: multi-week, fair, site-aware **duty-doctor allocation**, plus
registrar VTS protection and rebalancing of over-assigned duty. **v2** adds three dimensions:
**enhanced-access allocation**, **avoid-duty as an explicit last resort**, and **room-aware
moves**. It is an *advisor*: it returns a change-set and diagnostics; the UI previews and the
user applies (undoably) or discards.

Supervision gaps depend on **presence**, not types, so the solver cannot fix them — it must
report them in `unresolved` rather than silently ignore them. The same is true of the
"a GP must be physically present throughout the EA period" rule.

## Engine API — `engine/solver.js`

Pure module: no DOM, no `chrome.*`, no `fetch` (importable in node). May import from
`shared/time.js`, `shared/model.js`, `engine/leave.js`, `engine/rules.js`.

```js
export const DEFAULT_WEIGHTS = {
  dutyGap: 1000,   // per missing duty doctor per slot(/site)
  vts: 400,        // per registrar clinical session on their VTS half-day
  fairness: 2000,  // × sum of squared deviations of duty share from the mean
  sameDay: 60,     // per person with duty AM and PM on the same date
  weeklyCap: 80,   // per duty session over options.maxDutyPerWeek, per person per week
  locumDuty: 40,   // per duty session given to a locum (prefer employed GPs)
  preference: 30,  // per duty session on a slot in that person's staff.avoidDuty
  churn: 1,        // per entry whose final type differs from its original type
  eaGap: 300,      // v2 — per HOUR of enhanced-access shortfall vs the DES target, per week
  roomClash: 150   // v2 — per surplus session sharing one room in one slot
};

export function solveRota({
  dates,            // contiguous YYYY-MM-DD array, multiple whole weeks (Mon-aligned)
  entries,          // ALL entries (solver filters to horizon itself)
  staff, leaveList, settings,
  rooms = [],                     // v2 — [{ id, name }] from state.rooms; enables room repair
  historyEntries = [],            // entries before the horizon, for duty-debt fairness
  options = {}                    // { maxDutyPerWeek=2, iterations=8000, seed=1, weights }
})
// returns:
// {
//   changes: [{ entryId, staffId, date, period, from, to }], // final != original only
//   score: { before, after },
//   breakdown: { dutyGap, vts, fairness, sameDay, weeklyCap, locumDuty, preference, churn,
//                ea, rooms },                 // AFTER values; after === Σ breakdown
//   unresolved: [{ kind, message }],          // kind: duty | ea | preference | room |
//                                             //       supervision | enhanced
//   iterations,
//   roomChanges: [{ entryId, staffId, date, period, from, to }],  // v2 — roomId moves
//   explain: [{ key, label, weight, measure, unit, score }]       // v2 — per-dimension
// }
```

`changes` / `score` / `breakdown` / `unresolved` / `iterations` are unchanged from v1 —
`roomChanges` and `explain` are additive, and `breakdown` only gains keys. A practice with no
extended periods and no rooms scores exactly as it did in v1 (the two new terms are 0 and the
move ladder is byte-for-byte v1's), so the same seed reproduces the same rota.

## Definitions

- **Slot** = (date, period, site). Sites = `settings.sites` (length > 1 ⇒ per-site duty,
  person's site = `staff.site || sites[0]`); otherwise one virtual site.
- **Open slot**: `dayKey(date)` ∈ `settings.openDays` and date ∉ `settings.bankHolidays`.
- **Duty-eligible**: `person.role === 'gp' && person.dutyEligible`, not on approved leave that
  date (`approvedLeaveFor`), and present (has a flexible or locked active entry in the slot).
- **Locked entry** (never modified): status ∈ {vacancy, covered, cancelled}, or
  source === 'manual', or status === 'confirmed'. Locked duty entries still COUNT toward
  coverage and fairness, and locked sessions still occupy their room.
- **Flexible entry**: in horizon, status 'planned', source ∈ {template, auto-duty, solver, cover}.
- **EA-capable entry** (v2): a flexible entry in an **enabled** extended period
  (`settings.extraPeriods.early` / `.eve`), whose person is a clinician (role group ≠
  `nonclinical`, never a `notAPerson` directory lane) and not on leave that date.
- **Allowed types** for a flexible entry (original type = its typeId at solve start):
  - registrar with `vtsDay === \`${dayKey(date)}-${period}\`` and original type clinical
    ⇒ exactly `['tutorial']` (forced fix, applied in the initial solution);
  - else `[originalType]`, plus `'duty'` if the person is duty-eligible, the period is
    **core AM/PM** (duty is a core-hours role — v2 tightened this) and originalType ∈
    {surgery, triage, duty}; an entry whose original type IS duty may also take the person's
    pattern type for that slot (via `templateWeekIndex`; fallback `'surgery'`) so excess duty
    can be reverted; plus `'enhanced'` (and the pattern revert type) if the entry is
    EA-capable.
- **Duty share** (fairness): for each duty-eligible GP with `contractedSessions > 0`:
  `(historyDutyCount + plannedDutyCount) / contractedSessions`. History = duty entries in
  `historyEntries` (status not vacancy/cancelled). Locums (contracted 0) are excluded from the
  fairness term; their duty costs `locumDuty` instead.
- **Room-occupying session** (v2): active status (planned/confirmed/covered), a `roomId`, and a
  type that is `clinical && buildsClinic` — surgery, triage, duty, enhanced. Home visits, admin,
  CPD, tutorial and meetings do not hold a room. Same rule as `engine/room-infer.js` `fillRooms`.
- **Room clash** (v2): two or more room-occupying sessions with the same `roomId` in the same
  (date, period).

## Score

`score = Σ weight × measure` per DEFAULT_WEIGHTS above; one `evaluate()` feeds both the
annealing loop and the reported `breakdown`, so the two cannot drift. dutyGap measure =
`max(0, required − dutyCount)` summed over open slots (and sites), where
`required = settings.dutyRequired[period]`. fairness measure = `Σ (share_i − mean)²`.
weeklyCap is assessed per Mon–Sun week within the horizon. Perfect score 0 short-circuits.

v2 measures:

- **ea** = minutes short of the Enhanced Access DES target, summed per Mon–Sun week:
  target = `round(listSize/1000 × 60)` minutes/week, delivered in the `early` (60 min) and
  `eve` (90 min) periods by an active clinical session whose owner is not on leave — the same
  definition as `rules.js` `eaSummary`, so the two always agree. Scored at `eaGap` per **hour**
  short, i.e. one missed evening session ≈ 450 vs 1000 for an uncovered duty slot: enough to
  make the solver reach for EA, never enough to buy it at the cost of duty cover. Warn-level by
  design — the DES is a commissioning expectation, not a rostering hard stop.
- **rooms** = surplus sessions per clashing room-slot (`count − 1`), scored at `roomClash`
  (above sameDay, well below dutyGap), so a move that puts two clinics in one room is
  discouraged but never blocks cover.

Only `extraPeriods` gates EA. `peakPeriods` is a *leave* cap (max counted-leave sessions per
person in a named period) and has no bearing on session-type assignment, so the solver does not
consult it.

## Algorithm

1. **Initial solution**: original types → apply forced VTS fixes → greedy duty fill (for each
   open slot with a gap, assign the present, eligible, flexible GP with the lowest duty share;
   ties break **toward someone who has not listed that slot in `avoidDuty`**, then by name) →
   greedy EA fill (each week short of the DES target takes flexible EA-capable sessions —
   GPs first, since the DES needs a GP physically present — in date/period order until the
   target is met or candidates run out).
2. **Simulated annealing** for `options.iterations`:
   - RNG: mulberry32(seed) — fully deterministic.
   - Temperature `T = 25 × (0.02)^(i/iterations)` (≈25 → 0.5).
   - Moves (probabilities): *fix-gap* (random gap slot → random eligible flexible entry →
     duty), *toggle* (random flexible GP entry: duty⇄revert), *transfer* (within one slot, swap
     types of a duty entry and a non-duty eligible entry), *enhanced-access* (random flexible
     EA-capable entry: enhanced⇄revert), *random* (random flexible entry → random allowed type).
     Bands are 40/25/20/—/15 with EA inactive (identical to v1) and 34/21/17/15/13 when the
     practice runs extended periods.
   - Accept if Δscore ≤ 0, else with probability `exp(−Δ/T)`.
   - Track and return the best solution seen.
3. **Room repair** (post-solve, deterministic): for each room-slot still clashing, keep one
   occupant — a locked session first (it cannot move), then whoever calls that room home, then
   the lowest entry id — and move the others into a free room: their `usualRoomId` if it is free,
   else the lowest-indexed free room (the `fillRooms` preference order). Each move is reported in
   `roomChanges`; locked entries are never moved. `breakdown.rooms` scores the proposal *as a
   whole* — types plus these reassignments.
4. **Diagnostics** (`unresolved`): remaining duty gaps ("no eligible GP present"); per-week EA
   shortfall with the minutes short; every surviving duty on an `avoidDuty` slot, saying whether
   it was taken because nobody else was available or as a last resort to keep cover/fairness;
   room clashes no free room could resolve; plus the presence-driven warnings passed through
   from `checkWeek` per week — `supervision` and `enhanced` (EA period running with no GP).

Score recomputation may be full (entry counts are small: ~15 staff × 10 slots × weeks); keep it
O(entries) per evaluation and this stays well under a second at 8k iterations. Leave lookups are
memoised once per (person, date) — they are static across the solve.

## UI — Rota page

- Toolbar gains **“Solve rota”** (primary, next to Auto-assign duty — keep both).
- Clicking toggles a panel card (`state.ui.solvePanel`) above the grid:
  - Options: horizon weeks select [1,2,4,8] default 4 (from the displayed week's Monday);
    max duty/week number (default 2); effort select quick=3000 / standard=8000 /
    thorough=20000 iterations.
  - Run → store result in `state.ui.solveResult`, rerender.
- Result rendering: score before → after; change count; table of changes (staff name, day,
  AM/PM, from-chip → to-chip via `typeChip`); `unresolved` rendered with `warnHTML`;
  **Apply** (primary) and **Discard** buttons.
- Apply: `pushUndo`, set each changed entry's `typeId` (+ `source: 'solver'`), persist,
  `ctx.log(...)` audit entry, toast, clear panel. Discard: clear `state.ui.solveResult`.
- History entries for fairness: 8 weeks before the horizon start (same as auto-duty).
- **Outstanding v2 UI work** (engine-side is shipped): pass `rooms: state.rooms` into
  `solveRota`, apply `roomChanges` alongside the type changes on Apply, and render `explain`
  as the "why this proposal" list. Until the UI applies `roomChanges`, room moves are advisory.

## Preferences

`staff.avoidDuty: string[]` of `'mon-am'`-style keys (default `[]`, add to `newStaff`).
Staff editor: a multi-select (Mon–Fri × AM/PM) labelled “Avoid duty on”. Avoid-duty is a
**last-resort ladder, not a veto**: the greedy fill breaks ties away from an avoided slot, the
`preference` penalty makes the annealer prefer any equally-good alternative, duty cover and
fairness still outrank it (30 vs 1000/2000), and anything that survives is named in
`unresolved` so a preference can never be violated silently.

## Tests — `test-rota-solver.js` (node:assert/strict, no framework)

1. Coverage: gaps filled when eligible GPs are present; never assigns nurses/registrars.
2. Locked entries (manual / covered / vacancy / confirmed) are never changed.
3. Fairness: two GPs, equal contracts, 4 duty slots ⇒ 2/2 split (seeded, deterministic).
   Pro-rata: 8-session vs 4-session GP over 6 duty slots ⇒ the 8-session GP takes more.
4. Excess duty: slot with 3 duty entries and required 1 ⇒ extras reverted to pattern type.
5. VTS: registrar clinical on their vtsDay becomes tutorial; appears in `changes`.
6. maxDutyPerWeek honoured when feasible; sameDay double duty avoided when an alternative
   exists.
7. avoidDuty preference respected when an equally fair alternative exists.
8. Bank holidays / closed days: no duty assigned, no gap counted.
9. Determinism: same seed ⇒ identical changes; different seed may differ but score(after) equal
   or comparable.
10. Unresolved: slot with no eligible GP reports a duty gap in `unresolved`.
11. EA happy path: an EVE admin session becomes `enhanced` and meets the target; the solver's
    EA measure is cross-checked against `rules.js` `eaSummary` on the applied rota.
12. EA shortfall: scored (`eaGap × hours`), reported in `explain` and `unresolved`, never
    blocking; nonclinical staff are never given an EA clinical session.
13. Avoid-duty: (a) the greedy fill alone (iterations 0) sends duty to the non-avoider even when
    the avoider sorts first by name; (b) with nobody else, duty is still assigned, penalised,
    and named in `unresolved` as a last resort.
14. Rooms: (a) an unresolvable clash is scored and reported with the room name; (b) with a free
    room, the movable session is moved (never the locked one) and the applied rota is clash-free;
    (c) EA allocation picks the non-clashing pair rather than relying on a room shuffle.
15. Determinism across the new dimensions: same seed ⇒ identical `changes`, `roomChanges`,
    `breakdown`, `explain` and `unresolved`.
16. Result shape: the v1 contract is intact, `Σ breakdown === score.after`, `explain` covers all
    ten dimensions and agrees with `breakdown`, and both v2 terms are inert for a practice with
    neither extended periods nor rooms.

## Conventions (binding)

Plain JS ES modules, no dependencies. Local-date strings only via `shared/time.js`. Engine pure.
Every UI value through `esc()`. Follow the style of `engine/fairness.js` and
`app/views/rota.js`. All engine behaviour changes need tests. Solver advises, never hard-blocks.
