// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Note display board (TV / monitor kiosk).
//
// Paints ONLY the snapshot from board-core plus the practice-authored
// message. It never reads patient names out of the Condor streams — that
// reduction is buildSnapshot()'s job (H-067).

'use strict';

import {
  STORAGE_KEY,
  DEFAULT_POLL_SECONDS,
  TEMPO_ORDER,
  sanitiseConfig,
  resolveProfile,
  widgetsForProfile,
  formatFlapRows,
  buildSnapshot,
  demoStreams,
  forbiddenSnapshotKeys,
} from './board-core.js';

const stage = document.getElementById('noteStage');
const chromeProfile = document.getElementById('noteChromeProfile');
const profileSelect = document.getElementById('noteProfileSelect');
const fsBtn = document.getElementById('noteFsBtn');
const demoBtn = document.getElementById('noteDemoBtn');
const footLeft = document.getElementById('noteFootLeft');
const footRight = document.getElementById('noteFootRight');

const hasChrome = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

let config = sanitiseConfig(null);
let profile = resolveProfile(config, requestedProfileId());
let snapshot = null;
let usingDemo = isDemoRequested();
let pollTimer = null;
let clockTimer = null;
let lastFlap = '';
let lastClock = '';

function requestedProfileId() {
  const q = new URLSearchParams(location.search);
  const fromQuery = q.get('profile');
  const fromHash = (location.hash || '').replace(/^#/, '');
  if (fromQuery && fromQuery !== 'demo') return fromQuery;
  if (fromHash && fromHash !== 'demo') return fromHash;
  return null;
}

function isDemoRequested() {
  const q = new URLSearchParams(location.search);
  if (q.has('demo')) return true;
  if ((location.hash || '') === '#demo') return true;
  return !hasChrome;
}

function esc(s) {
  return String(s == null ? '' : s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

function flapRowHtml(row, flipFrom) {
  return [...row]
    .map((ch, i) => {
      const prev = flipFrom && flipFrom[i];
      const blank = ch === ' ' ? ' note-flap-blank' : '';
      const flip = prev != null && prev !== ch ? ' is-flip' : '';
      const glyph = ch === ' ' ? '' : esc(ch);
      return `<span class="note-flap${blank}${flip}" data-ch="${esc(ch)}"><span class="note-flap-glyph">${glyph}</span></span>`;
    })
    .join('');
}

function flapsHtml(message, rows, cols, prevJoined) {
  const grid = formatFlapRows(message, cols, rows);
  const joined = grid.join('\n');
  const prevRows = prevJoined ? prevJoined.split('\n') : [];
  const html = grid.map((row, i) => `<div class="note-flap-row">${flapRowHtml(row, prevRows[i] || '')}</div>`).join('');
  return { html, joined };
}

function tempoDots(tempo) {
  const idx = Math.max(0, TEMPO_ORDER.indexOf(tempo));
  return `<div class="note-dots" aria-hidden="true">${TEMPO_ORDER.map((t, i) => {
    const on = i <= idx ? ' is-on' : '';
    return `<span class="note-dot${on}" data-tone="${esc(t)}"></span>`;
  }).join('')}</div>`;
}

function tile(opts) {
  const tone = opts.tone ? ` data-tone="${esc(opts.tone)}"` : '';
  const word = opts.word ? ' note-tile-v-word' : '';
  return `<article class="note-tile"${tone}>
    <div class="note-tile-k">${esc(opts.k)}</div>
    <div class="note-tile-v${word}">${esc(opts.v)}</div>
    <div class="note-tile-s">${opts.sub || ''}${opts.dots || ''}</div>
  </article>`;
}

function tickerHtml(lines) {
  const items = (lines || []).filter(Boolean);
  if (!items.length) return '';
  const seq = items
    .map((l, i) => `${i ? '<span class="note-ticker-dot">·</span>' : ''}<span>${esc(l)}</span>`)
    .join('');
  return `<div class="note-ticker" aria-hidden="true">
    <div class="note-ticker-track">
      <div class="note-ticker-seq">${seq}</div>
      <div class="note-ticker-seq">${seq}</div>
    </div>
  </div>`;
}

function clockString(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function clockHtml(prev) {
  const text = clockString(new Date());
  const { html } = flapsHtml(text, 1, 5, prev);
  lastClock = formatFlapRows(text, 5, 1).join('\n');
  return `<div class="note-clock-wrap"><div class="note-clock" aria-label="Time">${html}</div></div>`;
}

function widgetSet() {
  return new Set(widgetsForProfile(profile));
}

function render() {
  const widgets = widgetSet();
  const s = snapshot;
  const parts = [];

  if (widgets.has('flap')) {
    const rows = profile.id === 'message' ? 3 : 2;
    const cols = profile.id === 'message' ? 18 : 22;
    const { html, joined } = flapsHtml(profile.message, rows, cols, lastFlap);
    lastFlap = joined;
    parts.push(`<div class="note-flaps" aria-label="Message">${html}</div>`);
  }

  const metrics = [];
  if (s && widgets.has('waiting')) {
    metrics.push(
      tile({
        k: 'People waiting',
        v: String(s.waiting.count),
        sub: esc(s.waiting.band),
        tone: s.waiting.tone,
      })
    );
  }
  if (s && widgets.has('tempo')) {
    metrics.push(
      tile({
        k: 'Tempo',
        v: s.tempoLabel,
        word: true,
        tone: s.tempo,
        dots: tempoDots(s.tempo),
      })
    );
  }
  if (s && widgets.has('demand')) {
    const n = (s.demand.medical || 0) + (s.demand.admin || 0);
    metrics.push(
      tile({
        k: 'Requests today',
        v: String(n),
        sub: esc(`${s.demand.medical} medical · ${s.demand.admin} admin`),
      })
    );
  }
  if (s && widgets.has('pressure') && s.pressure) {
    metrics.push(
      tile({
        k: 'Practice pressure',
        v: s.pressure.ppi == null ? '—' : String(s.pressure.ppi),
        sub: esc(s.pressure.band || 'Index from Condor'),
        tone: s.pressure.band || '',
      })
    );
  }
  if (s && widgets.has('triage') && s.triage) {
    metrics.push(
      tile({
        k: 'Triage inbox',
        v: s.triage.configured ? String(s.triage.total) : '—',
        sub: s.triage.configured ? esc(`${s.triage.urgent} urgent`) : 'Enable the request monitor in Settings',
      })
    );
  }
  if (s && widgets.has('slots') && s.slots) {
    metrics.push(
      tile({
        k: 'Slots remaining',
        v: String(s.slots.total),
        sub: esc(`${s.slots.am} this morning · ${s.slots.pm} this afternoon`),
      })
    );
  }
  if (s && widgets.has('urgent') && s.triage) {
    metrics.push(
      tile({
        k: 'Urgent unactioned',
        v: s.triage.configured ? String(s.triage.urgent) : '—',
        tone: s.triage.urgent > 0 ? 'busy' : 'quiet',
      })
    );
  }
  if (s && widgets.has('activity') && s.activity) {
    metrics.push(
      tile({
        k: 'Consultations today',
        v: String(s.activity.consultations),
        sub: esc(`${s.activity.all} activity items`),
      })
    );
  }
  if (metrics.length) parts.push(`<div class="note-metrics">${metrics.join('')}</div>`);

  if (s && widgets.has('ticker')) parts.push(tickerHtml(s.ticker));
  if (widgets.has('clock')) parts.push(clockHtml(lastClock));

  if (!parts.length) {
    stage.innerHTML = '<div class="note-empty">Nothing to show on this profile yet.</div>';
  } else {
    stage.innerHTML = `<div class="note-board" data-profile="${esc(profile.id)}" data-audience="${esc(profile.audience)}">${parts.join('')}</div>`;
  }

  chromeProfile.textContent = profile.name;
  profileSelect.value = profile.id;
  document.title = `${profile.name} · Note — Medicus Suite`;
  document.body.dataset.audience = profile.audience;
  document.body.dataset.profile = profile.id;

  const bits = ['Note · Medicus Suite'];
  if (usingDemo) bits.push('<span class="note-demo-flag">Demo figures</span>');
  if (profile.audience === 'public') bits.push('Public display');
  else bits.push('Staff display');
  footLeft.innerHTML = bits.join(' · ');
  updateFootRight();
}

function updateFootRight() {
  if (!snapshot) {
    footRight.textContent = usingDemo ? 'Demo' : 'Waiting for live figures';
    return;
  }
  const d = new Date(snapshot.fetchedAt);
  const pad = (n) => String(n).padStart(2, '0');
  const when = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const err =
    snapshot.errors && snapshot.errors.length
      ? ` · ${snapshot.errors.length} feed issue${snapshot.errors.length === 1 ? '' : 's'}`
      : '';
  footRight.innerHTML = `Updated ${esc(when)}${err ? `<span class="note-error">${esc(err)}</span>` : ''}`;
}

async function loadConfig() {
  if (!hasChrome) {
    config = sanitiseConfig(null);
    return;
  }
  const stored = await chrome.storage.local.get([STORAGE_KEY, 'suite.waitingRoom.thresholds']);
  config = sanitiseConfig(stored[STORAGE_KEY]);
  const wr = stored['suite.waitingRoom.thresholds'];
  if (wr && Number.isFinite(wr.amber) && Number.isFinite(wr.red)) {
    config.thresholds = {
      ...config.thresholds,
      amberWaitMin: wr.amber,
      redWaitMin: wr.red,
    };
  }
}

async function loadStreams() {
  if (usingDemo) return demoStreams();
  const { fetchAllStreams } = await import('../side-panel/modules/condor/condor-data.js');
  return fetchAllStreams();
}

async function loadPpi(streams) {
  if (profile.audience !== 'staff') return null;
  const { computeIndex } = await import('../side-panel/modules/condor/condor-index-core.js');
  return computeIndex(streams);
}

async function refresh() {
  profile = resolveProfile(config, requestedProfileId() || config.activeProfileId);
  let streams;
  try {
    streams = await loadStreams();
  } catch (e) {
    streams = { fetchErrors: [e && e.message ? e.message : String(e)] };
  }
  let ppi = null;
  try {
    ppi = await loadPpi(streams);
  } catch {
    ppi = null;
  }
  snapshot = buildSnapshot(streams, {
    nowMs: Date.now(),
    audience: profile.audience,
    thresholds: config.thresholds,
    ppi,
  });
  if (forbiddenSnapshotKeys(snapshot).length) {
    console.warn('[Note] snapshot contained a forbidden key — refusing to paint it');
    snapshot = buildSnapshot({}, { audience: profile.audience, nowMs: Date.now(), thresholds: config.thresholds });
    snapshot.errors = ['Display refused a snapshot that was not aggregate-only'];
  }
  render();
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  const ms = Math.max(10, config.pollSeconds || DEFAULT_POLL_SECONDS) * 1000;
  pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') refresh();
  }, ms);
  if (clockTimer) clearInterval(clockTimer);
  clockTimer = setInterval(() => {
    if (!widgetSet().has('clock')) return;
    const host = document.querySelector('.note-clock');
    if (!host) return;
    host.innerHTML = flapsHtml(clockString(new Date()), 1, 5, lastClock).html;
    lastClock = formatFlapRows(clockString(new Date()), 5, 1).join('\n');
  }, 1000);
}

function applyProfile(id) {
  config = sanitiseConfig({ ...config, activeProfileId: id });
  profile = resolveProfile(config, id);
  if (hasChrome) {
    chrome.storage.local.set({ [STORAGE_KEY]: config });
  }
  const url = new URL(location.href);
  if (usingDemo) url.searchParams.set('demo', '1');
  url.hash = id;
  history.replaceState(null, '', url);
  lastFlap = '';
  refresh();
}

function toggleFullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
}

function syncFullscreenClass() {
  document.body.classList.toggle('is-fullscreen', Boolean(document.fullscreenElement));
  fsBtn.textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen';
}

profileSelect.addEventListener('change', () => applyProfile(profileSelect.value));
fsBtn.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', syncFullscreenClass);

if (hasChrome) {
  demoBtn.hidden = false;
  demoBtn.addEventListener('click', () => {
    usingDemo = !usingDemo;
    demoBtn.textContent = usingDemo ? 'Live figures' : 'Demo';
    lastFlap = '';
    refresh();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area && area !== 'local') return;
    if (changes[STORAGE_KEY] || changes['suite.waitingRoom.thresholds']) {
      loadConfig().then(refresh);
    }
  });
}

window.addEventListener('hashchange', () => {
  const id = requestedProfileId();
  if (id) applyProfile(id);
});

document.addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) {
    return;
  }
  if (e.key === 'f' || e.key === 'F') {
    e.preventDefault();
    toggleFullscreen();
  } else if (e.key === '1') applyProfile('waiting-room');
  else if (e.key === '2') applyProfile('ops');
  else if (e.key === '3') applyProfile('message');
  else if (e.key === 'd' || e.key === 'D') {
    usingDemo = !usingDemo;
    if (hasChrome) demoBtn.textContent = usingDemo ? 'Live figures' : 'Demo';
    lastFlap = '';
    refresh();
  }
});

let idleTimer = null;
function bumpIdle() {
  document.body.classList.remove('is-idle');
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => document.body.classList.add('is-idle'), 4000);
}
['mousemove', 'keydown', 'pointerdown'].forEach((ev) => document.addEventListener(ev, bumpIdle, { passive: true }));
bumpIdle();

(async function boot() {
  await loadConfig();
  profile = resolveProfile(config, requestedProfileId() || config.activeProfileId);
  if (hasChrome) demoBtn.textContent = usingDemo ? 'Live figures' : 'Demo';
  await refresh();
  startPolling();
})();
