// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — task presence: "is someone already on this request?"
//
// PURPOSE (user request 2026-08-04; native hook found 2026-09-07): two
// clinicians can open the same triage request without either knowing the
// other is in it. August 2026 capture found no Medicus signal. September
// 2026: Medicus now subscribes to presence-{site}-task-{taskUuid} (member
// id = staff UUID; stock pusher:member_added / member_removed). Layer 0
// reads that channel via page-world.js and paints an occupied masthead on
// the open request — no shared store required. On a task-list page it also
// reads presence-{site}-task-list-{slug} and paints a compact named notice
// in the title row (list occupancy, never a per-request occupant). Layers
// 1–2 below remain for queue chips / practices still on the folder/Supabase
// transport.
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
//   - The strip says they have it open and you can still work it. It never
//     claims exclusivity, never blocks Medicus's own UI, and never asks the
//     second clinician to leave — the two-GPs-collide failure is wasted
//     duplicate work, and the fix is awareness, not enforcement.
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

  function parseTaskListPath(path) {
    if (typeof path !== 'string') return null;
    var m = path.match(/^\/([0-9a-z]{2,})\/tasks\/(?:data\/)?([A-Za-z0-9_-]{1,80})\/task-list\/?$/i);
    if (!m) return null;
    return { site: m[1].toLowerCase(), slug: m[2] };
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

  // Fallback when member.info is empty. Never "Someone else" — that reads
  // like a named person we chose not to identify.
  function unknownColleagueLabel() {
    return 'A colleague';
  }

  function isUnknownColleagueLabel(s) {
    var t = typeof s === 'string' ? s.trim() : '';
    if (!t) return true;
    var lower = t.toLowerCase();
    return (
      lower === 'a colleague' ||
      lower === 'a colleague (name not shown)' ||
      lower === 'someone else' ||
      lower === 'someone'
    );
  }

  // Prefer a previously-known staff label over the unknown-colleague fallback
  // when native member.info is empty. knownMap is staffId → display label
  // (store heartbeats + prior native names). Never invent a name.
  function preferKnownLabel(label, staffId, knownMap) {
    var current = typeof label === 'string' ? label.trim() : '';
    if (current && !isUnknownColleagueLabel(current)) return current.slice(0, 60);
    var known = '';
    if (knownMap && typeof staffId === 'string') {
      var k = knownMap[staffId] || knownMap[String(staffId).toLowerCase()];
      if (typeof k === 'string') known = k.trim();
    }
    if (known && !isUnknownColleagueLabel(known)) return known.slice(0, 60);
    return unknownColleagueLabel();
  }

  function rememberKnownLabel(staffId, label, knownMap) {
    if (!knownMap || typeof staffId !== 'string' || !staffId) return knownMap;
    var s = typeof label === 'string' ? label.trim() : '';
    if (!s || isUnknownColleagueLabel(s)) return knownMap;
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

  // presence-{site}-task-list-{slug} only. Rejects the per-request channel
  // presence-{site}-task-{uuid} and an empty slug.
  function parsePresenceListChannel(name) {
    if (typeof name !== 'string') return null;
    var m = name.match(/^presence-([0-9a-z]{2,})-task-list-(.+)$/i);
    if (!m) return null;
    var slug = typeof m[2] === 'string' ? m[2].trim() : '';
    if (!slug) return null;
    return { site: m[1].toLowerCase(), slug: slug };
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
      if (!label) label = unknownColleagueLabel();
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

  // Untrusted ch-native-list-presence detail → other clinicians on THIS list.
  // Same member rules as sanitizeNativePresence. List members carry listSlug,
  // never a request UUID — othersOnTask must not treat them as occupants.
  function sanitizeNativeListPresence(detail, myStaffId, expectedSlug) {
    if (!detail || typeof detail !== 'object') return [];
    if (detail.live === false) return [];
    if (typeof myStaffId !== 'string' || !UUID_RE.test(myStaffId)) return [];
    if (typeof expectedSlug !== 'string' || !expectedSlug) return [];
    if (typeof detail.slug !== 'string' || !detail.slug) return [];
    var slug = detail.slug;
    if (slug.toLowerCase() !== expectedSlug.toLowerCase()) return [];
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
      if (!label) label = unknownColleagueLabel();
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
        listSlug: slug,
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

  // 1 name; 2 "A and B"; 3 "A, B and C"; 4+ "A, B, C and N others".
  function occupiedNameList(names) {
    if (!Array.isArray(names) || !names.length) return '';
    var n = names.length;
    if (n === 1) return names[0];
    if (n === 2) return names[0] + ' and ' + names[1];
    if (n === 3) return names[0] + ', ' + names[1] + ' and ' + names[2];
    var rest = n - 3;
    return names[0] + ', ' + names[1] + ', ' + names[2] + ' and ' + rest + (rest === 1 ? ' other' : ' others');
  }

  // Margaret read peach as a lock. "Note:" is the heading saying this is
  // a note that a colleague is looking — never the word "lock".
  function withNoteLead(body) {
    if (!body) return '';
    return 'Note: ' + body;
  }

  // Who + instruction as ONE sentence. Native recency is the pulse pip,
  // not a word — "On it now" / "is on this request" read as leave it.
  function occupiedHeadline(others) {
    if (!Array.isArray(others) || !others.length) return '';
    if (others.length === 1 && others[0] && others[0].selfExtra) {
      return withNoteLead('You also have this open somewhere else. You can still work it.');
    }
    var named = [];
    var unknownCount = 0;
    for (var i = 0; i < others.length; i++) {
      var s = others[i] && others[i].label;
      var t = typeof s === 'string' ? s.trim() : '';
      if (!t || isUnknownColleagueLabel(t)) unknownCount++;
      else named.push(t);
    }
    var work = ' You can still work it.';
    if (!named.length) {
      if (unknownCount === 1) return withNoteLead('A colleague has this open.' + work);
      if (unknownCount === 2) return withNoteLead('Two colleagues have this open (names not shown).' + work);
      return withNoteLead(unknownCount + ' colleagues have this open (names not shown).' + work);
    }
    var shown = named.slice();
    if (unknownCount === 1) shown.push('a colleague');
    else if (unknownCount > 1) {
      if (named.length >= 3) {
        var more = named.length - 3 + unknownCount;
        return withNoteLead(
          named[0] +
            ', ' +
            named[1] +
            ', ' +
            named[2] +
            ' and ' +
            more +
            (more === 1 ? ' other' : ' others') +
            ' have this open.' +
            work
        );
      }
      if (named.length === 1) {
        var col = unknownCount === 2 ? 'two colleagues' : unknownCount + ' colleagues';
        return withNoteLead(named[0] + ' and ' + col + ' have this open.' + work);
      }
      return withNoteLead(
        named[0] +
          ', ' +
          named[1] +
          ' and ' +
          unknownCount +
          (unknownCount === 1 ? ' other' : ' others') +
          ' have this open.' +
          work
      );
    }
    var who = occupiedNameList(shown);
    return withNoteLead(who + (shown.length === 1 ? ' has this open.' : ' have this open.') + work);
  }

  // Same name-list rules as occupiedHeadline, list-level verb.
  function listOccupiedHeadline(others) {
    if (!Array.isArray(others) || !others.length) return '';
    var named = [];
    var unknownCount = 0;
    for (var i = 0; i < others.length; i++) {
      var s = others[i] && others[i].label;
      var t = typeof s === 'string' ? s.trim() : '';
      if (!t || isUnknownColleagueLabel(t)) unknownCount++;
      else named.push(t);
    }
    var work = ' You can still work it.';
    if (!named.length) {
      if (unknownCount === 1) return withNoteLead('A colleague is also on this list.' + work);
      if (unknownCount === 2) return withNoteLead('Two colleagues are also on this list (names not shown).' + work);
      return withNoteLead(unknownCount + ' colleagues are also on this list (names not shown).' + work);
    }
    var shown = named.slice();
    if (unknownCount === 1) shown.push('a colleague');
    else if (unknownCount > 1) {
      if (named.length >= 3) {
        var more = named.length - 3 + unknownCount;
        return withNoteLead(
          named[0] +
            ', ' +
            named[1] +
            ', ' +
            named[2] +
            ' and ' +
            more +
            (more === 1 ? ' other' : ' others') +
            ' are also on this list.' +
            work
        );
      }
      if (named.length === 1) {
        var col = unknownCount === 2 ? 'two colleagues' : unknownCount + ' colleagues';
        return withNoteLead(named[0] + ' and ' + col + ' are also on this list.' + work);
      }
      return withNoteLead(
        named[0] +
          ', ' +
          named[1] +
          ' and ' +
          unknownCount +
          (unknownCount === 1 ? ' other' : ' others') +
          ' are also on this list.' +
          work
      );
    }
    if (shown.length >= 3) {
      var restN = shown.length - 2;
      return withNoteLead(
        shown[0] +
          ', ' +
          shown[1] +
          ' and ' +
          restN +
          (restN === 1 ? ' other' : ' others') +
          ' are also on this list.' +
          work
      );
    }
    var who = occupiedNameList(shown);
    return withNoteLead(
      who + (shown.length === 1 ? ' is also on this list.' : ' are also on this list.') + work
    );
  }

  function listOccupiedBannerTitle() {
    return 'A colleague has this list open. They are not assigned the pile. You can still work it.';
  }

  // Visible strip no longer uses a separate action line — occupiedHeadline
  // already ends "You can still work it." Kept as an empty hook for tests.
  function occupiedAction() {
    return '';
  }

  function occupiedBannerTitle(others) {
    if (Array.isArray(others) && others.length && others[0] && others[0].selfExtra) {
      return 'You also have this open somewhere else. This tab is not the only one. You can still work it.';
    }
    return 'A colleague has this request open. It is not assigned to them. You can still work it.';
  }

  function occupancyHideHint() {
    return 'Hide this warning until someone else joins. It comes back if the people change.';
  }

  // Store-backed recency only ("Seen N min ago"). Native membership is live
  // NOW — the orange pulse pip is the recency signal, not a word.
  function occupiedNote(others, nowMs) {
    if (!Array.isArray(others) || !others.length) return '';
    var native = false;
    for (var i = 0; i < others.length; i++) {
      if (others[i] && others[i].native) native = true;
    }
    if (native) return '';
    var opened = others[0].openedAtMs;
    var ago = minutesAgoText(typeof opened === 'number' ? opened : nowMs, nowMs);
    if (ago === 'just now') return '';
    return 'Seen ' + ago;
  }

  function sanitizeSelfExtras(detail, myStaffId, expectedTaskUuid) {
    if (!detail || typeof detail !== 'object') return 0;
    if (detail.live === false) return 0;
    if (typeof myStaffId !== 'string' || !UUID_RE.test(myStaffId)) return 0;
    if (typeof expectedTaskUuid !== 'string' || !UUID_RE.test(expectedTaskUuid)) return 0;
    if (typeof detail.taskUuid !== 'string' || !UUID_RE.test(detail.taskUuid)) return 0;
    if (detail.taskUuid.toLowerCase() !== expectedTaskUuid.toLowerCase()) return 0;
    var n = detail.selfExtras;
    if (typeof n !== 'number' || !isFinite(n) || n < 1) return 0;
    return Math.min(20, Math.floor(n));
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
      parseTaskListPath: parseTaskListPath,
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
      sanitizeNativeListPresence: sanitizeNativeListPresence,
      parsePresenceTaskChannel: parsePresenceTaskChannel,
      parsePresenceListChannel: parsePresenceListChannel,
      othersOnTask: othersOnTask,
      occupiedHeadline: occupiedHeadline,
      listOccupiedHeadline: listOccupiedHeadline,
      occupiedAction: occupiedAction,
      occupiedNote: occupiedNote,
      occupiedNameList: occupiedNameList,
      occupiedBannerTitle: occupiedBannerTitle,
      listOccupiedBannerTitle: listOccupiedBannerTitle,
      occupancyHideHint: occupancyHideHint,
      occupiedInnerHtml: occupiedInnerHtml,
      listOccupiedInnerHtml: listOccupiedInnerHtml,
      unknownColleagueLabel: unknownColleagueLabel,
      isUnknownColleagueLabel: isUnknownColleagueLabel,
      preferKnownLabel: preferKnownLabel,
      rememberKnownLabel: rememberKnownLabel,
      occupancyDismissKey: occupancyDismissKey,
      occupancyDismissValue: occupancyDismissValue,
      occupancyIsDismissed: occupancyIsDismissed,
      occupancyWriteDismiss: occupancyWriteDismiss,
      sanitizeSelfExtras: sanitizeSelfExtras,
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
  var LIST_ID = 'ms-tp-list';
  var _nativeOthers = [];
  var _nativeTaskUuid = '';
  var _selfExtras = 0;
  var _storeOthers = [];
  var _firstSeen = {}; // staffId → first-seen ms on this overview (this-tab dwell)
  var _knownLabels = {}; // staffId → last known display label (store + native)
  var _paintCache = { path: '', sig: '', parent: null };
  var _liveIds = '';
  var _nativeListOthers = [];
  var _nativeListSlug = '';
  var _lastNativeListDetail = null;
  var _listPaintCache = { slug: '', sig: '', parent: null };
  var _listLiveIds = '';
  var _hiddenNativeList = [];

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
        initials = isUnknownColleagueLabel(label) ? '?' : initialsFromLabel(label);
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
        var avTitle = isUnknownColleagueLabel(o.label) ? 'A colleague (name not shown)' : o.label;
        return (
          '<span class="ms-tp-av' +
          extra +
          '" title="' +
          esc(avTitle) +
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
    var recencyHtml = '';
    if (nativeLive) {
      recencyHtml = '<span class="ms-tp-recency"><span class="ms-tp-live" aria-hidden="true"></span></span>';
    } else if (recency) {
      recencyHtml = '<span class="ms-tp-recency">' + esc(recency) + '</span>';
    }
    var hideHint = occupancyHideHint();
    var action = occupiedAction(others);
    var actionHtml = action ? '<span class="ms-tp-action">' + esc(action) + '</span>' : '';
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
      actionHtml +
      '<button type="button" class="ms-tp-hide" title="' +
      esc(hideHint) +
      '" aria-label="' +
      esc(hideHint) +
      '">Hide for now</button>' +
      '</span>'
    );
  }

  function listOccupiedInnerHtml(others) {
    var list = Array.isArray(others) ? others : [];
    var many = list.length > 1 ? ' ms-tp-avs-many' : '';
    var extraCount = list.length > 3 ? list.length - 3 : 0;
    var avatars = list
      .slice(0, 3)
      .map(function (o, i) {
        var extra = o.initials === '?' ? ' ms-tp-av-unknown' : '';
        var hue = o.initials === '?' ? '' : safeAvatarHue(o.hue);
        var bg = hue ? 'background:' + hue + ';' : '';
        var avTitle = isUnknownColleagueLabel(o.label) ? 'A colleague (name not shown)' : o.label;
        return (
          '<span class="ms-tp-av' +
          extra +
          '" title="' +
          esc(avTitle) +
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
    var full = listOccupiedHeadline(list);
    var quiet = 'You can still work it.';
    var lead = full;
    if (full.slice(-quiet.length - 1) === ' ' + quiet) {
      lead = full.slice(0, -(quiet.length + 1));
    } else {
      quiet = '';
    }
    return (
      '<span class="ms-tp-inner">' +
      '<span class="ms-tp-avs' +
      many +
      '">' +
      avatars +
      '</span>' +
      '<span class="ms-tp-who">' +
      esc(lead) +
      (quiet ? ' <span class="ms-tp-quiet">' + esc(quiet) + '</span>' : '') +
      '</span>' +
      '<span class="ms-tp-recency"><span class="ms-tp-live" aria-hidden="true"></span></span>' +
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

  function selfExtraOccupants(taskUuid) {
    var me = myIdentity();
    var sid = me && me.staffId ? me.staffId : 'self';
    var initials = '?';
    var label = 'You';
    if (me && me.email) {
      var fromEmail = displayLabel('', me.email);
      if (fromEmail) initials = initialsFromLabel(fromEmail);
    }
    return [
      {
        staffId: sid,
        label: label,
        initials: initials,
        hue: avatarHue(sid),
        native: true,
        selfExtra: true,
        taskUuid: taskUuid,
      },
    ];
  }

  function paintOccupied() {
    var path = location.pathname;
    var ctx = parseTaskOverviewPath(path);
    var others = ctx ? othersOnTask(mergedOthers(), ctx.taskUuid) : [];
    var nowMs = Date.now();
    if (ctx && !others.length && _selfExtras >= 1) {
      others = selfExtraOccupants(ctx.taskUuid);
    }
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
    var title = occupiedBannerTitle(others);
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
      el.setAttribute('tabindex', '-1');
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
    el.setAttribute('tabindex', '-1');
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
      _selfExtras = 0;
      _lastNativeDetail = null;
      _firstSeen = {};
      paintOccupied();
      return;
    }
    _nativeTaskUuid = expected;
    if (!me) {
      _nativeOthers = [];
      _selfExtras = 0;
      paintOccupied();
      return;
    }
    _nativeOthers = sanitizeNativePresence(_lastNativeDetail, me.staffId, expected);
    _selfExtras = sanitizeSelfExtras(_lastNativeDetail, me.staffId, expected);
    paintOccupied();
  }
  window.addEventListener('ch-native-task-presence', function (e) {
    _lastNativeDetail = e && e.detail && typeof e.detail === 'object' ? e.detail : null;
    applyNativePresence();
  });
  try {
    new MutationObserver(function () {
      applyNativePresence();
      applyNativeListPresence();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-ch-staff'] });
  } catch (_) {}

  // ── List occupancy (native Pusher presence-{site}-task-list-{slug}) ────────
  // Advisory only. Never a per-request occupant — do not feed these members
  // into #ms-tp-banner or per-row 👁 chips.
  function restoreNativeListWidgets() {
    for (var i = 0; i < _hiddenNativeList.length; i++) {
      var rec = _hiddenNativeList[i];
      var n = rec && rec.node;
      if (!n) continue;
      try {
        n.style.display = rec.display;
        n.style.visibility = rec.visibility;
        n.removeAttribute('aria-hidden');
        n.removeAttribute('data-ms-tp-list-hidden');
      } catch (_) {}
    }
    _hiddenNativeList = [];
  }

  function hideNativeListWidget(node) {
    if (!node || node.id === LIST_ID || (node.closest && node.closest('#' + LIST_ID))) return;
    try {
      if (node.getAttribute('data-ms-tp-list-hidden') === '1') {
        node.style.display = 'none';
        node.style.visibility = 'hidden';
        node.setAttribute('aria-hidden', 'true');
        return;
      }
      _hiddenNativeList.push({
        node: node,
        display: node.style.display,
        visibility: node.style.visibility,
      });
      node.setAttribute('data-ms-tp-list-hidden', '1');
      node.style.display = 'none';
      node.style.visibility = 'hidden';
      node.setAttribute('aria-hidden', 'true');
    } catch (_) {}
  }

  function findNativeListPresenceNode() {
    var root = document.body;
    if (!root) return null;
    var best = null;
    var bestLen = Infinity;
    var nodes = root.querySelectorAll('span, div, p, button, li, a, strong, em, small');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!el || el.id === LIST_ID) continue;
      if (el.closest && el.closest('#' + LIST_ID)) continue;
      var text = '';
      try {
        text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      } catch (_) {
        continue;
      }
      if (!text || text.length > 160) continue;
      if (!/working this list/i.test(text)) continue;
      if (text.length < bestLen) {
        best = el;
        bestLen = text.length;
      }
    }
    if (!best) return null;
    var node = best;
    while (node.parentNode && node.parentNode.nodeType === 1) {
      var parent = node.parentNode;
      if (parent.id === LIST_ID) break;
      var pt = '';
      try {
        pt = (parent.textContent || '').replace(/\s+/g, ' ').trim();
      } catch (_) {
        break;
      }
      if (pt.length > 100) break;
      if (!/working this list/i.test(pt)) break;
      node = parent;
    }
    return node;
  }

  function findListTitleHost() {
    var native = findNativeListPresenceNode();
    if (native && native.parentNode) return { host: native.parentNode, native: native, titleEl: null };
    var q = document.getElementById('queueTitle');
    if (q && q.parentNode) return { host: q.parentNode, native: null, titleEl: q };
    var main = document.querySelector('main') || document.body;
    if (!main) return null;
    var heading = main.querySelector('h1, h2');
    if (heading && heading.parentNode) {
      var hTop = 0;
      try {
        hTop = heading.getBoundingClientRect().top;
      } catch (_) {}
      if (hTop < 260) return { host: heading.parentNode, native: null, titleEl: heading };
    }
    var titled = main.querySelectorAll('[class*="title"], [class*="Title"]');
    for (var t = 0; t < titled.length && t < 24; t++) {
      var el = titled[t];
      if (!el || !el.parentNode) continue;
      if (el.id === LIST_ID || (el.closest && el.closest('#' + LIST_ID))) continue;
      var top = 9999;
      try {
        top = el.getBoundingClientRect().top;
      } catch (_) {}
      if (top >= 0 && top < 220) return { host: el.parentNode, native: null, titleEl: el };
    }
    return null;
  }

  function placeListStrip(el, found) {
    var host = found.host;
    var native = found.native;
    var titleEl = found.titleEl;
    if (native && native.parentNode) {
      if (el.parentNode !== native.parentNode || el.nextSibling !== native) {
        native.parentNode.insertBefore(el, native);
      }
      return;
    }
    if (titleEl && titleEl.parentNode === host) {
      var after = titleEl.nextSibling;
      if (el.parentNode !== host || el.previousSibling !== titleEl) {
        host.insertBefore(el, after);
      }
      return;
    }
    if (host && el.parentNode !== host) {
      host.insertBefore(el, host.firstChild);
    }
  }

  function removeListStrip() {
    restoreNativeListWidgets();
    var el = document.getElementById(LIST_ID);
    if (el) el.remove();
    _listPaintCache = { slug: '', sig: '', parent: null };
    _listLiveIds = '';
  }

  function mergeListOthers(raw) {
    var out = [];
    if (!Array.isArray(raw)) return out;
    for (var i = 0; i < raw.length; i++) {
      var n = raw[i];
      if (!n || !n.staffId) continue;
      rememberKnownLabel(n.staffId, n.label, _knownLabels);
      var label = preferKnownLabel(n.label, n.staffId, _knownLabels);
      var initials = n.initials;
      if (label !== n.label) {
        initials = isUnknownColleagueLabel(label) ? '?' : initialsFromLabel(label);
      }
      out.push({
        staffId: n.staffId,
        label: label,
        initials: initials,
        hue: n.hue || avatarHue(n.staffId),
        listSlug: n.listSlug,
        native: true,
      });
    }
    return out;
  }

  function paintListOccupied() {
    var path = location.pathname;
    var ctx = parseTaskListPath(path);
    var others = ctx ? mergeListOthers(_nativeListOthers) : [];
    if (ctx && others.length) {
      var keep = [];
      for (var i = 0; i < others.length; i++) {
        var o = others[i];
        if (!o) continue;
        if (typeof o.listSlug === 'string' && o.listSlug.toLowerCase() !== ctx.slug.toLowerCase()) continue;
        keep.push(o);
      }
      others = keep;
    }
    var headline = others.length ? listOccupiedHeadline(others) : '';
    var sig = (ctx ? ctx.slug : '') + '|' + staffIdList(others).join(',') + '|' + headline;
    var extras = document.querySelectorAll('#' + LIST_ID);
    for (var d = 1; d < extras.length; d++) {
      try {
        extras[d].remove();
      } catch (_) {}
    }
    var el = extras[0] || document.getElementById(LIST_ID);
    if (!ctx || !others.length) {
      if (!el && _listPaintCache.sig === sig && _listPaintCache.slug === (ctx ? ctx.slug : '')) return;
      removeListStrip();
      _listPaintCache = { slug: ctx ? ctx.slug : '', sig: sig, parent: null };
      return;
    }
    var found = findListTitleHost();
    if (!found || !found.host) {
      if (el) removeListStrip();
      return;
    }
    if (
      el &&
      _listPaintCache.slug === ctx.slug &&
      _listPaintCache.sig === sig &&
      el.parentNode &&
      el.parentNode === _listPaintCache.parent &&
      el.parentNode === found.host
    ) {
      if (found.native) hideNativeListWidget(found.native);
      return;
    }
    var html = listOccupiedInnerHtml(others);
    var title = listOccupiedBannerTitle();
    var idSet = staffIdList(others).slice().sort().join(',');
    if (el) {
      var inner = el.querySelector('.ms-tp-inner');
      if (inner) inner.outerHTML = html;
      else el.insertAdjacentHTML('afterbegin', html);
      el.setAttribute('data-sig', sig);
      el.setAttribute('title', title);
      el.className = 'ms-tp-list';
      var sr = el.querySelector('.ms-tp-sr');
      if (!sr) {
        sr = document.createElement('span');
        sr.className = 'ms-tp-sr';
        sr.setAttribute('role', 'status');
        sr.setAttribute('aria-live', 'polite');
        el.appendChild(sr);
      }
      if (idSet !== _listLiveIds) {
        sr.textContent = headline;
        _listLiveIds = idSet;
      }
      placeListStrip(el, found);
      if (found.native) hideNativeListWidget(found.native);
      _listPaintCache = { slug: ctx.slug, sig: sig, parent: el.parentNode };
      return;
    }
    el = document.createElement('span');
    el.id = LIST_ID;
    el.className = 'ms-tp-list';
    el.setAttribute('title', title);
    el.setAttribute('data-sig', sig);
    el.innerHTML = html + '<span class="ms-tp-sr" role="status" aria-live="polite"></span>';
    var srNew = el.querySelector('.ms-tp-sr');
    if (srNew) srNew.textContent = headline;
    _listLiveIds = idSet;
    placeListStrip(el, found);
    if (found.native) hideNativeListWidget(found.native);
    _listPaintCache = { slug: ctx.slug, sig: sig, parent: el.parentNode };
  }

  function applyNativeListPresence() {
    var ctx = parseTaskListPath(location.pathname);
    var me = myIdentity();
    var expected = ctx ? ctx.slug : '';
    if (!expected) {
      _nativeListOthers = [];
      _nativeListSlug = '';
      _lastNativeListDetail = null;
      paintListOccupied();
      return;
    }
    _nativeListSlug = expected;
    if (!me) {
      _nativeListOthers = [];
      paintListOccupied();
      return;
    }
    _nativeListOthers = sanitizeNativeListPresence(_lastNativeListDetail, me.staffId, expected);
    paintListOccupied();
  }
  window.addEventListener('ch-native-list-presence', function (e) {
    _lastNativeListDetail = e && e.detail && typeof e.detail === 'object' ? e.detail : null;
    applyNativeListPresence();
  });

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
        _selfExtras = 0;
        _firstSeen = {};
        _storeOthers = [];
        _lastNativeDetail = null;
      }
      syncBeacon();
      if (_beat) refreshBanner();
    }
    applyNativePresence();
    applyNativeListPresence();
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
