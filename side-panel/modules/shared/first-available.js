// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — "First available appointment" component.
//
// The front-desk question this answers: "when is the next <type> appointment?"
// — asked dozens of times a day on the phone, answered today by manually
// paging through the appointment book. Favourite types (FCP, GP urgent, bloods,
// …) are big one-click tiles; anything else is reachable by TYPING into the
// filter box ("acute" → every type containing acute). Mounted by BOTH the
// Slots module (its own section) and the Reception module (its own card); one
// instance per host, shared favourites.
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
// A booking surface. It NEVER reserves or creates an appointment itself: the
// "Book" button on a result is a HANDOFF — it dispatches the cancelable
// 'suite:first-avail:book' DOM event carrying { typeId, typeLabel, date }.
// The Slots module handles it by opening its own booking section pre-filled
// (patient detection, commit-time re-verification and every other H-043
// control unchanged). If no handler claims the event (reception / pop-out
// host), the component stores a one-shot 'slots.pendingBooking' and clicks
// the Slots nav tab, where slots.js init() picks it up — same jump idiom as
// reception's leaflet handoff (leaflets.pendingQuery). Keeping the write out
// of this component is what lets it render without a patient record.
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
// suite backups through shared/io/slot-counter-io.js. 'slots.pendingBooking'
// is transient handoff state — deliberately NOT backed up (allowlisted in
// test-backup-coverage.js).

'use strict';

import { fetchAppointmentFinder, findSlotsInWindow } from '../../../shared/booking-core.js';
import { detectMedicusTab } from '../../../shared/booking-identity.js';
import { filterAppointmentTypes } from './booking-panel-core.js';
import {
  MAX_FAVOURITES,
  sanitiseFirstAvailFavs,
  toggleFavourite,
  isFavourite,
  firstAvailableFrom,
  describeFirstAvailable,
} from './first-available-core.js';

const FAVS_KEY = 'slots.firstAvailFavs';
const PENDING_BOOKING_KEY = 'slots.pendingBooking';
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
    typeFilter: '', // the typable filter over the type list
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

  // ── Book handoff ───────────────────────────────────────────────────────────
  // NEVER books here. Dispatches the cancelable handoff event; a mounted Slots
  // module claims it (preventDefault) and opens its booking section pre-filled
  // with this type + day. Unclaimed (reception host, or slots not mounted):
  // store a one-shot pending-booking note and jump to the Slots tab, whose
  // init() consumes it. All patient/identity controls live in the booking
  // flow itself, unchanged.
  function bookHandoff(typeId, typeLabel, date) {
    if (!typeId) return;
    const detail = { typeId, typeLabel: typeLabel || '', date: date || todayIso() };
    const ev = new CustomEvent('suite:first-avail:book', { detail, cancelable: true, bubbles: false });
    const unclaimed = document.dispatchEvent(ev); // false when a handler preventDefault()ed
    if (!unclaimed) return;
    chrome.storage.local
      .set({ [PENDING_BOOKING_KEY]: { ...detail, savedAt: Date.now() } })
      .catch(() => {})
      .finally(() => {
        document.querySelector('.nav-tab[data-module="slots"]')?.click();
      });
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  function resultParts(typeId) {
    const r = st.results.get(typeId);
    if (!r) return { statusHtml: '<span class="fa-res fa-res-idle">tap to check</span>', bookable: null };
    if (r.status === 'loading')
      return { statusHtml: '<span class="fa-res fa-res-loading">searching&hellip;</span>', bookable: null };
    if (r.status === 'error')
      return { statusHtml: `<span class="fa-res fa-res-error">${esc(r.error)}</span>`, bookable: null };
    const asAt = r.checkedAt ? ` <span class="fa-asat">as at ${esc(hhmm(r.checkedAt))}</span>` : '';
    if (!r.found) {
      // "None in the window" and "the search was cut short" must never blur —
      // the desk would tell a patient there is nothing for a month when the
      // scheduler was simply busy.
      const none = r.aborted
        ? 'search stopped early — scheduler busy, try again'
        : `none in the next ${WINDOW_DAYS / 7} weeks`;
      return { statusHtml: `<span class="fa-res fa-res-none">${none}</span>${asAt}`, bookable: null };
    }
    const d = r.desc || {};
    const soon = d.relative === 'today' || d.relative === 'tomorrow';
    const more = r.found.dayCount > 1 ? ` <span class="fa-daycount">(${r.found.dayCount} that day)</span>` : '';
    const cut = r.aborted ? ' <span class="fa-res-note">— earlier days only, search stopped early</span>' : '';
    return {
      statusHtml: `<span class="fa-res fa-res-found${soon ? ' fa-res-soon' : ''}">${esc(d.whenText || '')}</span>${more}${cut}${asAt}`,
      bookable: { date: r.found.date },
    };
  }

  // Favourites as a grid of big tap targets: the tile checks, the accent Book
  // button under a found result starts the real booking flow.
  function renderFavTiles() {
    if (st.favs.length === 0) {
      return '<div class="fa-empty">No favourites yet — find a type below and star it.</div>';
    }
    const tiles = st.favs
      .map((f) => {
        const { statusHtml, bookable } = resultParts(f.id);
        return `
      <div class="fa-tile-wrap">
        <button type="button" class="fa-tile" data-fa-check="${esc(f.id)}"
          title="Check first available ${esc(f.label)}"${st.phase === 'ready' ? '' : ' disabled'}>
          <span class="fa-tile-name">${esc(f.label)}</span>
          <span class="fa-tile-status">${statusHtml}</span>
        </button>
        <button type="button" class="fa-tile-unstar" data-fa-unstar="${esc(f.id)}"
          title="Remove ${esc(f.label)} from favourites" aria-label="Remove ${esc(f.label)} from favourites">&#10005;</button>
        ${
          bookable
            ? `<button type="button" class="fa-book-btn" data-fa-book="${esc(f.id)}" data-fa-book-date="${esc(bookable.date)}"
                 title="Open booking with ${esc(f.label)} pre-selected">Book &rarr;</button>`
            : ''
        }
      </div>`;
      })
      .join('');
    const anyLoading = [...st.results.values()].some((r) => r.status === 'loading');
    return `
      <div class="fa-tile-grid">${tiles}</div>
      <div class="fa-actions">
        <button type="button" class="fa-checkall-btn" id="faCheckAll"${st.phase === 'ready' && !st.checkingAll && !anyLoading ? '' : ' disabled'}>${st.checkingAll ? 'Checking&hellip;' : 'Check all favourites'}</button>
      </div>`;
  }

  // The select's options for the current filter. The selected type is always
  // kept in the list (even when it no longer matches the filter) so the select
  // can never silently show a blank while state still holds a selection.
  function typeOptionsHtml() {
    const filtered = filterAppointmentTypes(st.types, st.typeFilter);
    const list = filtered.slice();
    if (st.selectedTypeId && !list.some((t) => t.value === st.selectedTypeId)) {
      const sel = st.types.find((t) => t.value === st.selectedTypeId);
      if (sel) list.unshift(sel);
    }
    const opts = list
      .map(
        (t) =>
          `<option value="${esc(t.value)}"${st.selectedTypeId === t.value ? ' selected' : ''}>${esc(t.label)}</option>`
      )
      .join('');
    const head =
      filtered.length === 0
        ? `<option value="" disabled>No types match &ldquo;${esc(st.typeFilter)}&rdquo;</option>`
        : `<option value="">${st.typeFilter ? `${filtered.length} match${filtered.length === 1 ? '' : 'es'}&hellip;` : 'Choose a type&hellip;'}</option>`;
    return head + opts;
  }

  function renderPicker() {
    const sel = st.selectedTypeId;
    const selLabel = (st.types.find((t) => t.value === sel) || {}).label || '';
    const starred = sel && isFavourite(st.favs, sel);
    const favFull = !starred && st.favs.length >= MAX_FAVOURITES;
    const { statusHtml, bookable } =
      sel && !isFavourite(st.favs, sel) ? resultParts(sel) : { statusHtml: '', bookable: null };
    return `
      <div class="fa-picker-label" id="faPickerLabel">Find any other type</div>
      <div class="fa-picker">
        <input type="text" class="fa-filter-input" id="faTypeFilter" value="${esc(st.typeFilter)}"
          placeholder="Type to filter &mdash; e.g. acute" autocomplete="off" aria-labelledby="faPickerLabel" />
        <select class="fa-select" id="faTypeSelect"${st.types.length === 0 ? ' disabled' : ''}>
          ${typeOptionsHtml()}
        </select>
      </div>
      <div class="fa-picker-actions">
        <button type="button" class="fa-find-btn" id="faFind"${sel && st.phase === 'ready' ? '' : ' disabled'}>Find first available</button>
        <button type="button" class="fa-star-btn${starred ? ' fa-starred' : ''}" id="faStar"${sel && !favFull ? '' : ' disabled'}
          title="${starred ? `Remove ${esc(selLabel)} from favourites` : favFull ? `Favourites are full (max ${MAX_FAVOURITES})` : `Add ${esc(selLabel)} to favourites`}"
          aria-pressed="${!!starred}">${starred ? '★ Favourited' : '☆ Favourite'}</button>
      </div>
      ${
        statusHtml
          ? `<div class="fa-picker-result">${statusHtml}${
              bookable
                ? ` <button type="button" class="fa-book-btn fa-book-inline" data-fa-book="${esc(sel)}" data-fa-book-date="${esc(bookable.date)}"
                     title="Open booking with ${esc(selLabel)} pre-selected">Book &rarr;</button>`
                : ''
            }</div>`
          : ''
      }`;
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
      ${renderFavTiles()}
      ${renderPicker()}
      <div class="fa-fineprint">Searches the next ${WINDOW_DAYS / 7} weeks, weekdays only. A result is a snapshot &mdash; the slot can be taken at any moment. &ldquo;Book&rdquo; opens the booking panel with the type and day filled in; the patient is checked there.</div>`;
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

  // In-place filter application: rebuilding only the <select> options on each
  // keystroke keeps focus (and the caret) in the filter input — a full
  // innerHTML render would recreate and blur it mid-word. A single remaining
  // match is auto-selected so "acute → Find first available" is two actions,
  // not three; that state change re-renders fully with focus restored.
  function applyFilterInPlace() {
    if (!mountEl) return;
    const selectEl = mountEl.querySelector('#faTypeSelect');
    if (!selectEl) return;
    const filtered = filterAppointmentTypes(st.types, st.typeFilter);
    if (filtered.length === 1 && filtered[0].value !== st.selectedTypeId) {
      st.selectedTypeId = filtered[0].value;
      render();
      const input = mountEl.querySelector('#faTypeFilter');
      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
      return;
    }
    selectEl.innerHTML = typeOptionsHtml();
    const findBtn = mountEl.querySelector('#faFind');
    if (findBtn) findBtn.disabled = !(st.selectedTypeId && st.phase === 'ready');
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
    mountEl.querySelector('#faTypeFilter')?.addEventListener('input', (e) => {
      st.typeFilter = e.target.value;
      applyFilterInPlace();
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
    mountEl.querySelectorAll('[data-fa-book]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const id = btn.dataset.faBook;
        const label =
          (st.favs.find((f) => f.id === id) || {}).label || (st.types.find((t) => t.value === id) || {}).label || '';
        bookHandoff(id, label, btn.dataset.faBookDate);
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
