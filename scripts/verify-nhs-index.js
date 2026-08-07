#!/usr/bin/env node
// Medicus Suite — verify rules/nhs-az-index.json against the live nhs.uk site.
//
// The Leaflets tab (side-panel/modules/leaflets/) ships a bundled A-Z index of
// condition/medicine slugs, AUTHORED from general nhs.uk URL-convention
// knowledge — not scraped, and not verifiable from the sandbox that built it
// (no route to nhs.uk there; see CLAUDE.md network policy). This script is
// the safety net: run it on a machine with normal internet egress and it
// HEAD-requests every entry's URL, reporting anything that is not a 200 so a
// broken/renamed slug can be fixed or removed before it ships.
//
// Usage:
//   node scripts/verify-nhs-index.js                 (report only, exit 0 unless a request fails to even connect)
//   node scripts/verify-nhs-index.js --fail-on-error  (exit non-zero if any entry is not a 200 — for CI on a machine with egress)
//
// Every entry is checked at low concurrency with a short delay between
// batches — this is a few hundred requests to a public NHS service, run by a
// human occasionally, not a scraper; be polite.

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const INDEX_PATH = path.join(__dirname, '..', 'rules', 'nhs-az-index.json');
const CONCURRENCY = 5;
const BATCH_DELAY_MS = 250;
const TIMEOUT_MS = 10000;

const KIND_SEGMENT = { condition: 'conditions', medicine: 'medicines' };

function buildUrl(entry) {
  const seg = KIND_SEGMENT[entry.kind] || 'conditions';
  return `https://www.nhs.uk/${seg}/${entry.slug}/`;
}

function headRequest(url) {
  return new Promise((resolve) => {
    const req = https.request(
      url,
      { method: 'HEAD', timeout: TIMEOUT_MS, headers: { 'User-Agent': 'medicus-suite-nhs-az-index-verifier/1.0' } },
      (res) => {
        // Drain and resolve; a redirect chain resolves at its final status
        // because Node's https does not auto-follow — report the first hop's
        // status plus location so a 3xx is visible rather than silently OK.
        resolve({ status: res.statusCode, location: res.headers.location || null });
        res.resume();
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: null, error: 'timeout' });
    });
    req.on('error', (err) => {
      resolve({ status: null, error: err.message });
    });
    req.end();
  });
}

async function runBatched(items, worker, concurrency) {
  const results = new Array(items.length);
  let next = 0;
  async function lane() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS / concurrency));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, lane));
  return results;
}

async function main() {
  const failOnError = process.argv.includes('--fail-on-error');

  if (!fs.existsSync(INDEX_PATH)) {
    console.error(`Index not found: ${INDEX_PATH}`);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
  const entries = Array.isArray(raw.entries) ? raw.entries : [];
  if (entries.length === 0) {
    console.error('Index has no entries — nothing to verify.');
    process.exit(1);
  }

  console.log(`Verifying ${entries.length} nhs.uk URLs (concurrency ${CONCURRENCY})...\n`);

  const results = await runBatched(
    entries,
    async (entry) => {
      const url = buildUrl(entry);
      const r = await headRequest(url);
      return { entry, url, ...r };
    },
    CONCURRENCY
  );

  const bad = results.filter((r) => r.status !== 200);
  const ok = results.length - bad.length;

  console.log(`OK (200): ${ok}/${results.length}\n`);

  if (bad.length > 0) {
    console.log('Non-200 / failed entries:');
    for (const r of bad) {
      const detail = r.error ? `ERROR: ${r.error}` : `status ${r.status}${r.location ? ` -> ${r.location}` : ''}`;
      console.log(`  ${r.entry.kind}/${r.entry.slug}  (${r.entry.name})  ${detail}\n    ${r.url}`);
    }
    console.log(
      `\n${bad.length} entr${bad.length === 1 ? 'y needs' : 'ies need'} fixing or removing from rules/nhs-az-index.json.`
    );
  } else {
    console.log('All entries verified.');
  }

  if (failOnError && bad.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
