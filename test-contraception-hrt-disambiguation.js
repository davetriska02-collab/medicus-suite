// Medicus Suite — contraception ↔ HRT disambiguation tests
// Run with: node test-contraception-hrt-disambiguation.js
//
// Regression guard for the CHC-vs-HRT no-double-fire invariant.
//
// The hrt-systemic rule matches the bare oestrogen terms "estradiol" /
// "oestradiol", which are SUBSTRINGS of the contraceptive oestrogen
// "ethinylestradiol" and of the natural-oestrogen combined pills' actual
// ingredients ("estradiol valerate" in Qlaira, "estradiol hemihydrate" in
// Zoely). Without disambiguation, enabling the chc-combined-hormonal rule
// would make a CHC patient ALSO fire the HRT monitoring rule (a wrong,
// confusing duplicate alert). The fix is data-level: hrt-systemic excludes
// "ethinylestradiol" / "ethinyloestradiol" / "qlaira" / "zoely".
//
// This test asserts, via the real drugMatchesRule(), that:
//  - contraceptive products fire chc-combined-hormonal and NOT hrt-systemic
//  - genuine HRT products fire hrt-systemic and NOT chc-combined-hormonal

'use strict';

const path = require('path');
const engine = require(path.join(__dirname, 'engine', 'rules-engine.js'));
const ruleset = require(path.join(__dirname, 'rules', 'drug-rules.json'));

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

const ruleById = (id) => ruleset.rules.find((r) => r.id === id);

const chc = ruleById('chc-combined-hormonal');
const hrt = ruleById('hrt-systemic');

check(!!chc, 'rule "chc-combined-hormonal" exists in drug-rules.json');
check(!!hrt, 'rule "hrt-systemic" exists in drug-rules.json');
check(!!chc && chc.enabled === true, 'chc-combined-hormonal is enabled');

// --- CHC products: fire CHC, NOT HRT ---
console.log('\n--- combined hormonal contraception: fires CHC, not HRT ---');
const chcMeds = [
  'Microgynon 30 tablets',
  'Qlaira tablets',
  'Zoely tablets',
  'Ethinylestradiol 30mcg / levonorgestrel 150mcg tablets',
];
for (const med of chcMeds) {
  check(engine.drugMatchesRule(med, chc), `"${med}" matches chc-combined-hormonal`);
  check(!engine.drugMatchesRule(med, hrt), `"${med}" does NOT match hrt-systemic (no double-fire)`);
}

// --- HRT products: fire HRT, NOT CHC ---
console.log('\n--- systemic HRT: fires HRT, not CHC ---');
const hrtMeds = ['Estradiol 1mg tablets', 'Evorel 50 patch'];
for (const med of hrtMeds) {
  check(engine.drugMatchesRule(med, hrt), `"${med}" matches hrt-systemic`);
  check(!engine.drugMatchesRule(med, chc), `"${med}" does NOT match chc-combined-hormonal (no cross-fire)`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
