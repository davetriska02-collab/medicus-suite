// Medicus Suite — Investigation Results queue triage chip tests
// Run with: node test-result-triage-queue.js

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0,
  failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
  }
}

// ============================================================
// Layer 1 — selectResultChips() pure helper
// ============================================================
console.log('Layer 1: selectResultChips() chip-selection logic');

const src = fs.readFileSync(path.join(__dirname, 'content-scripts', 'triage-lens', 'content.js'), 'utf8');

// Extract the standalone function from the IIFE
const fnMatch = src.match(/function selectResultChips\(sev\) \{[\s\S]*?\n  \}/);
check(!!fnMatch, 'selectResultChips function found in content.js');

let selectResultChips = null;
if (fnMatch) {
  const sandbox = {};
  vm.runInNewContext(fnMatch[0] + '\nthis.selectResultChips = selectResultChips;', sandbox);
  selectResultChips = sandbox.selectResultChips;
  check(typeof selectResultChips === 'function', 'selectResultChips extracted and callable');
}

if (selectResultChips) {
  // red + urgentCount > 0 -> resultUrgent
  const redSev = {
    level: 'red',
    urgentCount: 2,
    abnormalCount: 2,
    top: { name: 'Potassium', value: '6.8', unit: 'mmol/L' },
    misprioritised: false,
    unmatched: false,
  };
  const redChips = selectResultChips(redSev);
  check(redChips.length === 1, `red urgent: 1 chip (got ${redChips.length})`);
  check(
    redChips[0] && redChips[0].id === 'queue.resultUrgent',
    `red urgent: chip id is queue.resultUrgent (got ${redChips[0] && redChips[0].id})`
  );
  check(
    redChips[0] && redChips[0].vars.name === 'Potassium',
    `red urgent: vars.name is 'Potassium' (got ${redChips[0] && redChips[0].vars.name})`
  );
  check(
    redChips[0] && redChips[0].vars.count === 2,
    `red urgent: vars.count is 2 (got ${redChips[0] && redChips[0].vars.count})`
  );

  // amber -> resultAbnormal
  const amberSev = {
    level: 'amber',
    urgentCount: 0,
    abnormalCount: 3,
    top: null,
    misprioritised: false,
    unmatched: false,
  };
  const amberChips = selectResultChips(amberSev);
  check(amberChips.length === 1, `amber: 1 chip (got ${amberChips.length})`);
  check(amberChips[0] && amberChips[0].id === 'queue.resultAbnormal', `amber: chip id is queue.resultAbnormal`);
  check(amberChips[0] && amberChips[0].vars.count === 3, `amber: vars.count is 3`);

  // misprioritised adds resultMisprioritised
  const misSev = {
    level: 'red',
    urgentCount: 1,
    abnormalCount: 1,
    top: { name: 'Sodium', value: '125', unit: 'mmol/L' },
    misprioritised: true,
    unmatched: false,
  };
  const misChips = selectResultChips(misSev);
  check(misChips.length === 2, `misprioritised: 2 chips (got ${misChips.length})`);
  check(
    misChips.some((c) => c.id === 'queue.resultMisprioritised'),
    'misprioritised: includes queue.resultMisprioritised'
  );

  // Rule-chip label de-duplication (vars.label): the Medicus queue already shows
  // the analyte name, so a rule label that repeats it must not double up.
  const ruleChipLabel = (sev, id) => {
    const c = selectResultChips(sev).find((x) => x.id === id);
    return c ? c.vars.label : undefined;
  };
  const mkRuleSev = (name, ruleLabel) => ({
    level: 'red',
    urgentCount: 1,
    abnormalCount: 1,
    top: { name, value: '1', unit: '', ruleLabel },
    misprioritised: false,
    unmatched: false,
  });
  check(
    ruleChipLabel(mkRuleSev('B12', 'B12 low'), 'queue.resultRuleUrgent') === 'B12 low',
    "dedup: analyte at start — 'B12' + 'B12 low' -> 'B12 low'"
  );
  check(
    ruleChipLabel(mkRuleSev('B12', 'Low B12'), 'queue.resultRuleUrgent') === 'Low B12',
    "dedup: analyte at end — 'B12' + 'Low B12' -> 'Low B12'"
  );
  check(
    ruleChipLabel(mkRuleSev('Ferritin', 'low'), 'queue.resultRuleUrgent') === 'Ferritin — low',
    "dedup: no overlap — 'Ferritin' + 'low' -> 'Ferritin — low'"
  );
  check(
    ruleChipLabel(mkRuleSev('Ferritin', 'Ferritin borderline'), 'queue.resultRuleUrgent') === 'Ferritin borderline',
    "dedup: exact-prefix — 'Ferritin' + 'Ferritin borderline' -> 'Ferritin borderline'"
  );
  // amber path uses the same composer
  const amberRuleSev = {
    level: 'amber',
    urgentCount: 0,
    abnormalCount: 2,
    top: { name: 'B12', value: '1', unit: '', ruleLabel: 'B12 low' },
    misprioritised: false,
    unmatched: false,
  };
  check(
    ruleChipLabel(amberRuleSev, 'queue.resultRuleAbnormal') === 'B12 low',
    "dedup: amber rule chip also de-duplicates -> 'B12 low'"
  );
  check(
    misChips.find((c) => c.id === 'queue.resultMisprioritised')?.meta === true,
    'misprioritised: meta flag is true'
  );
  check(misChips.find((c) => c.id === 'queue.resultUrgent')?.meta !== true, 'urgent (clinical): meta flag is falsy');

  // unmatched adds resultUnmatched
  const unmatchSev = {
    level: 'amber',
    urgentCount: 0,
    abnormalCount: 1,
    top: null,
    misprioritised: false,
    unmatched: true,
  };
  const unmatchChips = selectResultChips(unmatchSev);
  check(unmatchChips.length === 2, `unmatched: 2 chips (got ${unmatchChips.length})`);
  check(
    unmatchChips.some((c) => c.id === 'queue.resultUnmatched'),
    'unmatched: includes queue.resultUnmatched'
  );
  check(unmatchChips.find((c) => c.id === 'queue.resultUnmatched')?.meta === true, 'unmatched: meta flag is true');
  check(
    unmatchChips.find((c) => c.id === 'queue.resultAbnormal')?.meta !== true,
    'abnormal (clinical): meta flag is falsy'
  );

  // none -> no chips
  const noneSev = {
    level: 'none',
    urgentCount: 0,
    abnormalCount: 0,
    top: null,
    misprioritised: false,
    unmatched: false,
  };
  const noneChips = selectResultChips(noneSev);
  check(noneChips.length === 0, `none: 0 chips (got ${noneChips.length})`);

  // null input -> []
  check(selectResultChips(null).length === 0, 'null input returns []');
  check(selectResultChips(undefined).length === 0, 'undefined input returns []');

  // red with urgentCount=0 falls back to amber path (no urgentCount chips)
  const redNoUrgent = {
    level: 'red',
    urgentCount: 0,
    abnormalCount: 2,
    top: null,
    misprioritised: false,
    unmatched: false,
  };
  const redNoUrgentChips = selectResultChips(redNoUrgent);
  check(!redNoUrgentChips.some((c) => c.id === 'queue.resultUrgent'), 'red urgentCount=0: no resultUrgent chip');

  // top null for urgent -> name is empty string
  const noTopSev = {
    level: 'red',
    urgentCount: 1,
    abnormalCount: 1,
    top: null,
    misprioritised: false,
    unmatched: false,
  };
  const noTopChips = selectResultChips(noTopSev);
  check(
    noTopChips[0] && noTopChips[0].vars.name === '',
    `red urgent no top: vars.name is empty string (got "${noTopChips[0] && noTopChips[0].vars.name}")`
  );

  // rule-driven red (top.ruleLabel set) → attributable queue.resultRuleUrgent
  const ruleRed = {
    level: 'red',
    urgentCount: 1,
    abnormalCount: 1,
    top: { name: 'Potassium', value: '6.7', unit: 'mmol/L', ruleLabel: 'Critical high potassium' },
    misprioritised: false,
    unmatched: false,
  };
  const ruleRedChips = selectResultChips(ruleRed);
  check(
    ruleRedChips.some((c) => c.id === 'queue.resultRuleUrgent'),
    'rule-driven red → queue.resultRuleUrgent'
  );
  check(!ruleRedChips.some((c) => c.id === 'queue.resultUrgent'), 'rule-driven red → NOT the generic resultUrgent');
  const rru = ruleRedChips.find((c) => c.id === 'queue.resultRuleUrgent');
  check(
    rru && rru.vars.rule === 'Critical high potassium' && rru.vars.name === 'Potassium',
    'resultRuleUrgent carries {name} and {rule}'
  );

  // rule-driven amber → attributable queue.resultRuleAbnormal
  const ruleAmber = {
    level: 'amber',
    urgentCount: 0,
    abnormalCount: 1,
    top: { name: 'HbA1c', value: '44', unit: 'mmol/mol', ruleLabel: 'Prediabetes range' },
    misprioritised: false,
    unmatched: false,
  };
  const ruleAmberChips = selectResultChips(ruleAmber);
  check(
    ruleAmberChips.some((c) => c.id === 'queue.resultRuleAbnormal'),
    'rule-driven amber → queue.resultRuleAbnormal'
  );
  check(
    !ruleAmberChips.some((c) => c.id === 'queue.resultAbnormal'),
    'rule-driven amber → NOT the generic resultAbnormal'
  );

  // lab-driven (no ruleLabel) → generic chips unchanged
  const labRed = {
    level: 'red',
    urgentCount: 1,
    abnormalCount: 1,
    top: { name: 'RDW', value: '16.7', unit: '%', ruleLabel: null },
    misprioritised: false,
    unmatched: false,
  };
  check(
    selectResultChips(labRed).some((c) => c.id === 'queue.resultUrgent'),
    'lab-driven red (null ruleLabel) → generic resultUrgent'
  );

  // text-review with a SPECIFIC rule label (e.g. bowel non-responder) → attributable chip
  const reviewLabelled = {
    level: 'amber',
    urgentCount: 0,
    abnormalCount: 0,
    top: null,
    misprioritised: false,
    unmatched: false,
    reviewCount: 1,
    reviewTop: { name: 'BCS:FOB result', label: 'Bowel screening: no response' },
  };
  const reviewLabelledChips = selectResultChips(reviewLabelled);
  check(
    reviewLabelledChips.some((c) => c.id === 'queue.resultReviewRule'),
    'labelled text review → queue.resultReviewRule'
  );
  check(
    !reviewLabelledChips.some((c) => c.id === 'queue.resultReview'),
    'labelled text review → NOT the generic resultReview'
  );
  const rrr = reviewLabelledChips.find((c) => c.id === 'queue.resultReviewRule');
  check(rrr && rrr.vars.rule === 'Bowel screening: no response', 'resultReviewRule carries the rule label in {rule}');
  // A text-review raises `level` to amber with abnormalCount=0 — the clinical abnormal
  // chip must NOT render (it would show a meaningless "0 abnormal" beside the review chip).
  check(
    !reviewLabelledChips.some((c) => c.id === 'queue.resultAbnormal'),
    'labelled text review (abnormalCount=0) → NO stray "0 abnormal" chip'
  );
  check(
    !reviewLabelledChips.some((c) => c.id === 'queue.resultRuleAbnormal'),
    'labelled text review (abnormalCount=0) → NO stray resultRuleAbnormal chip'
  );

  // text-review with the GENERIC "Needs review" label (e.g. a culture) → generic chip
  const reviewGeneric = {
    level: 'amber',
    urgentCount: 0,
    abnormalCount: 0,
    top: null,
    misprioritised: false,
    unmatched: false,
    reviewCount: 2,
    reviewTop: { name: 'MSU', label: 'Needs review' },
  };
  const reviewGenericChips = selectResultChips(reviewGeneric);
  check(
    reviewGenericChips.some((c) => c.id === 'queue.resultReview'),
    'generic "Needs review" text review → generic queue.resultReview (cultures unchanged)'
  );
  check(
    !reviewGenericChips.some((c) => c.id === 'queue.resultReviewRule'),
    'generic "Needs review" text review → NOT the attributable chip'
  );
  check(
    !reviewGenericChips.some((c) => c.id === 'queue.resultAbnormal'),
    'generic text review (abnormalCount=0) → NO stray "0 abnormal" chip'
  );

  // amber WITH a real numeric abnormal AND a text review → BOTH chips (abnormal not suppressed)
  const abnormalPlusReview = {
    level: 'amber',
    urgentCount: 0,
    abnormalCount: 2,
    top: { name: 'ALT', value: 120, unit: 'U/L', ruleLabel: null },
    misprioritised: false,
    unmatched: false,
    reviewCount: 1,
    reviewTop: { name: 'MSU', label: 'Needs review' },
  };
  const abnormalPlusReviewChips = selectResultChips(abnormalPlusReview);
  check(
    abnormalPlusReviewChips.some((c) => c.id === 'queue.resultAbnormal'),
    'amber with real abnormal (count>0) + review → abnormal chip STILL renders'
  );
  check(
    abnormalPlusReviewChips.find((c) => c.id === 'queue.resultAbnormal')?.vars.count === 2,
    'amber abnormal chip carries the real count (2), not 0'
  );
  check(
    abnormalPlusReviewChips.some((c) => c.id === 'queue.resultReview'),
    'amber with real abnormal + review → review chip also renders'
  );

  // text-noGrowth with a CUSTOM normal label (e.g. "Negative" H. pylori) → attributable
  // chip carrying that label, NOT the generic "No growth". This is the reported bug: the
  // chip must read the matched rule's normalLabel (sev.noGrowthTop.label), not the
  // hard-coded generic system-chip text.
  const noGrowthLabelled = {
    level: 'none',
    urgentCount: 0,
    abnormalCount: 0,
    top: null,
    misprioritised: false,
    unmatched: false,
    noGrowthCount: 1,
    noGrowthTop: { name: 'Helicobacter pylori stool antigen', label: 'Negative' },
  };
  const noGrowthLabelledChips = selectResultChips(noGrowthLabelled);
  check(
    noGrowthLabelledChips.some((c) => c.id === 'queue.resultNoGrowthRule'),
    'custom normal label → queue.resultNoGrowthRule'
  );
  check(
    !noGrowthLabelledChips.some((c) => c.id === 'queue.resultNoGrowth'),
    'custom normal label → NOT the generic resultNoGrowth'
  );
  const ngr = noGrowthLabelledChips.find((c) => c.id === 'queue.resultNoGrowthRule');
  check(ngr && ngr.vars.label === 'Negative', 'resultNoGrowthRule carries the rule normalLabel in {label}');

  // text-noGrowth with the DEFAULT "No growth" label (e.g. an MSU culture) → generic chip
  const noGrowthGeneric = {
    level: 'none',
    urgentCount: 0,
    abnormalCount: 0,
    top: null,
    misprioritised: false,
    unmatched: false,
    noGrowthCount: 2,
    noGrowthTop: { name: 'MSU', label: 'No growth' },
  };
  const noGrowthGenericChips = selectResultChips(noGrowthGeneric);
  check(
    noGrowthGenericChips.some((c) => c.id === 'queue.resultNoGrowth'),
    'default "No growth" normal label → generic queue.resultNoGrowth (cultures unchanged)'
  );
  check(
    !noGrowthGenericChips.some((c) => c.id === 'queue.resultNoGrowthRule'),
    'default "No growth" normal label → NOT the attributable chip'
  );

  // text-noGrowth with NO noGrowthTop (defensive) → falls back to the generic chip
  const noGrowthNoTop = {
    level: 'none',
    urgentCount: 0,
    abnormalCount: 0,
    top: null,
    misprioritised: false,
    unmatched: false,
    noGrowthCount: 1,
  };
  const noGrowthNoTopChips = selectResultChips(noGrowthNoTop);
  check(
    noGrowthNoTopChips.some((c) => c.id === 'queue.resultNoGrowth'),
    'noGrowth with no noGrowthTop → generic queue.resultNoGrowth (defensive fallback)'
  );

  // combo rule fired (e.g. sterile pyuria) → attributable queue.resultCombo carrying the
  // combo's label in {rule}. Escalate-only/amber; appears alongside any other chips.
  const comboSev = {
    level: 'amber',
    urgentCount: 0,
    abnormalCount: 0,
    top: null,
    misprioritised: false,
    unmatched: false,
    comboCount: 1,
    comboTop: { label: 'Sterile pyuria — pus cells raised, culture negative', level: 'amber' },
  };
  const comboChips = selectResultChips(comboSev);
  check(
    comboChips.some((c) => c.id === 'queue.resultCombo'),
    'fired combo → queue.resultCombo chip'
  );
  const combo = comboChips.find((c) => c.id === 'queue.resultCombo');
  check(
    combo && combo.vars.rule === 'Sterile pyuria — pus cells raised, culture negative',
    'queue.resultCombo carries the combo label in {rule}'
  );

  // comboCount=0 → no combo chip
  const noComboSev = {
    level: 'none',
    urgentCount: 0,
    abnormalCount: 0,
    top: null,
    misprioritised: false,
    unmatched: false,
    comboCount: 0,
    comboTop: null,
  };
  check(
    !selectResultChips(noComboSev).some((c) => c.id === 'queue.resultCombo'),
    'comboCount=0 → NO queue.resultCombo chip'
  );

  // comboCount>0 but comboTop null/missing label → defensive, no combo chip
  const comboNoTop = {
    level: 'amber',
    urgentCount: 0,
    abnormalCount: 0,
    top: null,
    misprioritised: false,
    unmatched: false,
    comboCount: 1,
    comboTop: null,
  };
  check(
    !selectResultChips(comboNoTop).some((c) => c.id === 'queue.resultCombo'),
    'comboCount>0 but no comboTop → NO combo chip (defensive)'
  );

  // ── item 2.6 (TRIAGE-LENS-2026-07-02.md) — trend arrow appended to the salient chip ──
  const mkRedWithPrior = (dir) => ({
    level: 'red',
    urgentCount: 1,
    abnormalCount: 1,
    top: {
      name: 'Potassium',
      value: '6.8',
      unit: 'mmol/L',
      prior: dir ? { value: 4.1, date: '2026-05-03', dir } : null,
    },
    misprioritised: false,
    unmatched: false,
  });
  check(
    selectResultChips(mkRedWithPrior('up')).find((c) => c.id === 'queue.resultUrgent').vars.name === 'Potassium ↑',
    "trend arrow: dir 'up' appends ↑ to the generic urgent chip's {name}"
  );
  check(
    selectResultChips(mkRedWithPrior('down')).find((c) => c.id === 'queue.resultUrgent').vars.name === 'Potassium ↓',
    "trend arrow: dir 'down' appends ↓"
  );
  check(
    selectResultChips(mkRedWithPrior('same')).find((c) => c.id === 'queue.resultUrgent').vars.name === 'Potassium',
    "trend arrow: dir 'same' → no arrow glyph"
  );
  check(
    selectResultChips(mkRedWithPrior(null)).find((c) => c.id === 'queue.resultUrgent').vars.name === 'Potassium',
    'trend arrow: no prior → no arrow glyph (backward compatible with pre-2.6 sev fixtures)'
  );

  // Rule-attributable chip (queue.resultRuleUrgent/resultRuleAbnormal) — the arrow
  // lands on the composed {label}, not on the raw {name}/{rule} vars (so a custom
  // template using {name} alone still shows the clean analyte name).
  const ruleRedWithPrior = {
    level: 'red',
    urgentCount: 1,
    abnormalCount: 1,
    top: {
      name: 'Potassium',
      value: '6.7',
      unit: 'mmol/L',
      ruleLabel: 'Critical high potassium',
      prior: { value: 4.1, date: '2026-05-03', dir: 'up' },
    },
    misprioritised: false,
    unmatched: false,
  };
  const rruChips = selectResultChips(ruleRedWithPrior);
  const rru2 = rruChips.find((c) => c.id === 'queue.resultRuleUrgent');
  check(rru2 && rru2.vars.label === 'Critical high potassium ↑', 'trend arrow: appended to the composed rule {label}');
  check(rru2 && rru2.vars.name === 'Potassium', 'trend arrow: raw {name} var left unmodified');
  check(rru2 && rru2.vars.rule === 'Critical high potassium', 'trend arrow: raw {rule} var left unmodified');

  // The generic amber chip (queue.resultAbnormal) has no name/label slot in its
  // shipped template ("{count} abnormal") — no defaults.json edit is in scope for
  // this change, so the arrow is deliberately NOT shown there (documented gap).
  const amberNoRuleWithPrior = {
    level: 'amber',
    urgentCount: 0,
    abnormalCount: 1,
    top: { name: 'ALT', value: '120', unit: 'U/L', prior: { value: 40, date: '2026-05-03', dir: 'up' } },
    misprioritised: false,
    unmatched: false,
  };
  const genericAmberChip = selectResultChips(amberNoRuleWithPrior).find((c) => c.id === 'queue.resultAbnormal');
  check(
    genericAmberChip && genericAmberChip.vars.count === 1 && !('name' in genericAmberChip.vars),
    'trend arrow: generic resultAbnormal chip vars are unchanged (no name/label slot to append to)'
  );
}

// ============================================================
// Layer 2 — overviewURL validation regex
// ============================================================
console.log('Layer 2: overviewURL validation regex');

// Extract the regex from content.js
const reMatch = src.match(/_OVERVIEW_URL_RE\s*=\s*(\/[^\n]+\/)/);
check(!!reMatch, '_OVERVIEW_URL_RE found in content.js');

let OVERVIEW_URL_RE = null;
if (reMatch) {
  try {
    // Extract pattern and flags from the regex literal
    const reStr = reMatch[1];
    const lastSlash = reStr.lastIndexOf('/');
    const pattern = reStr.slice(1, lastSlash);
    const flags = reStr.slice(lastSlash + 1);
    OVERVIEW_URL_RE = new RegExp(pattern, flags);
    check(true, '_OVERVIEW_URL_RE parsed from source');
  } catch (e) {
    check(false, `_OVERVIEW_URL_RE failed to parse: ${e.message}`);
  }
}

if (OVERVIEW_URL_RE) {
  // Valid paths
  check(
    OVERVIEW_URL_RE.test('/tasks/data/review-investigation-report/overview/550e8400-e29b-41d4-a716-446655440000'),
    'accepts real overview URL path'
  );
  check(
    OVERVIEW_URL_RE.test('/tasks/data/review_investigation_results_task/overview/550e8400-e29b-41d4-a716-446655440000'),
    'accepts underscore slug'
  );

  // Invalid paths — absolute URL with host
  check(
    !OVERVIEW_URL_RE.test(
      'https://example.medicus.health/tasks/data/review-investigation-report/overview/550e8400-e29b-41d4-a716-446655440000'
    ),
    'rejects https:// absolute URL'
  );
  // Path traversal
  check(!OVERVIEW_URL_RE.test('/tasks/data/../../../etc/passwd'), 'rejects path traversal with ..');
  // Absolute path with host embedded
  check(
    !OVERVIEW_URL_RE.test(
      '//evil.com/tasks/data/review-investigation-report/overview/550e8400-e29b-41d4-a716-446655440000'
    ),
    'rejects protocol-relative URL'
  );
  // Empty string
  check(!OVERVIEW_URL_RE.test(''), 'rejects empty string');
}

// ============================================================
// Layer 3 — result-chip re-injection wiring (regression guards)
// ============================================================
console.log('Layer 3: result-chip re-injection & cache-invalidation wiring');

// refreshQueueChips() must re-DISPLAY result chips on every grid re-render — otherwise
// AG Grid strips the .ch-q-result chips and they never come back. It does this via
// reinjectCachedResultChips (durable, from the per-task cache), NOT by kicking a fetch
// pass (that re-started/aborted the worker and starved it — only the first few rows got
// tagged). Guard both: re-injection present, fetch-trigger absent.
const rqcMatch = src.match(/const refreshQueueChips = \(\) => \{[\s\S]*?\n {2}\};/);
check(!!rqcMatch, 'refreshQueueChips function found');
if (rqcMatch) {
  check(
    /reinjectCachedResultChips\(\)/.test(rqcMatch[0]),
    'refreshQueueChips re-displays result chips via reinjectCachedResultChips() (durable)'
  );
  check(
    !/scheduleQueueResultTriage\(\)/.test(rqcMatch[0]),
    'refreshQueueChips does NOT kick a fetch pass (would starve the worker)'
  );
  check(/scheduleQueueMonitoring\(\)/.test(rqcMatch[0]), 'refreshQueueChips still re-runs scheduleQueueMonitoring()');
  // v3.72.0 — observer reuse: refreshQueueChips must NOT null the container then call
  // setupQueueObserver() (that forced a needless full rebuild on every grid mutation);
  // it re-arms the SAME observer instead.
  check(
    !/queueObservedContainer = null;\s*\n\s*setupQueueObserver\(\)/.test(rqcMatch[0]),
    'refreshQueueChips no longer nulls the container then rebuilds the observer (reuses it)'
  );
  // v3.72.0 — grid-scoped sweeps: the wipe/re-decorate sweeps must run over queueScope(),
  // not the whole document (so the per-frame cost scales with the grid, not the page).
  check(
    !/document\.querySelectorAll\('\.ch-queue-chips/.test(rqcMatch[0]),
    'refreshQueueChips wipe sweep is grid-scoped (queueScope), not document-wide'
  );
}

// ============================================================
// Layer 3b — v3.72.0 performance plan: visible-first ordering, concurrency,
// budget-aware backoff, memoised chip HTML, on-screen re-injection.
// ============================================================
console.log('Layer 3b: v3.72.0 result-triage performance wiring');

// (a) scheduleQueueResultTriage: on-screen partition first, concurrency 5, soft budget.
check(/onScreen/.test(src), 'scheduleQueueResultTriage builds an on-screen partition (visible-first ordering)');
check(/CONCURRENCY = 5/.test(src), 'result-triage concurrency is 5');
check(/_RESULT_FETCH_SOFT/.test(src), '_RESULT_FETCH_SOFT (budget-aware backoff threshold) is present');

// (b) Memoised chip HTML + cache invalidation on config change.
check(/_chipHtmlMemo/.test(src), '_chipHtmlMemo (rendered chip HTML memo) is present');
const watchForMemo = src.match(/watchConfig\(\(\) => \{[\s\S]*?\n {4}\}\);/);
check(
  !!watchForMemo && /_chipHtmlMemo\.clear\(\)/.test(watchForMemo[0]),
  'config change clears _chipHtmlMemo (edited labels/kinds re-render, not stale)'
);

// (c) reinjectCachedResultChips iterates on-screen rows, still keyed via _durableRowMap,
//     still TTL-gated.
const ricMatch = src.match(/const reinjectCachedResultChips = \(\) => \{[\s\S]*?\n {2}\};/);
check(!!ricMatch, 'reinjectCachedResultChips function found');
if (ricMatch) {
  check(
    /\.ag-row\[row-index\]/.test(ricMatch[0]),
    'reinjectCachedResultChips iterates on-screen .ag-row[row-index] rows'
  );
  check(
    /_durableRowMap\.get\(/.test(ricMatch[0]),
    'reinjectCachedResultChips still keyed via _durableRowMap.get(rowIndex) → taskUuid'
  );
  check(/_RESULT_CACHE_TTL/.test(ricMatch[0]), 'reinjectCachedResultChips still honours _RESULT_CACHE_TTL');
}

// A config change must invalidate the cached per-row result severities so an
// edited/enabled rule is recomputed rather than re-shown stale.
const watchMatch = src.match(/watchConfig\(\(\) => \{[\s\S]*?\n {4}\}\);/);
check(!!watchMatch, 'watchConfig(onChange) callback found');
if (watchMatch) {
  check(
    /_queueResultCache\.values\(\)[\s\S]*?\.sev = undefined/.test(watchMatch[0]),
    'config change invalidates cached _queueResultCache severities (recompute, not stale)'
  );
}

// scheduleQueueResultTriage must release its run latch in a finally so a thrown
// worker cannot permanently block every future result-triage pass.
const sqrtMatch = src.match(/const scheduleQueueResultTriage = async \(\) => \{[\s\S]*?\n {2}\};/);
check(!!sqrtMatch, 'scheduleQueueResultTriage function found');
if (sqrtMatch) {
  check(
    /finally\s*\{[\s\S]*?_queueResultRunning = false/.test(sqrtMatch[0]),
    'scheduleQueueResultTriage resets _queueResultRunning in a finally block'
  );
}

// ============================================================
// Layer 3c — v3.73.0 performance plan: visible burst un-throttled, leading-edge
// first fetch pass, MutationObserver own-chip self-trigger suppression.
// ============================================================
console.log('Layer 3c: v3.73.0 result-triage scheduler/observer wiring');

// (a) The worker applies a ZERO inter-fetch delay for on-screen rows (the off-screen
//     tail keeps the computed 100ms→1000ms backoff).
if (sqrtMatch) {
  check(
    /onScreen\.has\(rowIndex\)\s*\n?\s*\?\s*0/.test(sqrtMatch[0]),
    'worker applies a zero inter-fetch delay for on-screen rows (visible burst un-throttled)'
  );
}

// (b) Leading-edge FIRST fetch pass per queue entry (skips the 150ms debounce once).
check(/_firstResultPassPending/.test(src), 'leading-edge first fetch pass flag (_firstResultPassPending) present');

// (c) The queue MutationObserver ignores batches that are entirely our own chip injections.
check(/_isOwnChipMutation/.test(src), 'MutationObserver self-trigger suppression (_isOwnChipMutation) present');

// ============================================================
// Layer 4 — per-row fetch gate honours the text-outcome chips
// ============================================================
// computeQueueRowResult skips the per-row fetch when no result chip is enabled. The gate
// must include the culture/text chips (review + normal/noGrowth and their attributable
// variants) — otherwise a config that disables the numeric chips but keeps the culture
// chips fetches nothing and shows nothing.
console.log('Layer 4: per-row fetch gate (anyEnabled) honours text-outcome chips');
const gateMatch = src.match(/const anyEnabled = \[[\s\S]*?\]\s*\n?\s*\.some\(c => c && c\.enabled !== false\);/);
check(!!gateMatch, 'computeQueueRowResult anyEnabled gate found');
if (gateMatch) {
  check(/reviewCfg/.test(gateMatch[0]), 'fetch gate includes queue.resultReview chip');
  check(/reviewRuleCfg/.test(gateMatch[0]), 'fetch gate includes queue.resultReviewRule chip');
  check(/noGrowthCfg/.test(gateMatch[0]), 'fetch gate includes queue.resultNoGrowth chip');
  check(/noGrowthRuleCfg/.test(gateMatch[0]), 'fetch gate includes queue.resultNoGrowthRule chip');
  check(/comboCfg/.test(gateMatch[0]), 'fetch gate includes queue.resultCombo chip');
}

// ============================================================
// Layer 5 — item 1.1 leg D (TRIAGE-LENS-2026-07-02.md): the "couldn't check"
// error chip contract. computeQueueRowResult / the scheduler's fetch-gate are
// out of scope for the DOM-injection harness (test-queue-injection-smoke.js
// covers the render/de-dupe/churn/tint side with literal cache entries), so
// this file source-verifies the fetch/eval/cache wiring instead — same style
// as Layer 3/3b/3c above.
// ============================================================
console.log('Layer 5: leg D — "couldn\'t check" error-chip fetch/cache wiring');

// (a) computeQueueRowResult returns the QUEUE_RESULT_FETCH_ERROR sentinel (not
//     a silent null) on every genuine fetch/eval failure — globals missing,
//     the report fetch throwing, and evaluateReportSeverity throwing.
const cqrrMatch = src.match(/const computeQueueRowResult = async \(taskUuid\) => \{[\s\S]*?\n {2}\};/);
check(!!cqrrMatch, 'computeQueueRowResult function found');
check(/const QUEUE_RESULT_FETCH_ERROR = Object\.freeze\(/.test(src), 'QUEUE_RESULT_FETCH_ERROR sentinel defined');
if (cqrrMatch) {
  // fetchInvestigationReport/evaluateReportSeverity throwing are the LAST
  // "return QUEUE_RESULT_FETCH_ERROR" sites in the function, so a non-greedy
  // scan forward from each log line correctly lands on its OWN return (not a
  // later unrelated one). The globals/no-overviewURL checks below are instead
  // anchored to the literal `return null;` statement precisely, so a lazy
  // `[\s\S]*?` can't accidentally cross into a LATER unrelated
  // "return QUEUE_RESULT_FETCH_ERROR" elsewhere in the function and false-pass.
  check(
    /fetchInvestigationReport threw[\s\S]*?return QUEUE_RESULT_FETCH_ERROR/.test(cqrrMatch[0]),
    'a thrown report fetch returns the error sentinel'
  );
  check(
    /evaluateReportSeverity threw[\s\S]*?return QUEUE_RESULT_FETCH_ERROR/.test(cqrrMatch[0]),
    'a thrown evaluateReportSeverity() returns the error sentinel (previously uncaught)'
  );
  // Structural "nothing to check" paths — NOT per-row failures — must stay
  // plain null, never the error sentinel: a disabled feature (anyEnabled
  // false), the whole Sentinel API being absent from this world (globals not
  // loaded / no medicus context — a page-load-order issue, not this row's
  // fault), and a row with no matching investigation report at all.
  check(
    /if \(!anyEnabled\) return null;/.test(cqrrMatch[0]),
    'disabled feature (anyEnabled false) still returns plain null, not the error sentinel'
  );
  check(
    /if \(!API \|\| !NORM \|\| !SEV\) \{ log\('queue-result: globals not loaded', taskUuid\); return null; \}/.test(
      cqrrMatch[0]
    ),
    'missing Sentinel globals still returns plain null, not the error sentinel (whole feature unavailable, not a per-row failure)'
  );
  check(
    /if \(!ctx\) \{ log\('queue-result: no medicus context'\); return null; \}/.test(cqrrMatch[0]),
    'no medicus API context still returns plain null, not the error sentinel'
  );
  check(
    /if \(!entry \|\| !entry\.overviewURL\) \{ log\('queue-result: no overviewURL', taskUuid\); return null; \}/.test(
      cqrrMatch[0]
    ),
    'row with no matching investigation report still returns plain null, not the error sentinel'
  );
}

// (b) The scheduler's worker writes { sev: null, error: true } into
//     _queueResultCache on an error-sentinel result, and its own freshness
//     check uses the SHORT _RESULT_ERROR_TTL for error entries rather than
//     the normal 5-minute TTL — an expired error entry must fall through to
//     a real refetch, not linger as "fresh".
if (sqrtMatch) {
  check(
    /const isError = sev === QUEUE_RESULT_FETCH_ERROR;/.test(sqrtMatch[0]),
    'scheduler worker distinguishes the error sentinel from a definitive-null result'
  );
  check(/e2\.error = isError;/.test(sqrtMatch[0]), 'scheduler worker persists entry.error into _queueResultCache');
  check(
    /entry && entry\.error \? _RESULT_ERROR_TTL : _RESULT_CACHE_TTL/.test(sqrtMatch[0]),
    "scheduler's own freshness check uses _RESULT_ERROR_TTL for error entries (expired error = not cached = retried)"
  );
}

// (c) reinjectCachedResultChips renders the error entry (grey chip) while
//     live, and — mirroring the scheduler — treats an expired error entry as
//     not-cached (renders nothing, letting the next scheduler pass retry it).
if (ricMatch) {
  check(
    /entry\.sev === null && !entry\.error/.test(ricMatch[0]),
    'reinjectCachedResultChips only skips sev===null when it is NOT an error entry (error entries still render)'
  );
  check(
    /entry\.error \? _RESULT_ERROR_TTL : _RESULT_CACHE_TTL/.test(ricMatch[0]),
    'reinjectCachedResultChips applies the short _RESULT_ERROR_TTL to error entries, not the long normal TTL'
  );
}

// ============================================================
// Layer 6 — item 2.2/2.6 (TRIAGE-LENS-2026-07-02.md): buildResultDetail() /
// formatDetailLine() pure helpers, vm-extracted the same way as selectResultChips.
// ============================================================
console.log('Layer 6: buildResultDetail() / formatDetailLine() pure helpers');

const bdFnMatch = src.match(/function buildResultDetail\(report, sevResult\) \{[\s\S]*?\n  \}/);
check(!!bdFnMatch, 'buildResultDetail function found in content.js');
const fdlFnMatch = src.match(/function formatDetailLine\(entry\) \{[\s\S]*?\n  \}/);
check(!!fdlFnMatch, 'formatDetailLine function found in content.js');

let buildResultDetail = null;
let formatDetailLine = null;
if (bdFnMatch && fdlFnMatch) {
  const sandbox = {};
  vm.runInNewContext(
    bdFnMatch[0] +
      '\n' +
      fdlFnMatch[0] +
      '\nthis.buildResultDetail = buildResultDetail; this.formatDetailLine = formatDetailLine;',
    sandbox
  );
  buildResultDetail = sandbox.buildResultDetail;
  formatDetailLine = sandbox.formatDetailLine;
  check(typeof buildResultDetail === 'function', 'buildResultDetail extracted and callable');
  check(typeof formatDetailLine === 'function', 'formatDetailLine extracted and callable');
}

if (buildResultDetail && formatDetailLine) {
  // ── buildResultDetail: defensive inputs ──
  check(buildResultDetail(null, null).length === 0, 'null report/sev → []');
  check(buildResultDetail({ results: [] }, undefined).length === 0, 'undefined sev → []');
  check(
    buildResultDetail({ results: [] }, { level: 'none', flagged: [] }).length === 0,
    'no flagged/reviewTop/noGrowthTop/comboTop → []'
  );

  // ── buildResultDetail: priority order — urgent before abnormal, report order within tier ──
  const flaggedFixture = [
    {
      index: 0,
      name: 'ALT',
      effSev: 'abnormal',
      value: 90,
      unit: 'U/L',
      low: 3,
      high: 40,
      date: '2026-06-01',
      isAbove: true,
      isBelow: false,
      urgent: false,
      ruleLabel: null,
      ruleComparator: null,
      ruleThreshold: null,
      prior: null,
    },
    {
      index: 1,
      name: 'Potassium',
      effSev: 'urgent',
      value: 6.8,
      unit: 'mmol/L',
      low: 3.5,
      high: 5.3,
      date: '2026-06-12',
      isAbove: true,
      isBelow: false,
      urgent: true,
      ruleLabel: null,
      ruleComparator: null,
      ruleThreshold: null,
      prior: null,
    },
    {
      index: 2,
      name: 'eGFR',
      effSev: 'abnormal',
      value: 38,
      unit: 'mL/min',
      low: 90,
      high: null,
      date: '2026-06-01',
      isAbove: false,
      isBelow: true,
      urgent: false,
      ruleLabel: null,
      ruleComparator: null,
      ruleThreshold: null,
      prior: null,
    },
  ];
  const orderedSev = { level: 'red', flagged: flaggedFixture };
  const orderedDetail = buildResultDetail({ results: [] }, orderedSev);
  check(orderedDetail.length === 3, `all 3 flagged entries included (got ${orderedDetail.length})`);
  check(orderedDetail[0].name === 'Potassium', 'urgent-flagged result placed FIRST regardless of report order');
  check(
    orderedDetail[1].name === 'ALT' && orderedDetail[2].name === 'eGFR',
    'abnormal-flagged results follow, in report order'
  );

  // ── buildResultDetail: capped at 10, urgent entries always win a slot over abnormal ──
  const manyFlagged = [];
  for (let i = 0; i < 3; i++) {
    manyFlagged.push({
      index: i,
      name: 'U' + i,
      effSev: 'urgent',
      value: 1,
      unit: null,
      low: null,
      high: null,
      date: null,
      isAbove: false,
      isBelow: false,
      urgent: true,
      ruleLabel: null,
      ruleComparator: null,
      ruleThreshold: null,
      prior: null,
    });
  }
  for (let i = 3; i < 12; i++) {
    manyFlagged.push({
      index: i,
      name: 'A' + i,
      effSev: 'abnormal',
      value: 1,
      unit: null,
      low: null,
      high: null,
      date: null,
      isAbove: true,
      isBelow: false,
      urgent: false,
      ruleLabel: null,
      ruleComparator: null,
      ruleThreshold: null,
      prior: null,
    });
  }
  const cappedDetail = buildResultDetail({ results: [] }, { level: 'red', flagged: manyFlagged });
  check(cappedDetail.length === 10, `capped at 10 entries (got ${cappedDetail.length}, from 12 flagged)`);
  check(
    cappedDetail.slice(0, 3).every((e) => e.name.startsWith('U')),
    'all 3 urgent entries kept (never dropped for cap)'
  );
  check(
    cappedDetail.slice(3).every((e) => e.name.startsWith('A')),
    'remaining 7 slots filled by abnormal entries in order'
  );

  // ── buildResultDetail: flag direction precedence (isAbove/isBelow > ruleComparator > urgent) ──
  const dirFixture = (over) => ({
    level: 'amber',
    flagged: [
      {
        index: 0,
        name: 'X',
        effSev: 'abnormal',
        value: 1,
        unit: null,
        low: null,
        high: null,
        date: null,
        isAbove: false,
        isBelow: false,
        urgent: false,
        ruleLabel: null,
        ruleComparator: null,
        ruleThreshold: null,
        prior: null,
        ...over,
      },
    ],
  });
  check(
    buildResultDetail({ results: [] }, dirFixture({ isAbove: true }))[0].flag === 'above',
    'isAbove → flag "above"'
  );
  check(
    buildResultDetail({ results: [] }, dirFixture({ isBelow: true }))[0].flag === 'below',
    'isBelow → flag "below"'
  );
  check(
    buildResultDetail({ results: [] }, dirFixture({ ruleComparator: 'below' }))[0].flag === 'below',
    'no lab flag but ruleComparator "below" → flag "below"'
  );
  check(
    buildResultDetail({ results: [] }, dirFixture({ urgent: true, effSev: 'urgent' }))[0].flag === 'urgent',
    'no direction known at all, but urgent → flag "urgent" (last-resort fallback)'
  );
  check(buildResultDetail({ results: [] }, dirFixture({}))[0].flag === null, 'no direction, not urgent → flag null');

  // ── buildResultDetail: rule threshold summary composed onto ruleLabel ──
  const ruleFiredSev = {
    level: 'red',
    flagged: [
      {
        index: 0,
        name: 'Potassium',
        effSev: 'urgent',
        value: 6.8,
        unit: 'mmol/L',
        low: 3.5,
        high: 5.3,
        date: '2026-06-12',
        isAbove: true,
        isBelow: false,
        urgent: false,
        ruleLabel: 'Critical high potassium',
        ruleComparator: 'above',
        ruleThreshold: 6.5,
        prior: null,
      },
    ],
  };
  const ruleFiredEntry = buildResultDetail({ results: [] }, ruleFiredSev)[0];
  check(
    ruleFiredEntry.ruleLabel === 'Critical high potassium (red ≥6.5)',
    `rule threshold summary composed (got "${ruleFiredEntry.ruleLabel}")`
  );
  const ruleFiredBelow = buildResultDetail(
    { results: [] },
    {
      level: 'amber',
      flagged: [
        {
          index: 0,
          name: 'Sodium',
          effSev: 'abnormal',
          value: 128,
          unit: 'mmol/L',
          low: 133,
          high: 145,
          date: '2026-06-12',
          isAbove: false,
          isBelow: true,
          urgent: false,
          ruleLabel: 'Low sodium',
          ruleComparator: 'below',
          ruleThreshold: 130,
          prior: null,
        },
      ],
    }
  )[0];
  check(
    ruleFiredBelow.ruleLabel === 'Low sodium (amber ≤130)',
    `below-comparator threshold summary (got "${ruleFiredBelow.ruleLabel}")`
  );
  check(
    buildResultDetail(
      { results: [] },
      {
        level: 'red',
        flagged: [
          {
            index: 0,
            name: 'K',
            effSev: 'urgent',
            value: 6.8,
            unit: null,
            low: null,
            high: null,
            date: null,
            isAbove: false,
            isBelow: false,
            urgent: true,
            ruleLabel: null,
            ruleComparator: null,
            ruleThreshold: null,
            prior: null,
          },
        ],
      }
    )[0].ruleLabel === null,
    'no rule fired → ruleLabel null (no fabricated threshold text)'
  );

  // ── buildResultDetail: prior passed through unchanged ──
  const priorObj = { value: 4.1, date: '2026-05-03', dir: 'up' };
  const withPrior = buildResultDetail(
    { results: [] },
    {
      level: 'red',
      flagged: [
        {
          index: 0,
          name: 'K',
          effSev: 'urgent',
          value: 6.8,
          unit: 'mmol/L',
          low: 3.5,
          high: 5.3,
          date: '2026-06-12',
          isAbove: true,
          isBelow: false,
          urgent: true,
          ruleLabel: null,
          ruleComparator: null,
          ruleThreshold: null,
          prior: priorObj,
        },
      ],
    }
  )[0];
  check(withPrior.prior === priorObj, 'prior object passed through unchanged from the flagged entry');

  // ── buildResultDetail: rule-fired (text-rule) review + combo + noGrowth tail entries ──
  const tailSev = {
    level: 'amber',
    flagged: [],
    reviewTop: { name: 'MSU', label: 'Needs review' },
    comboTop: { label: 'Sterile pyuria', level: 'amber' },
    noGrowthTop: { name: 'H. pylori antigen', label: 'Negative' },
  };
  const tailReport = { results: [{ name: 'MSU', rawValue: 'Growth of mixed organisms', date: '2026-06-10' }] };
  const tailDetail = buildResultDetail(tailReport, tailSev);
  check(tailDetail.length === 3, `review + combo + noGrowth tail entries all present (got ${tailDetail.length})`);
  check(
    tailDetail[0].name === 'MSU' && tailDetail[0].ruleLabel === 'Needs review',
    'tier 3: rule-fired review entry first'
  );
  check(
    tailDetail[0].value === 'Growth of mixed organisms',
    'tier 3: review entry value cross-referenced from report.results by name'
  );
  check(
    tailDetail[1].name === 'Sterile pyuria' && tailDetail[1].flag === null,
    'tier 4: amber combo entry, flag null (not urgent)'
  );
  check(
    tailDetail[2].name === 'H. pylori antigen' && tailDetail[2].ruleLabel === 'Negative',
    'tier 4: noGrowth entry last'
  );
  const redComboDetail = buildResultDetail(
    { results: [] },
    { level: 'red', flagged: [], comboTop: { label: 'X', level: 'red' } }
  );
  check(redComboDetail[0].flag === 'urgent', 'a RED combo gets flag "urgent" (amber combo gets flag null)');

  // ── formatDetailLine: full line matching the plan's illustrative shape ──
  const fullEntry = {
    name: 'Potassium',
    value: 6.2,
    unit: 'mmol/L',
    low: 3.5,
    high: 5.3,
    flag: 'above',
    date: '2026-06-12',
    ruleLabel: 'Critical high potassium (red ≥6.5)',
    prior: { value: 4.1, date: '2026-05-03', dir: 'up' },
  };
  check(
    formatDetailLine(fullEntry) ===
      'Potassium 6.2 mmol/L ↑ (3.5–5.3) · 12 Jun · rule: Critical high potassium (red ≥6.5) · was 4.1, 03 May',
    `formatDetailLine full shape (got "${formatDetailLine(fullEntry)}")`
  );

  // ── formatDetailLine: omits missing pieces cleanly ──
  const minimalEntry = {
    name: 'MSU',
    value: null,
    unit: null,
    low: null,
    high: null,
    flag: null,
    date: null,
    ruleLabel: null,
    prior: null,
  };
  check(formatDetailLine(minimalEntry) === 'MSU', 'formatDetailLine: minimal entry → just the name');
  check(
    formatDetailLine(null) === '' && formatDetailLine(undefined) === '',
    'formatDetailLine: null/undefined → empty string'
  );

  // ── formatDetailLine: glyph mapping ──
  const glyphEntry = (flag) => ({
    name: 'X',
    value: 1,
    unit: null,
    low: null,
    high: null,
    flag,
    date: null,
    ruleLabel: null,
    prior: null,
  });
  check(formatDetailLine(glyphEntry('above')).includes('↑'), 'formatDetailLine: "above" flag → ↑ glyph');
  check(formatDetailLine(glyphEntry('below')).includes('↓'), 'formatDetailLine: "below" flag → ↓ glyph');
  check(formatDetailLine(glyphEntry('urgent')).includes('❗'), 'formatDetailLine: "urgent" flag → ❗ glyph');
  check(!formatDetailLine(glyphEntry(null)).match(/[↑↓❗]/), 'formatDetailLine: null flag → no glyph');

  // ── formatDetailLine: date formatting (zero-padded day, 3-letter month) ──
  check(
    formatDetailLine({
      name: 'X',
      value: 1,
      unit: null,
      low: null,
      high: null,
      flag: null,
      date: '2026-05-03',
      ruleLabel: null,
      prior: null,
    }).includes('03 May'),
    'formatDetailLine: single-digit day is zero-padded ("03 May")'
  );

  // ── formatDetailLine: prior with dir "same" still shows "was X" (arrow lives on the chip, not here) ──
  check(
    formatDetailLine({
      name: 'X',
      value: 5,
      unit: null,
      low: null,
      high: null,
      flag: null,
      date: null,
      ruleLabel: null,
      prior: { value: 5, date: '2026-01-01', dir: 'same' },
    }).includes('was 5, 01 Jan'),
    'formatDetailLine: dir "same" prior still renders "was X, date"'
  );
}

// ============================================================
// Layer 7 — item 2.2: injectResultChip wiring (taskUuid param, clickable chips,
// popover functions present, error-chip popover, no-innerHTML discipline on the
// popover build path). Source-verified here; the behavioural DOM side (open/
// close/anchor-death, error popover text rendering) is driven for real in
// test-queue-injection-smoke.js.
// ============================================================
console.log('Layer 7: result-chip popover wiring (item 2.2)');

const injectFnMatch = src.match(/const injectResultChip = \(rowIndex, sev, taskUuid, isError\) => \{[\s\S]*?\n  \};/);
check(!!injectFnMatch, 'injectResultChip takes (rowIndex, sev, taskUuid, isError)');
if (injectFnMatch) {
  check(
    /dataset\.chTaskUuid = taskUuid/.test(injectFnMatch[0]),
    'injectResultChip stamps the task uuid onto the chip host'
  );
  check(/setAttribute\('role', 'button'\)/.test(injectFnMatch[0]), 'clickable chips get role="button"');
  check(
    /setAttribute\('tabindex', '0'\)/.test(injectFnMatch[0]),
    'clickable chips get tabindex="0" (keyboard reachable)'
  );
  check(/addEventListener\('click'/.test(injectFnMatch[0]), 'chips get a click handler');
  check(/addEventListener\('keydown'/.test(injectFnMatch[0]), 'chips get a keydown handler (Enter/Space)');
  check(/e\.key === 'Enter' \|\| e\.key === ' '/.test(injectFnMatch[0]), 'keydown handler responds to Enter and Space');
  check(
    /toggleResultDetailPopover\(chipEl, taskUuid, !!isError\)/.test(injectFnMatch[0]),
    'click/keydown opens the detail popover for this chip, threading the error state'
  );
}

// All THREE injection call sites — the durable re-inject path
// (reinjectCachedResultChips) and the scheduler's cache-hit + post-fetch paths —
// must pass taskUuid through, or the chips injected by one of the paths would
// silently lose popover-ability (CLAUDE.md: "handlers attach at inject time — both
// initial and reinject go through injectResultChip, verify"). They must ALSO all
// still pass the error flag (item 1.1 leg D) — the grey "?" chip keeps rendering.
check(
  /injectResultChip\(rowIndex, entry\.sev, taskUuid, !!entry\.error\)/.test(src),
  'reinjectCachedResultChips passes taskUuid AND the error flag to injectResultChip'
);
check(
  /injectResultChip\(rowIndex, isError \? null : sev, taskUuid, isError\)/.test(src),
  'scheduler post-fetch path passes taskUuid AND the error flag'
);
const workerCallSites = src.match(/injectResultChip\(rowIndex, [^)]*taskUuid[^)]*\)/g) || [];
check(
  workerCallSites.length >= 3,
  `injectResultChip is called with taskUuid at all 3 sites (reinject + fresh-cache-hit + post-fetch) — found ${workerCallSites.length}`
);

// computeQueueRowResult attaches the detail array onto sev, and the scheduler
// mirrors it onto the cache entry alongside .sev/.error — but NEVER for an error
// result (the error popover is the fixed explanation, not stale numbers).
check(
  /sev\.detail = buildResultDetail\(report, sev\)/.test(src),
  'computeQueueRowResult attaches sev.detail via buildResultDetail'
);
check(
  /e2\.detail = !isError && sev && sev\.detail \? sev\.detail : undefined;/.test(src),
  'scheduler mirrors sev.detail onto the cache entry as e2.detail, cleared for error entries'
);
check(
  /entry\.sev = undefined; entry\.ts = 0; entry\.detail = undefined;/.test(src),
  'config-change cache invalidation also clears the stale .detail (not just .sev)'
);

// The popover build path — no innerHTML of any lab-derived string. Grey '?' error
// chips get a popover too: fixed explanation text that says it retries automatically.
const popoverBuildMatch = src.match(/const buildResultDetailPopoverEl = \(detail, isError\) => \{[\s\S]*?\n  \};/);
check(!!popoverBuildMatch, 'buildResultDetailPopoverEl function found (takes isError)');
if (popoverBuildMatch) {
  check(
    !/\.innerHTML/.test(popoverBuildMatch[0]),
    'buildResultDetailPopoverEl never uses innerHTML (createElement/textContent only)'
  );
  check(/createElement\('div'\)/.test(popoverBuildMatch[0]), 'buildResultDetailPopoverEl uses createElement');
  check(
    /\.textContent = formatDetailLine\(entry\)/.test(popoverBuildMatch[0]),
    'each line is assigned via textContent, not innerHTML'
  );
  check(
    /\.textContent = RESULT_ERROR_POPOVER_TEXT/.test(popoverBuildMatch[0]),
    'the error popover text is ALSO assigned via textContent'
  );
}
check(
  /const RESULT_ERROR_POPOVER_TEXT =[\s\S]*?retries automatically/.test(src),
  'error-chip popover text exists and says it retries automatically'
);
// The toggle re-reads the error state from the LIVE cache entry so a row that
// flipped to error since inject never shows a stale numeric detail array.
const toggleMatch = src.match(/const toggleResultDetailPopover = \(anchorEl, taskUuid, isError\) => \{[\s\S]*?\n  \};/);
check(!!toggleMatch, 'toggleResultDetailPopover takes (anchorEl, taskUuid, isError)');
if (toggleMatch) {
  check(
    /const showError = !!isError \|\| !!\(entry && entry\.error\);/.test(toggleMatch[0]),
    'toggle ORs the inject-time error flag with the live cache entry.error'
  );
  check(
    /!showError && entry && Array\.isArray\(entry\.detail\)/.test(toggleMatch[0]),
    'an error row never renders a numeric detail array (explanation text instead)'
  );
}

// Dismiss behaviour: outside click, Esc, scroll, and closing when the anchor is
// no longer in the document (checked from refreshQueueChips' own wipe cycle).
check(
  /document\.addEventListener\('click', onDocClickForResultPopover, true\)/.test(src),
  'popover dismisses on outside click'
);
check(/e\.key === 'Escape' \|\| e\.key === 'Esc'/.test(src), 'popover dismisses on Escape');
check(/window\.addEventListener\('scroll', closeResultDetailPopover, true\)/.test(src), 'popover dismisses on scroll');
check(
  /_resultDetailPopoverAnchor && !document\.contains\(_resultDetailPopoverAnchor\)/.test(src),
  'refreshQueueChips closes the popover if its anchor has been removed from the DOM'
);

// ============================================================
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
