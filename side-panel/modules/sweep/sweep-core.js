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
  overdue: 'red', not_met: 'red', alert: 'red',
  stale: 'amber', due_soon: 'amber', caution: 'amber',
  no_data: 'neutral', recently_initiated: 'neutral', noted: 'neutral',
  achieved: 'green', in_date: 'green',
  vax_due: 'amber', vax_given: 'green', vax_declined: 'neutral'
};

// Returns true if this chip status counts as "action needed" (red or amber).
export function isActionNeeded(status) {
  return ACTION_COLOURS.has(STATUS_COLOUR[status]);
}

// ---------------------------------------------------------------------------
// extractBookedPatients(raw)
//
// Parses the my-appointments response from:
//   /scheduling/data/homepage/my-appointments
//
// Returns:
//   {
//     patients: Array<{ uuid, name, time }>,  // deduped, capped, time-sorted
//     missingUuidCount: number,               // entries where no UUID was found
//     cappedAt: number | null,                // total before cap (if >MAX)
//     diagnosticMessage: string | null        // non-null when uuid extraction failed
//   }
//
// "time" is the raw `entry.start` string (e.g. "09:30") or null.
// Deduplication is on uuid (same patient booked twice → one entry).
// ---------------------------------------------------------------------------
export function extractBookedPatients(raw) {
  const schedules = raw?.schedule?.schedule;
  if (!Array.isArray(schedules)) {
    return {
      patients: [],
      missingUuidCount: 0,
      cappedAt: null,
      diagnosticMessage: 'Could not identify patients from the appointment feed — sweep unavailable; field layout may have changed'
    };
  }

  // Collect all appointment entries regardless of displayStatus
  const allEntries = schedules.flatMap(s => s.entries ?? [])
    .filter(e => e?.diaryEntryType?.value === 'appointment');

  // Extract UUID from an entry object using multiple strategies:
  //   1. entry.patient.id
  //   2. entry.patient.uuid
  //   3. Any UUID-shaped string found in entry.patient or entry directly
  function extractUuid(entry) {
    const p = entry.patient;
    if (!p && !entry) return null;

    // Strategy 1 & 2: explicit fields
    if (p) {
      for (const field of ['id', 'uuid', 'patientId', 'patientUuid']) {
        const v = p[field];
        if (typeof v === 'string' && UUID_RE.test(v)) {
          return v.toLowerCase().match(UUID_RE)[1];
        }
      }
    }

    // Strategy 3: scan all string values on entry.patient and entry for a UUID
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

  for (const entry of allEntries) {
    const uuid = extractUuid(entry);
    if (!uuid) {
      missingUuidCount++;
      continue;
    }
    if (seen.has(uuid)) continue; // same patient booked twice

    const name = entry.patient?.name ?? entry.patient?.displayName ?? 'Unknown patient';
    const time = entry.start ?? entry.startTime ?? null;
    seen.set(uuid, { uuid, name, time });
  }

  // Diagnose if NO UUIDs were found at all but there were appointments
  let diagnosticMessage = null;
  if (seen.size === 0 && allEntries.length > 0) {
    diagnosticMessage = 'Could not identify patients from the appointment feed — sweep unavailable; field layout may have changed';
  }

  // Sort by appointment time (lexicographic on time string is correct for HH:MM)
  const sorted = Array.from(seen.values()).sort((a, b) => {
    if (!a.time && !b.time) return 0;
    if (!a.time) return 1;
    if (!b.time) return -1;
    return a.time < b.time ? -1 : a.time > b.time ? 1 : 0;
  });

  const cappedAt = sorted.length > MAX_SWEEP_PATIENTS ? sorted.length : null;
  const patients = sorted.slice(0, MAX_SWEEP_PATIENTS);

  return { patients, missingUuidCount, cappedAt, diagnosticMessage };
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
//   { uuid, name, time, chips, redCount, amberCount, error,
//     hasHiddenActionChips: bool }   // true if any hidden chip is action-needed
//
// Hidden rules (sentinel.hiddenRules) are NOT applied as a suppression filter:
// hidden action chips still count towards redCount/amberCount, so a dismissed
// alert can never silently drop a patient from the worklist. The flag only
// drives an explanatory note in the UI.
//
// Sort order for actionRows: most red first, then most amber, then name.
// ---------------------------------------------------------------------------
export function summariseSweep(perPatientResults) {
  const actionRows = [];
  const clearRows = [];
  const errorRows = [];

  for (const r of (perPatientResults || [])) {
    if (r.error) {
      errorRows.push({ uuid: r.uuid, name: r.name, time: r.time, chips: null, redCount: 0, amberCount: 0, error: r.error, hasHiddenActionChips: false });
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

    const row = { uuid: r.uuid, name: r.name, time: r.time, chips, redCount, amberCount, error: null, hasHiddenActionChips };

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
