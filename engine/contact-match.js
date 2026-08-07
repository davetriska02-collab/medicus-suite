// engine/contact-match.js — Candidate scoring for manual→linked contact conversion
// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
//
// Pure engine for the Contacts linking tool. Ranks real-Medicus-patient candidates (from
// patient-finder search, "also at this address", or an already-linked contact) against one of
// the index patient's own manual (unlinked, free-text) contacts, so the family-tree canvas can
// show the most plausible match first.
//
// Every score is a SORT/BADGE AID ONLY. Nothing in this module or its caller auto-applies a
// match at any threshold — the product is human-confirmed-by-drag for every single conversion,
// regardless of score. This is deliberate: the GP building this explicitly cautioned that some
// families share a single generic email across everyone, and children's records sometimes wrongly
// carry a parent's own phone/email — so those signals are capped low and never decisive, and a
// gender or age mismatch is treated as a shrug (neutral), never a hard penalty, since Medicus
// supports a gender identity that can legitimately differ from a relationship word's assumed sex.
//
// Dual-mode export: Node `require` AND browser global (`window.ContactMatch`), same pattern as
// engine/reception-match.js / engine/contact-relationships.js.

(function (global) {
  'use strict';

  function loadContactRelationships() {
    if (typeof require === 'function') {
      try {
        // eslint-disable-next-line global-require
        return require('./contact-relationships.js');
      } catch (e) {
        /* not resolvable under this module system/path — fall through to browser hook */
      }
    }
    if (typeof global !== 'undefined' && global.ContactRelationships) {
      return global.ContactRelationships;
    }
    return null;
  }

  const ContactRelationships = loadContactRelationships();

  function loadNameDerivations() {
    if (typeof require === 'function') {
      try {
        // eslint-disable-next-line global-require
        return require('./name-derivations.js');
      } catch (e) {
        /* not resolvable under this module system/path — fall through to browser hook */
      }
    }
    if (typeof global !== 'undefined' && global.NameDerivations) {
      return global.NameDerivations;
    }
    return null;
  }

  const NameDerivations = loadNameDerivations();

  // foldForCompare(s) -> s with Unicode combining marks stripped, for EQUALITY comparisons only.
  // GP2GP imports and hand-typed manual contacts routinely drop diacritics (no accented-input
  // keyboard, straight ASCII transliteration), so "Nováková" and "Novakova" — the exact scenario
  // this module's name handling exists for — are the same person and must compare equal rather
  // than as two unrelated tokens. Kept local (a two-line NFD strip) rather than reaching into
  // NameDerivations, so token equality still folds when that module isn't loaded.
  function foldForCompare(s) {
    return String(s == null ? '' : s)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  // tokensEqual(a, b) -> the same token modulo diacritics. This is EQUALITY, not derivation: it is
  // safe for every token position, including given names.
  function tokensEqual(a, b) {
    if (a === b) return true;
    const fa = foldForCompare(a);
    return !!fa && fa === foldForCompare(b);
  }

  // surnameTokensMatch(a, b) -> tokensEqual OR a recognised Balto-Slavic gendered-surname pairing
  // (NameDerivations.isGenderedSurnameMatch), so a spelling difference caused only by grammatical
  // gender marking (Kowalski/Kowalska, Novák/Nováková...) doesn't register as a mismatch.
  //
  // SURNAME POSITION ONLY — this is applied solely to the last token of each name, never to given
  // names. Gendered marking is a property of surnames; running it over every token meant a given
  // name was tested against the same morphology and "Martina Brown" vs "Martin Brown" scored 0.9
  // on the name signal, which with a shared address badged a SIBLING as a "strong" match for the
  // manual contact. Given names are compared by fold-equality alone. Falls back to plain equality
  // when NameDerivations isn't loaded. See engine/name-derivations.js's own header.
  function surnameTokensMatch(a, b) {
    if (tokensEqual(a, b)) return true;
    return !!(NameDerivations && NameDerivations.isGenderedSurnameMatch(a, b));
  }

  // ── Name similarity — token-Jaccard, same technique as shared/knowledge-utils.js's findSimilar ──

  const NAME_STOPWORDS = new Set(['mr', 'mrs', 'miss', 'ms', 'mx', 'dr', 'prof']);

  // Unicode-letter-aware (\p{L}), not just a-z: the previous ASCII-only regex silently shredded
  // any accented name into meaningless fragments before comparison ever ran — e.g. "Björn
  // Nováková" became "bj rn nov kov", every accented character treated as a token separator.
  // Found while building non-British name-derivation matching (gendered Balto-Slavic surnames,
  // Nordic/Slavic patronymics — see engine/name-derivations.js) — those features are pointless if
  // the names they're meant to help match never survive this step intact. `.toLowerCase()` is
  // already Unicode-correct in JS (handles diacritics properly); only the character class needed
  // widening. Punctuation/apostrophes ("O'Brien") still fold to a space exactly as before.
  //
  // `.normalize('NFC')` FIRST, because \p{L} does not match \p{M}: an accented name in DECOMPOSED
  // form (base letter + separate combining mark — what some GP2GP payloads and macOS-originated
  // text actually carry) has its combining marks punched out to spaces here, shredding the token
  // exactly the way the ASCII-only regex used to. The same name in NFD vs NFC scored 0.25 against
  // itself. Composing first makes every input form tokenise identically; it is a no-op for the
  // already-composed and pure-ASCII cases.
  function normaliseName(s) {
    const text = String(s || '')
      .normalize('NFC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    let tokens = text.split(' ').filter((t) => t && !NAME_STOPWORDS.has(t));
    if (tokens.length === 0) tokens = text.split(' ').filter(Boolean);
    return { text: tokens.join(' '), tokens };
  }

  const CONTAINMENT_SCORE = 0.9;
  // Containment needs at least this many tokens on the shorter side. A ONE-token containment
  // ('Smith' inside 'John Smith', 'John' inside 'John Smith') is deliberately denied the 0.9 tier
  // and left to fall through to Jaccard (0.5 against a two-token name). Manual contacts are free
  // text and surname-only entries are common, so at 0.9 every same-surname person at the address
  // scored 0.9*55 + 20 = 85 → a "strong" badge for what is really just "someone in that household"
  // — the whole family, ranked as confidently as a genuine match. At the Jaccard band it lands ~62
  // → "possible": still surfaced and still rankable, but visibly a weaker claim.
  const MIN_CONTAINMENT_TOKENS = 2;

  // Hyphenated tokens are split for the containment test ONLY (normaliseName keeps the hyphen, so
  // 'smith-jones' stays one token everywhere else). Medicus and a hand-typed manual contact
  // disagree constantly about whether a double-barrelled surname carries its hyphen, and
  // 'Mary Smith-Jones' vs 'Mary Smith Jones' is the same person by any reading.
  function containmentTokens(tokens) {
    const out = [];
    for (const t of tokens) {
      for (const part of t.split('-')) if (part) out.push(part);
    }
    return out;
  }

  // tokenContainment(tokensA, tokensB) -> boolean. True when EVERY token of the shorter name is
  // present as a WHOLE token of the longer one — i.e. the shorter name is the longer one with
  // middle/extra name parts dropped ('John Smith' ⊂ 'John Michael Smith'). Whole-token is the
  // point: the previous raw-substring test ('john smith'.includes('smith')) also fired for 'Ann'
  // inside 'Annette' and 'Rose' inside 'Ambrose', scoring unrelated people at the top non-exact
  // tier.
  // Gendered-surname derivation is allowed ONLY where the last token of one name meets the last
  // token of the other — see surnameTokensMatch. Everywhere else it is fold-equality.
  function tokenContainment(tokensA, tokensB) {
    const a = containmentTokens(tokensA);
    const b = containmentTokens(tokensB);
    const shorter = a.length <= b.length ? a : b;
    const longer = a.length <= b.length ? b : a;
    if (shorter.length < MIN_CONTAINMENT_TOKENS) return false;
    return shorter.every((t, i) =>
      longer.some((lt, j) =>
        i === shorter.length - 1 && j === longer.length - 1 ? surnameTokensMatch(t, lt) : tokensEqual(t, lt)
      )
    );
  }

  // nameSimilarity(a, b) -> 0..1 (exact -> 1, whole-token containment -> 0.9, else Jaccard token
  // overlap). See tokenContainment/MIN_CONTAINMENT_TOKENS for what does and does not earn 0.9.
  function nameSimilarity(a, b) {
    const na = normaliseName(a);
    const nb = normaliseName(b);
    if (!na.text || !nb.text) return 0;
    if (na.text === nb.text) return 1;
    // Fold-equal is EXACT: "Anna Nováková" and "Anna Novakova" are one person whose accents one
    // system dropped, and this is the headline case the module's name handling exists for. (The
    // accent-STRICT rule in name-derivations.js is about *derivation* — inferring a family link
    // between two DIFFERENT strings from a single accented character, where folding "ý"/"á" to
    // "y"/"a" would misfire on Kennedy/Murphy. Folding two otherwise-identical strings together
    // carries no such risk.)
    if (foldForCompare(na.text) === foldForCompare(nb.text)) return 1;
    if (tokenContainment(na.tokens, nb.tokens)) return CONTAINMENT_SCORE;
    const setA = Array.from(new Set(na.tokens));
    const setB = Array.from(new Set(nb.tokens));
    const lastA = na.tokens[na.tokens.length - 1];
    const lastB = nb.tokens[nb.tokens.length - 1];
    let inter = 0;
    const usedB = new Set();
    for (const t of setA) {
      // findIndex, not setB.has(t): fold-equality and a surname-position gendered pairing both
      // need an actual comparison against each candidate token, not just a Set lookup — usedB
      // stops the same B token being consumed by two different A tokens.
      const matchIdx = setB.findIndex(
        (bt, i) => !usedB.has(i) && (t === lastA && bt === lastB ? surnameTokensMatch(t, bt) : tokensEqual(t, bt))
      );
      if (matchIdx !== -1) {
        inter++;
        usedB.add(matchIdx);
      }
    }
    const union = setA.length + setB.length - inter;
    return union > 0 ? inter / union : 0;
  }

  // nameSearchQueries(name) -> string[] — 1-3 name variants worth searching Medicus's own
  // patient-finder for, given a manual contact's raw free-text name. A 3+-word name (e.g. "John
  // Bates Smith") is genuinely ambiguous about where the surname starts: it could be firstName
  // "John" + a real middle name "Bates" + surname "Smith" (Medicus's own name fields wouldn't
  // contain "Bates" anywhere at all), OR firstName "John" + a compound/double-barrelled surname
  // "Bates Smith" with no middle-name concept in play at all. Live-tested finding: searching the
  // raw 3(+)-word string alone was missing real matches for both shapes. Returns the original name
  // as-is, PLUS, for a 3+-token name (after stripping a leading title, same recognised set as
  // normaliseName's NAME_STOPWORDS, so "Mr"/"Dr"/etc. never gets treated as part of the first/last
  // split): "first + last only" (drops the middle token(s) entirely) and "first + everything else
  // combined" (treats every token after the first as one compound surname) — deduped, so a simple
  // already-unambiguous 2-token name just returns itself once. Every result here still only ever
  // feeds a suggestion the GP confirms by drag — nothing auto-links — so casting a wider net has no
  // downside beyond a couple of extra search calls. Casing/punctuation are preserved from the
  // original name (unlike normaliseName's own lowercased/stripped tokens) — this feeds a search
  // query string, not a similarity comparison, so mangling a real name's spelling would only hurt.
  function nameSearchQueries(name) {
    const raw = String(name || '').trim();
    if (!raw) return [];
    const rawTokens = raw.split(/\s+/).filter(Boolean);
    const stripped = rawTokens.filter((t) => !NAME_STOPWORDS.has(t.toLowerCase()));
    const tokens = stripped.length ? stripped : rawTokens;
    const queries = new Set([raw]);
    if (tokens.length >= 3) {
      queries.add(`${tokens[0]} ${tokens[tokens.length - 1]}`);
      queries.add(`${tokens[0]} ${tokens.slice(1).join(' ')}`);
    }
    return Array.from(queries).filter(Boolean);
  }

  function fullName(name) {
    if (!name) return '';
    if (typeof name === 'string') return name;
    return [name.first, name.middle, name.last].filter(Boolean).join(' ');
  }

  // bestNameSignal(manualName, candidate) -> 0..1, max similarity against the candidate's current
  // displayName AND every recorded formerName (maiden names, pre-adoption names, etc.).
  function bestNameSignal(manualName, candidate) {
    const names = [candidate && candidate.displayName]
      .concat((candidate && candidate.formerNames) || [])
      .filter(Boolean);
    let best = 0;
    for (const n of names) {
      const s = nameSimilarity(manualName, n);
      if (s > best) best = s;
    }
    return best;
  }

  // ── Generation expectation (soft age-plausibility hint) ──────────────────────────────────────
  // 'older' / 'younger' / 'same' / null (no expectation — care/other tiers, or lateral in-laws).
  const GENERATION_EXPECTATION = {
    husband: 'same',
    wife: 'same',
    partner: 'same',
    'civil-partner': 'same',
    mother: 'older',
    father: 'older',
    son: 'younger',
    daughter: 'younger',
    brother: 'same',
    sister: 'same',
    grandmother: 'older',
    grandfather: 'older',
    grandson: 'younger',
    granddaughter: 'younger',
    aunt: 'older',
    uncle: 'older',
    niece: 'younger',
    nephew: 'younger',
    cousin: 'same',
    'mother-in-law': 'older',
    'father-in-law': 'older',
    'son-in-law': 'younger',
    'daughter-in-law': 'younger',
    'brother-in-law': 'same',
    'sister-in-law': 'same',
  };

  const SAME_GENERATION_TOLERANCE_YEARS = 20;
  const CROSS_GENERATION_MIN_GAP_YEARS = 10;

  // agePlausibility(baseId, candidateAge, indexPatientAge) -> 0..1 (never a hard filter — a
  // missing/unusable input or a relationship with no generation expectation returns 1, since
  // absence of evidence should not be treated as evidence of implausibility).
  function agePlausibility(baseId, candidateAge, indexPatientAge) {
    const expectation = GENERATION_EXPECTATION[baseId];
    if (!expectation) return 1;
    if (typeof candidateAge !== 'number' || typeof indexPatientAge !== 'number') return 1;
    const delta = candidateAge - indexPatientAge; // positive = candidate older
    if (expectation === 'same') {
      return Math.abs(delta) <= SAME_GENERATION_TOLERANCE_YEARS ? 1 : 0.5;
    }
    if (expectation === 'older') {
      if (delta >= CROSS_GENERATION_MIN_GAP_YEARS) return 1;
      if (delta >= 0) return 0.5;
      return 0;
    }
    if (expectation === 'younger') {
      if (delta <= -CROSS_GENERATION_MIN_GAP_YEARS) return 1;
      if (delta <= 0) return 0.5;
      return 0;
    }
    return 1;
  }

  // genderConsistency(baseId, candidateGenderIdentity) -> 0..1 (mismatch is a shrug at 0.5, NEVER
  // 0 — genderIdentity may legitimately differ from a relationship word's assumed sex; this is
  // deliberately not a filter).
  function genderConsistency(baseId, candidateGenderIdentity) {
    if (!ContactRelationships) return 1;
    const rel = ContactRelationships.getRelationship(baseId);
    if (!rel || rel.subjectGender === 'n') return 1;
    const bucket = ContactRelationships.genderBucket(candidateGenderIdentity);
    if (!bucket) return 1; // unknown — can't penalise what we can't check
    return bucket === rel.subjectGender ? 1 : 0.5;
  }

  function normalisePhone(p) {
    return String(p || '').replace(/[^0-9]/g, '');
  }

  function phoneOverlap(manualPhones, candidatePhones) {
    const a = Object.values(manualPhones || {})
      .map(normalisePhone)
      .filter(Boolean);
    const b = Object.values(candidatePhones || {})
      .map(normalisePhone)
      .filter(Boolean);
    if (!a.length || !b.length) return 0; // no data on either side — no signal either way
    return a.some((x) => b.includes(x)) ? 1 : 0;
  }

  function emailMatch(manualEmail, candidateEmail) {
    if (!manualEmail || !candidateEmail) return 0;
    return String(manualEmail).trim().toLowerCase() === String(candidateEmail).trim().toLowerCase() ? 1 : 0;
  }

  // patronymicFatherBonus(indexPatientName, candidate) -> 0 | PATRONYMIC_NAME_SIGNAL. In a patronymic naming system
  // (Nordic, East Slavic) a father shares NO surname with his own child at all — Björn's son is
  // "Björnsson", not "Björn" — so bestNameSignal above has nothing to go on for these families no
  // matter what the manual contact's free text says. This derives the implied father's first name
  // directly from the INDEX PATIENT's own name (their surname, or a Russian-style patronymic
  // middle name) and checks it against the CANDIDATE's own first name instead — independent of
  // the manual contact entirely. Only ever called when the relationship being guessed is
  // specifically 'father' (see scoreCandidate) — patronymics encode the father's name, never the
  // mother's, in both naming systems this covers.
  // ...and never the mother's, which is also why a candidate RECORDED as female is never given it:
  // the derivation's whole claim is "this person is the father named inside the child's own name".
  // A recorded gender that contradicts that isn't the soft shrug genderConsistency applies to a
  // free-text relationship word — it contradicts the derivation itself, so the derivation simply
  // has nothing to say and abstains. (An UNRECORDED gender still passes: absence of evidence is not
  // evidence of absence, and the cap below keeps what it can earn bounded either way.)
  //
  // The value it returns is capped at CONTAINMENT_SCORE — a derivation is an inference about a
  // naming system, and must never outrank the hard evidence of an actual whole-token name match.
  // At a flat 1.0 it sat ABOVE exact containment and reached "strong" (70) on its own, with the
  // three neutral-by-default signals (age 8 + gender 7) doing the rest and nothing corroborating it.
  const PATRONYMIC_NAME_SIGNAL = CONTAINMENT_SCORE;

  function patronymicFatherBonus(indexPatientName, candidate) {
    if (!NameDerivations || !indexPatientName || !candidate || !candidate.displayName) return 0;
    if (ContactRelationships && ContactRelationships.genderBucket(candidate.genderIdentity) === 'f') return 0;
    const patronymic = NameDerivations.extractPatronymicFather(indexPatientName);
    if (!patronymic) return 0;
    const candidateFirstToken = String(candidate.displayName).trim().split(/\s+/)[0];
    return NameDerivations.parentNameLikelyMatches(patronymic.fatherFirstName, candidateFirstToken)
      ? PATRONYMIC_NAME_SIGNAL
      : 0;
  }

  // ── Scoring ───────────────────────────────────────────────────────────────────────────────────

  const WEIGHTS = {
    name: 55,
    address: 20,
    age: 8,
    gender: 7,
    phone: 5,
    email: 5,
  };

  const STRONG_SCORE = 70;
  const POSSIBLE_SCORE = 40;

  // A patronymic-derived name signal is the only "name match" in the model that isn't actually a
  // comparison of the two names in front of us — it's an inference from the INDEX patient's name
  // about a naming system, against a candidate whose recorded name may share nothing with the
  // manual contact at all. On its own that must not be enough for a "strong" badge, whatever the
  // neutral defaults add up to: something else has to agree. Any of address / phone / email / a
  // real textual name similarity counts as corroboration; without one, the final score is held
  // just below the strong threshold, so the candidate is still surfaced and still ranked — at
  // "possible", which is what a single unconfirmed inference is worth.
  const PATRONYMIC_UNCORROBORATED_MAX_SCORE = STRONG_SCORE - 1;
  const PATRONYMIC_CORROBORATING_NAME_SIGNAL = 0.5;

  // scoreCandidate(manualContact, candidate, opts?) -> { score, tier, signals }
  //   manualContact: { name: {title?,first,middle?,last} | string, relationshipText?, phones?: {home?,mobile?,work?}, email? }
  //   candidate:     { patientId, displayName, formerNames?: string[], age?: number, genderIdentity?: string,
  //                    atSameAddress?: boolean, phones?: {home?,mobile?,work?}, email?: string }
  //   opts:          { manualRelationshipGuess?: { baseId, modifierId }, indexPatientAge?: number, indexPatientName?: string }
  function scoreCandidate(manualContact, candidate, opts = {}) {
    const manualName = fullName(manualContact && manualContact.name);
    const baseId = opts.manualRelationshipGuess && opts.manualRelationshipGuess.baseId;

    const textualNameSignal = bestNameSignal(manualName, candidate);
    let nameSignal = textualNameSignal;
    let patronymicDerived = false;
    if (baseId === 'father') {
      const bonus = patronymicFatherBonus(opts.indexPatientName, candidate);
      if (bonus > nameSignal) {
        nameSignal = bonus;
        patronymicDerived = true;
      }
    }
    const addressSignal = candidate && candidate.atSameAddress ? 1 : 0;
    const ageSignal = baseId ? agePlausibility(baseId, candidate && candidate.age, opts.indexPatientAge) : 1;
    const genderSignal = baseId ? genderConsistency(baseId, candidate && candidate.genderIdentity) : 1;
    const phoneSignal = phoneOverlap(manualContact && manualContact.phones, candidate && candidate.phones);
    const emailSignal = emailMatch(manualContact && manualContact.email, candidate && candidate.email);

    const corroborated =
      addressSignal === 1 ||
      phoneSignal === 1 ||
      emailSignal === 1 ||
      textualNameSignal >= PATRONYMIC_CORROBORATING_NAME_SIGNAL;

    // The name entry gains two ADDITIVE fields when (and only when) its value came from the
    // patronymic derivation rather than from comparing the two names — so a UI can caveat it
    // ("derived from the patient's own name, nothing else agrees") instead of presenting it as an
    // ordinary name match. Existing consumers read id/weight/value and are untouched; the fields
    // are simply absent on every other signal and on an ordinary name match.
    const nameEntry = { id: 'name', weight: WEIGHTS.name, value: nameSignal };
    if (patronymicDerived) {
      nameEntry.derivation = 'patronymic';
      nameEntry.corroborated = corroborated;
    }

    const signals = [
      nameEntry,
      { id: 'address', weight: WEIGHTS.address, value: addressSignal },
      { id: 'age', weight: WEIGHTS.age, value: ageSignal },
      { id: 'gender', weight: WEIGHTS.gender, value: genderSignal },
      { id: 'phone', weight: WEIGHTS.phone, value: phoneSignal },
      { id: 'email', weight: WEIGHTS.email, value: emailSignal },
    ];

    let score = Math.round(signals.reduce((sum, s) => sum + s.weight * s.value, 0));
    if (patronymicDerived && !corroborated) {
      score = Math.min(score, PATRONYMIC_UNCORROBORATED_MAX_SCORE);
    }
    const tier = score >= STRONG_SCORE ? 'strong' : score >= POSSIBLE_SCORE ? 'possible' : 'weak';

    return { score, tier, signals };
  }

  // Two candidates whose scores differ by no more than this are treated as indistinguishable. 5 is
  // the weight of the single weakest signal in the model (phone, email) — a gap that small means
  // the ranking was decided by exactly one of the two signals the GP explicitly said must never be
  // decisive, so the order between them carries no real information.
  const TIE_MARGIN = 5;

  // rankCandidates(manualContact, candidates, opts?) -> [{ candidate, score, tier, signals }, ...] desc by score
  // The top result additionally carries:
  //   margin — top score minus the runner-up's (0 on an exact tie), or null when there IS no
  //            runner-up. Callers must treat null as "not measurable", not as a small gap.
  //   tied   — true when the runner-up is within TIE_MARGIN. This is the authoritative ambiguity
  //            flag; prefer it over comparing `margin` yourself.
  // Both are purely additive: every existing key on every result (candidate/score/tier/signals) and
  // the sort order are unchanged, and only the top result gains the two fields.
  function rankCandidates(manualContact, candidates, opts) {
    const ranked = (candidates || [])
      .map((candidate) => Object.assign({ candidate }, scoreCandidate(manualContact, candidate, opts)))
      .sort((a, b) => b.score - a.score);
    if (ranked.length) {
      const margin = ranked.length > 1 ? ranked[0].score - ranked[1].score : null;
      ranked[0].margin = margin;
      ranked[0].tied = margin !== null && margin <= TIE_MARGIN;
    }
    return ranked;
  }

  const api = {
    nameSimilarity,
    nameSearchQueries,
    bestNameSignal,
    scoreCandidate,
    rankCandidates,
    WEIGHTS,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else if (global) {
    global.ContactMatch = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
