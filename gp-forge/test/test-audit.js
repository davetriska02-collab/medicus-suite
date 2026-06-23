// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// GP Forge — hash-chained audit log tests. Run: node test/test-audit.js

import { harness } from './helpers.js';
import { AuditLog, verifyChain, sha256 } from '../src/audit.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';

const { check, finish } = harness();

const dir = join(tmpdir(), `gpf-audit-${randomUUID()}`);
const path = join(dir, 'audit.jsonl');

const log = new AuditLog({ path, storeContent: false });
const r1 = log.append({ actor: 'alice', task: 'admin_draft', model: 'm', action: 'drafted', input: 'secret-input', output: 'draft-out' });
log.append({ actor: 'bob', task: 'admin_draft', model: 'm', action: 'drafted', input: 'i2', output: 'o2' });

check(verifyChain(path).ok === true, 'intact chain verifies');

const raw = readFileSync(path, 'utf8');
check(!raw.includes('secret-input'), 'raw input is NOT stored by default (only its hash)');
check(r1.inputHash === sha256('secret-input'), 'inputHash is recorded');
check(r1.input === undefined, 'no raw input field when storeContent=false');

// Tamper with the first record; the chain must break.
const lines = raw.split('\n').filter(Boolean);
const rec0 = JSON.parse(lines[0]);
rec0.actor = 'mallory';
lines[0] = JSON.stringify(rec0);
writeFileSync(path, lines.join('\n') + '\n');
const v = verifyChain(path);
check(v.ok === false && v.brokenAt === 0, 'tampering with a record is detected (chain breaks at 0)');

// storeContent=true does persist content (use only with encryption-at-rest + retention).
const path2 = join(dir, 'audit-content.jsonl');
const log2 = new AuditLog({ path: path2, storeContent: true });
log2.append({ actor: 'alice', task: 'admin_draft', model: 'm', action: 'drafted', input: 'INPUTX', output: 'OUTPUTX' });
check(readFileSync(path2, 'utf8').includes('OUTPUTX'), 'storeContent=true persists raw content');

rmSync(dir, { recursive: true, force: true });
finish();
