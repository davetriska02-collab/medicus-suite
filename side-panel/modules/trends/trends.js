// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
'use strict';
import { lineChart, esc, fmtDate, parseBp, bpTarget } from '../shared/trend-chart.js';

// ── Observation metrics (passive display — no clinical thresholds) ─────────────
const OBS_METRICS = [
  { key: 'hba1c',  label: 'HbA1c',       unit: 'mmol/mol',
    match: ['hba1c', 'glycated haemoglobin', 'haemoglobin a1c'], exclude: [] },
  { key: 'chol',   label: 'Cholesterol', unit: 'mmol/L',
    match: ['cholesterol'], exclude: ['hdl', 'ldl', 'ratio', 'non-hdl', 'non hdl'] },
  { key: 'weight', label: 'Weight',      unit: 'kg',
    match: ['weight', 'body weight'], exclude: ['weight loss', 'birth weight', 'ideal body weight', 'loss'] },
];

// ── BP constants ───────────────────────────────────────────────────────────────
const BP_NAMES = ['blood pressure', 'bp', 'arterial blood pressure'];

// ── Renal constants ────────────────────────────────────────────────────────────
const ACR_NAMES  = ['acr', 'albumin creatinine ratio', 'albumin:creatinine', 'albumin/creatinine'];
const EGFR_NAMES = ['egfr', 'estimated glomerular filtration rate', 'estimated gfr'];

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
  if (a < 3)   return 'A1';
  if (a <= 30) return 'A2';
  return 'A3';
}

// ── Module state ───────────────────────────────────────────────────────────────
let container = null;
let pollTimer = null;
let onRuntimeMsg = null;
let selectedView = 'bp';  // 'bp' | 'renal' | 'hba1c' | 'chol' | 'weight'
let lastData = null;

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
  lastData = null;
}

async function refresh() {
  if (!container) return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || !/medicus\.health/.test(tab.url)) { lastData = null; render({ state: 'no-medicus' }); return; }
    const data = await new Promise((res, rej) => {
      chrome.tabs.sendMessage(tab.id, { action: 'getTrendData' }, r => {
        if (chrome.runtime.lastError) rej(chrome.runtime.lastError);
        else res(r);
      });
    }).catch(() => null);
    if (!data) { lastData = null; render({ state: 'no-data' }); return; }
    lastData = data;
    render({ state: 'ok' });
  } catch (_) {
    render({ state: 'no-data' });
  }
}

// ── Picker ─────────────────────────────────────────────────────────────────────
const VIEWS = [
  { key: 'bp',     label: 'BP' },
  { key: 'renal',  label: 'Renal' },
  { key: 'hba1c',  label: 'HbA1c' },
  { key: 'chol',   label: 'Cholesterol' },
  { key: 'weight', label: 'Weight' },
];

function pickerHtml() {
  return `<div class="trends-picker" role="tablist">` + VIEWS.map(v =>
    `<button class="trends-tab${v.key === selectedView ? ' active' : ''}" data-view="${esc(v.key)}" role="tab" aria-selected="${v.key === selectedView}">${esc(v.label)}</button>`
  ).join('') + `</div>`;
}

function wirePicker() {
  if (!container) return;
  container.querySelectorAll('.trends-tab').forEach(b => {
    b.addEventListener('click', () => {
      const k = b.dataset.view;
      if (k === selectedView) return;
      selectedView = k;
      render({ state: lastData ? 'ok' : 'no-data' });
    });
  });
}

// ── Main render dispatcher ─────────────────────────────────────────────────────
function render(m) {
  if (!container) return;
  if (m.state === 'loading') {
    container.innerHTML = `<div class="trends-msg">Loading trends…</div>`;
    return;
  }
  if (m.state === 'no-medicus') {
    container.innerHTML = `<div class="trends-msg">Open a Medicus patient record to view trends.</div>`;
    return;
  }

  let body;
  if (selectedView === 'bp')    body = renderBp(m);
  else if (selectedView === 'renal') body = renderRenal(m);
  else                          body = renderObs(m);

  container.innerHTML = `<div class="trends-module">${pickerHtml()}${body}</div>`;
  wirePicker();
}

// ── BP ─────────────────────────────────────────────────────────────────────────
function buildBpModel(data) {
  const history = data.observationHistory || [];
  const row = history.find(o =>
    BP_NAMES.some(n => (o.name || '').toLowerCase().includes(n)));

  let pairs = (row?.history || [])
    .map(h => ({ date: h.date, bp: parseBp(h.rawValue) }))
    .filter(p => p.bp)
    .reverse();

  // Fallback: merge separate systolic/diastolic rows
  if (pairs.length === 0) {
    const sysRow = history.find(o => /systolic\s+blood\s+pressure/i.test(o.name || ''));
    const diaRow = history.find(o => /diastolic\s+blood\s+pressure/i.test(o.name || ''));
    if (sysRow && diaRow) {
      const diaByDate = {};
      (diaRow.history || []).forEach(h => { diaByDate[h.date] = h.rawValue; });
      pairs = (sysRow.history || [])
        .filter(h => diaByDate[h.date] != null)
        .map(h => ({ date: h.date, bp: parseBp(`${h.rawValue}/${diaByDate[h.date]}`) }))
        .filter(p => p.bp)
        .reverse();
    }
  }

  const age = computeAge(data.patientContext);
  const registers = data.registers || [];
  const acrRow = history.find(o => ACR_NAMES.some(n => (o.name || '').toLowerCase().includes(n)));
  const latestAcr = acrRow?.history?.[0]?.value;
  const acrOver70 = Number.isFinite(latestAcr) && latestAcr >= 70;
  const target = bpTarget(registers, age, acrOver70);

  const sysSeries = {
    cls: 'tc-sys', label: 'Systolic',
    points: pairs.map(p => ({ date: p.date, value: p.bp.systolic, flag: target && p.bp.systolic > target.sys })),
  };
  const diaSeries = {
    cls: 'tc-dia', label: 'Diastolic',
    points: pairs.map(p => ({ date: p.date, value: p.bp.diastolic, flag: target && p.bp.diastolic > target.dia })),
  };
  return { pairs, target, age, registers, series: [sysSeries, diaSeries] };
}

function computeAge(pc) {
  if (!pc) return null;
  if (Number.isFinite(pc.ageYears)) return pc.ageYears;
  if (Number.isFinite(pc.age)) return pc.age;
  const dob = pc.dob || pc.dateOfBirth;
  if (!dob) return null;
  const d = new Date(dob);
  if (isNaN(d)) return null;
  return Math.floor((Date.now() - d) / (365.25 * 24 * 3600 * 1000));
}

function renderBp(m) {
  if (m.state === 'no-data' || !lastData) {
    return `<div class="trends-msg">No blood pressure readings found for this patient.<br><span class="trends-hint">BP history is available once the investigation dashboard has been loaded in Medicus.</span></div>`;
  }
  const bm = buildBpModel(lastData);
  if (!bm.pairs.length) {
    return `<div class="trends-msg">No blood pressure readings found for this patient.<br><span class="trends-hint">BP history is available once the investigation dashboard has been loaded in Medicus.</span></div>`;
  }

  const latest = bm.pairs[bm.pairs.length - 1];
  const t = bm.target;
  const above = t && (latest.bp.systolic > t.sys || latest.bp.diastolic > t.dia);
  const targets = t
    ? [{ value: t.sys, label: `sys ≤${t.sys}` }, { value: t.dia, label: `dia ≤${t.dia}` }]
    : [];
  const registersHtml = bm.registers.length
    ? bm.registers.map(r => `<span class="bpt-reg">${esc(r.name || r.code)}</span>`).join('')
    : '<span class="bpt-reg bpt-reg-none">No qualifying register</span>';
  const paedNote = bm.age != null && bm.age < 18
    ? `<div class="bpt-note">⚠ Paediatric patient — adult thresholds shown. Use age/height centile charts to determine actual BP target.</div>`
    : '';

  return `
    <div class="bpt-module">
      <div class="bpt-head">
        <span class="bpt-latest">${latest.bp.systolic}/${latest.bp.diastolic} <small>mmHg · ${esc(fmtDate(latest.date))}</small></span>
        ${t
          ? `<span class="bpt-pill ${above ? 'bpt-above' : 'bpt-met'}">${above ? 'ABOVE TARGET' : 'AT TARGET'} · ≤${t.sys}/${t.dia} <span class="bpt-tgt-lbl">(${esc(t.label)})</span></span>`
          : `<span class="bpt-pill bpt-neutral">No BP target register</span>`
        }
      </div>
      <div class="bpt-registers">${registersHtml}</div>
      ${paedNote}
      ${lineChart({ series: bm.series, targets, yMin: 40, yMax: 200, unit: 'mmHg' })}
      <div class="bpt-legend">
        <span class="bpt-key bpt-k-sys">Systolic</span>
        <span class="bpt-key bpt-k-dia">Diastolic</span>
        ${targets.length ? `<span class="bpt-key bpt-k-tgt">Target</span>` : ''}
      </div>
      <div class="bpt-count">${bm.pairs.length} reading${bm.pairs.length !== 1 ? 's' : ''}</div>
    </div>`;
}

// ── Renal ──────────────────────────────────────────────────────────────────────
function buildRenalModel(data) {
  const history = data.observationHistory || [];

  const acrRow = history.find(o => ACR_NAMES.some(n => (o.name || '').toLowerCase().includes(n)));
  const acrPts = (acrRow?.history || [])
    .filter(h => Number.isFinite(h.value))
    .reverse()
    .map(h => ({ date: h.date, value: h.value }));

  const egfrRow = history.find(o => EGFR_NAMES.some(n => (o.name || '').toLowerCase().includes(n)));
  const egfrPts = (egfrRow?.history || [])
    .filter(h => Number.isFinite(h.value))
    .reverse()
    .map(h => ({ date: h.date, value: h.value }));

  const latestAcr  = acrPts.length  ? acrPts[acrPts.length - 1].value  : null;
  const prevAcr    = acrPts.length  > 1 ? acrPts[acrPts.length - 2].value : null;
  const latestEgfr = egfrPts.length ? egfrPts[egfrPts.length - 1].value : null;

  const gs = gStage(latestEgfr);
  const as = aStage(latestAcr);
  const kdigoFreq = gs && as ? KDIGO[gs]?.[as] : null;

  const referralFlag = latestAcr != null && latestAcr >= 70;
  const doublingFlag = latestAcr != null && prevAcr != null && latestAcr >= prevAcr * 2;
  const crossingFlag = prevAcr != null && latestAcr != null && aStage(prevAcr) !== as &&
    ['A1', 'A2', 'A3'].indexOf(as) > ['A1', 'A2', 'A3'].indexOf(aStage(prevAcr));

  const acrSeries = [{
    cls: 'tc-acr', label: 'ACR',
    points: acrPts.map(p => ({
      date: p.date, value: Math.min(p.value, 100), flag: p.value >= 30, offScale: p.value > 100,
    })),
  }];
  const acrBands = [
    { lo: 0,  hi: 3,   cls: 'tc-a1' },
    { lo: 3,  hi: 30,  cls: 'tc-a2' },
    { lo: 30, hi: 100, cls: 'tc-a3' },
  ];
  const acrUnit  = acrRow?.unit  || 'mg/mmol';
  const egfrUnit = egfrRow?.unit || 'mL/min/1.73m²';

  return { acrPts, egfrPts, latestAcr, latestEgfr, gs, as, kdigoFreq, referralFlag, doublingFlag, crossingFlag, acrSeries, acrBands, acrUnit, egfrUnit };
}

function renderRenal(m) {
  if (m.state === 'no-data' || !lastData) {
    return `<div class="trends-msg">No ACR or eGFR data found for this patient.<br><span class="trends-hint">Data is available once the investigation dashboard has been loaded in Medicus.</span></div>`;
  }
  const rm = buildRenalModel(lastData);
  if (!rm.acrPts.length && !rm.egfrPts.length) {
    return `<div class="trends-msg">No ACR or eGFR data found for this patient.<br><span class="trends-hint">Data is available once the investigation dashboard has been loaded in Medicus.</span></div>`;
  }

  const banners = [];
  if (rm.referralFlag) banners.push(`<div class="acrt-banner acrt-banner-red">⚠ ACR ≥70 mg/mmol — consider nephrology referral (NICE NG203)</div>`);
  if (rm.doublingFlag) banners.push(`<div class="acrt-banner acrt-banner-amber">ACR has doubled since previous reading — review and repeat</div>`);
  if (rm.crossingFlag) banners.push(`<div class="acrt-banner acrt-banner-amber">ACR category has increased (${esc(rm.as)}) — escalate monitoring frequency</div>`);

  const kdigoHtml = rm.gs && rm.as ? `
    <div class="acrt-kdigo">
      <span class="acrt-kdigo-cell acrt-${rm.as?.toLowerCase()}">${esc(rm.gs)}${esc(rm.as)}</span>
      <span class="acrt-kdigo-freq">${rm.kdigoFreq ? `${esc(rm.kdigoFreq)} check${rm.kdigoFreq === '1' ? '' : 's'}/year` : ''}</span>
      <span class="acrt-kdigo-lbl">KDIGO staging</span>
    </div>` : '';

  const latestHtml = `
    <div class="acrt-head">
      ${rm.latestAcr != null
        ? `<div class="acrt-val"><span class="acrt-num">${rm.latestAcr > 100 ? '>100' : rm.latestAcr.toFixed(1)}</span> <span class="acrt-unit">${esc(rm.acrUnit)} ACR</span> <span class="acrt-stage acrt-${rm.as?.toLowerCase()}">${esc(rm.as || '')}</span></div>`
        : `<div class="acrt-val acrt-no-val">No ACR data</div>`}
      ${rm.latestEgfr != null
        ? `<div class="acrt-val"><span class="acrt-num">${Math.round(rm.latestEgfr)}</span> <span class="acrt-unit">${esc(rm.egfrUnit)} eGFR</span> <span class="acrt-stage acrt-g${rm.gs?.toLowerCase().slice(1)}">${esc(rm.gs || '')}</span></div>`
        : `<div class="acrt-val acrt-no-val">No eGFR data</div>`}
      ${kdigoHtml}
    </div>`;

  const acrChart = rm.acrPts.length
    ? `<div class="acrt-section-lbl">ACR trend (mg/mmol) — clamped at 100</div>` +
      lineChart({ series: rm.acrSeries, bands: rm.acrBands, yMin: 0, yMax: 100, unit: rm.acrUnit }) +
      `<div class="acrt-band-legend"><span class="acrt-band-a1">A1 &lt;3</span><span class="acrt-band-a2">A2 3–30</span><span class="acrt-band-a3">A3 &gt;30</span></div>`
    : `<div class="trends-msg" style="padding:10px 12px">No ACR readings available.</div>`;

  const egfrBands = [
    { lo: 90,  hi: 200, cls: 'tc-g1' },
    { lo: 60,  hi: 90,  cls: 'tc-g2' },
    { lo: 45,  hi: 60,  cls: 'tc-g3a' },
    { lo: 30,  hi: 45,  cls: 'tc-g3b' },
    { lo: 15,  hi: 30,  cls: 'tc-g4' },
    { lo: 0,   hi: 15,  cls: 'tc-g5' },
  ];
  const egfrChart = rm.egfrPts.length
    ? `<div class="acrt-section-lbl">eGFR trend (mL/min/1.73m²)</div>` +
      lineChart({ series: [{ cls: 'tc-egfr', label: 'eGFR', points: rm.egfrPts }], bands: egfrBands, yMin: 0, yMax: 120, unit: rm.egfrUnit })
    : '';

  return `
    <div class="acrt-module">
      ${banners.join('')}
      ${latestHtml}
      ${acrChart}
      ${egfrChart}
      <div class="acrt-count">
        ${rm.acrPts.length ? `${rm.acrPts.length} ACR reading${rm.acrPts.length !== 1 ? 's' : ''}` : ''}
        ${rm.acrPts.length && rm.egfrPts.length ? ' · ' : ''}
        ${rm.egfrPts.length ? `${rm.egfrPts.length} eGFR reading${rm.egfrPts.length !== 1 ? 's' : ''}` : ''}
      </div>
    </div>`;
}

// ── Observations (HbA1c / Cholesterol / Weight) ────────────────────────────────
function seriesFor(metric, data) {
  const history = data.observationHistory || [];
  const row = history.find(o => {
    const name = (o.name || '').toLowerCase();
    return metric.match.some(n => name.includes(n)) && !metric.exclude.some(x => name.includes(x));
  });
  const pts = (row?.history || [])
    .filter(h => Number.isFinite(h.value))
    .slice()
    .reverse()
    .map(h => ({ date: h.date, value: h.value }));
  return { pts, unit: row?.unit || metric.unit };
}

function round(v) { return Math.round(v * 10) / 10; }

function renderObs(m) {
  const metric = OBS_METRICS.find(x => x.key === selectedView) || OBS_METRICS[0];
  if (m.state === 'no-data' || !lastData) {
    return `<div class="trends-msg">No observation data found for this patient.<br><span class="trends-hint">Data is available once the investigation dashboard has been loaded in Medicus.</span></div>`;
  }
  const { pts, unit } = seriesFor(metric, lastData);
  if (!pts.length) {
    return `<div class="trends-msg trends-msg-inline">No ${esc(metric.label)} readings recorded for this patient.</div>`;
  }

  const latest = pts[pts.length - 1];
  const prev = pts.length > 1 ? pts[pts.length - 2] : null;
  const delta = prev ? latest.value - prev.value : null;
  const arrow = delta == null ? '' : delta > 0 ? '▲' : delta < 0 ? '▼' : '▬';
  const deltaCls = delta == null ? '' : delta > 0 ? 'trends-up' : delta < 0 ? 'trends-down' : 'trends-flat';
  const first = pts[0], last = pts[pts.length - 1];
  const chart = lineChart({ series: [{ cls: 'tc-trend', label: metric.label, points: pts }], unit });

  return `
    <div class="trends-head">
      <div class="trends-val">
        <span class="trends-num">${esc(round(latest.value))}</span>
        <span class="trends-unit">${esc(unit)}</span>
        ${delta != null ? `<span class="trends-delta ${deltaCls}">${arrow} ${esc(round(Math.abs(delta)))}</span>` : ''}
      </div>
      <div class="trends-latest-date">latest ${esc(fmtDate(latest.date))}</div>
    </div>
    <div class="trends-section-lbl">${esc(metric.label)} (${esc(unit)})</div>
    ${chart}
    <div class="trends-count">${pts.length} reading${pts.length !== 1 ? 's' : ''} · ${esc(fmtDate(first.date))} – ${esc(fmtDate(last.date))}</div>`;
}
