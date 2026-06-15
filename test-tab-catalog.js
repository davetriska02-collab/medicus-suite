// Medicus Suite — Tab catalog staleness guard
// Run with: node test-tab-catalog.js
//
// The tab chooser (side-panel/tabs-chooser/) teaches new users what each tab
// is from side-panel/tab-catalog.js. This guard keeps that catalog in
// lock-step with the real nav (mirroring test-tour-steps.js): a tab added to
// panel.html without a catalog entry — or a catalog entry whose tab no longer
// exists — fails CI. Also sanity-checks blurbs, presets, and the hidden-tabs
// sanitiser's never-hide-everything guarantee.

'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

let pass = 0;
let failures = 0;
function check(cond, msg) {
  if (cond) {
    pass++;
    console.log(`  OK    ${msg}`);
  } else {
    failures++;
    console.error(`  FAIL  ${msg}`);
  }
}

(async () => {
  const url = pathToFileURL(path.join(__dirname, 'side-panel', 'tab-catalog.js')).href;
  const { TAB_CATALOG, ROLE_PRESETS, hiddenFromPreset, sanitiseHiddenTabs, toggleTabVisibility } = await import(url);

  const catalogIds = TAB_CATALOG.map((t) => t.id);
  const panelHtml = fs.readFileSync(path.join(__dirname, 'side-panel', 'panel.html'), 'utf8');
  const navIds = [...new Set([...panelHtml.matchAll(/data-module="([a-z-]+)"/g)].map((m) => m[1]))];

  // ── Parity with the real nav ────────────────────────────────────────────
  const missingFromCatalog = navIds.filter((id) => !catalogIds.includes(id));
  check(
    missingFromCatalog.length === 0,
    missingFromCatalog.length === 0
      ? `every panel.html tab has a catalog entry (${navIds.length} tabs)`
      : `nav tab(s) missing from tab-catalog.js: ${missingFromCatalog.join(', ')} — new users get no explainer`
  );
  const staleInCatalog = catalogIds.filter((id) => !navIds.includes(id));
  check(
    staleInCatalog.length === 0,
    staleInCatalog.length === 0
      ? 'no stale catalog entries'
      : `catalog entries with no nav tab: ${staleInCatalog.join(', ')}`
  );

  // ── Entry quality ───────────────────────────────────────────────────────
  check(new Set(catalogIds).size === catalogIds.length, 'catalog ids are unique');
  const badBlurbs = TAB_CATALOG.filter(
    (t) => typeof t.blurb !== 'string' || t.blurb.length < 15 || t.blurb.length > 110 || /[A-Z]{4,}/.test(t.blurb)
  );
  check(
    badBlurbs.length === 0,
    badBlurbs.length === 0
      ? 'every entry has a 15–110 char, non-shouty blurb'
      : `bad blurbs: ${badBlurbs.map((t) => t.id).join(', ')}`
  );
  check(
    TAB_CATALOG.every((t) => typeof t.name === 'string' && t.name.trim()),
    'every entry has a name'
  );

  // ── Presets ─────────────────────────────────────────────────────────────
  check(new Set(ROLE_PRESETS.map((p) => p.id)).size === ROLE_PRESETS.length, 'preset ids are unique');
  const badPresetRefs = ROLE_PRESETS.flatMap((p) => p.show.filter((id) => !catalogIds.includes(id)));
  check(
    badPresetRefs.length === 0,
    badPresetRefs.length === 0
      ? 'presets reference only catalog ids'
      : `unknown ids in presets: ${badPresetRefs.join(', ')}`
  );
  check(
    ROLE_PRESETS.every((p) => p.show.includes('today') && p.show.length >= 3),
    'every preset keeps the Today home tab and at least 3 tabs'
  );
  const allPreset = ROLE_PRESETS.find((p) => p.id === 'all');
  check(!!allPreset && hiddenFromPreset('all').length === 0, "'all' preset hides nothing");

  // ── Sanitiser ───────────────────────────────────────────────────────────
  check(sanitiseHiddenTabs(null).length === 0, 'sanitiser tolerates non-array input');
  check(
    sanitiseHiddenTabs(['condor', 'nope', 42, 'condor']).join(',') === 'condor',
    'sanitiser drops unknown/duplicate/non-string ids'
  );
  check(
    sanitiseHiddenTabs(catalogIds).length === 0,
    'sanitiser refuses to hide every tab (falls back to hiding nothing)'
  );

  // ── toggleTabVisibility (pure toggle for the options section + overlay) ────
  {
    // turning a visible tab OFF adds it to the hidden set
    const r1 = toggleTabVisibility([], 'condor');
    check(!r1.blocked && r1.hidden.join(',') === 'condor', 'toggle hides a visible tab');

    // turning a hidden tab back ON removes it
    const r2 = toggleTabVisibility(['condor'], 'condor');
    check(!r2.blocked && r2.hidden.length === 0, 'toggle re-shows a hidden tab');

    // unknown id is a no-op (not blocked, set unchanged)
    const r3 = toggleTabVisibility(['condor'], 'nope');
    check(!r3.blocked && r3.hidden.join(',') === 'condor', 'toggle ignores unknown ids');

    // hiding the last visible tab is BLOCKED and leaves the set unchanged
    const allButOne = catalogIds.filter((id) => id !== 'today');
    const r4 = toggleTabVisibility(allButOne, 'today');
    check(
      r4.blocked && r4.hidden.length === allButOne.length,
      'toggle blocks hiding the final visible tab (never lock-out)'
    );

    // turning ON is always allowed even from a near-empty visible state
    const r5 = toggleTabVisibility(allButOne, 'submissions');
    check(!r5.blocked && !r5.hidden.includes('submissions'), 'toggle ON allowed even at one-visible');

    // corrupt incoming hidden array is sanitised before toggling
    const r6 = toggleTabVisibility(['nope', 42, 'condor'], 'slots');
    check(
      !r6.blocked && r6.hidden.includes('condor') && r6.hidden.includes('slots') && !r6.hidden.includes('nope'),
      'toggle sanitises a corrupt hidden array first'
    );
  }

  console.log(`\n--- Results: ${pass} passed, ${failures} failed ---`);
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(`  FAIL  could not load tab-catalog.js: ${e.message}`);
  process.exit(1);
});
