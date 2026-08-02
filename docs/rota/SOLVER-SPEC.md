# Auto-rota solver — specification (v1.5.0)

## Scope and philosophy

The solver optimises **session-type assignment over a fixed presence matrix**. It never moves
anyone's working days (those are contractual); it decides what people do in the slots they
already work. Primary job: multi-week, fair, site-aware **duty-doctor allocation**, plus
registrar VTS protection and rebalancing of over-assigned duty. It is an *advisor*: it returns a
change-set and diagnostics; the UI previews and the user applies (undoably) or discards.

Supervision gaps depend on **presence**, not types, so the solver cannot fix them — it must
report them in `unresolved` rather than silently ignore them.

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
  churn: 1         // per entry whose final type differs from its original type
};

export function solveRota({
  dates,            // contiguous YYYY-MM-DD array, multiple whole weeks (Mon-aligned)
  entries,          // ALL entries (solver filters to horizon itself)
  staff, leaveList, settings,
  historyEntries = [],            // entries before the horizon, for duty-debt fairness
  options = {}                    // { maxDutyPerWeek=2, iterations=8000, seed=1, weights }
})
// returns:
// {
//   changes: [{ entryId, staffId, date, period, from, to }], // final != original only
//   score: { before, after },
//   breakdown: { dutyGap, vts, fairness, sameDay, weeklyCap, locumDuty, preference, churn }, // AFTER counts/values
//   unresolved: [{ kind, message }],   // gaps no assignment could fix + supervision note
//   iterations
// }
```

## Definitions

- **Slot** = (date, period, site). Sites = `settings.sites` (length > 1 ⇒ per-site duty,
  person's site = `staff.site || sites[0]`); otherwise one virtual site.
- **Open slot**: `dayKey(date)` ∈ `settings.openDays` and date ∉ `settings.bankHolidays`.
- **Duty-eligible**: `person.role === 'gp' && person.dutyEligible`, not on approved leave that
  date (`approvedLeaveFor`), and present (has a flexible or locked active entry in the slot).
- **Locked entry** (never modified): status ∈ {vacancy, covered, cancelled}, or
  source === 'manual', or status === 'confirmed'. Locked duty entries still COUNT toward
  coverage and fairness.
- **Flexible entry**: in horizon, status 'planned', source ∈ {template, auto-duty, solver, cover}.
- **Allowed types** for a flexible entry (original type = its typeId at solve start):
  - registrar with `vtsDay === \`${dayKey(date)}-${period}\`` and original type clinical
    ⇒ exactly `['tutorial']` (forced fix, applied in the initial solution);
  - else `[originalType]`, plus `'duty'` if the person is duty-eligible and originalType ∈
    {surgery, triage, duty}; an entry whose original type IS duty may also take the person's
    pattern type for that slot (via `templateWeekIndex`; fallback `'surgery'`) so excess duty
    can be reverted.
- **Duty share** (fairness): for each duty-eligible GP with `contractedSessions > 0`:
  `(historyDutyCount + plannedDutyCount) / contractedSessions`. History = duty entries in
  `historyEntries` (status not vacancy/cancelled). Locums (contracted 0) are excluded from the
  fairness term; their duty costs `locumDuty` instead.

## Score

`score = Σ weight × measure` per DEFAULT_WEIGHTS above. dutyGap measure =
`max(0, required − dutyCount)` summed over open slots (and sites), where
`required = settings.dutyRequired[period]`. fairness measure = `Σ (share_i − mean)²`.
weeklyCap is assessed per Mon–Sun week within the horizon. Perfect score 0 short-circuits.

## Algorithm

1. **Initial solution**: original types → apply forced VTS fixes → greedy duty fill (for each
   open slot with a gap, assign the present, eligible, flexible GP with the lowest duty share;
   deterministic tie-break by name).
2. **Simulated annealing** for `options.iterations`:
   - RNG: mulberry32(seed) — fully deterministic.
   - Temperature `T = 25 × (0.02)^(i/iterations)` (≈25 → 0.5).
   - Moves (probabilities): 40% *fix-gap* (random gap slot → random eligible flexible entry →
     duty), 25% *toggle* (random flexible GP entry: duty⇄revert), 20% *transfer* (within one
     slot, swap types of a duty entry and a non-duty eligible entry), 15% *random* (random
     flexible entry → random allowed type).
   - Accept if Δscore ≤ 0, else with probability `exp(−Δ/T)`.
   - Track and return the best solution seen.
3. **Diagnostics**: remaining duty gaps → `unresolved` ("no eligible GP present"); plus one
   summary note if `checkWeek`-style supervision issues exist in the horizon (run `checkWeek`
   per week post-solve and pass through warnings of kind `supervision`).

Score recomputation may be full (entry counts are small: ~15 staff × 10 slots × weeks); keep it
O(entries) per evaluation and this stays well under a second at 8k iterations.

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

## Preferences

`staff.avoidDuty: string[]` of `'mon-am'`-style keys (default `[]`, add to `newStaff`).
Staff editor: a multi-select (Mon–Fri × AM/PM) labelled “Avoid duty on”. Solver applies the
`preference` penalty per duty assignment on an avoided slot.

## Tests — `test-solver.js` (node:assert/strict, no framework)

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

## Conventions (binding)

Plain JS ES modules, no dependencies. Local-date strings only via `shared/time.js`. Engine pure.
Every UI value through `esc()`. Follow the style of `engine/fairness.js` and
`app/views/rota.js`. All engine behaviour changes need tests. Solver advises, never hard-blocks.
