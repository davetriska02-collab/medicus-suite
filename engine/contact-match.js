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

  // ── Name similarity — token-Jaccard, same technique as shared/knowledge-utils.js's findSimilar ──

  const NAME_STOPWORDS = new Set(['mr', 'mrs', 'miss', 'ms', 'mx', 'dr', 'prof']);

  function normaliseName(s) {
    const text = String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    let tokens = text.split(' ').filter((t) => t && !NAME_STOPWORDS.has(t));
    if (tokens.length === 0) tokens = text.split(' ').filter(Boolean);
    return { text: tokens.join(' '), tokens };
  }

  // nameSimilarity(a, b) -> 0..1 (exact -> 1, containment -> 0.9, else Jaccard token overlap)
  function nameSimilarity(a, b) {
    const na = normaliseName(a);
    const nb = normaliseName(b);
    if (!na.text || !nb.text) return 0;
    if (na.text === nb.text) return 1;
    if (na.text.includes(nb.text) || nb.text.includes(na.text)) return 0.9;
    const setA = new Set(na.tokens);
    const setB = new Set(nb.tokens);
    let inter = 0;
    for (const t of setA) if (setB.has(t)) inter++;
    const union = setA.size + setB.size - inter;
    return union > 0 ? inter / union : 0;
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

  // ── Scoring ───────────────────────────────────────────────────────────────────────────────────

  const WEIGHTS = {
    name: 55,
    address: 20,
    age: 8,
    gender: 7,
    phone: 5,
    email: 5,
  };

  // scoreCandidate(manualContact, candidate, opts?) -> { score, tier, signals }
  //   manualContact: { name: {title?,first,middle?,last} | string, relationshipText?, phones?: {home?,mobile?,work?}, email? }
  //   candidate:     { patientId, displayName, formerNames?: string[], age?: number, genderIdentity?: string,
  //                    atSameAddress?: boolean, phones?: {home?,mobile?,work?}, email?: string }
  //   opts:          { manualRelationshipGuess?: { baseId, modifierId }, indexPatientAge?: number }
  function scoreCandidate(manualContact, candidate, opts = {}) {
    const manualName = fullName(manualContact && manualContact.name);
    const baseId = opts.manualRelationshipGuess && opts.manualRelationshipGuess.baseId;

    const nameSignal = bestNameSignal(manualName, candidate);
    const addressSignal = candidate && candidate.atSameAddress ? 1 : 0;
    const ageSignal = baseId ? agePlausibility(baseId, candidate && candidate.age, opts.indexPatientAge) : 1;
    const genderSignal = baseId ? genderConsistency(baseId, candidate && candidate.genderIdentity) : 1;
    const phoneSignal = phoneOverlap(manualContact && manualContact.phones, candidate && candidate.phones);
    const emailSignal = emailMatch(manualContact && manualContact.email, candidate && candidate.email);

    const signals = [
      { id: 'name', weight: WEIGHTS.name, value: nameSignal },
      { id: 'address', weight: WEIGHTS.address, value: addressSignal },
      { id: 'age', weight: WEIGHTS.age, value: ageSignal },
      { id: 'gender', weight: WEIGHTS.gender, value: genderSignal },
      { id: 'phone', weight: WEIGHTS.phone, value: phoneSignal },
      { id: 'email', weight: WEIGHTS.email, value: emailSignal },
    ];

    const score = Math.round(signals.reduce((sum, s) => sum + s.weight * s.value, 0));
    const tier = score >= 70 ? 'strong' : score >= 40 ? 'possible' : 'weak';

    return { score, tier, signals };
  }

  // rankCandidates(manualContact, candidates, opts?) -> [{ candidate, score, tier, signals }, ...] desc by score
  function rankCandidates(manualContact, candidates, opts) {
    return (candidates || [])
      .map((candidate) => Object.assign({ candidate }, scoreCandidate(manualContact, candidate, opts)))
      .sort((a, b) => b.score - a.score);
  }

  const api = {
    nameSimilarity,
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
