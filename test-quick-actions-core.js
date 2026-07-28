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

// ── who rendering map ─────────────────────────────────────────────────────────
console.log('\n--- who rendering ---');

const WHO_EXPECT = {
  'Any GP': 'any GP',
  'Usual GP': 'their usual GP',
  Me: 'me',
  'Duty doctor': 'the duty doctor',
  'Practice nurse': 'the practice nurse',
  'HCA / phlebotomy': 'HCA/phlebotomy',
  Pharmacist: 'the pharmacist',
  'ANP / Paramedic': 'the ANP/paramedic',
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
