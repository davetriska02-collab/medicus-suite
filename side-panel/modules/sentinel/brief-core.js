// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Sentinel Pre-Consultation Brief core (pure ES module, no chrome/DOM)
//
// buildBrief(snapshot, trendData) → null | BriefObject
//
// Produces a risk-ranked "30-second brief" suitable for rendering at the top of
// the Sentinel panel when a patient record is open. Deliberately ruthless signal
// filtering: max 4 top signals + moreCount, red before amber, drug-monitoring
// before QOF before other; trend notes only when clinically notable.
//
// Evidence-based design constraints:
//   • Max 4 signals shown + "+N more" — GP reading time is ~30 seconds.
//   • Red-first, drug-first ordering — highest clinical risk surfaces first.
//   • Signal lines are action-only, but the brief itself is ALSO the
//     safe-to-prescribe glance: per-group RAG (meds / QOF / general) plus an
//     explicit allClear state, so "nothing to do" is a loud green, not an
//     absent card. A green meds group with amber QOF means "prescribing
//     checks clear; recall work outstanding".
//   • Trend notes only when delta exceeds documented clinical thresholds.

'use strict';

import { STATUS_RANK, isChipActionNeeded } from './sentinel-core.js';

// ── Clinical trend thresholds ─────────────────────────────────────────────────
// Minimum delta to report a trend note. Set conservatively so only clinically
// meaningful changes are surfaced. Comment documents the clinical rationale.

// Systolic BP: ≥10 mmHg change between last two readings is clinically notable.
// Smaller fluctuations are within normal measurement variability (ESH/ESC 2018).
const BP_SYSTOLIC_DELTA_MMHG = 10;

// HbA1c: ≥5 mmol/mol between last two readings represents a clinically meaningful
// glycaemic shift (NICE NG28; inter-assay CV ~1.5–2 mmol/mol).
const HBA1C_DELTA_MMOL = 5;

// eGFR: ≥15% decline from previous reading warrants clinical attention.
// NICE CG182 / KDIGO 2022: a 15% sustained decline over 12 months is actionable.
const EGFR_DECLINE_PERCENT = 15;

// ── Matching constants (mirrors trends.js — do not import from there to avoid
// module side-effects). Kept minimal — only the keys needed for trend-note
// extraction. See side-panel/modules/trends/trends.js for the authoritative lists.

const BP_NAMES = ['blood pressure', 'bp', 'arterial blood pressure'];
const HBA1C_NAMES = ['hba1c', 'glycated haemoglobin', 'haemoglobin a1c'];
const EGFR_NAMES = ['egfr', 'estimated glomerular filtration rate', 'estimated gfr'];

// ── Type ordering for signals (drug-monitoring first — highest monitoring risk) ─
const TYPE_RANK = {
  'drug-monitoring': 0,
  'drug-combo': 1,
  'event-count': 1,
  composite: 1,
  'qof-indicator': 2,
  'qof-process-indicator': 2,
  vaccine: 3,
};

function typeRank(type) {
  return TYPE_RANK[type] ?? 4;
}

// ── Chip type → brief group ───────────────────────────────────────────────────
// The brief splits into three at-a-glance groups so a prescriber can see
// "is this patient safe to prescribe for" separately from QOF/admin work:
//   meds    — everything that bears on prescribing safety: drug-monitoring
//             bloods/checks, interaction combos, allergy flags, and composite
//             rules (which combine drug rules).
//   qof     — QOF indicators and registers (payment/recall work, not
//             prescribing safety).
//   general — vaccines, event-count clinical reviews (falls, recurrent UTI)
//             and anything else.
// Unknown/future types deliberately fall through to 'general' — a new chip
// type must never silently inflate the "safe to prescribe" meds group.
const GROUP_BY_TYPE = {
  'drug-monitoring': 'meds',
  'drug-combo': 'meds',
  'drug-allergy': 'meds',
  'drug-no-monitoring': 'meds',
  composite: 'meds',
  'qof-indicator': 'qof',
  'qof-process-indicator': 'qof',
  'qof-register': 'qof',
  vaccine: 'general',
  'event-count': 'general',
};

export function chipGroup(chip) {
  // Clinical-safety observation alerts (falling eGFR trend, potassium bands…)
  // are emitted with type 'qof-indicator' but category 'safety-monitoring' —
  // the sentinel list already buckets them as "not QOF payment items". They
  // bear directly on prescribing safety, so the brief counts them as meds.
  if (chip?.category === 'safety-monitoring') return 'meds';
  return GROUP_BY_TYPE[chip?.type] ?? 'general';
}

// ── Signal text builders ───────────────────────────────────────────────────────

// Build compact signal text for a drug-monitoring chip.
// Lists only the due (action-needed) tests by name.
// e.g. "Methotrexate — FBC, LFT overdue"
function drugSignalText(chip) {
  const drug = chip.drugName || chip.ruleId || 'Drug';
  const dueTests = (chip.tests || [])
    .filter((t) => t && isChipActionNeeded(t.status))
    .map((t) => t.testName || t.name)
    .filter(Boolean);
  const testsPart = dueTests.length > 0 ? dueTests.join(', ') : 'monitoring';
  // Use a short status word that fits in one glance.
  const statusWord = chip.status === 'stale' ? 'severely overdue' : chip.status === 'overdue' ? 'overdue' : 'due soon';
  return `${drug} — ${testsPart} ${statusWord}`;
}

// Build compact signal text for a QOF indicator chip.
// e.g. "DM006 — HbA1c target not met"
function qofSignalText(chip) {
  const code = chip.indicatorCode || chip.ruleId || 'QOF';
  // Truncate long indicator names to keep the line scannable.
  const name = chip.indicatorName ? chip.indicatorName.slice(0, 40) : null;
  return name ? `${code} — ${name}` : code;
}

// Build compact signal text for other chip types.
// e.g. "Serotonin syndrome risk — ALERT"
function genericSignalText(chip) {
  const label =
    chip.displayName || chip.label || chip.drugName || chip.indicatorCode || chip.ruleName || chip.ruleId || 'Alert';
  const statusWord = chip.status ? chip.status.replace(/_/g, ' ') : '';
  return statusWord ? `${label} — ${statusWord}` : label;
}

function chipSignalText(chip) {
  if (chip.type === 'drug-monitoring') return drugSignalText(chip);
  if (chip.type === 'qof-indicator' || chip.type === 'qof-process-indicator') return qofSignalText(chip);
  return genericSignalText(chip);
}

// ── Severity mapping ──────────────────────────────────────────────────────────
// Maps STATUS_RANK → 'red' | 'amber'. Rank 0 = red; 1–2 = amber.
function chipSeverity(chip) {
  const rank = STATUS_RANK[chip.status] ?? 99;
  return rank === 0 ? 'red' : 'amber';
}

// ── Patient line ──────────────────────────────────────────────────────────────

function buildPatientLine(patient) {
  if (!patient) return null;
  const parts = [];
  const name = patient.displayName || patient.name;
  if (name) parts.push(name);
  if (patient.age != null) parts.push(String(patient.age));
  if (patient.gender) parts.push(patient.gender);
  return parts.length > 0 ? parts.join(' · ') : null; // · separator
}

// ── Trend note extraction ─────────────────────────────────────────────────────

// Find the most recent history for an observation row matching any of the name terms.
// Returns an array of { date, value } sorted oldest-first, or [] if not found.
function findObsHistory(observationHistory, nameTerms) {
  if (!Array.isArray(observationHistory)) return [];
  const row = observationHistory.find((o) => {
    const lower = (o.name || '').toLowerCase();
    return nameTerms.some((n) => lower.includes(n));
  });
  if (!row || !Array.isArray(row.history)) return [];
  // history arrays in trend data are newest-first; reverse to oldest-first.
  return row.history
    .filter((h) => h && typeof h.value === 'number' && isFinite(h.value))
    .slice()
    .reverse();
}

// Parse BP: accepts "165/92" or { systolic, diastolic } shapes.
// Returns { systolic, diastolic } or null.
function parseBpValue(rawValue) {
  if (!rawValue) return null;
  if (typeof rawValue === 'object' && rawValue !== null) {
    if (typeof rawValue.systolic === 'number' && typeof rawValue.diastolic === 'number') return rawValue;
    return null;
  }
  const s = String(rawValue);
  const m = s.match(/^(\d{2,3})\s*\/\s*(\d{2,3})$/);
  if (!m) return null;
  return { systolic: parseInt(m[1], 10), diastolic: parseInt(m[2], 10) };
}

// Extract the last two BP readings (systolic only for trend note).
// Returns { latest: {systolic,diastolic,date}, prev: {systolic,diastolic,date} } | null.
function extractBpReadings(observationHistory) {
  if (!Array.isArray(observationHistory)) return null;
  // Primary: look for a combined BP row whose history has parseable rawValues.
  const row = observationHistory.find((o) => {
    const lower = (o.name || '').toLowerCase();
    return BP_NAMES.some((n) => lower.includes(n));
  });
  if (row && Array.isArray(row.history)) {
    const parsed = row.history
      .map((h) => {
        const bp = parseBpValue(h.rawValue);
        return bp ? { ...bp, date: h.date } : null;
      })
      .filter(Boolean)
      .reverse(); // oldest-first
    if (parsed.length >= 2) {
      return { latest: parsed[parsed.length - 1], prev: parsed[parsed.length - 2] };
    }
  }
  return null;
}

function buildTrendNotes(trendData) {
  if (!trendData) return [];
  const obs = trendData.observationHistory;
  if (!Array.isArray(obs)) return [];

  const notes = [];

  // ── Systolic BP ───────────────────────────────────────────────────────────
  const bpReadings = extractBpReadings(obs);
  if (bpReadings) {
    const { latest, prev } = bpReadings;
    const delta = latest.systolic - prev.systolic;
    if (Math.abs(delta) >= BP_SYSTOLIC_DELTA_MMHG) {
      const direction = delta > 0 ? 'up' : 'down';
      const sign = delta > 0 ? '+' : '';
      notes.push({
        text: `BP ${latest.systolic}/${latest.diastolic}, ${direction} ${sign}${Math.round(delta)} sys since last`,
        direction,
      });
    }
  }

  // ── HbA1c ─────────────────────────────────────────────────────────────────
  const hba1cHistory = findObsHistory(obs, HBA1C_NAMES);
  if (hba1cHistory.length >= 2) {
    const latest = hba1cHistory[hba1cHistory.length - 1];
    const prev = hba1cHistory[hba1cHistory.length - 2];
    const delta = latest.value - prev.value;
    if (Math.abs(delta) >= HBA1C_DELTA_MMOL) {
      const direction = delta > 0 ? 'up' : 'down';
      const sign = delta > 0 ? '+' : '';
      notes.push({
        text: `HbA1c ${Math.round(latest.value)} mmol/mol, ${sign}${Math.round(delta)} since last`,
        direction,
      });
    }
  }

  // ── eGFR ──────────────────────────────────────────────────────────────────
  const egfrHistory = findObsHistory(obs, EGFR_NAMES);
  if (egfrHistory.length >= 2) {
    const latest = egfrHistory[egfrHistory.length - 1];
    const prev = egfrHistory[egfrHistory.length - 2];
    // Only flag decline (falling eGFR is the clinical concern).
    if (prev.value > 0 && latest.value < prev.value) {
      const declinePercent = ((prev.value - latest.value) / prev.value) * 100;
      if (declinePercent >= EGFR_DECLINE_PERCENT) {
        notes.push({
          text: `eGFR ${Math.round(latest.value)}, down ${Math.round(declinePercent)}% since last`,
          direction: 'down',
        });
      }
    }
  }

  // Cap at 3 trend notes — brief must remain scannable.
  return notes.slice(0, 3);
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * buildBrief(snapshot, trendData) → null | BriefObject
 *
 * @param {object|null} snapshot  — Sentinel snapshot ({chips, patientContext, …})
 * @param {object|null} trendData — Trends payload ({observationHistory, …}) or null
 * @returns null if snapshot is absent or has no chips key (no patient open),
 * else a BriefObject. When nothing is action-needed the brief is still
 * returned with allClear=true so the card can render an explicit green
 * "nothing to do" state instead of silently disappearing:
 * {
 *   patientLine,            // "Margaret Smith · 73 · F"  (null if no patient)
 *   counts: { red, amber }, // chips at rank 0 and rank 1–2
 *   groups: {               // per-group RAG state (all chips, not just shown)
 *     meds:    { red, amber, status },  // status: 'red' | 'amber' | 'clear'
 *     qof:     { red, amber, status },
 *     general: { red, amber, status },
 *   },
 *   allClear,               // true when zero action-needed chips
 *   signals: [ { severity, text, group } ],  // max 4, worst-first
 *   moreCount,              // additional action-needed chips beyond the 4 shown
 *   moreRed,                // how many of those hidden chips are RED (rank 0)
 *   trendNotes: [ { text, direction } ] // 0–3 notable trends
 * }
 */
export function buildBrief(snapshot, trendData) {
  if (!snapshot) return null;
  if (!snapshot.chips) return null;

  const chips = Array.isArray(snapshot.chips) ? snapshot.chips : [];
  const patient = snapshot.patientContext || snapshot.patient || null;

  // Action-needed chips only (rank ≤ 2).
  const actionChips = chips.filter((c) => c && isChipActionNeeded(c.status));

  // Build counts: red = rank 0, amber = rank 1–2. Also split per brief group
  // so the card can show meds/QOF/general RAG independently.
  let red = 0;
  let amber = 0;
  const groups = {
    meds: { red: 0, amber: 0 },
    qof: { red: 0, amber: 0 },
    general: { red: 0, amber: 0 },
  };
  for (const c of chips) {
    if (!c) continue;
    const rank = STATUS_RANK[c.status] ?? 99;
    if (rank === 0) {
      red++;
      groups[chipGroup(c)].red++;
    } else if (rank <= 2) {
      amber++;
      groups[chipGroup(c)].amber++;
    }
  }
  for (const g of Object.values(groups)) {
    g.status = g.red > 0 ? 'red' : g.amber > 0 ? 'amber' : 'clear';
  }

  // Sort action chips: rank 0 first, then by STATUS_RANK, then by type rank.
  const sorted = actionChips.slice().sort((a, b) => {
    const rankDiff = (STATUS_RANK[a.status] ?? 99) - (STATUS_RANK[b.status] ?? 99);
    if (rankDiff !== 0) return rankDiff;
    return typeRank(a.type) - typeRank(b.type);
  });

  // Build signal list: max 4 shown; the rest become moreCount.
  const MAX_SIGNALS = 4;
  const shown = sorted.slice(0, MAX_SIGNALS);
  const moreCount = sorted.length - shown.length;
  // R6: how many of the hidden ("+N more") chips are RED (rank 0). Used by the
  // brief card to ensure a hidden red item is never silently swallowed.
  const moreRed = sorted.slice(MAX_SIGNALS).filter((c) => (STATUS_RANK[c.status] ?? 99) === 0).length;

  const signals = shown.map((chip) => ({
    severity: chipSeverity(chip),
    text: chipSignalText(chip),
    group: chipGroup(chip),
  }));

  const trendNotes = buildTrendNotes(trendData);

  return {
    patientLine: buildPatientLine(patient),
    counts: { red, amber },
    groups,
    allClear: actionChips.length === 0,
    signals,
    moreCount,
    moreRed,
    trendNotes,
  };
}
