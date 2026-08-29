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

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
