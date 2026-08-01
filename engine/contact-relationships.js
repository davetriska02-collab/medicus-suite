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

  // ── Composition via a shared hub ─────────────────────────────────────────────────────────────
  // composeViaHub(xEdge, bEdge, xGenderIdentity) -> { baseId, modifierId: null } | null
  // Given X's relationship to a shared hub patient H (xEdge, e.g. baseId "mother" — X is H's
  // mother) and a SECOND person B's relationship to that SAME hub H (bEdge, e.g. baseId "daughter"
  // — B is H's daughter), compose X's relationship to B (e.g. "grandmother" — X is B's
  // grandmother). Used by the Contacts canvas's family-cycling composition step: when cycling
  // lands on B's own canvas, B's hub A's OTHER already-confirmed relatives can be pre-filled with a
  // relationship computed relative to B, not just copied from A's own labels for them.
  //
  // Deliberately narrow: only the two cases that are structurally UNCONDITIONAL given unmodified
  // parent/child/partner hops — no modifier ambiguity, no risk of the hop already independently
  // meaning something else. Returns null for everything outside that set, INCLUDING:
  //   - either hop carrying a Step-/Half-/Ex- modifier at all (checked here, not left to the
  //     caller — composing through an already-uncertain relationship compounds the uncertainty
  //     rather than resolving it)
  //   - sibling via one shared parent (can't tell full- vs half- from a single hop — this
  //     vocabulary's Half- modifier makes that a real distinction, not cosmetic)
  //   - step-parent/step-child via a partner hop (the partner could already independently BE that
  //     child's own biological/legal parent — an ordinary intact family — with nothing in the edges
  //     to rule that out)
  // See the parked composition memory (project_contacts_relationship_composition_future_phase, this
  // repo's Claude Code memory store) for the full reasoning and what's scoped for later — sibling
  // and step-parent composition are meant to follow, surfaced with an explicit full/half or
  // step/bio prompt rather than a silent guess, once this narrower set is live and proven.
  //
  // xGenderIdentity is a soft hint (same status as everywhere else in this file — never a hard
  // filter) only needed for the partner-hop-through-X case, where the composed word depends on X's
  // own gender rather than being determined by xEdge.baseId itself (husband/wife resolve on their
  // own; partner/civil-partner don't carry gender in the word).
  const HUB_PARENT_BASE_IDS = ['mother', 'father'];
  const HUB_CHILD_BASE_IDS = ['son', 'daughter'];
  const HUB_PARTNER_BASE_IDS = ['husband', 'wife', 'partner', 'civil-partner'];

  function composeViaHub(xEdge, bEdge, xGenderIdentity) {
    if (!xEdge || !bEdge || xEdge.modifierId || bEdge.modifierId) return null;
    const xToHub = xEdge.baseId;
    const bToHub = bEdge.baseId;

    // X is H's parent, B is H's child -> X is B's grandparent.
    if (HUB_PARENT_BASE_IDS.includes(xToHub) && HUB_CHILD_BASE_IDS.includes(bToHub)) {
      return { baseId: xToHub === 'mother' ? 'grandmother' : 'grandfather', modifierId: null };
    }
    // X is H's child, B is H's parent -> X is B's grandchild.
    if (HUB_CHILD_BASE_IDS.includes(xToHub) && HUB_PARENT_BASE_IDS.includes(bToHub)) {
      return { baseId: xToHub === 'son' ? 'grandson' : 'granddaughter', modifierId: null };
    }
    // X is H's parent, B is H's (unmodified) partner -> X is B's parent-in-law. Note: when bToHub
    // is the gender-neutral 'partner'/'civil-partner' (not 'husband'/'wife'), "-in-law" is being
    // used colloquially here, not in its strict UK-legal sense (an in-law relationship in law
    // requires marriage/civil partnership) — deliberately accepted rather than inventing a
    // "partner-in-law" id that doesn't exist anywhere in rules/contact-relationships.json's
    // vocabulary; the canvas confirm panel always shows this as an editable, human-reviewed
    // suggestion, never a silent write, so the imprecision is caught there if it matters to the GP.
    if (HUB_PARENT_BASE_IDS.includes(xToHub) && HUB_PARTNER_BASE_IDS.includes(bToHub)) {
      return { baseId: xToHub === 'mother' ? 'mother-in-law' : 'father-in-law', modifierId: null };
    }
    // X is H's (unmodified) partner, B is H's parent -> X is B's child-in-law (same colloquial-vs-
    // legal caveat as above for the gender-neutral partner/civil-partner case). husband/wife resolve
    // on their own; partner/civil-partner need the gender hint, and fall through to null (never
    // guessed) when it's unavailable or unrecognised.
    if (HUB_PARTNER_BASE_IDS.includes(xToHub) && HUB_PARENT_BASE_IDS.includes(bToHub)) {
      if (xToHub === 'husband') return { baseId: 'son-in-law', modifierId: null };
      if (xToHub === 'wife') return { baseId: 'daughter-in-law', modifierId: null };
      const bucket = genderBucket(xGenderIdentity);
      if (bucket === 'm') return { baseId: 'son-in-law', modifierId: null };
      if (bucket === 'f') return { baseId: 'daughter-in-law', modifierId: null };
      return null;
    }
    return null;
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

  // isDeceasedRelationshipText(text) -> boolean
  // Display-only signal, deliberately NOT part of normaliseFreeText's baseId/modifierId parsing —
  // "deceased" isn't a variant of a relationship the way Step-/Half-/Ex- are (it applies equally
  // to any relationship, so treating it as a same-kind modifier would be a category error), and
  // Medicus's own canonical vocabulary has no such concept to write back to. It's also NOT sourced
  // from Medicus's own `isDeceased` flag on the candidate's record (confirmed via HAR 2026-07-27:
  // a deceased patient is deducted the same way any inactive-after-grace-period patient is, so
  // `patient-details` 403s before that flag is ever reachable) — free text is the only reliable
  // signal available here. Matches the GP's own stated convention ("(RIP)") plus common variants,
  // word-bounded so it can't fire on an unrelated word that happens to contain the letters.
  const DECEASED_TEXT_RE = /\b(rip|deceased|dec'd|passed away)\b/i;
  function isDeceasedRelationshipText(text) {
    return DECEASED_TEXT_RE.test(String(text || ''));
  }

  // isUkMobileNumber(phoneNumber) -> boolean — a UK mobile number by format, regardless of how
  // it's punctuated/spaced or whether it's written with a leading 0 or the +44/44/0044 country
  // code. UK-specific: Ofcom's own numbering plan reserves the 07 range exclusively for mobile
  // (and pager) numbers, so a number matching this shape is never legitimately a landline —
  // unlike isDeceasedRelationshipText, this isn't inferring from free text a human wrote, it's a
  // structural fact about the number itself. Used to flag a number stored under the WRONG type
  // (e.g. a mobile-shaped number filed as "Home") — confirmed live as a real, recurring data-entry
  // pattern in GP2GP-imported records, same family of issue as the phone-note mismatch
  // extractPreferredPhoneNote already surfaces.
  function isUkMobileNumber(phoneNumber) {
    let digits = String(phoneNumber || '').replace(/[^0-9]/g, '');
    if (!digits) return false;
    if (digits.startsWith('00')) digits = digits.slice(2); // 00 international prefix
    if (digits.startsWith('44')) digits = '0' + digits.slice(2); // +44/44 country code -> leading 0
    return /^07\d{9}$/.test(digits);
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

  function findPreferredPhoneEntry(patientDetails) {
    const phones =
      (patientDetails &&
        patientDetails.patientContactInformationSection &&
        patientDetails.patientContactInformationSection.patientTelephoneNumbers) ||
      [];
    if (!phones.length) return null;
    return phones.find((p) => p.preferredTelephoneNumberForSms) || phones[0];
  }

  function extractPreferredPhone(patientDetails) {
    const entry = findPreferredPhoneEntry(patientDetails);
    return (entry && entry.telephoneNumber) || null;
  }

  // extractPreferredPhoneNote(patientDetails) -> string | null
  // Confirmed live (HAR capture, 2026-07-25): patient-details' own patientTelephoneNumbers[]
  // entries carry a free-text `notes` field (the same one editable via Medicus's own "Add/Edit
  // Phone Number" form) — e.g. "practice phone number", or in the GP2GP-import cases this was
  // built to catch, "mum's mobile" on what would otherwise look like the patient's own number.
  // Surfaced as a prominent warning wherever a candidate's phone is shown before merging/linking,
  // since a note here is exactly the kind of signal that a number doesn't really belong to the
  // patient it's recorded against. No equivalent field exists on email addresses in this API.
  function extractPreferredPhoneNote(patientDetails) {
    const entry = findPreferredPhoneEntry(patientDetails);
    return (entry && entry.notes) || null;
  }

  // extractPreferredPhoneId(patientDetails) -> string | null
  // The SAME preferred entry as extractPreferredPhone/extractPreferredPhoneNote (never a
  // different one — a caller that shows the note as a warning and then offers to edit it must be
  // editing the number the warning is actually about). Used by the canvas to know which
  // telephoneNumberId to send to ContactsApi.getEditTelephoneNumber/changeTelephoneNumber.
  function extractPreferredPhoneId(patientDetails) {
    const entry = findPreferredPhoneEntry(patientDetails);
    return (entry && entry.telephoneNumberId) || null;
  }

  // ── Duplicate-address detection (hub patient only) ───────────────────────────────────────────
  // A known PDS (Patient Demographic Service) data-quality pattern: the same real-world address
  // gets recorded on a patient's own record more than once, formatted slightly differently each
  // time — an exact re-send, one copy gaining an extra locality-ish token the other lacks (e.g.
  // "London" present on one but not the other), or the same text simply split across a different
  // number of address lines (one system's "Flat 1, 26 High Street" as a single line vs another's
  // "Flat 1" / "26 High Street" as two separate lines). DETECTION ONLY — no write/merge action is
  // built on this yet, pending a HAR capture of Medicus's own address-edit/delete endpoint (this
  // codebase never codes a write endpoint from a guess, see e.g. extractPreferredPhoneId's own
  // history — HAR-before-writes is a hard rule here, not just a preference).

  const ADDRESS_LINE_FIELDS = ['line1', 'line2', 'line3', 'locality', 'administrativeArea'];

  function normaliseAddressText(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalisePostcode(s) {
    return String(s || '')
      .toUpperCase()
      .replace(/\s+/g, '');
  }

  // addressTokens(address) — flattens every address-LINE-ish field (line1/2/3, locality,
  // administrativeArea — postalCode and country are handled separately, see
  // isLikelyDuplicateAddress) into a bag of words, SPLIT into numeric and alphabetic tokens.
  // Flattening is what makes a field-boundary difference stop mattering: "Flat 1, 26 High Street"
  // as a single line1, vs "Flat 1" / "26 High Street" as two separate lines, produce the IDENTICAL
  // token sets either way. The numeric/alphabetic split matters for a different reason — see
  // isLikelyDuplicateAddress's own comment on why a differing NUMBER can never be treated the same
  // as a differing WORD.
  function addressTokens(address) {
    const text = ADDRESS_LINE_FIELDS.map((f) => (address && address[f]) || '').join(' ');
    const all = normaliseAddressText(text).split(' ').filter(Boolean);
    return {
      numbers: new Set(all.filter((t) => /^\d+$/.test(t))),
      words: new Set(all.filter((t) => !/^\d+$/.test(t))),
    };
  }

  function setsEqual(a, b) {
    if (a.size !== b.size) return false;
    for (const x of a) if (!b.has(x)) return false;
    return true;
  }

  function tokenOverlap(setA, setB) {
    if (!setA.size || !setB.size) return 0;
    let inter = 0;
    for (const t of setA) if (setB.has(t)) inter++;
    const union = setA.size + setB.size - inter;
    return union > 0 ? inter / union : 0;
  }

  // How much of the WORD-token overlap (Jaccard) two addresses need, once their postcodes already
  // agree and their numeric tokens match exactly, to be treated as the same place recorded twice —
  // tuned to comfortably catch "one extra locality token" (e.g. 4 shared words + 1 extra = 4/5 =
  // 0.8) while still requiring most of the text to genuinely overlap, not just a couple of common
  // words like "high street".
  const DUPLICATE_TOKEN_THRESHOLD = 0.7;

  // isLikelyDuplicateAddress(a, b) -> boolean. Deliberately conservative — a merge eventually built
  // on this deletes a real address record, so a missed duplicate is a far smaller problem than a
  // false one:
  //   - BOTH addresses must have a postcode, and it must match once normalised (whitespace/case
  //     only) — never grouped on text similarity alone, since a genuinely different address a few
  //     doors down could otherwise share most of its words with this one.
  //   - Either postcode missing/blank -> never a duplicate (too uncertain to risk it).
  //   - The two addresses' NUMERIC tokens (house/flat numbers) must match EXACTLY, not just
  //     overlap — found live while testing this: with a short address (5-7 words total), a single
  //     differing word barely moves a pure Jaccard score, so "Flat 1" vs "Flat 2" at the same
  //     postcode was scoring high enough to falsely match. A number is what actually distinguishes
  //     one real address from its next-door neighbour or a different flat in the same building —
  //     unlike a stray extra WORD (e.g. "London"), a differing NUMBER is never safe to treat as
  //     noise, so it's checked separately and strictly rather than folded into the same fuzzy score.
  //   - Only once numbers match exactly does the rest of the address text (word tokens) need to
  //     overlap heavily.
  function isLikelyDuplicateAddress(a, b) {
    if (!a || !b) return false;
    const pcA = normalisePostcode(a.postalCode);
    const pcB = normalisePostcode(b.postalCode);
    if (!pcA || !pcB || pcA !== pcB) return false;
    const ta = addressTokens(a);
    const tb = addressTokens(b);
    if (!setsEqual(ta.numbers, tb.numbers)) return false;
    return tokenOverlap(ta.words, tb.words) >= DUPLICATE_TOKEN_THRESHOLD;
  }

  // findDuplicateAddressGroups(patientAddresses) -> [[i, j, ...], ...]
  //   patientAddresses: [{ addressId, address: {...} }] — a SINGLE patient's own
  //   patientAddressSection.patientAddresses array, exactly the shape already read elsewhere in
  //   this codebase (see contacts-canvas.js's indexAddress/formatAddressLine). "Only within the hub
  //   patient" is a CALLER decision, not this function's — it just groups whatever list it's given,
  //   so the canvas only ever calls it with the index patient's own addresses, never a linked
  //   contact's.
  // Groups by ARRAY INDEX (never assumes an addressId is present, though a real merge action would
  // need one). Each group is anchored to its first (lowest-index) member — every other member is
  // pairwise-likely-duplicate of that anchor, not necessarily of each other. That's a deliberate
  // simplification: a merge action only ever needs "these look like the same place", not a formal
  // transitive-equivalence guarantee across a 3+-address group.
  function findDuplicateAddressGroups(patientAddresses) {
    const list = Array.isArray(patientAddresses) ? patientAddresses : [];
    const groups = [];
    const grouped = new Set();
    for (let i = 0; i < list.length; i++) {
      if (grouped.has(i)) continue;
      const group = [i];
      for (let j = i + 1; j < list.length; j++) {
        if (grouped.has(j)) continue;
        if (isLikelyDuplicateAddress(list[i] && list[i].address, list[j] && list[j].address)) {
          group.push(j);
        }
      }
      if (group.length > 1) {
        group.forEach((idx) => grouped.add(idx));
        groups.push(group);
      }
    }
    return groups;
  }

  // chooseAddressToKeep(entries) -> index into `entries` to KEEP once a duplicate group is
  // confirmed for merging — every OTHER entry is a delete candidate. entries:
  // [{ address, isCorrespondenceAddress }], same order as the caller's own duplicate-group
  // indexes; this only ever returns a POSITION within this array — the caller maps it back to
  // whichever addressId that corresponds to. Confirmed via HAR capture 2026-07-30 that
  // isCorrespondenceAddress exists (only reachable per-address via getEditAddress, not present on
  // patientAddressSection.patientAddresses[] itself) and is worth protecting: deleting the wrong
  // duplicate would lose that designation, a real mistake, not a cosmetic one.
  // Tie-break order, each a genuine reason to prefer one duplicate over another, never an arbitrary
  // pick:
  //   1. Whichever IS the patient's correspondence address — protected above all else.
  //   2. Whichever has the MOST complete address data (fewest empty fields) — keeps the record
  //      carrying more information, not less.
  //   3. The first one in the given order — a final deterministic tiebreak, never random/unstable.
  function chooseAddressToKeep(entries) {
    if (!Array.isArray(entries) || !entries.length) return -1;
    const correspondenceIdx = entries.findIndex((e) => e && e.isCorrespondenceAddress);
    if (correspondenceIdx !== -1) return correspondenceIdx;
    const completenessFields = ADDRESS_LINE_FIELDS.concat(['postalCode']);
    let bestIdx = 0;
    let bestCompleteness = -1;
    entries.forEach((e, i) => {
      const addr = (e && e.address) || {};
      const completeness = completenessFields.filter((f) => String(addr[f] || '').trim()).length;
      if (completeness > bestCompleteness) {
        bestCompleteness = completeness;
        bestIdx = i;
      }
    });
    return bestIdx;
  }

  // buildChangeAddressBody({addressId, address, description, accessNotes, isCorrespondenceAddress})
  // -> the exact POST /patient/address/change-address body (confirmed via HAR capture 2026-07-30:
  // setting an existing address as the patient's correspondence address). A full-replace write,
  // not a patch — every field must be sent back, not just the one actually changing.
  //
  // Live-tested finding, straight from the user: Medicus's OWN UI for this action makes the GP
  // re-search and re-select the whole address from scratch via an OS Places lookup, even when
  // nothing about the address itself is changing — purely a quirk of that particular screen, not a
  // requirement of this endpoint. The captured search results carry EXACTLY the same
  // line1/line2/line3/locality/administrativeArea/postalCode/country/pafAddressKey shape this body
  // needs, and the endpoint doesn't care whether that shape came from a fresh OS Places lookup or
  // from an address already on file — so a caller that already knows the address (every caller in
  // this codebase does, from patientAddressSection) can build this directly, no search needed.
  // pafAddressKey stayed null in the captured flow despite going through OS Places, so it's always
  // sent null here too, never guessed at.
  function buildChangeAddressBody({ addressId, address, description, accessNotes, isCorrespondenceAddress } = {}) {
    const a = address || {};
    return {
      address: {
        line1: a.line1 || null,
        line2: a.line2 || null,
        line3: a.line3 || null,
        locality: a.locality || null,
        administrativeArea: a.administrativeArea || null,
        postalCode: a.postalCode || null,
        country: a.country || 'GBR',
        pafAddressKey: null,
      },
      description: description || null,
      accessNotes: accessNotes || null,
      id: addressId || null,
      isCorrespondenceAddress: !!isCorrespondenceAddress,
    };
  }

  // ── Shared contact-info detection (patient vs a linked contact) ─────────────────────────────
  // A patient sharing a non-Home phone or a non-Home email with one of their own linked contacts
  // is a known data-quality/confidentiality signal in this GP population — most often a child's
  // record wrongly carrying a parent's own mobile/email (see this file's own sourceNotes on why
  // phone/email are capped low in scoreCandidate: "children's records sometimes wrongly carry a
  // parent's own contact details"). This surfaces that same underlying problem directly rather
  // than just discounting it during matching: a message meant privately for the patient (results,
  // an appointment reminder, safeguarding-sensitive contact) could otherwise silently reach the
  // linked contact instead. "Home" is excluded from BOTH the phone and email checks (a shared
  // household landline or a shared household inbox is normal, not suspicious) — confirmed live
  // that email DOES carry a type field here (`patientEmailAddresses[].emailAddressType`, e.g.
  // "Personal"/"Home"/"Work"), correcting an earlier assumption in this file that email had no
  // type at all; a same-record example the user found (one record's copy filed as Home, the
  // other's as Work) wasn't being excluded before this fix even though the phone side already had
  // the equivalent carve-out.
  //
  // Detection only — never resolves whose number/email it "really" is. Two hints travel alongside
  // a match instead, so the GP can judge that themselves, straight from the user's own framing:
  // "it is often clear from the email itself who it belongs to, or from the patient's age that
  // they don't have their own mobile phone." Ages are the caller's job to show (this module has no
  // access to a "now" — see candidateAgeFromDob in contacts-canvas.js); emailOwnerHint is the
  // email-address half of that same idea, offered here since it's pure text comparison.

  function normalisePhoneDigits(p) {
    return String(p || '').replace(/[^0-9]/g, '');
  }

  function isHomeType(type) {
    return (
      String(type || '')
        .trim()
        .toLowerCase() === 'home'
    );
  }

  // emailOwnerHint(email, nameA, nameB) -> 'a' | 'b' | null — which of two names the email's local
  // part (before @) looks more like it belongs to. NOT a simple "does any token match" check —
  // found live while testing this: a parent and child sharing a surname (the ordinary case) both
  // "match" on the surname token alone, which would neutralise the hint in exactly the situation
  // it exists for. Instead scores each name by what FRACTION of its own tokens appear in the
  // local part (e.g. "sarah.jones82" -> {sarah, jones} matches ALL of "Sarah Jones"'s tokens but
  // only HALF of "Ethan Jones"'s, correctly favouring the fuller match) and hints whichever score
  // is strictly higher — a tie (including 0 vs 0, or an equally partial match on both sides, e.g.
  // "sarah@..." against two different Sarahs) returns null rather than guessing. Trailing digits
  // are stripped from each local-part token first (e.g. "jones82" -> "jones"), the single most
  // common real-world email pattern, without trying to be cleverer than that.
  function emailOwnerHint(email, nameA, nameB) {
    const local = String(email || '').split('@')[0];
    const localTokens = new Set(
      normaliseText(local)
        .split(' ')
        .map((t) => t.replace(/\d+$/, ''))
        .filter((t) => t.length > 1)
    );
    if (!localTokens.size) return null;
    const coverage = (name) => {
      const tokens = normaliseText(name)
        .split(' ')
        .filter((t) => t.length > 1);
      if (!tokens.length) return 0;
      return tokens.filter((t) => localTokens.has(t)).length / tokens.length;
    };
    const aScore = coverage(nameA);
    const bScore = coverage(nameB);
    if (aScore === bScore) return null;
    return aScore > bScore ? 'a' : 'b';
  }

  // findSharedContactInfo(patient, contact) -> { phones: [string], emails: [{email, ownerHint}] } | null
  //   patient/contact: { name, phones: [{telephoneNumber, telephoneNumberType}],
  //                       emails: [{emailAddress, emailAddressType}] }
  //   — the same shapes already read elsewhere in this codebase (patientContactInformationSection's
  //   patientTelephoneNumbers[]/patientEmailAddresses[]) — emails are full entry objects, not bare
  //   strings, specifically so the Home-type exclusion below has something to check.
  // Returns null when nothing is shared (the common case), not an empty-arrays object, so a caller
  // can just check truthiness.
  function findSharedContactInfo(patient, contact) {
    if (!patient || !contact) return null;
    const patientPhones = (patient.phones || []).filter((p) => p && !isHomeType(p.telephoneNumberType));
    const contactPhones = (contact.phones || []).filter((p) => p && !isHomeType(p.telephoneNumberType));
    const sharedPhones = [];
    for (const pp of patientPhones) {
      const ppDigits = normalisePhoneDigits(pp.telephoneNumber);
      if (!ppDigits) continue;
      if (sharedPhones.includes(pp.telephoneNumber)) continue;
      if (contactPhones.some((cp) => normalisePhoneDigits(cp.telephoneNumber) === ppDigits)) {
        sharedPhones.push(pp.telephoneNumber);
      }
    }
    const patientEmails = (patient.emails || []).filter((e) => e && e.emailAddress && !isHomeType(e.emailAddressType));
    const contactEmails = (contact.emails || []).filter((e) => e && e.emailAddress && !isHomeType(e.emailAddressType));
    const sharedEmails = [];
    for (const pe of patientEmails) {
      const peNorm = String(pe.emailAddress).trim().toLowerCase();
      if (!peNorm) continue;
      if (sharedEmails.some((s) => s.email === pe.emailAddress)) continue;
      if (contactEmails.some((ce) => String(ce.emailAddress).trim().toLowerCase() === peNorm)) {
        sharedEmails.push({
          email: pe.emailAddress,
          ownerHint: emailOwnerHint(pe.emailAddress, patient.name, contact.name),
        });
      }
    }
    if (!sharedPhones.length && !sharedEmails.length) return null;
    return { phones: sharedPhones, emails: sharedEmails };
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
    composeViaHub,
    normaliseFreeText,
    isDeceasedRelationshipText,
    isUkMobileNumber,
    isLikelyDuplicateAddress,
    findDuplicateAddressGroups,
    chooseAddressToKeep,
    buildChangeAddressBody,
    emailOwnerHint,
    findSharedContactInfo,
    ALIAS_TERMS,
    findExistingReciprocal,
    findExistingForwardLink,
    suggestForwardFromReciprocal,
    extractPreferredEmail,
    extractPreferredPhone,
    extractPreferredPhoneNote,
    extractPreferredPhoneId,
    buildLinkPatientBody,
    buildManualContactBody,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else if (global) {
    global.ContactRelationships = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
