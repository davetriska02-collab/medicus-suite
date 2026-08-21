// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Submissions Tracker IO helpers

'use strict';

async function submissionsExport() {
  const r = await chrome.storage.local.get(['submissions.config', 'submissions.thresholds', 'submissions.ledger']);
  // suite.practiceCode is owned by shared/io/suite-io.js — not exported here.
  return {
    config:     r['submissions.config']     ?? {},
    thresholds: r['submissions.thresholds'] ?? null,
    // Received-work day ledger (v3.153.0) — per-day counts of tasks seen. No
    // PHI (task UUIDs for today only; bare counts for past days). Backed up
    // so demand history survives a reinstall.
    ledger:     r['submissions.ledger']     ?? null,
  };
}

// Structural sanitiser for an imported ledger — mirrors normaliseLedger in
// side-panel/modules/submissions/submissions-core.js (this file is a plain
// script and cannot import that ES module). Drops anything malformed so a
// crafted backup cannot plant non-numeric counts or oversized garbage.
function _sanitiseLedger(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !raw.days || typeof raw.days !== 'object') {
    return null;
  }
  const days = {};
  for (const [date, day] of Object.entries(raw.days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !day || typeof day !== 'object' || Array.isArray(day)) continue;
    const cleanDay = {};
    if (day.watched === true) cleanDay.watched = true;
    for (const [key, entry] of Object.entries(day)) {
      if (key === 'watched' || !entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      if (!/^[a-zA-Z]{1,32}$/.test(key)) continue;
      if (entry.ids && typeof entry.ids === 'object' && !Array.isArray(entry.ids)) {
        const ids = {};
        for (const [id, h] of Object.entries(entry.ids)) {
          if (typeof id === 'string' && id.length > 0 && id.length <= 64) {
            ids[id] = typeof h === 'number' && Number.isInteger(h) && h >= 0 && h <= 23 ? h : 0;
          }
        }
        cleanDay[key] = { ids };
      } else if (typeof entry.n === 'number' && Number.isFinite(entry.n) && entry.n >= 0) {
        const hourly = new Array(24).fill(0);
        if (Array.isArray(entry.hourly)) {
          for (let i = 0; i < 24; i++) {
            const v = entry.hourly[i];
            if (typeof v === 'number' && Number.isFinite(v) && v >= 0) hourly[i] = Math.floor(v);
          }
        }
        cleanDay[key] = { n: Math.floor(entry.n), hourly };
      }
    }
    days[date] = cleanDay;
  }
  return { v: 1, days };
}

async function submissionsImport(data, _opts = {}) {
  if (!data || typeof data !== 'object') throw new Error('Submissions data must be an object.');
  const toSet = {};
  if (data.config !== undefined) {
    if (typeof data.config !== 'object' || Array.isArray(data.config)) {
      throw new Error('submissions.config must be an object.');
    }
    const cleanCfg = {};
    for (const [k, v] of Object.entries(data.config)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      cleanCfg[k] = v;
    }
    toSet['submissions.config'] = cleanCfg;
  }
  if (data.thresholds != null) {
    if (typeof data.thresholds !== 'object' || Array.isArray(data.thresholds)) {
      throw new Error('submissions.thresholds must be an object.');
    }
    // M2: validate each category's numeric thresholds so a crafted backup with a
    // string/NaN/Infinity threshold cannot reach the consumer where
    // `value >= NaN` is always false and alerts silently never fire.
    for (const [cat, entry] of Object.entries(data.thresholds)) {
      if (entry == null || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error(`submissions.thresholds.${cat} must be a non-null object.`);
      }
      for (const field of ['amber', 'red']) {
        if (entry[field] != null) {
          if (!Number.isFinite(entry[field]) || entry[field] <= 0) {
            throw new Error(
              `submissions.thresholds.${cat}.${field} must be a finite positive number (got ${JSON.stringify(entry[field])}).`
            );
          }
        }
      }
      if (entry.enabled != null && typeof entry.enabled !== 'boolean') {
        throw new Error(
          `submissions.thresholds.${cat}.enabled must be a boolean (got ${JSON.stringify(entry.enabled)}).`
        );
      }
      const amber = entry.amber;
      const red = entry.red;
      if (Number.isFinite(amber) && Number.isFinite(red) && red < amber) {
        throw new Error(`submissions.thresholds.${cat}: red must be at least amber.`);
      }
    }
    toSet['submissions.thresholds'] = data.thresholds;
  }
  if (data.ledger != null) {
    const clean = _sanitiseLedger(data.ledger);
    if (clean === null) throw new Error('submissions.ledger must be an object with a days map.');
    toSet['submissions.ledger'] = clean;
  }
  // practiceCode belongs to suite-io. A submissions-scoped backup must not
  // write suite keys (that was a cross-module smuggle path).
  if (Object.keys(toSet).length > 0) {
    await chrome.storage.local.set(toSet);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { submissionsExport, submissionsImport };
}
