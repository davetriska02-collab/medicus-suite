// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — "First available appointment" component.
//
// The front-desk question this answers: "when is the next <type> appointment?"
// — asked dozens of times a day on the phone, answered today by manually
// paging through the appointment book. Favourite types (FCP, GP urgent, bloods,
// …) get a one-click check; anything else is reachable through the full type
// selector. Mounted by BOTH the Slots module (its own section) and the
// Reception module (its own card); one instance per host, shared favourites.
//
// ── CONTRACT ─────────────────────────────────────────────────────────────────
//
//   createFirstAvailablePanel() → { attach, render, destroy }
//
//   attach(el) — (re)point the component at a mount element and render into
//                it. Hosts that rebuild their whole innerHTML on every render
//                (slots.js) call attach() after each rebuild; state lives in
//                the component, so results survive the host's re-renders.
//   destroy()  — unbind the storage listener, blank the mount. Idempotent.
//
// ── WHAT THIS COMPONENT IS NOT ───────────────────────────────────────────────
//
// A booking surface. It is READ-ONLY: no reserve, no create, no patient, no
// identity. Both existing booking flows (slots.js's panel, reception's
// createBookingPanel) stay the only places a slot can be taken, with their
// H-043/H-051 identity controls intact. Keeping this component write-free is
// what lets it render without a patient record and in the pop-out.
//
// Rate safety: every search goes through booking-core's findSlotsInWindow —
// caps (≤28 days, ≤4 concurrent, abort on 429/5xx) live THERE (plan D1.4).
// "Check all favourites" runs sequentially, one favourite at a time, and each
// search stops fetching further days as soon as a slot is found (limit: 1 —
// in-flight earlier days still land, so the earliest-slot answer stays right).
// Nothing here polls; every fetch is behind an explicit click.
//
// Storage: 'slots.firstAvailFavs' — [{ id, label }], shared by every mount
// (slots panel, pop-out, reception) via the storage listener, and included in
// suite backups through shared/io/slot-counter-io.js.

'use strict';

import { detectMedicusTab, fetchAppointmentFinder, findSlotsInWindow } from '../slots/booking-api.js';
import {
  MAX_FAVOURITES,
  sanitiseFirstAvailFavs,
  toggleFavourite,
  isFavourite,
  firstAvailableFrom,
  describeFirstAvailable,
} from './first-available-core.js';

const FAVS_KEY = 'slots.firstAvailFavs';
const WINDOW_DAYS = 28; // booking-core's MAX_WINDOW_DAYS — the widest the caps allow

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function hhmm(date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

// One <link> for the component's stylesheet per document, whichever host mounts
// first — module CSS is per-module (module-loader.js ensureModuleCss), so a
// component shared by two modules injects its own, id-guarded.
function ensureOwnCss() {
  const id = 'ms-first-available-css';
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = new URL('./first-available.css', import.meta.url).href;
  document.head.appendChild(link);
}

export function createFirstAvailablePanel() {
  // Pinned state instance for the life of the component (the `const st = s`
  // discipline) — async continuations always land in THIS object.
  const st = {
    destroyed: false,
    open: false,
    phase: 'idle', // idle | arming | ready | error — armed lazily on first open
    armError: null,
    apiBase: null,
    providerId: null,
    types: [], // [{ value, label }] from the appointment finder
    favs: [], // [{ id, label }] — mirrored from storage
    selectedTypeId: '',
    checkingAll: false,
    // typeId → { status: 'loading'|'done'|'error', found, desc, aborted,
    //            checkedAt, error } — results persist across host re-renders.
    results: new Map(),
  };

  let mountEl = null;

  // Cross-context favourites sync (panel ↔ pop-out ↔ reception).
  const onStorage = (changes, area) => {
    if (area !== 'local' || !changes[FAVS_KEY]) return;
    st.favs = sanitiseFirstAvailFavs(changes[FAVS_KEY].newValue);
    render();
  };
  chrome.storage.onChanged.addListener(onStorage);
  chrome.storage.local.get(FAVS_KEY).then((r) => {
    if (st.destroyed) return;
    st.favs = sanitiseFirstAvailFavs(r[FAVS_KEY]);
    render();
  });

  function saveFavs() {
    chrome.storage.local.set({ [FAVS_KEY]: st.favs }).catch((e) => {
      console.warn('[FirstAvail] Failed to save favourites', e);
    });
  }

  // ── Arming: find a signed-in Medicus tab, load the appointment types ───────
  async function arm() {
    const s = st; // pin
    if (s.phase === 'arming' || s.phase === 'ready') return;
    s.phase = 'arming';
    s.armError = null;
    render();
    try {
      const detected = await detectMedicusTab();
      if (s.destroyed) return;
      if (!detected || !detected.apiBase) {
        s.phase = 'error';
        s.armError = 'Could not find a signed-in Medicus tab. Open Medicus and try again.';
        return;
      }
      s.apiBase = detected.apiBase;
      const finder = await fetchAppointmentFinder(s.apiBase);
      if (s.destroyed) return;
      s.providerId = finder?.localOrganisationDetails?.id || null;
      const types = [];
      for (const svc of finder?.localOrganisationDetails?.services || []) {
        for (const t of svc.appointmentTypes || []) {
          if (!types.some((e) => e.value === t.value)) types.push({ value: t.value, label: t.label });
        }
      }
      s.types = types;
      s.phase = s.providerId ? 'ready' : 'error';
      if (!s.providerId) s.armError = 'Medicus did not return a booking provider for this practice.';
    } catch (err) {
      if (s.destroyed) return;
      s.phase = 'error';
      s.armError = err?.message || 'Could not load appointment types.';
    } finally {
      if (!s.destroyed) render();
    }
  }

  // ── Search: earliest slot of one type in the next 4 weeks ──────────────────
  async function checkType(typeId, label) {
    const s = st; // pin
    if (!typeId || s.phase !== 'ready') return;
    const existing = s.results.get(typeId);
    if (existing && existing.status === 'loading') return;
    s.results.set(typeId, { status: 'loading', label });
    render();
    try {
      // limit: 1 — stop fetching further days once a slot is collected. Days
      // already in flight (all earlier in the window, workers claim dates in
      // order) still complete and land in byDay, so the earliest answer holds.
      const res = await findSlotsInWindow(s.apiBase, {
        appointmentTypeId: typeId,
        providerId: s.providerId,
        fromDate: todayIso(),
        days: WINDOW_DAYS,
        skipWeekends: true,
        limit: 1,
      });
      if (s.destroyed) return;
      const found = firstAvailableFrom(res.byDay);
      s.results.set(typeId, {
        status: 'done',
        label,
        found,
        desc: describeFirstAvailable(found, todayIso()),
        aborted: !!res.aborted,
        checkedAt: new Date(),
      });
    } catch (err) {
      if (s.destroyed) return;
      s.results.set(typeId, {
        status: 'error',
        label,
        error: err?.message || 'Search failed.',
      });
    } finally {
      if (!s.destroyed) render();
    }
  }

  // Sequential on purpose — N favourites × 4 concurrent day-fetches each is
  // already the per-search cap; stacking favourites in parallel on top would
  // multiply it against the practice scheduler.
  async function checkAllFavs() {
    const s = st; // pin
    if (s.checkingAll || s.phase !== 'ready') return;
    s.checkingAll = true;
    render();
    try {
      for (const fav of s.favs.slice()) {
        if (s.destroyed) return;
        await checkType(fav.id, fav.label);
      }
    } finally {
      if (!s.destroyed) {
        s.checkingAll = false;
        render();
      }
    }
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  function renderResult(typeId) {
    const r = st.results.get(typeId);
    if (!r) return '<span class="fa-res fa-res-idle">not checked yet</span>';
    if (r.status === 'loading') return '<span class="fa-res fa-res-loading">searching&hellip;</span>';
    if (r.status === 'error') return `<span class="fa-res fa-res-error">${esc(r.error)}</span>`;
    const asAt = r.checkedAt ? ` <span class="fa-asat">as at ${esc(hhmm(r.checkedAt))}</span>` : '';
    if (!r.found) {
      // "None in the window" and "the search was cut short" must never blur —
      // the desk would tell a patient there is nothing for a month when the
      // scheduler was simply busy.
      const none = r.aborted
        ? 'search stopped early — scheduler busy, try again'
        : `none in the next ${WINDOW_DAYS / 7} weeks`;
      return `<span class="fa-res fa-res-none">${none}</span>${asAt}`;
    }
    const d = r.desc || {};
    const soon = d.relative === 'today' || d.relative === 'tomorrow';
    const more = r.found.dayCount > 1 ? ` <span class="fa-daycount">(${r.found.dayCount} that day)</span>` : '';
    const cut = r.aborted ? ' <span class="fa-res-note">— earlier days only, search stopped early</span>' : '';
    return `<span class="fa-res fa-res-found${soon ? ' fa-res-soon' : ''}">${esc(d.whenText || '')}</span>${more}${cut}${asAt}`;
  }

  function renderFavRows() {
    if (st.favs.length === 0) {
      return '<div class="fa-empty">No favourites yet — pick a type below and star it.</div>';
    }
    const rows = st.favs
      .map(
        (f) => `
      <div class="fa-fav-row" data-fa-type="${esc(f.id)}">
        <button type="button" class="fa-check-btn" data-fa-check="${esc(f.id)}" title="Check first available ${esc(f.label)}"${st.phase === 'ready' ? '' : ' disabled'}>${esc(f.label)}</button>
        <span class="fa-fav-result">${renderResult(f.id)}</span>
        <button type="button" class="fa-unstar-btn" data-fa-unstar="${esc(f.id)}" title="Remove ${esc(f.label)} from favourites" aria-label="Remove ${esc(f.label)} from favourites">★</button>
      </div>`
      )
      .join('');
    const anyLoading = [...st.results.values()].some((r) => r.status === 'loading');
    return `
      <div class="fa-fav-list">${rows}</div>
      <div class="fa-actions">
        <button type="button" class="fa-checkall-btn" id="faCheckAll"${st.phase === 'ready' && !st.checkingAll && !anyLoading ? '' : ' disabled'}>${st.checkingAll ? 'Checking&hellip;' : 'Check all favourites'}</button>
      </div>`;
  }

  function renderPicker() {
    const opts = st.types
      .map(
        (t) =>
          `<option value="${esc(t.value)}"${st.selectedTypeId === t.value ? ' selected' : ''}>${esc(t.label)}</option>`
      )
      .join('');
    const sel = st.selectedTypeId;
    const selLabel = (st.types.find((t) => t.value === sel) || {}).label || '';
    const starred = sel && isFavourite(st.favs, sel);
    const favFull = !starred && st.favs.length >= MAX_FAVOURITES;
    return `
      <div class="fa-picker">
        <select class="fa-select" id="faTypeSelect"${st.types.length === 0 ? ' disabled' : ''}>
          <option value="">Any other type&hellip;</option>
          ${opts}
        </select>
        <button type="button" class="fa-find-btn" id="faFind"${sel && st.phase === 'ready' ? '' : ' disabled'}>Find first</button>
        <button type="button" class="fa-star-btn${starred ? ' fa-starred' : ''}" id="faStar"${sel && !favFull ? '' : ' disabled'}
          title="${starred ? `Remove ${esc(selLabel)} from favourites` : favFull ? `Favourites are full (max ${MAX_FAVOURITES})` : `Add ${esc(selLabel)} to favourites`}"
          aria-pressed="${!!starred}">${starred ? '★' : '☆'}</button>
      </div>
      ${sel && !isFavourite(st.favs, sel) ? `<div class="fa-picker-result">${renderResult(sel)}</div>` : ''}`;
  }

  function renderBody() {
    if (st.phase === 'idle' || st.phase === 'arming') {
      return '<div class="fa-loading">Loading appointment types&hellip;</div>';
    }
    if (st.phase === 'error') {
      return `
        <div class="fa-error">${esc(st.armError || 'Unavailable.')}</div>
        <div class="fa-actions"><button type="button" class="fa-checkall-btn" id="faRetryArm">Try again</button></div>`;
    }
    return `
      ${renderFavRows()}
      ${renderPicker()}
      <div class="fa-fineprint">Searches the next ${WINDOW_DAYS / 7} weeks, weekdays only. A result is a snapshot — the slot can be taken at any moment, so book it through the usual booking panel.</div>`;
  }

  function render() {
    if (!mountEl || st.destroyed) return;
    mountEl.innerHTML = `
      <button type="button" class="fa-toggle-row" id="faToggle" aria-expanded="${st.open}">
        <span class="fa-toggle-chevron" aria-hidden="true">${st.open ? '▾' : '▸'}</span>
        <span class="fa-toggle-text">First available appointment</span>
        ${!st.open && st.favs.length > 0 ? `<span class="fa-toggle-badge">${st.favs.length} fav${st.favs.length !== 1 ? 's' : ''}</span>` : ''}
      </button>
      ${st.open ? `<div class="fa-body">${renderBody()}</div>` : ''}`;
    bind();
  }

  function bind() {
    if (!mountEl) return;
    mountEl.querySelector('#faToggle')?.addEventListener('click', () => {
      st.open = !st.open;
      // Lazy arm: no fetches until someone actually opens the section.
      if (st.open && st.phase === 'idle') arm();
      else render();
    });
    mountEl.querySelector('#faRetryArm')?.addEventListener('click', () => {
      st.phase = 'idle';
      arm();
    });
    mountEl.querySelector('#faTypeSelect')?.addEventListener('change', (e) => {
      st.selectedTypeId = e.target.value;
      render();
    });
    mountEl.querySelector('#faFind')?.addEventListener('click', () => {
      const label = (st.types.find((t) => t.value === st.selectedTypeId) || {}).label || '';
      checkType(st.selectedTypeId, label);
    });
    mountEl.querySelector('#faStar')?.addEventListener('click', () => {
      const label = (st.types.find((t) => t.value === st.selectedTypeId) || {}).label || '';
      if (!st.selectedTypeId || !label) return;
      st.favs = toggleFavourite(st.favs, { id: st.selectedTypeId, label });
      saveFavs(); // storage echo re-renders other mounts; render now for this one
      render();
    });
    mountEl.querySelector('#faCheckAll')?.addEventListener('click', () => checkAllFavs());
    mountEl.querySelectorAll('[data-fa-check]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const id = btn.dataset.faCheck;
        const fav = st.favs.find((f) => f.id === id);
        if (fav) checkType(fav.id, fav.label);
      })
    );
    mountEl.querySelectorAll('[data-fa-unstar]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const id = btn.dataset.faUnstar;
        st.favs = st.favs.filter((f) => f.id !== id);
        saveFavs();
        render();
      })
    );
  }

  function attach(el) {
    if (st.destroyed || !el) return;
    ensureOwnCss();
    mountEl = el;
    render();
  }

  function destroy() {
    if (st.destroyed) return;
    st.destroyed = true;
    chrome.storage.onChanged.removeListener(onStorage);
    if (mountEl) mountEl.innerHTML = '';
    mountEl = null;
  }

  return { attach, render, destroy };
}

export default createFirstAvailablePanel;
