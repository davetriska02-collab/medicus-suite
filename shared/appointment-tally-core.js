// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — appointment-book tally core
//
// Booked vs free counts by appointment type, from the same
// /scheduling/data/appointment-book/embedded-overview payload Slot Counter
// uses. Free slots are diaryEntryType === 'slot' (Slots' remaining-today
// rule: skip past start times on the viewed date when it is today). Booked
// are non-cancelled diaryEntryType === 'appointment'. Type inclusion is
// the caller's hiddenTypes set — the live widget writes slots.hiddenTypes
// so the Slot Counter checkboxes and this tally cannot drift.
//
// Optional vaccine-eligibility totals (flu / COVID / RSV) are also derived
// here from per-patient engine chips. The widget GETs patient records only
// when a vaccine toggle is on. This file stays pure: no fetch, no chrome.*,
// no DOM.
//
// Dual-mode: module.exports for Node tests, window.AppointmentTallyCore
// for the appointment-book content script.

(function (global) {
  'use strict';

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function todayISO(now) {
    var d = now instanceof Date ? now : new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  var UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

  var VAX_KEYS = ['flu', 'covid', 'rsv'];
  var VAX_LABELS = { flu: 'Flu', covid: 'COVID', rsv: 'RSV' };
  var VAX_RULE_IDS = { flu: 'vax-flu', covid: 'vax-covid', rsv: 'vax-rsv' };

  function emptyCounts() {
    return { booked: 0, free: 0 };
  }

  function emptyVaxToggles() {
    return { flu: false, covid: false, rsv: false };
  }

  function parseVaxToggles(val) {
    var out = emptyVaxToggles();
    if (!val || typeof val !== 'object' || Array.isArray(val)) return out;
    out.flu = !!val.flu;
    out.covid = !!val.covid;
    out.rsv = !!val.rsv;
    return out;
  }

  function anyVaxOn(toggles) {
    var t = parseVaxToggles(toggles);
    return !!(t.flu || t.covid || t.rsv);
  }

  function sumCounts(c) {
    c = c || emptyCounts();
    return (c.booked || 0) + (c.free || 0);
  }

  function entryType(entry) {
    return String((entry && entry.diaryEntryType && entry.diaryEntryType.value) || '');
  }

  function typeName(entry) {
    var t = entry && entry.appointmentType;
    var name = t && t.name;
    return name ? String(name) : 'Unknown';
  }

  function statusValue(entry) {
    return String((entry && entry.displayStatus && entry.displayStatus.value) || '').toLowerCase();
  }

  function isCancelled(entry) {
    if (statusValue(entry) === 'cancelled') return true;
    var st = (entry && entry.appointmentStatus) || {};
    return !!(st.isCancelled || String(st.value || '').toLowerCase() === 'cancelled');
  }

  function isCancelledSession(session) {
    return !!(session && session.summary && session.summary.status && session.summary.status.isCancelled);
  }

  function staffKey(name) {
    return String(name || '')
      .trim()
      .toLowerCase();
  }

  function staffAllowed(name, staffNames) {
    if (!staffNames) return true;
    var want;
    if (staffNames instanceof Set) want = staffNames;
    else if (Array.isArray(staffNames)) {
      want = new Set(
        staffNames
          .map(function (n) {
            return staffKey(n);
          })
          .filter(Boolean)
      );
    } else {
      return true;
    }
    if (want.size === 0) return true;
    return want.has(staffKey(name));
  }

  function slotIsPast(startDateTime, now) {
    if (!startDateTime || !now) return false;
    var t = new Date(startDateTime);
    if (isNaN(t.getTime())) return false;
    return t.getTime() < now.getTime();
  }

  function ensureType(byType, name) {
    if (!byType[name]) byType[name] = emptyCounts();
    return byType[name];
  }

  function extractPatientUuid(entry) {
    if (!entry) return null;
    var p = entry.patient;
    if (p) {
      var fields = ['id', 'uuid', 'patientId', 'patientUuid'];
      for (var i = 0; i < fields.length; i++) {
        var v = p[fields[i]];
        if (typeof v === 'string' && UUID_RE.test(v)) {
          return v.toLowerCase().match(UUID_RE)[1];
        }
      }
    }
    var sources = p ? [p, entry] : [entry];
    for (var s = 0; s < sources.length; s++) {
      var obj = sources[s];
      if (!obj || typeof obj !== 'object') continue;
      var keys = Object.keys(obj);
      for (var j = 0; j < keys.length; j++) {
        var val = obj[keys[j]];
        if (typeof val === 'string') {
          var m = val.match(UUID_RE);
          if (m) return m[1].toLowerCase();
        }
      }
    }
    return null;
  }

  function walkEntries(entries, byType, opts) {
    (entries || []).forEach(function (entry) {
      var kind = entryType(entry);
      if (kind === 'appointment') {
        if (isCancelled(entry)) return;
        ensureType(byType, typeName(entry)).booked += 1;
        if (opts.collectPatients) recordBookedPatient(opts.collectPatients, entry);
        return;
      }
      if (kind !== 'slot') return;
      if (opts.skipPastFree && slotIsPast(entry.startDateTime, opts.now)) return;
      ensureType(byType, typeName(entry)).free += 1;
    });
  }

  function recordBookedPatient(bucket, entry) {
    bucket.appointmentCount += 1;
    var uuid = extractPatientUuid(entry);
    var type = typeName(entry);
    if (!uuid) {
      bucket.missing += 1;
      return;
    }
    var row = bucket.byUuid[uuid];
    if (!row) {
      row = { uuid: uuid, types: {} };
      bucket.byUuid[uuid] = row;
    }
    row.types[type] = true;
  }

  function walkSessions(sessions, staffName, byType, staffSeen, opts) {
    (sessions || []).forEach(function (session) {
      if (!session || session.scheduleType === 'unavailability-period') return;
      if (isCancelledSession(session)) return;
      if (!staffAllowed(staffName, opts.staffNames)) return;
      staffSeen[staffName] = true;
      walkEntries(session.entries, byType, opts);
    });
  }

  /**
   * Aggregate booked + free by appointment type.
   *
   * opts:
   *   date        — YYYY-MM-DD of the book (raw.date used if omitted)
   *   now         — Date; defaults to new Date()
   *   skipPastFree — default true when date === today
   *   staffNames  — optional Set/array of staff names to include
   */
  function tallyFromOverview(raw, opts) {
    opts = opts || {};
    var now = opts.now instanceof Date ? opts.now : new Date();
    var date = opts.date || (raw && raw.date) || null;
    var skipPastFree = opts.skipPastFree;
    if (skipPastFree == null) {
      skipPastFree = !!(date && date === todayISO(now));
    }
    var patients = { byUuid: {}, missing: 0, appointmentCount: 0 };
    var walkOpts = {
      now: now,
      skipPastFree: !!skipPastFree,
      staffNames: opts.staffNames || null,
      collectPatients: patients,
    };
    var byType = {};
    var staffSeen = {};

    ((raw && raw.staffSchedules) || []).forEach(function (staff) {
      var name = staff && staff.name ? staff.name : 'Unknown';
      walkSessions(staff && staff.schedule, name, byType, staffSeen, walkOpts);
    });
    walkSessions((raw && raw.unassignedDiaries) || [], 'Unassigned', byType, staffSeen, walkOpts);

    return {
      date: date,
      byType: byType,
      staff: Object.keys(staffSeen).sort(function (a, b) {
        return a.localeCompare(b);
      }),
      skipPastFree: !!skipPastFree,
      patients: patients,
    };
  }

  function visiblePatientUuids(patients, hiddenTypes) {
    var hidden = hiddenSet(hiddenTypes);
    var uuids = [];
    var byUuid = (patients && patients.byUuid) || {};
    Object.keys(byUuid).forEach(function (uuid) {
      var types = Object.keys((byUuid[uuid] && byUuid[uuid].types) || {});
      var visible = types.some(function (type) {
        return !hidden.has(type);
      });
      if (visible) uuids.push(uuid);
    });
    uuids.sort();
    return uuids;
  }

  function vaccineKeyFromChip(chip) {
    if (!chip) return null;
    var v = chip.vaccine;
    if (v === 'flu' || v === 'covid' || v === 'rsv') return v;
    if (chip.ruleId === VAX_RULE_IDS.flu) return 'flu';
    if (chip.ruleId === VAX_RULE_IDS.covid) return 'covid';
    if (chip.ruleId === VAX_RULE_IDS.rsv) return 'rsv';
    return null;
  }

  function vaxFlagsFromChips(chips) {
    var flags = { flu: null, covid: null, rsv: null };
    (chips || []).forEach(function (chip) {
      if (!chip || chip.type !== 'vaccine') return;
      var key = vaccineKeyFromChip(chip);
      if (!key) return;
      flags[key] = chip.status || 'vax_due';
    });
    return flags;
  }

  function emptyVaxBucket() {
    return { eligible: 0, due: 0, given: 0, declined: 0 };
  }

  function emptyVaxSummary(total) {
    return {
      flu: emptyVaxBucket(),
      covid: emptyVaxBucket(),
      rsv: emptyVaxBucket(),
      checked: 0,
      errors: 0,
      pending: 0,
      total: total || 0,
    };
  }

  function countOneVax(bucket, status) {
    if (!status) return;
    bucket.eligible += 1;
    if (status === 'vax_due') bucket.due += 1;
    else if (status === 'vax_given') bucket.given += 1;
    else if (status === 'vax_declined') bucket.declined += 1;
  }

  function summariseVax(byUuid, visibleUuids) {
    var uuids = Array.isArray(visibleUuids) ? visibleUuids : [];
    var summary = emptyVaxSummary(uuids.length);
    var map = byUuid || {};
    uuids.forEach(function (uuid) {
      var row = map[uuid];
      if (!row) {
        summary.pending += 1;
        return;
      }
      if (row.error) {
        summary.errors += 1;
        summary.checked += 1;
        return;
      }
      summary.checked += 1;
      countOneVax(summary.flu, row.flu);
      countOneVax(summary.covid, row.covid);
      countOneVax(summary.rsv, row.rsv);
    });
    return summary;
  }

  function vaxButtonParts(summary, toggles, scanning) {
    var t = parseVaxToggles(toggles);
    var s = summary || emptyVaxSummary(0);
    var parts = [];
    VAX_KEYS.forEach(function (key) {
      if (!t[key]) return;
      var label = VAX_LABELS[key];
      var n = (s[key] && s[key].eligible) || 0;
      parts.push(scanning ? label + ' ' + n + '\u2026' : label + ' ' + n);
    });
    return parts;
  }

  function hiddenSet(hiddenTypes) {
    if (hiddenTypes instanceof Set) return hiddenTypes;
    if (Array.isArray(hiddenTypes)) {
      return new Set(
        hiddenTypes.filter(function (t) {
          return typeof t === 'string';
        })
      );
    }
    return new Set();
  }

  function applyHidden(byType, hiddenTypes) {
    var hidden = hiddenSet(hiddenTypes);
    var visible = {};
    var excluded = {};
    var totals = emptyCounts();
    Object.keys(byType || {}).forEach(function (type) {
      var counts = byType[type] || emptyCounts();
      if (hidden.has(type)) {
        excluded[type] = { booked: counts.booked || 0, free: counts.free || 0 };
        return;
      }
      visible[type] = { booked: counts.booked || 0, free: counts.free || 0 };
      totals.booked += visible[type].booked;
      totals.free += visible[type].free;
    });
    return {
      byType: visible,
      excluded: excluded,
      totals: totals,
      all: sumCounts(totals),
    };
  }

  function sortedTypeEntries(byType) {
    return Object.keys(byType || {})
      .map(function (type) {
        return [type, byType[type] || emptyCounts()];
      })
      .sort(function (a, b) {
        var d = sumCounts(b[1]) - sumCounts(a[1]);
        if (d) return d;
        return a[0].localeCompare(b[0]);
      });
  }

  function buttonLabel(totals, vaxParts) {
    var booked = (totals && totals.booked) || 0;
    var free = (totals && totals.free) || 0;
    var base = booked + ' booked \u00b7 ' + free + ' free';
    if (!vaxParts || !vaxParts.length) return base;
    return base + ' \u00b7 ' + vaxParts.join(' \u00b7 ');
  }

  function shouldApplyFetch(inFlightKey, currentKey) {
    return !!inFlightKey && inFlightKey === currentKey;
  }

  // In-flight coalesce: reuse the same promise only when the route key
  // matches and the caller is not bypassing cache. A late finish must
  // clear only the promise it started — otherwise a newer fetch for a
  // different date is wiped by the stale one.
  function shouldReuseInFlight(inFlight, inFlightKey, currentKey, bypassCache) {
    return !!inFlight && !bypassCache && inFlightKey === currentKey;
  }

  function beginInFlight(key, promise) {
    return { inFlight: promise, inFlightKey: key || '' };
  }

  function finishInFlight(state, promise) {
    state = state || {};
    if (state.inFlight === promise) {
      return { inFlight: null, inFlightKey: '' };
    }
    return { inFlight: state.inFlight || null, inFlightKey: state.inFlightKey || '' };
  }

  var api = {
    todayISO: todayISO,
    emptyCounts: emptyCounts,
    sumCounts: sumCounts,
    typeName: typeName,
    isCancelled: isCancelled,
    slotIsPast: slotIsPast,
    extractPatientUuid: extractPatientUuid,
    tallyFromOverview: tallyFromOverview,
    visiblePatientUuids: visiblePatientUuids,
    vaxFlagsFromChips: vaxFlagsFromChips,
    summariseVax: summariseVax,
    emptyVaxSummary: emptyVaxSummary,
    emptyVaxToggles: emptyVaxToggles,
    parseVaxToggles: parseVaxToggles,
    anyVaxOn: anyVaxOn,
    vaxButtonParts: vaxButtonParts,
    VAX_KEYS: VAX_KEYS,
    VAX_LABELS: VAX_LABELS,
    VAX_RULE_IDS: VAX_RULE_IDS,
    applyHidden: applyHidden,
    sortedTypeEntries: sortedTypeEntries,
    buttonLabel: buttonLabel,
    shouldApplyFetch: shouldApplyFetch,
    shouldReuseInFlight: shouldReuseInFlight,
    beginInFlight: beginInFlight,
    finishInFlight: finishInFlight,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.AppointmentTallyCore = api;
  }
})(typeof self !== 'undefined' ? self : this);
