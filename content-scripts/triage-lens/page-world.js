// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Triage Lens page-world interceptors
//
// Runs in the PAGE'S MAIN WORLD (declared with "world":"MAIN" in manifest.json,
// run_at document_start). This is the ONLY reliable way to wrap window.fetch /
// XMLHttpRequest on Medicus: the site ships a strict Content-Security-Policy
// (script-src 'self', no 'unsafe-inline'), which BLOCKS the old approach of
// injecting an inline <script> element from the isolated content script. A
// manifest-declared MAIN-world content script is injected by the browser itself
// and is exempt from the page CSP.
//
// It wraps fetch + XHR to observe the queue task-list response and re-broadcasts
// the bits the isolated content script needs as a window CustomEvent (which
// crosses the world boundary for JSON-serialisable detail):
//   • /tasks/data/{slug}/task-list      → 'ch-task-list-data'   (queue monitoring)
//   • Pusher presence-{site}-task-{uuid} → 'ch-native-task-presence' (occupied masthead)
//   • Pusher presence-{site}-task-list-{slug} → 'ch-native-list-presence' (list occupancy)
//
// It also notes WHICH PATIENT the page's embedded Clinical Summary panel was
// last fetched for (2026-08-03): any request to
// /clinical/data/clinical-summary/summary/{patientId} stamps that patientId
// onto a documentElement attribute ('data-ch-summary-patient'). The DOM is
// shared between worlds, so late-loading isolated-world scripts can read it
// without event-timing races. This is what lets the record-tidy widgets
// (problem-bulk-end / problem-nesting / allergy-cleanup) work on ANY page
// that renders the Clinical Summary panel — appointment views, consultation
// views, and page shapes Medicus adds later — not just the URL shapes they
// can parse a patientId out of. Only the URL is read (the patientId is IN
// the path); the response body is never touched for this.
//
// It reads responses only; it never blocks, rewrites, or sends anything. No
// patient data leaves the browser.

(function () {
  'use strict';

  // Pure emit/de-dupe helper. Never pre-assign lastPresenceSig to the would-be
  // next sig before calling this — that was how the empty wipe event vanished
  // (sig compared equal to itself and the previous request's names stuck).
  // Idle sentinel: after leaving an overview, sig becomes 'idle' so the 2s
  // poll emits exactly one empty event, not an empty event forever.
  function presenceEmitDecision(prevSig, taskUuid, members, live, selfExtras, selfId) {
    var prev = typeof prevSig === 'string' ? prevSig : '';
    var list = Array.isArray(members) ? members : [];
    var ids = [];
    for (var i = 0; i < list.length; i++) {
      var id = list[i] && typeof list[i].id === 'string' ? list[i].id.toLowerCase() : '';
      if (id) ids.push(id);
    }
    ids.sort();
    var liveBit = live === false ? '0' : '1';
    var extras = typeof selfExtras === 'number' && isFinite(selfExtras) && selfExtras >= 1 ? Math.floor(selfExtras) : 0;
    var sid = typeof selfId === 'string' ? selfId.toLowerCase() : '';
    if (sid && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(sid)) sid = '';
    if (!taskUuid) {
      return { sig: 'idle', emit: prev !== '' && prev !== 'idle' };
    }
    var sig = String(taskUuid).toLowerCase() + ':' + ids.join(',') + ':' + liveBit;
    if (extras >= 1) sig += ':x' + extras;
    if (sid) sig += ':s' + sid;
    return { sig: sig, emit: sig !== prev };
  }

  // Cheap dual-tab detector: extra copies of the same staff UUID in the
  // presence member list, or members.count greater than unique ids, with
  // self among them. Pusher-js hashes members by user_id, so two tabs of
  // the same UUID typically collapse to one entry and this returns 0.
  function presenceSelfExtras(rawIds, declaredCount, selfId) {
    if (typeof selfId !== 'string' || !selfId) return 0;
    var me = selfId.toLowerCase();
    var unique = {};
    var seenMe = 0;
    var list = Array.isArray(rawIds) ? rawIds : [];
    for (var i = 0; i < list.length; i++) {
      var id = typeof list[i] === 'string' ? list[i].toLowerCase() : '';
      if (!id) continue;
      if (!unique[id]) unique[id] = 1;
      else unique[id]++;
      if (id === me) seenMe++;
    }
    var uniqueN = 0;
    for (var k in unique) {
      if (Object.prototype.hasOwnProperty.call(unique, k)) uniqueN++;
    }
    if (!unique[me]) return 0;
    var extrasFromDupes = seenMe > 1 ? seenMe - 1 : 0;
    var declared = typeof declaredCount === 'number' && isFinite(declaredCount) ? declaredCount : uniqueN;
    var extrasFromCount = declared > uniqueN ? declared - uniqueN : 0;
    var n = extrasFromDupes > extrasFromCount ? extrasFromDupes : extrasFromCount;
    return n > 0 ? n : 0;
  }

  // List occupancy channel. Slug is not a UUID — must not match
  // presence-{site}-task-{uuid}. Empty slug (trailing hyphen only) is rejected
  // because (.+) needs at least one character.
  var PRESENCE_LIST_CH_RE = /^presence-([0-9a-z]{2,})-task-list-(.+)$/i;

  function currentTaskListSlug(pathname) {
    var path = pathname;
    if (path == null && typeof location !== 'undefined') {
      try {
        path = location.pathname;
      } catch (_) {
        path = '';
      }
    }
    var m = String(path || '').match(/\/tasks\/(?:data\/)?([^/]+)\/task-list\/?$/i);
    return m && m[1] ? m[1] : '';
  }

  // Node tests require this file for the helper only. MAIN-world behaviour is
  // unchanged: chrome content scripts have no `module`, so we fall through.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      presenceEmitDecision: presenceEmitDecision,
      presenceSelfExtras: presenceSelfExtras,
      currentTaskListSlug: currentTaskListSlug,
      PRESENCE_LIST_CH_RE: PRESENCE_LIST_CH_RE,
    };
    return;
  }

  if (window.__chPageWorld) return;
  window.__chPageWorld = true;
  if (window.__chPresenceTestHook) window.__chPresenceDecision = presenceEmitDecision;

  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var TL_RE = new RegExp('/tasks/data/([^/?]+)/task-list');
  var SUMMARY_RE =
    /\/clinical\/data\/clinical-summary\/summary\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

  // ---- Clinical Summary patient note (see header) ----
  // Stamped at request time — the patientId comes from the page's own routing
  // of its summary panel, so the URL alone is authoritative for "which patient
  // is the panel showing". Timestamp included so consumers CAN apply a
  // staleness policy; the attribute always holds the most recent value.
  function noteSummaryPatient(u) {
    var m = String(u || '').match(SUMMARY_RE);
    if (!m) return;
    try {
      document.documentElement.setAttribute('data-ch-summary-patient', m[1].toLowerCase() + '|' + Date.now());
    } catch (_) {}
  }

  // ---- Queue task-list ----
  function pickUuid(item) {
    if (!item || typeof item !== 'object') return null;
    var pref = ['taskUuid', 'taskId', 'uuid', 'id'];
    for (var i = 0; i < pref.length; i++) {
      var v = item[pref[i]];
      if (typeof v === 'string' && UUID_RE.test(v)) return v;
    }
    for (var k in item) {
      if (/patient/i.test(k)) continue;
      var val = item[k];
      if (typeof val === 'string' && UUID_RE.test(val) && /task|id|uuid/i.test(k)) return val;
    }
    return null;
  }

  function handleTaskList(u, body) {
    var m = u.match(TL_RE);
    if (!m) return;
    var items = body && (body.tasks || body.data || body.results || body.rows || (Array.isArray(body) ? body : null));
    if (!Array.isArray(items)) {
      console.warn('[ClinHUD] task-list: no array found; body keys=', body ? Object.keys(body) : body);
      return;
    }
    if (items.length && !window.__chTaskKeysLogged) {
      window.__chTaskKeysLogged = 1;
      console.debug('[ClinHUD] task-list first item keys:', Object.keys(items[0]));
    }
    var rows = items
      .map(function (item, i) {
        var row = { rowIndex: i, taskUuid: pickUuid(item) };
        if (item && typeof item === 'object') {
          row.overviewURL = typeof item.overviewURL === 'string' ? item.overviewURL : '';
          row.priorityDisplay = typeof item.priorityDisplay === 'string' ? item.priorityDisplay : '';
          row.unmatched = !!item.unmatchedToPatient;
          // Who last touched this task, straight off the wire (2026-08-04
          // capture, docs/learnings-task-presence.md): the queue payload
          // carries actionedBy/actionedDateTime but Medicus's own columnDefs
          // never display them. task-presence.js renders them as a queue
          // chip. Staff name + timestamp only — no patient fields are added.
          row.actionedBy = typeof item.actionedBy === 'string' ? item.actionedBy.slice(0, 80) : '';
          row.actionedDateTime = typeof item.actionedDateTime === 'string' ? item.actionedDateTime.slice(0, 40) : '';
        }
        return row;
      })
      .filter(function (r) {
        return r.taskUuid;
      });
    if (rows.length) {
      window.dispatchEvent(new CustomEvent('ch-task-list-data', { detail: { rows: rows, taskTypeSlug: m[1] } }));
    } else {
      console.warn('[ClinHUD] task-list: no task UUIDs from ' + items.length + ' items; sample=', items[0]);
    }
  }

  // ---- fetch wrap ----
  var origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (url) {
      var p = origFetch.apply(this, arguments);
      try {
        var u = typeof url === 'string' ? url : (url && url.url) || '';
        noteSummaryPatient(u);
        if (TL_RE.test(u)) {
          p.then(function (r) {
            try {
              r.clone()
                .json()
                .then(function (b) {
                  handleTaskList(u, b);
                })
                .catch(function (e) {
                  console.warn('[ClinHUD] task-list parse error', e);
                });
            } catch (_) {}
          });
        }
      } catch (_) {}
      return p;
    };
  }

  // ---- XHR wrap (Axios — this is what Medicus actually uses) ----
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      this.__chUrl = url;
    } catch (_) {}
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    try {
      var xhr = this;
      var u = xhr.__chUrl || '';
      noteSummaryPatient(u);
      if (TL_RE.test(u)) {
        xhr.addEventListener('load', function () {
          try {
            handleTaskList(u, JSON.parse(xhr.responseText));
          } catch (e) {
            console.warn('[ClinHUD] interceptor parse error', e);
          }
        });
      }
    } catch (_) {}
    return origSend.apply(this, arguments);
  };

  // ---- Logged-in staff identity note (2026-08-04) ----
  // The isolated world has no way to learn WHO is using Medicus, but the
  // page's own Pusher subscriptions name the logged-in user twice over
  // (docs/learnings-task-presence.md):
  //   {site}-staff-task-counters-{staffUuid}   → the staff member's UUID
  //   update-tenants-{email}                   → their login email
  // Stamp both onto a documentElement attribute ('data-ch-staff', value
  // 'staffUuid|email') the same way the summary-patient note works, so
  // task-presence.js can attribute its advisory presence beacons. This reads
  // channel NAMES only — no messages, no patient data. Re-checked on the
  // same 2s poll as native presence so a user-switch mid-page re-stamps.
  var STAFF_CH_RE =
    /^[0-9a-z]{2,}-staff-task-counters-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
  var TENANT_CH_RE = /^update-tenants-(.+)$/;

  function readPusher() {
    try {
      var app = document.querySelector('#app') || document.querySelector('[data-v-app]');
      var gp = app && app.__vue_app__ && app.__vue_app__.config && app.__vue_app__.config.globalProperties;
      return (gp && gp.$pusher) || null;
    } catch (_) {
      return null;
    }
  }

  function stampStaffIdentity(pusher) {
    try {
      var map = pusher && pusher.channels && pusher.channels.channels;
      if (!map) return;
      var staffId = '';
      var email = '';
      for (var name in map) {
        if (!Object.prototype.hasOwnProperty.call(map, name)) continue;
        var sm = name.match(STAFF_CH_RE);
        if (sm) staffId = sm[1].toLowerCase();
        var tm = name.match(TENANT_CH_RE);
        if (tm) email = tm[1].slice(0, 120);
      }
      if (!staffId) return;
      var value = staffId + '|' + email;
      if (document.documentElement.getAttribute('data-ch-staff') !== value) {
        document.documentElement.setAttribute('data-ch-staff', value);
      }
    } catch (_) {}
  }

  setTimeout(function () {
    stampStaffIdentity(readPusher());
  }, 2000);

  // ---- Native Pusher task presence (2026-09-07) ----
  // Medicus now subscribes to presence-{site}-task-{taskUuid} while a request
  // is open (live capture: presence-560b6c-task-{uuid}, member ids = staff
  // UUIDs, stock pusher:member_added / member_removed). Forward the current
  // task's member list to the isolated world as 'ch-native-task-presence'.
  // On a task-list page it also reads presence-{site}-task-list-{slug} and
  // emits 'ch-native-list-presence' — list occupancy, never a per-request
  // occupant. Channel names + member ids + staff-shaped info keys only —
  // drop anything that looks like a patient identifier. No writes; we never
  // subscribe ourselves (Pusher presence auth is Medicus's).
  var PRESENCE_TASK_CH_RE =
    /^presence-([0-9a-z]{2,})-task-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
  var lastPresenceSig = '';
  var boundPresenceCh = '';
  var boundPresenceRef = null; // { ch, onChange, onSucceeded, onError }
  var boundPresenceNames = new Set();
  var presenceSubErrored = false;
  var lastListPresenceSig = '';
  var boundListPresenceCh = '';
  var boundListPresenceRef = null;
  var boundListPresenceNames = new Set();
  var listPresenceSubErrored = false;

  function currentOverviewTaskUuid() {
    var m = String(location.pathname || '').match(
      /\/tasks\/(?:data\/)?[^/]+\/overview\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
    );
    return m ? m[1].toLowerCase() : '';
  }

  function staffShapedInfo(info) {
    if (!info || typeof info !== 'object') return {};
    var out = {};
    try {
      var keys = Object.keys(info);
      for (var i = 0; i < keys.length && i < 30; i++) {
        var k = keys[i];
        if (/patient|nhs|dob|dateofbirth|address|postcode|phone|mobile/i.test(k)) continue;
        var v = info[k];
        if (typeof v === 'string') out[k] = v.slice(0, 120);
        else if (typeof v === 'number' && isFinite(v)) out[k] = v;
        else if (typeof v === 'boolean') out[k] = v;
      }
    } catch (_) {}
    return out;
  }

  function emitNativePresence(taskUuid, members, live, selfExtras, selfId) {
    var list = Array.isArray(members) ? members : [];
    var extras = typeof selfExtras === 'number' && isFinite(selfExtras) && selfExtras >= 1 ? Math.floor(selfExtras) : 0;
    var sid = typeof selfId === 'string' && UUID_RE.test(selfId) ? selfId.toLowerCase() : '';
    var d = presenceEmitDecision(lastPresenceSig, taskUuid, list, live, extras, sid);
    if (!d.emit) return;
    lastPresenceSig = d.sig;
    var detail = { taskUuid: taskUuid || '', members: list };
    if (live === false) detail.live = false;
    if (extras >= 1) detail.selfExtras = extras;
    if (sid) detail.selfId = sid;
    try {
      window.dispatchEvent(new CustomEvent('ch-native-task-presence', { detail: detail }));
    } catch (_) {}
  }

  function emitNativeListPresence(slug, members, live, selfId) {
    var list = Array.isArray(members) ? members : [];
    var prev = lastListPresenceSig;
    var sid = typeof selfId === 'string' && UUID_RE.test(selfId) ? selfId.toLowerCase() : '';
    var d = presenceEmitDecision(lastListPresenceSig, slug, list, live, 0, sid);
    if (!d.emit) return;
    lastListPresenceSig = d.sig;
    var detailSlug = slug || '';
    if (!detailSlug && d.sig === 'idle' && prev && prev !== 'idle') {
      var colon = prev.indexOf(':');
      detailSlug = colon >= 0 ? prev.slice(0, colon) : prev;
    }
    var detail = { slug: detailSlug, members: list };
    if (live === false) detail.live = false;
    if (sid) detail.selfId = sid;
    try {
      window.dispatchEvent(new CustomEvent('ch-native-list-presence', { detail: detail }));
    } catch (_) {}
  }

  function collectPresenceMembers(ch) {
    var members = [];
    var seen = {};
    var rawIds = [];
    function add(id, info) {
      if (typeof id !== 'string' || !UUID_RE.test(id)) return;
      var sid = id.toLowerCase();
      rawIds.push(sid);
      if (seen[sid]) return;
      seen[sid] = 1;
      members.push({ id: sid, info: staffShapedInfo(info) });
    }
    if (!ch || !ch.members) return { members: members, selfExtras: 0 };
    var usedHash = false;
    try {
      var hash = ch.members.members;
      if (hash && typeof hash === 'object') {
        usedHash = true;
        Object.keys(hash).forEach(function (id) {
          var m = hash[id];
          if (m && typeof m === 'object') add(m.id || id, m.info || m);
          else add(id, {});
        });
      }
    } catch (_) {}
    if (!usedHash) {
      try {
        if (typeof ch.members.each === 'function') {
          ch.members.each(function (m) {
            if (m) add(m.id, m.info);
          });
        }
      } catch (_) {}
    }
    var declared = 0;
    try {
      if (typeof ch.members.count === 'number' && isFinite(ch.members.count)) declared = ch.members.count;
    } catch (_) {}
    var selfId = '';
    try {
      if (typeof ch.members.myID === 'string' && UUID_RE.test(ch.members.myID)) selfId = ch.members.myID;
    } catch (_) {}
    if (!selfId) {
      try {
        var attr = document.documentElement.getAttribute('data-ch-staff') || '';
        var bar = attr.indexOf('|');
        var idp = (bar >= 0 ? attr.slice(0, bar) : attr).trim();
        if (UUID_RE.test(idp)) selfId = idp;
      } catch (_) {}
    }
    return {
      members: members,
      selfExtras: presenceSelfExtras(rawIds, declared, selfId),
      selfId: selfId ? String(selfId).toLowerCase() : '',
    };
  }

  function unbindPresenceChannel() {
    if (boundPresenceRef) {
      var ch = boundPresenceRef.ch;
      try {
        if (ch && typeof ch.unbind === 'function') {
          ch.unbind('pusher:member_added', boundPresenceRef.onChange);
          ch.unbind('pusher:member_removed', boundPresenceRef.onChange);
          ch.unbind('pusher:subscription_succeeded', boundPresenceRef.onSucceeded);
          ch.unbind('pusher:subscription_error', boundPresenceRef.onError);
        }
      } catch (_) {}
      boundPresenceRef = null;
    }
    if (boundPresenceCh) {
      try {
        boundPresenceNames.delete(boundPresenceCh);
      } catch (_) {}
    }
    boundPresenceCh = '';
    presenceSubErrored = false;
  }

  function bindPresenceChannel(name, ch) {
    if (boundPresenceCh === name && boundPresenceRef) return;
    unbindPresenceChannel();
    boundPresenceCh = name;
    boundPresenceNames.add(name);
    presenceSubErrored = false;
    try {
      var boundName = name;
      var onChange = function () {
        var liveUuid = currentOverviewTaskUuid();
        var liveMatch = boundName.match(PRESENCE_TASK_CH_RE);
        if (!liveUuid || !liveMatch || liveMatch[2].toLowerCase() !== liveUuid) return;
        var pusherNow = readPusher();
        var connected = pusherNow && pusherNow.connection && pusherNow.connection.state === 'connected';
        if (!connected || presenceSubErrored) {
          emitNativePresence(liveUuid, [], false);
          return;
        }
        var got = collectPresenceMembers(ch);
        emitNativePresence(liveUuid, got.members, true, got.selfExtras, got.selfId);
      };
      var onSucceeded = function () {
        presenceSubErrored = false;
        onChange();
      };
      var onError = function () {
        presenceSubErrored = true;
        var liveUuid = currentOverviewTaskUuid();
        if (liveUuid) emitNativePresence(liveUuid, [], false);
      };
      ch.bind('pusher:member_added', onChange);
      ch.bind('pusher:member_removed', onChange);
      ch.bind('pusher:subscription_succeeded', onSucceeded);
      ch.bind('pusher:subscription_error', onError);
      boundPresenceRef = { ch: ch, onChange: onChange, onSucceeded: onSucceeded, onError: onError };
    } catch (_) {}
  }

  function unbindListPresenceChannel() {
    if (boundListPresenceRef) {
      var ch = boundListPresenceRef.ch;
      try {
        if (ch && typeof ch.unbind === 'function') {
          ch.unbind('pusher:member_added', boundListPresenceRef.onChange);
          ch.unbind('pusher:member_removed', boundListPresenceRef.onChange);
          ch.unbind('pusher:subscription_succeeded', boundListPresenceRef.onSucceeded);
          ch.unbind('pusher:subscription_error', boundListPresenceRef.onError);
        }
      } catch (_) {}
      boundListPresenceRef = null;
    }
    if (boundListPresenceCh) {
      try {
        boundListPresenceNames.delete(boundListPresenceCh);
      } catch (_) {}
    }
    boundListPresenceCh = '';
    listPresenceSubErrored = false;
  }

  function bindListPresenceChannel(name, ch) {
    if (boundListPresenceCh === name && boundListPresenceRef) return;
    unbindListPresenceChannel();
    boundListPresenceCh = name;
    boundListPresenceNames.add(name);
    listPresenceSubErrored = false;
    try {
      var boundName = name;
      var onChange = function () {
        var liveSlug = currentTaskListSlug();
        var liveMatch = boundName.match(PRESENCE_LIST_CH_RE);
        if (!liveSlug || !liveMatch || String(liveMatch[2]).toLowerCase() !== liveSlug.toLowerCase()) return;
        var pusherNow = readPusher();
        var connected = pusherNow && pusherNow.connection && pusherNow.connection.state === 'connected';
        if (!connected || listPresenceSubErrored) {
          emitNativeListPresence(liveSlug, [], false);
          return;
        }
        var got = collectPresenceMembers(ch);
        emitNativeListPresence(liveSlug, got.members, true, got.selfId);
      };
      var onSucceeded = function () {
        listPresenceSubErrored = false;
        onChange();
      };
      var onError = function () {
        listPresenceSubErrored = true;
        var liveSlug = currentTaskListSlug();
        if (liveSlug) emitNativeListPresence(liveSlug, [], false);
      };
      ch.bind('pusher:member_added', onChange);
      ch.bind('pusher:member_removed', onChange);
      ch.bind('pusher:subscription_succeeded', onSucceeded);
      ch.bind('pusher:subscription_error', onError);
      boundListPresenceRef = { ch: ch, onChange: onChange, onSucceeded: onSucceeded, onError: onError };
    } catch (_) {}
  }

  function socketIsLive(pusher) {
    return !!(pusher && pusher.connection && pusher.connection.state === 'connected' && !presenceSubErrored);
  }

  function listSocketIsLive(pusher) {
    return !!(pusher && pusher.connection && pusher.connection.state === 'connected' && !listPresenceSubErrored);
  }

  function pollTaskPresence(taskUuid, pusher) {
    if (!taskUuid) {
      unbindPresenceChannel();
      emitNativePresence('', []);
      return;
    }

    // Switching request: wipe immediately so the previous occupant cannot
    // paint on this overview while the new channel is still attaching.
    // Do NOT pre-assign lastPresenceSig — emitNativePresence / presenceEmitDecision
    // own the compare.
    if (lastPresenceSig && lastPresenceSig !== 'idle' && lastPresenceSig.indexOf(taskUuid + ':') !== 0) {
      emitNativePresence(taskUuid, []);
    }

    try {
      if (!socketIsLive(pusher)) {
        emitNativePresence(taskUuid, [], false);
        return;
      }
      var map = pusher && pusher.channels && pusher.channels.channels;
      if (map) {
        var found = false;
        for (var name in map) {
          if (!Object.prototype.hasOwnProperty.call(map, name)) continue;
          var pm = name.match(PRESENCE_TASK_CH_RE);
          if (!pm) continue;
          if (pm[2].toLowerCase() !== taskUuid) continue;
          found = true;
          bindPresenceChannel(name, map[name]);
          if (presenceSubErrored) emitNativePresence(taskUuid, [], false);
          else {
            var pollGot = collectPresenceMembers(map[name]);
            emitNativePresence(taskUuid, pollGot.members, true, pollGot.selfExtras, pollGot.selfId);
          }
          break;
        }
        if (!found) {
          unbindPresenceChannel();
          emitNativePresence(taskUuid, []);
        }
      }
    } catch (_) {}
  }

  function pollListPresence(slug, pusher) {
    if (!slug) {
      unbindListPresenceChannel();
      emitNativeListPresence('', []);
      return;
    }
    var slugKey = String(slug).toLowerCase();
    if (lastListPresenceSig && lastListPresenceSig !== 'idle' && lastListPresenceSig.indexOf(slugKey + ':') !== 0) {
      emitNativeListPresence(slug, []);
    }
    try {
      if (!listSocketIsLive(pusher)) {
        emitNativeListPresence(slug, [], false);
        return;
      }
      var map = pusher && pusher.channels && pusher.channels.channels;
      if (map) {
        var found = false;
        for (var name in map) {
          if (!Object.prototype.hasOwnProperty.call(map, name)) continue;
          var pm = name.match(PRESENCE_LIST_CH_RE);
          if (!pm) continue;
          if (String(pm[2]).toLowerCase() !== slugKey) continue;
          found = true;
          bindListPresenceChannel(name, map[name]);
          if (listPresenceSubErrored) emitNativeListPresence(slug, [], false);
          else {
            var pollGot = collectPresenceMembers(map[name]);
            emitNativeListPresence(slug, pollGot.members, true, pollGot.selfId);
          }
          break;
        }
        if (!found) {
          unbindListPresenceChannel();
          emitNativeListPresence(slug, []);
        }
      }
    } catch (_) {}
  }

  function pollNativePresence() {
    var taskUuid = currentOverviewTaskUuid();
    var listSlug = currentTaskListSlug();
    var pusher = readPusher();
    stampStaffIdentity(pusher);
    pollTaskPresence(taskUuid, pusher);
    pollListPresence(listSlug, pusher);
    setTimeout(pollNativePresence, 2000);
  }
  setTimeout(pollNativePresence, 2500);

  console.debug('[ClinHUD] page-world interceptors installed (MAIN world)');
})();
