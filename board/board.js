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
  sanitiseStyleId,
  sanitiseColourId,
  resolveProfile,
  widgetsForProfile,
  formatFlapRows,
  buildSnapshot,
  demoStreams,
  forbiddenSnapshotKeys,
  feedIsDegraded,
  youtubeEmbedUrl,
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
  const strong = opts.strongSub ? ' note-tile-s-strong' : '';
  return `<article class="note-tile"${tone}>
    <div class="note-tile-k">${esc(opts.k)}</div>
    <div class="note-tile-v${word}">${esc(opts.v)}</div>
    <div class="note-tile-s${strong}">${opts.sub || ''}${opts.dots || ''}</div>
  </article>`;
}

function boardCopy() {
  return config.copy || {};
}

function confirmStaffProfile(id) {
  const next = (config.profiles || []).find((p) => p.id === id);
  if (!next || next.audience !== 'staff') return true;
  if (profile && profile.audience === 'staff' && profile.id === id) return true;
  return window.confirm(
    `${next.name} is a staff display. It shows the triage inbox and pressure figures. Do not put this tab on the waiting-room TV.\n\nOpen it anyway?`
  );
}

function syncDemoBtn() {
  if (!hasChrome || !demoBtn) return;
  demoBtn.hidden = false;
  if (publicFeedFailed()) demoBtn.textContent = 'Live figures failed';
  else demoBtn.textContent = usingDemo ? 'Showing demo' : 'Showing live';
}

function publicFeedFailed() {
  return profile.audience === 'public' && !usingDemo && feedIsDegraded(snapshot);
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

function publicTempoSub(tempo) {
  const c = boardCopy();
  if (tempo === 'quiet') return c.tempoSubQuiet || '';
  if (tempo === 'steady') return c.tempoSubSteady || '';
  if (tempo === 'busy') return c.tempoSubBusy || '';
  if (tempo === 'very-busy') return c.tempoSubVery || '';
  return '';
}

function widgetSet() {
  return new Set(widgetsForProfile(profile));
}

function failLoudHtml() {
  const c = boardCopy();
  return `<div class="note-board note-board-fail" data-profile="${esc(profile.id)}" data-audience="public">
    <div class="note-fail" role="alert">
      <div class="note-fail-title">${esc(c.failTitle)}</div>
      <div class="note-fail-ask">${esc(c.failAsk)}</div>
      <p class="note-fail-body">${esc(c.failBody)}</p>
    </div>
    ${clockHtml(lastClock)}
  </div>`;
}

function youtubeHtml() {
  if (!widgetSet().has('youtube')) return '';
  const src = youtubeEmbedUrl(profile.youtubeListId);
  if (!src) return '';
  return `<aside class="note-yt" aria-label="Practice playlist"><iframe class="note-yt-frame" title="Practice playlist" src="${esc(src)}" allow="autoplay; fullscreen" referrerpolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-presentation"></iframe></aside>`;
}

function render() {
  const widgets = widgetSet();
  const s = snapshot;
  const parts = [];

  if (publicFeedFailed()) {
    stage.innerHTML = failLoudHtml();
    paintChrome();
    return;
  }

  if (s && profile.audience === 'staff' && !usingDemo && feedIsDegraded(s)) {
    parts.push(`<div class="note-fail-banner" role="alert">${esc(boardCopy().failBanner)}</div>`);
  }

  if (widgets.has('flap')) {
    const rows = 2;
    const cols = profile.id === 'message' ? 16 : 22;
    const { html, joined } = flapsHtml(profile.message, rows, cols, lastFlap);
    lastFlap = joined;
    parts.push(`<div class="note-flaps" aria-label="Message">${html}</div>`);
  }

  const metrics = [];
  if (s && widgets.has('waiting')) {
    metrics.push(
      tile({
        k: boardCopy().waitingLabel || 'People waiting',
        v: String(s.waiting.count),
        sub: esc(s.waiting.band),
        tone: s.waiting.tone,
        strongSub: true,
      })
    );
  }
  if (s && widgets.has('tempo')) {
    metrics.push(
      tile({
        k: profile.audience === 'staff' ? boardCopy().tempoLabelStaff : boardCopy().tempoLabelPublic,
        v: s.tempoLabel,
        word: true,
        tone: s.tempo,
        sub: profile.audience === 'staff' ? esc(boardCopy().tempoSubStaff) : esc(publicTempoSub(s.tempo)),
        dots: tempoDots(s.tempo),
      })
    );
  }
  if (s && widgets.has('demand')) {
    const n = (s.demand.medical || 0) + (s.demand.admin || 0);
    metrics.push(
      tile({
        k: boardCopy().demandLabel || 'Requests today',
        v: String(n),
        sub: esc(`${s.demand.medical} medical · ${s.demand.admin} admin`),
      })
    );
  }
  if (s && widgets.has('pressure') && s.pressure) {
    metrics.push(
      tile({
        k: boardCopy().pressureLabel || 'Pressure index',
        v: s.pressure.ppi == null ? '—' : String(s.pressure.ppi),
        sub: esc(s.pressure.band ? `${s.pressure.band} · ${boardCopy().pressureSub}` : boardCopy().pressureSub),
        tone: s.pressure.band || '',
      })
    );
  }
  if (s && widgets.has('triage') && s.triage) {
    metrics.push(
      tile({
        k: boardCopy().triageLabel || 'Triage inbox',
        v: s.triage.configured ? String(s.triage.total) : '—',
        sub: s.triage.configured ? esc(`${s.triage.urgent} urgent`) : 'Enable the request monitor in Settings',
      })
    );
  }
  if (s && widgets.has('slots') && s.slots) {
    metrics.push(
      tile({
        k: boardCopy().slotsLabel || 'Slots remaining',
        v: String(s.slots.total),
        sub: esc(`${s.slots.am} this morning · ${s.slots.pm} this afternoon`),
      })
    );
  }
  if (s && widgets.has('urgent') && s.triage) {
    metrics.push(
      tile({
        k: boardCopy().urgentLabel || 'Urgent unactioned',
        v: s.triage.configured ? String(s.triage.urgent) : '—',
        tone: s.triage.urgent > 0 ? 'busy' : 'quiet',
      })
    );
  }
  if (s && widgets.has('activity') && s.activity) {
    metrics.push(
      tile({
        k: boardCopy().activityLabel || 'Consultations today',
        v: String(s.activity.consultations),
        sub: esc(`${s.activity.all} activity items`),
      })
    );
  }
  if (metrics.length) parts.push(`<div class="note-metrics">${metrics.join('')}</div>`);

  if (s && widgets.has('ticker')) parts.push(tickerHtml(s.ticker));
  if (widgets.has('clock')) parts.push(clockHtml(lastClock));

  const yt = youtubeHtml();
  if (!parts.length && !yt) {
    stage.innerHTML = `<div class="note-empty">${esc(boardCopy().emptyBoard)}</div>`;
  } else if (yt) {
    stage.innerHTML = `<div class="note-board note-board-has-yt" data-profile="${esc(profile.id)}" data-audience="${esc(profile.audience)}"><div class="note-yt-main">${parts.join('')}</div>${yt}</div>`;
  } else {
    stage.innerHTML = `<div class="note-board" data-profile="${esc(profile.id)}" data-audience="${esc(profile.audience)}">${parts.join('')}</div>`;
  }

  paintChrome();
}

function paintChrome() {
  chromeProfile.textContent = profile.name;
  const opts = (config.profiles || []).map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  if (profileSelect.innerHTML !== opts) profileSelect.innerHTML = opts;
  profileSelect.value = profile.id;
  document.title = `${profile.name} · Note — Medicus Suite`;
  document.body.dataset.audience = profile.audience;
  document.body.dataset.profile = profile.id;
  const styleId = sanitiseStyleId(config.styleId);
  const colourId = sanitiseColourId(config.colourId);
  document.body.dataset.style = styleId;
  document.body.dataset.colour = colourId;
  document.documentElement.dataset.style = styleId;
  document.documentElement.dataset.colour = colourId;
  syncDemoBtn();

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
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  config = sanitiseConfig(stored[STORAGE_KEY]);
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
    copy: config.copy,
    publicCountsRequests: config.publicCountsRequests,
    ppi,
  });
  if (forbiddenSnapshotKeys(snapshot).length) {
    console.warn('[Note] snapshot contained a forbidden key — refusing to paint it');
    snapshot = buildSnapshot(
      {},
      {
        audience: profile.audience,
        nowMs: Date.now(),
        thresholds: config.thresholds,
        copy: config.copy,
      }
    );
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

profileSelect.addEventListener('change', () => {
  const id = profileSelect.value;
  if (!confirmStaffProfile(id)) {
    profileSelect.value = profile.id;
    return;
  }
  applyProfile(id);
});
fsBtn.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', syncFullscreenClass);

if (hasChrome) {
  demoBtn.hidden = false;
  demoBtn.addEventListener('click', () => {
    usingDemo = !usingDemo;
    syncDemoBtn();
    lastFlap = '';
    refresh();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area && area !== 'local') return;
    if (changes[STORAGE_KEY]) {
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
  else if (e.key === '2') {
    if (!confirmStaffProfile('ops')) return;
    applyProfile('ops');
  } else if (e.key === '3') applyProfile('message');
  else if (e.key === 'd' || e.key === 'D') {
    usingDemo = !usingDemo;
    syncDemoBtn();
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
  syncDemoBtn();
  await refresh();
  startPolling();
})();
