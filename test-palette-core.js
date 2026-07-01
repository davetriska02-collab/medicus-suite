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
  const { scoreMatch, rankCommands, pushRecent, patientScopedCommands, PATIENT_COMMAND_IDS } = await import(url);

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

  // ── patientScopedCommands — patient-context gating (top-10 plan item 10) ──
  check(patientScopedCommands(false).length === 0, 'no patient context → no patient-scoped commands');
  check(
    patientScopedCommands(undefined).length === 0,
    'undefined patient context → no patient-scoped commands (falsy)'
  );
  check(patientScopedCommands(null).length === 0, 'null patient context → no patient-scoped commands (falsy)');

  const patientCmds = patientScopedCommands(true);
  check(patientCmds.length === 5, `patient context present → 5 patient-scoped commands (got ${patientCmds.length})`);
  check(
    patientCmds.every((c) => c.group === 'Patient'),
    'every patient-scoped command is tagged group "Patient"'
  );

  const patientIds = patientCmds.map((c) => c.id);
  check(
    patientIds.includes(PATIENT_COMMAND_IDS.COPY_SUMMARY),
    '"Copy patient summary" present when patient context exists'
  );
  check(
    patientIds.includes(PATIENT_COMMAND_IDS.OPEN_VISUALISER),
    '"Open visualiser" present when patient context exists'
  );
  check(patientIds.includes(PATIENT_COMMAND_IDS.JUMP_RECORD), '"Jump to Record" present when patient context exists');
  check(patientIds.includes(PATIENT_COMMAND_IDS.JUMP_TRENDS), '"Jump to Trends" present when patient context exists');
  check(
    patientIds.includes(PATIENT_COMMAND_IDS.JUMP_SENTINEL),
    '"Jump to Sentinel" present when patient context exists'
  );

  const copySummaryCmd = patientCmds.find((c) => c.id === PATIENT_COMMAND_IDS.COPY_SUMMARY);
  check(
    copySummaryCmd && copySummaryCmd.label === 'Copy patient summary',
    `"Copy patient summary" label matches house style (got: "${copySummaryCmd?.label}")`
  );

  // patientScopedCommands must not leak a `run` function — it's pure/declarative,
  // the DOM/chrome-dependent behaviour is attached by palette.js.
  check(
    patientCmds.every((c) => typeof c.run === 'undefined'),
    'patientScopedCommands descriptors carry no run function (pure/declarative — palette.js attaches it)'
  );

  // Gating is re-evaluated fresh each call, not cached/stateful.
  check(
    patientScopedCommands(true).length === 5 && patientScopedCommands(false).length === 0,
    'gating re-evaluates per call (true then false in sequence both correct)'
  );

  // rankCommands works over patient-scoped commands the same as any other —
  // integration sanity check, not a re-test of rankCommands itself.
  const rankedPatient = rankCommands(patientScopedCommands(true), 'copy', []);
  check(
    rankedPatient.length > 0 && rankedPatient[0].id === PATIENT_COMMAND_IDS.COPY_SUMMARY,
    '"copy" query ranks "Copy patient summary" first among patient-scoped commands'
  );

  console.log(`\n--- Results: ${pass} passed, ${failures} failed ---`);
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(`  FAIL  could not load palette-core.js: ${e.message}`);
  process.exit(1);
});
