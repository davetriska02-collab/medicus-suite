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
for (const q of doc.closingQuestions || []) {
  check(q.id && q.ask && VALID_TYPES.has(q.type), `closing question "${q.id}" has id/ask/valid type`);
  if (q.type === 'choice' || q.type === 'multi') {
    check(Array.isArray(q.options) && q.options.length >= 2, `closing question "${q.id}" has >=2 options`);
  }
}

console.log('\n--- pathways ---');
check(Array.isArray(doc.pathways) && doc.pathways.length >= 9, `>=9 pathways (found ${doc.pathways?.length})`);
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

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
