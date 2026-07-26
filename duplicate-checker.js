'use strict';

// Registration type UUIDs for the full active patient list
// (Regular, Temporary, Immediately Necessary — sourced from the Medicus patient listing URL)
const REG_TYPE_IDS = [
  '748afb30-fea2-4002-a7e8-a1d4f33e46f5',
  '8220ca34-cc50-4ed5-9731-dae01be41d73',
  '49b7cad9-20fc-423c-a1ca-184154fb4c85',
];
const PAGE_SIZE = 500; // requested; API may cap lower — pagination adapts automatically
const PAGE_BATCH = 3; // pages fetched in parallel per round during patient listing
const CONCURRENCY = 10; // parallel problem-list requests
const THRESHOLD_PCT = 0.75; // fraction of active problems that must be duplicated to trigger

let _csvData = [];
let _sortCol = 'count';
let _sortAsc = false;
let _apiBase = null;
let _scanMode = 'full'; // 'full' | 'incremental'
let _currentPatientTabTitle = null; // best-effort label for the removal audit log only

// ── Single shared patient-detail selection (one box, one patient at a time) ──
// _activeSelectionKey is whichever patient's uuid is currently loaded into
// #patientDetailMain, whether reached via "Analyse current patient" or a rail
// click — both routes funnel through confirmPatientSwitch() below so there is
// only ever one "current" patient. _activeGeneration is bumped on every
// confirmed switch; in-flight async work (runJournalAnalysis,
// applyOnDemandCrossChecks) captures its own generation at the start and
// checks it hasn't changed before touching the DOM — the cooperative
// "stop the existing analysis" mechanism, since fetches already in flight
// can't be truly aborted mid-flight.
let _activeSelectionKey = null;
let _activeGeneration = 0;

// Marks the rail item for `uuid` active (and only that one) — keeps the rail
// in sync with whichever patient is loaded, regardless of how they got there.
function syncActiveRailItem(uuid) {
  document.querySelectorAll('.rail-item').forEach((el) => el.classList.remove('active'));
  if (!uuid) return;
  const match = document.querySelector(`.rail-item[data-uuid="${uuid}"]`);
  if (match) match.classList.add('active');
}

// Gate before loading a NEW patient into the shared detail pane. If a
// DIFFERENT patient is already loaded, confirms with the user first (an
// in-progress or already-finished analysis is real state — don't discard it
// silently). Returns false (caller must bail out, nothing changed) if the
// user declines.
function confirmPatientSwitch(uuid) {
  if (_activeSelectionKey && uuid && _activeSelectionKey !== uuid) {
    if (!confirm("Switch to a different patient? The current patient's analysis will stop.")) {
      return false;
    }
  }
  _activeSelectionKey = uuid || null;
  _activeGeneration++;
  syncActiveRailItem(uuid);
  return true;
}

const STATE_KEY = 'suite.dupChecker.state';

// ── Persistence ───────────────────────────────────────────────────────────────
function saveState(practiceCode, flagged, checkedUuids) {
  chrome.storage.local.set({
    [STATE_KEY]: {
      practiceCode,
      scanDate: new Date().toISOString(),
      flagged,
      checkedUuids: [...checkedUuids],
    },
  });
}

function loadState() {
  return new Promise((resolve) => chrome.storage.local.get(STATE_KEY, (r) => resolve(r[STATE_KEY] || null)));
}

function clearState() {
  return new Promise((resolve) => chrome.storage.local.remove(STATE_KEY, resolve));
}

// ── Practice code auto-detection ─────────────────────────────────────────────
async function detectPracticeCode() {
  if (typeof chrome === 'undefined' || !chrome.tabs) return null;
  try {
    const tabs = await chrome.tabs.query({ url: 'https://*.medicus.health/*' });
    for (const tab of tabs) {
      const m = tab.url && tab.url.match(/england\.medicus\.health\/([a-f0-9]{4,8})\//i);
      if (m) return m[1].toLowerCase();
    }
  } catch (e) {
    /* not available */
  }
  return null;
}

// Finds an open Medicus tab that's on a specific patient's page (care-record
// or patient URL, or a patientId=/patient= query param — same URL shapes
// engine/api-client.js's detectMedicusContext() recognises for content
// scripts; this is the tabs-API equivalent for the standalone extension page,
// which has no DOM access to the Medicus tab itself, only its URL/title).
// Returns { code, uuid, tabTitle } or null — never guesses across multiple
// open tabs referencing different patients, same "refuse rather than risk
// the wrong patient" stance as findPatientUuidFromDom.
const PATIENT_UUID_URL_RE =
  /\/(?:care-record|patient)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const PATIENT_UUID_QUERY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function detectCurrentPatient() {
  if (typeof chrome === 'undefined' || !chrome.tabs) return null;
  try {
    const tabs = await chrome.tabs.query({ url: 'https://*.medicus.health/*' });
    const found = new Set();
    let match = null;
    for (const tab of tabs) {
      if (!tab.url) continue;
      const codeMatch = tab.url.match(/england\.medicus\.health\/([a-f0-9]{4,8})\//i);
      if (!codeMatch) continue;
      let u;
      try {
        u = new URL(tab.url);
      } catch (e) {
        continue;
      }
      let uuid = null;
      const pathMatch = u.pathname.match(PATIENT_UUID_URL_RE);
      if (pathMatch) uuid = pathMatch[1];
      if (!uuid) {
        const qp = u.searchParams.get('patientId') || u.searchParams.get('patient');
        if (qp && PATIENT_UUID_QUERY_RE.test(qp)) uuid = qp;
      }
      if (!uuid) continue;
      uuid = uuid.toLowerCase();
      found.add(uuid);
      if (!match) match = { code: codeMatch[1].toLowerCase(), uuid, tabTitle: tab.title || null };
    }
    // Multiple distinct patients open across tabs — refuse to guess which one.
    if (found.size > 1) return null;
    return match;
  } catch (e) {
    /* not available */
  }
  return null;
}

// ── API helpers ───────────────────────────────────────────────────────────────
async function apiFetch(url) {
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status, url });
  return r.json();
}

// Confirmed write calls (mark-incorrect-and-hidden) return an empty `{}` ack,
// not always with a JSON content-type — tolerate an empty body rather than
// throwing on r.json() with nothing to parse.
async function apiPost(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status, url });
  const text = await r.text();
  return text ? JSON.parse(text) : {};
}

// ── Removal audit log ────────────────────────────────────────────────────────
// Every successful removal is recorded locally — patient data, so deliberately
// excluded from suite backups (see test-backup-coverage.js ALLOWLIST, same
// reasoning as STATE_KEY above). There is no confirmed "undo" endpoint yet
// (open question, see project notes), so this log is the only record of what
// this tool has changed on a live patient's record.
const REMOVAL_LOG_KEY = 'suite.dupChecker.removalLog';

function logRemoval(entry) {
  return new Promise((resolve) => {
    chrome.storage.local.get(REMOVAL_LOG_KEY, (r) => {
      const log = r[REMOVAL_LOG_KEY] || [];
      log.push({ ...entry, removedAt: new Date().toISOString() });
      chrome.storage.local.set({ [REMOVAL_LOG_KEY]: log }, resolve);
    });
  });
}

const DISCOVERY_KEY = 'suite.discoveredPatientListUrl';

function patientListParams(offset) {
  const params = new URLSearchParams();
  REG_TYPE_IDS.forEach((id) => params.append('patientRegistrationTypeIds[]', id));
  params.set('limit', PAGE_SIZE);
  params.set('offset', offset);
  return params.toString();
}

// Read the URL the api-discovery content script captured from the patient listing page.
function getDiscoveredBaseUrl() {
  return new Promise((resolve) => {
    chrome.storage.local.get(DISCOVERY_KEY, (r) => resolve(r[DISCOVERY_KEY] || null));
  });
}

// Build a paginated URL from a discovered base URL.
// Uses startRow/endRow (AG Grid format) to match what the Medicus app sends.
// Preserves all non-pagination params from the discovered URL (including any
// additional filters the app adds after the registration type IDs).
function patientListUrlFromDiscovered(discoveredBase, startRow) {
  const u = new URL(discoveredBase);
  // Ensure reg-type IDs are present
  if (!u.searchParams.has('patientRegistrationTypeIds[]')) {
    REG_TYPE_IDS.forEach((id) => u.searchParams.append('patientRegistrationTypeIds[]', id));
  }
  u.searchParams.set('startRow', startRow);
  u.searchParams.set('endRow', startRow + PAGE_SIZE);
  return u.toString();
}

function problemListUrl(apiBase, patientUuid) {
  return `${apiBase}/clinical/data/problem/listing/${patientUuid}`;
}

function normDesc(s) {
  return (s || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

// ── Patient list fetcher ──────────────────────────────────────────────────────
// Fetches patient pages in small parallel batches and filters eligible patients
// in-flight so we never hold all 33k records in memory at once.
async function fetchAllPatients(onProgress) {
  const discoveredBase = await getDiscoveredBaseUrl();
  if (!discoveredBase) {
    throw Object.assign(new Error('NEEDS_DISCOVERY'), { needsDiscovery: true });
  }
  showDiscoveredEndpoint(discoveredBase);

  function extractPage(data) {
    return data?.patients ?? data?.results ?? data?.data ?? (Array.isArray(data) ? data : null);
  }

  let offset = 0;
  let apiPageSize = null;
  let totalFetched = 0;
  let debugLogged = false;
  const eligible = [];

  while (true) {
    // Fetch PAGE_BATCH pages in parallel, starting from current offset
    const step = apiPageSize ?? PAGE_SIZE;
    const offsets = Array.from({ length: PAGE_BATCH }, (_, i) => offset + i * step);

    const results = await Promise.all(
      offsets.map((off) =>
        apiFetch(patientListUrlFromDiscovered(discoveredBase, off))
          .then((d) => ({ ok: true, page: extractPage(d) }))
          .catch(() => ({ ok: false, page: null }))
      )
    );

    let done = false;
    for (const { ok, page } of results) {
      if (!ok || !page || page.length === 0) {
        done = true;
        break;
      }
      if (apiPageSize === null) apiPageSize = page.length;
      totalFetched += page.length;
      if (!debugLogged && page.length > 0) {
        debugLogged = true;
        chrome.storage.local.set({ 'suite.patientFieldDebug': describeShape(page[0]) });
      }
      for (const p of page) {
        if (isEligiblePatient(p)) eligible.push(p);
      }
      if (page.length < apiPageSize) {
        done = true;
        break;
      }
    }

    onProgress(totalFetched, eligible.length);
    if (done) break;
    offset += PAGE_BATCH * (apiPageSize ?? PAGE_SIZE);
  }

  return eligible;
}

// ── GP2GP text detection ──────────────────────────────────────────────────────
// Scan every string value in the problem object (whatever field names the API uses)
const GP2GP_RE = /unspecified significance|defaulting to minor/i;

function hasGp2gpText(problem) {
  function scan(v) {
    if (typeof v === 'string') return GP2GP_RE.test(v);
    if (Array.isArray(v)) return v.some(scan);
    if (v && typeof v === 'object') return Object.values(v).some(scan);
    return false;
  }
  return scan(problem);
}

// ── Problem duplicate detector ────────────────────────────────────────────────
// Codes that can legitimately appear more than once (e.g. once per pregnancy/child)
// and should not count toward the duplicate threshold.
const EXCLUDED_FROM_DUPLICATE_CHECK = ['spontaneous vaginal delivery', 'termination of pregnancy', 'normal delivery'];

// Returns null if neither criterion fires, otherwise:
//   { duplicated: [{label, count}], triggers: string[], gp2gpCount: number }
function detectDuplicates(problemListing) {
  const active = problemListing?.activeProblems;
  if (!Array.isArray(active)) return null;

  const relevant = active.filter((p) => !p.isMarkedAsIncorrect && !p.hasEnded);
  if (relevant.length === 0) return null;

  // Group by normalised description, skipping codes that can legitimately repeat
  const counts = new Map();
  for (const p of relevant) {
    const key = normDesc(p.problemCodeDescription);
    if (!key) continue;
    if (EXCLUDED_FROM_DUPLICATE_CHECK.some((ex) => key.includes(ex))) continue;
    if (!counts.has(key)) counts.set(key, { label: p.problemCodeDescription, count: 0 });
    counts.get(key).count++;
  }
  const duplicatedGroups = [...counts.values()].filter((v) => v.count >= 2);

  // Criterion 1 — threshold: count entries that belong to a duplicate group
  const duplicatedEntries = duplicatedGroups.reduce((s, g) => s + g.count, 0);
  const pct = relevant.length > 0 ? duplicatedEntries / relevant.length : 0;
  const thresholdMet = pct >= THRESHOLD_PCT;

  // Criterion 2 — GP2GP signature text found in any string field of any problem
  const gp2gpCount = relevant.filter(hasGp2gpText).length;
  const gp2gpMet = gp2gpCount > 0;

  // Criterion 3 — GP2GP batch import: same createdInOriginalSystemDateTime appears
  // across ≥2 distinct duplicate groups, identifying a batch transfer event.
  const dupKeys = new Set([...counts.entries()].filter(([, v]) => v.count >= 2).map(([k]) => k));
  const tsToGroups = new Map(); // timestamp → Set of dup-group keys
  const tsToIds = new Map(); // timestamp → problem IDs that carry it (the imported copies)
  for (const p of relevant) {
    const key = normDesc(p.problemCodeDescription);
    if (!dupKeys.has(key)) continue;
    const ts = p.createdInOriginalSystemDateTime;
    if (!ts) continue;
    if (!tsToGroups.has(ts)) {
      tsToGroups.set(ts, new Set());
      tsToIds.set(ts, []);
    }
    tsToGroups.get(ts).add(key);
    if (p.id) tsToIds.get(ts).push(p.id);
  }
  const batchEntry = [...tsToGroups.entries()].find(([, groups]) => groups.size >= 2);
  const batchMet = !!batchEntry;
  const batchImport = batchEntry ? { timestamp: batchEntry[0], importedIds: tsToIds.get(batchEntry[0]) } : null;

  if (!thresholdMet && !gp2gpMet && !batchMet) return null;

  const triggers = [];
  if (thresholdMet) triggers.push(`${Math.round(pct * 100)}% of problems duplicated`);
  if (gp2gpMet) triggers.push(`GP2GP text (${gp2gpCount} problem${gp2gpCount !== 1 ? 's' : ''})`);
  if (batchMet) triggers.push(`GP2GP batch import (${batchEntry[0].slice(0, 10)})`);

  return { duplicated: duplicatedGroups, triggers, batchImport };
}

// ── Concurrency limiter ───────────────────────────────────────────────────────
async function runWithConcurrency(tasks, concurrency, onEach) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < tasks.length) {
      const idx = i++;
      results[idx] = await onEach(tasks[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

// ── Patient eligibility filter ────────────────────────────────────────────────

// Returns a structure-only description of an object (field names + types, no patient values)
function describeShape(obj, depth = 0) {
  if (depth > 3 || obj === null || obj === undefined) return typeof obj;
  if (Array.isArray(obj)) {
    // Return a nested object rather than interpolating the recursive result
    // into a template string — for an array of objects, string interpolation
    // would collapse the nested shape to the literal text "[object Object]".
    return { arrayLength: obj.length, itemShape: obj.length ? describeShape(obj[0], depth + 1) : 'unknown' };
  }
  if (typeof obj === 'object') {
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, describeShape(v, depth + 1)]));
  }
  return typeof obj;
}

// Distinct registrationStatus values observed — stored for debug display
const _seenStatuses = new Set();

function isEligiblePatient(p) {
  const status = (p.registrationStatus || '').toLowerCase().trim();
  _seenStatuses.add(p.registrationStatus || '(empty)');

  // Exclude patients who have left, been deducted, died, or are on emergency-only registration
  if (/deduct|left|remov|deceas|died?|dead|transfer|inactiv|historic|immediately/i.test(status)) return false;

  return true;
}

// ── Extract patient fields from varying API shapes ────────────────────────────
function patientFields(p) {
  const name =
    [p.forename || p.firstName || p.givenName || '', p.surname || p.lastName || p.familyName || '']
      .filter(Boolean)
      .join(' ') ||
    p.name ||
    p.patientName ||
    p.fullName ||
    '(unknown)';
  const nhs = p.nhsNumber || p.nhs || p.nhsNo || '';
  const dob = p.dateOfBirth || p.dob || p.birthDate || '';
  const uuid = p.id || p.patientId || p.uuid || p.patientUuid || null;
  return { name, nhs, dob, uuid };
}

// ── Second pass: event-date match analysis ────────────────────────────────────
// For each flagged patient, re-fetches the problem listing and checks whether the
// two (or more) copies of each duplicate group share the same dateToDisplay.
// Same date → both copies record the same clinical event → strong GP2GP duplicate
// signal.  Different dates → two separate episodes of the same condition → likely
// false positive.
async function runSecondPass() {
  if (!_csvData.length || !_apiBase) return;
  const btn = document.getElementById('secondPassBtn');
  btn.disabled = true;
  btn.textContent = 'Running second pass…';

  let done = 0;
  await runWithConcurrency(_csvData, CONCURRENCY, async (r) => {
    if (!r.uuid) {
      done++;
      return;
    }
    try {
      const listing = await apiFetch(problemListUrl(_apiBase, r.uuid));
      const active = listing?.activeProblems;
      if (Array.isArray(active)) {
        const relevant = active.filter((p) => !p.isMarkedAsIncorrect && !p.hasEnded);
        let matched = 0;
        for (const group of r.duplicated) {
          const key = normDesc(group.label);
          const copies = relevant.filter((p) => normDesc(p.problemCodeDescription) === key);
          if (copies.length < 2) continue;
          const dates = new Set(copies.map((p) => p.dateToDisplay || ''));
          if (dates.size === 1) matched++;
        }
        r.dateMatchPairs = matched;
        r.totalPairs = r.duplicated.length;
      }
    } catch (e) {
      /* leave undefined — shown as — */
    }
    done++;
    btn.textContent = `Running second pass… ${done}/${_csvData.length}`;
  });

  btn.textContent = 'Second pass complete';
  btn.disabled = false;
  renderResults(_csvData);
}

// ── Render ────────────────────────────────────────────────────────────────────
// Compact rail list (master-detail layout) — clicking an item loads that one
// patient's full detail into the single shared #patientDetailMain pane (see
// selectPatientRow below), rather than expanding inline in a table row.
function renderResults(rows) {
  const hasSecondPass = rows.some((r) => r.dateMatchPairs !== undefined);
  const sorted = [...rows].sort((a, b) => {
    let av = a[_sortCol],
      bv = b[_sortCol];
    if (_sortCol === 'count') {
      av = -av;
      bv = -bv;
    }
    if (_sortAsc) [av, bv] = [bv, av];
    return av < bv ? -1 : av > bv ? 1 : 0;
  });

  // Show/hide the date-match indicator based on whether second pass has run
  document.getElementById('dateMatchTh').style.display = hasSecondPass ? '' : 'none';

  const container = document.getElementById('resultBody');
  if (!sorted.length) {
    container.innerHTML = '<div class="rail-empty">No patients met any duplicate criterion.</div>';
    return;
  }

  container.innerHTML = sorted
    .map((r, i) => {
      let dateMatchMeta = '';
      if (hasSecondPass) {
        if (r.dateMatchPairs === undefined) {
          dateMatchMeta = '<span class="rail-item-meta mono">date-match —</span>';
        } else {
          const all = r.dateMatchPairs === r.totalPairs;
          const none = r.dateMatchPairs === 0;
          const colour = all ? 'var(--green)' : none ? 'var(--text-4)' : 'var(--amber)';
          dateMatchMeta = `<span class="rail-item-meta mono" style="color:${colour}">${r.dateMatchPairs}/${r.totalPairs}</span>`;
        }
      }
      const tooltip = `${r.name} · NHS ${r.nhs} · DOB ${r.dob}\n${r.duplicated.map((d) => `${d.label} x${d.count}`).join('\n')}`;
      return `
    <div class="rail-item" data-idx="${i}" data-uuid="${esc(r.uuid || '')}" title="${esc(tooltip)}">
      <div class="rail-item-top">
        <span class="rail-item-name">${esc(r.name)}</span>
        <span class="pill">${r.count}</span>
      </div>
      <div class="rail-item-top">
        <span class="rail-item-triggers">${r.triggers.map((t) => `<span class="trigger-badge">${esc(t)}</span>`).join(' ')}</span>
        ${dateMatchMeta}
      </div>
    </div>`;
    })
    .join('');

  container.querySelectorAll('.rail-item').forEach((item) => {
    item.addEventListener('click', () => selectPatientRow(parseInt(item.dataset.idx, 10), sorted));
  });

  // Re-apply active-state highlighting after a re-render (re-sort, second
  // pass, incremental merge) so it stays in sync with whichever patient is
  // currently loaded in the shared detail pane.
  syncActiveRailItem(_activeSelectionKey);
}

// Loads exactly one patient's raw-fields + journal analysis into the single
// shared #patientDetailMain pane, replacing whatever was shown there before
// (never more than one patient's detail on screen at once — see the
// master-detail rail layout). Collapses the scan-controls drawer once a
// patient is loaded, since it's no longer the thing competing for attention.
// Gated by confirmPatientSwitch() — if a different patient is already
// loaded (from here or from "Analyse current patient"), the user is asked
// to confirm before this one replaces it.
async function selectPatientRow(idx, sorted) {
  const r = sorted[idx];
  if (!confirmPatientSwitch(r.uuid || null)) return;
  const myGeneration = _activeGeneration;
  collapseScanDrawer();

  const main = document.getElementById('patientDetailMain');
  main.innerHTML = `<div class="card"><pre class="detail-pre" id="detail-pre-${idx}"></pre></div>`;
  const pre = document.getElementById(`detail-pre-${idx}`);
  pre.textContent = 'Loading…';

  if (!_apiBase || !r.uuid) {
    pre.textContent = 'No API base or patient UUID available — re-run the scan first.';
    return;
  }

  try {
    const listing = await apiFetch(problemListUrl(_apiBase, r.uuid));
    if (myGeneration !== _activeGeneration) return; // switched away mid-fetch
    const active = listing?.activeProblems;
    if (!Array.isArray(active) || active.length === 0) {
      pre.textContent = 'No active problems returned.';
      return;
    }

    const dupKeys = new Set(r.duplicated.map((d) => normDesc(d.label)));

    const lines = active.map((p, i) => {
      const key = normDesc(p.problemCodeDescription);
      const marker = dupKeys.has(key) ? ' ★ DUPLICATE' : '';
      return (
        `[${i + 1}]${marker}\n` +
        Object.entries(p)
          .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
          .join('\n')
      );
    });

    pre.textContent =
      `${active.length} active problem${active.length !== 1 ? 's' : ''} (★ = flagged duplicate)\n\n` +
      lines.join('\n\n');
  } catch (e) {
    if (myGeneration !== _activeGeneration) return;
    pre.textContent = `Error fetching problems: ${e.message}`;
  }

  if (myGeneration !== _activeGeneration) return;
  renderJournalAnalysisSlot(idx, r);
}

// ── Journal-level duplicate analysis (click-through) ─────────────────────────
// EXACT-tier groups (identical text & author) whose kind has a confirmed
// write contract (problem/note/prescription — see
// RecordDuplicateParser.isRemovableKind/buildRemovalRequest) can be removed
// directly from here, one group at a time, with a required reason and an
// explicit confirmation step — see runRemoval() below. HIGH/REVIEW-tier
// groups and unsupported kinds (communication/document/investigation-request)
// remain read-only recommendations; this is live patient data, so anything
// not backed by a confirmed, tested write contract stays manual.
const JOURNAL_TEMPLATE_KEY = 'suite.discoveredJournalUrlTemplate';
const PATIENT_UUID_PLACEHOLDER = '__PATIENT_UUID__';

function getJournalUrlTemplate() {
  return new Promise((resolve) =>
    chrome.storage.local.get(JOURNAL_TEMPLATE_KEY, (r) => resolve(r[JOURNAL_TEMPLATE_KEY] || null))
  );
}

function renderJournalAnalysisSlot(idx, r) {
  const pre = document.getElementById(`detail-pre-${idx}`);
  if (!pre || document.getElementById(`journal-analysis-${idx}`)) return;

  const wrap = document.createElement('div');
  wrap.id = `journal-analysis-${idx}`;
  wrap.className = 'journal-analysis-wrap';
  wrap.innerHTML = `<button class="analyze-journal-btn btn-ghost" data-idx="${idx}">Analyse full record for duplicates</button>
    <div id="journal-result-${idx}" style="margin-top:10px"></div>`;
  pre.insertAdjacentElement('afterend', wrap);
  wrap.querySelector('.analyze-journal-btn').addEventListener('click', () => runJournalAnalysis(idx, r));
}

// Captures _activeGeneration at the start and checks it hasn't changed
// before each DOM write — if the user switched to a different patient while
// this was in flight (confirmPatientSwitch bumps the generation), this
// abandons further work rather than clobbering the new patient's view. See
// the _activeSelectionKey/_activeGeneration block near the top of the file.
async function runJournalAnalysis(idx, r) {
  const myGeneration = _activeGeneration;
  const out = document.getElementById(`journal-result-${idx}`);
  const btn = document.querySelector(`.analyze-journal-btn[data-idx="${idx}"]`);
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Analysing…';
  }
  out.innerHTML = '<div style="color:var(--text-2);font-size:12px">Fetching patient journal…</div>';

  const template = await getJournalUrlTemplate();
  if (myGeneration !== _activeGeneration) return;
  if (!template) {
    out.innerHTML = `<div class="info" style="font-size:12px">
      No journal endpoint has been discovered yet. Open this patient's <strong>Journal</strong> tab in
      Medicus once (care-record → Journal), then click "Show patient fields" above to confirm capture,
      and try again.</div>`;
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Analyse full record for duplicates';
    }
    return;
  }

  const url = template.replace(new RegExp(PATIENT_UUID_PLACEHOLDER, 'g'), r.uuid);

  try {
    const payload = await apiFetch(url);
    if (myGeneration !== _activeGeneration) return;
    const analysis = window.RecordDuplicateParser.analyzeJournal(payload);
    const needsCrossCheck =
      analysis.groups.some((g) => g.kind === 'prescription' || g.kind === 'document') ||
      analysis.entries.some((e) => e.kind === 'document');
    if (needsCrossCheck) {
      out.innerHTML =
        '<div style="color:var(--text-2);font-size:12px">Cross-checking prescription/document candidate groups…</div>';
      await applyOnDemandCrossChecks(analysis, _apiBase, () => myGeneration === _activeGeneration);
      if (myGeneration !== _activeGeneration) return;
    }
    out.__analysis = analysis;
    out.__patient = r;
    out.__idx = idx;
    out.innerHTML = renderJournalAnalysisHtml(analysis, _apiBase, r.uuid);
    wireRemovalDelegation(out);
  } catch (e) {
    if (myGeneration !== _activeGeneration) return;
    out.innerHTML = `<div class="err" style="font-size:12px">Error fetching/analysing journal: ${esc(e.message)}</div>`;
  } finally {
    if (myGeneration === _activeGeneration && btn) {
      btn.disabled = false;
      btn.textContent = 'Re-analyse';
    }
  }
}

// ── On-demand cross-checks (2026-07-05) ──────────────────────────────────────
// Extra network calls per CANDIDATE group only — never a blanket practice-wide
// fetch, same principle as every other per-document/per-prescription detail
// call in this file. A cross-check that can't complete (network error, field
// missing) leaves the group as-is rather than blocking the whole analysis —
// the pure decision helpers in RecordDuplicateParser already treat incomplete
// data as "no mismatch confirmed", so silently skipping a failed fetch here
// is safe, not a guess.

async function crossCheckPrescriptionTiming(apiBase, group) {
  const createdDateTimeByEntryId = {};
  for (const e of group.entries) {
    try {
      const detail = await apiFetch(`${apiBase}/clinical/data/prescription/overview/${e.id}`);
      if (detail && detail.createdDateTime) createdDateTimeByEntryId[e.id] = detail.createdDateTime;
    } catch (err) {
      /* leave this entry's time unknown */
    }
  }
  return window.RecordDuplicateParser.hasPrescriptionTimingMismatch(group, createdDateTimeByEntryId);
}

// Fetches each member's clinical/data/document/modals/preview/{id} once —
// shared by both the questionnaire-template cross-check and the fileType
// split below, so a document group with N copies costs N fetches total,
// not 2N.
async function fetchDocumentPreviews(apiBase, group) {
  const previewByEntryId = {};
  for (const e of group.entries) {
    try {
      previewByEntryId[e.id] = await apiFetch(`${apiBase}/clinical/data/document/modals/preview/${e.id}`);
    } catch (err) {
      /* leave this entry's preview unknown */
    }
  }
  return previewByEntryId;
}

async function crossCheckQuestionnaireTemplate(apiBase, group, previewByEntryId) {
  const templateNameByEntryId = {};
  for (const e of group.entries) {
    const preview = previewByEntryId[e.id];
    const attachment = preview && preview.attachment;
    if (!attachment || attachment.fileRoute !== 'xml/patient-questionnaire-response' || !attachment.fileId) continue;
    try {
      const qr = await apiFetch(
        `${apiBase}/tasks/data/document/xml/patient-questionnaire-response/document-preview/${attachment.fileId}`
      );
      if (qr && qr.questionnaireTemplateName) templateNameByEntryId[e.id] = qr.questionnaireTemplateName;
    } catch (err) {
      /* leave this entry's template name unknown */
    }
  }
  return window.RecordDuplicateParser.hasQuestionnaireTemplateMismatch(group, templateNameByEntryId);
}

// Mutates `analysis` in place: re-filters groups, moving any CONFIRMED
// (not just suspected) mismatch into its own excluded list; splits any
// document group that's actually two-or-more genuinely different documents
// wrongly merged by sharing a date + resolved generic type label (real
// test-patient finding, 2026-07-07 — see splitDocumentGroupsByFileType's own
// comment); and refreshes summary.byTier/totalCandidateGroups to match what's
// actually still shown. isStillActive (optional) is polled between groups so
// a user-initiated patient switch can abandon the remaining per-group
// fetches early rather than working through all of them pointlessly.
// Extracted so both the primary (grouped-document) fetch loop and the
// whole-record file-match pass below feed the exact same maps — one
// counter, one set of fields, regardless of which loop reached a given
// document first.
function recordDocumentPreviewFields(
  entryId,
  preview,
  fileTypeByEntryId,
  fileSizeByEntryId,
  createdDateByEntryId,
  filedDateTimeByEntryId
) {
  if (!preview) return false;
  if (typeof preview.fileType === 'string' && preview.fileType.trim()) {
    fileTypeByEntryId[entryId] = preview.fileType.trim().toLowerCase();
  }
  if (preview.fileSize !== undefined && preview.fileSize !== null && String(preview.fileSize).trim()) {
    fileSizeByEntryId[entryId] = String(preview.fileSize).trim();
  }
  const doc = preview.document;
  if (doc && typeof doc.createdDate === 'string' && doc.createdDate.trim()) {
    createdDateByEntryId[entryId] = doc.createdDate.trim();
  }
  if (doc && typeof doc.filedDateTime === 'string' && doc.filedDateTime.trim()) {
    filedDateTimeByEntryId[entryId] = doc.filedDateTime.trim();
  }
  return true;
}

async function applyOnDemandCrossChecks(analysis, apiBase, isStillActive) {
  if (!apiBase) return;
  const kept = [];
  const excludedPrescriptionTiming = [];
  const excludedQuestionnaireMismatch = [];
  const fileTypeByEntryId = {};
  // fileSize (top-level on the preview response, confirmed live 2026-07-07
  // — see splitDocumentGroupsByFileType's header comment) isn't guaranteed
  // present on every document type; the tracked count below surfaces
  // coverage in the summary line rather than leaving a gap silent.
  const fileSizeByEntryId = {};
  const createdDateByEntryId = {};
  const filedDateTimeByEntryId = {};
  let documentPreviewsChecked = 0;
  let noteAttachmentMismatchTotal = 0;
  // Retained (not just extracted-then-discarded) so the field-by-field
  // comparison UI can read the full preview object later, on demand, when
  // the user clicks "Compare fields…" — well after this function returns.
  const allDocumentPreviewsByEntryId = {};

  for (const g of analysis.groups) {
    if (isStillActive && !isStillActive()) return;
    if (g.kind === 'prescription') {
      if (await crossCheckPrescriptionTiming(apiBase, g)) {
        excludedPrescriptionTiming.push(g);
        continue;
      }
    } else if (g.kind === 'document') {
      const previewByEntryId = await fetchDocumentPreviews(apiBase, g);
      Object.assign(allDocumentPreviewsByEntryId, previewByEntryId);
      for (const [entryId, preview] of Object.entries(previewByEntryId)) {
        if (
          recordDocumentPreviewFields(
            entryId,
            preview,
            fileTypeByEntryId,
            fileSizeByEntryId,
            createdDateByEntryId,
            filedDateTimeByEntryId
          )
        ) {
          documentPreviewsChecked++;
        }
      }
      if (await crossCheckQuestionnaireTemplate(apiBase, g, previewByEntryId)) {
        excludedQuestionnaireMismatch.push(g);
        continue;
      }
    } else if (g.kind === 'note') {
      // Attached-document mismatch guard (2026-07-13) — a note/consultation
      // group can tier EXACT on generic summary text/author alone even
      // though each member's own attached document (captured on the entry
      // by flattenJournal as attachedDocumentIds) genuinely differs. Only
      // fetches for note groups that actually carry an attachment — most
      // note groups have none and pay nothing here. Shares the same preview
      // cache/maps the document branch above populates, keyed by the
      // ATTACHED DOCUMENT's id (not the note's own id), so a document that
      // happens to appear both as a top-level entry and as an attachment is
      // only ever fetched once.
      const attachedIds = new Set();
      for (const e of g.entries) for (const id of e.attachedDocumentIds || []) attachedIds.add(id);
      if (attachedIds.size) {
        for (const id of attachedIds) {
          if (allDocumentPreviewsByEntryId[id] !== undefined) continue;
          try {
            const preview = await apiFetch(`${apiBase}/clinical/data/document/modals/preview/${id}`);
            allDocumentPreviewsByEntryId[id] = preview;
            recordDocumentPreviewFields(
              id,
              preview,
              fileTypeByEntryId,
              fileSizeByEntryId,
              createdDateByEntryId,
              filedDateTimeByEntryId
            );
          } catch (err) {
            allDocumentPreviewsByEntryId[id] = null;
          }
        }
        if (window.RecordDuplicateParser.hasAttachedDocumentMismatch(g, fileTypeByEntryId, fileSizeByEntryId)) {
          noteAttachmentMismatchTotal++;
          kept.push({ ...g, tier: 'review', attachmentMismatch: true });
          continue;
        }
      }
    }
    kept.push(g);
  }

  const { groups: splitGroups, documentGroupsSplit } = window.RecordDuplicateParser.splitDocumentGroupsByFileType(
    kept,
    fileTypeByEntryId,
    fileSizeByEntryId
  );

  // Document-linked-entry matching (2026-07-07, corrected 2026-07-08) —
  // fetches `clinical/document/entries/{documentId}` for EVERY document-kind
  // entry (not just ones already sitting in a candidate group above, per
  // explicit product decision to catch documents that never grouped with
  // anything else). This is a SEPARATE endpoint from the modals/preview
  // fetch above (was wrongly assumed to be the same response's
  // `careRecordElements` field until real payloads corrected it 2026-07-08)
  // — see findDocumentLinkedDuplicates' own header comment for the full
  // design rationale. The document's own journal-entry `.date` (already
  // known, already correct) is reused as the linked notes' date — no extra
  // date fetch, no format-mismatch risk.
  const allDocumentEntries = (analysis.entries || []).filter((e) => e.kind === 'document');
  if (isStillActive && !isStillActive()) return;
  const documentLinkedDataByDocumentId = {};
  for (const e of allDocumentEntries) {
    if (isStillActive && !isStillActive()) return;
    try {
      const res = await apiFetch(`${apiBase}/clinical/document/entries/${e.id}`);
      if (res && Array.isArray(res.entries) && res.entries.length) {
        documentLinkedDataByDocumentId[e.id] = { documentDate: e.date, entries: res.entries };
      }
    } catch (err) {
      /* leave this document's linked entries unknown */
    }
  }
  const { groups: linkedGroups, linkedEntriesGenerated } = window.RecordDuplicateParser.findDocumentLinkedDuplicates(
    analysis.entries,
    documentLinkedDataByDocumentId
  );

  // Journal-order sort so documentLinked groups land adjacent to the
  // document tasks they relate to, not appended at the bottom (2026-07-08).
  // The cross-record file-match check (fileType/fileSize across the whole
  // document pool) is NOT run here — live timing on a 63-document record
  // showed it added ~25s to this pass (54.5s -> 79.3s), so it moved to an
  // opt-in second pass (runFileMatchSecondPass, below) triggered by a
  // banner when findSuspiciousDocuments (zero-fetch, computed in
  // analyzeJournal) flags anything.
  const allGroups = window.RecordDuplicateParser.sortGroupsByJournalOrder(
    splitGroups.concat(linkedGroups),
    analysis.entries
  );
  analysis.groups = allGroups;
  analysis.excludedPrescriptionTiming = excludedPrescriptionTiming;
  analysis.excludedQuestionnaireMismatch = excludedQuestionnaireMismatch;
  const byTier = { exact: 0, high: 0, review: 0 };
  for (const g of allGroups) byTier[g.tier]++;
  analysis.summary.byTier = byTier;
  analysis.summary.documentLinkedEntriesGenerated = linkedEntriesGenerated;
  analysis.summary.documentLinkedGroupsFound = linkedGroups.length;
  analysis.summary.totalCandidateGroups = allGroups.length;
  analysis.summary.excludedPrescriptionTimingTotal = excludedPrescriptionTiming.length;
  analysis.summary.excludedQuestionnaireMismatchTotal = excludedQuestionnaireMismatch.length;
  analysis.summary.documentGroupsSplitByFileType = documentGroupsSplit;
  analysis.summary.noteAttachmentMismatchTotal = noteAttachmentMismatchTotal;
  analysis.summary.documentPreviewsChecked = documentPreviewsChecked;
  analysis.summary.documentPreviewsWithFileSize = Object.keys(fileSizeByEntryId).length;
  analysis.documentPreviewsByEntryId = allDocumentPreviewsByEntryId;
}

// Forces a fresh first-pass re-analysis (a genuine live re-fetch of the
// journal, same as clicking "Re-analyse") before ever running the file-match
// second pass (2026-07-13). Fixes a real bug: markEntryRemoved only patches
// the DOM in place (see its own header comment) — out.__analysis.entries
// still lists entries the user has already removed from the live record. Run
// the file-match check straight off that stale analysis and an
// already-removed document reappears as a "duplicate" to remove a second
// time, with undefined behaviour if the user tries. Re-running the first
// pass first guarantees the second pass only ever sees what's still actually
// in the record. This is why the button is wired to this function, not
// runFileMatchSecondPass directly.
async function runFreshFileMatchSecondPass(out) {
  const idx = out.__idx;
  const r = out.__patient;
  if (idx === undefined || !r) return;
  const myGeneration = _activeGeneration;
  await runJournalAnalysis(idx, r);
  // runJournalAnalysis replaces out's children and rebuilds out.__analysis
  // in place on this same element — no need to re-query it. If the user
  // switched to a different patient mid-fetch, out.__analysis won't have
  // been refreshed (runJournalAnalysis bails on its own generation check) —
  // bail here too rather than risk running the second pass against a
  // still-stale analysis.
  if (myGeneration !== _activeGeneration) return;
  if (!out.__analysis || out.__analysis.__fileMatchChecked) return;
  await runFileMatchSecondPass(out);
}

// ── Cross-record file-match second pass (opt-in, 2026-07-08) ────────────────
// The expensive half of cross-record file-match detection: fetches
// clinical/data/document/modals/preview/{id} for every document-kind entry
// NOT already covered by the primary pass above (reusing
// analysis.documentPreviewsByEntryId — no re-fetch for documents already
// known), then matches by (fileType, fileSize) across the WHOLE record.
// User-triggered only (see fileMatchSecondPassBannerHtml) — live timing
// showed running this unconditionally added ~25s to a 63-document record's
// analysis. `analysis.__fileMatchChecked` marks it done so the banner
// doesn't reappear on a later render of the same analysis object.
async function runFileMatchSecondPass(out) {
  const analysis = out.__analysis;
  if (!analysis || analysis.__fileMatchChecked) return;
  const P = window.RecordDuplicateParser;
  const bannerEl = out.querySelector('.file-match-second-pass');
  if (bannerEl) {
    bannerEl.innerHTML = '<div style="font-size:11px;color:var(--text-3)">Checking file size/type across every document in the record…</div>';
  }

  const allDocumentEntries = (analysis.entries || []).filter((e) => e.kind === 'document');
  const fileTypeByEntryId = {};
  const fileSizeByEntryId = {};
  const createdDateByEntryId = {};
  const filedDateTimeByEntryId = {};
  for (const [id, preview] of Object.entries(analysis.documentPreviewsByEntryId || {})) {
    recordDocumentPreviewFields(id, preview, fileTypeByEntryId, fileSizeByEntryId, createdDateByEntryId, filedDateTimeByEntryId);
  }
  for (const e of allDocumentEntries) {
    if (analysis.documentPreviewsByEntryId[e.id] !== undefined) continue;
    try {
      const preview = await apiFetch(`${_apiBase}/clinical/data/document/modals/preview/${e.id}`);
      analysis.documentPreviewsByEntryId[e.id] = preview;
      recordDocumentPreviewFields(e.id, preview, fileTypeByEntryId, fileSizeByEntryId, createdDateByEntryId, filedDateTimeByEntryId);
    } catch (err) {
      analysis.documentPreviewsByEntryId[e.id] = null;
    }
  }

  const {
    groups: fileMatchedGroups,
    clustersChecked,
    accurxUrlMismatchAvoided,
  } = P.findFileMatchedDuplicates(
    allDocumentEntries,
    analysis.groups,
    fileTypeByEntryId,
    fileSizeByEntryId,
    createdDateByEntryId,
    filedDateTimeByEntryId
  );

  analysis.groups = P.sortGroupsByJournalOrder(analysis.groups.concat(fileMatchedGroups), analysis.entries);
  analysis.__fileMatchChecked = true;
  analysis.summary.fileMatchClustersChecked = clustersChecked;
  analysis.summary.fileMatchedGroupsFound = fileMatchedGroups.length;
  analysis.summary.accurxUrlMismatchAvoided = accurxUrlMismatchAvoided;
  const byTier = { exact: 0, high: 0, review: 0 };
  for (const g of analysis.groups) byTier[g.tier]++;
  analysis.summary.byTier = byTier;
  analysis.summary.totalCandidateGroups = analysis.groups.length;

  out.innerHTML = renderJournalAnalysisHtml(analysis, _apiBase, out.__patient.uuid);
  wireRemovalDelegation(out);
}

const TIER_LABEL = {
  exact: 'EXACT — identical text & author',
  high: 'HIGH — identical text, different author/org',
  review: 'REVIEW — same code, different content',
};
const TIER_ACTION = {
  exact: 'Recommended: bulk-remove duplicate copies',
  high: 'Recommended: bulk-remove duplicate copies',
  review: 'Recommended: manual review — consider merge, not removal',
};

// Feather-style info glyph, currentColor stroke, per DOCTRINE.md icon rule.
const INFO_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';

function tierChipHtml(tier) {
  return `<span class="tier-chip tier-${tier}"><span class="tier-dot"></span>${TIER_LABEL[tier]}</span>`;
}

// EXACT/HIGH-tier entry display — truncated snippet per copy, stacked.
// REVIEW-tier groups use reviewEntriesHtml (below) instead: full text,
// side-by-side, diff-highlighted.
function standardEntryLinesHtml(g) {
  return g.entries
    .map((e) => {
      const snippet = esc((e.rawText || '').slice(0, 140));
      return `<div class="entry-line" data-entry-id="${esc(e.id)}">
        <strong style="color:var(--text-1)">${esc(e.recordedBy || '(unknown author)')}</strong>
        ${e.recordedByOrganisation ? ` · ${esc(e.recordedByOrganisation)}` : ''}
        ${e.fromTransferEncounter ? ' · <span style="color:var(--amber)">GP2GP transfer encounter</span>' : ''}
        ${e.isKeeper ? ' · <span style="color:var(--green)">kept (earliest copy)</span>' : ''}
        <div style="margin-top:2px">${snippet}${(e.rawText || '').length > 140 ? '…' : ''}</div>
      </div>`;
    })
    .join('');
}

// Link to the patient's own care-record journal in Medicus, opened in a new
// tab (2026-07-08, confirmed live — see buildCareRecordJournalUrl's own
// header comment: there is no document-specific deep link, Medicus's
// document viewer is an in-page modal, not a route — so this is the
// closest "click to compare" gets: land the user on the right patient's
// journal and let them navigate from there).
function patientJournalLinkHtml(apiBase, patientUuid) {
  const url = window.RecordDuplicateParser.buildCareRecordJournalUrl(apiBase, patientUuid);
  if (!url) return '';
  return `<div style="margin-bottom:8px"><a href="${esc(url)}" target="_blank" rel="noopener noreferrer" style="font-size:11px;color:var(--accent)">Open this patient's record in Medicus ↗</a></div>`;
}

// Opt-in banner for the cross-record file-match second pass (2026-07-08 —
// see runFileMatchSecondPass's own header comment for why this is opt-in,
// not automatic). Shown whenever this patient has any document entries at
// all and the second pass hasn't already run for this analysis — originally
// gated on findSuspiciousDocuments flagging something, but the user found
// that too narrow (2026-07-13): the check is still worth offering even when
// the zero-fetch heuristic found nothing, so it's unconditional now. The
// suspicious-document count, when present, is still surfaced as extra
// context for why the check might be worth running.
function fileMatchSecondPassBannerHtml(analysis) {
  if (analysis.__fileMatchChecked) return '';
  if (!(analysis.entries || []).some((e) => e.kind === 'document')) return '';
  const n = (analysis.suspiciousDocuments || []).length;
  const suspiciousLine = n
    ? `${n} document${n !== 1 ? 's' : ''} show signs of reimport corruption (a raw filename/GUID left in the title, or a creation time shared with another document) but didn't match anything in the analysis above. `
    : '';
  return `<div class="file-match-second-pass" style="margin-bottom:10px;padding:8px;border:1px solid var(--amber);border-radius:var(--r-md);font-size:11px">
    <div style="color:var(--text-1)">${suspiciousLine}A slower, whole-record check by file size and type may find duplicates the normal matching structurally can't see (e.g. copies filed on different dates).</div>
    <button class="run-file-match-btn btn-ghost" style="margin-top:6px">Run full cross-document file-match check…</button>
  </div>`;
}

function renderJournalAnalysisHtml(analysis, apiBase, patientUuid) {
  const { groups, transferEncounters, summary, gp2gpWrapperCoverage } = analysis;
  const nearMisses = (gp2gpWrapperCoverage && gp2gpWrapperCoverage.nearMisses) || [];
  const patientLinkHtml = patientJournalLinkHtml(apiBase, patientUuid);
  const fileMatchBannerHtml = fileMatchSecondPassBannerHtml(analysis);
  if (!groups.length && !transferEncounters.length && !nearMisses.length) {
    return `${patientLinkHtml}${fileMatchBannerHtml}<div class="empty-state">No candidate duplicate entries found in this patient's journal.</div>`;
  }

  const summaryLine = `<div style="font-size:12px;color:var(--text-3);margin-bottom:10px">
    <span class="mono">${summary.totalEntries}</span> comparable entr${summary.totalEntries !== 1 ? 'ies' : 'y'} read from this journal ·
    <span class="mono">${summary.totalCandidateGroups}</span> candidate duplicate group${summary.totalCandidateGroups !== 1 ? 's' : ''}
    (${summary.byTier.exact} exact, ${summary.byTier.high} high, ${summary.byTier.review} review)
    ${summary.transferEncountersTotal ? ` · ${summary.transferEncountersConfirmed}/${summary.transferEncountersTotal} GP2GP transfer encounter(s) content-confirmed` : ''}
    ${summary.suppressedSameConsultationTotal ? ` · <span style="color:var(--amber)">${summary.suppressedSameConsultationTotal} group(s) suppressed as same-consultation (${summary.suppressedSameConsultationFromTransfer} from transfer encounters)</span>` : ''}
    ${summary.suppressedQuantityMismatchTotal ? ` · <span style="color:var(--amber)">${summary.suppressedQuantityMismatchTotal} prescription group(s) suppressed as quantity-mismatch (different issued amounts, not a duplicate)</span>` : ''}
    ${summary.suppressedProblemLinkageTotal ? ` · <span style="color:var(--amber)">${summary.suppressedProblemLinkageTotal} problem code(s) suppressed as same-record linkage (one real problem linked from multiple encounters, not duplicate records)</span>` : ''}
    ${summary.excludedPrescriptionTimingTotal ? ` · <span style="color:var(--amber)">${summary.excludedPrescriptionTimingTotal} prescription group(s) excluded after timing cross-check (issued a minute+ apart, not a duplicate)</span>` : ''}
    ${summary.excludedQuestionnaireMismatchTotal ? ` · <span style="color:var(--amber)">${summary.excludedQuestionnaireMismatchTotal} document group(s) excluded after questionnaire-template cross-check (different questionnaire types)</span>` : ''}
    ${summary.documentGroupsSplitByFileType ? ` · <span style="color:var(--amber)">${summary.documentGroupsSplitByFileType} document group(s) split by file type/size (were wrongly merged — different documents sharing a date)</span>` : ''}
    ${summary.noteAttachmentMismatchTotal ? ` · <span style="color:var(--amber)">${summary.noteAttachmentMismatchTotal} note group(s) downgraded to review after an attached-document mismatch (same note text, different attachment)</span>` : ''}
    ${summary.documentPreviewsChecked ? ` · <span class="mono">${summary.documentPreviewsWithFileSize}/${summary.documentPreviewsChecked}</span> document preview(s) had a usable file-size field` : ''}
    ${summary.documentLinkedGroupsFound ? ` · <span style="color:var(--amber)">${summary.documentLinkedGroupsFound} document-linked duplicate group(s) found (experimental — see warning on each)</span>` : ''}
    ${summary.fileMatchClustersChecked ? ` · <span class="mono">${summary.fileMatchedGroupsFound}/${summary.fileMatchClustersChecked}</span> cross-record file-size/type cluster(s) surfaced as new group(s)` : ''}
    ${summary.accurxUrlMismatchAvoided ? ` · <span style="color:var(--amber)">${summary.accurxUrlMismatchAvoided} accurx URL-attachment(s) kept apart from a file-size/type match (different link, not a duplicate)</span>` : ''}
  </div>`;

  const groupsHtml = groups
    .map((g, gIdx) => {
      // Side-by-side cards for every note/problem group (2026-07-08 user
      // feedback, extended to EXACT the same day): even when the text is
      // identical, the cards surface what still differs — author/org, and
      // the per-copy created timestamp recovered from the UUIDv7 id (an
      // EXACT pair's copies were created years apart; the stacked snippet
      // view hid that entirely). REVIEW and documentLinked groups of any
      // kind keep it too.
      const sideBySide = g.tier === 'review' || g.documentLinked || g.kind === 'note' || g.kind === 'problem';
      const bodyHtml = sideBySide ? reviewEntriesHtml(g, analysis.documentPreviewsByEntryId, apiBase) : standardEntryLinesHtml(g);
      return `<div class="dup-group" data-group-idx="${gIdx}">
      <div class="dup-group-head">
        <span class="dup-group-key"><strong>${esc(g.kind)}</strong> · <span class="entry-date">${esc(g.date || 'unknown date')}</span> · <span class="code">${esc(g.code)}</span></span>
        ${tierChipHtml(g.tier)}
      </div>
      ${
        g.documentLinked
          ? `<div style="font-size:11px;color:var(--amber);margin-top:2px;font-weight:600">⚠ One copy of this pair is still linked to its source document and is kept automatically — only the freestanding duplicate is ever offered for removal. The matched text is derived from the document's linked-entry data; double-check it against the source document before removing.</div>`
          : ''
      }
      ${
        g.fileMatched
          ? `<div style="font-size:11px;color:var(--amber);margin-top:2px;font-weight:600">⚠ Matched by file size and type across different dates, not by the journal's own type/date fields — the journal grouping missed this pair entirely. Same size and type is strong evidence but not proof of identical content; check the "Download original" links in Compare fields before removing.</div>`
          : ''
      }
      ${
        g.attachmentMismatch
          ? `<div style="font-size:11px;color:var(--amber);margin-top:2px;font-weight:600">⚠ These entries have different attached documents (confirmed by file size and type) even though the note text and author match — use the "Download attached document ↗" links below to compare the originals directly before removing.</div>`
          : ''
      }
      ${
        g.emptyWrapperOnly
          ? `<div style="font-size:11px;color:var(--amber);margin-top:2px;font-weight:600">⚠ These entries only "match" on a content-free reimport wrapper — the SNOMED code and problem/topic are shared, but nothing here confirms the underlying content is the same (e.g. several different vaccines given the same day are often coded this way). Verify independently before removing.</div>`
          : ''
      }
      <div class="rec-line">${INFO_ICON}<span>${TIER_ACTION[g.tier]}</span></div>
      ${g.gp2gpWrapper ? '<div style="font-size:11px;color:var(--amber);margin-top:2px">GP2GP import-wrapper text detected</div>' : ''}
      ${bodyHtml}
      <div class="removal-slot" data-group-idx="${gIdx}" style="margin-top:8px">${removalSlotHtml(g, gIdx)}</div>
    </div>`;
    })
    .join('');

  const unconfirmedTransfers = transferEncounters.filter((t) => !t.contentConfirmed);
  const transferHtml = unconfirmedTransfers.length
    ? `<div style="margin-top:10px;font-size:11px;color:var(--text-3)">
        ${unconfirmedTransfers.length} GP2GP transfer encounter(s) on ${unconfirmedTransfers.map((t) => esc(t.date || '?')).join(', ')}
        had no confirmed content match — not auto-tiered, review manually if needed.
      </div>`
    : '';

  // Diagnostic-only: how often the GP2GP-wrapper regex (built from a single
  // 2026-07-01 sample) actually fires on this patient's real data, plus any
  // near-miss text that looks wrapper-like but wasn't stripped — evidence
  // for whether the pattern needs broadening. Capped at 5 samples so a
  // heavily-transferred patient doesn't dump an unreadable wall of text.
  const wrapperHtml =
    summary.gp2gpWrapperStrictMatches || nearMisses.length
      ? `<div style="margin-top:10px;padding:10px;border:1px solid var(--border);border-radius:var(--r-md);font-size:11px;color:var(--text-3)">
          <strong style="color:var(--text-1)">GP2GP-wrapper text coverage (diagnostic)</strong>
          <div style="margin-top:4px">${summary.gp2gpWrapperStrictMatches} entr${summary.gp2gpWrapperStrictMatches !== 1 ? 'ies' : 'y'} matched the known wrapper pattern.</div>
          ${
            nearMisses.length
              ? `<div style="margin-top:6px;color:var(--amber)">${nearMisses.length} near-miss(es) — wrapper-like text NOT stripped by the current pattern:</div>` +
                nearMisses
                  .slice(0, 5)
                  .map(
                    (nm) => `<div style="margin-top:4px;padding-top:4px;border-top:1px solid var(--border)">
                ${esc(nm.kind)} · ${esc(nm.date || 'unknown date')}${nm.fromTransferEncounter ? ' · <span style="color:var(--amber)">transfer encounter</span>' : ''}
                <div style="margin-top:2px">${esc(nm.sample)}${nm.sample.length >= 160 ? '…' : ''}</div>
              </div>`
                  )
                  .join('') +
                (nearMisses.length > 5 ? `<div style="margin-top:4px">…and ${nearMisses.length - 5} more.</div>` : '')
              : ''
          }
        </div>`
      : '';

  return patientLinkHtml + summaryLine + fileMatchBannerHtml + groupsHtml + transferHtml + wrapperHtml;
}

// ── Removal action (EXACT-tier, confirmed-write kinds only) ─────────────────
// Live patient data, no confirmed "undo" endpoint — so this only offers
// removal where the kind has a confirmed write contract, and requires an
// explicit (pre-filled, editable) reason before firing anything.
//
// The parser auto-picks a keeper (earliest UUIDv7 id timestamp) when at
// least two members have a decodable one — but on a group of 3+ copies it's
// common for only one or zero ids to be decodable (legacy/non-UUIDv7 ids
// mixed in from an older migration), which used to leave the group with NO
// removal option at all. Now that case falls through to a manual
// "choose which copy to keep" step instead of a dead end.
function removalSlotHtml(g, gIdx) {
  const removable = window.RecordDuplicateParser.isRemovableKind(g.kind);
  if (g.tier === 'review') return reviewActionsHtml(g, gIdx);
  if (!removable) return '';
  // documentLinked groups carry a pseudo-entry with recordedBy always null
  // (not part of the confirmed careRecordElements shape — see
  // findDocumentLinkedDuplicates), so they will essentially never tier
  // EXACT even on a genuine text match — recordedBySet always has >=2
  // members (the real entry's author plus the pseudo-entry's ''). Widened
  // to HIGH here specifically for documentLinked groups so the explicit
  // "build removal too" decision (2026-07-07) actually takes effect,
  // without loosening the general EXACT-only gate for ordinary groups.
  if (g.tier === 'high' && g.documentLinked) return removableSlotHtml(g, gIdx);
  // HIGH-tier note/problem groups (identical text, different author/org —
  // the classic GP2GP reimport signature) get remove + merge (2026-07-08
  // user request; the help copy has promised HIGH bulk removal all along).
  // Deliberately NOT documentLinked groups (their merge would edit a
  // document-linked pseudo-entry via the note contract — never live-tested)
  // and NOT prescriptions (their duplicates are governed by the quantity/
  // timing cross-checks, and "merging" two prescription issues has no
  // meaning).
  if (g.tier === 'high' && (g.kind === 'note' || g.kind === 'problem')) return highActionsHtml(g, gIdx);
  if (g.tier !== 'exact') return '';
  return removableSlotHtml(g, gIdx);
}

// HIGH-tier note/problem action row: the direct EXACT-style removal flow
// (text is identical, so no "are these equivalent?" judgment step is
// needed) plus the same merge-suggestion path REVIEW groups get — automated
// apply for note-kind, copy-paste guidance for problem-kind (no confirmed
// problem edit endpoint yet).
function highActionsHtml(g, gIdx) {
  const mergeBtn =
    g.kind === 'note' && !g.documentLinked
      ? `<button class="note-compare-merge-btn btn-ghost" data-group-idx="${gIdx}">Compare &amp; merge…</button>`
      : `<button class="review-merge-btn btn-ghost" data-group-idx="${gIdx}">Suggest a merge…</button>`;
  return `<div style="display:flex;gap:8px;flex-wrap:wrap">
    ${removableSlotHtml(g, gIdx)}
    ${mergeBtn}
  </div>`;
}

// The "choose keeper, then remove" two-click flow, factored out so the
// REVIEW-tier "these are equivalent" override (below) can drop straight
// into the exact same flow already live-tested for EXACT-tier groups,
// rather than duplicating it.
function removableSlotHtml(g, gIdx) {
  if (!g.keeperEntryId) return chooseKeeperButtonHtml(gIdx);
  return removalButtonHtml(g, gIdx, g.keeperEntryId);
}

function chooseKeeperButtonHtml(gIdx) {
  return `<button class="choose-keeper-btn btn-ghost" data-group-idx="${gIdx}">
    Choose which copy to keep…
  </button>`;
}

function chooseKeeperFormHtml(g, gIdx) {
  const rows = g.entries
    .map(
      (e) => `<label style="display:block;margin-top:6px;color:var(--text-2)">
        <input type="radio" name="keeper-choice-${gIdx}" class="keeper-choice-radio" data-group-idx="${gIdx}" value="${esc(e.id)}" />
        <strong style="color:var(--text-1)">${esc(e.recordedBy || '(unknown author)')}</strong>${e.recordedByOrganisation ? ` · ${esc(e.recordedByOrganisation)}` : ''}
        <div style="margin-top:2px;margin-left:18px">${esc((e.rawText || '').slice(0, 140))}</div>
      </label>`
    )
    .join('');
  return `<div class="choose-keeper-form" style="border:1px solid var(--border);border-radius:var(--r-md);padding:8px;font-size:11px">
    <div style="color:var(--text-1)">
      Could not automatically tell which of these ${g.entries.length} copies is the original (fewer than two have a
      decodable id timestamp) — pick the one to KEEP; the rest will be offered for removal.
    </div>
    ${rows}
    <div style="margin-top:8px;display:flex;gap:8px">
      <button class="continue-keeper-btn btn-primary" data-group-idx="${gIdx}" disabled>Continue</button>
      <button class="cancel-removal-btn btn-ghost" data-group-idx="${gIdx}">Cancel</button>
    </div>
  </div>`;
}

function removalButtonHtml(g, gIdx, keeperId) {
  const toRemove = g.entries.filter((e) => e.id !== keeperId).length;
  return `<button class="remove-group-btn" data-group-idx="${gIdx}" data-keeper-id="${esc(keeperId)}" style="background:var(--red-dim);color:var(--red);border:1px solid var(--red-line)">
    Remove ${toRemove} duplicate cop${toRemove !== 1 ? 'ies' : 'y'}
  </button>`;
}

// Pre-filled rather than blank: with hundreds of these to process, typing a
// fresh reason each time isn't feasible. Still a free-text field the user can
// edit/replace per group — the default just covers the common case.
const DEFAULT_REMOVAL_REASON =
  'Removing duplicate entry after human review of automated detection list of duplicates. See keeper record.';

// Explicit KEEP / REMOVE sections (2026-07-08 user feedback: "Keeping:
// (unknown author)" followed by the removal list on the next line read as
// one flowing sentence, leaving it genuinely unclear which copy was being
// discarded). The copies' cards above also get KEEP/DISCARD fate banners
// via markGroupFates, and clicking a card switches the keeper — the
// text labels are the primary cue (colour is reinforcement only, per the
// suite's colourblind doctrine).
function entryOneLiner(e) {
  return `${esc((e && e.recordedBy) || '(unknown author)')}${e && e.recordedByOrganisation ? ` · ${esc(e.recordedByOrganisation)}` : ''}`;
}

function renderRemovalFormHtml(g, gIdx, keeperId) {
  const keeperEntry = g.entries.find((e) => e.id === keeperId);
  const toRemove = g.entries.filter((e) => e.id !== keeperId);
  const listHtml = toRemove
    .map((e) => `<div style="font-size:11px;color:var(--text-2);margin-top:2px">– ${entryOneLiner(e)}</div>`)
    .join('');
  // Documents use the "Remove from record" contract (removed completely),
  // the others "mark-incorrect-and-hidden" (hidden) — word it accurately.
  const removalVerb =
    g.kind === 'document'
      ? `permanently remove ${toRemove.length} document${toRemove.length !== 1 ? 's' : ''} from this patient's record`
      : `permanently hide ${toRemove.length} ${esc(g.kind)} ${toRemove.length !== 1 ? 'entries' : 'entry'} from this patient's record`;
  return `<div class="removal-form" style="border:1px solid var(--red-line);border-radius:var(--r-md);padding:8px;font-size:11px">
    <div style="color:var(--text-1)">This will ${removalVerb}. There is no confirmed undo for this action.</div>
    <div class="note-link-warning" data-group-idx="${gIdx}"></div>
    <div style="margin-top:6px;display:flex;gap:12px;flex-wrap:wrap">
      <div style="flex:1 1 200px;border:1px solid var(--green);border-radius:var(--r-md);padding:6px 8px">
        <div style="font-weight:700;color:var(--green)">✓ KEEPING</div>
        <div style="font-size:11px;color:var(--text-2);margin-top:2px">– ${entryOneLiner(keeperEntry)}</div>
      </div>
      <div style="flex:1 1 200px;border:1px solid var(--red-line);border-radius:var(--r-md);padding:6px 8px">
        <div style="font-weight:700;color:var(--red)">✗ REMOVING (permanently hidden)</div>
        ${listHtml}
      </div>
    </div>
    <div style="margin-top:6px;color:var(--text-3)">Wrong way round? Click the copy to keep in the cards above — the green highlight will follow.</div>
    <label style="display:block;margin-top:8px;color:var(--text-2)">Reason (required)</label>
    <textarea class="removal-reason" data-group-idx="${gIdx}" rows="2" style="width:100%;box-sizing:border-box;margin-top:4px;font-size:11px;background:var(--bg-mid);color:var(--text-1);border:1px solid var(--border)">${esc(DEFAULT_REMOVAL_REASON)}</textarea>
    <div style="margin-top:8px;display:flex;gap:8px">
      <button class="confirm-removal-btn" data-group-idx="${gIdx}" data-keeper-id="${esc(keeperId)}" style="background:var(--red);color:var(--bg-deep);border:none;padding:7px 16px;border-radius:var(--r-md);font-weight:600">Confirm removal</button>
      <button class="cancel-removal-btn btn-ghost" data-group-idx="${gIdx}">Cancel</button>
    </div>
    <div class="removal-status" data-group-idx="${gIdx}" style="margin-top:6px"></div>
  </div>`;
}

// Marks which copy card is the keeper while a removal/merge form is open,
// and makes the cards clickable to switch it. Single visual cue: a green
// outline on the kept card, everything else faded — matching the Compare &
// merge view. (2026-07-08 user feedback: the earlier per-card
// "✓ KEEP / ✗ DISCARD" banners duplicated the form's KEEPING/REMOVING
// panels with different wording and misaligned confusingly with the
// columns, so they're gone — the form's panels are the single labelled
// statement, the outline is the at-a-glance pointer.)
function markGroupFates(out, gIdx, keeperId) {
  const groupEl = out.querySelector(`.dup-group[data-group-idx="${gIdx}"]`);
  if (!groupEl) return;
  groupEl.querySelectorAll('.entry-line[data-entry-id]').forEach((card) => {
    // Strip any banner left by an older build before this simplification.
    const banner = card.querySelector('.fate-banner');
    if (banner) banner.remove();
    const keep = card.dataset.entryId === keeperId;
    card.style.outline = keep ? '2px solid var(--green)' : '';
    card.style.opacity = keep ? '1' : '0.6';
    card.style.cursor = 'pointer';
    card.title = keep ? 'This copy will be kept' : 'Click to keep this copy instead';
  });
}

function clearGroupFates(out, gIdx) {
  const groupEl = out.querySelector(`.dup-group[data-group-idx="${gIdx}"]`);
  if (!groupEl) return;
  groupEl.querySelectorAll('.entry-line[data-entry-id]').forEach((card) => {
    const banner = card.querySelector('.fate-banner');
    if (banner) banner.remove();
    card.style.outline = '';
    card.style.opacity = '';
    card.style.cursor = '';
    card.removeAttribute('title');
  });
}

// Progressive linked-problems safety check for note-kind removals
// (2026-07-08, from a real pair: the GP2GP original was linked to its
// problem, the reimport copy wasn't — journal data doesn't show this, only
// clinical/data/note/overview/{noteId} does). Fetched after the form
// renders so the form is never blocked on the network; overviews are
// cached on the panel element for reuse by "Compare details…".
async function enhanceRemovalFormForNotes(out, gIdx, keeperId) {
  const g = out.__analysis.groups[gIdx];
  if (g.kind !== 'note' || g.documentLinked) return;
  const overviews = await fetchNoteOverviews(out, g);
  const slot = out.querySelector(`.removal-slot[data-group-idx="${gIdx}"]`);
  const warnEl = slot && slot.querySelector('.note-link-warning');
  // The form may have been cancelled/replaced while we fetched.
  if (!warnEl) return;
  const linked = (id) => {
    const o = overviews[id];
    return o && Array.isArray(o.linkedProblems) && o.linkedProblems.length ? o.linkedProblems : null;
  };
  const keeperLinked = linked(keeperId);
  const losing = g.entries
    .filter((e) => e.id !== keeperId)
    .map((e) => linked(e.id))
    .find((lp) => lp);
  if (losing && !keeperLinked) {
    const names = losing
      .map((p) => p.problemCodeDescription)
      .filter(Boolean)
      .join('; ');
    warnEl.innerHTML = `<div style="margin-top:6px;padding:6px 8px;border:1px solid var(--amber);border-radius:var(--r-md);color:var(--amber);font-weight:600">⚠ The copy being removed is linked to problem(s) (${esc(names)}) — the kept copy is not. Removing it loses that linkage. Consider clicking the linked copy above to keep it instead.</div>`;
  }
}

// One overview fetch per copy per session, cached on the panel element.
async function fetchNoteOverviews(out, g) {
  const P = window.RecordDuplicateParser;
  out.__noteOverviews = out.__noteOverviews || {};
  for (const e of g.entries) {
    if (out.__noteOverviews[e.id] !== undefined) continue;
    try {
      out.__noteOverviews[e.id] = await apiFetch(P.buildNoteOverviewUrl(_apiBase, e.id));
    } catch (err) {
      out.__noteOverviews[e.id] = null;
    }
  }
  return out.__noteOverviews;
}

// The unified note compare & merge view (2026-07-08): the full-record field
// table (via note/overview) and the merge editor in ONE place, matching the
// document Compare-fields pattern. The kept column is headed "✓ KEEP" in
// green (the kept card above gets a matching green outline; clicking a card
// switches the keeper and re-renders this view). Only "Note text" is
// mergeable — the change-note contract is a text replace, every other note
// field round-trips unchanged — so only that row gets radios; the rest are
// read-only evidence with differs-highlighting.
function renderNoteCompareMergeHtml(g, gIdx, keeperId, comparison, suggestedText) {
  const P = window.RecordDuplicateParser;
  const colHeaders = g.entries
    .map((e) =>
      e.id === keeperId
        ? `<th style="text-align:left;padding:4px 8px;font-size:11px;color:var(--green)">✓ KEEP — kept copy</th>`
        : `<th style="text-align:left;padding:4px 8px;font-size:11px;color:var(--text-2)">Other copy</th>`
    )
    .join('');
  const rowsHtml = comparison.rows
    .map((row) => {
      const mergeable = row.label === 'Note text';
      const cells = row.values
        .map((v, vIdx) => {
          const keepCol = v.entryId === keeperId;
          const cellStyle = `padding:4px 8px;vertical-align:top;text-align:left;font-size:11px;color:var(--text-1);border-top:1px solid var(--border)${keepCol ? ';border-left:2px solid var(--green)' : ''}`;
          if (!mergeable) {
            return `<td style="${cellStyle}">${v.value ? esc(v.value) : '<span style="color:var(--text-3)">(none)</span>'}</td>`;
          }
          // Radio value is the CLEANED text (GP2GP wrapper/junk stripped) —
          // picking a copy loads its usable content into the merge editor,
          // never the junk. Falls back to the journal's own text when the
          // overview fetch failed.
          const entry = g.entries[vIdx];
          const raw = v.value !== null ? v.value : (entry && entry.rawText) || '';
          const cleaned = P.splitWrapperText(raw || '').content.trim();
          return `<td style="${cellStyle}">
            <label style="display:flex;gap:6px;align-items:flex-start;cursor:pointer">
              <input type="radio" class="note-text-pick" name="note-text-${gIdx}" data-group-idx="${gIdx}" value="${esc(cleaned)}" />
              <span>${v.value ? esc(v.value) : '<span style="color:var(--text-3)">(none)</span>'}</span>
            </label>
          </td>`;
        })
        .join('');
      return `<tr${row.differs ? ' style="background:var(--amber-dim)"' : ''}>
        <td style="padding:4px 8px;font-size:11px;color:var(--text-2);white-space:nowrap;border-top:1px solid var(--border)">${esc(row.label)}${mergeable ? ' <span title="Mergeable — pick a copy\'s text or edit the merged text below" style="color:var(--accent)">✎</span>' : ''}</td>
        ${cells}
      </tr>`;
    })
    .join('');
  const applyAvailable = window.RecordDuplicateParser.isRemovableKind(g.kind) && keeperId;
  return `<div class="note-compare-merge-form" data-keeper-id="${esc(keeperId)}" style="border:1px solid var(--border);border-radius:var(--r-md);padding:8px;font-size:11px">
    <div style="color:var(--text-1)">Each copy's full note record, side by side (fields the journal doesn't show — linked problems, created timestamps). Differing rows are highlighted. Only <strong>Note text</strong> (✎) is mergeable — pick a copy's text or edit the merged text below; every other field stays as the kept copy has it. Click a card above to change which copy is kept.</div>
    <table style="width:100%;border-collapse:collapse;margin-top:8px">
      <thead><tr><th></th>${colHeaders}</tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <div style="margin-top:8px;color:var(--text-2)">Merged text (edit freely — a radio pick replaces it):</div>
    <textarea class="merge-suggestion-text" data-group-idx="${gIdx}" rows="3" style="width:100%;box-sizing:border-box;margin-top:4px;font-size:11px;background:var(--bg-mid);color:var(--text-1);border:1px solid var(--border)">${esc(suggestedText)}</textarea>
    <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
      ${applyAvailable ? `<button class="apply-note-merge-btn" data-group-idx="${gIdx}" data-keeper-id="${esc(keeperId)}" style="background:var(--accent);color:var(--bg-deep);border:none;padding:7px 16px;border-radius:var(--r-md);font-weight:600">Apply merge &amp; remove other copies</button>` : ''}
      <button class="copy-merge-btn btn-ghost" data-group-idx="${gIdx}">Copy merged text</button>
      <button class="cancel-removal-btn btn-ghost" data-group-idx="${gIdx}">Back</button>
    </div>
  </div>`;
}

async function showNoteCompareMerge(out, gIdx, keeperId) {
  const P = window.RecordDuplicateParser;
  const g = out.__analysis.groups[gIdx];
  const kid = keeperId || g.keeperEntryId || (g.entries[0] && g.entries[0].id);
  const slot = out.querySelector(`.removal-slot[data-group-idx="${gIdx}"]`);
  slot.innerHTML = `<div style="font-size:11px;color:var(--text-3)">Fetching each copy's full note record…</div>`;
  const overviews = await fetchNoteOverviews(out, g);
  const comparison = P.buildNoteFieldComparison(g, overviews);
  const suggestion = P.buildMergeSuggestion(g);
  slot.innerHTML = renderNoteCompareMergeHtml(g, gIdx, kid, comparison, suggestion.suggestedText);
  markGroupFates(out, gIdx, kid);
}

// ── REVIEW-tier comparison + merge (2026-07-06) ──────────────────────────────
// REVIEW groups ("manual review — consider merge, not removal") previously
// had no tooling at all beyond the 140-char snippet shown to every other
// tier. reviewEntriesHtml replaces that snippet entirely for REVIEW groups —
// shown by default (no click needed: a push, not a pull), side-by-side, with
// differences from a reference copy highlighted. reviewActionsHtml (used as
// this tier's removalSlotHtml — see above) supplies the action buttons: a
// path to override back into the existing EXACT-style removal flow once a
// human has judged the copies equivalent, and a merge-suggestion path for
// groups with genuine differences.
function diffSegmentsHtml(segments) {
  return segments
    .map((seg) => {
      const text = esc(seg.text);
      if (seg.op === 'insert') return `<span class="diff-insert">${text}</span>`;
      if (seg.op === 'delete') return `<span class="diff-delete">${text}</span>`;
      return `<span>${text}</span>`;
    })
    .join(' ');
}

// Reference entry: the first non-junk-user entry if one exists (the
// junk-user copy is more likely the reimport artifact), else entry 0. Same
// choice RecordDuplicateParser.buildMergeSuggestion makes, kept in sync
// deliberately rather than importing one shared index-picker for two very
// small call sites.
function pickReferenceIdx(entries) {
  const idx = entries.findIndex((e) => !window.RecordDuplicateParser.isJunkRecordedBy(e.recordedBy));
  return idx >= 0 ? idx : 0;
}

// Side-by-side cards, one per copy, wrapping onto new rows on narrow
// viewports (flex-wrap) rather than a fixed column count — reads fine at
// both the 2-copy common case and a 4+ copy group. `entry-line` class kept
// so markEntryRemoved (used by both the removal and note-merge flows) can
// still find and strike through the right card after a removal.
function reviewEntriesHtml(g, previewsByEntryId, apiBase) {
  const P = window.RecordDuplicateParser;
  const entries = g.entries;
  // For documentLinked pairs the reference is always the copy still linked
  // to its source document — it's the genuine original (forced keeper), so
  // the diff should read as "what the freestanding duplicate adds/loses
  // relative to the original".
  const linkedIdx = g.documentLinked ? entries.findIndex((e) => e.fromDocumentLinkedElement) : -1;
  const refIdx = linkedIdx >= 0 ? linkedIdx : pickReferenceIdx(entries);
  const refContent = P.splitWrapperText(entries[refIdx].rawText || '').content.trim();

  // Per-copy created timestamp recovered from the UUIDv7 id — zero fetches,
  // and it's the same signal the keeper tie-breaker already uses. An EXACT
  // pair's copies routinely differ ONLY here (original created at
  // registration, duplicate created by a later reimport), so it's the one
  // line that shows why two "identical" entries are both on the record.
  const idTimes = entries.map((e) => P.decodeIdTimestamp(e.id));
  const idTimesDiffer = new Set(idTimes.filter((t) => t !== null)).size > 1;
  const fmtIdTime = (ms) => (ms === null ? null : new Date(ms).toISOString().slice(0, 16).replace('T', ' '));

  const cards = entries
    .map((e, i) => {
      const split = P.splitWrapperText(e.rawText || '');
      const content = split.content.trim();
      const contentHtml = i === refIdx ? esc(content) : diffSegmentsHtml(P.wordDiff(refContent, content));
      // Show the GP2GP wrapper text in place (highlighted amber) rather than
      // silently stripping it — it's a visual guide to WHICH copy is the
      // reimport artifact to reject (2026-07-08 user request). The diff is
      // still computed on the cleaned content, so the wrapper frames it
      // without polluting the added/removed highlighting.
      const wrapHl = (t) =>
        `<span style="background:var(--amber-dim);color:var(--amber);border-radius:3px;padding:0 2px" title="GP2GP import wrapper — not real note content">${esc(t)}</span>`;
      const hasWrapper = !!(split.prefix || split.suffix);
      const bodyHtml = [split.prefix ? wrapHl(split.prefix) : '', contentHtml, split.suffix ? wrapHl(split.suffix) : '']
        .filter(Boolean)
        .join(' ');
      const junk = P.isJunkRecordedBy(e.recordedBy);
      const createdLine = fmtIdTime(idTimes[i])
        ? `<div class="mono" style="font-size:10px;margin-top:4px;color:${idTimesDiffer ? 'var(--amber)' : 'var(--text-3)'}">created ${fmtIdTime(idTimes[i])} <span style="color:var(--text-4)">(from record id)</span></div>`
        : '';
      // Attached-document download links (2026-07-13) — mirrors the
      // "Download original ↗" link already offered on document-kind field
      // comparison (renderDocumentFieldComparisonHtml): the closest this
      // tool gets to "click to compare", especially for an
      // attachmentMismatch group where the note text/author match but the
      // underlying attachment doesn't — download both and check directly.
      // Zero extra fetch here: previews for every attachedDocumentIds entry
      // were already fetched by applyOnDemandCrossChecks's note-kind branch.
      const attachmentLinksHtml = (e.attachedDocumentIds || [])
        .map((docId, docIdx) => {
          const preview = previewsByEntryId && previewsByEntryId[docId];
          const url = preview && P.buildDocumentDownloadUrl(apiBase, preview.fileId);
          if (!url) return null;
          const label = e.attachedDocumentIds.length > 1 ? `Download attachment ${docIdx + 1} ↗` : 'Download attached document ↗';
          return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent)">${label}</a>`;
        })
        .filter(Boolean)
        .join(' · ');
      return `<div class="entry-line" data-entry-id="${esc(e.id)}" style="flex:1 1 240px;min-width:200px;border:1px solid var(--border);border-radius:var(--r-md);padding:8px;background:var(--bg-mid)">
        <div><strong style="color:var(--text-1)">${esc(e.recordedBy || '(unknown author)')}</strong>${e.recordedByOrganisation ? ` · ${esc(e.recordedByOrganisation)}` : ''}</div>
        <div style="font-size:10px;color:var(--text-3);margin-top:2px">
          ${junk ? '<span style="color:var(--amber)">possible reimport artifact</span>' : ''}
          ${e.fromTransferEncounter ? ' · <span style="color:var(--amber)">GP2GP transfer</span>' : ''}
          ${hasWrapper ? ' · <span style="color:var(--amber)">GP2GP wrapper detected</span>' : ''}
          ${e.fromDocumentLinkedElement ? ' · <span style="color:var(--green)">still linked to source document — kept</span>' : ''}
          ${g.documentLinked && !e.fromDocumentLinkedElement ? ' · <span style="color:var(--amber)">freestanding copy</span>' : ''}
          ${e.isKeeper ? ' · <span style="color:var(--green)">kept (earliest copy)</span>' : ''}
          ${i === refIdx ? ' · reference copy' : ''}
          ${g.fileMatched ? ` · <span style="color:var(--text-2)">${esc(e.date || 'unknown date')}</span>` : ''}
          ${e.titleJunkPrefix ? ' · <span style="color:var(--amber)">title has raw filename/GUID prefix</span>' : ''}
          ${e.createdAfterFiled ? ' · <span style="color:var(--amber)">created after filed (reimport anomaly)</span>' : ''}
        </div>
        <div style="margin-top:6px">${bodyHtml}</div>
        ${createdLine}
        ${attachmentLinksHtml ? `<div style="font-size:10px;margin-top:4px">${attachmentLinksHtml}</div>` : ''}
      </div>`;
    })
    .join('');

  return `<div style="margin-top:8px">
    <div style="font-size:11px;color:var(--text-2);margin-bottom:6px">Differences from the reference copy are highlighted (<span class="diff-insert">added</span> / <span class="diff-delete">removed</span>).</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px">${cards}</div>
  </div>`;
}

function reviewActionsHtml(g, gIdx) {
  const removable = window.RecordDuplicateParser.isRemovableKind(g.kind);
  // Document-kind groups get field-by-field comparison instead of the
  // blob word-diff merge suggestion — a document's differences are
  // structured metadata (Title/Type/dates), not free text, and the blob
  // approach mostly just surfaced Title/Type as one mass (live finding,
  // 2026-07-08). Every other kind keeps the existing merge-suggestion path.
  // Note-kind groups get ONE unified flow (2026-07-08 user feedback — the
  // separate "Compare details…" and "Suggest a merge…" buttons were two
  // halves of the same job): the full-record field table AND the merge
  // editor together. Not offered on documentLinked groups — their
  // pseudo-entry ids come from the document-entries endpoint and have never
  // been confirmed against note/overview.
  const secondBtn =
    g.kind === 'document'
      ? `<button class="compare-fields-btn btn-ghost" data-group-idx="${gIdx}">Compare fields…</button>`
      : g.kind === 'note' && !g.documentLinked
        ? `<button class="note-compare-merge-btn btn-ghost" data-group-idx="${gIdx}">Compare &amp; merge…</button>`
        : `<button class="review-merge-btn btn-ghost" data-group-idx="${gIdx}">Suggest a merge…</button>`;
  // Documents are REVIEW-capped because their metadata comparison is
  // unreliable, not because they're judged equivalent — so the removal
  // button reads plainly for them ("Remove a duplicate copy…") rather than
  // asserting equivalence the way it does for genuine text REVIEW groups.
  const removeLabel =
    g.kind === 'document' ? 'Remove a duplicate copy…' : 'These are equivalent — remove duplicates';
  return `<div style="display:flex;gap:8px;flex-wrap:wrap">
    ${removable ? `<button class="review-equivalent-btn" data-group-idx="${gIdx}" style="background:var(--red-dim);color:var(--red);border:1px solid var(--red-line)">${removeLabel}</button>` : ''}
    ${secondBtn}
  </div>`;
}

// Field-by-field comparison for document-kind REVIEW groups (2026-07-08 —
// see buildDocumentFieldComparison's own header comment for why documents
// get this instead of the blob merge-suggestion). Fields with a confirmed
// write mapping (row.editKey — Title/Type/Document date/Author/Record date,
// via the clinical/document/edit-details contract confirmed 2026-07-08) can
// be applied to the kept copy automatically; the rest (Created/Filed/File
// type/File size are system-derived, Clinical specialty never live-tested
// non-null) stay reference-only via the copyable summary.
// Each field row defaults its radio to whichever copy is the group's
// computed keeper (earliest UUIDv7 timestamp — same tie-breaker used
// everywhere else in this tool), but every field can be overridden
// independently, since the "better" copy often differs per field (e.g. the
// duplicate's Record date is usually the reimport-collapsed one, but its
// Document date and Author may still be fine).
function renderDocumentFieldComparisonHtml(g, gIdx, comparison, previewByEntryId) {
  const entryIds = g.entries.map((e) => e.id);
  // Each copy gets TWO physical columns — a fixed narrow radio column and a
  // left-aligned value column — so the radios line up vertically and the
  // values line up vertically (live feedback 2026-07-08: radio + value
  // sharing one auto-width cell rendered misaligned and cramped).
  // A download link per copy (2026-07-08, confirmed live — see
  // buildDocumentDownloadUrl's own header comment) is the closest this tool
  // gets to "click to compare": the ORIGINAL file, same bytes the
  // fileType/fileSize check already compares, not a converted copy.
  const colHeaders = g.entries
    .map((e) => {
      const preview = previewByEntryId && previewByEntryId[e.id];
      const downloadUrl = preview && window.RecordDuplicateParser.buildDocumentDownloadUrl(_apiBase, preview.fileId);
      const downloadLink = downloadUrl
        ? ` · <a href="${esc(downloadUrl)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent);font-weight:normal">Download original ↗</a>`
        : '';
      return `<th colspan="2" style="text-align:left;padding:4px 8px;font-size:11px;color:var(--text-2)">${e.id === g.keeperEntryId ? 'Kept copy' : 'Other copy'}${downloadLink}</th>`;
    })
    .join('');

  const rowsHtml = comparison.rows
    .map((row, rowIdx) => {
      const cellsHtml = row.values
        .map((v, vIdx) => {
          const valueHtml = v.value ? esc(v.value) : '<span style="color:var(--text-3)">(none)</span>';
          const border = 'border-top:1px solid var(--border)';
          // System-managed audit rows (Created/Filed/File type/File size)
          // offer no pick at all — the kept copy always retains its own
          // creation/filing/file audit trail (user product decision,
          // 2026-07-08). Shown dimmed, purely as evidence of which copy is
          // which; excluded from the summary and never applied.
          if (row.systemManaged) {
            return `<td style="width:24px;${border}"></td>
            <td style="padding:4px 8px;vertical-align:top;text-align:left;font-size:11px;color:var(--text-3);${border}">${valueHtml}</td>`;
          }
          const checked = v.entryId === g.keeperEntryId || (!entryIds.includes(g.keeperEntryId) && v === row.values[0]);
          const radioId = `field-${gIdx}-${rowIdx}-${vIdx}`;
          return `<td style="width:24px;padding:5px 0 4px 8px;vertical-align:top;${border}">
            <input type="radio" id="${radioId}" class="field-compare-radio" name="field-${gIdx}-${rowIdx}" data-group-idx="${gIdx}" data-row-idx="${rowIdx}" data-entry-id="${esc(v.entryId)}" value="${esc(v.value || '')}" ${checked ? 'checked' : ''} />
          </td>
          <td style="padding:4px 8px;vertical-align:top;text-align:left;${border}">
            <label for="${radioId}" style="display:block;font-size:11px;color:var(--text-1);cursor:pointer">${valueHtml}</label>
          </td>`;
        })
        .join('');
      const mark = row.editKey
        ? ' <span title="Can be applied to the kept copy automatically" style="color:var(--accent)">✎</span>'
        : row.systemManaged
          ? ' <span title="Audit field — the kept copy always retains its own value" style="color:var(--text-4)">🔒</span>'
          : '';
      return `<tr data-label="${esc(row.label)}"${row.systemManaged ? ' data-system="1"' : ''}${row.differs ? ' style="background:var(--amber-dim)"' : ''}>
        <td style="padding:4px 8px;font-size:11px;color:var(--text-2);white-space:nowrap;border-top:1px solid var(--border)">${esc(row.label)}${mark}</td>
        ${cellsHtml}
      </tr>`;
    })
    .join('');

  const initialSummary = comparison.rows
    .filter((row) => !row.systemManaged)
    .map((row) => {
      const picked = row.values.find((v) => v.entryId === g.keeperEntryId) || row.values[0];
      return `${row.label}: ${picked.value || '(none)'}`;
    })
    .join('\n');

  const applyAvailable = entryIds.includes(g.keeperEntryId);
  return `<div class="document-field-compare-form" style="border:1px solid var(--border);border-radius:var(--r-md);padding:8px;font-size:11px">
    <div style="color:var(--text-1)">Compare each field independently and pick which value is correct. Fields marked ✎ can be written to the kept copy automatically. 🔒 fields (Created, Filed, File type, File size) are audit fields — the kept copy always keeps its own, so they're shown as evidence only. Anything else you pick from the other copy goes in the summary below for manual correction in Medicus.</div>
    <table style="width:100%;border-collapse:collapse;margin-top:8px">
      <thead><tr><th></th>${colHeaders}</tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <div style="margin-top:8px;color:var(--text-2)">Your chosen record:</div>
    <textarea class="document-field-summary-text" data-group-idx="${gIdx}" rows="6" readonly style="width:100%;box-sizing:border-box;margin-top:4px;font-size:11px;background:var(--bg-mid);color:var(--text-1);border:1px solid var(--border)">${esc(initialSummary)}</textarea>
    <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
      ${applyAvailable ? `<button class="apply-doc-fields-btn" data-group-idx="${gIdx}" style="background:var(--accent);color:var(--bg-deep);border:none;padding:7px 16px;border-radius:var(--r-md);font-weight:600">Apply chosen ✎ values to kept copy…</button>` : ''}
      <button class="copy-field-summary-btn btn-ghost" data-group-idx="${gIdx}">Copy summary</button>
      <button class="cancel-removal-btn btn-ghost" data-group-idx="${gIdx}">Back</button>
    </div>
    <div class="doc-apply-status" data-group-idx="${gIdx}" style="margin-top:6px;color:var(--text-2)"></div>
  </div>`;
}

function renderMergeSuggestionHtml(g, gIdx) {
  const P = window.RecordDuplicateParser;
  const suggestion = P.buildMergeSuggestion(g);
  const sourcesHtml = suggestion.sources
    .map(
      (s) =>
        `<div style="font-size:11px;color:var(--text-3)">${esc(s.recordedBy || '(unknown author)')}${s.isJunkUser ? ' · <span style="color:var(--amber)">possible reimport artifact</span>' : ''}${s.hadWrapper ? ' · GP2GP wrapper stripped' : ''}</div>`
    )
    .join('');

  const removable = P.isRemovableKind(g.kind);
  const autoApplyAvailable = g.kind === 'note' && removable && g.keeperEntryId;
  // The removal button is labelled differently per tier ("These are
  // equivalent — remove duplicates" on REVIEW, a direct "Remove N duplicate
  // copies" on HIGH), so the guidance names the right one.
  const removeButtonName =
    g.tier === 'review' ? '"These are equivalent — remove duplicates"' : 'the Remove button';
  const guidance = autoApplyAvailable
    ? ''
    : removable
      ? `Paste this into the copy you're keeping in Medicus, save, then click "Back" and use ${removeButtonName} to remove the other copies.`
      : g.kind === 'note'
        ? 'Auto-apply needs an auto-picked keeper copy — pick one via the remove flow first, or paste this into Medicus manually.'
        : "Paste this into the copy you're keeping in Medicus, save, then remove the other copies manually — this kind has no confirmed removal contract in this tool.";

  return `<div class="merge-suggestion-form" style="border:1px solid var(--border);border-radius:var(--r-md);padding:8px;font-size:11px">
    <div style="color:var(--text-1)">Suggested merged text (edit before using — this is a starting point, not authoritative):</div>
    ${sourcesHtml}
    <textarea class="merge-suggestion-text" data-group-idx="${gIdx}" rows="3" style="width:100%;box-sizing:border-box;margin-top:6px;font-size:11px;background:var(--bg-mid);color:var(--text-1);border:1px solid var(--border)">${esc(suggestion.suggestedText)}</textarea>
    <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="copy-merge-btn btn-ghost" data-group-idx="${gIdx}">Copy merged text</button>
      ${autoApplyAvailable ? `<button class="apply-note-merge-btn" data-group-idx="${gIdx}" data-keeper-id="${esc(g.keeperEntryId)}" style="background:var(--accent);color:var(--bg-deep);border:none;padding:7px 16px;border-radius:var(--r-md);font-weight:600">Apply merge &amp; remove other copies</button>` : ''}
      <button class="cancel-removal-btn btn-ghost" data-group-idx="${gIdx}">Back</button>
    </div>
    <div style="margin-top:6px;color:var(--text-2)">${guidance}</div>
    <div class="merge-status" data-group-idx="${gIdx}" style="margin-top:6px"></div>
  </div>`;
}

// Confirmation step for the note-kind automated merge — mirrors
// renderRemovalFormHtml's reason-required, pre-filled-editable pattern.
function renderNoteMergeConfirmHtml(g, gIdx, keeperId, mergedText) {
  const keeperEntry = g.entries.find((e) => e.id === keeperId);
  const toRemove = g.entries.filter((e) => e.id !== keeperId);
  const listHtml = toRemove
    .map(
      (e) =>
        `<div style="font-size:11px;color:var(--text-2);margin-top:2px">– ${esc(e.recordedBy || '(unknown author)')}</div>`
    )
    .join('');
  return `<div class="note-merge-form" style="border:1px solid var(--red-line);border-radius:var(--r-md);padding:8px;font-size:11px">
    <div style="color:var(--text-1)">This will edit the kept copy's note to the merged text below, then permanently hide ${toRemove.length} other cop${toRemove.length !== 1 ? 'ies' : 'y'}. There is no confirmed undo for either action.</div>
    <div style="margin-top:6px;display:flex;gap:12px;flex-wrap:wrap">
      <div style="flex:1 1 200px;border:1px solid var(--green);border-radius:var(--r-md);padding:6px 8px">
        <div style="font-weight:700;color:var(--green)">✓ KEEPING (text replaced by the merge)</div>
        <div style="font-size:11px;color:var(--text-2);margin-top:2px">– ${entryOneLiner(keeperEntry)}</div>
      </div>
      <div style="flex:1 1 200px;border:1px solid var(--red-line);border-radius:var(--r-md);padding:6px 8px">
        <div style="font-weight:700;color:var(--red)">✗ REMOVING (permanently hidden)</div>
        ${listHtml}
      </div>
    </div>
    <div style="margin-top:4px;color:var(--text-2)">Merged text:</div>
    <textarea class="note-merge-text" data-group-idx="${gIdx}" rows="3" style="width:100%;box-sizing:border-box;margin-top:2px;font-size:11px;background:var(--bg-mid);color:var(--text-1);border:1px solid var(--border)">${esc(mergedText)}</textarea>
    <label style="display:block;margin-top:8px;color:var(--text-2)">Reason (required)</label>
    <textarea class="note-merge-reason" data-group-idx="${gIdx}" rows="2" style="width:100%;box-sizing:border-box;margin-top:4px;font-size:11px;background:var(--bg-mid);color:var(--text-1);border:1px solid var(--border)">${esc(DEFAULT_REMOVAL_REASON)}</textarea>
    <div style="margin-top:8px;display:flex;gap:8px">
      <button class="confirm-note-merge-btn" data-group-idx="${gIdx}" data-keeper-id="${esc(keeperId)}" style="background:var(--red);color:var(--bg-deep);border:none;padding:7px 16px;border-radius:var(--r-md);font-weight:600">Confirm merge &amp; removal</button>
      <button class="cancel-removal-btn btn-ghost" data-group-idx="${gIdx}">Cancel</button>
    </div>
    <div class="merge-status" data-group-idx="${gIdx}" style="margin-top:6px"></div>
  </div>`;
}

function syncNoteMergeConfirmEnabled(out, gIdx) {
  const form = out.querySelector(`.removal-slot[data-group-idx="${gIdx}"] .note-merge-form`);
  if (!form) return;
  const text = form.querySelector('.note-merge-text').value.trim();
  const reason = form.querySelector('.note-merge-reason').value.trim();
  form.querySelector('.confirm-note-merge-btn').disabled = !text || !reason;
}

// GET the keeper's full current note -> build the change-note request ->
// POST it -> remove the other copies via the existing removal contract.
// Mirrors executeRemoval's messaging/error-handling shape deliberately.
// `manualOrgName` arrives on re-entry from the organisation prompt below —
// a previous-practice note with a blank stored organisation can't be saved
// without one (Medicus's own form enforces this), so the user supplies the
// name they'd type in Medicus, "Previous GP" by default.
async function applyNoteMerge(out, gIdx, keeperId, manualOrgName) {
  const P = window.RecordDuplicateParser;
  const analysis = out.__analysis;
  const r = out.__patient;
  const g = analysis.groups[gIdx];
  const form = out.querySelector(`.removal-slot[data-group-idx="${gIdx}"] .note-merge-form`);
  const mergedText = form.querySelector('.note-merge-text').value.trim();
  const reason = form.querySelector('.note-merge-reason').value.trim();
  const statusEl = form.querySelector('.merge-status');

  form.querySelectorAll('button, textarea').forEach((el) => (el.disabled = true));

  statusEl.textContent = 'Fetching current note…';
  let current;
  try {
    current = await apiFetch(P.buildNoteEditUrl(_apiBase, keeperId));
  } catch (e) {
    statusEl.textContent = `Could not fetch the current note — nothing changed. (${e.message})`;
    form.querySelectorAll('button, textarea').forEach((el) => (el.disabled = false));
    return;
  }

  const changeReq = P.buildNoteChangeRequest(_apiBase, current, mergedText, manualOrgName);
  if (!changeReq) {
    form.querySelectorAll('button, textarea').forEach((el) => (el.disabled = false));
    // Named refusal reasons (2026-07-08 — the generic "an unconfirmed field
    // was present" left real failures undiagnosable):
    if (current && current.linkedClinicalCase && current.linkedClinicalCase.defaultClinicalCaseId) {
      statusEl.textContent =
        'This note is linked to a clinical case — that mapping has never been live-tested, so edit it directly in Medicus instead, then remove the other copies manually.';
      return;
    }
    if (!mergedText) {
      statusEl.textContent =
        'The merged text is empty (both copies are junk-only?) — merging has nothing to save. Use the Remove button instead.';
      return;
    }
    if (current && current.recordedAtAnotherOrganisation && !P.resolveNoteOrganisation(current, null)) {
      statusEl.innerHTML = `<div style="color:var(--amber)">This note was recorded at another organisation but has no organisation name stored — Medicus refuses to save any edit until one is entered (its own form enforces this too). Enter the organisation to record:</div>
        <div style="margin-top:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input type="text" class="note-org-input" value="Previous GP" style="font-size:11px;padding:4px 6px;background:var(--bg-mid);color:var(--text-1);border:1px solid var(--border);border-radius:var(--r-md);min-width:180px" />
          <button class="note-org-continue-btn btn-ghost" data-group-idx="${gIdx}" data-keeper-id="${esc(keeperId)}">Continue with this organisation</button>
        </div>`;
      return;
    }
    statusEl.textContent =
      "This note can't be safely auto-merged — copy the merged text and edit it directly in Medicus instead, then remove the other copies manually.";
    return;
  }

  statusEl.textContent = 'Saving merged note…';
  try {
    await apiPost(changeReq.url, changeReq.body);
  } catch (e) {
    statusEl.textContent = `Failed to save the merged note — nothing removed. (${e.message})`;
    form.querySelectorAll('button, textarea').forEach((el) => (el.disabled = false));
    return;
  }

  const toRemove = g.entries.filter((e) => e.id !== keeperId);
  let succeeded = 0;
  let failed = 0;
  for (const entry of toRemove) {
    statusEl.textContent = `Note merged. Removing ${succeeded + failed + 1}/${toRemove.length}…`;
    const req = window.RecordDuplicateParser.buildRemovalRequest(g.kind, _apiBase, entry.id, reason);
    if (!req) {
      failed++;
      continue;
    }
    try {
      await apiPost(req.url, req.body);
      await logRemoval({
        patientUuid: r.uuid,
        patientName: r.name,
        kind: g.kind,
        entryId: entry.id,
        code: g.code,
        date: g.date,
        reason: `${reason} (merged into kept copy)`,
      });
      succeeded++;
      markEntryRemoved(out, gIdx, entry.id);
    } catch (e) {
      failed++;
    }
  }

  const slot = out.querySelector(`.removal-slot[data-group-idx="${gIdx}"]`);
  slot.innerHTML = failed
    ? `<div style="font-size:11px;color:var(--red)">Note merged. ${succeeded} removed, ${failed} failed — see entries above.</div>`
    : `<div style="font-size:11px;color:var(--green)">Note merged and ${succeeded} duplicate cop${succeeded !== 1 ? 'ies' : 'y'} removed.</div>`;
}

// Human-readable rendering of one posted-shape document edit value, for the
// old → new confirmation list (code posts as a concept object, author as an
// organisation object; everything else is a plain string or null).
function describeDocEditValue(editKey, value) {
  if (value == null) return '(none)';
  if (editKey === 'code') return value.description || value.conceptId || '(unnamed code)';
  if (editKey === 'authoredByOrganisation') return value.organisationName || '(unnamed organisation)';
  return String(value);
}

// Confirmation step for the document field apply — mirrors
// renderNoteMergeConfirmHtml's shape. No reason field: unlike removal/merge
// nothing is hidden here, the kept copy's details are edited in place via
// the confirmed clinical/document/edit-details contract.
function renderDocumentApplyConfirmHtml(g, gIdx, fieldChoices, editModels, unappliedNotes, manualOnly, overrides) {
  const P = window.RecordDuplicateParser;
  const keeperModel = editModels[g.keeperEntryId];
  const changesHtml = fieldChoices
    .map((c) => {
      const from = describeDocEditValue(c.editKey, P.getDocumentEditValue(keeperModel, c.editKey));
      // The applied value comes from the overrides map, not re-read from the
      // source edit model — for a preview-fallback field (e.g. a degraded
      // code recovered from the preview's typeCode) the source edit model
      // holds null and would misreport the change as "→ (none)".
      const to = describeDocEditValue(c.editKey, overrides[c.editKey]);
      return `<div style="font-size:11px;color:var(--text-2);margin-top:2px">– ${esc(c.label)}: <s>${esc(from)}</s> → <strong>${esc(to)}</strong></div>`;
    })
    .join('');
  const caveats = [];
  // Transparency for an organisation the user didn't explicitly pick: the
  // kept copy's org was blank/unstructured (GP2GP import) and Medicus
  // requires one, so it's being filled from record evidence or the prompt.
  if (overrides.authoredByOrganisation && !fieldChoices.some((c) => c.editKey === 'authoredByOrganisation')) {
    caveats.push(
      `Organisation on the kept copy will be recorded as "${overrides.authoredByOrganisation.organisationName}" — it currently has no structured organisation, and Medicus requires one to save.`
    );
  }
  if (overrides.code && !fieldChoices.some((c) => c.editKey === 'code')) {
    caveats.push(
      `Type on the kept copy will be recorded as "${overrides.code.description}" — its stored type had no clinical code, and Medicus refuses any save without one.`
    );
  }
  if (unappliedNotes.length) caveats.push(`Not applied: ${unappliedNotes.join('; ')}.`);
  if (manualOnly.length)
    caveats.push(
      `You also picked the other copy's ${manualOnly.join(', ')} — no confirmed write path for those; correct them manually in Medicus.`
    );
  return `<div class="doc-apply-form" style="border:1px solid var(--red-line);border-radius:var(--r-md);padding:8px;font-size:11px">
    <div style="color:var(--text-1)">This will edit the kept copy's document details in Medicus as below. There is no confirmed undo.</div>
    ${changesHtml}
    ${caveats.map((c) => `<div style="font-size:11px;color:var(--amber);margin-top:4px">${esc(c)}</div>`).join('')}
    <div style="margin-top:8px;display:flex;gap:8px">
      <button class="confirm-doc-apply-btn" data-group-idx="${gIdx}" style="background:var(--red);color:var(--bg-deep);border:none;padding:7px 16px;border-radius:var(--r-md);font-weight:600">Confirm edit</button>
      <button class="cancel-removal-btn btn-ghost" data-group-idx="${gIdx}">Cancel</button>
    </div>
    <div class="doc-apply-status" data-group-idx="${gIdx}" style="margin-top:6px;color:var(--text-2)"></div>
  </div>`;
}

// Collects the user's per-field picks from the live comparison table,
// fetches the edit-details model for the kept copy plus every source copy,
// and builds the confirmed-contract POST — or explains why it refused.
// Mirrors applyNoteMerge's fetch-then-build-then-confirm messaging shape.
// `manualOrgName` arrives on re-entry from the organisation prompt (the
// "Continue with this organisation" button) when no organisation name could
// be found anywhere on the record.
async function prepareDocumentFieldApply(out, gIdx, manualOrgName) {
  const P = window.RecordDuplicateParser;
  const analysis = out.__analysis;
  const g = analysis.groups[gIdx];
  const slot = out.querySelector(`.removal-slot[data-group-idx="${gIdx}"]`);
  const form = slot.querySelector('.document-field-compare-form');
  const statusEl = form.querySelector('.doc-apply-status');
  const comparison = P.buildDocumentFieldComparison(g, analysis.documentPreviewsByEntryId || {});

  const fieldChoices = [];
  const manualOnly = [];
  [...form.querySelectorAll('tbody tr')].forEach((rowEl, rowIdx) => {
    const row = comparison.rows[rowIdx];
    const checked = rowEl.querySelector('input[type="radio"]:checked');
    // Only picks that actually change the kept copy matter: a non-keeper
    // radio on a row whose values genuinely differ between the copies.
    if (!row || !row.differs || !checked || checked.dataset.entryId === g.keeperEntryId) return;
    if (row.editKey) fieldChoices.push({ editKey: row.editKey, entryId: checked.dataset.entryId, label: row.label });
    else manualOnly.push(row.label);
  });

  if (!fieldChoices.length) {
    statusEl.innerHTML = manualOnly.length
      ? `Nothing to apply automatically — the field(s) you picked from the other copy (${esc(manualOnly.join(', '))}) have no confirmed write path; use the summary to correct them manually.`
      : `Nothing to apply — every ✎ field is already set to the kept copy's value. To just delete the duplicate, click "Back" then "These are equivalent — remove duplicates".`;
    return;
  }

  form.querySelectorAll('button, input').forEach((el) => (el.disabled = true));
  statusEl.textContent = 'Fetching document edit models…';
  const ids = [...new Set([g.keeperEntryId, ...fieldChoices.map((c) => c.entryId)])];
  const editModels = {};
  try {
    for (const id of ids) {
      editModels[id] = await apiFetch(P.buildDocumentEditDetailsUrl(_apiBase, id));
    }
  } catch (e) {
    statusEl.textContent = `Could not fetch a document edit model — nothing changed. (${e.message})`;
    form.querySelectorAll('button, input').forEach((el) => (el.disabled = false));
    return;
  }

  const previews = analysis.documentPreviewsByEntryId || {};
  const keeperModel = editModels[g.keeperEntryId];
  const { overrides, unapplied } = P.buildDocumentEditOverrides(fieldChoices, editModels, previews);

  // A user-supplied organisation (from the prompt below — default
  // "Previous GP", exactly what they'd type into Medicus's own free-text
  // Organisation field) satisfies both an unresolvable picked Author and a
  // blank keeper organisation. Recorded as a name with null identifiers —
  // the confirmed manual-entry shape.
  const trimmedManualOrg = (manualOrgName || '').trim();
  if (trimmedManualOrg) {
    overrides.authoredByOrganisation = {
      organisationName: trimmedManualOrg,
      organisationIdentifierType: null,
      organisationIdentifierValue: null,
    };
    if (!('authorOrganisationOption' in overrides)) {
      overrides.authorOrganisationOption =
        keeperModel && keeperModel.authorOrganisationOption != null ? keeperModel.authorOrganisationOption : 'other';
    }
    const authorIdx = unapplied.findIndex((u) => u.editKey === 'authoredByOrganisation');
    if (authorIdx >= 0) unapplied.splice(authorIdx, 1);
  }

  // A GP2GP-imported kept copy routinely stores a BLANK (form-required)
  // organisation, which would refuse the whole request even when the user
  // is editing an unrelated field. If the model-only evidence chain can't
  // resolve the keeper's org, try its preview (displayed author / title's
  // "Author Org:") — same confirmed name-with-null-identifiers shape,
  // filling a blank required field rather than changing a real one.
  if (!('authoredByOrganisation' in overrides) && !P.resolveDocumentOrganisation(keeperModel, null)) {
    const keeperOrg = P.resolveDocumentOrganisation(keeperModel, previews[g.keeperEntryId]);
    if (keeperOrg) {
      overrides.authoredByOrganisation = keeperOrg;
      overrides.authorOrganisationOption =
        keeperModel && keeperModel.authorOrganisationOption != null ? keeperModel.authorOrganisationOption : 'other';
    }
  }

  const appliedChoices = fieldChoices.filter((c) => !unapplied.some((u) => u.editKey === c.editKey));
  // Per-field failure detail — the comparison table shows the preview's
  // DISPLAY values, but the write needs the structured identifiers behind
  // them from the copy's edit form, and on a reimport copy those can
  // genuinely be blank even though the preview displays fine.
  const UNAPPLIED_REASON_TEXT = {
    'no-edit-model': "its edit form couldn't be read",
    'not-writable': 'no confirmed write mapping',
    'source-value-missing':
      'no usable value could be found for this field anywhere on the other copy — not in its edit form, and not recoverable from its preview or title',
  };
  const unappliedNotes = unapplied.map((u) => {
    const label = (fieldChoices.find((c) => c.editKey === u.editKey) || {}).label || u.editKey || '(unknown)';
    return `${label} — ${UNAPPLIED_REASON_TEXT[u.reason] || u.reason}`;
  });

  // Organisation prompt: when the only thing standing in the way is a
  // missing organisation NAME (an unresolvable picked Author, or a blank
  // keeper org with other edits ready), ask the user for one instead of
  // refusing — "Previous GP" by default (user decision, 2026-07-08: that's
  // what they type when Medicus blocks a save on imported data for the
  // required-but-blank Organisation field).
  const authorStillUnapplied = unapplied.some((u) => u.editKey === 'authoredByOrganisation');
  const keeperOrgMissing = !('authoredByOrganisation' in overrides) && !P.resolveDocumentOrganisation(keeperModel, previews[g.keeperEntryId]);
  if (authorStillUnapplied || (appliedChoices.length && keeperOrgMissing)) {
    const why = authorStillUnapplied
      ? 'No organisation name could be found anywhere on the other copy for your Author pick.'
      : 'The kept copy has no organisation recorded, and Medicus requires one to save any edit.';
    statusEl.innerHTML = `<div style="color:var(--amber)">${esc(why)} Enter the organisation to record — exactly what you'd type into Medicus's own Organisation field (saved as a name with no organisation identifier):</div>
      <div style="margin-top:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input type="text" class="doc-org-input" value="Previous GP" style="font-size:11px;padding:4px 6px;background:var(--bg-mid);color:var(--text-1);border:1px solid var(--border);border-radius:var(--r-md);min-width:180px" />
        <button class="doc-org-continue-btn btn-ghost" data-group-idx="${gIdx}">Continue with this organisation</button>
      </div>`;
    form.querySelectorAll('button, input').forEach((el) => (el.disabled = false));
    return;
  }

  // Uncoded document type — the single confirmed hard blocker on GP2GP
  // imports (live 2026-07-08): a document whose imported type carries no
  // SNOMED code (edit model `code.value.conceptId: null`) is un-editable
  // even in Medicus's OWN UI — every save fails server-side with
  // {"errors":{"code.conceptId":["This value should not be blank."]}}. If
  // the keeper's own preview typeCode has the full code, use it; otherwise
  // tell the user exactly what's wrong and which copy (if any) carries a
  // properly-coded Type they can pick.
  if (!('code' in overrides)) {
    const codeVal = keeperModel && keeperModel.code && keeperModel.code.value;
    if (!(codeVal && codeVal.conceptId && codeVal.description && codeVal.descriptionId)) {
      const keeperPreviewDoc = (previews[g.keeperEntryId] || {}).document;
      const ktc = keeperPreviewDoc && keeperPreviewDoc.typeCode;
      if (ktc && ktc.conceptId && ktc.description && ktc.descriptionId) {
        overrides.code = { conceptId: ktc.conceptId, description: ktc.description, descriptionId: ktc.descriptionId };
      } else {
        const codedOther = g.entries
          .filter((e) => e.id !== g.keeperEntryId)
          .map((e) => (previews[e.id] || {}).document)
          .map((d) => d && d.typeCode)
          .find((tc) => tc && tc.conceptId && tc.description && tc.descriptionId);
        const keeperDesc = (codeVal && codeVal.description) || (keeperModel.code && keeperModel.code.label) || 'unknown';
        statusEl.textContent =
          `The kept copy's type ("${keeperDesc}") was imported without its clinical code, and Medicus refuses ANY save of such a document — even its own edit form fails with "This value should not be blank" on the code. ` +
          (codedOther
            ? `The other copy's Type ("${codedOther.description}") IS properly coded — select its Type radio and re-apply to supply the code.`
            : 'Neither copy carries a coded Type, so set a proper type on the kept copy in Medicus first, then re-apply.');
        form.querySelectorAll('button, input').forEach((el) => (el.disabled = false));
        return;
      }
    }
  }

  const req = appliedChoices.length
    ? P.buildDocumentEditRequest(_apiBase, keeperModel, overrides)
    : null;
  if (!req) {
    statusEl.textContent = appliedChoices.length
      ? "The kept copy can't be safely auto-edited — it carries a field this tool has never live-tested (linked problems/staff/clinical case/specialty, or a draft/marked-incorrect state). Use the summary to correct it manually in Medicus instead."
      : `None of the picked values could be applied: ${unappliedNotes.join('; ')}. Correct those manually in Medicus instead.`;
    form.querySelectorAll('button, input').forEach((el) => (el.disabled = false));
    return;
  }

  out.__pendingDocumentEdits = out.__pendingDocumentEdits || {};
  out.__pendingDocumentEdits[gIdx] = req;
  slot.innerHTML = renderDocumentApplyConfirmHtml(g, gIdx, appliedChoices, editModels, unappliedNotes, manualOnly, overrides);
}

// POSTs the pending edit built by prepareDocumentFieldApply. Deliberately
// does NOT touch the duplicate copy — documents still have no confirmed
// removal contract in this tool (that discovery is still open).
async function executeDocumentFieldApply(out, gIdx) {
  const req = out.__pendingDocumentEdits && out.__pendingDocumentEdits[gIdx];
  const slot = out.querySelector(`.removal-slot[data-group-idx="${gIdx}"]`);
  const form = slot.querySelector('.doc-apply-form');
  const statusEl = form.querySelector('.doc-apply-status');
  if (!req) {
    statusEl.textContent = 'Nothing pending — go back and re-pick the fields.';
    return;
  }
  form.querySelectorAll('button').forEach((el) => (el.disabled = true));
  statusEl.textContent = 'Saving document details…';
  try {
    await apiPost(req.url, req.body);
  } catch (e) {
    statusEl.textContent = `Failed to save — nothing changed. (${e.message})`;
    form.querySelectorAll('button').forEach((el) => (el.disabled = false));
    return;
  }
  delete out.__pendingDocumentEdits[gIdx];
  // Document removal is now a confirmed contract (2026-07-08), so offer it
  // right here — the field edit landed on the KEPT copy, and removableSlotHtml
  // targets the non-keepers for removal.
  slot.innerHTML =
    `<div style="font-size:11px;color:var(--green)">Document details updated on the kept copy. Values shown above are now stale — re-analyse to refresh.</div>
     <div style="margin-top:8px;color:var(--text-2)">Now remove the duplicate copy from the record:</div>
     <div style="margin-top:4px">${removableSlotHtml(g, gIdx)}</div>`;
}

// Delegated listener attached once per journal-result panel (`out` persists
// across "Re-analyse" re-renders; only its innerHTML is replaced), so state
// lives on the element itself (`out.__analysis`/`__patient`/`__idx`) rather
// than in a closure that would go stale after a refresh. The keeper id
// (auto-picked or manually chosen) travels as a data attribute on the
// triggering button rather than in separate tracked state.
function wireRemovalDelegation(out) {
  if (out.dataset.removalWired) return;
  out.dataset.removalWired = '1';

  out.addEventListener('click', (ev) => {
    const chooseBtn = ev.target.closest('.choose-keeper-btn');
    if (chooseBtn) {
      const gIdx = parseInt(chooseBtn.dataset.groupIdx, 10);
      const g = out.__analysis.groups[gIdx];
      const slot = out.querySelector(`.removal-slot[data-group-idx="${gIdx}"]`);
      slot.innerHTML = chooseKeeperFormHtml(g, gIdx);
      return;
    }
    const continueBtn = ev.target.closest('.continue-keeper-btn');
    if (continueBtn && !continueBtn.disabled) {
      const gIdx = parseInt(continueBtn.dataset.groupIdx, 10);
      const g = out.__analysis.groups[gIdx];
      const slot = out.querySelector(`.removal-slot[data-group-idx="${gIdx}"]`);
      const chosen = slot.querySelector('.keeper-choice-radio:checked');
      if (!chosen) return;
      slot.innerHTML = renderRemovalFormHtml(g, gIdx, chosen.value);
      markGroupFates(out, gIdx, chosen.value);
      enhanceRemovalFormForNotes(out, gIdx, chosen.value);
      return;
    }
    const removeBtn = ev.target.closest('.remove-group-btn');
    if (removeBtn) {
      const gIdx = parseInt(removeBtn.dataset.groupIdx, 10);
      const g = out.__analysis.groups[gIdx];
      const slot = out.querySelector(`.removal-slot[data-group-idx="${gIdx}"]`);
      slot.innerHTML = renderRemovalFormHtml(g, gIdx, removeBtn.dataset.keeperId);
      markGroupFates(out, gIdx, removeBtn.dataset.keeperId);
      enhanceRemovalFormForNotes(out, gIdx, removeBtn.dataset.keeperId);
      return;
    }
    const cancelBtn = ev.target.closest('.cancel-removal-btn');
    if (cancelBtn) {
      const gIdx = parseInt(cancelBtn.dataset.groupIdx, 10);
      const g = out.__analysis.groups[gIdx];
      const slot = out.querySelector(`.removal-slot[data-group-idx="${gIdx}"]`);
      slot.innerHTML = removalSlotHtml(g, gIdx);
      clearGroupFates(out, gIdx);
      return;
    }
    const confirmBtn = ev.target.closest('.confirm-removal-btn');
    if (confirmBtn && !confirmBtn.disabled) {
      const gIdx = parseInt(confirmBtn.dataset.groupIdx, 10);
      executeRemoval(out, gIdx, confirmBtn.dataset.keeperId);
      return;
    }
    const equivalentBtn = ev.target.closest('.review-equivalent-btn');
    if (equivalentBtn) {
      const gIdx = parseInt(equivalentBtn.dataset.groupIdx, 10);
      const g = out.__analysis.groups[gIdx];
      const slot = out.querySelector(`.removal-slot[data-group-idx="${gIdx}"]`);
      slot.innerHTML = removableSlotHtml(g, gIdx);
      return;
    }
    const mergeBtn = ev.target.closest('.review-merge-btn');
    if (mergeBtn) {
      const gIdx = parseInt(mergeBtn.dataset.groupIdx, 10);
      const g = out.__analysis.groups[gIdx];
      const slot = out.querySelector(`.removal-slot[data-group-idx="${gIdx}"]`);
      slot.innerHTML = renderMergeSuggestionHtml(g, gIdx);
      return;
    }
    const compareFieldsBtn = ev.target.closest('.compare-fields-btn');
    if (compareFieldsBtn) {
      const gIdx = parseInt(compareFieldsBtn.dataset.groupIdx, 10);
      const analysis = out.__analysis;
      const g = analysis.groups[gIdx];
      const slot = out.querySelector(`.removal-slot[data-group-idx="${gIdx}"]`);
      const comparison = window.RecordDuplicateParser.buildDocumentFieldComparison(
        g,
        analysis.documentPreviewsByEntryId || {}
      );
      slot.innerHTML = renderDocumentFieldComparisonHtml(g, gIdx, comparison, analysis.documentPreviewsByEntryId || {});
      return;
    }
    const copyFieldSummaryBtn = ev.target.closest('.copy-field-summary-btn');
    if (copyFieldSummaryBtn) {
      const gIdx = copyFieldSummaryBtn.dataset.groupIdx;
      const slot = out.querySelector(`.removal-slot[data-group-idx="${gIdx}"]`);
      const text = slot.querySelector('.document-field-summary-text').value;
      const restoreLabel = () => {
        copyFieldSummaryBtn.textContent = 'Copy summary';
      };
      navigator.clipboard
        ?.writeText(text)
        .then(() => {
          copyFieldSummaryBtn.textContent = 'Copied!';
          setTimeout(restoreLabel, 1500);
        })
        .catch(() => {});
      return;
    }
    const copyMergeBtn = ev.target.closest('.copy-merge-btn');
    if (copyMergeBtn) {
      const gIdx = copyMergeBtn.dataset.groupIdx;
      const slot = out.querySelector(`.removal-slot[data-group-idx="${gIdx}"]`);
      const text = slot.querySelector('.merge-suggestion-text').value;
      const restoreLabel = () => {
        copyMergeBtn.textContent = 'Copy merged text';
      };
      navigator.clipboard
        ?.writeText(text)
        .then(() => {
          copyMergeBtn.textContent = 'Copied!';
          setTimeout(restoreLabel, 1500);
        })
        .catch(() => {});
      return;
    }
    const applyMergeBtn = ev.target.closest('.apply-note-merge-btn');
    if (applyMergeBtn) {
      const gIdx = parseInt(applyMergeBtn.dataset.groupIdx, 10);
      const g = out.__analysis.groups[gIdx];
      const slot = out.querySelector(`.removal-slot[data-group-idx="${gIdx}"]`);
      const mergedText = slot.querySelector('.merge-suggestion-text').value;
      slot.innerHTML = renderNoteMergeConfirmHtml(g, gIdx, applyMergeBtn.dataset.keeperId, mergedText);
      markGroupFates(out, gIdx, applyMergeBtn.dataset.keeperId);
      return;
    }
    const confirmMergeBtn = ev.target.closest('.confirm-note-merge-btn');
    if (confirmMergeBtn && !confirmMergeBtn.disabled) {
      const gIdx = parseInt(confirmMergeBtn.dataset.groupIdx, 10);
      applyNoteMerge(out, gIdx, confirmMergeBtn.dataset.keeperId);
      return;
    }
    const noteOrgContinueBtn = ev.target.closest('.note-org-continue-btn');
    if (noteOrgContinueBtn && !noteOrgContinueBtn.disabled) {
      const gIdx = parseInt(noteOrgContinueBtn.dataset.groupIdx, 10);
      const input = out.querySelector(`.removal-slot[data-group-idx="${gIdx}"] .note-org-input`);
      applyNoteMerge(out, gIdx, noteOrgContinueBtn.dataset.keeperId, input ? input.value : '');
      return;
    }
    const noteCompareMergeBtn = ev.target.closest('.note-compare-merge-btn');
    if (noteCompareMergeBtn) {
      showNoteCompareMerge(out, parseInt(noteCompareMergeBtn.dataset.groupIdx, 10));
      return;
    }
    const runFileMatchBtn = ev.target.closest('.run-file-match-btn');
    if (runFileMatchBtn && !runFileMatchBtn.disabled) {
      runFileMatchBtn.disabled = true;
      runFileMatchBtn.textContent = 'Re-analysing…';
      runFreshFileMatchSecondPass(out);
      return;
    }
    const applyDocFieldsBtn = ev.target.closest('.apply-doc-fields-btn');
    if (applyDocFieldsBtn && !applyDocFieldsBtn.disabled) {
      prepareDocumentFieldApply(out, parseInt(applyDocFieldsBtn.dataset.groupIdx, 10));
      return;
    }
    const orgContinueBtn = ev.target.closest('.doc-org-continue-btn');
    if (orgContinueBtn && !orgContinueBtn.disabled) {
      const gIdx = parseInt(orgContinueBtn.dataset.groupIdx, 10);
      const input = out.querySelector(`.removal-slot[data-group-idx="${gIdx}"] .doc-org-input`);
      prepareDocumentFieldApply(out, gIdx, input ? input.value : '');
      return;
    }
    const confirmDocApplyBtn = ev.target.closest('.confirm-doc-apply-btn');
    if (confirmDocApplyBtn && !confirmDocApplyBtn.disabled) {
      executeDocumentFieldApply(out, parseInt(confirmDocApplyBtn.dataset.groupIdx, 10));
      return;
    }
    // Click-to-select keeper (2026-07-08 user mockup): while a removal or
    // note-merge confirm form is open, clicking a copy card makes IT the
    // kept one — the form re-renders and the KEEP/DISCARD banners follow.
    // Deliberately last in the chain so slot buttons always win; cards
    // contain no buttons of their own.
    const fateCard = ev.target.closest('.entry-line[data-entry-id]');
    if (fateCard) {
      const groupEl = fateCard.closest('.dup-group');
      if (!groupEl) return;
      const gIdx = parseInt(groupEl.dataset.groupIdx, 10);
      const g = out.__analysis.groups[gIdx];
      const slot = out.querySelector(`.removal-slot[data-group-idx="${gIdx}"]`);
      if (!slot) return;
      const newKeeperId = fateCard.dataset.entryId;
      // An in-flight removal/merge disables every form button including
      // Cancel — don't let a card click re-render the form out from under
      // the running operation.
      if (slot.querySelector('.cancel-removal-btn:disabled')) return;
      if (slot.querySelector('.removal-form')) {
        slot.innerHTML = renderRemovalFormHtml(g, gIdx, newKeeperId);
        markGroupFates(out, gIdx, newKeeperId);
        enhanceRemovalFormForNotes(out, gIdx, newKeeperId);
        return;
      }
      const mergeForm = slot.querySelector('.note-merge-form');
      if (mergeForm) {
        const mergedText = mergeForm.querySelector('.note-merge-text').value;
        slot.innerHTML = renderNoteMergeConfirmHtml(g, gIdx, newKeeperId, mergedText);
        markGroupFates(out, gIdx, newKeeperId);
        return;
      }
      // Unified compare & merge view: re-render around the new keeper
      // (overviews are cached, so this is instant).
      if (slot.querySelector('.note-compare-merge-form')) {
        showNoteCompareMerge(out, gIdx, newKeeperId);
      }
      return;
    }
  });

  // Confirm starts enabled (the reason field is pre-filled) but disables
  // itself if the reason is edited down to blank — checked on every
  // keystroke via delegation.
  out.addEventListener('input', (ev) => {
    if (ev.target.classList.contains('removal-reason')) {
      syncConfirmEnabled(out, ev.target.dataset.groupIdx);
      return;
    }
    if (ev.target.classList.contains('note-merge-text') || ev.target.classList.contains('note-merge-reason')) {
      syncNoteMergeConfirmEnabled(out, ev.target.dataset.groupIdx);
    }
  });

  // Manual keeper choice: Continue enables once a radio is picked.
  out.addEventListener('change', (ev) => {
    // Note-text pick in the unified compare & merge view: load that copy's
    // cleaned text into the merge editor (still freely editable after).
    if (ev.target.classList.contains('note-text-pick')) {
      const gIdx = ev.target.dataset.groupIdx;
      const ta = out.querySelector(`.removal-slot[data-group-idx="${gIdx}"] .merge-suggestion-text`);
      if (ta) ta.value = ev.target.value;
      return;
    }
    if (ev.target.classList.contains('keeper-choice-radio')) {
      const gIdx = ev.target.dataset.groupIdx;
      const slot = out.querySelector(`.removal-slot[data-group-idx="${gIdx}"]`);
      const btn = slot && slot.querySelector('.continue-keeper-btn');
      if (btn) btn.disabled = false;
      return;
    }
    if (ev.target.classList.contains('field-compare-radio')) {
      const gIdx = ev.target.dataset.groupIdx;
      const form = out.querySelector(`.removal-slot[data-group-idx="${gIdx}"] .document-field-compare-form`);
      if (!form) return;
      const rows = form.querySelectorAll('tbody tr');
      // data-label carries the clean field name (the visible cell now also
      // holds the ✎/🔒 marks); system-managed audit rows have no radios and
      // stay out of the summary — the kept copy retains its own.
      const lines = [...rows]
        .filter((row) => !row.dataset.system)
        .map((row) => {
          const checked = row.querySelector('input[type="radio"]:checked');
          const value = checked ? checked.value : '';
          return `${row.dataset.label}: ${value || '(none)'}`;
        });
      form.querySelector('.document-field-summary-text').value = lines.join('\n');
    }
  });
}

function syncConfirmEnabled(out, gIdx) {
  const form = out.querySelector(`.removal-slot[data-group-idx="${gIdx}"] .removal-form`);
  if (!form) return;
  const reason = form.querySelector('.removal-reason').value.trim();
  form.querySelector('.confirm-removal-btn').disabled = !reason;
}

// Marks one entry's rendered line as removed in place, without touching
// anything else on the page.
function markEntryRemoved(out, gIdx, entryId) {
  const groupEl = out.querySelector(`.dup-group[data-group-idx="${gIdx}"]`);
  const line = groupEl && groupEl.querySelector(`.entry-line[data-entry-id="${entryId}"]`);
  if (!line) return;
  line.style.opacity = '0.5';
  line.style.textDecoration = 'line-through';
  const marker = document.createElement('span');
  marker.style.cssText = 'color:var(--green);text-decoration:none;margin-left:6px';
  marker.textContent = '✓ removed';
  line.appendChild(marker);
}

// Deliberately does NOT re-fetch/re-analyze the whole journal afterwards —
// that was a full journal re-fetch plus the on-demand prescription/document
// cross-checks re-running for every remaining candidate group, which got
// very slow with hundreds of groups (per-patient counts seen live: up to
// ~250 candidate groups). Confirmed by the user (2026-07-05) as unnecessary
// after live-testing — patch just the removed entries in place instead.
async function executeRemoval(out, gIdx, keeperId) {
  const analysis = out.__analysis;
  const r = out.__patient;
  const g = analysis.groups[gIdx];
  const form = out.querySelector(`.removal-slot[data-group-idx="${gIdx}"] .removal-form`);
  const reason = form.querySelector('.removal-reason').value.trim();
  const statusEl = form.querySelector('.removal-status');

  form.querySelectorAll('button, textarea, input').forEach((el) => (el.disabled = true));

  const toRemove = g.entries.filter((e) => e.id !== keeperId);
  let succeeded = 0;
  let failed = 0;
  for (const entry of toRemove) {
    statusEl.textContent = `Removing ${succeeded + failed + 1}/${toRemove.length}…`;
    const req = window.RecordDuplicateParser.buildRemovalRequest(g.kind, _apiBase, entry.id, reason);
    if (!req) {
      failed++;
      continue;
    }
    try {
      await apiPost(req.url, req.body);
      await logRemoval({
        patientUuid: r.uuid,
        patientName: r.name,
        kind: g.kind,
        entryId: entry.id,
        code: g.code,
        date: g.date,
        reason,
      });
      succeeded++;
      markEntryRemoved(out, gIdx, entry.id);
    } catch (e) {
      failed++;
    }
  }

  const slot = out.querySelector(`.removal-slot[data-group-idx="${gIdx}"]`);
  slot.innerHTML = failed
    ? `<div style="font-size:11px;color:var(--red)">${succeeded} removed, ${failed} failed — see entries above.</div>`
    : `<div style="font-size:11px;color:var(--green)">${succeeded} duplicate cop${succeeded !== 1 ? 'ies' : 'y'} removed.</div>`;
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildCsv(rows) {
  const hasSecondPass = rows.some((r) => r.dateMatchPairs !== undefined);
  const header = [
    'Name',
    'NHS Number',
    'Date of Birth',
    'Duplicated code count',
    'Duplicated problems',
    'Triggered by',
  ];
  if (hasSecondPass) header.push('Date-match pairs');
  const lines = rows.map((r) => {
    const cols = [
      r.name,
      r.nhs,
      r.dob,
      r.count,
      r.duplicated.map((d) => `${d.label} x${d.count}`).join(' | '),
      r.triggers.join('; '),
    ];
    if (hasSecondPass) cols.push(r.dateMatchPairs !== undefined ? `${r.dateMatchPairs}/${r.totalPairs}` : '');
    return cols.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',');
  });
  return [header.join(','), ...lines].join('\r\n');
}

// ── Scan core ─────────────────────────────────────────────────────────────────
// skipUuids: Set of patient UUIDs to bypass (already checked in a prior run).
// Returns { affected, checkedUuids, totalFetched, eligibleCount }.
async function doScan(code, skipUuids) {
  const apiBase = `https://${code}.api.england.medicus.health`;
  _apiBase = apiBase;

  let patients;
  let totalFetched = 0;
  try {
    patients = await fetchAllPatients((fetched, eligibleSoFar) => {
      totalFetched = fetched;
      setProgress(0.05);
      setStatus(
        `Fetching patients… ${fetched.toLocaleString()} scanned, ${eligibleSoFar.toLocaleString()} eligible so far`
      );
    });
  } catch (e) {
    if (e.needsDiscovery) showDiscoveryPrompt(code);
    else showErr(`Could not fetch patient list: ${e.message}`);
    return null;
  }

  if (patients.length === 0) {
    showErr('No eligible patients found. Check the practice code and that you are logged into Medicus.');
    return null;
  }

  const toCheck =
    skipUuids && skipUuids.size
      ? patients.filter((p) => {
          const { uuid } = patientFields(p);
          return uuid && !skipUuids.has(uuid);
        })
      : patients;
  const skippedPrev = patients.length - toCheck.length;

  const affected = [];
  const checkedUuids = new Set(skipUuids || []);
  let checked = 0;

  await runWithConcurrency(toCheck, CONCURRENCY, async (p) => {
    const { name, nhs, dob, uuid } = patientFields(p);
    if (!uuid) {
      checked++;
      return;
    }
    checkedUuids.add(uuid);
    try {
      const listing = await apiFetch(problemListUrl(apiBase, uuid));
      const result = detectDuplicates(listing);
      if (result)
        affected.push({
          name,
          nhs,
          dob,
          uuid,
          count: result.duplicated.length,
          duplicated: result.duplicated,
          triggers: result.triggers,
          batchImport: result.batchImport ?? null,
        });
    } catch (e) {
      /* not a blocker */
    }
    checked++;
    setProgress(0.3 + (checked / toCheck.length) * 0.7);
    setStatus(
      `Checking problems… ${checked.toLocaleString()} / ${toCheck.length.toLocaleString()} patients${skippedPrev ? ` (${skippedPrev.toLocaleString()} skipped — already checked)` : ''}`
    );
  });

  return { affected, checkedUuids, totalFetched, eligibleCount: patients.length, skippedPrev };
}

function showScanResults(affected, totalFetched, eligibleCount, skippedPrev, incrementalNote) {
  _csvData = affected;
  const nAffected = affected.length;
  const nPairs = affected.reduce((s, r) => s + r.count, 0);

  document.getElementById('summary').innerHTML = `
    <div class="stat"><div class="stat-num">${totalFetched.toLocaleString()}</div><div class="stat-lbl">Patients scanned</div></div>
    <div class="stat"><div class="stat-num">${eligibleCount.toLocaleString()}</div><div class="stat-lbl">Eligible (active, alive)</div></div>
    ${skippedPrev ? `<div class="stat"><div class="stat-num" style="color:var(--text-2)">${skippedPrev.toLocaleString()}</div><div class="stat-lbl">Skipped (prev. checked)</div></div>` : ''}
    <div class="stat"><div class="stat-num amber">${nAffected}</div><div class="stat-lbl">Patients flagged</div></div>
    <div class="stat"><div class="stat-num amber">${nPairs}</div><div class="stat-lbl">Duplicated code groups</div></div>
  `;

  renderResults(affected);
  if (nAffected > 0) {
    document.getElementById('csvBtn').style.display = 'inline-block';
    document.getElementById('secondPassBtn').style.display = 'inline-block';
  }

  setProgress(1);
  setStatus(
    incrementalNote || `Scan complete — ${nAffected} of ${eligibleCount} patients have duplicate active problems.`
  );
  // 'flex' not 'block' — #results is a flex-column (summary/header/sort-row
  // fixed, .rail-list scrolls) per the master-detail rail layout.
  document.getElementById('results').style.display = 'flex';
}

// ── Full scan ─────────────────────────────────────────────────────────────────
async function runScan() {
  // When in incremental mode, the blue button triggers incremental scan instead
  if (_scanMode === 'incremental') {
    runIncrementalScan();
    return;
  }
  const code = document.getElementById('codeInput').value.trim().toLowerCase();
  if (!/^[a-f0-9]{4,8}$/.test(code)) {
    showErr('Enter a valid practice code (4–8 hex characters, e.g. e38a9f).');
    return;
  }
  setScanningUI();
  try {
    const res = await doScan(code, null);
    if (!res) return;
    showScanResults(res.affected, res.totalFetched, res.eligibleCount, 0, null);
    saveState(code, res.affected, res.checkedUuids);
    hideSavedStateBanner();
    setScanMode('incremental');
  } finally {
    document.getElementById('runBtn').disabled = false;
    const incrBtn = document.getElementById('incrBtn');
    if (incrBtn) incrBtn.disabled = false;
  }
}

async function runFullScan() {
  _scanMode = 'full';
  runScan();
}

// ── Incremental scan ──────────────────────────────────────────────────────────
async function runIncrementalScan() {
  const code = document.getElementById('codeInput').value.trim().toLowerCase();
  if (!/^[a-f0-9]{4,8}$/.test(code)) {
    showErr('Enter a valid practice code (4–8 hex characters, e.g. e38a9f).');
    return;
  }
  const state = await loadState();
  if (!state || state.practiceCode !== code) {
    showErr('No saved results for this practice code. Run a full scan first.');
    return;
  }
  setScanningUI();
  try {
    const skipUuids = new Set(state.checkedUuids || []);
    const res = await doScan(code, skipUuids);
    if (!res) return;

    // Merge: existing flagged patients + newly flagged (union by uuid)
    const existingByUuid = new Map((state.flagged || []).map((r) => [r.uuid, r]));
    for (const r of res.affected) existingByUuid.set(r.uuid, r);
    const merged = [...existingByUuid.values()];

    const note = res.affected.length
      ? `Incremental scan complete — ${res.affected.length} new patient(s) flagged, ${merged.length} total.`
      : `Incremental scan complete — no new patients flagged. ${merged.length} total from previous scan.`;

    showScanResults(merged, res.totalFetched, res.eligibleCount, res.skippedPrev, note);
    saveState(code, merged, res.checkedUuids);
    hideSavedStateBanner();
  } finally {
    document.getElementById('runBtn').disabled = false;
    document.getElementById('incrBtn').disabled = false;
  }
}

function setScanningUI() {
  document.getElementById('runBtn').disabled = true;
  const incrBtn = document.getElementById('incrBtn');
  if (incrBtn) incrBtn.disabled = true;
  document.getElementById('csvBtn').style.display = 'none';
  document.getElementById('secondPassBtn').style.display = 'none';
  document.getElementById('results').style.display = 'none';
  document.getElementById('resultBody').innerHTML = '';
  document.getElementById('summary').innerHTML = '';
  document.getElementById('errMsg').textContent = '';
  document.getElementById('progressWrap').style.display = 'block';
}

// ── Scan mode (full vs incremental) ──────────────────────────────────────────
function setScanMode(mode) {
  _scanMode = mode;
  const runBtn = document.getElementById('runBtn');
  const fullScanBtn = document.getElementById('fullScanBtn');
  if (mode === 'incremental') {
    runBtn.textContent = 'Scan new patients';
    if (fullScanBtn) fullScanBtn.style.display = 'inline-block';
  } else {
    runBtn.textContent = 'Run scan';
    if (fullScanBtn) fullScanBtn.style.display = 'none';
  }
}

// ── Saved-state banner ────────────────────────────────────────────────────────
async function initSavedState() {
  const state = await loadState();
  if (!state) return;
  const dateStr = new Date(state.scanDate).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  document.getElementById('savedStateInfo').textContent =
    `Previous scan ${dateStr} — ${(state.flagged || []).length} patients flagged, ${(state.checkedUuids || []).length.toLocaleString()} patients already checked.`;
  document.getElementById('savedStateBanner').style.display = 'flex';
  if (state.practiceCode) document.getElementById('codeInput').value = state.practiceCode;
}

function hideSavedStateBanner() {
  document.getElementById('savedStateBanner').style.display = 'none';
}

async function restoreResults() {
  const state = await loadState();
  if (!state) return;
  _apiBase = `https://${state.practiceCode}.api.england.medicus.health`;
  _csvData = state.flagged || [];
  if (_csvData.length) {
    renderResults(_csvData);
    document.getElementById('csvBtn').style.display = 'inline-block';
    document.getElementById('secondPassBtn').style.display = 'inline-block';
    document.getElementById('results').style.display = 'flex';
    const dateStr = new Date(state.scanDate).toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    setStatus(`Restored ${_csvData.length} flagged patient(s) from scan on ${dateStr}.`);
  } else {
    setStatus('Saved results restored — no flagged patients from previous scan.');
  }
  setScanMode('incremental');
  hideSavedStateBanner();
}

async function clearSavedState() {
  await clearState();
  hideSavedStateBanner();
  setScanMode('full');
  setStatus('Saved results cleared. Run a full scan to start fresh.');
}

function setProgress(pct) {
  document.getElementById('progressBar').style.width = (pct * 100).toFixed(1) + '%';
  document.getElementById('progressLabel').textContent = (pct * 100).toFixed(0) + '%';
}

function setStatus(msg) {
  document.getElementById('status').textContent = msg;
}

function showErr(msg) {
  document.getElementById('errMsg').textContent = msg;
  document.getElementById('runBtn').disabled = false;
  const incrBtn = document.getElementById('incrBtn');
  if (incrBtn) incrBtn.disabled = false;
  document.getElementById('progressWrap').style.display = 'none';
}

function showDiscoveryPrompt(code) {
  const listingUrl =
    `https://england.medicus.health/${code}/patient/listing` +
    `?patientRegistrationTypeIds[]=${REG_TYPE_IDS.join('&patientRegistrationTypeIds[]=')}`;
  document.getElementById('errMsg').innerHTML =
    `To run the scan, the extension needs to observe the patient listing API call once.<br>` +
    `<strong>Open the <a href="${listingUrl}" target="_blank" style="color:var(--accent)">` +
    `Medicus patient listing page</a></strong>, wait for it to load, then come back here and click Run scan again.`;
  document.getElementById('runBtn').disabled = false;
  document.getElementById('progressWrap').style.display = 'none';
}

// ── Rail list sort ────────────────────────────────────────────────────────────
document.querySelectorAll('.sort-btn[data-sort]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const col = btn.dataset.sort;
    if (_sortCol === col) _sortAsc = !_sortAsc;
    else {
      _sortCol = col;
      _sortAsc = col !== 'count';
    }
    document.querySelectorAll('.sort-btn[data-sort]').forEach((b) => b.classList.toggle('active', b === btn));
    renderResults(_csvData);
  });
});

// ── Learn-more / scan-drawer collapse ────────────────────────────────────────
document.getElementById('learnMoreToggle').addEventListener('click', () => {
  const copy = document.getElementById('introCopy');
  const btn = document.getElementById('learnMoreToggle');
  const expanded = copy.style.display !== 'none';
  copy.style.display = expanded ? 'none' : 'block';
  btn.setAttribute('aria-expanded', String(!expanded));
  btn.textContent = expanded ? 'What does this do, and why? ▾' : 'What does this do, and why? ▴';
});

function collapseScanDrawer() {
  document.getElementById('scanDrawer').classList.add('collapsed');
  document.getElementById('scanDrawerToggle').setAttribute('aria-expanded', 'false');
}

document.getElementById('scanDrawerToggle').addEventListener('click', () => {
  const drawer = document.getElementById('scanDrawer');
  const collapsed = drawer.classList.toggle('collapsed');
  document.getElementById('scanDrawerToggle').setAttribute('aria-expanded', String(!collapsed));
});

// ── CSV download ──────────────────────────────────────────────────────────────
document.getElementById('csvBtn').addEventListener('click', () => {
  const blob = new Blob([buildCsv(_csvData)], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `duplicate-problems-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
});

// ── Init ──────────────────────────────────────────────────────────────────────
document.getElementById('runBtn').addEventListener('click', runScan);
document.getElementById('fullScanBtn').addEventListener('click', runFullScan);
document.getElementById('incrBtn').addEventListener('click', runIncrementalScan);
document.getElementById('secondPassBtn').addEventListener('click', runSecondPass);
document.getElementById('restoreBtn').addEventListener('click', restoreResults);
document.getElementById('clearStateBtn').addEventListener('click', clearSavedState);

document.getElementById('debugBtn').addEventListener('click', () => {
  const panel = document.getElementById('debugPanel');
  if (panel.style.display !== 'none') {
    panel.style.display = 'none';
    return;
  }
  chrome.storage.local.get(
    [
      'suite.patientFieldDebug',
      'suite.discoveredAllPatientUrls',
      'suite.discoveredAllJournalUrls',
      'suite.discoveredJournalUrl',
      'suite.discoveredJournalUrlTemplate',
      'suite.discoveredAllJournalUrlTemplates',
      'suite.apiDiscoveryLastRun',
    ],
    (r) => {
      const shape = r['suite.patientFieldDebug'];
      const lastRun = r['suite.apiDiscoveryLastRun'];
      const lastRunLine = lastRun
        ? `api-discovery.js content script last ran: ${new Date(lastRun).toLocaleString()}\n\n`
        : 'api-discovery.js content script last ran: (never — no capture has happened on this install yet)\n\n';
      const allUrls = r['suite.discoveredAllPatientUrls'] || [];
      const allJournalUrls = r['suite.discoveredAllJournalUrls'] || [];
      const journalUrl = r['suite.discoveredJournalUrl'];
      const journalTemplate = r['suite.discoveredJournalUrlTemplate'];
      const allTemplates = r['suite.discoveredAllJournalUrlTemplates'] || [];
      const statusList = _seenStatuses.size
        ? 'registrationStatus values seen this run:\n  ' + [..._seenStatuses].sort().join('\n  ')
        : 'No registrationStatus values captured yet — run the scan first.';
      const urlList = allUrls.length
        ? '\n\nAll patient API URLs seen on listing page:\n  ' +
          allUrls
            .map((u) => {
              try {
                const x = new URL(u);
                return x.pathname + (x.search || '');
              } catch {
                return u;
              }
            })
            .join('\n\n  ')
        : '\n\n(Navigate to the patient listing page to capture API URLs)';
      const journalList = allJournalUrls.length
        ? '\n\nAll API URLs seen on a patient journal tab:\n  ' +
          allJournalUrls
            .map((u) => {
              try {
                const x = new URL(u);
                return x.pathname + (x.search || '');
              } catch {
                return u;
              }
            })
            .join('\n\n  ') +
          (journalUrl ? `\n\nBest-guess journal endpoint (path contains "journal"):\n  ${journalUrl}` : '')
        : "\n\n(Navigate to a patient's journal tab — ?careRecordTab=journal — to capture API URLs)";
      const templateList = allTemplates.length
        ? '\n\nReusable URL templates (patient UUID replaced with __PATIENT_UUID__ — used by "Analyse record" below):\n  ' +
          allTemplates
            .map((u) => {
              try {
                const x = new URL(u);
                return x.pathname + (x.search || '');
              } catch {
                return u;
              }
            })
            .join('\n\n  ') +
          (journalTemplate
            ? `\n\nBest-guess journal template:\n  ${journalTemplate}`
            : '\n\n(No best-guess template yet — none of the captured URLs had "journal" in the path. Pick the right one manually if needed.)')
        : '';
      panel.textContent =
        lastRunLine +
        statusList +
        urlList +
        journalList +
        templateList +
        (shape ? '\n\nPatient object shape:\n' + JSON.stringify(shape, null, 2) : '');
      panel.style.display = 'block';
    }
  );
});

document.getElementById('rediscoverBtn').addEventListener('click', () => {
  chrome.storage.local.remove([DISCOVERY_KEY, 'suite.discoveredAllPatientUrls'], () => {
    document.getElementById('endpointWrap').style.display = 'none';
    document.getElementById('endpointDisplay').textContent = '';
    document.getElementById('debugPanel').style.display = 'none';
  });
});

function showDiscoveredEndpoint(url) {
  const wrap = document.getElementById('endpointWrap');
  const display = document.getElementById('endpointDisplay');
  try {
    const u = new URL(url);
    display.textContent = u.hostname + u.pathname;
  } catch (e) {
    display.textContent = url;
  }
  wrap.style.display = 'block';
}

// ── Analyse current patient (bypasses the practice-wide scan) ───────────────
// Reuses runJournalAnalysis()/renderJournalAnalysisHtml()/wireRemovalDelegation()
// unchanged — passing the fixed idx key 'current' makes it look up
// journal-result-current / .analyze-journal-btn[data-idx="current"], the same
// way a numeric row idx looks up journal-result-${idx} from a scan result.
async function tryDetectCurrentPatient(showErrorIfMissing) {
  const errEl = document.getElementById('currentPatientErr');
  const match = await detectCurrentPatient();
  if (match) {
    document.getElementById('currentPatientCode').value = match.code;
    document.getElementById('currentPatientUuid').value = match.uuid;
    _currentPatientTabTitle = match.tabTitle;
    errEl.style.display = 'none';
  } else if (showErrorIfMissing) {
    errEl.textContent =
      "No single open Medicus patient-record tab detected. Open the patient's care record page in Medicus, or enter the practice code and patient UUID manually below.";
    errEl.style.display = 'block';
  }
}

// Renders into the SAME shared #patientDetailMain pane a rail click uses —
// there is only ever one patient's detail on screen, whichever route loaded
// it. Gated by confirmPatientSwitch(), which also syncs the rail's active
// highlight if this patient happens to already be in the scanned list.
async function runCurrentPatientAnalysis() {
  const errEl = document.getElementById('currentPatientErr');
  const code = document.getElementById('currentPatientCode').value.trim().toLowerCase();
  const uuid = document.getElementById('currentPatientUuid').value.trim().toLowerCase();
  errEl.style.display = 'none';

  if (!/^[a-f0-9]{4,8}$/.test(code)) {
    errEl.textContent = 'Enter a valid practice code (4–8 hex characters, e.g. e38a9f).';
    errEl.style.display = 'block';
    return;
  }
  if (!PATIENT_UUID_QUERY_RE.test(uuid)) {
    errEl.textContent = 'Enter a valid patient UUID.';
    errEl.style.display = 'block';
    return;
  }

  if (!confirmPatientSwitch(uuid)) return;
  collapseScanDrawer();

  _apiBase = `https://${code}.api.england.medicus.health`;
  const r = { uuid, name: _currentPatientTabTitle || '(current patient)' };

  const main = document.getElementById('patientDetailMain');
  main.innerHTML = '<div class="card"><div id="journal-result-current"></div></div>';

  await runJournalAnalysis('current', r);
}

document.getElementById('detectCurrentPatientBtn').addEventListener('click', () => tryDetectCurrentPatient(true));
document.getElementById('analyzeCurrentPatientBtn').addEventListener('click', runCurrentPatientAnalysis);

Promise.all([detectPracticeCode(), getDiscoveredBaseUrl()]).then(([code, url]) => {
  if (code) document.getElementById('codeInput').value = code;
  if (url) showDiscoveredEndpoint(url);
});

tryDetectCurrentPatient(false);

initSavedState();
