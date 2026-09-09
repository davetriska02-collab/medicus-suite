// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Away / staff absence for task surfaces.
//
// Away ≠ occupancy (who is on this request). Away is "this person is on
// leave / has a Medicus absence" — the same signal allocate canvases
// already paint. Occupancy chips and occupancy-look settings stay out.
//
// One resolver: LabAllocateCore.presenceForName
//   Medicus absences → rota leave → today’s appointment book
//   states: away | away-pending | present | unknown | n/a
// shouldWarnAbsence / absenceWarningCopy / matchStaffByName are re-exported
// so callers do not copy-paste leave math.
//
// Data: READ rota.staff + rota.leave from chrome.storage.local; live
// absences / book via LabAllocateCore.createClient (same as
// lab-allocate-canvas.js loadRotaAbsences / loadMedicusPresence).
// Never writes rota.*.
//
// Dual-mode: window.StaffPresence in the browser; module.exports in Node.

(function (global) {
  'use strict';

  function loadLab() {
    if (typeof require === 'function') {
      try {
        return require('./lab-allocate-core.js');
      } catch (_) {
        /* browser path below */
      }
    }
    if (global && global.LabAllocateCore) return global.LabAllocateCore;
    throw new Error('StaffPresence needs LabAllocateCore');
  }

  function rotaSourcesFromStorage(got) {
    var src = got && typeof got === 'object' ? got : {};
    return {
      staffList: Array.isArray(src['rota.staff']) ? src['rota.staff'] : [],
      leaveList: Array.isArray(src['rota.leave']) ? src['rota.leave'] : [],
    };
  }

  function emptySources() {
    return {
      staffList: [],
      leaveList: [],
      absences: [],
      book: null,
      dateISO: '',
    };
  }

  function sourcesFromParts(opts) {
    opts = opts || {};
    return {
      staffList: Array.isArray(opts.staffList) ? opts.staffList : [],
      leaveList: Array.isArray(opts.leaveList) ? opts.leaveList : [],
      absences: Array.isArray(opts.absences) ? opts.absences : [],
      book: opts.book || null,
      dateISO: typeof opts.dateISO === 'string' ? opts.dateISO : '',
    };
  }

  function presenceForName(opts) {
    return loadLab().presenceForName(opts || {});
  }

  function shouldWarnAbsence(absence) {
    return loadLab().shouldWarnAbsence(absence);
  }

  function absenceWarningCopy(absence, count, clinicianName) {
    return loadLab().absenceWarningCopy(absence, count, clinicianName);
  }

  function matchStaffByName(staffList, name) {
    return loadLab().matchStaffByName(staffList, name);
  }

  function isTeamAssignee(name) {
    return loadLab().isTeamAssignee(name);
  }

  // Teams are n/a. Empty name is n/a. Otherwise the allocate resolver —
  // unknown is not present when there is no evidence.
  function lookup(name, sources) {
    var who = typeof name === 'string' ? name.trim() : '';
    if (!who) return { state: 'n/a', reason: 'not-a-person', label: '', source: '' };
    if (isTeamAssignee(who)) return { state: 'n/a', reason: 'team', label: '', source: '' };
    var src = sources || emptySources();
    return presenceForName({
      name: who,
      dateISO: src.dateISO || undefined,
      staffList: src.staffList,
      leaveList: src.leaveList,
      absences: src.absences,
      book: src.book,
    });
  }

  function decorateAssigneeLabel(label, presence) {
    var name = typeof label === 'string' ? label.trim() : '';
    if (!name) return '';
    if (!shouldWarnAbsence(presence)) return name;
    return name + ' — Away';
  }

  // Allocate canvas paints abs.label in .ms-lac-col-absence
  // ("{name} is on {leave type} until {date}"). Same sentence here.
  // Advisory only — callers must not disable Create from this string.
  function absenceNote(presence) {
    if (!shouldWarnAbsence(presence)) return '';
    return presence && presence.label ? String(presence.label) : '';
  }

  function pickTaskAssigneeName(task) {
    if (!task || typeof task !== 'object') return '';
    if (typeof task.assignedTo === 'string' && task.assignedTo.trim()) return task.assignedTo.trim();
    if (task.assignedTo && typeof task.assignedTo === 'object') {
      var nested = task.assignedTo.name || task.assignedTo.label || task.assignedTo.displayName;
      if (nested && String(nested).trim()) return String(nested).trim();
    }
    if (typeof task.assignee === 'string' && task.assignee.trim()) return task.assignee.trim();
    if (task.assignee && typeof task.assignee === 'object') {
      var fromObj = task.assignee.name || task.assignee.label || task.assignee.displayName;
      if (fromObj && String(fromObj).trim()) return String(fromObj).trim();
    }
    return '';
  }

  function normaliseOpenTask(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var assignedTo = pickTaskAssigneeName(raw);
    var taskType =
      typeof raw.taskType === 'string' && raw.taskType.trim()
        ? raw.taskType.trim()
        : typeof raw.type === 'string' && raw.type.trim()
          ? raw.type.trim()
          : 'Task';
    var dueDate = typeof raw.dueDate === 'string' ? raw.dueDate.trim() : '';
    if (dueDate === '-') dueDate = '';
    return {
      taskType: taskType.slice(0, 80),
      assignedTo: assignedTo.slice(0, 80),
      dueDate: dueDate.slice(0, 40),
      isOverdue: raw.isOverdue === true,
    };
  }

  // Read-only. Mirrors lab-allocate-canvas.js loadRotaAbsences (~348) then
  // loadMedicusPresence (~359): storage GET, then fetchTodayBook +
  // fetchStaffScheduleAbsences. Never chrome.storage.local.set.
  async function loadSources(opts) {
    opts = opts || {};
    var staffList = [];
    var leaveList = [];
    var absences = [];
    var book = null;
    var dateISO = typeof opts.dateISO === 'string' ? opts.dateISO : '';

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        var got = await chrome.storage.local.get(['rota.staff', 'rota.leave']);
        var rota = rotaSourcesFromStorage(got);
        staffList = rota.staffList;
        leaveList = rota.leaveList;
      } catch (_) {
        /* empty lists → lookup returns unknown, never a fabricated present */
      }
    }

    if (opts.apiBase) {
      try {
        var client = loadLab().createClient(opts.apiBase, { fetchImpl: opts.fetchImpl });
        var settled = await Promise.allSettled([
          client.fetchTodayBook(dateISO || undefined),
          client.fetchStaffScheduleAbsences(),
        ]);
        if (settled[0].status === 'fulfilled') book = settled[0].value;
        if (settled[1].status === 'fulfilled') absences = settled[1].value || [];
      } catch (_) {
        /* book/absences optional; rota leave still resolves Away */
      }
    }

    return sourcesFromParts({
      staffList: staffList,
      leaveList: leaveList,
      absences: absences,
      book: book,
      dateISO: dateISO,
    });
  }

  var api = {
    rotaSourcesFromStorage: rotaSourcesFromStorage,
    sourcesFromParts: sourcesFromParts,
    emptySources: emptySources,
    presenceForName: presenceForName,
    shouldWarnAbsence: shouldWarnAbsence,
    absenceWarningCopy: absenceWarningCopy,
    matchStaffByName: matchStaffByName,
    isTeamAssignee: isTeamAssignee,
    lookup: lookup,
    decorateAssigneeLabel: decorateAssigneeLabel,
    absenceNote: absenceNote,
    pickTaskAssigneeName: pickTaskAssigneeName,
    normaliseOpenTask: normaliseOpenTask,
    loadSources: loadSources,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) global.StaffPresence = api;
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
