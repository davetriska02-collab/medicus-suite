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
    /const api = \{ compileRule, ruleMatchesText, ruleMatchEvidence \};/.test(src),
    'all three are exported off the same api object'
  );
}

assert.strictEqual(failed, 0, `${failed} check(s) failed`);
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
