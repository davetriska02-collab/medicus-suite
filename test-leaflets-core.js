// Medicus Suite — Leaflets pure-logic tests
// Run with: node test-leaflets-core.js
//
// Covers shared/leaflets-utils.js (fuzzy search incl. aliases + prefix
// typos-lite, URL building/encoding, recent-list cap, tier-2 config gating,
// API-response -> render-model mapping from a fixture JSON, tag/attribute
// sanitisation) plus a schema check on the real rules/nhs-az-index.json
// (unique slugs, lowercase-hyphen format) and a source-level guard that the
// side-panel module always renders the nhs.uk search-fallback row.

'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
  }
}

const LU = require('./shared/leaflets-utils.js');

// ── Fixtures ──────────────────────────────────────────────────────────────

const ECZEMA = { slug: 'atopic-eczema', name: 'Atopic eczema', kind: 'condition', aliases: ['eczema', 'dermatitis'] };
const WARTS = {
  slug: 'warts-and-verrucas',
  name: 'Warts and verrucas',
  kind: 'condition',
  aliases: ['wart', 'verruca', 'verrucas'],
};
const PARA_ADULT = {
  slug: 'paracetamol-for-adults',
  name: 'Paracetamol (adults)',
  kind: 'medicine',
  aliases: ['paracetamol'],
};
const IBS = {
  slug: 'irritable-bowel-syndrome-ibs',
  name: 'Irritable bowel syndrome (IBS)',
  kind: 'condition',
  aliases: ['ibs'],
};
const FIXTURE_INDEX = [ECZEMA, WARTS, PARA_ADULT, IBS];

// ── 1. Fuzzy search: exact / alias / prefix / typos-lite ───────────────────
console.log('\n--- searchIndex: exact + alias + prefix matches ---');
{
  const exact = LU.searchIndex(FIXTURE_INDEX, 'Atopic eczema');
  check(exact[0]?.slug === 'atopic-eczema', 'exact name match ranks first');

  const alias = LU.searchIndex(FIXTURE_INDEX, 'eczema');
  check(
    alias.some((e) => e.slug === 'atopic-eczema'),
    'alias match finds the entry (eczema -> Atopic eczema)'
  );

  const aliasToken = LU.searchIndex(FIXTURE_INDEX, 'wart');
  check(
    aliasToken.some((e) => e.slug === 'warts-and-verrucas'),
    'alias "wart" matches "Warts and verrucas"'
  );

  const tokenPrefix = LU.searchIndex(FIXTURE_INDEX, 'verr');
  check(
    tokenPrefix.some((e) => e.slug === 'warts-and-verrucas'),
    'token-prefix "verr" matches "verrucas" alias'
  );

  const medAlias = LU.searchIndex(FIXTURE_INDEX, 'paracetamol');
  check(
    medAlias.some((e) => e.slug === 'paracetamol-for-adults'),
    'medicine alias matches'
  );

  const acronym = LU.searchIndex(FIXTURE_INDEX, 'ibs');
  check(
    acronym.some((e) => e.slug === 'irritable-bowel-syndrome-ibs'),
    'acronym alias "ibs" matches'
  );

  check(LU.searchIndex(FIXTURE_INDEX, '').length === 0, 'empty query -> no matches');
  check(LU.searchIndex(FIXTURE_INDEX, '   ').length === 0, 'whitespace-only query -> no matches');
  check(LU.searchIndex(FIXTURE_INDEX, 'xyznotarealcondition').length === 0, 'no-match query -> []');
}

console.log('\n--- searchIndex: typos-lite prefix matching ---');
{
  // "eczems" (single substituted final letter) should still surface "eczema"
  // via the bounded Levenshtein check on same-length word prefixes (1 edit).
  const typo = LU.searchIndex(FIXTURE_INDEX, 'eczems');
  check(
    typo.some((e) => e.slug === 'atopic-eczema'),
    '1-edit typo "eczems" still matches "eczema"'
  );

  // Too many edits away — must NOT match (guards against over-fuzzy false positives).
  const farOff = LU.searchIndex(FIXTURE_INDEX, 'xzxma');
  check(!farOff.some((e) => e.slug === 'atopic-eczema'), 'unrelated string does not fuzzy-match');

  // Short queries (< 4 chars) never fuzz-match — avoids everything matching everything.
  const short = LU.searchIndex(FIXTURE_INDEX, 'ecz');
  check(Array.isArray(short), 'short query does not throw');
}

console.log('\n--- searchIndex: ranking + limit ---');
{
  const limited = LU.searchIndex(FIXTURE_INDEX, 'a', { limit: 2 });
  check(limited.length <= 2, 'limit option caps result count');
  check(LU.searchIndex(null, 'eczema').length === 0, 'non-array entries -> [] (no throw)');
  check(LU.searchIndex(FIXTURE_INDEX, null).length === 0, 'null query -> [] (no throw)');
}

// ── 2. URL building + encoding ──────────────────────────────────────────────
console.log('\n--- URL building ---');
{
  check(
    LU.buildLeafletUrl(ECZEMA) === 'https://www.nhs.uk/conditions/atopic-eczema/',
    `condition URL correct (got: ${LU.buildLeafletUrl(ECZEMA)})`
  );
  check(
    LU.buildLeafletUrl(PARA_ADULT) === 'https://www.nhs.uk/medicines/paracetamol-for-adults/',
    `medicine URL correct (got: ${LU.buildLeafletUrl(PARA_ADULT)})`
  );
  check(LU.buildLeafletUrl(null) === null, 'buildLeafletUrl(null) -> null (no throw)');

  check(
    LU.buildApiUrl(ECZEMA) === 'https://api.nhs.uk/conditions/atopic-eczema',
    `API URL correct, no trailing slash (got: ${LU.buildApiUrl(ECZEMA)})`
  );

  const spaced = LU.buildSearchUrl('ear infection & pain');
  check(spaced.startsWith('https://www.nhs.uk/search/results?q='), 'search fallback URL uses the right base');
  check(
    spaced.includes(encodeURIComponent('ear infection & pain')),
    'search fallback URL encodes the term (incl. "&")'
  );
  check(!spaced.includes(' '), 'search fallback URL has no raw spaces');

  check(LU.buildSearchUrl('') === 'https://www.nhs.uk/search/results?q=', 'empty term still builds a valid URL');
  check(LU.buildSearchUrl(null).endsWith('q='), 'null term does not throw, builds a valid URL');
}

// ── 3. Recent list: push, de-dupe, cap ──────────────────────────────────────
console.log('\n--- addRecent ---');
{
  let recent = [];
  recent = LU.addRecent(recent, { slug: 'a', name: 'A', kind: 'condition' });
  recent = LU.addRecent(recent, { slug: 'b', name: 'B', kind: 'condition' });
  check(recent.length === 2 && recent[0].slug === 'b', 'newest pushed to front');

  // re-selecting an existing entry moves it to front rather than duplicating
  recent = LU.addRecent(recent, { slug: 'a', name: 'A', kind: 'condition' });
  check(recent.length === 2 && recent[0].slug === 'a', 're-adding an existing slug moves it to front, no duplicate');

  let capped = [];
  for (let i = 0; i < 15; i++) {
    capped = LU.addRecent(capped, { slug: `s${i}`, name: `S${i}`, kind: 'condition' });
  }
  check(capped.length === 10, `recent list capped at 10 (got ${capped.length})`);
  check(capped[0].slug === 's14', 'cap keeps the most recent items');

  const withMax = LU.addRecent([], { slug: 'x', name: 'X', kind: 'medicine' }, 3);
  check(withMax.length === 1, 'custom max param accepted');

  const item = LU.addRecent([], { slug: 'y', name: 'Y', kind: 'medicine' })[0];
  check(typeof item.openedAt === 'string' && item.openedAt.length > 0, 'openedAt stamped when not supplied');
}

// ── 4. Tier-2 config gating ─────────────────────────────────────────────────
console.log('\n--- canFetchLeaflet (no key -> no fetch path reachable) ---');
{
  check(LU.canFetchLeaflet(null) === false, 'null config -> false');
  check(LU.canFetchLeaflet({}) === false, 'empty config -> false');
  check(LU.canFetchLeaflet({ enabled: true }) === false, 'enabled with no apiKey -> false');
  check(LU.canFetchLeaflet({ enabled: true, apiKey: '' }) === false, 'enabled with blank apiKey -> false');
  check(LU.canFetchLeaflet({ enabled: true, apiKey: '   ' }) === false, 'enabled with whitespace-only apiKey -> false');
  check(LU.canFetchLeaflet({ enabled: false, apiKey: 'abc123' }) === false, 'apiKey set but not enabled -> false');
  check(LU.canFetchLeaflet({ enabled: true, apiKey: 'abc123' }) === true, 'enabled + apiKey -> true (only true case)');
}

// ── 5. Sanitisation: strips tags/attributes ─────────────────────────────────
console.log('\n--- stripTags ---');
{
  check(LU.stripTags('<p>Hello <b>world</b></p>') === 'Hello world', 'strips simple tags');
  check(
    LU.stripTags('<img src=x onerror="alert(1)">gotcha') === 'gotcha',
    'strips tag WITH its attributes (event handler included)'
  );
  check(
    LU.stripTags('<script>alert(1)</script>after') === 'alert(1) after',
    'script tag markup stripped, inner text remains as text'
  );
  check(LU.stripTags('a&nbsp;&nbsp;b') === 'a b', '&nbsp; collapsed to a single space');
  check(LU.stripTags('  multiple   spaces  ') === 'multiple spaces', 'whitespace collapsed and trimmed');
  check(LU.stripTags(null) === '', 'null -> empty string');
  check(LU.stripTags(undefined) === '', 'undefined -> empty string');
  check(LU.stripTags(42) === '42', 'non-string coerced to string, not throw');
}

// ── 6. API response -> render-model mapping (fixture JSON) ─────────────────
console.log('\n--- mapApiResponseToRenderModel ---');
{
  const goodFixture = {
    name: 'Chickenpox',
    url: 'https://www.nhs.uk/conditions/chickenpox/',
    lastReviewed: '2024-05-01T00:00:00Z',
    hasPart: [
      { name: 'Overview', text: '<p>Chickenpox is a mild illness.</p><p>Most children catch it.</p>' },
      { name: 'Symptoms<script>alert(1)</script>', text: '<ul><li>Itchy spots</li><li>Fever</li></ul>' },
    ],
  };
  const model = LU.mapApiResponseToRenderModel(goodFixture, ECZEMA);
  check(model !== null, 'valid schema.org-shaped fixture maps to a non-null model');
  check(model?.title === 'Chickenpox', `title extracted correctly (got: "${model?.title}")`);
  check(
    model?.sourceUrl === 'https://www.nhs.uk/conditions/chickenpox/',
    'sourceUrl passed through when it is a real nhs.uk URL'
  );
  check(model?.lastReviewed === '2024-05-01', `lastReviewed clipped to date (got: "${model?.lastReviewed}")`);
  check(model?.sections.length === 2, `both hasPart entries mapped to sections (got ${model?.sections.length})`);
  check(model?.sections[0].paragraphs.length === 2, 'first section split into 2 paragraphs on </p>');
  check(model?.sections[0].paragraphs[0] === 'Chickenpox is a mild illness.', 'paragraph text is tag-free');
  check(
    model?.sections[1].heading === 'Symptoms alert(1)',
    `heading has tags stripped, no live markup survives (got: "${model?.sections[1].heading}")`
  );
  check(
    !JSON.stringify(model).includes('<script>'),
    'no raw "<script>" tag anywhere in the render model (tags always stripped)'
  );
  check(
    model.sections.every((s) => s.paragraphs.every((p) => !/<[^>]+>/.test(p))),
    'no HTML tags survive in any paragraph text'
  );

  // Malformed / unusable shapes must return null, never throw or half-fill.
  check(LU.mapApiResponseToRenderModel(null, ECZEMA) === null, 'null JSON -> null');
  check(LU.mapApiResponseToRenderModel({}, null) === null, 'empty object with no fallback entry -> null');
  check(
    LU.mapApiResponseToRenderModel({ name: 'X' }, ECZEMA) === null,
    'no hasPart / usable content -> null (name alone is not enough)'
  );
  check(
    LU.mapApiResponseToRenderModel({ name: 'X', hasPart: [{ text: '' }] }, ECZEMA) === null,
    'hasPart with no heading and no body text -> null'
  );

  // Falls back to the entry's own name when the API omits `name`.
  const noName = LU.mapApiResponseToRenderModel({ hasPart: [{ name: 'Overview', text: 'Some text.' }] }, ECZEMA);
  check(noName?.title === ECZEMA.name, "missing API name falls back to the search entry's name");

  // A non-nhs.uk url in the response is not trusted as sourceUrl — falls back
  // to the locally-built leaflet URL instead.
  const spoofedUrl = LU.mapApiResponseToRenderModel(
    { name: 'X', url: 'https://evil.example/phish', hasPart: [{ name: 'O', text: 'text' }] },
    ECZEMA
  );
  check(
    spoofedUrl?.sourceUrl === LU.buildLeafletUrl(ECZEMA),
    'non-nhs.uk url in API response is ignored, falls back to the built URL'
  );
}

// ── 7. leafletOpenLedgerEvent — pure event-shape builder ───────────────────
console.log('\n--- leafletOpenLedgerEvent ---');
{
  const evt = LU.leafletOpenLedgerEvent(ECZEMA, '2026-07-02T09:00:00.000Z');
  check(evt.source === 'leaflets', 'source is "leaflets"');
  check(evt.patientRef === null, 'patientRef is always null (no PHI)');
  check(evt.label === 'atopic-eczema', 'label is the slug');
  check(evt.action === 'opened', 'action is "opened"');
  check(evt.ts === '2026-07-02T09:00:00.000Z', 'ts passed through when supplied');
  check(LU.leafletOpenLedgerEvent(null) === null, 'null entry -> null (no throw)');
  check(typeof LU.leafletOpenLedgerEvent(ECZEMA).ts === 'string', 'ts auto-stamped when not supplied');
}

// ── 8. Index schema check — the real rules/nhs-az-index.json ───────────────
console.log('\n--- rules/nhs-az-index.json schema ---');
{
  const indexPath = path.join(__dirname, 'rules', 'nhs-az-index.json');
  check(fs.existsSync(indexPath), 'rules/nhs-az-index.json exists');
  const raw = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  check(Array.isArray(raw.entries), 'index has an entries array');
  check(
    raw.entries.length >= 150 && raw.entries.length <= 250,
    `entry count in the 150-250 range (got ${raw.entries.length})`
  );

  const errs = LU.validateIndexEntries(raw.entries);
  check(
    errs.length === 0,
    errs.length === 0 ? 'every entry passes schema validation' : `schema errors: ${errs.slice(0, 5).join('; ')}`
  );

  const slugs = raw.entries.map((e) => e.slug);
  check(new Set(slugs).size === slugs.length, 'all slugs unique');
  check(
    slugs.every((s) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s)),
    'every slug is lowercase-hyphen format'
  );
  check(
    raw.entries.every((e) => e.kind === 'condition' || e.kind === 'medicine'),
    'every entry kind is condition|medicine'
  );
  check(
    raw.entries.every((e) => Array.isArray(e.aliases)),
    'every entry has an aliases array'
  );

  // Deliberately introduce a schema violation to prove validateIndexEntries
  // actually catches it (not just always returning []).
  const badEntries = [{ slug: 'Bad_Slug', name: 'X', kind: 'condition', aliases: [] }];
  check(LU.validateIndexEntries(badEntries).length > 0, 'validateIndexEntries rejects a malformed slug');
  check(LU.validateIndexEntries('not-an-array').length > 0, 'validateIndexEntries rejects non-array input');
}

// ── 9. Guaranteed search-fallback row — source-level guard ─────────────────
// No DOM harness in this repo's test suite (see test-brief-core.js style —
// pure-logic modules are unit tested directly; UI modules are guarded at the
// source level, same technique as test-xss-attribute-escaping.js's "source
// guard" section). Asserts the module always appends the fallback row,
// whether or not the bundled index produced any matches.
console.log('\n--- guaranteed nhs.uk search-fallback row (source guard) ---');
{
  const src = fs.readFileSync(path.join(__dirname, 'side-panel', 'modules', 'leaflets', 'leaflets.js'), 'utf8');
  check(src.includes('renderFallbackRow'), 'module defines/uses renderFallbackRow');
  check(src.includes('data-act="search-nhs"'), 'fallback row is wired to the search-nhs action');

  // Extract the renderResults() function body and confirm BOTH the
  // no-matches branch and the has-matches branch include the fallback row —
  // i.e. it is not conditional on match count.
  const fnStart = src.indexOf('function renderResults(query)');
  check(fnStart !== -1, 'renderResults(query) function found');
  const fnEnd = src.indexOf('\nfunction ', fnStart + 1);
  const fnBody = src.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);
  check(fnBody.includes('matches.length === 0'), "renderResults has a 'matches.length === 0' branch");

  // Both `return `…`;` template-literal blocks in the function (the zero-match
  // branch and the normal branch) must each mention the fallback row.
  const returns = [...fnBody.matchAll(/return `[\s\S]*?`;/g)].map((m) => m[0]);
  check(returns.length === 2, `renderResults has exactly two return statements (got ${returns.length})`);
  check(returns[0]?.includes('fallback'), 'no-results branch return includes the fallback row');
  check(returns[1]?.includes('fallback'), 'has-results branch return includes the fallback row');
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);
