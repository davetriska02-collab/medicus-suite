// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — command palette pure logic (no chrome APIs, no DOM)
//
// Scoring/ranking for the Ctrl+K palette, kept separate and unit-tested
// (test-palette-core.js) per the *-core.js convention. The DOM engine in
// palette.js consumes these.
//
// Exports:
//   scoreMatch(query, text)                — 0 = no match, higher = better
//   rankCommands(commands, query, recents) — filtered + ordered command list
//   patientScopedCommands(hasPatient)      — patient-context command descriptors

'use strict';

// Patient-scoped command descriptors (Dave-council roadmap step 4 / top-10
// plan item 10). These only make sense with a patient open in Medicus — "Copy
// patient summary" has nothing to copy, "Jump to Sentinel" has nothing to
// triage. Pure and declarative on purpose (no `run` here) so this list is
// testable without chrome/DOM: palette.js attaches `run` by id when it builds
// the live command registry, and calls this with the live patient-context
// signal it already has to gate presence.
//
// Distinct ids from the always-present nav:record / nav:trends / nav:sentinel
// commands — those jump to a tab regardless of context; these
// are the "I'm mid-consultation, patient is open" quick actions, grouped
// together under "Patient" so they float to the top of that context.
export const PATIENT_COMMAND_IDS = Object.freeze({
  COPY_SUMMARY: 'patient:copy-summary',
  JUMP_RECORD: 'patient:jump-record',
  JUMP_TRENDS: 'patient:jump-trends',
  JUMP_SENTINEL: 'patient:jump-sentinel',
});

const PATIENT_COMMAND_DESCRIPTORS = [
  { id: PATIENT_COMMAND_IDS.COPY_SUMMARY, label: 'Copy patient summary', keywords: 'clipboard copy snapshot' },
  { id: PATIENT_COMMAND_IDS.JUMP_RECORD, label: 'Jump to Record', keywords: 'patient record live summary' },
  { id: PATIENT_COMMAND_IDS.JUMP_TRENDS, label: 'Jump to Trends', keywords: 'patient trends chart metric' },
  { id: PATIENT_COMMAND_IDS.JUMP_SENTINEL, label: 'Jump to Sentinel', keywords: 'patient monitoring qof drug' },
];

// Returns the patient-scoped command descriptors when `hasPatient` is true,
// otherwise an empty array — the hide/absent behaviour the plan requires.
// Each descriptor carries `group: 'Patient'` so callers don't need to repeat it.
export function patientScopedCommands(hasPatient) {
  if (!hasPatient) return [];
  return PATIENT_COMMAND_DESCRIPTORS.map((d) => ({ ...d, group: 'Patient' }));
}

// Score how well `query` matches `text`.
//   0                — no match
//   1                — empty query (everything matches, neutral score)
//   500 - index      — exact substring (earlier is better), +80 if it starts
//                      a word (so "mon" prefers "Monitoring" over "Lemon")
//   subsequence      — all query chars appear in order: base 100, +8 per
//                      word-boundary hit, −1 per gap char (compactness)
export function scoreMatch(query, text) {
  const q = String(query || '')
    .trim()
    .toLowerCase();
  const t = String(text || '').toLowerCase();
  if (!q) return 1;
  if (!t) return 0;

  const idx = t.indexOf(q);
  if (idx !== -1) {
    const wordStart = idx === 0 || /[\s/:·-]/.test(t[idx - 1]);
    return 500 - Math.min(idx, 100) + (wordStart ? 80 : 0);
  }

  // Subsequence walk
  let score = 100;
  let ti = 0;
  for (const ch of q) {
    let found = -1;
    for (let i = ti; i < t.length; i++) {
      if (t[i] === ch) {
        found = i;
        break;
      }
    }
    if (found === -1) return 0;
    if (found === 0 || /[\s/:·-]/.test(t[found - 1])) score += 8;
    score -= Math.max(0, found - ti - 1); // gap penalty
    ti = found + 1;
  }
  return Math.max(score, 1);
}

// Rank commands for display.
//   commands — [{ id, label, keywords?, ... }]
//   query    — current input text
//   recents  — array of command ids, most recent first
//
// Empty query: recents (in recency order) float to the top, the rest keep
// their registry order. Non-empty query: scored against label + keywords,
// zero-score commands dropped, ties broken by registry order (stable).
export function rankCommands(commands, query, recents) {
  const q = String(query || '').trim();
  const rec = Array.isArray(recents) ? recents : [];

  if (!q) {
    const byRecency = (c) => {
      const i = rec.indexOf(c.id);
      return i === -1 ? Infinity : i;
    };
    return [...commands].sort((a, b) => byRecency(a) - byRecency(b));
  }

  return commands
    .map((c, order) => ({
      c,
      order,
      score: scoreMatch(q, `${c.label} ${c.keywords || ''}`),
    }))
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((e) => e.c);
}

// Maintain the recents list: newest first, deduplicated, capped.
export function pushRecent(recents, id, cap = 5) {
  const rec = (Array.isArray(recents) ? recents : []).filter((r) => r !== id);
  rec.unshift(id);
  return rec.slice(0, cap);
}

// Commands that used to open removed surfaces. The load cut (v3.264.15)
// deleted Today, the appointment-book tally and the Note / TV board.
// These ids must never come back as palette actions — omitRetiredCommands
// drops them even if a later edit re-adds the registry row.
export const RETIRED_COMMAND_IDS = Object.freeze([
  'open:board',
  'open:today',
  'open:tally',
  'nav:today',
  'nav:board',
  'nav:tally',
]);

const RETIRED_LABEL =
  /^(go to (today|note)|open note)\b|note display board|note tv|appointment[- ]book tally|appointment tally/i;

export function omitRetiredCommands(commands) {
  const retired = new Set(RETIRED_COMMAND_IDS);
  return (Array.isArray(commands) ? commands : []).filter((c) => {
    if (!c || retired.has(c.id)) return false;
    return !RETIRED_LABEL.test(String(c.label || ''));
  });
}

// Second key of a "g" chord → module. Preference is the module's own
// data-module first letter; where two or more modules share a first letter,
// one keeps it and the rest take a letter from elsewhere in the name.
//   s* → slots keeps 's'; sentinel → 'm' (Monitoring), submissions → 'u',
//        sweep → 'w'
//   c* → capacity keeps 'c'
//   r* → referrals keeps 'r'; record → 'd', reception → 'e'
//   trends → 'n' (t is unused — the Today tab was removed)
// Signing, Rota, Phrases and Patient Alerts have no letter. Panel.js is the
// only shell that listens for the chord; the pop-out must not advertise it.
export const G_CHORD_MAP = Object.freeze({
  s: 'slots',
  m: 'sentinel',
  r: 'referrals',
  c: 'capacity',
  a: 'activity',
  u: 'submissions',
  k: 'knowledge',
  l: 'leaflets',
  w: 'sweep',
  e: 'reception',
  d: 'record',
  n: 'trends',
});

// Shipped shell shortcuts. `keys` names both modifiers whenever the listener
// accepts ctrlKey OR metaKey — a label that says only "Ctrl" is wrong on Mac.
// `shells` is where the listener actually exists (panel.js vs both shells).
export const SHELL_SHORTCUTS = Object.freeze([
  {
    id: 'palette',
    keys: 'Ctrl/Cmd+K',
    action: 'Command palette',
    shells: ['panel', 'popout'],
  },
  {
    id: 'cycle',
    keys: 'Ctrl/Cmd+Alt+←/→',
    action: 'Cycle the visible tabs',
    shells: ['panel'],
  },
  {
    id: 'digits',
    keys: '1–9',
    action: 'Jump to that place among the visible tabs (the first nine only)',
    shells: ['panel'],
  },
  {
    id: 'chord',
    keys: 'g, then a letter',
    action: 'Jump to a named tab. The letter is not always the first letter of the tab name — the map is below',
    shells: ['panel'],
  },
  {
    id: 'search',
    keys: '/',
    action: 'Focus this tab’s search box, when it has one',
    shells: ['panel'],
  },
  {
    id: 'help',
    keys: '?',
    action: 'Open help for this tab',
    shells: ['panel'],
  },
  {
    id: 'esc',
    keys: 'Esc',
    action: 'Close the palette, help and other popovers. Also leaves focus mode when no dialog is open',
    shells: ['panel', 'popout'],
  },
  {
    id: 'zen',
    keys: 'Ctrl/Cmd+.',
    action: 'Toggle focus mode',
    shells: ['panel', 'popout'],
  },
]);

const POPOUT_SHORTCUT_NOTE =
  'Number jumps, tab cycling and g-then-letter work in the docked side panel. This window has the command palette and focus mode.';

/**
 * Cheat-sheet model for the current shell.
 * `tabs` — { id, name, jumpable } for nav tabs in this window.
 * A chord whose tab is hidden or absent is marked available:false so the
 * sheet does not claim the key will switch to it.
 */
export function shortcutSheet(shell, tabs) {
  const which = shell === 'panel' ? 'panel' : 'popout';
  const list = Array.isArray(tabs) ? tabs : [];
  const byId = new Map(list.map((t) => [t.id, t]));
  const chordIds = new Set(Object.values(G_CHORD_MAP));
  const chords =
    which === 'panel'
      ? Object.entries(G_CHORD_MAP).map(([key, id]) => {
          const tab = byId.get(id);
          return {
            key,
            id,
            name: (tab && tab.name) || id,
            available: !!(tab && tab.jumpable),
          };
        })
      : [];
  const noLetter =
    which === 'panel'
      ? list.filter((t) => t.jumpable && !chordIds.has(t.id) && t.id !== 'rota-app' && t.id !== 'duplicate-checker')
      : [];
  return {
    shortcuts: SHELL_SHORTCUTS.filter((s) => s.shells.includes(which)),
    chords,
    noLetter: noLetter.map((t) => ({ id: t.id, name: t.name || t.id })),
    note: which === 'popout' ? POPOUT_SHORTCUT_NOTE : '',
    typingNote: which === 'panel' ? 'Number keys, g, / and ? stay quiet while the cursor is in a text field.' : '',
  };
}
