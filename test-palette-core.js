// Medicus Suite — Command palette core logic tests
// Run with: node test-palette-core.js
//
// Covers side-panel/palette/palette-core.js: match scoring, ranking
// (recents-first on empty query, score order on real queries), and the
// recents list maintenance. Pure logic — no chrome APIs, no DOM.

'use strict';

const fs = require('fs');
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
  const {
    scoreMatch,
    rankCommands,
    pushRecent,
    patientScopedCommands,
    PATIENT_COMMAND_IDS,
    omitRetiredCommands,
    shortcutSheet,
    SHELL_SHORTCUTS,
    G_CHORD_MAP,
    RETIRED_COMMAND_IDS,
  } = await import(url);

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
  check(patientCmds.length === 4, `patient context present → 4 patient-scoped commands (got ${patientCmds.length})`);
  check(
    patientCmds.every((c) => c.group === 'Patient'),
    'every patient-scoped command is tagged group "Patient"'
  );

  const patientIds = patientCmds.map((c) => c.id);
  check(
    patientIds.includes(PATIENT_COMMAND_IDS.COPY_SUMMARY),
    '"Copy patient summary" present when patient context exists'
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
    patientScopedCommands(true).length === 4 && patientScopedCommands(false).length === 0,
    'gating re-evaluates per call (true then false in sequence both correct)'
  );

  // rankCommands works over patient-scoped commands the same as any other —
  // integration sanity check, not a re-test of rankCommands itself.
  const rankedPatient = rankCommands(patientScopedCommands(true), 'copy', []);
  check(
    rankedPatient.length > 0 && rankedPatient[0].id === PATIENT_COMMAND_IDS.COPY_SUMMARY,
    '"copy" query ranks "Copy patient summary" first among patient-scoped commands'
  );

  // ── retired commands (Today / tally / Note TV must not reopen) ────────────
  const retired = omitRetiredCommands([
    { id: 'open:board', label: 'Open Note display board' },
    { id: 'nav:today', label: 'Go to Today' },
    { id: 'nav:slots', label: 'Go to Slots' },
    { id: 'open:custom', label: 'Open Note TV' },
    { id: 'open:tally', label: 'Appointment tally' },
  ]);
  check(retired.length === 1 && retired[0].id === 'nav:slots', 'retired Today / Note TV / tally commands are dropped');
  check(RETIRED_COMMAND_IDS.includes('open:board'), 'open:board is on the retired-id list');
  check(!Object.values(G_CHORD_MAP).includes('today'), 'g-chord map has no Today tab');
  check(!Object.values(G_CHORD_MAP).includes('board'), 'g-chord map has no Note tab');
  check(!('t' in G_CHORD_MAP) && !('b' in G_CHORD_MAP), 'g-t and g-b stay unbound');
  check(
    G_CHORD_MAP.i === 'signing' &&
      G_CHORD_MAP.p === 'patient-alerts' &&
      G_CHORD_MAP.h === 'phrases' &&
      G_CHORD_MAP.o === 'rota',
    'g-chords reach Signing, Patient Alerts, Phrases and Rota'
  );

  const catalogUrl = pathToFileURL(path.join(__dirname, 'side-panel', 'tab-catalog.js')).href;
  const { TAB_CATALOG } = await import(catalogUrl);
  const catalogIds = new Set(TAB_CATALOG.map((t) => t.id));
  for (const id of Object.values(G_CHORD_MAP)) {
    check(catalogIds.has(id), `g-chord target "${id}" is a real tab`);
  }

  for (const s of SHELL_SHORTCUTS) {
    if (/ctrl/i.test(s.keys)) {
      check(/cmd/i.test(s.keys), `${s.id} names Cmd as well as Ctrl (got ${s.keys})`);
    }
    check(!/today|note tv|tally/i.test(s.action), `${s.id} does not describe a removed surface`);
  }

  const panelSheet = shortcutSheet('panel', [
    { id: 'slots', name: 'Slots', jumpable: true },
    { id: 'sentinel', name: 'Monitoring', jumpable: false },
    { id: 'signing', name: 'Signing', jumpable: true },
  ]);
  check(
    panelSheet.shortcuts.some((s) => s.id === 'cycle') && panelSheet.shortcuts.some((s) => s.id === 'palette'),
    'panel sheet lists tab cycling and the palette'
  );
  const slotsChord = panelSheet.chords.find((c) => c.id === 'slots');
  const monChord = panelSheet.chords.find((c) => c.id === 'sentinel');
  check(slotsChord && slotsChord.available && slotsChord.key === 's', 'visible Slots chord is offered');
  check(monChord && monChord.available === false, 'a hidden chord target is not claimed as available');
  const signingChord = panelSheet.chords.find((c) => c.id === 'signing');
  check(signingChord && signingChord.key === 'i' && signingChord.available, 'Signing chord is i and available');
  check(
    !panelSheet.noLetter.some((t) => t.id === 'signing'),
    'Signing is not listed as a tab with no letter'
  );
  check(/t or b does nothing/.test(panelSheet.unboundNote), 'sheet says g-t and g-b do nothing');
  check(/Slots through Signing/.test(panelSheet.shortcuts.find((s) => s.id === 'digits').action), 'digits 1–9 are Slots through Signing');

  const popSheet = shortcutSheet('popout', [{ id: 'slots', name: 'Slots', jumpable: true }]);
  check(!popSheet.shortcuts.some((s) => s.id === 'cycle'), 'pop-out sheet does not claim tab cycling');
  check(popSheet.chords.length === 0, 'pop-out sheet has no g-chord map');
  check(/no digit jumps/.test(popSheet.note) && /Ctrl\/Cmd\+K/.test(popSheet.note), 'pop-out sheet says no digits or g-chords; use Ctrl/Cmd+K');

  const paletteSrc = fs.readFileSync(path.join(__dirname, 'side-panel', 'palette', 'palette.js'), 'utf8');
  check(
    !paletteSrc.includes('open:board') && !paletteSrc.includes('openBoardTab'),
    'palette source has no Note board opener'
  );
  check(
    !paletteSrc.includes('modules/today') && !paletteSrc.includes('board.html'),
    'palette source does not import removed surfaces'
  );
  check(paletteSrc.includes('omitRetiredCommands'), 'palette runs the retired-command filter');
  check(
    paletteSrc.includes("id: 'help:shortcuts'") && paletteSrc.includes('data-palette-shortcuts'),
    'palette exposes the shortcuts sheet'
  );
  check(
    paletteSrc.includes('open:duplicate-checker') &&
      paletteSrc.includes('data-module="duplicate-checker"') &&
      paletteSrc.includes('openDuplicateCheckerTab'),
    'pop-out fallback opens the duplicate checker only when that tab is absent'
  );
  check(!paletteSrc.includes('Task Presence'), 'palette.js on this branch does not add Settings: Task Presence');
  const dupSrc = fs.readFileSync(path.join(__dirname, 'pop-out', 'duplicate-open.js'), 'utf8');
  check(dupSrc.includes('duplicate-checker.html'), 'duplicate fallback opens the existing checker page');
  check(
    !/board\.html|modules\/today|appointment-tally|open:board|openBoardTab/.test(dupSrc),
    'duplicate fallback does not reopen removed surfaces'
  );
  check(paletteSrc.includes('Ctrl/Cmd'), 'palette labels name Ctrl and Cmd');

  const panelSrc = fs.readFileSync(path.join(__dirname, 'side-panel', 'panel.js'), 'utf8');
  check(panelSrc.includes("from './palette/palette-core.js'"), 'panel chord map comes from palette-core');
  check(!/const G_CHORD_MAP\s*=/.test(panelSrc), 'panel does not keep a second chord map');
  check(panelSrc.includes('listed tabs only'), 'help copy does not claim g jumps to every tab');
  check(panelSrc.includes('Ctrl/Cmd+Alt'), 'All-tabs hint names Ctrl and Cmd');

  const zenSrc = fs.readFileSync(path.join(__dirname, 'shared', 'zen-mode.js'), 'utf8');
  check(zenSrc.includes('Ctrl/Cmd+.'), 'focus-mode label names Ctrl and Cmd');

  console.log(`\n--- Results: ${pass} passed, ${failures} failed ---`);
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(`  FAIL  could not load palette-core.js: ${e.message}`);
  process.exit(1);
});
