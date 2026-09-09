// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — shared "who is away" wrapper.
//
// One resolver: LabAllocateCore.presenceForName (rota leave + Medicus
// absences + today's appointment book). Allocate canvases already paint
// AWAY from this. Monitoring (Sentinel) and any other task surface must
// call through here — do not add a second matching algorithm.
//
// presence.enabled is the same opt-out as task-presence.js: on unless this
// machine explicitly set it false. Opt-out hides the away chrome only; it
// never mutes a clinical safety path.
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

  function isAwayState(state) {
    return state === 'away' || state === 'away-pending';
  }

  // Same stance as task-presence resolvePresenceConfig: on unless opted out.
  function isPresenceEnabled(storage) {
    if (!storage || typeof storage !== 'object') return true;
    return storage['presence.enabled'] !== false;
  }

  function rotaSourcesFromStorage(got) {
    var src = got && typeof got === 'object' ? got : {};
    return {
      staffList: Array.isArray(src['rota.staff']) ? src['rota.staff'] : [],
      leaveList: Array.isArray(src['rota.leave']) ? src['rota.leave'] : [],
    };
  }

  function emptySources(enabled) {
    return {
      enabled: enabled !== false,
      staffList: [],
      leaveList: [],
      absences: [],
      book: null,
      dateISO: '',
    };
  }

  function sourcesFromParts(opts) {
    opts = opts || {};
    var enabled = opts.enabled !== false;
    if (!enabled) return emptySources(false);
    return {
      enabled: true,
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

  function lookup(name, sources) {
    if (!sources || sources.enabled === false) {
      return { state: 'n/a', reason: 'opted-out', label: '', source: '' };
    }
    var who = typeof name === 'string' ? name.trim() : '';
    if (!who) return { state: 'n/a', reason: 'not-a-person', label: '', source: '' };
    return presenceForName({
      name: who,
      dateISO: sources.dateISO || undefined,
      staffList: sources.staffList,
      leaveList: sources.leaveList,
      absences: sources.absences,
      book: sources.book,
    });
  }

  function decorateAssigneeLabel(label, presence) {
    var name = typeof label === 'string' ? label.trim() : '';
    if (!name) return '';
    if (!isAwayState(presence && presence.state)) return name;
    return name + ' — Away';
  }

  // Advisory only — never blocks create / assign. Allocate canvases warn
  // the same way; the clinician still chooses.
  function assigneeWarning(presence) {
    if (!isAwayState(presence && presence.state)) return '';
    var label = presence.label && String(presence.label).trim() ? String(presence.label).trim() : '';
    if (presence.state === 'away-pending') {
      return (
        (label ? label + ' ' : '') +
        'They may still be away — leave is requested, not yet approved. You can still create the task.'
      );
    }
    return (
      (label ? label + ' ' : '') +
      'They will not see this today unless someone else picks it up. You can still create the task.'
    );
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

  async function loadSources(opts) {
    opts = opts || {};
    var enabled = true;
    var staffList = [];
    var leaveList = [];
    var absences = [];
    var book = null;
    var dateISO = typeof opts.dateISO === 'string' ? opts.dateISO : '';

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        var got = await chrome.storage.local.get(['presence.enabled', 'rota.staff', 'rota.leave']);
        enabled = isPresenceEnabled(got);
        var rota = rotaSourcesFromStorage(got);
        staffList = rota.staffList;
        leaveList = rota.leaveList;
      } catch (_) {
        /* rota sources stay empty — lookup then returns unknown, not away */
      }
    }
    if (!enabled) return emptySources(false);

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
        /* Medicus book/absences are optional; rota leave still paints Away */
      }
    }

    return sourcesFromParts({
      enabled: true,
      staffList: staffList,
      leaveList: leaveList,
      absences: absences,
      book: book,
      dateISO: dateISO,
    });
  }

  var api = {
    isAwayState: isAwayState,
    isPresenceEnabled: isPresenceEnabled,
    rotaSourcesFromStorage: rotaSourcesFromStorage,
    sourcesFromParts: sourcesFromParts,
    emptySources: emptySources,
    presenceForName: presenceForName,
    lookup: lookup,
    decorateAssigneeLabel: decorateAssigneeLabel,
    assigneeWarning: assigneeWarning,
    pickTaskAssigneeName: pickTaskAssigneeName,
    normaliseOpenTask: normaliseOpenTask,
    loadSources: loadSources,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) global.StaffPresence = api;
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
