// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
'use strict';

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
  `;
  document.head.appendChild(s);
}

export function renderPpi(data) {
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

  const arrivedCount = data.waitingRoom?.arrivedCount ?? 0;
  const medical = data.submissions?.totals?.medical ?? 0;
  const admin = data.submissions?.totals?.admin ?? 0;
  const queueCount = medical + admin;
  const urgentCount = data.requestMonitor?.urgentCount ?? 0;
  const minimum = data.capacityPreset?.minimum ?? 0;
  const remaining = data.slots?.totalRemaining ?? 0;

  const scoreA = Math.min((arrivedCount / 10) * 100, 100);
  const scoreB = Math.min((queueCount / 40) * 100, 100);
  const scoreC = Math.min((urgentCount / 5) * 100, 100);
  let scoreD = 0;
  if (minimum !== 0) {
    const deficit = Math.max(0, minimum - remaining);
    scoreD = Math.min((deficit / minimum) * 100, 100);
  }

  const ppi = Math.round(scoreA * 0.3 + scoreB * 0.25 + scoreC * 0.25 + scoreD * 0.2);

  // Reconcile the headline band with the Demand/Capacity card: that card flags
  // "Over/At capacity" off the requests-vs-slots ratio, but capacity is only 20%
  // of the index (and 0 when no capacity preset is set), so the gauge can read
  // GREEN while Demand reads red. Surface that explicitly rather than letting the
  // two cards silently contradict each other. Ratio thresholds mirror demand-gap.js.
  const demandRatio = remaining > 0 ? queueCount / remaining : queueCount > 0 ? Infinity : 0;
  const capacityStretched = demandRatio >= 1.0;

  let colorClass, colorLabel, strokeColor;
  if (ppi < 40) {
    colorClass = 'condor-ppi-green';
    colorLabel = 'GREEN';
    strokeColor = 'var(--green)';
  } else if (ppi < 70) {
    colorClass = 'condor-ppi-amber';
    colorLabel = 'AMBER';
    strokeColor = 'var(--amber)';
  } else {
    colorClass = 'condor-ppi-red';
    colorLabel = 'RED';
    strokeColor = 'var(--red)';
  }

  // #1 trust fix: never show a GREEN dial while Demand/Capacity reads over limit.
  // Floor the displayed band to AMBER (the numeric ppi is left unchanged). This
  // mirrors the band-floor in condor.js computeIndex so the gauge, the headline
  // strip and the copied figures never contradict one another. This only ever
  // RAISES a signal, never lowers one.
  const floored = capacityStretched && colorClass === 'condor-ppi-green';
  if (floored) {
    colorClass = 'condor-ppi-amber';
    colorLabel = 'AMBER';
    strokeColor = 'var(--amber)';
  }

  // Minimum visible sliver so a low-but-nonzero index still shows on the track.
  const fillPct = ppi <= 0 ? 0 : Math.max(3, Math.min(ppi, 100));
  const meter =
    `<div class="condor-ppi-meter">` +
    `<div class="condor-ppi-readout">` +
    `<span class="condor-ppi-value ${colorClass}">${ppi}</span>` +
    `<span class="condor-ppi-outof">/100</span>` +
    `<span class="condor-ppi-band ${colorClass}">${colorLabel}</span>` +
    `</div>` +
    `<div class="condor-ppi-track" role="img" aria-label="Pressure index ${ppi} of 100, band ${colorLabel}">` +
    `<div class="condor-ppi-fill" style="width:${fillPct}%;background:${strokeColor}"></div>` +
    `<span class="condor-ppi-thresh condor-ppi-thresh--amber" style="left:40%" title="Amber from 40"></span>` +
    `<span class="condor-ppi-thresh condor-ppi-thresh--red" style="left:70%" title="Red from 70"></span>` +
    `</div>` +
    `<div class="condor-ppi-scale"><span>0</span><span>pressure index</span><span>100</span></div>` +
    `</div>`;

  const capacityNote =
    capacityStretched && ppi < 70
      ? `<div class="condor-ppi-note">Capacity is ${demandRatio >= 1.5 ? 'over' : 'at'} limit (${queueCount} requests vs ${remaining} slots). ${floored ? `Shown as AMBER though the weighted index is only ${ppi}` : `The index weights capacity at 20%`} — see Demand / Capacity below.</div>`
      : '';

  // R3: make the index transparent. The info button's data-tip explains the
  // weighting formula AND shows the live component scores in scope here, plus the
  // band thresholds. title= mirrors it for native-hover fallback. Plain text only
  // (Tip uses textContent), so no HTML escaping concern, but keep quotes out.
  const ppiInfoText =
    `Practice Pressure Index = ` +
    `waiting room 30% + request queue 25% + urgent 25% + capacity 20%. ` +
    `Now: WR ${Math.round(scoreA)}/100, Queue ${Math.round(scoreB)}/100, ` +
    `Urgent ${Math.round(scoreC)}/100, Capacity ${Math.round(scoreD)}/100 → ${ppi}/100. ` +
    `Band: GREEN under 40, AMBER 40-70, RED 70 or over.`;
  const ppiInfoAttr = ppiInfoText.replace(/"/g, '&quot;');
  const capTipText = `Slots remaining (${remaining}) out of your daily minimum (${minimum}).`;
  const capTipAttr = capTipText.replace(/"/g, '&quot;');

  return (
    `<div class="condor-card condor-ppi">` +
    `<div class="condor-card-title-row">` +
    `<span class="condor-card-title">Practice Pressure</span>` +
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
