// Medicus Suite — Triage Lens match-evidence guard (item 2.1,
// docs/plans/TRIAGE-LENS-2026-07-02.md)
// Run with: node test-rule-match-evidence.js
//
// rule-match.js's new ruleMatchEvidence(compiledRule, text) is built ON TOP
// of the SAME compiled pattern array ruleMatchesText tests against (same
// patterns, same order, same "first pattern that matches wins" via .some()/
// .exec() short-circuit) — so it can never disagree with the boolean API:
// evidence !== null exactly when ruleMatchesText is true. This file pins:
//   1. term/start/end/context shape for plain-stem rules,
//   2. term/start/end/context shape for word-boundary regex rules,
//   3. no-match -> null,
//   4. sentence-boundary context vs the +/-80 char ellipsised fallback,
//   5. a parity sweep across the shipped 78-rule corpus (defaults.json)
//      crossed with the REAL text corpus already exercised by
//      test-triage-rule-patterns.js (reused via source extraction, not
//      duplicated, so the two files cannot silently diverge).
//
// compileRule/ruleMatchesText themselves are untouched — pinned unchanged by
// test-triage-preview-parity.js — this file only exercises the new export.

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error('  ✗ ' + msg);
  }
}

const M = require('./content-scripts/triage-lens/rule-match.js');

function rule(over) {
  return { id: 'r1', label: 'R1', enabled: true, regex: false, patterns: ['cough'], ...over };
}

// ── 1. Plain-stem rule: term/start/end/context ────────────────────────────
console.log('--- plain-stem rule evidence ---');
{
  const c = M.compileRule(rule({ patterns: ['cough'] }));
  const text = 'Patient reports coughing for 3 days. No fever noted.';
  const ev = M.ruleMatchEvidence(c, text);
  check(ev !== null, 'evidence returned for a matching stem');
  check(ev.term === 'cough', `term is the matched substring only, "cough" (got "${ev && ev.term}")`);
  check(ev.start === text.indexOf('cough'), 'start offset matches the true index of the match');
  check(ev.end === ev.start + 'cough'.length, 'end offset = start + matched length');
  check(text.slice(ev.start, ev.end) === ev.term, 'text.slice(start,end) reproduces term exactly');
  check(
    ev.context === 'Patient reports coughing for 3 days.',
    `context is the containing sentence, trimmed (got "${ev.context}")`
  );
}

// ── 2. Case preserved in term (regexes are case-insensitive) ──────────────
console.log('--- case is preserved in the returned term ---');
{
  const c = M.compileRule(rule({ patterns: ['cough'] }));
  const ev = M.ruleMatchEvidence(c, 'COUGHING all night.');
  check(ev !== null, 'matches case-insensitively');
  check(ev.term === 'COUGH', `term preserves the text's own casing, "COUGH" (got "${ev && ev.term}")`);
}

// ── 3. Word-boundary regex rule: term/start/end/context ───────────────────
console.log('--- regex (word-boundary) rule evidence ---');
{
  const c = M.compileRule(rule({ regex: true, patterns: ['chest pain'] }));
  const text = 'Called about indigestion yesterday. Now severe chest pain radiating to the jaw.';
  const ev = M.ruleMatchEvidence(c, text);
  check(ev !== null, 'regex rule evidence found');
  check(ev.term === 'chest pain', `term is exactly the matched phrase (got "${ev && ev.term}")`);
  check(
    ev.context === 'Now severe chest pain radiating to the jaw.',
    `context is the SECOND sentence only, not the whole text (got "${ev.context}")`
  );

  // Both \b: "chest pains" must not match (mirrors ruleMatchesText's own
  // pinned behaviour in test-triage-preview-parity.js) -> evidence null too.
  const c2 = M.compileRule(rule({ regex: true, patterns: ['chest pain'] }));
  const noMatch = M.ruleMatchEvidence(c2, 'a history of chest pains for years');
  check(noMatch === null, 'word-boundary regex: "chest pains" does not match "chest pain\\b" -> null evidence');
}

// ── 4. No match -> null ────────────────────────────────────────────────────
console.log('--- no match -> null ---');
{
  const c = M.compileRule(rule({ patterns: ['cough'] }));
  check(M.ruleMatchEvidence(c, 'no respiratory symptoms at all') === null, 'unrelated text -> null');
  check(M.ruleMatchEvidence(c, '') === null, 'empty text -> null');
  check(M.ruleMatchEvidence(null, 'cough') === null, 'null compiledRule -> null, does not throw');
  check(M.ruleMatchEvidence({ id: 'x' }, 'cough') === null, 'compiledRule with no _compiled -> null');
  check(M.ruleMatchEvidence(c, null) === null, 'null text -> null, does not throw');
  check(M.ruleMatchEvidence(c, undefined) === null, 'undefined text -> null, does not throw');
}

// ── 5. Sentence-boundary context vs +/-80 char ellipsised fallback ────────
console.log('--- context: sentence boundary vs ellipsised window fallback ---');
{
  const c = M.compileRule(rule({ patterns: ['cough'] }));

  // Multiple sentences: only the containing one is returned.
  const multi = 'Patient called yesterday about a sore throat. Today reports a bad cough and fever. Wants a callback.';
  const evMulti = M.ruleMatchEvidence(c, multi);
  check(
    evMulti.context === 'Today reports a bad cough and fever.',
    `multi-sentence text: context is only the containing sentence (got "${evMulti.context}")`
  );
  check(!evMulti.context.includes('sore throat'), 'context excludes the PRECEDING sentence');
  check(!evMulti.context.includes('callback'), 'context excludes the FOLLOWING sentence');

  // No sentence-ending punctuation anywhere -> +/-80 char window, ellipsised
  // on whichever side(s) were actually cut short of the text's own edges.
  // Pad both sides past the 80-char window so BOTH ellipses are exercised.
  const pad = 'word '.repeat(20); // 100 chars, well past the 80-char window
  const noPunct = pad + 'cough' + ' ' + pad;
  const evNoPunct = M.ruleMatchEvidence(c, noPunct);
  check(evNoPunct !== null, 'run-on (no punctuation) text still matches');
  const matchIdx = noPunct.indexOf('cough');
  check(
    matchIdx > 80 && noPunct.length - (matchIdx + 5) > 80,
    'test text padding is actually long enough on both sides to force truncation'
  );
  check(
    evNoPunct.context.startsWith('…'),
    `window fallback: left side was cut (match not near text start) -> leading ellipsis (got "${evNoPunct.context.slice(0, 20)}…")`
  );
  check(
    evNoPunct.context.endsWith('…'),
    `window fallback: right side was cut (match not near text end) -> trailing ellipsis (got "…${evNoPunct.context.slice(-20)}")`
  );
  check(evNoPunct.context.includes('cough'), 'window fallback context still contains the matched term');
  // Window is centred on the match: roughly 80 chars either side (plus the
  // leading/trailing ellipsis marker).
  const rawWindowLeft = noPunct.slice(Math.max(0, matchIdx - 80), matchIdx);
  check(evNoPunct.context.includes(rawWindowLeft.trim().slice(-15)), 'left window roughly matches the +/-80 char spec');

  // Short run-on text with no punctuation, match near the very start/end ->
  // no ellipsis needed on the side that reaches the text's own edge.
  const shortNoPunct = 'cough for days';
  const evShort = M.ruleMatchEvidence(c, shortNoPunct);
  check(
    evShort.context === 'cough for days',
    `short run-on text: whole text returned verbatim, no ellipsis needed (got "${evShort.context}")`
  );
  check(
    !evShort.context.startsWith('…') && !evShort.context.endsWith('…'),
    'no ellipsis when the window already reaches both text edges'
  );

  // A text WITH punctuation elsewhere, but none near this particular match,
  // still uses the sentence path (possibly a long "sentence") — not the
  // window fallback — since SENTENCE_BOUNDARY.test(text) is true globally.
  const punctFarAway = 'Reason for contact: ' + 'x'.repeat(40) + ' persistent cough ' + 'y'.repeat(40) + '. Thanks.';
  const evFar = M.ruleMatchEvidence(c, punctFarAway);
  check(
    evFar.context.endsWith('.') && evFar.context.startsWith('Reason for contact'),
    'text with punctuation ONLY far from the match still takes the sentence path (bounded by nearest boundary/text edge), not the window fallback'
  );
}

// ── 6. Parity: evidence !== null exactly when ruleMatchesText is true,
//     across the shipped 78-rule corpus x the REAL corpus of texts already
//     exercised by test-triage-rule-patterns.js (reused, not duplicated) ──
console.log('--- parity sweep: 78-rule corpus x test-triage-rule-patterns.js texts ---');
{
  const cfg = require('./defaults.json');
  check(cfg.rules.length === 78, `defaults.json ships 78 rules (got ${cfg.rules.length})`);

  const patternsTestSrc = fs.readFileSync(path.join(__dirname, 'test-triage-rule-patterns.js'), 'utf8');
  // Reuse the corpus of realistic request texts already hand-written in
  // test-triage-rule-patterns.js's expectMatch(...) calls, by extracting
  // their first (string-literal) argument — rather than re-typing a second
  // copy here that could silently drift from the real one.
  const literalRe = /expectMatch\(\s*((?:"(?:[^"\\]|\\.)*")|(?:'(?:[^'\\]|\\.)*'))/g;
  const corpusTexts = [];
  let lm;
  while ((lm = literalRe.exec(patternsTestSrc))) {
    try {
      // eslint-disable-next-line no-new-func
      const val = new Function('return ' + lm[1])();
      if (typeof val === 'string') corpusTexts.push(val);
    } catch (e) {
      /* skip anything that doesn't evaluate cleanly */
    }
  }
  check(
    corpusTexts.length >= 90,
    `extracted a sizeable text corpus from test-triage-rule-patterns.js (got ${corpusTexts.length})`
  );

  const compiled = cfg.rules.map((r) => M.compileRule(r)).filter(Boolean);
  check(compiled.length === cfg.rules.length, 'every shipped rule compiles (parity precondition)');

  let combos = 0;
  let mismatches = 0;
  for (const c of compiled) {
    for (const text of corpusTexts) {
      combos++;
      const matched = M.ruleMatchesText(c, text);
      const ev = M.ruleMatchEvidence(c, text);
      if (matched !== (ev !== null)) {
        mismatches++;
        console.error(
          `  ✗ parity break: rule "${c.id}" matched=${matched} but evidence!==null is ${ev !== null} for text "${text}"`
        );
      }
    }
  }
  check(combos === compiled.length * corpusTexts.length, `swept every rule x text combination (${combos})`);
  check(mismatches === 0, `no parity mismatches across ${combos} rule x text combinations (found ${mismatches})`);

  // Positive sanity: at least some of these actually match (otherwise the
  // parity sweep above would be vacuously true).
  let positiveMatches = 0;
  for (const c of compiled) {
    for (const text of corpusTexts) {
      if (M.ruleMatchesText(c, text)) positiveMatches++;
    }
  }
  check(
    positiveMatches > 50,
    `the corpus actually produces plenty of positive matches to exercise (got ${positiveMatches})`
  );
}

// ── 7. compileRule/ruleMatchesText remain byte-for-byte unchanged ─────────
// (Full behavioural pin already lives in test-triage-preview-parity.js; this
// is a light source-level guard that the new export was ADDED, not spliced
// into the middle of the existing functions.)
console.log('--- existing exports untouched ---');
{
  const src = fs.readFileSync(path.join(__dirname, 'content-scripts/triage-lens/rule-match.js'), 'utf8');
  check(/function compileRule\(rule\)/.test(src), 'compileRule still present, unchanged signature');
  check(
    /function ruleMatchesText\(compiledRule, text\)/.test(src),
    'ruleMatchesText still present, unchanged signature'
  );
  check(
    /function ruleMatchEvidence\(compiledRule, text\)/.test(src),
    'ruleMatchEvidence exported with the documented signature'
  );
  check(
    /const api = \{\s*compileRule,\s*ruleMatchesText,\s*ruleMatchEvidence,\s*NEGATORS,\s*PAST_MARKERS,\s*ruleRequireMet,\s*validateRuleRequire,\s*\};/.test(
      src
    ),
    'all seven are exported off the same api object (item 3.5 adds ruleRequireMet/validateRuleRequire)'
  );
}

// ── 8. Negation/past-tense demotion (item 3.4, TRIAGE-LENS-2026-07-02.md) ──
// DISPLAY-ONLY: qualifier is additive metadata on ruleMatchEvidence's return.
// Never changes whether a rule matches (ruleMatchesText/section 6's parity
// sweep is untouched by this).
console.log('--- qualifier: negation before vs after the term ---');
{
  const c = M.compileRule(rule({ regex: true, patterns: ['chest pain'] }));

  const ev1 = M.ruleMatchEvidence(c, 'Patient reports no chest pain today.');
  check(ev1 !== null, '"no chest pain" still matches (display-only demotion, never suppressed)');
  check(ev1.qualifier === 'negated', `negator BEFORE the term demotes it (got qualifier=${ev1 && ev1.qualifier})`);
  check(ev1.qualifierTerm === 'no', `qualifierTerm is the triggering word, "no" (got "${ev1 && ev1.qualifierTerm}")`);

  const ev2 = M.ruleMatchEvidence(c, 'Denies any chest pain on questioning.');
  check(ev2.qualifier === 'negated', '"denies any chest pain" -> negated');
  check(ev2.qualifierTerm === 'denies', `qualifierTerm "denies" (got "${ev2 && ev2.qualifierTerm}")`);

  // Negator AFTER the term must NOT demote — order matters.
  const ev3 = M.ruleMatchEvidence(c, 'Called about chest pain, no relief from GTN.');
  check(ev3 !== null, '"chest pain, no relief" still matches');
  check(ev3.qualifier === null, `negator AFTER the term does not demote (got qualifier=${ev3 && ev3.qualifier})`);
  check(ev3.qualifierTerm === null, 'qualifierTerm is null when unqualified');
}

console.log('--- qualifier: 6-word window boundary ---');
{
  const c = M.compileRule(rule({ patterns: ['cough'] }));
  // Exactly 6 words between "no" and the match ("no" itself counts as the
  // 6th word back) -> still within window -> negated.
  const within = M.ruleMatchEvidence(c, 'no one two three four five cough for days.');
  check(
    within.qualifier === 'negated',
    `negator exactly 6 words before the match is within the window (got qualifier=${within && within.qualifier})`
  );
  // One word further back (7 words) -> outside the window -> not demoted.
  const outside = M.ruleMatchEvidence(c, 'no one two three four five six cough for days.');
  check(
    outside.qualifier === null,
    `negator 7 words before the match is OUTSIDE the 6-word window (got qualifier=${outside && outside.qualifier})`
  );
}

console.log('--- qualifier: every listed negator triggers ---');
{
  const c = M.compileRule(rule({ patterns: ['fever'] }));
  const cases = {
    no: 'no fever reported',
    not: 'patient is not fever today',
    denies: 'denies fever this week',
    denied: 'denied fever on review',
    denying: 'denying any fever now',
    without: 'without fever since Monday',
    never: 'never had a fever',
    nil: 'nil fever on examination',
  };
  for (const [term, text] of Object.entries(cases)) {
    const ev = M.ruleMatchEvidence(c, text);
    check(ev !== null, `"${text}" still matches (never suppressed)`);
    check(
      ev.qualifier === 'negated' && ev.qualifierTerm === term,
      `negator "${term}" triggers negated demotion (got qualifier=${ev && ev.qualifier}, term=${ev && ev.qualifierTerm})`
    );
  }
}

console.log('--- qualifier: past-tense phrases anywhere in the sentence ---');
{
  const c = M.compileRule(rule({ patterns: ['UTI'] }));
  const cases = {
    'last year': 'Patient had a UTI last year.',
    'last month': 'UTI treated last month with antibiotics.',
    'years ago': 'UTI diagnosed years ago, none since.',
    'months ago': 'Had a UTI months ago.',
    'weeks ago': 'UTI resolved weeks ago.',
    previously: 'Previously had a UTI, now asymptomatic.',
    'in the past': 'UTI in the past, not currently.',
    'history of': 'History of UTI noted.',
    previous: 'Previous UTI, fully treated.',
  };
  for (const [phrase, text] of Object.entries(cases)) {
    const ev = M.ruleMatchEvidence(c, text);
    check(ev !== null, `"${text}" still matches (never suppressed)`);
    check(
      ev.qualifier === 'past' && ev.qualifierTerm === phrase,
      `past marker "${phrase}" triggers past demotion (got qualifier=${ev && ev.qualifier}, term=${ev && ev.qualifierTerm})`
    );
  }
}

console.log('--- qualifier: negated wins when both negation and a past marker are present ---');
{
  const c = M.compileRule(rule({ regex: true, patterns: ['chest pain'] }));
  const ev = M.ruleMatchEvidence(c, 'Patient had no chest pain last year.');
  check(ev !== null, 'still matches');
  check(
    ev.qualifier === 'negated',
    `negation wins over a co-present past marker (got qualifier=${ev && ev.qualifier})`
  );
  check(ev.qualifierTerm === 'no', `qualifierTerm is the negator, "no" (got "${ev && ev.qualifierTerm}")`);
}

console.log('--- qualifier: a later, un-negated mention of the same rule is preferred ---');
{
  // The FIRST match ("chest pain" inside "no chest pain") is negated. A much
  // later, un-negated restatement of the same pattern exists in the same
  // request (the negator is well outside the later mention's 6-word window).
  // ruleMatchEvidence must prefer the stronger (unqualified) evidence.
  const c = M.compileRule(rule({ regex: true, patterns: ['chest pain'] }));
  const text =
    'no chest pain reported at initial triage assessment earlier this morning ' +
    'but patient now describes chest pain radiating to the left arm.';
  const firstIdx = text.indexOf('chest pain');
  const secondIdx = text.indexOf('chest pain', firstIdx + 1);
  check(secondIdx > firstIdx, 'test text actually contains two distinct mentions of the pattern');

  const ev = M.ruleMatchEvidence(c, text);
  check(ev !== null, 'evidence found');
  check(
    ev.start === secondIdx,
    `evidence points at the SECOND (later, unqualified) mention, not the first negated one (expected start ${secondIdx}, got ${ev && ev.start})`
  );
  check(
    ev.qualifier === null,
    `the returned evidence is unqualified — the stronger (live) mention wins (got qualifier=${ev && ev.qualifier})`
  );

  // Sanity check: if we instead pin the FIRST occurrence directly, it IS
  // negated — proving the override actually did something (not a vacuous
  // pass because the first mention was never negated to begin with).
  const evFirstOnly = M.ruleMatchEvidence(c, text.slice(0, firstIdx + 'chest pain'.length) + '.');
  check(
    evFirstOnly.qualifier === 'negated',
    `sanity: text truncated to only the first mention IS negated (got qualifier=${evFirstOnly && evFirstOnly.qualifier})`
  );
}

console.log('--- qualifier: whole-word discipline ("notable"/"nothing" must not trigger) ---');
{
  const c = M.compileRule(rule({ patterns: ['cough'] }));

  const ev1 = M.ruleMatchEvidence(c, 'Patient has notable swelling and cough for days.');
  check(ev1 !== null, 'matches');
  check(
    ev1.qualifier === null,
    `"notable" (contains "not" as a substring, not a whole word) must not trigger negation (got qualifier=${ev1 && ev1.qualifier})`
  );

  const ev2 = M.ruleMatchEvidence(c, 'Nothing else to add, patient reports cough for days.');
  check(ev2 !== null, 'matches');
  check(
    ev2.qualifier === null,
    `"Nothing" (contains "no" as a substring, not a whole word) must not trigger negation (got qualifier=${ev2 && ev2.qualifier})`
  );
}

// ── 9. NEGATORS/PAST_MARKERS exported as consts (clinical review doc) ─────
console.log('--- NEGATORS/PAST_MARKERS exported ---');
{
  check(
    Array.isArray(M.NEGATORS) && M.NEGATORS.length === 8,
    `NEGATORS exported, 8 entries (got ${M.NEGATORS && M.NEGATORS.length})`
  );
  check(
    Array.isArray(M.PAST_MARKERS) && M.PAST_MARKERS.length === 9,
    `PAST_MARKERS exported, 9 entries (got ${M.PAST_MARKERS && M.PAST_MARKERS.length})`
  );
}

// ── 10. ruleRequireMet (item 3.5, TRIAGE-LENS-2026-07-02.md) ──────────────
// A rule's OPTIONAL `require` clause is a SEPARATE gate applied by the caller
// AFTER a text match — never touches ruleMatchesText/ruleMatchEvidence. FAIL
// CLOSED: a clause whose data is absent from ctx is treated as unsatisfied.
console.log('--- ruleRequireMet: no require clause → always true ---');
{
  check(M.ruleRequireMet({}, {}) === true, 'no require field on the rule → allowed with empty ctx');
  check(M.ruleRequireMet({}, undefined) === true, 'no require field on the rule → allowed with undefined ctx');
  check(M.ruleRequireMet({ require: null }, {}) === true, 'require: null is treated as no gate');
  check(M.ruleRequireMet({ require: {} }, {}) === true, 'require: {} (no clauses) is always satisfied');
}

console.log('--- ruleRequireMet: ageMin/ageMax ---');
{
  const child = { require: { ageMax: 15 } };
  check(M.ruleRequireMet(child, { ageYears: 8 }) === true, 'ageMax: age within bound → true');
  check(M.ruleRequireMet(child, { ageYears: 15 }) === true, 'ageMax: age exactly at bound (inclusive) → true');
  check(M.ruleRequireMet(child, { ageYears: 16 }) === false, 'ageMax: age above bound → false');
  check(M.ruleRequireMet(child, {}) === false, 'ageMax: no ageYears in ctx → fail closed');
  check(M.ruleRequireMet(child, undefined) === false, 'ageMax: no ctx at all → fail closed');

  const elder = { require: { ageMin: 65 } };
  check(M.ruleRequireMet(elder, { ageYears: 70 }) === true, 'ageMin: age above bound → true');
  check(M.ruleRequireMet(elder, { ageYears: 65 }) === true, 'ageMin: age exactly at bound (inclusive) → true');
  check(M.ruleRequireMet(elder, { ageYears: 64 }) === false, 'ageMin: age below bound → false');
  check(M.ruleRequireMet(elder, {}) === false, 'ageMin: no ageYears in ctx → fail closed');

  const band = { require: { ageMin: 18, ageMax: 65 } };
  check(M.ruleRequireMet(band, { ageYears: 40 }) === true, 'ageMin+ageMax band: within → true');
  check(M.ruleRequireMet(band, { ageYears: 17 }) === false, 'ageMin+ageMax band: below → false');
  check(M.ruleRequireMet(band, { ageYears: 66 }) === false, 'ageMin+ageMax band: above → false');
}

console.log('--- ruleRequireMet: sex ---');
{
  const maleOnly = { require: { sex: 'male' } };
  check(M.ruleRequireMet(maleOnly, { sex: 'male' }) === true, 'sex: matching → true');
  check(M.ruleRequireMet(maleOnly, { sex: 'female' }) === false, 'sex: non-matching → false');
  check(M.ruleRequireMet(maleOnly, {}) === false, 'sex: no sex in ctx → fail closed');
  check(M.ruleRequireMet(maleOnly, { sex: 'Male' }) === true, 'sex: case-insensitive match');
}

console.log('--- ruleRequireMet: medsAny / problemsAny (substring match) ---');
{
  const mtxGated = { require: { medsAny: ['methotrexate'] } };
  check(
    M.ruleRequireMet(mtxGated, { medsText: 'Methotrexate 10mg once weekly' }) === true,
    'medsAny: case-insensitive substring hit → true'
  );
  check(M.ruleRequireMet(mtxGated, { medsText: 'Amlodipine 5mg' }) === false, 'medsAny: no matching substring → false');
  check(M.ruleRequireMet(mtxGated, {}) === false, 'medsAny: no medsText in ctx → fail closed');
  check(M.ruleRequireMet(mtxGated, { medsText: '' }) === false, 'medsAny: empty medsText → fail closed');

  const ckdGated = { require: { problemsAny: ['ckd', 'chronic kidney disease'] } };
  check(
    M.ruleRequireMet(ckdGated, { problemsText: 'CKD stage 3' }) === true,
    'problemsAny: case-insensitive substring hit → true'
  );
  check(M.ruleRequireMet(ckdGated, { problemsText: 'Asthma' }) === false, 'problemsAny: no matching substring → false');
  check(M.ruleRequireMet(ckdGated, {}) === false, 'problemsAny: no problemsText in ctx → fail closed');
}

console.log('--- ruleRequireMet: whole require object (multiple clauses, AND) ---');
{
  const utiChild = {
    require: { ageMax: 15 },
  };
  const utiMethotrexate = {
    require: { medsAny: ['methotrexate'] },
  };
  // The queue surface has age but no meds — a UTI+child rule fires there,
  // a UTI+methotrexate rule does not (fails closed, no meds data on the queue).
  const queueCtx = { ageYears: 8 };
  check(M.ruleRequireMet(utiChild, queueCtx) === true, 'age-gated rule fires on a surface that has age data');
  check(
    M.ruleRequireMet(utiMethotrexate, queueCtx) === false,
    'meds-gated rule fails closed on a surface with no meds data'
  );
  // The detail/record surface has both — both fire when the data confirms them.
  const detailCtx = { ageYears: 8, medsText: 'Methotrexate 10mg weekly, Folic acid 5mg weekly' };
  check(M.ruleRequireMet(utiChild, detailCtx) === true, 'age-gated rule fires on a surface with age data');
  check(M.ruleRequireMet(utiMethotrexate, detailCtx) === true, 'meds-gated rule fires when meds data confirms it');

  const multiClause = { require: { ageMin: 18, ageMax: 65, sex: 'female', medsAny: ['warfarin'] } };
  const fullCtx = { ageYears: 30, sex: 'female', medsText: 'Warfarin 3mg' };
  check(M.ruleRequireMet(multiClause, fullCtx) === true, 'all four clauses satisfied → true');
  check(
    M.ruleRequireMet(multiClause, { ...fullCtx, sex: 'male' }) === false,
    'one clause (sex) unsatisfied among several → false'
  );
  check(
    M.ruleRequireMet(multiClause, { ageYears: 30, sex: 'female' }) === false,
    'one clause (medsAny) has no data at all → fail closed, false'
  );
}

// ── 11. validateRuleRequire (item 3.5) ─────────────────────────────────────
console.log('--- validateRuleRequire ---');
{
  check(M.validateRuleRequire({}).length === 0, 'no require field → no errors');
  check(M.validateRuleRequire({ require: undefined }).length === 0, 'require: undefined → no errors');
  check(
    M.validateRuleRequire({ require: { ageMin: 18, ageMax: 65, sex: 'female', medsAny: ['x'], problemsAny: ['y'] } })
      .length === 0,
    'a well-formed require object → no errors'
  );
  check(M.validateRuleRequire({ require: 'nope' }).length > 0, 'a non-object require is rejected');
  check(M.validateRuleRequire({ require: [] }).length > 0, 'an array require is rejected');
  check(M.validateRuleRequire({ require: { ageMin: -1 } }).length > 0, 'negative ageMin is rejected');
  check(M.validateRuleRequire({ require: { ageMax: -1 } }).length > 0, 'negative ageMax is rejected');
  check(M.validateRuleRequire({ require: { ageMin: 70, ageMax: 65 } }).length > 0, 'ageMin > ageMax is rejected');
  check(M.validateRuleRequire({ require: { sex: 'Male' } }).length > 0, 'capitalised sex is rejected');
  check(M.validateRuleRequire({ require: { sex: 'other' } }).length > 0, 'an unrecognised sex value is rejected');
  check(M.validateRuleRequire({ require: { medsAny: 'not-an-array' } }).length > 0, 'a non-array medsAny is rejected');
  check(
    M.validateRuleRequire({ require: { problemsAny: [1, 2] } }).length > 0,
    'a non-string-array problemsAny is rejected'
  );
}

assert.strictEqual(failed, 0, `${failed} check(s) failed`);
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
