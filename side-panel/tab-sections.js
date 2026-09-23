// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — tab section scheme A (pure; no DOM, no chrome)
//
// Menu and command-palette grouping only. This is NOT the strip order.
// The strip stays the flat DOM order shipped in panel.html / pop-out.html.
// Phrases is not in this build. Rota manager and Duplicates are off the
// strip; they still belong to Practice.

'use strict';

// Nothing sits above the sections. Kept so callers can still ask.
export const PINNED_IDS = [];

// Full-tab launchers. Kept out of the strip, the digit jump, and the arrow cycle.
export const OFF_STRIP_IDS = ['rota-app', 'duplicate-checker'];

export const TAB_SECTIONS = [
  {
    id: 'triage',
    label: 'Triage',
    ids: ['slots'],
  },
  {
    id: 'qof-tools',
    label: 'QOF tools',
    ids: ['sweep', 'signing'],
  },
  {
    id: 'with-patient',
    label: 'With the patient',
    ids: ['sentinel', 'record', 'trends', 'patient-alerts'],
  },
  {
    id: 'desk',
    label: 'Desk',
    ids: ['reception', 'submissions'],
  },
  {
    id: 'practice',
    label: 'Practice',
    ids: ['capacity', 'activity', 'referrals', 'rota', 'rota-app', 'duplicate-checker'],
  },
  {
    id: 'reference',
    label: 'Reference',
    ids: ['knowledge', 'leaflets'],
  },
];

const SECTION_BY_ID = new Map();
for (const section of TAB_SECTIONS) {
  for (const id of section.ids) SECTION_BY_ID.set(id, section);
}

// Palette badge. An id this map does not know keeps the old 'Tab' badge.
export function paletteGroupFor(moduleId) {
  if (PINNED_IDS.includes(moduleId)) return '';
  return SECTION_BY_ID.get(moduleId)?.label || 'Tab';
}

// Each section's ids, in scheme order. Pinned ids, if any, come first.
export function orderedMenuIds() {
  return [...PINNED_IDS, ...TAB_SECTIONS.flatMap((section) => section.ids)];
}

// First nine jumpable ids. Off-strip launchers are never numbered, even if a
// stored order still mentions them.
export function digitJumpIds(ids) {
  const skip = new Set(OFF_STRIP_IDS);
  return (Array.isArray(ids) ? ids : []).filter((id) => !skip.has(id)).slice(0, 9);
}

// "1 Slots, 2 Monitoring, …" for the help popover title. At most nine.
export function digitJumpCaption(labels) {
  const list = Array.isArray(labels) ? labels : [];
  return list
    .slice(0, 9)
    .map((name, i) => `${i + 1} ${String(name ?? '').trim()}`)
    .join(', ');
}

// entries: { id, label, icon?, active?, hidden? }
// Hidden entries are dropped. Empty sections are dropped. Unknown ids are
// appended after the known sections so a new tab is still reachable.
export function groupTabMenu(entries) {
  const byId = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || entry.hidden || !entry.id || byId.has(entry.id)) continue;
    byId.set(entry.id, entry);
  }

  const out = [];
  const take = (id, sectionLabel) => {
    const entry = byId.get(id);
    if (!entry) return null;
    byId.delete(id);
    return {
      kind: 'item',
      id: entry.id,
      label: entry.label || entry.id,
      icon: entry.icon || '',
      active: !!entry.active,
      section: sectionLabel || '',
    };
  };

  for (const id of PINNED_IDS) {
    const item = take(id, '');
    if (item) out.push(item);
  }

  for (const section of TAB_SECTIONS) {
    const items = [];
    for (const id of section.ids) {
      const item = take(id, section.label);
      if (item) items.push(item);
    }
    if (!items.length) continue;
    out.push({ kind: 'heading', id: section.id, label: section.label });
    out.push(...items);
  }

  for (const entry of byId.values()) {
    out.push({
      kind: 'item',
      id: entry.id,
      label: entry.label || entry.id,
      icon: entry.icon || '',
      active: !!entry.active,
      section: '',
    });
  }
  return out;
}

function menuButton(entry, safe) {
  const active = entry.active ? ' active' : '';
  return (
    `<button class="alltabs-item${active}" role="menuitem" data-module="${safe(entry.id)}">` +
    `<span class="alltabs-item-icon" aria-hidden="true">${entry.icon || ''}</span>` +
    `<span class="alltabs-item-label">${safe(entry.label)}</span>` +
    '</button>'
  );
}

// Icon HTML is trusted (our own SVG). Labels and ids go through `esc`.
// Pinned rows sit in a plain wrapper — no group name, so they are not under a parent.
export function renderTabMenuHTML(entries, esc) {
  const safe = typeof esc === 'function' ? esc : (value) => String(value ?? '');
  const grouped = groupTabMenu(entries);
  const chunks = [];
  let buttons = [];
  let heading = null;

  const flush = () => {
    if (!buttons.length && !heading) return;
    if (heading) {
      chunks.push(
        `<div class="alltabs-group" role="group" aria-label="${safe(heading.label)}">` +
          `<div class="alltabs-section" data-section="${safe(heading.id)}" aria-hidden="true">${safe(heading.label)}</div>` +
          buttons.join('') +
          '</div>'
      );
    } else {
      chunks.push(`<div class="alltabs-group">${buttons.join('')}</div>`);
    }
    buttons = [];
    heading = null;
  };

  for (const entry of grouped) {
    if (entry.kind === 'heading') {
      flush();
      heading = entry;
      continue;
    }
    // A section-less row after a headed group (an unknown tab) starts a new wrapper.
    if (!entry.section && heading) flush();
    buttons.push(menuButton(entry, safe));
  }
  flush();
  return chunks.join('');
}
