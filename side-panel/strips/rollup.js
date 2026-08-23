// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Alert roll-up — groups elevated demand strips into one summary bar.

'use strict';

import { escStrip, fmtHHMM } from './helpers.js';

// Three strips (#wrStrip, #rmStrip, #subRagStrip) each render independently below
// the nav. When two or more are in an ELEVATED (amber/red) state they stack and
// compete for the same scarce vertical space, so a single severity-ordered roll-up
// bar replaces the stack: one line at max severity with a pill per elevated channel,
// expandable (chevron) to the full strips for detail. Each strip's own poller is
// untouched — it still renders its own DOM; it just reports its resulting level here
// via reportAlert(), and the roll-up reads that shared bus. Red auto-expands.
//
// CLINICAL SAFETY: grouping only collapses the *presentation* of strips that are
// already showing; nothing is hidden that wasn't on screen, and the roll-up itself
// carries the max severity. Green/calm states are never "elevated", so the roll-up
// only ever appears when there is genuinely more than one elevated signal.

const ALERT_CHANNELS = ['waiting', 'triage', 'demand'];

export function initStrip(el, bus) {
  const alertRollupEl = el;
  const alertStackEl = document.getElementById('alertStack');
  const alertBus = { waiting: null, triage: null, demand: null };
  let _rollupExpanded = null; // null = use default (red→open, amber→closed); else session choice

  // Persistent "keep the roll-up expanded" preference (suite.rollup.alwaysExpanded).
  // Power users want the amber detail pinned on screen instead of clicking Details
  // every time the alert set changes; when on, the roll-up renders expanded always.
  // Toggled from the command palette; cached here, kept current via onChanged.
  let _rollupAlwaysExpanded = false;
  chrome.storage.local.get('suite.rollup.alwaysExpanded').then((r) => {
    _rollupAlwaysExpanded = r['suite.rollup.alwaysExpanded'] === true;
    renderRollup();
  });
  function onStorage(changes) {
    if ('suite.rollup.alwaysExpanded' in changes) {
      _rollupAlwaysExpanded = changes['suite.rollup.alwaysExpanded'].newValue === true;
      _rollupExpanded = null; // re-derive against the new preference
      renderRollup();
    }
  }
  chrome.storage.onChanged.addListener(onStorage);

  function reportAlert(channel, state) {
    // state = { level, label, count, meta?, title? } or null when inactive.
    alertBus[channel] = state;
    renderRollup();
  }

  function renderRollup() {
    if (!alertRollupEl || !alertStackEl) return;
    const elevated = ALERT_CHANNELS.map((k) => alertBus[k]).filter(
      (a) => a && (a.level === 'amber' || a.level === 'red')
    );

    if (elevated.length < 2) {
      // Nothing to group — restore the normal stacked strips, roll-up hidden.
      alertRollupEl.className = 'alert-rollup alert-rollup-hidden';
      alertRollupEl.innerHTML = '';
      alertStackEl.style.display = '';
      _rollupExpanded = null;
      return;
    }

    const hasRed = elevated.some((a) => a.level === 'red');
    const maxLevel = hasRed ? 'red' : 'amber';
    // Expanded when: the user pinned it open, OR (default) it's red. Amber starts
    // collapsed unless the session toggle or the persistent pref says otherwise.
    // The pinned pref supplies the DEFAULT only — a session click must still be
    // able to collapse (audit low: the Hide button visibly no-op'd while
    // suite.rollup.alwaysExpanded was on, because this re-forced true on the
    // re-render the click itself triggered).
    if (_rollupExpanded === null) _rollupExpanded = _rollupAlwaysExpanded || hasRed;

    const pills = elevated
      .map(
        (a) =>
          `<span class="pill pill--${a.level}"${a.title ? ` title="${escStrip(a.title)}"` : ''}><span class="pill-dot"></span><span class="pill-name">${escStrip(
            a.label
          )}</span>${a.count != null ? `<span class="pill-count">${a.count}</span>` : ''}${
            a.meta ? `<span class="pill-meta">${escStrip(a.meta)}</span>` : ''
          }</span>`
      )
      .join('');

    // R6: severity is carried by a WORD, not only colour — red reads "URGENT",
    // amber "ALERTS" (uppercased by CSS), so escalation survives colourblind mode.
    const word = maxLevel === 'red' ? 'urgent' : 'alerts';
    // Timestamp the bar so every figure is anchored to a moment the manager can
    // quote ("as at 11:02") — a live number with no time is one she won't cite.
    const stamp = fmtHHMM(Date.now());
    alertRollupEl.className = `alert-rollup alert-rollup--${maxLevel}`;
    alertRollupEl.setAttribute('aria-expanded', String(_rollupExpanded));
    alertRollupEl.innerHTML = `
    <span class="alert-rollup-icon">${maxLevel === 'red' ? '🔴' : '⚠'}</span>
    <span class="alert-rollup-count">${elevated.length} ${word}</span>
    <span class="alert-rollup-pills">${pills}</span>
    <span class="alert-rollup-stamp" title="Figures as at ${stamp}">${stamp}</span>
    <button class="alert-rollup-toggle" title="${
      _rollupExpanded ? 'Collapse the detail — the alert stays' : 'Show the detail'
    }">${_rollupExpanded ? 'Hide' : 'Details'}<span class="alert-rollup-chev">${
      _rollupExpanded ? '▾' : '▸'
    }</span></button>
  `;
    alertStackEl.style.display = _rollupExpanded ? '' : 'none';
  }

  function onClick() {
    _rollupExpanded = !_rollupExpanded;
    renderRollup();
  }
  alertRollupEl?.addEventListener('click', onClick);

  bus.reportAlert = reportAlert;

  return function cleanup() {
    chrome.storage.onChanged.removeListener(onStorage);
    alertRollupEl?.removeEventListener('click', onClick);
  };
}
