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
// 5b. chipLabel — design-crit decision D (render-time-only slot-prefix strip)
// ============================================================
console.log('\n5b. chipLabel');

check(PC.chipLabel('Opener — ongoing pain') === 'ongoing pain', 'a short slot prefix is stripped');
check(
  PC.chipLabel('Condition explainer — tennis elbow') === 'tennis elbow',
  'a 20-char prefix (<=24) is still stripped'
);
check(
  PC.chipLabel('This is a genuinely long descriptive title — with a note') ===
    'This is a genuinely long descriptive title — with a note',
  'a prefix over 24 chars is left untouched (real title, not mangled)'
);
check(PC.chipLabel('No separator here at all') === 'No separator here at all', 'a title with no em-dash is untouched');
check(PC.chipLabel('') === '', 'empty title returns empty string');
check(PC.chipLabel(null) === '', 'nullish title returns empty string, never throws');
{
  // Exactly-24-char prefix boundary: stripped (<=24, not <24).
  const p24 = 'x'.repeat(24);
  check(PC.chipLabel(`${p24} — rest`) === 'rest', 'a prefix of exactly 24 chars is stripped (boundary inclusive)');
  const p25 = 'x'.repeat(25);
  check(
    PC.chipLabel(`${p25} — rest`) === `${p25} — rest`,
    'a prefix of 25 chars is left untouched (just over the limit)'
  );
}

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

  // BODY-TEXT contract (Opus review finding 7): the bodies are the patient-
  // facing surface and this file is the designated recurring drop-in point —
  // no shipped body may claim an action was completed. "what you've sent"
  // (the PATIENT sent it) is the one legitimate use, stripped before the test.
  const BODY_CLAIM = /\b(sent|booked|done|submitted|arranged|referred|prescribed|issued|completed)\b/i;
  const BODY_ALLOWED = /\bwhat you've sent\b/gi;
  const claimers = SHIPPED_PACK.blocks.filter((b) => BODY_CLAIM.test(String(b.body).replace(BODY_ALLOWED, '')));
  check(
    claimers.length === 0,
    `no shipped body claims a completed action${claimers.length ? ': ' + claimers.map((b) => b.id).join(', ') : ''}`
  );

  // The infant-fever red-flag threshold is a NATIONAL constant (NICE NG143:
  // under 3 months with temperature >= 38°C), not a fill-in — a *** here
  // invites a materially wrong escalation trigger (Opus review finding 8).
  const childFever = SHIPPED_PACK.blocks.find((b) => b.id === 'sn-child-fever');
  check(
    !!childFever && childFever.body.includes('under 3 months old'),
    'sn-child-fever hard-codes the under-3-months threshold (never a ***)'
  );

  // Design-crit decision R: a sign-off body ending "Dr ***" misleads a
  // patient about who is treating them when a non-doctor (e.g. an ANP)
  // pastes it — the placeholder must carry the clinician's own name/role,
  // never a hard-coded title. Guards every future drop-in, not just today's.
  const drStarClaimers = SHIPPED_PACK.blocks.filter((b) => /Dr\s*\*\*\*/.test(String(b.body)));
  check(
    drStarClaimers.length === 0,
    `no shipped body contains "Dr ***"${drStarClaimers.length ? ': ' + drStarClaimers.map((b) => b.id).join(', ') : ''}`
  );
}

// ============================================================
// 6b. generateBlockId — must terminate at the id-length limit
// ============================================================
// `${base}-${n}`.slice(0, limit) truncates the suffix back off when base is
// already at the limit → identical candidate every iteration → unbounded busy-
// loop freezing the panel/Options page (Opus review finding 1, BLOCKER). Pin
// termination and distinctness; this class of bug is invisible to CI unless
// something asserts it.
console.log('\n6b. generateBlockId termination at the length limit');

{
  const longTitle = 'x'.repeat(120);
  const firstId = PC.generateBlockId(longTitle, new Set());
  check(firstId.length <= PC.PH_LIMITS.id, 'long-title id respects the length limit');
  const secondId = PC.generateBlockId(longTitle, new Set([firstId]));
  check(secondId !== firstId, 'colliding long-title id gets a REAL suffix (returns, distinct)');
  const many = new Set([firstId, secondId]);
  const thirdId = PC.generateBlockId(longTitle, many);
  check(!many.has(thirdId), 'third collision still distinct');
  // Two same-long-titled blocks through the list sanitiser — the exact repro
  // that froze: must return, with distinct ids.
  const pair = PC.sanitiseBlockList([
    {
      id: '',
      title: longTitle,
      body: 'a',
      trigger: 'ta',
      keywords: '',
      category: 'admin',
      audience: 'note',
      leafletUrl: '',
      slot: 'whole',
    },
    {
      id: '',
      title: longTitle,
      body: 'b',
      trigger: 'tb',
      keywords: '',
      category: 'admin',
      audience: 'note',
      leafletUrl: '',
      slot: 'whole',
    },
  ]);
  check(
    pair.length === 2 && pair[0].id !== pair[1].id,
    'sanitiseBlockList of two identical long titles returns two distinct ids'
  );
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

// Extract single-quoted strings, DOUBLE-quoted strings AND template literals —
// UI copy lives in all three. Double quotes matter precisely because Prettier
// (singleQuote: true) emits them for strings containing an apostrophe — i.e.
// exactly the natural-English copy most likely to carry a claim (Opus review
// finding 6).
const singleQuoted = modSrc.match(/'(?:[^'\\\n]|\\.)*'/g) || [];
const doubleQuoted = modSrc.match(/"(?:[^"\\\n]|\\.)*"/g) || [];
const templates = modSrc.match(/`(?:[^`\\]|\\.)*`/g) || [];
const literals = [...singleQuoted, ...doubleQuoted, ...templates];
check(literals.length > 40, `extracted a plausible number of string/template literals (got ${literals.length})`);

// (a) No completion claim — the H-049 banned words, CASE-INSENSITIVE ("has been
// sent" claims completion as surely as "Sent"). Legitimate negations are
// stripped before the test rather than allowlisting whole literals.
const BANNED = /\b(done|sent|booked|submitted)\b/i;
const BANNED_NEGATIONS = /\b(not(?:hing is)?(?: yet)? (?:done|sent|booked|submitted)|sends nothing)\b/gi;
const offenders = literals.filter((l) => BANNED.test(l.replace(BANNED_NEGATIONS, '')));
check(
  offenders.length === 0,
  `no UI literal claims completion (done/sent/booked/submitted, any case)${offenders.length ? ': ' + offenders.slice(0, 3).join(' | ') : ''}`
);

// (b) The ***-unfilled copy gate exists and states the consequence — audience-
// aware, so it is never false for a note/task composition (a false consequence
// teaches click-through-blindness; Opus review finding 3).
check(/carriesGaps\s*&&\s*!confirmed/.test(modSrc), 'Copy is gated on unfilled placeholders + explicit confirmation');
check(modSrc.includes('the patient'), 'the *** confirmation names the patient-facing consequence');
check(modSrc.includes('whoever reads this'), 'the *** confirmation has a true consequence for note/task audiences');

// (b2) A confirmed ***-copy keeps its obligation visible after the click
// (Opus review finding 4) and the post-copy line names the clipboard-outlives-
// context risk (finding 5 — H-052 cites this line as the accepted control).
check(
  modSrc.includes('This copy still contains *** — type over every one before you send.'),
  'the *** obligation survives the confirmed copy'
);
check(
  /stays on the clipboard until you copy something else/.test(modSrc),
  'post-copy line names clipboard persistence (H-052 clipboard-outlives-context control)'
);
check(modSrc.includes('Copy anyway'), 'the gate demands an explicit "Copy anyway" second click');

// (c) The post-copy line claims the clipboard only, and persists (no timer).
check(
  modSrc.includes('Nothing goes anywhere until you paste and send'),
  'post-copy line states the outstanding manual step'
);
check(!/setTimeout[\s\S]{0,200}?_copyStatus\s*=\s*''/.test(modSrc), 'no timer ever clears the post-copy reminder');

// (d) Audience marking is DIFFERENTIAL (design-crit decision F, H-052 control
// b): the tray's own For:/mixed-audience control stays unconditional and full
// strength; cards/chips now OMIT the badge for the expected default
// ('patient') and only render it for 'note'/'task'. The "badge on every
// card" pin is retired in favour of asserting the tray control's presence
// and that the amber task-audience triad is still a real, defined class.
check(modSrc.includes('ph-compose-aud'), "the tray's unconditional For: control markup is present");
check(modSrc.includes('Mixed audiences'), 'mixed-audience compose warning present');
check(
  /function renderAudBadge/.test(modSrc) && /ph-aud-\$\{esc\(audience\)\}/.test(modSrc),
  'a shared renderAudBadge() helper renders the note/task audience triad (patient stays unbadged)'
);
{
  const cssSrc = fs.readFileSync(path.join(__dirname, 'side-panel', 'modules', 'phrases', 'phrases.css'), 'utf8');
  check(
    /\.ph-aud-task\s*\{[^}]*var\(--amber-dim\)[^}]*\}/.test(cssSrc) &&
      /\.ph-aud-task\s*\{[^}]*var\(--amber\)[^}]*\}/.test(cssSrc),
    'the ph-aud-task amber triad class is still defined (the differential omits patient, not task)'
  );
  check(!modSrc.includes('ph-badge-practice'), 'the old always-on green PRACTICE badge is gone (decision G)');
}

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
