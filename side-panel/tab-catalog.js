// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — tab catalog (DATA + pure helpers, no DOM/chrome at import)
//
// Single source of truth for what each side-panel tab is, in words a brand-new
// user understands, plus the role presets offered by the tab chooser.
// test-tab-catalog.js guards parity with panel.html's data-module set — adding
// a nav tab without a catalog entry (or vice versa) fails CI.
//
// Tab visibility itself is stored in chrome.storage.local 'suite.hiddenTabs'
// (an array of ids). It is USER-OWNED: included in the user's own suite backup
// (shared/io/suite-io.js) but deliberately NOT writable by the practice-profile
// central-deployment mechanism (see shared/io/practice-profile.js — profiles
// never push suite.* preference keys).

'use strict';

export const TAB_CATALOG = [
  { id: 'today', name: 'Today', blurb: 'Your morning at a glance — waiting room, demand, slots, sweep.' },
  { id: 'slots', name: 'Slots', blurb: 'Live bookable-slot counts by appointment type.' },
  { id: 'sentinel', name: 'Monitoring', blurb: 'Per-patient alerts: drug monitoring, QOF and vaccines.' },
  { id: 'trends', name: 'Trends', blurb: 'Charts of the open patient’s BP, renal, HbA1c and weight.' },
  { id: 'capacity', name: 'Forecast', blurb: 'Calendar of future appointment capacity against your minimums.' },
  { id: 'submissions', name: 'Submissions', blurb: 'Incoming task volumes by type, with demand thresholds.' },
  { id: 'activity', name: 'Activity', blurb: 'Staff activity report over a date range.' },
  { id: 'referrals', name: 'Referrals', blurb: 'Referral audit — counts, priorities, specialties, clinicians.' },
  { id: 'condor', name: 'Condor', blurb: 'Live operations dashboard — pressure, demand gap, task age.' },
  { id: 'reception', name: 'Reception', blurb: 'Front-desk tools: guided call capture and patient status.' },
  { id: 'sweep', name: 'Sweep', blurb: 'Pre-clinic check of today’s booked patients for overdue monitoring.' },
  { id: 'knowledge', name: 'Knowledge', blurb: 'Your practice’s reference base — criteria, contacts, pathways.' },
  { id: 'leaflets', name: 'Leaflets', blurb: 'Find and share the right NHS patient information leaflet, fast.' },
  {
    id: 'record',
    name: 'Record',
    blurb: 'Live snapshot of the open patient — problems, meds, results, safety prompts. No PDF needed.',
  },
  { id: 'visualiser', name: 'Visualiser', blurb: 'Analyse an exported record PDF in a full browser tab.' },
  { id: 'about', name: 'About', blurb: 'Module info, version checks and feedback.' },
];

// One-tap starting points; users fine-tune afterwards. Every preset keeps
// Today (the home tab) and Knowledge/About-level basics reachable.
export const ROLE_PRESETS = [
  {
    id: 'gp',
    label: 'GP / clinician',
    show: ['today', 'sentinel', 'record', 'trends', 'sweep', 'slots', 'knowledge', 'leaflets', 'visualiser', 'about'],
  },
  {
    id: 'reception',
    label: 'Reception',
    show: ['today', 'reception', 'slots', 'submissions', 'knowledge', 'leaflets', 'about'],
  },
  {
    id: 'manager',
    label: 'Practice manager',
    show: ['today', 'slots', 'capacity', 'submissions', 'activity', 'referrals', 'condor', 'knowledge', 'about'],
  },
  {
    id: 'all',
    label: 'Everything',
    show: TAB_CATALOG.map((t) => t.id),
  },
];

const ALL_IDS = new Set(TAB_CATALOG.map((t) => t.id));

// hidden set for a preset = catalog minus the preset's shown tabs.
export function hiddenFromPreset(presetId) {
  const preset = ROLE_PRESETS.find((p) => p.id === presetId);
  if (!preset) return [];
  const show = new Set(preset.show);
  return TAB_CATALOG.map((t) => t.id).filter((id) => !show.has(id));
}

// Defensive load: strings only, known ids only, and never every tab — if a
// corrupt value would hide the whole nav, fall back to hiding nothing.
export function sanitiseHiddenTabs(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [...new Set(raw.filter((id) => typeof id === 'string' && ALL_IDS.has(id)))];
  return out.length >= ALL_IDS.size ? [] : out;
}

// Pure toggle used by both the side-panel chooser overlay and the options-page
// tab section. Given the current hidden set and a tab id, returns the new hidden
// array. Turning a tab ON is always allowed; turning one OFF is BLOCKED when it
// would hide the last visible tab — hiding is de-cluttering, never lock-out.
// Returns { hidden, blocked }: when blocked, `hidden` is unchanged.
export function toggleTabVisibility(hiddenIds, id) {
  const set = new Set(sanitiseHiddenTabs(hiddenIds));
  if (!ALL_IDS.has(id)) return { hidden: [...set], blocked: false };
  if (set.has(id)) {
    set.delete(id); // turning ON — always allowed
    return { hidden: [...set], blocked: false };
  }
  // turning OFF — block if it would leave nothing visible
  if (ALL_IDS.size - set.size <= 1) return { hidden: [...set], blocked: true };
  set.add(id);
  return { hidden: [...set], blocked: false };
}
