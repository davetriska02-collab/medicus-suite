// Queue Book assist — C4 next-green-day snippet (prepare-only).
//
// Pure: pick a green day from already-counted slot totals, and compose the
// timestamped draft sentence. Never holds a slot. Never invents a slot id.
// Loaded as a classic script (`window.TriageQueueBook`) before content.js.
//
// Safety: the snippet always includes "or nearest equivalent" + "as of hh:mm"
// and never the word Booked. Staging is not a booking (H-049 family).
(function (global) {
  'use strict';

  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function isoFromDate(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function parseISO(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0, 0);
  }

  function formatDayLabel(iso) {
    const d = parseISO(iso);
    if (!d) return String(iso || '');
    return DOW[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
  }

  function formatAsOf(now) {
    const d = now instanceof Date ? now : new Date();
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function minimumForDate(preset, iso) {
    if (!preset) return 0;
    const d = parseISO(iso);
    if (!d) return 0;
    const keys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const key = keys[d.getDay()];
    if (preset.minimumByDay && preset.minimumByDay[key] !== undefined) {
      return Number(preset.minimumByDay[key]) || 0;
    }
    if (d.getDay() === 0 || d.getDay() === 6) return 0;
    return Number(preset.minimumPerDay) || 0;
  }

  // A day is green when free slots of the preset's types meet the weekday
  // minimum (C4). Thresholds (tight/low) describe pressure, not "green";
  // only count >= minimum is a green day. minimum 0 = closed / not offered.
  function isGreenDay(day, preset) {
    if (!day || !preset) return false;
    const min = minimumForDate(preset, day.iso);
    if (min <= 0) return false;
    const free = Number(day.free);
    return Number.isFinite(free) && free >= min;
  }

  // days: [{ iso, free, sessionsCount? }] already aggregated for the preset.
  // Skips today (disposition is "not today") and any day that is not green.
  function pickNextGreenDay(days, preset) {
    if (!Array.isArray(days) || !preset) return null;
    for (let i = 0; i < days.length; i++) {
      const day = days[i];
      if (!day || !day.iso) continue;
      if (isGreenDay(day, preset)) return day;
    }
    return null;
  }

  // countFreeSlots(raw, { allowedTypes, filterBefore })
  // Minimal read of an embedded-overview payload — slot diary entries only,
  // optional type whitelist, optional "ignore already-past times".
  function countFreeSlots(raw, opts) {
    opts = opts || {};
    const allowed = Array.isArray(opts.allowedTypes) && opts.allowedTypes.length ? opts.allowedTypes : null;
    const cutoff = opts.filterBefore instanceof Date ? opts.filterBefore : null;
    let free = 0;
    let sessionsCount = 0;
    const staffSchedules = raw && Array.isArray(raw.staffSchedules) ? raw.staffSchedules : [];
    for (let s = 0; s < staffSchedules.length; s++) {
      const schedule = staffSchedules[s] && staffSchedules[s].schedule;
      if (!Array.isArray(schedule)) continue;
      for (let i = 0; i < schedule.length; i++) {
        const session = schedule[i] || {};
        if (!session.summary || !session.summary.status || !session.summary.status.isCancelled) {
          sessionsCount++;
        }
        const entries = session.entries;
        if (!Array.isArray(entries)) continue;
        for (let e = 0; e < entries.length; e++) {
          const entry = entries[e] || {};
          if (!entry.diaryEntryType || entry.diaryEntryType.value !== 'slot') continue;
          const type = (entry.appointmentType && entry.appointmentType.name) || '';
          if (allowed && allowed.indexOf(type) === -1) continue;
          if (cutoff && entry.startDateTime) {
            const t = Date.parse(entry.startDateTime);
            if (Number.isFinite(t) && t < cutoff.getTime()) continue;
          }
          free++;
        }
      }
    }
    return { free: free, sessionsCount: sessionsCount };
  }

  // composeBookSnippet({ patientName, presetName, day, now })
  // day: { iso, free } | null. Always prepare-only language.
  function composeBookSnippet(opts) {
    opts = opts || {};
    const name = String(opts.patientName || 'patient').trim() || 'patient';
    const preset = String(opts.presetName || 'capacity preset').trim() || 'capacity preset';
    const asOf = formatAsOf(opts.now);
    if (!opts.day || !opts.day.iso) {
      return (
        'book ' +
        name +
        ' — ' +
        preset +
        ' — next green day (confirm on the Capacity tab) — or nearest equivalent — as of ' +
        asOf +
        '. Does not hold a slot.'
      );
    }
    const free = Number(opts.day.free);
    const freeBit = Number.isFinite(free) ? ', ' + free + ' free as of ' + asOf : ' as of ' + asOf;
    return (
      'book ' +
      name +
      ' — ' +
      preset +
      ' — ' +
      formatDayLabel(opts.day.iso) +
      freeBit +
      ' — or nearest equivalent. Does not hold a slot.'
    );
  }

  // C4 v2 — create a reception task (same endpoint as W4/W5). Never a slot.
  function normaliseAssignees(form) {
    const teams = (form && form.assigneeOptions && form.assigneeOptions.teams) || (form && form.teams) || [];
    const staff = (form && form.assigneeOptions && form.assigneeOptions.staff) || (form && form.staff) || [];
    const out = [];
    const push = (list, kind) => {
      if (!Array.isArray(list)) return;
      for (let i = 0; i < list.length; i++) {
        const t = list[i] || {};
        const id = t.value || t.id;
        if (!id) continue;
        out.push({
          value: kind + '|' + id,
          label: String(t.label || t.name || id),
          kind: kind,
        });
      }
    };
    push(teams, 'team');
    push(staff, 'staff');
    return out;
  }

  function pickDefaultAssignee(assignees) {
    if (!Array.isArray(assignees) || !assignees.length) return '';
    const rec = assignees.find((a) => /reception|admin|care.?nav|workflow/i.test(a.label || ''));
    return (rec || assignees[0]).value || '';
  }

  // pin + live must agree or the write is refused. Same H-043 shape as W5.
  function assertTaskIdentity(pin, live) {
    if (!pin || !live) return { ok: false, reason: 'Identity missing — task not created.' };
    if (!pin.taskUuid || !pin.patientId) return { ok: false, reason: 'Identity missing — task not created.' };
    if (!live.taskUuid || live.taskUuid !== pin.taskUuid) {
      return { ok: false, reason: 'Row moved — task not created.' };
    }
    if (!live.patientId || live.patientId !== pin.patientId) {
      return { ok: false, reason: 'Patient could not be re-verified — task not created.' };
    }
    return { ok: true };
  }

  function buildCreatePayload(opts) {
    opts = opts || {};
    const assignee = String(opts.assignee || '');
    const sep = assignee.indexOf('|');
    const description = String(opts.description || '').trim();
    if (!opts.patientId || sep < 1 || !description) return null;
    return {
      patientId: opts.patientId,
      contextId: null,
      contextType: null,
      assigneeType: assignee.slice(0, sep),
      assigneeId: assignee.slice(sep + 1),
      description: description,
      priority: Number(opts.priority) || 0,
      snoozeUntil: null,
    };
  }

  function workingDatesFrom(now, n) {
    const start = now instanceof Date ? now : new Date();
    const out = [];
    let d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    // Skip today — C4 activates after "not today".
    d.setDate(d.getDate() + 1);
    let guard = 0;
    while (out.length < (n || 5) && guard < 21) {
      if (d.getDay() !== 0 && d.getDay() !== 6) out.push(isoFromDate(d));
      d.setDate(d.getDate() + 1);
      guard++;
    }
    return out;
  }

  const api = {
    isoFromDate: isoFromDate,
    formatDayLabel: formatDayLabel,
    formatAsOf: formatAsOf,
    minimumForDate: minimumForDate,
    isGreenDay: isGreenDay,
    pickNextGreenDay: pickNextGreenDay,
    countFreeSlots: countFreeSlots,
    composeBookSnippet: composeBookSnippet,
    workingDatesFrom: workingDatesFrom,
    normaliseAssignees: normaliseAssignees,
    pickDefaultAssignee: pickDefaultAssignee,
    assertTaskIdentity: assertTaskIdentity,
    buildCreatePayload: buildCreatePayload,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.TriageQueueBook = api;
})(typeof window !== 'undefined' ? window : globalThis);
