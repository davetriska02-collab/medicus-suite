// Medicus Suite — First-available appointment core tests
// Run with: node test-first-available.js
//
// side-panel/modules/shared/first-available-core.js is the pure logic behind
// the "when is the next <type> appointment?" lookup (Slots section + Reception
// card). What is pinned here, and why:
//
//   • Favourites sanitisation — the storage shape is untrusted (hand-edited
//     backups, older versions); junk must never crash the panel or balloon
//     past the MAX_FAVOURITES cap (every "Check all" is favourites × window
//     credentialed calls against the practice scheduler).
//   • firstAvailableFrom — the EARLIEST slot must win regardless of byDay key
//     insertion order, and a fetched-but-empty day must be skipped, not
//     returned as an answer.
//   • describeFirstAvailable — "Today"/"Tomorrow"/dated wording is what the
//     desk reads out to a patient; a swapped label is a wrong promise.
//   • The UI component stays READ-ONLY — no reserve/create imports — and its
//     searches go through findSlotsInWindow (the capped window search), never
//     a hand-rolled fan-out (plan D1.4).
//
// ES modules, loaded via dynamic import() from this CommonJS script (the
// test-booking-core.js pattern).

'use strict';

let passed = 0;
let failed = 0;

function check(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
  }
}

(async () => {
  const core = await import('./side-panel/modules/shared/first-available-core.js');
  const {
    MAX_FAVOURITES,
    sanitiseFirstAvailFavs,
    toggleFavourite,
    isFavourite,
    firstAvailableFrom,
    describeFirstAvailable,
  } = core;

  // ── sanitiseFirstAvailFavs ─────────────────────────────────────────────────
  console.log('\nsanitiseFirstAvailFavs:');
  check(
    Array.isArray(sanitiseFirstAvailFavs(undefined)) && sanitiseFirstAvailFavs(undefined).length === 0,
    'undefined → []'
  );
  check(sanitiseFirstAvailFavs('junk').length === 0, 'non-array → []');
  check(sanitiseFirstAvailFavs([null, 42, 'x', {}]).length === 0, 'junk entries dropped');
  check(
    sanitiseFirstAvailFavs([
      { id: 'a', label: 'FCP' },
      { id: '', label: 'x' },
      { id: 'b', label: '' },
    ]).length === 1,
    'entries with empty id or label dropped'
  );
  const deduped = sanitiseFirstAvailFavs([
    { id: 'a', label: 'FCP' },
    { id: 'a', label: 'FCP again' },
    { id: 'b', label: 'GP' },
  ]);
  check(deduped.length === 2 && deduped[0].label === 'FCP', 'de-dupes by id, first wins');
  const overfull = sanitiseFirstAvailFavs(
    Array.from({ length: MAX_FAVOURITES + 5 }, (_, i) => ({ id: `t${i}`, label: `Type ${i}` }))
  );
  check(overfull.length === MAX_FAVOURITES, `caps at MAX_FAVOURITES (${MAX_FAVOURITES})`);
  check(sanitiseFirstAvailFavs([{ id: '  a  ', label: '  FCP  ' }])[0].id === 'a', 'trims id/label whitespace');

  // ── toggleFavourite / isFavourite ──────────────────────────────────────────
  console.log('\ntoggleFavourite:');
  const base = [{ id: 'a', label: 'FCP' }];
  const added = toggleFavourite(base, { id: 'b', label: 'GP urgent' });
  check(added.length === 2 && added[1].id === 'b', 'adds an absent favourite at the end');
  check(base.length === 1, 'input array is untouched');
  const removed = toggleFavourite(added, { id: 'a', label: 'FCP' });
  check(removed.length === 1 && removed[0].id === 'b', 'removes a present favourite');
  const full = Array.from({ length: MAX_FAVOURITES }, (_, i) => ({ id: `t${i}`, label: `Type ${i}` }));
  check(toggleFavourite(full, { id: 'new', label: 'New' }).length === MAX_FAVOURITES, 'adding past the cap is a no-op');
  check(
    toggleFavourite(full, { id: 't0', label: 'Type 0' }).length === MAX_FAVOURITES - 1,
    'removal still works at the cap'
  );
  check(toggleFavourite(base, { id: '', label: 'x' }).length === 1, 'empty id is a no-op');
  check(isFavourite(base, 'a') && !isFavourite(base, 'zz'), 'isFavourite matches by id');

  // ── firstAvailableFrom ─────────────────────────────────────────────────────
  console.log('\nfirstAvailableFrom:');
  check(firstAvailableFrom(null) === null, 'null byDay → null');
  check(firstAvailableFrom({}) === null, 'empty byDay → null');
  check(firstAvailableFrom({ '2026-08-10': [], '2026-08-11': [] }) === null, 'all-empty days → null');

  // Insertion order deliberately NOT date order — concurrent day fetches land
  // in whatever order the network returns them.
  const byDay = {
    '2026-08-12': [{ startDateTime: '2026-08-12 09:00:00' }],
    '2026-08-10': [], // fetched, full — must be skipped, not answered
    '2026-08-11': [
      { startDateTime: '2026-08-11 14:30:00' },
      { startDateTime: '2026-08-11 08:15:00' },
      { startDateTime: '2026-08-11 10:00:00' },
    ],
  };
  const found = firstAvailableFrom(byDay);
  check(found && found.date === '2026-08-11', 'earliest NON-EMPTY day wins regardless of key order');
  check(found && found.slot.startDateTime === '2026-08-11 08:15:00', 'earliest slot within the day wins');
  check(found && found.dayCount === 3, 'dayCount is the whole day, not just the first slot');
  check(
    firstAvailableFrom(byDay).slot === firstAvailableFrom(byDay).slot ||
      byDay['2026-08-11'][0].startDateTime === '2026-08-11 14:30:00',
    'input arrays are not mutated by the sort'
  );

  // ── describeFirstAvailable ─────────────────────────────────────────────────
  console.log('\ndescribeFirstAvailable:');
  const today = '2026-08-07';
  const mk = (date, time) => ({ date, slot: { startDateTime: `${date} ${time}:00` }, dayCount: 1 });
  check(describeFirstAvailable(null, today) === null, 'null found → null');
  const dToday = describeFirstAvailable(mk('2026-08-07', '14:30'), today);
  check(
    dToday.whenText === 'Today 14:30' && dToday.relative === 'today',
    `today → "Today 14:30" (got "${dToday.whenText}")`
  );
  const dTomorrow = describeFirstAvailable(mk('2026-08-08', '09:15'), today);
  check(
    dTomorrow.whenText === 'Tomorrow 09:15' && dTomorrow.relative === 'tomorrow',
    `tomorrow → "Tomorrow 09:15" (got "${dTomorrow.whenText}")`
  );
  const dLater = describeFirstAvailable(mk('2026-08-11', '10:00'), today);
  check(dLater.whenText === 'Tue 11 Aug 2026, 10:00', `later date → dated wording (got "${dLater.whenText}")`);
  check(dLater.relative === 'in 4 days', `later date relative → "in 4 days" (got "${dLater.relative}")`);
  const dNoTime = describeFirstAvailable({ date: '2026-08-11', slot: {}, dayCount: 1 }, today);
  check(dNoTime.whenText === 'Tue 11 Aug 2026', 'missing slot time degrades to the date alone');

  // ── filterAppointmentTypes (shared by all three type pickers) ──────────────
  console.log('\nfilterAppointmentTypes:');
  const bp = await import('./side-panel/modules/shared/booking-panel-core.js');
  const { filterAppointmentTypes } = bp;
  const TYPES = [
    { value: '1', label: 'GP Acute' },
    { value: '2', label: 'GP Routine' },
    { value: '3', label: 'FCP MSK' },
    { value: '4', label: 'Acute Nurse' },
  ];
  check(filterAppointmentTypes(TYPES, '').length === 4, 'empty query returns every type');
  check(filterAppointmentTypes(TYPES, '   ').length === 4, 'whitespace query returns every type');
  const acute = filterAppointmentTypes(TYPES, 'acute');
  check(
    acute.length === 2 && acute.every((t) => /acute/i.test(t.label)),
    '"acute" → the two labels containing acute, case-insensitive'
  );
  check(
    filterAppointmentTypes(TYPES, 'ACUTE GP').length === 1,
    'multi-word query: all words must match ("ACUTE GP" → GP Acute)'
  );
  check(filterAppointmentTypes(TYPES, 'zzz').length === 0, 'no match → empty list, never a crash');
  check(filterAppointmentTypes(null, 'x').length === 0, 'null types → empty list');
  check(filterAppointmentTypes([{ value: '9' }], 'x').length === 0, 'entry with no label never matches');

  // ── Component source pins (write-free + capped search + handoff) ───────────
  console.log('\ncomponent source pins:');
  const fs = require('fs');
  const path = require('path');
  const uiSrc = fs.readFileSync(path.join(__dirname, 'side-panel/modules/shared/first-available.js'), 'utf8');
  check(
    !/reserveSlot|createAppointment|fetchCreateForm/.test(uiSrc),
    'first-available.js imports NO booking write functions — booking is a handoff, never done here'
  );
  check(
    uiSrc.includes('findSlotsInWindow'),
    'first-available.js searches through the capped window search (plan D1.4)'
  );
  check(!uiSrc.includes('setInterval'), 'first-available.js never polls — every fetch is behind a click');
  check(
    uiSrc.includes("'slots.firstAvailFavs'") || uiSrc.includes('"slots.firstAvailFavs"'),
    'favourites storage key is slots.firstAvailFavs'
  );
  check(uiSrc.includes('suite:first-avail:book'), 'the Book button dispatches the handoff event, not a booking call');
  check(uiSrc.includes('slots.pendingBooking'), 'unclaimed handoffs travel via the one-shot slots.pendingBooking key');
  const ioSrc = fs.readFileSync(path.join(__dirname, 'shared/io/slot-counter-io.js'), 'utf8');
  check(ioSrc.includes('slots.firstAvailFavs'), 'slot-counter-io.js backs up slots.firstAvailFavs');

  // The slots module claims the handoff and owns the actual booking flow —
  // the pre-fill must land in front of the UNCHANGED reserve/verify/create
  // path, and every type picker carries the typable filter.
  const slotsSrc = fs.readFileSync(path.join(__dirname, 'side-panel/modules/slots/slots.js'), 'utf8');
  check(
    slotsSrc.includes('suite:first-avail:book') && slotsSrc.includes('preventDefault'),
    'slots.js claims the handoff event (preventDefault) and opens its booking section'
  );
  check(slotsSrc.includes('slots.pendingBooking'), 'slots.js consumes the one-shot pending-booking handoff');
  check(slotsSrc.includes('filterAppointmentTypes'), 'slots.js booking type picker is typably filterable');
  const panelSrc = fs.readFileSync(path.join(__dirname, 'side-panel/modules/shared/booking-panel.js'), 'utf8');
  check(panelSrc.includes('filterAppointmentTypes'), 'reception booking-panel type picker is typably filterable');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
