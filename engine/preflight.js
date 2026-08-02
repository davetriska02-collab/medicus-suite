// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// engine/preflight.js — Prescribing Pre-flight (what-if safety preview)
//
// Pure composition engine: given "current patient context + one proposed
// drug (free text, not yet prescribed)", runs the SAME engines the suite
// already uses for the live record — engine/acb-scores.js,
// engine/stopp-start.js, and engine/rules-engine.js's drug-monitoring /
// drug-combo evaluators — over the hypothetical medication list (current
// meds + the proposed drug), and reports the DELTA.
//
// REUSE, NOT DUPLICATION (CLAUDE.md "silent-missing-alert disease"): this
// file contains no drug term lists, no interaction pairs, no monitoring
// intervals of its own. Every clinical judgement is delegated to the
// existing engines/rule files:
//   - ACB scoring            → ACBScores.computeACB (engine/acb-scores.js)
//   - STOPP/START             → StoppStart.computeStoppStart (engine/stopp-start.js)
//   - drug-monitoring rules   → SentinelRules.evaluateDrugRule (rules/drug-rules.json
//                                + drug-combo/monitoring entries in rules/alert-library.json)
//   - drug-drug interactions  → SentinelRules.evaluateDrugComboRule (rules/alert-library.json
//                                — e.g. methotrexate+trimethoprim, allopurinol+azathioprine,
//                                ACEi/ARB+K-sparing diuretic)
// Matching uses the SAME case-insensitive substring convention as the rest
// of the suite (drugMatchesRule / the drug-combo matcher) — the proposed
// drug name is simply added to the medication list and passed through
// unmodified rule evaluators, so it is matched exactly as a real
// prescription would be, with zero new matching logic.
//
// INPUT SHAPES — deliberately the SAME normalised shapes the Record module
// (side-panel/modules/record/record.js) already holds, so no new fetch is
// ever required to run a pre-flight check:
//   patientContext.medications  — [{ name, startDate? }]  (data.medications shape)
//   patientContext.problems     — [{ label, codedDate? }] (data.problems shape)
//   patientContext.observations — [{ name, rawValue, date, ... }] (data.observations shape)
//   patientContext.ageYears     — number | null
//   patientContext.sex          — string | null
//   proposedDrug                — free-text drug name (string)
//
// OUTPUT — see runPreflightCheck() below.
//
// Ledger hook (F2, not built here): runPreflightCheck() is the single
// call-site a future shared/event-ledger.js can instrument to record "user
// ran a pre-flight check" — do not scatter pre-flight logic elsewhere.

(function (global) {
  'use strict';

  // Load the sibling engines. Dual-mode: Node `require` in tests, or the
  // browser globals the panel/pop-out shells already load via <script> tags
  // BEFORE this file (see side-panel/panel.html / pop-out/pop-out.html —
  // acb-scores.js, stopp-start.js and rules-engine.js all load ahead of any
  // module that needs them, the same convention record.js relies on via
  // window.ACBScores / window.StoppStart / window.SentinelRules).
  function loadEngine(name, globalName) {
    try {
      if (typeof module !== 'undefined' && module.exports) {
        return require('./' + name);
      }
    } catch (e) {
      /* fall through to global */
    }
    if (global && global[globalName]) return global[globalName];
    return null;
  }

  const ACBScores = loadEngine('acb-scores.js', 'ACBScores');
  const StoppStart = loadEngine('stopp-start.js', 'StoppStart');
  const SentinelRules = loadEngine('rules-engine.js', 'SentinelRules');

  // ── Helpers ───────────────────────────────────────────────────────────────

  function isBlank(s) {
    return !s || !String(s).trim();
  }

  // Latest eGFR observation value, mirroring record.js's latestEgfr() so the
  // STOPP/START eGFR gate behaves identically in pre-flight and on the live
  // record. Not exported from record.js (it is a small closure over `obs`),
  // so re-derived here from the SAME observation shape rather than imported —
  // this is normalisation of an already-normalised field (obs.name / obs.rawValue),
  // not a duplication of any clinical rule or term list.
  function latestEgfr(observations) {
    const obs = Array.isArray(observations) ? observations : [];
    const e = obs.find((o) => /e?gfr/i.test((o && o.name) || ''));
    if (!e) return null;
    const n = parseFloat(String(e.rawValue));
    return Number.isFinite(n) ? n : null;
  }

  // Drug-monitoring + drug-combo rules relevant to pre-flight, pulled from
  // the two canonical rule files. alert-library.json's `library[].rule`
  // entries are the suite's interaction/awareness alerts (methotrexate +
  // trimethoprim, allopurinol/febuxostat + azathioprine, ACEi/ARB +
  // K-sparing diuretic, PINCER combos, etc.) — they are opt-in as CUSTOM
  // rules via sentinel-options, but pre-flight treats the full library as
  // always-on background knowledge: a what-if check should surface every
  // interaction the suite KNOWS about, not only the ones a clinician has
  // already added to their live rule set.
  function collectRules(drugRulesDoc, alertLibraryDoc) {
    const drugRules = (drugRulesDoc && Array.isArray(drugRulesDoc.rules) ? drugRulesDoc.rules : []).filter(
      (r) => r && r.enabled !== false && r.type === 'drug-monitoring'
    );
    // alert-library.json's library[].rule objects carry no `id` of their own
    // (an id is only generated when a clinician adds one as a custom rule via
    // sentinel-options). ruleId is used below to de-duplicate "already firing
    // on the current regimen" vs "newly introduced by the proposed drug" —
    // stamp the library's own `libId` on as `id` (pure identity plumbing, not
    // a clinical-content change) so every library rule is distinguishable.
    const libraryRules = (alertLibraryDoc && Array.isArray(alertLibraryDoc.library) ? alertLibraryDoc.library : [])
      .filter(
        (entry) =>
          entry &&
          entry.rule &&
          entry.rule.enabled !== false &&
          (entry.rule.type === 'drug-combo' || entry.rule.type === 'drug-monitoring')
      )
      .map((entry) => ({ ...entry.rule, id: entry.rule.id || entry.libId }));
    return {
      drugMonitoringRules: [...drugRules, ...libraryRules.filter((r) => r.type === 'drug-monitoring')],
      comboRules: libraryRules.filter((r) => r.type === 'drug-combo'),
    };
  }

  // ── ACB delta ────────────────────────────────────────────────────────────

  function computeAcbDelta(currentDrugObjs, projectedDrugObjs) {
    if (!ACBScores) return null;
    const current = ACBScores.computeACB(currentDrugObjs);
    const projected = ACBScores.computeACB(projectedDrugObjs);
    const bandOf = (total) => (total >= 3 ? 'high' : total > 0 ? 'some' : 'none');
    return {
      current: current.total,
      projected: projected.total,
      delta: projected.total - current.total,
      band: bandOf(projected.total),
      currentBand: bandOf(current.total),
      escalates: bandOf(projected.total) !== bandOf(current.total) && projected.total > current.total,
      perDrug: projected.perDrug,
    };
  }

  // ── STOPP/START (only the flags the ADDITION introduces) ────────────────

  function computeStoppStartDelta(currentDrugObjs, projectedDrugObjs, probObjs, ageYears, egfr) {
    if (!StoppStart) return [];
    const before = StoppStart.computeStoppStart({ drugs: currentDrugObjs, problems: probObjs, ageYears, egfr });
    const after = StoppStart.computeStoppStart({ drugs: projectedDrugObjs, problems: probObjs, ageYears, egfr });
    const beforeIds = new Set(before.map((f) => f.id));
    // New flags only — a flag already true of the current regimen is not
    // something the proposed drug caused, so pre-flight reports only what
    // the addition introduces (the STOPP/START DELTA), not the whole list.
    return after.filter((f) => !beforeIds.has(f.id));
  }

  // ── Drug-drug interactions (drug-combo rules) ────────────────────────────
  // Fires evaluateDrugComboRule over the PROJECTED med list; then keeps only
  // combos that involve the proposed drug (i.e. would NOT already fire on
  // the current regimen alone) — so a pre-existing interaction between two
  // CURRENT drugs isn't misreported as caused by the new one.
  function computeInteractions(comboRules, projectedData, currentData) {
    if (!SentinelRules || !SentinelRules.evaluateDrugComboRule) return [];
    const beforeIds = new Set();
    comboRules.forEach((rule) => {
      const fired = SentinelRules.evaluateDrugComboRule(rule, currentData);
      fired.forEach((chip) => beforeIds.add(chip.ruleId));
    });
    const alerts = [];
    comboRules.forEach((rule) => {
      const fired = SentinelRules.evaluateDrugComboRule(rule, projectedData);
      fired.forEach((chip) => {
        if (!beforeIds.has(chip.ruleId)) alerts.push(chip);
      });
    });
    return alerts;
  }

  // ── Monitoring requirements the proposed drug would introduce ───────────
  // Runs evaluateDrugRule for the proposed drug only (against rules matching
  // ANY drug-monitoring rule), against the patient's CURRENT observations —
  // this distinguishes "baseline satisfied by an existing recent result"
  // from "baseline missing" per CLAUDE.md's output-honesty requirement.
  function computeMonitoring(drugMonitoringRules, proposedDrugName, currentData, now) {
    if (!SentinelRules || !SentinelRules.evaluateDrugRule) return [];
    const singleDrugData = { ...currentData, medications: [{ name: proposedDrugName }] };
    const results = [];
    drugMonitoringRules.forEach((rule) => {
      const chips = SentinelRules.evaluateDrugRule(rule, singleDrugData, now);
      chips.forEach((chip) => {
        const tests = (chip.tests || []).map((t) => ({
          name: t.name || t.testName || '',
          status: t.status,
          satisfied: t.status === 'in_date' || t.status === 'due_soon' || t.status === 'recently_initiated',
          latestResult:
            t.latestObs && t.latestObs.date
              ? { value: t.latestObs.value != null ? t.latestObs.value : null, date: t.latestObs.date }
              : null,
          intervalDays: t.intervalDays || null,
        }));
        results.push({
          ruleId: chip.ruleId,
          drugClass: chip.drugClass || null,
          matchedTerm: chip.matchedTerm || null,
          status: chip.status,
          sharedCare: !!chip.sharedCare,
          source: chip.source || null,
          notes: chip.notes || null,
          tests,
        });
      });
    });
    return results;
  }

  // ── Unknown-drug honesty check ────────────────────────────────────────────
  // A drug is "known" to pre-flight if EITHER: (a) it matches a
  // drug-monitoring rule, (b) it matches a drug-combo rule's drugSets
  // (i.e. it could participate in a known interaction), or (c) ACB/STOPP
  // recognise it (their own internal term tables — checked by seeing if
  // adding it changes their output). If none of these apply, pre-flight
  // must say so honestly rather than imply safety (CLAUDE.md output-honesty
  // requirement; plan F1).
  function isDrugKnownToRules(proposedDrugName, drugMonitoringRules, comboRules, acbDelta, stoppStartFlags) {
    if (!SentinelRules || !proposedDrugName) return false;
    const matchesMonitoring = drugMonitoringRules.some((rule) => SentinelRules.drugMatchesRule(proposedDrugName, rule));
    const matchesCombo = comboRules.some((rule) =>
      (rule.drugSets || []).some((set) => {
        if (!Array.isArray(set.match)) return false;
        const lower = String(proposedDrugName).toLowerCase();
        return set.match.some((m) => lower.includes(String(m).toLowerCase()));
      })
    );
    const acbHit =
      acbDelta && Array.isArray(acbDelta.perDrug) && acbDelta.perDrug.some((d) => d.name === proposedDrugName);
    const stoppHit = Array.isArray(stoppStartFlags) && stoppStartFlags.length > 0;
    return matchesMonitoring || matchesCombo || acbHit || stoppHit;
  }

  // ── Main entry point ──────────────────────────────────────────────────────
  //
  // This is the single call-site F2 (Clinical Event Ledger) should
  // instrument to record "user ran a pre-flight check" — keep all pre-flight
  // logic reachable through this one function.
  //
  // @param {object} patientContext
  //   {
  //     medications:  [{ name, startDate? }],
  //     problems:     [{ label, codedDate? }],
  //     observations: [{ name, rawValue, date, ... }],
  //     ageYears:     number|null,
  //     sex:          string|null,
  //   }
  // @param {string} proposedDrug  free-text drug name
  // @param {object} ruleFiles     { drugRules: <parsed drug-rules.json>, alertLibrary: <parsed alert-library.json> }
  // @param {object} [options]     { now: ISO string (defaults to current time) }
  //
  // @returns {object|null} null when input is unusable (blank patient context
  //   or blank drug name — nothing to check); otherwise:
  //   {
  //     proposedDrug: string,
  //     known: boolean,               // false → "No local rules mention this drug" honesty case
  //     acb: { current, projected, delta, band, currentBand, escalates, perDrug } | null,
  //     stoppStart: [ ...new flags introduced by the addition ],
  //     interactions: [ ...drug-combo chips involving the proposed drug ],
  //     monitoring: [ ...monitoring requirements the proposed drug would introduce,
  //                    each test flagged satisfied:true/false ],
  //     caveat: "Decision aid, not advice — confirm against the BNF and the full record."
  //   }
  function runPreflightCheck(patientContext, proposedDrug, ruleFiles, options) {
    options = options || {};
    if (isBlank(proposedDrug)) return null;
    if (!patientContext || typeof patientContext !== 'object') return null;

    const now = options.now || new Date().toISOString();
    const proposedName = String(proposedDrug).trim();

    const currentMeds = Array.isArray(patientContext.medications) ? patientContext.medications : [];
    const problems = Array.isArray(patientContext.problems) ? patientContext.problems : [];
    const observations = Array.isArray(patientContext.observations) ? patientContext.observations : [];
    const ageYears =
      patientContext.ageYears != null && isFinite(Number(patientContext.ageYears))
        ? Number(patientContext.ageYears)
        : null;
    const sex = patientContext.sex || null;

    const projectedMeds = [...currentMeds, { name: proposedName }];

    // Shapes ACB/STOPP expect: {label} / {name} — same mapping record.js uses.
    const currentDrugObjs = currentMeds.map((m) => ({ label: m.name }));
    const projectedDrugObjs = projectedMeds.map((m) => ({ label: m.name }));
    const probObjs = problems.map((p) => ({ name: p.label }));
    const egfr = latestEgfr(observations);

    const acbDelta = computeAcbDelta(currentDrugObjs, projectedDrugObjs);
    const stoppStartFlags = computeStoppStartDelta(currentDrugObjs, projectedDrugObjs, probObjs, ageYears, egfr);

    const { drugMonitoringRules, comboRules } = collectRules(
      ruleFiles && ruleFiles.drugRules,
      ruleFiles && ruleFiles.alertLibrary
    );

    const currentData = { medications: currentMeds, problems, observations, patientContext: { ageYears, sex } };
    const projectedData = { medications: projectedMeds, problems, observations, patientContext: { ageYears, sex } };

    const interactions = computeInteractions(comboRules, projectedData, currentData);
    const monitoring = computeMonitoring(drugMonitoringRules, proposedName, currentData, now);

    const known =
      isDrugKnownToRules(proposedName, drugMonitoringRules, comboRules, acbDelta, stoppStartFlags) ||
      interactions.length > 0 ||
      monitoring.length > 0;

    return {
      proposedDrug: proposedName,
      known,
      acb: acbDelta,
      stoppStart: stoppStartFlags,
      interactions,
      monitoring,
      caveat: 'Decision aid, not advice — confirm against the BNF and the full record.',
    };
  }

  // ── Module export (dual-mode: Node require OR browser global) ───────────────
  const api = { runPreflightCheck, collectRules };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.Preflight = api;
  }
})(typeof window !== 'undefined' ? window : global);
