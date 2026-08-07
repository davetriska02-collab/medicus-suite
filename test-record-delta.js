// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
//
// test-record-delta.js — ported from the private composite-features
// prototype's test-record-delta.mjs (delta/record-delta.mjs -> shared/record-delta.js).
// Run: node --test test-record-delta.js
//
// Every assertion below is carried over UNCHANGED from the source test; only
// the import mechanics changed — a CommonJS require of the ported, browser-
// compatible shared/record-delta.js instead of an ESM import of the
// Node-only original (which hashed with node:crypto; see the PORT NOTE in
// shared/record-delta.js for why the digest algorithm changed and why that
// does not affect any of these assertions — they check format/determinism/
// diff semantics, never the literal digest value).

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { fingerprint, fingerprintKeys, recordDelta } = require('./shared/record-delta.js');

const t0 = {
  problems: [{ label: 'Type 2 diabetes mellitus', code: '44054006', status: 'active' }],
  medications: [{ name: 'Metformin 500mg tablets' }],
  allergies: [],
  immunisations: [],
};

// Same patient a month later: new penicillin allergy, new CKD diagnosis,
// metformin dose changed (still metformin), amlodipine started.
const t1 = {
  problems: [
    { label: 'Type 2 diabetes mellitus', code: '44054006', status: 'active' },
    { label: 'Chronic kidney disease stage 3', code: '431857002', status: 'active' },
  ],
  medications: [{ name: 'Metformin 1g tablets' }, { name: 'Amlodipine 5mg tablets' }],
  allergies: [{ label: 'Penicillin allergy', code: '373270004', status: 'active' }],
  immunisations: [],
};

test('fingerprint keys are hashed (no PHI) and stable', () => {
  const keys = fingerprintKeys(t0);
  assert.equal(keys.length, 2); // 1 problem + 1 med
  assert.ok(
    keys.every((k) => /^[0-9a-f]{16}$/.test(k)),
    'keys are short hex hashes, not clinical text'
  );
  // deterministic
  assert.deepEqual(fingerprintKeys(t0).sort(), keys.sort());
});

test('delta surfaces new allergy + new problem + new med, allergy ranked first', () => {
  const prev = fingerprintKeys(t0);
  const d = recordDelta(prev, t1);

  assert.equal(d.hasNewAllergy, true);
  assert.equal(d.hasNewProblem, true);
  assert.equal(d.hasNewMedication, true);

  // allergy is the most clinically significant new event -> first
  assert.equal(d.added[0].kind, 'allergy');
  assert.match(d.added[0].label, /Penicillin/);

  const events = d.added.map((a) => a.event);
  assert.ok(events.includes('allergy-added'));
  assert.ok(events.includes('problem-added')); // CKD
  assert.ok(events.includes('medication-added')); // amlodipine
});

test('a dose change is NOT a stop+start (medication identity is the drug name)', () => {
  const prev = fingerprintKeys(t0);
  const d = recordDelta(prev, t1);
  // metformin 500mg -> 1g: same med identity, so it is neither added nor removed
  assert.ok(!d.added.some((a) => /metformin/i.test(a.label)), 'metformin dose change is not a new med');
  // only amlodipine is the genuinely new medication
  assert.equal(d.added.filter((a) => a.kind === 'medication').length, 1);
});

test('removed items are counted (metformin identity persists, so 0 removed here)', () => {
  const d = recordDelta(fingerprintKeys(t0), t1);
  assert.equal(d.removedCount, 0); // nothing dropped: diabetes + metformin-identity both persist
  // dropping the diabetes problem entirely IS a removal
  const dropped = recordDelta(fingerprintKeys(t1), { ...t1, problems: [] });
  assert.ok(dropped.removedCount >= 2); // both problems gone
});

test('first run (no prior keys) reports everything current as added', () => {
  const d = recordDelta([], t1);
  // t1: problems(diabetes, CKD)=2 + meds(metformin, amlodipine)=2 + allergy(penicillin)=1 = 5
  assert.equal(d.counts.added, 5);
});

// fingerprint() itself is exercised transitively above via fingerprintKeys(),
// but is imported directly (as the source test did) so it stays part of the
// module's public contract under test.
test('fingerprint() exposes both keys and in-memory labels', () => {
  const fp = fingerprint(t0);
  assert.ok(fp.keys instanceof Set);
  assert.ok(fp.labels instanceof Map);
  assert.equal(fp.keys.size, 2);
});
