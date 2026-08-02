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
// 3a — the British-surname false-positive set (the whole point of the collision guards)
// ============================================================
// Every pair below is two ORDINARY, UNRELATED British/English names that the first cut of this
// module reported as the same family surname in different gendered forms. A false "same family"
// here is not cosmetic: it feeds contact-match.js's name signal, which is 55 of the 100 available
// points, so it is what turns "someone else at this address" into a "strong" badge pointing a GP
// at the WRONG patient. Both argument orders are checked — the function must be symmetric.
console.log('3a: common British name pairs never match as gendered surname variants');
{
  const britishFalsePairs = [
    ['martin', 'martina'],
    ['martin', 'martinez'],
    ['martin', 'martindale'],
    ['colin', 'collins'],
    ['robin', 'roberts'],
    ['austin', 'austen'],
    ['jenkin', 'jenkins'],
    ['griffin', 'griffiths'],
    ['georgina', 'george'],
    ['christina', 'christopher'],
    ['carolina', 'caroline'],
    ['justin', 'justina'],
  ];
  for (const [a, b] of britishFalsePairs) {
    check(!ND.isGenderedSurnameMatch(a, b), `"${a}" vs "${b}" is not a gendered-surname pair`);
    check(!ND.isGenderedSurnameMatch(b, a), `"${b}" vs "${a}" — same abstention in the other argument order`);
  }
}

// ============================================================
// 3b — the genuine pairs the feature exists for, both directions
// ============================================================
console.log('3b: genuine gendered pairs still match in both directions');
{
  const genuinePairs = [
    ['kowalski', 'kowalska', 'Polish -ski/-ska'],
    ['nowicki', 'nowicka', 'Polish -cki/-cka'],
    ['ivanov', 'ivanova', 'East Slavic -ov/-ova'],
    ['medvedev', 'medvedeva', 'East Slavic -ev/-eva'],
    ['karenin', 'karenina', 'East Slavic -in/-ina with a long enough stem'],
    ['gagarin', 'gagarina', 'another genuine -in/-ina pair'],
    ['novak', 'novakova', 'Czech -ová appended to the male base (ASCII-typed)'],
    ['Novák', 'Nováková', 'the same Czech pair with the real diacritics'],
    ['novotný', 'novotná', 'Czech adjectival pair, both accented'],
    ['kazlauskas', 'kazlauskienė', 'Lithuanian -as male vs married-woman -ienė'],
    ['kazlauskas', 'kazlauskaitė', 'Lithuanian -as male vs unmarried-daughter -aitė'],
    ['petraitis', 'petraitytė', 'Lithuanian -is male vs -ytė daughter'],
    ['vaitkus', 'vaitkiūtė', 'Lithuanian -us male vs -iūtė daughter'],
  ];
  for (const [a, b, label] of genuinePairs) {
    check(ND.isGenderedSurnameMatch(a, b), `${label}: "${a}" vs "${b}" matches`);
    check(ND.isGenderedSurnameMatch(b, a), `${label}: matches in the reverse argument order too`);
  }
}

// ============================================================
// 3c — the one-side-strips fallback must not accept ANY continuation of the stem
// ============================================================
// When exactly one side carries a recognised suffix, the other side is compared against the
// stripped stem. A bare `startsWith` accepted literally any continuation, which is what let
// "colin"/"collins" and "martin"/"martinez" through. The unstripped side now has to be the stem
// plus a recognised counterpart ending from the SAME language family.
console.log('3c: the prefix fallback requires a recognised counterpart ending');
{
  check(
    !ND.isGenderedSurnameMatch('kazlauskienė', 'kazlauskevicius'),
    'a Lithuanian female form does not match an arbitrary longer surname sharing its stem'
  );
  check(
    !ND.isGenderedSurnameMatch('novakova', 'novakovic'),
    '"Novakova" does not match the unrelated "Novakovic" just because the stem is a prefix'
  );
  check(
    !ND.isGenderedSurnameMatch('ivanova', 'ivanovsky'),
    'nor does a stem-prefix relationship alone pair "Ivanova" with "Ivanovsky"'
  );
  check(
    ND.isGenderedSurnameMatch('kazlauskienė', 'kazlausk'),
    'a bare stem (no male ending typed at all) is still an accepted counterpart'
  );
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
// 4a — patronymic stem guards (a 3-char stem is not evidence of anything)
// ============================================================
// "-sson" is a full recognised patronymic suffix, so suffix recognition alone does NOT make a
// derivation safe: ordinary surnames end that way too ("Crosson" -> "cro", "Classon" -> "cla") and
// a 3-letter stem prefix-matches a huge slice of real first names — which is how "Cronan Byrne"
// scored 70/"strong" as the father of a "Crosson". The stem itself has to look like a name root.
console.log('4a: patronymic derivation needs a stem with real discriminating power');
{
  check(
    ND.extractPatronymicFather('Cronan Crosson') === null,
    '"Crosson" does not derive a father — "cro" is not a name'
  );
  check(ND.extractPatronymicFather('Mary Classon') === null, 'same for "Classon" -> "cla"');
  check(ND.extractPatronymicFather('Tom Casson') === null, 'and for "Casson" -> "ca"');
  check(
    ND.extractPatronymicFather('Sarah Harrison') === null,
    'ordinary English "-son": Harrison never derives a father'
  );
  check(ND.extractPatronymicFather('Kate Jackson') === null, 'nor does Jackson');

  // ...while the genuine short-stem Nordic patronymics still derive.
  const jon = ND.extractPatronymicFather('Ólafur Jónsson');
  check(jon && jon.fatherFirstName === 'jon', '"Jónsson" still derives the father "Jón" despite the 3-letter stem');
  const per = ND.extractPatronymicFather('Erik Persson');
  check(per && per.fatherFirstName === 'per', 'Swedish "Persson" still derives "Per"');
  const ivanovich = ND.extractPatronymicFather('Boris Ivanovich Petrov');
  check(
    ivanovich && ivanovich.fatherFirstName === 'ivan',
    '"Ivanovich" still derives "Ivan" — a 4-character stem is unaffected'
  );
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
