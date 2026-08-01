// Medicus Suite — Non-British name-derivation pure-logic tests
// Run with: node test-name-derivations.js
//
// engine/name-derivations.js recognises two things British-surname assumptions elsewhere in this
// codebase get wrong: grammatically gendered Balto-Slavic surname pairs (Kowalski/Kowalska), and
// patronymic naming (Nordic, East Slavic) where a person's own name encodes their father's first
// name rather than a shared family surname. This file pins the conservative collision guards this
// whole feature depends on: bare "-son"/"-is"/"-as"/"-y" endings must NEVER fire against ordinary
// English surnames, only the more distinctive markers that don't coincide with them.

'use strict';

const ND = require('./engine/name-derivations.js');

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
// 1 — stripGenderedSurnameSuffix
// ============================================================
console.log('1: stripGenderedSurnameSuffix');
{
  check(ND.stripGenderedSurnameSuffix('kowalski').stem === 'kowal', 'Polish male -ski strips to the stem');
  check(ND.stripGenderedSurnameSuffix('kowalska').stem === 'kowal', 'Polish female -ska strips to the same stem');
  check(ND.stripGenderedSurnameSuffix('ivanov').stem === 'ivan', 'Russian male -ov strips to the stem');
  check(ND.stripGenderedSurnameSuffix('ivanova').stem === 'ivan', 'Russian female -ova strips to the same stem');
  check(ND.stripGenderedSurnameSuffix('novakova').stem === 'novak', 'Czech -ová (folded) strips to the base');
  check(
    ND.stripGenderedSurnameSuffix('kazlauskiene').stem === 'kazlausk',
    'Lithuanian married-woman -ienė (ASCII-typed) strips correctly'
  );
  check(
    ND.stripGenderedSurnameSuffix('Kazlauskaitė').stem === 'kazlausk',
    'Lithuanian unmarried-daughter -aitė (correct diacritic) strips correctly'
  );
  check(ND.stripGenderedSurnameSuffix('smith') === null, 'an ordinary English surname strips to nothing');
  check(ND.stripGenderedSurnameSuffix('davis') === null, 'a short English surname is not mistaken for a suffix');
  check(ND.stripGenderedSurnameSuffix('wilson') === null, 'bare -son is never treated as a strippable suffix here');
}

// ============================================================
// 2 — Czech/Slovak accent-strict suffixes (ý/á) — the deliberate exception
// ============================================================
console.log('2: strictAccent suffixes require the real diacritic');
{
  check(
    ND.stripGenderedSurnameSuffix('novotný').stem === 'novotn',
    'Novotný (correct diacritic) strips via the strict male marker'
  );
  check(
    ND.stripGenderedSurnameSuffix('novotná').stem === 'novotn',
    'Novotná (correct diacritic) strips via the strict female marker'
  );
  check(
    ND.stripGenderedSurnameSuffix('novotny') === null,
    'the ASCII-typed form (no diacritic) does NOT strip — folding would degrade "ý" to the common English "y"'
  );
  check(
    ND.stripGenderedSurnameSuffix('kennedy') === null,
    'an ordinary English "-y" surname is never touched by the strict Czech marker'
  );
  check(ND.stripGenderedSurnameSuffix('murphy') === null, 'same for another common English "-y" surname');
}

// ============================================================
// 3 — isGenderedSurnameMatch
// ============================================================
console.log('3: isGenderedSurnameMatch');
{
  check(ND.isGenderedSurnameMatch('kowalski', 'kowalska'), 'Polish male/female pair matches');
  check(ND.isGenderedSurnameMatch('ivanov', 'ivanova'), 'Russian male/female pair matches');
  check(
    ND.isGenderedSurnameMatch('novak', 'novakova'),
    'Czech unstripped male form matches the -ová appended female form (prefix fallback)'
  );
  check(
    ND.isGenderedSurnameMatch('kazlauskas', 'kazlauskiene'),
    'Lithuanian unstripped male form matches -ienė via the prefix fallback'
  );
  check(
    ND.isGenderedSurnameMatch('kazlauskas', 'Kazlauskaitė'),
    'Lithuanian unstripped male form matches -aitė via the prefix fallback, correct diacritic'
  );
  check(
    ND.isGenderedSurnameMatch('novotný', 'novotná'),
    'Czech adjectival pair matches when both sides carry the real diacritic'
  );
  check(
    !ND.isGenderedSurnameMatch('novotny', 'novotna'),
    'the same pair typed WITHOUT diacritics does not match — avoids the "y"/"a" collision risk'
  );
  check(!ND.isGenderedSurnameMatch('smith', 'smithson'), '"Smith" vs "Smithson" is not a gendered-surname pair');
  check(!ND.isGenderedSurnameMatch('kennedy', 'murphy'), 'two unrelated English "-y" surnames never match');
  check(!ND.isGenderedSurnameMatch('kowalski', 'nowicka'), 'two DIFFERENT Polish families do not cross-match');
  check(!ND.isGenderedSurnameMatch('smith', 'smith'), 'identical tokens are the caller’s job, not this function’s');
}

// ============================================================
// 4 — extractPatronymicFather
// ============================================================
console.log('4: extractPatronymicFather');
{
  const bjornsson = ND.extractPatronymicFather('Björn Karlsson');
  check(bjornsson && bjornsson.fatherFirstName === 'karl', 'Icelandic -sson derives the father’s first name');
  check(bjornsson.childGenderImplied === 'm', 'the -sson suffix implies a male child');
  check(bjornsson.system === 'nordic', 'system is reported as nordic');

  const dottir = ND.extractPatronymicFather('Anna Bjornsdottir');
  check(dottir && dottir.fatherFirstName === 'bjorn', 'ASCII-typed -dottir still derives the father’s first name');
  check(dottir.childGenderImplied === 'f', 'the -dóttir suffix implies a female child');

  check(
    ND.extractPatronymicFather('James Wilson') === null,
    'an ordinary English "-son" surname is NOT treated as a patronymic — the core collision risk this feature exists to avoid'
  );
  check(ND.extractPatronymicFather('Peter Johnson') === null, 'same for another extremely common English -son surname');
  check(ND.extractPatronymicFather('Anna Robinson') === null, 'and again for a third');

  const russian = ND.extractPatronymicFather('Ivan Petrovich Sokolov');
  check(russian && russian.fatherFirstName === 'petr', 'Russian -ovich middle name derives the father’s first name');
  check(russian.system === 'slavic', 'system is reported as slavic');
  check(russian.childGenderImplied === 'm', '-ovich implies a male child');

  const russianF = ND.extractPatronymicFather('Anna Petrovna Sokolova');
  check(
    russianF && russianF.fatherFirstName === 'petr',
    'Russian -ovna middle name (daughter) derives the same father'
  );
  check(russianF.childGenderImplied === 'f', '-ovna implies a female child');

  check(
    ND.extractPatronymicFather('Ivan Sokolov') === null,
    'a 2-token Russian-style name has no middle token to hold a patronymic at all'
  );
  check(ND.extractPatronymicFather('') === null, 'empty name returns null');
  check(ND.extractPatronymicFather(null) === null, 'is defensive against null');
}

// ============================================================
// 5 — parentNameLikelyMatches
// ============================================================
console.log('5: parentNameLikelyMatches');
{
  check(ND.parentNameLikelyMatches('bjorn', 'Björn'), 'exact name, different diacritic spelling, folds to a match');
  check(ND.parentNameLikelyMatches('karl', 'Karl'), 'exact match regardless of casing');
  check(ND.parentNameLikelyMatches('ivan', 'Ivanka'), 'a genuine prefix relationship counts as a match');
  check(!ND.parentNameLikelyMatches('ivan', 'Ivo'), 'two genuinely different short names do not match');
  check(!ND.parentNameLikelyMatches('bjorn', 'anna'), 'unrelated names do not match');
  check(!ND.parentNameLikelyMatches('', 'Karl'), 'an empty derived name never matches anything');
}

// ============================================================
console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
