// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Sentinel Patient Passport core (pure ES module, no chrome/DOM)
//
// buildPassport(snapshot, trendData) → null | PassportObject
//
// Produces a patient-friendly printable health summary to hand to the patient
// at the end of a consultation. Plain English, reading age 9–11, no jargon.
//
// Evidence-based design constraints (health-literacy requirements):
//   • Reading age 9–11: short sentences (<20 words), no jargon, second person.
//   • Natural frequencies over bare values where they aid meaning.
//   • NEVER colour alone: every status has a text label.
//   • All status values ∈ {good, soon, action, none}.
//
// Reuses matching constants from brief-core.js where practical; local copies
// of the name arrays are kept here to avoid circular imports in tests.

'use strict';

import { STATUS_RANK, isChipActionNeeded } from './sentinel-core.js';

// ── Observation matching constants ────────────────────────────────────────────
// Mirrors the arrays in brief-core.js and trends.js. Kept local to avoid
// importing browser-context modules in a test environment.

const BP_NAMES = ['blood pressure', 'bp', 'arterial blood pressure'];
const HBA1C_NAMES = ['hba1c', 'glycated haemoglobin', 'haemoglobin a1c'];
const EGFR_NAMES = ['egfr', 'estimated glomerular filtration rate', 'estimated gfr'];
// Cholesterol: total cholesterol only (excludes HDL, LDL, ratio — same as trends.js)
const CHOL_NAMES = ['cholesterol'];
const CHOL_EXCLUDE = ['hdl', 'ldl', 'ratio', 'non-hdl', 'non hdl'];
// Weight: body weight only (same exclusions as trends.js)
const WEIGHT_NAMES = ['weight', 'body weight'];
const WEIGHT_EXCLUDE = ['weight loss', 'birth weight', 'ideal body weight', 'loss'];

// ── Clinical trend thresholds ─────────────────────────────────────────────────
// Mirrors brief-core.js thresholds exactly — do not change independently.
const BP_SYSTOLIC_DELTA_MMHG = 10;
const HBA1C_DELTA_MMOL = 5;
const EGFR_DECLINE_PERCENT = 15;
// Cholesterol and weight: no universal evidence-based notable delta for
// patient-facing text — trend sentence omitted for these metrics.

// ── QOF indicator plain-English map (patient-voiced) ─────────────────────────
// Deliberately different from sentinel-core.js QOF_ACTION_BY_PREFIX (admin wording).
// These are written for the patient, second person, present tense.
const QOF_PATIENT_ACTION = [
  ['HYP', 'A blood pressure check is due.', 'This check helps keep your blood pressure under control.'],
  ['DM', 'A diabetes review is due.', 'This yearly check helps keep your diabetes under control.'],
  ['AST', 'An asthma review is due.', 'This check makes sure your asthma treatment is still working well for you.'],
  ['COPD', 'A lung health review is due.', 'This yearly check helps us look after your lung condition.'],
  ['CHD', 'A heart health review is due.', 'This check helps keep your heart condition stable and safe.'],
  [
    'AF',
    'An atrial fibrillation review is due.',
    'This check helps make sure your heart rhythm treatment is right for you.',
  ],
  ['CKD', 'A kidney health review is due.', 'This yearly check helps us look after your kidneys.'],
  ['HF', 'A heart failure review is due.', 'This check helps us make sure your heart failure treatment is working.'],
  ['MH', 'A mental health review is due.', 'This yearly review helps make sure you are getting the right support.'],
  ['DEP', 'A depression review is due.', 'This check helps make sure your treatment is helping you feel better.'],
  ['EP', 'An epilepsy review is due.', 'This yearly check helps make sure your epilepsy treatment is right for you.'],
  ['PAD', 'A circulation health review is due.', 'This check helps look after the blood flow to your legs and feet.'],
  ['STIA', 'A stroke or TIA review is due.', 'This yearly check helps reduce your risk of another stroke or TIA.'],
  [
    'RA',
    'A rheumatoid arthritis review is due.',
    'This check helps make sure your arthritis treatment is working well.',
  ],
  ['OB', 'A weight management review is due.', 'This check is here to help you with your weight and health goals.'],
  ['SMOK', 'A stop-smoking review is due.', 'This check can help you get support to stop smoking.'],
  ['LD', 'An annual health check is due.', 'This yearly check is to help keep you as healthy as possible.'],
];

// ── Helper: find an observation history row matching any name term ─────────────
// Returns the row object or null. Used for BP (needs rawValue) and other obs.
function findObsRow(observationHistory, nameTerms, excludeTerms) {
  if (!Array.isArray(observationHistory)) return null;
  return (
    observationHistory.find((o) => {
      const lower = (o.name || '').toLowerCase();
      if (!nameTerms.some((n) => lower.includes(n))) return false;
      if (excludeTerms && excludeTerms.some((e) => lower.includes(e))) return false;
      return true;
    }) || null
  );
}

// ── BP parsing ────────────────────────────────────────────────────────────────
// Accepts "165/92" string or { systolic, diastolic } object.
function parseBpValue(rawValue) {
  if (!rawValue) return null;
  if (typeof rawValue === 'object' && rawValue !== null) {
    if (typeof rawValue.systolic === 'number' && typeof rawValue.diastolic === 'number') return rawValue;
    return null;
  }
  const m = String(rawValue).match(/^(\d{2,3})\s*\/\s*(\d{2,3})$/);
  if (!m) return null;
  return { systolic: parseInt(m[1], 10), diastolic: parseInt(m[2], 10) };
}

// ── Extract latest + previous reading ─────────────────────────────────────────
// Returns { latest, prev } or null if fewer than 1 reading.
// If only one reading, prev is null.
// history arrays in trend data are newest-first; we reverse to oldest-first.
function extractHistory(row) {
  if (!row || !Array.isArray(row.history)) return null;
  const filtered = row.history.filter((h) => h && typeof h.value === 'number' && isFinite(h.value));
  const oldest = filtered.slice().reverse();
  if (oldest.length === 0) return null;
  return {
    latest: oldest[oldest.length - 1],
    prev: oldest.length >= 2 ? oldest[oldest.length - 2] : null,
  };
}

// Extract BP readings (newest-first reversal is handled per extractBpReadings).
function extractBpReadings(observationHistory) {
  const row = findObsRow(observationHistory, BP_NAMES, null);
  if (!row || !Array.isArray(row.history)) return null;
  const parsed = row.history
    .map((h) => {
      const bp = parseBpValue(h.rawValue);
      return bp ? { ...bp, date: h.date } : null;
    })
    .filter(Boolean)
    .reverse(); // oldest-first
  if (parsed.length === 0) return null;
  return {
    latest: parsed[parsed.length - 1],
    prev: parsed.length >= 2 ? parsed[parsed.length - 2] : null,
  };
}

// ── Build trend sentence for a metric ─────────────────────────────────────────
// Returns a short sentence or '' when not notable/applicable.
function bpTrendSentence(bpReadings) {
  if (!bpReadings || !bpReadings.prev) return '';
  const delta = bpReadings.latest.systolic - bpReadings.prev.systolic;
  if (Math.abs(delta) < BP_SYSTOLIC_DELTA_MMHG) return '';
  return delta > 0 ? 'It has gone up since last time.' : 'It has come down since last time.';
}

function hba1cTrendSentence(latest, prev) {
  if (prev == null) return '';
  const delta = latest - prev;
  if (Math.abs(delta) < HBA1C_DELTA_MMOL) return '';
  return delta > 0 ? 'It has gone up since last time.' : 'It has come down since last time.';
}

function egfrTrendSentence(latest, prev) {
  if (prev == null || prev <= 0) return '';
  const delta = latest - prev;
  const declinePercent = prev > 0 ? ((prev - latest) / prev) * 100 : 0;
  if (delta > 0) {
    // improvement — also worth noting for patient reassurance when notable
    const risePercent = prev > 0 ? ((latest - prev) / prev) * 100 : 0;
    if (risePercent >= EGFR_DECLINE_PERCENT) return 'It has come up since last time.';
    return '';
  }
  if (declinePercent >= EGFR_DECLINE_PERCENT) return 'It has gone down since last time.';
  return '';
}

// ── Build numbers entries ──────────────────────────────────────────────────────

function buildBpEntry(observationHistory) {
  const bpReadings = extractBpReadings(observationHistory);
  if (!bpReadings) return null;
  const { latest } = bpReadings;
  const valueStr = `${latest.systolic}/${latest.diastolic}`;
  const isHigh = latest.systolic >= 140 || latest.diastolic >= 90;
  const status = isHigh ? 'action' : 'good';
  const statusLabel = isHigh ? 'Action needed' : 'On track';
  const trendPart = bpTrendSentence(bpReadings);
  const meaning = 'Blood pressure is the force of blood in your arteries.' + (trendPart ? ' ' + trendPart : '');
  return {
    label: 'Blood pressure',
    value: valueStr,
    meaning,
    status,
    statusLabel,
  };
}

function buildHba1cEntry(observationHistory) {
  const row = findObsRow(observationHistory, HBA1C_NAMES, null);
  const h = extractHistory(row);
  if (!h) return null;
  const val = Math.round(h.latest.value);
  const prevVal = h.prev ? h.prev.value : null;
  let status, statusLabel;
  if (val < 53) {
    status = 'good';
    statusLabel = 'On track';
  } else if (val <= 74) {
    status = 'soon';
    statusLabel = 'Needs a check soon';
  } else {
    status = 'action';
    statusLabel = 'Action needed';
  }
  const trendPart = hba1cTrendSentence(val, prevVal != null ? Math.round(prevVal) : null);
  const meaning = 'This shows your average blood sugar over the last 3 months.' + (trendPart ? ' ' + trendPart : '');
  return {
    label: 'HbA1c',
    value: `${val} mmol/mol`,
    meaning,
    status,
    statusLabel,
  };
}

function buildEgfrEntry(observationHistory) {
  const row = findObsRow(observationHistory, EGFR_NAMES, null);
  const h = extractHistory(row);
  if (!h) return null;
  const val = Math.round(h.latest.value);
  const prevVal = h.prev ? h.prev.value : null;
  let status, statusLabel;
  if (val >= 60) {
    status = 'good';
    statusLabel = 'On track';
  } else if (val >= 30) {
    status = 'soon';
    statusLabel = 'Needs a check soon';
  } else {
    status = 'action';
    statusLabel = 'Action needed';
  }
  const trendPart = egfrTrendSentence(val, prevVal != null ? Math.round(prevVal) : null);
  // Natural-frequency phrasing: describes filtering capacity relative to 90 (healthy baseline).
  const meaning =
    `Your kidneys are filtering at about ${val} out of a healthy 90 or more.` + (trendPart ? ' ' + trendPart : '');
  return {
    label: 'Kidney function (eGFR)',
    value: String(val),
    meaning,
    status,
    statusLabel,
  };
}

function buildCholesterolEntry(observationHistory) {
  const row = findObsRow(observationHistory, CHOL_NAMES, CHOL_EXCLUDE);
  const h = extractHistory(row);
  if (!h) return null;
  const val = Number(h.latest.value).toFixed(1);
  return {
    label: 'Cholesterol',
    value: `${val} mmol/L`,
    meaning: 'Cholesterol is a fatty substance in your blood.',
    status: 'none',
    statusLabel: '',
  };
}

function buildWeightEntry(observationHistory) {
  const row = findObsRow(observationHistory, WEIGHT_NAMES, WEIGHT_EXCLUDE);
  const h = extractHistory(row);
  if (!h) return null;
  const val = Number(h.latest.value).toFixed(1);
  return {
    label: 'Weight',
    value: `${val} kg`,
    meaning: 'Your weight recorded at your last reading.',
    status: 'none',
    statusLabel: '',
  };
}

// ── Build due entries ──────────────────────────────────────────────────────────

// Drug-monitoring chip → patient-friendly due entry.
function buildDrugDueEntry(chip) {
  const dueTests = (chip.tests || [])
    .filter((t) => t && isChipActionNeeded(t.status))
    .map((t) => t.name || t.testName)
    .filter(Boolean);
  const drug = chip.drugName || 'your medication';
  const testList = dueTests.length > 0 ? dueTests.join(', ') : null;
  const title = testList ? `Blood test: ${testList}` : 'Blood test for medication monitoring';
  const why = `These checks make sure your ${drug} stays safe for you.`;
  return { title, why };
}

// QOF indicator chip → patient-friendly due entry.
// Returns null if no mapping exists (caller handles null by grouping as generic).
function buildQofDueEntry(chip) {
  const code = String(chip.indicatorCode || '').toUpperCase();
  const hit = QOF_PATIENT_ACTION.find(([prefix]) => code.startsWith(prefix));
  if (!hit) return null;
  return { title: hit[1], why: hit[2] };
}

// Vaccine chip → patient-friendly due entry.
function buildVaccineDueEntry(chip) {
  const name = chip.displayName || chip.ruleName || 'vaccination';
  return {
    title: `You can book your ${name} vaccine.`,
    why: 'Staying up to date with vaccines helps keep you protected.',
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * buildPassport(snapshot, trendData) → null | PassportObject
 *
 * @param {object|null} snapshot  — Sentinel snapshot ({chips, patientContext, …})
 * @param {object|null} trendData — Trends payload ({observationHistory, …}) or null
 * @returns null when no patient is present, else:
 * {
 *   patient: { name, dob, nhsNumber },
 *   generatedAt,          // ISO timestamp (now)
 *   due: [ { title, why } ],
 *   numbers: [ { label, value, meaning, status, statusLabel } ],
 *   nothingDue,           // true when due is empty
 * }
 */
export function buildPassport(snapshot, trendData) {
  if (!snapshot) return null;
  const patient = snapshot.patientContext || snapshot.patient || null;
  if (!patient) return null;

  const chips = Array.isArray(snapshot.chips) ? snapshot.chips : [];

  // ── Action-needed chips (rank ≤ 2) ─────────────────────────────────────────
  const actionChips = chips.filter((c) => c && isChipActionNeeded(c.status));

  // ── Build due list ──────────────────────────────────────────────────────────
  const due = [];
  let hasGenericAlert = false;

  for (const chip of actionChips) {
    if (chip.type === 'drug-monitoring') {
      due.push(buildDrugDueEntry(chip));
    } else if (chip.type === 'qof-indicator' || chip.type === 'qof-process-indicator') {
      const entry = buildQofDueEntry(chip);
      if (entry) {
        due.push(entry);
      } else {
        hasGenericAlert = true;
      }
    } else if (chip.type === 'vaccine') {
      due.push(buildVaccineDueEntry(chip));
    } else {
      // Composites, drug-combos, event-counts, alerts — no safe plain-English mapping.
      hasGenericAlert = true;
    }
  }

  // Deduplicate due entries by title (e.g. same drug may generate duplicate tests).
  const seenTitles = new Set();
  const dedupedDue = due.filter((entry) => {
    if (seenTitles.has(entry.title)) return false;
    seenTitles.add(entry.title);
    return true;
  });

  // Append generic entry for any unmapped chip types (one combined entry only).
  if (hasGenericAlert) {
    dedupedDue.push({
      title: 'Your doctor would like to review something on your record.',
      why: 'Please book an appointment so your doctor can check this with you.',
    });
  }

  // ── Build numbers ───────────────────────────────────────────────────────────
  const obs = trendData && Array.isArray(trendData.observationHistory) ? trendData.observationHistory : [];
  const numbers = [];

  const bpEntry = buildBpEntry(obs);
  if (bpEntry) numbers.push(bpEntry);

  const hba1cEntry = buildHba1cEntry(obs);
  if (hba1cEntry) numbers.push(hba1cEntry);

  const egfrEntry = buildEgfrEntry(obs);
  if (egfrEntry) numbers.push(egfrEntry);

  const cholEntry = buildCholesterolEntry(obs);
  if (cholEntry) numbers.push(cholEntry);

  const weightEntry = buildWeightEntry(obs);
  if (weightEntry) numbers.push(weightEntry);

  return {
    patient: {
      name: patient.displayName || patient.name || '',
      dob: patient.dateOfBirth || '',
      nhsNumber: patient.nhsNumber || '',
    },
    generatedAt: new Date().toISOString(),
    due: dedupedDue,
    numbers,
    nothingDue: dedupedDue.length === 0,
  };
}
