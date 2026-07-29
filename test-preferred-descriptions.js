// Medicus Suite — shared/preferred-descriptions.js (generic per-key "what
// does this practice prefer" tally/override learning) tests
// Run with: node test-preferred-descriptions.js
//
// Pure logic only — no chrome.storage, no DOM. Exercises the generic
// key/candidate mechanism against BOTH real call shapes it serves:
//   - the wording-preference axis (key=descriptionId, candidate=
//     {description, descriptionId})
//   - the concept-remap axis (key=`${targetConceptId}|${targetDescriptionId}`,
//     candidate={conceptId, descriptionId, description})
// plus override precedence (always wins over tally; tie-break by most
// recent when counts are equal) and defensiveness on malformed input.

'use strict';

const {
  emptyEntry,
  normaliseEntry,
  resolvePreferred,
  recordChoice,
  setOverride,
  clearOverride,
} = require('./shared/preferred-descriptions.js');

let passed = 0,
  failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
  }
}

console.log('\n--- normaliseEntry / emptyEntry: never throws on malformed input ---');
check(JSON.stringify(normaliseEntry(null)) === JSON.stringify(emptyEntry()), 'null -> empty entry');
check(JSON.stringify(normaliseEntry(undefined)) === JSON.stringify(emptyEntry()), 'undefined -> empty entry');
check(JSON.stringify(normaliseEntry('nonsense')) === JSON.stringify(emptyEntry()), 'string -> empty entry');
check(JSON.stringify(normaliseEntry({})) === JSON.stringify(emptyEntry()), '{} -> empty entry (tally defaults to {})');
check(
  normaliseEntry({ tally: 'not-an-object' }).tally &&
    Object.keys(normaliseEntry({ tally: 'not-an-object' }).tally).length === 0,
  'non-object tally coerced to empty object, never throws'
);
check(
  normaliseEntry({ override: { candidate: { description: 'no key' } } }).override === null,
  'an override object missing key is discarded (nothing stable to key by)'
);

console.log('\n--- recordChoice: pure, immutable, tallies by an arbitrary key (wording axis shape) ---');
{
  const e0 = null;
  const e1 = recordChoice(e0, 'd1', { description: 'Fracture of radius', descriptionId: 'd1' }, '2026-07-28T10:00:00Z');
  check(e0 === null, 'the original (null) entry is untouched');
  check(e1.tally.d1.count === 1, 'first choice for a fresh key starts the tally at 1');
  check(e1.tally.d1.candidate.description === 'Fracture of radius', 'candidate captured whole');
  check(e1.tally.d1.lastUsed === '2026-07-28T10:00:00Z', 'lastUsed uses the injected timestamp');

  const e2 = recordChoice(e1, 'd1', { description: 'Fracture of radius', descriptionId: 'd1' }, '2026-07-28T11:00:00Z');
  check(e1.tally.d1.count === 1, 'recording a second choice does not mutate the earlier entry object');
  check(e2.tally.d1.count === 2, 'a repeat choice for the same key increments the tally');
  check(e2.tally.d1.lastUsed === '2026-07-28T11:00:00Z', 'lastUsed advances to the newer timestamp');

  const e3 = recordChoice(
    e2,
    'd2',
    { description: 'Fracture of right radius', descriptionId: 'd2' },
    '2026-07-28T12:00:00Z'
  );
  check(
    e3.tally.d1.count === 2 && e3.tally.d2.count === 1,
    'a different key gets its own tally row, existing one untouched'
  );
}

console.log('\n--- recordChoice: concept-remap axis shape (composite conceptId|descriptionId key) ---');
{
  let e = null;
  const target = {
    conceptId: '449708009',
    descriptionId: 'td1',
    description: 'Injection of varicose vein of lower limb',
  };
  e = recordChoice(e, '449708009|td1', target, '2026-07-29T09:00:00Z');
  check(e.tally['449708009|td1'].count === 1, 'composite key tallies correctly');
  check(
    e.tally['449708009|td1'].candidate.conceptId === '449708009',
    'full remap candidate object is preserved, not just a description string'
  );
  check(
    e.tally['449708009|td1'].candidate.description === 'Injection of varicose vein of lower limb',
    'candidate description preserved'
  );
}

console.log('\n--- recordChoice: falsy key -> no-op (nothing stable to key by) ---');
{
  const e = recordChoice(null, null, { description: 'Some free-text candidate' });
  check(Object.keys(e.tally).length === 0, 'a null key is never tallied');
  const e2 = recordChoice(null, '', { description: 'x' });
  check(Object.keys(e2.tally).length === 0, 'an empty-string key is never tallied');
}

console.log('\n--- resolvePreferred: highest tally wins, tie-break by most recent ---');
{
  let e = null;
  e = recordChoice(e, 'd1', { description: 'Eczema NOS' }, '2026-07-28T09:00:00Z');
  e = recordChoice(e, 'd2', { description: 'Atopic eczema' }, '2026-07-28T10:00:00Z');
  e = recordChoice(e, 'd2', { description: 'Atopic eczema' }, '2026-07-28T11:00:00Z');
  const resolved = resolvePreferred(e);
  check(resolved.key === 'd2', 'the key picked twice outranks the one picked once');
  check(resolved.candidate.description === 'Atopic eczema', 'resolved candidate matches the winning key');
  check(resolved.source === 'tally', 'source is reported as "tally" when no override is set');

  // Tie: d1 and d3 both count 1 — most recently used should win.
  let e2 = null;
  e2 = recordChoice(e2, 'd1', { description: 'A' }, '2026-07-28T09:00:00Z');
  e2 = recordChoice(e2, 'd3', { description: 'C' }, '2026-07-28T10:00:00Z');
  const resolvedTie = resolvePreferred(e2);
  check(resolvedTie.key === 'd3', 'a tie on count is broken by the most recently used entry');
}
check(resolvePreferred(null) === null, 'an unrecorded key resolves to null');
check(resolvePreferred(emptyEntry()) === null, 'an entry with an empty tally and no override resolves to null');

console.log('\n--- setOverride / clearOverride: manual pin always wins over tally, tallying continues underneath ---');
{
  let e = null;
  e = recordChoice(e, 'd1', { description: 'Popular choice' }, '2026-07-28T09:00:00Z');
  e = recordChoice(e, 'd1', { description: 'Popular choice' }, '2026-07-28T10:00:00Z');
  e = recordChoice(e, 'd1', { description: 'Popular choice' }, '2026-07-28T11:00:00Z');
  check(resolvePreferred(e).key === 'd1', 'sanity: d1 is winning on tally before any override');

  const withOverride = setOverride(e, 'd2', { description: 'Practice-preferred wording' });
  const resolved = resolvePreferred(withOverride);
  check(resolved.key === 'd2', 'a manual override outranks a higher tally count');
  check(resolved.source === 'override', 'source is reported as "override" when one is set');
  check(
    withOverride.tally.d1.count === 3,
    "the override does not erase the underlying tally (practice can still see it's not being used)"
  );

  // Tallying continues normally even while an override is active.
  const stillTallying = recordChoice(withOverride, 'd1', { description: 'Popular choice' }, '2026-07-28T12:00:00Z');
  check(stillTallying.tally.d1.count === 4, 'tallying keeps incrementing underneath an active override');
  check(
    resolvePreferred(stillTallying).key === 'd2',
    'the override still wins even as the tally it is overriding keeps growing'
  );

  const cleared = clearOverride(stillTallying);
  check(cleared.override === null, 'clearOverride removes the override');
  check(resolvePreferred(cleared).key === 'd1', 'once cleared, resolution falls back to the (now higher) tally again');
  check(cleared.tally.d1.count === 4, 'clearing the override does not touch the tally');
}

console.log('\n--- setOverride / clearOverride: defensive on malformed input ---');
check(setOverride(null, null, {}).override === null, 'setOverride with no key is a no-op, never throws');
check(setOverride(null, '', { description: 'x' }).override === null, 'setOverride with an empty-string key is a no-op');
check(clearOverride(null).override === null, 'clearOverride on a null entry never throws');

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
