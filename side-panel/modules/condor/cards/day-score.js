// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.

'use strict';

// ── CSS (injected once) ────────────────────────────────────────────────────────

let cssInjected = false;

function ensureStyles() {
  if (cssInjected) return;
  cssInjected = true;
  const style = document.createElement('style');
  style.textContent = `
.condor-ds-score { display:flex; align-items:center; gap:8px; padding:6px 0; }
.condor-ds-tick { font-size:18px; font-weight:700; }
.condor-ds-tick.pass { color:var(--green); }
.condor-ds-tick.fail { color:var(--red); opacity:.4; }
.condor-ds-num { font-size:20px; font-weight:700; color:var(--t1); margin-left:4px; }
.condor-ds-labels { display:flex; gap:10px; font-size:9px; flex-wrap:wrap; margin-bottom:4px; }
.condor-ds-labels span { color:var(--text-3); }
.condor-ds-labels span.pass { color:var(--green); }
.condor-ds-labels span.fail { color:var(--red); }
.condor-ds-pending { font-size:11px; color:var(--text-3); padding:4px 0; }
.condor-ds-spark-lbl { font-size:9px; color:var(--text-3); text-transform:uppercase; letter-spacing:.04em; margin-top:4px; }
`;
  document.head.appendChild(style);
}

// ── Score cache (populated async on module load) ───────────────────────────────

let cachedScores = [];
let scoresLoaded = false;

async function loadScores() {
  if (scoresLoaded) return;
  // Set the flag only after a successful read so that a storage error
  // (quota exceeded, API unavailable) does not permanently suppress retries.
  const r = await chrome.storage.local.get(['condor.dayScores']);
  cachedScores = r['condor.dayScores'] || [];
  scoresLoaded = true;
}

loadScores(); // fire-and-forget on module load

// ── Score computation ─────────────────────────────────────────────────────────

/**
 * Compute the day score (0–4) from the given data object.
 * @param {object} data
 * @returns {{ c1: boolean, c2: boolean, c3: boolean, c4: boolean, score: number }}
 */
function computeScore(data) {
  // Criterion 1 — Submissions in check: <= 60 or unknown (null) = pass
  const c1 = data.submissions === null || (data.submissions?.totals?.all ?? 0) <= 60;
  // Criterion 2 — No stale urgent tasks: gt8h === 0 or unknown (null) = pass
  const c2 = data.requestMonitor === null || (data.requestMonitor?.byAgeBucket?.gt8h === 0);
  // Criterion 3 — Capacity maintained: totalRemaining > 0 or unknown (null) = pass
  const c3 = data.slots === null || ((data.slots?.totalRemaining ?? 0) > 0);
  // Criterion 4 — No critical fetch errors
  const c4 = Array.isArray(data.fetchErrors) && data.fetchErrors.length === 0;

  return { c1, c2, c3, c4, score: [c1, c2, c3, c4].filter(Boolean).length };
}

// ── Persist today's score ──────────────────────────────────────────────────────

/**
 * Compute and persist today's day score to chrome.storage.local.
 * No-op before 17:00.
 * @param {object} data
 */
export async function saveDayScore(data) {
  const hour = new Date().getHours();
  if (hour < 17) return; // only save at/after 17:00

  const today = new Date().toISOString().slice(0, 10);
  const { score } = computeScore(data);

  const stored = await chrome.storage.local.get(['condor.dayScores']);
  const scores = stored['condor.dayScores'] || [];

  // Remove any existing entry for today, add new one, keep last 30
  const updated = scores.filter(s => s.date !== today);
  updated.push({ date: today, score });
  const trimmed = updated.slice(-30);

  await chrome.storage.local.set({ 'condor.dayScores': trimmed });

  // Keep the module-level cache in sync so re-renders reflect the new value
  cachedScores = trimmed;
}

// ── Sparkline SVG ─────────────────────────────────────────────────────────────

/**
 * Build a 30-day sparkline SVG from an array of { date, score } entries.
 * @param {Array<{date: string, score: number}>} scores
 * @returns {string} SVG element string
 */
function buildSparkline(scores) {
  const BAR_W = 7;
  const GAP   = 2;
  const H     = 40;

  const scoreColor = (s) => {
    if (s >= 4) return 'var(--green)';
    if (s === 3) return 'var(--accent)';
    if (s === 2) return 'var(--amber)';
    return 'var(--red)'; // score 1 or 0
  };

  const bars = scores.map((entry, i) => {
    const x     = i * (BAR_W + GAP);
    const barH  = Math.max(2, (entry.score / 4) * H);
    const y     = H - barH;
    const fill  = scoreColor(entry.score);
    const opacityAttr = entry.score === 0 ? ' opacity=".5"' : '';
    return `<rect x="${x}" y="${y.toFixed(1)}" width="${BAR_W}" height="${barH.toFixed(1)}" fill="${fill}"${opacityAttr} rx="1"/>`;
  }).join('');

  const totalW = scores.length > 0 ? scores.length * (BAR_W + GAP) - GAP : 200;
  return `<svg viewBox="0 0 ${totalW} ${H}" height="${H}" width="100%" xmlns="http://www.w3.org/2000/svg" style="display:block">${bars}</svg>`;
}

// ── Render ────────────────────────────────────────────────────────────────────

/**
 * Render the Day Score card as an HTML string.
 * Uses `cachedScores` (populated asynchronously on module load) for the sparkline.
 * @param {object} data
 * @returns {string} HTML string
 */
export function renderDayScore(data) {
  ensureStyles();

  const now   = new Date();
  const hour  = now.getHours();
  const today = now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

  let scoreHtml;
  if (hour >= 17) {
    const { c1, c2, c3, c4, score } = computeScore(data);
    scoreHtml = `
    <div class="condor-ds-score">
      <span class="condor-ds-tick ${c1 ? 'pass' : 'fail'}">✓</span>
      <span class="condor-ds-tick ${c2 ? 'pass' : 'fail'}">✓</span>
      <span class="condor-ds-tick ${c3 ? 'pass' : 'fail'}">✓</span>
      <span class="condor-ds-tick ${c4 ? 'pass' : 'fail'}">✓</span>
      <span class="condor-ds-num">${score}/4</span>
    </div>
    <div class="condor-ds-labels">
      <span class="${c1 ? 'pass' : 'fail'}">Submissions</span>
      <span class="${c2 ? 'pass' : 'fail'}">Urgent tasks</span>
      <span class="${c3 ? 'pass' : 'fail'}">Capacity</span>
      <span class="${c4 ? 'pass' : 'fail'}">Connectivity</span>
    </div>`;
  } else {
    scoreHtml = `\n    <div class="condor-ds-pending">Score available after 17:00</div>`;
  }

  const sparkHtml = cachedScores.length > 0
    ? `\n  <div class="condor-ds-spark-lbl">30-day history</div>\n  ${buildSparkline(cachedScores)}`
    : '';

  return `<div class="condor-card condor-ds">
  <div class="condor-card-title">Day Score · ${today}</div>${scoreHtml}${sparkHtml}
</div>`;
}
