// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — task presence: "is someone already on this request?"
//
// PURPOSE (user request 2026-08-04; native hook found 2026-09-07): two
// clinicians can open the same triage request without either knowing the
// other is in it. August 2026 capture found no Medicus signal. September
// 2026: Medicus now subscribes to presence-{site}-task-{taskUuid} (member
// id = staff UUID; stock pusher:member_added / member_removed). Layer 0
// reads that channel via page-world.js and paints an occupied masthead on
// the open request — no shared store required. Layers 1–2 below remain for
// queue chips / practices still on the folder/Supabase transport.
//
//   LAYER 1 — "last actioned" queue chip (zero infrastructure). The queue
//   task-list payload already carries actionedBy / actionedDateTime on every
//   row; Medicus's own columnDefs just never display them. page-world.js now
//   forwards both over the existing 'ch-task-list-data' bridge and this
//   script renders them as a chip on the queue row. Read-only, wire data
//   Medicus already sent to this browser.
//
//   LAYER 2 — live "opened by" presence (needs the shared store). While a
//   clinician has a task overview open AND VISIBLE, heartbeat an advisory
//   presence row (site, taskUuid, staffId, display label, timestamps) to a
//   practice-configured Supabase table. Consumers:
//     • queue rows get a "👁 <name>" chip while a colleague's presence is fresh
//     • opening a task someone else has open can still paint the occupied
//       strip from store rows when native Pusher membership is empty
//   Presence store is DORMANT until the practice configures a store URL + key
//   in Options → Task presence. Identity comes from the page's own Pusher
//   channel names (staff UUID + login email, stamped by page-world.js as
//   'data-ch-staff') — never guessed, never typed per-machine.
//
// WHAT LEAVES THE BROWSER (layer 2 only, and only when configured): the
// opaque task UUID, the site code, the staff UUID, a staff display label and
// two timestamps. No patient identifier of any kind — a task UUID is
// meaningless without an authenticated Medicus session. Layer 1 sends nothing
// anywhere.
//
// SAFETY POSTURE — advisory, never a lock:
//   - The strip says to check with them or carry on. It never claims
//     exclusivity, never blocks Medicus's own UI, and never asks the second
//     clinician to leave — the two-GPs-collide failure is wasted duplicate
//     work, and the fix is awareness, not enforcement.
//   - ABSENCE of a chip/banner is NEVER evidence nobody is on the request
//     (store unconfigured, offline, colleague without the Suite). The Options
//     card and setup doc both say so. Nothing here suppresses or reorders any
//     other signal.
//   - Heartbeats stop when the tab is hidden and rows go stale after
//     PRESENCE_TTL_MS, so a request left open over lunch stops claiming its
//     owner (a stale "someone's on it" would DELAY care — worse than the
//     collision it prevents).
//   - Store failures are silent-to-the-clinician (debug-logged): a broken
//     advisory layer must not add noise to a clinical queue.

(function () {
  'use strict';

  var DEBUG = false;
  try {
    DEBUG = localStorage.getItem('ch-debug') === '1';
  } catch (_) {}
  function log() {
    if (!DEBUG) return;
    try {
      console.log.apply(console, ['[MSTP]'].concat([].slice.call(arguments)));
    } catch (_) {}
  }

  var HEARTBEAT_MS = 25000; // beacon cadence while a task is open + visible
  var PRESENCE_TTL_MS = 90000; // a row older than this is stale everywhere
  var QUEUE_POLL_MS = 20000; // how often the queue re-reads presence
  var MAX_QUERY_UUIDS = 100; // cap the in.() list on queue presence reads
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // ── pure helpers (exported for tests) ─────────────────────────────────────

  // Validate one bridged task-list row (UNTRUSTED — the event crosses the
  // MAIN/isolated world boundary, so a compromised page could forge it).
  // Mirrors content.js's bridge validation: int rowIndex, UUID taskUuid,
  // strings length-capped. Returns a clean copy or null.
  function sanitizeBridgeRow(row) {
    if (!row || typeof row !== 'object') return null;
    var rowIndex = row.rowIndex;
    if (typeof rowIndex !== 'number' || !isFinite(rowIndex) || rowIndex < 0 || (rowIndex | 0) !== rowIndex) return null;
    if (typeof row.taskUuid !== 'string' || !UUID_RE.test(row.taskUuid)) return null;
    return {
      rowIndex: rowIndex,
      taskUuid: row.taskUuid.toLowerCase(),
      actionedBy: typeof row.actionedBy === 'string' ? row.actionedBy.slice(0, 80) : '',
      actionedDateTime: typeof row.actionedDateTime === 'string' ? row.actionedDateTime.slice(0, 40) : '',
    };
  }

  // 'staffUuid|email' documentElement attribute → { staffId, email } | null.
  // Strict on the UUID (it keys presence rows); lenient on the email (label
  // only). Same stamp-attribute pattern as parseSummaryBridgeAttr.
  function parseStaffAttr(value) {
    if (typeof value !== 'string' || !value) return null;
    var bar = value.indexOf('|');
    var id = (bar >= 0 ? value.slice(0, bar) : value).trim();
    if (!UUID_RE.test(id)) return null;
    var email = bar >= 0 ? value.slice(bar + 1).trim() : '';
    if (email.length > 120) email = '';
    return { staffId: id.toLowerCase(), email: email };
  }

  // What other clinicians see against this user's presence. Options override
  // first, else the email's local part ('david.triska@nhs.net' → 'david.triska'),
  // else empty (caller falls back to 'A colleague').
  function displayLabel(cfgName, email) {
    var name = typeof cfgName === 'string' ? cfgName.trim() : '';
    if (name) return name.slice(0, 60);
    var em = typeof email === 'string' ? email.trim() : '';
    if (em) {
      var at = em.indexOf('@');
      return (at > 0 ? em.slice(0, at) : em).slice(0, 60);
    }
    return '';
  }

  // Task overview URL → { site, slug, taskUuid } | null. Accepts both the
  // route shape (/{site}/tasks/{slug}/overview/{uuid}) and the data shape
  // (/{site}/tasks/data/{slug}/overview/{uuid}); list pages never match.
  function parseTaskOverviewPath(path) {
    if (typeof path !== 'string') return null;
    var m = path.match(
      /^\/([0-9a-z]{2,})\/tasks\/(?:data\/)?([A-Za-z0-9_-]{1,80})\/overview\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#]|$)/i
    );
    if (!m) return null;
    return { site: m[1].toLowerCase(), slug: m[2], taskUuid: m[3].toLowerCase() };
  }

  // Presence store config gate. URL must be https on a *.supabase.co host
  // (matching the host permission the manifest already carries); key must be
  // plausibly a Supabase anon key (JWT-ish length). Anything else → dormant.
  function validPresenceConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') return false;
    if (cfg.enabled !== true) return false;
    if (typeof cfg.url !== 'string' || typeof cfg.key !== 'string') return false;
    var u;
    try {
      u = new URL(cfg.url);
    } catch (_) {
      return false;
    }
    if (u.protocol !== 'https:') return false;
    if (!/^[a-z0-9-]+\.supabase\.co$/i.test(u.hostname)) return false;
    if (cfg.key.trim().length < 30) return false;
    return true;
  }

  // One heartbeat row. openedAtIso is only included on the FIRST beat of an
  // open (upsert merge would otherwise reset it every 25s and "opened N min
  // ago" would never grow).
  function buildHeartbeatPayload(site, taskUuid, staffId, label, nowIso, openedAtIso) {
    var row = {
      site: site,
      task_uuid: taskUuid,
      staff_id: staffId,
      staff_label: (typeof label === 'string' && label ? label : 'A colleague').slice(0, 60),
      last_seen: nowIso,
    };
    if (openedAtIso) row.opened_at = openedAtIso;
    return row;
  }

  // Store rows → the OTHER clinicians' fresh presences, newest per staff_id,
  // self excluded, stale excluded, shapes validated (the store is shared
  // infrastructure — treat reads as untrusted too).
  function activeOthers(rows, myStaffId, nowMs, ttlMs) {
    if (!Array.isArray(rows)) return [];
    var byStaff = {};
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r || typeof r !== 'object') continue;
      if (typeof r.staff_id !== 'string' || !UUID_RE.test(r.staff_id)) continue;
      var sid = r.staff_id.toLowerCase();
      if (sid === myStaffId) continue;
      var seen = Date.parse(r.last_seen);
      if (!isFinite(seen) || nowMs - seen > ttlMs || seen - nowMs > 60000) continue;
      var label =
        typeof r.staff_label === 'string' && r.staff_label.trim() ? r.staff_label.trim().slice(0, 60) : 'A colleague';
      var opened = Date.parse(r.opened_at);
      var entry = {
        staffId: sid,
        label: label,
        lastSeenMs: seen,
        openedAtMs: isFinite(opened) ? opened : seen,
        taskUuid: typeof r.task_uuid === 'string' && UUID_RE.test(r.task_uuid) ? r.task_uuid.toLowerCase() : '',
      };
      if (!byStaff[sid] || byStaff[sid].lastSeenMs < seen) byStaff[sid] = entry;
    }
    var out = [];
    for (var k in byStaff) if (Object.prototype.hasOwnProperty.call(byStaff, k)) out.push(byStaff[k]);
    out.sort(function (a, b) {
      return a.openedAtMs - b.openedAtMs;
    });
    return out;
  }

  // Queue chip text for a task's active others. One name shown verbatim;
  // more are counted (the chip lives inside the fixed-width patient cell).
  function presenceChipText(others) {
    if (!Array.isArray(others) || !others.length) return '';
    if (others.length === 1) return '👁 ' + others[0].label;
    return '👁 ' + others.length + ' colleagues';
  }

  // "just now" / "N min ago" for the banner. Deliberately coarse — the exact
  // second is noise; the decision is "do I duplicate this work right now".
  function minutesAgoText(openedAtMs, nowMs) {
    var mins = Math.floor((nowMs - openedAtMs) / 60000);
    if (!isFinite(mins) || mins < 1) return 'just now';
    if (mins === 1) return '1 min ago';
    if (mins < 60) return mins + ' min ago';
    var hrs = Math.floor(mins / 60);
    return hrs + (hrs === 1 ? ' hr ago' : ' hrs ago');
  }

  // "✎ <who> · <time>" chip for the wire's last-actioned fields. Medicus's
  // datetime string is '04 Aug 2026, 13:49' — the time part is what a
  // same-day queue needs, so keep just it when the shape matches (the full
  // string stays in the title attribute).
  function actionedChipText(actionedBy, actionedDateTime) {
    var who = typeof actionedBy === 'string' ? actionedBy.trim() : '';
    if (!who) return '';
    var when = typeof actionedDateTime === 'string' ? actionedDateTime.trim() : '';
    var tm = when.match(/,\s*(\d{1,2}:\d{2})\s*$/);
    return '✎ ' + who.slice(0, 40) + (tm ? ' · ' + tm[1] : '');
  }

  // Resolve the presence config from a chrome.storage snapshot (fire-and-
  // forget, 2026-08-04). Source order: manually-entered Options values (both
  // url AND key set) win, else the shared-folder file cache
  // ('presence.fileCache', synced by the service worker from
  // presence-config.json in the extension folder — one file configures every
  // machine that loads from the shared folder). Enabled semantics are
  // "on unless this machine explicitly opted out": presence.enabled is only
  // false when someone unticked the Options box, so a machine that has never
  // opened Options runs the moment the shared file exists.
  function resolvePresenceConfig(storage) {
    storage = storage && typeof storage === 'object' ? storage : {};
    var manualUrl =
      typeof storage['presence.url'] === 'string' ? storage['presence.url'].trim().replace(/\/+$/, '') : '';
    var manualKey = typeof storage['presence.key'] === 'string' ? storage['presence.key'].trim() : '';
    var fc = storage['presence.fileCache'];
    var fcUrl = fc && typeof fc === 'object' && typeof fc.url === 'string' ? fc.url.trim().replace(/\/+$/, '') : '';
    var fcKey = fc && typeof fc === 'object' && typeof fc.key === 'string' ? fc.key.trim() : '';
    var useManual = !!(manualUrl && manualKey);
    return {
      enabled: storage['presence.enabled'] !== false,
      url: useManual ? manualUrl : fcUrl,
      key: useManual ? manualKey : fcKey,
      name: typeof storage['presence.name'] === 'string' ? storage['presence.name'] : '',
      source: useManual ? 'manual' : fcUrl && fcKey ? 'file' : 'none',
    };
  }

  // task_uuid=in.(...) filter value for a queue presence read, deduped and
  // capped (PostgREST in.() syntax; UUIDs need no quoting).
  function buildPresenceInFilter(uuids, cap) {
    if (!Array.isArray(uuids)) return '';
    var seen = {};
    var keep = [];
    var max = typeof cap === 'number' && cap > 0 ? cap : MAX_QUERY_UUIDS;
    for (var i = 0; i < uuids.length && keep.length < max; i++) {
      var u = uuids[i];
      if (typeof u !== 'string' || !UUID_RE.test(u)) continue;
      var lc = u.toLowerCase();
      if (seen[lc]) continue;
      seen[lc] = 1;
      keep.push(lc);
    }
    if (!keep.length) return '';
    return 'in.(' + keep.join(',') + ')';
  }

  // Native Pusher member.info → a display label. Staff-shaped keys only;
  // empty if nothing usable (caller falls back to 'A colleague').
  function labelFromPresenceInfo(info) {
    if (!info || typeof info !== 'object') return '';
    var keys = [
      'displayName',
      'display_name',
      'name',
      'fullName',
      'full_name',
      'staffName',
      'staff_name',
      'shortName',
      'short_name',
    ];
    for (var i = 0; i < keys.length; i++) {
      var v = info[keys[i]];
      if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 60);
    }
    var first =
      typeof info.firstName === 'string'
        ? info.firstName.trim()
        : typeof info.first_name === 'string'
          ? info.first_name.trim()
          : '';
    var last =
      typeof info.lastName === 'string'
        ? info.lastName.trim()
        : typeof info.last_name === 'string'
          ? info.last_name.trim()
          : '';
    if (first && last) return (first + ' ' + last).slice(0, 60);
    if (first) return first.slice(0, 60);
    var email = typeof info.email === 'string' ? info.email.trim() : '';
    if (email) {
      var at = email.indexOf('@');
      return (at > 0 ? email.slice(0, at) : email).slice(0, 60);
    }
    if (typeof info.initials === 'string' && info.initials.trim()) return info.initials.trim().slice(0, 3);
    return '';
  }

  // "Dr Aisha Malik" → AM; "david.triska" → DT; already-initials kept.
  function initialsFromLabel(label) {
    var s = typeof label === 'string' ? label.trim() : '';
    if (!s) return '?';
    s = s.replace(/^(dr|prof|professor|mr|mrs|ms|miss)\.?\s+/i, '');
    if (s.indexOf('@') >= 0) s = s.split('@')[0];
    if (/^[A-Za-z]{1,3}$/.test(s)) return s.toUpperCase();
    var parts = s.split(/[\s._-]+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
    return s.slice(0, 2).toUpperCase();
  }

  // Identity colour for an avatar — categorical, never status red/amber.
  // Each value is dark enough for white initials (WCAG AA contrast vs #fff).
  var AVATAR_HUES = ['#047857', '#7c3aed', '#2563eb', '#0369a1', '#a21caf', '#4f46e5', '#0f766e', '#1d4ed8'];
  var HUE_HEX_RE = /^#[0-9a-fA-F]{6}$/;
  function avatarHue(staffId) {
    var id = typeof staffId === 'string' ? staffId : '';
    var h = 0;
    for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return AVATAR_HUES[h % AVATAR_HUES.length];
  }
  function safeAvatarHue(hue) {
    return typeof hue === 'string' && HUE_HEX_RE.test(hue) ? hue : '';
  }

  // Prefer a previously-known staff label over the "Someone else" fallback
  // when native member.info is empty. knownMap is staffId → display label
  // (store heartbeats + prior native names). Never invent a name.
  function preferKnownLabel(label, staffId, knownMap) {
    var current = typeof label === 'string' ? label.trim() : '';
    if (current && current !== 'Someone else') return current.slice(0, 60);
    var known = '';
    if (knownMap && typeof staffId === 'string') {
      var k = knownMap[staffId] || knownMap[String(staffId).toLowerCase()];
      if (typeof k === 'string') known = k.trim();
    }
    if (known && known !== 'Someone else' && known !== 'A colleague') return known.slice(0, 60);
    return current || 'Someone else';
  }

  function rememberKnownLabel(staffId, label, knownMap) {
    if (!knownMap || typeof staffId !== 'string' || !staffId) return knownMap;
    var s = typeof label === 'string' ? label.trim() : '';
    if (!s || s === 'Someone else' || s === 'A colleague') return knownMap;
    knownMap[staffId] = s.slice(0, 60);
    return knownMap;
  }

  // presence-{site}-task-{uuid} only. Rejects the queue channel
  // presence-{site}-task-list-{slug} (that is "who has the list open", not
  // who is in a request — treating it as per-task would false-positive).
  function parsePresenceTaskChannel(name) {
    if (typeof name !== 'string') return null;
    var m = name.match(
      /^presence-([0-9a-z]{2,})-task-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
    );
    if (!m) return null;
    return { site: m[1].toLowerCase(), taskUuid: m[2].toLowerCase() };
  }

  // Untrusted ch-native-task-presence detail → other clinicians on THIS task.
  // Fail closed: without a known self id we cannot tell "me" from a colleague,
  // so showing anyone would paint YOU as occupying your own request.
  function sanitizeNativePresence(detail, myStaffId, expectedTaskUuid) {
    if (!detail || typeof detail !== 'object') return [];
    // Missing `live` is treated as live (rig fixtures omit it). live === false
    // means the socket is down or the subscription errored — fail closed, hide.
    if (detail.live === false) return [];
    if (typeof myStaffId !== 'string' || !UUID_RE.test(myStaffId)) return [];
    if (typeof expectedTaskUuid !== 'string' || !UUID_RE.test(expectedTaskUuid)) return [];
    if (typeof detail.taskUuid !== 'string' || !UUID_RE.test(detail.taskUuid)) return [];
    var taskUuid = detail.taskUuid.toLowerCase();
    if (taskUuid !== expectedTaskUuid.toLowerCase()) return [];
    var me = myStaffId.toLowerCase();
    var raw = Array.isArray(detail.members) ? detail.members.slice(0, 20) : [];
    var seen = {};
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var m = raw[i];
      if (!m || typeof m !== 'object') continue;
      if (typeof m.id !== 'string' || !UUID_RE.test(m.id)) continue;
      var sid = m.id.toLowerCase();
      if (sid === me || seen[sid]) continue;
      seen[sid] = 1;
      var info = m.info && typeof m.info === 'object' ? m.info : {};
      var label = labelFromPresenceInfo(info);
      var unknown = !label;
      if (!label) label = 'Someone else';
      var initials = unknown
        ? '?'
        : typeof info.initials === 'string' && /^[A-Za-z]{1,3}$/.test(info.initials.trim())
          ? info.initials.trim().toUpperCase()
          : initialsFromLabel(label);
      out.push({
        staffId: sid,
        label: label,
        initials: initials,
        hue: avatarHue(sid),
        taskUuid: taskUuid,
        native: true,
      });
    }
    return out;
  }

  // Drop leftovers from a previous request if paint runs before nav cleanup.
  function othersOnTask(others, taskUuid) {
    if (!Array.isArray(others) || typeof taskUuid !== 'string' || !UUID_RE.test(taskUuid)) return [];
    var want = taskUuid.toLowerCase();
    var out = [];
    for (var i = 0; i < others.length; i++) {
      var o = others[i];
      if (!o || o.staffId === undefined) continue;
      // Expected UUID is set: missing UUID is a stale leftover — drop it.
      if (typeof o.taskUuid !== 'string' || !o.taskUuid || !UUID_RE.test(o.taskUuid)) continue;
      if (o.taskUuid.toLowerCase() !== want) continue;
      out.push(o);
    }
    return out;
  }

  function occupiedHeadline(others) {
    if (!Array.isArray(others) || !others.length) return '';
    var n = others.length;
    function lab(i) {
      var s = others[i] && others[i].label;
      return typeof s === 'string' && s.trim() ? s.trim() : 'Someone else';
    }
    function second(s) {
      return s === 'Someone else' ? 'someone else' : s;
    }
    var a = lab(0);
    if (n === 1) return a + ' is on this request';
    if (n === 2) return a + ' and ' + second(lab(1)) + ' are on this request';
    if (a === 'Someone else') {
      var rest = n - 1;
      if (rest === 1) return 'Someone else and one other person are on this request';
      return 'Someone else and ' + rest + ' other people are on this request';
    }
    var b = second(lab(1));
    var more = n - 2;
    if (more === 1) return a + ', ' + b + ' and 1 other are on this request';
    return a + ', ' + b + ' and ' + more + ' others are on this request';
  }

  function occupiedAction() {
    return 'Check with them before you reply, or carry on. You are not locked out.';
  }

  // Native Pusher membership is live NOW. "seen here N min" is counted from
  // when THIS tab first noticed the member (_firstSeen) — never "Opened".
  function occupiedNote(others, nowMs) {
    if (!Array.isArray(others) || !others.length) return '';
    var native = false;
    for (var i = 0; i < others.length; i++) {
      if (others[i] && others[i].native) native = true;
    }
    if (native) {
      var seenAt = others[0].openedAtMs;
      var mins = Math.floor((nowMs - seenAt) / 60000);
      if (!isFinite(mins) || mins < 1) return 'Live';
      return 'Live · seen here ' + mins + ' min';
    }
    var opened = others[0].openedAtMs;
    var ago = minutesAgoText(typeof opened === 'number' ? opened : nowMs, nowMs);
    return ago === 'just now' ? 'Live' : 'Seen ' + ago;
  }

  function occupancyDismissKey(taskUuid) {
    return 'ms-tp-dismiss:' + String(taskUuid || '').toLowerCase();
  }

  function occupancyDismissValue(staffIds) {
    if (!Array.isArray(staffIds)) return '';
    return staffIds
      .map(function (id) {
        return typeof id === 'string' ? id.toLowerCase() : '';
      })
      .filter(Boolean)
      .sort()
      .join(',');
  }

  function occupancyIsDismissed(taskUuid, staffIds, storage) {
    if (!storage || typeof storage.getItem !== 'function') return false;
    if (typeof taskUuid !== 'string' || !UUID_RE.test(taskUuid)) return false;
    var got = '';
    try {
      got = storage.getItem(occupancyDismissKey(taskUuid));
    } catch (_) {
      return false;
    }
    if (got == null || got === '') return false;
    return got === occupancyDismissValue(staffIds);
  }

  function occupancyWriteDismiss(taskUuid, staffIds, storage) {
    if (!storage || typeof storage.setItem !== 'function') return false;
    if (typeof taskUuid !== 'string' || !UUID_RE.test(taskUuid)) return false;
    try {
      storage.setItem(occupancyDismissKey(taskUuid), occupancyDismissValue(staffIds));
      return true;
    } catch (_) {
      return false;
    }
  }

  // ── test hook (node) ──────────────────────────────────────────────────────
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      sanitizeBridgeRow: sanitizeBridgeRow,
      parseStaffAttr: parseStaffAttr,
      displayLabel: displayLabel,
      parseTaskOverviewPath: parseTaskOverviewPath,
      validPresenceConfig: validPresenceConfig,
      buildHeartbeatPayload: buildHeartbeatPayload,
      activeOthers: activeOthers,
      presenceChipText: presenceChipText,
      minutesAgoText: minutesAgoText,
      actionedChipText: actionedChipText,
      resolvePresenceConfig: resolvePresenceConfig,
      buildPresenceInFilter: buildPresenceInFilter,
      labelFromPresenceInfo: labelFromPresenceInfo,
      initialsFromLabel: initialsFromLabel,
      avatarHue: avatarHue,
      sanitizeNativePresence: sanitizeNativePresence,
      parsePresenceTaskChannel: parsePresenceTaskChannel,
      othersOnTask: othersOnTask,
      occupiedHeadline: occupiedHeadline,
      occupiedAction: occupiedAction,
      occupiedNote: occupiedNote,
      preferKnownLabel: preferKnownLabel,
      rememberKnownLabel: rememberKnownLabel,
      occupancyDismissKey: occupancyDismissKey,
      occupancyDismissValue: occupancyDismissValue,
      occupancyIsDismissed: occupancyIsDismissed,
      occupancyWriteDismiss: occupancyWriteDismiss,
      AVATAR_HUES: AVATAR_HUES,
      safeAvatarHue: safeAvatarHue,
    };
    return; // node context: helpers only, no DOM/chrome wiring
  }

  // ── config (chrome.storage; dormant until a store is configured) ──────────
  var _cfg = { enabled: false, url: '', key: '', name: '', source: 'none' };

  function refreshConfig() {
    try {
      chrome.storage.local.get(
        ['presence.enabled', 'presence.url', 'presence.key', 'presence.name', 'presence.fileCache'],
        function (res) {
          if (chrome.runtime.lastError) return;
          _cfg = resolvePresenceConfig(res);
        }
      );
    } catch (_) {}
  }
  refreshConfig();
  // Ask the service worker to (re)sync presence-config.json from the shared
  // extension folder — fire-and-forget; a successful sync lands in
  // presence.fileCache and the onChanged listener below re-resolves.
  try {
    chrome.runtime.sendMessage({ action: 'presence:syncFileConfig' }, function () {
      void chrome.runtime.lastError; // SW asleep/no file — both fine
    });
  } catch (_) {}
  try {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'local') return;
      if (
        changes['presence.enabled'] ||
        changes['presence.url'] ||
        changes['presence.key'] ||
        changes['presence.name'] ||
        changes['presence.fileCache']
      ) {
        refreshConfig();
      }
    });
  } catch (_) {}

  // ── folder store status (the PRIMARY transport, 2026-08-04) ───────────────
  // The practice's shared folder is the store (see shared/presence-folder.js).
  // All file IO lives in the service worker; this script only learns whether
  // the folder is usable and routes beats/reads accordingly. The hosted
  // (Supabase) transport below survives as the fallback for practices
  // without a shared folder.
  var _folder = { configured: false, permission: 'none' };

  function swMessage(msg) {
    return new Promise(function (resolve, reject) {
      try {
        chrome.runtime.sendMessage(msg, function (res) {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(res);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  function refreshFolderStatus() {
    swMessage({ action: 'presence:folderStatus' })
      .then(function (res) {
        if (res && typeof res === 'object') {
          _folder = { configured: res.configured === true, permission: String(res.permission || 'none') };
        }
      })
      .catch(function () {
        /* SW unreachable — keep last-known state */
      });
  }
  refreshFolderStatus();
  setInterval(refreshFolderStatus, 120000);

  function folderUsable() {
    return _folder.configured && _folder.permission === 'granted';
  }

  function presenceReady() {
    return folderUsable() || validPresenceConfig(_cfg);
  }

  // ── identity (stamped by page-world.js) ───────────────────────────────────
  function myIdentity() {
    try {
      return parseStaffAttr(document.documentElement.getAttribute('data-ch-staff'));
    } catch (_) {
      return null;
    }
  }

  // ── Supabase REST (plain fetch; supabase-js is neither needed nor loadable
  //    under Medicus's CSP from a content script) ─────────────────────────────
  function storeHeaders() {
    return {
      apikey: _cfg.key,
      Authorization: 'Bearer ' + _cfg.key,
      'Content-Type': 'application/json',
    };
  }

  function storeUpsert(row) {
    var h = storeHeaders();
    h.Prefer = 'resolution=merge-duplicates';
    return fetch(_cfg.url + '/rest/v1/task_presence?on_conflict=site,task_uuid,staff_id', {
      method: 'POST',
      headers: h,
      body: JSON.stringify([row]),
      keepalive: true,
    });
  }

  function storeDelete(site, taskUuid, staffId) {
    return fetch(
      _cfg.url +
        '/rest/v1/task_presence?site=eq.' +
        encodeURIComponent(site) +
        '&task_uuid=eq.' +
        encodeURIComponent(taskUuid) +
        '&staff_id=eq.' +
        encodeURIComponent(staffId),
      { method: 'DELETE', headers: storeHeaders(), keepalive: true }
    );
  }

  function storeReadTask(site, taskUuid) {
    var sinceIso = new Date(Date.now() - PRESENCE_TTL_MS).toISOString();
    return fetch(
      _cfg.url +
        '/rest/v1/task_presence?select=*&site=eq.' +
        encodeURIComponent(site) +
        '&task_uuid=eq.' +
        encodeURIComponent(taskUuid) +
        '&last_seen=gte.' +
        encodeURIComponent(sinceIso),
      { headers: storeHeaders() }
    ).then(function (r) {
      if (!r.ok) throw new Error('presence read HTTP ' + r.status);
      return r.json();
    });
  }

  function storeReadMany(site, uuids) {
    var inFilter = buildPresenceInFilter(uuids);
    if (!inFilter) return Promise.resolve([]);
    var sinceIso = new Date(Date.now() - PRESENCE_TTL_MS).toISOString();
    return fetch(
      _cfg.url +
        '/rest/v1/task_presence?select=*&site=eq.' +
        encodeURIComponent(site) +
        '&task_uuid=' +
        inFilter +
        '&last_seen=gte.' +
        encodeURIComponent(sinceIso),
      { headers: storeHeaders() }
    ).then(function (r) {
      if (!r.ok) throw new Error('presence read HTTP ' + r.status);
      return r.json();
    });
  }

  // ── transport dispatch: folder first, hosted store as fallback ────────────
  // Folder semantics differ from the hosted upsert in one way that matters:
  // a beat is a WHOLE-FILE REPLACE, so opened_at must ride every beat (from
  // the beacon's local state) — there is no server-side merge to preserve it.
  function beatWrite(row, openedAtIso) {
    if (folderUsable()) {
      var full = Object.assign({}, row, { opened_at: openedAtIso });
      return swMessage({ action: 'presence:folderBeat', row: full }).then(function (res) {
        if (!res || !res.ok) throw new Error('folder beat: ' + ((res && res.reason) || 'no response'));
        return { ok: true };
      });
    }
    return storeUpsert(row);
  }

  function beatClear(site, taskUuid, staffId) {
    if (folderUsable()) {
      return swMessage({ action: 'presence:folderClear', site: site, staffId: staffId }).then(function (res) {
        if (!res || !res.ok) throw new Error('folder clear: ' + ((res && res.reason) || 'no response'));
      });
    }
    return storeDelete(site, taskUuid, staffId);
  }

  function readTaskRows(site, taskUuid) {
    if (folderUsable()) {
      return swMessage({ action: 'presence:folderRead', site: site }).then(function (res) {
        if (!res || !res.ok) throw new Error('folder read: ' + ((res && res.reason) || 'no response'));
        return (res.rows || []).filter(function (r) {
          return r && r.task_uuid === taskUuid;
        });
      });
    }
    return storeReadTask(site, taskUuid);
  }

  function readManyRows(site, uuids) {
    if (folderUsable()) {
      // One directory listing returns every live beat for the site; the
      // caller groups by task_uuid and ignores tasks not on its queue.
      return swMessage({ action: 'presence:folderRead', site: site }).then(function (res) {
        if (!res || !res.ok) throw new Error('folder read: ' + ((res && res.reason) || 'no response'));
        return res.rows || [];
      });
    }
    return storeReadMany(site, uuids);
  }

  // ── LAYER 2a: heartbeat while a task overview is open + visible ───────────
  var _beat = null; // { site, slug, taskUuid, timer, openedAtIso, sentOpenedAt }

  function stopBeacon(sendDelete) {
    if (!_beat) return;
    var b = _beat;
    _beat = null;
    if (b.timer) clearInterval(b.timer);
    if (sendDelete && presenceReady()) {
      var me = myIdentity();
      if (me) {
        Promise.resolve(beatClear(b.site, b.taskUuid, me.staffId)).catch(function (e) {
          log('presence delete failed', e && e.message);
        });
      }
    }
    log('beacon stopped', b.taskUuid);
  }

  function sendBeat() {
    if (!_beat || !presenceReady() || document.hidden) return;
    var me = myIdentity();
    if (!me) return; // identity not stamped yet — try again next tick
    var nowIso = new Date().toISOString();
    var payload = buildHeartbeatPayload(
      _beat.site,
      _beat.taskUuid,
      me.staffId,
      displayLabel(_cfg.name, me.email),
      nowIso,
      _beat.sentOpenedAt ? null : _beat.openedAtIso
    );
    var beatRef = _beat;
    beatWrite(payload, _beat.openedAtIso)
      .then(function (r) {
        if (r.ok && beatRef) beatRef.sentOpenedAt = true;
        if (!r.ok) log('presence upsert HTTP ' + r.status);
      })
      .catch(function (e) {
        log('presence upsert failed', e && e.message);
      });
  }

  function syncBeacon() {
    var ctx = parseTaskOverviewPath(location.pathname);
    if (!ctx) {
      // left the task page (SPA nav) — release the advisory row promptly so a
      // colleague isn't warned off a request nobody has open any more
      stopBeacon(true);
      return;
    }
    if (_beat && _beat.taskUuid === ctx.taskUuid) return; // same task, keep beating
    stopBeacon(true);
    if (!presenceReady()) return;
    _beat = {
      site: ctx.site,
      slug: ctx.slug,
      taskUuid: ctx.taskUuid,
      openedAtIso: new Date().toISOString(),
      sentOpenedAt: false,
      timer: setInterval(sendBeat, HEARTBEAT_MS),
    };
    log('beacon started', ctx.taskUuid);
    sendBeat();
    refreshBanner();
  }

  // Release on real navigation/close too (keepalive lets the DELETE finish).
  window.addEventListener('pagehide', function () {
    stopBeacon(true);
  });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      sendBeat(); // catch up immediately on return
      refreshBanner();
    }
    // hidden: just stop refreshing — the row goes stale by TTL, which is the
    // designed release for "left it open and walked away"
  });

  // ── LAYER 0 + 2b: occupied masthead on the open task ───────────────────────
  // Layer 0 (native Pusher presence) is the primary signal and needs no store.
  // Layer 2 (folder/Supabase) still paints if native is empty.
  var BANNER_ID = 'ms-tp-banner';
  var _nativeOthers = [];
  var _nativeTaskUuid = '';
  var _storeOthers = [];
  var _firstSeen = {}; // staffId → first-seen ms on this overview (this-tab dwell)
  var _knownLabels = {}; // staffId → last known display label (store + native)
  var _paintCache = { path: '', sig: '', parent: null };
  var _liveIds = '';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function stampFirstSeen(others) {
    var live = {};
    var now = Date.now();
    for (var i = 0; i < others.length; i++) {
      var id = others[i].staffId;
      live[id] = 1;
      if (!_firstSeen[id]) _firstSeen[id] = now;
      if (typeof others[i].openedAtMs !== 'number') others[i].openedAtMs = _firstSeen[id];
    }
    for (var k in _firstSeen) {
      if (!Object.prototype.hasOwnProperty.call(_firstSeen, k)) continue;
      if (!live[k]) delete _firstSeen[k];
    }
    return others;
  }

  function mergedOthers() {
    var by = {};
    var i;
    for (i = 0; i < _storeOthers.length; i++) {
      rememberKnownLabel(_storeOthers[i].staffId, _storeOthers[i].label, _knownLabels);
    }
    for (i = 0; i < _nativeOthers.length; i++) {
      rememberKnownLabel(_nativeOthers[i].staffId, _nativeOthers[i].label, _knownLabels);
    }
    for (i = 0; i < _nativeOthers.length; i++) {
      var n = _nativeOthers[i];
      var label = preferKnownLabel(n.label, n.staffId, _knownLabels);
      var initials = n.initials;
      if (label !== n.label) {
        initials = label === 'Someone else' ? '?' : initialsFromLabel(label);
      }
      by[n.staffId] = {
        staffId: n.staffId,
        label: label,
        initials: initials,
        hue: n.hue || avatarHue(n.staffId),
        openedAtMs: n.openedAtMs,
        taskUuid: n.taskUuid,
        native: true,
      };
    }
    for (i = 0; i < _storeOthers.length; i++) {
      var s = _storeOthers[i];
      if (!by[s.staffId]) {
        by[s.staffId] = {
          staffId: s.staffId,
          label: s.label,
          initials: initialsFromLabel(s.label),
          hue: avatarHue(s.staffId),
          openedAtMs: s.openedAtMs,
          taskUuid: s.taskUuid,
          native: false,
        };
      }
    }
    var out = [];
    for (var k in by) if (Object.prototype.hasOwnProperty.call(by, k)) out.push(by[k]);
    out.sort(function (a, b) {
      return (a.openedAtMs || 0) - (b.openedAtMs || 0);
    });
    return stampFirstSeen(out);
  }

  function removeBanner() {
    var el = document.getElementById(BANNER_ID);
    if (el) el.remove();
    try {
      document.documentElement.classList.remove('ms-tp-occupied');
    } catch (_) {}
    _paintCache = { path: '', sig: '', parent: null };
    _liveIds = '';
  }

  function staffIdList(others) {
    return others.map(function (o) {
      return o.staffId;
    });
  }

  function occupiedInnerHtml(others, nowMs) {
    var many = others.length > 1 ? ' ms-tp-avs-many' : '';
    var extraCount = others.length > 3 ? others.length - 3 : 0;
    var avatars = others
      .slice(0, 3)
      .map(function (o, i) {
        var extra = o.initials === '?' ? ' ms-tp-av-unknown' : '';
        var hue = o.initials === '?' ? '' : safeAvatarHue(o.hue);
        var bg = hue ? 'background:' + hue + ';' : '';
        return (
          '<span class="ms-tp-av' +
          extra +
          '" title="' +
          esc(o.label) +
          '" aria-hidden="true" style="z-index:' +
          (i + 1) +
          ';' +
          bg +
          '">' +
          esc(o.initials) +
          '</span>'
        );
      })
      .join('');
    if (extraCount > 0) {
      avatars +=
        '<span class="ms-tp-av ms-tp-av-more" aria-hidden="true" style="z-index:4" title="' +
        esc('+' + extraCount + ' more') +
        '">+' +
        extraCount +
        '</span>';
    }
    var recency = occupiedNote(others, nowMs);
    var nativeLive = false;
    for (var ni = 0; ni < others.length; ni++) {
      if (others[ni] && others[ni].native) nativeLive = true;
    }
    var seenExtra = '';
    if (nativeLive && /^Live\s*·\s*/i.test(recency)) {
      seenExtra = recency.replace(/^Live\s*·\s*/i, '');
    }
    var recencyHtml;
    if (nativeLive) {
      recencyHtml =
        '<span class="ms-tp-recency">' +
        '<span class="ms-tp-live" aria-hidden="true"></span>' +
        '<span class="ms-tp-recency-live">Live</span>' +
        (seenExtra ? '<span class="ms-tp-seen"> · ' + esc(seenExtra) + '</span>' : '') +
        '</span>';
    } else {
      recencyHtml = '<span class="ms-tp-recency">' + esc(recency) + '</span>';
    }
    return (
      '<span class="ms-tp-inner">' +
      '<span class="ms-tp-avs' +
      many +
      '">' +
      avatars +
      '</span>' +
      '<span class="ms-tp-who">' +
      esc(occupiedHeadline(others)) +
      '</span>' +
      recencyHtml +
      '<span class="ms-tp-action">' +
      esc(occupiedAction()) +
      '</span>' +
      '<button type="button" class="ms-tp-hide">Hide</button>' +
      '</span>'
    );
  }

  function bindBannerClicks(el) {
    if (el.getAttribute('data-hide-bound') === '1') return;
    el.setAttribute('data-hide-bound', '1');
    el.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.classList || !t.classList.contains('ms-tp-hide')) return;
      e.preventDefault();
      e.stopPropagation();
      var ctx = parseTaskOverviewPath(location.pathname);
      if (!ctx) return;
      var others = othersOnTask(mergedOthers(), ctx.taskUuid);
      occupancyWriteDismiss(ctx.taskUuid, staffIdList(others), sessionStorage);
      removeBanner();
    });
  }

  function paintOccupied() {
    var path = location.pathname;
    var ctx = parseTaskOverviewPath(path);
    var others = ctx ? othersOnTask(mergedOthers(), ctx.taskUuid) : [];
    var nowMs = Date.now();
    if (ctx && others.length && occupancyIsDismissed(ctx.taskUuid, staffIdList(others), sessionStorage)) {
      others = [];
    }
    var headline = others.length ? occupiedHeadline(others) : '';
    var note = others.length ? occupiedNote(others, nowMs) : '';
    var sig = (ctx ? ctx.taskUuid : '') + '|' + staffIdList(others).join(',') + '|' + headline + '|' + note;
    var el = document.getElementById(BANNER_ID);
    if (!ctx || !others.length) {
      if (!el && _paintCache.sig === sig && _paintCache.path === path) return;
      removeBanner();
      _paintCache = { path: path, sig: sig, parent: null };
      return;
    }
    if (
      el &&
      _paintCache.path === path &&
      _paintCache.sig === sig &&
      el.parentNode &&
      el.parentNode === _paintCache.parent
    ) {
      return;
    }
    var html = occupiedInnerHtml(others, nowMs);
    var title = headline + (note ? ' · ' + note : '') + '. ' + occupiedAction();
    var idSet = staffIdList(others).slice().sort().join(',');
    try {
      document.documentElement.classList.add('ms-tp-occupied');
    } catch (_) {}
    var host =
      (el && el.parentNode && el.parentNode.tagName === 'MAIN' && el.parentNode) ||
      document.querySelector('main') ||
      document.body;
    if (el) {
      var inner = el.querySelector('.ms-tp-inner');
      if (inner) inner.outerHTML = html;
      else el.insertAdjacentHTML('afterbegin', html);
      el.setAttribute('data-sig', sig);
      el.setAttribute('title', title);
      el.setAttribute('aria-live', 'off');
      var sr = el.querySelector('.ms-tp-sr');
      if (!sr) {
        sr = document.createElement('span');
        sr.className = 'ms-tp-sr';
        sr.setAttribute('role', 'status');
        sr.setAttribute('aria-live', 'polite');
        el.appendChild(sr);
      }
      if (idSet !== _liveIds) {
        sr.textContent = headline;
        _liveIds = idSet;
      }
      bindBannerClicks(el);
      if (host && el.parentNode !== host) host.insertBefore(el, host.firstChild);
      _paintCache = { path: path, sig: sig, parent: el.parentNode };
      return;
    }
    el = document.createElement('div');
    el.id = BANNER_ID;
    el.setAttribute('aria-live', 'off');
    el.setAttribute('title', title);
    el.setAttribute('data-sig', sig);
    el.innerHTML = html + '<span class="ms-tp-sr" role="status" aria-live="polite"></span>';
    var srNew = el.querySelector('.ms-tp-sr');
    if (srNew) srNew.textContent = headline;
    _liveIds = idSet;
    bindBannerClicks(el);
    // PREPEND into <main> — trailing foreign nodes get reconciled away by Vue
    // (CLAUDE.md queue-chip rule 1).
    if (host) host.insertBefore(el, host.firstChild);
    _paintCache = { path: path, sig: sig, parent: el.parentNode };
  }

  // Keep the old name: store-layer refresh still calls this.
  function renderBanner(others) {
    _storeOthers = Array.isArray(others) ? others : [];
    paintOccupied();
  }

  var _bannerBusy = false;
  function refreshBanner() {
    paintOccupied();
    if (!_beat || !presenceReady() || document.hidden || _bannerBusy) return;
    var me = myIdentity();
    if (!me) return;
    _bannerBusy = true;
    var forTask = _beat.taskUuid;
    readTaskRows(_beat.site, forTask)
      .then(function (rows) {
        _bannerBusy = false;
        if (!_beat || _beat.taskUuid !== forTask) return;
        _storeOthers = activeOthers(rows, me.staffId, Date.now(), PRESENCE_TTL_MS);
        paintOccupied();
      })
      .catch(function (e) {
        _bannerBusy = false;
        log('banner read failed', e && e.message);
      });
  }
  setInterval(refreshBanner, HEARTBEAT_MS);

  // No rate-limit: dropping a member_removed is a false occupied bar (worse
  // than duplicate work — it delays care). Latest event always wins.
  // Cache the last detail: identity stamp can lag the first presence event
  // by a couple of seconds; without a replay we'd miss a colleague forever
  // (page-world will not re-emit an unchanged member list).
  var _lastNativeDetail = null;
  function applyNativePresence() {
    var ctx = parseTaskOverviewPath(location.pathname);
    var me = myIdentity();
    var expected = ctx ? ctx.taskUuid : '';
    if (!expected) {
      _nativeOthers = [];
      _nativeTaskUuid = '';
      _lastNativeDetail = null;
      _firstSeen = {};
      paintOccupied();
      return;
    }
    _nativeTaskUuid = expected;
    if (!me) {
      _nativeOthers = [];
      paintOccupied();
      return;
    }
    _nativeOthers = sanitizeNativePresence(_lastNativeDetail, me.staffId, expected);
    paintOccupied();
  }
  window.addEventListener('ch-native-task-presence', function (e) {
    _lastNativeDetail = e && e.detail && typeof e.detail === 'object' ? e.detail : null;
    applyNativePresence();
  });
  try {
    new MutationObserver(function () {
      applyNativePresence();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-ch-staff'] });
  } catch (_) {}

  // ── LAYER 1 + 2c: queue chips ─────────────────────────────────────────────
  // Bridge rows arrive per task-list response; each event's rows replace the
  // map wholesale (a fresh payload is authoritative for the grid's current
  // order — same stance as content.js's bridge listener).
  var _rows = new Map(); // rowIndex → sanitized row
  var _presence = new Map(); // taskUuid → [activeOthers entries]
  var _bridgeCount = 0;
  var _bridgeTimer = null;

  window.addEventListener('ch-task-list-data', function (e) {
    // Rate-limit + validate: bridged detail is untrusted (see content.js).
    _bridgeCount++;
    if (!_bridgeTimer) {
      _bridgeTimer = setTimeout(function () {
        _bridgeCount = 0;
        _bridgeTimer = null;
      }, 5000);
    }
    if (_bridgeCount > 10) return;
    var detail = e && e.detail;
    if (!detail || !Array.isArray(detail.rows)) return;
    _rows.clear();
    var capped = detail.rows.length > 500 ? detail.rows.slice(0, 500) : detail.rows;
    for (var i = 0; i < capped.length; i++) {
      var row = sanitizeBridgeRow(capped[i]);
      if (row) _rows.set(row.rowIndex, row);
    }
    scheduleInject();
    pollQueuePresence();
  });

  function onQueuePage() {
    return /\/tasks\/[^/]+\/task-list/.test(location.pathname);
  }

  function chipHost(row) {
    // The patient-name cell — same final fallback host as content.js's
    // decoration chips. Chips are width-capped in CSS so they can't push the
    // name out of the fixed-width cell.
    return row.querySelector('[col-id="patientName"]');
  }

  function injectQueueChips() {
    if (!onQueuePage() || !_rows.size) return;
    _rows.forEach(function (data, rowIndex) {
      var row = document.querySelector('.ag-row[row-index="' + rowIndex + '"]:not(.ag-full-width-row)');
      if (!row) return;
      var host = chipHost(row);
      if (!host) return;
      var others = _presence.get(data.taskUuid) || [];
      var presenceTxt = presenceChipText(others);
      var actionedTxt = actionedChipText(data.actionedBy, data.actionedDateTime);
      var existing = host.querySelector('.ms-tp-chips');
      if (!presenceTxt && !actionedTxt) {
        if (existing) existing.remove();
        return;
      }
      var sig = presenceTxt + '||' + actionedTxt;
      if (existing && existing.getAttribute('data-sig') === sig) return; // idempotent re-inject
      var wrap = existing || document.createElement('span');
      wrap.className = 'ms-tp-chips';
      wrap.setAttribute('data-sig', sig);
      var html = '';
      if (presenceTxt) {
        html +=
          '<span class="ms-tp-chip ms-tp-chip-presence" title="A colleague has this request open right now (Suite advisory — absence of this chip does not mean nobody has it open)">' +
          esc(presenceTxt) +
          '</span>';
      }
      if (actionedTxt) {
        html +=
          '<span class="ms-tp-chip ms-tp-chip-actioned" title="Last actioned by ' +
          esc(data.actionedBy) +
          (data.actionedDateTime ? ' — ' + esc(data.actionedDateTime) : '') +
          '">' +
          esc(actionedTxt) +
          '</span>';
      }
      wrap.innerHTML = html;
      // PREPEND, never append — Vue strips trailing foreign nodes on re-render.
      if (!existing) host.insertBefore(wrap, host.firstChild);
    });
  }

  // Re-inject on grid churn, coalesced to one rAF like the sibling observers.
  var _injectScheduled = false;
  function scheduleInject() {
    if (_injectScheduled || document.hidden) return;
    _injectScheduled = true;
    requestAnimationFrame(function () {
      _injectScheduled = false;
      try {
        injectQueueChips();
      } catch (e) {
        log('inject failed', e && e.message);
      }
    });
  }

  var _lastQueuePoll = 0;
  var _queuePollBusy = false;
  function pollQueuePresence(force) {
    if (!onQueuePage() || !presenceReady() || document.hidden || _queuePollBusy) return;
    if (!force && Date.now() - _lastQueuePoll < QUEUE_POLL_MS - 500) return;
    var me = myIdentity();
    if (!me || !_rows.size) return;
    var site = (location.pathname.split('/').filter(Boolean)[0] || '').toLowerCase();
    if (!site) return;
    var uuids = [];
    _rows.forEach(function (d) {
      uuids.push(d.taskUuid);
    });
    _queuePollBusy = true;
    _lastQueuePoll = Date.now();
    readManyRows(site, uuids)
      .then(function (rows) {
        _queuePollBusy = false;
        _presence.clear();
        if (Array.isArray(rows)) {
          var byTask = {};
          for (var i = 0; i < rows.length; i++) {
            var t = rows[i] && rows[i].task_uuid;
            if (typeof t !== 'string' || !UUID_RE.test(t)) continue;
            (byTask[t.toLowerCase()] = byTask[t.toLowerCase()] || []).push(rows[i]);
          }
          for (var k in byTask) {
            if (!Object.prototype.hasOwnProperty.call(byTask, k)) continue;
            var others = activeOthers(byTask[k], me.staffId, Date.now(), PRESENCE_TTL_MS);
            if (others.length) _presence.set(k, others);
          }
        }
        scheduleInject();
      })
      .catch(function (e) {
        _queuePollBusy = false;
        log('queue presence read failed', e && e.message);
      });
  }
  setInterval(function () {
    pollQueuePresence();
  }, QUEUE_POLL_MS);

  // ── SPA navigation + grid churn wiring ────────────────────────────────────
  var _lastHref = location.href;
  function onMaybeNavigated() {
    if (location.href !== _lastHref) {
      _lastHref = location.href;
      var ctx = parseTaskOverviewPath(location.pathname);
      if (!ctx || ctx.taskUuid !== _nativeTaskUuid) {
        _nativeOthers = [];
        _nativeTaskUuid = ctx ? ctx.taskUuid : '';
        _firstSeen = {};
        _storeOthers = [];
        _lastNativeDetail = null;
      }
      syncBeacon();
      if (_beat) refreshBanner();
    }
    applyNativePresence();
    scheduleInject();
  }

  var hub = window.__chObserverHub;
  if (hub && hub.subscribe) {
    hub.subscribe(onMaybeNavigated);
  } else {
    var obs = new MutationObserver(onMaybeNavigated);
    if (document.body) obs.observe(document.body, { childList: true, subtree: true });
  }
  window.addEventListener('popstate', onMaybeNavigated);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncBeacon);
  } else {
    syncBeacon();
  }

  // Safety-net rescan (same rationale as the sibling widgets): SPA route
  // changes without history events, and grids rendered after a quiet gap.
  setInterval(function () {
    if (!document.hidden) onMaybeNavigated();
  }, 5000);

  log('task-presence installed');
})();
