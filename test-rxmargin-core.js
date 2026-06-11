// Medicus Suite — Dispensing Margin core math tests
// Run with: node test-rxmargin-core.js
//
// Imports side-panel/modules/rxmargin/rxmargin.js as an ES module (same
// dynamic-import-of-file-URL technique as test-tab-order.js). Only the pure,
// chrome-free helpers are exercised — deductionRateFor, productMetrics,
// practiceTotals, parseCsv, toCsv, sampleProducts.

'use strict';

const path = require('path');

(async () => {
  let passed = 0,
    failed = 0;

  function check(cond, msg) {
    if (cond) {
      console.log(`  OK  ${msg}`);
      passed++;
    } else {
      console.error(`  FAIL  ${msg}`);
      failed++;
      process.exitCode = 1;
    }
  }
  const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

  const modPath = new URL('side-panel/modules/rxmargin/rxmargin.js', `file://${path.resolve(__dirname)}/`).href;

  let mod;
  try {
    mod = await import(modPath);
  } catch (e) {
    console.error('FATAL: could not import rxmargin.js:', e.message);
    process.exit(1);
  }

  const {
    DEFAULT_CONFIG,
    deductionRateFor,
    productMetrics,
    practiceTotals,
    categoryBreakdown,
    parsePackQty,
    marginBand,
    upsertSnapshot,
    ymKeyOf,
    parseCsv,
    toCsv,
    sampleProducts,
    CSV_HEADER,
  } = mod;

  // ── deductionRateFor ─────────────────────────────────────────────────────────
  check(approx(deductionRateFor('generic', DEFAULT_CONFIG), 0.1118), 'dispensing-doctor flat rate is 11.18%');
  check(
    approx(deductionRateFor('branded', DEFAULT_CONFIG), 0.1118),
    'dispensing-doctor mode ignores category (flat rate for branded too)'
  );
  const groupCfg = {
    mode: 'pharmacyGroups',
    ddRate: 11.18,
    groupRates: { generic: 20, branded: 5, appliance: 9.85, dnd: 0 },
  };
  check(approx(deductionRateFor('generic', groupCfg), 0.2), 'pharmacy-group generic rate is 20%');
  check(approx(deductionRateFor('branded', groupCfg), 0.05), 'pharmacy-group branded rate is 5%');
  check(approx(deductionRateFor('appliance', groupCfg), 0.0985), 'pharmacy-group appliance rate is 9.85%');
  check(approx(deductionRateFor('dnd', groupCfg), 0), 'pharmacy-group DND rate is 0%');
  check(deductionRateFor('generic', { mode: 'dispensingDoctor', ddRate: 150 }) === 1, 'clawback % is clamped to 100');
  check(deductionRateFor('generic', { mode: 'dispensingDoctor', ddRate: -5 }) === 0, 'negative clawback clamps to 0');

  // ── productMetrics ───────────────────────────────────────────────────────────
  const profitable = {
    id: 'p1',
    name: 'Atorvastatin 20mg',
    pack: '28',
    category: 'generic',
    tariff: 1.43,
    monthlyPacks: 180,
    suppliers: [
      { name: 'A', price: 0.78 },
      { name: 'B', price: 0.62 },
    ],
    currentSupplier: 'A',
  };
  const m = productMetrics(profitable, DEFAULT_CONFIG);
  check(approx(m.netReimb, 1.43 * (1 - 0.1118)), 'net reimbursement applies clawback');
  check(m.best.name === 'B' && approx(m.bestCost, 0.62), 'best supplier is the cheapest quote');
  check(m.current.name === 'A' && approx(m.currentCost, 0.78), 'current supplier resolves to the named one');
  check(approx(m.marginPerPackCurrent, 1.43 * 0.8882 - 0.78), 'margin/pack at current supplier');
  check(!m.lossMaker, 'profitable line is not flagged as loss-making');
  check(m.switchable && approx(m.switchSavingMonthly, (0.78 - 0.62) * 180), 'switch saving = cost delta × packs');
  check(approx(m.switchSavingAnnual, m.switchSavingMonthly * 12), 'annual switch saving is 12× monthly');
  check(approx(m.monthlyProfitCurrent, m.marginPerPackCurrent * 180), 'monthly profit = margin × packs');

  // Loss-making line: net reimbursement below purchase cost.
  const loss = {
    id: 'p2',
    name: 'Sildenafil 50mg',
    pack: '8',
    category: 'generic',
    tariff: 1.21,
    monthlyPacks: 40,
    suppliers: [{ name: 'A', price: 1.35 }],
    currentSupplier: 'A',
  };
  const lm = productMetrics(loss, DEFAULT_CONFIG);
  check(lm.lossMaker, 'line where clawed-back tariff < cost is flagged loss-making');
  check(lm.marginPerPackCurrent < 0 && lm.monthlyProfitCurrent < 0, 'loss line has negative margin and profit');
  check(!lm.switchable, 'single-supplier line offers no switch saving');

  // No supplier price → safe nulls, contributes nothing.
  const noPrice = { id: 'p3', name: 'X', pack: '1', category: 'generic', tariff: 5, monthlyPacks: 10, suppliers: [] };
  const np = productMetrics(noPrice, DEFAULT_CONFIG);
  check(np.bestCost === null && np.currentCost === null, 'no supplier → null costs');
  check(np.marginPerPackCurrent === null && np.monthlyProfitCurrent === 0, 'no supplier → no profit, not a loss');
  check(np.lossMaker === false, 'unpriced line is not a loss-maker');

  // Default current supplier = cheapest when none named.
  const unnamedCurrent = { ...profitable, id: 'p4', currentSupplier: null };
  const uc = productMetrics(unnamedCurrent, DEFAULT_CONFIG);
  check(uc.current.name === 'B', 'unset current supplier defaults to the cheapest');
  check(approx(uc.switchSavingMonthly, 0), 'already-cheapest line has zero switch saving');

  // ── practiceTotals ───────────────────────────────────────────────────────────
  const totals = practiceTotals([profitable, loss, noPrice], DEFAULT_CONFIG);
  check(totals.productCount === 3, 'totals count all products');
  check(totals.pricedCount === 2, 'totals count only priced products');
  check(totals.lossCount === 1 && totals.lossMakers[0].id === 'p2', 'totals identify the loss-maker');
  check(
    totals.switchableCount === 1 && totals.switchOpportunities[0].id === 'p1',
    'totals identify switch opportunities'
  );
  check(
    approx(totals.monthlyProfitCurrent, m.monthlyProfitCurrent + lm.monthlyProfitCurrent),
    'total monthly profit sums line profits'
  );
  check(approx(totals.switchSavingMonthly, m.switchSavingMonthly), 'total switch saving sums line savings');
  check(approx(totals.annualProfitCurrent, totals.monthlyProfitCurrent * 12), 'annual total is 12× monthly');

  // ── CSV round-trip ───────────────────────────────────────────────────────────
  const csv = [
    CSV_HEADER,
    'Atorvastatin 20mg tablets,28,generic,1.43,180,Wholesaler A,0.78,',
    'Atorvastatin 20mg tablets,28,generic,1.43,180,Wholesaler B,0.62,yes',
    'Pregabalin 75mg caps,56,generic,2.10,60,Wholesaler C,1.42,yes',
  ].join('\n');
  const parsed = parseCsv(csv);
  check(parsed.length === 2, 'CSV rows grouped by name+pack into 2 products');
  const atorva = parsed.find((p) => p.name.startsWith('Atorvastatin'));
  check(atorva.suppliers.length === 2, 'two supplier quotes grouped under one product');
  check(atorva.currentSupplier === 'Wholesaler B', 'current-supplier flag parsed from CSV');
  check(approx(atorva.tariff, 1.43) && atorva.monthlyPacks === 180, 'tariff and monthly packs parsed');

  const roundTrip = parseCsv(toCsv(parsed));
  check(roundTrip.length === 2, 'toCsv → parseCsv preserves product count');
  const atorva2 = roundTrip.find((p) => p.name.startsWith('Atorvastatin'));
  check(
    atorva2 && atorva2.suppliers.length === 2 && atorva2.currentSupplier === 'Wholesaler B',
    'round-trip preserves suppliers and current flag'
  );

  // Money strings with £ and commas, and a quoted field with a comma, parse cleanly.
  const messy = parseCsv(
    'name,pack,category,tariff,monthlyPacks,supplier,price,current\n"Drug, special",10,branded,"£1,234.50",12,Supplier X,£2.00,1'
  );
  check(messy.length === 1 && messy[0].name === 'Drug, special', 'quoted field with comma parsed');
  check(approx(messy[0].tariff, 1234.5), 'money string with £ and thousands comma parsed');

  // ── sampleProducts ───────────────────────────────────────────────────────────
  const sample = sampleProducts();
  check(Array.isArray(sample) && sample.length >= 3, 'sampleProducts returns a non-trivial dataset');
  check(
    sample.every((p) => p.id && p.name && Array.isArray(p.suppliers)),
    'sample products are well-formed'
  );
  const sampleTotals = practiceTotals(sample, DEFAULT_CONFIG);
  check(sampleTotals.switchSavingMonthly > 0, 'sample dataset surfaces a positive switch saving');

  // ── Blank-price supplier must not be treated as a free (£0) quote ────────────
  const blankPrice = {
    id: 'p5',
    name: 'Omeprazole 20mg',
    pack: '28',
    category: 'generic',
    tariff: 1.0,
    monthlyPacks: 100,
    suppliers: [
      { name: 'A', price: 0.55 },
      { name: 'B', price: '' }, // not yet quoted
    ],
    currentSupplier: 'A',
  };
  const bp = productMetrics(blankPrice, DEFAULT_CONFIG);
  check(bp.best.name === 'A' && approx(bp.bestCost, 0.55), 'blank-price supplier is not the cheapest buy');
  check(approx(bp.switchSavingMonthly, 0), 'blank-price supplier produces no fake switch saving');
  check(bp.marginPerPackCurrent < bp.netReimb, 'margin is computed against the real (non-zero) cost');

  // Same hazard via CSV: an empty price cell is unpriced, not £0.
  const csvBlank = parseCsv(
    'name,pack,category,tariff,monthlyPacks,supplier,price,current\nDrugX,28,generic,1.00,100,A,0.55,yes\nDrugX,28,generic,1.00,100,B,,'
  );
  check(csvBlank.length === 1, 'CSV blank-price row groups into one product');
  const drugX = csvBlank[0];
  const bSup = drugX.suppliers.find((s) => s.name === 'B');
  check(bSup && bSup.price === '', 'empty CSV price cell parses to "" (unpriced), not 0');
  const cm = productMetrics(drugX, DEFAULT_CONFIG);
  check(cm.best.name === 'A' && approx(cm.switchSavingMonthly, 0), 'CSV unpriced supplier yields no fake saving');

  // ── CSV formula-injection guard ──────────────────────────────────────────────
  const danger = [
    {
      id: 'p6',
      name: '=cmd|calc',
      pack: '+1',
      category: 'generic',
      tariff: 1,
      monthlyPacks: 1,
      suppliers: [{ name: '@evil', price: 1 }],
      currentSupplier: '@evil',
    },
  ];
  const dangerCsv = toCsv(danger);
  check(dangerCsv.includes("'=cmd|calc"), 'formula-leading name is prefixed with apostrophe on export');
  check(/,'\+1,/.test(dangerCsv) || dangerCsv.includes("'+1"), 'formula-leading pack is guarded on export');
  check(dangerCsv.includes("'@evil"), 'formula-leading supplier name is guarded on export');
  const reparsed = parseCsv(dangerCsv);
  check(reparsed[0].name === '=cmd|calc', 'guard is stripped on re-import (lossless round-trip)');
  check(reparsed[0].suppliers[0].name === '@evil', 'supplier-name guard stripped on re-import');

  // ── parsePackQty ─────────────────────────────────────────────────────────────
  check(parsePackQty('28') === 28, 'pack quantity parsed from a bare number');
  check(parsePackQty('28 tablets') === 28, 'pack quantity parsed from "28 tablets"');
  check(parsePackQty('') === null && parsePackQty('OP') === null, 'no quantity → null');

  // ── cost-per-unit in productMetrics ──────────────────────────────────────────
  const cpu = productMetrics(
    {
      id: 'u1',
      name: 'Y',
      pack: '100',
      category: 'generic',
      tariff: 10,
      monthlyPacks: 1,
      suppliers: [{ name: 'A', price: 5 }],
      currentSupplier: 'A',
    },
    DEFAULT_CONFIG
  );
  check(approx(cpu.costPerUnit, 0.05), 'cost-per-unit = pack cost / pack quantity');
  check(approx(cpu.bestCostPerUnit, 0.05), 'best cost-per-unit computed');

  // ── marginBand (RAG) ─────────────────────────────────────────────────────────
  const th = { green: 25, amber: 10 };
  check(marginBand(40, th) === 'good', 'margin ≥ green → good');
  check(marginBand(15, th) === 'watch', 'margin between amber and green → watch');
  check(marginBand(2, th) === 'poor', 'margin below amber → poor');
  check(marginBand(-5, th) === 'poor', 'negative margin → poor');
  check(marginBand(null, th) === null, 'unknown margin → null band');

  // ── categoryBreakdown ────────────────────────────────────────────────────────
  const mix = [
    {
      id: 'c1',
      name: 'G1',
      pack: '28',
      category: 'generic',
      tariff: 2,
      monthlyPacks: 10,
      suppliers: [{ name: 'A', price: 1 }],
      currentSupplier: 'A',
    },
    {
      id: 'c2',
      name: 'B1',
      pack: '28',
      category: 'branded',
      tariff: 5,
      monthlyPacks: 10,
      suppliers: [{ name: 'A', price: 4 }],
      currentSupplier: 'A',
    },
  ];
  const cb = categoryBreakdown(mix, DEFAULT_CONFIG);
  check(cb.length === 2, 'breakdown has one row per populated category');
  check(
    cb.every((r) => r.productCount === 1 && Number.isFinite(r.monthlyProfitCurrent)),
    'breakdown rows carry counts and profit'
  );
  check(cb[0].monthlyProfitCurrent >= cb[1].monthlyProfitCurrent, 'breakdown sorted by profit, biggest first');

  // ── upsertSnapshot / ymKeyOf ─────────────────────────────────────────────────
  const ym = ymKeyOf(new Date('2026-06-15T00:00:00Z'));
  check(ym === '2026-06', 'ymKeyOf formats YYYY-MM');
  let hist = upsertSnapshot([], { monthlyProfitCurrent: 100 }, '2026-05');
  hist = upsertSnapshot(hist, { monthlyProfitCurrent: 120 }, '2026-06');
  check(hist.length === 2 && hist[1].ym === '2026-06', 'snapshots appended in month order');
  hist = upsertSnapshot(hist, { monthlyProfitCurrent: 130 }, '2026-06');
  check(hist.length === 2 && hist[1].monthlyProfitCurrent === 130, 'same-month snapshot replaced, not duplicated');
  const capped = Array.from({ length: 30 }, (_, i) => ({ ym: `y${i}`, monthlyProfitCurrent: i }));
  const cappedOut = capped.reduce((h, s) => upsertSnapshot(h, s, s.ym, 24), []);
  check(cappedOut.length === 24, 'history is capped to the configured length');

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
