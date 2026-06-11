// Medicus Suite — Triage Lens baseline-rule pattern guard
// Run with: node test-triage-rule-patterns.js
//
// The Triage Lens content script compiles rule patterns with
//   regex:true  → new RegExp('\b' + pattern + '\b', 'i')
//   regex:false → escape, then new RegExp('\b' + pattern, 'i')   (stem match)
// and SILENTLY SKIPS any pattern that fails to compile. A skipped pattern is
// a silent clinical miss (the chip just never fires), so this test fails the
// build if any shipped pattern is invalid, plus pins schema invariants and a
// set of positive/negative match examples for the high-risk rules.

'use strict';

const path = require('path');
const cfg = require(path.join(__dirname, 'defaults.json'));

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; }
  else { console.error(`  FAIL  ${msg}`); failed++; }
}

// ---- Mirror of the engine's compile step (content.js compileRule) ----
function compileRule(rule) {
  const compiled = [];
  for (const p of rule.patterns || []) {
    const s = String(p || '').trim();
    if (!s) continue;
    const src = rule.regex ? s : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wrapped = rule.regex ? ('\\b' + src + '\\b') : ('\\b' + src);
    compiled.push(new RegExp(wrapped, 'i')); // throws on invalid — intentional
  }
  return compiled;
}

// ---- 1. Every shipped pattern must compile ----
const VALID_KINDS = new Set(['red', 'amber', 'green', 'info']);
const seenIds = new Set();
const compiledById = new Map();

for (const rule of cfg.rules) {
  check(!seenIds.has(rule.id), `duplicate rule id: ${rule.id}`);
  seenIds.add(rule.id);
  check(VALID_KINDS.has(rule.kind), `${rule.id}: invalid kind "${rule.kind}"`);
  check(Array.isArray(rule.fields) && rule.fields.length > 0, `${rule.id}: empty fields`);
  check(Array.isArray(rule.pages) && rule.pages.length > 0, `${rule.id}: empty pages`);
  check(rule.builtin === true, `${rule.id}: shipped rule must be builtin:true`);
  check((rule.actions || []).length > 0, `${rule.id}: shipped rule has no actions`);
  try {
    const compiled = compileRule(rule);
    check(compiled.length > 0, `${rule.id}: no usable patterns`);
    compiledById.set(rule.id, compiled);
  } catch (e) {
    check(false, `${rule.id}: pattern failed to compile — ${e.message}`);
    compiledById.set(rule.id, []);
  }
}
console.log(`  OK  ${cfg.rules.length} rules, all patterns compile, schema invariants hold`);

check(cfg.version >= 2, `defaults version must be >= 2 for the stored-config merge to fire (got ${cfg.version})`);

// ---- 2. Cross-rule example matching ----
// matches(text) → array of rule ids whose patterns hit (request-field style).
const matches = (text) =>
  cfg.rules.filter(r => (compiledById.get(r.id) || []).some(re => re.test(text))).map(r => r.id);

// expect(text, mustInclude[], mustExclude[])
function expectMatch(text, mustInclude, mustExclude = []) {
  const hit = new Set(matches(text));
  for (const id of mustInclude) check(hit.has(id), `"${text}" should fire ${id} (fired: ${[...hit].join(', ') || 'none'})`);
  for (const id of mustExclude) check(!hit.has(id), `"${text}" must NOT fire ${id}`);
}

// Positive: each new red rule fires on realistic patient text
expectMatch("dads face is drooping on one side and his speech is slurred", ['stroke-tia']);
expectMatch("I think I'm having a mini stroke", ['stroke-tia']);
expectMatch("high fever and confusion, hes very drowsy and hard to wake", ['sepsis']);
expectMatch("my lips have swollen up and my throat is closing after eating peanuts", ['anaphylaxis']);
expectMatch("she has a rash that doesn't fade when I press it with a glass", ['meningitis']);
expectMatch("fever and a stiff neck and the light hurts my eyes", ['meningitis']);
expectMatch("sudden tearing pain in my back and I feel faint", ['aaa']);
expectMatch("woke up with sudden severe pain in my testicle and feel sick", ['testicular-torsion']);
expectMatch("one calf swollen and hot since my long haul flight", ['pe-dvt']);
expectMatch("sharp chest pain when I breathe in and I'm suddenly breathless", ['pe-dvt']);
expectMatch("my tummy is rigid and it's the worst ever stomach pain", ['acute-severe-abdomen']);
expectMatch("my 6 week old has a temperature and won't feed", ['fever-infant']);
expectMatch("his ribs are pulling in when he breathes and he's grunting", ['resp-distress-child']);
expectMatch("she had a fit with a fever, her first ever seizure", ['seizure']);
expectMatch("I'm pregnant and bleeding with cramps", ['ectopic-miscarriage']);
expectMatch("baby not moving as much today, hardly any kicks", ['reduced-fetal-movements']);
expectMatch("32 weeks pregnant with a terrible headache and blurred vision", ['pre-eclampsia']);
expectMatch("flashing lights and new floaters like a curtain over my eye", ['sudden-vision-loss']);
expectMatch("my knee is red hot and swollen and I have a fever", ['septic-arthritis']);
expectMatch("my son is hearing voices telling him people are after him", ['psychosis']);

// Positive: key ambers
expectMatch("there is blood in my wee", ['haematuria-2ww']);
expectMatch("I haven't had a period for years but now I'm bleeding", ['postmenopausal-bleeding']);
expectMatch("I found a hard lump in my breast", ['breast-changes-2ww']);
expectMatch("food keeps getting stuck in my throat and it's getting worse", ['dysphagia-2ww']);
expectMatch("I keep having hypos at night", ['diabetes']);
expectMatch("no wet nappy for 18 hours and she won't drink", ['dehydration-child']);
expectMatch("he's vomiting green and won't keep any feed down", ['vomiting-baby']);
expectMatch("I'm on warfarin and fell and banged my head", ['head-injury']);
expectMatch("my toddler is limping and won't put weight on his leg", ['acute-limp-child']);
expectMatch("my newborn looks yellow and is very sleepy", ['neonatal-jaundice']);
expectMatch("the whites of my eyes are yellow and my urine is dark", ['adult-jaundice']);
expectMatch("I found a lump on my testicle, it feels hard", ['testicular-lump']);
expectMatch("I'm pregnant and have been in contact with chickenpox", ['vzv-pregnancy']);
expectMatch("the condom split, I need the morning after pill", ['emergency-contraception']);
expectMatch("breastfeeding and my breast is red and hot with flu-like symptoms", ['mastitis']);
expectMatch("soaking through pads every hour with large clots", ['heavy-period']);
expectMatch("fever and foul smelling discharge since giving birth", ['postpartum-complications']);
expectMatch("painful red eye and the light hurts", ['acute-red-eye']);
expectMatch("woke up deaf in one ear", ['sudden-hearing-loss']);
expectMatch("nosebleed that won't stop and I'm on apixaban", ['epistaxis']);
expectMatch("my big toe is red hot and swollen, think it's gout", ['gout']);
expectMatch("the redness on my leg is spreading and feels hot", ['cellulitis']);
expectMatch("I've had a rash since starting my new tablets", ['medication-side-effect']);
expectMatch("mum has been suddenly confused since yesterday", ['delirium']);
expectMatch("I'm worried about my drinking and can't stop", ['alcohol-misuse']);
expectMatch("I keep making myself sick after meals", ['eating-disorder']);
expectMatch("struggling to cope since having the baby, not bonding with my baby", ['postnatal-mh']);

// Positive: infos + modified existing rules
expectMatch("I need an emergency dentist for a dental abscess", ['dental']);
expectMatch("any news on my blood results?", ['blood-test-result']);
expectMatch("chasing my referral, haven't heard from the hospital", ['referral-chase']);
expectMatch("I need a letter for my insurance", ['medical-report-letter']);
expectMatch("what travel jabs do I need for Kenya?", ['travel-vaccination']);
expectMatch("can I get Mounjaro for weight loss?", ['weight-loss-injection']);
expectMatch("I want to update my DNACPR form", ['end-of-life-admin']);
expectMatch("mums memory is getting worse, she keeps forgetting things", ['memory-loss']);
expectMatch("I'm using my blue inhaler more often than usual", ['cough-resp']);
expectMatch("having thoughts of harming my baby", ['mh-crisis']);

// Negative: pruned over-broad stems must not fire
expectMatch("I'm confused about my medication", [], ['delirium']);
expectMatch("I had a hangover yesterday", [], ['alcohol-misuse']);
expectMatch("I've hit a wall with my diet and want to lose weight", [], ['head-injury']);
expectMatch("my eye is red", [], ['acute-red-eye', 'sudden-vision-loss']);
expectMatch("both my ankles are a bit swollen by the evening", [], ['pe-dvt', 'cellulitis']);
expectMatch("my hay fever allergies are bad", [], ['anaphylaxis']);
expectMatch("the kitchen flooding ruined my carpet", [], ['heavy-period']);
expectMatch("I'm dying to know my results", [], ['end-of-life-admin']);
expectMatch("trip to the shops left me tired", [], ['travel-vaccination']);
expectMatch("I fell out with my sister", [], ['head-injury']);
expectMatch("toddler not eating his vegetables", [], ['eating-disorder']);
expectMatch("osteoarthritis in both knees for years", [], ['septic-arthritis', 'gout']);

// Severity sanity for the new reds: every red rule needs at least one action
for (const r of cfg.rules.filter(r => r.kind === 'red')) {
  check((r.actions || []).some(a => a.type === 'note'), `${r.id}: red rule should carry a clinical note action`);
}

// Modified existing rules: pinned expectations
const soreThroat = cfg.rules.find(r => r.id === 'sore-throat');
check(!soreThroat.patterns.includes('dysphagia\\w*'),
  'sore-throat no longer owns persistent dysphagia (moved to dysphagia-2ww)');
const coughResp = cfg.rules.find(r => r.id === 'cough-resp');
check(coughResp.patterns.some(p => p.includes('blue inhaler')),
  'cough-resp gained reliever-overuse patterns');
const mhCrisis = cfg.rules.find(r => r.id === 'mh-crisis');
check(mhCrisis.patterns.some(p => p.includes('puerperal')),
  'mh-crisis covers postpartum/puerperal psychosis');

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
