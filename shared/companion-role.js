// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Shared — Companion HUD role + page-context helpers.
//
// The floating widget (content-scripts/task-actions-panel.js) is one box
// with four role views. This module is the testable core: which role is
// valid, which sections that role shows, how a Medicus URL maps to a page
// kind, and honest desk / pulse / slot-glance mapping. The widget owns
// fetch + DOM; this file never fetches and never touches chrome.*.
//
// Dual-mode export (same pattern as shared/due-mini.js):
//   Browser (classic script): window.MsCompanionRole.<fn>(...)
//   Node / test:              require('./shared/companion-role.js').<fn>(...)

(function (global) {
  'use strict';

  var ROLES = ['clinic', 'reception', 'triage', 'nursing'];
  var ROLE_LABELS = {
    clinic: 'Clinic',
    reception: 'Reception',
    triage: 'Triage',
    nursing: 'Nursing',
  };
  var ROLE_LS = 'ms-companion-role';

  function normalizeRole(v) {
    var r = String(v == null ? '' : v).toLowerCase();
    return ROLES.indexOf(r) >= 0 ? r : 'clinic';
  }

  function dueVoiceForRole(role) {
    return normalizeRole(role) === 'reception' ? 'reception' : 'clinic';
  }

  // A page may *suggest* a role when the user has never chosen one.
  // Never yank a saved choice mid-clinic.
  function suggestedRole(kind, savedRole) {
    if (savedRole) return normalizeRole(savedRole);
    if (kind === 'queue') return 'triage';
    return 'clinic';
  }

  function readSavedRole(storage) {
    if (!storage || typeof storage.getItem !== 'function') return null;
    try {
      var raw = storage.getItem(ROLE_LS);
      if (!raw) return null;
      return normalizeRole(raw);
    } catch (_) {
      return null;
    }
  }

  function writeSavedRole(storage, role) {
    if (!storage || typeof storage.setItem !== 'function') return;
    try {
      storage.setItem(ROLE_LS, normalizeRole(role));
    } catch (_) {
      /* private mode / blocked storage */
    }
  }

  var TASK_RE =
    /\/([0-9a-f]{4,})\/tasks\/data\/([^/]+)\/overview\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
  var QUEUE_RE = /\/([0-9a-f]{4,})\/tasks\/data\/([^/]+)(?:\/task-list)?\/?$/i;
  var RECORD_RE = /\/([0-9a-f]{4,})\/(?:patient\/patient\/care-record|care-record)\/([0-9a-f-]{36})/i;

  /**
   * pageContext(pathname) → { kind, siteId, pageKey, ... } | null
   *
   * kind:
   *   'task'   — task overview (not document-filing)
   *   'record' — care-record (patient UUID in the URL)
   *   'queue'  — task-list / queue root (no overview UUID)
   * null      — leave the widget off (letters, unknown pages)
   */
  function pageContext(pathname) {
    var path = String(pathname || '');
    var task = TASK_RE.exec(path);
    if (task) {
      if (String(task[2]).toLowerCase() === 'document') return null;
      return {
        kind: 'task',
        siteId: task[1],
        typeSlug: task[2],
        taskUuid: task[3],
        pageKey: task[3],
      };
    }
    var rec = RECORD_RE.exec(path);
    if (rec) {
      return {
        kind: 'record',
        siteId: rec[1],
        patientId: rec[2],
        pageKey: 'record:' + rec[2],
      };
    }
    var queue = QUEUE_RE.exec(path);
    if (queue && path.indexOf('/overview/') === -1) {
      var slug = queue[2];
      if (String(slug).toLowerCase() === 'document') return null;
      return {
        kind: 'queue',
        siteId: queue[1],
        typeSlug: slug,
        pageKey: 'queue:' + slug,
      };
    }
    return null;
  }

  /**
   * Which Companion sections this role + page kind should show.
   * Writes (book / create-task) stay available only where we can pin a
   * patient identity (task overview or care-record URL).
   */
  function roleShows(role, kind) {
    role = normalizeRole(role);
    kind = kind || 'task';
    var hasPatient = kind === 'task' || kind === 'record';
    return {
      due: role !== 'triage' && hasPatient,
      desk: role === 'reception',
      slots: role === 'reception' || role === 'nursing',
      pulse: role === 'triage',
      book: (role === 'clinic' || role === 'reception' || role === 'nursing') && hasPatient,
      task: (role === 'clinic' || role === 'triage') && kind === 'task',
      record: role === 'clinic' && kind === 'task',
    };
  }

  // Same arrived-patients filter as shared/appointments-feed.js — copied
  // so the content-script widget does not load that classic-script singleton
  // (it depends on PracticeCode / ApiDiag, which the page does not have).
  function arrivedEntries(raw) {
    var schedule = raw && raw.schedule && raw.schedule.schedule;
    if (!Array.isArray(schedule)) return [];
    var out = [];
    for (var i = 0; i < schedule.length; i++) {
      var entries = (schedule[i] && schedule[i].entries) || [];
      for (var j = 0; j < entries.length; j++) {
        var e = entries[j];
        if (!e) continue;
        var type = e.diaryEntryType && e.diaryEntryType.value;
        var status = e.displayStatus && e.displayStatus.value;
        if (type === 'appointment' && status === 'arrived') out.push(e);
      }
    }
    return out;
  }

  function extractTaskArray(data) {
    if (!data) return [];
    if (Array.isArray(data.tasks)) return data.tasks;
    if (data.data && Array.isArray(data.data.tasks)) return data.data.tasks;
    if (Array.isArray(data)) return data;
    return [];
  }

  function deskFromPayloads(appointmentsRaw, medicalRaw, adminRaw) {
    var waiting = appointmentsRaw == null ? null : arrivedEntries(appointmentsRaw).length;
    var medical = medicalRaw == null ? null : extractTaskArray(medicalRaw).length;
    var admin = adminRaw == null ? null : extractTaskArray(adminRaw).length;
    return { waiting: waiting, medical: medical, admin: admin };
  }

  function nurseTypeMatch(label) {
    return /nurse|treatment room|phlebot|blood test|bloods|vaccin|imms|immunis|bp check|blood pressure/i.test(
      String(label || '')
    );
  }

  function slotTime(dt) {
    return dt ? String(dt).substring(11, 16) : '';
  }

  /**
   * Compact first-available lines from finder types + today's slots.
   * typesAndSlots: [{ label, slots: [{ startDateTime }] }]
   * role 'nursing' prefers nurse-ish types; reception takes the first two.
   */
  function slotsGlanceLines(typesAndSlots, role) {
    var list = Array.isArray(typesAndSlots) ? typesAndSlots : [];
    var wantNurse = normalizeRole(role) === 'nursing';
    var picked = wantNurse ? list.filter(function (t) { return nurseTypeMatch(t && t.label); }) : list;
    if (wantNurse && picked.length === 0) picked = list.slice(0, 1);
    picked = picked.slice(0, 2);
    return picked.map(function (t) {
      var label = String((t && t.label) || 'Appointment');
      if (!t || t.slots == null) {
        return { label: label, time: '', none: false, unknown: true };
      }
      var slots = t.slots || [];
      var first = slots[0];
      var time = first ? slotTime(first.startDateTime) : '';
      return {
        label: label,
        time: time,
        none: !time,
        unknown: false,
      };
    });
  }

  /**
   * Honest pulse from live queue DOM. Counts only what is on screen —
   * never invents a queue length. kind 'not_queue' when there is no grid.
   */
  function queuePulseFromDom(root) {
    if (!root || typeof root.querySelectorAll !== 'function') {
      return { kind: 'not_queue', count: 0, redFlags: 0, resultRed: 0, worst: [] };
    }
    var rows = root.querySelectorAll('.ag-center-cols-container .ag-row[row-index]');
    if (!rows.length) {
      return { kind: 'not_queue', count: 0, redFlags: 0, resultRed: 0, worst: [] };
    }
    var count = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r.classList && r.classList.contains('ag-row-level-1')) continue;
      if (r.getAttribute && r.getAttribute('aria-hidden') === 'true') continue;
      count++;
    }
    var flagNodes = root.querySelectorAll('.ch-queue-chips .ch-chip-red');
    var resultReds = root.querySelectorAll('.ch-q-result .ch-chip-red');
    var worst = [];
    for (var w = 0; w < resultReds.length && worst.length < 2; w++) {
      var text = (resultReds[w].textContent || '').replace(/\s+/g, ' ').trim();
      if (text) worst.push(text);
    }
    return {
      kind: 'queue',
      count: count,
      redFlags: flagNodes.length,
      resultRed: resultReds.length,
      worst: worst,
    };
  }

  var api = {
    ROLES: ROLES,
    ROLE_LABELS: ROLE_LABELS,
    ROLE_LS: ROLE_LS,
    normalizeRole: normalizeRole,
    dueVoiceForRole: dueVoiceForRole,
    suggestedRole: suggestedRole,
    readSavedRole: readSavedRole,
    writeSavedRole: writeSavedRole,
    pageContext: pageContext,
    roleShows: roleShows,
    arrivedEntries: arrivedEntries,
    extractTaskArray: extractTaskArray,
    deskFromPayloads: deskFromPayloads,
    nurseTypeMatch: nurseTypeMatch,
    slotsGlanceLines: slotsGlanceLines,
    queuePulseFromDom: queuePulseFromDom,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.MsCompanionRole = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : global);
