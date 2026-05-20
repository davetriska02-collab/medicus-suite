import { submit } from './storage.js';

const DRAFT_KEY        = 'itslowness.draft';
const LAST_SITE_KEY    = 'itslowness.lastSite';
const LAST_ROLE_KEY    = 'itslowness.lastRole';
const LAST_SESSION_KEY = 'itslowness.lastSessionType';

const state = {
  config: null,
  screen: 'setup',
  session: {
    sessionType: '',
    sessionTypeLabel: '',
    role: '',
    roleLabel: '',
    site: '',
    siteLabel: '',
    startedAt: null,
  },
  timer: {
    running: false,
    incidentStart: null,
    incidentStartISO: null,
  },
  incidents: [],
  narrative: '',
};

let rafId = null;
let heartbeatId = null;
let holdTimerId = null;
let holdProgressId = null;
let activeNoteIndex = null;
let pendingSessionPayload = null;

// ─── Boot ────────────────────────────────────────────────────────────────────

async function boot() {
  let config;
  try {
    const res = await fetch('./config.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    config = await res.json();
  } catch (err) {
    showErrorBanner(`Failed to load config.json: ${err.message}`);
    return;
  }

  if (!isValidConfig(config)) {
    showErrorBanner('config.json is malformed — sites, roles and sessionTypes must each be non-empty arrays of {id, label} objects.');
    return;
  }

  state.config = config;

  document.querySelector('meta[name="app-version"]').content = config.appVersion;
  const versionDisplay = document.getElementById('version-display');
  if (versionDisplay) versionDisplay.textContent = `v${config.appVersion}`;

  populateSelect('sel-site', config.sites);
  populateSelect('sel-role', config.roles);
  populateSelect('sel-session-type', config.sessionTypes);

  restoreLastSelections();

  const draft = loadDraft();
  if (draft && draft.session && draft.session.startedAt) {
    restoreFromDraft(draft);
  }

  bindEvents();
  startHeartbeat();
}

function isValidConfig(c) {
  return (
    c &&
    isNonEmptyArray(c.sites) &&
    isNonEmptyArray(c.roles) &&
    isNonEmptyArray(c.sessionTypes) &&
    c.sites.every(hasIdLabel) &&
    c.roles.every(hasIdLabel) &&
    c.sessionTypes.every(hasIdLabel)
  );
}

function isNonEmptyArray(v) {
  return Array.isArray(v) && v.length > 0;
}

function hasIdLabel(o) {
  return o && typeof o.id === 'string' && typeof o.label === 'string';
}

// ─── Selects & config ────────────────────────────────────────────────────────

function populateSelect(id, items) {
  const sel = document.getElementById(id);
  items.forEach(item => {
    const opt = document.createElement('option');
    opt.value = item.id;
    opt.textContent = item.label;
    sel.appendChild(opt);
  });
}

function restoreLastSelections() {
  trySetSelect('sel-site', localStorage.getItem(LAST_SITE_KEY));
  trySetSelect('sel-role', localStorage.getItem(LAST_ROLE_KEY));
  trySetSelect('sel-session-type', localStorage.getItem(LAST_SESSION_KEY));
}

function trySetSelect(id, value) {
  if (!value) return;
  const sel = document.getElementById(id);
  const opt = sel.querySelector(`option[value="${CSS.escape(value)}"]`);
  if (opt) sel.value = value;
}

function saveLastSelections() {
  localStorage.setItem(LAST_SITE_KEY, state.session.site);
  localStorage.setItem(LAST_ROLE_KEY, state.session.role);
  localStorage.setItem(LAST_SESSION_KEY, state.session.sessionType);
}

// ─── Draft persistence ───────────────────────────────────────────────────────

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(state));
  } catch {
    // quota exceeded — silently ignore
  }
}

function clearDraft() {
  localStorage.removeItem(DRAFT_KEY);
}

function startHeartbeat() {
  heartbeatId = setInterval(saveDraft, 5000);
}

function restoreFromDraft(draft) {
  Object.assign(state.session, draft.session);
  state.incidents = Array.isArray(draft.incidents) ? draft.incidents : [];
  state.narrative = draft.narrative || '';

  if (draft.timer) {
    state.timer.running = false;
    state.timer.incidentStart = null;
    state.timer.incidentStartISO = null;
  }

  const banner = document.getElementById('recovery-banner');
  banner.hidden = false;

  transitionTo('active');
  renderInfoChip();
  renderIncidentList();
  updateStats();
}

// ─── Screen transitions ──────────────────────────────────────────────────────

function transitionTo(screen) {
  state.screen = screen;
  document.body.dataset.screen = screen;
}

// ─── Event binding ───────────────────────────────────────────────────────────

function bindEvents() {
  document.getElementById('form-setup').addEventListener('submit', e => {
    e.preventDefault();
    startSession();
  });

  document.getElementById('btn-edit-session').addEventListener('click', () => {
    if (state.timer.running) stopTimer();
    transitionTo('setup');
    syncSelectsToState();
  });

  document.getElementById('btn-toggle-timer').addEventListener('click', toggleTimer);

  const btnEnd = document.getElementById('btn-end-session');
  btnEnd.addEventListener('pointerdown', onEndSessionPointerDown);
  btnEnd.addEventListener('pointerup', onEndSessionPointerUp);
  btnEnd.addEventListener('pointercancel', onEndSessionPointerUp);
  btnEnd.addEventListener('pointerleave', onEndSessionPointerUp);

  document.getElementById('btn-note-confirm').addEventListener('click', confirmNote);
  document.getElementById('btn-note-cancel').addEventListener('click', () => {
    document.getElementById('note-dialog').close();
  });

  document.getElementById('note-dialog').addEventListener('cancel', e => {
    e.preventDefault();
    document.getElementById('note-dialog').close();
  });

  document.getElementById('session-narrative').addEventListener('input', e => {
    state.narrative = e.target.value;
  });

  document.getElementById('btn-submit').addEventListener('click', handleSubmit);

  document.getElementById('btn-download-json').addEventListener('click', () => {
    if (!pendingSessionPayload) return;
    downloadJson(pendingSessionPayload);
  });

  document.getElementById('btn-new-session').addEventListener('click', () => {
    clearDraft();
    pendingSessionPayload = null;
    state.incidents = [];
    state.narrative = '';
    state.session = {
      sessionType: '',
      sessionTypeLabel: '',
      role: '',
      roleLabel: '',
      site: '',
      siteLabel: '',
      startedAt: null,
    };
    transitionTo('setup');
  });

  window.addEventListener('keydown', handleKeydown);

  window.addEventListener('beforeunload', e => {
    if (state.screen === 'active' && state.incidents.length > 0) {
      e.preventDefault();
      e.returnValue = 'You have unsaved session data.';
      return e.returnValue;
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.timer.running) {
      if (!document.title.startsWith('[RUNNING] ')) {
        document.title = '[RUNNING] ' + document.title;
      }
    } else if (!document.hidden) {
      document.title = document.title.replace(/^\[RUNNING\] /, '');
    }
  });
}

function syncSelectsToState() {
  trySetSelect('sel-site', state.session.site);
  trySetSelect('sel-role', state.session.role);
  trySetSelect('sel-session-type', state.session.sessionType);
}

// ─── Session start ───────────────────────────────────────────────────────────

function startSession() {
  const siteEl    = document.getElementById('sel-site');
  const roleEl    = document.getElementById('sel-role');
  const typeEl    = document.getElementById('sel-session-type');

  if (!siteEl.value || !roleEl.value || !typeEl.value) {
    showErrorBanner('Please select a site, role, and session type before starting.');
    return;
  }

  hideErrorBanner();

  state.session.site         = siteEl.value;
  state.session.siteLabel    = siteEl.options[siteEl.selectedIndex].text;
  state.session.role         = roleEl.value;
  state.session.roleLabel    = roleEl.options[roleEl.selectedIndex].text;
  state.session.sessionType  = typeEl.value;
  state.session.sessionTypeLabel = typeEl.options[typeEl.selectedIndex].text;
  state.session.startedAt    = new Date().toISOString();

  state.incidents = [];
  state.narrative = '';
  pendingSessionPayload = null;

  saveLastSelections();
  transitionTo('active');
  renderInfoChip();
  renderIncidentList();
  updateStats();

  document.getElementById('recovery-banner').hidden = true;

  resetToggleButton();
}

function renderInfoChip() {
  const { sessionTypeLabel, roleLabel, siteLabel } = state.session;
  document.getElementById('info-chip').textContent =
    `${sessionTypeLabel} · ${roleLabel} · ${siteLabel}`;
}

// ─── Timer ───────────────────────────────────────────────────────────────────

function toggleTimer() {
  if (state.timer.running) {
    stopTimer();
  } else {
    startTimer();
  }
}

function startTimer() {
  state.timer.running          = true;
  state.timer.incidentStart    = performance.now();
  state.timer.incidentStartISO = new Date().toISOString();

  const btn = document.getElementById('btn-toggle-timer');
  btn.classList.remove('idle');
  btn.classList.add('running');

  startElapsedLoop();
}

function stopTimer() {
  const elapsed = performance.now() - state.timer.incidentStart;
  const durationSeconds = Math.round(elapsed / 1000);

  state.timer.running = false;

  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  const incident = {
    id: state.incidents.length + 1,
    startedAt: state.timer.incidentStartISO,
    endedAt: new Date().toISOString(),
    durationSeconds,
    note: '',
  };

  state.incidents.push(incident);
  state.timer.incidentStart    = null;
  state.timer.incidentStartISO = null;

  resetToggleButton();
  renderIncidentList();
  updateStats();
}

function resetToggleButton() {
  const btn = document.getElementById('btn-toggle-timer');
  btn.classList.remove('running');
  btn.classList.add('idle');
  document.getElementById('display-elapsed').textContent = '00:00.0';
}

function startElapsedLoop() {
  const startMark = state.timer.incidentStart;

  function frame() {
    if (!state.timer.running) return;
    const ms = performance.now() - startMark;
    document.getElementById('display-elapsed').textContent = formatElapsed(ms);
    rafId = requestAnimationFrame(frame);
  }

  rafId = requestAnimationFrame(frame);
}

function formatElapsed(ms) {
  const totalTenths = Math.floor(ms / 100);
  const tenths = totalTenths % 10;
  const totalSeconds = Math.floor(ms / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60);
  return `${pad2(minutes)}:${pad2(seconds)}.${tenths}`;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

// ─── Stats ───────────────────────────────────────────────────────────────────

function updateStats() {
  const count = state.incidents.length;
  const total = state.incidents.reduce((s, i) => s + i.durationSeconds, 0);

  document.getElementById('stat-incidents').textContent =
    `${count} incident${count === 1 ? '' : 's'}`;

  document.getElementById('stat-total-lost').textContent =
    total >= 60
      ? `${Math.floor(total / 60)}m ${total % 60}s lost`
      : `${total}s lost`;
}

// ─── Incident list ───────────────────────────────────────────────────────────

function renderIncidentList() {
  const list = document.getElementById('incident-list');
  list.innerHTML = '';

  const reversed = [...state.incidents].reverse();

  reversed.forEach((incident, reversedIdx) => {
    const originalIdx = state.incidents.length - 1 - reversedIdx;
    const li = document.createElement('li');

    const timeStr = formatLocalTime(incident.startedAt);
    const durStr  = formatDurationDisplay(incident.durationSeconds);

    const meta = document.createElement('div');
    meta.className = 'incident-meta';

    const label = document.createElement('span');
    label.className = 'incident-label';
    label.textContent = `#${incident.id}`;

    const dur = document.createElement('span');
    dur.className = 'incident-duration';
    dur.textContent = durStr;

    const time = document.createElement('span');
    time.className = 'incident-time';
    time.textContent = timeStr;

    const noteBtn = document.createElement('button');
    noteBtn.className = 'btn btn-ghost btn-small';
    noteBtn.textContent = incident.note ? 'Edit note' : 'Add note';
    noteBtn.addEventListener('click', () => openNoteDialog(originalIdx));

    meta.appendChild(label);
    meta.appendChild(dur);
    meta.appendChild(time);
    meta.appendChild(noteBtn);
    li.appendChild(meta);

    if (incident.note) {
      const noteEl = document.createElement('div');
      noteEl.className = 'incident-note';
      noteEl.textContent = incident.note;
      li.appendChild(noteEl);
    }

    list.appendChild(li);
  });
}

function formatLocalTime(isoString) {
  const d = new Date(isoString);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDurationDisplay(seconds) {
  if (seconds >= 60) {
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

// ─── Note dialog ─────────────────────────────────────────────────────────────

function openNoteDialog(incidentIndex) {
  activeNoteIndex = incidentIndex;
  const input = document.getElementById('note-input');
  input.value = state.incidents[incidentIndex].note || '';
  document.getElementById('note-dialog').showModal();
  input.focus();
}

function confirmNote() {
  if (activeNoteIndex === null) return;
  const value = document.getElementById('note-input').value.trim();
  state.incidents[activeNoteIndex].note = value;
  activeNoteIndex = null;
  document.getElementById('note-dialog').close();
  renderIncidentList();
}

// ─── Keyboard handler ────────────────────────────────────────────────────────

function handleKeydown(e) {
  if (state.screen !== 'active') return;

  const dialog = document.getElementById('note-dialog');
  const dialogOpen = dialog.open;

  if (e.ctrlKey && e.shiftKey && e.key === 'S') {
    e.preventDefault();
    toggleTimer();
    return;
  }

  if (dialogOpen) return;

  if (e.key === ' ' || e.key === 'Spacebar') {
    const tag = document.activeElement?.tagName;
    const isInteractive = ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(tag);
    if (!isInteractive) {
      e.preventDefault();
      toggleTimer();
    }
    return;
  }

  if ((e.key === 'n' || e.key === 'N') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const tag = document.activeElement?.tagName;
    const isText = ['INPUT', 'TEXTAREA'].includes(tag);
    if (!isText && state.incidents.length > 0) {
      e.preventDefault();
      openNoteDialog(state.incidents.length - 1);
    }
    return;
  }

  if (e.key === 'Escape') {
    if (dialogOpen) dialog.close();
  }
}

// ─── End session (hold-to-confirm) ───────────────────────────────────────────

function onEndSessionPointerDown(e) {
  const btn = document.getElementById('btn-end-session');
  btn.setPointerCapture(e.pointerId);

  let pct = 0;
  holdProgressId = setInterval(() => {
    pct += 5;
    btn.textContent = `Hold… ${pct}%`;
    if (pct >= 100) {
      clearInterval(holdProgressId);
      holdProgressId = null;
    }
  }, 100);

  holdTimerId = setTimeout(() => {
    clearInterval(holdProgressId);
    holdProgressId = null;
    holdTimerId = null;
    endSession();
  }, 2000);
}

function onEndSessionPointerUp() {
  if (holdTimerId) {
    clearTimeout(holdTimerId);
    holdTimerId = null;
  }
  if (holdProgressId) {
    clearInterval(holdProgressId);
    holdProgressId = null;
  }
  const btn = document.getElementById('btn-end-session');
  btn.textContent = 'End Session';
}

function endSession() {
  if (state.timer.running) stopTimer();
  renderSubmitScreen();
  transitionTo('submit');
}

// ─── Submit screen ───────────────────────────────────────────────────────────

function renderSubmitScreen() {
  const count = state.incidents.length;
  const total = state.incidents.reduce((s, i) => s + i.durationSeconds, 0);

  document.getElementById('submit-heading').textContent =
    `Session complete — ${count} incident${count === 1 ? '' : 's'}, ${formatDurationDisplay(total)} lost`;

  const tbody = document.getElementById('incident-table-body');
  tbody.innerHTML = '';

  state.incidents.forEach(incident => {
    const tr = document.createElement('tr');

    const tdN    = document.createElement('td');
    tdN.textContent = incident.id;

    const tdTime = document.createElement('td');
    tdTime.textContent = formatLocalTime(incident.startedAt);

    const tdDur  = document.createElement('td');
    tdDur.textContent = formatDurationDisplay(incident.durationSeconds);

    const tdNote = document.createElement('td');
    tdNote.textContent = incident.note || '—';

    tr.appendChild(tdN);
    tr.appendChild(tdTime);
    tr.appendChild(tdDur);
    tr.appendChild(tdNote);
    tbody.appendChild(tr);
  });

  const narrative = document.getElementById('session-narrative');
  narrative.value = state.narrative;

  const status = document.getElementById('submit-status');
  status.hidden = true;
  status.className = 'submit-status';
  status.textContent = '';

  document.getElementById('btn-submit').disabled = false;
  document.getElementById('btn-submit').hidden = false;
  document.getElementById('btn-new-session').hidden = true;
  document.getElementById('escape-hatch').hidden = true;
}

// ─── Submit ──────────────────────────────────────────────────────────────────

async function handleSubmit() {
  state.narrative = document.getElementById('session-narrative').value;

  const payload = buildSessionPayload();
  pendingSessionPayload = payload;

  const btn = document.getElementById('btn-submit');
  btn.disabled = true;
  btn.textContent = 'Submitting…';

  const status = document.getElementById('submit-status');
  status.hidden = false;
  status.className = 'submit-status';
  status.textContent = 'Sending…';

  try {
    const result = await submit(payload, state.config);

    if (result.ok) {
      clearDraft();
      status.className = 'submit-status success';
      status.textContent = result.issueNumber
        ? `Submitted successfully. Issue #${result.issueNumber}.`
        : 'Submitted successfully.';
      btn.hidden = true;
      document.getElementById('btn-new-session').hidden = false;
      document.getElementById('escape-hatch').hidden = true;
    } else if (result.queued) {
      status.className = 'submit-status queued';
      status.textContent = `Saved to offline queue: ${result.error}. It will be retried next time.`;
      document.getElementById('escape-hatch').hidden = false;
      btn.disabled = false;
      btn.textContent = 'Retry';
    }
  } catch (err) {
    status.className = 'submit-status error';
    status.textContent = `Error: ${err.message}`;
    btn.disabled = false;
    btn.textContent = 'Retry';
    document.getElementById('escape-hatch').hidden = false;
  }
}

function buildSessionPayload() {
  const now = new Date();
  return {
    schemaVersion: 1,
    sessionId: `${now.toISOString()}-${Math.random().toString(36).slice(2, 6)}`,
    site: state.session.site,
    siteLabel: state.session.siteLabel,
    role: state.session.role,
    roleLabel: state.session.roleLabel,
    sessionType: state.session.sessionType,
    sessionTypeLabel: state.session.sessionTypeLabel,
    startedAt: state.session.startedAt,
    endedAt: now.toISOString(),
    wallClockSeconds: Math.round(
      (now.getTime() - new Date(state.session.startedAt).getTime()) / 1000
    ),
    incidentCount: state.incidents.length,
    totalLostSeconds: state.incidents.reduce((s, i) => s + i.durationSeconds, 0),
    narrative: state.narrative,
    incidents: state.incidents,
    client: {
      userAgent: navigator.userAgent,
      appVersion: state.config.appVersion,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  };
}

// ─── Download JSON ───────────────────────────────────────────────────────────

function downloadJson(payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `it-slowness-session-${payload.sessionId}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Error banner ────────────────────────────────────────────────────────────

function showErrorBanner(msg) {
  const banner = document.getElementById('error-banner');
  banner.textContent = msg;
  banner.hidden = false;
}

function hideErrorBanner() {
  document.getElementById('error-banner').hidden = true;
}

// ─── Init ────────────────────────────────────────────────────────────────────

boot();
