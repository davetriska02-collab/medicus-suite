// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Shared — Companion HUD role + page-context helpers.
//
// The floating widget (content-scripts/task-actions-panel.js) is one box
// with four role views. This module is the testable core: which role is
// valid, which sections that role shows, how a Medicus URL maps to a page
// kind, and honest desk / pulse / slot-glance mapping. The widget owns
// fetch + DOM; this file never fetches and never touches chrome.*.
// Nursing What's due uses the nursing voice (treatment-room wording).
// Reception also sees this-patient future appointments (Already booked).
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
  var ALL_SCREENS_LS = 'ms-companion-all-screens';
  var DOCKED_LS = 'ms-companion-docked';
  var SIZE_LS = 'ms-companion-size';
  var ROLE_CAPTIONS = {
    clinic: 'GP due list for this patient',
    reception: 'What to book, plus the desk',
    triage: 'The medical queue, not this one task',
    nursing: 'Bloods, BP, jabs and nurse slots',
  };

  function normalizeRole(v) {
    var r = String(v == null ? '' : v).toLowerCase();
    return ROLES.indexOf(r) >= 0 ? r : 'clinic';
  }

  function dueVoiceForRole(role) {
    var r = normalizeRole(role);
    if (r === 'reception') return 'reception';
    if (r === 'nursing') return 'nursing';
    return 'clinic';
  }

  function roleCaption(role) {
    return ROLE_CAPTIONS[normalizeRole(role)] || ROLE_CAPTIONS.clinic;
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

  function readFlag(storage, key) {
    if (!storage || typeof storage.getItem !== 'function') return false;
    try {
      return storage.getItem(key) === '1';
    } catch (_) {
      return false;
    }
  }

  function writeFlag(storage, key, on) {
    if (!storage || typeof storage.setItem !== 'function') return;
    try {
      storage.setItem(key, on ? '1' : '0');
    } catch (_) {
      /* private mode / blocked storage */
    }
  }

  function readAllScreens(storage) {
    return readFlag(storage, ALL_SCREENS_LS);
  }

  function writeAllScreens(storage, on) {
    writeFlag(storage, ALL_SCREENS_LS, !!on);
  }

  function readDocked(storage) {
    return readFlag(storage, DOCKED_LS);
  }

  function writeDocked(storage, on) {
    writeFlag(storage, DOCKED_LS, !!on);
  }

  var MIN_WIDTH = 280;
  var MIN_HEIGHT = 160;
  var DEFAULT_WIDTH = 340;

  function clampSize(size, viewport) {
    var vp = viewport || {};
    var maxW = typeof vp.width === 'number' && vp.width > 0 ? vp.width - 16 : 720;
    var maxH = typeof vp.height === 'number' && vp.height > 0 ? vp.height - 16 : 720;
    var w = size && typeof size.width === 'number' ? size.width : DEFAULT_WIDTH;
    var h = size && typeof size.height === 'number' ? size.height : null;
    w = Math.max(MIN_WIDTH, Math.min(Math.round(w), maxW));
    if (h == null) return { width: w, height: null };
    h = Math.max(MIN_HEIGHT, Math.min(Math.round(h), maxH));
    return { width: w, height: h };
  }

  function readSavedSize(storage) {
    if (!storage || typeof storage.getItem !== 'function') return null;
    try {
      var raw = storage.getItem(SIZE_LS);
      if (!raw) return null;
      var p = JSON.parse(raw);
      if (!p || typeof p.width !== 'number') return null;
      return clampSize(p);
    } catch (_) {
      return null;
    }
  }

  function writeSavedSize(storage, size) {
    if (!storage || typeof storage.setItem !== 'function') return;
    try {
      var next = clampSize(size || {});
      storage.setItem(SIZE_LS, JSON.stringify(next));
    } catch (_) {
      /* private mode / blocked storage */
    }
  }

  // Only known patient-URL shapes — never a random UUID (appointment / task
  // ids also look like this). Same two patterns detectMedicusContext uses.
  function extractPatientUuidFromPath(pathname) {
    var path = String(pathname || '');
    var care = /\/care-record\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(path);
    if (care) return care[1];
    var pat = /\/patient\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(path);
    if (pat) return pat[1];
    return null;
  }

  function siteIdFromPath(pathname) {
    var m = /^\/([0-9a-f]{4,})(?:\/|$)/i.exec(String(pathname || ''));
    return m ? m[1] : null;
  }

  var TASK_RE =
    /\/([0-9a-f]{4,})\/tasks\/data\/([^/]+)\/overview\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
  var QUEUE_RE = /\/([0-9a-f]{4,})\/tasks\/data\/([^/]+)(?:\/task-list)?\/?$/i;
  var RECORD_RE = /\/([0-9a-f]{4,})\/(?:patient\/patient\/care-record|care-record)\/([0-9a-f-]{36})/i;

  /**
   * pageContext(pathname) → { kind, siteId, pageKey, ... } | null
   *
   * kind:
   *   'task'      — task overview (not document-filing)
   *   'record'    — care-record (patient UUID in the URL)
   *   'queue'     — task-list / queue root (no overview UUID)
   *   'elsewhere' — other patient-scoped page (opt-in all-screens only)
   *   'practice'  — other Medicus page with no patient pin (opt-in only)
   * null         — leave the widget off
   *
   * opts.allScreens — when true, unknown pages still return a context so
   * the Companion can sit on the diary / letters / homepage if the user
   * asked for that. Default off: those pages stay empty (don't annoy).
   */
  function pageContext(pathname, opts) {
    var path = String(pathname || '');
    var allScreens = !!(opts && opts.allScreens);
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
    if (!allScreens) return null;
    var siteId = siteIdFromPath(path);
    if (!siteId) return null;
    var patientId = extractPatientUuidFromPath(path);
    if (patientId) {
      return {
        kind: 'elsewhere',
        siteId: siteId,
        patientId: patientId,
        pageKey: 'elsewhere:' + patientId,
      };
    }
    return {
      kind: 'practice',
      siteId: siteId,
      pageKey: 'practice:' + path,
    };
  }

  /**
   * Which Companion sections this role + page kind should show.
   * Writes (book / create-task) stay available only where we can pin a
   * patient identity (task overview or care-record URL).
   */
  function roleShows(role, kind) {
    role = normalizeRole(role);
    kind = kind || 'task';
    var hasPatient = kind === 'task' || kind === 'record' || kind === 'elsewhere';
    return {
      due: role !== 'triage' && hasPatient,
      desk: role === 'reception',
      slots: role === 'reception' || role === 'nursing',
      pulse: role === 'triage',
      book: (role === 'clinic' || role === 'reception' || role === 'nursing') && hasPatient,
      task: (role === 'clinic' || role === 'triage') && kind === 'task',
      record: (role === 'clinic' || role === 'reception') && kind === 'task',
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

  /**
   * Hint for a Reception due line: which slot type to offer, never a
   * committed booking. Prefers a live type name from today's glance.
   */
  function suggestedBookHint(dueLabel, slotLines) {
    var text = String(dueLabel || '').toLowerCase();
    var lines = Array.isArray(slotLines) ? slotLines : [];
    function findType(re) {
      for (var i = 0; i < lines.length; i++) {
        var label = lines[i] && lines[i].label;
        if (label && re.test(String(label))) return String(label);
      }
      return '';
    }
    if (/blood|lithium|methotrexate|phlebot|azathioprine|leflunomide|sulfasalazine|mercaptopurine/.test(text)) {
      return findType(/blood|phlebot/i) || 'a bloods slot';
    }
    if (/blood pressure|bp check|\bbp\b/.test(text)) {
      return findType(/blood pressure|\bbp\b|treatment room|nurse/i) || 'a nurse or BP slot';
    }
    if (/diabetes/.test(text)) {
      return findType(/diabetes/i) || 'a diabetes or nurse review slot';
    }
    if (/asthma|copd/.test(text)) {
      return findType(/asthma|copd/i) || 'an asthma / COPD or nurse slot';
    }
    if (/vaccin|flu|imms|immunis|jab/.test(text)) {
      return findType(/vaccin|imms|flu|nurse/i) || 'a nurse or immunisation slot';
    }
    if (/book a |book an |review/.test(text)) {
      return findType(/nurse|review|clinic/i) || 'a review slot';
    }
    return '';
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
   * Kept for tests / fallback. The live glance uses slotsFromOverview
   * (the Slot Counter's embedded-overview scrape), not the first two
   * finder types.
   */
  function slotsGlanceLines(typesAndSlots, role) {
    var list = Array.isArray(typesAndSlots) ? typesAndSlots : [];
    var wantNurse = normalizeRole(role) === 'nursing';
    var picked = wantNurse ? list.filter(function (t) { return nurseTypeMatch(t && t.label); }) : list;
    if (wantNurse && picked.length === 0) picked = list.slice(0, 1);
    return picked.map(function (t) {
      var label = String((t && t.label) || 'Appointment');
      if (!t || t.slots == null) {
        return { label: label, time: '', none: false, unknown: true, count: 0 };
      }
      var slots = t.slots || [];
      var first = slots[0];
      var time = first ? slotTime(first.startDateTime) : '';
      return {
        label: label,
        time: time,
        none: !time,
        unknown: false,
        count: slots.length,
      };
    });
  }

  var MAX_SLOT_LINES = 10;

  /**
   * Remaining free slots from the appointment-book embedded-overview —
   * the same scrape Slot Counter uses (staffSchedules → session entries
   * with diaryEntryType.value === 'slot'). One payload, every type.
   *
   * opts: { todayISO, nowMs, role }
   */
  function slotsFromOverview(raw, opts) {
    opts = opts || {};
    var today = opts.todayISO || null;
    var nowMs = opts.nowMs != null ? opts.nowMs : Date.now();
    var role = normalizeRole(opts.role);
    var byType = {};
    var staffSchedules = (raw && raw.staffSchedules) || [];
    for (var i = 0; i < staffSchedules.length; i++) {
      var sessions = (staffSchedules[i] && staffSchedules[i].schedule) || [];
      for (var j = 0; j < sessions.length; j++) {
        var entries = (sessions[j] && sessions[j].entries) || [];
        for (var k = 0; k < entries.length; k++) {
          var entry = entries[k];
          if (!entry || !entry.diaryEntryType || entry.diaryEntryType.value !== 'slot') continue;
          if (today && entry.startDateTime) {
            var start = new Date(entry.startDateTime);
            if (!isNaN(start.getTime()) && start.getTime() < nowMs) continue;
          }
          var name = (entry.appointmentType && entry.appointmentType.name) || 'Unknown';
          if (!byType[name]) byType[name] = { label: name, count: 0, next: '' };
          byType[name].count += 1;
          var hm = slotTime(entry.startDateTime);
          if (hm && (!byType[name].next || hm < byType[name].next)) byType[name].next = hm;
        }
      }
    }
    var lines = Object.keys(byType).map(function (key) {
      return byType[key];
    });
    if (role === 'nursing') {
      var nurseOnly = lines.filter(function (l) {
        return nurseTypeMatch(l.label);
      });
      if (nurseOnly.length) lines = nurseOnly;
    }
    lines.sort(function (a, b) {
      if (b.count !== a.count) return b.count - a.count;
      return String(a.label).localeCompare(String(b.label));
    });
    var total = 0;
    for (var n = 0; n < lines.length; n++) total += lines[n].count;
    var hidden = lines.slice(MAX_SLOT_LINES);
    var moreSlots = 0;
    for (var h = 0; h < hidden.length; h++) moreSlots += hidden[h].count;
    function toLine(l) {
      return {
        label: l.label,
        time: l.next,
        count: l.count,
        none: l.count === 0,
        unknown: false,
      };
    }
    var allLines = lines.map(toLine);
    return {
      total: total,
      typeCount: lines.length,
      moreCount: hidden.length,
      moreSlots: moreSlots,
      lines: allLines.slice(0, MAX_SLOT_LINES),
      allLines: allLines,
    };
  }

  /**
   * Honest pulse from live queue DOM. Counts only what is on screen —
   * never invents a queue length. kind 'not_queue' when there is no grid.
   */
  function oldestMinutesFromText(text) {
    var m = String(text || '').match(/(\d+)\s*min/i);
    if (!m) return 0;
    var n = parseInt(m[1], 10);
    return n > 0 ? n : 0;
  }

  function queuePulseFromDom(root) {
    if (!root || typeof root.querySelectorAll !== 'function') {
      return { kind: 'not_queue', count: 0, redFlags: 0, resultRed: 0, worst: [], oldestMinutes: null };
    }
    var rows = root.querySelectorAll('.ag-center-cols-container .ag-row[row-index]');
    if (!rows.length) {
      return { kind: 'not_queue', count: 0, redFlags: 0, resultRed: 0, worst: [], oldestMinutes: null };
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
    var oldest = 0;
    for (var w = 0; w < resultReds.length && worst.length < 2; w++) {
      var text = (resultReds[w].textContent || '').replace(/\s+/g, ' ').trim();
      if (text) {
        worst.push(text);
        oldest = Math.max(oldest, oldestMinutesFromText(text));
      }
    }
    var ageNodes = root.querySelectorAll('.ch-queue-chips .ch-chip, .ch-chip-age');
    for (var a = 0; a < ageNodes.length; a++) {
      oldest = Math.max(oldest, oldestMinutesFromText(ageNodes[a].textContent));
    }
    return {
      kind: 'queue',
      count: count,
      redFlags: flagNodes.length,
      resultRed: resultReds.length,
      worst: worst,
      oldestMinutes: oldest > 0 ? oldest : null,
    };
  }

  var api = {
    ROLES: ROLES,
    ROLE_LABELS: ROLE_LABELS,
    ROLE_LS: ROLE_LS,
    ALL_SCREENS_LS: ALL_SCREENS_LS,
    DOCKED_LS: DOCKED_LS,
    SIZE_LS: SIZE_LS,
    MIN_WIDTH: MIN_WIDTH,
    MIN_HEIGHT: MIN_HEIGHT,
    DEFAULT_WIDTH: DEFAULT_WIDTH,
    ROLE_CAPTIONS: ROLE_CAPTIONS,
    normalizeRole: normalizeRole,
    dueVoiceForRole: dueVoiceForRole,
    roleCaption: roleCaption,
    suggestedBookHint: suggestedBookHint,
    suggestedRole: suggestedRole,
    readSavedRole: readSavedRole,
    writeSavedRole: writeSavedRole,
    readAllScreens: readAllScreens,
    writeAllScreens: writeAllScreens,
    readDocked: readDocked,
    writeDocked: writeDocked,
    clampSize: clampSize,
    readSavedSize: readSavedSize,
    writeSavedSize: writeSavedSize,
    extractPatientUuidFromPath: extractPatientUuidFromPath,
    siteIdFromPath: siteIdFromPath,
    pageContext: pageContext,
    roleShows: roleShows,
    arrivedEntries: arrivedEntries,
    extractTaskArray: extractTaskArray,
    deskFromPayloads: deskFromPayloads,
    nurseTypeMatch: nurseTypeMatch,
    slotsGlanceLines: slotsGlanceLines,
    slotsFromOverview: slotsFromOverview,
    MAX_SLOT_LINES: MAX_SLOT_LINES,
    queuePulseFromDom: queuePulseFromDom,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.MsCompanionRole = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : global);
