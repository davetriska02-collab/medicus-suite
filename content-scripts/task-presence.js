// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — task presence: "is someone already on this request?"
//
// PURPOSE (user request 2026-08-04): two clinicians can open the same triage
// request without either knowing the other is in it. The live capture
// (docs/learnings-task-presence.md) proved Medicus offers nothing to build on:
// opening a request writes NOTHING (20 calls, all GETs), the status enum has
// no 'in-progress', and all 17 Pusher channels are public (so no presence
// channel exists and client events are impossible). Whatever signal exists has
// to be ours. This script provides two layers:
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
//     • opening a task someone else has open injects an advisory banner
//       ("<name> opened this N min ago — they may be working on it")
//   Presence is DORMANT until the practice configures a store URL + key in
//   Options → Task presence. Identity comes from the page's own Pusher
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
//   - The banner says "may be working on it". It never claims exclusivity,
//     never blocks Medicus's own UI, and never asks the second clinician to
//     leave — the two-GPs-collide failure is wasted duplicate work, and the
//     fix is awareness, not enforcement.
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
      buildPresenceInFilter: buildPresenceInFilter,
    };
    return; // node context: helpers only, no DOM/chrome wiring
  }

  // ── config (chrome.storage; dormant until the practice opts in) ───────────
  var _cfg = { enabled: false, url: '', key: '', name: '' };

  function refreshConfig() {
    try {
      chrome.storage.local.get(['presence.enabled', 'presence.url', 'presence.key', 'presence.name'], function (res) {
        if (chrome.runtime.lastError) return;
        _cfg = {
          enabled: res['presence.enabled'] === true,
          url: typeof res['presence.url'] === 'string' ? res['presence.url'].trim().replace(/\/+$/, '') : '',
          key: typeof res['presence.key'] === 'string' ? res['presence.key'].trim() : '',
          name: typeof res['presence.name'] === 'string' ? res['presence.name'] : '',
        };
      });
    } catch (_) {}
  }
  refreshConfig();
  try {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'local') return;
      if (
        changes['presence.enabled'] ||
        changes['presence.url'] ||
        changes['presence.key'] ||
        changes['presence.name']
      ) {
        refreshConfig();
      }
    });
  } catch (_) {}

  function presenceReady() {
    return validPresenceConfig(_cfg);
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
        storeDelete(b.site, b.taskUuid, me.staffId).catch(function (e) {
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
    storeUpsert(payload)
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

  // ── LAYER 2b: advisory banner on the open task ────────────────────────────
  var BANNER_ID = 'ms-tp-banner';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function removeBanner() {
    var el = document.getElementById(BANNER_ID);
    if (el) el.remove();
  }

  function renderBanner(others) {
    if (!others.length || !_beat) {
      removeBanner();
      return;
    }
    var now = Date.now();
    var parts = others.map(function (o) {
      return '<strong>' + esc(o.label) + '</strong> opened this ' + esc(minutesAgoText(o.openedAtMs, now));
    });
    var html =
      '<span class="ms-tp-banner-eye" aria-hidden="true">👁</span>' +
      '<span class="ms-tp-banner-text">' +
      parts.join('; ') +
      ' — they may be working on it. Check before duplicating the work.' +
      '<span class="ms-tp-banner-note">Suite advisory from colleagues’ open tabs — not a lock, and no banner does not mean no one.</span></span>';
    var el = document.getElementById(BANNER_ID);
    if (el) {
      if (el.getAttribute('data-sig') !== html.length + ':' + others.length) {
        el.innerHTML = html;
        el.setAttribute('data-sig', html.length + ':' + others.length);
      }
      return;
    }
    el = document.createElement('div');
    el.id = BANNER_ID;
    el.setAttribute('role', 'status');
    el.innerHTML = html;
    el.setAttribute('data-sig', html.length + ':' + others.length);
    // PREPEND into <main> (or body fallback) — trailing foreign nodes get
    // reconciled away by Vue; leading ones survive (CLAUDE.md queue-chip rule 1).
    var host = document.querySelector('main') || document.body;
    if (host) host.insertBefore(el, host.firstChild);
  }

  var _bannerBusy = false;
  function refreshBanner() {
    if (!_beat || !presenceReady() || document.hidden || _bannerBusy) return;
    var me = myIdentity();
    if (!me) return;
    _bannerBusy = true;
    var forTask = _beat.taskUuid;
    storeReadTask(_beat.site, forTask)
      .then(function (rows) {
        _bannerBusy = false;
        if (!_beat || _beat.taskUuid !== forTask) return; // navigated away mid-flight
        renderBanner(activeOthers(rows, me.staffId, Date.now(), PRESENCE_TTL_MS));
      })
      .catch(function (e) {
        _bannerBusy = false;
        log('banner read failed', e && e.message);
      });
  }
  setInterval(refreshBanner, HEARTBEAT_MS);

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
    storeReadMany(site, uuids)
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
      syncBeacon();
      removeBanner();
      if (_beat) refreshBanner();
    }
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
