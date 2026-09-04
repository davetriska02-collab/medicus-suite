// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — UK bank-holiday / working-day calendar (pure, sync).
//
// Data is bundled (shared/uk-bank-holidays-data.js), regenerated from GOV.UK
// by scripts/regen-bank-holidays.js. No runtime fetch — capacity / slots
// "next working day" must work offline and without a www.gov.uk host permission.

'use strict';

import { UK_BANK_HOLIDAYS, UK_BANK_HOLIDAYS_META } from './uk-bank-holidays-data.js';

export const DIVISIONS = Object.freeze(['england-and-wales', 'scotland', 'northern-ireland']);
export const DEFAULT_DIVISION = 'england-and-wales';

/** Minimum remaining horizon (months) before CI should fail closed. */
export const MIN_HORIZON_MONTHS = 9;

const _sets = new Map(); // division -> Set<iso>
const _titles = new Map(); // division -> Map<iso, title>

function pad(n) {
  return String(n).padStart(2, '0');
}

function toISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseISO(iso) {
  return new Date(iso + 'T12:00:00');
}

function resolveDivision(division) {
  const div = division || DEFAULT_DIVISION;
  if (!UK_BANK_HOLIDAYS[div]) {
    throw new Error(`Unknown UK bank-holiday division: ${div}`);
  }
  return div;
}

function holidaySet(division) {
  const div = resolveDivision(division);
  let set = _sets.get(div);
  if (!set) {
    set = new Set(UK_BANK_HOLIDAYS[div].events.map((e) => e.date));
    _sets.set(div, set);
  }
  return set;
}

function titleMap(division) {
  const div = resolveDivision(division);
  let map = _titles.get(div);
  if (!map) {
    map = new Map(UK_BANK_HOLIDAYS[div].events.map((e) => [e.date, e.title || '']));
    _titles.set(div, map);
  }
  return map;
}

/** Official GOV.UK title for a bank holiday date, or '' when not a holiday. */
export function bankHolidayTitle(iso, division = DEFAULT_DIVISION) {
  return titleMap(division).get(iso) || '';
}

export function calendarMeta() {
  return UK_BANK_HOLIDAYS_META;
}

export function bankHolidayEvents(division = DEFAULT_DIVISION) {
  return UK_BANK_HOLIDAYS[resolveDivision(division)].events.slice();
}

export function bankHolidayDates(division = DEFAULT_DIVISION, { fromISO = null, toISO = null } = {}) {
  return UK_BANK_HOLIDAYS[resolveDivision(division)].events
    .map((e) => e.date)
    .filter((d) => (!fromISO || d >= fromISO) && (!toISO || d <= toISO));
}

/** Rota DEFAULT_SETTINGS seed: current calendar year through the bundled horizon. */
export function defaultBankHolidays(division = DEFAULT_DIVISION) {
  const year = new Date().getFullYear();
  return bankHolidayDates(division, { fromISO: `${year}-01-01` });
}

export function calendarHorizonISO(division = DEFAULT_DIVISION) {
  const dates = bankHolidayDates(division);
  return dates.length ? dates[dates.length - 1] : null;
}

/**
 * True when `iso` falls inside a calendar year the bundled data covers.
 * GOV.UK publishes whole calendar years, so the year-end of the last bundled
 * event is the honest coverage edge. Beyond it, isBankHoliday() would
 * silently answer "no" for a New Year's Day it has never heard of — callers
 * that make a claim from that answer must check this first.
 */
export function calendarCoversISO(iso, division = DEFAULT_DIVISION) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const horizon = calendarHorizonISO(division);
  return !!horizon && iso <= horizon.slice(0, 4) + '-12-31';
}

export function monthsUntilHorizon(division = DEFAULT_DIVISION, asOfISO = null) {
  const horizon = calendarHorizonISO(division);
  if (!horizon) return 0;
  const asOf = asOfISO ? parseISO(asOfISO) : new Date();
  const target = parseISO(horizon);
  return (target.getFullYear() - asOf.getFullYear()) * 12 + (target.getMonth() - asOf.getMonth());
}

export function isBankHoliday(iso, division = DEFAULT_DIVISION) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  return holidaySet(division).has(iso);
}

export function isWeekend(iso) {
  const dow = parseISO(iso).getDay();
  return dow === 0 || dow === 6;
}

/** Open for core English GP hours: weekday and not a bank holiday. */
export function isWorkingDay(iso, division = DEFAULT_DIVISION) {
  return !isWeekend(iso) && !isBankHoliday(iso, division);
}

export function addDaysISO(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/**
 * First working day strictly after `iso` (skips weekends and bank holidays).
 * Walks multi-day Christmas / Easter blocks correctly.
 */
export function firstWorkingDayAfter(iso, division = DEFAULT_DIVISION) {
  let d = addDaysISO(iso, 1);
  // Hard cap avoids infinite loops on a corrupted empty calendar.
  for (let i = 0; i < 30; i++) {
    if (isWorkingDay(d, division)) return d;
    d = addDaysISO(d, 1);
  }
  throw new Error(`No working day found within 30 days after ${iso}`);
}

/**
 * Contiguous closed block (weekends + bank holidays) containing `iso`.
 * Returns null when `iso` is a working day.
 */
export function holidayBlockContaining(iso, division = DEFAULT_DIVISION) {
  if (isWorkingDay(iso, division)) return null;
  let start = iso;
  let end = iso;
  while (true) {
    const prev = addDaysISO(start, -1);
    if (isWorkingDay(prev, division)) break;
    start = prev;
  }
  while (true) {
    const next = addDaysISO(end, 1);
    if (isWorkingDay(next, division)) break;
    end = next;
  }
  const bankHolidays = [];
  const titles = [];
  for (let d = start; d <= end; d = addDaysISO(d, 1)) {
    if (isBankHoliday(d, division)) {
      bankHolidays.push(d);
      titles.push(bankHolidayTitle(d, division));
    }
  }
  const closedDays = Math.round((parseISO(end) - parseISO(start)) / 86400000) + 1;
  return { start, end, bankHolidays, titles, closedDays, division: resolveDivision(division) };
}

/**
 * Closed block immediately before a working day `iso` (post-holiday rebound day).
 * Null when the previous calendar day was also a working day.
 */
export function closedBlockBefore(iso, division = DEFAULT_DIVISION) {
  const prev = addDaysISO(iso, -1);
  return holidayBlockContaining(prev, division);
}

/**
 * Tomorrow, or the next weekday that is not a bank holiday.
 * Drop-in replacement for the previous weekend-only helper.
 */
export function nextWorkingDayISO(division = DEFAULT_DIVISION, fromISO = null) {
  const from = fromISO || toISO(new Date());
  return firstWorkingDayAfter(from, division);
}
