#!/usr/bin/env node
// Durable run-state for the scheduled-task loops. No dependencies.
//
// Canonical store: .claude/scheduled-tasks/state/<loop>.last-run.json
// (override the directory with LOOP_STATE_DIR, used by selftest).
//
// One uniform schema for every loop, so the "did it run / what did it do /
// what's still open" surface is identical across routines. This is what keeps
// the durable-state column from drifting loop-to-loop.
//
// Two transports, one schema:
//   - committed file  — for loops that push to the repo (the-keeper, feature-list,
//     safety-case). Survives the ephemeral container because it lands in a commit.
//   - issue/PR footer — for report-only loops (bug-bash, security-audit,
//     extraction-canary) that must NOT write to the repo. Their durable state
//     rides in the GitHub artefact they already create: an HTML-comment footer
//     line that the next run reads back. The comment is invisible in rendered
//     Markdown but greppable in the raw body.
//
// Usage:
//   node loop-state.js read   <loop>                 # committed-file transport: print current state (bootstrap if absent)
//   node loop-state.js update <loop> < partial.json  # committed-file transport: merge partial, stamp lastRun=now, write
//   node loop-state.js footer <loop> < partial.json  # footer transport: emit the HTML-comment line to append to an issue/PR body
//   node loop-state.js parse          < body.txt     # footer transport: extract the state JSON from a pasted issue/PR body
//   node loop-state.js selftest                      # run built-in assertions (no writes outside a tmp dir)
//
// `update`/`footer` merge the partial object you pipe in over the prior record,
// then stamp `lastRun` (now), `schemaVersion`, and `loop`. Pass only the fields
// a run actually changed, e.g.:
//   echo '{"lastRunMainSha":"abc1234","outcome":"issue-opened","output":"issue #47"}' \
//     | node loop-state.js footer weekly-bug-bash

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const SCHEMA_VERSION = 1;

// Fields the schema defines, with their bootstrap (first-run) values.
function bootstrap(loop) {
  return {
    loop,
    schemaVersion: SCHEMA_VERSION,
    lastRun: null,            // ISO timestamp of the last successful run, or null on bootstrap
    lastRunMainSha: null,     // origin/main short SHA at the last run (use to scope "changed since")
    outcome: 'bootstrap',     // no-op | issue-opened | heartbeat | proposed | pushed | aborted | ...
    output: null,             // ref to the artefact produced (issue #, commit, PR, file path)
    window: null,             // loop-specific scope of the last run, e.g. {since, filesReviewed}
    openItems: [],            // [{id, summary, firstFlagged}] flagged but not yet resolved
    notes: '',                // free text
  };
}

function stateDir() {
  return process.env.LOOP_STATE_DIR || path.join(__dirname, '..', 'state');
}

function statePath(loop) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(loop)) {
    throw new Error(`invalid loop name: ${JSON.stringify(loop)} (use lowercase, digits, hyphens)`);
  }
  return path.join(stateDir(), `${loop}.last-run.json`);
}

function read(loop) {
  const p = statePath(loop);
  if (!fs.existsSync(p)) return bootstrap(loop);
  const stored = JSON.parse(fs.readFileSync(p, 'utf8'));
  // Fold over the bootstrap default so a record written by an older schema
  // still has every current field present when read.
  return { ...bootstrap(loop), ...stored, loop };
}

function update(loop, partial) {
  if (partial === null || typeof partial !== 'object' || Array.isArray(partial)) {
    throw new Error('update expects a JSON object on stdin');
  }
  const next = {
    ...read(loop),
    ...partial,
    loop,
    schemaVersion: SCHEMA_VERSION,
    lastRun: new Date().toISOString(),
  };
  const p = statePath(loop);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(next, null, 2) + '\n');
  return next;
}

function readStdin() {
  const raw = fs.readFileSync(0, 'utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

function readStdinRaw() {
  return fs.readFileSync(0, 'utf8');
}

const FOOTER_RE = /<!--\s*loop-state v(\d+)\s+(\{.*?\})\s*-->/s;

// Render a one-line HTML-comment footer to embed in an issue/PR body. The body
// itself is the durable store for report-only loops, so there's no prior file to
// merge over — the partial you pass IS the record (plus stamps).
function footer(loop, partial) {
  if (partial === null || typeof partial !== 'object' || Array.isArray(partial)) {
    throw new Error('footer expects a JSON object on stdin');
  }
  const rec = {
    ...bootstrap(loop),
    ...partial,
    loop,
    schemaVersion: SCHEMA_VERSION,
    lastRun: new Date().toISOString(),
  };
  return `<!-- loop-state v${SCHEMA_VERSION} ${JSON.stringify(rec)} -->`;
}

// Extract the state record from a pasted issue/PR body. Returns null if none.
function parse(body) {
  const m = FOOTER_RE.exec(body || '');
  if (!m) return null;
  return JSON.parse(m[2]);
}

function selftest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-state-'));
  process.env.LOOP_STATE_DIR = dir;
  const assert = (cond, msg) => { if (!cond) { throw new Error('FAIL: ' + msg); } };

  // Bootstrap read when no file exists.
  const boot = read('weekly-demo');
  assert(boot.lastRun === null, 'bootstrap lastRun is null');
  assert(boot.outcome === 'bootstrap', 'bootstrap outcome');
  assert(Array.isArray(boot.openItems) && boot.openItems.length === 0, 'bootstrap openItems empty');

  // Update merges and stamps.
  const a = update('weekly-demo', { lastRunMainSha: 'abc1234', outcome: 'issue-opened', output: 'issue #1' });
  assert(a.lastRunMainSha === 'abc1234', 'update set sha');
  assert(a.outcome === 'issue-opened', 'update set outcome');
  assert(typeof a.lastRun === 'string' && a.lastRun.endsWith('Z'), 'update stamped lastRun');
  assert(fs.existsSync(path.join(dir, 'weekly-demo.last-run.json')), 'file written');

  // Partial update preserves prior fields it doesn't mention.
  const b = update('weekly-demo', { outcome: 'no-op' });
  assert(b.lastRunMainSha === 'abc1234', 'partial update preserves sha');
  assert(b.outcome === 'no-op', 'partial update overrides outcome');

  // Re-read round-trips.
  const c = read('weekly-demo');
  assert(c.outcome === 'no-op' && c.lastRunMainSha === 'abc1234', 'round-trip');

  // Bad loop name rejected.
  let threw = false;
  try { statePath('../escape'); } catch { threw = true; }
  assert(threw, 'rejects bad loop name');

  // Footer transport: render → parse round-trips, and survives surrounding text.
  const line = footer('weekly-bug-bash', { lastRunMainSha: 'def5678', outcome: 'issue-opened', output: 'issue #9' });
  assert(line.startsWith('<!-- loop-state v1 ') && line.endsWith('-->'), 'footer shape');
  const body = `## Summary\nsome findings\n\n${line}\n`;
  const got = parse(body);
  assert(got && got.lastRunMainSha === 'def5678', 'parse recovers sha');
  assert(got.outcome === 'issue-opened' && got.loop === 'weekly-bug-bash', 'parse recovers fields');
  assert(typeof got.lastRun === 'string' && got.lastRun.endsWith('Z'), 'footer stamped lastRun');
  assert(parse('no footer here') === null, 'parse returns null when absent');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('loop-state selftest: OK');
}

function main() {
  const [cmd, loop] = process.argv.slice(2);
  try {
    if (cmd === 'read') {
      if (!loop) throw new Error('usage: loop-state.js read <loop>');
      console.log(JSON.stringify(read(loop), null, 2));
    } else if (cmd === 'update') {
      if (!loop) throw new Error('usage: loop-state.js update <loop> < partial.json');
      console.log(JSON.stringify(update(loop, readStdin()), null, 2));
    } else if (cmd === 'footer') {
      if (!loop) throw new Error('usage: loop-state.js footer <loop> < partial.json');
      console.log(footer(loop, readStdin()));
    } else if (cmd === 'parse') {
      const rec = parse(readStdinRaw());
      if (rec === null) { console.error('no loop-state footer found'); process.exit(3); }
      console.log(JSON.stringify(rec, null, 2));
    } else if (cmd === 'selftest') {
      selftest();
    } else {
      console.error('usage: loop-state.js <read|update|footer|parse|selftest> [loop]');
      process.exit(2);
    }
  } catch (e) {
    console.error('loop-state error: ' + e.message);
    process.exit(1);
  }
}

if (require.main === module) main();
module.exports = { read, update, footer, parse, bootstrap, SCHEMA_VERSION };
