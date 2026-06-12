// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — guided tour engine (spotlight step-through)
//
// Steps are pure data in tour-steps.js; this file is the runtime only.
//   - Dims the page and cuts a spotlight over each step's target element.
//   - Skips steps whose target isn't present/visible (most anchors need a
//     patient record open — a partial tour is expected, not an error).
//   - Records completion in localStorage (shared across extension pages, so
//     Options can reset it) keyed by TOUR_VERSION. Bumping the version gives
//     returning users a "What's new" pass of only the steps added since the
//     version they last completed.

'use strict';

import { TOUR_VERSION, TOUR_STEPS } from './tour-steps.js';

export const TOUR_SEEN_KEY = 'suite.tour.seenVersion';

let _layer = null;
let _steps = [];
let _idx = 0;
let _mode = 'full'; // 'full' | 'whats-new'
let _keyHandler = null;
let _resizeHandler = null;

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

// First-run: full tour. Version moved on: "What's new" pass of new steps only.
// Already seen current version: nothing.
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

// Manual replay (⋯ menu / Options). Always the full tour.
export function startTour() {
  runTour(TOUR_STEPS, 'full');
}

export function stopTour() {
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
}

// Resolve a step's target: first selector whose element exists and is visible.
function resolveTarget(step) {
  if (!step.target) return null;
  for (const sel of [].concat(step.target)) {
    const el = document.querySelector(sel);
    if (el && (el.offsetParent !== null || el === document.body)) return el;
  }
  return null;
}

function runTour(steps, mode) {
  stopTour();
  _steps = steps.filter((s) => s.center || resolveTarget(s));
  if (_steps.length === 0) return;
  _mode = mode;
  _idx = 0;

  _layer = document.createElement('div');
  _layer.className = 'sent-tour-layer';
  _layer.setAttribute('role', 'dialog');
  _layer.setAttribute('aria-modal', 'true');
  _layer.setAttribute('aria-label', 'Guided tour');
  _layer.innerHTML = `
    <div class="sent-tour-spot" aria-hidden="true"></div>
    <div class="sent-tour-card">
      <div class="sent-tour-tag"></div>
      <div class="sent-tour-title"></div>
      <div class="sent-tour-body"></div>
      <div class="sent-tour-foot">
        <span class="sent-tour-progress"></span>
        <div class="sent-tour-btns">
          <button class="sent-tour-btn" data-tour-act="back">Back</button>
          <button class="sent-tour-btn" data-tour-act="skip">Skip</button>
          <button class="sent-tour-btn sent-tour-next" data-tour-act="next">Next</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(_layer);

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
    }
  };
  document.addEventListener('keydown', _keyHandler, true);

  _resizeHandler = () => position();
  window.addEventListener('resize', _resizeHandler);

  showStep();
}

function next() {
  if (_idx >= _steps.length - 1) {
    finish();
    return;
  }
  _idx++;
  showStep();
}

function back() {
  if (_idx === 0) return;
  _idx--;
  showStep();
}

function finish() {
  markSeen();
  stopTour();
}

function showStep() {
  if (!_layer) return;
  const step = _steps[_idx];
  // Target may have left the DOM mid-tour (e.g. snapshot changed) — skip ahead.
  if (!step.center && !resolveTarget(step)) {
    if (_idx < _steps.length - 1) {
      _idx++;
      showStep();
    } else {
      finish();
    }
    return;
  }

  _layer.querySelector('.sent-tour-tag').textContent = _mode === 'whats-new' ? 'What’s new' : 'Guided tour';
  _layer.querySelector('.sent-tour-title').textContent = step.title;
  _layer.querySelector('.sent-tour-body').textContent = step.body;
  _layer.querySelector('.sent-tour-progress').textContent = `${_idx + 1} of ${_steps.length}`;
  _layer.querySelector('[data-tour-act="back"]').disabled = _idx === 0;
  _layer.querySelector('.sent-tour-next').textContent = _idx === _steps.length - 1 ? 'Done' : 'Next';

  const target = step.center ? null : resolveTarget(step);
  if (target) target.scrollIntoView({ block: 'center', behavior: 'instant' });
  // Position after scroll has settled this frame.
  requestAnimationFrame(position);
}

// Position the spotlight cutout and the card for the current step.
function position() {
  if (!_layer) return;
  const step = _steps[_idx];
  const spot = _layer.querySelector('.sent-tour-spot');
  const card = _layer.querySelector('.sent-tour-card');
  const target = step.center ? null : resolveTarget(step);
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const pad = 6;

  if (!target) {
    _layer.classList.add('sent-tour-center');
    card.style.left = `${Math.max(12, (vw - card.offsetWidth) / 2)}px`;
    card.style.top = `${Math.max(12, (vh - card.offsetHeight) / 2)}px`;
    return;
  }

  _layer.classList.remove('sent-tour-center');
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
