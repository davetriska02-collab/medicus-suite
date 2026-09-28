// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Markup for the availability-wall setup canvas. No chrome, no fetch.
// Events are bound by wall.js. Keyboard mapping is the Move menu on each name.

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function enc(id) {
  return encodeURIComponent(id);
}

function listValue(list) {
  return (list || []).join(', ');
}

function moveMenu(chip, options) {
  if (!chip.mappable) {
    return '<p class="av-chip-note">Fewer than 3 letters. Use a pattern rule.</p>';
  }
  const current = chip.potId || '';
  const opts = [`<option value="">Not on a tile</option>`]
    .concat(
      (options || []).map(
        (pot) => `<option value="${esc(pot.id)}"${pot.id === current ? ' selected' : ''}>${esc(pot.label)}</option>`
      )
    )
    .join('');
  return `<label class="av-chip-move">Move
    <select id="av-map-${esc(enc(chip.id))}" data-map-item="${esc(chip.id)}" aria-label="Move ${esc(chip.name)} to a tile">${opts}</select>
  </label>`;
}

function chipHtml(chip, options, draggingId) {
  const dragging = draggingId && draggingId === chip.id ? ' is-dragging' : '';
  const badge = chip.badge ? `<span class="av-chip-badge">${esc(chip.badge)}</span>` : '';
  const count = `${chip.count} upcoming`;
  const drag = chip.mappable
    ? `<button type="button" class="av-chip-drag" draggable="true" data-drag-item="${esc(chip.id)}" aria-label="${esc(chip.name)}, ${esc(chip.kindLabel)}, ${esc(count)}. Drag onto a tile, or use Move.">
        <span class="av-chip-kind">${esc(chip.kindLabel)}</span>
        <span class="av-chip-name">${esc(chip.name)}</span>
        <span class="av-chip-count">${esc(String(chip.count))}</span>
        ${badge}
      </button>`
    : `<div class="av-chip-drag" data-drag-item="${esc(chip.id)}">
        <span class="av-chip-kind">${esc(chip.kindLabel)}</span>
        <span class="av-chip-name">${esc(chip.name)}</span>
        <span class="av-chip-count">${esc(String(chip.count))}</span>
      </div>`;
  const pin =
    chip.how === 'pattern' && chip.potId
      ? `<button type="button" class="av-chip-pin" data-pin-item="${esc(chip.id)}" data-pin-pot="${esc(chip.potId)}">Pin here</button>`
      : '';
  const remove = chip.potId
    ? `<button type="button" class="av-chip-remove" data-remove-item="${esc(chip.id)}" data-remove-pot="${esc(chip.potId)}">Remove</button>`
    : '';
  return `<li class="av-chip${dragging}" data-item="${esc(chip.id)}">${drag}${moveMenu(chip, options)}${pin}${remove}</li>`;
}

function ruleField(pot, bucket, kind, label) {
  const value = listValue(pot[bucket] && pot[bucket][kind]);
  const id = `av-rule-${pot.id}-${bucket}-${kind}`;
  return `<label class="av-rule" for="${esc(id)}">${esc(label)}
    <input type="text" id="${esc(id)}" data-rule="${esc(bucket)}.${esc(kind)}" value="${esc(value)}" />
  </label>`;
}

function potHtml(pot, options, draggingId, dragOver, openDetails) {
  const over = dragOver === pot.id ? ' is-over' : '';
  const settingsOpen = openDetails && openDetails.includes(`settings:${pot.id}`) ? ' open' : '';
  const rulesOpen = openDetails && openDetails.includes(`rules:${pot.id}`) ? ' open' : '';
  const where = pot.onWall ? 'On today’s wall' : 'Not on today’s wall';
  const hiddenNote = pot.hiddenBySearch
    ? `<p class="av-pot-hidden">${pot.hiddenBySearch} hidden by the search</p>`
    : '';
  const chips = pot.chips.length
    ? pot.chips.map((chip) => chipHtml(chip, options, draggingId)).join('')
    : '<li class="av-pot-empty">Drop a slot type, session or diary here.</li>';
  return `<section class="av-pot${over}" data-drop="${esc(pot.id)}" aria-label="${esc(pot.label)} tile">
    <header class="av-pot-head">
      <label class="av-pot-name">Tile name
        <input type="text" id="av-label-${esc(pot.id)}" data-tile-label="${esc(pot.id)}" value="${esc(pot.label)}" />
      </label>
      <p class="av-pot-count"><span class="av-num">${esc(String(pot.count))}</span> ${esc(where)}</p>
    </header>
    <ul class="av-chip-list">${chips}</ul>
    ${hiddenNote}
    <details class="av-details" data-details="rules:${esc(pot.id)}"${rulesOpen}>
      <summary>Pattern rules</summary>
      <p class="av-details-lead">Whole words. A name you drag is added here as well. Clearing a word takes it off the tile. A broader word, such as nurse, still matches every name that contains it.</p>
      ${ruleField(pot, 'match', 'types', 'Slot types')}
      ${ruleField(pot, 'match', 'sessions', 'Session or diary names')}
      ${ruleField(pot, 'match', 'roles', 'Clinician roles')}
      ${ruleField(pot, 'exclude', 'types', 'Exclude types')}
      ${ruleField(pot, 'exclude', 'sessions', 'Exclude sessions')}
      ${ruleField(pot, 'exclude', 'roles', 'Exclude roles')}
    </details>
    <details class="av-details" data-details="settings:${esc(pot.id)}"${settingsOpen}>
      <summary>Tile settings</summary>
      <div class="av-row">
        <label>Subtitle <input type="text" data-tile-field="subtitle" data-tile="${esc(pot.id)}" value="${esc(pot.subtitle)}" /></label>
        <label><input type="checkbox" data-tile-flag="hidden" data-tile="${esc(pot.id)}" ${pot.hidden ? 'checked' : ''} /> Hide</label>
        <label><input type="checkbox" data-tile-flag="showOnToday" data-tile="${esc(pot.id)}" ${pot.showOnToday ? 'checked' : ''} /> Today</label>
        <label><input type="checkbox" data-tile-flag="immediate" data-tile="${esc(pot.id)}" ${pot.immediate ? 'checked' : ''} /> For immediate booking</label>
        <label>Week
          <select data-tile-field="weekLane" data-tile="${esc(pot.id)}">
            <option value="" ${!pot.weekLane ? 'selected' : ''}>Not in the 7-day view</option>
            <option value="routine" ${pot.weekLane === 'routine' ? 'selected' : ''}>Routine GP</option>
            <option value="extended" ${pot.weekLane === 'extended' ? 'selected' : ''}>Extended access</option>
          </select>
        </label>
        <button type="button" data-move="-1" data-tile="${esc(pot.id)}">Match sooner</button>
        <button type="button" data-move="1" data-tile="${esc(pot.id)}">Match later</button>
      </div>
    </details>
  </section>`;
}

function filterButton(kind, current, label) {
  const pressed = kind === current ? 'true' : 'false';
  return `<button type="button" class="av-filter" id="av-filter-${esc(kind)}" data-kind="${esc(kind)}" aria-pressed="${pressed}">${esc(label)}</button>`;
}

/**
 * @param {object} view from setupView, plus draggingId, dragOver, openDetails
 */
export function renderSetup(view) {
  const state = view || {};
  const options = state.tileOptions || [];
  const draggingId = state.draggingId || '';
  const dragOver = state.dragOver || '';
  const openDetails = state.openDetails || [];
  const paletteOver = dragOver === 'palette' ? ' is-over' : '';
  const paletteChips = (state.palette || []).map((chip) => chipHtml(chip, options, draggingId)).join('');
  const paletteBody = state.emptyBook
    ? '<p class="av-palette-empty">No names from the book yet. The list fills after a reading. Pattern rules still work.</p>'
    : paletteChips
      ? `<ul class="av-chip-list">${paletteChips}</ul>`
      : '<p class="av-palette-empty">Every discovered name is on a tile.</p>';
  const warnings = (state.warnings || []).length
    ? `<div class="av-warnings" role="status">${state.warnings
        .map((text) => `<p class="av-warn">Warning. ${esc(text)}</p>`)
        .join('')}</div>`
    : '';
  const previewTiles = (state.preview && state.preview.tiles ? state.preview.tiles : [])
    .map((tile) => {
      const where = tile.onWall ? 'on today’s wall' : 'not on today’s wall';
      return `<li><span class="av-preview-label">${esc(tile.label)}</span> <span class="av-num">${esc(String(tile.count))}</span> <span class="av-preview-where">${esc(where)}</span></li>`;
    })
    .join('');
  const unmapped = state.preview ? state.preview.unmapped : 0;
  const pots = (state.pots || []).map((pot) => potHtml(pot, options, draggingId, dragOver, openDetails)).join('');
  return `<div class="av-canvas">
    <section class="av-palette${paletteOver}" data-drop="palette" aria-label="Names not on a tile">
      <div class="av-palette-head">
        <h3>Not on a tile</h3>
        <label class="av-search" for="avSetupSearch">Search
          <input type="search" id="avSetupSearch" placeholder="Slot type, session or diary" value="${esc(state.query || '')}" autocomplete="off" />
        </label>
        <div class="av-filters" role="group" aria-label="Which names to show">
          ${filterButton('all', state.kind || 'all', 'All')}
          ${filterButton('types', state.kind || 'all', 'Slot types')}
          ${filterButton('sessions', state.kind || 'all', 'Sessions')}
          ${filterButton('roles', state.kind || 'all', 'Diaries')}
        </div>
      </div>
      ${paletteBody}
      <p class="av-drop-hint">Drop a name here to take it off its tile.</p>
    </section>
    <div class="av-pots">
      <section class="av-preview" aria-live="polite">
        <h3>If you save now</h3>
        <ul class="av-preview-list">${previewTiles}</ul>
        <p class="av-preview-unmapped"><span class="av-num">${esc(String(unmapped))}</span> free slot${unmapped === 1 ? '' : 's'} not on a tile</p>
      </section>
      ${warnings}
      <div class="av-pot-grid">${pots}</div>
      <p class="av-poll"><label>Refresh every
        <input type="number" id="avPoll" min="2" max="30" step="1" value="${esc(state.pollMinutes)}" /> minutes (2–30). Today uses this. Later days are every 30 minutes, and nothing runs from 19:00 to 07:00.
      </label></p>
    </div>
  </div>`;
}
