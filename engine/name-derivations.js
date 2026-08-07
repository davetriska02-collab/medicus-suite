// engine/name-derivations.js — Non-British surname derivation matching
// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
//
// Two distinct linguistic phenomena that British-surname assumptions elsewhere in this codebase
// (same literal surname string = same family) get wrong, both aimed at not letting the matching
// engine under-score — or, for the patronymic case, MISS entirely — a genuine relationship:
//
// 1. GENDERED SURNAME VARIANTS (Balto-Slavic). The same family surname takes a different
//    grammatical FORM depending on the bearer's sex — Polish Kowalski/Kowalska, Czech/Slovak
//    Novák/Nováková, Russian/Bulgarian Ivanov/Ivanova, and Lithuanian's genuinely three-way
//    system (a married woman always takes -ienė regardless of her own name's ending; an
//    unmarried daughter's suffix depends on her FATHER's ending: -as->-aitė, -is/-ys->-ytė,
//    -us->-iūtė). A manual GP2GP contact and a real Medicus record can easily disagree on which
//    form got typed in. isGenderedSurnameMatch() recognises these pairs as the same family name.
//
// 2. PATRONYMIC EXTRACTION (Nordic, East Slavic). In these systems a person's own surname (or,
//    for Russian-style naming, their middle name) directly ENCODES their father's first name —
//    Icelandic Björnsson/Björnsdóttir ("Björn's son/daughter"), Russian Ivanovich/Ivanovna ("son/
//    daughter of Ivan"). A manual contact for "father" won't share a surname with the index
//    patient at all in these systems — extractPatronymicFather() derives what the father's own
//    first name should be directly from the index patient's own name, giving a positive signal
//    to weigh a father candidate by, independent of whatever the manual contact's free text says.
//    ALWAYS the father, never the mother — that's what "patronymic" (as opposed to the much rarer
//    matronymic naming, not covered here) means in both of these real systems.
//
// DIACRITICS: GP2GP imports and hand-typed manual contacts routinely drop them (no accented-input
// keyboard, straight ASCII transliteration), so every comparison here works on a folded
// (accent-stripped) form rather than assuming either side spelled a name "correctly". The one
// deliberate exception is the two single-character Czech/Slovak adjectival-surname markers
// (ý/á) — folded, "ý"/"á" degrade to the extremely common bare English letters "y"/"a", which
// would misfire constantly against ordinary British surnames (Kennedy, Murphy, Shaw...). Those
// two stay accent-strict: matched only when the real accented character is present.
//
// Every result here is a SORT/BADGE AID ONLY, feeding into engine/contact-match.js's existing
// scoring — nothing auto-applies at any confidence, matching that file's own doctrine.
//
// Dual-mode export: Node `require` AND browser global (`window.NameDerivations`), same pattern as
// engine/contact-match.js / engine/contact-relationships.js.

(function (global) {
  'use strict';

  // Stems shorter than this after stripping a suffix are rejected — a 1-2 character stem carries
  // no real discriminating power and would make coincidental collisions likely.
  const MIN_STEM_LENGTH = 3;

  // The bare East-Slavic -in/-ina pair needs a LONGER stem than everything else here. At the
  // general 3-character minimum it matched a long list of ordinary British name pairs that merely
  // share a prefix and happen to end that way — martin/martina, justin/justina — and the cost of a
  // false pairing is a wrong-patient "strong" badge, not a missed suggestion. At 5 the genuine
  // article still works (Karenin/Karenina, Gagarin/Gagarina, Nikitin/Nikitina, Yesenin/Yesenina);
  // the trade is that SHORT genuine -in surnames (Putin/Putina, Lenin/Lenina, Kuzmin/Kuzmina) now
  // abstain rather than pair. That is the deliberate direction: abstaining costs a sort/badge hint
  // the GP can still resolve by eye, whereas a false pair actively points them at the wrong record.
  // -ov/-ova and -ev/-eva are audited and left at 3: both sides of those pairs always carry the
  // suffix (so both must strip to the SAME stem, not merely share a prefix), and English surnames
  // ending -ov/-ev are vanishingly rare, so the same collision has no route in.
  const EAST_SLAVIC_IN_MIN_STEM_LENGTH = 5;

  // The one-side-strips fallback (see isGenderedSurnameMatch) additionally requires this much stem
  // before it will consider a counterpart at all — it is the weakest of the three routes to a
  // match, since only ONE side ever showed a recognised suffix.
  const PREFIX_FALLBACK_MIN_STEM_LENGTH = 4;

  // foldDiacritics(s) -> s with Unicode combining diacritical marks stripped (NFD decompose, then
  // remove the marks) — ö/á/č/š/ž/ę/ė/ū etc. all fold to their plain-Latin base letter. Doesn't
  // touch true separate letters that aren't diacritic marks (Polish ł, Icelandic ð/þ) — accepted
  // as a known gap rather than something worth a full transliteration table for.
  function foldDiacritics(s) {
    return String(s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  // ── Gendered surname suffixes (Balto-Slavic) ─────────────────────────────────────────────────
  // Sorted longest-first so a more specific suffix is never shadowed by a shorter one that
  // happens to be a trailing substring of it. `strictAccent: true` suffixes are matched against
  // the RAW (unfolded) token only — see the file header for why.
  const GENDERED_SURNAME_SUFFIXES = [
    // Polish adjectival surnames, and the Russian/Bulgarian transliteration of the same pattern.
    { suffix: 'dzki', gender: 'm', family: 'polish' },
    { suffix: 'dzka', gender: 'f', family: 'polish' },
    { suffix: 'cki', gender: 'm', family: 'polish' },
    { suffix: 'cka', gender: 'f', family: 'polish' },
    { suffix: 'tsky', gender: 'm', family: 'polish' },
    { suffix: 'tskaya', gender: 'f', family: 'polish' },
    { suffix: 'ski', gender: 'm', family: 'polish' },
    { suffix: 'ska', gender: 'f', family: 'polish' },
    { suffix: 'skaya', gender: 'f', family: 'polish' },
    { suffix: 'sky', gender: 'm', family: 'polish' },
    // Czech/Slovak: -ová is APPENDED to the male base (Novák -> Nováková), not swapped — the male
    // form is left to match via isGenderedSurnameMatch's prefix fallback, same as Lithuanian
    // below. Novotný/Novotná-style adjectival surnames swap a bare accented vowel instead — see
    // the file header for why these two stay accent-strict. This single entry also serves East
    // Slavic -ova (Ivanova): folded, "ová" and "ova" are the same string with the same gender, so
    // a second entry for it would only be an ordering ambiguity — the East Slavic block below
    // deliberately lists only its male -ov.
    { suffix: 'ová', gender: 'f', family: 'czech' },
    { suffix: 'ý', gender: 'm', strictAccent: true, family: 'czech' },
    { suffix: 'á', gender: 'f', strictAccent: true, family: 'czech' },
    // East Slavic (Russian/Ukrainian/Belarusian/Bulgarian) — a genuine suffix swap. (Female -ova
    // is the folded "ová" entry above.)
    { suffix: 'ov', gender: 'm', family: 'eastslavic' },
    { suffix: 'eva', gender: 'f', family: 'eastslavic' },
    { suffix: 'ev', gender: 'm', family: 'eastslavic' },
    { suffix: 'ina', gender: 'f', family: 'eastslavic', minStem: EAST_SLAVIC_IN_MIN_STEM_LENGTH },
    { suffix: 'in', gender: 'm', family: 'eastslavic', minStem: EAST_SLAVIC_IN_MIN_STEM_LENGTH },
    // Lithuanian female suffixes only. Deliberately no entry for the bare male endings
    // (-as/-is/-ys) as strippable suffixes in their own right — far too short and far too likely
    // to coincide with ordinary English surnames (Lewis, Douglas, Curtis, Rhys...) to strip
    // safely on their own. They're only ever reached as the unstripped remainder compared against
    // a stripped female form (isGenderedSurnameMatch's prefix fallback) — never stripped
    // themselves.
    { suffix: 'ienė', gender: 'f', family: 'lithuanian' }, // married woman/widow, regardless of her father's/husband's own ending
    { suffix: 'aitė', gender: 'f', family: 'lithuanian' }, // unmarried daughter, father's name ends -as
    { suffix: 'iūtė', gender: 'f', family: 'lithuanian' }, // unmarried daughter, father's name ends -us
    { suffix: 'ytė', gender: 'f', family: 'lithuanian' }, // unmarried daughter, father's name ends -is/-ys
  ].sort((a, b) => b.suffix.length - a.suffix.length);

  // Endings the UNSTRIPPED side of a one-sided match is allowed to carry, per language family —
  // see isGenderedSurnameMatch's prefix fallback. Keyed by the family of the suffix that DID
  // strip, because the counterpart form is a fact about that language, not about the other token.
  const COUNTERPART_ENDINGS = {
    // Lithuanian male surname endings. The female forms are built from the father's/husband's own
    // name, whose ending is one of these — plus '' for a record where only the bare stem got typed.
    lithuanian: ['', 'as', 'is', 'ys', 'us', 'ius'],
    // Czech/Slovak -ová is appended to the WHOLE male base (Novák -> Nováková), so the counterpart
    // is the bare stem. 'y'/'a' cover the adjectival pair (Novotný/Novotná) when only one of the
    // two sides was typed with its accent — the accented side still has to strip for us to be here
    // at all, so the "y"/"a" collision risk the strictAccent rule exists to avoid does not apply.
    czech: ['', 'y', 'a'],
    // Polish and East Slavic pairs ALWAYS carry a suffix on BOTH sides (-ski/-ska, -ov/-ova,
    // -in/-ina), so a genuine pair always takes the both-sides-strip route and this fallback is
    // never legitimately needed. Leaving it open bought nothing and cost a long list of ordinary
    // British false pairs — Colin/Collins, Martin/Martinez, Martin/Martindale, Robin/Roberts,
    // Austin/Austen, Jenkin/Jenkins, Griffin/Griffiths, Georgina/George, Christina/Christopher,
    // Carolina/Caroline — all of which reached the top non-exact name tier on nothing more than a
    // shared prefix. An empty list disables the fallback for these families entirely.
    polish: [],
    eastslavic: [],
  };

  // stripGenderedSurnameSuffix(token) -> { stem, gender, suffix, family } | null. `stem` is always
  // returned folded+lowercased, regardless of whether the matched suffix itself was strict. An
  // entry may raise its own minimum stem length (`minStem`) above the shared MIN_STEM_LENGTH when
  // its suffix is short enough to collide with ordinary English spellings — see
  // EAST_SLAVIC_IN_MIN_STEM_LENGTH.
  function stripGenderedSurnameSuffix(token) {
    const raw = String(token || '');
    const rawLower = raw.toLowerCase();
    const folded = foldDiacritics(rawLower);
    for (const entry of GENDERED_SURNAME_SUFFIXES) {
      const minStem = entry.minStem || MIN_STEM_LENGTH;
      if (entry.strictAccent) {
        if (rawLower.length > entry.suffix.length && rawLower.endsWith(entry.suffix)) {
          const stem = foldDiacritics(rawLower.slice(0, rawLower.length - entry.suffix.length));
          if (stem.length >= minStem) {
            return { stem, gender: entry.gender, suffix: entry.suffix, family: entry.family };
          }
        }
      } else {
        const suffix = foldDiacritics(entry.suffix);
        if (folded.length > suffix.length && folded.endsWith(suffix)) {
          const stem = folded.slice(0, folded.length - suffix.length);
          if (stem.length >= minStem) {
            return { stem, gender: entry.gender, suffix: entry.suffix, family: entry.family };
          }
        }
      }
    }
    return null;
  }

  // isGenderedSurnameMatch(tokenA, tokenB) -> boolean. True when both tokens plausibly represent
  // the same Balto-Slavic family surname in different grammatically-gendered forms.
  //   - Both sides strip to the SAME stem (Polish Kowalski/Kowalska, Russian Ivanov/Ivanova,
  //     Czech Novotný/Novotná) -> match.
  //   - Both sides strip but to DIFFERENT stems -> genuinely different families, not a match.
  //   - Exactly one side strips (the Lithuanian asymmetric case, and Czech -ová's appended-not-
  //     swapped form: Novák vs Nováková) -> match only if the other, folded, unprocessed token is
  //     EXACTLY the stripped stem plus one of the counterpart endings its own language family
  //     actually uses (COUNTERPART_ENDINGS) — "kazlausk" + "as" IS "kazlauskas", so
  //     Kazlauskienė/Kazlauskaitė correctly match Kazlauskas. A bare `startsWith` here — accepting
  //     ANY continuation of the stem — is what paired "Colin"/"Collins", "Martin"/"Martinez" and
  //     "Georgina"/"George"; a shared prefix is not evidence of a shared family.
  //   - NEITHER side shows any recognised suffix -> this function abstains (false), deliberately,
  //     rather than falling back to a bare prefix check on two untouched strings — that would
  //     wrongly treat unrelated English surnames sharing a prefix (e.g. "Smith" vs "Smithson") as
  //     a gendered-surname pair. Recognised-suffix evidence on at least one side is required
  //     before this function has anything to say at all.
  function isGenderedSurnameMatch(tokenA, tokenB) {
    const a = foldDiacritics(String(tokenA || '').toLowerCase());
    const b = foldDiacritics(String(tokenB || '').toLowerCase());
    if (!a || !b || a === b) return false; // exact-equality already handled by the caller
    const stripA = stripGenderedSurnameSuffix(tokenA);
    const stripB = stripGenderedSurnameSuffix(tokenB);
    if (!stripA && !stripB) return false;
    if (stripA && stripB) return stripA.stem === stripB.stem;
    const stripped = stripA || stripB;
    const raw = stripA ? b : a;
    if (stripped.stem.length < PREFIX_FALLBACK_MIN_STEM_LENGTH) return false;
    const endings = COUNTERPART_ENDINGS[stripped.family] || [];
    return endings.some((ending) => raw === stripped.stem + ending);
  }

  // ── Patronymic extraction (Nordic, East Slavic) ──────────────────────────────────────────────
  // Nordic: applied to the SURNAME (last token) — the surname itself IS the patronymic. Only the
  // doubled-s "-sson" form is treated as strippable, NOT bare single-s "-son" — Icelandic genitive
  // regularly ends in -s, and "son" itself begins with s, so the regular pattern always doubles
  // (Björn -> Björns -> Björnsson; Gunnar -> Gunnars -> Gunnarsson) — while ordinary English
  // "-son" surnames (Wilson, Johnson, Jackson, Robinson, Anderson...) never double the s. That
  // orthographic difference is what makes stripping safe here; a bare "-son" would misfire on a
  // huge fraction of ordinary English patients. "-dóttir" (daughter) has no such risk at all — no
  // English surname takes that form even folded — so it's included at full strength.
  const NORDIC_PATRONYMIC_SUFFIXES = [
    { suffix: 'sdóttir', childGender: 'f' },
    { suffix: 'dóttir', childGender: 'f' },
    { suffix: 'sson', childGender: 'm' },
  ].sort((a, b) => b.suffix.length - a.suffix.length);

  // East Slavic patronymic MIDDLE name (Russian/Ukrainian/Belarusian naming order is First
  // Patronymic Family) — distinctive enough (no English word/name ends this way) that no
  // collision guard is needed, unlike Nordic -son. Formation from a first name to its patronymic
  // isn't perfectly mechanical (stem changes, e.g. "Ilya" -> "Ilyich" not "*Ilyovich") — the
  // stripped stem is therefore compared to a candidate's first name via a prefix check
  // (parentNameLikelyMatches), not exact equality, to tolerate this.
  const SLAVIC_PATRONYMIC_SUFFIXES = [
    { suffix: 'yevich', childGender: 'm' },
    { suffix: 'ovich', childGender: 'm' },
    { suffix: 'evich', childGender: 'm' },
    { suffix: 'yevna', childGender: 'f' },
    { suffix: 'ovna', childGender: 'f' },
    { suffix: 'evna', childGender: 'f' },
    { suffix: 'ichna', childGender: 'f' }, // irregular but real, e.g. Ilyinichna
  ].sort((a, b) => b.suffix.length - a.suffix.length);

  // A patronymic stem is a claim about a real first name, and it is then prefix-matched against a
  // candidate's forename — so a 3-letter stem matches an enormous slice of the population. Matching
  // a full recognised suffix is NOT enough on its own: "-sson" is a genuine suffix, and ordinary
  // surnames end that way too ("Crosson" -> "cro", "Classon" -> "cla", "Casson" -> "ca"), which is
  // how a "Cronan Byrne" was scored as the father of a "Crosson". Four characters is the floor; a
  // 3-character stem is accepted only when it ends in a CONSONANT, which is also the linguistically
  // correct shape for the doubled-s form — the extra s IS the genitive of a consonant-final name
  // (Jón -> Jóns -> Jónsson, Per -> Pers -> Persson), whereas a vowel-final Nordic name takes the
  // single-s form we deliberately never strip at all (Sturla -> Sturluson, Tryggvi -> Tryggvason).
  const PATRONYMIC_MIN_STEM_LENGTH = 4;
  const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'y']);

  function patronymicStemIsUsable(stem) {
    if (stem.length >= PATRONYMIC_MIN_STEM_LENGTH) return true;
    if (stem.length < MIN_STEM_LENGTH) return false;
    return !VOWELS.has(stem[stem.length - 1]);
  }

  function stripSuffixFromList(token, list) {
    const folded = foldDiacritics(String(token || '').toLowerCase());
    for (const entry of list) {
      const suffix = foldDiacritics(entry.suffix);
      if (folded.length > suffix.length && folded.endsWith(suffix)) {
        const stem = folded.slice(0, folded.length - suffix.length);
        if (patronymicStemIsUsable(stem)) return { stem, childGender: entry.childGender };
      }
    }
    return null;
  }

  // extractPatronymicFather(fullName) -> { fatherFirstName, childGenderImplied, system } | null.
  // fullName is a raw display name ("Björn Karlsson", "Ivan Petrovich Sokolov") — tokenised on
  // whitespace; casing is irrelevant since only suffix-stripping happens.
  function extractPatronymicFather(fullName) {
    const tokens = String(fullName || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!tokens.length) return null;
    // Nordic — surname (last token) IS the patronymic.
    const nordic = stripSuffixFromList(tokens[tokens.length - 1], NORDIC_PATRONYMIC_SUFFIXES);
    if (nordic) {
      return { fatherFirstName: nordic.stem, childGenderImplied: nordic.childGender, system: 'nordic' };
    }
    // East Slavic — patronymic is a MIDDLE token (First Patronymic Family), so needs 3+ tokens.
    if (tokens.length >= 3) {
      for (let i = 1; i < tokens.length - 1; i++) {
        const slavic = stripSuffixFromList(tokens[i], SLAVIC_PATRONYMIC_SUFFIXES);
        if (slavic) {
          return { fatherFirstName: slavic.stem, childGenderImplied: slavic.childGender, system: 'slavic' };
        }
      }
    }
    return null;
  }

  // parentNameLikelyMatches(derivedFirstName, candidateFirstName) -> boolean. Prefix-based, not
  // exact equality — the Nordic case is usually a clean stem (Björnsson -> Björn), but the Slavic
  // patronymic stem is only approximate (see SLAVIC_PATRONYMIC_SUFFIXES's own comment), so a
  // shorter/longer prefix relationship is treated as a match either direction. Folded, so
  // "Bjorn" (typed without the ö) still matches a stem derived from a correctly-accented record.
  function parentNameLikelyMatches(derivedFirstName, candidateFirstName) {
    const a = foldDiacritics(
      String(derivedFirstName || '')
        .trim()
        .toLowerCase()
    );
    const b = foldDiacritics(
      String(candidateFirstName || '')
        .trim()
        .toLowerCase()
    );
    if (!a || !b) return false;
    if (a.length < MIN_STEM_LENGTH || b.length < MIN_STEM_LENGTH) return a === b;
    const shorter = a.length <= b.length ? a : b;
    const longer = a.length <= b.length ? b : a;
    return longer.startsWith(shorter);
  }

  const api = {
    foldDiacritics,
    stripGenderedSurnameSuffix,
    isGenderedSurnameMatch,
    extractPatronymicFather,
    parentNameLikelyMatches,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else if (global) {
    global.NameDerivations = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
