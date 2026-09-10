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
// Dual-mode: module.exports for Node tests, window.AppointmentTallyCore
// for the appointment-book content script. No fetch, no chrome.*, no DOM.

(function (global) {
  'use strict';

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function todayISO(now) {
    var d = now instanceof Date ? now : new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function emptyCounts() {
    return { booked: 0, free: 0 };
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

  function walkEntries(entries, byType, opts) {
    (entries || []).forEach(function (entry) {
      var kind = entryType(entry);
      if (kind === 'appointment') {
        if (isCancelled(entry)) return;
        ensureType(byType, typeName(entry)).booked += 1;
        return;
      }
      if (kind !== 'slot') return;
      if (opts.skipPastFree && slotIsPast(entry.startDateTime, opts.now)) return;
      ensureType(byType, typeName(entry)).free += 1;
    });
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
    var walkOpts = {
      now: now,
      skipPastFree: !!skipPastFree,
      staffNames: opts.staffNames || null,
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
    };
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

  function buttonLabel(totals) {
    var booked = (totals && totals.booked) || 0;
    var free = (totals && totals.free) || 0;
    return booked + ' booked · ' + free + ' free';
  }

  var api = {
    todayISO: todayISO,
    emptyCounts: emptyCounts,
    sumCounts: sumCounts,
    typeName: typeName,
    isCancelled: isCancelled,
    slotIsPast: slotIsPast,
    tallyFromOverview: tallyFromOverview,
    applyHidden: applyHidden,
    sortedTypeEntries: sortedTypeEntries,
    buttonLabel: buttonLabel,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.AppointmentTallyCore = api;
  }
})(typeof self !== 'undefined' ? self : this);
