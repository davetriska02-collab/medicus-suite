// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — First-available appointment: pure-logic core (no chrome APIs,
// no DOM, no fetch).
//
// The "when is the next FCP?" question is a READ — the component that renders
// it (first-available.js) never books, reserves, or writes anything. What
// lives here is everything a test can drive without a browser:
//
//   sanitiseFirstAvailFavs()  — favourites list validation (storage is
//                               untrusted: hand-edited backups, older versions)
//   toggleFavourite()         — add/remove a favourite, capped
//   firstAvailableFrom()      — earliest slot out of a findSlotsInWindow byDay
//   describeFirstAvailable()  — the desk-facing wording ("Today", "Tomorrow",
//                               "Mon 3 Aug 2026") + how far away it is
//
// Endpoints stay in shared/booking-core.js (findSlotsInWindow) — this file
// must never grow a fetch.

'use strict';

import { formatDayLabel, slotTime } from './booking-panel-core.js';

// Favourites cap — a scrolling wall of favourites defeats the point of a
// quick-glance list, and every "Check all" is (favourites × window) worth of
// credentialed calls against the practice scheduler.
export const MAX_FAVOURITES = 12;

/**
 * sanitiseFirstAvailFavs(raw) → [{ id, label }]
 *
 * Storage shape is untrusted (restored backups, future/older versions).
 * Keeps only entries with a non-empty string id and label, de-dupes by id
 * (first wins), caps at MAX_FAVOURITES.
 */
export function sanitiseFirstAvailFavs(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    const label = typeof entry.label === 'string' ? entry.label.trim() : '';
    if (!id || !label || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label });
    if (out.length >= MAX_FAVOURITES) break;
  }
  return out;
}

/**
 * toggleFavourite(favs, { id, label }) → new array (input untouched).
 *
 * Removes the favourite if present, adds it (at the end) if not. Adding past
 * MAX_FAVOURITES is a no-op — the caller shows the cap message.
 */
export function toggleFavourite(favs, fav) {
  const list = sanitiseFirstAvailFavs(favs);
  const id = fav && typeof fav.id === 'string' ? fav.id.trim() : '';
  const label = fav && typeof fav.label === 'string' ? fav.label.trim() : '';
  if (!id || !label) return list;
  const without = list.filter((f) => f.id !== id);
  if (without.length !== list.length) return without; // was present — removed
  if (list.length >= MAX_FAVOURITES) return list; // full — caller messages
  return [...list, { id, label }];
}

export function isFavourite(favs, typeId) {
  return sanitiseFirstAvailFavs(favs).some((f) => f.id === typeId);
}

/**
 * firstAvailableFrom(byDay) → { date, slot, dayCount } | null
 *
 * `byDay` is findSlotsInWindow's per-day grouping. Returns the earliest slot:
 * lowest fetched date with a non-empty array, then lowest startDateTime within
 * it. `dayCount` is how many slots that whole day held (the day's array is
 * complete — the window search fetches whole days). Null when every fetched
 * day was empty.
 */
export function firstAvailableFrom(byDay) {
  const src = byDay && typeof byDay === 'object' ? byDay : {};
  for (const date of Object.keys(src).sort()) {
    const daySlots = Array.isArray(src[date]) ? src[date] : [];
    if (daySlots.length === 0) continue;
    const sorted = daySlots
      .slice()
      .sort((a, b) => String((a && a.startDateTime) || '').localeCompare(String((b && b.startDateTime) || '')));
    return { date, slot: sorted[0], dayCount: daySlots.length };
  }
  return null;
}

// Midday-anchored day difference so a DST boundary can never make "tomorrow"
// read as "in 2 days" (same anchor discipline as booking-panel-core).
function dayDiff(fromIso, toIso) {
  const a = new Date(`${fromIso}T12:00:00`);
  const b = new Date(`${toIso}T12:00:00`);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/**
 * describeFirstAvailable(found, todayIso) → { whenText, relative } | null
 *
 * `found` is firstAvailableFrom()'s result. whenText is what the desk reads
 * out ("Today 14:30" / "Tomorrow 09:15" / "Mon 3 Aug 2026, 09:15"); relative
 * is the at-a-glance distance ("today" / "tomorrow" / "in 4 days").
 */
export function describeFirstAvailable(found, todayIso) {
  if (!found || !found.date) return null;
  const time = slotTime(found.slot);
  const diff = dayDiff(todayIso, found.date);
  let dayText;
  let relative;
  if (diff === 0) {
    dayText = 'Today';
    relative = 'today';
  } else if (diff === 1) {
    dayText = 'Tomorrow';
    relative = 'tomorrow';
  } else {
    dayText = formatDayLabel(found.date);
    relative = diff != null && diff > 1 ? `in ${diff} days` : '';
  }
  return {
    whenText: time ? (diff === 0 || diff === 1 ? `${dayText} ${time}` : `${dayText}, ${time}`) : dayText,
    relative,
  };
}

export default {
  MAX_FAVOURITES,
  sanitiseFirstAvailFavs,
  toggleFavourite,
  isFavourite,
  firstAvailableFrom,
  describeFirstAvailable,
};
