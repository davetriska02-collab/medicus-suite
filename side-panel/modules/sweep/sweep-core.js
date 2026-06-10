// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Sweep module: pure-logic core (no chrome APIs, no DOM)
//
// Exported functions:
//   extractBookedPatients(raw)   — parse my-appointments payload
//   summariseSweep(perPatientResults) — sort/split action-needed results
//
// ACTION_COLOURS is exported so sweep.js and the test can share the
// single authoritative map without duplicating it.

'use strict';

import { isBloodTest, groupInstructionsByAction } from '../shared/chip-instructions.js';

// Maximum patients the sweep will process. If the appointment feed returns
// more, the first MAX_SWEEP_PATIENTS by appointment time are processed.
export const MAX_SWEEP_PATIENTS = 40;

// UUID shape used by Medicus APIs.
const UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

// Colours mapped as "action-needed" per shared/chip-renderer.js STATUS_COLOUR.
// Keep in sync: red and amber → action needed; neutral and green → no action.
// This is intentionally a plain object (no import) so sweep-core stays
// side-effect-free and node-testable without loading chip-renderer.
export const ACTION_COLOURS = new Set(['red', 'amber']);

// Colour map (mirrors chip-renderer.js STATUS_COLOUR exactly)
const STATUS_COLOUR = {
  overdue: 'red',
  not_met: 'red',
  alert: 'red',
  stale: 'amber',
  due_soon: 'amber',
  caution: 'amber',
  no_data: 'neutral',
  recently_initiated: 'neutral',
  noted: 'neutral',
  achieved: 'green',
  in_date: 'green',
  vax_due: 'amber',
  vax_given: 'green',
  vax_declined: 'neutral',
};

// Returns true if this chip status counts as "action needed" (red or amber).
export function isActionNeeded(status) {
  return ACTION_COLOURS.has(STATUS_COLOUR[status]);
}

// ---------------------------------------------------------------------------
// extractBookedPatients(raw, { clinician, limit } = {})
//
// Parses the PRACTICE-WIDE appointment book response from:
//   /scheduling/data/appointment-book/embedded-overview?date=...
//   ({ staffSchedules: [{ name, schedule: [{ entries: [...] }] }] })
//
// v3.40.2: previously parsed /scheduling/data/homepage/my-appointments, which
// is PER-CLINICIAN (the logged-in user's own diary) — a user with no
// personally-booked clinic got an empty schedule and the sweep silently
// reported "0 patients". Same root cause as the Condor waiting-room fix in
// v3.36.2. The appointment book covers every clinician's booked patients.
//
// Options:
//   clinician — when set, only that staff member's appointments are included
//               (exact match on staffSchedules[].name).
//   limit     — max patients to return (default: MAX_SWEEP_PATIENTS).
//               Pass null for no cap (caller handles batching).
//
// Returns:
//   {
//     patients: Array<{ uuid, name, time, clinician }>, // deduped, time-sorted, limited
//     clinicians: string[],            // staff with >=1 appointment entry (unfiltered)
//     appointmentCount: number,        // appointment entries seen (after clinician filter)
//     missingUuidCount: number,        // entries where no UUID was found
//     cappedAt: number | null,         // total before limit (only set when limit applied)
//     diagnosticMessage: string | null // non-null when the feed is unusable —
//                                      //   unrecognised shape, no appointments
//                                      //   at all, or no extractable UUIDs.
//                                      //   NEVER silently zero (H-005).
//   }
//
// "time" is the entry's startDateTime (ISO) or null. Deduplication is on uuid
// (same patient booked twice, incl. with different clinicians → one entry,
// earliest first).
// ---------------------------------------------------------------------------
export function extractBookedPatients(raw, opts) {
  const clinicianFilter = (opts && opts.clinician) || null;
  const limit = opts != null && 'limit' in opts ? opts.limit : MAX_SWEEP_PATIENTS;
  const staffSchedules = raw?.staffSchedules;
  if (!Array.isArray(staffSchedules)) {
    return {
      patients: [],
      clinicians: [],
      appointmentCount: 0,
      missingUuidCount: 0,
      cappedAt: null,
      diagnosticMessage: 'Could not read the appointment book — sweep unavailable; field layout may have changed',
    };
  }

  // Collect appointment entries (excluding cancelled), tagged with the staff
  // member whose diary they sit in. Track which clinicians have appointments
  // regardless of the filter so the UI can offer the full dropdown.
  const allEntries = [];
  const clinicianSet = new Set();
  for (const staff of staffSchedules) {
    const staffName = staff?.name || 'Unknown clinician';
    let staffHasAppointments = false;
    for (const session of staff?.schedule || []) {
      for (const entry of session?.entries || []) {
        if (entry?.diaryEntryType?.value !== 'appointment') continue;
        if (String(entry?.displayStatus?.value || '').toLowerCase() === 'cancelled') continue;
        staffHasAppointments = true;
        if (clinicianFilter && staffName !== clinicianFilter) continue;
        allEntries.push({ entry, clinician: staffName });
      }
    }
    if (staffHasAppointments) clinicianSet.add(staffName);
  }
  const clinicians = Array.from(clinicianSet).sort((a, b) => a.localeCompare(b));

  // Extract UUID from an entry object using multiple strategies:
  //   1. entry.patient.id / uuid / patientId / patientUuid
  //   2. Any UUID-shaped string found in entry.patient or entry directly
  function extractUuid(entry) {
    const p = entry.patient;
    if (!p && !entry) return null;

    if (p) {
      for (const field of ['id', 'uuid', 'patientId', 'patientUuid']) {
        const v = p[field];
        if (typeof v === 'string' && UUID_RE.test(v)) {
          return v.toLowerCase().match(UUID_RE)[1];
        }
      }
    }

    const sources = p ? [p, entry] : [entry];
    for (const obj of sources) {
      if (!obj || typeof obj !== 'object') continue;
      for (const val of Object.values(obj)) {
        if (typeof val === 'string') {
          const m = val.match(UUID_RE);
          if (m) return m[1].toLowerCase();
        }
      }
    }

    return null;
  }

  let missingUuidCount = 0;
  const seen = new Map(); // uuid → patient object (deduplicate)

  for (const { entry, clinician } of allEntries) {
    const uuid = extractUuid(entry);
    if (!uuid) {
      missingUuidCount++;
      continue;
    }
    if (seen.has(uuid)) continue; // same patient booked twice

    const name = entry.patient?.name ?? entry.patient?.displayName ?? 'Unknown patient';
    const time = entry.startDateTime ?? entry.start ?? entry.startTime ?? null;
    seen.set(uuid, { uuid, name, time, clinician });
  }

  // Fail-visible (H-005): every zero outcome carries an explicit reason — a
  // genuinely empty book, a filter matching nothing, or unextractable UUIDs —
  // so the UI can never render a misleading "0 patients, nothing to action".
  let diagnosticMessage = null;
  if (allEntries.length === 0) {
    diagnosticMessage = clinicianFilter
      ? `No booked appointments found for ${clinicianFilter} in today's appointment book.`
      : "No booked appointments found in today's appointment book.";
  } else if (seen.size === 0) {
    diagnosticMessage =
      'Could not identify patients from the appointment book — sweep unavailable; field layout may have changed';
  }

  // Sort by appointment time (lexicographic works for ISO datetimes)
  const sorted = Array.from(seen.values()).sort((a, b) => {
    if (!a.time && !b.time) return 0;
    if (!a.time) return 1;
    if (!b.time) return -1;
    return a.time < b.time ? -1 : a.time > b.time ? 1 : 0;
  });

  const cappedAt = limit !== null && sorted.length > limit ? sorted.length : null;
  const patients = limit !== null ? sorted.slice(0, limit) : sorted;

  return { patients, clinicians, appointmentCount: allEntries.length, missingUuidCount, cappedAt, diagnosticMessage };
}

// ---------------------------------------------------------------------------
// summariseSweep(perPatientResults)
//
// Input: Array of per-patient result objects:
//   {
//     uuid:  string,
//     name:  string,
//     time:  string | null,
//     chips: Array | null,     // null if evaluation was not attempted
//     error: string | null,    // non-null if fetch/eval failed
//     hiddenRuleIds: Set        // ruleIds in sentinel.hiddenRules
//   }
//
// Returns:
//   {
//     actionRows:  Array<SweepRow>,  // patients with ≥1 action chip, worst-first
//     clearRows:   Array<SweepRow>,  // patients with 0 action chips (healthy)
//     errorRows:   Array<SweepRow>,  // patients where fetch/eval threw
//   }
//
// SweepRow shape:
//   { uuid, name, time, clinician, chips, redCount, amberCount, error,
//     hasHiddenActionChips: bool }   // true if any hidden chip is action-needed
//
// Hidden rules (sentinel.hiddenRules) are NOT applied as a suppression filter:
// hidden action chips still count towards redCount/amberCount, so a dismissed
// alert can never silently drop a patient from the worklist. The flag only
// drives an explanatory note in the UI.
//
// Sort order for actionRows: most red first, then most amber, then name.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// chipInstruction(chip)
//
// Translate one action-needed chip into a literal instruction a receptionist
// can act on without clinical knowledge. Receptionists BOOK and FLAG — they
// never make clinical decisions, so every instruction is either "book X" or
// "flag to the duty clinician". Returns { action, detail } or null when the
// chip is not action-needed.
// ---------------------------------------------------------------------------

// QOF indicator code prefix → plain-English booking instruction. Codes are
// like HYP010 / DM006 — the leading letters identify the clinical area.
// Anything unmapped falls back to a generic review booking; the detail line
// always carries the real indicator code + name so the clinician can verify.
const QOF_ACTION_BY_PREFIX = [
  ['HYP', 'Book a blood pressure check'],
  ['BP', 'Book a blood pressure check'],
  ['DM', 'Book a diabetes review'],
  ['AST', 'Book an asthma review'],
  ['COPD', 'Book a COPD review'],
  ['SMOK', 'Ask for and record smoking status'],
  ['CHD', 'Book a long-term condition review'],
  ['HF', 'Book a long-term condition review'],
  ['AF', 'Book a long-term condition review'],
  ['STIA', 'Book a long-term condition review'],
  ['PAD', 'Book a long-term condition review'],
  ['CKD', 'Book a long-term condition review'],
  ['MH', 'Book an annual health check'],
  ['SMI', 'Book an annual health check'],
  ['LD', 'Book an annual health check'],
];

// isBloodTest() is imported from ../shared/chip-instructions.js.
// NON_BLOOD_TEST_RE is shared there — see that file for the definition and comments.

export function chipInstruction(chip) {
  if (!chip || !isActionNeeded(chip.status)) return null;

  if (chip.type === 'drug-monitoring') {
    const dueTests = (chip.tests || [])
      .filter((t) => t && (t.status === 'overdue' || t.status === 'stale' || t.status === 'due_soon'))
      .map((t) => t.name || t.testName)
      .filter(Boolean);
    const drug = chip.drugName || 'monitored medication';
    const detail = `${drug} monitoring ${chip.status === 'due_soon' ? 'due soon' : 'overdue'}`;
    if (dueTests.length === 0) {
      return { action: 'Book a monitoring appointment', detail };
    }
    const bloods = dueTests.filter(isBloodTest);
    const checks = dueTests.filter((n) => !isBloodTest(n));
    let action;
    if (bloods.length && checks.length) {
      action = `Book a blood test and check appointment: ${[...bloods, ...checks].join(', ')}`;
    } else if (bloods.length) {
      action = `Book a blood test appointment: ${bloods.join(', ')}`;
    } else {
      action = `Book a check-up appointment: ${checks.join(', ')}`;
    }
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

  // Everything else (alerts, event counts, registers, combos, trends) is a
  // clinical judgement — reception's only safe action is to hand it on.
  const label =
    chip.drugName ||
    chip.indicatorCode ||
    chip.label ||
    chip.displayName ||
    chip.registerName ||
    chip.ruleId ||
    'alert';
  return { action: 'Flag to the duty clinician', detail: String(label) };
}

// ---------------------------------------------------------------------------
// buildHandout(actionRows, meta)
//
// Build the printable reception worklist from the sweep's action rows.
// Pure: no DOM, no chrome APIs — the caller renders it.
//
// meta: { runAt, clinician (or null = all), suiteVersion }
//
// Returns {
//   generatedAt, clinician, suiteVersion,
//   patients: [{ time, name, clinician, redCount, amberCount,
//                actions: [{ action, detail }],   // deduplicated, red-first order preserved
//                hasHiddenActionChips }]
// }
// Patients are ordered by appointment time (the order reception works in),
// not severity. Identical action+detail pairs are deduplicated per patient
// (two overdue tests on one drug rule must not print twice).
// ---------------------------------------------------------------------------
export function buildHandout(actionRows, meta) {
  const m = meta || {};
  const patients = (actionRows || [])
    .map((row) => {
      // Group by the booking action so a patient with several gaps that resolve to
      // the SAME booking (e.g. DM020 + DM036 → one diabetes review; three QOF gaps
      // → one review appointment) prints as one line with the reasons combined,
      // not three near-identical "book an appointment" rows for reception to wade
      // through. Reasons are de-duplicated and joined.
      const groups = groupInstructionsByAction(row.chips || [], chipInstruction);
      const actions = groups.map(({ action, details }) => ({ action, detail: details.join('; ') }));
      return {
        time: row.time || null,
        name: row.name || 'Unknown patient',
        clinician: row.clinician || null,
        redCount: row.redCount || 0,
        amberCount: row.amberCount || 0,
        actions,
        hasHiddenActionChips: !!row.hasHiddenActionChips,
      };
    })
    .filter((p) => p.actions.length > 0);

  // Reception works the day in appointment order.
  patients.sort((a, b) => {
    if (!a.time && !b.time) return (a.name || '').localeCompare(b.name || '');
    if (!a.time) return 1;
    if (!b.time) return -1;
    return a.time < b.time ? -1 : a.time > b.time ? 1 : 0;
  });

  return {
    generatedAt: m.runAt || new Date().toISOString(),
    clinician: m.clinician || null,
    suiteVersion: m.suiteVersion || '',
    patients,
  };
}

export function summariseSweep(perPatientResults) {
  const actionRows = [];
  const clearRows = [];
  const errorRows = [];

  for (const r of perPatientResults || []) {
    if (r.error) {
      errorRows.push({
        uuid: r.uuid,
        name: r.name,
        time: r.time,
        clinician: r.clinician || null,
        chips: null,
        redCount: 0,
        amberCount: 0,
        error: r.error,
        hasHiddenActionChips: false,
      });
      continue;
    }

    const chips = r.chips || [];
    const hiddenIds = r.hiddenRuleIds instanceof Set ? r.hiddenRuleIds : new Set(r.hiddenRuleIds || []);

    let redCount = 0;
    let amberCount = 0;
    let hasHiddenActionChips = false;

    for (const chip of chips) {
      const colour = STATUS_COLOUR[chip.status];
      // Hidden rules are intentionally NOT suppressed here (CLINICAL-SAFETY-NOTICE
      // limitation 26): a per-workstation dismissal must not silently omit a
      // patient from the recall worklist. Hidden action chips still count; the
      // row is flagged so the clinician knows why the panel looks different.
      if (hiddenIds.has(chip.ruleId) && (colour === 'red' || colour === 'amber')) {
        hasHiddenActionChips = true;
      }
      if (colour === 'red') redCount++;
      else if (colour === 'amber') amberCount++;
    }

    const row = {
      uuid: r.uuid,
      name: r.name,
      time: r.time,
      clinician: r.clinician || null,
      chips,
      redCount,
      amberCount,
      error: null,
      hasHiddenActionChips,
    };

    if (redCount > 0 || amberCount > 0) {
      actionRows.push(row);
    } else {
      clearRows.push(row);
    }
  }

  // Sort action rows: most red first, then most amber, then alphabetical name
  actionRows.sort((a, b) => {
    if (b.redCount !== a.redCount) return b.redCount - a.redCount;
    if (b.amberCount !== a.amberCount) return b.amberCount - a.amberCount;
    return (a.name || '').localeCompare(b.name || '');
  });

  // Sort clear rows alphabetically
  clearRows.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  return { actionRows, clearRows, errorRows };
}
