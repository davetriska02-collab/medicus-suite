// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// GP Forge — audit log CLI.
//   node src/audit-cli.js verify [path]              → exit 0 if the hash chain is intact, 1 if broken
//   node src/audit-cli.js prune --days N [path]      → archive records older than N days, re-chain the rest
// Default path: $GPF_AUDIT_PATH or ./data/audit.jsonl. `verify` is suitable for cron/monitoring.

import { verifyChain, pruneBefore } from './audit.js';

const args = process.argv.slice(2);
const cmd = args[0];

function flag(name, dflt) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
}
function positionalPath() {
  const days = flag('--days', null);
  return args.slice(1).find((a) => !a.startsWith('--') && a !== days) || process.env.GPF_AUDIT_PATH || './data/audit.jsonl';
}

if (cmd === 'verify') {
  const path = positionalPath();
  const r = verifyChain(path);
  if (r.ok) {
    console.log(`OK — audit chain intact (${r.count} records) — ${path}`);
    process.exit(0);
  }
  console.error(`BROKEN — audit chain fails at record ${r.brokenAt}: ${r.reason} — ${path}`);
  process.exit(1);
} else if (cmd === 'prune') {
  const days = Number(flag('--days', 365));
  if (!Number.isFinite(days) || days < 0) {
    console.error('prune requires --days N (a non-negative number)');
    process.exit(2);
  }
  const path = positionalPath();
  const before = new Date(Date.now() - days * 86_400_000).toISOString();
  const r = pruneBefore(path, before);
  console.log(
    `pruned (older than ${days} days / before ${before}): kept ${r.kept}, archived ${r.archived}` +
      (r.archivePath ? ` → ${r.archivePath}` : '')
  );
  process.exit(0);
} else {
  console.error('usage: audit-cli.js <verify|prune --days N> [path]');
  process.exit(2);
}
