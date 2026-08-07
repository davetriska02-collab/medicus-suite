// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — "First available appointment" component.
//
// The front-desk question this answers: "when is the next <type> appointment?"
// — asked dozens of times a day on the phone, answered today by manually
// paging through the appointment book. Favourite types (FCP, GP urgent, bloods,
// …) are one card each in a grid; anything else is reachable by TYPING into
// the filter box ("acute" → every type containing acute). Mounted by BOTH the
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

import { detectMedicusTab, fetchAppointmentFinder, findSlotsInWindow } from '../slots/booking-api.js';
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

// Feather-style stroke SVGs at 14px currentColor — same markup idiom as
// slots.js's SVG_ALERT_TRIANGLE (design-crit Decision E/H).
const SVG_ALERT_TRIANGLE = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;

const SVG_STAR = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;

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
    // typeIds currently mid-handoff — double-fire guard for the Book button
    // (design-crit Decision A): set on click, cleared once the handoff (event
    // dispatch, or the storage write + tab jump) has resolved.
    bookingIds: new Set(),
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
  // flow itself, unchanged. Guarded against double-fire via bookingIds — the
  // pressed footer button is disabled until the handoff resolves either way.
  function bookHandoff(typeId, typeLabel, date) {
    if (!typeId || st.bookingIds.has(typeId)) return;
    st.bookingIds.add(typeId);
    render();
    const finish = () => {
      st.bookingIds.delete(typeId);
      if (!st.destroyed) render();
    };
    const detail = { typeId, typeLabel: typeLabel || '', date: date || todayIso() };
    const ev = new CustomEvent('suite:first-avail:book', { detail, cancelable: true, bubbles: false });
    const unclaimed = document.dispatchEvent(ev); // false when a handler preventDefault()ed
    if (!unclaimed) {
      finish();
      return;
    }
    chrome.storage.local
      .set({ [PENDING_BOOKING_KEY]: { ...detail, savedAt: Date.now() } })
      .catch(() => {})
      .finally(() => {
        document.querySelector('.nav-tab[data-module="slots"]')?.click();
        finish();
      });
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  // Latest checkedAt across every completed result — the ONE freshness stamp
  // shown in the section header (design-crit Decision D). Per-tile "as at"
  // was deleted; this is the single source of truth for it now.
  function latestCheckedAt() {
    let latest = null;
    for (const r of st.results.values()) {
      if (r.status === 'done' && r.checkedAt && (!latest || r.checkedAt > latest)) latest = r.checkedAt;
    }
    return latest;
  }

  // Status text + bookable date for one typeId. Voice/palette (Decision B/C):
  // idle/loading/none are sans, a found time is mono 13px ink (never green),
  // "none" carries no hue, and the ONLY amber in this component's inline text
  // is "the tool could not complete" (an aborted search or a fetch error) —
  // red is used for nothing here.
  function resultParts(typeId) {
    const r = st.results.get(typeId);
    if (!r) return { statusHtml: '<span class="fa-res fa-res-idle">Not checked yet</span>', bookable: null };
    if (r.status === 'loading')
      return { statusHtml: '<span class="fa-res fa-res-loading">Checking&hellip;</span>', bookable: null };
    if (r.status === 'error')
      return { statusHtml: `<span class="fa-res fa-res-error">${esc(r.error)}</span>`, bookable: null };
    if (!r.found) {
      // "None in the window" and "the search was cut short" must never blur —
      // the desk would tell a patient there is nothing for a month when the
      // scheduler was simply busy. The caveat is amber; a genuine "none" is not.
      const none = r.aborted
        ? '<span class="fa-res fa-res-caveat">search stopped early &mdash; scheduler busy, try again</span>'
        : `<span class="fa-res fa-res-none">None in ${WINDOW_DAYS / 7} weeks</span>`;
      return { statusHtml: none, bookable: null };
    }
    const d = r.desc || {};
    const dayCount = r.found.dayCount || 1;
    const more = dayCount > 1 ? ` <span class="fa-daycount">+${dayCount - 1} later that day</span>` : '';
    const cut = r.aborted ? ' <span class="fa-res-caveat">&mdash; earlier days only, search stopped early</span>' : '';
    return {
      statusHtml: `<span class="fa-res fa-res-found">${esc(d.whenText || '')}</span>${more}${cut}`,
      bookable: { date: r.found.date },
    };
  }

  // The footer is ALWAYS rendered (Decision A) so every card in the grid is
  // the same height — its content and click behaviour are the only things
  // that change with state.
  function renderFooter(id, label) {
    const r = st.results.get(id);
    if (!r) {
      return `<button type="button" class="fa-foot" data-fa-check="${esc(id)}"${st.phase === 'ready' ? '' : ' disabled'}>Check</button>`;
    }
    if (r.status === 'loading') {
      return `<button type="button" class="fa-foot" disabled>Checking&hellip;</button>`;
    }
    if (r.status === 'error') {
      return `<button type="button" class="fa-foot" data-fa-check="${esc(id)}">Retry</button>`;
    }
    if (r.found) {
      const busy = st.bookingIds.has(id);
      return `<button type="button" class="fa-foot fa-foot-book" data-fa-book="${esc(id)}" data-fa-book-date="${esc(r.found.date)}" aria-label="Book ${esc(label)}"${busy ? ' disabled' : ''}>Book</button>`;
    }
    return `<button type="button" class="fa-foot fa-foot-none" disabled><span aria-hidden="true">&mdash;</span></button>`;
  }

  function renderFavCard(f) {
    const r = st.results.get(f.id);
    const busy = r && r.status === 'loading';
    const { statusHtml } = resultParts(f.id);
    return `
      <div class="fa-card"${busy ? ' aria-busy="true"' : ''}>
        <button type="button" class="fa-tile" data-fa-check="${esc(f.id)}"
          title="Check first available ${esc(f.label)}"${st.phase === 'ready' ? '' : ' disabled'}>
          <span class="fa-tile-name">${esc(f.label)}</span>
          <span class="fa-tile-status">${statusHtml}</span>
        </button>
        <button type="button" class="fa-tile-unstar" data-fa-unstar="${esc(f.id)}"
          title="Remove ${esc(f.label)} from favourites" aria-label="Remove ${esc(f.label)} from favourites">&#10005;</button>
        ${renderFooter(f.id, f.label)}
      </div>`;
  }

  // Favourites as a grid of one-card-per-favourite: the tile top region
  // (re)checks, the always-present footer either checks, shows progress, or
  // (once a slot is found) starts the booking handoff.
  function renderFavTiles() {
    if (st.favs.length === 0) {
      return `<div class="fa-empty">${SVG_STAR}<span>No favourites yet. Find a type below and save it.</span></div>`;
    }
    const cards = st.favs.map((f) => renderFavCard(f)).join('');
    const anyLoading = [...st.results.values()].some((r) => r.status === 'loading');
    return `
      <div class="fa-tile-grid">${cards}</div>
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
    const bookingBusy = sel && st.bookingIds.has(sel);
    return `
      <div class="fa-picker-label" id="faPickerLabel">Find any other type</div>
      <div class="fa-picker">
        <input type="text" class="fa-filter-input" id="faTypeFilter" value="${esc(st.typeFilter)}"
          placeholder="Type to filter &mdash; e.g. acute" autocomplete="off" aria-labelledby="faPickerLabel" />
        <select class="fa-select" id="faTypeSelect" aria-label="Appointment type"${st.types.length === 0 ? ' disabled' : ''}>
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
                     aria-label="Book ${esc(selLabel)}" title="Open booking with ${esc(selLabel)} pre-selected"${bookingBusy ? ' disabled' : ''}>Book</button>`
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
        <div class="fa-error-banner" role="alert">
          <span class="fa-error-icon" aria-hidden="true">${SVG_ALERT_TRIANGLE}</span>
          <span class="fa-error-msg">${esc(st.armError || 'Unavailable.')}</span>
          <button type="button" class="fa-retry-btn" id="faRetryArm">Try again</button>
        </div>`;
    }
    return `
      <div class="fa-live" aria-live="polite">
        ${renderFavTiles()}
        <div class="fa-snapshot-note">Snapshot &mdash; a slot can be taken at any moment.</div>
        ${renderPicker()}
      </div>
      <div class="fa-fineprint">Searches the next ${WINDOW_DAYS / 7} weeks, weekdays only. Book opens the booking panel with the type and day filled in &mdash; the patient is checked there.</div>`;
  }

  function render() {
    if (!mountEl || st.destroyed) return;
    const latest = latestCheckedAt();
    const asAt = st.open && latest ? `<span class="fa-toggle-asat">as at ${esc(hhmm(latest))}</span>` : '';
    mountEl.innerHTML = `
      <div class="fa-shell">
        <button type="button" class="fa-toggle-row" id="faToggle" aria-expanded="${st.open}">
          <span class="fa-toggle-chevron" aria-hidden="true">${st.open ? '▾' : '▸'}</span>
          <span class="fa-toggle-text">First available appointment</span>
          ${!st.open && st.favs.length > 0 ? `<span class="fa-toggle-badge">${st.favs.length} saved</span>` : ''}
          ${asAt}
        </button>
        ${st.open ? `<div class="fa-body">${renderBody()}</div>` : ''}
      </div>`;
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
