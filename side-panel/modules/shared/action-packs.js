// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Action Packs (pure ES module, no chrome APIs, no DOM)
//
// Attaches copy-ready text to every action-needed Sentinel chip:
//   - Blood form request (drug-monitoring chips with due tests)
//   - Recall SMS (first attempt)
//   - Escalation SMS (second/third attempt)
//   - Behaviourally-informed letter body
//   - Admin/pharmacist task line
//
// QOF indicator chips: sms/letter/task variants (no bloodForm in this phase).
// Vaccine chips: offer SMS + task (no escalation, no bloodForm).
// Non-action chips: returns null.
//
// Exports:
//   buildChipActions(chip, patient)   → null | { bloodForm?, sms?, smsEscalation?, letter?, task? }
//   buildPatientActions(chips, patient) → aggregated pack for all action-needed chips

'use strict';

import { isBloodTest } from './chip-instructions.js';
import { isChipActionNeeded } from '../sentinel/sentinel-core.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

// Extract a usable first name from a patient object.
// Tries displayName / name (formatted as "Surname, Firstname" or "Firstname Surname").
// Falls back to null when no usable token found (caller omits "Dear X," greeting).
function extractFirstName(patient) {
  const raw = (patient && (patient.displayName || patient.name || '')) || '';
  if (!raw.trim()) return null;
  // Handle "Surname, Firstname Middlename" — common UK clinical system format
  const commaSplit = raw.split(',');
  if (commaSplit.length >= 2) {
    const givenPart = commaSplit[1].trim();
    const firstToken = givenPart.split(/\s+/)[0];
    return firstToken || null;
  }
  // Plain "Firstname Surname"
  const firstToken = raw.trim().split(/\s+/)[0];
  return firstToken || null;
}

// Derive the status word for copy text ("overdue" / "due soon").
function statusWord(status) {
  if (status === 'stale') return 'overdue';
  if (status === 'due_soon' || status === 'caution') return 'due soon';
  return 'overdue'; // default for alert / not_met / other
}

// Filter a drug chip's tests to only those that are action-needed.
function dueTestNames(chip) {
  return (chip.tests || [])
    .filter((t) => t && isChipActionNeeded(t.status))
    .map((t) => t.name || t.testName)
    .filter(Boolean);
}

// QOF indicator code → patient-facing condition description for SMS/letters.
const QOF_CONDITION_BY_PREFIX = [
  ['HYP', 'blood pressure condition'],
  ['DM', 'diabetes'],
  ['AST', 'asthma'],
  ['COPD', 'COPD (lung condition)'],
  ['CHD', 'heart disease'],
  ['AF', 'atrial fibrillation (irregular heartbeat)'],
  ['CKD', 'kidney condition'],
  ['HF', 'heart failure'],
  ['MH', 'mental health condition'],
  ['DEP', 'depression'],
  ['EP', 'epilepsy'],
  ['PAD', 'peripheral arterial disease'],
  ['STIA', 'stroke or TIA'],
  ['RA', 'rheumatoid arthritis'],
  ['OB', 'obesity'],
  ['SMOK', 'smoking'],
  ['LD', 'learning disability'],
];

function qofConditionDescription(chip) {
  const code = String(chip.indicatorCode || '').toUpperCase();
  const hit = QOF_CONDITION_BY_PREFIX.find(([prefix]) => code.startsWith(prefix));
  if (hit) return hit[1];
  return chip.indicatorName || 'long-term condition';
}

// QOF indicator code → review type description.
const QOF_REVIEW_BY_PREFIX = [
  ['HYP', 'blood pressure check'],
  ['DM', 'annual diabetes review'],
  ['AST', 'annual asthma review'],
  ['COPD', 'annual COPD review'],
  ['CHD', 'annual heart disease review'],
  ['AF', 'annual AF review'],
  ['CKD', 'annual kidney disease review'],
  ['HF', 'annual heart failure review'],
  ['MH', 'annual mental health review'],
  ['DEP', 'depression review'],
  ['EP', 'annual epilepsy review'],
  ['PAD', 'annual peripheral arterial disease review'],
  ['STIA', 'annual stroke/TIA review'],
  ['RA', 'annual rheumatoid arthritis review'],
  ['OB', 'weight management review'],
  ['SMOK', 'smoking cessation review'],
  ['LD', 'annual health check'],
];

function qofReviewDescription(chip) {
  const code = String(chip.indicatorCode || '').toUpperCase();
  const hit = QOF_REVIEW_BY_PREFIX.find(([prefix]) => code.startsWith(prefix));
  if (hit) return hit[1];
  return chip.indicatorName ? `${chip.indicatorName} review` : 'annual review';
}

// ── buildChipActions ──────────────────────────────────────────────────────────

// Returns null when the chip does not need action.
// Otherwise returns { bloodForm?, sms?, smsEscalation?, letter?, task? }.
export function buildChipActions(chip, patient) {
  if (!chip || !isChipActionNeeded(chip.status)) return null;

  const firstName = extractFirstName(patient);
  const greeting = firstName ? `Dear ${firstName}, ` : 'Dear patient, ';
  const nhsNo = patient && patient.nhsNumber ? patient.nhsNumber : null;
  const patientName =
    patient && (patient.displayName || patient.name) ? patient.displayName || patient.name : 'this patient';

  // ── Drug-monitoring chips ──────────────────────────────────────────────────
  if (chip.type === 'drug-monitoring') {
    const drug = chip.drugName || 'monitored medication';
    const word = statusWord(chip.status);
    const dueTests = dueTestNames(chip);
    const source = chip.source || null;
    const testsDisplay = dueTests.length > 0 ? dueTests.join(', ') : 'monitoring tests';
    const bloodTests = dueTests.filter((n) => isBloodTest(n));
    const physicalChecks = dueTests.filter((n) => !isBloodTest(n));

    const result = {};

    // Blood form — only when there are actual blood tests due
    if (bloodTests.length > 0) {
      result.bloodForm = [`${bloodTests.join(', ')} — ${drug} monitoring (${word}).`, source ? `Source: ${source}` : '']
        .filter(Boolean)
        .join(' ');
    }

    // Physical checks note — included in the task, not the blood form
    const checksNote = physicalChecks.length > 0 ? ` Also required: ${physicalChecks.join(', ')}.` : '';

    // SMS — first recall attempt (≤320 chars target)
    result.sms =
      `${greeting}you are due a blood test (${testsDisplay}) because you take ${drug}. ` +
      `This check keeps your treatment safe. Please book with reception this week. ` +
      `Thank you — [practice name] (no reply)`;

    // SMS escalation — consequence-transparent (CQC-aligned)
    result.smsEscalation =
      `${greeting}our records show your ${drug} monitoring blood test (${testsDisplay}) is now ${word}. ` +
      `If we cannot complete this check, your prescriber will be informed and your repeat ` +
      `prescription may be paused for safety. Please book urgently with reception. ` +
      `— [practice name] (no reply)`;

    // Letter body
    result.letter = [
      `Re: Blood monitoring — ${drug}`,
      '',
      `${greeting.trim().replace(/,$/, '')}`,
      '',
      `Our records show that your blood test (${testsDisplay}) for ${drug} monitoring is ${word}.`,
      '',
      `This is an important safety check. Please book an appointment with reception as soon as ` +
        `possible to have this blood test done.`,
      '',
      `If you have already had this test done elsewhere, please contact us so we can update your records.`,
      '',
      `If you have any questions, please contact the surgery.`,
      '',
      `Yours sincerely`,
      `[Clinician name]`,
      `[Practice name]`,
    ].join('\n');

    // Task line
    result.task =
      `Contact ${patientName}${nhsNo ? ` (NHS ${nhsNo})` : ''} re ${word} ${drug} monitoring. ` +
      `Order set: ${testsDisplay}.${checksNote}`;

    return result;
  }

  // ── QOF indicator chips ───────────────────────────────────────────────────
  if (chip.type === 'qof-indicator') {
    // Safety-monitoring surveillance flags (eGFR/HbA1c trends, electrolyte alerts)
    // reuse the qof-indicator chip shape but are CLINICIAN-REVIEW items, not patient
    // recalls. They must NEVER emit patient-facing "come for your review" SMS/letter
    // copy: a raised potassium or falling eGFR is a clinical action to review now, not
    // a routine booking the patient arranges at their convenience. Emit a clinician
    // task only — no sms, no letter.
    if (chip.category === 'safety-monitoring') {
      const flag = chip.indicatorName || chip.indicatorCode || 'safety flag';
      const valuePart = chip.valueText ? ` (${chip.valueText})` : '';
      return {
        task:
          `Clinical review — ${patientName}${nhsNo ? ` (NHS ${nhsNo})` : ''}: ${flag}${valuePart} flagged. ` +
          `Clinician to review and action. Not a patient recall.`,
      };
    }

    const condition = qofConditionDescription(chip);
    const review = qofReviewDescription(chip);

    const result = {};

    result.sms =
      `${greeting}our records show you are due your ${review} because of your ${condition}. ` +
      `Please book an appointment with reception at your earliest convenience. ` +
      `Thank you — [practice name] (no reply)`;

    result.letter = [
      `Re: Annual review — ${review}`,
      '',
      `${greeting.trim().replace(/,$/, '')}`,
      '',
      `Our records show that your ${review} is due. This review helps us monitor your ` +
        `${condition} and ensure you are receiving the best care.`,
      '',
      `Please contact reception to book an appointment at your convenience.`,
      '',
      `If you have recently had this review done elsewhere, please let us know so we can update your records.`,
      '',
      `Yours sincerely`,
      `[Clinician name]`,
      `[Practice name]`,
    ].join('\n');

    result.task =
      `Contact ${patientName}${nhsNo ? ` (NHS ${nhsNo})` : ''} re overdue ${review} ` +
      `(${chip.indicatorCode || 'QOF'}${chip.indicatorName ? ' — ' + chip.indicatorName : ''}).`;

    return result;
  }

  // ── Vaccine chips ─────────────────────────────────────────────────────────
  if (chip.type === 'vaccine') {
    const vaccine = chip.displayName || 'vaccination';

    const result = {};

    result.sms =
      `${greeting}our records show you are eligible for ${vaccine}. ` +
      `Please book an appointment with reception to receive this vaccination. ` +
      `Thank you — [practice name] (no reply)`;

    // Letter body — direct-to-patient vaccination invitation
    result.letter = [
      `Re: Vaccination invitation — ${vaccine}`,
      '',
      `${greeting.trim().replace(/,$/, '')}`,
      '',
      `Our records show that you are eligible for ${vaccine}, and we would like to invite you ` +
        `to book an appointment to have it.`,
      '',
      `Vaccination is an important way to protect your health. Please contact reception to ` +
        `arrange an appointment at a time convenient for you.`,
      '',
      `If you have already had this vaccination elsewhere, please let us know so we can update your records.`,
      '',
      `If you have any questions, please contact the surgery.`,
      '',
      `Yours sincerely`,
      `[Clinician name]`,
      `[Practice name]`,
    ].join('\n');

    result.task =
      `Contact ${patientName}${nhsNo ? ` (NHS ${nhsNo})` : ''} re eligibility for ${vaccine}. ` +
      `Offer vaccination booking.`;

    return result;
  }

  // ── Other chip types (alert, drug-combo, event-count, composite, etc.) ────
  // These require clinical judgement — provide only a task line.
  const label = chip.drugName || chip.indicatorCode || chip.label || chip.displayName || chip.ruleId || 'alert';

  return {
    task:
      `Review ${patientName}${nhsNo ? ` (NHS ${nhsNo})` : ''} — ${String(label)} alert flagged. ` +
      `Clinical judgement required before further action.`,
  };
}

// ── buildBatchPack ────────────────────────────────────────────────────────────

// Build a combined batch output model for a set of selected worklist patients.
// Pure: no DOM, no chrome APIs — the caller renders it.
//
// items: Array of objects matching the SweepRow shape from sweep-core.js:
//   { name, time?, clinician?, chips, redCount?, amberCount? }
//   (At minimum `name` and `chips` are required; all others are optional.)
//
// Returns null when items is empty or has no entries with action-needed chips.
// Otherwise returns:
//   {
//     generatedAt: ISO string,
//     patients: [{
//       name, time, clinician, redCount, amberCount,
//       bloodForm: string|null,   // blood form request text
//       sms: string|null,         // per-patient combined recall SMS
//       task: string|null,        // per-patient combined task text
//     }]
//   }
//
// Patients with no action-needed chips produce a section with null fields.
// Order is preserved (caller passes items in their chosen order).
export function buildBatchPack(items) {
  if (!Array.isArray(items) || items.length === 0) return null;

  const patients = items.map((item) => {
    const patient = { name: item.name || 'Unknown patient' };
    const pack = buildPatientActions(item.chips || [], patient);
    return {
      name: item.name || 'Unknown patient',
      time: item.time || null,
      clinician: item.clinician || null,
      redCount: item.redCount || 0,
      amberCount: item.amberCount || 0,
      bloodForm: pack ? pack.bloodForm : null,
      sms: pack ? pack.sms : null,
      task: pack ? pack.task : null,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    patients,
  };
}

// ── buildPatientActions ───────────────────────────────────────────────────────

// Aggregates buildChipActions across all action-needed chips for a patient.
// Returns an object with:
//   bloodForm  — deduplicated blood form lines (one per distinct set of tests+drug)
//   sms        — combined recall SMS listing all drugs/reviews
//   task       — combined task block (one entry per chip)
export function buildPatientActions(chips, patient) {
  const actionChips = (chips || []).filter((c) => isChipActionNeeded(c && c.status));
  if (actionChips.length === 0) return null;

  const bloodFormLines = [];
  const smsItems = [];
  const taskLines = [];
  const seenBloodFormLines = new Set();

  for (const chip of actionChips) {
    const pack = buildChipActions(chip, patient);
    if (!pack) continue;

    // Blood form: deduplicate identical lines
    if (pack.bloodForm) {
      if (!seenBloodFormLines.has(pack.bloodForm)) {
        seenBloodFormLines.add(pack.bloodForm);
        bloodFormLines.push(pack.bloodForm);
      }
    }

    // SMS items: collect drug/vaccine/review names for combined SMS
    if (chip.type === 'drug-monitoring') {
      const dueTests = dueTestNames(chip);
      const drug = chip.drugName || 'monitored medication';
      const word = statusWord(chip.status);
      smsItems.push(`${drug} (${dueTests.length > 0 ? dueTests.join(', ') : 'monitoring'}, ${word})`);
    } else if (chip.type === 'qof-indicator' && chip.category !== 'safety-monitoring') {
      // Safety-monitoring flags are clinician-review only — never folded into a
      // patient-facing combined recall SMS (see buildChipActions).
      smsItems.push(qofReviewDescription(chip));
    } else if (chip.type === 'vaccine') {
      smsItems.push(chip.displayName || 'vaccination');
    }

    if (pack.task) {
      taskLines.push(pack.task);
    }
  }

  const firstName = extractFirstName(patient);
  const greeting = firstName ? `Dear ${firstName}, ` : 'Dear patient, ';

  const combinedSms =
    smsItems.length === 0
      ? null
      : smsItems.length === 1
        ? // Single item — use full contextual SMS from the individual pack
          (actionChips.length === 1 ? buildChipActions(actionChips[0], patient)?.sms : null) ||
          `${greeting}our records show you have the following item(s) needing attention: ${smsItems[0]}. Please contact reception to book. Thank you — [practice name] (no reply)`
        : `${greeting}our records show you have the following items needing attention: ${smsItems.join('; ')}. Please contact reception to book. Thank you — [practice name] (no reply)`;

  return {
    bloodForm: bloodFormLines.length > 0 ? bloodFormLines.join('\n') : null,
    sms: combinedSms,
    task: taskLines.length > 0 ? taskLines.join('\n\n') : null,
  };
}
