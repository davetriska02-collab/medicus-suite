// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — patient-request overview free-text body field capture
//
// PURPOSE
//   Phase 0 discovery, gating Phase 2 (queue-level bracket classification) of
//   a new feature. Confirmed already (docs/learnings-triage-attachment-to-
//   document.md §8, ~lines 296-350): for `communication_thread_task`, the
//   per-task overview payload nests
//     data.communicationThread.communications[].patientRequest
//   with an `attachments[]` sub-array — but the MESSAGE-TEXT field name
//   inside `patientRequest` was never captured, and NOTHING is confirmed for
//   `medical_patient_request_task` / `admin_patient_request_task` — the task
//   types this feature actually targets. This script closes that gap:
//     Does GET /tasks/data/{typeSlug}/overview/{taskUuid} (or a row's own
//     `overviewURL` from /tasks/data/{typeSlug}/task-list) carry the
//     patient's free-text request body for those two task types, and under
//     exactly which field path?
//
// WHERE TO RUN
//   Logged-in Medicus tab, MAIN-world PAGE console (DevTools → Console — the
//   page's own console, NOT the extension's). Uses credentialed `fetch`
//   (`credentials: 'include'`) so it rides the page's own cookie/session
//   auth, replaying the same task-list → overview path the shipped code
//   already calls (`shared/request-monitor.js` buildApiUrl / BUCKETS) — it
//   invents no new endpoint.
//
//   URL construction follows scripts/task-presence-capture.js's apiBaseUrl(),
//   NOT shared/request-monitor.js's hardcoded '.api.england.medicus.health' —
//   that hardcode is env-specific; deriving the API host from the CURRENT
//   page's own hostname is what every other capture script in this repo does
//   and is more likely to be correct on whichever Medicus environment this is
//   pasted into. See ASSUMPTIONS below — this is the one most likely for a
//   live run to disprove.
//
// WHAT THIS SCRIPT DOES
//   1. Fetches the task-list for `medical_patient_request_task`, status
//      'new-request'; if that comes back empty, falls back through the other
//      status shared/request-monitor.js's BUCKETS actually polls
//      ('reply-received'). Takes at most 3 tasks from whichever status
//      first returns rows.
//   2. Repeats for `admin_patient_request_task`, max 2 tasks.
//   3. For each task, fetches its overview — preferring the row's own
//      `overviewURL` field if present, else constructing
//      `/tasks/data/{typeSlug}/overview/{id}`.
//   4. Fetches are SEQUENTIAL with a small delay between them (polite to the
//      live API — no parallel fan-out).
//   5. Logs a REDACTED STRUCTURAL MAP of each overview response (see PRIVACY
//      CONTRACT below) and flags candidate free-text fields.
//   6. Ends with ONE consolidated JSON summary you copy back.
//
// PRIVACY CONTRACT — read this before running, it is non-negotiable
//   This script's ENTIRE console output is a structural map, never content:
//     · every leaf of the walked response is logged as   path : type(length)
//       e.g.  data.communicationThread.communications[0].patientRequest.message: string(214)
//     · STRING VALUES ARE NEVER PRINTED — only their length.
//     · UUID-shaped strings are labelled  uuid(36)  — never treated as plain
//       strings, never printed.
//     · numbers/booleans/null print only their type, never their value.
//     · arrays are truncated to their first element + a "[+N more]" note —
//       the 2nd..Nth elements are NOT walked or printed at all.
//     · candidate free-text fields (string leaves ≥ 40 chars whose OWN key —
//       not the full path — matches /message|body|text|request|content|
//       description|comment/i) get an extra «CANDIDATE FREE-TEXT FIELD» flag
//       next to their path+length — still never their value.
//   Nothing else is logged: no patient names, no dates of birth, no NHS
//   numbers, no addresses, no free-text content, no raw JSON dump of any
//   response. If you need to verify a candidate field really is the message
//   body, do that by eye in the Medicus UI itself — do not modify this
//   script to print it.
//
// WHERE TO PASTE THE RESULTS
//   The script prints ONE `console.log(JSON.stringify(summary, null, 2))`
//   at the very end, prefixed with a "COPY FROM HERE" marker. Copy that JSON
//   block back into the conversation/PR that requested this capture. Nothing
//   earlier in the console output needs to be captured — the structural-map
//   tables are for your own live sanity-check while it runs.
//
// ASSUMPTIONS THIS SCRIPT MAKES (a live run may disprove any of these)
//   · Practice code = first path segment of location.pathname, API host =
//     `${code}.api.${location.hostname}` (task-presence-capture.js's fixed
//     apiBaseUrl() — see its header for why the naive "strip first label"
//     version is wrong).
//   · `masterAssignee` is NOT required on the task-list call — the existing
//     task-presence-capture.js probe fetched task-list successfully without
//     it. If your Medicus install 403s without it, re-run with
//     `chReqBody.assignee('<team-or-staff-uuid>')` before `.run()`.
//   · A relative `overviewURL` (starting with `/`) is relative to the API
//     host, not the page origin — unconfirmed for these two task types
//     specifically (confirmed only that `overviewURL` exists as a task-list
//     row field per docs/learnings-task-presence.md).
//   · Status fallback order mirrors shared/request-monitor.js's BUCKETS
//     exactly ('new-request' then 'reply-received') — the fuller status
//     enum in docs/learnings-task-presence.md ('awaiting-recipient-response',
//     'snoozed', 'resolved', 'rejected') is NOT tried, by design, since the
//     feature this gates only cares about actionable inbound requests.
//
// USAGE
//   1. Open any Medicus page on the practice you want to capture (does not
//      need to be a task page — the script builds its own URLs). DevTools →
//      Console (page console).
//   2. Paste this whole file, press Enter → "[reqbody] armed".
//   3. chReqBody.run()   ← does everything, prints tables as it goes, ends
//      with the copy-paste JSON summary.
//   4. If task-list 401/403s, see the printed message — you are either not
//      logged in or on the wrong host; re-check and re-run.

(function () {
  'use strict';
  if (window.chReqBody && window.chReqBody.__armed) {
    console.warn('[reqbody] already armed — call chReqBody.stop() first to re-arm (or just chReqBody.run() again)');
    return;
  }

  // ── config ──────────────────────────────────────────────────────────────
  var DELAY_MS = 400; // politeness delay between sequential fetches
  var MAX_DEPTH = 12; // structural-walk recursion cap
  var CANDIDATE_MIN_LEN = 40;
  var CANDIDATE_KEY_RE = /(message|body|text|request|content|description|comment)/i;
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  var TASK_TYPES = [
    { slug: 'medical_patient_request_task', label: 'medical', maxTasks: 3 },
    { slug: 'admin_patient_request_task', label: 'admin', maxTasks: 2 },
  ];
  // Status fallback order — exactly what shared/request-monitor.js's BUCKETS
  // polls for these two task types (medNew/medReply, adminNew/adminReply).
  var STATUS_FALLBACK = ['new-request', 'reply-received'];

  var assigneeId = null; // optional — see ASSUMPTIONS above

  // ── API host (same fixed logic as scripts/task-presence-capture.js) ───────
  function apiBaseUrl() {
    var parts = location.pathname.split('/').filter(Boolean);
    var code = parts[0] || '';
    return 'https://' + code + '.api.' + location.hostname;
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function absolutize(u) {
    if (!u) return u;
    if (/^https?:\/\//i.test(u)) return u;
    if (u.charAt(0) === '/') return apiBaseUrl() + u;
    return apiBaseUrl() + '/' + u;
  }

  // ── fetch helper — never throws, always resolves with a report shape ──────
  async function fetchReport(url) {
    var started = Date.now();
    try {
      var r = await fetch(url, { credentials: 'include' });
      var txt = await r.text();
      var json = null,
        parseError = null;
      if (txt) {
        try {
          json = JSON.parse(txt);
        } catch (e) {
          parseError = String(e && e.message ? e.message : e);
        }
      }
      return {
        url: url,
        status: r.status,
        ok: r.ok,
        ms: Date.now() - started,
        json: json,
        parseError: parseError,
        rawLength: txt ? txt.length : 0,
      };
    } catch (err) {
      return {
        url: url,
        status: 'ERROR',
        ok: false,
        ms: Date.now() - started,
        json: null,
        parseError: String(err && err.message ? err.message : err),
        rawLength: 0,
      };
    }
  }

  function authNote(status) {
    if (status === 401 || status === 403) {
      return (
        ' ← ' +
        status +
        ': not logged in, session expired, or wrong practice host (check location.hostname vs your Medicus login)'
      );
    }
    return '';
  }

  // ── structural walk — PRIVACY-CRITICAL, see header comment ────────────────
  // Emits { path, type, note, candidate } leaves only. NEVER carries a value.
  function lastKeyOf(path) {
    var m = path.match(/([A-Za-z0-9_]+)(\[[^\]]*\])?$/);
    return m ? m[1] : path;
  }

  function walk(node, path, out, depth) {
    if (depth > MAX_DEPTH) {
      out.push({ path: path, type: 'truncated', note: 'max depth ' + MAX_DEPTH + ' reached' });
      return;
    }
    if (node === null) {
      out.push({ path: path, type: 'null' });
      return;
    }
    if (Array.isArray(node)) {
      var note = 'array(' + node.length + ')' + (node.length > 1 ? ' [+' + (node.length - 1) + ' more]' : '');
      out.push({ path: path, type: 'array', note: note });
      if (node.length > 0) walk(node[0], path + '[0]', out, depth + 1);
      return;
    }
    var t = typeof node;
    if (t === 'object') {
      var keys = Object.keys(node);
      if (keys.length === 0) {
        out.push({ path: path, type: 'object', note: 'empty' });
        return;
      }
      keys.forEach(function (k) {
        var childPath = path ? path + '.' + k : k;
        walk(node[k], childPath, out, depth + 1);
      });
      return;
    }
    if (t === 'string') {
      if (UUID_RE.test(node)) {
        out.push({ path: path, type: 'uuid', note: 'uuid(36)' });
        return;
      }
      var len = node.length;
      var candidate = len >= CANDIDATE_MIN_LEN && CANDIDATE_KEY_RE.test(lastKeyOf(path));
      out.push({
        path: path,
        type: 'string',
        note: 'string(' + len + ')',
        candidate: candidate,
      });
      return;
    }
    // number / boolean / undefined / function / symbol / bigint
    out.push({
      path: path,
      type: t,
      note: t === 'number' || t === 'boolean' ? t + '(' + String(node).length + ')' : t,
    });
  }

  function printLeaves(label, leaves) {
    console.log(
      '%c[reqbody] structural map — ' + label + ' (' + leaves.length + ' leaves)',
      'color:#2a7;font-weight:bold'
    );
    console.table(
      leaves.map(function (l) {
        return {
          path: l.path,
          type: l.type,
          note: l.note || '',
          candidate: l.candidate ? '«CANDIDATE FREE-TEXT FIELD»' : '',
        };
      })
    );
  }

  // ── task-list fetch with status fallback ───────────────────────────────────
  function buildListUrl(slug, status) {
    var base = apiBaseUrl() + '/tasks/data/' + slug + '/task-list';
    var params = new URLSearchParams();
    params.append('statuses[]', status);
    params.append('viewContext', 'homepage');
    if (assigneeId) params.append('masterAssignee', assigneeId);
    return base + '?' + params.toString();
  }

  async function fetchTaskListWithFallback(slug) {
    for (var i = 0; i < STATUS_FALLBACK.length; i++) {
      var status = STATUS_FALLBACK[i];
      var url = buildListUrl(slug, status);
      console.log('[reqbody] task-list GET (' + slug + ', status=' + status + ')');
      var rep = await fetchReport(url);
      if (!rep.ok) {
        console.warn(
          '[reqbody] task-list ' +
            slug +
            '/' +
            status +
            ' → HTTP ' +
            rep.status +
            authNote(rep.status) +
            (rep.parseError ? ' parseError=' + rep.parseError : '')
        );
        // Auth failure is fatal for this task type — no point trying the next status.
        if (rep.status === 401 || rep.status === 403) {
          return { status: status, url: url, rep: rep, tasks: [], fatal: true };
        }
        await sleep(DELAY_MS);
        continue;
      }
      var tasks = (rep.json && (rep.json.tasks || rep.json.data || rep.json.items)) || [];
      if (!Array.isArray(tasks)) tasks = [];
      console.log(
        '[reqbody] task-list ' + slug + '/' + status + ' → HTTP ' + rep.status + ', ' + tasks.length + ' task(s)'
      );
      if (tasks.length > 0) {
        return { status: status, url: url, rep: rep, tasks: tasks, fatal: false };
      }
      await sleep(DELAY_MS);
    }
    return { status: STATUS_FALLBACK[STATUS_FALLBACK.length - 1], url: null, rep: null, tasks: [], fatal: false };
  }

  function overviewUrlFor(task, slug) {
    if (task && typeof task.overviewURL === 'string' && task.overviewURL) {
      return { url: absolutize(task.overviewURL), source: 'row.overviewURL' };
    }
    var id = task && task.id;
    return { url: apiBaseUrl() + '/tasks/data/' + slug + '/overview/' + id, source: 'constructed' };
  }

  // ── per-task-type pipeline ─────────────────────────────────────────────────
  async function processTaskType(cfg) {
    var result = {
      taskType: cfg.slug,
      listEndpoint: null,
      listStatusUsed: null,
      listHttpStatus: null,
      taskCount: 0,
      tasksSampled: 0,
      overviews: [],
      fatalListError: null,
    };

    var listResult = await fetchTaskListWithFallback(cfg.slug);
    result.listEndpoint = listResult.url ? listResult.url.replace(/^https?:\/\/[^/]+/, '') : null;
    result.listStatusUsed = listResult.status;
    result.listHttpStatus = listResult.rep ? listResult.rep.status : null;
    result.taskCount = listResult.tasks.length;
    if (listResult.fatal) {
      result.fatalListError =
        'HTTP ' + (listResult.rep && listResult.rep.status) + authNote(listResult.rep && listResult.rep.status);
      return result;
    }
    if (listResult.tasks.length === 0) {
      console.log(
        '[reqbody] ' + cfg.slug + ': no tasks found across any fallback status — nothing to fetch overviews for.'
      );
      return result;
    }

    var sample = listResult.tasks.slice(0, cfg.maxTasks);
    result.tasksSampled = sample.length;

    for (var i = 0; i < sample.length; i++) {
      var task = sample[i];
      var target = overviewUrlFor(task, cfg.slug);
      console.log(
        '[reqbody] overview GET (' +
          cfg.slug +
          ' task ' +
          (i + 1) +
          '/' +
          sample.length +
          ', source=' +
          target.source +
          ')'
      );
      var rep = await fetchReport(target.url);

      var entry = {
        taskIndex: i,
        overviewEndpoint: target.url.replace(/^https?:\/\/[^/]+/, ''),
        overviewUrlSource: target.source,
        httpStatus: rep.status,
        candidateFields: [],
        totalLeaves: 0,
        error: null,
      };

      if (!rep.ok) {
        entry.error =
          'HTTP ' + rep.status + authNote(rep.status) + (rep.parseError ? ' parseError=' + rep.parseError : '');
        console.warn('[reqbody] overview ' + cfg.slug + '[' + i + '] → ' + entry.error);
        result.overviews.push(entry);
        await sleep(DELAY_MS);
        continue;
      }
      if (rep.parseError || rep.json === null) {
        entry.error =
          'response was not parseable JSON (parseError=' + rep.parseError + ', rawLength=' + rep.rawLength + ')';
        console.warn('[reqbody] overview ' + cfg.slug + '[' + i + '] → ' + entry.error);
        result.overviews.push(entry);
        await sleep(DELAY_MS);
        continue;
      }

      var leaves = [];
      walk(rep.json, '', leaves, 0);
      entry.totalLeaves = leaves.length;
      entry.candidateFields = leaves
        .filter(function (l) {
          return l.candidate;
        })
        .map(function (l) {
          return { path: l.path, note: l.note };
        });

      printLeaves(cfg.slug + ' task ' + (i + 1) + '/' + sample.length + ' overview', leaves);
      if (entry.candidateFields.length) {
        console.log(
          '%c[reqbody] ' +
            entry.candidateFields.length +
            ' candidate free-text field(s) for ' +
            cfg.slug +
            ' task ' +
            (i + 1) +
            ':',
          'color:#a72;font-weight:bold'
        );
        console.table(entry.candidateFields);
      } else {
        console.log(
          '%c[reqbody] no candidate free-text field found for ' + cfg.slug + ' task ' + (i + 1),
          'color:#a72'
        );
      }

      result.overviews.push(entry);
      await sleep(DELAY_MS);
    }

    return result;
  }

  // ── run ─────────────────────────────────────────────────────────────────
  async function run() {
    console.log(
      '%c[reqbody] starting capture — sequential, ' + DELAY_MS + 'ms delay between fetches',
      'color:#2a7;font-weight:bold'
    );
    var summary = {
      capturedAt: new Date().toISOString(),
      pageOrigin: location.origin,
      apiBaseUrl: apiBaseUrl(),
      question:
        'Does the per-task overview endpoint carry the patient free-text request body for medical/admin_patient_request_task, and under which field path?',
      taskTypes: {},
    };

    for (var i = 0; i < TASK_TYPES.length; i++) {
      var cfg = TASK_TYPES[i];
      console.log('%c[reqbody] ── ' + cfg.slug + ' ──────────────────────────', 'color:#27a;font-weight:bold');
      var r = await processTaskType(cfg);
      summary.taskTypes[cfg.slug] = r;
      await sleep(DELAY_MS);
    }

    console.log('%c[reqbody] ── DONE — COPY FROM HERE ─────────────────────────────', 'color:#2a7;font-weight:bold');
    console.log(JSON.stringify(summary, null, 2));
    console.log('%c[reqbody] ── COPY TO HERE ──────────────────────────────────────', 'color:#2a7;font-weight:bold');
    return summary;
  }

  window.chReqBody = {
    __armed: true,
    run: run,
    assignee: function (id) {
      assigneeId = id || null;
      console.log('[reqbody] masterAssignee set to ' + (assigneeId || '(cleared)') + ' — re-run chReqBody.run()');
    },
    stop: function () {
      this.__armed = false;
      console.log(
        '[reqbody] disarmed (nothing was patched globally, so there is nothing to unwrap — this just clears the arm flag).'
      );
    },
  };

  console.log(
    '%c[reqbody] armed — answers: does the overview payload carry the patient request free-text body, and where?\n' +
      '  chReqBody.run()   ← fetches task-list + overview for both task types, prints structural maps, ends with a JSON summary to copy back\n' +
      '  chReqBody.assignee(uuid)  ← optional, only if task-list 403s without a masterAssignee filter\n' +
      'PRIVACY: only path/type/length is ever logged — no names, dates, NHS numbers, or free-text values. See header comment for the full contract.',
    'color:#2a7;font-weight:bold'
  );
})();
