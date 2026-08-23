// Medicus Suite — reception-pathways.json structural integrity guard
// Run with: node test-reception-pathways.js
//
// The reception capture pathways are clinical-adjacent content used by
// non-clinical staff: a malformed pathway fails silently in the UI (a missing
// red flag is simply never asked). This guard keeps the file structurally
// sound so content edits can't drop required pieces unnoticed.

'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  OK  ${msg}`); passed++; }
  else { console.error(`  FAIL  ${msg}`); failed++; process.exitCode = 1; }
}

const doc = JSON.parse(fs.readFileSync(path.join(__dirname, 'rules', 'reception-pathways.json'), 'utf8'));

console.log('--- top-level metadata ---');
check(/^\d{4}-\d{2}-\d{2}$/.test(doc.lastUpdated || ''), 'lastUpdated is an ISO date');
check(typeof doc.specVersion === 'string' && doc.specVersion.length > 0, 'specVersion present');
check(typeof doc.sourceNotes === 'string' && doc.sourceNotes.length > 0, 'sourceNotes present');
check(doc.escalations && typeof doc.escalations['999'] === 'string' && doc.escalations['999'].length > 0, 'escalations["999"] text present');
check(doc.escalations && typeof doc.escalations['duty'] === 'string' && doc.escalations['duty'].length > 0, 'escalations["duty"] text present');

console.log('\n--- closing questions ---');
const VALID_TYPES = new Set(['yesno', 'text', 'choice', 'multi']);
check(Array.isArray(doc.closingQuestions) && doc.closingQuestions.length >= 3, 'closingQuestions present (>=3)');
// v1.6: caller-vs-patient capture. Load-bearing for safeguarding and for any
// later age-confirmation rule — asked first because it frames every later answer.
const qCaller = (doc.closingQuestions || []).find(q => q.id === 'caller');
check(!!qCaller, 'closing question "caller" (patient vs someone calling on their behalf) exists');
check(qCaller && qCaller.type === 'text', 'closing question "caller" is free text');
check(qCaller && /patient|behalf/i.test(qCaller.ask), 'closing question "caller" asks patient-vs-on-their-behalf');
check((doc.closingQuestions || [])[0] && doc.closingQuestions[0].id === 'caller', 'closing question "caller" is asked first');
for (const q of doc.closingQuestions || []) {
  check(q.id && q.ask && VALID_TYPES.has(q.type), `closing question "${q.id}" has id/ask/valid type`);
  if (q.type === 'choice' || q.type === 'multi') {
    check(Array.isArray(q.options) && q.options.length >= 2, `closing question "${q.id}" has >=2 options`);
  }
}

console.log('\n--- pathways ---');
check(Array.isArray(doc.pathways) && doc.pathways.length >= 13, `>=13 pathways (found ${doc.pathways?.length})`);
check((doc.pathways || []).some(p => p.id === 'general'), 'catch-all "general" pathway exists');

const seenIds = new Set();
for (const p of doc.pathways || []) {
  check(!!p.id && !seenIds.has(p.id), `pathway id "${p.id}" unique`);
  seenIds.add(p.id);
  check(typeof p.title === 'string' && p.title.length > 0, `[${p.id}] title present`);
  check(Array.isArray(p.sources) && p.sources.length >= 1, `[${p.id}] sources cited`);

  // Red flags: the safety-critical part. Every pathway must screen, and every
  // flag must carry a valid escalation level.
  check(Array.isArray(p.redFlags) && p.redFlags.length >= 5, `[${p.id}] >=5 red flags (found ${p.redFlags?.length})`);
  const rfIds = new Set();
  for (const rf of p.redFlags || []) {
    check(!!rf.id && !rfIds.has(rf.id), `[${p.id}] red flag id "${rf.id}" unique within pathway`);
    rfIds.add(rf.id);
    check(typeof rf.ask === 'string' && rf.ask.length > 10, `[${p.id}/${rf.id}] ask text present`);
    check(rf.escalate === '999' || rf.escalate === 'duty', `[${p.id}/${rf.id}] escalate is 999|duty`);
  }

  check(Array.isArray(p.questions) && p.questions.length >= 3, `[${p.id}] >=3 history questions`);
  const qIds = new Set();
  for (const q of p.questions || []) {
    check(!!q.id && !qIds.has(q.id), `[${p.id}] question id "${q.id}" unique within pathway`);
    qIds.add(q.id);
    check(typeof q.ask === 'string' && q.ask.length > 0, `[${p.id}/${q.id}] ask present`);
    check(VALID_TYPES.has(q.type), `[${p.id}/${q.id}] type valid (${q.type})`);
    if (q.type === 'choice' || q.type === 'multi') {
      check(Array.isArray(q.options) && q.options.length >= 2, `[${p.id}/${q.id}] >=2 options`);
    }
  }

  if (p.pharmacyFirst) {
    check(typeof p.pharmacyFirst.note === 'string' && p.pharmacyFirst.note.length > 0, `[${p.id}] pharmacyFirst note present`);
    check(p.pharmacyFirst.ageMin == null || Number.isFinite(p.pharmacyFirst.ageMin), `[${p.id}] pharmacyFirst.ageMin numeric`);
    check(p.pharmacyFirst.ageMax == null || Number.isFinite(p.pharmacyFirst.ageMax), `[${p.id}] pharmacyFirst.ageMax numeric`);
  }
}

// ── 2026-07-11 Keeper: content-level regression locks ────────────────────────
console.log('\n--- 2026-07-11 Keeper: content regression locks ---');

// Sinusitis pathway
const sinusitis = doc.pathways.find(p => p.id === 'sinusitis');
check(!!sinusitis, 'sinusitis pathway exists');
check(sinusitis && sinusitis.pharmacyFirst && sinusitis.pharmacyFirst.ageMin === 12, 'sinusitis pharmacyFirst ageMin = 12');

// Backpain cauda equina — difficulty initiating micturition
const backpain = doc.pathways.find(p => p.id === 'backpain');
const rfBladder = backpain && (backpain.redFlags || []).find(rf => rf.id === 'rf-bladder');
check(!!rfBladder, 'backpain rf-bladder red flag exists');
check(rfBladder && /difficulty starting/i.test(rfBladder.ask), 'backpain rf-bladder mentions "difficulty starting to pass urine" (cauda equina addition)');

// Feverish child — bulging fontanelle
const feverishChild = doc.pathways.find(p => p.id === 'feverish-child');
const rfFontanelle = feverishChild && (feverishChild.redFlags || []).find(rf => rf.id === 'rf-fontanelle');
check(!!rfFontanelle, 'feverish-child rf-fontanelle red flag exists');
check(rfFontanelle && rfFontanelle.escalate === '999', 'rf-fontanelle escalates to 999');
check(rfFontanelle && /bulging|fontanelle/i.test(rfFontanelle.ask), 'rf-fontanelle ask mentions bulging fontanelle');

// Cough — weight loss as red flag
const cough = doc.pathways.find(p => p.id === 'cough');
const rfWeightloss = cough && (cough.redFlags || []).find(rf => rf.id === 'rf-weightloss');
check(!!rfWeightloss, 'cough rf-weightloss red flag exists (was question, now red flag)');
check(rfWeightloss && rfWeightloss.escalate === 'duty', 'rf-weightloss escalates to duty');

// Headache — GCA split into visual (999) and non-visual (duty)
const headache = doc.pathways.find(p => p.id === 'headache');
const rfNew50Visual = headache && (headache.redFlags || []).find(rf => rf.id === 'rf-new50-visual');
const rfNew50 = headache && (headache.redFlags || []).find(rf => rf.id === 'rf-new50');
check(!!rfNew50Visual, 'headache rf-new50-visual (GCA with visual threat) exists');
check(rfNew50Visual && rfNew50Visual.escalate === '999', 'rf-new50-visual escalates to 999');
check(!!rfNew50, 'headache rf-new50 (GCA without visual threat) still exists');
check(rfNew50 && rfNew50.escalate === 'duty', 'rf-new50 escalates to duty');

// ── 2026-07-25 Keeper: 5 new red flags (NG12 2WW + raised ICP) ──────────────
console.log('\n--- 2026-07-25 Keeper: new red flag content locks ---');

// rf-morning-vomit: headache pathway, 999 — raised ICP (NICE CKS Headache, progressive morning headache + vomiting)
const rfMorningVomit = headache && (headache.redFlags || []).find(rf => rf.id === 'rf-morning-vomit');
check(!!rfMorningVomit, 'headache rf-morning-vomit red flag exists');
check(rfMorningVomit && rfMorningVomit.escalate === '999', 'rf-morning-vomit escalates to 999');
check(rfMorningVomit && /morning|sleep|worsening/i.test(rfMorningVomit.ask), 'rf-morning-vomit ask mentions morning/sleep/worsening');

// ── 2026-08-18 Keeper: sore-throat unwell-child → 999; headache household CO ──
console.log('\n--- 2026-08-18 Keeper: pathway red-flag updates ---');
const soreThroat = doc.pathways.find(p => p.id === 'sore-throat');
const rfUnwellChild = soreThroat && (soreThroat.redFlags || []).find(rf => rf.id === 'rf-unwell-child');
check(!!rfUnwellChild, 'sore-throat rf-unwell-child red flag exists');
check(rfUnwellChild && rfUnwellChild.escalate === '999', 'sore-throat rf-unwell-child escalates to 999 (CKS May 2026 floppy/not drinking)');
check(rfUnwellChild && /floppy|not drinking/i.test(rfUnwellChild.ask), 'sore-throat rf-unwell-child ask mentions floppy / not drinking');

const rfHouseholdCo = headache && (headache.redFlags || []).find(rf => rf.id === 'rf-household-co');
check(!!rfHouseholdCo, 'headache rf-household-co red flag exists');
check(rfHouseholdCo && rfHouseholdCo.escalate === '999', 'headache rf-household-co escalates to 999');
check(rfHouseholdCo && /household|carbon monoxide/i.test(rfHouseholdCo.ask), 'headache rf-household-co ask mentions household / carbon monoxide');

// rf-nasal-unilateral: sinusitis pathway, duty — unilateral nasal obstruction (NICE NG12 ENT 2WW)
const sinusitisP = doc.pathways.find(p => p.id === 'sinusitis');
const rfNasalUnilateral = sinusitisP && (sinusitisP.redFlags || []).find(rf => rf.id === 'rf-nasal-unilateral');
check(!!rfNasalUnilateral, 'sinusitis rf-nasal-unilateral red flag exists');
check(rfNasalUnilateral && rfNasalUnilateral.escalate === 'duty', 'rf-nasal-unilateral escalates to duty');
check(rfNasalUnilateral && /one side|unilateral/i.test(rfNasalUnilateral.ask), 'rf-nasal-unilateral ask mentions one side/unilateral');

// rf-skin-lesion: rash pathway, duty — new/changing mole (NICE NG12 melanoma 2WW)
const rashP = doc.pathways.find(p => p.id === 'rash');
const rfSkinLesion = rashP && (rashP.redFlags || []).find(rf => rf.id === 'rf-skin-lesion');
check(!!rfSkinLesion, 'rash rf-skin-lesion red flag exists');
check(rfSkinLesion && rfSkinLesion.escalate === 'duty', 'rf-skin-lesion escalates to duty');
check(rfSkinLesion && /mole|skin mark/i.test(rfSkinLesion.ask), 'rf-skin-lesion ask mentions mole or skin mark');

// rf-haematuria: general pathway, duty — visible haematuria 45+ (NICE NG12 bladder/kidney 2WW)
const generalP = doc.pathways.find(p => p.id === 'general');
const rfHaematuria = generalP && (generalP.redFlags || []).find(rf => rf.id === 'rf-haematuria');
check(!!rfHaematuria, 'general rf-haematuria red flag exists');
check(rfHaematuria && rfHaematuria.escalate === 'duty', 'rf-haematuria escalates to duty');
check(rfHaematuria && /blood in the urine|45/i.test(rfHaematuria.ask), 'rf-haematuria ask mentions blood in urine and age 45');

// rf-hoarseness: general pathway, duty — persistent 3+ weeks (NICE NG12 laryngeal/thyroid 2WW)
const rfHoarseness = generalP && (generalP.redFlags || []).find(rf => rf.id === 'rf-hoarseness');
check(!!rfHoarseness, 'general rf-hoarseness red flag exists');
check(rfHoarseness && rfHoarseness.escalate === 'duty', 'rf-hoarseness escalates to duty');
check(rfHoarseness && /3 weeks|hoarse/i.test(rfHoarseness.ask), 'rf-hoarseness ask mentions 3 weeks and hoarse voice');

// ── 2026-07-28 (plan section B): three new pathways + v1.6 schema flags ──────
// DRAFT clinical content — pending CSO sign-off. These locks guard the STRUCTURE
// (which is what fails silently); the wording itself is the CSO's call.
console.log('\n--- 2026-07-28: gu-male / gyn-female / mental-health + v1.6 schema flags ---');

// Escalation levels are a closed enum everywhere. No pathway may introduce a
// conditional or third level — a conditional level is how an author quietly
// picks the lower one (plan B.4).
const allRedFlags = (doc.pathways || []).flatMap(p => (p.redFlags || []).map(rf => ({ p: p.id, rf })));
check(
  allRedFlags.every(({ rf }) => rf.escalate === '999' || rf.escalate === 'duty'),
  'no red flag anywhere has an escalate level outside 999|duty'
);
check(
  allRedFlags.every(({ rf }) => rf.safeguarding === undefined || rf.safeguarding === true),
  'safeguarding, where present, is the literal boolean true (never a truthy string/number)'
);
check(
  (doc.pathways || []).every(p => p.sensitive === undefined || p.sensitive === true),
  'sensitive, where present, is the literal boolean true'
);

// gu-male — male GU. NO pharmacyFirst block: male UTI is excluded from the
// Pharmacy First service spec, so a block here would be a routing hazard.
const guMale = doc.pathways.find(p => p.id === 'gu-male');
check(!!guMale, 'gu-male pathway exists');
check(guMale && guMale.pharmacyFirst === undefined, 'gu-male has NO pharmacyFirst block (male UTI excluded from Pharmacy First)');
check(guMale && (guMale.redFlags || []).some(rf => rf.id === 'rf-torsion' && rf.escalate === '999'), 'gu-male rf-torsion escalates to 999 (testicular torsion)');
check(guMale && (guMale.redFlags || []).some(rf => rf.id === 'rf-retention' && rf.escalate === '999'), 'gu-male rf-retention escalates to 999 (acute retention)');
check(guMale && (guMale.redFlags || []).some(rf => rf.id === 'rf-testis-lump' && rf.escalate === 'duty'), 'gu-male rf-testis-lump escalates to duty (NG12 testicular)');
// Added at CSO review 2026-07-28: the two male genital emergencies a non-clinical
// taker cannot be expected to recognise. Both are reachable from this pathway's own
// match terms (foreskin / penis), so their absence was a silent gap, not a scope call.
check(guMale && (guMale.redFlags || []).some(rf => rf.id === 'rf-priapism' && rf.escalate === '999'), 'gu-male rf-priapism escalates to 999 (ischaemic priapism, CSO review 2026-07-28)');
check(guMale && (guMale.redFlags || []).some(rf => rf.id === 'rf-paraphimosis' && rf.escalate === 'duty'), 'gu-male rf-paraphimosis escalates to duty (CSO review 2026-07-28)');

// gyn-female — complements the existing women's UTI pathway; clinician-only, so
// no pharmacyFirst block here either.
const gynFemale = doc.pathways.find(p => p.id === 'gyn-female');
check(!!gynFemale, 'gyn-female pathway exists');
check(gynFemale && gynFemale.pharmacyFirst === undefined, 'gyn-female has NO pharmacyFirst block (clinician-only pathway)');
check(gynFemale && (gynFemale.redFlags || []).some(rf => rf.id === 'rf-ectopic-shoulder' && rf.escalate === '999'), 'gyn-female rf-ectopic-shoulder escalates to 999 (NG126 ectopic)');
check(gynFemale && (gynFemale.redFlags || []).some(rf => rf.id === 'rf-pmb' && rf.escalate === 'duty'), 'gyn-female rf-pmb escalates to duty (NG12 postmenopausal bleeding)');
check(gynFemale && (gynFemale.sources || []).some(s => /NG126/.test(s)), 'gyn-female cites NICE NG126 (ectopic)');
// CSO review 2026-07-28. (1) The drafted pathway screened for NO septic presentation
// at all — septic miscarriage / severe PID / toxic shock would have produced a plain
// "unwell = yes" answer and no escalation banner, while both sibling GU pathways
// screen for it.
{
  const rfSepsis = gynFemale && (gynFemale.redFlags || []).find(rf => rf.id === 'rf-sepsis');
  check(!!rfSepsis && rfSepsis.escalate === '999', 'gyn-female rf-sepsis exists and escalates to 999 (CSO review 2026-07-28)');
}
// (2) The heavy-bleeding flag must stay SPLIT from the passing-tissue one: NICE NG126
// sends instability / significant bleeding straight to A&E but refers stable bleeding
// to early-pregnancy assessment within 24h. Collapsing them 999s ordinary miscarriages
// and re-introduces exactly the conditional-escalation shape the file forbids.
{
  const bleed = gynFemale && (gynFemale.redFlags || []).find(rf => rf.id === 'rf-early-preg-bleed');
  const tissue = gynFemale && (gynFemale.redFlags || []).find(rf => rf.id === 'rf-early-preg-tissue');
  check(!!bleed && bleed.escalate === '999', 'gyn-female rf-early-preg-bleed escalates to 999');
  check(!!bleed && /faint|dizzy|unwell/i.test(bleed.ask), 'rf-early-preg-bleed is the HEAVY/unstable arm (mentions faint/dizzy/unwell)');
  check(!!bleed && !/passing (clots|tissue)/i.test(bleed.ask), 'rf-early-preg-bleed no longer bundles passing clots/tissue into the 999 arm');
  check(!!tissue && tissue.escalate === 'duty', 'gyn-female rf-early-preg-tissue exists and escalates to duty (NG126 EPAU-within-24h arm)');
}

// mental-health — sensitive, safeguarding-flagged, and explicitly non-stratifying.
const mentalHealth = doc.pathways.find(p => p.id === 'mental-health');
check(!!mentalHealth, 'mental-health pathway exists');
check(mentalHealth && mentalHealth.sensitive === true, 'mental-health is marked sensitive:true (no draft autosave; initials mandatory)');
check(mentalHealth && (mentalHealth.redFlags || []).filter(rf => rf.safeguarding === true).length >= 1, 'mental-health has at least one safeguarding:true red flag');
check(
  mentalHealth && (mentalHealth.redFlags || []).every(rf => rf.safeguarding !== true || rf.escalate === 'duty' || rf.escalate === '999'),
  'every safeguarding red flag still carries a normal escalation level (safeguarding is in addition, not instead)'
);
check(mentalHealth && (mentalHealth.sources || []).some(s => /NG225/.test(s)), 'mental-health cites NICE NG225');
check(
  mentalHealth && (mentalHealth.sources || []).some(s => /non-stratif|risk-stratification/i.test(s)),
  'mental-health sources record the NG225 non-stratifying design note'
);
check(mentalHealth && mentalHealth.pharmacyFirst === undefined, 'mental-health has NO pharmacyFirst block');
// The two general-pathway mental-health flags live in BOTH places on purpose —
// callers do not announce the right pathway.
for (const id of ['rf-mentalhealth-attempt', 'rf-mentalhealth']) {
  check(generalP && (generalP.redFlags || []).some(rf => rf.id === id), `general still carries "${id}" (kept in both pathways deliberately)`);
  check(mentalHealth && (mentalHealth.redFlags || []).some(rf => rf.id === id), `mental-health also carries "${id}"`);
  // CSO review 2026-07-28: "duplicated" has to mean IDENTICAL. Two copies of a
  // self-harm question that drift apart give two different escalation prompts for
  // the same caller depending on which tile reception happened to open — and the
  // third-person wording of these two is accepted only BECAUSE the identical-text
  // property is load-bearing. Pin the text, not just the id.
  const a = generalP && (generalP.redFlags || []).find(rf => rf.id === id);
  const b = mentalHealth && (mentalHealth.redFlags || []).find(rf => rf.id === id);
  check(!!a && !!b && a.ask === b.ask, `"${id}" ask text is IDENTICAL in general and mental-health`);
  check(!!a && !!b && a.escalate === b.escalate, `"${id}" escalation level is IDENTICAL in general and mental-health`);
}
// The plan's conditional drafts must be SPLIT, never collapsed into one flag.
for (const [hi, lo] of [['rf-selfharm-injury-urgent', 'rf-selfharm-not-urgent'], ['rf-psychosis-acute', 'rf-psychosis-present']]) {
  const a = mentalHealth && (mentalHealth.redFlags || []).find(rf => rf.id === hi);
  const b = mentalHealth && (mentalHealth.redFlags || []).find(rf => rf.id === lo);
  check(!!a && a.escalate === '999', `mental-health "${hi}" exists and escalates to 999`);
  check(!!b && b.escalate === 'duty', `mental-health "${lo}" exists and escalates to duty (conditional draft split, not collapsed)`);
}

// specVersion must record the v1.6 additions AND their CSO sign-off. Until
// 2026-07-28 this asserted the DRAFT marker; the sign-off replaced it, and the
// assertion moved with it rather than being deleted — an un-asserted governance
// state is one nobody notices regressing.
check(/v1\.6/.test(doc.specVersion || ''), 'specVersion records the v1.6 additions');
check(/v1\.8/.test(doc.specVersion || ''), 'specVersion records the v1.8 CSO review');
check(/CSO SIGN-OFF RECORDED/i.test(doc.specVersion || ''), 'specVersion records that CSO sign-off was given');
check(/Signed off: Dr D\. Triska/.test(doc.specVersion || ''), 'specVersion names the signing CSO');
check(
  /delegated virtual-Dave agent/i.test(doc.specVersion || ''),
  'the sign-off is provenance-honest about how the review was performed'
);
check(
  !/^Reception capture pathways v1\.8[^.]*\(DRAFT/i.test(doc.specVersion || ''),
  'the CURRENT spec version is not itself marked DRAFT (historical draft markers below it are fine)'
);

// ── 2026-08-23 Keeper gap analysis: fever-adult pathway + feverish-child chemo flag ──
// Gap #1 of the 2026-08-22 gap analysis (NICE CG151 neutropenic sepsis) — PENDING CSO
// sign-off; these locks guard the structure and escalation tiers, the wording is the
// CSO's call.
console.log('\n--- 2026-08-23 Keeper gap analysis: fever-adult + feverish-child chemo flag ---');
const feverAdult = doc.pathways.find(p => p.id === 'fever-adult');
check(!!feverAdult, 'fever-adult pathway exists');
check(feverAdult && feverAdult.pharmacyFirst === undefined, 'fever-adult has NO pharmacyFirst block (clinician-only pathway)');
{
  const rfChemo = feverAdult && (feverAdult.redFlags || []).find(rf => rf.id === 'rf-chemo-fever');
  check(!!rfChemo, 'fever-adult rf-chemo-fever red flag exists (neutropenic sepsis, NICE CG151)');
  check(rfChemo && rfChemo.escalate === '999', 'fever-adult rf-chemo-fever escalates to 999');
  check(rfChemo && /chemotherapy/i.test(rfChemo.ask), 'fever-adult rf-chemo-fever ask mentions chemotherapy');
  check(rfChemo && /do not book|escalate now/i.test(rfChemo.ask), 'fever-adult rf-chemo-fever ask carries the do-not-book instruction');
}
{
  const rfNonblanching = feverAdult && (feverAdult.redFlags || []).find(rf => rf.id === 'rf-nonblanching');
  check(!!rfNonblanching && rfNonblanching.escalate === '999', 'fever-adult rf-nonblanching exists and escalates to 999');
}
// The house shared-flag pattern: rf-sepsis is reused with its usual clinical meaning and
// its ask text must be byte-IDENTICAL to the general pathway's copy — two copies that
// drift apart give two different escalation prompts for the same caller.
{
  const a = generalP && (generalP.redFlags || []).find(rf => rf.id === 'rf-sepsis');
  const b = feverAdult && (feverAdult.redFlags || []).find(rf => rf.id === 'rf-sepsis');
  check(!!a && !!b && a.ask === b.ask, 'fever-adult rf-sepsis ask text is IDENTICAL to general\'s rf-sepsis');
  check(!!b && b.escalate === '999', 'fever-adult rf-sepsis escalates to 999');
}
for (const [id, level] of [['rf-confusion', '999'], ['rf-meningism', '999'], ['rf-immune-other', 'duty'], ['rf-travel', 'duty'], ['rf-fluids', 'duty']]) {
  check(
    feverAdult && (feverAdult.redFlags || []).some(rf => rf.id === id && rf.escalate === level),
    `fever-adult ${id} escalates to ${level}`
  );
}
check(feverAdult && (feverAdult.sources || []).some(s => /CG151/.test(s)), 'fever-adult cites NICE CG151 (neutropenic sepsis)');
// Companion single-flag addition: feverish-child also lacked a chemo flag.
{
  const rfChemoChild = feverishChild && (feverishChild.redFlags || []).find(rf => rf.id === 'rf-chemo-fever');
  check(!!rfChemoChild, 'feverish-child rf-chemo-fever red flag exists (companion addition)');
  check(rfChemoChild && rfChemoChild.escalate === '999', 'feverish-child rf-chemo-fever escalates to 999');
  check(rfChemoChild && /chemotherapy/i.test(rfChemoChild.ask), 'feverish-child rf-chemo-fever ask mentions chemotherapy');
}
check(/v1\.10/.test(doc.specVersion || ''), 'specVersion records the v1.10 additions');

// ── 2026-07-28 (plan section E): disposition routing blocks ──────────────────
// Structural locks only — the guardrail truth table lives in
// test-reception-disposition.js. What matters here is that the five
// clinician-only pathways never acquire a routing block by a content edit: the
// engine would still refuse them (CLINICIAN_ONLY_IDS is frozen in code), but a
// block sitting in the file would misrepresent the shipped clinical intent.
console.log('\n--- 2026-07-28 (plan E): disposition blocks ---');
const CLINICIAN_ONLY = ['mental-health', 'gu-male', 'gyn-female', 'general', 'fever-adult'];
for (const id of CLINICIAN_ONLY) {
  const p = doc.pathways.find(x => x.id === id);
  check(!!p && p.disposition === undefined, `[${id}] has NO disposition block (clinician-only pathway)`);
}
const DISPOSITION_DOMAINS = ['minor_infection', 'msk', 'gu_male', 'gyn_female', 'mental_health', 'other'];
const DESTINATIONS = ['pharmacy_first', 'anp', 'paramedic', 'gp_routine'];
for (const p of doc.pathways || []) {
  if (!p.disposition) continue;
  const d = p.disposition;
  check(DISPOSITION_DOMAINS.indexOf(d.domain) !== -1, `[${p.id}] disposition.domain is a known domain (${d.domain})`);
  check(Array.isArray(d.allowed) && d.allowed.length >= 1, `[${p.id}] disposition.allowed non-empty`);
  check((d.allowed || []).every(x => DESTINATIONS.indexOf(x) !== -1), `[${p.id}] disposition.allowed entries are known destinations`);
  check(d.default === 'gp_routine' || d.default === 'duty', `[${p.id}] disposition.default is gp_routine|duty`);
  check(Array.isArray(d.rules), `[${p.id}] disposition.rules is a list`);
  // A shipped rule suggesting pharmacy_first must be gated on the eligibility
  // check, never on a bare age — the age band lives in the pharmacyFirst block
  // and must not be restated (and drift) in the routing rules.
  for (const r of d.rules || []) {
    check(DESTINATIONS.indexOf(r.suggest) !== -1, `[${p.id}] rule suggests a known destination (${r.suggest})`);
    if (r.suggest === 'pharmacy_first') {
      check(r.when && r.when.pharmacyFirstEligible === true, `[${p.id}] pharmacy_first rule is gated on pharmacyFirstEligible`);
      check(!!p.pharmacyFirst, `[${p.id}] pharmacy_first rule has a pharmacyFirst block to read`);
    }
  }
  // Clinician-only domains must not carry non-clinician destinations even in
  // shipped content (the engine refuses them; the file should not claim them).
  if (['mental_health', 'gu_male', 'gyn_female'].indexOf(d.domain) !== -1) {
    check((d.allowed || []).every(x => x === 'gp_routine'), `[${p.id}] clinician-only domain allows gp_routine only`);
  }
}
check(/v1\.7/.test(doc.specVersion || ''), 'specVersion records the v1.7 disposition additions');

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
