// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
//
// test-record-allergy-prompts.js — unit tests for buildAllergyPrompts()
// (side-panel/modules/record/record.js)
//
// Runs under `node --test` (Node.js built-in test runner). No browser is
// required: buildAllergyPrompts evaluates the REAL drug-allergy rules
// (rules/drug-rules.json) via the REAL SentinelRules engine
// (engine/rules-engine.js) and renders any resulting chip via the REAL
// ChipRenderer.renderDrugAllergyChip (shared/chip-renderer.js) — the exact
// same engine + renderer content-scripts/sentinel.js already uses for this
// chip type (see test-drug-allergy.js / test-drug-allergy-render.js for the
// same real-engine, real-rules idiom this file follows). Neither dependency
// touches the DOM, so both `require` cleanly here.
//
// Fixtures are SYNTHETIC. The NHS number '1234567890' deliberately FAILS the
// Modulus-11 checksum (same convention as test-fhir-enrichment.js) so it can
// never be a real NHS number.

'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const SentinelRules = require('./engine/rules-engine.js');
const ChipRenderer = require('./shared/chip-renderer.js');

// ── Module import shim ────────────────────────────────────────────────────────
// record.js is an ES module with a bare import at the top. We use a dynamic
// import() so this CommonJS harness can pull the named export (same idiom as
// test-record-summary.js). The module's top level closes over `chrome` and
// (for buildAllergyPrompts) `window` — neither is called until a function is
// actually invoked, so the stubs just need to exist to avoid a
// ReferenceError at parse/call time.
globalThis.chrome = {
  runtime: { onMessage: { addListener() {}, removeListener() {} } },
  tabs: { onActivated: null, onUpdated: null },
};
globalThis.window = globalThis.window || {};

// The import path must be file:// for Node ESM.
const MODULE_URL = new URL('./side-panel/modules/record/record.js', `file://${process.cwd()}/`).href;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const DRUG_RULES = JSON.parse(readFileSync(path.join(__dirname, 'rules', 'drug-rules.json'), 'utf8')).rules;

const PATIENT_CONTEXT = { ageYears: 50, nhsNumber: '1234567890' }; // checksum-INVALID by construction

function fixtureModel(overrides) {
  return Object.assign(
    {
      allergies: [{ label: 'Penicillin allergy', status: 'active' }],
      medications: [{ name: 'Amoxicillin 500mg capsules' }],
      problems: [],
      observations: [],
      patientContext: PATIENT_CONTEXT,
    },
    overrides
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('buildAllergyPrompts', async () => {
  // Load the ES module once.
  let buildAllergyPrompts;
  try {
    const mod = await import(MODULE_URL);
    buildAllergyPrompts = mod.buildAllergyPrompts;
  } catch (e) {
    // If the import itself fails (e.g. syntax error), surface it loudly.
    it('module imports without error', () => {
      assert.fail(`Failed to import record.js: ${e.message}\n${e.stack}`);
    });
    return;
  }

  it('module exports buildAllergyPrompts', () => {
    assert.equal(typeof buildAllergyPrompts, 'function');
  });

  describe('with the real engine + real rules/drug-rules.json', () => {
    beforeEach(() => {
      globalThis.window.SentinelRules = SentinelRules;
      globalThis.window.ChipRenderer = ChipRenderer;
    });

    it('allergy + matching medication -> a prompt is rendered from the engine chip', () => {
      const html = buildAllergyPrompts(fixtureModel(), DRUG_RULES);
      assert.equal(typeof html, 'string');
      assert.notEqual(html, '');
      assert.match(html, /class="sent-chip /, 'rendered via the shared chip markup, not bespoke HTML');
      assert.match(html, /Penicillin allergy \+ Amoxicillin/, 'carries the engine-computed matchSummary');
    });

    it('no allergies -> empty, and the engine is never called', () => {
      let calls = 0;
      globalThis.window.SentinelRules = {
        ...SentinelRules,
        evaluatePatient(...args) {
          calls++;
          return SentinelRules.evaluatePatient(...args);
        },
      };
      const html = buildAllergyPrompts(fixtureModel({ allergies: [] }), DRUG_RULES);
      assert.equal(html, '');
      assert.equal(calls, 0, 'evaluatePatient must never be called when there is no allergy data');
    });

    it('allergies undefined (session-only model) -> empty, no throw', () => {
      assert.doesNotThrow(() => {
        const html = buildAllergyPrompts(fixtureModel({ allergies: undefined }), DRUG_RULES);
        assert.equal(html, '');
      });
    });

    it('inactive allergy -> no prompt (engine active-only semantics, not re-implemented here)', () => {
      const html = buildAllergyPrompts(
        fixtureModel({ allergies: [{ label: 'Penicillin allergy', status: 'inactive' }] }),
        DRUG_RULES
      );
      assert.equal(html, '');
    });

    it('resolved allergy -> no prompt', () => {
      const html = buildAllergyPrompts(
        fixtureModel({ allergies: [{ label: 'Penicillin allergy', status: 'resolved' }] }),
        DRUG_RULES
      );
      assert.equal(html, '');
    });

    it('allergy present but no matching drug on the current medication list -> empty', () => {
      const html = buildAllergyPrompts(
        fixtureModel({ medications: [{ name: 'Atorvastatin 40mg tablets' }] }),
        DRUG_RULES
      );
      assert.equal(html, '');
    });

    it('renders one prompt per fired rule when more than one allergy/drug pair matches', () => {
      const html = buildAllergyPrompts(
        fixtureModel({
          allergies: [
            { label: 'Penicillin allergy', status: 'active' },
            { label: 'NSAID hypersensitivity', status: 'active' },
          ],
          medications: [{ name: 'Amoxicillin 500mg capsules' }, { name: 'Ibuprofen 400mg tablets' }],
        }),
        DRUG_RULES
      );
      const chipCount = (html.match(/class="sent-chip /g) || []).length;
      assert.ok(chipCount >= 2, `expected at least 2 rendered chips, got ${chipCount} in:\n${html}`);
    });
  });

  describe('fail-soft', () => {
    it('engine throwing -> empty, never propagates', () => {
      globalThis.window.SentinelRules = {
        evaluatePatient() {
          throw new Error('boom');
        },
      };
      globalThis.window.ChipRenderer = ChipRenderer;
      assert.doesNotThrow(() => {
        const html = buildAllergyPrompts(fixtureModel(), DRUG_RULES);
        assert.equal(html, '');
      });
    });

    it('engine/renderer globals missing -> empty, no throw', () => {
      delete globalThis.window.SentinelRules;
      delete globalThis.window.ChipRenderer;
      assert.doesNotThrow(() => {
        const html = buildAllergyPrompts(fixtureModel(), DRUG_RULES);
        assert.equal(html, '');
      });
    });

    it('malformed rules argument -> empty, no throw', () => {
      globalThis.window.SentinelRules = SentinelRules;
      globalThis.window.ChipRenderer = ChipRenderer;
      assert.doesNotThrow(() => {
        const html = buildAllergyPrompts(fixtureModel(), null);
        assert.equal(html, '');
      });
    });

    it('empty model -> empty, no throw', () => {
      assert.doesNotThrow(() => {
        const html = buildAllergyPrompts({}, DRUG_RULES);
        assert.equal(html, '');
      });
    });
  });
});
