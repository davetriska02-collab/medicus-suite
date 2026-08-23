// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — tab catalog (DATA + pure helpers, no DOM/chrome at import)
//
// Single source of truth for what each side-panel tab is, in words a brand-new
// user understands, plus the role presets offered by the tab chooser, plus
// the registration fields both shells used to duplicate (entry/css paths,
// which shells load the module, g-chord letter, About-card copy).
// test-tab-catalog.js guards parity with panel.html's data-module set — adding
// a nav tab without a catalog entry (or vice versa) fails CI.
//
// Tab visibility itself is stored in chrome.storage.local 'suite.hiddenTabs'
// (an array of ids). It is USER-OWNED: included in the user's own suite backup
// (shared/io/suite-io.js) but deliberately NOT writable by the practice-profile
// central-deployment mechanism (see shared/io/practice-profile.js — profiles
// never push suite.* preference keys).

'use strict';

// kind:
//   'module'  — real ES module with init()/cleanup; lives in both shells unless
//               shells is narrowed
//   'fulltab' — nav button that opens a full browser tab (not in MODULES)
//   'about'   — inline About view (panel only; MODULES.about = null)
//
// entry/css are paths relative to side-panel/modules/. gChord is the second
// key of a "g <letter>" jump (panel only). aboutName/aboutVersion/aboutDesc
// feed the About page; omit them to keep a tab off that curated list.

export const TAB_CATALOG = [
  {
    id: 'today',
    name: 'Today',
    blurb: 'Your morning at a glance — waiting room, demand, slots, sweep.',
    kind: 'module',
    shells: ['panel', 'popout'],
    entry: 'today/today.js',
    css: 'today/today.css',
    gChord: 't',
    aboutVersion: 'v1.0',
    aboutDesc:
      'Morning command centre: waiting room, triage load, demand counts, available slots and the pre-clinic sweep — one screen answers "what does today look like?" before clinic starts.',
  },
  {
    id: 'slots',
    name: 'Slots',
    blurb: 'Live bookable-slot counts by appointment type.',
    kind: 'module',
    shells: ['panel', 'popout'],
    entry: 'slots/slots.js',
    css: 'slots/slots.css',
    gChord: 's',
    aboutName: 'Slot Counter',
    aboutVersion: 'v2.2',
    aboutDesc:
      'Available appointment slots by type for any date. API-based; no scheduling page required. Updates live via Pusher when a Medicus tab is open.',
  },
  {
    id: 'sentinel',
    name: 'Monitoring',
    blurb: 'Per-patient alerts: drug monitoring, QOF and vaccines.',
    kind: 'module',
    shells: ['panel', 'popout'],
    entry: 'sentinel/sentinel.js',
    css: 'sentinel/sentinel.css',
    gChord: 'm',
    aboutName: 'Monitoring (Sentinel)',
    aboutVersion: 'v0.5.1',
    aboutDesc:
      'Clinical context sidebar on patient records. Drug monitoring and QOF (Quality and Outcomes Framework) 25/26 indicators. Runs as a content script; requires a patient page to be open.',
    aboutPurpose: true,
  },
  {
    id: 'trends',
    name: 'Trends',
    blurb: 'Charts of the open patient’s BP, renal, HbA1c and weight.',
    kind: 'module',
    shells: ['panel', 'popout'],
    entry: 'trends/trends.js',
    css: 'trends/trends.css',
    gChord: 'n',
  },
  {
    id: 'capacity',
    name: 'Forecast',
    blurb: 'Calendar of future appointment capacity against your minimums.',
    kind: 'module',
    shells: ['panel', 'popout'],
    entry: 'capacity/capacity.js',
    css: 'capacity/capacity.css',
    gChord: 'p',
  },
  {
    id: 'submissions',
    name: 'Submissions',
    blurb: 'Incoming task volumes by type, with demand thresholds.',
    kind: 'module',
    shells: ['panel', 'popout'],
    entry: 'submissions/submissions.js',
    css: 'submissions/submissions.css',
    gChord: 'u',
    aboutName: 'Submissions Tracker',
    aboutVersion: 'v1.0',
    aboutDesc:
      'Daily inbound task counts across medical, admin, investigation and prescription categories. Today view, date range, day-vs-day comparison.',
  },
  {
    id: 'activity',
    name: 'Activity',
    blurb: 'Staff activity report over a date range.',
    kind: 'module',
    shells: ['panel', 'popout'],
    entry: 'activity/activity.js',
    css: 'activity/activity.css',
    gChord: 'a',
    aboutName: 'Activity Report',
    aboutVersion: 'v1.0',
    aboutDesc:
      'Practice activity per staff member across a configurable date range. Shows period totals and a stacked horizontal bar chart broken down by consultations, prescription requests, medication reviews, document tasks, and investigation results. API-based.',
  },
  {
    id: 'referrals',
    name: 'Referrals',
    blurb: 'Referral audit — counts, priorities, specialties, clinicians.',
    kind: 'module',
    shells: ['panel', 'popout'],
    entry: 'referrals/referrals.js',
    css: 'referrals/referrals.css',
    gChord: 'r',
    aboutName: 'Referrals Tracker',
    aboutVersion: 'v1.0',
    aboutDesc:
      'Referral audit data across a configurable date range. Shows total referral count with priority (Routine / Urgent / 2WW) and status breakdowns, plus horizontal bar charts by referring clinician, specialty, and hospital. Fetches from the Medicus clinical-audit-report endpoint. API-based.',
  },
  {
    id: 'condor',
    name: 'Condor',
    blurb: 'Live operations dashboard — pressure, demand gap, task age.',
    kind: 'module',
    shells: ['panel', 'popout'],
    entry: 'condor/condor.js',
    css: 'condor/condor.css',
    gChord: 'c',
  },
  {
    id: 'reception',
    name: 'Reception',
    blurb: 'Front-desk tools: guided call capture and patient status.',
    kind: 'module',
    shells: ['panel', 'popout'],
    entry: 'reception/reception.js',
    css: 'reception/reception.css',
    gChord: 'e',
  },
  {
    id: 'sweep',
    name: 'Sweep',
    blurb: 'Pre-clinic check of today’s booked patients for overdue monitoring.',
    kind: 'module',
    shells: ['panel', 'popout'],
    entry: 'sweep/sweep.js',
    css: 'sweep/sweep.css',
    gChord: 'w',
  },
  {
    id: 'signing',
    name: 'Signing',
    blurb: 'Open repeat requests with each patient’s recorded monitoring alongside — riskiest first.',
    kind: 'module',
    shells: ['panel', 'popout'],
    entry: 'signing/signing.js',
    css: 'signing/signing.css',
  },
  {
    id: 'followups',
    name: 'Follow-ups',
    blurb: 'Personal reminders for things you’re waiting on, resurfaced when due. This machine only.',
    kind: 'module',
    shells: ['panel', 'popout'],
    entry: 'followups/followups.js',
    css: 'followups/followups.css',
  },
  {
    id: 'knowledge',
    name: 'Knowledge',
    blurb: 'Your practice’s reference base — criteria, contacts, pathways.',
    kind: 'module',
    shells: ['panel', 'popout'],
    entry: 'knowledge/knowledge.js',
    css: 'knowledge/knowledge.css',
    gChord: 'k',
  },
  {
    id: 'leaflets',
    name: 'Leaflets',
    blurb: 'Find and share the right NHS patient information leaflet, fast.',
    kind: 'module',
    shells: ['panel', 'popout'],
    entry: 'leaflets/leaflets.js',
    css: 'leaflets/leaflets.css',
    gChord: 'l',
  },
  {
    id: 'record',
    name: 'Record',
    blurb: 'Live snapshot of the open patient — problems, meds, results, safety prompts. No PDF needed.',
    kind: 'module',
    shells: ['panel', 'popout'],
    entry: 'record/record.js',
    css: 'record/record.css',
    gChord: 'd',
  },
  {
    id: 'rota',
    name: 'Rota',
    blurb: 'Today’s duty cover, leave, uncovered sessions and staffing warnings.',
    kind: 'module',
    shells: ['panel', 'popout'],
    entry: 'rota/rota.js',
    css: 'rota/rota.css',
  },
  {
    id: 'rota-app',
    name: 'Rota manager',
    blurb: 'Opens the full rota in a new tab — patterns, leave, duty fairness and cover.',
    kind: 'fulltab',
    shells: ['panel'],
    aboutName: 'Rota Manager',
    aboutVersion: 'v1.10',
    aboutDesc:
      'Practice rota built in sessions: working patterns, leave (April–March, session-accounted), registrar supervision, duty fairness pro-rata to contracted sessions and a cover worklist. The Rota manager tab opens the full app in a new browser tab; the Rota tab is the compact morning view. Formerly a standalone extension, now part of the suite. Local storage only; read-only where it reads Medicus, and no patient data is ever persisted.',
  },
  {
    id: 'patient-alerts',
    name: 'Pt Alerts',
    blurb: 'Your own per-patient flags — interpreter, safeguarding, behaviour — shown when that patient is open.',
    kind: 'module',
    shells: ['panel', 'popout'],
    entry: 'patient-alerts/patient-alerts.js',
    css: 'patient-alerts/patient-alerts.css',
  },
  {
    id: 'phrases',
    name: 'Phrases',
    blurb: 'Reusable message blocks you compose, copy and paste into Medicus yourself.',
    kind: 'module',
    shells: ['panel', 'popout'],
    entry: 'phrases/phrases.js',
    css: 'phrases/phrases.css',
  },
  {
    id: 'visualiser',
    name: 'Visualiser',
    blurb: 'Analyse an exported record PDF in a full browser tab.',
    kind: 'fulltab',
    shells: ['panel'],
  },
  {
    id: 'duplicate-checker',
    name: 'Duplicates',
    blurb: 'Practice-wide scan for GP2GP duplicate-record import errors, with per-patient drill-down.',
    kind: 'fulltab',
    shells: ['panel'],
  },
  {
    id: 'about',
    name: 'About',
    blurb: 'Module info, version checks and feedback.',
    kind: 'about',
    shells: ['panel'],
  },
];

// One-tap starting points; users fine-tune afterwards. Every preset keeps
// Today (the home tab) and Knowledge/About-level basics reachable.
export const ROLE_PRESETS = [
  {
    id: 'gp',
    label: 'GP / clinician',
    show: [
      'today',
      'sentinel',
      'record',
      'patient-alerts',
      'trends',
      'sweep',
      'signing',
      'followups',
      'slots',
      'knowledge',
      'leaflets',
      'phrases',
      'visualiser',
      'about',
    ],
  },
  {
    id: 'reception',
    label: 'Reception',
    show: ['today', 'reception', 'patient-alerts', 'slots', 'submissions', 'knowledge', 'leaflets', 'about'],
  },
  {
    id: 'manager',
    label: 'Practice manager',
    show: [
      'today',
      'slots',
      'capacity',
      'submissions',
      'activity',
      'referrals',
      'condor',
      'rota',
      'rota-app',
      'knowledge',
      'about',
    ],
  },
  {
    id: 'all',
    label: 'Everything',
    show: TAB_CATALOG.map((t) => t.id),
  },
];

const ALL_IDS = new Set(TAB_CATALOG.map((t) => t.id));

export function isLoadableModule(tab, shell) {
  return tab && tab.kind === 'module' && Array.isArray(tab.shells) && tab.shells.includes(shell);
}

export function loadableModuleIds(shell) {
  return TAB_CATALOG.filter((t) => isLoadableModule(t, shell)).map((t) => t.id);
}

// Second key of a "g" chord → module id. Only entries that declare gChord.
export function gChordMap() {
  const out = {};
  for (const t of TAB_CATALOG) {
    if (t.gChord) out[t.gChord] = t.id;
  }
  return out;
}

export function aboutEntries() {
  return TAB_CATALOG.filter((t) => typeof t.aboutDesc === 'string' && t.aboutDesc.trim());
}

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
