// Medicus Suite — drug-monitoring brand-coverage tests
// Run with: node test-drug-brand-coverage.js
//
// Guards against the SILENT under-matching failure mode in built-in
// drug-monitoring rules: a med prescribed by a brand name the rule doesn't
// list simply never fires — no error, just a missing alert. This test loads
// rules/drug-rules.json and asserts, via the real drugMatchesRule(), that
// every brand/generic we intend to monitor actually matches its rule, and
// that drugs which must NOT fire (excluded forms, unrelated drugs) don't.
//
// When you add or edit a rule's drug.match / drug.exclude, extend the maps
// below. UK brand names are sourced from the BNF / dm+d / emc; only
// UK-marketed brands are listed (including discontinued ones, since repeat
// prescriptions persist).

'use strict';

const path = require('path');
const engine = require(path.join(__dirname, 'engine', 'rules-engine.js'));
const ruleset = require(path.join(__dirname, 'rules', 'drug-rules.json'));

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  OK  ${msg}`); passed++; }
  else { console.error(`  FAIL  ${msg}`); failed++; }
}

const ruleById = (id) => ruleset.rules.find(r => r.id === id);

// For each rule, representative prescription strings that MUST fire it.
// Mix bare generics with realistic brand+dose/form suffixes to exercise the
// case-insensitive substring matching in engine/rules-engine.js.
const EXPECTED = {
  'methotrexate-maintenance': [
    'Methotrexate 2.5mg tablets', 'Maxtrex 2.5mg tablets', 'Metoject 15mg/0.3ml injection',
    'Jylamvo 2mg/ml oral solution', 'Nordimet 12.5mg injection',
    'Zlatal 2.5mg tablets', 'Methofill 17.5mg injection',
    // exclusions were removed — injectable/parenteral forms must fire too
    'Methotrexate 50mg/2ml injection', 'Methotrexate injection'
  ],
  'leflunomide-maintenance': ['Leflunomide 20mg tablets', 'Arava 20mg tablets', 'Leflunomide Medac 10mg tablets'],
  'hydroxychloroquine-maintenance': [
    'Hydroxychloroquine 200mg tablets', 'Quinoric 200mg tablets',
    'Plaquenil 200mg tablets', 'Chloroquine 250mg tablets', 'Avloclor 250mg tablets',
    'Zentiva hydroxychloroquine 200mg', 'Blackrock hydroxychloroquine 200mg',
    'Accord hydroxychloroquine 200mg', 'Ipca hydroxychloroquine 200mg'
  ],
  'azathioprine-maintenance': ['Azathioprine 50mg tablets', 'Imuran 50mg tablets', 'Azapress 50mg tablets', 'Jayempi 10mg/ml oral suspension'],
  'sulfasalazine-maintenance': [
    'Sulfasalazine 500mg tablets', 'Sulphasalazine 500mg', 'Salazopyrin EN-Tabs 500mg',
    'Sulazine EC 500mg tablets'
  ],
  'carbamazepine-maintenance': [
    'Carbamazepine 200mg tablets', 'Tegretol Prolonged Release 200mg', 'Carbagen SR 200mg'
  ],
  'lithium-maintenance': [
    'lithium', 'Lithium carbonate 250mg tablets', 'Lithium citrate liquid',
    'Priadel 400mg modified-release tablets', 'Camcolit 250mg tablets',
    'Liskonum 450mg MR tablets', 'Li-Liquid 509mg/5ml'
  ],
  'amiodarone-maintenance': ['Amiodarone 200mg tablets', 'Cordarone X 200mg tablets'],
  'carbimazole-propylthiouracil': [
    'Carbimazole 5mg tablets', 'Neo-Mercazole 5mg tablets',
    'Neomercazole 20mg', 'Propylthiouracil 50mg tablets'
  ],
  'ace-arb': [
    'Ramipril 5mg capsules', 'Tritace 5mg', 'Triapin 5mg/5mg',
    'Lisinopril 10mg', 'Zestril 10mg', 'Carace 10mg', 'Zestoretic 20/12.5',
    'Perindopril arginine 5mg', 'Coversyl Arginine Plus 5mg/1.25mg',
    'Enalapril 10mg', 'Innovace 10mg', 'Innozide 20mg/12.5mg',
    'Captopril 25mg', 'Capoten 25mg', 'Noyada 5mg/5ml oral solution',
    'Trandolapril 2mg', 'Gopten 2mg', 'Fosinopril 10mg', 'Staril 10mg',
    'Losartan 50mg', 'Cozaar 50mg', 'Hyzaar 50/12.5', 'Arbli 12.5mg/2.5ml',
    'Candesartan 8mg', 'Amias 8mg', 'Valsartan 80mg', 'Diovan 80mg',
    'Co-Diovan 160/25', 'Exforge 5mg/160mg', 'Irbesartan 150mg', 'Aprovel 150mg',
    'Co-Aprovel 150/12.5', 'Karvea 150mg', 'Telmisartan 40mg', 'Micardis 40mg',
    'Micardis Plus 40/12.5', 'Pritor 40mg', 'Tolura 40mg', 'Olmesartan 20mg',
    'Olmetec 20mg', 'Sevikar 20mg/5mg', 'Azilsartan 40mg', 'Edarbi 40mg',
    'Sacubitril/valsartan 49mg/51mg', 'Entresto 49mg/51mg'
  ],
  'spironolactone': [
    'Spironolactone 25mg tablets', 'Aldactone 25mg', 'Eplerenone 25mg', 'Inspra 25mg'
  ],
  'sglt2-inhibitor': [
    'Dapagliflozin 10mg', 'Forxiga 10mg', 'Xigduo 5mg/1000mg', 'Qtern 5mg/10mg',
    'Empagliflozin 10mg', 'Jardiance 10mg', 'Synjardy 5mg/850mg', 'Glyxambi 10mg/5mg',
    'Canagliflozin 100mg', 'Invokana 100mg', 'Vokanamet 50mg/850mg',
    'Ertugliflozin 5mg', 'Steglatro 5mg', 'Segluromet 2.5mg/850mg', 'Steglujan 5mg/100mg'
  ],
  'glp1-receptor-agonist': [
    'Ozempic 1mg', 'Wegovy 2.4mg', 'Rybelsus 7mg', 'Semaglutide injection',
    'Mounjaro 5mg', 'Tirzepatide injection', 'Trulicity 1.5mg', 'Victoza 1.2mg',
    'Saxenda 3mg', 'Xultophy 100/3.6', 'Lyxumia 20mcg', 'Byetta 10mcg',
    'Bydureon BCise 2mg'
  ],
  'doac': [
    'Apixaban 5mg', 'Eliquis 5mg', 'Rivaroxaban 20mg', 'Xarelto 20mg',
    'Edoxaban 60mg', 'Lixiana 60mg', 'Dabigatran 150mg', 'Pradaxa 150mg'
  ],
  'statin': [
    'Atorvastatin 40mg', 'Lipitor 40mg', 'Atozet 10mg/40mg', 'Simvastatin 40mg',
    'Inegy 10mg/40mg', 'Rosuvastatin 10mg', 'Crestor 10mg', 'Enebium 20mg',
    'Pravastatin 40mg', 'Lipostat 40mg', 'Fluvastatin 80mg', 'Lescol XL 80mg',
    'Pitavastatin 2mg', 'Livazo 2mg'
  ],
  'allopurinol': [
    'Allopurinol 100mg', 'Zyloric 100mg', 'Caplenal 100mg tablets', 'Uricto 100mg tablets',
    'Febuxostat 80mg', 'Adenuric 80mg'
  ],
  'antipsychotic': [
    'Olanzapine 10mg', 'Zyprexa 10mg', 'Zalasta 10mg', 'ZypAdhera 300mg depot',
    'Risperidone 2mg', 'Risperdal Consta 25mg', 'Okedi 75mg',
    'Quetiapine 200mg', 'Seroquel XL 200mg', 'Atrolak XL 200mg', 'Biquelle XL 200mg',
    'Zaluron XL 200mg', 'Aripiprazole 10mg', 'Abilify Maintena 400mg',
    'Haloperidol 1.5mg', 'Serenace 1.5mg', 'Dozic 5mg/5ml', 'Haldol decanoate 50mg',
    'Chlorpromazine 25mg', 'Largactil 25mg', 'Amisulpride 200mg', 'Solian 200mg',
    'Paliperidone 6mg', 'Invega 6mg', 'Xeplion 75mg', 'Trevicta 175mg', 'Byannli 700mg',
    'Lurasidone 37mg', 'Latuda 37mg', 'Asenapine 10mg', 'Sycrest 10mg',
    'Cariprazine 3mg', 'Reagila 3mg'
  ],
  'mirabegron': ['Mirabegron 50mg', 'Betmiga 50mg'],
  'levothyroxine': [
    'Levothyroxine 100mcg', 'Eltroxin 100mcg', 'Euthyrox 50mcg',
    'Liothyronine 20mcg', 'Tertroxin 20mcg'
  ],
  'hrt-systemic': [
    'Estradiol 1mg tablets', 'Progynova 1mg', 'Zumenon 2mg', 'Climaval 1mg',
    'Estraderm MX 50 patches', 'Nuvelle Continuous', 'Evorel 50 patches',
    'Femoston-conti 1mg/5mg', 'Estradot 50 patches', 'Oestrogel pump', 'Premarin 0.625mg'
  ],
  'adhd-stimulant-paediatric': [
    'Medikinet XL 20mg', 'methylphenidate', 'Tranquilyn 10mg', 'Ritalin 10mg',
    'Affenid 18mg', 'Atenza 27mg', 'Concerta XL 36mg', 'Delmosart 18mg',
    'Kixel 30mg', 'Matoride XL 18mg', 'Xaggitin XL 18mg', 'Xenidate XL 18mg',
    'Equasym XL 20mg', 'Focusim 5mg', 'Meflynate XL 10mg', 'Metyrol 10mg'
  ],
  'adhd-stimulant-adult': [
    'Medikinet XL 20mg', 'methylphenidate', 'Tranquilyn 10mg', 'Ritalin 10mg',
    'Affenid 18mg', 'Atenza 27mg', 'Concerta XL 36mg', 'Delmosart 18mg',
    'Kixel 30mg', 'Matoride XL 18mg', 'Xaggitin XL 18mg', 'Xenidate XL 18mg',
    'Equasym XL 20mg', 'Focusim 5mg', 'Meflynate XL 10mg', 'Metyrol 10mg'
  ],
  'atomoxetine-maintenance': ['Atomoxetine 40mg', 'Strattera 40mg'],
  'guanfacine-maintenance': ['Guanfacine 2mg', 'Intuniv 2mg']
};

for (const [id, meds] of Object.entries(EXPECTED)) {
  console.log(`\n--- ${id} ---`);
  const rule = ruleById(id);
  check(!!rule, `rule "${id}" exists in drug-rules.json`);
  if (!rule) continue;
  for (const med of meds) {
    check(engine.drugMatchesRule(med, rule), `fires for "${med}"`);
  }
}

// Drugs / forms that must NOT fire a given rule.
const MUST_NOT = [
  ['lithium-maintenance', 'Amlodipine 5mg tablets'],
  ['methotrexate-maintenance', 'Amoxicillin 500mg capsules'],
  ['adhd-stimulant-adult', 'Sertraline 50mg tablets'],
  ['statin', 'Paracetamol 500mg tablets'],
  // clozapine is deliberately excluded — monitored under the national CPMS protocol
  ['antipsychotic', 'Clozapine 100mg tablets'],
  ['antipsychotic', 'Clozaril 100mg tablets'],
  // local vaginal oestrogens are excluded (no systemic effect)
  ['hrt-systemic', 'Vagifem 10mcg vaginal tablets'],
  ['hrt-systemic', 'Ovestin 0.1% vaginal cream'],
  ['hrt-systemic', 'Estring 7.5mcg vaginal ring']
];

console.log('\n--- negative controls (must NOT fire) ---');
for (const [id, med] of MUST_NOT) {
  check(!engine.drugMatchesRule(med, ruleById(id)), `"${med}" does NOT match ${id}`);
}

// === DASH FOLDING ===
// normaliseDrugString() folds dashes and underscores to spaces before the
// whitespace collapse, so dashed brand forms match spaced rule terms and vice versa.
console.log('\n--- dash folding (dashes ↔ spaces) ---');
{
  const carbRule = ruleById('carbimazole-propylthiouracil');
  // Dashed brand form matches spaced rule term: "Neo-Mercazole" → "neo mercazole"
  // rule match "neo-mercazole" → also "neo mercazole" after normalisation
  check(engine.drugMatchesRule('Neo-Mercazole 5mg tablets', carbRule),
    'dashed brand "Neo-Mercazole" matches rule term "neo-mercazole" after dash fold');
  // Reverse: a hypothetically spaced prescription "neo mercazole" also matches
  check(engine.drugMatchesRule('neo mercazole 20mg', carbRule),
    'spaced prescription "neo mercazole" matches dashed rule term "neo-mercazole" after dash fold');
}

// === INVERSE COVERAGE CHECK ===
// Every enabled drug-monitoring rule must have at least one EXPECTED entry.
// A new rule with no entry would pass the forward loop silently — this catches it.
console.log('\n--- inverse coverage: every enabled drug-monitoring rule has an EXPECTED entry ---');
const drugMonitoringRules = (ruleset.rules || []).filter(r => r.type === 'drug-monitoring' && r.enabled !== false);
for (const rule of drugMonitoringRules) {
  check(Object.prototype.hasOwnProperty.call(EXPECTED, rule.id) && EXPECTED[rule.id].length > 0,
    `rule "${rule.id}" has at least one EXPECTED entry`);
}
console.log(`(${drugMonitoringRules.length} enabled drug-monitoring rules audited)`);

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
