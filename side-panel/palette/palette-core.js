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

'use strict';

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
