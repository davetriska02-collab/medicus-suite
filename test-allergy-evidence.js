// test-allergy-evidence.js — allergy evidence-trawl unit tests
// (engine/allergy-evidence.js, Phase 2 of docs/plans/ALLERGY-CLEANUP-2026-07-28.md).
//
// Every fixture below is SYNTHETIC: invented clinician names, invented
// organisations, invented narrative text. Nothing here came from a real
// patient record. What IS reproduced faithfully is the STRUCTURE confirmed
// live in docs/learnings-patient-journal-api.md — `patientJournalRecords[]`
// day-groups titled "DayName DD Mon YYYY", flat top-level items with their
// content under `item.data`, nested
// `encounter -> data.consultationTopics[].headings[].entries[]`, the
// `isMarkedIncorrect` (not `isMarkedAsIncorrect`) retraction flag, the
// prescription entry that carries no `recordedBy` at all, and the
// "Data Transferred from other system" GP2GP topic marker.
//
// Run with: node test-allergy-evidence.js  (also runs under `node --test`)
'use strict';

const {
  normaliseAllergyLabel,
  findEvidence,
  parseDayTitle,
  extractDayGroups,
  buildSnippet,
  REACTION_TERMS,
  MAX_EVIDENCE_ITEMS,
  DEFAULT_SNIPPET_CHARS,
  GP2GP_TOPIC_MARKER,
} = require('./engine/allergy-evidence.js');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
  }
}

function eq(actual, expected, msg) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${msg} (got ${JSON.stringify(actual)})`);
}

// ── Fixture builders (structure per docs/learnings-patient-journal-api.md) ──

function day(title, items) {
  return { title, items };
}

function flatItem(type, data, extra) {
  return Object.assign({ type, id: `item-${type}-${Math.random().toString(36).slice(2, 8)}`, data }, extra || null);
}

function nestedEntry(entryType, fields) {
  return Object.assign(
    {
      entryType,
      id: `entry-${entryType}-${Math.random().toString(36).slice(2, 8)}`,
      note: null,
      clinicalCodeDescription: null,
      recordedBy: null,
      recordedByOrganisation: null,
      isMarkedIncorrect: false,
    },
    fields
  );
}

function encounterItem(entries, opts) {
  const o = opts || {};
  return {
    type: 'encounter',
    id: `enc-${Math.random().toString(36).slice(2, 8)}`,
    data: {
      startTime: o.startTime || null,
      responsiblePractitioner: o.responsiblePractitioner || null,
      consultationTopics: [
        {
          title: o.topicTitle || 'Consultation',
          headings: [{ title: 'History', entries }],
        },
      ],
    },
  };
}

// The main record: one patient, one substance (amoxicillin), every evidence
// tier and every source type represented exactly once, plus two entries that
// must be skipped outright. Day groups are newest-first, as the live API
// returns them — so anything that comes out in date order came out that way
// because the module sorted it, not because the fixture was pre-sorted.
function mainJournal() {
  return {
    patientJournalRecords: [
      // Score 2 — substance in the note, reaction word in a DIFFERENT field
      // of the same entry, so no same-field proximity pair exists.
      day('Sat 19 May 2018', [
        encounterItem(
          [
            nestedEntry('note', {
              note: 'Family history reviewed; mother had trouble with amoxicillin as a child.',
              clinicalCodeDescription: 'Adverse reaction',
              recordedBy: 'Dr Marwen Ilsley',
              recordedByOrganisation: 'Netherfold Health Centre',
            }),
          ],
          { responsiblePractitioner: 'Dr Marwen Ilsley' }
        ),
      ]),

      // Retracted nested entry — strongest possible text, must never surface.
      day('Tue 02 Jan 2018', [
        encounterItem([
          nestedEntry('note', {
            note: 'Amoxicillin caused anaphylaxis requiring adrenaline.',
            recordedBy: 'Dr Marwen Ilsley',
            isMarkedIncorrect: true,
          }),
        ]),
      ]),

      // Score 1 — document, matched on its title.
      day('Thu 21 Sep 2017', [
        flatItem('document', {
          title: 'Outpatient letter re amoxicillin',
          documentTypeLabel: 'Clinic letter',
          recordedBy: 'Dr Wren Ashgrove',
          recordedByOrganisation: 'Coldharbour General Hospital',
        }),
      ]),

      // Score 1 — flat note, substance mentioned, no reaction wording.
      day('Mon 03 Jul 2017', [
        flatItem('note', {
          note: 'Repeat request reviewed. Amoxicillin not suitable.',
          clinicalCodeDescription: 'Medication review',
          recordedBy: 'Nurse Halcyon Weft',
          recordedByOrganisation: 'Netherfold Health Centre',
        }),
      ]),

      // Draft flat note — must never surface.
      day('Fri 12 May 2017', [
        flatItem('note', { note: 'Amoxicillin caused collapse.', recordedBy: 'Dr Marwen Ilsley' }, { isDraft: true }),
      ]),

      // Score 3 — substance and reaction close together in one note.
      day('Wed 08 Feb 2017', [
        encounterItem(
          [
            nestedEntry('note', {
              note: 'Seen with a widespread urticarial rash 2 hours after starting amoxicillin. Advised to stop it.',
              clinicalCodeDescription: 'Drug reaction',
              recordedBy: 'Dr Aveline Corbray',
              recordedByOrganisation: 'Netherfold Health Centre',
            }),
          ],
          { responsiblePractitioner: 'Dr Aveline Corbray' }
        ),
      ]),

      // Score 1 — prescription, corroborates exposure. `recordedBy` is
      // present in the fixture on purpose: it is confirmed NOT to exist on a
      // real prescription, so the module must report null regardless.
      day('Fri 06 Jan 2017', [
        flatItem('prescription', {
          productName: 'Amoxicillin 500mg capsules',
          dosageText: 'One three times a day for five days',
          recordedBy: 'Dr Should Never Be Read',
        }),
      ]),

      // Score 3, inside a GP2GP transfer encounter — earliest dated evidence,
      // so also the provenance answer, and its recordedBy is the importer.
      day('Mon 12 Jun 2006', [
        encounterItem(
          [
            nestedEntry('note', {
              note: 'Amoxicillin — patient reports swelling of the lips and face.',
              recordedBy: 'User Previous Practice',
              recordedByOrganisation: 'Old Mill Surgery',
            }),
          ],
          { topicTitle: GP2GP_TOPIC_MARKER, responsiblePractitioner: 'User Previous Practice' }
        ),
      ]),
    ],
  };
}

console.log('--- normaliseAllergyLabel ---');
{
  eq(normaliseAllergyLabel('Allergy to penicillin'), ['penicillin'], '"Allergy to X" wrapper stripped');
  eq(
    normaliseAllergyLabel('[X]Adverse reaction to amoxicillin trihydrate'),
    ['amoxicillin trihydrate', 'amoxicillin', 'trihydrate'],
    'ICD bracket prefix + "Adverse reaction to" stripped; full phrase kept plus both head words'
  );
  eq(
    normaliseAllergyLabel('H/O: penicillin allergy'),
    ['penicillin'],
    '"H/O:" prefix and trailing " allergy" both stripped'
  );
  eq(normaliseAllergyLabel('H/O penicillin allergy'), ['penicillin'], '"H/O " (no colon) prefix stripped too');
  eq(normaliseAllergyLabel('Penicillin allergy'), ['penicillin'], 'trailing " allergy" stripped, result lowercased');
  eq(normaliseAllergyLabel('Amoxicillin adverse reaction'), ['amoxicillin'], 'trailing " adverse reaction" stripped');
  eq(
    normaliseAllergyLabel('Allergy to shellfish NOS'),
    ['shellfish'],
    'trailing NOS stripped (shared legacy-marker helper)'
  );
  eq(
    normaliseAllergyLabel('Adverse reaction to co-amoxiclav NEC'),
    ['co-amoxiclav'],
    'trailing NEC stripped; hyphenated single word yields no extra head words'
  );
  eq(
    normaliseAllergyLabel('Allergy to penicillins/cephalosporins'),
    ['penicillins/cephalosporins', 'penicillins', 'cephalosporins'],
    'slash-joined label contributes the combined phrase and both components'
  );
  eq(
    normaliseAllergyLabel('Allergy to nut product'),
    ['nut product'],
    'generic head word ("product") and sub-4-char head word ("nut") both skipped; phrase still searched'
  );
  eq(normaliseAllergyLabel('H/O: allergy to penicillin'), ['penicillin'], 'stacked wrappers unwind in one call');

  eq(normaliseAllergyLabel(null), [], 'null label yields no terms');
  eq(normaliseAllergyLabel(undefined), [], 'undefined label yields no terms');
  eq(normaliseAllergyLabel(''), [], 'empty label yields no terms');
  eq(normaliseAllergyLabel('   '), [], 'whitespace-only label yields no terms');
  eq(normaliseAllergyLabel({}), [], 'non-string label yields no terms rather than throwing');
  eq(
    normaliseAllergyLabel('Adverse drug reaction'),
    [],
    'a label that names no substance at all yields NO terms (never a term like "reaction" that would match the whole record)'
  );
  eq(normaliseAllergyLabel('Allergy'), [], 'a bare "Allergy" label yields no terms');
}

console.log('\n--- parseDayTitle ---');
{
  assert(parseDayTitle('Thu 02 Jul 2026') === '2026-07-02', 'confirmed "DayName DD Mon YYYY" format parses to ISO');
  assert(parseDayTitle('Mon 12 Jun 2006') === '2006-06-12', 'a second real-format title parses');
  assert(parseDayTitle('02 Jul 2026') === '2026-07-02', 'defensive: parses even without the day name');
  assert(parseDayTitle('Thu 2 July 2026') === '2026-07-02', 'defensive: single-digit day and full month name');
  assert(parseDayTitle('Thu 32 Jul 2026') === null, 'an impossible day number yields null, never a nonsense date');
  assert(parseDayTitle('Thu 02 Xyz 2026') === null, 'an unknown month yields null');
  assert(parseDayTitle('recently') === null, 'unparseable text yields null');
  assert(parseDayTitle(null) === null, 'null title yields null');
  assert(parseDayTitle(12345) === null, 'non-string title yields null');
}

console.log('\n--- extractDayGroups ---');
{
  eq(
    extractDayGroups({ patientJournalRecords: [{ title: 'a' }] }),
    [{ title: 'a' }],
    'reads the confirmed patientJournalRecords key'
  );
  eq(extractDayGroups([{ title: 'a' }]), [{ title: 'a' }], 'accepts a bare array of day groups');
  eq(extractDayGroups(null), [], 'null payload yields no day groups');
  eq(extractDayGroups('nope'), [], 'string payload yields no day groups');
  eq(extractDayGroups({ patientJournalRecords: 'nope' }), [], 'non-array patientJournalRecords yields no day groups');
  eq(extractDayGroups({ journal: [{ title: 'a' }] }), [], 'the pre-confirmation guess keys are deliberately NOT read');
}

console.log('\n--- REACTION_TERMS lexicon ---');
{
  assert(
    Array.isArray(REACTION_TERMS) && REACTION_TERMS.length > 20,
    'the curated reaction lexicon is exported as a non-trivial array'
  );
  ['rash', 'urticaria', 'anaphylaxis', 'angioedema', 'shortness of breath', 'felt unwell', 'intolerance'].forEach(
    (t) => {
      assert(REACTION_TERMS.indexOf(t) !== -1, `lexicon contains "${t}"`);
    }
  );
  assert(
    REACTION_TERMS.length === new Set(REACTION_TERMS).size,
    'the lexicon has no duplicate terms (a duplicate would double-count in matchedReactionTerms)'
  );
}

console.log('\n--- findEvidence: tiers, source types, ordering, provenance ---');
{
  const res = findEvidence('Allergy to amoxicillin', mainJournal());

  eq(res.substanceTerms, ['amoxicillin'], 'substanceTerms echoes the normalised label');
  assert(
    res.evidence.length === 6,
    `six evidence items found, retracted/draft entries excluded (got ${res.evidence.length})`
  );

  const scores = res.evidence.map((e) => e.score);
  eq(scores, [3, 3, 2, 1, 1, 1], 'sorted by score descending');

  const dates = res.evidence.map((e) => e.date);
  eq(
    dates,
    ['2006-06-12', '2017-02-08', '2018-05-19', '2017-01-06', '2017-07-03', '2017-09-21'],
    'within each score tier, earliest date first'
  );

  const top = res.evidence[0];
  assert(top.score === 3, 'substance + reaction within the proximity window scores 3');
  assert(top.sourceType === 'encounter-entry', 'a nested encounter note is labelled encounter-entry');
  assert(
    top.isGp2gpImport === true,
    'evidence inside a "Data Transferred from other system" encounter is flagged as an import'
  );
  assert(
    top.recordedBy === 'User Previous Practice',
    'the importing user is reported verbatim (the UI must caveat it, not the engine)'
  );
  assert(top.recordedByOrganisation === 'Old Mill Surgery', 'recordedByOrganisation is carried through');
  eq(top.matchedSubstanceTerms, ['amoxicillin'], 'matched substance terms reported');
  eq(top.matchedReactionTerms, ['swelling'], 'matched reaction terms reported');

  const second = res.evidence[1];
  assert(second.score === 3, 'the in-house consultation note also scores 3');
  assert(second.isGp2gpImport === false, 'an ordinary encounter is not flagged as an import');
  assert(
    second.recordedBy === 'Dr Aveline Corbray',
    'nested entry recordedBy is used in preference to the encounter practitioner'
  );
  eq(
    second.matchedReactionTerms,
    ['rash', 'reaction'],
    'reaction terms are aggregated across every searchable field of the entry (note + clinicalCodeDescription)'
  );
  assert(
    second.matchedReactionTerms.indexOf('urticaria') === -1,
    '"urticarial" does not match the lexicon term "urticaria" — matching is word-boundary, not stemmed'
  );

  const tier2 = res.evidence[2];
  assert(tier2.score === 2, 'substance and reaction in different fields of one entry scores 2, not 3');
  eq(tier2.matchedReactionTerms, ['reaction'], 'the reaction term found in clinicalCodeDescription is reported');

  const rx = res.evidence.find((e) => e.sourceType === 'prescription');
  assert(!!rx, 'the prescription is surfaced as exposure corroboration');
  assert(rx.score === 1, 'a prescription of the substance scores 1');
  assert(
    rx.recordedBy === null,
    'prescription recordedBy is reported null — the field is confirmed absent on real prescriptions'
  );
  assert(
    rx.recordedByOrganisation === null,
    'prescription recordedByOrganisation is reported null for the same reason'
  );
  assert(rx.snippet === 'Amoxicillin 500mg capsules', 'the prescription snippet is the product name verbatim');

  const doc = res.evidence.find((e) => e.sourceType === 'document');
  assert(!!doc, 'a document matched on its title is surfaced');
  assert(
    doc.score === 1 && doc.snippet === 'Outpatient letter re amoxicillin',
    'document title match scores 1 and quotes the title'
  );
  assert(doc.recordedBy === 'Dr Wren Ashgrove', 'document recordedBy is carried through');

  const flatNote = res.evidence.find((e) => e.sourceType === 'note');
  assert(!!flatNote && flatNote.score === 1, 'a flat top-level note with no reaction wording scores 1');
  eq(flatNote.matchedReactionTerms, [], 'a substance-only mention reports no reaction terms');

  const allText = JSON.stringify(res.evidence);
  assert(
    allText.indexOf('anaphylaxis') === -1,
    'an isMarkedIncorrect entry is skipped entirely, however strong its text'
  );
  assert(allText.indexOf('collapse') === -1, 'an isDraft item is skipped entirely');
  assert(
    allText.indexOf('Should Never Be Read') === -1,
    'a recordedBy on a prescription is never read, even when present in the payload'
  );

  eq(
    res.provenance,
    {
      date: '2006-06-12',
      dateRaw: 'Mon 12 Jun 2006',
      recordedBy: 'User Previous Practice',
      recordedByOrganisation: 'Old Mill Surgery',
      sourceType: 'encounter-entry',
      isGp2gpImport: true,
    },
    'provenance is the earliest dated evidence item of any tier, carrying its import flag'
  );
  assert(
    !('snippet' in res.provenance),
    'provenance carries no snippet — it can never present unquoted text as a quote'
  );
}

console.log('\n--- findEvidence: proximity window boundary ---');
{
  // 'rash' then a filler run then the substance — the gap between the two
  // match START indices is what the ±window is measured on.
  const gap = (n) => 'x'.repeat(n);
  const near = `rash ${gap(60)} amoxicillin`;
  const far = `rash ${gap(400)} amoxicillin`;
  const payload = (text) => ({ patientJournalRecords: [day('Thu 02 Jul 2026', [flatItem('note', { note: text })])] });

  assert(
    findEvidence('Allergy to amoxicillin', payload(near)).evidence[0].score === 3,
    'a reaction term inside the window scores 3'
  );
  assert(
    findEvidence('Allergy to amoxicillin', payload(far)).evidence[0].score === 2,
    'the same terms far apart in one field score 2'
  );
  assert(
    findEvidence('Allergy to amoxicillin', payload(far), { proximityChars: 500 }).evidence[0].score === 3,
    'opts.proximityChars widens the window'
  );
}

console.log('\n--- findEvidence: substance match discipline ---');
{
  const mk = (note) => ({ patientJournalRecords: [day('Thu 02 Jul 2026', [flatItem('note', { note })])] });

  assert(
    findEvidence('Allergy to amoxicillin', mk('Widespread rash after an unknown antibiotic.')).evidence.length === 0,
    'a reaction word with no substance match is not evidence of THIS allergy'
  );
  assert(
    findEvidence('Allergy to amoxicillin', mk('Started co-amoxiclavamoxicillinoid therapy.')).evidence.length === 0,
    'matching is word-boundary — a substring inside a longer word does not match'
  );
  assert(
    findEvidence('Allergy to penicillin', mk('Avoid penicillins in future.')).evidence.length === 1,
    'a simple plural of the substance term still matches'
  );
  assert(
    findEvidence('Allergy to amoxicillin', mk('AMOXICILLIN stopped.')).evidence.length === 1,
    'matching is case-insensitive'
  );
  eq(
    findEvidence('Adverse reaction to amoxicillin trihydrate', mk('Given amoxicillin last winter.')).evidence[0]
      .matchedSubstanceTerms,
    ['amoxicillin'],
    'a head word of a multi-word substance matches even when the full phrase does not'
  );
  assert(
    findEvidence('Allergy to penicillin', mk('Issued Amoxil 500mg.'), { extraSubstanceTerms: ['amoxil'] }).evidence
      .length === 1,
    'opts.extraSubstanceTerms is the brand<->generic bridging injection point'
  );
}

console.log('\n--- findEvidence: snippets are verbatim and length-capped ---');
{
  const filler = 'The patient attended for a routine review of longstanding symptoms. ';
  const longNote = `${filler.repeat(6)}Then developed a florid rash after taking amoxicillin. ${filler.repeat(6)}`;
  const res = findEvidence('Allergy to amoxicillin', {
    patientJournalRecords: [day('Thu 02 Jul 2026', [flatItem('note', { note: longNote })])],
  });
  const snip = res.evidence[0].snippet;

  assert(longNote.length > DEFAULT_SNIPPET_CHARS, 'the fixture note is longer than the snippet cap (precondition)');
  assert(
    snip.length <= DEFAULT_SNIPPET_CHARS,
    `snippet is capped at ${DEFAULT_SNIPPET_CHARS} chars including ellipses (got ${snip.length})`
  );
  assert(snip.startsWith('…') && snip.endsWith('…'), 'both cut ends are ellipsised');
  const inner = snip.slice(1, -1);
  assert(longNote.indexOf(inner) !== -1, 'the snippet body is a VERBATIM slice of the source text — never paraphrased');
  assert(inner.indexOf('amoxicillin') !== -1, 'the snippet is centred on the substance match');
  assert(inner.indexOf('rash') !== -1, 'the surrounding reaction wording survives inside the window');

  const short = findEvidence('Allergy to amoxicillin', {
    patientJournalRecords: [day('Thu 02 Jul 2026', [flatItem('note', { note: 'Rash from amoxicillin.' })])],
  });
  assert(
    short.evidence[0].snippet === 'Rash from amoxicillin.',
    'a short source field is quoted whole, with no ellipses'
  );

  // buildSnippet directly — the pieces the UI will size a column against.
  assert(buildSnippet('abcdef', 3, 1, 240) === 'abcdef', 'buildSnippet returns short text unchanged');
  const capped = buildSnippet('y'.repeat(100) + 'TARGET' + 'z'.repeat(100), 100, 6, 40);
  assert(capped.length === 40, 'buildSnippet honours an explicit maxChars, ellipses included');
  assert(capped.indexOf('TARGET') !== -1, 'buildSnippet keeps the match inside the window');
}

console.log('\n--- findEvidence: cap and ordering of undated evidence ---');
{
  const days = [];
  for (let i = 0; i < 30; i++) {
    days.push(
      day(`Thu ${String((i % 28) + 1).padStart(2, '0')} Jul 2020`, [flatItem('note', { note: 'Amoxicillin again.' })])
    );
  }
  const res = findEvidence('Allergy to amoxicillin', { patientJournalRecords: days });
  assert(
    res.evidence.length === MAX_EVIDENCE_ITEMS,
    `output is capped at ${MAX_EVIDENCE_ITEMS} items (got ${res.evidence.length})`
  );
  assert(
    findEvidence('Allergy to amoxicillin', { patientJournalRecords: days }, { maxItems: 3 }).evidence.length === 3,
    'opts.maxItems overrides the cap'
  );

  const mixed = findEvidence('Allergy to amoxicillin', {
    patientJournalRecords: [
      day(null, [flatItem('note', { note: 'Amoxicillin, date unknown.' })]),
      day('Thu 02 Jul 2026', [flatItem('note', { note: 'Amoxicillin recorded.' })]),
    ],
  });
  eq(
    mixed.evidence.map((e) => e.date),
    ['2026-07-02', null],
    'undated evidence sorts last within its tier'
  );
  assert(
    mixed.evidence[1].dateRaw === null,
    'an unparseable/absent day title leaves dateRaw null rather than inventing one'
  );
  assert(mixed.provenance.date === '2026-07-02', 'provenance only ever picks a DATED item');
}

console.log('\n--- findEvidence: provenance edge cases ---');
{
  const undatedOnly = findEvidence('Allergy to amoxicillin', {
    patientJournalRecords: [day('sometime', [flatItem('note', { note: 'Amoxicillin.' })])],
  });
  assert(undatedOnly.evidence.length === 1, 'an undated day group still yields evidence');
  assert(undatedOnly.evidence[0].dateRaw === 'sometime', 'the raw day title is always carried through verbatim');
  assert(undatedOnly.provenance === null, 'provenance is null when nothing dated was found');

  // The earliest item is deliberately pushed past the cap: provenance is
  // computed before truncation, so the origin event survives.
  const days = [day('Mon 01 Jan 2001', [flatItem('note', { note: 'Amoxicillin first mentioned.' })])];
  for (let i = 0; i < 40; i++) {
    days.push(
      day(`Thu ${String((i % 28) + 1).padStart(2, '0')} Jul 2020`, [flatItem('note', { note: 'Amoxicillin again.' })])
    );
  }
  const capped = findEvidence('Allergy to amoxicillin', { patientJournalRecords: days });
  assert(capped.evidence.length === MAX_EVIDENCE_ITEMS, 'the cap still applies (precondition)');
  assert(capped.provenance.date === '2001-01-01', 'provenance is computed over ALL evidence, before the output cap');
}

console.log('\n--- findEvidence: fail-soft on malformed input ---');
{
  const empty = (res, msg) => {
    assert(Array.isArray(res.evidence) && res.evidence.length === 0 && res.provenance === null, msg);
  };

  empty(findEvidence('Allergy to amoxicillin', null), 'null payload returns an empty result, not an exception');
  empty(findEvidence('Allergy to amoxicillin', undefined), 'undefined payload returns an empty result');
  empty(findEvidence('Allergy to amoxicillin', 'nonsense'), 'string payload returns an empty result');
  empty(findEvidence('Allergy to amoxicillin', 42), 'number payload returns an empty result');
  empty(findEvidence('Allergy to amoxicillin', {}), 'payload with no patientJournalRecords returns an empty result');
  empty(
    findEvidence('Allergy to amoxicillin', { patientJournalRecords: null }),
    'null patientJournalRecords returns an empty result'
  );

  eq(
    findEvidence('Allergy to amoxicillin', null).substanceTerms,
    ['amoxicillin'],
    'substanceTerms is still returned on a garbage payload'
  );

  const ragged = {
    patientJournalRecords: [
      null,
      'nope',
      { title: 'Thu 02 Jul 2026', items: null },
      { title: 'Thu 02 Jul 2026', items: 'nope' },
      {
        items: [
          null,
          'nope',
          { type: 'note' }, // no data at all
          { type: 'note', data: null },
          { type: 'encounter', data: null },
          { type: 'encounter', data: { consultationTopics: null } },
          {
            type: 'encounter',
            data: {
              consultationTopics: [
                null,
                { headings: null },
                { headings: [null, { entries: null }, { entries: [null, {}] }] },
              ],
            },
          },
          { type: 'prescription', data: { productName: 42, dosageText: [] } },
        ],
      },
    ],
  };
  let threw = false;
  let raggedRes;
  try {
    raggedRes = findEvidence('Allergy to amoxicillin', ragged);
  } catch (_) {
    threw = true;
  }
  assert(!threw, 'a deeply ragged payload never throws');
  assert(raggedRes.evidence.length === 0, 'a deeply ragged payload yields no evidence');

  // A ragged payload must not stop the GOOD entries beside it being found.
  const mixed = JSON.parse(JSON.stringify(ragged));
  mixed.patientJournalRecords.push(day('Thu 02 Jul 2026', [flatItem('note', { note: 'Rash after amoxicillin.' })]));
  const mixedRes = findEvidence('Allergy to amoxicillin', mixed);
  assert(
    mixedRes.evidence.length === 1 && mixedRes.evidence[0].score === 3,
    'malformed siblings do not lose a good entry'
  );

  const noLabel = findEvidence(null, mainJournal());
  eq(noLabel.substanceTerms, [], 'a null allergy label yields no substance terms');
  empty(noLabel, 'a null allergy label yields no evidence rather than matching everything');
  empty(findEvidence('', mainJournal()), 'an empty allergy label yields no evidence');
  empty(findEvidence('Adverse drug reaction', mainJournal()), 'a substance-less allergy label yields no evidence');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
