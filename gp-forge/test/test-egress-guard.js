// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// GP Forge — fail-closed egress guard tests. Run: node test/test-egress-guard.js
// Uses an injected probe so no real network is required.

import { harness } from './helpers.js';
import { assertEgressLocked, EgressOpenError } from '../src/egress-guard.js';

const { check, finish } = harness();

const reachable = async () => true; // canary reachable => egress is OPEN (unsafe)
const blocked = async () => false; // canary unreachable => egress is LOCKED (safe)

(async () => {
  // Open egress + no override => must throw (fail-closed).
  let threw = false;
  try {
    await assertEgressLocked({ canaryHost: 'x', canaryPort: 1, allowOpen: false, probe: reachable });
  } catch (err) {
    threw = err instanceof EgressOpenError;
  }
  check(threw, 'open egress with allowOpen=false → throws EgressOpenError (fail-closed)');

  // Open egress + dev override => warns and continues.
  const logs = [];
  const res = await assertEgressLocked({ canaryHost: 'x', canaryPort: 1, allowOpen: true, probe: reachable, logger: { warn: (m) => logs.push(m) } });
  check(res.locked === false && res.overridden === true && logs.length === 1, 'open egress with allowOpen=true → warns and continues (dev/MOCK only)');

  // Locked egress => safe.
  const ok = await assertEgressLocked({ canaryHost: 'x', canaryPort: 1, allowOpen: false, probe: blocked });
  check(ok.locked === true, 'locked egress → passes');

  finish();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
