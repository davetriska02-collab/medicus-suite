// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Shared — Rule Currency Assessor
//
// Assesses how current each bundled rule file is.
// Pure function: no I/O, no chrome APIs.
//
// Usage (browser classic script): window.RuleCurrency.assessRuleCurrency(files, todayISO)
// Usage (Node / ES module):       require('./shared/rule-currency.js').assessRuleCurrency(...)
//
// Dual-export pattern: same as engine/rules-engine.js.
// In a browser context the IIFE assigns to global.RuleCurrency.
// In a Node/test context module.exports is set.

(function (global) {
  'use strict';

  const STALE_DAYS = 365;
  const RED_DAYS = 540;

  // Parse "QOF YYYY/YY" from a specVersion string.
  // Returns { startYear, endYear } or null if unparseable.
  // e.g. "QOF 2026/27" → { startYear: 2026, endYear: 2027 }
  function parseQofSpecVersion(specVersion) {
    if (!specVersion || typeof specVersion !== 'string') return null;
    // Match "QOF YYYY/YY" — end year may be 2-digit
    const m = specVersion.match(/\bQOF\s+(\d{4})\/(\d{2,4})\b/i);
    if (!m) return null;
    const startYear = parseInt(m[1], 10);
    const endYearRaw = m[2];
    let endYear;
    if (endYearRaw.length === 2) {
      // "26" → same century as startYear: 2000 + 26 = 2026; 2099 + 26 is unlikely
      endYear = Math.floor(startYear / 100) * 100 + parseInt(endYearRaw, 10);
    } else {
      endYear = parseInt(endYearRaw, 10);
    }
    if (!Number.isFinite(startYear) || !Number.isFinite(endYear)) return null;
    if (endYear !== startYear + 1) return null; // sanity: must be consecutive years
    return { startYear, endYear };
  }

  // Parse "YYYY/YY" season from a specVersion string.
  // Returns { startYear, endYear } or null.
  // e.g. "JCVI/UKHSA 2025/26 season" → { startYear: 2025, endYear: 2026 }
  function parseSeasonSpecVersion(specVersion) {
    if (!specVersion || typeof specVersion !== 'string') return null;
    const m = specVersion.match(/\b(\d{4})\/(\d{2,4})\b/);
    if (!m) return null;
    const startYear = parseInt(m[1], 10);
    const endYearRaw = m[2];
    let endYear;
    if (endYearRaw.length === 2) {
      endYear = Math.floor(startYear / 100) * 100 + parseInt(endYearRaw, 10);
    } else {
      endYear = parseInt(endYearRaw, 10);
    }
    if (!Number.isFinite(startYear) || !Number.isFinite(endYear)) return null;
    if (endYear !== startYear + 1) return null;
    return { startYear, endYear };
  }

  // Count whole days between two ISO date strings (YYYY-MM-DD).
  // Returns null if either is invalid.
  function ageDaysISO(lastUpdatedISO, todayISO) {
    if (!lastUpdatedISO || !todayISO) return null;
    const a = Date.parse(lastUpdatedISO);
    const b = Date.parse(todayISO);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return Math.round((b - a) / 86400000);
  }

  // Assess a single file entry.
  // Returns { id, lastUpdated, specVersion, ageDays, level, message }
  // level: 'green' | 'amber' | 'red'
  // red = materially wrong content (QOF year mismatch, ended vaccine season,
  //       or age > RED_DAYS); amber = stale but not materially wrong or age unknown.
  function assessFile(file, todayISO, opts) {
    const staleDays = opts && opts.staleDays != null ? opts.staleDays : STALE_DAYS;
    const redDays = opts && opts.redDays != null ? opts.redDays : RED_DAYS;

    const id = file.id || '';
    const lastUpdated = file.lastUpdated || null;
    const specVersion = file.specVersion || null;

    // Age check
    const ageDays = ageDaysISO(lastUpdated, todayISO);
    let level = 'green';
    let message = '';

    if (ageDays === null) {
      level = 'amber';
      message = 'lastUpdated missing or unparseable — currency unknown.';
    } else if (ageDays > redDays) {
      level = 'red';
      message = `Last updated ${ageDays} days ago (>${redDays}d) — needs urgent review.`;
    } else if (ageDays > staleDays) {
      level = 'amber';
      message = `Last updated ${ageDays} days ago (>${staleDays}d).`;
    }

    // QOF-specific check (id === 'qof') — QOF year mismatch is materially wrong → red
    if (id === 'qof' && specVersion) {
      const parsed = parseQofSpecVersion(specVersion);
      if (!parsed) {
        if (level === 'green') {
          level = 'amber';
          message = `Could not parse QOF year from specVersion "${specVersion}".`;
        }
      } else {
        // QOF year YYYY/YY runs 1 April YYYY – 31 March (YYYY+1).
        // A file becomes mismatched once today is on or after 1 April (endYear),
        // i.e. the next QOF year has started. This is materially wrong → red.
        const nextYearStart = todayISO >= `${parsed.endYear}-04-01`;
        if (nextYearStart) {
          level = 'red';
          message = `QOF year mismatch: file encodes "${parsed.startYear}/${String(parsed.endYear).slice(-2)}" but today (${todayISO}) is in QOF ${parsed.endYear}/${String(parsed.endYear + 1).slice(-2)}.`;
        }
      }
    }

    // Vaccine-season check (id === 'vaccine') — ended season is materially wrong → red
    if (id === 'vaccine' && specVersion) {
      const parsed = parseSeasonSpecVersion(specVersion);
      if (!parsed) {
        if (level === 'green') {
          level = 'amber';
          message = `Could not parse vaccine season from specVersion "${specVersion}".`;
        }
      } else {
        // Season YYYY/YY goes stale from 1 September of endYear
        // (2025/26 → stale from 2026-09-01, when 2026/27 should exist).
        // An ended season is materially wrong (wrong eligibility) → red.
        const staleCutoff = `${parsed.endYear}-09-01`;
        if (todayISO >= staleCutoff) {
          level = 'red';
          message = `Vaccine season "${parsed.startYear}/${String(parsed.endYear).slice(-2)}" ended — the ${parsed.endYear}/${String(parsed.endYear + 1).slice(-2)} season file should be available.`;
        }
      }
    }

    return { id, lastUpdated, specVersion, ageDays, level, message };
  }

  /**
   * Assess currency of bundled rule files.
   *
   * @param {Array<{id: string, lastUpdated: string|null, specVersion: string|null}>} files
   *   One entry per rule file. id values: 'drug', 'qof', 'vaccine', 'alert'.
   * @param {string} todayISO  Today's date in 'YYYY-MM-DD' format.
   * @param {object} [opts]    Optional overrides. Defaults: { staleDays: 365, redDays: 540 }.
   *   opts.staleDays: age threshold (days) for amber. Backwards-compatible: omit for default.
   *   opts.redDays:   age threshold (days) for red. Ignored for QOF/vaccine content checks
   *                   which are always red when mismatched.
   * @returns {{ overall: 'green'|'amber'|'red', files: Array, warnings: string[] }}
   */
  function assessRuleCurrency(files, todayISO, opts) {
    if (!Array.isArray(files) || files.length === 0) {
      return { overall: 'amber', files: [], warnings: ['No rule file metadata provided.'] };
    }

    const assessed = files.map((f) => assessFile(f, todayISO, opts));
    const warnings = assessed
      .filter((f) => (f.level === 'amber' || f.level === 'red') && f.message)
      .map((f) => f.message);

    const hasRed = assessed.some((f) => f.level === 'red');
    const hasAmber = assessed.some((f) => f.level === 'amber');
    const overall = hasRed ? 'red' : hasAmber ? 'amber' : 'green';
    return { overall, files: assessed, warnings };
  }

  const api = { assessRuleCurrency };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.RuleCurrency = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : global);
