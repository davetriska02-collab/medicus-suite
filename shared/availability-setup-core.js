// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Availability wall setup canvas. Pure. No DOM, no chrome, no fetch.
//
// One catalog name belongs on one tile. A name is a slot type, a session,
// or a diary read from the appointment book. The same words in two of those
// lists are two names.
//
// Dragging writes the exact folded name into that tile's match list and
// takes it off every other tile. If another tile still has a broader pattern
// that would match the name, the exact name is added to that tile's exclude
// list so the pattern cannot steal the slots.
//
// Typed pattern rules are left in place. They still match through the same
// whole-word rules as the wall.
//
// Opening the canvas does not rewrite a saved mapping. A name that was
// already stored on two tiles stays there until someone moves or removes it.
// The wall still counts each slot once, on the earlier tile. The canvas
// warns, and the preview uses that same rule.

import {
  MATCH_LIST_MAX,
  assignSlots,
  foldText,
  isMappableName,
  nameAllowsRemote,
  normaliseConfig,
  textHitsNeedle,
  tileAllowsRemoteSlots,
  tileForSlot,
} from './availability-board-core.js';

export { MATCH_LIST_MAX };

/** Safe default: one pot per catalog name. Duplicates already saved are kept until edited. */
export const ONE_POT_PER_ITEM = true;

const KINDS = [
  ['types', 'Slot type'],
  ['sessions', 'Session'],
  ['roles', 'Diary'],
];
const KIND_SET = new Set(KINDS.map((row) => row[0]));

const UNDO_LIMIT = 40;

export function slotField(slot, kind) {
  if (!slot) return '';
  if (kind === 'types') return slot.slotType || '';
  if (kind === 'sessions') return slot.sessionName || '';
  return slot.clinician || '';
}

function rememberName(map, raw) {
  const name = String(raw || '').trim();
  if (!name) return;
  const folded = foldText(name);
  if (!folded || map.has(folded)) return;
  map.set(folded, name);
}

/**
 * One row per folded name in each list. Upcoming-slot counts are how many
 * free slots carry that exact field. Cheap: one pass over the slots already
 * in memory.
 */
export function buildCatalog(observed, slots) {
  const src = observed && typeof observed === 'object' ? observed : {};
  const lists = {
    types: src.slotTypes,
    sessions: src.sessions,
    roles: src.clinicians,
  };
  const items = [];
  for (const [kind, label] of KINDS) {
    const names = new Map();
    for (const raw of Array.isArray(lists[kind]) ? lists[kind] : []) rememberName(names, raw);
    for (const slot of slots || []) rememberName(names, slotField(slot, kind));
    for (const [folded, name] of names) {
      let count = 0;
      for (const slot of slots || []) {
        if (foldText(slotField(slot, kind)) === folded) count += 1;
      }
      items.push({
        id: `${kind}:${folded}`,
        kind,
        kindLabel: label,
        name,
        folded,
        count,
        mappable: isMappableName(name),
      });
    }
  }
  items.sort((a, b) => {
    if (a.mappable !== b.mappable) return a.mappable ? -1 : 1;
    const ka = KINDS.findIndex((row) => row[0] === a.kind);
    const kb = KINDS.findIndex((row) => row[0] === b.kind);
    if (ka !== kb) return ka - kb;
    return a.name.localeCompare(b.name);
  });
  return items;
}

export function migrateConfig(raw) {
  return normaliseConfig(raw);
}

/** Match and exclude lists only, so a read of the canvas can be compared to a save. */
export function mappingSignature(config) {
  const cfg = normaliseConfig(config);
  return {
    confirmed: cfg.confirmed === true,
    pollMinutes: cfg.pollMinutes,
    tiles: cfg.tiles.map((t) => ({
      id: t.id,
      label: t.label,
      matchOrder: t.matchOrder,
      displayOrder: t.displayOrder,
      match: t.match,
      exclude: t.exclude,
    })),
  };
}

function orderedTiles(config) {
  return normaliseConfig(config)
    .tiles.slice()
    .sort((a, b) => a.matchOrder - b.matchOrder || a.displayOrder - b.displayOrder);
}

function excludedName(tile, kind, item) {
  return (tile.exclude[kind] || []).some((n) => n === item.folded || textHitsNeedle(item.name, n));
}

function patternHits(tile, kind, folded, name) {
  return (tile.match[kind] || []).some((n) => n !== folded && textHitsNeedle(name, n));
}

function homesFor(tiles, item) {
  if (!item.mappable) return [];
  const homes = [];
  for (const tile of tiles) {
    if (excludedName(tile, item.kind, item)) continue;
    const list = tile.match[item.kind] || [];
    if (list.includes(item.folded)) homes.push({ id: tile.id, label: tile.label, how: 'exact' });
    else if (list.some((n) => textHitsNeedle(item.name, n))) {
      homes.push({ id: tile.id, label: tile.label, how: 'pattern' });
    }
  }
  return homes;
}

function slotLanding(slots, tiles, item) {
  const mine = (slots || []).filter((slot) => foldText(slotField(slot, item.kind)) === item.folded);
  const byTile = {};
  let unmapped = 0;
  for (const slot of mine) {
    const tile = tileForSlot(slot, tiles);
    if (!tile) unmapped += 1;
    else byTile[tile.id] = (byTile[tile.id] || 0) + 1;
  }
  return { total: mine.length, byTile, unmapped };
}

function duplicateWarning(item, homes) {
  if (homes.length < 2) return '';
  const winner = homes[0];
  const labels = homes.map((home) => home.label);
  return `${item.name} is listed on ${labels.join(' and ')}. Only ${winner.label} is counted. One name belongs on one tile. Drag it onto that tile, or press Remove on the other.`;
}

function strayWarning(item, homes, landing, tiles) {
  if (!homes.length || !landing.total) return '';
  const winner = homes[0].id;
  const elsewhere = landing.total - (landing.byTile[winner] || 0);
  if (elsewhere <= 0) return '';
  const bits = [];
  for (const tile of tiles) {
    const n = landing.byTile[tile.id] || 0;
    if (!n || tile.id === winner) continue;
    bits.push(`${n} on ${tile.label}`);
  }
  if (landing.unmapped) bits.push(`${landing.unmapped} not on a tile`);
  return `${elsewhere} ${item.name} slot${elsewhere === 1 ? '' : 's'} ${elsewhere === 1 ? 'is' : 'are'} counted somewhere else (${bits.join(', ')}). Another rule matches first. The preview is the count that would be saved.`;
}

export function placementReport(config, catalog, slots) {
  const tiles = orderedTiles(config);
  return (catalog || []).map((item) => {
    const homes = homesFor(tiles, item);
    const landing = slotLanding(slots, tiles, item);
    const warning = duplicateWarning(item, homes);
    const stray = strayWarning(item, homes, landing, tiles);
    return {
      item,
      homes,
      winnerId: homes.length ? homes[0].id : '',
      duplicate: homes.length > 1,
      warning,
      stray,
    };
  });
}

function cloneConfig(config) {
  return normaliseConfig(JSON.parse(JSON.stringify(normaliseConfig(config))));
}

function blockedByOwnExclude(tile, kind, folded, name) {
  return (tile.exclude[kind] || []).some((n) => n !== folded && textHitsNeedle(name, n));
}

/**
 * Put a name on one tile, or on none when tileId is null.
 * Does not rewrite unrelated pattern needles. Does not set confirmed.
 */
export function placeItem(config, item, tileId) {
  const kept = normaliseConfig(config);
  if (!item || !KIND_SET.has(item.kind) || !isMappableName(item && item.name)) {
    return { ok: false, config: kept, reason: 'short', notice: '' };
  }
  const kind = item.kind;
  const folded = foldText(item.name);
  const name = item.name;
  const base = cloneConfig(config);
  const target = tileId ? base.tiles.find((t) => t.id === tileId) : null;
  if (tileId && !target) return { ok: false, config: kept, reason: 'missing', notice: '' };
  if (target && blockedByOwnExclude(target, kind, folded, name)) {
    return { ok: false, config: kept, reason: 'excluded', notice: '' };
  }

  const allowedBefore = target ? tileAllowsRemoteSlots(target) : false;
  for (const tile of base.tiles) {
    const stripped = (tile.match[kind] || []).filter((n) => n !== folded);
    if (target && tile.id === target.id && stripped.length >= MATCH_LIST_MAX) {
      return { ok: false, config: kept, reason: 'full', notice: '' };
    }
    const needsExclude = (!target || tile.id !== target.id) && stripped.some((n) => textHitsNeedle(name, n));
    if (
      needsExclude &&
      !(tile.exclude[kind] || []).includes(folded) &&
      (tile.exclude[kind] || []).length >= MATCH_LIST_MAX
    ) {
      return { ok: false, config: kept, reason: 'full', notice: '' };
    }
  }

  for (const tile of base.tiles) {
    tile.match[kind] = (tile.match[kind] || []).filter((n) => n !== folded);
  }
  if (target && !target.match[kind].includes(folded)) target.match[kind] = target.match[kind].concat(folded);
  if (target) target.exclude[kind] = (target.exclude[kind] || []).filter((n) => n !== folded);
  for (const tile of base.tiles) {
    if (target && tile.id === target.id) continue;
    if (patternHits(tile, kind, folded, name)) {
      if (!tile.exclude[kind].includes(folded)) tile.exclude[kind] = tile.exclude[kind].concat(folded);
    } else {
      tile.exclude[kind] = (tile.exclude[kind] || []).filter((n) => n !== folded);
    }
  }

  let notice = '';
  if (target && !allowedBefore && nameAllowsRemote(name)) {
    notice = `${name} is a telephone or video name. Saving it on ${target.label} counts those slots on that tile.`;
  }
  return { ok: true, config: normaliseConfig(base), reason: null, notice };
}

export function unmapItem(config, item) {
  return placeItem(config, item, null);
}

/** Take a name off one tile. The last tile clears it, including a pattern that would put it back. */
export function removeFromPot(config, item, tileId) {
  const kept = normaliseConfig(config);
  if (!item || !KIND_SET.has(item.kind) || !isMappableName(item && item.name)) {
    return { ok: false, config: kept, reason: 'short', notice: '' };
  }
  const kind = item.kind;
  const folded = foldText(item.name);
  const base = cloneConfig(config);
  const tile = base.tiles.find((t) => t.id === tileId);
  if (!tile) return { ok: false, config: kept, reason: 'missing', notice: '' };
  const others = base.tiles.filter((t) => t.id !== tileId && (t.match[kind] || []).includes(folded));
  if (!others.length) return unmapItem(config, item);
  tile.match[kind] = (tile.match[kind] || []).filter((n) => n !== folded);
  if (patternHits(tile, kind, folded, item.name)) {
    if (!tile.exclude[kind].includes(folded)) {
      if (tile.exclude[kind].length >= MATCH_LIST_MAX) {
        return { ok: false, config: kept, reason: 'full', notice: '' };
      }
      tile.exclude[kind] = tile.exclude[kind].concat(folded);
    }
  }
  return { ok: true, config: normaliseConfig(base), reason: null, notice: '' };
}

export function previewAssignment(slots, config) {
  const cfg = normaliseConfig(config);
  const { byId, unmapped } = assignSlots(slots || [], cfg.tiles);
  const tiles = cfg.tiles
    .slice()
    .sort((a, b) => a.displayOrder - b.displayOrder || a.label.localeCompare(b.label))
    .map((tile) => ({
      id: tile.id,
      label: tile.label,
      count: (byId[tile.id] || []).length,
      onWall: tile.showOnToday && !tile.hidden,
    }));
  return { tiles, unmapped: (unmapped || []).length };
}

export function pushUndo(stack, config) {
  const snap = JSON.stringify(normaliseConfig(config));
  const next = (Array.isArray(stack) ? stack : []).concat(snap);
  return next.length > UNDO_LIMIT ? next.slice(next.length - UNDO_LIMIT) : next;
}

export function popUndo(stack) {
  const list = Array.isArray(stack) ? stack.slice() : [];
  if (!list.length) return { stack: list, config: null };
  const snap = list.pop();
  return { stack: list, config: normaliseConfig(JSON.parse(snap)) };
}

function queryHit(item, query) {
  const q = String(query || '')
    .trim()
    .toLowerCase();
  if (!q) return true;
  return item.name.toLowerCase().includes(q) || item.kindLabel.toLowerCase().includes(q);
}

function chipFrom(row, potId) {
  const home = row.homes.find((item) => item.id === potId) || null;
  return {
    id: row.item.id,
    name: row.item.name,
    kind: row.item.kind,
    kindLabel: row.item.kindLabel,
    count: row.item.count,
    mappable: row.item.mappable,
    how: home ? home.how : 'none',
    potId: potId || '',
    duplicate: row.duplicate,
    badge:
      home && home.how === 'pattern'
        ? 'Pattern'
        : row.duplicate && home && home.id !== row.winnerId
          ? 'Also listed'
          : '',
    removeMode: row.homes.filter((item) => item.how === 'exact').length > 1 ? 'pot' : 'all',
  };
}

/**
 * View model for the canvas. Read-only: the saved mapping is not rewritten.
 * Palette rows are names the wall would not claim. Pot chips are the names
 * that tile claims, including a pattern claim.
 */
export function setupView(config, observed, slots, ui) {
  const cfg = normaliseConfig(config);
  const opts = ui || {};
  const kind = KIND_SET.has(opts.kind) ? opts.kind : 'all';
  const catalog = buildCatalog(observed, slots);
  const report = placementReport(cfg, catalog, slots || []);
  const preview = previewAssignment(slots, cfg);
  const warnings = [];
  for (const row of report) {
    if (row.warning) warnings.push(row.warning);
    if (row.stray) warnings.push(row.stray);
  }
  const visible = (item) => queryHit(item, opts.query) && (kind === 'all' || item.kind === kind);
  const palette = report
    .filter((row) => !row.homes.length)
    .map((row) => chipFrom(row, ''))
    .filter((chip) => visible(chip));
  const pots = cfg.tiles
    .slice()
    .sort((a, b) => a.displayOrder - b.displayOrder || a.label.localeCompare(b.label))
    .map((tile) => {
      const all = report
        .filter((row) => row.homes.some((home) => home.id === tile.id))
        .map((row) => chipFrom(row, tile.id));
      const chips = all.filter((chip) => visible(chip));
      const face = preview.tiles.find((row) => row.id === tile.id);
      return {
        id: tile.id,
        label: tile.label,
        subtitle: tile.subtitle || '',
        hidden: !!tile.hidden,
        showOnToday: !!tile.showOnToday,
        immediate: tile.immediate !== false,
        weekLane: tile.weekLane || '',
        match: tile.match,
        exclude: tile.exclude,
        count: face ? face.count : 0,
        onWall: face ? face.onWall : false,
        chips,
        hiddenBySearch: all.length - chips.length,
      };
    });
  return {
    palette,
    pots,
    warnings,
    preview,
    pollMinutes: cfg.pollMinutes,
    tileOptions: pots.map((pot) => ({ id: pot.id, label: pot.label })),
    emptyBook: catalog.length === 0,
    query: String(opts.query || ''),
    kind,
  };
}

export function reasonText(reason, tileLabel) {
  if (reason === 'full') {
    return `That tile already has ${MATCH_LIST_MAX} names. Remove one, or use a pattern rule.`;
  }
  if (reason === 'excluded') {
    return `${tileLabel || 'That tile'} has a pattern that excludes this name. Edit the pattern rules on that tile first.`;
  }
  if (reason === 'missing') return 'That tile is not on the page.';
  if (reason === 'short') return 'That name is shorter than 3 letters, so it cannot be stored on its own.';
  return '';
}
