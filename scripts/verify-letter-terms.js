// scripts/verify-letter-terms.js — Document Coder: SNOMED verification harness
// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
//
// Run with: node scripts/verify-letter-terms.js [--strict]
//
// PURPOSE
//   The letter-extraction engine (engine/letter-extract.js) emits candidate
//   TERMS; it does not and cannot verify that a term resolves to an active
//   SNOMED CT concept — that is the resolution stage's job. At runtime,
//   resolution runs against Medicus's OWN concept index under the user's
//   session (docs/SNOMED-API-GUIDE.md §1) — letter-derived text is never sent
//   to any public service (the Caldicott rule in the plan). This harness is
//   the OFFLINE, SYNTHETIC-DATA cousin: it takes the engine's own test corpus
//   (invented letters, zero PHI), extracts every OFFERED term, and checks each
//   against the public, no-auth NHS SNOMED CT termbrowser API (the same
//   service, config and fail-closed doctrine as shared/snomed-retirement.js)
//   so we know the extractor's output vocabulary actually lands on real,
//   active UK-edition concepts.
//
//   It also pins the concept IDs used in design artefacts (the UI mockup) so
//   a retired or mistyped ID in a design doc gets caught the same way.
//
// NETWORK HONESTY
//   The concepts/{id} endpoint shape is live-confirmed (2026-07-25, see
//   rules/snomed-terminology-server.json). The descriptions-search endpoint
//   shape below is the expected public sct-browser API form but has NOT yet
//   been live-confirmed from this repo — the first successful networked run
//   should confirm or correct it (update this comment when it does; house
//   doctrine: never silently upgrade an assumption to a fact).
//   On ANY network/shape failure the harness reports "could not verify" and
//   exits 2 — it never claims verification it did not perform.

'use strict';

const path = require('path');
const L = require(path.join(__dirname, '..', 'engine', 'letter-extract.js'));
const CFG = require(path.join(__dirname, '..', 'rules', 'snomed-terminology-server.json'));

const STRICT = process.argv.includes('--strict');

// ── Synthetic corpus (mirrors test-letter-extract.js; no PHI, no NHS numbers)
const PAD = 'Anytown District General Hospital\nDepartment of Medicine\n\n';
const CORPUS = [
  `${PAD}Diagnoses:
1. Community acquired pneumonia
2. New atrial fibrillation, rate controlled on ward
3. Hyponatraemia
4. Type 2 diabetes mellitus
5. Falls`,
  `${PAD}Problems:\n1. Hypertension\n2. Recurrent falls`,
  `${PAD}Diagnoses:\n1. NSTEMI\n2. Acute cholecystitis\n3. Gout, first presentation\n4. Cellulitis of left leg`,
  `${PAD}Primary diagnosis: Acute appendicitis`,
  `${PAD}Impression:\n1. Moderate depressive episode. No suicidal ideation.\n2. Acute otitis media - mother reports 3 days of fever`,
];

// Concept IDs pinned in design artefacts (docs/plans/document-coder-mockup.html)
// — externally corroborated 2026-08-01 (findacode/snomedbrowser); this harness
// re-verifies them against the live UK edition whenever it can reach it.
const PINNED_IDS = {
  49436004: 'Atrial fibrillation',
  700379002: 'Chronic kidney disease stage 3B',
};

// Config's release field already carries its "v" prefix — same URL build as
// shared/snomed-retirement.js buildConceptUrl (baseUrl/edition/release/…).
const BASE = `${CFG.baseUrl}/${CFG.edition}/${CFG.release}`;

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  // A wrong release string returns literal `false` (confirmed live 2026-07-25).
  if (body === false) throw new Error('release-string-rejected (update rules/snomed-terminology-server.json)');
  return body;
}

async function verifyPinnedId(id, expectedLabel) {
  const c = await getJson(`${BASE}/concepts/${id}`);
  const active = c && c.active === true;
  const label = (c && (c.fsn || c.defaultTerm || c.preferredTerm)) || '(no label in response)';
  return { id, expectedLabel, active, label, ok: active };
}

async function searchTerm(term) {
  // Expected public sct-browser search shape — see NETWORK HONESTY above.
  const q = encodeURIComponent(term);
  const url = `${BASE}/descriptions?query=${q}&limit=50&searchMode=partialMatching&lang=english&statusFilter=activeOnly&skipTo=0&returnLimit=5&normalize=true`;
  const body = await getJson(url);
  const matches = (body && (body.matches || body.items || body)) || [];
  const list = Array.isArray(matches) ? matches : [];
  const top = list[0] || null;
  return {
    term,
    resolved: !!top,
    topConceptId: top ? top.conceptId || top.concept_id || null : null,
    topLabel: top ? top.term || top.fsn || null : null,
    matchCount: list.length,
  };
}

(async () => {
  // 1. Harvest every OFFERED term from the corpus via the real engine — so
  //    this list can never drift from what the extractor actually emits.
  const offered = [];
  for (const text of CORPUS) {
    const r = L.assessLetterText(text);
    for (const c of r.candidates) if (c.offered) offered.push(c.term);
  }
  const uniqueTerms = [...new Set(offered)];
  console.log(
    `Extractor emitted ${uniqueTerms.length} unique OFFERED terms from the synthetic corpus:\n  ${uniqueTerms.join('\n  ')}\n`
  );

  let failures = 0;
  try {
    console.log(`— Pinned design-artefact concept IDs (${BASE}) —`);
    for (const [id, label] of Object.entries(PINNED_IDS)) {
      const v = await verifyPinnedId(id, label);
      console.log(`  ${v.ok ? 'OK ' : 'FAIL'} ${id} → ${v.label} (expected ~"${label}", active=${v.active})`);
      if (!v.ok) failures++;
    }

    console.log('\n— Offered-term resolution against the UK edition —');
    for (const term of uniqueTerms) {
      const v = await searchTerm(term);
      if (v.resolved) {
        console.log(`  OK  "${term}" → ${v.topConceptId} ${v.topLabel} (${v.matchCount} matches)`);
      } else {
        console.log(`  MISS "${term}" → no active match (extractor term may need refinement, or search-shape wrong)`);
        failures++;
      }
    }
  } catch (err) {
    console.error(`\nCOULD NOT VERIFY: ${err.message}`);
    console.error(
      'Network or endpoint-shape failure — nothing above the failure point is verified. ' +
        'Re-run from a machine that can reach termbrowser.nhs.uk (the dev sandbox proxy blocks it). ' +
        'This harness never claims verification it did not perform.'
    );
    process.exit(2);
  }

  console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}`);
  process.exit(STRICT && failures ? 1 : 0);
})();
