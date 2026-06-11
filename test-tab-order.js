// Medicus Suite — Tab ordering logic tests
// Run with: node test-tab-order.js
//
// Imports side-panel/tab-order.js as an ES module (same technique as
// test-sweep-core.js: dynamic import of a file:// URL).
//
// Coverage for reconcileTabOrder(defaultIds, storedOrder):
//   - empty / unset stored → defaults unchanged
//   - partial stored (favourites first) → those first, then rest in default order
//   - stored id not in defaults → ignored
//   - default id missing from stored → appended
//   - no duplicates ever (even if stored repeats an id)
//   - pop-out subset case: stored contains an id (visualiser) the shell lacks

'use strict';

const path = require('path');

(async () => {
  let passed = 0, failed = 0;

  function check(cond, msg) {
    if (cond) { console.log(`  OK  ${msg}`); passed++; }
    else { console.error(`  FAIL  ${msg}`); failed++; process.exitCode = 1; }
  }

  const eq = (a, b) => Array.isArray(a) && Array.isArray(b)
    && a.length === b.length && a.every((v, i) => v === b[i]);

  const tabOrderPath = new URL(
    'side-panel/tab-order.js',
    `file://${path.resolve(__dirname)}/`
  ).href;

  let reconcileTabOrder, STORAGE_KEY;
  try {
    const mod = await import(tabOrderPath);
    reconcileTabOrder = mod.reconcileTabOrder;
    STORAGE_KEY       = mod.STORAGE_KEY;
  } catch (e) {
    console.error('FATAL: could not import tab-order.js:', e.message);
    process.exit(1);
  }

  check(typeof reconcileTabOrder === 'function', 'reconcileTabOrder is a function');
  check(STORAGE_KEY === 'suite.tabOrder', 'STORAGE_KEY is suite.tabOrder');

  // The panel's default DOM order (from CLAUDE.md task brief).
  const PANEL = ['slots', 'sentinel', 'trends', 'capacity', 'submissions',
    'activity', 'referrals', 'condor', 'reception', 'sweep', 'visualiser', 'about'];
  // The pop-out has the same set minus visualiser & about.
  const POPOUT = ['slots', 'sentinel', 'trends', 'capacity', 'submissions',
    'activity', 'referrals', 'condor', 'reception', 'sweep'];

  // Empty / unset stored → defaults unchanged.
  check(eq(reconcileTabOrder(PANEL, []), PANEL), 'empty stored → defaults unchanged');
  check(eq(reconcileTabOrder(PANEL, undefined), PANEL), 'undefined stored → defaults unchanged');
  check(eq(reconcileTabOrder(PANEL, null), PANEL), 'null stored → defaults unchanged');

  // Partial stored (favourites first) → those first, then rest in default order.
  {
    const stored = ['referrals', 'sweep'];
    const expected = ['referrals', 'sweep', 'slots', 'sentinel', 'trends',
      'capacity', 'submissions', 'activity', 'condor', 'reception', 'visualiser', 'about'];
    check(eq(reconcileTabOrder(PANEL, stored), expected),
      'partial stored → favourites first, rest in default order');
  }

  // Stored id not in defaults → ignored.
  {
    const stored = ['referrals', 'nonexistent-module', 'sweep'];
    const out = reconcileTabOrder(PANEL, stored);
    check(!out.includes('nonexistent-module'), 'stored id not in defaults is ignored');
    check(out.length === PANEL.length, 'ignoring unknown id keeps full default length');
  }

  // Default id missing from stored → appended (in default order).
  {
    const stored = ['condor'];
    const out = reconcileTabOrder(PANEL, stored);
    check(out[0] === 'condor', 'stored favourite leads');
    check(eq(out.slice(1), PANEL.filter(id => id !== 'condor')),
      'remaining defaults appended in original order');
  }

  // No duplicates ever, even when stored repeats an id.
  {
    const stored = ['slots', 'slots', 'sentinel', 'sentinel'];
    const out = reconcileTabOrder(PANEL, stored);
    check(new Set(out).size === out.length, 'no duplicates even when stored repeats ids');
    check(eq(out, PANEL), 'deduped repeats with full default rest → original order preserved');
  }

  // Full reorder round-trips exactly.
  {
    const reversed = [...PANEL].reverse();
    check(eq(reconcileTabOrder(PANEL, reversed), reversed), 'full stored order is honoured exactly');
  }

  // Pop-out subset case: stored (a panel order) contains visualiser & about,
  // which the pop-out shell lacks — those are ignored, pop-out tabs reorder.
  {
    const stored = ['referrals', 'visualiser', 'sweep', 'about', 'slots'];
    const out = reconcileTabOrder(POPOUT, stored);
    check(!out.includes('visualiser') && !out.includes('about'),
      'pop-out ignores stored ids it does not have (visualiser/about)');
    check(out.length === POPOUT.length, 'pop-out keeps its full tab set');
    check(eq(out.slice(0, 3), ['referrals', 'sweep', 'slots']),
      'pop-out honours stored order for the ids it does have');
  }

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) process.exit(1);
})();
