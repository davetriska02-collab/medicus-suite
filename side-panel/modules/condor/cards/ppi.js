// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
'use strict';

import { computeIndex } from '../condor-index-core.js';

let cssInjected = false;
function ensureStyles() {
  if (cssInjected) return;
  cssInjected = true;
  const s = document.createElement('style');
  s.textContent = `
    /* Owned index meter (replaces the stock half-doughnut, 2026-06-21). A linear
       0-100 track with the GREEN/AMBER/RED band thresholds marked at 40 and 70,
       so a low index that is floored to AMBER by capacity reads truthfully: you
       see the fill sit left of the amber tick. */
    .condor-ppi-meter { padding: 2px 2px 0; }
    .condor-ppi-readout { display:flex; align-items:baseline; justify-content:center; gap:5px; margin-bottom:9px; }
    .condor-ppi-value { font-family:var(--sans); font-size:30px; font-weight:700; line-height:1; }
    .condor-ppi-outof { font-family:var(--mono); font-size:11px; color:var(--text-4); font-variant-numeric:tabular-nums; }
    .condor-ppi-band { font-family:var(--mono); font-size:11px; font-weight:700; letter-spacing:0.08em; margin-left:3px; }
    .condor-ppi-track { position:relative; height:10px; border-radius:var(--r-pill); background:var(--bg-mid); border:1px solid var(--border); overflow:hidden; }
    .condor-ppi-fill { position:absolute; left:0; top:0; bottom:0; border-radius:var(--r-pill); transform-origin:left center; animation:condor-ppi-grow 520ms var(--ease) both; }
    .condor-ppi-thresh { position:absolute; top:0; bottom:0; width:2px; transform:translateX(-1px); opacity:0.85; }
    .condor-ppi-thresh--amber { background:var(--amber); }
    .condor-ppi-thresh--red { background:var(--red); }
    .condor-ppi-scale { display:flex; justify-content:space-between; margin-top:3px; font-family:var(--mono); font-size:8px; color:var(--text-4); font-variant-numeric:tabular-nums; }
    @keyframes condor-ppi-grow { from { transform:scaleX(0); } to { transform:scaleX(1); } }
    @media (prefers-reduced-motion: reduce) { .condor-ppi-fill { animation:none; } }
    .condor-ppi-green { color:var(--green); }
    .condor-ppi-amber { color:var(--amber); }
    .condor-ppi-red   { color:var(--red); }
    .condor-ppi-breakdown { display:flex; flex-wrap:wrap; gap:5px; justify-content:center; padding:4px 0; }
    .condor-ppi-chip { font-size:10px; background:rgba(127,127,127,0.1); padding:1px 7px; border-radius:8px; color:var(--text-3); }
    .condor-ppi-note { font-size:10px; line-height:1.35; color:var(--amber); text-align:center; padding:2px 6px 0; }
    .condor-card-title-row { display:flex; align-items:center; justify-content:center; gap:5px; }
    .condor-ppi-info {
      border:1px solid var(--border); background:transparent; color:var(--text-3);
      width:16px; height:16px; line-height:1; border-radius:50%; padding:0;
      font-size:11px; cursor:help; display:inline-flex; align-items:center; justify-content:center;
    }
    .condor-ppi-info:hover { color:var(--t1); }
    .condor-ppi-custom-badge {
      font-family:var(--mono); font-size:8px; letter-spacing:0.06em; text-transform:uppercase;
      color:var(--accent); background:var(--accent-dim); border:1px solid var(--accent-line);
      border-radius:var(--r-pill); padding:1px 6px;
    }
  `;
  document.head.appendChild(s);
}

// `config` is the module's optional custom { weights, thresholds } override
// (item 8, chrome.storage.local['condor.indexConfig']) — passed through by
// condor.js's poll(). Omitted/null means "shipped defaults", same as before.
export function renderPpi(data, config) {
  ensureStyles();

  const allNull =
    data.waitingRoom === null &&
    data.submissions === null &&
    data.requestMonitor === null &&
    data.slots === null &&
    data.capacityPreset === null;

  if (allNull) {
    return '<div class="condor-card condor-placeholder">Practice code not configured. <button class="ghost-btn setup-now-btn">Set up now</button></div>';
  }

  // Single source of truth for the index/band math AND the capacity safety
  // floor — shared with condor.js's headline strip and practice-report.js so
  // none of the three can ever quietly disagree (see condor-index-core.js).
  const idx = computeIndex(data, config);
  const { ppi, band, arrivedCount, urgentCount, minimum, capacityCount: remaining, demandCount: queueCount } = idx;
  const { weights, thresholds } = idx.config;
  const scoreA = idx.scores.waitingRoom;
  const scoreB = idx.scores.queue;
  const scoreC = idx.scores.urgent;
  const scoreD = idx.scores.capacity;

  const colorClass = band === 'GREEN' ? 'condor-ppi-green' : band === 'AMBER' ? 'condor-ppi-amber' : 'condor-ppi-red';
  const strokeColor = band === 'GREEN' ? 'var(--green)' : band === 'AMBER' ? 'var(--amber)' : 'var(--red)';

  // Reconcile the headline band with the Demand/Capacity card: that card flags
  // "Over/At capacity" off the requests-vs-slots ratio, but capacity is only a
  // fraction of the index (0 when no capacity preset is set), so the gauge can
  // read GREEN while Demand reads red. Surface that explicitly rather than
  // letting the two cards silently contradict each other.
  const capacityStretched = idx.capacityState !== 'none';

  // Minimum visible sliver so a low-but-nonzero index still shows on the track.
  const fillPct = ppi <= 0 ? 0 : Math.max(3, Math.min(ppi, 100));
  const meter =
    `<div class="condor-ppi-meter">` +
    `<div class="condor-ppi-readout">` +
    `<span class="condor-ppi-value ${colorClass}">${ppi}</span>` +
    `<span class="condor-ppi-outof">/100</span>` +
    `<span class="condor-ppi-band ${colorClass}">${band}</span>` +
    `</div>` +
    `<div class="condor-ppi-track" role="img" aria-label="Pressure index ${ppi} of 100, band ${band}">` +
    `<div class="condor-ppi-fill" style="width:${fillPct}%;background:${strokeColor}"></div>` +
    `<span class="condor-ppi-thresh condor-ppi-thresh--amber" style="left:${thresholds.amber}%" title="Amber from ${thresholds.amber}"></span>` +
    `<span class="condor-ppi-thresh condor-ppi-thresh--red" style="left:${thresholds.red}%" title="Red from ${thresholds.red}"></span>` +
    `</div>` +
    `<div class="condor-ppi-scale"><span>0</span><span>pressure index</span><span>100</span></div>` +
    `</div>`;

  const capacityNote =
    capacityStretched && band !== 'RED'
      ? `<div class="condor-ppi-note">Capacity is ${idx.capacityState === 'over' ? 'over' : 'at'} limit (${queueCount} requests vs ${remaining} slots). ${idx.floored ? `Shown as ${band} though the weighted index is only ${ppi}` : `The index weights capacity at ${Math.round(weights.capacity * 100)}%`} — see Demand / Capacity below.</div>`
      : '';

  // R3: make the index transparent. The info button's data-tip explains the
  // weighting formula AND shows the live component scores in scope here, plus the
  // band thresholds. title= mirrors it for native-hover fallback. Plain text only
  // (Tip uses textContent), so no HTML escaping concern, but keep quotes out.
  const ppiInfoText =
    `Practice Pressure Index = ` +
    `waiting room ${Math.round(weights.waitingRoom * 100)}% + request queue ${Math.round(weights.queue * 100)}% + urgent ${Math.round(weights.urgent * 100)}% + capacity ${Math.round(weights.capacity * 100)}%. ` +
    `Now: WR ${Math.round(scoreA)}/100, Queue ${Math.round(scoreB)}/100, ` +
    `Urgent ${Math.round(scoreC)}/100, Capacity ${Math.round(scoreD)}/100 → ${ppi}/100. ` +
    `Band: GREEN under ${thresholds.amber}, AMBER ${thresholds.amber}-${thresholds.red}, RED ${thresholds.red} or over.` +
    (idx.isCustom ? ' (custom weightings — tune via the cog on this card)' : '');
  const ppiInfoAttr = ppiInfoText.replace(/"/g, '&quot;');
  const capTipText = `Slots remaining (${remaining}) out of your daily minimum (${minimum}).`;
  const capTipAttr = capTipText.replace(/"/g, '&quot;');

  const customBadge = idx.isCustom ? `<span class="condor-ppi-custom-badge">custom</span>` : '';

  return (
    `<div class="condor-card condor-ppi">` +
    `<div class="condor-card-title-row">` +
    `<span class="condor-card-title">Practice Pressure</span>` +
    customBadge +
    `<button class="condor-ppi-info" aria-label="How is the pressure index calculated?" data-tip="${ppiInfoAttr}" title="${ppiInfoAttr}">&#9432;</button>` +
    `</div>` +
    meter +
    `<div class="condor-ppi-breakdown">` +
    `<span class="condor-ppi-chip">WR: ${arrivedCount}</span>` +
    `<span class="condor-ppi-chip">Queue: ${queueCount}</span>` +
    `<span class="condor-ppi-chip">Urgent: ${urgentCount}</span>` +
    `<span class="condor-ppi-chip" data-tip="${capTipAttr}" title="${capTipAttr}" tabindex="0" role="button">Cap: ${remaining}/${minimum}</span>` +
    `</div>` +
    capacityNote +
    `</div>`
  );
}
