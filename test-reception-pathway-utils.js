// Medicus Suite — Reception pathway utils tests
// Run with: node test-reception-pathway-utils.js
//
// Covers validatePathway / sanitisePathway / resolveEffectivePathways — the
// shared code path used by the options editor, the backup import, and the
// reception panel's effective-pathway resolution.

'use strict';

const { validatePathway, sanitisePathway, resolveEffectivePathways, pathwaySchemaPrompt,
        orderTiles, tileColourFor, sanitiseTilePrefs, TILE_COLOUR_KEYS } =
  require('./shared/reception-pathway-utils.js');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  OK  ${msg}`); passed++; }
  else { console.error(`  FAIL  ${msg}`); failed++; process.exitCode = 1; }
}

function goodPathway(over) {
  return Object.assign({
    id: 'test-path',
    title: 'Test pathway',
    appliesTo: 'Adults',
    sources: ['Practice-authored'],
    redFlags: [{ id: 'rf-1', ask: 'Severe difficulty breathing right now?', escalate: '999' }],
    questions: [{ id: 'q-1', ask: 'How long?', type: 'text', label: 'Duration' }],
  }, over || {});
}

// ── validatePathway ───────────────────────────────────────────────────────────
console.log('--- validatePathway ---');
check(validatePathway(goodPathway()).length === 0, 'minimal valid pathway passes');
check(validatePathway(null).length > 0, 'null rejected');
check(validatePathway([]).length > 0, 'array rejected');
check(validatePathway(goodPathway({ id: 'Bad Id!' })).length > 0, 'id with spaces/punctuation rejected');
check(validatePathway(goodPathway({ title: '' })).length > 0, 'empty title rejected');
check(validatePathway(goodPathway({ title: 'x'.repeat(81) })).length > 0, 'over-long title rejected');
check(validatePathway(goodPathway({ redFlags: [] })).length > 0, 'pathway without red flags rejected (safety-critical)');
check(validatePathway(goodPathway({ redFlags: [{ id: 'rf-1', ask: 'too short', escalate: '999' }] })).length > 0, 'red-flag ask under 10 chars rejected');
check(validatePathway(goodPathway({ redFlags: [{ id: 'rf-1', ask: 'A perfectly fine question?', escalate: 'panic' }] })).length > 0, 'invalid escalate level rejected');
check(validatePathway(goodPathway({
  redFlags: [
    { id: 'rf-1', ask: 'A perfectly fine question?', escalate: '999' },
    { id: 'rf-1', ask: 'Another fine question here?', escalate: 'duty' },
  ],
})).length > 0, 'duplicate red-flag ids rejected');
check(validatePathway(goodPathway({ questions: [] })).length > 0, 'pathway without questions rejected');
check(validatePathway(goodPathway({ questions: [{ id: 'q-1', ask: 'Pick', type: 'choice', options: ['only-one'] }] })).length > 0, 'choice with <2 options rejected');
check(validatePathway(goodPathway({ questions: [{ id: 'q-1', ask: 'Pick', type: 'banana' }] })).length > 0, 'unknown question type rejected');
check(validatePathway(goodPathway({ pharmacyFirst: { note: '' } })).length > 0, 'pharmacyFirst without note rejected');
check(validatePathway(goodPathway({ pharmacyFirst: { note: 'ok', ageMin: 'five' } })).length > 0, 'non-numeric ageMin rejected');

// All bundled pathways must pass the shared validator (the editor round-trips them).
const bundled = JSON.parse(require('fs').readFileSync('./rules/reception-pathways.json', 'utf8'));
for (const p of bundled.pathways) {
  check(validatePathway(p).length === 0, `bundled pathway "${p.id}" passes shared validator`);
}

// ── sanitisePathway ───────────────────────────────────────────────────────────
console.log('\n--- sanitisePathway ---');
const dirty = goodPathway({
  __proto__injected: 'x',
  extraField: 'should vanish',
  title: '  Padded title  ',
});
dirty.redFlags[0].surprise = 'gone';
const clean = sanitisePathway(dirty);
check(!('extraField' in clean), 'unknown top-level fields stripped');
check(!('surprise' in clean.redFlags[0]), 'unknown red-flag fields stripped');
check(clean.title === 'Padded title', 'strings trimmed');
check(validatePathway(clean).length === 0, 'sanitised output still valid');

// ── resolveEffectivePathways ──────────────────────────────────────────────────
console.log('\n--- resolveEffectivePathways ---');
const bundledSet = [goodPathway({ id: 'p-a', title: 'A' }), goodPathway({ id: 'p-b', title: 'B' })];

// Default: everything off
let res = resolveEffectivePathways({ bundled: bundledSet, overrides: {}, customPathways: [], enabledPathways: {} });
check(res.enabled.length === 0, 'DEFAULT IS OFF: no enabled pathways without explicit config');
check(res.all.length === 2 && res.all.every(e => e.enabled === false), 'all listed as disabled');

// Disclaimer gate: enabled pathways are suppressed when disclaimerAccepted is not strictly true.
res = resolveEffectivePathways({ bundled: bundledSet, overrides: {}, customPathways: [], enabledPathways: { 'p-a': true }, disclaimerAccepted: false });
check(res.enabled.length === 0, 'disclaimerAccepted:false → enabled is empty (fail-safe)');
check(res.all.find(e => e.pathway.id === 'p-a').enabled === true, 'all listing still shows enabled:true before acceptance (toggles render)');
res = resolveEffectivePathways({ bundled: bundledSet, overrides: {}, customPathways: [], enabledPathways: { 'p-a': true } /* no disclaimerAccepted field */ });
check(res.enabled.length === 0, 'absent disclaimerAccepted defaults to not accepted → empty enabled (fail-safe)');

// Enable one with disclaimer accepted
res = resolveEffectivePathways({ bundled: bundledSet, overrides: {}, customPathways: [], enabledPathways: { 'p-a': true }, disclaimerAccepted: true });
check(res.enabled.length === 1 && res.enabled[0].id === 'p-a', 'only explicitly-enabled pathway active (with disclaimer accepted)');

// Non-true values do not enable (even with disclaimer accepted)
res = resolveEffectivePathways({ bundled: bundledSet, overrides: {}, customPathways: [], enabledPathways: { 'p-a': 'yes', 'p-b': 1 }, disclaimerAccepted: true });
check(res.enabled.length === 0, 'truthy-but-not-true values do NOT enable (strict === true)');

// Valid override replaces bundled
const edited = goodPathway({ id: 'p-a', title: 'A (edited)' });
res = resolveEffectivePathways({ bundled: bundledSet, overrides: { 'p-a': edited }, customPathways: [], enabledPathways: { 'p-a': true }, disclaimerAccepted: true });
check(res.enabled[0].title === 'A (edited)', 'valid override replaces bundled content');
check(res.all.find(e => e.pathway.id === 'p-a').origin === 'edited', 'origin reported as edited');

// Invalid override falls back to bundled, flagged
const broken = goodPathway({ id: 'p-a', redFlags: [] });
res = resolveEffectivePathways({ bundled: bundledSet, overrides: { 'p-a': broken }, customPathways: [], enabledPathways: { 'p-a': true }, disclaimerAccepted: true });
check(res.enabled.length === 1 && res.enabled[0].title === 'A', 'invalid override → bundled original used and still enable-able');
check(res.all.find(e => e.pathway.id === 'p-a').overrideInvalid === true, 'invalid override flagged (overrideInvalid), never silent');
check(res.all.find(e => e.pathway.id === 'p-a').invalid === false, 'bundled fallback itself not marked unusable');

// Custom appended; id clash with bundled is rejected
const custom = goodPathway({ id: 'p-custom', title: 'Custom' });
const clash = goodPathway({ id: 'p-a', title: 'Impostor' });
res = resolveEffectivePathways({
  bundled: bundledSet, overrides: {}, customPathways: [custom, clash],
  enabledPathways: { 'p-custom': true, 'p-a': true },
  disclaimerAccepted: true,
});
check(res.enabled.some(p => p.id === 'p-custom'), 'custom pathway enabled');
check(res.enabled.find(p => p.id === 'p-a').title === 'A', 'custom id-clash cannot shadow a bundled pathway');
check(res.all.find(e => e.pathway.title === 'Impostor').invalid === true, 'clashing custom flagged invalid');

// Invalid custom never reaches enabled set
const badCustom = goodPathway({ id: 'p-bad', questions: [] });
res = resolveEffectivePathways({ bundled: bundledSet, overrides: {}, customPathways: [badCustom], enabledPathways: { 'p-bad': true }, disclaimerAccepted: true });
check(res.enabled.length === 0, 'invalid custom pathway never enabled even if flagged on');

// ── pathwaySchemaPrompt — embedded example must satisfy validatePathway ────────
console.log('\n--- pathwaySchemaPrompt ---');
const prompt = pathwaySchemaPrompt();
check(typeof prompt === 'string' && prompt.length > 100, 'pathwaySchemaPrompt returns a non-trivial string');
const START_MARKER = '--- EXAMPLE JSON ---';
const END_MARKER   = '--- END EXAMPLE ---';
const startIdx = prompt.indexOf(START_MARKER);
const endIdx   = prompt.indexOf(END_MARKER);
check(startIdx !== -1 && endIdx !== -1 && endIdx > startIdx, 'prompt contains EXAMPLE JSON / END EXAMPLE markers');
let exampleErrs = ['markers not found'];
if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
  const jsonText = prompt.slice(startIdx + START_MARKER.length, endIdx).trim();
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
    exampleErrs = validatePathway(parsed);
  } catch (e) {
    exampleErrs = ['JSON.parse failed: ' + e.message];
  }
}
check(exampleErrs.length === 0, 'embedded EXAMPLE JSON in pathwaySchemaPrompt() passes validatePathway (schema stays in sync with validator)');
if (exampleErrs.length > 0) {
  exampleErrs.forEach(e => console.error('    validation error:', e));
}

// ── Tile organisation: orderTiles / tileColourFor / sanitiseTilePrefs ─────────
console.log('\n--- orderTiles ---');
const tp = (id, title) => ({ id, title });
const tiles = [tp('c', 'Cough'), tp('a', 'Asthma'), tp('b', 'Back pain')];

// Manual mode, no prefs → input order preserved.
let ot = orderTiles(tiles, {});
check(ot.map(t => t.id).join(',') === 'c,a,b', 'manual + no order → incoming order preserved');

// Manual mode honours stored order, appends unknown-to-order tiles at the end.
ot = orderTiles(tiles, { sortMode: 'manual', order: ['b', 'c'] });
check(ot.map(t => t.id).join(',') === 'b,c,a', 'manual order honoured; tile absent from order appended last');

// Stored order referencing a removed pathway never injects a phantom tile.
ot = orderTiles(tiles, { sortMode: 'manual', order: ['x', 'a'] });
check(ot.map(t => t.id).join(',') === 'a,c,b', 'unknown id in stored order ignored (no phantom)');
check(ot.length === tiles.length, 'manual reconcile never drops or duplicates a tile');

// Alpha mode sorts by title, case-insensitively.
ot = orderTiles([tp('c', 'cough'), tp('a', 'Asthma'), tp('b', 'Back pain')], { sortMode: 'alpha' });
check(ot.map(t => t.id).join(',') === 'a,b,c', 'alpha sorts by title, case-insensitive');
check(ot.length === 3, 'alpha keeps every tile');

// Defensive: non-array input → empty array, no throw.
check(Array.isArray(orderTiles(null, {})) && orderTiles(null, {}).length === 0, 'orderTiles(null) → []');

console.log('\n--- tileColourFor ---');
check(tileColourFor({ colours: { a: 'red' } }, 'a') === 'red', 'returns stored colour');
check(tileColourFor({ colours: { a: 'red' } }, 'b') === 'default', 'unset id → default');
check(tileColourFor({ colours: { a: 'not-a-colour' } }, 'a') === 'default', 'invalid colour → default');
check(tileColourFor(null, 'a') === 'default', 'null prefs → default');
check(TILE_COLOUR_KEYS.indexOf('default') === 0, 'TILE_COLOUR_KEYS leads with default');

console.log('\n--- sanitiseTilePrefs ---');
let sp = sanitiseTilePrefs({ sortMode: 'alpha', order: ['a', 'b', 'a'], colours: { a: 'red', b: 'bad', c: 'blue' } });
check(sp.sortMode === 'alpha', 'valid sortMode kept');
check(sp.order.join(',') === 'a,b', 'order de-duplicated, id-shaped entries kept');
check(sp.colours.a === 'red' && sp.colours.c === 'blue' && sp.colours.b === undefined, 'invalid colour key dropped, valid kept');
sp = sanitiseTilePrefs({ sortMode: 'sideways', colours: { a: 'default' } });
check(sp.sortMode === 'manual', 'unknown sortMode falls back to manual');
check(sp.colours.a === undefined, "'default' colour not stored (absence == default)");
sp = sanitiseTilePrefs(null);
check(sp.sortMode === 'manual' && Array.isArray(sp.order) && sp.order.length === 0, 'null → safe empty prefs');
// Prototype-pollution / non-id keys rejected on shape.
sp = sanitiseTilePrefs({ colours: { '__proto__': 'red', 'bad key': 'blue' } });
check(Object.keys(sp.colours).length === 0, 'non-id-shaped colour keys rejected (prototype-pollution defence)');
// validIds filter restricts to known pathway ids.
sp = sanitiseTilePrefs({ order: ['a', 'b', 'c'], colours: { a: 'red', z: 'blue' } }, new Set(['a', 'b']));
check(sp.order.join(',') === 'a,b', 'validIds Set filters order to known ids');
check(sp.colours.a === 'red' && sp.colours.z === undefined, 'validIds Set filters colour keys to known ids');

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
