// Regression guard for the attribute-injection XSS class fixed alongside the
// repo audit: several `escHtml` helpers escape only `& < >` (not the double
// quote `"`) yet were used inside double-quoted HTML attributes carrying
// untrusted data (patient medication names, imported custom-rule ids). A value
// containing `"` could break out of the attribute and inject an event-handler
// attribute -> DOM-based XSS in the privileged side panel. Angle brackets are
// escaped so raw `<script>` is blocked; the live vector is attribute breakout.
//
// This test fails closed if (a) the live chip renderer ever lets a quote-bearing
// drug name / rule id break out of an attribute, or (b) any of the fixed source
// files reintroduces the quote-unsafe `="${escHtml(...)}"` attribute pattern.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error('  ✗ ' + msg);
  }
}

const chipRenderer = require('./shared/chip-renderer.js');

// A payload that, if interpolated into a double-quoted attribute by a helper
// that does not escape `"`, breaks out and adds an event handler.
const BREAKOUT = 'x" onmouseover="alert(1)';

function makeCustomRule(overrides = {}) {
  return {
    id: 'custom-test',
    label: 'Test rule',
    enabled: true,
    isCustom: true,
    drug: { match: ['leflunomide'] },
    tests: [{ name: 'FBC', intervalDays: 90 }],
    ...overrides,
  };
}

// ── 1. Runtime: renderDrugChip must not let a malicious drug name or rule id
//       break out of the data-* / title attributes ─────────────────────────────
console.log('--- renderDrugChip attribute escaping ---');
{
  const rule = makeCustomRule();
  const chip = chipRenderer.buildPreviewChip(rule, 'overdue', BREAKOUT);
  // Force the evidence-bearing branch (data-rule-id / data-evidence-key attrs).
  chip.evidence = { why: 'test' };
  chip.ruleId = BREAKOUT;
  chip.drugName = BREAKOUT;
  chip.notes = BREAKOUT; // feeds the title="" tooltip on custom chips
  const html = chipRenderer.renderDrugChip(chip);

  // A raw `"` in element TEXT content is harmless (escHtml leaves it; the
  // browser does not treat it as markup between tags), so we must NOT scan the
  // whole string. The vulnerability is an ATTRIBUTE breakout: we therefore
  // extract each attribute's value (everything up to the next real `"`
  // delimiter) and prove the ENTIRE hostile payload stayed inside that single
  // attribute. If a quote-unsafe escaper had been used, the first raw `"` would
  // close the attribute and the `onmouseover=...alert(1)` tail would fall
  // outside the captured value (an injected event handler).
  for (const attr of ['data-evidence-key', 'data-rule-id', 'title']) {
    const m = new RegExp(`${attr}="([^"]*)"`).exec(html);
    if (!m) continue; // not every chip emits every attribute
    const value = m[1];
    check(
      value.includes('&quot;') && value.includes('alert(1)'),
      `renderDrugChip: the full hostile payload is contained & quote-escaped inside ${attr}="…" (no breakout)`
    );
  }
  // At least one of the targeted attributes must have been present and checked.
  check(
    /data-evidence-key="|data-rule-id="|title="/.test(html),
    'renderDrugChip: emitted at least one of the audited attributes'
  );
  // Sanity: it still rendered a chip.
  check(html.includes('sent-chip'), 'renderDrugChip: still produces chip HTML with hostile input');
}

// ── 2. Source guard: none of the fixed files may use the quote-unsafe
//       `="${escHtml(...)}"` attribute pattern. Attribute context must use a
//       quote-escaping helper (escAttr). ─────────────────────────────────────────
console.log('--- source guard: no quote-unsafe escHtml in attribute context ---');
{
  const files = ['shared/chip-renderer.js', 'side-panel/modules/sentinel/sentinel.js', 'sentinel-options/options.js'];
  for (const f of files) {
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
    // `="${escHtml(` is an attribute value (`name="...`) produced by escHtml.
    check(
      !src.includes('="${escHtml('),
      `${f}: no double-quoted attribute interpolated with quote-unsafe escHtml (use escAttr)`
    );
  }
}

// ── 3. Each fixed module exposes a quote-escaping escAttr that handles `"`. ────────
console.log('--- escAttr coverage ---');
{
  // chip-renderer is requireable; assert its escAttr (if exported) escapes quotes.
  if (typeof chipRenderer.escAttr === 'function') {
    check(chipRenderer.escAttr('a"b') === 'a&quot;b', 'chip-renderer escAttr escapes the double-quote');
  }
  // For the two browser-script files, assert an escAttr that escapes `"` exists in source.
  for (const f of ['side-panel/modules/sentinel/sentinel.js', 'sentinel-options/options.js']) {
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
    check(
      /function escAttr|escAttr\s*=/.test(src) && src.includes('&quot;'),
      `${f}: defines an escAttr that escapes the double-quote`
    );
  }
}

// ── 4. panel.js escStrip must escape double quotes ───────────────────────────
//    escStrip() is used in double-quoted HTML attribute positions at panel.js:936
//    and :1346 where b.label / a.title may contain user-entered free text.
console.log('--- panel.js escStrip escapes double quotes ---');
{
  const src = fs.readFileSync(path.join(__dirname, 'side-panel/panel.js'), 'utf8');
  check(
    src.includes('&quot;') && /function escStrip/.test(src),
    'panel.js: escStrip function escapes the double-quote (&quot;)'
  );
  check(
    !src.includes("replace(/\"/g, '\"')"),
    'panel.js: escStrip does not leave raw double-quotes unescaped'
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
