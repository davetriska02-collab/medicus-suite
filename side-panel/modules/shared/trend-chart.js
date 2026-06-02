'use strict';

export function parseBp(raw) {
  if (!raw) return null;
  const m = String(raw).match(/(\d{2,3})\s*\/\s*(\d{2,3})/);
  return m ? { systolic: +m[1], diastolic: +m[2] } : null;
}

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export function fmtDate(d) {
  const dt = new Date(d);
  return isNaN(dt) ? String(d) : dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
}

// Resolve the BP target from achieved QOF register codes + patient age.
// acrOver70 can be passed to trigger the more intensive CKD+proteinuria target.
export function bpTarget(registers, age, acrOver70) {
  const codes = new Set((registers || []).map(r => String(r.code || '').toUpperCase()));
  if (codes.has('CKD') && acrOver70) return { sys: 130, dia: 80, label: 'CKD + ACR >70' };
  if (codes.has('HYP') && age != null && age >= 80) return { sys: 150, dia: 90, label: 'HYP ≥80' };
  if (['HYP', 'DM', 'CHD', 'STIA'].some(c => codes.has(c))) return { sys: 140, dia: 90, label: 'standard' };
  return null;
}

// Render a multi-series SVG line chart with optional horizontal target lines and
// background band shading. Returns an HTML string containing an <svg> element.
//
// series:  [{ points: [{date, value, flag}], cls, label }]   — oldest first
// targets: [{ value, label }]                                — dashed horizontal lines
// bands:   [{ lo, hi, cls }]                                 — background fill rects
// yMin/yMax: explicit Y range; auto-computed from data if omitted
// unit:    string appended to tooltip values
export function lineChart({ series, targets = [], bands = [], yMin, yMax, unit = '' }) {
  const W = 480, H = 240, PL = 40, PR = 14, PT = 14, PB = 28;
  const allVals = series.flatMap(s => s.points.map(p => p.value)).filter(Number.isFinite)
    .concat(targets.map(t => t.value));
  if (!allVals.length) return '<svg viewBox="0 0 480 240" class="tc-svg"><text x="240" y="120" text-anchor="middle" class="tc-empty">No data</text></svg>';
  const lo = yMin ?? Math.min(...allVals);
  const hi = yMax ?? Math.max(...allVals);
  const range = (hi - lo) || 1;

  // Compute x positions: all series share the same date domain
  const allDates = [...new Set(series.flatMap(s => s.points.map(p => p.date)))].sort();
  const n = allDates.length;
  const xScale = d => PL + (n < 2 ? (W - PL - PR) / 2 : allDates.indexOf(d) * (W - PL - PR) / (n - 1));
  const yScale = v => H - PB - ((Math.min(Math.max(v, lo), hi) - lo) / range) * (H - PT - PB);

  // Y axis ticks
  const tickCount = 5;
  const tickStep = range / (tickCount - 1);
  const yTicks = Array.from({ length: tickCount }, (_, i) => lo + i * tickStep);
  const axisTicks = yTicks.map(v => {
    const yy = yScale(v).toFixed(1);
    return `<line x1="${PL}" y1="${yy}" x2="${W - PR}" y2="${yy}" class="tc-grid"/>` +
      `<text x="${PL - 4}" y="${(+yy + 4).toFixed(1)}" class="tc-axis-lbl" text-anchor="end">${Math.round(v)}</text>`;
  }).join('');

  // X axis date labels (up to 6)
  const xLabelStep = Math.max(1, Math.ceil(n / 6));
  const xLabels = allDates
    .filter((_, i) => i % xLabelStep === 0 || i === n - 1)
    .map(d => `<text x="${xScale(d).toFixed(1)}" y="${H - PB + 14}" class="tc-axis-lbl" text-anchor="middle">${esc(fmtDate(d))}</text>`)
    .join('');

  const bandRects = bands.map(b => {
    const y1 = yScale(Math.min(b.hi, hi)).toFixed(1);
    const y2 = yScale(Math.max(b.lo, lo)).toFixed(1);
    return `<rect x="${PL}" y="${y1}" width="${W - PL - PR}" height="${(+y2 - +y1).toFixed(1)}" class="tc-band ${esc(b.cls)}"/>`;
  }).join('');

  const targetLines = targets.map(t =>
    `<line x1="${PL}" y1="${yScale(t.value).toFixed(1)}" x2="${W - PR}" y2="${yScale(t.value).toFixed(1)}" class="tc-target"/>` +
    `<text x="${W - PR}" y="${(yScale(t.value) - 3).toFixed(1)}" class="tc-target-lbl" text-anchor="end">${esc(t.label)}</text>`
  ).join('');

  const seriesEl = series.map(s => {
    const pts = s.points.filter(p => Number.isFinite(p.value));
    if (!pts.length) return '';
    const d = pts.map(p => `${pts.indexOf(p) ? 'L' : 'M'} ${xScale(p.date).toFixed(1)} ${yScale(p.value).toFixed(1)}`).join(' ');
    const dots = pts.map(p =>
      `<circle cx="${xScale(p.date).toFixed(1)}" cy="${yScale(p.value).toFixed(1)}" r="3.5" class="tc-dot ${p.flag ? 'tc-dot-alert' : ''}">` +
      `<title>${esc(fmtDate(p.date))}: ${esc(p.value)}${unit ? ' ' + esc(unit) : ''}</title></circle>`
    ).join('');
    return `<path d="${d}" class="tc-line ${esc(s.cls)}" fill="none"/>${dots}`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" class="tc-svg" role="img" aria-label="Trend chart">` +
    `<line x1="${PL}" y1="${PT}" x2="${PL}" y2="${H - PB}" class="tc-axis"/>` +
    `<line x1="${PL}" y1="${H - PB}" x2="${W - PR}" y2="${H - PB}" class="tc-axis"/>` +
    bandRects + axisTicks + xLabels + targetLines + seriesEl +
    '</svg>';
}
