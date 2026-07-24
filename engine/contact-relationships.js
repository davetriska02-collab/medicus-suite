// engine/contact-relationships.js — Canonical relationship vocabulary, inversion, free-text matching
// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
//
// Pure engine for the Contacts linking tool (docs: see the Contacts Management build plan).
// Replaces Medicus's free-text `patientContactRelationship` field with a fixed, 32-entry
// canonical vocabulary (rules/contact-relationships.json) built from base relationships plus
// three orthogonal modifiers (Ex-, Step-, Half-), each valid only on specific tiers.
//
// SCOPE NOTE: this is the PURE data/inversion/free-text-matching core only. No content-script
// wiring, no DOM, no fetch — see engine/contact-match.js (candidate scoring) and
// engine/contact-tree.js (in-memory family-tree structure) for the other two pure modules that
// sit alongside this one.
//
// rules/contact-relationships.json is READ-ONLY from this module's point of view.
//
// Dual-mode export: Node `require` AND browser global (`window.ContactRelationships`), same
// pattern as engine/reception-match.js.
//
// ── GENDER-INVERSION NOTE ──────────────────────────────────────────────────────────────────────
// `reciprocal` in the JSON is one of: a plain string (unambiguous — "partner"→"partner"), an
// { m, f } object keyed by the INDEX PATIENT's gender bucket (not the candidate's — the forward
// label already encodes the candidate's implied role), or null (the Care tier — no relationship
// has a natural reciprocal, so no reverse link is ever auto-suggested for those). When the index
// patient's gender bucket can't be resolved to 'm'/'f', invertRelationship() returns
// `ambiguous: true` rather than guessing — the caller MUST surface the computed reverse label as
// an editable, reviewable line before firing any write. This is a deliberate extension of the
// product's "no smart-defaulting, explicit decision every time" rule to gender-ambiguous
// inversion, not an oversight.
// ───────────────────────────────────────────────────────────────────────────────────────────────

(function (global) {
  'use strict';

  // ── Load rules/contact-relationships.json — read-only ────────────────────────────────────────
  // Node: require() resolves the real JSON synchronously at load time. Browser: require() doesn't
  // exist in a content-script context, so this falls through to an empty-arrays placeholder here
  // — the REAL data arrives later via an async fetch (content-scripts/contacts-api.js fetches
  // rules/contact-relationships.json via chrome.runtime.getURL and sets
  // global.ContactRelationshipsData once it resolves). dataOf() below re-checks that global on
  // EVERY call rather than caching it once, so the browser path picks up the real data as soon as
  // it lands, without this module needing to know when that happens.
  function loadDefaultData() {
    if (typeof require === 'function') {
      try {
        // eslint-disable-next-line global-require
        return require('../rules/contact-relationships.json');
      } catch (e) {
        /* not resolvable under this module system/path — fall through to browser hook */
      }
    }
    return { tiers: [], modifiers: [], relationships: [] };
  }

  const DEFAULT_DATA = loadDefaultData();

  function dataOf(data) {
    if (data && Array.isArray(data.relationships)) return data;
    if (
      typeof global !== 'undefined' &&
      global.ContactRelationshipsData &&
      Array.isArray(global.ContactRelationshipsData.relationships)
    ) {
      return global.ContactRelationshipsData;
    }
    return DEFAULT_DATA;
  }

  // ── Basic lookups ─────────────────────────────────────────────────────────────────────────────

  function getRelationship(id, data) {
    const d = dataOf(data);
    if (!id) return null;
    return d.relationships.find((r) => r.id === id) || null;
  }

  function getModifiers(data) {
    return dataOf(data).modifiers || [];
  }

  function validModifiersForBase(baseId, data) {
    const rel = getRelationship(baseId, data);
    if (!rel) return [];
    return getModifiers(data)
      .filter((m) => Array.isArray(m.appliesToTiers) && m.appliesToTiers.includes(rel.tier))
      .map((m) => m.id);
  }

  function getModifierLabel(modifierId, data) {
    const m = getModifiers(data).find((mm) => mm.id === modifierId);
    return m ? m.label : '';
  }

  // formatLabel(baseId, modifierId) -> "Step-mother", "Ex-husband", "Brother" (no modifier)
  function formatLabel(baseId, modifierId, data) {
    const rel = getRelationship(baseId, data);
    if (!rel) return '';
    if (!modifierId) return rel.label;
    const validIds = validModifiersForBase(baseId, data);
    if (!validIds.includes(modifierId)) return rel.label; // invalid modifier for this base — ignore rather than error
    const modLabel = getModifierLabel(modifierId, data); // e.g. "Step-", "Ex-", "Half-"
    return `${modLabel}${rel.label.charAt(0).toLowerCase()}${rel.label.slice(1)}`;
  }

  // ── Gender bucket resolution ──────────────────────────────────────────────────────────────────
  // Medicus's own genderIdentity strings observed: "Female", "Male" (title case). Maps anything
  // else (null, "Non-binary", unrecognised) to null — never guessed.
  function genderBucket(genderIdentity) {
    const g = String(genderIdentity || '')
      .trim()
      .toLowerCase();
    if (g === 'female' || g === 'f') return 'f';
    if (g === 'male' || g === 'm') return 'm';
    return null;
  }

  // ── Inversion ─────────────────────────────────────────────────────────────────────────────────
  // invertRelationship({ baseId, modifierId, indexGender }) -> { baseId, modifierId, ambiguous }
  // `indexGender` is the INDEX patient's own genderIdentity string (or a pre-resolved 'm'/'f'/null
  // bucket — genderBucket() is idempotent on already-bucketed input since 'm'/'f' pass through).
  function invertRelationship({ baseId, modifierId, indexGender } = {}, data) {
    const rel = getRelationship(baseId, data);
    if (!rel || rel.reciprocal == null) {
      return { baseId: null, modifierId: null, ambiguous: true };
    }
    let reverseBaseId;
    if (typeof rel.reciprocal === 'string') {
      reverseBaseId = rel.reciprocal;
    } else {
      const bucket = genderBucket(indexGender);
      if (!bucket || !rel.reciprocal[bucket]) {
        return { baseId: null, modifierId: null, ambiguous: true };
      }
      reverseBaseId = rel.reciprocal[bucket];
    }
    // Modifiers carry across the inversion unchanged (Step-mother -> Step-son/Step-daughter).
    return { baseId: reverseBaseId, modifierId: modifierId || null, ambiguous: false };
  }

  // ── Free-text normalisation (colours column-1 manual-contact cards) ──────────────────────────
  // ALIAS_TERMS — CSO review NOT required (relationship semantics, not clinical content) but
  // still coverage-tested: every relationship id except 'other' must have a non-empty entry
  // (test-contact-relationships.js), and every alias key must correspond to a real shipped id.
  // A missing alias means a manual contact's free text simply doesn't get coloured/categorised —
  // the failure mode is "falls back to 'needs review'", never a wrong category.
  const ALIAS_TERMS = {
    husband: ['husband', 'hubby'],
    wife: ['wife'],
    partner: ['partner', 'other half', 'boyfriend', 'girlfriend', 'oh', 'significant other'],
    'civil-partner': ['civil partner', 'civil partnership'],

    mother: ['mother', 'mum', 'mom', 'mam', 'ma'],
    father: ['father', 'dad', 'pa', 'papa'],
    son: ['son'],
    daughter: ['daughter'],

    brother: ['brother', 'bro'],
    sister: ['sister', 'sis'],

    grandmother: ['grandmother', 'grandma', 'granny', 'nan', 'nanny', 'nana'],
    grandfather: ['grandfather', 'grandad', 'granddad', 'grandpa', 'pop', 'pops'],
    grandson: ['grandson'],
    granddaughter: ['granddaughter'],

    aunt: ['aunt', 'auntie', 'aunty'],
    uncle: ['uncle'],
    niece: ['niece'],
    nephew: ['nephew'],
    cousin: ['cousin'],

    'mother-in-law': ['mother in law', 'mother-in-law'],
    'father-in-law': ['father in law', 'father-in-law'],
    'son-in-law': ['son in law', 'son-in-law'],
    'daughter-in-law': ['daughter in law', 'daughter-in-law'],
    'brother-in-law': ['brother in law', 'brother-in-law'],
    'sister-in-law': ['sister in law', 'sister-in-law'],

    'legal-guardian': ['legal guardian', 'guardian'],
    'foster-carer': ['foster carer', 'foster parent', 'foster mother', 'foster father'],
    carer: ['carer', 'caregiver', 'care giver'],
    'care-home-staff': ['care home', 'care home staff', 'nursing home', 'nursing home staff'],

    friend: ['friend'],
    neighbour: ['neighbour', 'neighbor'],
  };

  const MODIFIER_WORD_RE = {
    step: /\bstep[- ]?/i,
    half: /\bhalf[- ]?/i,
    ex: /\bex[- ]?/i,
  };

  function normaliseText(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .replace(/[’']/g, '')
      .replace(/[^a-z0-9\s-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function containsTerm(normalisedText, term) {
    if (!term) return false;
    const re = new RegExp('\\b' + escapeRegExp(normaliseText(term)) + '\\b', 'i');
    return re.test(normalisedText);
  }

  // normaliseFreeText(text) -> { baseId, modifierId, confidence } | null
  // confidence: 1 = exact canonical label match, 0.85 = alias match, null result = no match at all
  // (caller should route unmatched text to the "needs review" holding area, never guess a slot).
  function normaliseFreeText(text, data) {
    const d = dataOf(data);
    const raw = normaliseText(text);
    if (!raw) return null;

    // Strip a leading modifier word/prefix, if present, and remember which one.
    let modifierId = null;
    let remainder = raw;
    for (const [modId, re] of Object.entries(MODIFIER_WORD_RE)) {
      const validTiers = getModifiers(d).find((m) => m.id === modId);
      if (!validTiers) continue;
      if (re.test(remainder)) {
        modifierId = modId;
        remainder = remainder.replace(re, '').trim();
        break; // only one modifier can apply — Step/Half are mutually exclusive by tier design
      }
    }

    // Exact canonical label match first (highest confidence).
    for (const rel of d.relationships) {
      if (normaliseText(rel.label) === remainder) {
        const validModIds = validModifiersForBase(rel.id, d);
        return {
          baseId: rel.id,
          modifierId: modifierId && validModIds.includes(modifierId) ? modifierId : null,
          confidence: 1,
        };
      }
    }

    // Alias match.
    for (const rel of d.relationships) {
      const aliases = ALIAS_TERMS[rel.id];
      if (!aliases) continue;
      if (aliases.some((a) => containsTerm(remainder, a) || normaliseText(a) === remainder)) {
        const validModIds = validModifiersForBase(rel.id, d);
        return {
          baseId: rel.id,
          modifierId: modifierId && validModIds.includes(modifierId) ? modifierId : null,
          confidence: 0.85,
        };
      }
    }

    return null;
  }

  // ── Contact-info extraction (shared between the wizard widget and the canvas) ────────────────
  // Pure extractors over a patient-details response's OWN registered phone/email (not a manual
  // contact's — the patient's own patientContactInformationSection) — used to show comparison
  // evidence (e.g. "does this manual entry's phone match the patient's own registered number")
  // in both the merge panel and the reverse-manual-match removal prompt.

  function extractPreferredEmail(patientDetails) {
    const emails =
      (patientDetails &&
        patientDetails.patientContactInformationSection &&
        patientDetails.patientContactInformationSection.patientEmailAddresses) ||
      [];
    if (!emails.length) return null;
    const preferred = emails.find((e) => e.preferredEmailAddress);
    return (preferred || emails[0]).emailAddress || null;
  }

  function extractPreferredPhone(patientDetails) {
    const phones =
      (patientDetails &&
        patientDetails.patientContactInformationSection &&
        patientDetails.patientContactInformationSection.patientTelephoneNumbers) ||
      [];
    if (!phones.length) return null;
    const preferred = phones.find((p) => p.preferredTelephoneNumberForSms);
    return (preferred || phones[0]).telephoneNumber || null;
  }

  // ── Existing-link detection (shared between the wizard widget and the canvas) ────────────────
  // Pure functions over a patient-details response — safety-critical duplicate-prevention logic
  // that must not drift between the two UI surfaces that both create real Medicus links, so it
  // lives here (unit-tested) rather than being duplicated in each content script.

  // findExistingReciprocal(indexPatientDetails, candidatePatientId) -> the "Listed as Contact For"
  // entry (if any) proving the candidate ALREADY lists the index patient as one of their own
  // contacts. Checking this before offering a reverse link matters because POST link-patient has
  // no idempotency guard of its own — firing it again creates a genuine duplicate relationship on
  // the candidate's record, not an update.
  function findExistingReciprocal(indexPatientDetails, candidatePatientId) {
    const list =
      (indexPatientDetails &&
        indexPatientDetails.patientLinkedContactsSection &&
        indexPatientDetails.patientLinkedContactsSection.patientContacts) ||
      [];
    return list.find((c) => c.linkedPatientId === candidatePatientId) || null;
  }

  // findExistingForwardLink(indexPatientDetails, candidatePatientId) -> an entry from the index
  // patient's OWN patientContactsSection that's already a REAL link to this candidate
  // (patientContactPatientId set, not a manual entry). Confirmed live: POST link-patient rejects a
  // duplicate with a 400 ("Patient Contact already exists.") rather than silently no-op'ing —
  // checking this first lets a caller skip the redundant write instead of erroring out.
  function findExistingForwardLink(indexPatientDetails, candidatePatientId) {
    const list =
      (indexPatientDetails &&
        indexPatientDetails.patientContactsSection &&
        indexPatientDetails.patientContactsSection.patientContacts) ||
      [];
    return list.find((c) => c.patientContactPatientId === candidatePatientId) || null;
  }

  // suggestForwardFromReciprocal(reciprocalEntry, candidateGenderIdentity) -> { baseId, modifierId } | null
  // When the candidate already lists the index patient as their own contact (e.g. "Mother"), that's
  // a stronger signal for what the FORWARD relationship should default to than any manual entry's
  // own free text — invert the already-established relationship using the CANDIDATE's own gender
  // (they're the one whose son/daughter-type label depends on it, since the relationship was
  // recorded from their side).
  function suggestForwardFromReciprocal(reciprocalEntry, candidateGenderIdentity, data) {
    if (!reciprocalEntry) return null;
    const guess = normaliseFreeText(reciprocalEntry.patientContactRelationship, data);
    if (!guess) return null;
    const inv = invertRelationship(
      { baseId: guess.baseId, modifierId: guess.modifierId, indexGender: candidateGenderIdentity },
      data
    );
    return inv.ambiguous ? null : { baseId: inv.baseId, modifierId: inv.modifierId };
  }

  // ── Medicus API payload builders ──────────────────────────────────────────────────────────────

  // buildLinkPatientBody(...) -> exact POST /patient/patient-contact/link-patient body shape
  function buildLinkPatientBody(
    { patientId, linkPatientId, baseId, modifierId, isNextOfKin, copyCorrespondence, notes } = {},
    data
  ) {
    return {
      patientId,
      linkPatientId,
      patientContactRelationship: formatLabel(baseId, modifierId, data),
      patientContactIsNextOfKin: !!isNextOfKin,
      patientContactCopyCorrespondence: !!copyCorrespondence,
      patientContactNotes: notes || null,
    };
  }

  // buildManualContactBody(...) -> exact POST /patient/patient-contact/create-patient-contact body shape
  function buildManualContactBody(
    {
      patientId,
      name = {},
      baseId,
      modifierId,
      phones = {},
      email,
      address = {},
      isNextOfKin,
      copyCorrespondence,
      notes,
    } = {},
    data
  ) {
    return {
      patientId,
      patientContactTitle: name.title || null,
      patientContactFirstName: name.first || '',
      patientContactMiddleNames: name.middle || null,
      patientContactLastName: name.last || '',
      patientContactRelationship: formatLabel(baseId, modifierId, data),
      patientContactHomePhoneNumber: phones.home || null,
      patientContactMobileNumber: phones.mobile || null,
      patientContactWorkPhoneNumber: phones.work || null,
      patientContactEmailAddress: email || null,
      patientContactAddress: {
        line1: address.line1 || '',
        line2: address.line2 || '',
        line3: address.line3 || '',
        locality: address.locality || '',
        administrativeArea: address.administrativeArea || '',
        postalCode: address.postalCode || '',
        country: address.country || 'GBR',
      },
      patientContactIsNextOfKin: !!isNextOfKin,
      patientContactNotes: notes || null,
      patientContactCopyCorrespondence: !!copyCorrespondence,
    };
  }

  const api = {
    getRelationship,
    getModifiers,
    validModifiersForBase,
    formatLabel,
    genderBucket,
    invertRelationship,
    normaliseFreeText,
    ALIAS_TERMS,
    findExistingReciprocal,
    findExistingForwardLink,
    suggestForwardFromReciprocal,
    extractPreferredEmail,
    extractPreferredPhone,
    buildLinkPatientBody,
    buildManualContactBody,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else if (global) {
    global.ContactRelationships = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
