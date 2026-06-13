// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — shared data-freshness helper
//
// Why this exists: every data module rendered an absolute "Updated 08:47"
// stamp, which reads as a wall clock, not a freshness signal. Across the
// synthetic-panel appraisal, users (clinical, manager and power-user alike)
// could not tell whether a figure was live, stale, or silently failed. This
// helper gives every surface ONE consistent relative label plus an explicit
// stale state, so "is this number current?" is answerable at a glance.
//
// Usage (per module, on each render where data exists):
//   import { freshnessHtml, attachFreshnessTicker } from '../shared/freshness.js';
//   `<span class="data-freshness">${freshnessHtml(state.lastFetched)}</span>`
//   // once, after first render of the module container:
//   attachFreshnessTicker(container);
//
// The ticker keeps relative labels honest between a module's own refreshes by
// re-rendering any element carrying a data-fresh-at attribute every 20s.

'use strict';

const DEFAULT_STALE_MS = 5 * 60 * 1000; // 5 min — past this a live feed is suspect

// Relative, human label for how long ago `date` was. Deliberately coarse.
export function relativeTime(date, now = Date.now()) {
  const t = date instanceof Date ? date.getTime() : Number(date);
  if (!t || Number.isNaN(t)) return '';
  const secs = Math.max(0, Math.round((now - t) / 1000));
  if (secs < 10) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

// Absolute clock, kept as the title attr so the precise time is one hover away.
export function absoluteTime(date) {
  const d = date instanceof Date ? date : new Date(Number(date));
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// One consistent freshness chip. Shows "Updated · 12s ago"; once older than
// staleMs it gains a ⚠ and the .is-stale class so the surface visibly flags
// that what you are reading may no longer be live.
export function freshnessHtml(date, { staleMs = DEFAULT_STALE_MS, label = 'Updated', now = Date.now() } = {}) {
  const t = date instanceof Date ? date.getTime() : Number(date);
  if (!t || Number.isNaN(t)) return '';
  const stale = now - t > staleMs;
  const rel = relativeTime(t, now);
  const abs = absoluteTime(t);
  const warn = stale ? '<span class="freshness-warn" aria-hidden="true">&#9888;</span> ' : '';
  return (
    `<span class="freshness-stamp${stale ? ' is-stale' : ''}" data-fresh-at="${t}" data-fresh-stale-ms="${staleMs}"` +
    ` data-fresh-label="${label}" title="Last updated at ${abs}">${warn}${label} · ${rel}</span>`
  );
}

// Re-render any freshness stamps inside `root` so relative labels stay accurate
// between the module's own data refreshes. Idempotent per root. Returns a stop fn.
export function attachFreshnessTicker(root, intervalMs = 20000) {
  if (!root || root._freshnessTicker) return () => {};
  const tick = () => {
    const now = Date.now();
    root.querySelectorAll('.freshness-stamp[data-fresh-at]').forEach((el) => {
      const t = Number(el.dataset.freshAt);
      if (!t) return;
      const staleMs = Number(el.dataset.freshStaleMs) || DEFAULT_STALE_MS;
      const label = el.dataset.freshLabel || 'Updated';
      const stale = now - t > staleMs;
      el.classList.toggle('is-stale', stale);
      const warn = stale ? '⚠ ' : '';
      el.textContent = `${warn}${label} · ${relativeTime(t, now)}`;
      el.title = `Last updated at ${absoluteTime(t)}`;
    });
  };
  const id = setInterval(tick, intervalMs);
  root._freshnessTicker = id;
  return () => {
    clearInterval(id);
    delete root._freshnessTicker;
  };
}
