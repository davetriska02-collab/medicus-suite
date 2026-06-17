// Medicus Suite — provenance & caveat canon tests
// Run with: node test-provenance.js
//
// Guards shared/provenance.js: the canonical caveat constants exist and are
// non-empty, and the provenance formatter behaves — including the
// missing-timestamp / no-fabrication path (a blank as-of is OMITTED, never
// defaulted to an invented "now").

'use strict';

(() => {
  let passed = 0,
    failed = 0;
  function check(cond, msg) {
    if (cond) {
      console.log(`  OK  ${msg}`);
      passed++;
    } else {
      console.error(`  FAIL  ${msg}`);
      failed++;
      process.exitCode = 1;
    }
  }

  const { CAVEATS, formatProvenance, formatAsOf } = require('./shared/provenance.js');

  // ── Caveat constants ────────────────────────────────────────────────────────
  const keys = ['NO_ALERT_NOT_ALL_CLEAR', 'LIVE_SNAPSHOT_NOT_COMPLETE', 'SUPPORTING_EVIDENCE_NOT_PROOF'];
  for (const k of keys) {
    check(typeof CAVEATS[k] === 'string', `CAVEATS.${k} exists and is a string`);
    check(CAVEATS[k] && CAVEATS[k].trim().length > 0, `CAVEATS.${k} is non-empty`);
  }
  // Content sanity (no over-claim drift): each carries its load-bearing phrase.
  check(/≠/.test(CAVEATS.NO_ALERT_NOT_ALL_CLEAR), 'NO_ALERT_NOT_ALL_CLEAR carries the "≠" assertion');
  check(
    /not a complete record/i.test(CAVEATS.LIVE_SNAPSHOT_NOT_COMPLETE),
    'LIVE_SNAPSHOT_NOT_COMPLETE says "not a complete record"'
  );
  check(/not proof/i.test(CAVEATS.SUPPORTING_EVIDENCE_NOT_PROOF), 'SUPPORTING_EVIDENCE_NOT_PROOF says "not proof"');

  // ── formatProvenance — source + as-of compose with " · " ─────────────────────
  check(
    formatProvenance({ source: 'Slots free now', asOf: '09:14' }) === 'Slots free now · as at 09:14',
    'source + string as-of composes "<source> · as at <time>"'
  );
  check(
    formatProvenance({ source: 'Waiting room' }) === 'Waiting room',
    'source alone renders without an as-of clause'
  );

  // Date and epoch-ms inputs both produce a clock stamp (locale-formatted).
  const d = new Date('2026-06-17T09:14:00');
  const fromDate = formatProvenance({ source: 'X', asOf: d });
  check(/^X · as at /.test(fromDate), 'Date as-of yields a stamped line');
  const fromEpoch = formatProvenance({ source: 'X', asOf: d.getTime() });
  check(fromEpoch === fromDate, 'epoch-ms as-of matches the equivalent Date');

  // ── No-fabrication / missing-timestamp path ──────────────────────────────────
  check(formatProvenance({}) === '', 'no inputs → empty string (renders nothing, never a bare stamp)');
  check(formatProvenance({ asOf: '' }) === '', 'blank as-of and no source → empty string');
  check(
    formatProvenance({ source: 'Capacity', asOf: null }) === 'Capacity',
    'null as-of is OMITTED — no fabricated time appended'
  );
  check(
    !/as at/.test(formatProvenance({ source: 'Capacity', asOf: undefined })),
    'undefined as-of never emits an "as at" clause'
  );
  check(
    formatProvenance({ source: 'Y', asOf: new Date('not-a-date') }) === 'Y',
    'invalid Date as-of is omitted, not stamped'
  );
  check(formatProvenance({ source: 'Y', asOf: NaN }) === 'Y', 'NaN as-of is omitted, not stamped');

  // formatAsOf in isolation
  check(formatAsOf('') === '', 'formatAsOf("") → ""');
  check(formatAsOf(null) === '', 'formatAsOf(null) → ""');
  check(formatAsOf('07:57') === '07:57', 'formatAsOf passes through a preformatted string (trimmed)');
  check(formatAsOf('  07:57  ') === '07:57', 'formatAsOf trims a preformatted string');

  // Whitespace-only source is treated as absent.
  check(formatProvenance({ source: '   ', asOf: '09:00' }) === 'as at 09:00', 'whitespace-only source is dropped');

  console.log(`\n${passed} passed, ${failed} failed`);
})();
