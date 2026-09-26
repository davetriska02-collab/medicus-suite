// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Availability wall. Read-only. One fetch loop, only while this tab is visible.
//
// The v3.264.15 load cut removed Today and the Note TV board because they
// kept polling Medicus in the background. This page does not register an
// alarm and does not fetch while hidden. Each refresh is seven GETs of
// embedded-overview (one calendar day each). Default gap is 5 minutes.
// The floor is 2 minutes. The countdown ticks locally.

import {
  TICK_MS,
  attention,
  blankTile,
  clockLabel,
  defaultTiles,
  dropPastSlots,
  extractFreeSlots,
  isoFromDate,
  mergeSnapshots,
  normaliseConfig,
  overviewPath,
  pollMsFromConfig,
  roleIndex,
  shouldFetch,
  tileFace,
  todayViews,
  weekDates,
  weekView,
} from '../shared/availability-board-core.js';

const main = document.getElementById('avMain');
const weekEl = document.getElementById('avWeek');
const banner = document.getElementById('avBanner');
const updatedEl = document.getElementById('avUpdated');
const dateEl = document.getElementById('avDate');
const noteEl = document.getElementById('avNote');
const editor = document.getElementById('avEditor');
const editorBody = document.getElementById('avEditorBody');

let config = normaliseConfig(null);
let roleMap = {};
let snapshot = { days: {}, fetchedAt: null, stale: false, error: false, ready: false };
let observed = { slotTypes: [], sessions: [], clinicians: [] };
let reduceMotion = false;
let pollTimer = null;
let tickTimer = null;
let fetching = false;
let selectedTile = 0;

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function packOn() {
  const packs = window.PracticePacks;
  if (!packs || !packs.KEYS) return false;
  return packs.peek(packs.KEYS.availabilityWall) === true;
}

function visible() {
  return document.visibilityState === 'visible' && !document.hidden;
}

function readMotion() {
  reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

async function loadConfig() {
  const exp = await window.availabilityExport();
  config = normaliseConfig(exp && exp.config);
  let staff = [];
  try {
    const r = await chrome.storage.local.get('rota.staff');
    staff = Array.isArray(r['rota.staff']) ? r['rota.staff'] : [];
  } catch {
    staff = [];
  }
  roleMap = roleIndex(staff);
}

function paintOff(message) {
  main.innerHTML = `<p class="av-message">${esc(message)}</p>`;
  weekEl.hidden = true;
  noteEl.textContent = '';
  banner.hidden = true;
}

function faceHtml(view) {
  const face = tileFace(view);
  if (!face) return '';
  const motion = attention(face.tone, reduceMotion);
  const icon = motion.icon ? '<span class="av-icon" aria-hidden="true">!</span>' : '';
  const cls = `av-tile tone-${esc(face.tone)}${motion.flash ? ' flash' : ''}`;
  const label = `${face.label}, ${face.primary}, ${face.secondary}`;
  return `<article class="${cls}" aria-label="${esc(label)}">
    <p class="av-kicker">${esc(face.label)}</p>
    <p class="av-primary">${icon}${esc(face.primary)}</p>
    ${face.detail ? `<p class="av-detail">${esc(face.detail)}</p>` : ''}
    <p class="av-secondary">${esc(face.secondary)}</p>
  </article>`;
}

function render() {
  if (!packOn()) {
    paintOff('The availability wall is switched off. Turn it on under Settings, Practice features.');
    return;
  }
  const now = new Date();
  dateEl.textContent = now.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  if (!snapshot.ready) {
    paintOff(
      snapshot.error
        ? 'The book could not be read. Nothing is shown as zero. Try again when Medicus is signed in.'
        : 'Reading the appointment book…'
    );
    updatedEl.textContent = snapshot.error ? 'No reading yet' : 'Waiting for the book';
    return;
  }
  const today = isoFromDate(now);
  const todayRow = snapshot.days[today];
  const todaySlots = todayRow && todayRow.slots;
  if (todaySlots == null) {
    main.innerHTML = '<p class="av-message">Today’s book has not been read. Slots are not shown as zero.</p>';
  } else {
    const views = todayViews(todaySlots, config, now, reduceMotion);
    main.innerHTML = `<div class="av-grid">${views.tiles.map(faceHtml).join('')}</div>`;
    noteEl.textContent =
      views.unmapped > 0
        ? `${views.unmapped} free slot${views.unmapped === 1 ? '' : 's'} today ${views.unmapped === 1 ? 'is' : 'are'} not on a tile. Set up tiles to place them.`
        : 'Slots, times and counts only. A slot can be taken between refreshes.';
  }
  const dates = weekDates(today);
  const rows = dates.map((date) => {
    const row = snapshot.days[date];
    return { date, slots: row ? row.slots : null };
  });
  const week = weekView(rows, config);
  const peak = Math.max(1, ...week.days.map((d) => (d.routine || 0) + (d.extended || 0)));
  const bars = week.days
    .map((d) => {
      const routine = d.routine == null ? '—' : String(d.routine);
      const ext = d.extended ? `${d.extended} extended` : d.weekend ? 'Weekend' : '';
      const rW = d.routine ? Math.round((d.routine / peak) * 100) : 0;
      const eW = d.extended ? Math.round((d.extended / peak) * 100) : 0;
      return `<div class="av-bar${d.weekend ? ' weekend' : ''}">
        <div class="av-bar-label">${esc(d.label)}</div>
        <div class="av-bar-count">${esc(routine)}</div>
        <div class="av-bar-ext">${esc(ext)}</div>
        <div class="av-meter" aria-hidden="true"><span class="routine" style="width:${rW}%"></span><span class="extended" style="width:${eW}%"></span></div>
      </div>`;
    })
    .join('');
  const total = week.incomplete ? `${week.totalRoutine}+` : String(week.totalRoutine);
  weekEl.hidden = false;
  weekEl.innerHTML = `<h2>Next 7 days · routine GP</h2>
    <div class="av-bars">${bars}
      <div class="av-total"><span>Total</span><strong>${esc(total)}</strong>${
        week.totalExtended ? `<div class="av-bar-ext">${week.totalExtended} extended</div>` : ''
      }</div>
    </div>`;
  if (snapshot.fetchedAt) {
    const stamp = clockLabel(snapshot.fetchedAt);
    updatedEl.textContent = snapshot.stale ? `Last updated ${stamp} · refresh failed` : `Last updated ${stamp}`;
  }
  banner.hidden = !snapshot.stale;
  banner.textContent = snapshot.stale
    ? 'The last refresh did not finish. Numbers still on screen are the previous reading, not zeros.'
    : '';
}

async function fetchDay(code, date) {
  const url = `${window.PracticeCode.apiBaseFor(code)}${overviewPath(date)}`;
  const r = await fetch(url, { credentials: 'include', method: 'GET' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function refresh() {
  if (fetching) return;
  if (!shouldFetch({ packOn: packOn(), visible: visible() })) return;
  const code = await window.PracticeCode.getPracticeCode();
  if (!code) {
    snapshot = {
      days: snapshot.days,
      fetchedAt: snapshot.fetchedAt,
      stale: true,
      error: !snapshot.ready,
      ready: snapshot.ready,
    };
    if (!snapshot.ready) snapshot.error = true;
    render();
    if (!snapshot.ready) paintOff('No practice code yet. Open Medicus, or set the code in Settings.');
    return;
  }
  fetching = true;
  const today = isoFromDate(new Date());
  const dates = weekDates(today);
  const incoming = { fetchedAt: Date.now(), days: {} };
  const observedSets = { slotTypes: new Set(), sessions: new Set(), clinicians: new Set() };
  let cursor = 0;
  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= dates.length) return;
      const date = dates[i];
      try {
        const raw = await fetchDay(code, date);
        const extracted = extractFreeSlots(raw, {
          now: new Date(),
          dateISO: date,
          roleIndex: roleMap,
          dropPast: date === today,
        });
        incoming.days[date] = { ok: true, slots: extracted.slots };
        extracted.observed.slotTypes.forEach((n) => observedSets.slotTypes.add(n));
        extracted.observed.sessions.forEach((n) => observedSets.sessions.add(n));
        extracted.observed.clinicians.forEach((n) => observedSets.clinicians.add(n));
      } catch {
        incoming.days[date] = { ok: false };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(2, dates.length) }, () => worker()));
  fetching = false;
  snapshot = mergeSnapshots(snapshot, incoming);
  observed = {
    slotTypes: [...observedSets.slotTypes].sort(),
    sessions: [...observedSets.sessions].sort(),
    clinicians: [...observedSets.clinicians].sort(),
  };
  render();
}

function localTick() {
  if (!visible() || !snapshot.ready) return;
  const today = isoFromDate(new Date());
  const row = snapshot.days[today];
  if (row && Array.isArray(row.slots)) {
    snapshot.days[today] = { slots: dropPastSlots(row.slots, new Date()) };
  }
  render();
}

function arm() {
  if (pollTimer) clearInterval(pollTimer);
  if (tickTimer) clearInterval(tickTimer);
  pollTimer = null;
  tickTimer = null;
  if (!packOn()) return;
  const pollMs = pollMsFromConfig(config);
  tickTimer = setInterval(localTick, TICK_MS);
  pollTimer = setInterval(() => {
    if (!shouldFetch({ packOn: packOn(), visible: visible() })) return;
    refresh();
  }, pollMs);
}

function onVisibility() {
  if (!visible()) return;
  refresh();
}

function chipList(title, names, field) {
  if (!names.length) return '';
  const chips = names
    .map((n) => `<button type="button" data-add-field="${esc(field)}" data-add-value="${esc(n)}">${esc(n)}</button>`)
    .join('');
  return `<div><strong>${esc(title)}</strong><div class="av-observed">${chips}</div></div>`;
}

function renderEditor() {
  const tiles = config.tiles
    .map((t, i) => {
      const m = t.match || { types: [], sessions: [], roles: [] };
      const x = t.exclude || { types: [], sessions: [], roles: [] };
      return `<section class="av-tile-edit" data-index="${i}">
        <h3><label><input type="radio" name="avSel" ${i === selectedTile ? 'checked' : ''} data-sel="${i}" /> Tile</label></h3>
        <div class="av-row">
          <label>Name <input type="text" data-k="label" value="${esc(t.label)}" /></label>
          <label><input type="checkbox" data-k="hidden" ${t.hidden ? 'checked' : ''} /> Hide</label>
          <label><input type="checkbox" data-k="showOnToday" ${t.showOnToday ? 'checked' : ''} /> Today</label>
          <label>Week
            <select data-k="weekLane">
              <option value="" ${!t.weekLane ? 'selected' : ''}>Not in the 7-day view</option>
              <option value="routine" ${t.weekLane === 'routine' ? 'selected' : ''}>Routine GP</option>
              <option value="extended" ${t.weekLane === 'extended' ? 'selected' : ''}>Extended access</option>
            </select>
          </label>
        </div>
        <div class="av-row"><label>Slot types <input type="text" data-k="match.types" value="${esc(m.types.join(', '))}" /></label></div>
        <div class="av-row"><label>Session names <input type="text" data-k="match.sessions" value="${esc(m.sessions.join(', '))}" /></label></div>
        <div class="av-row"><label>Clinician roles <input type="text" data-k="match.roles" value="${esc(m.roles.join(', '))}" /></label></div>
        <div class="av-row"><label>Exclude types <input type="text" data-k="exclude.types" value="${esc(x.types.join(', '))}" /></label></div>
        <div class="av-row"><label>Exclude sessions <input type="text" data-k="exclude.sessions" value="${esc(x.sessions.join(', '))}" /></label></div>
        <div class="av-row"><label>Exclude roles <input type="text" data-k="exclude.roles" value="${esc(x.roles.join(', '))}" /></label></div>
      </section>`;
    })
    .join('');
  editorBody.innerHTML = `
    <div class="av-row"><label>Refresh every
      <input type="number" id="avPoll" min="2" max="30" step="1" value="${esc(config.pollMinutes)}" /> minutes (2–30)
    </label></div>
    <p>Names seen on the last reading. Click one to add it to the selected tile.</p>
    ${chipList('Slot types', observed.slotTypes, 'match.types')}
    ${chipList('Sessions', observed.sessions, 'match.sessions')}
    ${chipList('Diaries', observed.clinicians, 'match.roles')}
    ${tiles}`;
}

function readEditor() {
  const pollEl = document.getElementById('avPoll');
  const tiles = [...editorBody.querySelectorAll('.av-tile-edit')].map((section, i) => {
    const val = (k) => section.querySelector(`[data-k="${k}"]`);
    const split = (k) =>
      String(val(k).value || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    const base = config.tiles[i] || blankTile();
    return {
      id: base.id,
      label: val('label').value,
      hidden: val('hidden').checked,
      showOnToday: val('showOnToday').checked,
      weekLane: val('weekLane').value || null,
      displayOrder: base.displayOrder,
      match: { types: split('match.types'), sessions: split('match.sessions'), roles: split('match.roles') },
      exclude: { types: split('exclude.types'), sessions: split('exclude.sessions'), roles: split('exclude.roles') },
    };
  });
  config = normaliseConfig({ pollMinutes: pollEl ? pollEl.value : config.pollMinutes, tiles });
}

function openEditor() {
  renderEditor();
  editor.hidden = false;
}

function closeEditor() {
  editor.hidden = true;
}

document.getElementById('avSetup').addEventListener('click', openEditor);
document.getElementById('avCloseEditor').addEventListener('click', closeEditor);
document.getElementById('avAddTile').addEventListener('click', () => {
  readEditor();
  config.tiles.push(blankTile());
  config = normaliseConfig(config);
  selectedTile = config.tiles.length - 1;
  renderEditor();
});
document.getElementById('avResetTiles').addEventListener('click', () => {
  config = normaliseConfig({ pollMinutes: config.pollMinutes, tiles: defaultTiles() });
  renderEditor();
});
document.getElementById('avSaveTiles').addEventListener('click', async () => {
  readEditor();
  await window.availabilityImport({ config });
  closeEditor();
  arm();
  render();
});
editorBody.addEventListener('click', (e) => {
  const sel = e.target.closest('[data-sel]');
  if (sel) selectedTile = Number(sel.dataset.sel);
  const add = e.target.closest('[data-add-value]');
  if (!add) return;
  const section = editorBody.querySelector(`.av-tile-edit[data-index="${selectedTile}"]`);
  const input = section && section.querySelector(`[data-k="${add.dataset.addField}"]`);
  if (!input) return;
  const cur = input.value.trim();
  input.value = cur ? `${cur}, ${add.dataset.addValue}` : add.dataset.addValue;
});
editorBody.addEventListener('change', (e) => {
  const sel = e.target.closest('[data-sel]');
  if (sel) selectedTile = Number(sel.dataset.sel);
});

readMotion();
if (window.matchMedia) {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (mq.addEventListener)
    mq.addEventListener('change', () => {
      readMotion();
      render();
    });
}

document.addEventListener('visibilitychange', onVisibility);

window.PracticePacks.read(window.PracticePacks.KEYS.availabilityWall).then(async () => {
  await loadConfig();
  if (!packOn()) {
    paintOff('The availability wall is switched off. Turn it on under Settings, Practice features.');
    return;
  }
  arm();
  refresh();
});

window.PracticePacks.watch(window.PracticePacks.KEYS.availabilityWall, async (on) => {
  if (!on) {
    if (pollTimer) clearInterval(pollTimer);
    if (tickTimer) clearInterval(tickTimer);
    paintOff('The availability wall is switched off. Turn it on under Settings, Practice features.');
    return;
  }
  await loadConfig();
  arm();
  refresh();
});
