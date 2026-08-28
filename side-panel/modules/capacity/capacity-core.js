// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Capacity Forecast: pure-logic core (no chrome APIs, no DOM)
//
// Exported:
//   DOW_KEYS, WEEKDAYS, minimumForDate, defaultMinimumByDay, presetSummary, validatePreset
//   DEFAULT_LOOKAHEAD, normaliseLookahead, validateLookahead
//   upliftKindForBlock, upliftMultiplier, effectiveMinimumForDate
//   evaluateDay, scanHorizon, filterAtRisk, summariseScan, STATUS_RANK

'use strict';

import {
  isBankHoliday,
  isWorkingDay,
  isWeekend,
  addDaysISO,
  closedBlockBefore,
  holidayBlockContaining,
  DEFAULT_DIVISION,
} from '../../../shared/uk-calendar.js';

// Date#getDay() is Sunday-indexed (0=Sun … 6=Sat); map to the preset keys.
export const DOW_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// Editor rows are Monday-first.
export const WEEKDAYS = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
];

/** Worse status = higher rank (for sorting at-risk packs). */
export const STATUS_RANK = {
  critical: 4,
  low: 3,
  tight: 2,
  sufficient: 1,
  closed: 0,
  historic: 0,
  loading: 0,
  empty: 0,
};

/**
 * Practice-manager look-ahead defaults.
 * Uplift multipliers are editable estimates (post-BH rebound), not published
 * F2F ground truth — UI must label them as estimates.
 */
export const DEFAULT_LOOKAHEAD = Object.freeze({
  horizonDays: 28,
  includeTight: false,
  upliftEnabled: true,
  division: DEFAULT_DIVISION,
  singleBhUplift: 1.25,
  easterBlockUplift: 1.35,
  xmasBlockUplift: 1.4,
});

const RISK_BASE = ['critical', 'low'];

export function normaliseLookahead(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const horizonDays = clampInt(src.horizonDays, 7, 84, DEFAULT_LOOKAHEAD.horizonDays);
  const includeTight = !!src.includeTight;
  const upliftEnabled = src.upliftEnabled !== false;
  const division =
    typeof src.division === 'string' && src.division.trim()
      ? src.division.trim()
      : DEFAULT_LOOKAHEAD.division;
  return {
    horizonDays,
    includeTight,
    upliftEnabled,
    division,
    singleBhUplift: clampUplift(src.singleBhUplift, DEFAULT_LOOKAHEAD.singleBhUplift),
    easterBlockUplift: clampUplift(src.easterBlockUplift, DEFAULT_LOOKAHEAD.easterBlockUplift),
    xmasBlockUplift: clampUplift(src.xmasBlockUplift, DEFAULT_LOOKAHEAD.xmasBlockUplift),
  };
}

export function validateLookahead(form) {
  const raw = form && typeof form === 'object' ? form : {};
  if (raw.horizonDays != null) {
    const h = Number(raw.horizonDays);
    if (!Number.isFinite(h) || h < 7 || h > 84) {
      return { valid: false, error: 'Horizon must be between 7 and 84 days.' };
    }
  }
  for (const key of ['singleBhUplift', 'easterBlockUplift', 'xmasBlockUplift']) {
    if (raw[key] != null) {
      const n = Number(raw[key]);
      if (!Number.isFinite(n) || n < 1 || n > 2.5) {
        return { valid: false, error: 'Uplift multipliers must be between 1.0 and 2.5.' };
      }
    }
  }
  const n = normaliseLookahead(raw);
  return { valid: true, error: null, value: n };
}

export function riskStatusesFor(lookahead) {
  const cfg = normaliseLookahead(lookahead);
  return cfg.includeTight ? [...RISK_BASE, 'tight'] : [...RISK_BASE];
}

// Per-weekday minimum for a given ISO date, falling back to the legacy flat
// `minimumPerDay` field (weekends = 0) for presets saved before minimumByDay.
export function minimumForDate(preset, dateISO) {
  if (!preset) return 0;
  const dow = new Date(dateISO + 'T12:00:00').getDay();
  const key = DOW_KEYS[dow];
  if (preset.minimumByDay && preset.minimumByDay[key] !== undefined) {
    return preset.minimumByDay[key];
  }
  // Legacy fallback: weekends carry no minimum; weekdays use the flat value.
  if (dow === 0 || dow === 6) return 0;
  return preset.minimumPerDay || 0;
}

// Build a minimumByDay map from a legacy flat minimum (weekdays = min, weekend = 0).
export function defaultMinimumByDay(legacyMin) {
  const m = legacyMin || 0;
  return { mon: m, tue: m, wed: m, thu: m, fri: m, sat: 0, sun: 0 };
}

// Compact summary line for the preset dropdown.
export function presetSummary(p) {
  const mins = p.minimumByDay;
  if (!mins) return `min ${p.minimumPerDay || 0}/day`;
  const values = WEEKDAYS.map((d) => mins[d.key] || 0);
  const allSame = values.slice(0, 5).every((v) => v === values[0]);
  if (allSame && values[5] === 0 && values[6] === 0) return `min ${values[0]}/weekday`;
  const wkTotal = values.reduce((a, b) => a + b, 0);
  return `min ${wkTotal}/week`;
}

// Validate the editor form. Returns { valid, error } — error is the message the
// caller surfaces (kept identical to the original inline alerts).
export function validatePreset({ name, slotTypes, tight, low }) {
  if (!name || !String(name).trim()) return { valid: false, error: 'Preset needs a name.' };
  if (!slotTypes || slotTypes.length === 0) return { valid: false, error: 'Select at least one slot type.' };
  if (low >= tight) return { valid: false, error: 'Low threshold must be below Tight threshold.' };
  if (tight >= 100 || low >= 100) return { valid: false, error: 'Thresholds must be below 100%.' };
  return { valid: true, error: null };
}

/**
 * Classify a closed block for uplift: xmas / easter / single / null.
 * Hypothesis-grade — see DEFAULT_LOOKAHEAD comment.
 */
export function upliftKindForBlock(block) {
  if (!block || !Array.isArray(block.bankHolidays) || block.bankHolidays.length === 0) return null;
  const dates = block.bankHolidays;
  if (
    dates.some((d) => {
      const md = d.slice(5); // MM-DD
      return md >= '12-24' || md <= '01-02';
    })
  ) {
    return 'xmas';
  }
  // Multi-day spring/autumn blocks with a Friday or Monday BH ≈ Easter (or long Jubilee-style).
  if (
    block.closedDays >= 3 &&
    dates.some((d) => {
      const m = d.slice(5, 7);
      return m === '03' || m === '04';
    })
  ) {
    return 'easter';
  }
  return 'single';
}

export function upliftMultiplier(kind, lookahead) {
  const cfg = normaliseLookahead(lookahead);
  if (!cfg.upliftEnabled || !kind) return 1;
  if (kind === 'xmas') return cfg.xmasBlockUplift;
  if (kind === 'easter') return cfg.easterBlockUplift;
  if (kind === 'single') return cfg.singleBhUplift;
  return 1;
}

/**
 * Effective minimum for a date = base weekday minimum × post-BH uplift (if any).
 * Bank holidays themselves and non-working days with base 0 stay at 0.
 */
export function effectiveMinimumForDate(preset, dateISO, lookahead = DEFAULT_LOOKAHEAD) {
  const cfg = normaliseLookahead(lookahead);
  const base = minimumForDate(preset, dateISO);
  const division = cfg.division;
  const bankHoliday = isBankHoliday(dateISO, division);
  const working = isWorkingDay(dateISO, division);
  const weekend = isWeekend(dateISO);

  let kind = null;
  let block = null;
  if (working && base > 0 && cfg.upliftEnabled) {
    block = closedBlockBefore(dateISO, division);
    kind = upliftKindForBlock(block);
  }

  const mult = upliftMultiplier(kind, cfg);
  const effective = base > 0 && mult !== 1 ? Math.round(base * mult) : base;

  return {
    base,
    effective,
    uplift: mult,
    upliftKind: kind,
    upliftApplied: mult > 1 && effective !== base,
    isBankHoliday: bankHoliday,
    isWorkingDay: working,
    isWeekend: weekend,
    block,
    division,
  };
}

/**
 * Evaluate one day given aggregated slot data (or null while loading/missing).
 * Mirrors capacity.js dayStatus semantics with uplift + holiday tagging.
 */
export function evaluateDay({
  preset,
  dateISO,
  agg,
  lookahead = DEFAULT_LOOKAHEAD,
  today = null,
  loading = false,
  computeStatus,
}) {
  const todayISO = today || localTodayISO();
  const minInfo = effectiveMinimumForDate(preset, dateISO, lookahead);
  const past = dateISO < todayISO;
  const isToday = dateISO === todayISO;

  if (loading) {
    return dayResult({
      dateISO,
      status: 'loading',
      total: null,
      minInfo,
      sessionsCount: null,
      reason: 'Loading…',
    });
  }
  if (!agg) {
    return dayResult({
      dateISO,
      status: 'empty',
      total: null,
      minInfo,
      sessionsCount: null,
      reason: 'No data yet',
    });
  }
  if (past && !isToday) {
    return dayResult({
      dateISO,
      status: 'historic',
      total: agg.total,
      minInfo,
      sessionsCount: agg.sessionsCount,
      reason: 'Past day',
    });
  }
  if (minInfo.isBankHoliday || agg.sessionsCount === 0 || minInfo.effective === 0) {
    const closedWhy = minInfo.isBankHoliday
      ? 'Bank holiday'
      : agg.sessionsCount === 0
        ? 'No sessions in the book'
        : 'No minimum set';
    return dayResult({
      dateISO,
      status: 'closed',
      total: agg.total,
      minInfo,
      sessionsCount: agg.sessionsCount,
      reason: closedWhy,
    });
  }

  const statusFn =
    typeof computeStatus === 'function'
      ? computeStatus
      : (count, minimum, thresholds) => defaultComputeStatus(count, minimum, thresholds);
  const status = statusFn(agg.total, minInfo.effective, preset.thresholds || { tight: 75, low: 50 });
  const pct = minInfo.effective > 0 ? Math.round((agg.total / minInfo.effective) * 100) : 100;
  let reason = `${agg.total} free vs ${minInfo.effective} minimum (${pct}%)`;
  if (minInfo.upliftApplied) {
    reason += ` · post-holiday uplift ×${minInfo.uplift.toFixed(2)} (est.)`;
  }
  return dayResult({
    dateISO,
    status,
    total: agg.total,
    minInfo,
    sessionsCount: agg.sessionsCount,
    pct,
    reason,
  });
}

/**
 * Walk calendar days from `fromISO` (inclusive) for `horizonDays`.
 * Returns every day plus an at-risk subset for the print/Today surfaces.
 */
export function scanHorizon({
  preset,
  dataByDate = {},
  loadingDates = null,
  fromISO = null,
  lookahead = DEFAULT_LOOKAHEAD,
  today = null,
  computeStatus,
  includeNonWorking = true,
}) {
  const cfg = normaliseLookahead(lookahead);
  const start = fromISO || localTodayISO();
  const todayISO = today || localTodayISO();
  const loading = loadingDates instanceof Set ? loadingDates : new Set(loadingDates || []);
  const days = [];

  for (let i = 0; i < cfg.horizonDays; i++) {
    const dateISO = addDaysISO(start, i);
    const minInfo = effectiveMinimumForDate(preset, dateISO, cfg);
    if (!includeNonWorking && !minInfo.isWorkingDay) continue;
    days.push(
      evaluateDay({
        preset,
        dateISO,
        agg: dataByDate[dateISO] || null,
        lookahead: cfg,
        today: todayISO,
        loading: loading.has(dateISO),
        computeStatus,
      })
    );
  }

  const atRisk = filterAtRisk(days, cfg, todayISO);
  return {
    fromISO: start,
    toISO: addDaysISO(start, cfg.horizonDays - 1),
    horizonDays: cfg.horizonDays,
    lookahead: cfg,
    days,
    atRisk,
    summary: summariseScan(days, atRisk, cfg),
  };
}

export function filterAtRisk(days, lookahead = DEFAULT_LOOKAHEAD, today = null) {
  const risk = new Set(riskStatusesFor(lookahead));
  const todayISO = today || localTodayISO();
  return (days || [])
    .filter((d) => d && risk.has(d.status) && d.dateISO >= todayISO && d.minInfo?.isWorkingDay)
    .slice()
    .sort((a, b) => {
      const rank = (STATUS_RANK[b.status] || 0) - (STATUS_RANK[a.status] || 0);
      if (rank !== 0) return rank;
      return a.dateISO < b.dateISO ? -1 : a.dateISO > b.dateISO ? 1 : 0;
    });
}

export function summariseScan(days, atRisk, lookahead = DEFAULT_LOOKAHEAD) {
  const cfg = normaliseLookahead(lookahead);
  const working = (days || []).filter((d) => d.minInfo?.isWorkingDay && d.status !== 'historic');
  const critical = (atRisk || []).filter((d) => d.status === 'critical').length;
  const low = (atRisk || []).filter((d) => d.status === 'low').length;
  const tight = (atRisk || []).filter((d) => d.status === 'tight').length;
  const postHolidayRisk = (atRisk || []).filter((d) => d.minInfo?.upliftApplied).length;
  const worst = (atRisk && atRisk[0]) || null;
  const loaded = working.filter((d) => d.status !== 'loading' && d.status !== 'empty').length;
  return {
    workingDays: working.length,
    loadedDays: loaded,
    atRiskCount: (atRisk || []).length,
    critical,
    low,
    tight,
    postHolidayRisk,
    worstDate: worst?.dateISO || null,
    worstStatus: worst?.status || null,
    horizonDays: cfg.horizonDays,
    includeTight: cfg.includeTight,
  };
}

/** Plain-English one-liner for Today / risk pack header. */
export function lookAheadSentence(summary, presetName) {
  if (!summary) return 'Capacity look-ahead unavailable.';
  const name = presetName ? ` (${presetName})` : '';
  if (summary.atRiskCount === 0) {
    return `No at-risk days in the next ${summary.horizonDays} days${name}.`;
  }
  const bits = [];
  if (summary.critical) bits.push(`${summary.critical} critical`);
  if (summary.low) bits.push(`${summary.low} low`);
  if (summary.tight) bits.push(`${summary.tight} tight`);
  const worst =
    summary.worstDate && summary.worstStatus
      ? ` Worst: ${formatShortEn(summary.worstDate)} (${summary.worstStatus}).`
      : '';
  const post =
    summary.postHolidayRisk > 0 ? ` ${summary.postHolidayRisk} post–bank-holiday.` : '';
  return `${summary.atRiskCount} day${summary.atRiskCount === 1 ? '' : 's'} at risk in the next ${summary.horizonDays} days${name}: ${bits.join(', ')}.${worst}${post}`;
}

export function horizonDateList(fromISO, horizonDays) {
  const start = fromISO || localTodayISO();
  const n = clampInt(horizonDays, 1, 84, DEFAULT_LOOKAHEAD.horizonDays);
  const out = [];
  for (let i = 0; i < n; i++) out.push(addDaysISO(start, i));
  return out;
}

// ── internals ─────────────────────────────────────────────────────────────────

function dayResult({ dateISO, status, total, minInfo, sessionsCount, reason, pct = null }) {
  return {
    dateISO,
    status,
    total,
    sessionsCount,
    reason,
    pct,
    minInfo,
    weekday: WEEKDAYS.find((d) => d.key === DOW_KEYS[new Date(dateISO + 'T12:00:00').getDay()])?.label || '',
  };
}

function defaultComputeStatus(count, minimum, thresholds = { tight: 75, low: 50 }) {
  if (count >= minimum) return 'sufficient';
  const pct = minimum > 0 ? (count / minimum) * 100 : 100;
  if (pct >= thresholds.tight) return 'tight';
  if (pct >= thresholds.low) return 'low';
  return 'critical';
}

function clampInt(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function clampUplift(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(2.5, Math.max(1, Math.round(n * 100) / 100));
}

function localTodayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatShortEn(iso) {
  try {
    return new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  } catch (_) {
    return iso;
  }
}

// Re-export calendar helpers tests may want via the core surface.
export { isBankHoliday, isWorkingDay, isWeekend, addDaysISO, closedBlockBefore, holidayBlockContaining };
