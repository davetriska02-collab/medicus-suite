// Medicus Suite — availability wall setup canvas
// Run with: node test-availability-setup.js
'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) {
    passed++;
    console.log(`  OK  ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL  ${msg}`);
  }
}

function slot(extra) {
  return Object.assign(
    {
      id: 's1',
      startMs: 1,
      endMs: 2,
      slotType: 'Practice nurse',
      sessionName: 'Morning list',
      sessionHaystack: 'Morning list Practice nurse Nurse Example',
      clinician: 'Nurse Example',
      roleHints: [],
      site: 'Example Surgery',
      delivery: 'face to face',
    },
    extra || {}
  );
}

function saved(tiles, extra) {
  return Object.assign({ confirmed: true, pollMinutes: 5, tiles }, extra || {});
}

(async () => {
  const core = await import(pathToFileURL(path.join(__dirname, 'shared/availability-board-core.js')).href);
  const setup = await import(pathToFileURL(path.join(__dirname, 'shared/availability-setup-core.js')).href);
  const canvas = await import(pathToFileURL(path.join(__dirname, 'availability/setup-canvas.js')).href);

  console.log('\n--- one pot, and a saved mapping is not rewritten on open ---');
  check(setup.ONE_POT_PER_ITEM === true, 'one name belongs on one tile');
  check(core.MATCH_LIST_MAX === 48, 'a dragged name is kept up to 48, not dropped at 16');

  const nursing = {
    id: 'nursing',
    label: 'Nursing / HCA',
    matchOrder: 0,
    displayOrder: 1,
    match: { types: ['nurse'], sessions: ['nurse'], roles: ['nurse'] },
    exclude: { types: ['nurse practitioner'], sessions: [], roles: [] },
  };
  const otd = {
    id: 'otd-gp',
    label: 'On-the-day GP',
    matchOrder: 1,
    displayOrder: 2,
    match: { types: ['duty'], sessions: [], roles: [] },
    exclude: { types: [], sessions: [], roles: [] },
  };
  const visits = {
    id: 'visits',
    label: 'Visits',
    matchOrder: 2,
    displayOrder: 3,
    match: { types: ['visit'], sessions: [], roles: [] },
    exclude: { types: [], sessions: [], roles: [] },
  };
  const original = core.normaliseConfig(saved([nursing, otd, visits]));
  const beforeSig = JSON.stringify(setup.mappingSignature(original));
  const nurseSlot = slot();
  const beforeAssign = JSON.stringify(core.assignSlots([nurseSlot], original.tiles));
  const migrated = setup.migrateConfig(original);
  check(JSON.stringify(setup.mappingSignature(migrated)) === beforeSig, 'migrate keeps every saved needle');
  check(
    JSON.stringify(core.assignSlots([nurseSlot], migrated.tiles)) === beforeAssign,
    'opening the canvas does not move an existing slot'
  );
  const viewed = setup.setupView(original, { slotTypes: [], sessions: [], clinicians: [] }, [nurseSlot], {});
  check(JSON.stringify(setup.mappingSignature(original)) === beforeSig, 'reading the canvas does not edit the mapping');
  check(
    core.tileForSlot(nurseSlot, original.tiles).id === 'nursing',
    'a practice nurse slot still follows the nurse pattern before anyone drags'
  );

  console.log('\n--- catalog: once, counted, two lists stay two names ---');
  const observed = {
    slotTypes: ['Practice nurse', 'practice nurse', 'GP'],
    sessions: ['Morning list', 'Practice nurse'],
    clinicians: ['Nurse Example', 'Dr Example'],
  };
  const slots = [
    nurseSlot,
    slot({ id: 's2', slotType: 'Practice nurse', sessionName: 'Morning list', clinician: 'Dr Example' }),
    slot({ id: 's3', slotType: 'GP', sessionName: 'Morning list', clinician: 'Dr Example' }),
  ];
  const catalog = setup.buildCatalog(observed, slots);
  const typeRows = catalog.filter((item) => item.kind === 'types' && item.folded === 'practice nurse');
  check(typeRows.length === 1, 'the same slot type is listed once');
  check(typeRows[0].count === 2, 'upcoming slots of that type are counted');
  check(
    catalog.filter((item) => item.name === 'Practice nurse').length === 2,
    'a slot type and a session with the same words are two names'
  );
  const gp = catalog.find((item) => item.kind === 'types' && item.folded === 'gp');
  check(gp && gp.mappable === false, 'gp is too short to pin on its own');
  const diaries = catalog.filter((item) => item.kind === 'roles');
  check(diaries.length === 2, 'each diary is listed once');
  check(
    diaries.find((item) => item.folded === 'dr example').count === 2,
    'diary count is the upcoming slots on that diary'
  );

  console.log('\n--- add, move, remove ---');
  const added = setup.placeItem(original, { kind: 'types', name: 'Practice nurse' }, 'otd-gp');
  check(added.ok === true, 'dragging a slot type onto a tile is accepted');
  check(added.config.confirmed === true, 'dragging does not change the saved confirmed flag');
  const otdMatch = added.config.tiles.find((tile) => tile.id === 'otd-gp').match.types;
  const nursingAfter = added.config.tiles.find((tile) => tile.id === 'nursing');
  check(otdMatch.includes('practice nurse'), 'the exact name is stored on the tile');
  check(!nursingAfter.match.types.includes('practice nurse'), 'the exact name is not left on the other tile');
  check(
    nursingAfter.match.types.includes('nurse') && nursingAfter.match.sessions.includes('nurse'),
    'the broader pattern rules are kept'
  );
  check(
    nursingAfter.exclude.types.includes('practice nurse'),
    'the pattern tile excludes that exact name so it cannot steal the slots'
  );
  check(core.tileForSlot(nurseSlot, added.config.tiles).id === 'otd-gp', 'after the drag the slot is on the new tile');

  const moved = setup.placeItem(added.config, { kind: 'types', name: 'Practice nurse' }, 'visits');
  check(moved.ok === true, 'a name can move to another tile');
  check(
    moved.config.tiles.find((tile) => tile.id === 'visits').match.types.includes('practice nurse'),
    'the name is on the tile it was dropped on'
  );
  check(
    !moved.config.tiles.find((tile) => tile.id === 'otd-gp').match.types.includes('practice nurse'),
    'the name is taken off the previous tile'
  );
  check(core.tileForSlot(nurseSlot, moved.config.tiles).id === 'visits', 'the slot follows the move');

  const removed = setup.unmapItem(moved.config, { kind: 'types', name: 'Practice nurse' });
  check(removed.ok === true, 'removing a name is accepted');
  check(
    removed.config.tiles.every((tile) => !tile.match.types.includes('practice nurse')),
    'the exact name is off every tile'
  );
  check(core.tileForSlot(nurseSlot, removed.config.tiles) == null, 'the pattern does not put the name back');
  check(
    removed.config.tiles.find((tile) => tile.id === 'nursing').match.types.includes('nurse'),
    'removing one name does not delete the pattern that covers other names'
  );
  const otherNurse = slot({ id: 's4', slotType: 'Treatment room nurse' });
  check(
    core.tileForSlot(otherNurse, removed.config.tiles).id === 'nursing',
    'another nurse type still follows the pattern'
  );

  console.log('\n--- duplicates stay until someone edits them ---');
  const dupCfg = core.normaliseConfig(
    saved([
      {
        id: 'otd-gp',
        label: 'On-the-day GP',
        matchOrder: 0,
        displayOrder: 1,
        match: { types: ['same day clinic'] },
      },
      {
        id: 'routine-gp',
        label: 'Routine GP',
        matchOrder: 1,
        displayOrder: 2,
        match: { types: ['same day clinic'] },
      },
    ])
  );
  const dupSlot = slot({ slotType: 'Same day clinic', sessionName: 'Booked', clinician: 'Dr Example' });
  const dupSig = JSON.stringify(setup.mappingSignature(dupCfg));
  const report = setup.placementReport(
    dupCfg,
    setup.buildCatalog({ slotTypes: ['Same day clinic'], sessions: [], clinicians: [] }, [dupSlot]),
    [dupSlot]
  );
  check(JSON.stringify(setup.mappingSignature(dupCfg)) === dupSig, 'reporting a duplicate does not delete it');
  check(report[0].duplicate === true, 'a name stored on two tiles is reported');
  check(report[0].warning.includes('Only On-the-day GP is counted'), 'the warning names the tile that is counted');
  const dupAssign = core.assignSlots([dupSlot, dupSlot], dupCfg.tiles);
  check(dupAssign.byId['otd-gp'].length === 2, 'both slots are counted once, on the earlier tile');
  check(dupAssign.byId['routine-gp'].length === 0, 'the later tile does not count them again');
  check((dupAssign.unmapped || []).length === 0, 'a duplicate mapping is not a second copy and not a drop');

  const cleared = setup.removeFromPot(dupCfg, { kind: 'types', name: 'Same day clinic' }, 'otd-gp');
  check(cleared.ok === true, 'remove takes the name off the tile that was pressed');
  check(
    !cleared.config.tiles.find((tile) => tile.id === 'otd-gp').match.types.includes('same day clinic'),
    'the pressed tile no longer has the name'
  );
  check(
    cleared.config.tiles.find((tile) => tile.id === 'routine-gp').match.types.includes('same day clinic'),
    'the other tile keeps it, so one pot remains'
  );
  check(core.tileForSlot(dupSlot, cleared.config.tiles).id === 'routine-gp', 'the remaining tile now counts the slot');

  console.log('\n--- short names, a full tile, telephone, preview ---');
  const short = setup.placeItem(original, { kind: 'types', name: 'GP' }, 'otd-gp');
  check(short.ok === false && short.reason === 'short', 'a two-letter name is refused');
  check(
    JSON.stringify(setup.mappingSignature(short.config)) === beforeSig,
    'a refused drag leaves the mapping as it was'
  );

  const many = [];
  for (let i = 0; i < 48; i++) many.push(`alpha name ${i}`);
  const full = core.normaliseConfig(saved([{ id: 'custom-1', label: 'Pot', match: { types: many } }]));
  check(full.tiles[0].match.types.length === 48, '48 names are stored');
  const overflow = setup.placeItem(full, { kind: 'types', name: 'zeta extra name' }, 'custom-1');
  check(overflow.ok === false && overflow.reason === 'full', 'the 49th name is refused instead of being dropped');
  check(overflow.config.tiles[0].match.types.length === 48, 'a full tile is left unchanged');

  const seventeen = [];
  for (let i = 0; i < 17; i++) seventeen.push(`beta name ${i}`);
  const kept = core.normaliseConfig(saved([{ id: 'custom-2', label: 'Pot', match: { types: seventeen } }]));
  check(kept.tiles[0].match.types.length === 17, 'a list longer than the old cap of 16 is kept');

  const phone = setup.placeItem(original, { kind: 'types', name: 'Telephone consult' }, 'otd-gp');
  check(phone.ok === true && /telephone or video/.test(phone.notice), 'putting a telephone name on a tile says so');
  const phoneSlot = slot({
    id: 'ph',
    slotType: 'Telephone consult',
    delivery: 'telephone',
    sessionHaystack: 'Morning list Telephone consult Nurse Example',
  });
  check(
    core.tileForSlot(phoneSlot, phone.config.tiles).id === 'otd-gp',
    'the preview rule counts that telephone slot on the tile'
  );

  const preview = setup.previewAssignment([nurseSlot, phoneSlot], added.config);
  const otdPreview = preview.tiles.find((tile) => tile.id === 'otd-gp');
  check(
    otdPreview.count === 1 && otdPreview.onWall === true,
    'the live preview counts the pinned slot on the wall tile'
  );
  check(preview.unmapped === 1, 'a slot that matches no tile is counted as not on a tile');

  console.log('\n--- undo ---');
  let stack = setup.pushUndo([], original);
  stack = setup.pushUndo(stack, added.config);
  const undone = setup.popUndo(stack);
  check(
    JSON.stringify(setup.mappingSignature(undone.config)) === JSON.stringify(setup.mappingSignature(added.config)),
    'undo returns the mapping from before the last change'
  );
  const undoneAgain = setup.popUndo(undone.stack);
  check(
    JSON.stringify(setup.mappingSignature(undoneAgain.config)) === beforeSig,
    'a second undo returns the saved mapping'
  );
  check(setup.popUndo([]).config == null, 'undo with nothing stored does not invent a mapping');

  console.log('\n--- canvas markup ---');
  const filterCfg = core.normaliseConfig(
    saved([{ id: 'custom-9', label: 'Pot', matchOrder: 0, displayOrder: 1, match: { types: ['baby clinic'] } }])
  );
  const filterSlots = [
    slot({ slotType: 'Baby clinic', sessionName: 'Afternoon list', clinician: 'Dr Example' }),
    slot({ id: 'u', slotType: 'Asthma clinic', sessionName: 'Afternoon list', clinician: 'Dr Example' }),
  ];
  const filtered = setup.setupView(
    filterCfg,
    { slotTypes: ['Baby clinic', 'Asthma clinic'], sessions: ['Afternoon list'], clinicians: ['Dr Example'] },
    filterSlots,
    { query: 'asthma', kind: 'types' }
  );
  check(
    filtered.palette.length === 1 && filtered.palette[0].name === 'Asthma clinic',
    'search shows the unmapped slot type once'
  );
  check(filtered.pots[0].hiddenBySearch === 1, 'a mapped name hidden by search is still on the tile');
  const html = canvas.renderSetup({
    ...setup.setupView(added.config, observed, [nurseSlot], {}),
    warnings: ['Same day clinic is listed on two tiles.'],
    draggingId: typeRows[0].id,
    dragOver: 'otd-gp',
    openDetails: [],
  });
  check(html.includes('draggable="true"'), 'names can be dragged');
  check(html.includes('Not on a tile'), 'unmapped names and the Move menu say Not on a tile');
  check(html.includes('If you save now'), 'the preview is labelled as the count that would be saved');
  check(html.includes('>Remove<'), 'a mapped name has a remove button');
  check(html.includes('Warning. Same day clinic'), 'a duplicate is written out, not signalled by colour alone');
  check(html.includes('is-dragging') && html.includes('is-over'), 'a drag shows the name and the tile under it');
  check(html.includes('Pattern rules'), 'typed pattern rules stay on the tile');
  check(!html.includes('Patient Example') && !html.includes('NHS'), 'the canvas markup is not a patient record');

  console.log('\n--- page wires the canvas ---');
  const wall = fs.readFileSync(path.join(__dirname, 'availability/wall.js'), 'utf8');
  const page = fs.readFileSync(path.join(__dirname, 'availability/wall.html'), 'utf8');
  check(
    wall.includes('renderSetup') && wall.includes('placeItem') && wall.includes('removeFromPot'),
    'the page uses the canvas mapping'
  );
  check(page.includes('id="avUndo"'), 'undo is on the setup dialog');
  check(wall.includes('confirmed: true'), 'save is what confirms the mapping');
  check(wall.includes('The mapping was not saved'), 'a failed save stays on the dialog');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
