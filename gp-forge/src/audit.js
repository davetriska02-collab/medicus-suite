// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// GP Forge — append-only, hash-chained audit log.
// Records {who, when, model, task, input/output hashes, reviewer, action}. Each record's hash
// includes the previous record's hash, so any later edit/deletion breaks the chain (tamper-evident).
// DEFAULT: stores HASHES of input/output, NOT raw content — so the audit file is not a plaintext
// PHI store. Set storeContent:true only with DB/disk encryption-at-rest + a retention policy.

import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const GENESIS = 'GENESIS';

export function sha256(input) {
  return createHash('sha256').update(typeof input === 'string' ? input : JSON.stringify(input)).digest('hex');
}

// Deterministic stringify (sorted keys) so the hash is stable regardless of property order.
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function lastHashOf(path) {
  if (!existsSync(path)) return GENESIS;
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  if (lines.length === 0) return GENESIS;
  try {
    return JSON.parse(lines[lines.length - 1]).hash || GENESIS;
  } catch {
    return GENESIS;
  }
}

export class AuditLog {
  constructor({ path, storeContent = false } = {}) {
    if (!path) throw new Error('AuditLog requires a path');
    this.path = path;
    this.storeContent = storeContent;
    mkdirSync(dirname(path), { recursive: true });
    this.prevHash = lastHashOf(path);
  }

  // entry: { actor, task, model, action, input, output, reviewer }
  append(entry) {
    const rec = {
      id: randomUUID(),
      ts: entry.ts || new Date().toISOString(),
      actor: entry.actor ?? null,
      task: entry.task ?? null,
      model: entry.model ?? null,
      action: entry.action ?? null,
      reviewer: entry.reviewer ?? null, // null until a human reviews/files — updated by a later record
      inputHash: entry.input === undefined ? null : sha256(entry.input),
      outputHash: entry.output === undefined ? null : sha256(entry.output),
      prevHash: this.prevHash,
    };
    if (this.storeContent) {
      rec.input = entry.input ?? null;
      rec.output = entry.output ?? null;
    }
    rec.hash = sha256(this.prevHash + stableStringify(rec));
    appendFileSync(this.path, JSON.stringify(rec) + '\n');
    this.prevHash = rec.hash;
    return rec;
  }
}

// Re-derive the chain and report the first record where it breaks (tamper / deletion / reorder).
export function verifyChain(path) {
  if (!existsSync(path)) return { ok: true, count: 0 };
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  let prev = GENESIS;
  for (let i = 0; i < lines.length; i++) {
    let rec;
    try {
      rec = JSON.parse(lines[i]);
    } catch {
      return { ok: false, brokenAt: i, reason: 'unparseable record' };
    }
    if (rec.prevHash !== prev) return { ok: false, brokenAt: i, reason: 'prevHash mismatch' };
    const { hash, ...rest } = rec;
    if (sha256(prev + stableStringify(rest)) !== hash) return { ok: false, brokenAt: i, reason: 'hash mismatch' };
    prev = hash;
  }
  return { ok: true, count: lines.length };
}

// Retention: archive records older than `beforeISO` (the chain prefix from GENESIS, so the archive
// stays independently verifiable) and re-chain the kept records into a fresh active log. Re-chaining
// changes the kept records' hashes — that is the documented retention action; the archive preserves
// the originals.
export function pruneBefore(path, beforeISO) {
  if (!existsSync(path)) return { kept: 0, archived: 0, archivePath: null };
  const recs = readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const cutoff = new Date(beforeISO).toISOString();
  const archived = recs.filter((r) => r.ts < cutoff);
  const kept = recs.filter((r) => r.ts >= cutoff);

  let archivePath = null;
  if (archived.length) {
    archivePath = `${path}.${Date.now()}.archive.jsonl`;
    writeFileSync(archivePath, archived.map((r) => JSON.stringify(r)).join('\n') + '\n');
  }

  let prev = GENESIS;
  const rechained = kept.map((r) => {
    const { hash, prevHash, ...rest } = r;
    void hash;
    void prevHash;
    const base = { ...rest, prevHash: prev };
    const h = sha256(prev + stableStringify(base));
    prev = h;
    return { ...base, hash: h };
  });
  writeFileSync(path, rechained.length ? rechained.map((r) => JSON.stringify(r)).join('\n') + '\n' : '');
  return { kept: kept.length, archived: archived.length, archivePath };
}
