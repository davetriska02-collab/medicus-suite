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

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
