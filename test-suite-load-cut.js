// Medicus Suite — load-cut regression guard (Dave-go)
// Run with: node test-suite-load-cut.js
'use strict';

const fs = require('fs');
const path = require('path');

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

const ROOT = __dirname;

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function missing(rel) {
  return !fs.existsSync(path.join(ROOT, rel));
}

console.log('Paths removed');
check(missing('side-panel/modules/today/today.js'), 'Today module gone');
check(missing('content-scripts/appointment-tally.js'), 'appointment tally injector gone');
check(missing('board/board.js'), 'Note TV board.js gone');
check(missing('board.html'), 'board.html gone');
check(missing('side-panel/modules/condor/condor-data.js'), 'condor TV fetch layer gone');

console.log('\nNav / registration');
for (const shell of ['side-panel/panel.html', 'pop-out/pop-out.html']) {
  const html = read(shell);
  check(!html.includes('data-module="today"'), `${shell} has no Today tab`);
  check(!html.includes('data-module="board"'), `${shell} has no Note tab`);
}
for (const js of ['side-panel/panel.js', 'pop-out/pop-out.js']) {
  const src = read(js);
  check(!/today:\s*\{/.test(src), `${js} does not register today`);
  check(!/board:\s*\{/.test(src), `${js} does not register board`);
  check(!src.includes("|| 'today'"), `${js} boot does not fall back to today`);
}

console.log('\nMulti-day book scan timers');
check(!fs.existsSync(path.join(ROOT, 'side-panel/modules/today')), 'no Today timers (module deleted)');

console.log('\nRequest Monitor defaults');
const RM = require('./shared/request-monitor.js');
(async () => {
  const mockStore = {};
  global.chrome = {
    storage: {
      local: {
        get: async (keysOrKey) => {
          if (typeof keysOrKey === 'string') return { [keysOrKey]: mockStore[keysOrKey] };
          if (Array.isArray(keysOrKey)) {
            const out = {};
            for (const k of keysOrKey) if (mockStore[k] !== undefined) out[k] = mockStore[k];
            return out;
          }
          return { ...mockStore };
        },
        set: async (obj) => {
          Object.assign(mockStore, obj);
        },
      },
    },
  };
  const cfg = await RM.getConfig();
  check(cfg.pollSeconds === 300, 'default pollSeconds is 300 (5 min)');
  await RM.setConfig({ pollSeconds: 5 });
  const floored = await RM.getConfig();
  check(floored.pollSeconds === 120, 'pollSeconds floor is 120 (2 min)');
  check(RM.MIN_POLL_SECONDS === 120, 'MIN_POLL_SECONDS export is 120');

  console.log('\nRM strip: no panel-side pollAll');
  const panel = read('side-panel/panel.js');
  const rmBlock = panel.slice(panel.indexOf('async function _doFetchAndRenderRmStrip'), panel.indexOf('function renderRmStrip'));
  check(!rmBlock.includes('RequestMonitor.pollAll'), 'rm strip does not call pollAll');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
