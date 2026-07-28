// Medicus Suite — reception disposition routing guardrail tests (plan section E)
// Run with: node test-reception-disposition.js
//
// This is the truth table for "where can this patient safely go?". The engine
// SUGGESTS, a human DECIDES, and every suggestion carries the offer-a-clinician
// fallback line. The failure mode these tests exist for is silent and serious:
// a routing block in editable data (a practice edit, an LLM-authored pack, a
// crafted backup) quietly sending a patient somewhere no clinician agreed to.
//
// Covered here: the precedence order of the guardrails, the adversarial
// clinician-only override fixture, both age floors, the confirmed-age-only
// fail-closed path, Pharmacy First eligibility failing closed, the custom-pack
// attestation gate, the schema's closed vocabularies, what reaches the pasted
// capture text, and the shipped blocks in rules/reception-pathways.json.

'use strict';

const fs = require('fs');
const path = require('path');

(async () => {
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

  const corePath = new URL('side-panel/modules/reception/reception-core.js', `file://${path.resolve(__dirname)}/`).href;

  const {
    evaluateDisposition,
    dispositionCaptureLines,
    overrideDestinations,
    destinationLabel,
    isValidRoutingAttestation,
    buildCaptureText,
    DISPOSITION_FALLBACK_LINE,
    CLINICIAN_ONLY_IDS,
    CLINICIAN_ONLY_DOMAINS,
  } = await import(corePath);

  const PU = require('./shared/reception-pathway-utils.js');
  const doc = JSON.parse(fs.readFileSync(path.join(__dirname, 'rules', 'reception-pathways.json'), 'utf8'));

  // ── Fixtures ───────────────────────────────────────────────────────────────

  const RF = [
    { id: 'rf-a', ask: 'Any difficulty breathing right now?', escalate: '999' },
    { id: 'rf-b', ask: 'Are they unable to swallow their own saliva?', escalate: 'duty' },
  ];
  const ALL_NO = { redFlagPositives: [], redFlagUnanswered: [] };

  function pathway(over) {
    return Object.assign(
      {
        id: 'test-throat',
        title: 'Test throat',
        redFlags: RF,
        questions: [{ id: 'q-1', ask: 'How long?', type: 'text' }],
        pharmacyFirst: { note: 'PF note', ageMin: 5 },
        disposition: {
          domain: 'minor_infection',
          allowed: ['pharmacy_first', 'gp_routine'],
          rules: [{ when: { pharmacyFirstEligible: true }, suggest: 'pharmacy_first' }],
          default: 'gp_routine',
        },
      },
      over || {}
    );
  }

  // A bundled pathway is one whose id the caller passes as bundledId.
  function ctx(over) {
    return Object.assign({ bundledId: 'test-throat', origin: 'bundled', confirmedAge: 30 }, ALL_NO, over || {});
  }

  const GOOD_ATTESTATION = {
    attestedBy: 'Dr A Patel',
    role: 'cso',
    attestedAt: '2026-07-28T09:00:00.000Z',
    scope: 'custom-routing',
  };

  // ── Frozen constants: single source of truth, in lock-step ─────────────────
  console.log('--- frozen clinician-only sets ---');
  check(Object.isFrozen(CLINICIAN_ONLY_IDS) && Object.isFrozen(CLINICIAN_ONLY_DOMAINS), 'core sets are frozen');
  check(
    Object.isFrozen(PU.CLINICIAN_ONLY_IDS) && Object.isFrozen(PU.CLINICIAN_ONLY_DOMAINS),
    'pathway-utils sets are frozen'
  );
  check(
    JSON.stringify(CLINICIAN_ONLY_IDS) === JSON.stringify(PU.CLINICIAN_ONLY_IDS),
    'CLINICIAN_ONLY_IDS identical in reception-core and reception-pathway-utils'
  );
  check(
    JSON.stringify(CLINICIAN_ONLY_DOMAINS) === JSON.stringify(PU.CLINICIAN_ONLY_DOMAINS),
    'CLINICIAN_ONLY_DOMAINS identical in reception-core and reception-pathway-utils'
  );
  check(
    JSON.stringify(CLINICIAN_ONLY_IDS) === JSON.stringify(['mental-health', 'gu-male', 'gyn-female', 'general']),
    'CLINICIAN_ONLY_IDS content pinned'
  );
  check(
    JSON.stringify(CLINICIAN_ONLY_DOMAINS) === JSON.stringify(['mental_health', 'gu_male', 'gyn_female']),
    'CLINICIAN_ONLY_DOMAINS content pinned'
  );

  // ── Schema validation: malformed blocks make the PATHWAY invalid ───────────
  console.log('\n--- schema validation (malformed → pathway invalid) ---');
  check(PU.validatePathway(pathway()).length === 0, 'well-formed disposition block validates');
  const bad = (d, label) => {
    const errs = PU.validatePathway(pathway({ disposition: d }));
    check(errs.length > 0, `${label} → invalid ("${errs[0] || 'NO ERROR'}")`);
  };
  const base = () => ({
    domain: 'minor_infection',
    allowed: ['pharmacy_first', 'gp_routine'],
    rules: [{ when: { pharmacyFirstEligible: true }, suggest: 'pharmacy_first' }],
    default: 'gp_routine',
  });
  bad('minor_infection', 'disposition as a string');
  bad([base()], 'disposition as an array');
  bad(Object.assign(base(), { domain: 'triage' }), 'unknown domain');
  bad(Object.assign(base(), { domain: undefined }), 'missing domain');
  bad(Object.assign(base(), { allowed: ['pharmacy_first', 'ambulance'] }), 'unknown destination in allowed');
  bad(Object.assign(base(), { allowed: [] }), 'empty allowed list');
  bad(Object.assign(base(), { allowed: ['pharmacy_first', 'pharmacy_first', 'gp_routine'] }), 'duplicate destination');
  bad(Object.assign(base(), { default: 'pharmacy_first' }), 'default outside gp_routine/duty');
  bad(Object.assign(base(), { default: undefined }), 'missing default');
  bad(Object.assign(base(), { rules: { when: {} } }), 'rules not a list');
  bad(Object.assign(base(), { rules: [{ when: { isChild: true }, suggest: 'gp_routine' }] }), 'unknown when key');
  bad(Object.assign(base(), { rules: [{ when: {}, suggest: 'gp_routine' }] }), 'empty when object');
  bad(Object.assign(base(), { rules: [{ suggest: 'gp_routine' }] }), 'rule with no when');
  bad(
    Object.assign(base(), { rules: [{ when: { pharmacyFirstEligible: 'yes' }, suggest: 'gp_routine' }] }),
    'non-boolean pharmacyFirstEligible'
  );
  bad(Object.assign(base(), { rules: [{ when: { ageUnder: 5.5 }, suggest: 'gp_routine' }] }), 'fractional ageUnder');
  bad(Object.assign(base(), { rules: [{ when: { ageAtLeast: 999 }, suggest: 'gp_routine' }] }), 'ageAtLeast over 120');
  bad(Object.assign(base(), { rules: [{ when: { ageUnder: '5' }, suggest: 'gp_routine' }] }), 'string age value');
  bad(Object.assign(base(), { rules: [{ when: { ageUnder: 5 }, suggest: 'paramedic' }] }), 'suggest outside allowed');
  bad(
    Object.assign(base(), { rules: [{ when: { ageUnder: 5 }, suggest: 'gp_routine', unless: true }] }),
    'unknown field on a rule'
  );
  bad(Object.assign(base(), { escalateTo: 'duty' }), 'unknown field on the block');
  // gp_routine is always an acceptable suggestion even when not listed in allowed.
  check(
    PU.validatePathway(
      pathway({
        disposition: {
          domain: 'msk',
          allowed: ['anp'],
          rules: [{ when: { ageAtLeast: 18 }, suggest: 'gp_routine' }],
          default: 'gp_routine',
        },
      })
    ).length === 0,
    'suggest "gp_routine" is allowed without being listed in allowed[]'
  );

  console.log('\n--- sanitisePathway carries the block, whitelist-only ---');
  const dirty = pathway({
    disposition: {
      domain: 'minor_infection',
      allowed: ['pharmacy_first', 'gp_routine'],
      rules: [{ when: { pharmacyFirstEligible: true, sneaky: 1 }, suggest: 'pharmacy_first', extra: 'x' }],
      default: 'gp_routine',
      smuggled: 'payload',
    },
  });
  const clean = PU.sanitisePathway(dirty);
  check(!!clean.disposition && clean.disposition.domain === 'minor_infection', 'disposition survives sanitisation');
  check(!('smuggled' in clean.disposition), 'unknown block field dropped');
  check(!('extra' in clean.disposition.rules[0]), 'unknown rule field dropped');
  check(!('sneaky' in clean.disposition.rules[0].when), 'unknown when key dropped');
  check(PU.sanitisePathway(pathway({ disposition: undefined })).disposition === undefined, 'no block → no key added');

  // ── Precedence order — each earlier rule wins ─────────────────────────────
  console.log('\n--- precedence: clinician-only beats everything ---');
  const positives = [{ id: 'rf-a', ask: 'x', escalate: '999' }];

  let r = evaluateDisposition(pathway({ sensitive: true }), ctx({ redFlagPositives: positives }));
  check(r.status === 'none', 'sensitive pathway → status none (no card, no capture line) even with a positive flag');

  r = evaluateDisposition(pathway({ id: 'mental-health' }), ctx({ bundledId: 'mental-health' }));
  check(r.status === 'none', 'mental-health → status none');

  for (const id of ['gu-male', 'gyn-female', 'general']) {
    r = evaluateDisposition(pathway({ id }), ctx({ bundledId: id, redFlagPositives: positives }));
    check(
      r.status === 'withheld' && r.reason === 'clinician-only pathway',
      `${id} → withheld "clinician-only pathway" (beats the red-flag reason)`
    );
  }

  for (const domain of CLINICIAN_ONLY_DOMAINS) {
    r = evaluateDisposition(
      pathway({ disposition: { domain, allowed: ['pharmacy_first'], rules: [], default: 'gp_routine' } }),
      ctx()
    );
    check(r.status === 'withheld' && r.reason === 'clinician-only pathway', `domain ${domain} → withheld`);
  }

  console.log('\n--- precedence: attestation gate, then red flags ---');
  r = evaluateDisposition(pathway({ id: 'custom-thing' }), ctx({ bundledId: null, origin: 'custom' }));
  check(
    r.status === 'withheld' && r.reason === 'custom pathway — routing not signed off',
    'custom pathway with no attestation → withheld (clinician-only by default)'
  );
  r = evaluateDisposition(pathway(), ctx({ origin: 'edited' }));
  check(r.status === 'withheld', 'practice-EDITED bundled pathway with no attestation → withheld');
  r = evaluateDisposition(pathway(), ctx({ origin: 'edited', routingAttestation: GOOD_ATTESTATION }));
  check(
    r.status === 'suggest' && r.destination === 'pharmacy_first',
    'practice-edited pathway WITH a valid CSO sign-off → rules apply'
  );
  r = evaluateDisposition(
    pathway({ id: 'custom-thing' }),
    ctx({ bundledId: null, origin: 'custom', routingAttestation: GOOD_ATTESTATION })
  );
  check(
    r.status === 'suggest' && r.destination === 'pharmacy_first',
    'custom pathway with a valid sign-off → rules apply'
  );
  r = evaluateDisposition(
    pathway({ id: 'custom-thing' }),
    ctx({
      bundledId: null,
      origin: 'custom',
      routingAttestation: Object.assign({}, GOOD_ATTESTATION, { role: 'manager' }),
    })
  );
  check(r.status === 'withheld', 'sign-off by a role other than CSO/partner does NOT unlock routing');

  r = evaluateDisposition(pathway(), ctx({ redFlagPositives: positives }));
  check(
    r.status === 'withheld' && r.reason === 'red flag positive',
    'positive red flag → withheld "red flag positive"'
  );
  r = evaluateDisposition(pathway(), ctx({ redFlagPositives: positives, redFlagUnanswered: ['rf-b'] }));
  check(r.reason === 'red flag positive', 'positive beats unanswered in the recorded reason');
  r = evaluateDisposition(pathway(), ctx({ redFlagUnanswered: ['rf-b'] }));
  check(
    r.status === 'withheld' && r.reason === 'red flags not all answered',
    'unanswered red flag → withheld "red flags not all answered"'
  );
  // Guardrail: the card lives inside the form, where unanswered is the normal
  // starting state — so a fresh form must never show a suggestion.
  r = evaluateDisposition(pathway(), ctx({ redFlagUnanswered: ['rf-a', 'rf-b'], confirmedAge: 30 }));
  check(r.status !== 'suggest', 'a freshly-opened form (nothing answered) shows nothing');

  console.log('\n--- no disposition block → nothing at all ---');
  r = evaluateDisposition(pathway({ disposition: undefined }), ctx());
  check(r.status === 'none', 'pathway without a disposition block → status none');

  // ── Confirmed age: the only age, and it fails closed ──────────────────────
  console.log('\n--- confirmed age only, fail closed ---');
  for (const age of [null, undefined, NaN, 'seven', -1, 121, Infinity]) {
    r = evaluateDisposition(pathway(), ctx({ confirmedAge: age }));
    check(
      r.status === 'suggest' && r.destination === 'gp_routine' && r.reason === 'age unconfirmed — failed closed',
      `confirmedAge ${String(age)} → gp_routine, "age unconfirmed — failed closed"`
    );
  }
  r = evaluateDisposition(pathway(), ctx({ confirmedAge: null }));
  check(/age not confirmed/.test(r.basis), 'unconfirmed age is stated in the basis line, never implied');

  // ── Age floor ─────────────────────────────────────────────────────────────
  console.log('\n--- age floor ---');
  const paedPathway = pathway({
    id: 'test-child',
    pharmacyFirst: { note: 'PF note', ageMin: 1 },
    disposition: {
      domain: 'other',
      allowed: ['pharmacy_first', 'anp', 'paramedic', 'gp_routine'],
      rules: [
        { when: { ageUnder: 5 }, suggest: 'paramedic' },
        { when: { pharmacyFirstEligible: true }, suggest: 'pharmacy_first' },
      ],
      default: 'gp_routine',
    },
  });
  r = evaluateDisposition(paedPathway, ctx({ bundledId: 'test-child', confirmedAge: 0 }));
  check(
    r.status === 'suggest' && r.destination === 'gp_routine' && r.reason === 'age under 1 — clinician only',
    'age 0 → gp_routine, "age under 1 — clinician only" (rules never consulted)'
  );
  r = evaluateDisposition(paedPathway, ctx({ bundledId: 'test-child', confirmedAge: 3 }));
  check(
    r.status === 'suggest' && r.destination === 'pharmacy_first',
    'age 3 → the paramedic rule is skipped by the under-5 floor; the next rule decides'
  );
  const paramedicOnly = pathway({
    id: 'test-msk',
    pharmacyFirst: undefined,
    disposition: {
      domain: 'msk',
      allowed: ['anp', 'paramedic', 'gp_routine'],
      rules: [
        { when: { ageAtLeast: 0 }, suggest: 'paramedic' },
        { when: { ageAtLeast: 0 }, suggest: 'anp' },
      ],
      default: 'gp_routine',
    },
  });
  r = evaluateDisposition(paramedicOnly, ctx({ bundledId: 'test-msk', confirmedAge: 4 }));
  check(
    r.destination === 'gp_routine' && r.reason === 'no rule matched — pathway default',
    'age 4 → both anp and paramedic stripped, falls through to the default'
  );
  r = evaluateDisposition(paramedicOnly, ctx({ bundledId: 'test-msk', confirmedAge: 5 }));
  check(r.destination === 'paramedic', 'age 5 → the under-5 strip no longer applies');

  console.log('\n--- override control obeys the same floor ---');
  check(
    JSON.stringify(overrideDestinations(paramedicOnly, 40)) === JSON.stringify(['anp', 'paramedic', 'gp_routine']),
    'adult → full allowed list offered for override'
  );
  check(
    JSON.stringify(overrideDestinations(paramedicOnly, 3)) === JSON.stringify(['gp_routine']),
    'under 5 → nurse/paramedic not offered as an override either'
  );
  check(
    JSON.stringify(overrideDestinations(paramedicOnly, null)) === JSON.stringify(['gp_routine']),
    'unknown age → override list fails closed'
  );
  check(overrideDestinations({}, 40).indexOf('gp_routine') !== -1, 'a clinician is always offerable');

  // ── Pharmacy First eligibility fails closed ───────────────────────────────
  console.log('\n--- pharmacyFirstEligible fails closed ---');
  r = evaluateDisposition(pathway(), ctx({ confirmedAge: 7 }));
  check(r.destination === 'pharmacy_first', 'inside the PF age band → pharmacy_first');
  r = evaluateDisposition(pathway(), ctx({ confirmedAge: 4 }));
  check(r.destination === 'gp_routine', 'below the PF ageMin → default, never pharmacy_first');
  r = evaluateDisposition(pathway({ pharmacyFirst: undefined }), ctx({ confirmedAge: 30 }));
  check(
    r.destination === 'gp_routine',
    'a pathway with NO pharmacyFirst block can never satisfy pharmacyFirstEligible:true'
  );
  const pfBand = pathway({ pharmacyFirst: { note: 'PF', ageMin: 16, ageMax: 64 } });
  check(
    evaluateDisposition(pfBand, ctx({ confirmedAge: 65 })).destination === 'gp_routine',
    'above PF ageMax → default'
  );
  check(evaluateDisposition(pfBand, ctx({ confirmedAge: 64 })).destination === 'pharmacy_first', 'PF ageMax inclusive');
  check(evaluateDisposition(pfBand, ctx({ confirmedAge: 16 })).destination === 'pharmacy_first', 'PF ageMin inclusive');
  // pharmacyFirstEligible:false is a real condition, not a wildcard.
  const negRule = pathway({
    disposition: {
      domain: 'minor_infection',
      allowed: ['pharmacy_first', 'gp_routine'],
      rules: [{ when: { pharmacyFirstEligible: false }, suggest: 'gp_routine' }],
      default: 'duty',
    },
  });
  check(
    evaluateDisposition(negRule, ctx({ confirmedAge: 4 })).destination === 'gp_routine',
    'when:false matches when ineligible'
  );
  check(
    evaluateDisposition(negRule, ctx({ confirmedAge: 30 })).destination === 'duty',
    'when:false does not match when eligible'
  );

  console.log('\n--- rule ordering and AND semantics ---');
  const anded = pathway({
    disposition: {
      domain: 'minor_infection',
      allowed: ['pharmacy_first', 'gp_routine'],
      rules: [{ when: { pharmacyFirstEligible: true, ageAtLeast: 18 }, suggest: 'pharmacy_first' }],
      default: 'gp_routine',
    },
  });
  check(
    evaluateDisposition(anded, ctx({ confirmedAge: 30 })).destination === 'pharmacy_first',
    'all conditions true → match'
  );
  check(
    evaluateDisposition(anded, ctx({ confirmedAge: 10 })).destination === 'gp_routine',
    'one condition false → no match'
  );
  const ordered = pathway({
    disposition: {
      domain: 'minor_infection',
      allowed: ['pharmacy_first', 'gp_routine'],
      rules: [
        { when: { ageAtLeast: 18 }, suggest: 'gp_routine' },
        { when: { pharmacyFirstEligible: true }, suggest: 'pharmacy_first' },
      ],
      default: 'duty',
    },
  });
  check(
    evaluateDisposition(ordered, ctx({ confirmedAge: 30 })).destination === 'gp_routine',
    'first matching rule wins'
  );

  // ── Adversarial override ──────────────────────────────────────────────────
  console.log('\n--- adversarial override: a mental-health fork claiming domain "other" ---');
  const bundledMH = doc.pathways.find((p) => p.id === 'mental-health');
  check(!!bundledMH, 'bundled mental-health pathway found');
  const evilFork = JSON.parse(JSON.stringify(bundledMH));
  delete evilFork.sensitive; // drop the sensitive marker as well as relabelling
  evilFork.disposition = {
    domain: 'other',
    allowed: ['pharmacy_first'],
    rules: [{ when: { ageAtLeast: 0 }, suggest: 'pharmacy_first' }],
    default: 'gp_routine',
  };
  check(
    PU.validatePathway(evilFork).length === 0,
    'the fork is STRUCTURALLY valid (which is why the engine must not rely on shape)'
  );
  r = evaluateDisposition(evilFork, ctx({ bundledId: 'mental-health', confirmedAge: 30 }));
  check(
    r.status === 'none',
    'fork of mental-health still produces NO routing output (frozen id, applied after override resolution)'
  );
  r = evaluateDisposition(
    evilFork,
    ctx({ bundledId: null, origin: 'custom', confirmedAge: 30, routingAttestation: GOOD_ATTESTATION })
  );
  check(
    r.status === 'none',
    'even re-badged as a signed-off CUSTOM pathway, the id mental-health is still clinician-only'
  );
  const guFork = JSON.parse(JSON.stringify(doc.pathways.find((p) => p.id === 'gu-male')));
  guFork.disposition = { domain: 'other', allowed: ['pharmacy_first'], rules: [], default: 'gp_routine' };
  r = evaluateDisposition(guFork, ctx({ bundledId: 'gu-male', confirmedAge: 30 }));
  check(
    r.status === 'withheld' && r.reason === 'clinician-only pathway',
    'gu-male fork claiming domain "other" → withheld'
  );

  console.log('\n--- resolveEffectivePathways rejects the downgrading override ---');
  const resolved = PU.resolveEffectivePathways({
    bundled: doc.pathways,
    overrides: { 'mental-health': evilFork },
    customPathways: [],
    enabledPathways: { 'mental-health': true },
    disclaimerAccepted: true,
  });
  const mhEntry = resolved.all.find((e) => e.pathway.id === 'mental-health');
  check(mhEntry.overrideInvalid === true, 'downgrading override flagged overrideInvalid');
  check(mhEntry.origin === 'bundled', 'the bundled original stays active');
  check(mhEntry.pathway.sensitive === true, 'the bundled sensitive flag is not lost to the fork');
  check(
    PU.overrideDowngradesDisposition(bundledMH, evilFork) === true,
    'overrideDowngradesDisposition detects it directly'
  );
  // A legitimate edit that keeps the clinician-only posture is still accepted.
  const okFork = JSON.parse(JSON.stringify(bundledMH));
  okFork.title = 'Mental health / emotional distress (practice wording)';
  check(
    PU.overrideDowngradesDisposition(bundledMH, okFork) === false,
    'an edit with no disposition block is not a downgrade'
  );
  const resolvedOk = PU.resolveEffectivePathways({
    bundled: doc.pathways,
    overrides: { 'mental-health': okFork },
    customPathways: [],
    enabledPathways: {},
    disclaimerAccepted: true,
  });
  check(
    resolvedOk.all.find((e) => e.pathway.id === 'mental-health').origin === 'edited',
    'a legitimate practice edit of a clinician-only pathway is still accepted'
  );
  // A non-clinician-only bundled pathway may of course carry routing.
  const soreFork = JSON.parse(JSON.stringify(doc.pathways.find((p) => p.id === 'sore-throat')));
  check(
    PU.overrideDowngradesDisposition(
      doc.pathways.find((p) => p.id === 'sore-throat'),
      soreFork
    ) === false,
    'editing a minor-illness pathway is not a downgrade'
  );

  // ── Attestation shape ─────────────────────────────────────────────────────
  console.log('\n--- routing attestation shape validation ---');
  const attCases = [
    [GOOD_ATTESTATION, true, 'complete CSO sign-off'],
    [Object.assign({}, GOOD_ATTESTATION, { role: 'partner' }), true, 'partner role accepted'],
    [null, false, 'null'],
    [undefined, false, 'undefined'],
    ['yes', false, 'string'],
    [[GOOD_ATTESTATION], false, 'array'],
    [Object.assign({}, GOOD_ATTESTATION, { attestedBy: '' }), false, 'empty name'],
    [Object.assign({}, GOOD_ATTESTATION, { attestedBy: '   ' }), false, 'whitespace name'],
    [Object.assign({}, GOOD_ATTESTATION, { attestedBy: undefined }), false, 'missing name'],
    [Object.assign({}, GOOD_ATTESTATION, { role: 'manager' }), false, 'practice manager role'],
    [Object.assign({}, GOOD_ATTESTATION, { role: 'CSO' }), false, 'role is case-sensitive'],
    [Object.assign({}, GOOD_ATTESTATION, { attestedAt: 'yesterday' }), false, 'non-ISO timestamp'],
    [Object.assign({}, GOOD_ATTESTATION, { attestedAt: 1753689600000 }), false, 'numeric timestamp'],
    [Object.assign({}, GOOD_ATTESTATION, { scope: 'everything' }), false, 'wrong scope'],
    [Object.assign({}, GOOD_ATTESTATION, { scope: undefined }), false, 'missing scope'],
  ];
  for (const [value, want, label] of attCases) {
    check(isValidRoutingAttestation(value) === want, `core: ${label} → ${want}`);
    check(PU.isValidRoutingAttestation(value) === want, `pathway-utils agrees: ${label} → ${want}`);
  }
  check(PU.sanitiseRoutingAttestation(GOOD_ATTESTATION).scope === 'custom-routing', 'sanitise returns the record');
  check(
    PU.sanitiseRoutingAttestation({ attestedBy: 'X', role: 'cso' }) === null,
    'sanitise returns null for a partial record'
  );
  check(
    Object.keys(PU.sanitiseRoutingAttestation(Object.assign({}, GOOD_ATTESTATION, { extra: 1 }))).join(',') ===
      'attestedBy,role,attestedAt,scope',
    'sanitise whitelist-copies (no extra fields)'
  );

  // ── The fallback line is never optional ───────────────────────────────────
  console.log('\n--- fallback line on every suggestion ---');
  check(
    DISPOSITION_FALLBACK_LINE === 'Or a clinician callback if the patient prefers — always offer it.',
    'fallback line text pinned verbatim'
  );
  let suggestCount = 0;
  for (const p of doc.pathways) {
    for (const age of [null, 0, 3, 4, 7, 16, 30, 64, 65, 90]) {
      const res = evaluateDisposition(p, { bundledId: p.id, origin: 'bundled', confirmedAge: age, ...ALL_NO });
      if (res.status === 'suggest') {
        suggestCount++;
        if (res.fallbackLine !== DISPOSITION_FALLBACK_LINE) {
          check(false, `[${p.id}/age ${age}] suggestion missing the fallback line`);
        }
        if (!res.basis) check(false, `[${p.id}/age ${age}] suggestion missing its basis`);
      }
    }
  }
  check(
    suggestCount > 0,
    `every shipped suggestion carries the fallback line and a basis (${suggestCount} suggestions checked)`
  );

  // ── Capture text ──────────────────────────────────────────────────────────
  console.log('\n--- capture text: what the record shows ---');
  const capture = (dispRecord, over) =>
    buildCaptureText(
      Object.assign(
        {
          pathway: pathway(),
          closingQuestions: [],
          escalations: { 999: 'CALL 999.', duty: 'DUTY GP.' },
          ownWords: 'sore throat',
          redFlagAnswers: { 'rf-a': 'no', 'rf-b': 'no' },
          questionAnswers: {},
          closingAnswers: {},
          meta: { nowIso: '2026-07-28T10:00:00Z', disposition: dispRecord },
        },
        over || {}
      )
    );

  const suggestRes = evaluateDisposition(pathway(), ctx({ confirmedAge: 7 }));
  let text = capture(Object.assign({}, suggestRes, { decision: 'confirmed' }));
  check(
    text.includes(
      'Suggested route: Pharmacy First (Test throat, age 7 confirmed, no red flags) — receptionist confirmed'
    ),
    'confirmed suggestion recorded with its basis'
  );
  check(text.includes(DISPOSITION_FALLBACK_LINE), 'the fallback line is in the PASTED TEXT, not just on screen');

  text = capture(
    Object.assign({}, suggestRes, {
      decision: 'overridden',
      overrideTo: 'gp_routine',
      overrideNote: 'caller wants a GP',
    })
  );
  check(
    text.includes('— receptionist overrode to: GP appointment — caller wants a GP'),
    'override and its note recorded'
  );
  text = capture(Object.assign({}, suggestRes, { decision: 'overridden', overrideTo: 'gp_routine' }));
  check(
    text.includes('— receptionist overrode to: GP appointment'),
    'override with no note still records the destination'
  );
  text = capture(suggestRes);
  check(
    text.includes('receptionist decision not recorded'),
    'an undecided suggestion is recorded as undecided, never as agreed'
  );

  for (const reason of [
    'red flag positive',
    'red flags not all answered',
    'clinician-only pathway',
    'custom pathway — routing not signed off',
  ]) {
    const t = capture({ status: 'withheld', reason });
    check(t.includes(`Disposition withheld: ${reason}`), `withheld reason "${reason}" lands in the capture text`);
    check(!t.includes(DISPOSITION_FALLBACK_LINE), `withheld "${reason}" carries no suggestion and no fallback line`);
  }

  const noneText = capture({ status: 'none', reason: 'sensitive pathway — no disposition output' });
  check(!/Suggested route|Disposition withheld/.test(noneText), 'status none writes NOTHING into the capture text');
  const sensitiveRes = evaluateDisposition(pathway({ sensitive: true }), ctx({ confirmedAge: 30 }));
  const sensitiveText = capture(sensitiveRes, { pathway: pathway({ sensitive: true }) });
  check(sensitiveRes.status === 'none', 'sensitive pathway → no card');
  check(
    !/Suggested route|Disposition withheld/.test(sensitiveText),
    'sensitive pathway → no capture line either (no-output posture)'
  );
  check(capture(undefined).indexOf('Suggested route') === -1, 'no disposition record at all → no lines');
  check(dispositionCaptureLines(null).length === 0, 'dispositionCaptureLines(null) → []');

  check(destinationLabel('pharmacy_first') === 'Pharmacy First', 'destination labels are human-readable');
  check(destinationLabel('duty') === 'Duty clinician', 'duty has a label (reachable as a pathway default)');

  // ── Shipped blocks ────────────────────────────────────────────────────────
  console.log('\n--- shipped disposition blocks ---');
  const byId = Object.fromEntries(doc.pathways.map((p) => [p.id, p]));
  for (const p of doc.pathways) {
    check(PU.validatePathway(p).length === 0, `[${p.id}] shipped pathway validates (disposition included)`);
  }
  for (const id of CLINICIAN_ONLY_IDS) {
    check(byId[id] && byId[id].disposition === undefined, `[${id}] ships with NO disposition block (clinician-only)`);
  }
  const EXPECTED_DOMAINS = {
    'sore-throat': 'minor_infection',
    earache: 'minor_infection',
    sinusitis: 'minor_infection',
    urinary: 'minor_infection',
    rash: 'minor_infection',
    cough: 'minor_infection',
    backpain: 'msk',
    'feverish-child': 'other',
    headache: 'other',
  };
  for (const [id, domain] of Object.entries(EXPECTED_DOMAINS)) {
    const d = byId[id] && byId[id].disposition;
    check(!!d && d.domain === domain, `[${id}] domain ${domain}`);
    check(!!d && d.default === 'gp_routine', `[${id}] default gp_routine (conservative)`);
    check(!!d && d.allowed.indexOf('gp_routine') !== -1, `[${id}] gp_routine always allowed`);
  }
  // CSO review 2026-07-28 removed `rash` from this list. The other four pathways'
  // Pharmacy First age bands each map 1:1 onto ONE named PF condition, so the age
  // gate is a fair proxy for eligibility. The rash block's single band stands in for
  // three conditions with different bands, and its match terms also catch cellulitis
  // — which PF does not cover — so an age-only gate would have suggested a pharmacy
  // for a rash the pharmacist cannot treat. pharmacy_first stays SELECTABLE there.
  for (const id of ['sore-throat', 'earache', 'sinusitis', 'urinary']) {
    const d = byId[id].disposition;
    check(
      JSON.stringify(d.rules) ===
        JSON.stringify([{ when: { pharmacyFirstEligible: true }, suggest: 'pharmacy_first' }]),
      `[${id}] pharmacy_first is reachable ONLY through the Pharmacy First eligibility gate`
    );
    check(!!byId[id].pharmacyFirst, `[${id}] has the pharmacyFirst block that gate reads`);
  }
  check(
    JSON.stringify(byId.rash.disposition.rules) === '[]',
    'rash suggests NO automatic Pharmacy First route (CSO review 2026-07-28)'
  );
  check(
    byId.rash.disposition.allowed.indexOf('pharmacy_first') !== -1,
    'rash still ALLOWS pharmacy_first as a receptionist-chosen override'
  );
  check(
    (byId.rash.sources || []).some((s) => /CSO REVIEW 2026-07-28/.test(s)),
    'the rash pathway records why its Pharmacy First rule was removed'
  );
  check(byId.cough.disposition.allowed.indexOf('pharmacy_first') === -1, 'cough cannot suggest Pharmacy First');
  check(byId.backpain.disposition.allowed.indexOf('paramedic') !== -1, 'backpain may suggest a paramedic practitioner');
  check(byId.headache.disposition.allowed.length === 1, 'headache allows gp_routine only');

  console.log('\n--- shipped blocks end to end ---');
  const shipped = (id, age) =>
    evaluateDisposition(byId[id], { bundledId: id, origin: 'bundled', confirmedAge: age, ...ALL_NO });
  check(shipped('sore-throat', 7).destination === 'pharmacy_first', 'sore-throat age 7 → Pharmacy First');
  check(shipped('sore-throat', 4).destination === 'gp_routine', 'sore-throat age 4 (below PF ageMin 5) → GP');
  check(
    shipped('sore-throat', null).reason === 'age unconfirmed — failed closed',
    'sore-throat, no age → GP, failed closed'
  );
  check(shipped('urinary', 30).destination === 'pharmacy_first', 'urinary age 30 → Pharmacy First');
  check(shipped('urinary', 70).destination === 'gp_routine', 'urinary age 70 (outside 16–64) → GP');
  check(shipped('earache', 0).reason === 'age under 1 — clinician only', 'earache age 0 → clinician only');
  check(shipped('feverish-child', 0).destination === 'gp_routine', 'feverish-child age 0 → GP (age floor)');
  check(shipped('feverish-child', 3).destination === 'gp_routine', 'feverish-child age 3 → GP (ANP stripped under 5)');
  check(shipped('backpain', 40).destination === 'gp_routine', 'backpain adult → GP by default (no rules shipped yet)');
  check(shipped('mental-health', 30).status === 'none', 'mental-health → nothing, ever');
  check(shipped('general', 30).status === 'withheld', 'general → withheld (catch-all is clinician-only)');
  check(
    /v1\.7/.test(doc.specVersion) && /v1\.8/.test(doc.specVersion),
    'specVersion records the v1.7 blocks and the v1.8 review that signed them off'
  );
  check(
    /CSO SIGN-OFF RECORDED/i.test(doc.specVersion) && /delegated virtual-Dave agent/i.test(doc.specVersion),
    'the disposition blocks carry a provenance-honest CSO sign-off'
  );
  check(
    shipped('rash', 40).destination === 'gp_routine',
    'rash, adult, no red flags → GP appointment (no automatic Pharmacy First suggestion)'
  );

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) process.exit(1);
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
