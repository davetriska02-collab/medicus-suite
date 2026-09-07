// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — allocation groups (named sets of people work is split onto).
//
// A group is staff UUIDs, not a Medicus team inbox. Split/top-up/level stay
// in the allocate cores; this file only validates, stores, and picks dests.
// Optional schedule controls which chips appear (Europe/London). Unscheduled
// groups always appear. No DOM, no chrome.*, no fetch.
//
// Dual-mode: module.exports for Node tests, window.AllocationGroupsCore
// in content scripts / options.

'use strict';

(function (global) {
  var TZ = 'Europe/London';
  var MAX_MEMBERS = 12;
  var MAX_NAME = 48;
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var HM_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
  var DAY_IDS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  var SURFACES = ['request', 'rx', 'lab'];
  var KIND_IN_TODAY = 'in-today';
  var KIND_GROUP = 'group';
  var KIND_CUSTOM = 'custom';

  function isUuid(v) {
    return UUID_RE.test(String(v || ''));
  }

  function clip(s, n) {
    var t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    if (t.length <= n) return t;
    return t.slice(0, n).trim();
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function parseHm(s) {
    var m = HM_RE.exec(String(s || '').trim());
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }

  function formatHm(mins) {
    if (!Number.isFinite(mins) || mins < 0 || mins >= 24 * 60) return '';
    return pad2(Math.floor(mins / 60)) + ':' + pad2(mins % 60);
  }

  function asDate(now) {
    if (now instanceof Date) return isNaN(now.getTime()) ? new Date() : now;
    if (now == null || now === '') return new Date();
    var d = new Date(now);
    return isNaN(d.getTime()) ? new Date() : d;
  }

  function londonClock(now) {
    var d = asDate(now);
    var parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(d);
    var map = {};
    parts.forEach(function (p) {
      map[p.type] = p.value;
    });
    var day = String(map.weekday || '')
      .toLowerCase()
      .slice(0, 3);
    if (DAY_IDS.indexOf(day) === -1) day = 'mon';
    var hour = parseInt(map.hour, 10);
    var minute = parseInt(map.minute, 10);
    if (!Number.isFinite(hour)) hour = 0;
    if (!Number.isFinite(minute)) minute = 0;
    return { day: day, minutes: hour * 60 + minute, date: d };
  }

  function generateGroupId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    var bytes = new Array(16);
    var i;
    for (i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    var hex = bytes
      .map(function (b) {
        return (b < 16 ? '0' : '') + b.toString(16);
      })
      .join('');
    return (
      hex.slice(0, 8) +
      '-' +
      hex.slice(8, 12) +
      '-' +
      hex.slice(12, 16) +
      '-' +
      hex.slice(16, 20) +
      '-' +
      hex.slice(20, 32)
    );
  }

  function scheduleErrors(raw) {
    if (raw == null) return [];
    if (typeof raw !== 'object' || Array.isArray(raw)) return ['schedule must be an object or null'];
    var days = Array.isArray(raw.days) ? raw.days : [];
    var cleaned = [];
    var seen = {};
    days.forEach(function (d) {
      var id = String(d || '')
        .toLowerCase()
        .slice(0, 3);
      if (DAY_IDS.indexOf(id) === -1) return;
      if (seen[id]) return;
      seen[id] = true;
      cleaned.push(id);
    });
    if (!cleaned.length) return ['schedule needs at least one weekday'];
    var start = parseHm(raw.start);
    var end = parseHm(raw.end);
    if (start == null) return ['schedule start must be HH:MM'];
    if (end == null) return ['schedule end must be HH:MM'];
    if (end <= start) return ['schedule end must be after start (no overnight windows)'];
    return [];
  }

  function normaliseSchedule(raw) {
    if (raw == null) return null;
    if (scheduleErrors(raw).length) return null;
    var days = [];
    var seen = {};
    (Array.isArray(raw.days) ? raw.days : []).forEach(function (d) {
      var id = String(d || '')
        .toLowerCase()
        .slice(0, 3);
      if (DAY_IDS.indexOf(id) === -1 || seen[id]) return;
      seen[id] = true;
      days.push(id);
    });
    days.sort(function (a, b) {
      return DAY_IDS.indexOf(a) - DAY_IDS.indexOf(b);
    });
    return {
      days: days,
      start: formatHm(parseHm(raw.start)),
      end: formatHm(parseHm(raw.end)),
    };
  }

  function memberList(raw) {
    var ids = [];
    var names = {};
    var seen = {};
    function push(id, name) {
      var uid = String(id || '').toLowerCase();
      if (!isUuid(uid) || seen[uid]) return;
      seen[uid] = true;
      ids.push(uid);
      var n = clip(name, 80);
      if (n) names[uid] = n;
    }
    if (raw && Array.isArray(raw.members)) {
      raw.members.forEach(function (m) {
        if (!m) return;
        if (typeof m === 'string') {
          push(m, '');
          return;
        }
        push(m.id || m.staffId, m.name || m.displayName);
      });
    }
    var fromIds = raw && Array.isArray(raw.memberIds) ? raw.memberIds : [];
    var nameMap = raw && raw.memberNames && typeof raw.memberNames === 'object' ? raw.memberNames : {};
    fromIds.forEach(function (id) {
      var uid = String(id || '').toLowerCase();
      push(uid, nameMap[id] || nameMap[uid] || '');
    });
    return { memberIds: ids, memberNames: names };
  }

  function presetErrors(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ['group must be an object'];
    var name = clip(raw.name, MAX_NAME);
    if (!name) return ['group needs a name'];
    var mem = memberList(raw);
    if (!mem.memberIds.length) return ['group needs at least one person'];
    if (mem.memberIds.length > MAX_MEMBERS) return ['a group can have at most ' + MAX_MEMBERS + ' people'];
    if (raw.id != null && raw.id !== '' && !isUuid(raw.id)) return ['group id must be a UUID'];
    if (raw.schedule != null) {
      var se = scheduleErrors(raw.schedule);
      if (se.length) return se;
    }
    return [];
  }

  function normalisePreset(raw) {
    if (presetErrors(raw).length) return null;
    var mem = memberList(raw);
    var id = isUuid(raw.id) ? String(raw.id).toLowerCase() : generateGroupId();
    var updatedAt = raw.updatedAt && !isNaN(new Date(raw.updatedAt).getTime()) ? new Date(raw.updatedAt).toISOString() : null;
    return {
      id: id,
      name: clip(raw.name, MAX_NAME),
      memberIds: mem.memberIds.slice(0, MAX_MEMBERS),
      memberNames: mem.memberNames,
      schedule: normaliseSchedule(raw.schedule),
      updatedAt: updatedAt,
    };
  }

  function normalisePresets(raw) {
    var out = [];
    var seen = {};
    (Array.isArray(raw) ? raw : []).forEach(function (item) {
      var p = normalisePreset(item);
      if (!p || seen[p.id]) return;
      seen[p.id] = true;
      out.push(p);
    });
    return out;
  }

  function groupIsVisible(preset, now) {
    var p = preset && preset.memberIds ? preset : normalisePreset(preset);
    if (!p) return false;
    if (!p.schedule) return true;
    var clock = londonClock(now);
    if (p.schedule.days.indexOf(clock.day) === -1) return false;
    var start = parseHm(p.schedule.start);
    var end = parseHm(p.schedule.end);
    if (start == null || end == null) return false;
    return clock.minutes >= start && clock.minutes < end;
  }

  function findPreset(presets, id) {
    var uid = String(id || '').toLowerCase();
    if (!isUuid(uid)) return null;
    var list = normalisePresets(presets);
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === uid) return list[i];
    }
    return null;
  }

  function isAwayState(state) {
    return state === 'away' || state === 'away-pending';
  }

  function presenceState(member, opts) {
    opts = opts || {};
    if (typeof opts.presenceFor === 'function') {
      var hit = opts.presenceFor(member) || {};
      return hit.state || '';
    }
    if (typeof opts.presenceForName === 'function') {
      var byName = opts.presenceForName(member.name) || {};
      return byName.state || '';
    }
    return '';
  }

  function membersForSplit(preset, opts) {
    opts = opts || {};
    var p = preset && Array.isArray(preset.memberIds) ? preset : normalisePreset(preset);
    if (!p) {
      return { dests: [], skipped: [], reason: 'No people in that group.' };
    }
    var dests = [];
    var skipped = [];
    p.memberIds.forEach(function (id) {
      var name = (p.memberNames && p.memberNames[id]) || 'Unknown';
      var member = { staffId: id, name: name };
      var state = presenceState(member, opts);
      if (isAwayState(state)) {
        skipped.push({ staffId: id, name: name, reason: 'away' });
        return;
      }
      dests.push(member);
    });
    if (!dests.length) {
      return {
        dests: [],
        skipped: skipped,
        reason: skipped.length
          ? 'Everyone in that group is away.'
          : 'No people in that group.',
      };
    }
    return { dests: dests, skipped: skipped };
  }

  function destsFromSet(set, opts) {
    opts = opts || {};
    var kind = set && set.kind ? String(set.kind) : '';
    if (kind === KIND_IN_TODAY) {
      var inToday = Array.isArray(opts.inToday) ? opts.inToday.slice() : [];
      var dests = [];
      inToday.forEach(function (p) {
        if (!p || !p.name) return;
        dests.push({
          staffId: isUuid(p.staffId) ? String(p.staffId).toLowerCase() : '',
          name: p.name,
          key: p.key || '',
        });
      });
      if (!dests.length) {
        return {
          dests: [],
          skipped: [],
          reason: opts.emptyInTodayReason || 'No doctors with a session on the appointment book to split onto.',
        };
      }
      return { dests: dests, skipped: [] };
    }
    if (kind === KIND_GROUP) {
      var preset = findPreset(opts.presets, set.id);
      if (!preset) return { dests: [], skipped: [], reason: 'Unknown group.' };
      return membersForSplit(preset, opts);
    }
    if (kind === KIND_CUSTOM) {
      var custom = normalisePreset({
        name: 'Custom',
        members: set.members || [],
        memberIds: set.memberIds,
        memberNames: set.memberNames,
      });
      if (!custom) return { dests: [], skipped: [], reason: 'Pick at least one person.' };
      return membersForSplit(custom, opts);
    }
    return { dests: [], skipped: [], reason: 'Pick who to share out to.' };
  }

  function skippedPhrase(skipped) {
    var names = [];
    (Array.isArray(skipped) ? skipped : []).forEach(function (s) {
      if (s && s.name) names.push(s.name);
    });
    if (!names.length) return '';
    if (names.length === 1) return names[0] + ' is away — skipped.';
    if (names.length === 2) return names[0] + ' and ' + names[1] + ' are away — skipped.';
    return names.slice(0, -1).join(', ') + ', and ' + names[names.length - 1] + ' are away — skipped.';
  }

  function visiblePresets(presets, now) {
    return normalisePresets(presets).filter(function (p) {
      return groupIsVisible(p, now);
    });
  }

  function defaultDestSet(presets, now, lastUsed) {
    var list = normalisePresets(presets);
    var visible = list.filter(function (p) {
      return groupIsVisible(p, now);
    });
    var scheduledIn = visible.filter(function (p) {
      return !!p.schedule;
    });
    function lastUsedGroup() {
      if (!lastUsed || lastUsed.kind !== KIND_GROUP || !lastUsed.id) return null;
      var uid = String(lastUsed.id).toLowerCase();
      for (var i = 0; i < visible.length; i++) {
        if (visible[i].id === uid) return { kind: KIND_GROUP, id: visible[i].id };
      }
      return null;
    }
    if (scheduledIn.length === 1) {
      return { kind: KIND_GROUP, id: scheduledIn[0].id };
    }
    if (scheduledIn.length > 1) {
      var among = lastUsedGroup();
      if (among) {
        for (var s = 0; s < scheduledIn.length; s++) {
          if (scheduledIn[s].id === among.id) return among;
        }
      }
      return { kind: KIND_IN_TODAY };
    }
    var visibleLast = lastUsedGroup();
    if (visibleLast) return visibleLast;
    return { kind: KIND_IN_TODAY };
  }

  function rememberLastUsed(config, surface, destSet) {
    var next = normaliseConfig(config);
    var surf = SURFACES.indexOf(surface) === -1 ? '' : surface;
    if (!surf) return next;
    if (!destSet || destSet.kind === KIND_CUSTOM) return next;
    if (destSet.kind === KIND_IN_TODAY) {
      next.lastUsedBySurface[surf] = { kind: KIND_IN_TODAY };
      return next;
    }
    if (destSet.kind === KIND_GROUP && isUuid(destSet.id)) {
      next.lastUsedBySurface[surf] = { kind: KIND_GROUP, id: String(destSet.id).toLowerCase() };
    }
    return next;
  }

  function normaliseConfig(raw) {
    var src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    var last = src.lastUsedBySurface && typeof src.lastUsedBySurface === 'object' ? src.lastUsedBySurface : {};
    var out = { lastUsedBySurface: {} };
    SURFACES.forEach(function (s) {
      var ref = last[s];
      if (ref && ref.kind === KIND_GROUP && isUuid(ref.id)) {
        out.lastUsedBySurface[s] = { kind: KIND_GROUP, id: String(ref.id).toLowerCase() };
      } else if (ref && ref.kind === KIND_IN_TODAY) {
        out.lastUsedBySurface[s] = { kind: KIND_IN_TODAY };
      }
    });
    return out;
  }

  function upsertPreset(list, raw) {
    var incoming = normalisePreset(
      Object.assign({}, raw || {}, {
        updatedAt: (raw && raw.updatedAt) || new Date().toISOString(),
      })
    );
    if (!incoming) return { ok: false, presets: normalisePresets(list), errors: presetErrors(raw) };
    var presets = normalisePresets(list);
    var hit = -1;
    for (var i = 0; i < presets.length; i++) {
      if (presets[i].id === incoming.id) {
        hit = i;
        break;
      }
    }
    if (hit === -1) presets.push(incoming);
    else presets[hit] = incoming;
    return { ok: true, presets: presets, preset: incoming };
  }

  function removePreset(list, id) {
    var uid = String(id || '').toLowerCase();
    var presets = normalisePresets(list).filter(function (p) {
      return p.id !== uid;
    });
    return { ok: true, presets: presets };
  }

  var api = {
    TZ: TZ,
    MAX_MEMBERS: MAX_MEMBERS,
    MAX_NAME: MAX_NAME,
    DAY_IDS: DAY_IDS,
    SURFACES: SURFACES,
    KIND_IN_TODAY: KIND_IN_TODAY,
    KIND_GROUP: KIND_GROUP,
    KIND_CUSTOM: KIND_CUSTOM,
    isUuid: isUuid,
    londonClock: londonClock,
    parseHm: parseHm,
    formatHm: formatHm,
    generateGroupId: generateGroupId,
    scheduleErrors: scheduleErrors,
    normaliseSchedule: normaliseSchedule,
    presetErrors: presetErrors,
    normalisePreset: normalisePreset,
    normalisePresets: normalisePresets,
    groupIsVisible: groupIsVisible,
    findPreset: findPreset,
    membersForSplit: membersForSplit,
    destsFromSet: destsFromSet,
    skippedPhrase: skippedPhrase,
    visiblePresets: visiblePresets,
    defaultDestSet: defaultDestSet,
    rememberLastUsed: rememberLastUsed,
    normaliseConfig: normaliseConfig,
    upsertPreset: upsertPreset,
    removePreset: removePreset,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) global.AllocationGroupsCore = api;
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
