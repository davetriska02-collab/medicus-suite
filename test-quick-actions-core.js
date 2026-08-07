// Medicus Suite — GP → reception quick-actions composer tests
// Run with: node test-quick-actions-core.js
//
// Pins the composed sentence VERBATIM. The whole point of this feature is that a
// receptionist reads one unambiguous line of English; a silent phrasing drift
// ("Book F2F appt with Usual GP") is the failure mode, and it is invisible in a
// screenshot review. Every canonical output below is therefore a literal string
// comparison, not a regex.
//
// Also covers: the append-only comment join (must never rewrite what the GP typed),
// and sanitiseConfig's fail-safe behaviour (garbage in → shipped defaults out,
// clamped lengths, capped lists, prototype-pollution keys rejected).

'use strict';

const QA = require('./shared/quick-actions-core.js');

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
function eq(actual, expected, msg) {
  check(
    actual === expected,
    `${msg}${actual === expected ? '' : `\n        expected: ${JSON.stringify(expected)}\n        actual:   ${JSON.stringify(actual)}`}`
  );
}

// ── Canonical composed lines (VERBATIM — do not relax these) ──────────────────
console.log('--- canonical composed lines ---');

eq(
  QA.composeLine({ action: 'Book F2F appt', who: 'Nat', when: 'Within 2 weeks' }),
  'Book F2F appt with Nat, within 2 weeks.',
  'custom name + mapped timeframe'
);
eq(
  QA.composeLine({ action: 'Book F2F appt', who: 'Any GP', when: 'Routine (next available)' }),
  'Book F2F appt with any GP, routine.',
  'mapped who + mapped "routine"'
);
eq(
  QA.composeLine({ action: 'Book telephone appt', who: '', when: 'Within 48h' }),
  'Book telephone appt, within 48h.',
  'no who → the " with …" clause is dropped'
);
eq(
  QA.composeLine({
    action: 'Book bloods (HCA/phlebotomy)',
    who: '',
    when: 'This week',
    note: 'if none free, book next available and let me know',
  }),
  'Book bloods (HCA/phlebotomy), this week. If none free, book next available and let me know.',
  'fallback suggestion becomes a sentence-cased, full-stopped tail'
);
eq(
  QA.composeLine({ action: 'Phone patient', who: '', when: 'Today', note: 'if no answer, text booking link' }),
  'Phone patient, today. If no answer, text booking link.',
  'phone + today + fallback note'
);
eq(
  QA.composeLine({ action: 'Book telephone appt', who: 'Me', when: 'Within 2 weeks' }),
  'Book telephone appt with me, within 2 weeks.',
  '"Me" renders as "me"'
);
eq(
  QA.composeLine({ action: 'FYI only — no action' }),
  'FYI — no action needed.',
  'FYI action collapses to the fixed line'
);

// The v2 presets (reception feedback 2026-07-28) — pinned like every other line.
eq(
  QA.composeLine({ action: 'Book DOAC review', who: 'Registrar', when: 'Within 2 weeks' }),
  'Book DOAC review with the registrar, within 2 weeks.',
  'DOAC review + registrar'
);
eq(
  QA.composeLine({ action: 'Book medication review', who: 'Pharmacist', when: 'Within 4 weeks' }),
  'Book medication review with the pharmacist, within 4 weeks.',
  'medication review + pharmacist'
);
eq(
  QA.composeLine({ action: 'Book CVD review', who: 'Practice nurse', when: 'Within 4 weeks' }),
  'Book CVD review with the practice nurse, within 4 weeks.',
  'CVD review + practice nurse'
);
eq(
  QA.composeLine({ action: 'Book F2F appt', who: 'First-contact physio', when: 'This week' }),
  'Book F2F appt with a first-contact physio, this week.',
  'first-contact physio reads with "a", not "the"'
);
eq(
  QA.composeLine({ action: 'Book telephone appt', who: 'Mental health practitioner', when: 'Within 2 weeks' }),
  'Book telephone appt with a mental health practitioner, within 2 weeks.',
  'mental health practitioner reads mid-sentence'
);
eq(
  QA.composeLine({ action: 'Add to jobs list', who: '', when: 'This week' }),
  'Add to jobs list, this week.',
  'jobs list is a plain instruction — no who clause needed'
);
eq(
  QA.composeLine({ action: 'No appt — inform patient' }),
  'No appt — inform patient.',
  'the "no appointment" action composes in full (it used to clamp to "…inform pati")'
);

// ── who rendering map ─────────────────────────────────────────────────────────
console.log('\n--- who rendering ---');

const WHO_EXPECT = {
  'Any GP': 'any GP',
  'Usual GP': 'their usual GP',
  Me: 'me',
  'Duty doctor': 'the duty doctor',
  Registrar: 'the registrar',
  'Practice nurse': 'the practice nurse',
  'HCA / phlebotomy': 'HCA/phlebotomy',
  Pharmacist: 'the pharmacist',
  'ANP / Paramedic': 'the ANP/paramedic',
  'First-contact physio': 'a first-contact physio',
  'Mental health practitioner': 'a mental health practitioner',
};
for (const [label, rendered] of Object.entries(WHO_EXPECT)) {
  eq(
    QA.composeLine({ action: 'Phone patient', who: label }),
    `Phone patient with ${rendered}.`,
    `who "${label}" → "${rendered}"`
  );
}
check(
  QA.DEFAULT_CONFIG.sets.default.who.every((w) => Object.prototype.hasOwnProperty.call(WHO_EXPECT, w)),
  'every shipped who label has a pinned mid-sentence rendering'
);

// Custom names are VERBATIM — never re-cased, never article-prefixed.
eq(QA.composeLine({ action: 'Phone patient', who: 'Nat' }), 'Phone patient with Nat.', 'custom name "Nat" stays "Nat"');
eq(
  QA.composeLine({ action: 'Phone patient', who: 'Dr Okonkwo' }),
  'Phone patient with Dr Okonkwo.',
  'custom name "Dr Okonkwo" is verbatim'
);
eq(
  QA.composeLine({ action: 'Phone patient', who: 'the MSK team' }),
  'Phone patient with the MSK team.',
  'custom who keeps its own lower-case start'
);

// ── when rendering map ────────────────────────────────────────────────────────
console.log('\n--- when rendering ---');

const WHEN_EXPECT = {
  Today: 'today',
  Tomorrow: 'tomorrow',
  'Within 48h': 'within 48h',
  'This week': 'this week',
  'Within 2 weeks': 'within 2 weeks',
  'Within 4 weeks': 'within 4 weeks',
  'Routine (next available)': 'routine',
};
for (const [label, rendered] of Object.entries(WHEN_EXPECT)) {
  eq(
    QA.composeLine({ action: 'Phone patient', when: label }),
    `Phone patient, ${rendered}.`,
    `when "${label}" → "${rendered}"`
  );
}
check(
  QA.DEFAULT_CONFIG.sets.default.when.every((w) => Object.prototype.hasOwnProperty.call(WHEN_EXPECT, w)),
  'every shipped timeframe label has a pinned mid-sentence rendering'
);

// Custom timeframes decapitalise — except acronyms (second char also upper case).
eq(
  QA.composeLine({ action: 'Phone patient', when: 'Before Friday' }),
  'Phone patient, before Friday.',
  'custom "Before Friday" → "before Friday"'
);
eq(
  QA.composeLine({ action: 'Phone patient', when: 'ASAP' }),
  'Phone patient, ASAP.',
  'acronym guard: "ASAP" is not decapitalised'
);
eq(
  QA.composeLine({ action: 'Phone patient', when: 'AM only' }),
  'Phone patient, AM only.',
  'acronym guard: "AM only" is not decapitalised'
);
eq(
  QA.composeLine({ action: 'Phone patient', when: 'next Tuesday' }),
  'Phone patient, next Tuesday.',
  'already-lower-case custom timeframe unchanged'
);

// ── shipped label lengths ─────────────────────────────────────────────────────
// Every shipped label must survive sanitiseConfig()'s clamp UNCHANGED. An
// over-long preset does not fail loudly — it is silently sliced mid-word ("Book
// mental health practition") and ships that way to a receptionist.
console.log('\n--- shipped labels fit their limits ---');

for (const [setName, set] of Object.entries(QA.DEFAULT_CONFIG.sets)) {
  for (const key of ['actions', 'who', 'when', 'fallbacks']) {
    const limit = key === 'fallbacks' ? QA.QA_LIMITS.fallback : QA.QA_LIMITS.label;
    const tooLong = set[key].filter((label) => label.length > limit);
    check(
      tooLong.length === 0,
      `every shipped ${setName}.${key} label is ≤ ${limit} chars${tooLong.length ? ` (over: ${JSON.stringify(tooLong)})` : ''}`
    );
    const untrimmed = set[key].filter((label) => label !== label.trim());
    check(untrimmed.length === 0, `no shipped ${setName}.${key} label has stray whitespace`);
    check(
      set[key].length <= QA.QA_LIMITS.list,
      `shipped ${setName}.${key} is within the ${QA.QA_LIMITS.list}-entry cap`
    );
  }
}

// The clamp itself, applied to the shipped config — belt and braces, because the
// length check above would pass if QA_LIMITS ever changed shape.
const roundTripped = QA.sanitiseConfig(JSON.parse(JSON.stringify(QA.DEFAULT_CONFIG)));
check(
  JSON.stringify(roundTripped.sets) === JSON.stringify(QA.DEFAULT_CONFIG.sets),
  'the shipped config survives sanitiseConfig() byte-for-byte (nothing clamps)'
);

// ── FYI suppression ───────────────────────────────────────────────────────────
console.log('\n--- FYI suppression ---');

eq(
  QA.composeLine({ action: 'FYI only — no action', who: 'Any GP', when: 'Today' }),
  'FYI — no action needed.',
  'FYI suppresses BOTH who and when (they would contradict "no action")'
);
eq(
  QA.composeLine({ action: 'fyi only', who: 'Nat', when: 'Today', note: 'for information' }),
  'FYI — no action needed. For information.',
  'FYI match is case-insensitive and still carries the note'
);
eq(
  QA.composeLine({ action: 'Notify FYI', who: 'Nat' }),
  'Notify FYI with Nat.',
  'FYI only matches at the START of the action label'
);

// ── no action → no line ───────────────────────────────────────────────────────
console.log('\n--- action is required ---');

eq(QA.composeLine({}), '', 'no action → empty string');
eq(
  QA.composeLine({ action: '', who: 'Any GP', when: 'Today', note: 'anything' }),
  '',
  'empty action → empty string even with everything else set'
);
eq(QA.composeLine({ action: '   ' }), '', 'whitespace-only action → empty string');
eq(QA.composeLine(null), '', 'null selection → empty string');
eq(QA.composeLine(undefined), '', 'undefined selection → empty string');

// ── note handling ─────────────────────────────────────────────────────────────
console.log('\n--- note handling ---');

eq(
  QA.composeLine({ action: 'Phone patient', note: '  ring the mobile first  ' }),
  'Phone patient. Ring the mobile first.',
  'note is trimmed, sentence-cased and full-stopped'
);
eq(
  QA.composeLine({ action: 'Phone patient', note: 'is she still coughing?' }),
  'Phone patient. Is she still coughing?',
  'note ending in ? keeps its own punctuation'
);
eq(
  QA.composeLine({ action: 'Phone patient', note: 'urgent!' }),
  'Phone patient. Urgent!',
  'note ending in ! keeps its own punctuation'
);
eq(
  QA.composeLine({ action: 'Phone patient', note: 'already done.' }),
  'Phone patient. Already done.',
  'note ending in . is not double-stopped'
);
eq(QA.composeLine({ action: 'Phone patient', note: '' }), 'Phone patient.', 'empty note adds nothing');
eq(QA.composeLine({ action: 'Phone patient', note: '   ' }), 'Phone patient.', 'whitespace-only note adds nothing');

const longNote = 'x'.repeat(300);
const clampedNoteLine = QA.composeLine({ action: 'Phone patient', note: longNote });
eq(
  clampedNoteLine,
  'Phone patient. X' + 'x'.repeat(139) + '.',
  'note keeps exactly its first 140 characters (sentence-cased, full-stopped)'
);
check(clampedNoteLine.indexOf('x'.repeat(140)) === -1, 'note is clamped at 140 characters');

// ── whole-line clamp ──────────────────────────────────────────────────────────
console.log('\n--- whole-line clamp ---');

const longLine = QA.composeLine({
  action: 'A'.repeat(28),
  who: 'B'.repeat(28),
  when: 'C'.repeat(28),
  note: 'D'.repeat(140),
});
check(longLine.length <= 240, `whole line is clamped to 240 characters (got ${longLine.length})`);
check(QA.QA_LIMITS.line === 240, 'line limit constant is 240');
check(QA.composeLine({ action: 'Phone patient' }).length < 240, 'a normal line is nowhere near the clamp');

// ── appendToComment ───────────────────────────────────────────────────────────
console.log('\n--- appendToComment ---');

eq(QA.appendToComment('', 'Phone patient, today.'), 'Phone patient, today.', 'empty existing → no leading separator');
eq(
  QA.appendToComment('Spoke to patient', 'Phone patient, today.'),
  'Spoke to patient\nPhone patient, today.',
  'non-empty existing without a trailing newline → one newline separator'
);
eq(
  QA.appendToComment('Spoke to patient\n', 'Phone patient, today.'),
  'Spoke to patient\nPhone patient, today.',
  'existing already ending in a newline → no extra separator'
);
eq(
  QA.appendToComment('Line one\nLine two\n\n', 'Phone patient, today.'),
  'Line one\nLine two\n\nPhone patient, today.',
  'multiple trailing newlines are left exactly as the GP typed them'
);
eq(QA.appendToComment('Existing text', ''), 'Existing text', 'empty line → existing returned untouched');
eq(
  QA.appendToComment(null, 'Phone patient, today.'),
  'Phone patient, today.',
  'non-string existing is treated as empty'
);
eq(QA.appendToComment('Existing text', null), 'Existing text', 'non-string line appends nothing');

// The append-only invariant, stated directly: existing text is always a prefix.
const preserved = 'Pt rang at 09:12 — wants a call back.\nTried once already.';
check(
  QA.appendToComment(preserved, 'Phone patient, today.').startsWith(preserved),
  "append-only: the clinician's existing text is always an untouched prefix"
);

// ── sanitiseConfig ────────────────────────────────────────────────────────────
console.log('\n--- sanitiseConfig ---');

const D = QA.DEFAULT_CONFIG;
for (const garbage of [null, undefined, 'nonsense', 42, [], true, { sets: 'no' }, { sets: [] }]) {
  const c = QA.sanitiseConfig(garbage);
  check(
    c.version === 1 && c.activeSet === 'default' && JSON.stringify(c.sets.default) === JSON.stringify(D.sets.default),
    `garbage input (${JSON.stringify(garbage)}) → shipped defaults`
  );
}

check(Object.isFrozen(QA.DEFAULT_CONFIG), 'DEFAULT_CONFIG is frozen');
check(Object.isFrozen(QA.DEFAULT_CONFIG.sets.default.actions), 'DEFAULT_CONFIG is deep-frozen');
const mutable = QA.sanitiseConfig(null);
mutable.sets.default.actions.push('Mutating the returned config');
check(
  D.sets.default.actions.indexOf('Mutating the returned config') === -1,
  'sanitiseConfig returns a mutable COPY, not the frozen shipped object'
);

// version
check(QA.sanitiseConfig({ version: 7 }).version === 7, 'integer version ≥1 is kept');
check(QA.sanitiseConfig({ version: 0 }).version === 1, 'version 0 is forced to 1');
check(QA.sanitiseConfig({ version: -3 }).version === 1, 'negative version is forced to 1');
check(QA.sanitiseConfig({ version: 2.9 }).version === 2, 'fractional version is floored');
check(QA.sanitiseConfig({ version: 'four' }).version === 1, 'non-numeric version falls back to 1');

// activeSet
check(
  QA.sanitiseConfig({ activeSet: 'nope' }).activeSet === 'default',
  'activeSet naming a missing set falls back to default'
);
check(
  QA.sanitiseConfig({ activeSet: 'branch', sets: { branch: { actions: ['Book'] } } }).activeSet === 'branch',
  'activeSet naming an existing set is kept'
);

// list sanitising
const messy = QA.sanitiseConfig({
  sets: {
    default: {
      actions: ['  Book F2F appt  ', '', 42, null, { a: 1 }, ['x'], 'Phone patient'],
      who: ['Nat'],
      when: ['Today'],
      fallbacks: ['if no answer, text'],
    },
  },
});
check(
  JSON.stringify(messy.sets.default.actions) === JSON.stringify(['Book F2F appt', 'Phone patient']),
  'non-string and empty entries are dropped; survivors are trimmed'
);

const clamped = QA.sanitiseConfig({
  sets: {
    default: { actions: ['A'.repeat(50)], who: ['W'.repeat(50)], when: ['T'.repeat(50)], fallbacks: ['F'.repeat(300)] },
  },
});
check(clamped.sets.default.actions[0].length === 28, 'action label clamped to 28');
check(clamped.sets.default.who[0].length === 28, 'who label clamped to 28');
check(clamped.sets.default.when[0].length === 28, 'when label clamped to 28');
check(clamped.sets.default.fallbacks[0].length === 140, 'fallback clamped to 140');

const many = QA.sanitiseConfig({
  sets: {
    default: {
      actions: Array.from({ length: 60 }, (_, i) => `Action ${i}`),
      who: Array.from({ length: 60 }, (_, i) => `Who ${i}`),
      when: Array.from({ length: 60 }, (_, i) => `When ${i}`),
      fallbacks: Array.from({ length: 60 }, (_, i) => `Fallback ${i}`),
    },
  },
});
for (const key of ['actions', 'who', 'when', 'fallbacks']) {
  check(many.sets.default[key].length === 24, `${key} list capped at 24 entries`);
}

// missing lists on the default set fall back to the shipped ones
const partial = QA.sanitiseConfig({ sets: { default: { actions: ['Book F2F appt'] } } });
check(
  JSON.stringify(partial.sets.default.who) === JSON.stringify(D.sets.default.who),
  'a missing list on the default set is restored from the shipped defaults'
);
check(partial.sets.default.actions.length === 1, 'a present list on the default set is respected as authored');
check(
  JSON.stringify(QA.sanitiseConfig({ sets: { default: { who: [] } } }).sets.default.who) === '[]',
  'an explicitly emptied list stays empty (an edit, not a fault)'
);

// prototype-pollution defence
const polluted = QA.sanitiseConfig({
  sets: {
    __proto__: { actions: ['evil'] },
    constructor: { actions: ['evil'] },
    prototype: { actions: ['evil'] },
    branch: { actions: ['Book'] },
  },
});
check(!Object.prototype.hasOwnProperty.call(polluted.sets, '__proto__'), '__proto__ rejected as a set key');
check(!Object.prototype.hasOwnProperty.call(polluted.sets, 'constructor'), 'constructor rejected as a set key');
check(!Object.prototype.hasOwnProperty.call(polluted.sets, 'prototype'), 'prototype rejected as a set key');
check(!!polluted.sets.branch, 'a legitimate sibling set key survives the rejection');
check({}.actions === undefined, 'Object.prototype was not polluted');

// A PADDED forbidden key passes the raw-key check and then trims into
// '__proto__' — sets['__proto__'] = … would rewrite the prototype, not add a
// key, so the post-clamp re-check must drop it too.
const paddedProto = QA.sanitiseConfig({ sets: { ' __proto__ ': { actions: ['evil'] } } });
check(
  !Object.prototype.hasOwnProperty.call(paddedProto.sets, '__proto__') &&
    Object.getPrototypeOf(paddedProto.sets) === Object.prototype &&
    paddedProto.sets.actions === undefined,
  'a padded " __proto__ " set key is rejected after clamping (prototype untouched)'
);

// A non-default set with missing lists gets EMPTY lists, not the shipped ones —
// a practice's second set is theirs to fill, not a silent copy of the defaults.
const secondSet = QA.sanitiseConfig({ sets: { branch: { actions: ['Book at branch'] } } });
check(JSON.stringify(secondSet.sets.branch.who) === '[]', 'a non-default set gets empty lists, not shipped defaults');
check(!!secondSet.sets.default, 'sets.default is always created even when the input never mentions it');

// ── removedShipped tombstones (sanitiseConfig) ────────────────────────────────
console.log('\n--- removedShipped tombstones ---');

check(JSON.stringify(QA.sanitiseConfig(null).removedShipped) === '[]', 'removedShipped defaults to an empty array');
check(
  JSON.stringify(QA.sanitiseConfig({ removedShipped: 'nope' }).removedShipped) === '[]',
  'a non-array removedShipped falls back to []'
);
check(
  JSON.stringify(
    QA.sanitiseConfig({ removedShipped: ['  Duty   Doctor  ', 'Pharmacist', 'pharmacist', 42, null, '', ['x']] })
      .removedShipped
  ) === JSON.stringify(['duty doctor', 'pharmacist']),
  'tombstones are normalised, de-duplicated, and non-strings dropped'
);
check(
  QA.sanitiseConfig({ removedShipped: ['X'.repeat(300)] }).removedShipped[0].length === 140,
  'a tombstone label is clamped to 140 characters'
);
check(
  QA.sanitiseConfig({ removedShipped: Array.from({ length: 300 }, (_, i) => `Entry ${i}`) }).removedShipped.length ===
    QA.QA_LIMITS.tombstones,
  `removedShipped is capped at ${QA.QA_LIMITS.tombstones} entries`
);
// options.js re-sanitises cfg on every save — a tombstone must survive that.
check(
  QA.sanitiseConfig(QA.sanitiseConfig({ removedShipped: ['Pharmacist'] })).removedShipped[0] === 'pharmacist',
  'removedShipped survives a sanitise round-trip (every save re-sanitises)'
);

// ── normaliseLabel / isShippedLabel ───────────────────────────────────────────
console.log('\n--- label identity helpers ---');

eq(QA.normaliseLabel('  Duty   Doctor  '), 'duty doctor', 'normaliseLabel trims, collapses whitespace, lower-cases');
eq(QA.normaliseLabel(null), '', 'normaliseLabel(null) → ""');
check(QA.isShippedLabel('who', 'duty  DOCTOR') === true, 'isShippedLabel matches on the normalised label');
check(QA.isShippedLabel('who', 'Nat') === false, "a practice's own name is not a shipped label");
check(QA.isShippedLabel('actions', 'Duty doctor') === false, 'isShippedLabel is per-list');
check(QA.isShippedLabel('nonsense', 'Duty doctor') === false, 'an unknown list key is never shipped');
check(QA.isShippedLabel('who', '  ') === false, 'a blank label is never shipped');

// ── mergeShippedPresets ───────────────────────────────────────────────────────
// The v1 shipped lists, verbatim, plus a practice's own entries — i.e. exactly
// what sits in chrome.storage for a surgery that saved before v2 shipped.
console.log('\n--- mergeShippedPresets ---');

const V1_ACTIONS = [
  'Book F2F appt',
  'Book telephone appt',
  'Send booking link',
  'Phone patient',
  'Book bloods (HCA/phlebotomy)',
  'Add to duty list',
  'No appt needed — inform patient',
  'FYI only — no action',
];
const V1_WHO = [
  'Any GP',
  'Usual GP',
  'Me',
  'Duty doctor',
  'Practice nurse',
  'HCA / phlebotomy',
  'Pharmacist',
  'ANP / Paramedic',
];
const v1Config = () => ({
  version: 1,
  activeSet: 'default',
  sets: {
    default: {
      actions: V1_ACTIONS.concat(['Chase secondary care letter']),
      who: V1_WHO.concat(['Nat', 'Dr Okonkwo']),
      when: [
        'Today',
        'Tomorrow',
        'Within 48h',
        'This week',
        'Within 2 weeks',
        'Within 4 weeks',
        'Routine (next available)',
      ],
      fallbacks: ['if no answer, text booking link'],
    },
  },
});

const migrated = QA.mergeShippedPresets(v1Config());
check(migrated.changed === true, 'a v1 config reports changed → the caller persists it');
check(migrated.cfg.version === QA.DEFAULT_CONFIG.version, 'the new version is stamped on the migrated config');

const mWho = migrated.cfg.sets.default.who;
const mActions = migrated.cfg.sets.default.actions;
check(
  JSON.stringify(mWho.slice(0, V1_WHO.length + 2)) === JSON.stringify(V1_WHO.concat(['Nat', 'Dr Okonkwo'])),
  'existing entries keep their exact order and position — new ones are appended after them'
);
for (const label of ['Registrar', 'First-contact physio', 'Mental health practitioner']) {
  check(mWho.indexOf(label) > -1, `new shipped who "${label}" is merged in`);
}
for (const label of ['Book medication review', 'Book DOAC review', 'Book CVD review', 'Add to jobs list']) {
  check(mActions.indexOf(label) > -1, `new shipped action "${label}" is merged in`);
}
check(mActions.indexOf('Chase secondary care letter') > -1, "the practice's own action is untouched");
check(
  mWho.filter((w) => w === 'Pharmacist').length === 1,
  'an entry the practice already has is not duplicated by the union'
);
check(
  JSON.stringify(migrated.cfg.sets.default.when) === JSON.stringify(v1Config().sets.default.when),
  'a list with no new shipped entries is left exactly as authored'
);
check(
  migrated.cfg.sets.default.fallbacks.length === QA.DEFAULT_CONFIG.sets.default.fallbacks.length,
  'the fallbacks the practice had removed pre-tombstone are unioned back (documented v1 limitation)'
);

// Idempotent: the second run is a no-op, so the widget and the options editor can
// both call it on every load without fighting over the storage key.
const again = QA.mergeShippedPresets(migrated.cfg);
check(again.changed === false, 're-running the merge reports no change');
check(
  JSON.stringify(again.cfg) === JSON.stringify(migrated.cfg),
  're-running the merge produces a byte-identical config (idempotent)'
);
const thrice = QA.mergeShippedPresets(again.cfg);
check(JSON.stringify(thrice.cfg) === JSON.stringify(migrated.cfg), 'still identical on a third run');

// Purity: the caller's object is never mutated in place.
const beforeMerge = v1Config();
const beforeJson = JSON.stringify(beforeMerge);
QA.mergeShippedPresets(beforeMerge);
check(JSON.stringify(beforeMerge) === beforeJson, 'mergeShippedPresets does not mutate its argument');

// A config already on the current version is left alone entirely.
const current = QA.mergeShippedPresets({ version: QA.DEFAULT_CONFIG.version, sets: { default: { who: ['Nat'] } } });
check(current.changed === false, 'a current-version config is not touched');
check(JSON.stringify(current.cfg.sets.default.who) === JSON.stringify(['Nat']), 'and its lists are left as authored');

// Tombstones: a deleted shipped preset is NOT resurrected.
const tombstoned = QA.mergeShippedPresets({
  version: 1,
  removedShipped: ['pharmacist', 'REGISTRAR', 'book doac review'],
  sets: {
    default: {
      actions: V1_ACTIONS.slice(),
      who: V1_WHO.filter((w) => w !== 'Pharmacist'),
      when: ['Today'],
      fallbacks: ['if no answer, text booking link'],
    },
  },
});
check(tombstoned.cfg.sets.default.who.indexOf('Pharmacist') === -1, 'a tombstoned shipped who is not resurrected');
check(tombstoned.cfg.sets.default.who.indexOf('Registrar') === -1, 'a tombstoned NEW shipped who is never added');
check(
  tombstoned.cfg.sets.default.actions.indexOf('Book DOAC review') === -1,
  'a tombstoned new shipped action is never added (tombstone match is case-insensitive)'
);
check(
  tombstoned.cfg.sets.default.who.indexOf('Mental health practitioner') > -1,
  'untombstoned new presets still arrive alongside the tombstoned ones'
);
check(
  JSON.stringify(tombstoned.cfg.removedShipped) === JSON.stringify(['pharmacist', 'registrar', 'book doac review']),
  'the tombstone list itself survives the migration'
);

// The options editor's delete → re-add cycle, using the same exported helpers the
// editor calls (options/options.js tombstone()/untombstone()).
function editorDelete(cfg, key, label) {
  const set = cfg.sets[cfg.activeSet];
  set[key] = set[key].filter((x) => x !== label);
  if (QA.isShippedLabel(key, label)) {
    const n = QA.normaliseLabel(label);
    if (!cfg.removedShipped.includes(n)) cfg.removedShipped.push(n);
  }
  return QA.sanitiseConfig(cfg); // the editor re-sanitises on every save
}
function editorAdd(cfg, key, label) {
  cfg.sets[cfg.activeSet][key].push(label);
  const n = QA.normaliseLabel(label);
  cfg.removedShipped = cfg.removedShipped.filter((t) => t !== n);
  return QA.sanitiseConfig(cfg);
}

let lifecycle = QA.mergeShippedPresets(v1Config()).cfg;
lifecycle = editorDelete(lifecycle, 'who', 'Registrar');
check(lifecycle.removedShipped.indexOf('registrar') > -1, 'deleting a shipped entry records its tombstone');
lifecycle.version = 1; // pretend the next shipped version has landed
lifecycle = QA.mergeShippedPresets(lifecycle).cfg;
check(lifecycle.sets.default.who.indexOf('Registrar') === -1, 'delete → migrate → still gone');

lifecycle = editorAdd(lifecycle, 'who', 'Registrar');
check(lifecycle.removedShipped.indexOf('registrar') === -1, 're-adding an entry by hand clears its tombstone');
lifecycle.version = 1;
lifecycle = QA.mergeShippedPresets(lifecycle).cfg;
check(
  lifecycle.sets.default.who.filter((w) => w === 'Registrar').length === 1,
  're-add → migrate → present exactly once (no duplicate)'
);

// A full list must never be trimmed to make room for shipped entries: the overflow
// slice takes from the TAIL, which is where the practice's own entries live.
const full = QA.mergeShippedPresets({
  version: 1,
  sets: { default: { actions: Array.from({ length: 24 }, (_, i) => `Practice action ${i}`) } },
});
check(full.cfg.sets.default.actions.length === 24, 'a full list stays at the 24-entry cap');
check(
  full.cfg.sets.default.actions[23] === 'Practice action 23',
  'no user entry is displaced when the list is already full'
);

// Every set is migrated (they all derive from the shipped lists) — but an EMPTY
// list is a deliberate edit (or a second set, which ships empty by design) and is
// never seeded.
const multi = QA.mergeShippedPresets({
  version: 1,
  activeSet: 'branch',
  sets: {
    default: { actions: V1_ACTIONS.slice(), who: V1_WHO.slice(), when: ['Today'], fallbacks: [] },
    branch: { actions: ['Book F2F appt'], who: [], when: [], fallbacks: [] },
  },
});
check(multi.cfg.sets.branch.actions.indexOf('Book CVD review') > -1, 'a non-default set is migrated too');
check(JSON.stringify(multi.cfg.sets.branch.who) === '[]', 'an empty list is left empty — never seeded from shipped');
check(JSON.stringify(multi.cfg.sets.default.fallbacks) === '[]', 'a deliberately emptied list stays emptied');
check(multi.cfg.activeSet === 'branch', 'activeSet is preserved across the migration');

// Garbage in still yields a usable config (the merge sanitises first).
for (const garbage of [null, undefined, 'nonsense', 42, [], true]) {
  const g = QA.mergeShippedPresets(garbage);
  check(
    g.cfg.version === QA.DEFAULT_CONFIG.version &&
      JSON.stringify(g.cfg.sets.default) === JSON.stringify(D.sets.default),
    `mergeShippedPresets(${JSON.stringify(garbage)}) → shipped defaults at the current version`
  );
}

// Markup is carried as INERT TEXT — the core never renders HTML, and every
// consumer escapes at render time (esc() in the widget, escHtml/escAttr in options).
console.log('\n--- markup is text, not markup ---');
const scripty = QA.sanitiseConfig({ sets: { default: { who: ['<script>x</script>'] } } });
eq(scripty.sets.default.who[0], '<script>x</script>', 'a <script> label survives sanitise as inert text');
eq(
  QA.composeLine({ action: 'Phone patient', who: '<script>x</script>' }),
  'Phone patient with <script>x</script>.',
  "composeLine emits the label verbatim — escaping is the renderer's job"
);

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
