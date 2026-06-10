// Medicus Suite — Knowledge utilities tests
// Run with: node test-knowledge-utils.js
//
// Covers validation/sanitisation, the near-duplicate (anti-bloat) title
// matcher, PHI warning heuristics, and that the LLM prompt's embedded example
// JSON actually validates against the schema it describes.

'use strict';

const KU = require('./shared/knowledge-utils.js');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  OK  ${msg}`); passed++; }
  else { console.error(`  FAIL  ${msg}`); failed++; }
}

// ── validateEntry ─────────────────────────────────────────────────────────────
console.log('--- validateEntry ---');
check(KU.validateEntry({ title: 'DN referrals', category: 'contacts' }).length === 0, 'minimal valid entry passes');
check(KU.validateEntry(null).length > 0, 'null entry rejected');
check(KU.validateEntry({ category: 'contacts' }).length > 0, 'missing title rejected');
check(KU.validateEntry({ title: 'x', category: 'Bad Category!' }).length > 0, 'malformed category id rejected');
check(KU.validateEntry({ title: 'x', category: 'c', id: '__proto__' }).length > 0, 'prototype-pollution id shape rejected');
check(KU.validateEntry({ title: 'x', category: 'c', url: 'javascript:alert(1)' }).length > 0, 'non-http(s) url rejected');
check(KU.validateEntry({ title: 'x', category: 'c', url: 'https://nice.org.uk' }).length === 0, 'https url accepted');
check(KU.validateEntry({ title: 'x', category: 'c', tags: ['ok', 5] }).length > 0, 'non-string tag rejected');
check(KU.validateEntry({ title: 'x', category: 'c', reviewBy: '01/12/2026' }).length > 0, 'non-ISO reviewBy rejected');
check(KU.validateEntry({ title: 'x', category: 'c', source: 'chatgpt' }).length > 0, 'unknown source rejected');

// ── sanitiseEntry ─────────────────────────────────────────────────────────────
console.log('\n--- sanitiseEntry ---');
const dirty = {
  title: '  Spinal MRI access  ', category: 'Referrals', body: 'b',
  url: 'not-a-url', tags: [' 2WW ', '', 'x'.repeat(99)],
  source: 'evil', extraField: 'smuggled', reviewed: 'yes',
};
const clean = KU.sanitiseEntry(dirty);
check(clean.title === 'Spinal MRI access' && clean.category === 'referrals', 'trims title, lowercases category');
check(clean.url === '', 'invalid url dropped');
check(clean.tags[0] === '2ww' && clean.tags[1].length === KU.KB_LIMITS.tagLen, 'tags trimmed, lowercased, clamped');
check(!('extraField' in clean), 'unknown fields not copied (whitelist rebuild)');
check(clean.source === 'manual' && clean.reviewed === false, 'unknown source → manual; non-boolean reviewed → false');
check(typeof clean.updatedAt === 'string' && clean.updatedAt.includes('T'), 'updatedAt stamped');

// ── generateEntryId ───────────────────────────────────────────────────────────
console.log('\n--- generateEntryId ---');
const taken = new Set(['cardiology-chest-pain']);
check(KU.generateEntryId('Cardiology — chest pain!', taken) === 'cardiology-chest-pain-2', 'slug + collision suffix');
check(/^entry/.test(KU.generateEntryId('???', new Set())), 'unsluggable title falls back to "entry"');

// ── findSimilar (anti-bloat) ──────────────────────────────────────────────────
console.log('\n--- findSimilar ---');
const items = [
  { id: 'a', title: 'Cardiology — chest pain referral criteria' },
  { id: 'b', title: 'Dermatology — 2WW suspected melanoma' },
  { id: 'c', title: 'District nursing — single point of access' },
];
check(KU.findSimilar('cardiology chest pain', items).length === 1
   && KU.findSimilar('cardiology chest pain', items)[0].item.id === 'a',
   'reworded duplicate caught (boilerplate words ignored)');
check(KU.findSimilar('Referral criteria: chest pain (cardiology)', items)[0]?.item.id === 'a',
   'punctuation/word-order variant caught');
check(KU.findSimilar('Rheumatology — urgent GCA pathway', items).length === 0,
   'distinct topic not flagged');
check(KU.findSimilar('Dermatology — routine acne referral', items).length === 0,
   'same specialty, different topic not flagged');
check(KU.findSimilar('Cardiology — chest pain referral criteria', items, { excludeId: 'a' }).length === 0,
   'excludeId skips the entry being edited');
check(KU.findSimilar('', items).length === 0, 'empty title → no matches');
check(KU.findSimilar('Referral criteria', [{ id: 'x', title: 'Referral criteria' }])[0]?.item.id === 'x',
   'all-boilerplate identical titles still match (stopword fallback)');

// ── phiWarnings ───────────────────────────────────────────────────────────────
console.log('\n--- phiWarnings ---');
check(KU.phiWarnings([{ title: 'Patient John', body: 'NHS no 943 476 5919' }]).length === 1,
   'NHS-number-shaped digits flagged');
check(KU.phiWarnings([{ title: 'DN SPA', body: 'Phone 01234 567890 option 2' }]).length === 0,
   '11-digit phone number not flagged');
check(KU.phiWarnings([{ title: 'x', body: 'include the patient DOB in the form' }]).length === 1,
   'DOB mention flagged');
check(KU.phiWarnings([{ title: 'Dermatology 2WW', body: 'Refer via e-RS.' }]).length === 0,
   'clean entry produces no warnings');

// ── sanitiseCategories ────────────────────────────────────────────────────────
console.log('\n--- sanitiseCategories ---');
const cats = KU.sanitiseCategories([{ id: 'OK-one', name: ' Cat ' }, { id: '__proto__', name: 'bad' }, { id: 'ok-one', name: 'dupe' }, null]);
check(cats.length === 1 && cats[0].id === 'ok-one' && cats[0].name === 'Cat', 'lowercases ids, drops bad/dupe/null');
check(KU.sanitiseCategories([]).length === KU.KB_DEFAULT_CATEGORIES.length, 'empty input → default categories');

// ── kbSchemaPrompt example round-trip ─────────────────────────────────────────
console.log('\n--- kbSchemaPrompt ---');
const prompt = KU.kbSchemaPrompt();
const m = prompt.match(/--- EXAMPLE JSON ---\n([\s\S]*?)\n--- END EXAMPLE ---/);
check(!!m, 'prompt contains delimited example JSON');
if (m) {
  let example = null;
  try { example = JSON.parse(m[1]); } catch (_) {}
  check(!!example && Array.isArray(example.entries) && example.entries.length > 0, 'example JSON parses to { entries: [...] }');
  if (example) {
    const allValid = example.entries.every(e => KU.validateEntry(e).length === 0);
    check(allValid, 'every example entry validates against the schema the prompt describes');
    const knownCats = new Set(KU.KB_DEFAULT_CATEGORIES.map(c => c.id));
    check(example.entries.every(e => knownCats.has(e.category)), 'example entries use the default category ids');
  }
}
check(/Output ONLY a valid JSON/i.test(prompt), 'prompt demands JSON-only output');
check(/NEVER include any patient details/i.test(prompt), 'prompt forbids patient details');
check(/placeholder in square brackets/i.test(prompt), 'prompt forbids invented local numbers (placeholders instead)');

// ── kbSingleEntryPrompt (one card from pasted text) ───────────────────────────
console.log('\n--- kbSingleEntryPrompt ---');
const single = KU.kbSingleEntryPrompt();
check(/ONLY a single valid JSON object/i.test(single), 'single prompt demands one JSON object (no array)');
check(/NEVER include any patient details/i.test(single), 'single prompt forbids patient details');
const sm = single.match(/--- EXAMPLE JSON ---\n([\s\S]*?)\n--- END EXAMPLE ---/);
check(!!sm, 'single prompt contains delimited example JSON');
if (sm) {
  let ex = null;
  try { ex = JSON.parse(sm[1]); } catch (_) {}
  check(!!ex && !Array.isArray(ex) && typeof ex === 'object', 'single example is one object, not an array');
  check(!!ex && KU.validateEntry(ex).length === 0, 'single example validates against the schema');
  check(!!ex && new Set(KU.KB_DEFAULT_CATEGORIES.map(c => c.id)).has(ex.category), 'single example uses a default category id');
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
