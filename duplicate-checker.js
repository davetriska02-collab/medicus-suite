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

// ── API helpers ───────────────────────────────────────────────────────────────
async function apiFetch(url) {
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status, url });
  return r.json();
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

  // Show/hide the date-match column header based on whether second pass has run
  document.getElementById('dateMatchTh').style.display = hasSecondPass ? '' : 'none';

  const tbody = document.getElementById('resultBody');
  const colspan = hasSecondPass ? 7 : 6;
  tbody.innerHTML = sorted
    .map((r, i) => {
      let dateMatchCell = '';
      if (hasSecondPass) {
        if (r.dateMatchPairs === undefined) {
          dateMatchCell = '<td style="text-align:center;color:var(--text-2)">—</td>';
        } else {
          const all = r.dateMatchPairs === r.totalPairs;
          const none = r.dateMatchPairs === 0;
          const colour = all ? 'var(--green)' : none ? 'var(--text-2)' : 'var(--amber)';
          dateMatchCell = `<td style="text-align:center;color:${colour};font-size:12px">${r.dateMatchPairs}/${r.totalPairs}</td>`;
        }
      }
      return `
    <tr class="result-row" data-idx="${i}" style="cursor:pointer" title="Click to inspect raw problem fields">
      <td>${esc(r.name)}</td>
      <td style="white-space:nowrap">${esc(r.nhs)}</td>
      <td style="white-space:nowrap">${esc(r.dob)}</td>
      <td style="text-align:center"><span class="pill">${r.count}</span></td>
      <td><div class="dup-list">${r.duplicated.map((d) => esc(d.label + '\xd7' + d.count)).join('<br>')}</div></td>
      <td>${r.triggers.map((t) => `<span class="trigger-badge">${esc(t)}</span>`).join(' ')}</td>
      ${dateMatchCell}
    </tr>
    <tr class="detail-row" id="detail-${i}" style="display:none">
      <td colspan="${colspan}" style="padding:0">
        <pre class="detail-pre" id="detail-pre-${i}" style="margin:0;padding:12px 16px;font-size:11px;color:var(--text-2);background:var(--bg-mid);border-top:1px solid var(--border);white-space:pre-wrap;overflow:auto;max-height:400px"></pre>
      </td>
    </tr>`;
    })
    .join('');

  tbody.querySelectorAll('.result-row').forEach((row) => {
    row.addEventListener('click', () => toggleProblemDetail(row, sorted));
  });
}

async function toggleProblemDetail(row, sorted) {
  const idx = parseInt(row.dataset.idx, 10);
  const detailRow = document.getElementById(`detail-${idx}`);
  const pre = document.getElementById(`detail-pre-${idx}`);

  if (detailRow.style.display !== 'none') {
    detailRow.style.display = 'none';
    return;
  }

  detailRow.style.display = '';
  pre.textContent = 'Loading…';

  const r = sorted[idx];
  if (!_apiBase || !r.uuid) {
    pre.textContent = 'No API base or patient UUID available — re-run the scan first.';
    return;
  }

  try {
    const listing = await apiFetch(problemListUrl(_apiBase, r.uuid));
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
    pre.textContent = `Error fetching problems: ${e.message}`;
  }

  renderJournalAnalysisSlot(idx, r);
}

// ── Journal-level duplicate analysis (click-through) ─────────────────────────
// Read-only inspection only. Does NOT delete or merge anything — Medicus has
// no confirmed write endpoint for this yet, and this is live patient data, so
// bulk-remove/merge stays a recommendation shown to the user, not an action
// this tool performs.
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
  wrap.style.cssText = 'padding:12px 16px;border-top:1px solid var(--border)';
  wrap.innerHTML = `<button class="analyze-journal-btn" data-idx="${idx}" style="background:var(--bg-mid);color:var(--text);border:1px solid var(--border);padding:6px 14px;font-size:12px">Analyze full record for duplicates</button>
    <div id="journal-result-${idx}" style="margin-top:10px"></div>`;
  pre.insertAdjacentElement('afterend', wrap);
  wrap.querySelector('.analyze-journal-btn').addEventListener('click', () => runJournalAnalysis(idx, r));
}

async function runJournalAnalysis(idx, r) {
  const out = document.getElementById(`journal-result-${idx}`);
  const btn = document.querySelector(`.analyze-journal-btn[data-idx="${idx}"]`);
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Analyzing…';
  }
  out.innerHTML = '<div style="color:var(--text-2);font-size:12px">Fetching patient journal…</div>';

  const template = await getJournalUrlTemplate();
  if (!template) {
    out.innerHTML = `<div class="info" style="font-size:12px">
      No journal endpoint has been discovered yet. Open this patient's <strong>Journal</strong> tab in
      Medicus once (care-record → Journal), then click "Show patient fields" above to confirm capture,
      and try again.</div>`;
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Analyze full record for duplicates';
    }
    return;
  }

  const url = template.replace(new RegExp(PATIENT_UUID_PLACEHOLDER, 'g'), r.uuid);

  try {
    const payload = await apiFetch(url);
    const analysis = window.RecordDuplicateParser.analyzeJournal(payload);
    out.innerHTML = renderJournalAnalysisHtml(analysis);
  } catch (e) {
    out.innerHTML = `<div class="err" style="font-size:12px">Error fetching/analysing journal: ${esc(e.message)}</div>`;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Re-analyze';
    }
  }
}

const TIER_COLOUR = { exact: 'var(--red)', high: 'var(--amber)', review: 'var(--text-2)' };
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

function renderJournalAnalysisHtml(analysis) {
  const { groups, transferEncounters, summary } = analysis;
  if (!groups.length && !transferEncounters.length) {
    return '<div style="color:var(--text-2);font-size:12px">No candidate duplicate entries found in this patient\'s journal.</div>';
  }

  const summaryLine = `<div style="font-size:12px;color:var(--text-2);margin-bottom:10px">
    ${summary.totalCandidateGroups} candidate duplicate group${summary.totalCandidateGroups !== 1 ? 's' : ''}
    (${summary.byTier.exact} exact, ${summary.byTier.high} high, ${summary.byTier.review} review)
    ${summary.transferEncountersTotal ? ` · ${summary.transferEncountersConfirmed}/${summary.transferEncountersTotal} GP2GP transfer encounter(s) content-confirmed` : ''}
  </div>`;

  const groupsHtml = groups
    .map((g) => {
      const colour = TIER_COLOUR[g.tier];
      const entryLines = g.entries
        .map((e) => {
          const snippet = esc((e.rawText || '').slice(0, 140));
          return `<div style="padding:4px 0;border-top:1px solid var(--border);font-size:11px;color:var(--text-2)">
        <strong style="color:var(--text)">${esc(e.recordedBy || '(unknown author)')}</strong>
        ${e.recordedByOrganisation ? ` · ${esc(e.recordedByOrganisation)}` : ''}
        ${e.fromTransferEncounter ? ' · <span style="color:var(--amber)">GP2GP transfer encounter</span>' : ''}
        <div style="margin-top:2px">${snippet}${(e.rawText || '').length > 140 ? '…' : ''}</div>
      </div>`;
        })
        .join('');
      return `<div style="border:1px solid var(--border);border-radius:var(--r);padding:10px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-size:12px"><strong>${esc(g.kind)}</strong> · ${esc(g.date || 'unknown date')} · ${esc(g.code)}</span>
        <span class="trigger-badge" style="background:transparent;border-color:${colour};color:${colour}">${TIER_LABEL[g.tier]}</span>
      </div>
      <div style="font-size:11px;color:${colour};margin-top:4px">${TIER_ACTION[g.tier]}</div>
      ${g.gp2gpWrapper ? '<div style="font-size:11px;color:var(--amber);margin-top:2px">GP2GP import-wrapper text detected</div>' : ''}
      ${entryLines}
    </div>`;
    })
    .join('');

  const unconfirmedTransfers = transferEncounters.filter((t) => !t.contentConfirmed);
  const transferHtml = unconfirmedTransfers.length
    ? `<div style="margin-top:10px;font-size:11px;color:var(--text-2)">
        ${unconfirmedTransfers.length} GP2GP transfer encounter(s) on ${unconfirmedTransfers.map((t) => esc(t.date || '?')).join(', ')}
        had no confirmed content match — not auto-tiered, review manually if needed.
      </div>`
    : '';

  return summaryLine + groupsHtml + transferHtml;
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

  if (nAffected === 0) {
    document.getElementById('resultBody').innerHTML =
      '<tr><td colspan="6" style="text-align:center;color:var(--text-2);padding:24px">No patients met any duplicate criterion.</td></tr>';
  } else {
    renderResults(affected);
    document.getElementById('csvBtn').style.display = 'inline-block';
    document.getElementById('secondPassBtn').style.display = 'inline-block';
  }

  setProgress(1);
  setStatus(
    incrementalNote || `Scan complete — ${nAffected} of ${eligibleCount} patients have duplicate active problems.`
  );
  document.getElementById('results').style.display = 'block';
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
    document.getElementById('results').style.display = 'block';
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
    `<strong>Open the <a href="${listingUrl}" target="_blank" style="color:var(--blue)">` +
    `Medicus patient listing page</a></strong>, wait for it to load, then come back here and click Run scan again.`;
  document.getElementById('runBtn').disabled = false;
  document.getElementById('progressWrap').style.display = 'none';
}

// ── Table sort ────────────────────────────────────────────────────────────────
document.querySelectorAll('th[data-col]').forEach((th) => {
  th.addEventListener('click', () => {
    const col = th.dataset.col;
    if (_sortCol === col) _sortAsc = !_sortAsc;
    else {
      _sortCol = col;
      _sortAsc = col !== 'count';
    }
    renderResults(_csvData);
  });
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
    ],
    (r) => {
      const shape = r['suite.patientFieldDebug'];
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
        ? '\n\nReusable URL templates (patient UUID replaced with __PATIENT_UUID__ — used by "Analyze record" below):\n  ' +
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

Promise.all([detectPracticeCode(), getDiscoveredBaseUrl()]).then(([code, url]) => {
  if (code) document.getElementById('codeInput').value = code;
  if (url) showDiscoveredEndpoint(url);
});

initSavedState();
