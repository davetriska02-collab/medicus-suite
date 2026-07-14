// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — "While you're here" check-in prompt builder
//
// DORMANT — nothing calls this module yet. It exists so that when Medicus ships
// the full appointments spec (find-appointments-for-check-in /
// mark-patient-as-arrived, wrapped in shared/txn-api.js), wiring up composite
// feature B ("opportunistic case-finding at check-in") is a one-line job:
//
//   on mark-patient-as-arrived
//     -> fetch the patient's bundle via the txn feed (shared/txn-api.js)
//     -> evaluate it with SentinelRules.evaluatePatient() (engine/rules-engine.js)
//     -> buildCheckinPrompts(chips) to get the prioritised "While you're here" list
//
// Until that wiring lands, buildCheckinPrompts is pure and side-effect free: it
// takes chips already produced by the rules engine and turns a handful of them
// into short prompt lines — nothing here calls the engine, the txn API, or
// chrome.* itself.
//
// RECEPTION-SAFE COPY: this list may be shown to a receptionist at check-in, not
// just a clinician. Every prompt label is built ONLY from fields already present
// on the source chip (e.g. chip.label, chip.drugName, chip.displayName,
// chip.indicatorName) plus a fixed, non-clinical phrase ("... due", "... owed",
// "Bloods overdue for ..."). Nothing here invents or infers clinical detail that
// isn't already on the chip.
//
// Chip shapes consumed (see engine/rules-engine.js evaluatePatient for the
// authoritative source, and shared/chip-renderer.js for how each is displayed):
//   drug-monitoring : { type, ruleId, drugName, status, ... }
//   qof-indicator   : { type, ruleId, indicatorCode, indicatorName, status, ... }
//   vaccine         : { type, ruleId, vaccine, displayName, status, ... }
//   drug-allergy    : { type, ruleId, label, status, matchSummary(string), ... }
//   drug-combo      : { type, ruleId, label, status, matchSummary(array), ... }
//
// MAPPING POLICY (declarative — see MAPPING_TABLE below):
//   drug-allergy  status 'alert'                 -> safety,     priority 0,  "URGENT: <label>"
//   drug-combo    status 'alert'                  -> safety,     priority 0,  "URGENT: <label>"
//   drug-monitoring status 'overdue' or 'stale'    -> monitoring, priority 10, "Bloods overdue for <drugName>"
//   vaccine       status 'vax_due'                 -> vaccine,    priority 20, "<displayName> due"
//   qof-indicator status 'not_met'                 -> qof,        priority 30, "<indicatorName> owed"
//   anything else (ok / met / complete / informational / unrecognised type) -> no prompt
//
// 'stale' is included alongside 'overdue' for drug-monitoring because the engine
// (STATUS_RANK / STATUS_PHRASE in engine/rules-engine.js) treats it as the same
// actionable "bloods are overdue" family, just further past the interval —
// "severely overdue" is still overdue for a check-in prompt's purposes.
//
// Priority is a plain number, lower = more urgent; ties keep the input chips'
// relative order (Array#sort is a stable sort). Safety (drug-allergy / drug-combo
// alerts) always sits at priority 0 and is EXEMPT from the maxPrompts cap — see
// buildCheckinPrompts below. The relative order of the other three kinds
// (monitoring > vaccine > qof) is a deliberate clinical-priority choice: an
// overdue blood test on a monitored drug is treated as more actionable at
// check-in than a vaccine reminder, which in turn outranks a QOF admin item.

(function (global) {
  'use strict';

  // Each entry maps ONE (chip.type, chip.status) pair to a prompt shape.
  // `label(chip)` must read ONLY fields already on the chip (see header).
  const MAPPING_TABLE = [
    {
      chipType: 'drug-allergy',
      statuses: ['alert'],
      kind: 'safety',
      priority: 0,
      label: (chip) => `URGENT: ${chip.label || chip.ruleId || 'Drug-allergy alert'}`,
    },
    {
      chipType: 'drug-combo',
      statuses: ['alert'],
      kind: 'safety',
      priority: 0,
      label: (chip) => `URGENT: ${chip.label || chip.ruleId || 'Drug-combination alert'}`,
    },
    {
      chipType: 'drug-monitoring',
      statuses: ['overdue', 'stale'],
      kind: 'monitoring',
      priority: 10,
      label: (chip) => `Bloods overdue for ${chip.drugName || chip.ruleId || 'medication'}`,
    },
    {
      chipType: 'vaccine',
      statuses: ['vax_due'],
      kind: 'vaccine',
      priority: 20,
      label: (chip) => `${chip.displayName || chip.vaccine || chip.ruleId || 'Vaccine'} due`,
    },
    {
      chipType: 'qof-indicator',
      statuses: ['not_met'],
      kind: 'qof',
      priority: 30,
      label: (chip) => `${chip.indicatorName || chip.indicatorCode || chip.ruleId || 'Indicator'} owed`,
    },
  ];

  // The chip types this table understands. Lets future wiring code warn (rather
  // than silently ignore) when the engine starts emitting a chip type this
  // module has no mapping for.
  function listSupportedChipTypes() {
    const seen = new Set();
    const out = [];
    MAPPING_TABLE.forEach((rule) => {
      if (!seen.has(rule.chipType)) {
        seen.add(rule.chipType);
        out.push(rule.chipType);
      }
    });
    return out;
  }

  function findRule(chip) {
    if (!chip || !chip.type) return null;
    return MAPPING_TABLE.find((rule) => rule.chipType === chip.type && rule.statuses.includes(chip.status)) || null;
  }

  // buildCheckinPrompts(chips, opts = {}) -> prompt[]
  //   opts.maxPrompts (default 5) caps the number of NON-safety prompts kept.
  //   Safety prompts (kind: 'safety') are never dropped by this cap — every
  //   drug-allergy/drug-combo alert chip survives, however many there are.
  //
  // Returns [{ priority, kind, label, sourceChip }], sorted most-important-first
  // (lowest priority number first), safety prompts always leading.
  function buildCheckinPrompts(chips, opts = {}) {
    const maxPrompts = opts.maxPrompts != null ? opts.maxPrompts : 5;
    const list = Array.isArray(chips) ? chips : [];

    const prompts = [];
    list.forEach((chip) => {
      const rule = findRule(chip);
      if (!rule) return;
      prompts.push({
        priority: rule.priority,
        kind: rule.kind,
        label: rule.label(chip),
        sourceChip: chip,
      });
    });

    // Stable sort: Array#sort is guaranteed stable, so equal-priority prompts
    // keep the relative order they had in the input chips array.
    prompts.sort((a, b) => a.priority - b.priority);

    const safety = prompts.filter((p) => p.kind === 'safety');
    const rest = prompts.filter((p) => p.kind !== 'safety').slice(0, maxPrompts);

    return [...safety, ...rest];
  }

  const api = { buildCheckinPrompts, listSupportedChipTypes };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.CheckinPrompts = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
