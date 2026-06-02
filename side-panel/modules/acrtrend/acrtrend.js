'use strict';
import { lineChart, esc, fmtDate } from '../shared/trend-chart.js';

const ACR_NAMES = ['acr', 'albumin creatinine ratio', 'albumin:creatinine', 'albumin/creatinine'];
const EGFR_NAMES = ['egfr', 'estimated glomerular filtration rate', 'estimated gfr'];

// KDIGO monitoring frequency: [gStage][aStage] → checks/year string
const KDIGO = {
  G1:  { A1: '0–1', A2: '1',   A3: '1+' },
  G2:  { A1: '0–1', A2: '1',   A3: '1+' },
  G3a: { A1: '1',   A2: '1',   A3: '2'  },
  G3b: { A1: '1–2', A2: '2',   A3: '2+' },
  G4:  { A1: '2',   A2: '2',   A3: '3'  },
  G5:  { A1: '4+',  A2: '4+',  A3: '4+' },
};

function gStage(e) {
  if (e == null || !Number.isFinite(e)) return null;
  if (e >= 90) return 'G1';
  if (e >= 60) return 'G2';
  if (e >= 45) return 'G3a';
  if (e >= 30) return 'G3b';
  if (e >= 15) return 'G4';
  return 'G5';
}
function aStage(a) {
  if (a == null || !Number.isFinite(a)) return null;
  if (a < 3)  return 'A1';
  if (a <= 30) return 'A2';
  return 'A3';
}

let container = null;
let pollTimer = null;
let onRuntimeMsg = null;

export async function init(el) {
  container = el;
  render({ state: 'loading' });
  await refresh();
  pollTimer = setInterval(refresh, 15000);
  onRuntimeMsg = msg => { if (msg && msg.type === 'sentinel:snapshot-updated') refresh(); };
  chrome.runtime.onMessage.addListener(onRuntimeMsg);
  return cleanup;
}

export function cleanup() {
  clearInterval(pollTimer);
  pollTimer = null;
  if (onRuntimeMsg) { chrome.runtime.onMessage.removeListener(onRuntimeMsg); onRuntimeMsg = null; }
  container = null;
}

async function refresh() {
  if (!container) return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || !/medicus\.health/.test(tab.url)) {
      render({ state: 'no-medicus' });
      return;
    }
    const data = await new Promise((res, rej) => {
      chrome.tabs.sendMessage(tab.id, { action: 'getTrendData' }, r => {
        if (chrome.runtime.lastError) rej(chrome.runtime.lastError);
        else res(r);
      });
    }).catch(() => null);
    if (!data) { render({ state: 'no-data' }); return; }
    render({ state: 'ok', ...buildModel(data) });
  } catch (_) {
    render({ state: 'no-data' });
  }
}

function buildModel(data) {
  const history = data.observationHistory || [];

  const acrRow = history.find(o => ACR_NAMES.some(n => (o.name || '').toLowerCase().includes(n)));
  // ACR values parse numerically (unlike BP), so use .value directly
  const acrPts = (acrRow?.history || [])
    .filter(h => Number.isFinite(h.value))
    .reverse() // oldest → newest
    .map(h => ({ date: h.date, value: h.value }));

  const egfrRow = history.find(o => EGFR_NAMES.some(n => (o.name || '').toLowerCase().includes(n)));
  const egfrPts = (egfrRow?.history || [])
    .filter(h => Number.isFinite(h.value))
    .reverse()
    .map(h => ({ date: h.date, value: h.value }));

  const latestAcr = acrPts.length ? acrPts[acrPts.length - 1].value : null;
  const prevAcr   = acrPts.length > 1 ? acrPts[acrPts.length - 2].value : null;
  const latestEgfr = egfrPts.length ? egfrPts[egfrPts.length - 1].value : null;

  const gs = gStage(latestEgfr);
  const as = aStage(latestAcr);
  const kdigoFreq = gs && as ? KDIGO[gs]?.[as] : null;

  // Action flags
  const referralFlag  = latestAcr != null && latestAcr >= 70;
  const doublingFlag  = latestAcr != null && prevAcr != null && latestAcr >= prevAcr * 2;
  const crossingFlag  = prevAcr != null && latestAcr != null && aStage(prevAcr) !== as &&
    ['A1', 'A2', 'A3'].indexOf(as) > ['A1', 'A2', 'A3'].indexOf(aStage(prevAcr));

  // Flag individual ACR points that cross into A3 or are ≥70
  const acrSeries = [{
    cls: 'tc-acr',
    label: 'ACR',
    points: acrPts.map(p => ({
      date: p.date,
      value: Math.min(p.value, 100), // clamp for display
      flag: p.value >= 30,
      offScale: p.value > 100,
    })),
  }];

  const acrBands = [
    { lo: 0,  hi: 3,  cls: 'tc-a1' },
    { lo: 3,  hi: 30, cls: 'tc-a2' },
    { lo: 30, hi: 100, cls: 'tc-a3' },
  ];

  const acrUnit = acrRow?.unit || 'mg/mmol';
  const egfrUnit = egfrRow?.unit || 'mL/min/1.73m²';

  return {
    acrPts, egfrPts, latestAcr, latestEgfr,
    gs, as, kdigoFreq,
    referralFlag, doublingFlag, crossingFlag,
    acrSeries, acrBands, acrUnit, egfrUnit,
  };
}

function render(m) {
  if (!container) return;
  if (m.state === 'loading') {
    container.innerHTML = `<div class="acrt-msg">Loading ACR / eGFR history…</div>`;
    return;
  }
  if (m.state === 'no-medicus') {
    container.innerHTML = `<div class="acrt-msg">Open a Medicus patient record to view ACR trend.</div>`;
    return;
  }
  if (m.state === 'no-data' || (!m.acrPts?.length && !m.egfrPts?.length)) {
    container.innerHTML = `<div class="acrt-msg">No ACR or eGFR data found for this patient.<br><span class="acrt-hint">Data is available once the investigation dashboard has been loaded in Medicus.</span></div>`;
    return;
  }

  // Action banners
  const banners = [];
  if (m.referralFlag)  banners.push(`<div class="acrt-banner acrt-banner-red">⚠ ACR ≥70 mg/mmol — consider nephrology referral (NICE NG203)</div>`);
  if (m.doublingFlag)  banners.push(`<div class="acrt-banner acrt-banner-amber">ACR has doubled since previous reading — review and repeat</div>`);
  if (m.crossingFlag)  banners.push(`<div class="acrt-banner acrt-banner-amber">ACR category has increased (${esc(m.as)}) — escalate monitoring frequency</div>`);

  // KDIGO cell
  const kdigoHtml = m.gs && m.as ? `
    <div class="acrt-kdigo">
      <span class="acrt-kdigo-cell acrt-${m.as?.toLowerCase()}">${esc(m.gs)}${esc(m.as)}</span>
      <span class="acrt-kdigo-freq">${m.kdigoFreq ? `${esc(m.kdigoFreq)} check${m.kdigoFreq === '1' ? '' : 's'}/year` : ''}</span>
      <span class="acrt-kdigo-lbl">KDIGO staging</span>
    </div>` : '';

  // Latest values strip
  const latestHtml = `
    <div class="acrt-head">
      ${m.latestAcr != null
        ? `<div class="acrt-val"><span class="acrt-num">${m.latestAcr > 100 ? '>100' : m.latestAcr.toFixed(1)}</span> <span class="acrt-unit">${esc(m.acrUnit)} ACR</span> <span class="acrt-stage acrt-${m.as?.toLowerCase()}">${esc(m.as || '')}</span></div>`
        : `<div class="acrt-val acrt-no-val">No ACR data</div>`}
      ${m.latestEgfr != null
        ? `<div class="acrt-val"><span class="acrt-num">${Math.round(m.latestEgfr)}</span> <span class="acrt-unit">${esc(m.egfrUnit)} eGFR</span> <span class="acrt-stage acrt-g${m.gs?.toLowerCase().slice(1)}">${esc(m.gs || '')}</span></div>`
        : `<div class="acrt-val acrt-no-val">No eGFR data</div>`}
      ${kdigoHtml}
    </div>`;

  // ACR chart (only if data exists)
  const acrChart = m.acrPts.length
    ? `<div class="acrt-section-lbl">ACR trend (mg/mmol) — clamped at 100</div>` +
      lineChart({ series: m.acrSeries, bands: m.acrBands, yMin: 0, yMax: 100, unit: m.acrUnit }) +
      `<div class="acrt-band-legend"><span class="acrt-band-a1">A1 &lt;3</span><span class="acrt-band-a2">A2 3–30</span><span class="acrt-band-a3">A3 &gt;30</span></div>`
    : `<div class="acrt-msg acrt-msg-inline">No ACR readings available.</div>`;

  // eGFR mini sparkline (reuse lineChart with G-stage bands)
  const egfrBands = [
    { lo: 90,  hi: 200, cls: 'tc-g1' },
    { lo: 60,  hi: 90,  cls: 'tc-g2' },
    { lo: 45,  hi: 60,  cls: 'tc-g3a' },
    { lo: 30,  hi: 45,  cls: 'tc-g3b' },
    { lo: 15,  hi: 30,  cls: 'tc-g4' },
    { lo: 0,   hi: 15,  cls: 'tc-g5' },
  ];
  const egfrChart = m.egfrPts.length
    ? `<div class="acrt-section-lbl">eGFR trend (mL/min/1.73m²)</div>` +
      lineChart({ series: [{ cls: 'tc-egfr', label: 'eGFR', points: m.egfrPts }], bands: egfrBands, yMin: 0, yMax: 120, unit: m.egfrUnit })
    : '';

  container.innerHTML = `
    <div class="acrt-module">
      ${banners.join('')}
      ${latestHtml}
      ${acrChart}
      ${egfrChart}
      <div class="acrt-count">
        ${m.acrPts.length ? `${m.acrPts.length} ACR reading${m.acrPts.length !== 1 ? 's' : ''}` : ''}
        ${m.acrPts.length && m.egfrPts.length ? ' · ' : ''}
        ${m.egfrPts.length ? `${m.egfrPts.length} eGFR reading${m.egfrPts.length !== 1 ? 's' : ''}` : ''}
      </div>
    </div>`;
}
