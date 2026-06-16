// Medicus Suite — shared pill organise-mode preferences
//
// The data layer behind the per-surface "organise mode" (drag-to-reorder +
// per-item colour) used by categorical pills. Generalised from the Slots pill
// implementation so any module that renders a list of categorical pills/tiles
// can reuse one validated prefs shape, one colour-key list, and one ordering
// rule — rather than each surface keeping its own copy.
//
// Prefs shape (persisted per surface, e.g. 'slots.pillPrefs'):
//   { order: string[]            // item ids, user's preferred order
//   , colours: { [id]: key } }   // key ∈ SWATCH_KEYS (never 'default')
//
// SAFETY: the colour is the user's own organising aid, NEVER a clinical status.
// A real amber/red alert always overrides a user colour at render time, and the
// canonical .pill--red fill is locked (see panel.css / TOKENS.md). Colour keys
// map to the canonical --swatch-* tokens via the surface's pill-c-* / tile-c-*
// classes; this module owns the key LIST, panel.css owns the hex values.

'use strict';

// The fixed organising palette. Order matters (it's the swatch row order).
// 'default' means "no colour" (no --swatch token; rendered transparent).
// Kept in lock-step with Reception's TILE_COLOUR_KEYS (shared/reception-pathway-utils.js)
// and the --swatch-* tokens (panel.css) by test-pill-palette-sync.js — edit all three together.
export const SWATCH_KEYS = ['default', 'slate', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'purple', 'pink'];

// Validate raw stored prefs into a safe { order, colours } shape: order is a
// string[]; colours only keeps entries whose value is a real, non-'default'
// swatch key. Unknown keys are dropped (so a stale/poisoned config can't smuggle
// an arbitrary class name into a pill-c-* template).
export function sanitisePillPrefs(raw) {
  const out = { order: [], colours: {} };
  if (raw && typeof raw === 'object') {
    if (Array.isArray(raw.order)) out.order = raw.order.filter((t) => typeof t === 'string');
    if (raw.colours && typeof raw.colours === 'object') {
      for (const [id, key] of Object.entries(raw.colours)) {
        if (typeof id === 'string' && SWATCH_KEYS.includes(key) && key !== 'default') out.colours[id] = key;
      }
    }
  }
  return out;
}

// Reorder [id, value] entries by the user's saved order: saved ids first (in
// saved order, if still present), then any remaining entries in their incoming
// (default) order. Entries not in savedOrder keep their relative order, so a
// new item that appeared since the user last organised simply trails the list.
export function applyPillOrder(entries, savedOrder) {
  if (!Array.isArray(savedOrder) || savedOrder.length === 0) return entries;
  const present = new Map(entries);
  const out = [];
  for (const id of savedOrder) {
    if (present.has(id)) {
      out.push([id, present.get(id)]);
      present.delete(id);
    }
  }
  for (const [id, value] of entries) if (present.has(id)) out.push([id, value]);
  return out;
}
