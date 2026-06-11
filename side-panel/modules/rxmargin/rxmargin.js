// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Dispensing Margin module
//
// A working, offline alternative to RxMargin (rxmargin.co.uk) for UK dispensing
// GP practices. Dispensing practices buy medicines from wholesalers but are
// reimbursed at Drug Tariff prices, minus the NHS discount-deduction "clawback".
// The practice's profit on a line is therefore:
//
//     net margin per pack = tariff × (1 − clawback) − purchase price
//
// This module is a per-product ledger that computes that margin, finds the
// cheapest supplier you've entered, flags loss-making lines, and totals the
// monthly/annual cash impact — including the saving available simply by
// switching each line to its best supplier.
//
// It is deliberately data-driven: the practice enters (or CSV-imports) its own
// Drug Tariff reimbursement prices and wholesaler quotes. The repo cannot ship
// the licensed monthly Drug Tariff / wholesaler price feeds, but the money math
// — which is where the savings come from — runs entirely locally.
//
// The pure functions below (deductionRateFor, productMetrics, practiceTotals,
// parseCsv, toCsv, …) take no `chrome` dependency and are unit-tested in
// test-rxmargin-core.js. All chrome.storage access lives inside init/handlers.

'use strict';

// ── Clawback / discount-deduction model ───────────────────────────────────────
//
// Two models, user-selectable:
//   'dispensingDoctor' — a single flat clawback applied to every line. The
//        historical Statement of Financial Entitlements reference figure for
//        dispensing doctors is 11.18% of the Drug Tariff / list price. This is
//        the default; practices should set their own current figure.
//   'pharmacyGroups'   — the current Drug Tariff Part V group model: a fixed
//        deduction per category (generics 20.00%, branded 5.00%, appliances
//        9.85%, discount-not-deducted 0.00%).
//
// Both rate sets are editable in the module's settings so the figures can be
// kept current with the Drug Tariff without a code change.

export const DEFAULT_CONFIG = Object.freeze({
  mode: 'dispensingDoctor',
  ddRate: 11.18, // flat % for dispensing-doctor mode
  groupRates: { generic: 20.0, branded: 5.0, appliance: 9.85, dnd: 0.0 },
});

export const CATEGORIES = [
  { id: 'generic', label: 'Generic' },
  { id: 'branded', label: 'Branded' },
  { id: 'appliance', label: 'Appliance' },
  { id: 'dnd', label: 'Discount not deducted' },
];

// Resolve the fractional clawback rate (0–1) for a product category.
export function deductionRateFor(category, config = DEFAULT_CONFIG) {
  const cfg = config || DEFAULT_CONFIG;
  if (cfg.mode === 'dispensingDoctor') {
    return clampPct(cfg.ddRate) / 100;
  }
  const rates = cfg.groupRates || DEFAULT_CONFIG.groupRates;
  const r = rates[category];
  return clampPct(r == null ? 0 : r) / 100;
}

function clampPct(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 100) return 100;
  return v;
}

function num(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

// ── Per-product computation ────────────────────────────────────────────────────
//
// Returns a metrics object with everything the UI and totals need. All money is
// in pounds; callers round for display. `current` figures use the supplier the
// practice currently buys from (product.currentSupplier); `best` figures use the
// cheapest supplier entered. `switchSaving*` is the cash freed by moving the
// current line to its best supplier (never negative).
export function productMetrics(product, config = DEFAULT_CONFIG) {
  const suppliers = Array.isArray(product?.suppliers) ? product.suppliers : [];
  const priced = suppliers
    .map((s) => ({ name: String(s?.name || '').trim(), price: num(s?.price) }))
    .filter((s) => s.name !== '' && Number.isFinite(s.price));

  const tariff = num(product?.tariff);
  const monthlyPacks = Math.max(0, num(product?.monthlyPacks));
  const rate = deductionRateFor(product?.category, config);
  const netReimb = tariff * (1 - rate);

  let best = null;
  let worst = null;
  for (const s of priced) {
    if (best === null || s.price < best.price) best = s;
    if (worst === null || s.price > worst.price) worst = s;
  }

  // Current supplier: explicit match, else default to the best (cheapest) buy.
  let current = null;
  if (product?.currentSupplier) {
    current = priced.find((s) => s.name === product.currentSupplier) || null;
  }
  if (!current) current = best;

  const bestCost = best ? best.price : null;
  const currentCost = current ? current.price : null;
  const hasCost = currentCost != null;

  const marginPerPackBest = bestCost == null ? null : netReimb - bestCost;
  const marginPerPackCurrent = currentCost == null ? null : netReimb - currentCost;

  // Margin % expressed against net reimbursement (how much of each reimbursed
  // pound the practice keeps). Null when no supplier price is known.
  const marginPct = marginPerPackCurrent == null || netReimb <= 0 ? null : (marginPerPackCurrent / netReimb) * 100;

  const monthlyProfitCurrent = marginPerPackCurrent == null ? 0 : marginPerPackCurrent * monthlyPacks;
  const monthlyProfitBest = marginPerPackBest == null ? 0 : marginPerPackBest * monthlyPacks;
  const switchSavingMonthly =
    currentCost == null || bestCost == null ? 0 : Math.max(0, (currentCost - bestCost) * monthlyPacks);

  return {
    id: product?.id || null,
    name: String(product?.name || '').trim(),
    pack: String(product?.pack || '').trim(),
    category: product?.category || 'generic',
    tariff,
    monthlyPacks,
    rate,
    netReimb,
    best,
    worst,
    current,
    bestCost,
    currentCost,
    hasCost,
    marginPerPackBest,
    marginPerPackCurrent,
    marginPct,
    monthlyProfitCurrent,
    monthlyProfitBest,
    annualProfitCurrent: monthlyProfitCurrent * 12,
    annualProfitBest: monthlyProfitBest * 12,
    switchSavingMonthly,
    switchSavingAnnual: switchSavingMonthly * 12,
    // A line is loss-making when, at the supplier currently used, the clawed-back
    // reimbursement does not cover the purchase price. This is the headline
    // patient-budget risk the practice wants surfaced.
    lossMaker: marginPerPackCurrent != null && marginPerPackCurrent < 0,
    // Switchable: a cheaper supplier than the one currently used is on file.
    switchable: switchSavingMonthly > 0,
  };
}

// ── Practice-wide totals ───────────────────────────────────────────────────────
export function practiceTotals(products, config = DEFAULT_CONFIG) {
  const list = Array.isArray(products) ? products : [];
  const t = {
    productCount: list.length,
    pricedCount: 0,
    lossCount: 0,
    switchableCount: 0,
    monthlyReimb: 0,
    monthlySpendCurrent: 0,
    monthlyProfitCurrent: 0,
    monthlyProfitBest: 0,
    switchSavingMonthly: 0,
    lossMakers: [],
    switchOpportunities: [],
  };
  for (const p of list) {
    const m = productMetrics(p, config);
    if (m.hasCost) t.pricedCount += 1;
    if (m.lossMaker) {
      t.lossCount += 1;
      t.lossMakers.push(m);
    }
    if (m.switchable) {
      t.switchableCount += 1;
      t.switchOpportunities.push(m);
    }
    t.monthlyReimb += m.netReimb * m.monthlyPacks;
    if (m.currentCost != null) t.monthlySpendCurrent += m.currentCost * m.monthlyPacks;
    t.monthlyProfitCurrent += m.monthlyProfitCurrent;
    t.monthlyProfitBest += m.monthlyProfitBest;
    t.switchSavingMonthly += m.switchSavingMonthly;
  }
  t.annualProfitCurrent = t.monthlyProfitCurrent * 12;
  t.annualProfitBest = t.monthlyProfitBest * 12;
  t.switchSavingAnnual = t.switchSavingMonthly * 12;
  // Biggest savings first so the UI can lead with the highest-impact actions.
  t.lossMakers.sort((a, b) => a.monthlyProfitCurrent - b.monthlyProfitCurrent);
  t.switchOpportunities.sort((a, b) => b.switchSavingMonthly - a.switchSavingMonthly);
  return t;
}

// ── CSV import / export ────────────────────────────────────────────────────────
//
// Flat one-row-per-supplier-quote shape so spreadsheets are easy to author:
//   name,pack,category,tariff,monthlyPacks,supplier,price,current
// Rows sharing the same (name + pack) are grouped into one product with several
// supplier quotes. `current` (any of 1/yes/true/y/x) marks the supplier in use.

export const CSV_HEADER = 'name,pack,category,tariff,monthlyPacks,supplier,price,current';

export function parseCsv(text) {
  const rows = splitCsvRows(String(text || ''));
  if (rows.length === 0) return [];

  // Detect & skip a header row (first cell literally "name", case-insensitive).
  let start = 0;
  if (rows[0][0] && rows[0][0].trim().toLowerCase() === 'name') start = 1;

  const byKey = new Map();
  for (let i = start; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every((c) => String(c).trim() === '')) continue;
    const name = (r[0] || '').trim();
    if (!name) continue;
    const pack = (r[1] || '').trim();
    const category = normaliseCategory(r[2]);
    const tariff = parseMoney(r[3]);
    const monthlyPacks = Math.max(0, Math.round(num(parseMoney(r[4]))));
    const supplierName = (r[5] || '').trim();
    const price = parseMoney(r[6]);
    const isCurrent = isTruthyFlag(r[7]);

    const key = `${name.toLowerCase()} ${pack.toLowerCase()}`;
    let prod = byKey.get(key);
    if (!prod) {
      prod = {
        id: makeId(),
        name,
        pack,
        category,
        tariff,
        monthlyPacks,
        suppliers: [],
        currentSupplier: null,
      };
      byKey.set(key, prod);
    } else {
      // Keep the first non-empty tariff / packs / category seen for the product.
      if (!prod.tariff && tariff) prod.tariff = tariff;
      if (!prod.monthlyPacks && monthlyPacks) prod.monthlyPacks = monthlyPacks;
    }
    if (supplierName) {
      prod.suppliers.push({ name: supplierName, price });
      if (isCurrent) prod.currentSupplier = supplierName;
    }
  }
  return [...byKey.values()];
}

export function toCsv(products) {
  const list = Array.isArray(products) ? products : [];
  const lines = [CSV_HEADER];
  for (const p of list) {
    const suppliers = Array.isArray(p.suppliers) && p.suppliers.length ? p.suppliers : [{ name: '', price: '' }];
    for (const s of suppliers) {
      const current = s.name && s.name === p.currentSupplier ? 'yes' : '';
      lines.push(
        [
          csvCell(p.name),
          csvCell(p.pack),
          csvCell(p.category || 'generic'),
          fmtNum(p.tariff),
          fmtNum(p.monthlyPacks),
          csvCell(s.name || ''),
          s.price === '' ? '' : fmtNum(s.price),
          current,
        ].join(',')
      );
    }
  }
  return lines.join('\n');
}

function splitCsvRows(text) {
  // Minimal CSV: handles quoted fields with embedded commas and doubled quotes.
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function parseMoney(v) {
  if (v == null) return 0;
  const s = String(v).replace(/[£\s,]/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function fmtNum(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}

function normaliseCategory(v) {
  const s = String(v || '')
    .trim()
    .toLowerCase();
  if (s.startsWith('brand')) return 'branded';
  if (s.startsWith('appl')) return 'appliance';
  if (s === 'dnd' || s.includes('not deduct')) return 'dnd';
  return 'generic';
}

function isTruthyFlag(v) {
  const s = String(v || '')
    .trim()
    .toLowerCase();
  return s === '1' || s === 'yes' || s === 'true' || s === 'y' || s === 'x';
}

export function makeId() {
  return 'rx_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

// A small illustrative dataset so the module is immediately explorable. These
// figures are made-up worked examples, NOT live Drug Tariff prices — the empty
// state explains that the practice should replace them with its own data.
export function sampleProducts() {
  return [
    {
      id: makeId(),
      name: 'Atorvastatin 20mg tablets',
      pack: '28',
      category: 'generic',
      tariff: 1.43,
      monthlyPacks: 180,
      suppliers: [
        { name: 'Wholesaler A', price: 0.78 },
        { name: 'Wholesaler B', price: 0.62 },
      ],
      currentSupplier: 'Wholesaler A',
    },
    {
      id: makeId(),
      name: 'Sildenafil 50mg tablets',
      pack: '8',
      category: 'generic',
      tariff: 1.21,
      monthlyPacks: 40,
      suppliers: [
        { name: 'Wholesaler A', price: 1.35 },
        { name: 'Wholesaler B', price: 1.18 },
      ],
      currentSupplier: 'Wholesaler A',
    },
    {
      id: makeId(),
      name: 'Pregabalin 75mg capsules',
      pack: '56',
      category: 'generic',
      tariff: 2.1,
      monthlyPacks: 60,
      suppliers: [
        { name: 'Wholesaler A', price: 1.9 },
        { name: 'Wholesaler C', price: 1.42 },
      ],
      currentSupplier: 'Wholesaler A',
    },
  ];
}

// Make pure helpers available to a CommonJS test harness as well as ES imports.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DEFAULT_CONFIG,
    CATEGORIES,
    CSV_HEADER,
    deductionRateFor,
    productMetrics,
    practiceTotals,
    parseCsv,
    toCsv,
    makeId,
    sampleProducts,
  };
}

// ════════════════════════════════════════════════════════════════════════════
//  UI
// ════════════════════════════════════════════════════════════════════════════

const STORE_KEY = 'rxmargin.products';
const CONFIG_KEY = 'rxmargin.config';

let container = null;
let state = {
  products: [],
  config: { ...DEFAULT_CONFIG, groupRates: { ...DEFAULT_CONFIG.groupRates } },
  view: 'ledger', // 'ledger' | 'settings'
  editingId: null,
  selfWrite: false,
};

export async function init(el) {
  container = el;
  const stored = await chrome.storage.local.get([STORE_KEY, CONFIG_KEY]);
  state.products = Array.isArray(stored[STORE_KEY]) ? stored[STORE_KEY] : [];
  state.config = mergeConfig(stored[CONFIG_KEY]);
  chrome.storage.onChanged.addListener(onStorageChange);
  render();
  return () => {
    chrome.storage.onChanged.removeListener(onStorageChange);
    container = null;
  };
}

function mergeConfig(raw) {
  const base = { ...DEFAULT_CONFIG, groupRates: { ...DEFAULT_CONFIG.groupRates } };
  if (raw && typeof raw === 'object') {
    if (raw.mode === 'pharmacyGroups' || raw.mode === 'dispensingDoctor') base.mode = raw.mode;
    if (Number.isFinite(Number(raw.ddRate))) base.ddRate = clampPct(raw.ddRate);
    if (raw.groupRates && typeof raw.groupRates === 'object') {
      for (const k of Object.keys(base.groupRates)) {
        if (Number.isFinite(Number(raw.groupRates[k]))) base.groupRates[k] = clampPct(raw.groupRates[k]);
      }
    }
  }
  return base;
}

function onStorageChange(changes, area) {
  if (area !== 'local' || state.selfWrite) return;
  let changed = false;
  if (changes[STORE_KEY]) {
    state.products = Array.isArray(changes[STORE_KEY].newValue) ? changes[STORE_KEY].newValue : [];
    changed = true;
  }
  if (changes[CONFIG_KEY]) {
    state.config = mergeConfig(changes[CONFIG_KEY].newValue);
    changed = true;
  }
  if (changed) render();
}

async function persistProducts() {
  state.selfWrite = true;
  try {
    await chrome.storage.local.set({ [STORE_KEY]: state.products });
  } finally {
    state.selfWrite = false;
  }
}

async function persistConfig() {
  state.selfWrite = true;
  try {
    await chrome.storage.local.set({ [CONFIG_KEY]: state.config });
  } finally {
    state.selfWrite = false;
  }
}

// ── Money formatting ────────────────────────────────────────────────────────
function gbp(n) {
  const v = Number(n) || 0;
  return (
    (v < 0 ? '−£' : '£') + Math.abs(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}
function gbp0(n) {
  const v = Number(n) || 0;
  return (v < 0 ? '−£' : '£') + Math.abs(Math.round(v)).toLocaleString('en-GB');
}
function pct(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return (Number(n) >= 0 ? '' : '−') + Math.abs(Number(n)).toFixed(1) + '%';
}
function esc(s) {
  return String(s == null ? '' : s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

// ── Render ──────────────────────────────────────────────────────────────────
function render() {
  if (!container) return;
  if (state.view === 'settings') return renderSettings();
  renderLedger();
}

function renderLedger() {
  const totals = practiceTotals(state.products, state.config);
  const rateLabel =
    state.config.mode === 'dispensingDoctor'
      ? `Dispensing doctor · ${state.config.ddRate}% flat clawback`
      : 'Pharmacy group rates';

  const metrics = state.products.map((p) => ({ p, m: productMetrics(p, state.config) }));

  container.innerHTML = `
    <div class="rxm-module">
      <div class="rxm-head">
        <div>
          <h2 class="rxm-title">Dispensing Margin</h2>
          <div class="rxm-sub">${esc(rateLabel)}</div>
        </div>
        <div class="rxm-head-actions">
          <button class="rxm-btn" data-act="settings" title="Clawback &amp; rate settings">Rates</button>
          <button class="rxm-btn" data-act="import" title="Import a price list (CSV)">Import CSV</button>
          <button class="rxm-btn" data-act="export" title="Export ledger as CSV">Export CSV</button>
          <button class="rxm-btn rxm-btn-primary" data-act="add">+ Product</button>
        </div>
      </div>

      ${renderDashboard(totals)}

      ${state.products.length === 0 ? renderEmpty() : `<div class="rxm-table-wrap">${renderTable(metrics)}</div>`}

      ${renderOpportunities(totals)}

      <input type="file" id="rxmFile" accept=".csv,text/csv" style="display:none" />
    </div>
  `;
  wireLedger();
}

function renderDashboard(t) {
  const profitCls = t.monthlyProfitCurrent >= 0 ? 'pos' : 'neg';
  return `
    <div class="rxm-cards">
      <div class="rxm-card">
        <div class="rxm-card-label">Monthly margin (current)</div>
        <div class="rxm-card-val ${profitCls}">${gbp0(t.monthlyProfitCurrent)}</div>
        <div class="rxm-card-foot">${gbp0(t.annualProfitCurrent)}/yr · ${t.pricedCount}/${t.productCount} priced</div>
      </div>
      <div class="rxm-card ${t.switchSavingMonthly > 0 ? 'rxm-card-accent' : ''}">
        <div class="rxm-card-label">Saving if you switch supplier</div>
        <div class="rxm-card-val ${t.switchSavingMonthly > 0 ? 'accent' : ''}">${gbp0(t.switchSavingMonthly)}</div>
        <div class="rxm-card-foot">${gbp0(t.switchSavingAnnual)}/yr · ${t.switchableCount} line(s)</div>
      </div>
      <div class="rxm-card ${t.lossCount > 0 ? 'rxm-card-warn' : ''}">
        <div class="rxm-card-label">Loss-making lines</div>
        <div class="rxm-card-val ${t.lossCount > 0 ? 'neg' : ''}">${t.lossCount}</div>
        <div class="rxm-card-foot">where clawed-back tariff &lt; cost</div>
      </div>
      <div class="rxm-card">
        <div class="rxm-card-label">Best-case monthly margin</div>
        <div class="rxm-card-val">${gbp0(t.monthlyProfitBest)}</div>
        <div class="rxm-card-foot">${gbp0(t.annualProfitBest)}/yr at best supplier</div>
      </div>
    </div>
  `;
}

function renderEmpty() {
  return `
    <div class="rxm-empty">
      <p><strong>No products yet.</strong> This is a dispensing-margin ledger for UK dispensing
      practices — enter your Drug Tariff reimbursement price and your wholesaler quotes for each
      product, and it works out the margin, flags loss-making lines, and totals the cash you could
      save by buying each line from its cheapest supplier.</p>
      <p>Add products one at a time, or bulk-load a price list with <em>Import CSV</em>
      (columns: <code>${esc(CSV_HEADER)}</code>).</p>
      <div class="rxm-empty-actions">
        <button class="rxm-btn rxm-btn-primary" data-act="add">+ Add a product</button>
        <button class="rxm-btn" data-act="sample">Load worked example</button>
      </div>
      <p class="rxm-note">Prices are entered by your practice. No live Drug Tariff or wholesaler
      data is bundled — figures stay on this device.</p>
    </div>
  `;
}

function renderTable(metrics) {
  const rows = metrics
    .map(({ p, m }) => {
      const marginCls = m.marginPerPackCurrent == null ? '' : m.marginPerPackCurrent < 0 ? 'neg' : 'pos';
      const flags = [];
      if (m.lossMaker) flags.push('<span class="rxm-flag rxm-flag-loss">LOSS</span>');
      if (m.switchable) flags.push('<span class="rxm-flag rxm-flag-switch">SWITCH</span>');
      const supplierBits = (p.suppliers || [])
        .map((s) => {
          const isBest = m.best && s.name === m.best.name && Number(s.price) === Number(m.best.price);
          const isCur = m.current && s.name === m.current.name;
          const cls = isBest ? 'rxm-sup-best' : '';
          const star = isCur ? ' ●' : '';
          return `<span class="rxm-sup ${cls}">${esc(s.name)} ${gbp(s.price)}${star}</span>`;
        })
        .join('');
      return `
        <tr data-id="${esc(p.id)}" class="${m.lossMaker ? 'rxm-row-loss' : ''}">
          <td class="rxm-c-name">
            <div class="rxm-name">${esc(p.name) || '<em>unnamed</em>'}</div>
            <div class="rxm-meta">${esc(p.pack ? 'pack ' + p.pack : '')} · ${esc(catLabel(p.category))} · clawback ${(m.rate * 100).toFixed(2)}%</div>
            <div class="rxm-suppliers">${supplierBits || '<span class="rxm-meta">no supplier price</span>'}</div>
          </td>
          <td class="rxm-c-num">${m.tariff ? gbp(m.tariff) : '—'}</td>
          <td class="rxm-c-num">${m.tariff ? gbp(m.netReimb) : '—'}</td>
          <td class="rxm-c-num">${m.currentCost == null ? '—' : gbp(m.currentCost)}</td>
          <td class="rxm-c-num ${marginCls}">${m.marginPerPackCurrent == null ? '—' : gbp(m.marginPerPackCurrent)}<div class="rxm-meta">${pct(m.marginPct)}</div></td>
          <td class="rxm-c-num">${m.monthlyPacks || 0}</td>
          <td class="rxm-c-num ${m.monthlyProfitCurrent < 0 ? 'neg' : ''}">${gbp(m.monthlyProfitCurrent)}<div class="rxm-meta">${flags.join(' ')}</div></td>
          <td class="rxm-c-act">
            <button class="rxm-icon" data-edit="${esc(p.id)}" title="Edit">✎</button>
            <button class="rxm-icon" data-del="${esc(p.id)}" title="Delete">✕</button>
          </td>
        </tr>`;
    })
    .join('');
  return `
    <table class="rxm-table">
      <thead>
        <tr>
          <th>Product</th><th>Tariff</th><th>Net reimb.</th><th>Buy</th>
          <th>Margin/pack</th><th>Packs/mo</th><th>Profit/mo</th><th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderOpportunities(t) {
  if (t.switchOpportunities.length === 0 && t.lossMakers.length === 0) return '';
  let html = '<div class="rxm-opps">';
  if (t.switchOpportunities.length) {
    const top = t.switchOpportunities.slice(0, 5);
    html += `<div class="rxm-opp-block">
      <h3>Top supplier switches</h3>
      <ul>${top
        .map(
          (m) =>
            `<li><strong>${gbp(m.switchSavingMonthly)}/mo</strong> on ${esc(m.name)} — move from
            ${esc(m.current ? m.current.name : '?')} (${gbp(m.currentCost)}) to
            ${esc(m.best ? m.best.name : '?')} (${gbp(m.bestCost)})</li>`
        )
        .join('')}</ul>
    </div>`;
  }
  if (t.lossMakers.length) {
    const top = t.lossMakers.slice(0, 5);
    html += `<div class="rxm-opp-block">
      <h3>Loss-making lines to review</h3>
      <ul>${top
        .map(
          (m) =>
            `<li><strong class="neg">${gbp(m.monthlyProfitCurrent)}/mo</strong> on ${esc(m.name)} —
            net reimbursement ${gbp(m.netReimb)} vs buy ${gbp(m.currentCost)}</li>`
        )
        .join('')}</ul>
    </div>`;
  }
  html += '</div>';
  return html;
}

function catLabel(id) {
  return (CATEGORIES.find((c) => c.id === id) || CATEGORIES[0]).label;
}

// ── Settings view ─────────────────────────────────────────────────────────────
function renderSettings() {
  const c = state.config;
  container.innerHTML = `
    <div class="rxm-module">
      <div class="rxm-head">
        <h2 class="rxm-title">Clawback &amp; rates</h2>
        <button class="rxm-btn" data-act="back">← Back to ledger</button>
      </div>
      <div class="rxm-settings">
        <p class="rxm-note">The clawback (discount deduction) is the percentage of the Drug Tariff
        reimbursement the NHS retains. Set the model and figures to match the current Drug Tariff —
        these are editable so the tool stays accurate without a code change.</p>

        <label class="rxm-field">
          <span>Model</span>
          <select id="rxmMode">
            <option value="dispensingDoctor" ${c.mode === 'dispensingDoctor' ? 'selected' : ''}>Dispensing doctor — single flat rate</option>
            <option value="pharmacyGroups" ${c.mode === 'pharmacyGroups' ? 'selected' : ''}>Pharmacy group rates (per category)</option>
          </select>
        </label>

        <div class="rxm-rate-group ${c.mode === 'dispensingDoctor' ? '' : 'rxm-hidden'}" id="rxmDD">
          <label class="rxm-field">
            <span>Flat clawback %</span>
            <input type="number" id="rxmDDRate" step="0.01" min="0" max="100" value="${c.ddRate}" />
          </label>
          <p class="rxm-note">SFE reference for dispensing doctors is 11.18%. Confirm your current figure.</p>
        </div>

        <div class="rxm-rate-group ${c.mode === 'pharmacyGroups' ? '' : 'rxm-hidden'}" id="rxmGroups">
          ${CATEGORIES.map(
            (cat) => `
            <label class="rxm-field">
              <span>${esc(cat.label)} %</span>
              <input type="number" class="rxm-grate" data-cat="${cat.id}" step="0.01" min="0" max="100" value="${c.groupRates[cat.id]}" />
            </label>`
          ).join('')}
          <p class="rxm-note">Current Drug Tariff Part V group deductions: generics 20.00%, branded 5.00%, appliances 9.85%.</p>
        </div>

        <div class="rxm-settings-actions">
          <button class="rxm-btn rxm-btn-primary" data-act="save-settings">Save</button>
          <button class="rxm-btn" data-act="reset-settings">Reset to defaults</button>
        </div>
      </div>
    </div>`;
  wireSettings();
}

function wireSettings() {
  const modeSel = container.querySelector('#rxmMode');
  modeSel.addEventListener('change', () => {
    container.querySelector('#rxmDD').classList.toggle('rxm-hidden', modeSel.value !== 'dispensingDoctor');
    container.querySelector('#rxmGroups').classList.toggle('rxm-hidden', modeSel.value !== 'pharmacyGroups');
  });
  container.querySelector('[data-act="back"]').addEventListener('click', () => {
    state.view = 'ledger';
    render();
  });
  container.querySelector('[data-act="save-settings"]').addEventListener('click', async () => {
    const cfg = { mode: modeSel.value, ddRate: clampPct(container.querySelector('#rxmDDRate').value), groupRates: {} };
    container.querySelectorAll('.rxm-grate').forEach((inp) => {
      cfg.groupRates[inp.dataset.cat] = clampPct(inp.value);
    });
    state.config = mergeConfig(cfg);
    await persistConfig();
    state.view = 'ledger';
    render();
  });
  container.querySelector('[data-act="reset-settings"]').addEventListener('click', async () => {
    state.config = { ...DEFAULT_CONFIG, groupRates: { ...DEFAULT_CONFIG.groupRates } };
    await persistConfig();
    render();
  });
}

// ── Ledger wiring ─────────────────────────────────────────────────────────────
function wireLedger() {
  const on = (sel, ev, fn) => container.querySelectorAll(sel).forEach((e) => e.addEventListener(ev, fn));

  on('[data-act="settings"]', 'click', () => {
    state.view = 'settings';
    render();
  });
  on('[data-act="add"]', 'click', () => openEditor(null));
  on('[data-act="sample"]', 'click', async () => {
    state.products = sampleProducts();
    await persistProducts();
    render();
  });
  on('[data-act="export"]', 'click', () => exportCsv());
  on('[data-act="import"]', 'click', () => container.querySelector('#rxmFile').click());

  const file = container.querySelector('#rxmFile');
  if (file) {
    file.addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      try {
        const text = await f.text();
        const parsed = parseCsv(text);
        if (parsed.length === 0) {
          alert('No rows found in that CSV. Expected columns: ' + CSV_HEADER);
        } else {
          state.products = parsed;
          await persistProducts();
          render();
        }
      } catch (err) {
        alert('Could not read that file: ' + err.message);
      }
      e.target.value = '';
    });
  }

  on('[data-edit]', 'click', (e) => openEditor(e.currentTarget.dataset.edit));
  on('[data-del]', 'click', async (e) => {
    const id = e.currentTarget.dataset.del;
    const p = state.products.find((x) => x.id === id);
    if (p && confirm(`Delete "${p.name || 'this product'}"?`)) {
      state.products = state.products.filter((x) => x.id !== id);
      await persistProducts();
      render();
    }
  });
}

function exportCsv() {
  const csv = toCsv(state.products);
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dispensing-margin-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Product editor (modal) ─────────────────────────────────────────────────────
function openEditor(id) {
  const existing = id ? state.products.find((p) => p.id === id) : null;
  const p = existing
    ? JSON.parse(JSON.stringify(existing))
    : {
        id: makeId(),
        name: '',
        pack: '',
        category: 'generic',
        tariff: 0,
        monthlyPacks: 0,
        suppliers: [{ name: '', price: '' }],
        currentSupplier: null,
      };
  if (!p.suppliers || p.suppliers.length === 0) p.suppliers = [{ name: '', price: '' }];

  const host = document.createElement('div');
  host.className = 'rxm-modal-host';
  host.innerHTML = `
    <div class="rxm-modal">
      <h3>${existing ? 'Edit product' : 'Add product'}</h3>
      <label class="rxm-field"><span>Drug / appliance name</span>
        <input id="rxmName" type="text" value="${esc(p.name)}" placeholder="e.g. Atorvastatin 20mg tablets" /></label>
      <div class="rxm-field-row">
        <label class="rxm-field"><span>Pack size</span>
          <input id="rxmPack" type="text" value="${esc(p.pack)}" placeholder="e.g. 28" /></label>
        <label class="rxm-field"><span>Category</span>
          <select id="rxmCat">${CATEGORIES.map((c) => `<option value="${c.id}" ${p.category === c.id ? 'selected' : ''}>${c.label}</option>`).join('')}</select></label>
      </div>
      <div class="rxm-field-row">
        <label class="rxm-field"><span>Drug Tariff £/pack</span>
          <input id="rxmTariff" type="number" step="0.01" min="0" value="${num(p.tariff)}" /></label>
        <label class="rxm-field"><span>Packs dispensed / month</span>
          <input id="rxmPacks" type="number" step="1" min="0" value="${num(p.monthlyPacks)}" /></label>
      </div>
      <div class="rxm-suppliers-edit">
        <div class="rxm-field-label">Supplier quotes (£/pack). The ● marks the supplier you currently use.</div>
        <div id="rxmSupList"></div>
        <button type="button" class="rxm-btn rxm-btn-sm" id="rxmAddSup">+ Add supplier</button>
      </div>
      <div class="rxm-modal-actions">
        <button class="rxm-btn" id="rxmCancel">Cancel</button>
        <button class="rxm-btn rxm-btn-primary" id="rxmSave">Save</button>
      </div>
    </div>`;
  container.appendChild(host);

  const supList = host.querySelector('#rxmSupList');
  function drawSuppliers() {
    supList.innerHTML = p.suppliers
      .map(
        (s, i) => `
        <div class="rxm-sup-edit" data-i="${i}">
          <input type="radio" name="rxmCur" ${s.name && s.name === p.currentSupplier ? 'checked' : ''} data-cur="${i}" title="Currently used" />
          <input type="text" class="rxm-sup-name" data-i="${i}" value="${esc(s.name)}" placeholder="Supplier" />
          <input type="number" step="0.01" min="0" class="rxm-sup-price" data-i="${i}" value="${s.price === '' ? '' : num(s.price)}" placeholder="£/pack" />
          <button type="button" class="rxm-icon rxm-sup-del" data-i="${i}" title="Remove">✕</button>
        </div>`
      )
      .join('');
    supList.querySelectorAll('.rxm-sup-name').forEach((inp) =>
      inp.addEventListener('input', (e) => {
        p.suppliers[+e.target.dataset.i].name = e.target.value;
      })
    );
    supList.querySelectorAll('.rxm-sup-price').forEach((inp) =>
      inp.addEventListener('input', (e) => {
        p.suppliers[+e.target.dataset.i].price = e.target.value === '' ? '' : Number(e.target.value);
      })
    );
    supList.querySelectorAll('[data-cur]').forEach((inp) =>
      inp.addEventListener('change', (e) => {
        p.currentSupplier = p.suppliers[+e.target.dataset.cur].name || null;
      })
    );
    supList.querySelectorAll('.rxm-sup-del').forEach((btn) =>
      btn.addEventListener('click', (e) => {
        p.suppliers.splice(+e.currentTarget.dataset.i, 1);
        if (p.suppliers.length === 0) p.suppliers.push({ name: '', price: '' });
        drawSuppliers();
      })
    );
  }
  drawSuppliers();

  host.querySelector('#rxmAddSup').addEventListener('click', () => {
    p.suppliers.push({ name: '', price: '' });
    drawSuppliers();
  });
  const close = () => host.remove();
  host.querySelector('#rxmCancel').addEventListener('click', close);
  host.addEventListener('click', (e) => {
    if (e.target === host) close();
  });
  host.querySelector('#rxmSave').addEventListener('click', async () => {
    p.name = host.querySelector('#rxmName').value.trim();
    p.pack = host.querySelector('#rxmPack').value.trim();
    p.category = host.querySelector('#rxmCat').value;
    p.tariff = num(host.querySelector('#rxmTariff').value);
    p.monthlyPacks = Math.max(0, num(host.querySelector('#rxmPacks').value));
    p.suppliers = p.suppliers
      .map((s) => ({ name: String(s.name || '').trim(), price: s.price === '' ? '' : num(s.price) }))
      .filter((s) => s.name !== '');
    if (p.currentSupplier && !p.suppliers.some((s) => s.name === p.currentSupplier)) p.currentSupplier = null;
    if (!p.name) {
      alert('Please enter a product name.');
      return;
    }
    const idx = state.products.findIndex((x) => x.id === p.id);
    if (idx >= 0) state.products[idx] = p;
    else state.products.push(p);
    await persistProducts();
    close();
    render();
  });
}
