// Medicus Suite — Command palette core logic tests
// Run with: node test-palette-core.js
//
// Covers side-panel/palette/palette-core.js: match scoring, ranking
// (recents-first on empty query, score order on real queries), and the
// recents list maintenance. Pure logic — no chrome APIs, no DOM.

'use strict';

const path = require('path');
const { pathToFileURL } = require('url');

let pass = 0;
let failures = 0;
function ok(msg) {
  pass++;
  console.log(`  OK    ${msg}`);
}
function check(cond, msg) {
  if (cond) ok(msg);
  else {
    failures++;
    console.error(`  FAIL  ${msg}`);
  }
}

(async () => {
  const url = pathToFileURL(path.join(__dirname, 'side-panel', 'palette', 'palette-core.js')).href;
  const { scoreMatch, rankCommands, pushRecent } = await import(url);

  // ── scoreMatch ────────────────────────────────────────────────────────────
  check(scoreMatch('', 'anything') === 1, 'empty query matches everything with neutral score');
  check(scoreMatch('zzz', 'Go to Monitoring') === 0, 'non-matching query scores 0');
  check(
    scoreMatch('mon', 'Go to Monitoring') > scoreMatch('mon', 'Lemon sorbet'),
    'word-start substring beats mid-word'
  );
  check(scoreMatch('monitoring', 'Go to Monitoring') > 0, 'full word matches');
  check(scoreMatch('MON', 'go to monitoring') > 0, 'matching is case-insensitive');
  check(scoreMatch('gtm', 'Go to Monitoring') > 0, 'subsequence across word boundaries matches');
  check(
    scoreMatch('settings', 'Settings: Backup & Restore') > scoreMatch('stk', 'Settings: Backup & Restore'),
    'substring outranks sparse subsequence'
  );

  // ── rankCommands ──────────────────────────────────────────────────────────
  const cmds = [
    { id: 'nav:slots', label: 'Go to Slot Counter', keywords: 'slots' },
    { id: 'nav:sentinel', label: 'Go to Monitoring', keywords: 'sentinel' },
    { id: 'settings:backup', label: 'Settings: Backup & Restore', keywords: 'export import' },
    { id: 'help:tour', label: 'Replay the guided tour', keywords: 'walkthrough' },
  ];

  const empty = rankCommands(cmds, '', []);
  check(empty.length === 4 && empty[0].id === 'nav:slots', 'empty query, no recents: registry order preserved');

  const recented = rankCommands(cmds, '', ['help:tour', 'settings:backup']);
  check(
    recented[0].id === 'help:tour' && recented[1].id === 'settings:backup',
    'empty query: recents float to the top in recency order'
  );

  const mon = rankCommands(cmds, 'monitor', []);
  check(mon.length > 0 && mon[0].id === 'nav:sentinel', "'monitor' ranks Go to Monitoring first");

  const kw = rankCommands(cmds, 'export', []);
  check(kw.length === 1 && kw[0].id === 'settings:backup', 'keywords are searchable');

  check(rankCommands(cmds, 'qqqq', []).length === 0, 'no matches yields empty list');

  const original = cmds.map((c) => c.id).join(',');
  rankCommands(cmds, 'monitor', []);
  check(cmds.map((c) => c.id).join(',') === original, 'rankCommands does not mutate its input');

  // ── pushRecent ────────────────────────────────────────────────────────────
  check(pushRecent([], 'a').join(',') === 'a', 'pushRecent starts a list');
  check(pushRecent(['a', 'b'], 'b').join(',') === 'b,a', 'pushRecent dedupes and moves to front');
  check(pushRecent(['a', 'b', 'c', 'd', 'e'], 'f').length === 5, 'pushRecent caps at 5');
  check(pushRecent(null, 'x').join(',') === 'x', 'pushRecent tolerates non-array input');

  console.log(`\n--- Results: ${pass} passed, ${failures} failed ---`);
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(`  FAIL  could not load palette-core.js: ${e.message}`);
  process.exit(1);
});
