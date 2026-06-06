// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
'use strict';
import { parseBp, bpTarget, lineChart, esc, fmtDate } from '../shared/trend-chart.js';

// Observation name substrings that identify BP readings in observationHistory
const BP_NAMES = ['blood pressure', 'bp', 'arterial blood pressure'];

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
  const row = history.find(o =>
    BP_NAMES.some(n => (o.name || '').toLowerCase().includes(n)));

  // BP values are stored as "120/80" strings; the numeric `value` field is NaN.
  // Parse rawValue for each history point to extract systolic/diastolic pairs.
  let pairs = (row?.history || [])
    .map(h => ({ date: h.date, bp: parseBp(h.rawValue) }))
    .filter(p => p.bp)
    .reverse(); // oldest → newest for chart

  // Fallback: if no combined entry was found (or it yielded no parseable points),
  // merge separate "Systolic blood pressure" / "Diastolic blood pressure" entries
  // directly. This handles API shapes where the synthesis in normaliseObservationHistory
  // did not produce a combined entry (e.g. Key observations row only has latest reading).
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

  // Determine if latest ACR is >70 (for intensive CKD target)
  const ACR_NAMES = ['acr', 'albumin creatinine ratio', 'albumin:creatinine', 'albumin/creatinine'];
  const acrRow = (data.observationHistory || []).find(o =>
    ACR_NAMES.some(n => (o.name || '').toLowerCase().includes(n)));
  const latestAcr = acrRow?.history?.[0]?.value;
  const acrOver70 = Number.isFinite(latestAcr) && latestAcr >= 70;

  const target = bpTarget(registers, age, acrOver70);

  const sysSeries = {
    cls: 'tc-sys',
    label: 'Systolic',
    points: pairs.map(p => ({ date: p.date, value: p.bp.systolic, flag: target && p.bp.systolic > target.sys })),
  };
  const diaSeries = {
    cls: 'tc-dia',
    label: 'Diastolic',
    points: pairs.map(p => ({ date: p.date, value: p.bp.diastolic, flag: target && p.bp.diastolic > target.dia })),
  };

  return { pairs, target, age, registers, series: [sysSeries, diaSeries], acrOver70 };
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

function render(m) {
  if (!container) return;
  if (m.state === 'loading') {
    container.innerHTML = `<div class="bpt-msg">Loading BP history…</div>`;
    return;
  }
  if (m.state === 'no-medicus') {
    container.innerHTML = `<div class="bpt-msg">Open a Medicus patient record to view BP trend.</div>`;
    return;
  }
  if (m.state === 'no-data' || !m.pairs?.length) {
    container.innerHTML = `<div class="bpt-msg">No blood pressure readings found for this patient.<br><span class="bpt-hint">BP history is available once the investigation dashboard has been loaded in Medicus.</span></div>`;
    return;
  }

  const latest = m.pairs[m.pairs.length - 1];
  const t = m.target;
  const above = t && (latest.bp.systolic > t.sys || latest.bp.diastolic > t.dia);
  const targets = t
    ? [{ value: t.sys, label: `sys ≤${t.sys}` }, { value: t.dia, label: `dia ≤${t.dia}` }]
    : [];
  const registersHtml = m.registers.length
    ? m.registers.map(r => `<span class="bpt-reg">${esc(r.name || r.code)}</span>`).join('')
    : '<span class="bpt-reg bpt-reg-none">No qualifying register</span>';

  const paedNote = m.age != null && m.age < 18
    ? `<div class="bpt-note">⚠ Paediatric patient — adult thresholds shown. Use age/height centile charts to determine actual BP target.</div>`
    : '';

  container.innerHTML = `
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
      ${lineChart({ series: m.series, targets, yMin: 40, yMax: 200, unit: 'mmHg' })}
      <div class="bpt-legend">
        <span class="bpt-key bpt-k-sys">Systolic</span>
        <span class="bpt-key bpt-k-dia">Diastolic</span>
        ${targets.length ? `<span class="bpt-key bpt-k-tgt">Target</span>` : ''}
      </div>
      <div class="bpt-count">${m.pairs.length} reading${m.pairs.length !== 1 ? 's' : ''}</div>
    </div>`;
}
