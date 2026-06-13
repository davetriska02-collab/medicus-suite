// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — guided tour engine (spotlight step-through, suite-wide)
//
// Steps are pure data in tour-steps.js; this file is the runtime only.
//   - Dims the page and cuts a spotlight over each step's target element.
//   - Steps may name a `module`: the engine activates that tab (via the
//     activateModule hook passed to initTour) before resolving the target, so
//     the walkthrough can move through the suite.
//   - Steps whose target isn't present/visible are skipped, unless they set
//     `centerFallback: true` (shown as a centred card instead) — used for
//     anchors that only exist conditionally (alert strips, patient data).
//   - Records completion in localStorage (shared across extension pages, so
//     Options can reset it) keyed by TOUR_VERSION. Bumping the version gives
//     returning users a "What's new" pass of only the steps added since the
//     version they last completed.

'use strict';

import { TOUR_VERSION, TOUR_STEPS } from './tour-steps.js';

export const TOUR_SEEN_KEY = 'suite.tour.seenVersion';

let _activateModule = null; // async (name) => void — provided by the shell
let _getActiveModule = null; // () => string|null

let _prevFocus = null; // focus-trap: element focused before the tour started

let _layer = null;
let _steps = [];
let _idx = 0;
let _dir = 1; // navigation direction: 1 forward, -1 back (for skip-resolution)
let _mode = 'full'; // 'full' | 'whats-new'
let _navSeq = 0; // stale-async guard for rapid next/back clicks
let _keyHandler = null;
let _resizeHandler = null;

// Called once by the shell (panel.js / pop-out.js) so module-scoped steps can
// switch tabs. The tour still works without it — those steps just skip unless
// their module already happens to be active.
export function initTour({ activateModule, getActiveModule } = {}) {
  _activateModule = activateModule || null;
  _getActiveModule = getActiveModule || null;
}

function seenVersion() {
  try {
    const v = parseInt(localStorage.getItem(TOUR_SEEN_KEY), 10);
    return Number.isFinite(v) ? v : null;
  } catch (_) {
    return null;
  }
}

function markSeen() {
  try {
    localStorage.setItem(TOUR_SEEN_KEY, String(TOUR_VERSION));
  } catch (_) {
    /* storage unavailable — tour will re-offer next time, acceptable */
  }
}

// First-run: full walkthrough. Version moved on: "What's new" pass of new
// steps only. Already seen current version: nothing.
export function maybeAutoStartTour() {
  const seen = seenVersion();
  if (seen === null) {
    runTour(TOUR_STEPS, 'full');
    return;
  }
  if (seen < TOUR_VERSION) {
    const fresh = TOUR_STEPS.filter((s) => (s.addedIn ?? 1) > seen);
    if (fresh.length) runTour(fresh, 'whats-new');
  }
}

// Manual replay (Monitoring ⋯ menu / Options). Always the full walkthrough.
export function startTour() {
  runTour(TOUR_STEPS, 'full');
}

export function stopTour() {
  const had = !!_layer;
  _navSeq++;
  if (_keyHandler) {
    document.removeEventListener('keydown', _keyHandler, true);
    _keyHandler = null;
  }
  if (_resizeHandler) {
    window.removeEventListener('resize', _resizeHandler);
    _resizeHandler = null;
  }
  _layer?.remove();
  _layer = null;
  _steps = [];
  _idx = 0;
  // Restore focus to the element that was active before the tour started
  _prevFocus?.focus?.();
  _prevFocus = null;
  if (had) document.dispatchEvent(new CustomEvent('suite:tour-ended'));
}

// Resolve a step's target right now: first selector whose element exists and
// is visible. Does NOT activate modules — see ensureStepContext.
function resolveTarget(step) {
  if (!step.target) return null;
  for (const sel of [].concat(step.target)) {
    const el = document.querySelector(sel);
    if (el && (el.offsetParent !== null || el === document.body)) return el;
  }
  return null;
}

// Activate the step's module if needed, then wait briefly for its target to
// appear (module init may render asynchronously). Returns the element or null.
async function ensureStepContext(step) {
  let switched = false;
  if (step.module && _activateModule && _getActiveModule?.() !== step.module) {
    switched = true;
    try {
      await _activateModule(step.module);
    } catch (_) {
      /* module failed to load — fall through to target resolution/skip */
    }
  }
  if (!step.target) return null;
  // Only wait the long render-grace when we actually switched tabs (the module
  // is freshly mounting). For a step on the ALREADY-active module the target
  // either exists now or never will — e.g. the patient-data Sentinel steps with
  // no record open — so a short grace is enough. Without this, a run of absent
  // steps each stalled the full 2.5s, making "Next" look completely dead.
  const deadline = Date.now() + (switched ? 2500 : step.module ? 400 : 0);
  for (;;) {
    const el = resolveTarget(step);
    if (el || Date.now() >= deadline) return el;
    await new Promise((r) => setTimeout(r, 100));
  }
}

function runTour(steps, mode) {
  stopTour();
  // Keep steps that can plausibly show: centred cards always can; module steps
  // get their chance after activation; everything else needs a target now.
  _steps = steps.filter((s) => s.center || s.centerFallback || s.module || resolveTarget(s));
  if (_steps.length === 0) return;
  _mode = mode;
  _idx = 0;
  _dir = 1;

  _layer = document.createElement('div');
  _layer.className = 'suite-tour-layer';
  _layer.setAttribute('role', 'dialog');
  _layer.setAttribute('aria-modal', 'true');
  _layer.setAttribute('aria-label', 'Guided tour');
  _layer.innerHTML = `
    <div class="suite-tour-spot" aria-hidden="true"></div>
    <div class="suite-tour-card" aria-live="polite">
      <div class="suite-tour-tag"></div>
      <div class="suite-tour-title"></div>
      <div class="suite-tour-body"></div>
      <div class="suite-tour-track"><div class="suite-tour-track-fill"></div></div>
      <div class="suite-tour-foot">
        <button class="suite-tour-skip" data-tour-act="skip">Skip tour</button>
        <span class="suite-tour-progress"></span>
        <div class="suite-tour-btns">
          <button class="suite-tour-btn" data-tour-act="back">Back</button>
          <button class="suite-tour-btn suite-tour-next" data-tour-act="next">Next</button>
        </div>
      </div>
    </div>`;
  // Capture focus before appending so we can restore it when the tour ends
  _prevFocus = document.activeElement;
  document.body.appendChild(_layer);
  // Notify setup checklist (and any other listener) that the tour is up
  document.dispatchEvent(new CustomEvent('suite:tour-started'));

  _layer.addEventListener('click', (e) => {
    const act = e.target.closest('[data-tour-act]')?.dataset.tourAct;
    if (act === 'next') next();
    else if (act === 'back') back();
    else if (act === 'skip') finish();
  });

  _keyHandler = (e) => {
    if (!_layer) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      finish();
    } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
      e.stopPropagation();
      next();
    } else if (e.key === 'ArrowLeft') {
      e.stopPropagation();
      back();
    } else if (e.key === 'Tab') {
      // Focus trap: wrap within the tour dialog buttons
      const focusable = [..._layer.querySelectorAll('button:not(:disabled)')];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  document.addEventListener('keydown', _keyHandler, true);

  _resizeHandler = () => positionFor(_steps[_idx], resolveTarget(_steps[_idx] || {}));
  window.addEventListener('resize', _resizeHandler);

  showStep();
  // Move focus into the dialog after the first step is rendered
  requestAnimationFrame(() => _layer?.querySelector('.suite-tour-next')?.focus());
}

function next() {
  if (_idx >= _steps.length - 1) {
    finish();
    return;
  }
  _dir = 1;
  _idx++;
  showStep();
}

function back() {
  if (_idx === 0) return;
  _dir = -1;
  _idx--;
  showStep();
}

function finish() {
  markSeen();
  stopTour();
}

async function showStep() {
  if (!_layer) return;
  const seq = ++_navSeq;
  const step = _steps[_idx];

  const target = step.center ? null : await ensureStepContext(step);
  if (seq !== _navSeq || !_layer) return; // superseded by another navigation

  // Unresolvable and no fallback → skip in the direction of travel.
  if (!step.center && !target && !step.centerFallback) {
    if (_dir === -1 && _idx > 0) {
      _idx--;
      showStep();
    } else if (_dir !== -1 && _idx < _steps.length - 1) {
      _idx++;
      showStep();
    } else {
      finish();
    }
    return;
  }

  _layer.querySelector('.suite-tour-tag').textContent = _mode === 'whats-new' ? 'What’s new' : 'Guided tour';
  _layer.querySelector('.suite-tour-title').textContent = step.title;
  _layer.querySelector('.suite-tour-body').textContent = step.body;
  _layer.querySelector('.suite-tour-progress').textContent = `${_idx + 1} of ${_steps.length}`;
  _layer.querySelector('[data-tour-act="back"]').disabled = _idx === 0;
  _layer.querySelector('.suite-tour-next').textContent = _idx === _steps.length - 1 ? 'Done' : 'Next';
  const fill = _layer.querySelector('.suite-tour-track-fill');
  if (fill) fill.style.width = `${((_idx + 1) / _steps.length) * 100}%`;

  if (target) target.scrollIntoView({ block: 'center', behavior: 'instant' });
  // Position after scroll has settled this frame.
  requestAnimationFrame(() => positionFor(step, target));
}

// Position the spotlight cutout and the card for a step.
function positionFor(step, target) {
  if (!_layer || !step) return;
  const spot = _layer.querySelector('.suite-tour-spot');
  const card = _layer.querySelector('.suite-tour-card');
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const pad = 6;

  if (!target) {
    // Centred card; the layer itself carries the scrim (a parked/zero-size
    // spotlight can't — Chromium culls box-shadow on offscreen/empty boxes).
    _layer.classList.add('suite-tour-center');
    card.style.left = `${Math.max(12, (vw - card.offsetWidth) / 2)}px`;
    card.style.top = `${Math.max(12, (vh - card.offsetHeight) / 2)}px`;
    return;
  }

  _layer.classList.remove('suite-tour-center');
  const r = target.getBoundingClientRect();
  spot.style.left = `${r.left - pad}px`;
  spot.style.top = `${r.top - pad}px`;
  spot.style.width = `${r.width + pad * 2}px`;
  spot.style.height = `${r.height + pad * 2}px`;

  // Card below the target when it fits, otherwise above; clamped to viewport.
  const cw = card.offsetWidth;
  const ch = card.offsetHeight;
  const below = r.bottom + pad + 10 + ch <= vh - 12;
  const top = below ? r.bottom + pad + 10 : Math.max(12, r.top - pad - 10 - ch);
  const left = Math.min(Math.max(12, r.left), Math.max(12, vw - cw - 12));
  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
}
