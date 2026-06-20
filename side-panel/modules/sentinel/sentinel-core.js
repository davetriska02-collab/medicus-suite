// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Sentinel pure-logic core (no chrome APIs, no DOM)
//
// Moved from sentinel.js to mirror the reception-core.js / sweep-core.js precedent.
// sentinel.js imports STATUS_RANK and buildAdminSummaryText from here.
//
// The QOF wording table and action strings here are for the admin copy-text
// audience and DELIBERATELY DIFFER from sweep-core.js (reception handout).
// Do not unify them; test-chip-instructions.js pins both independently.
//
// Exports:
//   STATUS_RANK           — status string → numeric rank (used by sentinel.js rendering)
//   isChipActionNeeded(status) — true when rank <= 2
//   chipInstruction(chip) — plain-English booking instruction or null
//   buildAdminSummaryText(chips, patient) — full admin summary text block

'use strict';

import { isBloodTest, groupInstructionsByAction } from '../shared/chip-instructions.js';

// Status severity rank. 0=red, 1=severe-amber, 2=amber, 3-5=neutral/green.
// Used here for action-needed filtering AND exported for sentinel.js rendering.
//
// MUST stay in lock-step with STATUS_RANK in engine/rules-engine.js — the engine
// emits the statuses, this table ranks/filters them. A key present there but
// missing here falls through to `?? 99` and ranks differently across surfaces
// (e.g. a vaccine chip ranked 1 by the engine but 99 here). test-status-rank-sync.js
// pins the two tables to deep-equality so any future drift fails CI.
export const STATUS_RANK = {
  overdue: 0,
  not_met: 0,
  alert: 0,
  stale: 1,
  due_soon: 2,
  caution: 2,
  no_data: 3,
  noted: 3,
  recently_initiated: 4,
  achieved: 5,
  in_date: 5,
  vax_given: 5,
  vax_declined: 3,
  vax_due: 1,
};

// Returns true if this chip status counts as action-needed (rank 0–2).
export function isChipActionNeeded(status) {
  return (STATUS_RANK[status] ?? 99) <= 2;
}

// QOF indicator code prefix → plain-English booking instruction (admin wording).
// Intentionally different from sweep-core QOF_ACTION_BY_PREFIX (different audience).
const QOF_ACTION_BY_PREFIX = [
  ['HYP', 'Book a blood pressure check'],
  ['DM', 'Book a diabetes review'],
  ['AST', 'Book an asthma review'],
  ['COPD', 'Book a COPD review'],
  ['CHD', 'Book a heart disease review'],
  ['AF', 'Book an atrial fibrillation review'],
  ['CKD', 'Book a kidney disease review'],
  ['HF', 'Book a heart failure review'],
  ['MH', 'Book a mental health review'],
  ['DEP', 'Book a depression review'],
  ['EP', 'Book an epilepsy review'],
  ['PAD', 'Book a peripheral arterial disease review'],
  ['STIA', 'Book a stroke/TIA review'],
  ['RA', 'Book a rheumatoid arthritis review'],
  ['OB', 'Book an obesity review'],
  ['SMOK', 'Book a smoking cessation review'],
  ['LD', 'Book an annual health check'],
];

// Convert a single chip into a plain-English booking instruction for admin.
// Returns { action, detail } or null when the chip is not action-needed.
// Action strings here are intentionally shorter than sweep-core (admin copy-text vs reception printout).
export function chipInstruction(chip) {
  if (!chip || !isChipActionNeeded(chip.status)) return null;

  if (chip.type === 'drug-monitoring') {
    const dueTests = (chip.tests || [])
      .filter((t) => t && isChipActionNeeded(t.status))
      .map((t) => t.name || t.testName)
      .filter(Boolean);
    const drug = chip.drugName || 'monitored medication';
    const detail = `${drug} monitoring ${chip.status === 'due_soon' ? 'due soon' : 'overdue'}`;
    if (dueTests.length === 0) return { action: 'Book a monitoring appointment', detail };
    const bloods = dueTests.filter((n) => isBloodTest(n));
    const checks = dueTests.filter((n) => !isBloodTest(n));
    let action;
    if (bloods.length && checks.length) action = `Book a blood test and check: ${[...bloods, ...checks].join(', ')}`;
    else if (bloods.length) action = `Book a blood test: ${bloods.join(', ')}`;
    else action = `Book a check-up: ${checks.join(', ')}`;
    return { action, detail };
  }

  if (chip.type === 'qof-indicator') {
    const code = String(chip.indicatorCode || '').toUpperCase();
    const hit = QOF_ACTION_BY_PREFIX.find(([prefix]) => code.startsWith(prefix));
    return {
      action: hit ? hit[1] : 'Book a review appointment',
      detail: `${chip.indicatorCode || 'QOF'}${chip.indicatorName ? ' — ' + chip.indicatorName : ''}`,
    };
  }

  if (chip.type === 'vaccine') {
    return {
      action: `Offer to book: ${chip.displayName || 'vaccination'}`,
      detail: 'eligible this season — double-check eligibility on the record',
    };
  }

  // Alerts, combos, event-counts, composites → clinical judgement only
  const label =
    chip.drugName ||
    chip.indicatorCode ||
    chip.label ||
    chip.displayName ||
    chip.registerName ||
    chip.ruleId ||
    'alert';
  return { action: 'Flag to duty clinician', detail: String(label) };
}

// Build the plain-text admin appointments summary for a patient.
// Returns a multi-line string suitable for copy-pasting into the clinical system.
export function buildAdminSummaryText(chips, patient) {
  const actionChips = (chips || []).filter((c) => isChipActionNeeded(c.status));
  const rawName = patient ? patient.displayName || patient.name || null : null;
  // Use NHS number as fallback identifier so the header is never "Unknown patient"
  // when we have enough to identify the record.
  const namePart = rawName || (patient?.nhsNumber ? `NHS ${patient.nhsNumber}` : 'Unknown patient');
  const metaParts = patient
    ? [
        // Only show NHS in the meta line when the name is already in the header
        rawName && patient.nhsNumber ? `NHS ${patient.nhsNumber}` : '',
        patient.dateOfBirth ? `DOB ${patient.dateOfBirth}` : '',
        patient.age ? `Age ${patient.age}` : '',
        patient.gender ? patient.gender : '',
      ].filter(Boolean)
    : [];
  const dateLine = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  if (actionChips.length === 0) {
    return `No monitoring appointments needed — ${namePart}\n${dateLine}`;
  }

  // Deduplicate by booking action (same logic as sweep-core buildHandout)
  const groups = groupInstructionsByAction(actionChips, chipInstruction);

  if (groups.length === 0) {
    return `No monitoring appointments needed — ${namePart}\n${dateLine}`;
  }

  const lines = groups.map(
    ({ action, details }) => `• ${action}${details.length ? ' (' + details.join('; ') + ')' : ''}`
  );

  const header = [`Appointments needed — ${namePart}`];
  if (metaParts.length) header.push(metaParts.join(' · '));
  header.push(dateLine);
  return header.join('\n') + '\n\n' + lines.join('\n');
}
