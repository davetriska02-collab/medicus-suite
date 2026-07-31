// Medicus Suite — Phrases core + shipped-pack + H-052 wording-control tests
// Run with: node test-phrases-core.js
//
// Pins, in order:
//   1. sanitiseBlock / validateBlock / sanitiseConfig — clamps, whitelist-copy,
//      fail-closed audience, https-only leaflet links, prototype-key rejection
//   2. mergeShippedPack — version gating, tombstones, no-overwrite, idempotence
//   3. composeMessage — fixed slot order, blank-line join, unknown-id tolerance
//   4. searchBlocks — /trigger exact beats prefix beats fuzzy; usage ordering
//   5. THE SHIPPED-PACK CONTRACT — every block in shared/phrases-presets.js
//      validates, ids unique, categories closed. This is what the curated
//      content drop-in is tested against: a malformed pack fails CI, not a user.
//   6. Authoring prompt — schema fields present, reading-age rule stated, and
//      the --- EXAMPLE JSON --- payload parses and validates.
//   7. H-052 wording-control source grep of the module (the
//      test-reception-quick-actions-ui.js pattern): no completion claim in any
//      UI string, the ***-unfilled copy gate exists, audience tags render.

'use strict';

const fs = require('fs');
const path = require('path');

const PC = require('./shared/phrases-core.js');
const { SHIPPED_PACK } = require('./shared/phrases-presets.js');

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

function mkBlock(over) {
  return {
    id: 'test-block',
    title: 'Test block',
    body: 'Body text.',
    trigger: 'test',
    keywords: 'testing',
    category: 'admin',
    audience: 'patient',
    leafletUrl: '',
    slot: 'whole',
    ...over,
  };
}

// ============================================================
// 1. sanitiseBlock / validateBlock / sanitiseConfig
// ============================================================
console.log('1. sanitisers');

check(PC.validateBlock(null).length > 0, 'validateBlock rejects non-objects');
check(PC.validateBlock(mkBlock({ title: '' })).length > 0, 'validateBlock demands a title');
check(PC.validateBlock(mkBlock({ body: '   ' })).length > 0, 'validateBlock demands body text');
check(PC.validateBlock(mkBlock({ audience: 'gp' })).length > 0, 'validateBlock rejects an unknown audience');
check(PC.validateBlock(mkBlock({ slot: 'footer' })).length > 0, 'validateBlock rejects an unknown slot');
check(
  PC.validateBlock(mkBlock({ leafletUrl: 'http://insecure.example' })).length > 0,
  'validateBlock rejects a non-https leaflet link'
);
check(PC.validateBlock(mkBlock()).length === 0, 'validateBlock accepts a well-formed block');

{
  const clean = PC.sanitiseBlock({
    id: 'My ID!',
    title: 'x'.repeat(500),
    body: 'y'.repeat(5000),
    trigger: 'HeLLo World',
    keywords: 'ABC def',
    category: 'Results Normal',
    audience: 'nonsense',
    leafletUrl: 'javascript:alert(1)',
    slot: 'nonsense',
    extraField: 'smuggled',
    __proto__: { evil: 1 },
  });
  check(clean.title.length === PC.PH_LIMITS.title, 'title clamped to limit');
  check(clean.body.length === PC.PH_LIMITS.body, 'body clamped to limit');
  check(clean.id === 'my-id', 'id slugified');
  check(clean.trigger === 'hello-world', 'trigger slugified/lowercased');
  check(clean.keywords === 'abc def', 'keywords lower-cased');
  check(clean.audience === 'note', 'unknown audience fails CLOSED to note (never patient)');
  check(clean.slot === 'whole', 'unknown slot defaults to whole');
  check(clean.leafletUrl === '', 'non-https leaflet link dropped');
  check(!('extraField' in clean), 'unknown fields whitelist-dropped');
  check(Object.keys(clean).length === 9, 'exactly the nine schema fields survive');
}

{
  // Markup is carried inert (escaped at render time), not stripped here.
  const clean = PC.sanitiseBlock(mkBlock({ body: '<script>alert(1)</script>' }));
  check(clean.body === '<script>alert(1)</script>', 'markup carried as inert text (escaped at render)');
}

{
  const cfg = PC.sanitiseConfig({
    version: '3.7',
    usage: { __proto__: 99, constructor: 5, 'good-id': 12.9, bad: -4, ['weird key!']: 3 },
    practiceBlocks: [mkBlock(), { junk: true }, 'not a block'],
    removedShipped: ['Dead-Block', 'dead-block', 42, ''],
  });
  check(cfg.version === 3, 'config version floored to an integer');
  check(cfg.usage['good-id'] === 12, 'usage counts floored');
  check(
    !Object.prototype.hasOwnProperty.call(cfg.usage, 'constructor') &&
      !Object.prototype.hasOwnProperty.call(cfg.usage, '__proto__'),
    'forbidden usage keys rejected (own-property check)'
  );
  check(cfg.usage['weird-key'] === 3, 'usage keys slugified');
  check(cfg.practiceBlocks.length === 1, 'invalid practice blocks dropped');
  check(cfg.removedShipped.join(',') === 'dead-block', 'tombstones slugified + deduped');
  const bad = PC.sanitiseConfig('garbage');
  check(
    bad.version === 0 && Array.isArray(bad.practiceBlocks) && Array.isArray(bad.removedShipped),
    'garbage input yields a usable empty config'
  );
}

check(PC.bumpUsage({}, '__proto__').__proto__ === Object.prototype, 'bumpUsage refuses forbidden ids');
check(PC.bumpUsage({ a: 1 }, 'a').a === 2, 'bumpUsage increments');
check(PC.bumpUsage({ a: PC.PH_LIMITS.usageMax }, 'a').a === PC.PH_LIMITS.usageMax, 'bumpUsage caps');

// ============================================================
// 2. mergeShippedPack — version gate, tombstones, no-overwrite
// ============================================================
console.log('\n2. mergeShippedPack');

const packV2 = {
  version: 2,
  categories: [{ id: 'admin', label: 'Admin' }],
  blocks: [mkBlock({ id: 'ship-a', title: 'Ship A' }), mkBlock({ id: 'ship-b', title: 'Ship B' })],
};

{
  // Fresh install: whole pack arrives.
  const { cfg, changed } = PC.mergeShippedPack(null, packV2);
  check(changed === true, 'fresh config: changed=true');
  check(cfg.version === 2, 'fresh config stamped with pack version');
  check(cfg.practiceBlocks.length === 2, 'fresh config receives the whole pack');
}

{
  // Same version: no-op.
  const { cfg, changed } = PC.mergeShippedPack({ version: 2, practiceBlocks: [] }, packV2);
  check(changed === false, 'same version: changed=false');
  check(cfg.practiceBlocks.length === 0, 'same version: nothing added');
}

{
  // Tombstone survives a bump; user's modified copy of ship-a is NOT overwritten.
  const userA = mkBlock({ id: 'ship-a', title: 'Ship A EDITED BY PRACTICE' });
  const stored = { version: 1, practiceBlocks: [userA], removedShipped: ['ship-b'] };
  const { cfg, changed } = PC.mergeShippedPack(stored, packV2);
  check(changed === true, 'older version: changed=true');
  check(cfg.version === 2, 'version stamped after merge');
  check(!cfg.practiceBlocks.some((b) => b.id === 'ship-b'), 'tombstoned shipped block stays deleted');
  const a = cfg.practiceBlocks.find((b) => b.id === 'ship-a');
  check(a && a.title === 'Ship A EDITED BY PRACTICE', "user's stored block wins over changed shipped wording");
  // Idempotence: a second run changes nothing.
  const again = PC.mergeShippedPack(cfg, packV2);
  check(again.changed === false, 'second run is a no-op');
}

// ============================================================
// 3. composeMessage — slot order, join, tolerance
// ============================================================
console.log('\n3. composeMessage');

{
  const blocks = [
    mkBlock({ id: 'sign', slot: 'signoff', body: 'SIGN' }),
    mkBlock({ id: 'open', slot: 'opener', body: 'OPEN' }),
    mkBlock({ id: 'sn', slot: 'safetynet', body: 'SAFETY' }),
    mkBlock({ id: 'sub', slot: 'substance', body: 'SUBSTANCE' }),
    mkBlock({ id: 'next', slot: 'nextstep', body: 'NEXT' }),
    mkBlock({ id: 'whole1', slot: 'whole', body: 'WHOLE' }),
  ];
  // Selected in reverse click order — output must be slot order regardless.
  const out = PC.composeMessage(['sign', 'sn', 'next', 'sub', 'whole1', 'open'], blocks);
  check(
    out === 'OPEN\n\nWHOLE\n\nSUBSTANCE\n\nSAFETY\n\nNEXT\n\nSIGN',
    'blocks compose in fixed slot order (opener→whole→substance→safetynet→nextstep→signoff), blank-line joined'
  );
  check(PC.composeMessage(['open', 'ghost-id'], blocks) === 'OPEN', 'unknown ids skipped silently');
  check(PC.composeMessage([], blocks) === '', 'empty selection composes to empty string');
  // Two blocks in the SAME slot keep selection order (stable).
  const two = [mkBlock({ id: 'w1', slot: 'whole', body: 'ONE' }), mkBlock({ id: 'w2', slot: 'whole', body: 'TWO' })];
  check(PC.composeMessage(['w2', 'w1'], two) === 'TWO\n\nONE', 'same-slot ties keep selection order');
}

// ============================================================
// 4. searchBlocks — /trigger beats everything; usage ordering
// ============================================================
console.log('\n4. searchBlocks');

{
  const blocks = [
    mkBlock({ id: 'b1', title: 'Normally verbose title', trigger: 'verbose', keywords: '' }),
    mkBlock({ id: 'b2', title: 'Something else', trigger: 'normal', keywords: '' }),
    mkBlock({ id: 'b3', title: 'Normal results message', trigger: 'norm', keywords: 'results' }),
  ];
  // /normal → trigger fast path: exact 'normal' (b2) beats prefix (none), and
  // b1's fuzzy title match ("Normally…") must NOT appear at all.
  const r1 = PC.searchBlocks('/normal', blocks, {});
  check(r1.length === 1 && r1[0].id === 'b2', '/trigger exact match wins and excludes fuzzy title matches');
  // /norm → exact 'norm' (b3) outranks prefix 'normal' (b2).
  const r2 = PC.searchBlocks('/norm', blocks, {});
  check(r2[0].id === 'b3' && r2[1] && r2[1].id === 'b2', '/trigger exact beats trigger prefix');
  // Bare trigger without the slash still wins outright.
  const r3 = PC.searchBlocks('normal', blocks, {});
  check(r3[0].id === 'b2', 'bare exact trigger typed without slash still ranks first');
  // Empty query → usage ordering (most used by me first).
  const r4 = PC.searchBlocks('', blocks, { b3: 9, b1: 2 });
  check(r4.map((b) => b.id).join(',') === 'b3,b1,b2', 'empty query sorts by usage desc, stable for ties');
  // Substring beats subsequence (palette scoring preserved).
  check(PC.scoreMatch('mon', 'Monitoring') > PC.scoreMatch('mon', 'many other nights'), 'substring beats subsequence');
  check(PC.scoreMatch('zzz', 'nothing here') === 0, 'no match scores 0');
}

// ============================================================
// 5. charCount / hasUnfilledPlaceholders
// ============================================================
console.log('\n5. helpers');

check(PC.hasUnfilledPlaceholders('Hello *** there') === true, '*** detected');
check(PC.hasUnfilledPlaceholders('Hello ** there *') === false, 'fewer than three asterisks is not a placeholder');
check(PC.charCount('').chars === 0 && PC.charCount('').smsSegments === 0, 'empty text counts zero');
check(PC.charCount('a'.repeat(160)).smsSegments === 1, '160 chars = 1 SMS segment');
check(PC.charCount('a'.repeat(161)).smsSegments === 2, '161 chars = 2 SMS segments');

// ============================================================
// 6. THE SHIPPED-PACK CONTRACT (curated content drop-in is tested here)
// ============================================================
console.log('\n6. shipped pack (shared/phrases-presets.js) validates wholesale');

{
  check(Number.isInteger(SHIPPED_PACK.version) && SHIPPED_PACK.version >= 1, 'pack version is an integer >= 1');
  const catIds = (SHIPPED_PACK.categories || []).map((c) => c.id);
  const EXPECTED_CATS = [
    'openers',
    'results-normal',
    'results-borderline',
    'conditions',
    'safety-netting',
    'needs-call',
    'admin',
    'sign-offs',
  ];
  check(
    JSON.stringify(catIds) === JSON.stringify(EXPECTED_CATS),
    `pack carries exactly the eight agreed categories (got: ${catIds.join(', ')})`
  );
  check(Array.isArray(SHIPPED_PACK.blocks) && SHIPPED_PACK.blocks.length >= 2, 'pack has blocks');

  const ids = new Set();
  let allValid = true;
  let allCatsKnown = true;
  let allIdsUnique = true;
  const badTitles = [];
  for (const b of SHIPPED_PACK.blocks) {
    const errs = PC.validateBlock(b);
    if (errs.length > 0) {
      allValid = false;
      badTitles.push(`${(b && b.title) || '?'}: ${errs[0]}`);
    }
    if (!catIds.includes(b.category)) allCatsKnown = false;
    if (ids.has(b.id)) allIdsUnique = false;
    ids.add(b.id);
  }
  check(allValid, `every shipped block passes validateBlock${badTitles.length ? ' — ' + badTitles.join('; ') : ''}`);
  check(allCatsKnown, 'every shipped block uses a declared category id');
  check(allIdsUnique, 'shipped block ids are unique');
  // Sanitisation must be a no-op on shipped content — the pack ships clean.
  const roundTrip = SHIPPED_PACK.blocks.every((b) => JSON.stringify(PC.sanitiseBlock(b)) === JSON.stringify({ ...b }));
  check(roundTrip, 'sanitiseBlock is a no-op on every shipped block (pack ships pre-clean)');
}

// ============================================================
// 7. Authoring prompt — schema + style rules + valid example
// ============================================================
console.log('\n7. authoring prompt');

{
  const prompt = PC.phrasesAuthoringPrompt();
  for (const field of [
    '"id"',
    '"title"',
    '"body"',
    '"trigger"',
    '"keywords"',
    '"category"',
    '"audience"',
    '"leafletUrl"',
    '"slot"',
  ]) {
    check(prompt.includes(field), `prompt documents the ${field} field`);
  }
  check(/reading age of 9(–|-)11/i.test(prompt), 'prompt states the NHS reading-age 9–11 rule');
  check(/NEVER include any patient details/i.test(prompt), 'prompt forbids patient details');
  check(
    /\*\*\*/.test(prompt) && /NEVER auto-filled/i.test(prompt.replace(/never auto-filled/i, 'NEVER auto-filled')),
    'prompt explains the *** manual-fill rule'
  );
  const m = prompt.match(/--- EXAMPLE JSON ---\n([\s\S]*?)\n--- END EXAMPLE ---/);
  check(!!m, 'prompt carries the --- EXAMPLE JSON --- block');
  if (m) {
    let ex = null;
    try {
      ex = JSON.parse(m[1]);
    } catch (_) {}
    check(!!ex && Array.isArray(ex.blocks) && ex.blocks.length > 0, 'example JSON parses to { blocks: [...] }');
    check(!!ex && ex.blocks.every((b) => PC.validateBlock(b).length === 0), 'every example block passes validateBlock');
  }
}

// ============================================================
// 8. H-052 wording-control source grep of the module
// ============================================================
console.log('\n8. module wording controls (source grep)');

const modSrc = fs.readFileSync(path.join(__dirname, 'side-panel', 'modules', 'phrases', 'phrases.js'), 'utf8');

// Extract single-quoted strings AND template literals — UI copy lives in both.
const singleQuoted = modSrc.match(/'(?:[^'\\\n]|\\.)*'/g) || [];
const templates = modSrc.match(/`(?:[^`\\]|\\.)*`/g) || [];
const literals = [...singleQuoted, ...templates];
check(literals.length > 40, `extracted a plausible number of string/template literals (got ${literals.length})`);

// (a) No completion claim — the H-049 banned words, capitalised claim form.
const BANNED = /\b(Done|Sent|Booked|Submitted)\b/;
const offenders = literals.filter((l) => BANNED.test(l));
check(
  offenders.length === 0,
  `no UI literal claims completion (Done/Sent/Booked/Submitted)${offenders.length ? ': ' + offenders.slice(0, 3).join(' | ') : ''}`
);

// (b) The ***-unfilled copy gate exists and states the consequence.
check(
  /hasUnfilledPlaceholders\(text\)\s*&&\s*!confirmed/.test(modSrc),
  'Copy is gated on hasUnfilledPlaceholders + explicit confirmation'
);
check(modSrc.includes('the patient will see'), 'the *** confirmation states the consequence, not the mechanism');
check(modSrc.includes('Copy anyway'), 'the gate demands an explicit "Copy anyway" second click');

// (c) The post-copy line claims the clipboard only, and persists (no timer).
check(modSrc.includes('nothing goes anywhere until you do'), 'post-copy line states the outstanding manual step');
check(!/setTimeout[\s\S]{0,200}?_copyStatus\s*=\s*''/.test(modSrc), 'no timer ever clears the post-copy reminder');

// (d) Audience tag renders on cards and in the compose pane (H-052 control b).
check(/ph-aud-\$\{esc\(b\.audience\)\}/.test(modSrc), 'audience tag rendered on every block card');
check(modSrc.includes('Mixed audiences'), 'mixed-audience compose warning present');

// (e) Copy-only: no fetch, no Medicus DOM write — the module talks to
//     chrome.storage and the clipboard, nothing else.
check(!/\bfetch\s*\(/.test(modSrc), 'module makes no network requests');
check(!/document\.execCommand\(\s*'insert/i.test(modSrc), 'module never inserts into any document');

// (f) *** is never auto-filled: no code path replaces *** with anything but
//     the highlight <mark> (renders THE SAME *** back, visually loud).
const starReplacements = modSrc.match(/\.replace\(\/\\\*\\\*\\\*\/g?,[^)]*\)/g) || [];
check(
  starReplacements.length === 1 && starReplacements[0].includes('***'),
  'the only *** transform is the visual highlight that preserves the literal ***'
);

// ============================================================
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
