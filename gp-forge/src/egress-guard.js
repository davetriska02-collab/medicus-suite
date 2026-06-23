// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// GP Forge — fail-closed egress guard (the CSO's refuse-to-sign condition, as a runtime control).
// The appliance must NOT reach the internet beyond the allow-listed Medicus host. On startup (and
// callable periodically) we probe a CANARY external host that should be UNREACHABLE if egress is
// properly locked. If the canary IS reachable, egress is open → we refuse (throw) → the caller must
// not process patient data. A dev override (allowOpen) downgrades this to a loud warning for MOCK-data
// local development only.

import { connect } from 'node:net';

export class EgressOpenError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EgressOpenError';
  }
}

// Default probe: returns true if a TCP connection to host:port SUCCEEDS (i.e. egress is open).
export function tcpProbe(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    let settled = false;
    const done = (reachable) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

// Returns { locked, reachable }. Throws EgressOpenError when egress is open and allowOpen is false.
export async function assertEgressLocked({ canaryHost, canaryPort, allowOpen = false, probe = tcpProbe, logger = console } = {}) {
  const reachable = await probe(canaryHost, canaryPort);
  if (reachable) {
    const msg =
      `Egress is NOT locked: reached canary ${canaryHost}:${canaryPort}. The appliance can reach the ` +
      `internet beyond the allow-listed Medicus host.`;
    if (allowOpen) {
      logger.warn(`[gp-forge] WARNING — ${msg} GPF_ALLOW_OPEN_EGRESS=true: continuing for DEV/MOCK use only. Do NOT process patient data.`);
      return { locked: false, reachable: true, overridden: true };
    }
    throw new EgressOpenError(`${msg} Refusing to start (fail-closed). Lock egress or set GPF_ALLOW_OPEN_EGRESS=true for dev only.`);
  }
  return { locked: true, reachable: false };
}
