// Medicus Suite — Note board backup IO tests
// Run with: node test-board-io.js

'use strict';

const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  let passed = 0;
  let failed = 0;
  function check(cond, msg) {
    if (cond) {
      passed++;
      console.log(`  OK    ${msg}`);
    } else {
      failed++;
      console.error(`  FAIL  ${msg}`);
    }
  }

  const io = require('./shared/io/board-io.js');
  const suiteEnv = require('./shared/io/suite-envelope.js');
  const { sanitiseConfig } = await import(pathToFileURL(path.join(__dirname, 'board', 'board-core.js')).href);

  check(
    typeof io.boardExport === 'function' && typeof io.boardImport === 'function',
    'exports boardExport/boardImport'
  );
  check(io.BOARD_KEYS.includes('board.config'), 'covers board.config');
  check(suiteEnv.VALID_SCOPES.includes('board'), 'board is a valid envelope scope');

  {
    const env = suiteEnv.wrap('board', { board: { config: { activeProfileId: 'ops' } } }, '3.248.0');
    const lines = suiteEnv.previewEnvelope(env);
    check(
      lines.some((l) => /^Note board:/.test(l)),
      'previewEnvelope summarises Note board'
    );
  }

  {
    const clean = io.sanitiseImported({
      activeProfileId: 'waiting-room',
      profiles: [
        {
          id: 'waiting-room',
          audience: 'staff',
          widgets: ['pressure', 'flap', 'tempo'],
          message: '<b>Hello</b>  there',
        },
      ],
    });
    const wr = clean.profiles.find((p) => p.id === 'waiting-room');
    check(wr.audience === 'public', 'import locks waiting-room to public');
    check(!wr.widgets.includes('pressure'), 'import strips staff widgets from public profile');
    check(wr.message === 'Hello there', 'import strips markup from the message');
    const cfg = sanitiseConfig(clean);
    check(cfg.profiles.find((p) => p.id === 'waiting-room').audience === 'public', 'core agrees after import');
  }

  {
    let threw = false;
    try {
      io.sanitiseImported({ activeProfileId: 'secret-tv' });
    } catch {
      threw = true;
    }
    check(threw, 'unknown profile id is rejected');
  }

  {
    const clean = io.sanitiseImported({
      activeProfileId: 'c-abc1234',
      publicCountsRequests: true,
      copy: { tempoPublicSteady: '<b>Calm</b>' },
      profiles: [
        {
          id: 'c-abc1234',
          name: 'Pharmacy',
          audience: 'public',
          widgets: ['pressure', 'flap', 'tempo'],
        },
      ],
    });
    const pharm = clean.profiles.find((p) => p.id === 'c-abc1234');
    check(Boolean(pharm), 'import keeps a custom public board');
    check(pharm.audience === 'public', 'import locks a custom public board to public');
    check(!pharm.widgets.includes('pressure'), 'import strips staff widgets from a custom public board');
    check(pharm.name === 'Pharmacy', 'import keeps the custom board name');
    check(clean.publicCountsRequests === true, 'import keeps the public-demand toggle');
    const cfg = sanitiseConfig(clean);
    check(cfg.copy.tempoPublicSteady === 'Calm', 'core strips markup from imported copy');
    check(
      cfg.profiles.find((p) => p.id === 'c-abc1234').name === 'Pharmacy',
      'core keeps the custom board after import'
    );
  }

  {
    const clean = io.sanitiseImported({ styleId: 'harbour' });
    check(clean.styleId === 'harbour', 'import keeps a known look');
    let threw = false;
    try {
      io.sanitiseImported({ styleId: 'neon-club' });
    } catch {
      threw = true;
    }
    check(threw, 'unknown look is rejected on import');
  }

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
