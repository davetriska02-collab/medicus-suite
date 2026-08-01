// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Contacts linking: visual family-tree canvas (Phase 3 columns + Phase 4 tree)
//
// A richer, all-at-once alternative to contacts-link-button.js's one-contact-at-a-time wizard:
// the index patient's manual contacts, already-linked contacts, name/address-ranked suggestions,
// and other patients at the same address are all shown laid out as a family tree — parents above,
// partner/siblings beside, children below, collapsible grandparents/aunts-uncles/other sections,
// a needs-review holding area for anything whose relationship text doesn't map cleanly — rather
// than flat columns, so it's clear at a glance who's already matched and where a candidate would
// go. Colour-coded by a normalised category of the relationship text so visually-related cards
// are easy to spot. Dragging a manual card onto a Medicus card pairs them (drag-to-merge);
// dragging any card onto a SLOT (not one generic zone — Phase 4's change) opens the same confirm
// form the wizard uses (drag-to-assign) and fires the same shared write path.
//
// Business logic (API calls, relationship vocabulary, matching, and — critically — the
// wrong-patient guard and duplicate-link detection) all comes from window.ContactsApi /
// window.ContactRelationships / window.ContactMatch / window.ContactTree, exactly as
// contacts-link-button.js uses the first three — this file owns rendering and drag interaction
// only, not a second copy of anything safety-critical.
//
// window.ContactTree (engine/contact-tree.js, built+tested in Phase 0) is used for the LOCKED
// half of the tree only — already-real edges pre-placed from the index patient's existing linked
// contacts, which are immutable facts for the session. The PENDING half (a manual contact still
// awaiting a merge+confirm decision, together with its candidate matches) is deliberately NOT
// pushed through the tree engine's pendingSuggestions/commitSuggestion machinery — it's derived at
// render time from cs.manualCards/cs.suggestedCards, exactly as Phase 3 already worked, just
// grouped by slot instead of by row. Doing it this way avoids a two-way sync between the tree
// engine's own suggestion store and the manual/suggested card arrays that already drive the
// merge-compare panel; the tree engine's write path (assignToSlot) is still what a NEWLY confirmed
// edge conceptually maps onto, it's just applied by rebuilding the locked half after a successful
// write rather than by calling commitSuggestion on a mirrored suggestion.
//
// Opened via window.ContactsCanvas.open(), called from a button in contacts-link-button.js.
'use strict';

(function () {
  if (window.ContactsCanvas) return; // re-entry guard

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Colour coding ─────────────────────────────────────────────────────────────────────────────
  // One colour per relationship tier, applied to a manual contact's own card, any Medicus
  // candidate suggested BECAUSE of that manual contact, and any already-linked contact whose own
  // recorded relationship normalises into the same tier — the visual pairing hint described in
  // the product design (colour-match a manual card to its likely Medicus counterpart).

  const TIER_COLOURS = {
    partner: '#f59e0b',
    'parent-child': '#2563eb',
    sibling: '#16a34a',
    'grandparent-grandchild': '#7c3aed',
    extended: '#0891b2',
    'in-law': '#db2777',
    care: '#64748b',
    other: '#94a3b8',
  };
  const NEEDS_REVIEW_COLOUR = '#cbd5e1';

  function colourForRelationshipText(text) {
    const CR = window.ContactRelationships;
    const guess = CR.normaliseFreeText(text);
    if (!guess) return NEEDS_REVIEW_COLOUR;
    const rel = CR.getRelationship(guess.baseId);
    return (rel && TIER_COLOURS[rel.tier]) || NEEDS_REVIEW_COLOUR;
  }

  // ── Slot mapping ──────────────────────────────────────────────────────────────────────────────
  // Which family-tree slot (engine/contact-tree.js's fixed slot set) a canonical relationship id
  // belongs in. Several relationship tiers collapse into 'other' (grandchildren, niece/nephew/
  // cousin, every in-law, every care-tier relationship, friend/neighbour) because the tree engine's
  // slot set is intentionally coarse — it was built and tested in Phase 0 around the core
  // generational rows (parents/partner/siblings/children) plus grandparents/aunts-uncles as the
  // two named "+" expansions, not a slot per relationship type. 'other' is where everything else
  // that doesn't fit those surfaces, exactly as the holding area was always meant to work.
  const SLOT_FOR_BASE_ID = {
    husband: 'partner',
    wife: 'partner',
    partner: 'partner',
    'civil-partner': 'partner',
    mother: 'parents',
    father: 'parents',
    son: 'children',
    daughter: 'children',
    brother: 'siblings',
    sister: 'siblings',
    grandmother: 'grandparents',
    grandfather: 'grandparents',
    grandson: 'other',
    granddaughter: 'other',
    aunt: 'auntsUncles',
    uncle: 'auntsUncles',
    niece: 'other',
    nephew: 'other',
    cousin: 'other',
    'mother-in-law': 'other',
    'father-in-law': 'other',
    'son-in-law': 'other',
    'daughter-in-law': 'other',
    'brother-in-law': 'other',
    'sister-in-law': 'other',
    'legal-guardian': 'other',
    'foster-carer': 'other',
    carer: 'other',
    'care-home-staff': 'other',
    friend: 'other',
    neighbour: 'other',
    other: 'other',
  };

  const SLOT_TITLES = {
    parents: 'Parents',
    partner: 'Partner',
    siblings: 'Siblings',
    children: 'Children',
    grandparents: 'Grandparents',
    auntsUncles: 'Aunts / Uncles',
    other: 'Other family / contacts',
  };

  // slotBaseIds(slotPath) -> the canonical relationship ids valid for that slot, so the confirm
  // panel's relationship dropdown can be filtered to what actually makes sense for the slot a card
  // was dropped on, rather than showing all 32 regardless.
  function slotBaseIds(slotPath) {
    return Object.keys(SLOT_FOR_BASE_ID).filter((id) => SLOT_FOR_BASE_ID[id] === slotPath);
  }

  // pickBaseIdForSlot(slotPath, candidateGenderIdentity) -> the best default relationship id for a
  // card dropped on a slot with no better guess available (no manual free-text match, no existing
  // reciprocal to invert). Picks the slot's option whose `subjectGender` matches the CANDIDATE's
  // own recorded gender identity (e.g. "sister" over "brother" for a female candidate dropped on
  // Siblings) rather than blindly taking the first id in SLOT_FOR_BASE_ID's declaration order —
  // still just a starting point, always shown editable in the confirm panel, never a silent write.
  function pickBaseIdForSlot(slotPath, candidateGenderIdentity) {
    const CR = window.ContactRelationships;
    const validIds = slotBaseIds(slotPath);
    if (!validIds.length) return 'other';
    const bucket = CR.genderBucket(candidateGenderIdentity);
    if (bucket) {
      const genderMatch = validIds.find((id) => {
        const rel = CR.getRelationship(id);
        return rel && rel.subjectGender === bucket;
      });
      if (genderMatch) return genderMatch;
    }
    return validIds[0];
  }

  // ── State ─────────────────────────────────────────────────────────────────────────────────────

  let cs = null; // null when the canvas is closed

  function blankCanvasState() {
    return {
      apiBase: null,
      patientId: null,
      indexPatientDetails: null,
      indexAge: null, // stashed for cardHtml's shared-contact-info hint ("this patient is X, [contact] is Y")
      hasNoNok: false, // no linked contact has isNextOfKin true — flagged for every patient, any age
      isUnder13: false,
      hasNoCopyCorrespondenceU13: false, // only ever meaningful when isUnder13 is also true
      loading: true,
      error: null,

      manualCards: [], // [{ id, name, relationshipText, colour, mergedWith: null|medicusCardId, mergedNotes: '' }]
      linkedCards: [], // [{ id, name, relationshipText, colour, isLinked, baseId, modifierId }] — every already-linked contact, whether or not its relationship maps to a canonical id (baseId/modifierId null if not) or is currently placed in a tree slot; see buildLockedTree + bestManualMatchFor
      suggestedCards: [], // [{ id, name, dateOfBirth, genderIdentity, atSameAddress, score, tier, colour, forManualId, hint? }] — hint set only for a transitively-sourced match (loadCanvas step 1.5), drives a distinguishing sub-label in renderSources()
      addressCards: [], // [{ id, name }]
      transitiveCards: [], // [{ id, name, genderIdentity?, hint }] — real contacts pulled from a related patient's own record (either direction, or the related patient themselves — see loadCanvas step 1.5), matched to no manual contact of this patient's own. genderIdentity only ever set for the related patient themselves (already fetched for that one; the other two directions would need a further per-contact fetch, not done)

      indexAddresses: [], // the hub/index patient's OWN patientAddressSection.patientAddresses, full array (not just [0]) — feeds duplicateAddressGroups below
      duplicateAddressGroups: [], // [[i, j, ...], ...] — ContactRelationships.findDuplicateAddressGroups(indexAddresses)
      addressMergeGroups: [], // [{ indexes: [i, j, ...], keepIndex }] — duplicateAddressGroups augmented with which member to keep (buildAddressMergeGroups), drives renderDuplicateAddressWarning + mergeDuplicateAddressGroup
      addressMerging: new Set(), // group keys (indexes.join(',')) currently mid-merge — same Set-not-single-value reasoning as phoneDeleting
      addressMergeError: null,
      tree: null, // window.ContactTree instance — LOCKED edges only, pre-placed from linkedCards; see file header
      // window.ContactTree family session — the cross-patient "Next family member" cycling pool.
      // Created fresh in open() unless resuming a session persisted before a navigation (see the
      // "Family cycling" section near close() for the full mechanism and why this can't just be an
      // in-page tree swap). Populated from this patient's own linked contacts in loadCanvas' Step
      // 1.8, and grown further by every edge committed this session (doCanvasConfirm).
      familySession: null,
      expandedSlots: {}, // slotPath -> true once the user has clicked "+ <slot>" to reveal an empty collapsible row
      // patientId -> the PLACED PARENT's own cardId this grandparent was composed from (loadCanvas
      // step 1.6) — persisted here (not just local to loadCanvas) so renderTree can still group a
      // grandparent under the correct parent's own tree item after it's been placed, without
      // re-deriving it (which would need re-fetching that parent's own patient-details). A
      // grandparent with no entry here (dragged in directly, e.g. via search, rather than
      // composed) falls back to the general collapsible slot instead — see
      // unassignedGrandparentsHtml.
      grandparentViaParent: new Map(),

      pendingMerge: null, // { manualId, medicusId, manualDetail, medicusPreview, keepNotes, keepManualPhone } while the compare panel is open
      mergeLoading: false,
      mergeError: null,

      phoneEdit: null, // { telephoneNumberId, forMedicusId, candidateName, loading, error, saving, form } while the candidate's own phone-number edit form is open — see startPhoneEdit()
      phoneDeleting: new Set(), // telephoneNumberIds currently being deleted — a Set, not a single value, so deleting two rows in overlapping requests can't have the second one's cleanup accidentally clear the first's still-in-flight state (or vice versa) — see deletePhoneNumber()
      phoneFixingType: new Set(), // telephoneNumberIds currently having their type fixed (the "Fix type" one-click action) — same Set-not-single-value reasoning as phoneDeleting — see fixPhoneType()

      confirmCardId: null, // id of whichever card is currently staged for linking
      confirmCardKind: null, // 'manual' | 'medicus' — which array confirmCardId is drawn from
      confirm: null, // built when a card is dropped on a slot — same shape as the wizard's confirm fields, plus slotPath
      // In-flight guard for the confirm panel's "Confirm link" button. Set SYNCHRONOUSLY at the top
      // of doCanvasConfirm, before the first await, and the button is rendered disabled while it's
      // true: performLinkAndCleanup is a multi-second sequence of up to four POSTs, and the reverse
      // link-patient POST has no idempotency guard of its own (see
      // ContactRelationships.findExistingReciprocal's own comment) — a double-click would create a
      // genuine DUPLICATE relationship on the OTHER patient's record, not a harmless repeat.
      confirming: false,
      manualDeleting: new Set(), // manual patientContactIds currently being deleted (blank-contact Delete) — same Set-not-single-value reasoning as phoneDeleting
      reverseManualRemoving: false, // the "Remove it" offer for a manual contact on the CANDIDATE's record is mid-delete
      workingError: null,
      doneSummary: null,
      reverseManualMatch: null, // a likely-matching manual contact found on the candidate's OWN record, offered for removal
      reverseManualMatchError: null,
    };
  }

  // ── Data loading ──────────────────────────────────────────────────────────────────────────────

  function candidateAgeFromDob(dateOfBirth) {
    if (!dateOfBirth) return null;
    const d = new Date(dateOfBirth);
    if (isNaN(d.getTime())) return null;
    return Math.floor((Date.now() - d.getTime()) / (365.25 * 86400000));
  }

  // formatAddressLine(address) -> "12 High St, Springfield, SP1 2AB" | null — display-only, used
  // to disambiguate two same-named candidates (see the name-collision check in loadCanvas). DOB
  // was tried here first but the user pointed out it's useless for this purpose: manual contacts
  // never carry a DOB at all, so there's nothing on the manual side to recognise or compare it
  // against. Address/phone/email don't have that problem — a GP who knows the family can often
  // recognise the right one on sight, AND (per the user's follow-up) the same detail is also shown
  // on the affected MANUAL contact card itself, so the two sides can be compared side by side
  // before dragging one onto the other. `address` is the same shape already relied on by
  // `sameAddress` and the wizard's `buildManualContactBody` (line1/line2/locality/postalCode
  // confirmed via those existing, already-live code paths) — only the fields actually present are
  // shown, in case any are blank.
  function formatAddressLine(address) {
    if (!address) return null;
    const parts = [address.line1, address.line2, address.locality, address.postalCode].filter((p) => (p || '').trim());
    return parts.length ? parts.join(', ') : null;
  }

  // manualPhoneSummary(manualDetail) -> "Home 01234 567890, Mobile 07700 900123" | null — a manual
  // contact can have up to three flat phone fields (never a list, unlike a real patient's
  // patientTelephoneNumbers[] — see buildPhoneRows), each shown with its type so it's clear which
  // is which when comparing against a candidate's single preferred number.
  function manualPhoneSummary(manualDetail) {
    const entries = [
      ['Home', manualDetail.patientContactHomeTelephoneNumber && manualDetail.patientContactHomeTelephoneNumber.value],
      [
        'Mobile',
        manualDetail.patientContactMobileTelephoneNumber && manualDetail.patientContactMobileTelephoneNumber.value,
      ],
      ['Work', manualDetail.patientContactWorkTelephoneNumber && manualDetail.patientContactWorkTelephoneNumber.value],
    ].filter(([, value]) => value);
    return entries.length ? entries.map(([type, value]) => `${type} ${value}`).join(', ') : null;
  }

  // genderFromRelationshipLabel(text) -> 'm' | 'f' | null — a zero-cost gender signal derived from
  // the relationship LABEL itself (e.g. "Father" implies male via that relationship's own
  // subjectGender in rules/contact-relationships.json), rather than a separate patient-details
  // fetch. Live-tested finding: a transitive-pool candidate's own hint text already carries this
  // ("recorded there as 'Father'") — no need to pull a coded gender field when the user-generated
  // relationship text already implies one. Same soft-hint status as genderIdentity everywhere else
  // in this codebase (rules/contact-relationships.json's own sourceNotes: "never a hard filter") —
  // 'n'/unrecognised text correctly yields null, no forced guess for a genuinely gender-neutral or
  // unparseable label.
  function genderFromRelationshipLabel(text) {
    const guess = window.ContactRelationships.normaliseFreeText(text);
    const rel = guess && window.ContactRelationships.getRelationship(guess.baseId);
    return (rel && (rel.subjectGender === 'm' || rel.subjectGender === 'f') && rel.subjectGender) || null;
  }

  function sameAddress(a, b) {
    if (!a || !b) return false;
    const norm = (addr) =>
      [addr.line1, addr.postalCode]
        .map((x) =>
          String(x || '')
            .trim()
            .toLowerCase()
        )
        .join('|');
    return !!(a.postalCode && b.postalCode) && norm(a) === norm(b);
  }

  // buildAddressMergeGroups(apiBase, indexAddresses, duplicateGroups) ->
  //   Promise<[{indexes, keepIndex, correspondenceIndex, details, unverifiedIndexes}]>
  // For each duplicate group (ContactRelationships.findDuplicateAddressGroups), fetches
  // getEditAddress per member — the ONLY place isCorrespondenceAddress/description/accessNotes are
  // reachable (confirmed via HAR capture 2026-07-30); none of them are present on
  // patientAddressSection.patientAddresses[] itself. `keepIndex` is only ever the DEFAULT selection
  // (ContactRelationships.chooseAddressToKeep) — the GP can override it in the panel before merging
  // (see renderDuplicateAddressWarning's radio buttons). `correspondenceIndex` is surfaced
  // separately (which member CURRENTLY holds the flag, -1 if none) so the panel can note it
  // regardless of which one ends up selected. `details` is kept parallel to `indexes` (details[i]
  // is the getEditAddress response for indexes[i]) so mergeDuplicateAddressGroup can reuse
  // description/accessNotes when moving the correspondence flag onto whichever address the GP
  // actually kept, without a second fetch.
  //
  // FAILS CLOSED on an unverifiable member (`unverifiedIndexes`, previously a swallowed
  // `catch (_) { …set(idx, {}) }`): an empty detail object is indistinguishable from a verified
  // "not the correspondence address", so a single flaky getEditAddress could let the merge delete
  // the patient's REAL correspondence address with no flag transfer at all — a silent, clinically
  // consequential loss (correspondence goes to the wrong place afterwards, with nothing on screen
  // to say so). An address with no addressId at all is treated the same way: there is nothing to
  // ask about, so it cannot be cleared. The group is still SHOWN when this happens — the duplicate
  // is real and worth the GP seeing — but its Merge control is disabled with an explicit note
  // (renderDuplicateAddressWarning), and mergeDuplicateAddressGroup re-checks the same flag itself
  // so the refusal never depends on the button's disabled attribute alone.
  async function buildAddressMergeGroups(apiBase, indexAddresses, duplicateGroups) {
    if (!duplicateGroups.length) return [];
    const allIndexes = Array.from(new Set(duplicateGroups.flat()));
    const detailByIndex = new Map();
    const unverified = new Set();
    await Promise.all(
      allIndexes.map(async (idx) => {
        const entry = indexAddresses[idx];
        if (!entry || !entry.addressId) {
          unverified.add(idx);
          return;
        }
        try {
          const detail = await window.ContactsApi.getEditAddress(apiBase, entry.addressId);
          detailByIndex.set(idx, detail || {});
        } catch (_) {
          unverified.add(idx);
          detailByIndex.set(idx, {});
        }
      })
    );
    return duplicateGroups.map((indexes) => {
      const details = indexes.map((idx) => detailByIndex.get(idx) || {});
      const entries = indexes.map((idx, i) => ({
        address: indexAddresses[idx] && indexAddresses[idx].address,
        isCorrespondenceAddress: !!details[i].isCorrespondenceAddress,
      }));
      const keepPos = window.ContactRelationships.chooseAddressToKeep(entries);
      const correspondencePos = entries.findIndex((e) => e.isCorrespondenceAddress);
      return {
        indexes,
        keepIndex: indexes[keepPos],
        correspondenceIndex: correspondencePos === -1 ? -1 : indexes[correspondencePos],
        details,
        unverifiedIndexes: indexes.filter((idx) => unverified.has(idx)),
      };
    });
  }

  // buildLockedTree — pre-places every already-linked contact whose relationship maps to a
  // canonical id (lc.baseId, computed once in loadCanvas via normaliseFreeText) into its slot as a
  // `locked:true` edge — an immutable fact for this session, not a pending decision. A linked
  // contact whose relationship text doesn't map to any canonical id (lc.baseId null — genuinely
  // vague free text) is left out of the tree entirely: it stays a plain cs.linkedCards entry,
  // available to be matched against a manual contact (bestManualMatchFor/renderSources) or dragged
  // straight onto a slot, exactly like a suggested candidate — there's no separate "fix its
  // category first" step, since dropping it onto a slot captures the relationship the same way a
  // brand-new link does.
  function buildLockedTree(indexPatientId, linkedCards) {
    let tree = window.ContactTree.createTree(indexPatientId);
    for (const lc of linkedCards) {
      const slotPath = lc.baseId && SLOT_FOR_BASE_ID[lc.baseId];
      if (!slotPath) continue;
      tree = window.ContactTree.assignToSlot(
        tree,
        slotPath,
        { id: lc.id, patientId: lc.id, name: lc.name },
        { baseId: lc.baseId, modifierId: lc.modifierId, locked: true }
      );
    }
    return tree;
  }

  async function loadCanvas() {
    const ctx = window.ContactsApi.resolveContext();
    if (!ctx) {
      cs.error = 'Could not identify the current patient — try reloading the page.';
      cs.loading = false;
      render();
      return;
    }
    cs.apiBase = ctx.apiBase;
    cs.patientId = ctx.patientId;
    const st = cs;
    try {
      await window.ContactsApi.ensureRelationshipsData();
      if (st !== cs) return;
      const details = await window.ContactsApi.getPatientDetails(st.apiBase, st.patientId);
      if (st !== cs) return;
      st.indexPatientDetails = details;

      const allContacts = (details.patientContactsSection && details.patientContactsSection.patientContacts) || [];
      st.manualCards = allContacts
        .filter((c) => !c.patientContactPatientId)
        .map((c) => ({
          id: c.patientContactId,
          name: c.patientContactName,
          relationshipText: c.patientContactRelationship,
          colour: colourForRelationshipText(c.patientContactRelationship),
          // Confirmed via HAR capture 2026-07-26: a genuinely blank manual contact (name AND
          // relationship both empty strings, no phone/email/address either) — the user's own
          // description is "an artifact of a now-fixed bug in the import process". Flagged for a
          // dedicated "Delete" treatment (renderSources) rather than the normal match pipeline —
          // there's no name to search or match against, so it's excluded from that entirely below.
          isBlank: !(c.patientContactName || '').trim() && !(c.patientContactRelationship || '').trim(),
          mergedWith: null,
          // Confirmed via HAR capture 2026-07-27: Medicus's own `isDeceased` flag (used elsewhere
          // in this suite, e.g. side-panel/modules/record/record.js) is NOT reachable for a
          // deceased CONTACT — a deceased patient is deducted the same way any inactive-after-
          // grace-period patient is, so patient-details 403s before that flag is ever reachable.
          // Free text is the only reliable signal available — see
          // ContactRelationships.isDeceasedRelationshipText for why this is display-only, never a
          // formal modifier like Step-/Half-/Ex-.
          deceased: window.ContactRelationships.isDeceasedRelationshipText(c.patientContactRelationship),
        }));
      st.linkedCards = allContacts
        .filter((c) => c.patientContactPatientId)
        .map((c) => {
          // Computed once, up front, from Medicus's own free text — the authoritative source for
          // an already-real link's relationship (see buildConfirmForCard's priority over any
          // guess derived from a manual card's own, separate free text). Null when the text
          // doesn't map to any canonical id at all (see buildLockedTree/bestManualMatchFor).
          const guess = window.ContactRelationships.normaliseFreeText(c.patientContactRelationship);
          return {
            id: c.patientContactPatientId,
            name: c.patientContactName,
            relationshipText: c.patientContactRelationship,
            colour: colourForRelationshipText(c.patientContactRelationship),
            isLinked: true, // distinguishes an already-linked card from a suggestedCards entry when both are looked up by id
            baseId: guess ? guess.baseId : null,
            modifierId: guess ? guess.modifierId : null,
            deceased: window.ContactRelationships.isDeceasedRelationshipText(c.patientContactRelationship),
            // Confirmed via HAR capture: patientContactsSection's own list entries carry a bare
            // `isNextOfKin` (a THIRD field-naming variant alongside the write-side
            // patientContactIsNextOfKin and view-patient-contact's own
            // patientContactRelationshipIsNextOfKin — see Step 1.10 below) — reliable enough to
            // read straight off here, no extra fetch needed for the NOK gap check.
            isNextOfKin: !!c.isNextOfKin,
            relationshipId: c.patientContactId || null, // needed for viewPatientContact — see Step 1.10
          };
        });

      st.tree = buildLockedTree(st.patientId, st.linkedCards);
      // Not set when resuming a persisted session (open() already populated it with `current`
      // pointing at this exact patient) — only start a fresh one when there isn't one yet.
      if (!st.familySession) st.familySession = window.ContactTree.createFamilySession(st.patientId);

      const alreadyKnownIds = new Set(st.linkedCards.map((c) => c.id));
      const indexAddress =
        details.patientAddressSection &&
        details.patientAddressSection.patientAddresses[0] &&
        details.patientAddressSection.patientAddresses[0].address;
      // Duplicate-address detection — ONLY within the hub/index patient's own record (never a
      // linked contact's), per the user's own scoping. A known PDS data-quality pattern: the same
      // real address recorded more than once, differently formatted each time — see
      // ContactRelationships.findDuplicateAddressGroups' own comment for the full reasoning.
      // buildAddressMergeGroups' getEditAddress calls are a small, bounded fetch (only for
      // addresses actually flagged as duplicates, typically 0-2 per canvas open) — same "small
      // bounded fetch for correctness" pattern already used throughout this function.
      st.indexAddresses = (details.patientAddressSection && details.patientAddressSection.patientAddresses) || [];
      st.duplicateAddressGroups = window.ContactRelationships.findDuplicateAddressGroups(st.indexAddresses);
      st.addressMergeGroups = await buildAddressMergeGroups(st.apiBase, st.indexAddresses, st.duplicateAddressGroups);
      if (st !== cs) return;
      const indexAge = candidateAgeFromDob(details.patientDetailsSection && details.patientDetailsSection.dateOfBirth);
      st.indexAge = indexAge; // stashed on state too — cardHtml's sharedContactInfoDetailHtml needs it for the "ages side by side" hint

      // Step 1.10 — NOK / copy-correspondence gaps (hub patient only, per the user's own scoping).
      // isNextOfKin is read straight off linkedCards (bare `isNextOfKin`, no extra fetch — see that
      // field's own comment above). Copy-correspondence ISN'T reliably observable on that same list
      // (two independent HAR captures of patient-details never showed it at all, even when false)
      // so it needs its own per-contact fetch — confirmed via HAR capture 2026-07-30 that
      // viewPatientContact returns patientContactRelationshipCopyCorrespondence (a THIRD
      // field-naming variant: write-side is patientContactCopyCorrespondence, this read is
      // patientContactRelationshipCopyCorrespondence). Only bothered with at all when the patient
      // is actually under 13 — the one case the user asked to flag — so a typical adult patient's
      // canvas open pays zero extra fetch cost for this half of the check.
      st.hasNoNok = !st.linkedCards.some((lc) => lc.isNextOfKin);
      st.isUnder13 = typeof indexAge === 'number' && indexAge < 13;
      st.hasNoCopyCorrespondenceU13 = false;
      if (st.isUnder13 && st.linkedCards.length) {
        const ccResults = await Promise.all(
          st.linkedCards.map((lc) =>
            lc.relationshipId
              ? window.ContactsApi.viewPatientContact(st.apiBase, lc.relationshipId).catch(() => null)
              : Promise.resolve(null)
          )
        );
        if (st !== cs) return;
        const hasAnyCopyCorrespondence = ccResults.some((r) => r && r.patientContactRelationshipCopyCorrespondence);
        st.hasNoCopyCorrespondenceU13 = !hasAnyCopyCorrespondence;
      }

      // Step 1.5 — transitive candidates from patients who list THIS patient as their own contact
      // ("Listed as Contact For" — patientLinkedContactsSection, already fetched above as part of
      // `details`, no extra call for the list itself). For each such related "hub" patient, the
      // pool draws on BOTH directions of THEIR OWN patient-details response (also no extra fetch —
      // both sections are already in the one response per hub): who the hub has themselves added
      // as a contact, AND who else lists the HUB as their own contact — the identical "Listed as
      // Contact For" relationship that found this hub via A, just one hop further out. Both are a
      // much higher-confidence candidate source for A's manual contacts than a free-text
      // patient-finder search or a same-address coincidence — they come from an already-established
      // real relationship, not a guess. Pooled from ALL related patients (typically 0-2, cheap in
      // parallel). A manual contact matched here (score >= 40, i.e. not just "weak" — see
      // buildPhoneRows-style tier thresholds in ContactMatch) skips the generic search entirely,
      // rather than duplicating the API call and offering a redundant, lower-confidence suggestion
      // alongside a better one. Any pooled contact matched to no manual contact at all is still
      // surfaced (transitiveCards, below) rather than silently dropped — that's the whole point of
      // pulling this in.
      const relatedPatients =
        (details.patientLinkedContactsSection && details.patientLinkedContactsSection.patientContacts) || [];
      const transitivePool = [];
      // Hoisted above the `if` below (rather than declared inside it) so the grandparents step
      // further down — which can add to the pool even when `relatedPatients` is empty, e.g. a
      // placed parent whose OWN record has no reciprocal "Listed as Contact For" link back to this
      // patient at all — shares the same dedup set rather than needing its own. patientDetailsCache
      // lets that same step reuse a placed parent's own patient-details for free when they're
      // ALSO a related patient (reciprocal link exists) rather than re-fetching.
      const seenPatientIds = new Set();
      const patientDetailsCache = new Map();
      if (relatedPatients.length) {
        const relatedDetails = await Promise.all(
          relatedPatients.map((rp) =>
            window.ContactsApi.getPatientDetails(st.apiBase, rp.linkedPatientId).catch((err) => {
              // Not silent: a related patient contributing nothing to the pool is
              // indistinguishable from "no useful contacts on their record" unless this is visible
              // — logged, not swallowed, so a pattern (e.g. every failure being a different-address
              // or different-practice patient) is diagnosable from the console rather than guessed at.
              console.warn(
                `[Contacts canvas] Could not fetch related patient "${rp.linkedPatientContactName}"'s own contacts — excluded from the pool:`,
                err && err.message
              );
              return null;
            })
          )
        );
        if (st !== cs) return;
        relatedPatients.forEach((rp, i) => patientDetailsCache.set(rp.linkedPatientId, relatedDetails[i]));
        // PASS 1 — every related patient THEMSELVES, for ALL of them, before anyone's sub-lists
        // are processed below. This is the strongest possible evidence: no matching/guessing
        // needed at all, since rp.patientContactRelationship is exactly the entry
        // findExistingReciprocal/suggestForwardFromReciprocal already look for once dropped onto a
        // slot — genderIdentity (from this same already-fetched patient-details, no extra call) is
        // what lets that inversion pick "Son" vs "Daughter" correctly instead of falling back to
        // ambiguous. Doing this as ITS OWN pass, not interleaved with pass 2 below, matters: if a
        // son both lists his father directly AND appears on his mother's own contact list, and the
        // mother happened to come first in relatedPatients, an interleaved single pass would add
        // him via the mother's (weaker) sub-list before ever reaching his own (stronger) entry —
        // this pass guarantees every direct entry is staked out first, regardless of array order.
        // Excludes anyone already a real direct link (e.g. a bidirectionally-linked partner also
        // appears here, but there's nothing left to offer for them).
        relatedDetails.forEach((rd, i) => {
          const rp = relatedPatients[i];
          if (alreadyKnownIds.has(rp.linkedPatientId) || seenPatientIds.has(rp.linkedPatientId)) return;
          seenPatientIds.add(rp.linkedPatientId);
          transitivePool.push({
            patientId: rp.linkedPatientId,
            name: rp.linkedPatientContactName,
            genderIdentity: rd && rd.patientDetailsSection && rd.patientDetailsSection.genderIdentity,
            // Free — already part of this same fetched patient-details response, not a separate
            // call. Only ever displayed if a name collision makes it worth showing (see loadCanvas'
            // collidingIds check below) — kept on the card either way since it cost nothing extra.
            address: formatAddressLine(
              rd &&
                rd.patientAddressSection &&
                rd.patientAddressSection.patientAddresses[0] &&
                rd.patientAddressSection.patientAddresses[0].address
            ),
            phone: rd && window.ContactRelationships.extractPreferredPhone(rd),
            email: rd && window.ContactRelationships.extractPreferredEmail(rd),
            hint: `Lists this patient as their own "${rp.patientContactRelationship}"`,
          });
        });
        // PASS 2 — each related patient's own sub-lists, now that every direct entry has already
        // staked its claim above.
        relatedDetails.forEach((rd, i) => {
          if (!rd) return; // best-effort per related patient — one failure doesn't lose the rest
          const viaName = relatedPatients[i].linkedPatientContactName;
          // Direction 1: contacts the hub has themselves added (patientContactsSection — mixes
          // manual and real, patientContactPatientId set only for the real ones).
          const theirContacts = (rd.patientContactsSection && rd.patientContactsSection.patientContacts) || [];
          for (const c of theirContacts) {
            if (!c.patientContactPatientId) continue; // only real links are transitively useful
            if (c.patientContactPatientId === st.patientId) continue; // that's the index patient themselves
            if (alreadyKnownIds.has(c.patientContactPatientId)) continue; // A already has this real link directly
            if (seenPatientIds.has(c.patientContactPatientId)) continue;
            seenPatientIds.add(c.patientContactPatientId);
            transitivePool.push({
              patientId: c.patientContactPatientId,
              name: c.patientContactName,
              // "recorded as" here is the HUB's own label for THIS CONTACT (e.g. hub calls them
              // "Father") — unlike A's relationship to them, this label DOES genuinely describe
              // the contact's own role, so it's a valid (zero-cost, no extra fetch) source for
              // their gender too — see genderFromRelationshipLabel. Direction 2 below is NOT the
              // same: there the label describes the HUB's role as seen by the OTHER patient, never
              // that patient's own gender, so no gender is derived for it.
              genderIdentity: genderFromRelationshipLabel(c.patientContactRelationship),
              // Same reasoning as gender just above: this label genuinely describes the contact's
              // own role (not the hub's), so it's a valid, zero-cost source for a deceased flag
              // too — e.g. hub recorded them as "Father (RIP)".
              deceased: window.ContactRelationships.isDeceasedRelationshipText(c.patientContactRelationship),
              hint: `via ${viaName}'s own contacts (recorded there as "${c.patientContactRelationship}")`,
            });
          }
          // Direction 2: OTHER patients who list the hub as THEIR OWN contact — the same "Listed
          // as Contact For" relationship that found this hub via A in the first place, just one
          // hop further out. Free: already present in this same patient-details response
          // (patientLinkedContactsSection), no extra fetch. Inherently a real link (a manual
          // contact has no patientContactPatientId, so it could never appear here at all) — no
          // filter needed for that, unlike direction 1 above. At least as high-confidence as A's
          // own "Listed as Contact For" entries were, and stronger than a same-address coincidence
          // — a patient already recorded on ANOTHER real patient's record is not a guess.
          const alsoListedFor =
            (rd.patientLinkedContactsSection && rd.patientLinkedContactsSection.patientContacts) || [];
          for (const c of alsoListedFor) {
            if (c.linkedPatientId === st.patientId) continue; // that's the index patient themselves
            if (alreadyKnownIds.has(c.linkedPatientId)) continue; // A already has this real link directly
            if (seenPatientIds.has(c.linkedPatientId)) continue;
            seenPatientIds.add(c.linkedPatientId);
            transitivePool.push({
              patientId: c.linkedPatientId,
              name: c.linkedPatientContactName,
              // Here "recorded as" is THIS contact's own label for the hub, not A's relationship
              // to either of them — still just informational context, same as direction 1.
              hint: `also lists ${viaName} as their own "${c.patientContactRelationship}"`,
            });
          }
        });
      }

      // Step 1.6 — grandparents. A placed parent's OWN linked parents are this patient's
      // grandparents (maternal via the mother, paternal via the father) — deterministic, not a
      // fuzzy guess, given the innermost relationship (the parent's own mother/father) is itself
      // already recognised. Found live: this didn't happen automatically even when the parent WAS
      // correctly placed in the tree, because Direction 1 above only ever reaches a hub's own
      // contacts when the hub is a "related patient" — i.e. when the RECIPROCAL "Listed as Contact
      // For" link exists on the parent's own record too. Plenty of real parent links predate this
      // tool (created via Medicus's native UI, or the older bulk-import wizard, which historically
      // only ever wrote the forward direction) and never got a reciprocal written, so the parent's
      // own record was never reached by Direction 1 at all. Fetched explicitly here instead, for
      // exactly the placed parent(s) — reusing patientDetailsCache when one is ALSO already a
      // related patient, rather than a duplicate fetch. How to intuit a side for a grandparent
      // reached any OTHER way (no placed parent to hang it off) is real, separate, scoped-for-later
      // work — this only ever fires off an ALREADY-recognised parent-child relationship, nothing
      // fuzzier.
      const placedParentEdges = (st.tree.slots.parents || []).filter(
        (e) => e.baseId === 'mother' || e.baseId === 'father'
      );
      if (placedParentEdges.length) {
        const parentDetailsList = await Promise.all(
          placedParentEdges.map((edge) => {
            if (patientDetailsCache.has(edge.cardId)) return Promise.resolve(patientDetailsCache.get(edge.cardId));
            return window.ContactsApi.getPatientDetails(st.apiBase, edge.cardId).catch((err) => {
              console.warn(
                `[Contacts canvas] Could not fetch this patient's own parent's record — grandparents on that side excluded:`,
                err && err.message
              );
              return null;
            });
          })
        );
        if (st !== cs) return;
        placedParentEdges.forEach((edge, i) => {
          const rd = parentDetailsList[i];
          if (!rd) return; // best-effort per parent — one failure doesn't lose the other side
          const side = edge.baseId === 'mother' ? 'Maternal' : 'Paternal';
          const parentCard = st.linkedCards.find((c) => c.id === edge.cardId);
          const parentName = (parentCard && parentCard.name) || 'this parent';
          const theirContacts = (rd.patientContactsSection && rd.patientContactsSection.patientContacts) || [];
          for (const c of theirContacts) {
            if (!c.patientContactPatientId) continue; // only a real link on the parent's own record composes
            if (c.patientContactPatientId === st.patientId) continue; // that's the index patient themselves
            // Only the parent's OWN mother/father composes into a grandparent for A — anything
            // else on the parent's own contact list (a sibling, a friend, their own partner) isn't
            // one, and Direction 1 above already offers those on their own general merits anyway.
            const theirGuess = window.ContactRelationships.normaliseFreeText(c.patientContactRelationship);
            if (!theirGuess || (theirGuess.baseId !== 'mother' && theirGuess.baseId !== 'father')) continue;
            // Recorded BEFORE the alreadyKnownIds/seenPatientIds checks below, and unconditionally
            // on them — found live: a grandparent already directly linked to A from before this
            // step existed (so never needed "discovering" as a pool candidate at all) was skipping
            // this entirely, since it used to sit after those checks' own `continue`s. renderTree's
            // nesting (grandparentsPairHtml) needs this association regardless of whether the
            // grandparent is a fresh suggestion or an already-real link — see the field's own
            // comment in blankCanvasState.
            st.grandparentViaParent.set(c.patientContactPatientId, edge.cardId);
            if (alreadyKnownIds.has(c.patientContactPatientId)) continue; // A already has this real link directly — nothing to suggest
            if (seenPatientIds.has(c.patientContactPatientId)) continue;
            seenPatientIds.add(c.patientContactPatientId);
            const guessedBaseId = theirGuess.baseId === 'mother' ? 'grandmother' : 'grandfather';
            transitivePool.push({
              patientId: c.patientContactPatientId,
              name: c.patientContactName,
              genderIdentity: theirGuess.baseId === 'mother' ? 'f' : 'm',
              // The one case in this whole pool where the guess is confident enough to pre-fill
              // the confirm panel's relationship picker outright (buildConfirmForCard), rather than
              // only ever showing as an informational hint the user has to translate themselves —
              // still fully editable there, never force-applied.
              guessedBaseId,
              deceased: window.ContactRelationships.isDeceasedRelationshipText(c.patientContactRelationship),
              hint: `${side} grandparent — ${parentName}'s own ${c.patientContactRelationship}`,
            });
          }
        });
      }

      // Step 1.6b — composition via a cycling hub. When this patient was reached BY cycling (see
      // the "Family cycling" section near close()), the hub patient A who led us here already has a
      // fully-built tree sitting in st.familySession.byPatient (setTreeFor, called right before the
      // navigation in advanceToNextFamilyMember) — no fresh fetch needed to discover WHO the other
      // candidates are, unlike the existing Step 1.6 grandparents-via-placed-parent above, which
      // fetches a placed parent's own record fresh every time. A tree edge only ever carries
      // cardId/baseId/modifierId, not a name or gender, though (engine/contact-tree.js keeps that
      // minimal on purpose) — so each candidate still needs its own bounded patient-details fetch,
      // same as every other pool source in this function, just to get a name and a gender hint for
      // composeViaHub's reversed-partner case. Finds the hub's edge that named THIS patient, then
      // composes every one of the hub's OTHER edges against it via ContactRelationships.
      // composeViaHub — the narrow, structurally-safe set only (grandparent/grandchild, in-law; see
      // that function's own comment for what's deliberately excluded and why).
      if (st.familySession) {
        const hubId = Object.keys(st.familySession.byPatient).find((id) => {
          const hubTree = st.familySession.byPatient[id];
          return (hubTree.edges || []).some((e) => e.cardId === st.patientId);
        });
        if (hubId) {
          const hubTree = st.familySession.byPatient[hubId];
          const bEdge = hubTree.edges.find((e) => e.cardId === st.patientId);
          const hubCard = st.linkedCards.find((c) => c.id === hubId);
          const candidateEdges = hubTree.edges.filter(
            (xEdge) =>
              xEdge.cardId !== st.patientId && !alreadyKnownIds.has(xEdge.cardId) && !seenPatientIds.has(xEdge.cardId)
          );
          if (candidateEdges.length) {
            const candidateDetailsList = await Promise.all(
              candidateEdges.map((xEdge) => {
                if (patientDetailsCache.has(xEdge.cardId)) {
                  return Promise.resolve({ rd: patientDetailsCache.get(xEdge.cardId), inactive: false });
                }
                return window.ContactsApi.getPatientDetails(st.apiBase, xEdge.cardId).then(
                  (rd) => ({ rd, inactive: false }),
                  (err) => ({ rd: null, inactive: !!(err && err.errorCode === 'inactive-patient-access') })
                );
              })
            );
            if (st !== cs) return;
            candidateEdges.forEach((xEdge, i) => {
              if (seenPatientIds.has(xEdge.cardId)) return; // could have been added by an earlier source above
              const { rd, inactive } = candidateDetailsList[i];
              const xGenderIdentity = rd && rd.patientDetailsSection && rd.patientDetailsSection.genderIdentity;
              const composed = window.ContactRelationships.composeViaHub(xEdge, bEdge, xGenderIdentity);
              if (!composed) return;
              seenPatientIds.add(xEdge.cardId);
              transitivePool.push({
                patientId: xEdge.cardId,
                name: (rd && rd.patientDetailsSection && rd.patientDetailsSection.fullOfficialName) || xEdge.cardId,
                genderIdentity: xGenderIdentity,
                guessedBaseId: composed.baseId,
                // Composed, not free-text sourced — there's no "(RIP)" marker to read here the way
                // the other pool sources do (isDeceasedRelationshipText), so this can never be
                // TRUE. inactive IS a real, if narrower, signal though: the fetch above 403ing as
                // inactive-patient-access means this candidate's own record can't currently be
                // opened at all (see cardHtml's recordInactive badge) — worth surfacing even though
                // it isn't the same thing as confirmed-deceased.
                deceased: false,
                recordInactive: inactive,
                hint: `Composed via ${(hubCard && hubCard.name) || 'the previous family member'}'s own ${window.ContactRelationships.formatLabel(xEdge.baseId, xEdge.modifierId)}`,
              });
            });
          }
        }
      }

      // Step 1.8 — family-cycling pool + every placed card's age. Every already-linked contact
      // placed in the tree (st.tree.edges — locked edges only, see buildLockedTree; a linked-but-
      // unclassified contact with no canonical baseId never gets a tree slot at all, so isn't
      // covered here — same narrower-first scoping as the composition work, see the parked memory
      // note) is a candidate for "Next family member", AND gets its dob resolved to an age for
      // cardHtml's own bracket-after-name display (originally only fetched for the Children slot,
      // extended here to every placed card once this same fetch already covers all of them — see
      // cardHtml's own comment on why only under-18). Reuses patientDetailsCache for free wherever a
      // parent/child/related-patient fetch above already covered them, a fresh bounded fetch
      // otherwise — still enqueued/aged even when the fetch fails, so a candidate isn't silently
      // dropped from the pool just for having an unknown dob (it sorts last instead, per
      // enqueueFamilyMember). Whether a candidate is actually openable is a SEPARATE question, only
      // really consequential once cycling reaches them (advanceToNextFamilyMember's own skip loop)
      // — but an inactive-access 403 discovered here, for free, is still worth badging immediately
      // rather than thrown away (see cardHtml's recordInactive handling) — no reason to wait for a
      // cycling attempt to surface something already visible on this canvas right now.
      const poolEdges = st.tree.edges || [];
      if (poolEdges.length) {
        const poolDetailsList = await Promise.all(
          poolEdges.map((edge) => {
            if (patientDetailsCache.has(edge.cardId)) {
              return Promise.resolve({ rd: patientDetailsCache.get(edge.cardId), inactive: false });
            }
            return window.ContactsApi.getPatientDetails(st.apiBase, edge.cardId).then(
              (rd) => {
                patientDetailsCache.set(edge.cardId, rd); // wasn't cached before — save it so Step 1.9 below (and anything later) reuses it for free
                return { rd, inactive: false };
              },
              (err) => ({ rd: null, inactive: !!(err && err.errorCode === 'inactive-patient-access') })
            );
          })
        );
        if (st !== cs) return;
        poolEdges.forEach((edge, i) => {
          const { rd, inactive } = poolDetailsList[i];
          const dob = rd && rd.patientDetailsSection && rd.patientDetailsSection.dateOfBirth;
          st.familySession = window.ContactTree.enqueueFamilyMember(st.familySession, edge.cardId, dob || null);
          const lc = st.linkedCards.find((c) => c.id === edge.cardId);
          if (lc) {
            if (inactive) lc.recordInactive = true;
            const age = candidateAgeFromDob(dob);
            if (age !== null) lc.age = age;
          }
        });
      }

      // Step 1.8b — age for every OTHER linked contact, not just tree-placed ones. Step 1.8 above
      // only covers st.tree.edges — a linked contact whose relationship text didn't parse to a
      // recognised baseId never gets a tree slot at all, so was never touched there, even though
      // it can still appear as an "already linked" review-match candidate in renderSources
      // (linkedMatchesByManualId) — found live: age-in-brackets wasn't showing on those "pre-
      // matched" cards. Reuses patientDetailsCache for anyone an earlier step already fetched; a
      // fresh bounded fetch for the rest.
      const unagedLinkedCards = st.linkedCards.filter((lc) => lc.age == null);
      if (unagedLinkedCards.length) {
        const unagedDetailsList = await Promise.all(
          unagedLinkedCards.map((lc) => {
            if (patientDetailsCache.has(lc.id)) return Promise.resolve(patientDetailsCache.get(lc.id));
            return window.ContactsApi.getPatientDetails(st.apiBase, lc.id).catch(() => null);
          })
        );
        if (st !== cs) return;
        unagedLinkedCards.forEach((lc, i) => {
          const rd = unagedDetailsList[i];
          const age = candidateAgeFromDob(rd && rd.patientDetailsSection && rd.patientDetailsSection.dateOfBirth);
          if (age !== null) lc.age = age;
        });
      }

      // Step 1.9 — shared contact info (hub patient vs each linked contact placed in the tree,
      // same scope as Step 1.8). A patient sharing a non-Home phone or an email with one of their
      // own linked contacts is a known data-quality/confidentiality risk in this population — see
      // ContactRelationships.findSharedContactInfo's own comment for the full reasoning. Reuses
      // patientDetailsCache (now populated by Step 1.8 above, whether from a fresh fetch or an
      // earlier step) — no extra fetch needed here at all.
      if (poolEdges.length) {
        const cis = details.patientContactInformationSection;
        const indexPatientForShare = {
          name: details.displayName,
          phones: (cis && cis.patientTelephoneNumbers) || [],
          emails: (cis && cis.patientEmailAddresses) || [], // raw entries — findSharedContactInfo needs emailAddressType to exclude Home, not just the address string
        };
        poolEdges.forEach((edge) => {
          const rd = patientDetailsCache.get(edge.cardId);
          if (!rd) return; // fetch failed (inactive or otherwise) — nothing to compare against
          const rcis = rd.patientContactInformationSection;
          const shared = window.ContactRelationships.findSharedContactInfo(indexPatientForShare, {
            name: rd.displayName,
            phones: (rcis && rcis.patientTelephoneNumbers) || [],
            emails: (rcis && rcis.patientEmailAddresses) || [],
          });
          if (!shared) return;
          const lc = st.linkedCards.find((c) => c.id === edge.cardId);
          if (lc) lc.sharedContactInfo = shared; // lc.age is already set by Step 1.8 above — no need for a second age field
        });
      }

      const transitiveMatchByManualId = new Map();
      const manualCardsNeedingSearch = [];
      for (const mc of st.manualCards) {
        if (mc.isBlank) continue; // no name to search or match against — see renderSources' dedicated Delete treatment
        const match = bestTransitiveMatchFor(mc, transitivePool);
        if (match && match.score >= 40) transitiveMatchByManualId.set(mc.id, match);
        else manualCardsNeedingSearch.push(mc);
      }

      // One-or-more patient-finder searches per manual contact THAT HAS NO TRANSITIVE MATCH, run
      // in parallel, ranked against THAT specific manual contact and tagged with which one
      // suggested it (drives the colour match). ContactMatch.nameSearchQueries fires MULTIPLE query
      // variants when the name has 3+ tokens — live-tested finding: a manual contact with a middle
      // name (e.g. "John Bates Smith") searched as one raw string was missing real matches, since
      // it's genuinely ambiguous whether "Bates" is a true middle name (Medicus's own search
      // wouldn't contain it at all) or part of a compound surname "Bates Smith" (a plain 3-word
      // query doesn't reliably find that either). Results from every variant for a manual contact
      // are merged by patientId before scoring, so a candidate found via any one of them is
      // included exactly once — nothing here auto-applies anything, every candidate still goes
      // through the same ranking/scoring below and is only ever a human-confirmed-by-drag
      // suggestion, so casting a wider net has no downside beyond a couple of extra fetches.
      const searchResults = await Promise.all(
        manualCardsNeedingSearch.map((mc) => {
          const queries = window.ContactMatch.nameSearchQueries(mc.name);
          return Promise.all(queries.map((q) => window.ContactsApi.searchPatients(st.apiBase, q).catch(() => []))).then(
            (resultLists) => {
              const merged = new Map();
              for (const list of resultLists) for (const r of list) merged.set(r.patientId, r);
              return { mc, results: Array.from(merged.values()) };
            }
          );
        })
      );
      if (st !== cs) return;

      const bestByPatientId = new Map();
      for (const { mc, results } of searchResults) {
        const candidates = results.map((r) => ({
          patientId: r.patientId,
          displayName: r.displayName,
          dateOfBirth: r.dateOfBirth,
          age: candidateAgeFromDob(r.dateOfBirth),
          genderIdentity: r.genderIdentity,
          atSameAddress: sameAddress(indexAddress, r.address),
        }));
        const ranked = window.ContactMatch.rankCandidates(
          { name: mc.name },
          candidates.filter((c) => !alreadyKnownIds.has(c.patientId)),
          {
            manualRelationshipGuess: window.ContactRelationships.normaliseFreeText(mc.relationshipText),
            indexPatientAge: indexAge,
          }
        ).slice(0, 3);
        for (const r of ranked) {
          const existing = bestByPatientId.get(r.candidate.patientId);
          if (!existing || r.score > existing.score) {
            bestByPatientId.set(r.candidate.patientId, {
              id: r.candidate.patientId,
              name: r.candidate.displayName,
              dateOfBirth: r.candidate.dateOfBirth,
              age: r.candidate.age, // was computed above (candidateAgeFromDob) but never actually copied onto this object — cardHtml's age-in-brackets display silently had nothing to read for every search-sourced suggestion
              genderIdentity: r.candidate.genderIdentity,
              atSameAddress: r.candidate.atSameAddress,
              score: r.score,
              tier: r.tier,
              colour: mc.colour,
              forManualId: mc.id,
            });
          }
        }
      }
      // Fold the transitive matches in as suggestions too, using the SAME suggestedCards shape —
      // `hint` drives a distinguishing sub-label in renderSources() instead of the usual tier·score.
      for (const [manualId, match] of transitiveMatchByManualId) {
        const mc = st.manualCards.find((c) => c.id === manualId);
        bestByPatientId.set(match.patientId, {
          id: match.patientId,
          name: match.name,
          address: match.address || null,
          phone: match.phone || null,
          email: match.email || null,
          genderIdentity: match.genderIdentity || null,
          atSameAddress: false,
          score: match.score,
          tier: match.tier,
          colour: mc.colour,
          forManualId: manualId,
          hint: match.hint,
          guessedBaseId: match.guessedBaseId || null,
          deceased: !!match.deceased,
          recordInactive: !!match.recordInactive,
        });
      }
      st.suggestedCards = Array.from(bestByPatientId.values()).sort((a, b) => b.score - a.score);

      // Anyone from the transitive pool who matched no manual contact at all — a real relative
      // this patient has no record of yet, not even a manual one. Surfaced on its own rather than
      // dropped, since that's the whole reason for pulling this in.
      const suggestedIds = new Set(st.suggestedCards.map((c) => c.id));
      st.transitiveCards = transitivePool
        .filter((t) => !alreadyKnownIds.has(t.patientId) && !suggestedIds.has(t.patientId))
        .map((t) => ({
          id: t.patientId,
          name: t.name,
          genderIdentity: t.genderIdentity,
          address: t.address || null,
          phone: t.phone || null,
          email: t.email || null,
          hint: t.hint,
          guessedBaseId: t.guessedBaseId || null,
          deceased: !!t.deceased,
          recordInactive: !!t.recordInactive,
        }));

      // Same-name collision check — e.g. two genuinely different real patients both named "John
      // Smith" surfacing as separate candidates (one via the transitive pool, one already linked,
      // or two search results) with nothing else to tell them apart. Only in that specific case is
      // extra disambiguating detail worth showing: grouped by exact name across every candidate
      // card currently on screen (suggested, transitive, and already-linked "review" matches), and
      // only names mapping to MORE THAN ONE distinct patient id get flagged. Address/phone/email
      // already known for free (a transitive pool entry sourced from an already-fetched hub — see
      // above) are reused as-is; only a genuinely missing set triggers an extra per-candidate
      // fetch, and only for the small, bounded set of colliding candidates — never routinely for
      // every card, which is what the user explicitly asked this NOT to become. DOB was tried
      // first here but dropped — see formatAddressLine's comment for why it doesn't help.
      const allCandidateCards = [...st.suggestedCards, ...st.transitiveCards, ...st.linkedCards];
      const idsByName = new Map();
      for (const c of allCandidateCards) {
        const key = (c.name || '').trim().toLowerCase();
        if (!key) continue;
        if (!idsByName.has(key)) idsByName.set(key, new Set());
        idsByName.get(key).add(c.id);
      }
      const collidingIds = new Set();
      for (const ids of idsByName.values()) {
        if (ids.size > 1) for (const id of ids) collidingIds.add(id);
      }
      if (collidingIds.size) {
        const needsDetail = allCandidateCards.filter(
          (c) => collidingIds.has(c.id) && !c.address && !c.phone && !c.email
        );
        const fetchedDetails = await Promise.all(
          needsDetail.map((c) =>
            window.ContactsApi.getPatientDetails(st.apiBase, c.id)
              .then((d) => ({
                address: formatAddressLine(
                  d.patientAddressSection &&
                    d.patientAddressSection.patientAddresses[0] &&
                    d.patientAddressSection.patientAddresses[0].address
                ),
                phone: window.ContactRelationships.extractPreferredPhone(d),
                email: window.ContactRelationships.extractPreferredEmail(d),
              }))
              .catch(() => ({ address: null, phone: null, email: null }))
          )
        );
        if (st !== cs) return;
        needsDetail.forEach((c, i) => {
          c.address = fetchedDetails[i].address;
          c.phone = fetchedDetails[i].phone;
          c.email = fetchedDetails[i].email;
        });
        for (const c of allCandidateCards) {
          if (collidingIds.has(c.id)) c.ambiguousName = true;
        }
      }

      // The candidates above are now disambiguated, but that only helps once the user already
      // knows which manual contact card they belong to — the whole point is deciding which of
      // several same-named candidates to drag onto WHICH manual card, so the manual side needs
      // the same comparison points too (found live: "for this to be useful... we also need to
      // show this on the manual contact cards"). Scoped to `suggestedCards` only (every entry
      // there already carries `forManualId` and, from the check above, `ambiguousName`) — an
      // already-linked "review" match's manual pairing is computed lazily per-render
      // (bestManualMatchFor), not worth the extra complexity here for the same rare case.
      // `viewPatientContact` is the same endpoint/shape `startMerge` already uses for the merge
      // panel's own phone/email rows — confirmed live there, not a new guess — fetched here only
      // for the small, bounded set of manual contacts actually affected, never routinely.
      const manualIdsNeedingDetail = new Set(
        st.suggestedCards.filter((c) => c.ambiguousName && c.forManualId).map((c) => c.forManualId)
      );
      if (manualIdsNeedingDetail.size) {
        const manualsNeedingDetail = st.manualCards.filter((mc) => manualIdsNeedingDetail.has(mc.id));
        const fetchedManualDetails = await Promise.all(
          manualsNeedingDetail.map((mc) =>
            window.ContactsApi.viewPatientContact(st.apiBase, mc.id)
              .then((d) => ({
                address: formatAddressLine(
                  d.patientContactAddress && (d.patientContactAddress.value || d.patientContactAddress)
                ),
                phone: manualPhoneSummary(d),
                email: (d.patientContactEmailAddress && d.patientContactEmailAddress.value) || null,
              }))
              .catch(() => ({ address: null, phone: null, email: null }))
          )
        );
        if (st !== cs) return;
        manualsNeedingDetail.forEach((mc, i) => {
          mc.address = fetchedManualDetails[i].address;
          mc.phone = fetchedManualDetails[i].phone;
          mc.email = fetchedManualDetails[i].email;
          mc.ambiguousName = true;
        });
      }

      // "Also at this address": other patients registered at the index patient's own home address,
      // minus anyone already surfaced as a suggestion (suggestedCards OR transitiveCards — a
      // same-address coincidence is weaker evidence than either, so it must never duplicate a card
      // already shown via one of them). Minimal shape ({id, displayName} only) — no scoring
      // signals available from this endpoint, so no ranking here, just a plain list.
      const alreadySurfacedIds = new Set([...suggestedIds, ...st.transitiveCards.map((c) => c.id)]);
      const addressId =
        details.patientAddressSection &&
        details.patientAddressSection.patientAddresses[0] &&
        details.patientAddressSection.patientAddresses[0].addressId;
      if (addressId) {
        try {
          const overview = await window.ContactsApi.getAddressOverview(st.apiBase, addressId);
          if (st !== cs) return;
          st.addressCards = (overview.alsoAtThisAddress || [])
            .filter((p) => !alreadyKnownIds.has(p.id) && !alreadySurfacedIds.has(p.id))
            .map((p) => ({ id: p.id, name: p.displayName }));
        } catch (_) {
          st.addressCards = []; // best-effort only — the rest of the canvas still works
        }
      }

      st.loading = false;
    } catch (err) {
      st.error = err.message || 'Failed to load this patient’s contacts.';
      st.loading = false;
    } finally {
      if (st === cs) render();
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────────────────────

  // sharedContactInfoDetailHtml(card) — the expanded detail shown under a linked contact's card
  // when ContactRelationships.findSharedContactInfo flagged something (loadCanvas' Step 1.9).
  // Detection only, never resolves whose number/email it "really" is — surfaces the same two
  // hints the user asked for directly ("it is often clear from the email itself who it belongs
  // to, or from the patient's age that they don't have their own mobile phone"), then leaves the
  // judgement call to the GP. No "fix" shortcut wired up here: the phone-edit machinery
  // (startPhoneEdit/savePhoneEdit) is tightly coupled to an active merge-compare session
  // (cs.pendingMerge) elsewhere in this file, and this badge shows on an already-linked tree card
  // outside that flow — a real gap if a one-click fix turns out to matter in practice, worth
  // revisiting once this has been live-tested.
  function sharedContactInfoDetailHtml(card) {
    const shared = card.sharedContactInfo;
    if (!shared) return '';
    const lines = [];
    for (const p of shared.phones) {
      lines.push(`Shares phone ${p} with this patient`);
    }
    for (const e of shared.emails) {
      const owner =
        e.ownerHint === 'a'
          ? " — looks like it may be this patient's own"
          : e.ownerHint === 'b'
            ? ` — looks like it may be ${card.name}'s own`
            : '';
      lines.push(`Shares email ${e.email} with this patient${owner}`);
    }
    // No separate "ages" line here any more — cardHtml itself now shows an under-18 card's age in
    // brackets after their name (see that function), so it's already visible on the card without
    // needing to expand this detail block at all.
    return `<div class="ms-cv-card-sub ms-cv-shared-info">${lines.map((l) => `<div>${esc(l)}</div>`).join('')}</div>`;
  }

  function cardHtml(card, kind, opts) {
    opts = opts || {};
    // locked: true forces non-draggable regardless of the `draggable` opt — used both for a manual
    // card once it's been merged (the ONLY way to finish is dragging its outlined Medicus
    // counterpart to a slot, never the faded manual card itself a second time) and for every
    // already-linked card pre-placed into a tree slot (an immutable fact for this session).
    const draggable = !opts.locked && opts.draggable !== false;
    // Checked here, once, rather than at every individual cardHtml call site — `card.deceased` is
    // set at load time wherever relationship free text is available (manual/linked cards, and the
    // transitive/grandparent pools — see ContactRelationships.isDeceasedRelationshipText) and
    // simply absent everywhere else (address cards, a plain search result with no relationship
    // text at all), so this is safe to check unconditionally on every card. `card.recordInactive`
    // is the same idea for a different signal: set when a fetch for this linked contact 403s as
    // inactive-patient-access (loadCanvas' Step 1.8, advanceToNextFamilyMember's cycling skip loop)
    // — surfaced rather than silently discarded, since a dead next-of-kin still listed as an
    // emergency contact is something a GP should be able to see, not just something cycling quietly
    // skips past. `card.sharedContactInfo` (Step 1.9) is the same idea for a third signal — see
    // sharedContactInfoDetailHtml for the expanded detail shown underneath the card.
    const badgeText =
      (opts.badge || '') +
      (card.deceased ? ' · Deceased' : '') +
      (card.recordInactive ? ' · Inactive record' : '') +
      (card.sharedContactInfo ? ' · Shares contact info' : '');
    const badge = badgeText ? `<span class="ms-cv-badge">${esc(badgeText)}</span>` : '';
    const sub = opts.sub ? `<div class="ms-cv-card-sub">${esc(opts.sub)}</div>` : '';
    const stateClass = opts.faded ? ' ms-cv-card-faded' : opts.outlined ? ' ms-cv-card-outlined' : '';
    // Age in brackets after the name, e.g. "Jamie (8)" — originally only shown for the Children
    // slot (loadCanvas Step 1.7), extended to every card once Step 1.8 started fetching a dob for
    // every placed card anyway (family-cycling needed it regardless). NOT capped to under-18s —
    // an earlier under-18 restriction here was live-caught as the actual reason ages had stopped
    // showing at all: every real test patient available happened to be an adult, so the cap hid
    // every single one, on every card type, uniformly — exactly the symptom reported. Shown for
    // any age, same as the original Children-slot behaviour before this was generalised.
    const ageSuffix = card.age != null ? ` (${card.age})` : '';
    return `
      <div class="ms-cv-card${stateClass}" ${draggable ? `draggable="true" data-card-id="${esc(card.id)}" data-card-kind="${esc(kind)}"` : ''}
           style="border-left-color:${esc(card.colour || NEEDS_REVIEW_COLOUR)}">
        <div class="ms-cv-card-name">${esc(card.name)}${esc(ageSuffix)}${badge}</div>
        ${sub}
        ${sharedContactInfoDetailHtml(card)}
      </div>`;
  }

  // cardsInSlot(slotPath) -> [{ edge, card }] — edges currently placed in a tree slot, each paired
  // with its display card (looked up from linkedCards by id, since an edge only carries
  // cardId/patientId, not name/colour).
  function cardsInSlot(slotPath) {
    if (!cs.tree) return [];
    const slotValue = cs.tree.slots[slotPath];
    const edges = slotPath === 'partner' ? (slotValue ? [slotValue] : []) : slotValue || [];
    return edges.map((edge) => {
      const card = cs.linkedCards.find((c) => c.id === edge.cardId) || {
        id: edge.cardId,
        name: edge.cardId,
        colour: NEEDS_REVIEW_COLOUR,
      };
      return { edge, card };
    });
  }

  // slotHtml(slotPath) — one drop-target box. Populated (locked, non-draggable) cards on top, a
  // "Drop here" placeholder underneath/instead when empty — dropping any draggable card (manual,
  // suggested, or address) here calls tryAssign(id, kind, slotPath), see bindEvents().
  function slotHtml(slotPath) {
    const entries = cardsInSlot(slotPath);
    const cardsHtml = entries
      .map(({ edge, card }) =>
        cardHtml(card, 'linked', {
          draggable: false,
          locked: true,
          sub: window.ContactRelationships.formatLabel(edge.baseId, edge.modifierId),
        })
      )
      .join('');
    return `
      <div class="ms-cv-slot" data-slot-path="${esc(slotPath)}">
        <div class="ms-cv-slot-title">${esc(SLOT_TITLES[slotPath])}</div>
        <div class="ms-cv-slot-body">${cardsHtml}<div class="ms-cv-slot-placeholder">Drop here</div></div>
      </div>`;
  }

  // collapsibleSlotHtml — grandparents/aunts-uncles/other start collapsed behind a "+" button
  // unless already populated or the user has expanded it this session, so an empty canvas isn't
  // dominated by rarely-used rows.
  function collapsibleSlotHtml(slotPath) {
    const entries = cardsInSlot(slotPath);
    if (entries.length || cs.expandedSlots[slotPath]) return slotHtml(slotPath);
    return `<button class="ms-ct-btn-ghost ms-cv-slot-expand" data-expand-slot="${esc(slotPath)}">+ ${esc(SLOT_TITLES[slotPath])}</button>`;
  }

  // branchPlaceholderHtml — the "drop here" list item appended to every branch (see below), always
  // present alongside any already-placed cards so a populated branch stays a valid drop target for
  // one more sibling/parent. Siblings/children never need a hint here — an ever-present trailing
  // "drop here" is already the normal, unsurprising way those rows say "you can add another".
  // Parents is the one row people expect to be capped at exactly two, so a THIRD slot there reads
  // as an anomaly rather than the same normal affordance unless it's labelled — optional `hint`
  // param exists for that (see parentsBranchHtml), not used by any other caller.
  function branchPlaceholderHtml(slotPath, hint) {
    return `<li class="ms-cv-tree-branch-item ms-cv-tree-branch-placeholder" data-slot-path="${esc(slotPath)}">
      <div class="ms-cv-slot-placeholder">Drop here${hint ? `<div class="ms-cv-slot-hint">${esc(hint)}</div>` : ''}</div>
    </li>`;
  }

  // grandparentsPairHtml(forParentCardId) — the 0-2 grandparents composed via THIS specific parent
  // (loadCanvas step 1.6, cs.grandparentViaParent), rendered as their own joined-pair bus ABOVE
  // that parent's own card, nested inside the parent's LI (parentsBranchHtml) rather than a
  // separate row — same "nest inside the specific family member's own item" technique as
  // siblingsAndIndexBranchHtml's children-attach, same reasoning (a connector centred on a ROW's
  // own width, rather than on the specific card it's meant to hang off, drifts apart from it as
  // soon as the row isn't symmetric). Returns '' when this parent has none composed, so an
  // unaffected parent's LI doesn't grow at all — a grandparent with no known parent association at
  // all (dragged in directly rather than composed) shows in unassignedGrandparentsHtml instead.
  function grandparentsPairHtml(forParentCardId) {
    const entries = cardsInSlot('grandparents').filter(
      ({ edge }) => cs.grandparentViaParent.get(edge.cardId) === forParentCardId
    );
    if (!entries.length) return '';
    const items = entries
      .map(
        ({ edge, card }) =>
          `<li class="ms-cv-tree-branch-item" data-slot-path="grandparents">${cardHtml(card, 'linked', {
            draggable: false,
            locked: true,
            sub: window.ContactRelationships.formatLabel(edge.baseId, edge.modifierId),
          })}</li>`
      )
      .join('');
    return `
      <div class="ms-cv-tree-grandparents-attach">
        <ul class="ms-cv-tree-branch ms-cv-tree-branch--below">${items}</ul>
        <div class="ms-cv-connector" aria-hidden="true"></div>
      </div>
    `;
  }

  // unassignedGrandparentsHtml — grandparents with NO known parent association (loadCanvas step
  // 1.6's cs.grandparentViaParent) — dragged in directly (e.g. via search) rather than composed
  // from a placed parent's own record, so there's no specific parent's item to nest them under.
  // Those WITH a known association render nested there instead (grandparentsPairHtml) — excluded
  // here so they're never shown twice. Collapsible, same as every other rarely-used slot, since
  // most families will have nothing left to show here once composition has done its job.
  function unassignedGrandparentsHtml() {
    const unassigned = cardsInSlot('grandparents').filter(({ edge }) => !cs.grandparentViaParent.has(edge.cardId));
    if (!unassigned.length && !cs.expandedSlots.grandparents) {
      return `<button class="ms-ct-btn-ghost ms-cv-slot-expand" data-expand-slot="grandparents">+ ${esc(SLOT_TITLES.grandparents)}</button>`;
    }
    const cardsHtml = unassigned
      .map(({ edge, card }) =>
        cardHtml(card, 'linked', {
          draggable: false,
          locked: true,
          sub: window.ContactRelationships.formatLabel(edge.baseId, edge.modifierId),
        })
      )
      .join('');
    return `
      <div class="ms-cv-slot" data-slot-path="grandparents">
        <div class="ms-cv-slot-title">${esc(SLOT_TITLES.grandparents)}</div>
        <div class="ms-cv-slot-body">${cardsHtml}<div class="ms-cv-slot-placeholder">Drop here</div></div>
      </div>`;
  }

  // parentsBranchHtml — the two parent cards (if both present) joined by a horizontal line BELOW
  // them, with a single shared line continuing down from the midpoint (the pre-existing
  // .ms-cv-connector element, already centred in the same column) rather than one stem per card —
  // this is the "join siblings/peers, one line down from the joining point" variant
  // (.ms-cv-tree-branch--below), the mirror of siblingsAndIndexBranchHtml's "one shared line down,
  // splitting into a stem per child" variant (.ms-cv-tree-branch--above). Each parent's own item
  // also nests that parent's OWN composed grandparents above their card (grandparentsPairHtml) —
  // mirroring the same parent/child joining style one generation up, on whichever side is known.
  function parentsBranchHtml() {
    const entries = cardsInSlot('parents');
    const items = entries
      .map(
        ({ edge, card }) =>
          `<li class="ms-cv-tree-branch-item" data-slot-path="parents">
            ${grandparentsPairHtml(edge.cardId)}
            ${cardHtml(card, 'linked', {
              draggable: false,
              locked: true,
              sub: window.ContactRelationships.formatLabel(edge.baseId, edge.modifierId),
            })}
          </li>`
      )
      .join('');
    // Only hinted once both biological/legal parent slots are already filled — with 0 or 1 placed,
    // this placeholder is just the normal "add a parent" affordance and needs no explanation; it's
    // specifically the THIRD slot (see branchPlaceholderHtml) that reads as an anomaly otherwise.
    const placeholderHint = entries.length >= 2 ? 'Step-parent' : null;
    return `
      <div class="ms-cv-tree-branch-title">Parents</div>
      <ul class="ms-cv-tree-branch ms-cv-tree-branch--below">${items}${branchPlaceholderHtml('parents', placeholderHint)}</ul>
    `;
  }

  // siblingsAndIndexBranchHtml — every sibling card, a "drop new sibling" placeholder, and the
  // index patient's own box, all as children of one shared bus (.ms-cv-tree-branch--above) fed by
  // the single connector line coming down from the parents branch above — so a sibling gets their
  // own individual branch off that line, exactly like the index patient does, rather than being
  // grouped inside one undifferentiated "siblings" box. The index item itself now nests a
  // "couple" — the index card and the partner slot, joined by a shared line BELOW them exactly
  // like parentsBranchHtml joins the two parents — with the children branch hanging from that
  // pairing's own midpoint, not from the index card alone. Found live: the previous design
  // (partner attached off to the side via position:absolute, children hanging straight down from
  // the index card) drew the index<->partner connection as a stray-looking line running across
  // most of the panel width whenever the tree had any siblings pushing the index card away from
  // centre, and didn't reflect that the children below belong to BOTH the index patient and their
  // partner, not just the index patient alone. Nesting the whole couple+children unit inside the
  // index item's own LI keeps it out of the outer siblings+index row's own width/centring the same
  // way the old partner-attach did — the OUTER row only ever sees one combined-width item here,
  // regardless of how wide the couple+children unit itself grows.
  function siblingsAndIndexBranchHtml() {
    const entries = cardsInSlot('siblings');
    const indexName = (cs.indexPatientDetails && cs.indexPatientDetails.displayName) || 'This patient';
    const siblingItems = entries
      .map(
        ({ edge, card }) =>
          `<li class="ms-cv-tree-branch-item" data-slot-path="siblings">${cardHtml(card, 'linked', {
            draggable: false,
            locked: true,
            sub: window.ContactRelationships.formatLabel(edge.baseId, edge.modifierId),
          })}</li>`
      )
      .join('');
    const partnerEntry = cardsInSlot('partner')[0] || null;
    const partnerItem = partnerEntry
      ? `<li class="ms-cv-tree-branch-item" data-slot-path="partner">${cardHtml(partnerEntry.card, 'linked', {
          draggable: false,
          locked: true,
          sub: window.ContactRelationships.formatLabel(partnerEntry.edge.baseId, partnerEntry.edge.modifierId),
        })}</li>`
      : `<li class="ms-cv-tree-branch-item ms-cv-tree-branch-placeholder" data-slot-path="partner">
          <div class="ms-cv-slot-placeholder">Drop here</div>
        </li>`;
    const indexItem = `<li class="ms-cv-tree-branch-item ms-cv-tree-branch-index">
      <ul class="ms-cv-tree-branch ms-cv-tree-branch--below ms-cv-tree-couple">
        <li class="ms-cv-tree-branch-item"><div class="ms-cv-tree-index">${esc(indexName)}</div></li>
        ${partnerItem}
      </ul>
      <div class="ms-cv-tree-children-attach">
        <div class="ms-cv-connector" aria-hidden="true"></div>
        ${childrenBranchHtml()}
      </div>
    </li>`;
    return `<ul class="ms-cv-tree-branch ms-cv-tree-branch--above">${siblingItems}${branchPlaceholderHtml('siblings')}${indexItem}</ul>`;
  }

  // childrenBranchHtml — mirrors siblingsAndIndexBranchHtml's layout (shared bus above, one stem
  // per card) but for the index patient's own children, fed by the connector below the
  // siblings+index row rather than the one above it. Age-in-brackets (e.g. "Jamie (8)") is
  // cardHtml's own doing now, not special-cased here — see that function's comment.
  function childrenBranchHtml() {
    const entries = cardsInSlot('children');
    const items = entries
      .map(
        ({ edge, card }) =>
          `<li class="ms-cv-tree-branch-item" data-slot-path="children">${cardHtml(card, 'linked', {
            draggable: false,
            locked: true,
            sub: window.ContactRelationships.formatLabel(edge.baseId, edge.modifierId),
          })}</li>`
      )
      .join('');
    return `<ul class="ms-cv-tree-branch ms-cv-tree-branch--above">${items}${branchPlaceholderHtml('children')}</ul>`;
  }

  // isPlacedInTree(cardId) -> whether this card already has a real edge somewhere in the tree
  // (locked, pre-placed, or committed this session) — used to decide what still needs surfacing as
  // "not yet placed" below the tree.
  function isPlacedInTree(cardId) {
    return !!(cs.tree && cs.tree.edges.some((e) => e.cardId === cardId));
  }

  function renderTree() {
    // Every already-linked contact (cs.linkedCards) that ISN'T in a tree slot AND has no plausible
    // manual-contact match to be shown next to instead (see renderSources' own use of
    // bestManualMatchFor) — nothing else to compare it against, so it needs a place to be dragged
    // FROM. Plain draggable cards, same as a suggested candidate: dropping one onto a slot captures
    // its relationship there and then, exactly like a brand-new link — no separate "categorise
    // first" step. Sits BELOW the whole tree so it doesn't visually compete with everything that's
    // already placed.
    const unplaced = cs.linkedCards.filter((c) => !isPlacedInTree(c.id) && !bestManualMatchFor(c));
    const unplacedHtml = unplaced.length
      ? `<div class="ms-cv-unplaced">
          <div class="ms-cv-slot-title">Not yet placed in the family tree</div>
          <div class="ms-cv-slot-body">${unplaced
            .map((c) => cardHtml(c, 'medicus', { sub: c.relationshipText || '(no relationship recorded)' }))
            .join('')}</div>
        </div>`
      : '';

    // The core lineage (parents -> siblings+index) is grouped in its own zero-gap column so the
    // connector sits flush against the horizontal join line above it (no dead space from the
    // outer .ms-cv-tree's row gap) and so both rows share exactly the same horizontal centre — see
    // .ms-cv-tree-lineage in the CSS. Children are no longer a third row here — see
    // siblingsAndIndexBranchHtml's own comment for why they're nested inside the index item
    // instead. Grandparents are nested inside the relevant PARENT's own item in parentsBranchHtml
    // for the same reason, wherever the composed side (maternal/paternal) is known — see
    // grandparentsPairHtml — with any grandparent whose side ISN'T known (e.g. dragged in directly
    // rather than composed from a placed parent) still shown in this general collapsible slot as a
    // fallback.
    return `
      <div class="ms-cv-tree">
        <div class="ms-cv-tree-row ms-cv-tree-row-extra">${unassignedGrandparentsHtml()}</div>
        <div class="ms-cv-tree-lineage">
          <div class="ms-cv-tree-row ms-cv-tree-row-parents">${parentsBranchHtml()}</div>
          <div class="ms-cv-connector" aria-hidden="true"></div>
          <div class="ms-cv-tree-row">${siblingsAndIndexBranchHtml()}</div>
        </div>
        <div class="ms-cv-tree-row ms-cv-tree-row-extra">
          ${collapsibleSlotHtml('auntsUncles')}
          ${collapsibleSlotHtml('other')}
        </div>
        ${unplacedHtml}
      </div>
    `;
  }

  // renderSources() — the drag-FROM side: every manual contact grouped with its own ranked Medicus
  // candidates (never a flat globally-sorted list — that's what previously let two same-named
  // manual contacts, e.g. two "John Smith" entries for two different real people, mix up which
  // candidate belonged to which), plus other patients at the same address. cardHtml's `outlined`
  // state marks a Medicus/address card that's already the target of a pending merge.
  // disambiguationSuffix(card) — appended to a candidate's sub-label ONLY when loadCanvas'
  // name-collision check flagged it (ambiguousName) — see that check for why this isn't shown
  // routinely. Address/phone/email in that preference order (address is usually the most
  // recognisable at a glance); any combination that's actually on record is shown, comma-joined.
  function disambiguationSuffix(card) {
    if (!card.ambiguousName) return '';
    const parts = [card.address, card.phone, card.email].filter(Boolean);
    return parts.length
      ? ` · ${parts.join(' · ')}`
      : ' · no address/phone/email on record (name matches another candidate)';
  }

  function renderSources() {
    const mergedMedicusIds = new Set(cs.manualCards.filter((c) => c.mergedWith).map((c) => c.mergedWith));
    // Every already-linked contact that plausibly matches a manual contact still waiting to be
    // converted — computed fresh each render, independent of whether it's ALSO placed in a tree
    // slot (see bestManualMatchFor): a recognised, already-locked contact can be a manual
    // duplicate's real match just as much as an unrecognised one can, so both get the same single
    // mechanism here rather than two different code paths.
    const linkedMatchesByManualId = new Map();
    for (const lc of cs.linkedCards) {
      const forManualId = bestManualMatchFor(lc);
      if (!forManualId) continue;
      if (!linkedMatchesByManualId.has(forManualId)) linkedMatchesByManualId.set(forManualId, []);
      linkedMatchesByManualId.get(forManualId).push(lc);
    }
    // A manual contact's own group is NEVER "settled" while it still exists — see the long comment
    // above the old `settled` calculation (removed) for why: a manual record only stops existing
    // by being deleted (immediately if its match is already placed, per confirmMerge's own
    // "already placed" branch, or after the drag-to-slot step otherwise), so a manual card that's
    // STILL HERE, by definition, has not been matched-and-confirmed yet — even one sitting right
    // next to an obviously-matching, already-placed "review match" candidate. Found live: the
    // earlier version treated a plausible, unconfirmed review match as good enough to settle the
    // whole group, but nobody had actually declared "same person" for it yet — the manual record
    // was untouched, so calling it done was misleading. "Matched and linked" below is now purely
    // the already-linked contacts with no manual counterpart at all (unmatchedLinkedHtml) — a
    // manual contact only ever leaves this list by being resolved (deleted), never by settling.
    const manualGroups = cs.manualCards.map((manual) => {
      // A blank manual contact (isBlank — see loadCanvas) has no name to match or search against,
      // so it never enters the normal suggestion pipeline at all — a dedicated Delete affordance
      // instead, rather than showing "No suggestions yet" against a card with nothing on it to
      // identify who it might even be.
      if (manual.isBlank) {
        const manualHtml = cardHtml({ ...manual, name: manual.name || '(blank contact)' }, 'manual', {
          sub: 'No name or relationship recorded — likely a stale import artifact',
          faded: true,
          locked: true,
        });
        // Disabled while its own delete is in flight (cs.manualDeleting) — same convention as the
        // merge panel's per-row phone buttons, so a slow POST can't be fired twice by a second click.
        const deleting = cs.manualDeleting.has(manual.id);
        return `<div class="ms-cv-source-group">${manualHtml}<div class="ms-cv-source-matches">
                <button class="ms-ct-btn-ghost ms-cv-delete-manual-btn" data-manual-id="${esc(manual.id)}" ${deleting ? 'disabled' : ''}>${deleting ? 'Deleting…' : 'Delete'}</button>
              </div></div>`;
      }
      const matches = cs.suggestedCards.filter((c) => c.forManualId === manual.id);
      const reviewMatches = linkedMatchesByManualId.get(manual.id) || [];
      const manualHtml = cardHtml(manual, 'manual', {
        sub: (manual.relationshipText || 'No relationship recorded') + disambiguationSuffix(manual),
        badge: manual.mergedWith ? ' · merged' : '',
        faded: !!manual.mergedWith,
        locked: !!manual.mergedWith,
      });
      // reviewMatches first — an already-linked contact plausibly this row's duplicate
      // outranks an unlinked candidate suggestion for attention here. Draggable (kind
      // 'medicus', found via cs.linkedCards — see findCard) exactly like a suggested
      // candidate, so it can be dragged onto the manual card (or vice versa) to merge and,
      // once dropped on its tree slot, clean up the manual duplicate.
      const reviewMatchesHtml = reviewMatches
        .map((c) =>
          cardHtml(c, 'medicus', {
            badge: ' · already linked',
            sub: (c.relationshipText || '') + disambiguationSuffix(c),
            outlined: mergedMedicusIds.has(c.id),
          })
        )
        .join('');
      const matchesHtml = matches.length
        ? matches
            .map((c) =>
              cardHtml(c, 'medicus', {
                // A transitive match (loadCanvas step 1.5) skipped the generic search
                // entirely — its sub-label says where it actually came from instead of a
                // tier·score that was never computed against a real search result set.
                sub:
                  (c.hint || `${c.tier} · ${c.score}${c.atSameAddress ? ' · same address' : ''}`) +
                  disambiguationSuffix(c),
                outlined: mergedMedicusIds.has(c.id),
              })
            )
            .join('')
        : reviewMatches.length
          ? ''
          : '<div class="ms-cv-empty">No suggestions yet.</div>';
      return `<div class="ms-cv-source-group">${manualHtml}<div class="ms-cv-source-matches">${reviewMatchesHtml}${matchesHtml}</div></div>`;
    });
    const manualGroupsHtml = cs.manualCards.length
      ? manualGroups.join('')
      : '<div class="ms-cv-empty">No manual contacts to convert.</div>';
    // Shown whenever there's at least one manual contact still needing conversion — the drag-a-
    // card-onto-another-card gesture (tryMerge) isn't self-explanatory from the cards alone,
    // especially once a manual contact already has an obviously-matching "already linked" card
    // sitting right next to it and it's not obvious anything further is required.
    const manualHintHtml = cs.manualCards.length
      ? `<div class="ms-cv-hint">Drag a manual contact onto its matching Medicus card to match them and delete the duplicate.</div>`
      : '';
    // Found live: with the manual card and its matches sitting side by side in each row, it
    // wasn't obvious at a glance what the right-hand cards actually WERE (candidates, not already
    // real) — labelled once here, above every row, rather than repeating it per manual contact.
    const manualGroupsHeaderHtml = cs.manualCards.length
      ? `<div class="ms-cv-source-group-header">
          <div class="ms-cv-source-group-header-manual">Manual contact</div>
          <div class="ms-cv-source-group-header-matches">Possible Medicus contact matches</div>
        </div>`
      : '';

    // Already-linked contacts with a recognised relationship (placed in the tree — see
    // buildLockedTree) but no plausible manual-contact match at all (bestManualMatchFor found
    // nothing above threshold) previously never appeared in this list — they're just sitting in
    // the tree, fine, nothing to do. Found live: that leaves this whole list unable to show them,
    // so if the automatic matcher genuinely missed a real duplicate (its name-similarity scoring
    // is the one thing that could miss, e.g. a manual contact recorded under a maiden name with a
    // different surname to the real linked patient), there was no way to catch or fix it — a
    // tree-placed card is locked/non-draggable in the tree itself, and it never appeared anywhere
    // else either. Rendering it here too, still draggable, closes that gap rather than opening a
    // new one: the SAME generic tryMerge/findCard mechanism already used for review matches works
    // for any 'medicus'-kind card regardless of which list it's rendered in, so dropping a manual
    // contact onto one of these still triggers the normal compare-and-merge flow. The genuinely
    // unmatched manual contact itself is untouched by this — it keeps showing "No suggestions
    // yet" in the ACTIVE list above, so a maiden-name-style miss stays visible from both sides,
    // not silently buried by moving this card out of sight.
    const matchedLinkedIds = new Set();
    for (const arr of linkedMatchesByManualId.values()) {
      for (const lc of arr) matchedLinkedIds.add(lc.id);
    }
    const unmatchedLinkedHtml = cs.linkedCards
      .filter((lc) => lc.baseId && !matchedLinkedIds.has(lc.id))
      .map((lc) =>
        cardHtml(lc, 'medicus', {
          badge: ' · already linked',
          sub: window.ContactRelationships.formatLabel(lc.baseId, lc.modifierId) + disambiguationSuffix(lc),
          outlined: mergedMedicusIds.has(lc.id),
        })
      )
      .join('');
    const settledSectionHtml = unmatchedLinkedHtml
      ? `<div class="ms-cv-settled-heading">Matched and linked</div><div class="ms-cv-source-matches">${unmatchedLinkedHtml}</div>`
      : '';

    const addressHtml = cs.addressCards.length
      ? cs.addressCards.map((c) => cardHtml(c, 'address', { outlined: mergedMedicusIds.has(c.id) })).join('')
      : '<div class="ms-cv-empty">No one else found at this address.</div>';

    // Real contacts pulled from a related patient's own record (loadCanvas step 1.5, both
    // directions — contacts THEY added, and other patients who list THEM) that matched none of
    // this patient's own manual contacts — a relative this patient has no record of at all yet,
    // not just an unconverted manual one. Draggable straight onto a tree slot like any other
    // candidate; the relationship picker there falls back to 'other' (see buildConfirmForCard) —
    // the hint below is informational only, never an auto-guess.
    const transitiveHtml = cs.transitiveCards.length
      ? `<div class="ms-cv-transitive">
          <div class="ms-cv-column-title">Also found via a related patient's own contacts</div>
          <div class="ms-cv-source-matches">${cs.transitiveCards
            .map((c) =>
              cardHtml(c, 'medicus', {
                sub: (c.hint || '') + disambiguationSuffix(c),
                outlined: mergedMedicusIds.has(c.id),
              })
            )
            .join('')}</div>
        </div>`
      : '';

    return `
      <div class="ms-cv-sources">
        <div class="ms-cv-column">
          <div class="ms-cv-column-title">Manual contacts to convert</div>
          ${manualHintHtml}
          ${manualGroupsHeaderHtml}
          ${manualGroupsHtml}
          ${settledSectionHtml}
        </div>
        <div class="ms-cv-column">
          <div class="ms-cv-column-title">Also at this address</div>
          ${addressHtml}
        </div>
      </div>
      ${transitiveHtml}
    `;
  }

  function findCard(id, kind) {
    if (kind === 'manual') return cs.manualCards.find((c) => c.id === id);
    if (kind === 'medicus')
      return (
        cs.suggestedCards.find((c) => c.id === id) ||
        cs.linkedCards.find((c) => c.id === id) ||
        cs.transitiveCards.find((c) => c.id === id)
      );
    if (kind === 'address') return cs.addressCards.find((c) => c.id === id);
    return null;
  }

  function renderConfirmPanel() {
    if (cs.doneSummary) {
      // "Link another" (the old dismiss button) removed: tryAssign now clears doneSummary itself
      // on a fresh drag, so dragging the next card straight onto a slot genuinely just works
      // without clicking anything first — the button's only remaining job would have been
      // dismissing this panel without dragging anything else, which isn't worth a dedicated
      // button. One thing that WOULD have forced an explicit stop here: an unresolved
      // reverseManualMatch offer below. tryAssign clears that too on a new drag now, so it's
      // possible to silently skip past it by dragging quickly — accepted as consistent with this
      // tool's own "never force a decision" doctrine (the offer is explicitly best-effort, never
      // blocking, and the duplicate can still be cleaned up later via the wizard or in Medicus
      // directly) rather than reintroducing a mandatory checkpoint for a rare, non-critical case.
      return `
        <div class="ms-cv-confirm-panel ms-cv-confirm-panel-done">
          <div class="ms-cv-success-icon">✓</div>
          <div>${esc(cs.doneSummary)}</div>
          <div class="ms-ct-note">Medicus's own contacts card won't show this change until the page is refreshed.</div>
          ${
            cs.reverseManualMatch
              ? `<div class="ms-ct-warn">${esc(cs.confirm && cs.confirm.candidateDisplayName)} also has a manual contact named
                   "${esc(cs.reverseManualMatch.patientContactName)}" that may represent this patient — it was NOT
                   removed automatically since no one has confirmed the match. Remove it too?</div>
                 ${reverseManualMatchComparisonHtml(cs.reverseManualMatch, cs.indexPatientDetails)}
                 <button class="ms-ct-btn-ghost" id="ms-cv-remove-reverse-manual" ${cs.reverseManualRemoving ? 'disabled' : ''}>${cs.reverseManualRemoving ? 'Removing…' : 'Remove it'}</button>`
              : ''
          }
          ${cs.reverseManualMatchError ? `<div class="ms-ct-error">${esc(cs.reverseManualMatchError)}</div>` : ''}
          <button class="ms-ct-btn-ghost" id="ms-cv-reload">Refresh now</button>
        </div>
      `;
    }
    if (!cs.confirm) {
      if (cs.workingError) {
        return `<div class="ms-cv-confirm-panel"><div class="ms-ct-error">${esc(cs.workingError)}</div><button class="ms-ct-btn-ghost" id="ms-cv-drop-clear">Dismiss</button></div>`;
      }
      return '';
    }
    const card = findCard(cs.confirmCardId, cs.confirmCardKind);
    if (!card) return '';
    const rel = window.ContactRelationships;
    const allRelIds = cs.confirm.slotPath
      ? slotBaseIds(cs.confirm.slotPath)
      : Object.keys(rel.ALIAS_TERMS).concat(['other']);
    const baseSelect = allRelIds
      .map((id) => {
        const r = rel.getRelationship(id);
        return r
          ? `<option value="${esc(id)}"${cs.confirm.baseId === id ? ' selected' : ''}>${esc(r.label)}</option>`
          : '';
      })
      .join('');
    const validMods = rel.validModifiersForBase(cs.confirm.baseId);
    const modRadios = validMods.length
      ? `<span class="ms-ct-import-mods">
          <label><input type="radio" name="ms-cv-mod" value="" ${!cs.confirm.modifierId ? 'checked' : ''}/> None</label>
          ${validMods
            .map(
              (m) =>
                `<label><input type="radio" name="ms-cv-mod" value="${esc(m)}" ${cs.confirm.modifierId === m ? 'checked' : ''}/> ${esc(rel.getModifiers().find((mm) => mm.id === m).label)}</label>`
            )
            .join(' ')}
        </span>`
      : '';
    const indexName = (cs.indexPatientDetails && cs.indexPatientDetails.displayName) || 'this patient';
    const candidateName = card.name;

    // LEFT column — Jane's (the candidate's) relationship to John (the index patient), written
    // onto John's own record. Unchanged logic from before this redesign, just relocated: the
    // picker + forward NOK/copy only apply when the relationship isn't already known (a brand-new
    // candidate, or an already-linked one whose free text didn't parse) and isn't just cleaning up
    // an existing link.
    const forwardColumnBody = !cs.confirm.relationshipKnown
      ? `<select class="ms-ct-select" id="ms-cv-base">${baseSelect}</select>
         ${modRadios}
         ${
           cs.confirm.existingForwardLink
             ? ''
             : `<label><input type="checkbox" id="ms-cv-fwd-nok" ${cs.confirm.forwardIsNextOfKin ? 'checked' : ''}/> Next of kin</label>
                <div class="ms-ct-note">This will record ${esc(candidateName)} as ${esc(indexName)}'s next of kin.</div>
                <label><input type="checkbox" id="ms-cv-fwd-copy" ${cs.confirm.forwardCopyCorrespondence ? 'checked' : ''}/> Copy correspondence</label>
                <div class="ms-ct-note">This will allow messages to be sent to ${esc(candidateName)} about ${esc(indexName)}.</div>`
         }`
      : `<div class="ms-ct-note">Already recorded on ${esc(indexName)}'s own record.</div>`;

    // RIGHT column — John's reciprocal relationship to Jane, written onto JANE's own record (a
    // SEPARATE write, performLinkAndCleanup's reverse link). The relationship label itself is
    // never independently chosen here — always the gender-aware inversion of the left column's
    // pick (ContactRelationships.invertRelationship) — but reverseIsNextOfKin/
    // reverseCopyCorrespondence are genuinely interactive: the write path has supported them since
    // this canvas was built, they just had no UI to set them until now (previously hardcoded
    // false in buildConfirmForCard). Shown whenever a reverse write will actually fire — i.e.
    // independent of whether the LEFT column's picker is showing, since confirming a NEW reverse
    // link for an ALREADY-recognised forward relationship is a real, valid case.
    const reverseColumnBody = cs.confirm.existingReciprocal
      ? `<div class="ms-ct-warn">${esc(candidateName)} already lists this patient as their own contact (recorded as "${esc(cs.confirm.existingReciprocal.patientContactRelationship)}") — no reverse link will be created.</div>`
      : cs.confirm.reverseAmbiguous
        ? `<div class="ms-ct-note">Reverse relationship not auto-suggested (gender not recorded) — use the wizard for this case.</div>`
        : `<div class="ms-cv-confirm-reverse-label">${esc(rel.formatLabel(cs.confirm.reverseBaseId, cs.confirm.modifierId))}</div>
           <label><input type="checkbox" id="ms-cv-rev-nok" ${cs.confirm.reverseIsNextOfKin ? 'checked' : ''}/> Next of kin</label>
           <div class="ms-ct-note">This will record ${esc(indexName)} as ${esc(candidateName)}'s next of kin.</div>
           <label><input type="checkbox" id="ms-cv-rev-copy" ${cs.confirm.reverseCopyCorrespondence ? 'checked' : ''}/> Copy correspondence</label>
           <div class="ms-ct-note">This will allow messages to be sent to ${esc(indexName)} about ${esc(candidateName)}.</div>`;

    return `
      <div class="ms-cv-confirm-panel">
        <div class="ms-cv-card-name">Linking: ${esc(card.name)}${cs.confirm.slotPath ? ` — ${esc(SLOT_TITLES[cs.confirm.slotPath])}` : ''}</div>
        ${
          cs.confirm.existingForwardLink
            ? `<div class="ms-ct-warn">Already linked (recorded as "${esc(cs.confirm.existingForwardLink.patientContactRelationship)}")${
                cs.confirm.relationshipKnown
                  ? ` — this will just clean up the manual duplicate, if one is merged in.`
                  : `, which didn't match a known category — pick how it should appear below. Confirming will ` +
                    `update this relationship on Medicus and clean up the manual duplicate, if one is merged in.`
              }</div>`
            : ''
        }
        <div class="ms-cv-confirm-columns">
          <div class="ms-cv-confirm-col">
            <div class="ms-cv-confirm-col-title">Record ${esc(candidateName)}'s relationship to ${esc(indexName)} here:</div>
            ${forwardColumnBody}
          </div>
          <div class="ms-cv-confirm-col">
            <div class="ms-cv-confirm-col-title">Record ${esc(indexName)}'s reciprocal relationship to ${esc(candidateName)}:</div>
            ${reverseColumnBody}
          </div>
        </div>
        ${cs.workingError ? `<div class="ms-ct-error">${esc(cs.workingError)}</div>` : ''}
        <div class="ms-cv-confirm-panel-actions">
          <button class="ms-ct-btn" id="ms-cv-confirm" ${cs.confirming ? 'disabled' : ''}>${
            cs.confirming ? 'Linking…' : cs.confirm.linkProgress ? 'Retry the remaining steps' : 'Confirm link'
          }</button>
          <button class="ms-ct-btn-ghost" id="ms-cv-drop-clear" ${cs.confirming ? 'disabled' : ''}>Cancel</button>
        </div>
      </div>
    `;
  }

  // renderMergePanel() — the drag-to-merge compare step, modelled on duplicate-checker.js's
  // note-compare-merge pattern (side-by-side table, a "kept" column that always wins, differing
  // rows flagged, only genuinely mergeable content gets a choice). Adapted for contacts: the
  // Medicus column ALWAYS wins (it's the live record, never a symmetric "pick either" choice like
  // duplicate-checker's), so the only decisions are whether to carry the manual record's notes
  // and/or a differing phone number forward into the new link's notes field as supplementary text
  // — everything else is read-only evidence that these two cards really are the same person.
  function renderMergePanel() {
    const pm = cs.pendingMerge;
    if (!pm) return '';
    if (cs.mergeLoading) {
      return `<div class="ms-cv-confirm-panel"><div class="ms-ct-loading">Comparing records…</div></div>`;
    }
    if (pm.finalizing) {
      return `<div class="ms-cv-confirm-panel"><div class="ms-ct-loading">Removing the manual duplicate…</div></div>`;
    }
    if (cs.mergeError) {
      return `<div class="ms-cv-confirm-panel"><div class="ms-ct-error">${esc(cs.mergeError)}</div><button class="ms-ct-btn-ghost" id="ms-cv-merge-cancel">Close</button></div>`;
    }
    if (!pm.manualDetail || !pm.medicusPreview) return '';
    const manual = pm.manualDetail;
    const medicus = pm.medicusPreview;
    // A plain row: {label, manual, medicus, differs}. Phone rows carry an extra `entry` (the raw
    // patientTelephoneNumbers[] item, for the Edit button + its own note) — see plainRowHtml vs
    // phoneRowHtml below.
    const topRows = [
      { label: 'Name', manual: manual.patientContactName, medicus: medicus.linkPatientName, differs: false },
      // DOB: manual contacts don't carry one at all — shown purely as corroborating evidence
      // (e.g. an implausible age for the recorded relationship is a reason to cancel, not merge),
      // never a real comparison since there's nothing on the manual side to differ against.
      {
        label: 'Date of birth',
        manual: '(not recorded)',
        medicus: medicus.linkPatientDOB || '(not recorded)',
        differs: false,
      },
    ];
    const phoneRows = buildPhoneRows(pm.manualPhones, pm.medicusPhones);
    const emailRows = [];
    if (pm.manualEmail || pm.medicusEmail) {
      emailRows.push({
        label: 'Email',
        manual: pm.manualEmail || '(none recorded)',
        medicus: pm.medicusEmail || '(none recorded)',
        differs: pm.emailsDiffer,
      });
    }
    const plainRowHtml = (r) => `<tr${r.differs ? ' class="ms-cv-merge-row-differs"' : ''}>
          <td class="ms-cv-merge-label">${esc(r.label)}</td>
          <td>${esc(r.manual)}</td>
          <td class="ms-cv-merge-keep-col">${esc(r.medicus)}</td>
        </tr>`;
    const phoneRowHtml = (r) => {
      const noteWarn = r.entry && r.entry.notes ? `<div class="ms-ct-warn">Note: "${esc(r.entry.notes)}"</div>` : '';
      // isUkMobileNumber is a structural fact about the number itself (Ofcom reserves 07 for
      // mobile/pager only), not an inference from free text — safe to state plainly rather than
      // hedge. "Fix type" fires immediately on click (fixPhoneType) rather than opening the edit
      // form first — the warning right here already states exactly what's wrong, so clicking the
      // button IS the confirmation, per the user's own framing. Entry-scoped by telephoneNumberId
      // like every other phone action here, so this is safe regardless of how many OTHER entries
      // (correctly-filed Home numbers, say) the candidate also has — this only ever touches the
      // one specific row whose own number looked wrong.
      const wrongTypeWarn = r.wrongType
        ? `<div class="ms-ct-warn">This looks like a mobile number, but is filed as "${esc(r.label)}".</div>`
        : '';
      const fixingType = r.entry && cs.phoneFixingType.has(r.entry.telephoneNumberId);
      const busy = !!cs.phoneEdit || (r.entry && cs.phoneDeleting.has(r.entry.telephoneNumberId)) || fixingType;
      const editBtn =
        r.entry && !busy
          ? `<button class="ms-ct-btn-ghost ms-cv-merge-edit-btn" data-telephone-id="${esc(r.entry.telephoneNumberId)}"
               data-medicus-id="${esc(pm.medicusId)}" data-candidate-name="${esc(medicus.linkPatientName)}">Edit</button>`
          : '';
      const fixTypeBtn =
        r.entry && r.wrongType && !busy
          ? `<button class="ms-ct-btn-ghost ms-cv-merge-fixtype-btn" data-telephone-id="${esc(r.entry.telephoneNumberId)}"
               data-medicus-id="${esc(pm.medicusId)}">Fix type</button>`
          : fixingType
            ? `<span class="ms-ct-note">Fixing…</span>`
            : '';
      // Confirmed via HAR capture 2026-07-26: this is exactly the flow the capture itself walked
      // through — a mobile number wrongly filed as "Home", fixed via Edit (change type), THEN
      // deleted outright once it turned out to be a leftover from the pre-linking era (e.g. a
      // partner's own number kept on this patient's record before direct patient-linking existed
      // — now defunct and technically wrong, per the live report that prompted this). No native
      // confirm() dialog, matching this codebase's existing delete-button convention (e.g.
      // #ms-cv-remove-reverse-manual) — a clearly labelled, deliberately-placed button IS the
      // confirmation here, not an extra popup.
      const deleteBtn =
        r.entry && !busy
          ? `<button class="ms-ct-btn-ghost ms-cv-merge-delete-btn" data-telephone-id="${esc(r.entry.telephoneNumberId)}"
               data-medicus-id="${esc(pm.medicusId)}">Delete</button>`
          : r.entry && cs.phoneDeleting.has(r.entry.telephoneNumberId)
            ? `<span class="ms-ct-note">Deleting…</span>`
            : '';
      const actionsRow =
        editBtn || deleteBtn || fixTypeBtn
          ? `<div class="ms-cv-phone-actions">${editBtn}${fixTypeBtn}${deleteBtn}</div>`
          : '';
      return `<tr${r.differs ? ' class="ms-cv-merge-row-differs"' : ''}>
          <td class="ms-cv-merge-label">${esc(r.label)}</td>
          <td>${esc(r.manual || '(none recorded)')}</td>
          <td class="ms-cv-merge-keep-col">${esc(r.medicus || '(none recorded)')}${actionsRow}${noteWarn}${wrongTypeWarn}</td>
        </tr>`;
    };
    const rowsHtml =
      topRows.map(plainRowHtml).join('') + phoneRows.map(phoneRowHtml).join('') + emailRows.map(plainRowHtml).join('');
    const editingThisMerge = cs.phoneEdit && cs.phoneEdit.forMedicusId === pm.medicusId;
    const notesText = (manual.patientContactRelationshipNotes || '').trim();
    // Already placed in the family tree — confirmMerge() deletes the manual duplicate immediately
    // rather than carrying anything into a new link's notes (there is no new link to write). The
    // keep-phone/email/notes checkboxes below only ever feed that new link's notes field, so
    // they'd do nothing here — replaced with a plain heads-up instead of a control with no effect.
    const alreadyPlaced = isPlacedInTree(pm.medicusId);
    return `
      <div class="ms-cv-confirm-panel">
        <div class="ms-cv-card-name">Same person? Compare before merging</div>
        <table class="ms-cv-merge-table">
          <thead><tr><th></th><th>Manual record</th><th class="ms-cv-merge-keep-col">✓ Live Medicus record (kept)</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        ${pm.phoneActionError ? `<div class="ms-ct-error">${esc(pm.phoneActionError)}</div>` : ''}
        ${
          editingThisMerge
            ? renderPhoneEditForm()
            : `
        ${
          alreadyPlaced
            ? `<div class="ms-ct-note">${esc(pm.medicusPreview.linkPatientName)} is already linked and placed in the family tree — confirming here removes the manual duplicate immediately; note any phone/email/notes above you want to keep, since there's no new link for them to carry into.</div>`
            : `
        ${
          pm.phonesDiffer
            ? `<label><input type="checkbox" id="ms-cv-merge-keep-phone" ${pm.keepManualPhone ? 'checked' : ''}/> Note the manual phone number(s) that differ in the new link's notes too</label>`
            : ''
        }
        ${
          pm.emailsDiffer
            ? `<label><input type="checkbox" id="ms-cv-merge-keep-email" ${pm.keepManualEmail ? 'checked' : ''}/> Note the manual email address in the new link's notes too</label>`
            : ''
        }
        ${
          notesText
            ? `<label><input type="checkbox" id="ms-cv-merge-keep-notes" ${pm.keepNotes ? 'checked' : ''}/> Carry forward the manual record's notes: "${esc(notesText)}"</label>`
            : ''
        }`
        }
        <div class="ms-cv-confirm-panel-actions">
          <button class="ms-ct-btn" id="ms-cv-merge-confirm">Confirm — same person</button>
          <button class="ms-ct-btn-ghost" id="ms-cv-merge-cancel">Cancel</button>
        </div>
        `
        }
      </div>
    `;
  }

  // renderPhoneEditForm() — the CANDIDATE's own phone-number edit form, opened via the "Edit"
  // button on the merge panel's Phone row. Replaces the normal merge checkboxes/actions while
  // open (rather than floating separately) so there's only ever one clear action available at a
  // time — you can't accidentally confirm the merge with an unsaved phone edit still pending.
  function renderPhoneEditForm() {
    const pe = cs.phoneEdit;
    if (pe.loading) return `<div class="ms-ct-loading">Loading phone details…</div>`;
    if (!pe.form) {
      return `
        <div class="ms-ct-error">${esc(pe.error || 'Failed to load this phone number for editing.')}</div>
        <button class="ms-ct-btn-ghost" id="ms-cv-phone-edit-cancel">Close</button>
      `;
    }
    const typeOptions = (pe.form.telephoneNumberTypes || [])
      .map(
        (t) =>
          `<option value="${esc(t.value)}"${pe.form.telephoneNumberType === t.value ? ' selected' : ''}>${esc(t.label)}</option>`
      )
      .join('');
    return `
      <div class="ms-cv-card-name">Editing ${esc(pe.candidateName)}'s own phone number</div>
      <div class="ms-ct-note">This changes their live Medicus record directly — not a "contact" entry, and not undoable from here.</div>
      <div class="ms-cv-phone-edit-form">
        <label>Number
          <input type="text" class="ms-ct-input" id="ms-cv-phone-edit-number" value="${esc(pe.form.telephoneNumber)}" />
        </label>
        <select class="ms-ct-select" id="ms-cv-phone-edit-type">${typeOptions}</select>
        <label><input type="checkbox" id="ms-cv-phone-edit-sms" ${pe.form.preferredTelephoneNumberForSms ? 'checked' : ''}/> Preferred number for text messages</label>
        <label>Notes
          <input type="text" class="ms-ct-input" id="ms-cv-phone-edit-notes" value="${esc(pe.form.notes || '')}" />
        </label>
      </div>
      ${pe.error ? `<div class="ms-ct-error">${esc(pe.error)}</div>` : ''}
      <div class="ms-cv-confirm-panel-actions">
        <button class="ms-ct-btn" id="ms-cv-phone-edit-save" ${pe.saving ? 'disabled' : ''}>${pe.saving ? 'Saving…' : 'Save'}</button>
        <button class="ms-ct-btn-ghost" id="ms-cv-phone-edit-cancel" ${pe.saving ? 'disabled' : ''}>Cancel</button>
      </div>
    `;
  }

  // renderDuplicateAddressWarning — surfaces cs.addressMergeGroups (loadCanvas, ONLY ever computed
  // from the hub/index patient's own addresses, never a linked contact's — see
  // ContactRelationships.findDuplicateAddressGroups/chooseAddressToKeep and this file's own
  // buildAddressMergeGroups). `keepIndex` is only ever a DEFAULT selection (correspondence address
  // first, then most complete) — the GP can override it with the radio buttons here before
  // merging; every address in the group is shown, not just a fixed "keep"/"delete" split, and
  // whichever one currently holds the correspondence-address flag is noted regardless of which one
  // ends up selected. No separate confirm() popup — the panel already shows exactly what's
  // selected before the Merge button is reachable, that visible context IS the confirmation, same
  // convention as the existing fixPhoneType/deletePhoneNumber actions.
  // renderNokCopyCorrespondenceWarning — surfaces cs.hasNoNok/cs.hasNoCopyCorrespondenceU13
  // (loadCanvas Step 1.10, hub patient only). Read-only awareness, same as every other flag in
  // this canvas — fixing a gap means dragging a candidate onto a slot and ticking the relevant
  // checkbox in the confirm panel (see the "reverse" NOK/copy-correspondence checkboxes added
  // alongside this), not a dedicated action here.
  function renderNokCopyCorrespondenceWarning() {
    const lines = [];
    if (cs.hasNoNok) lines.push('No next of kin is set for this patient.');
    if (cs.hasNoCopyCorrespondenceU13) {
      lines.push('This patient is under 13 and has no contact set to receive copy correspondence.');
    }
    if (!lines.length) return '';
    return `<div class="ms-ct-warn ms-cv-nok-cc-warn">${lines.map((l) => `<div>${esc(l)}</div>`).join('')}</div>`;
  }

  function renderDuplicateAddressWarning() {
    if (!cs.addressMergeGroups.length) return '';
    const groups = cs.addressMergeGroups
      .map((plan) => {
        const groupKey = plan.indexes.join(',');
        const merging = cs.addressMerging.has(groupKey);
        // Fail-closed (see buildAddressMergeGroups): at least one member's correspondence status
        // couldn't be read, so nothing here may be deleted — the flag transfer can't be planned.
        const unverifiedCount = (plan.unverifiedIndexes || []).length;
        const blocked = unverifiedCount > 0;
        const rows = plan.indexes
          .map((idx) => {
            const entry = cs.indexAddresses[idx];
            const text = (entry && formatAddressLine(entry.address)) || '(no address text)';
            const isCorrespondence = idx === plan.correspondenceIndex;
            const unverifiedHere = (plan.unverifiedIndexes || []).includes(idx);
            return `
              <label class="ms-cv-dupaddr-line">
                <input type="radio" name="ms-cv-dupaddr-keep-${esc(groupKey)}" class="ms-cv-dupaddr-keep-radio"
                       data-address-group="${esc(groupKey)}" data-address-index="${idx}"
                       ${idx === plan.keepIndex ? 'checked' : ''} ${merging || blocked ? 'disabled' : ''}/>
                ${esc(text)}${isCorrespondence ? ' <span class="ms-ct-note">(currently correspondence address)</span>' : ''}${
                  unverifiedHere ? ' <span class="ms-ct-note">(couldn’t be checked)</span>' : ''
                }
              </label>
            `;
          })
          .join('');
        // Only relevant when the GP has picked something OTHER than the current correspondence
        // address to keep — mergeDuplicateAddressGroup carries the flag over to whichever address
        // the GP actually kept (ContactRelationships.buildChangeAddressBody), so this is purely
        // informational, not a "you'll need to fix this yourself" warning.
        const movesCorrespondence = plan.correspondenceIndex !== -1 && plan.keepIndex !== plan.correspondenceIndex;
        return `
          <div class="ms-cv-dupaddr-group">
            ${rows}
            ${
              blocked
                ? `<div class="ms-ct-warn">Couldn’t verify correspondence status for ${unverifiedCount === 1 ? 'one of these addresses' : `${unverifiedCount} of these addresses`} — merge disabled, so this can’t delete the correspondence address without moving the flag first. Reopen the canvas to retry, or merge them in Medicus directly.</div>`
                : movesCorrespondence
                  ? `<div class="ms-ct-note">This deletes the current correspondence address — the correspondence-address flag is set on the kept address FIRST, before anything is deleted.</div>`
                  : ''
            }
            <button class="ms-ct-btn-ghost ms-cv-dupaddr-merge" data-address-group="${esc(groupKey)}" ${merging || blocked ? 'disabled' : ''}>${merging ? 'Merging…' : 'Merge — keep the selected address, delete the rest'}</button>
          </div>
        `;
      })
      .join('');
    const n = cs.addressMergeGroups.length;
    return `
      <div class="ms-ct-warn ms-cv-dupaddr-warn">
        <strong>${n} possible duplicate address${n === 1 ? '' : 'es'} on this patient's own record</strong> —
        looks like a PDS update recorded the same address more than once, just formatted
        differently each time. Pick which one to keep for each group (defaults to the
        correspondence address, or the most complete copy if none is marked).
        ${groups}
        ${cs.addressMergeError ? `<div class="ms-ct-error">${esc(cs.addressMergeError)}</div>` : ''}
      </div>
    `;
  }

  function render() {
    const overlay = document.getElementById('ms-contacts-canvas-overlay');
    if (!overlay) return;
    if (!cs) {
      overlay.remove();
      return;
    }
    overlay.innerHTML = `
      <div class="ms-cv-panel">
        <div class="ms-cv-header">
          <span>Contacts canvas${cs.indexPatientDetails ? ' — ' + esc(cs.indexPatientDetails.displayName || '') : ''}</span>
          <span class="ms-cv-header-actions">
            ${
              cs.familySession && cs.familySession.pending.length
                ? `<button class="ms-ct-btn-ghost ms-cv-header-link" id="ms-cv-next-family" title="Leaves this patient's record and opens the next already-linked family member's own record, carrying your review pool with you — asks for confirmation first">Next family member (${cs.familySession.pending.length})</button>`
                : ''
            }
            <button class="ms-ct-btn-ghost ms-cv-header-link" id="ms-cv-open-import" title="Search any other patient's record and bulk-copy several of their contacts onto this one in one go — this canvas only ever surfaces patients already listed as a contact for this one">Import from another patient</button>
            <button class="ms-ct-btn-ghost" id="ms-cv-close">Close</button>
          </span>
        </div>
        ${
          cs.loading
            ? `<div class="ms-cv-loading">Loading…</div>`
            : cs.error
              ? `<div class="ms-ct-error">${esc(cs.error)}</div>`
              : `<div class="ms-cv-body">
                   ${renderNokCopyCorrespondenceWarning()}
                   ${renderDuplicateAddressWarning()}
                   ${renderTree()}
                   ${cs.pendingMerge ? renderMergePanel() : renderConfirmPanel()}
                   ${renderSources()}
                 </div>`
        }
      </div>
    `;
    bindEvents(overlay);
  }

  // ── Merge & assign actions ───────────────────────────────────────────────────────────────────

  function normalisePhoneForCompare(p) {
    return String(p || '').replace(/[^0-9]/g, '');
  }

  // buildPhoneRows(manualPhones, medicusPhones) -> [{ label, manual, medicus, differs, entry }]
  //   manualPhones: { Home, Mobile, Work } — a manual contact only ever has these three flat
  //     fields, never a list, and never Temporary.
  //   medicusPhones: raw patientTelephoneNumbers[] from patient-details (any number of entries,
  //     any of the four real types: Home/Mobile/Work/Temporary — confirmed via HAR capture
  //     2026-07-26, edit-telephone-number's own telephoneNumberTypes enum).
  // One row per Medicus entry (so every number is individually visible AND individually
  // editable — the FIX for the mismatch this replaces: previously the compare table showed
  // linkPatientMobilePhoneNumber||linkPatientHomePhoneNumber from the link-preview endpoint while
  // "Edit" targeted whichever patientTelephoneNumbers[] entry was flagged preferredForSms, and
  // confirmed live via HAR that those are NOT always the same entry). Only the FIRST entry of each
  // type is compared against the manual side (differs highlighting) — a manual contact has at most
  // one value per type, so a second entry of the same type has nothing of its own to compare
  // against and renders as a plain extra row instead. A type with a manual value but no Medicus
  // entry at all still gets its own row (manual side visible, Medicus side "(none recorded)").
  function buildPhoneRows(manualPhones, medicusPhones) {
    const byType = { Home: [], Mobile: [], Work: [], Temporary: [] };
    for (const p of medicusPhones || []) {
      (byType[p.telephoneNumberType] || (byType[p.telephoneNumberType] = [])).push(p);
    }
    const rows = [];
    for (const type of ['Home', 'Mobile', 'Work', 'Temporary']) {
      const manualValue = (manualPhones && manualPhones[type]) || null;
      const entries = byType[type] || [];
      if (!manualValue && !entries.length) continue; // nothing on either side for this type
      if (!entries.length) {
        rows.push({ label: type, manual: manualValue, medicus: null, differs: false, entry: null });
        continue;
      }
      entries.forEach((entry, i) => {
        const isFirst = i === 0;
        rows.push({
          label: entries.length > 1 ? `${type} (${i + 1})` : type,
          manual: isFirst ? manualValue : null,
          medicus: entry.telephoneNumber,
          differs:
            isFirst &&
            !!manualValue &&
            normalisePhoneForCompare(manualValue) !== normalisePhoneForCompare(entry.telephoneNumber),
          entry,
          // Confirmed live as a real, recurring pattern in GP2GP-imported records: a mobile-shaped
          // number filed under the wrong type (e.g. "Home"). Never flagged for an entry ALREADY
          // typed Mobile — nothing to fix there.
          wrongType: type !== 'Mobile' && window.ContactRelationships.isUkMobileNumber(entry.telephoneNumber),
        });
      });
    }
    return rows;
  }

  // reverseManualMatchComparisonHtml — same purpose/shape as the wizard's copy of this function:
  // a couple of plain evidence lines (not a full interactive table) so the removal decision isn't
  // made on a bare name-similarity score alone.
  function reverseManualMatchComparisonHtml(match, indexPatientDetails) {
    if (!match.detail) return '';
    const CR = window.ContactRelationships;
    const theirPhone =
      (match.detail.patientContactMobileTelephoneNumber && match.detail.patientContactMobileTelephoneNumber.value) ||
      (match.detail.patientContactHomeTelephoneNumber && match.detail.patientContactHomeTelephoneNumber.value) ||
      '(none recorded)';
    const theirEmail =
      (match.detail.patientContactEmailAddress && match.detail.patientContactEmailAddress.value) || '(none recorded)';
    const indexPhone = CR.extractPreferredPhone(indexPatientDetails) || '(none recorded)';
    const indexEmail = CR.extractPreferredEmail(indexPatientDetails) || '(none recorded)';
    const indexPhoneNote = CR.extractPreferredPhoneNote(indexPatientDetails);
    return `
      <div class="ms-ct-note">Their manual entry: phone ${esc(theirPhone)}, email ${esc(theirEmail)}</div>
      <div class="ms-ct-note">This patient's own record: phone ${esc(indexPhone)}, email ${esc(indexEmail)}</div>
      ${indexPhoneNote ? `<div class="ms-ct-warn">This patient's own phone number has a note attached: "${esc(indexPhoneNote)}" — double-check it actually belongs to them.</div>` : ''}
    `;
  }

  // startMerge — fetches the manual contact's full detail (view-patient-contact, for its
  // phone/email/notes), the Medicus candidate's live preview (link-patient's GET, for phone + DOB),
  // and the candidate's own patient-details (for email, which the preview doesn't carry) in
  // parallel, then opens the compare panel. Nothing is paired until the user explicitly confirms
  // the panel — a failed/slow fetch never silently merges anything.
  async function startMerge(manualId, medicusId) {
    const manual = cs.manualCards.find((c) => c.id === manualId);
    if (!manual) return;
    cs.pendingMerge = {
      manualId,
      medicusId,
      manualDetail: null,
      medicusPreview: null,
      keepNotes: false,
      keepManualPhone: false,
      keepManualEmail: false,
    };
    cs.phoneEdit = null; // a previous merge's unsaved edit form, if any, no longer applies
    cs.mergeLoading = true;
    cs.mergeError = null;
    render();
    try {
      const [manualDetail, medicusPreview, medicusDetails] = await Promise.all([
        window.ContactsApi.viewPatientContact(cs.apiBase, manualId),
        window.ContactsApi.previewLinkCandidate(cs.apiBase, cs.patientId, medicusId),
        window.ContactsApi.getPatientDetails(cs.apiBase, medicusId),
      ]);
      if (!cs.pendingMerge || cs.pendingMerge.manualId !== manualId) return; // cancelled or superseded mid-fetch
      // A manual contact only ever has these three flat fields (never a list, never Temporary) —
      // see buildPhoneRows for how these pair against the Medicus side's full patientTelephoneNumbers list.
      const manualPhones = {
        Home:
          (manualDetail.patientContactHomeTelephoneNumber && manualDetail.patientContactHomeTelephoneNumber.value) ||
          null,
        Mobile:
          (manualDetail.patientContactMobileTelephoneNumber &&
            manualDetail.patientContactMobileTelephoneNumber.value) ||
          null,
        Work:
          (manualDetail.patientContactWorkTelephoneNumber && manualDetail.patientContactWorkTelephoneNumber.value) ||
          null,
      };
      // The full list, not just one flattened value (confirmed via HAR capture 2026-07-26 that the
      // link-preview endpoint's own linkPatientMobilePhoneNumber/linkPatientHomePhoneNumber can
      // point at a DIFFERENT entry than whichever one is flagged preferredTelephoneNumberForSms —
      // the exact mismatch that made "Edit" open the wrong number. Showing every entry from
      // patient-details directly, each with its own Edit button, removes the ambiguity entirely
      // rather than trying to guess which single one to show).
      const medicusPhones =
        (medicusDetails.patientContactInformationSection &&
          medicusDetails.patientContactInformationSection.patientTelephoneNumbers) ||
        [];
      const manualEmail =
        (manualDetail.patientContactEmailAddress && manualDetail.patientContactEmailAddress.value) || null;
      const medicusEmail = window.ContactRelationships.extractPreferredEmail(medicusDetails);
      cs.pendingMerge.manualDetail = manualDetail;
      cs.pendingMerge.medicusPreview = medicusPreview;
      cs.pendingMerge.manualPhones = manualPhones;
      cs.pendingMerge.medicusPhones = medicusPhones;
      cs.pendingMerge.manualEmail = manualEmail;
      cs.pendingMerge.medicusEmail = medicusEmail;
      cs.pendingMerge.phonesDiffer = buildPhoneRows(manualPhones, medicusPhones).some((r) => r.differs);
      cs.pendingMerge.emailsDiffer = !!(
        manualEmail &&
        medicusEmail &&
        manualEmail.trim().toLowerCase() !== medicusEmail.trim().toLowerCase()
      );
      cs.pendingMerge.keepNotes = !!(
        manualDetail.patientContactRelationshipNotes && manualDetail.patientContactRelationshipNotes.trim()
      );
    } catch (err) {
      cs.mergeError = err.message || 'Failed to load comparison details.';
    } finally {
      cs.mergeLoading = false;
      render();
    }
  }

  // deleteBlankManualContact — the dedicated Delete button for an isBlank manual card (see
  // loadCanvas). Reuses deletePatientContactRelationship, the same endpoint already used
  // elsewhere in this file for removing a manual duplicate — no new write logic needed.
  //
  // Two guards, both cheap, both added after review: an in-flight guard (cs.manualDeleting, set
  // synchronously before the first await and rendered as a disabled button — the delete is a real
  // POST and a double-click otherwise fires it twice), and the same WRONG-PATIENT re-verify
  // mergeDuplicateAddressGroup uses. The delete is pinned to a server UUID so it could never
  // retarget another patient's record on its own, but the ACTION's meaning is "clean up an import
  // artifact on the patient in front of me" — if the page has moved on, the GP is no longer
  // looking at the record they decided about, so it stops rather than writing.
  async function deleteBlankManualContact(manualId) {
    const manual = cs.manualCards.find((c) => c.id === manualId);
    if (!manual) return;
    if (cs.manualDeleting.has(manualId)) return; // already in flight — never fire the delete twice
    const st = cs;
    st.workingError = null;
    st.manualDeleting.add(manualId);
    render();
    try {
      const ctx = window.ContactsApi.resolveContext();
      if (!ctx || ctx.patientId !== st.patientId) {
        throw new Error('The page has moved to a different patient — reopen the canvas and try again.');
      }
      await window.ContactsApi.deletePatientContactRelationship(st.apiBase, manualId);
      if (st !== cs) return;
      st.manualCards = st.manualCards.filter((c) => c.id !== manualId);
    } catch (err) {
      if (st !== cs) return;
      st.workingError = err.message || 'Failed to delete this blank contact.';
    } finally {
      if (st === cs) {
        st.manualDeleting.delete(manualId);
        render();
      }
    }
  }

  async function confirmMerge() {
    const pm = cs.pendingMerge;
    if (!pm || !pm.manualDetail) return;
    const manual = cs.manualCards.find((c) => c.id === pm.manualId);
    if (!manual) {
      cs.pendingMerge = null;
      render();
      return;
    }
    // A candidate ALREADY placed in the family tree (a recognised relationship, or one the
    // relationship picker has just written to Medicus) has no later "drop onto a slot" step for
    // this pairing to hang off of — that's normally where doCanvasConfirm/performLinkAndCleanup
    // deletes the manual duplicate. Confirming the match here IS the only decision point for an
    // already-placed pairing, so delete now rather than leaving it stranded in manual.mergedWith
    // with nowhere left to go (previously silently discarded on close, since there is no "drop
    // onto a slot it's already correctly sitting in" action for the user to take).
    if (isPlacedInTree(pm.medicusId)) {
      if (pm.finalizing) return; // already in flight — checked-and-set synchronously, before any await
      pm.finalizing = true;
      cs.mergeError = null;
      render();
      try {
        // WRONG-PATIENT GUARD — same cheap re-verify as mergeDuplicateAddressGroup/
        // deleteBlankManualContact. The delete is UUID-pinned so it can't retarget, but this
        // removes a record from the patient the GP was looking at when they confirmed the match;
        // if the page has moved on, that decision no longer refers to what's on screen.
        const ctx = window.ContactsApi.resolveContext();
        if (!ctx || ctx.patientId !== cs.patientId) {
          throw new Error('The page has moved to a different patient — reopen the canvas and try again.');
        }
        await window.ContactsApi.deletePatientContactRelationship(cs.apiBase, manual.id);
        if (cs.pendingMerge !== pm) return; // cancelled or superseded mid-request
        cs.manualCards = cs.manualCards.filter((c) => c.id !== manual.id);
        cs.doneSummary = `${manual.name}'s manual contact removed — ${pm.medicusPreview.linkPatientName} is already linked and placed in the family tree.`;
        cs.pendingMerge = null;
      } catch (err) {
        cs.mergeError = err.message || 'Failed to remove the manual duplicate.';
      } finally {
        if (cs.pendingMerge === pm) pm.finalizing = false;
        render();
      }
      return;
    }
    const notesParts = [];
    if (pm.keepNotes && pm.manualDetail.patientContactRelationshipNotes) {
      notesParts.push(pm.manualDetail.patientContactRelationshipNotes.trim());
    }
    if (pm.keepManualPhone) {
      // Every type that actually differs (buildPhoneRows only flags the first entry of a type as
      // differing — the one genuinely comparable against the manual side's single value for it).
      const differing = buildPhoneRows(pm.manualPhones, pm.medicusPhones).filter((r) => r.differs);
      for (const r of differing) {
        notesParts.push(`Also reachable on ${r.manual} (${r.label}, from previous manual contact record)`);
      }
    }
    if (pm.keepManualEmail && pm.manualEmail) {
      notesParts.push(`Also reachable on ${pm.manualEmail} (from previous manual contact record)`);
    }
    manual.mergedWith = pm.medicusId;
    manual.mergedNotes = notesParts.join(' — ');
    cs.pendingMerge = null;
    render();
  }

  function cancelMerge() {
    cs.pendingMerge = null;
    cs.mergeError = null;
    cs.phoneEdit = null;
    render();
  }

  // ── Candidate's own phone-number editing (from the merge panel) ─────────────────────────────
  // A materially different write from everything else in this file: it mutates the CANDIDATE's
  // own registered demographic data (via ContactsApi.changeTelephoneNumber), not a "contact"
  // relationship record. Kept to a tight scope — edit an EXISTING number only, opened only from
  // the merge panel's Phone row, closed as soon as the merge it belongs to moves on.

  async function startPhoneEdit(telephoneNumberId, forMedicusId, candidateName) {
    cs.phoneEdit = {
      telephoneNumberId,
      forMedicusId,
      candidateName,
      loading: true,
      error: null,
      saving: false,
      form: null,
    };
    render();
    try {
      const data = await window.ContactsApi.getEditTelephoneNumber(cs.apiBase, telephoneNumberId);
      if (!cs.phoneEdit || cs.phoneEdit.telephoneNumberId !== telephoneNumberId) return; // cancelled or superseded mid-fetch
      cs.phoneEdit.form = {
        telephoneNumber: data.telephoneNumber || '',
        telephoneNumberType: data.telephoneNumberType || '',
        telephoneNumberTypes: data.telephoneNumberTypes || [],
        preferredTelephoneNumberForSms: !!data.preferredTelephoneNumberForSms,
        notes: data.notes || '',
      };
    } catch (err) {
      if (cs.phoneEdit && cs.phoneEdit.telephoneNumberId === telephoneNumberId) {
        cs.phoneEdit.error = err.message || 'Failed to load this phone number for editing.';
      }
    } finally {
      if (cs.phoneEdit && cs.phoneEdit.telephoneNumberId === telephoneNumberId) cs.phoneEdit.loading = false;
      render();
    }
  }

  function cancelPhoneEdit() {
    cs.phoneEdit = null;
    render();
  }

  async function savePhoneEdit() {
    const pe = cs.phoneEdit;
    if (!pe || !pe.form) return;
    // The write-target equivalent of the wrong-patient guard elsewhere in this codebase: the
    // merge this edit was opened from must still be for the same candidate. Without this, a slow
    // save landing after the user has already moved on to merging someone else could silently
    // edit the WRONG patient's phone number.
    if (!cs.pendingMerge || cs.pendingMerge.medicusId !== pe.forMedicusId) {
      pe.error = 'This merge has moved on to a different candidate — reopen the edit to try again.';
      render();
      return;
    }
    pe.saving = true;
    pe.error = null;
    render();
    try {
      await window.ContactsApi.changeTelephoneNumber(cs.apiBase, {
        id: pe.telephoneNumberId,
        telephoneNumber: pe.form.telephoneNumber,
        telephoneNumberType: pe.form.telephoneNumberType,
        preferredTelephoneNumberForSms: pe.form.preferredTelephoneNumberForSms,
        notes: pe.form.notes || null,
      });
      if (!cs.pendingMerge || cs.pendingMerge.medicusId !== pe.forMedicusId) return; // superseded mid-save
      // Re-fetch rather than patch the saved entry in place: this edit form's telephoneNumberType
      // values are lowercase ('home') while patient-details' are title-case ('Home'), and a type
      // CHANGE also reshuffles which buildPhoneRows group this entry belongs to — simplest and
      // most correct to just ask Medicus again rather than hand-translate both.
      const medicusDetails = await window.ContactsApi.getPatientDetails(cs.apiBase, pe.forMedicusId);
      if (!cs.pendingMerge || cs.pendingMerge.medicusId !== pe.forMedicusId) return; // superseded mid-refetch
      cs.pendingMerge.medicusPhones =
        (medicusDetails.patientContactInformationSection &&
          medicusDetails.patientContactInformationSection.patientTelephoneNumbers) ||
        [];
      cs.pendingMerge.phonesDiffer = buildPhoneRows(cs.pendingMerge.manualPhones, cs.pendingMerge.medicusPhones).some(
        (r) => r.differs
      );
      cs.phoneEdit = null;
    } catch (err) {
      pe.error = err.message || 'Failed to save this phone number.';
    } finally {
      if (cs.phoneEdit === pe) pe.saving = false;
      render();
    }
  }

  // deletePhoneNumber — the merge panel's per-row Delete button, confirmed via HAR capture
  // 2026-07-26 (a mobile number wrongly filed as "Home", fixed via Edit, then deleted outright
  // once confirmed to be a leftover from before direct patient-linking existed — a partner's own
  // number kept on this patient's record as a workaround, now defunct). Same wrong-patient guard
  // and re-fetch-rather-than-patch convention as savePhoneEdit.
  async function deletePhoneNumber(telephoneNumberId, forMedicusId) {
    const pm = cs.pendingMerge;
    if (!pm || pm.medicusId !== forMedicusId) {
      cs.mergeError = 'This merge has moved on to a different candidate — reopen it to try again.';
      render();
      return;
    }
    pm.phoneActionError = null;
    cs.phoneDeleting.add(telephoneNumberId);
    render();
    try {
      await window.ContactsApi.deleteTelephoneNumber(cs.apiBase, telephoneNumberId);
      if (cs.pendingMerge !== pm) return; // superseded mid-delete
      const medicusDetails = await window.ContactsApi.getPatientDetails(cs.apiBase, forMedicusId);
      if (cs.pendingMerge !== pm) return; // superseded mid-refetch
      pm.medicusPhones =
        (medicusDetails.patientContactInformationSection &&
          medicusDetails.patientContactInformationSection.patientTelephoneNumbers) ||
        [];
      pm.phonesDiffer = buildPhoneRows(pm.manualPhones, pm.medicusPhones).some((r) => r.differs);
    } catch (err) {
      pm.phoneActionError = err.message || 'Failed to delete this phone number.';
    } finally {
      cs.phoneDeleting.delete(telephoneNumberId);
      render();
    }
  }

  // fixPhoneType(telephoneNumberId, forMedicusId) — one-click version of the phone-edit flow,
  // specifically for the "Fix type" button. Clicking it IS the confirmation: the warning right
  // next to the button already states plainly what's wrong ("this looks like a mobile number, but
  // is filed as Home") — no separate review step needed on top of that, per the user's own
  // framing. Still fetches fresh first rather than reusing pm.medicusPhones (which could be stale
  // by the time this fires) — changeTelephoneNumber is a full replace, not a partial patch, so
  // every OTHER field (the number itself, preferredForSms, notes) must be sent back exactly as
  // currently recorded or they'd be silently wiped; only telephoneNumberType is actually changed
  // here. Entry-scoped by telephoneNumberId throughout, same as deletePhoneNumber — a patient with
  // several Home numbers is safe by construction, since this never acts on "the Home number"
  // generically, only the one specific row whose OWN number looked wrong in the first place (see
  // the wrongType check in buildPhoneRows) — there is nothing here that could touch a different,
  // correctly-filed entry, however many of them exist.
  async function fixPhoneType(telephoneNumberId, forMedicusId) {
    const pm = cs.pendingMerge;
    if (!pm || pm.medicusId !== forMedicusId) {
      cs.mergeError = 'This merge has moved on to a different candidate — reopen it to try again.';
      render();
      return;
    }
    pm.phoneActionError = null;
    cs.phoneFixingType.add(telephoneNumberId);
    render();
    try {
      const current = await window.ContactsApi.getEditTelephoneNumber(cs.apiBase, telephoneNumberId);
      if (cs.pendingMerge !== pm) return; // superseded mid-fetch
      // Found live (API 400: "The value you selected is not a valid choice."): the WRITE value
      // this endpoint expects for `telephoneNumberType` is NOT necessarily the same string as the
      // READ-side value shown in patientTelephoneNumbers[] (which is where 'Mobile' — hardcoded
      // here originally — was wrongly copied from). `telephoneNumberTypes` on THIS SAME response
      // is the authoritative list of valid write values (it's what already populates the regular
      // Edit form's own dropdown, which works) — resolve "Mobile" from there instead of assuming.
      const mobileOption = (current.telephoneNumberTypes || []).find(
        (t) =>
          String((t && t.label) || '')
            .trim()
            .toLowerCase() === 'mobile'
      );
      if (!mobileOption) {
        throw new Error('Could not find a "Mobile" option for this phone number — nothing was changed.');
      }
      await window.ContactsApi.changeTelephoneNumber(cs.apiBase, {
        id: telephoneNumberId,
        telephoneNumber: current.telephoneNumber,
        telephoneNumberType: mobileOption.value,
        preferredTelephoneNumberForSms: !!current.preferredTelephoneNumberForSms,
        notes: current.notes || '',
      });
      if (cs.pendingMerge !== pm) return; // superseded mid-save
      const medicusDetails = await window.ContactsApi.getPatientDetails(cs.apiBase, forMedicusId);
      if (cs.pendingMerge !== pm) return; // superseded mid-refetch
      pm.medicusPhones =
        (medicusDetails.patientContactInformationSection &&
          medicusDetails.patientContactInformationSection.patientTelephoneNumbers) ||
        [];
      pm.phonesDiffer = buildPhoneRows(pm.manualPhones, pm.medicusPhones).some((r) => r.differs);
    } catch (err) {
      pm.phoneActionError = err.message || "Failed to fix this phone number's type.";
    } finally {
      cs.phoneFixingType.delete(telephoneNumberId);
      render();
    }
  }

  // mergeDuplicateAddressGroup(groupKey) — deletes every duplicate in the group EXCEPT the one
  // buildAddressMergeGroups already chose to keep (correspondence-address first, then most
  // complete). groupKey is plan.indexes.join(',') — cheap, stable enough to identify a group for
  // the lifetime of one render (indexes only change on a fresh loadCanvas). No confirm() dialog —
  // the panel already shows exactly what will be kept vs deleted before this button is reachable
  // at all, same "the visible context IS the confirmation" convention as fixPhoneType/
  // deletePhoneNumber elsewhere in this file, not a separate popup on top of that.
  //
  // ORDER IS SAFETY-CRITICAL: the correspondence-address flag is transferred to the SURVIVOR
  // FIRST, and only then are the duplicates deleted. The original order (delete everything, then
  // move the flag) meant a failure of that final POST — the exact moment the flag-holding address
  // had just been deleted — left the patient with NO correspondence address at all, silently:
  // letters then go nowhere, and nothing on screen says so. Reversed, the worst case is a failure
  // part-way through the deletes, which leaves EXTRA duplicate addresses behind — visible,
  // harmless, and re-mergeable on the next canvas open. Either ordering ends in the same place on
  // the happy path (whether Medicus enforces one-correspondence-address-per-patient server-side or
  // tolerates two transiently, the survivor holds the flag and the duplicates are gone), so there
  // is nothing to trade off here — only the failure mode differs.
  async function mergeDuplicateAddressGroup(groupKey) {
    const plan = cs.addressMergeGroups.find((g) => g.indexes.join(',') === groupKey);
    if (!plan) return;
    const st = cs;
    // Fail closed, independently of the button's disabled attribute (see buildAddressMergeGroups):
    // if any member's correspondence status couldn't be read, the flag transfer can't be planned,
    // so nothing may be deleted.
    if (plan.unverifiedIndexes && plan.unverifiedIndexes.length) {
      st.addressMergeError =
        'Could not verify which of these addresses is the correspondence address, so nothing was deleted — reopen the canvas to retry, or merge them in Medicus directly.';
      render();
      return;
    }
    if (st.addressMerging.has(groupKey)) return; // already mid-merge — never fire the deletes twice
    st.addressMergeError = null;
    st.addressMerging.add(groupKey);
    render();
    try {
      // WRONG-PATIENT GUARD: re-verify immediately before the writes — same discipline as
      // doCanvasConfirm/doImportConfirm, since this deletes real address records.
      const ctx = window.ContactsApi.resolveContext();
      if (!ctx || ctx.patientId !== st.patientId) {
        throw new Error('The page has moved to a different patient — reopen the canvas and try again.');
      }
      // STEP 1 — if the GP kept a DIFFERENT address than the one that held the correspondence-
      // address flag, carry that designation over to the survivor BEFORE any delete (see this
      // function's own comment above for why the order matters). A full-replace write
      // (ContactRelationships.buildChangeAddressBody), built entirely from data already on hand
      // (the kept address's own fields, plus its getEditAddress detail already fetched into
      // plan.details) — no OS Places re-search needed, see that function's own comment for why
      // Medicus's own UI for this makes a GP do that even though the endpoint doesn't require it.
      // A failure here throws before anything has been deleted, so the patient's record is left
      // exactly as it was.
      if (plan.correspondenceIndex !== -1 && plan.correspondenceIndex !== plan.keepIndex) {
        const keepPos = plan.indexes.indexOf(plan.keepIndex);
        const keepEntry = st.indexAddresses[plan.keepIndex];
        const keepDetail = plan.details[keepPos] || {};
        if (!keepEntry || !keepEntry.addressId) {
          throw new Error(
            'Could not identify the address to keep, so the correspondence address could not be moved — nothing was deleted.'
          );
        }
        await window.ContactsApi.changeAddress(
          st.apiBase,
          window.ContactRelationships.buildChangeAddressBody({
            addressId: keepEntry.addressId,
            address: keepEntry.address,
            description: keepDetail.description,
            accessNotes: keepDetail.accessNotes,
            isCorrespondenceAddress: true,
          })
        );
        if (st !== cs) return;
      }
      // STEP 2 — now, and only now, delete the duplicates.
      const toDelete = plan.indexes.filter((idx) => idx !== plan.keepIndex);
      for (const idx of toDelete) {
        const entry = st.indexAddresses[idx];
        if (!entry || !entry.addressId) continue;
        await window.ContactsApi.deleteAddress(st.apiBase, entry.addressId);
        if (st !== cs) return;
      }
      // Re-fetch rather than patching indexes locally — deleting shifts array positions in ways
      // that would be fragile to track by hand; simpler and safer to just ask Medicus what's left.
      const refreshedDetails = await window.ContactsApi.getPatientDetails(st.apiBase, st.patientId);
      if (st !== cs) return;
      st.indexAddresses =
        (refreshedDetails.patientAddressSection && refreshedDetails.patientAddressSection.patientAddresses) || [];
      st.duplicateAddressGroups = window.ContactRelationships.findDuplicateAddressGroups(st.indexAddresses);
      st.addressMergeGroups = await buildAddressMergeGroups(st.apiBase, st.indexAddresses, st.duplicateAddressGroups);
      if (st !== cs) return;
    } catch (err) {
      // Copy matches the write order above: because the correspondence-address flag is moved
      // BEFORE anything is deleted, a failure here can only ever leave extra duplicates behind —
      // it can never have left this patient without a correspondence address. Say so explicitly,
      // so a GP seeing this doesn't have to go and check that themselves.
      st.addressMergeError = `${err.message || 'Failed to merge these addresses.'} Some duplicates may still be there — refresh to check what remains. The correspondence address is always set on the address you kept before anything is deleted, so it cannot have been lost.`;
    } finally {
      if (st === cs) {
        st.addressMerging.delete(groupKey);
        render();
      }
    }
  }

  function tryMerge(sourceId, sourceKind, targetId, targetKind) {
    // Only manual<->medicus pairs can merge (declaring "these are the same person").
    const isManualMedicus =
      (sourceKind === 'manual' && (targetKind === 'medicus' || targetKind === 'address')) ||
      (targetKind === 'manual' && (sourceKind === 'medicus' || sourceKind === 'address'));
    if (!isManualMedicus) return false;
    const manualId = sourceKind === 'manual' ? sourceId : targetId;
    const medicusId = sourceKind === 'manual' ? targetId : sourceId;
    startMerge(manualId, medicusId);
    return true;
  }

  function buildConfirmForCard(card, kind, slotPath) {
    const CR = window.ContactRelationships;
    let candidatePatientId = card.id;
    let manualContactIdToDelete = null;
    if (kind === 'manual') {
      // A manual-only card dropped directly can't be linked without a real patient — unless it's
      // been merged with a Medicus candidate first.
      if (!card.mergedWith) return null;
      candidatePatientId = card.mergedWith;
      manualContactIdToDelete = card.id;
    } else {
      // A Medicus/address card dropped — if it happens to be the merge target of some manual
      // card, treat that manual card as the one being superseded.
      const pairedManual = cs.manualCards.find((c) => c.mergedWith === card.id);
      if (pairedManual) manualContactIdToDelete = pairedManual.id;
    }
    const existingReciprocal = CR.findExistingReciprocal(cs.indexPatientDetails, candidatePatientId);
    const existingForwardLink = CR.findExistingForwardLink(cs.indexPatientDetails, candidatePatientId);
    const medicusCard =
      cs.suggestedCards.find((c) => c.id === candidatePatientId) ||
      cs.linkedCards.find((c) => c.id === candidatePatientId) ||
      cs.transitiveCards.find((c) => c.id === candidatePatientId);
    const manualCard = manualContactIdToDelete ? cs.manualCards.find((c) => c.id === manualContactIdToDelete) : null;
    const guess = manualCard ? CR.normaliseFreeText(manualCard.relationshipText) : null;
    // Deliberately NOT using a transitively-sourced card's own hint text as a baseId guess in the
    // general case: it describes either the HUB patient's label for this contact, or this
    // contact's own label for the hub — never the index patient's relationship to them —
    // confirmed live to be actively wrong whenever the hub isn't the index patient themselves
    // (e.g. hub's "Daughter" pulled in as a guess for the index patient, when the correct
    // relationship is "Sister" — both are the hub's daughters). Composing the CORRECT relationship
    // from the index-to-hub and hub-to-contact relationships in general is real, separate,
    // scoped-for-later work (relationship composition) — falls through to 'other' below for that
    // general case, same as a genuinely unknown candidate; the hint is still shown in
    // renderSources' sub-label so the user has the context to pick correctly themselves. ONE
    // specific composition is safe to pre-fill today, though: a placed parent's own recognised
    // mother/father (loadCanvas' grandparents step) is deterministic, not a guess — that's what
    // `medicusCard.guessedBaseId` carries, checked below.
    const reciprocalSuggestion = CR.suggestForwardFromReciprocal(
      existingReciprocal,
      medicusCard && medicusCard.genderIdentity
    );
    // A medicusCard carrying its own baseId means Medicus's own free text for this ALREADY-REAL
    // link parsed to a canonical id (see loadCanvas) — that's the authoritative source, outranking
    // any guess derived from the manual card's own, separate free text or a reciprocal suggestion.
    // relationshipKnown drives renderConfirmPanel: an unrecognised already-linked card (baseId
    // null) still needs the picker shown so the user explicitly sets it, even though nothing about
    // it gets written to Medicus — a recognised one doesn't need asking at all.
    const relationshipKnown = !!(medicusCard && medicusCard.baseId);
    let baseId, modifierId;
    if (relationshipKnown) {
      baseId = medicusCard.baseId;
      modifierId = medicusCard.modifierId || null;
    } else {
      baseId =
        (reciprocalSuggestion && reciprocalSuggestion.baseId) ||
        (medicusCard && medicusCard.guessedBaseId) ||
        (guess && guess.baseId) ||
        'other';
      modifierId = (reciprocalSuggestion && reciprocalSuggestion.modifierId) || (guess && guess.modifierId) || null;
    }
    // The dropped-on slot wins over a guessed/reciprocal-suggested baseId that doesn't actually
    // belong there (e.g. a manual contact whose free text guessed "friend" but was dragged into
    // the Parents slot) — default to a gender-appropriate relationship for that slot instead
    // (pickBaseIdForSlot), still fully editable in the confirm panel.
    if (slotPath) {
      const validIds = slotBaseIds(slotPath);
      if (validIds.length && !validIds.includes(baseId)) {
        baseId = pickBaseIdForSlot(slotPath, medicusCard && medicusCard.genderIdentity);
        modifierId = null;
      }
    }
    let reverseBaseId = null;
    let reverseAmbiguous = false;
    if (!existingReciprocal) {
      const indexGender =
        cs.indexPatientDetails.patientDetailsSection && cs.indexPatientDetails.patientDetailsSection.genderIdentity;
      const inv = CR.invertRelationship({ baseId, modifierId, indexGender });
      reverseAmbiguous = inv.ambiguous;
      reverseBaseId = inv.ambiguous ? null : inv.baseId;
    }
    return {
      candidatePatientId,
      candidateDisplayName: (medicusCard && medicusCard.name) || card.name,
      manualContactIdToDelete,
      notes: (manualCard && manualCard.mergedNotes) || '',
      baseId,
      modifierId,
      relationshipKnown,
      slotPath: slotPath || null,
      forwardIsNextOfKin: false,
      forwardCopyCorrespondence: false,
      reverseBaseId,
      reverseAmbiguous,
      reverseIsNextOfKin: false,
      reverseCopyCorrespondence: false,
      existingReciprocal,
      existingForwardLink,
    };
  }

  // bestManualMatchFor(card) -> manualCard.id | null. Reuses ContactMatch's name-similarity scoring
  // — the same function that ranks Medicus search results against a manual contact when the canvas
  // first loads — just called the other way round: one already-linked person, several manual
  // contacts, to find which one this card is most likely a duplicate of. Works the same for a
  // recognised (already placed in the tree) or unrecognised linked card — see renderSources/
  // renderTree, the single mechanism both use. A zero score means no detectable similarity at all,
  // not "least-bad guess" — treated as no match.
  function bestManualMatchFor(card) {
    let best = null;
    for (const mc of cs.manualCards) {
      if (mc.mergedWith) continue; // already resolved this session — not a candidate for a new pairing
      const { score } = window.ContactMatch.scoreCandidate(
        { name: mc.name, relationshipText: mc.relationshipText },
        { patientId: card.id, displayName: card.name }
      );
      // Found live: no `manualRelationshipGuess`/`indexPatientAge` is passed here (there's no
      // slot/relationship context yet — that's the whole point of this function), so `baseId` is
      // always undefined inside scoreCandidate, which makes age/gender each default to a neutral
      // 1 rather than an actual signal (see agePlausibility/genderConsistency's `baseId ? … : 1`).
      // That's a guaranteed 15-point baseline (8+7) for EVERY pairing regardless of name — so with
      // only one manual contact on a record, `score > 0` matched it against every already-linked
      // contact compared against it, not just the real duplicate (confirmed live: a child wrongly
      // swept into a manual duplicate's review-matches purely on this baseline, alongside the
      // actual match). Raised to the same `>= 40` ("possible" tier or better) bar already used for
      // `bestTransitiveMatchFor` — the baseline alone can no longer clear it; real name similarity
      // has to do the work.
      if (score >= 40 && (!best || score > best.score)) best = { id: mc.id, score };
    }
    return best ? best.id : null;
  }

  // bestTransitiveMatchFor(mc, pool) -> {patientId, name, genderIdentity?, hint, score, tier} | null
  // Same lightweight name-similarity scoring as bestManualMatchFor — a pooled entry only ever
  // carries a name (plus genderIdentity for the related patient themselves — already fetched for
  // that one; the other two pool directions would need yet another per-contact fetch, not worth it
  // for this purpose) — called once per manual contact in loadCanvas's step 1.5 to decide whether
  // it can skip the generic patient-finder search for that contact.
  function bestTransitiveMatchFor(mc, pool) {
    let best = null;
    for (const t of pool) {
      const { score, tier } = window.ContactMatch.scoreCandidate(
        { name: mc.name },
        { patientId: t.patientId, displayName: t.name }
      );
      if (score > 0 && (!best || score > best.score)) best = { ...t, score, tier };
    }
    return best;
  }

  function tryAssign(cardId, cardKind, slotPath) {
    const card = findCard(cardId, cardKind);
    if (!card) return;
    // A stale "done" summary from a PREVIOUS link takes priority in renderConfirmPanel over
    // cs.confirm — without clearing it here, this new pending decision would be set correctly but
    // invisible, stuck behind the old success message until "Link another"/"Refresh now" is
    // clicked. Clearing it here is what actually makes the file's own stated intent true: dragging
    // the next card straight onto a slot should just work without clicking anything first.
    cs.doneSummary = null;
    cs.reverseManualMatch = null;
    cs.reverseManualMatchError = null;
    const confirm = buildConfirmForCard(card, cardKind, slotPath);
    if (!confirm) {
      cs.workingError =
        'A manual-only contact needs to be merged with a Medicus match first — drag it onto a candidate in the sources list below.';
      cs.confirmCardId = cardId;
      cs.confirmCardKind = cardKind;
      cs.confirm = null;
      render();
      return;
    }
    cs.confirmCardId = cardId;
    cs.confirmCardKind = cardKind;
    cs.confirm = confirm;
    cs.workingError = null;
    render();
  }

  // describeLinkProgress(confirm, progress) -> { done: [label], remaining: [label] }
  // Turns performLinkAndCleanup's per-step progress object (see that function — it's the same
  // object handed back on the thrown error and passed straight back in on retry) into plain
  // English for the failure message. Only the steps that ACTUALLY apply to this particular confirm
  // are listed: the applies() conditions here mirror, one-for-one, the params doCanvasConfirm
  // passes below, so a step the user was never going to need can't turn up as "still to do".
  function describeLinkProgress(confirm, progress) {
    const p = progress || {};
    const steps = [
      { done: !!p.forwardLink, applies: !confirm.existingForwardLink, label: "the link on this patient's record" },
      {
        done: !!p.relationshipUpdate,
        applies: !!(confirm.existingForwardLink && !confirm.relationshipKnown),
        label: 'the corrected relationship on the existing link',
      },
      {
        // reverseAlreadyPresent counts as done: the reverse link is on record, this attempt just
        // (correctly) didn't create it — see performLinkAndCleanup's staleness re-derive.
        done: !!(p.reverseLink || p.reverseAlreadyPresent),
        applies: !!confirm.reverseBaseId,
        label: `the reverse link on ${confirm.candidateDisplayName}'s own record`,
      },
      {
        done: !!p.manualDelete,
        applies: !!confirm.manualContactIdToDelete,
        label: 'removing the old manual contact',
      },
    ].filter((s) => s.applies);
    return {
      done: steps.filter((s) => s.done).map((s) => s.label),
      remaining: steps.filter((s) => !s.done).map((s) => s.label),
    };
  }

  async function doCanvasConfirm() {
    if (!cs.confirm) return;
    // In-flight guard, checked-and-set synchronously before anything async: the button is also
    // rendered disabled below, but the flag is what actually makes a second call impossible — see
    // cs.confirming's own comment for why a duplicate reverse link is the specific hazard.
    if (cs.confirming) return;
    const st = cs;
    st.confirming = true;
    cs.workingError = null;
    render();
    try {
      const result = await window.ContactsApi.performLinkAndCleanup({
        apiBase: st.apiBase,
        patientId: st.patientId,
        candidatePatientId: st.confirm.candidatePatientId,
        candidateDisplayName: st.confirm.candidateDisplayName,
        indexPatientFullName:
          st.indexPatientDetails.patientDetailsSection && st.indexPatientDetails.patientDetailsSection.fullOfficialName,
        baseId: st.confirm.baseId,
        modifierId: st.confirm.modifierId,
        forwardIsNextOfKin: st.confirm.forwardIsNextOfKin,
        forwardCopyCorrespondence: st.confirm.forwardCopyCorrespondence,
        notes: st.confirm.notes,
        existingForwardLink: st.confirm.existingForwardLink,
        // Only set when the link already exists AND its relationship wasn't already known
        // (relationshipKnown false — the picker was shown and the user just chose one) — write it
        // back to Medicus rather than only reclassifying it locally for this session.
        relationshipUpdateId:
          st.confirm.existingForwardLink && !st.confirm.relationshipKnown
            ? st.confirm.existingForwardLink.patientContactId
            : null,
        reverseBaseId: st.confirm.reverseBaseId,
        reverseIsNextOfKin: st.confirm.reverseIsNextOfKin,
        reverseCopyCorrespondence: st.confirm.reverseCopyCorrespondence,
        existingReciprocal: st.confirm.existingReciprocal,
        manualContactIdToDelete: st.confirm.manualContactIdToDelete,
        // RESUMABLE RETRY (see performLinkAndCleanup): whatever the previous attempt got through
        // before it failed, carried back in so this attempt skips it. Without this, a failure
        // after the forward link had already succeeded left the retry structurally impossible —
        // clicking Confirm again re-POSTed the forward link, which 400s ("Patient Contact already
        // exists") before the remaining steps ever ran, so the half-finished write could never be
        // completed from this panel at all.
        progress: st.confirm.linkProgress || null,
      });
      if (st !== cs) return;
      st.confirm.linkProgress = null; // fully completed — a later, unrelated confirm must start clean
      st.doneSummary = result.summary;
      st.reverseManualMatch = result.reverseManualMatch;
      // Remove the linked manual card from column 1 so the canvas reflects the change immediately
      // (Medicus's own page still needs a refresh — same limitation as the wizard).
      if (st.confirm.manualContactIdToDelete) {
        st.manualCards = st.manualCards.filter((c) => c.id !== st.confirm.manualContactIdToDelete);
      }
      // Pre-place the new edge into the tree as locked, and drop the candidate from the
      // suggestion/address sources, so the slot the card was dropped on shows it immediately
      // without waiting for Medicus's own page refresh — recordCommittedEdge's whole point
      // (engine/contact-tree.js), applied here by rebuilding the locked half after a successful write.
      if (st.confirm.slotPath) {
        // When a real link already existed (existingForwardLink), what got recorded on Medicus may
        // not match the guessed baseId shown while the dropdown was hidden — re-derive the locked
        // label from what's actually on record rather than the unedited guess.
        let lockedBaseId = st.confirm.baseId;
        let lockedModifierId = st.confirm.modifierId;
        if (st.confirm.existingForwardLink) {
          const existingGuess = window.ContactRelationships.normaliseFreeText(
            st.confirm.existingForwardLink.patientContactRelationship
          );
          if (existingGuess) {
            lockedBaseId = existingGuess.baseId;
            lockedModifierId = existingGuess.modifierId;
          }
        }
        st.tree = window.ContactTree.assignToSlot(
          st.tree,
          st.confirm.slotPath,
          {
            id: st.confirm.candidatePatientId,
            patientId: st.confirm.candidatePatientId,
            name: st.confirm.candidateDisplayName,
          },
          {
            baseId: lockedBaseId,
            modifierId: lockedModifierId,
            isNextOfKin: st.confirm.forwardIsNextOfKin,
            copyCorrespondence: st.confirm.forwardCopyCorrespondence,
            locked: true,
          }
        );
        if (!st.linkedCards.some((c) => c.id === st.confirm.candidatePatientId)) {
          const lockedLabel = window.ContactRelationships.formatLabel(lockedBaseId, lockedModifierId);
          st.linkedCards.push({
            id: st.confirm.candidatePatientId,
            name: st.confirm.candidateDisplayName,
            relationshipText: lockedLabel,
            colour: colourForRelationshipText(lockedLabel),
            isLinked: true,
            isNextOfKin: !!st.confirm.forwardIsNextOfKin,
          });
        }
        // Recompute the NOK/copy-correspondence gap flags (Step 1.10) right now, rather than only
        // on the next full canvas reload — the user's own ask: "it only flags if you reopen a
        // canvas after matching, could we run the check on matching". Cheap and safe as a pure
        // clear-only update: this write can only ever REMOVE a gap (a fresh NOK/copy-correspondence
        // tick just confirmed), never wrongly introduce one, so no re-fetch is needed.
        if (st.confirm.forwardIsNextOfKin) st.hasNoNok = false;
        if (st.isUnder13 && st.confirm.forwardCopyCorrespondence) st.hasNoCopyCorrespondenceU13 = false;
        // Feed the family-cycling pool (engine/contact-tree.js) with this newly-committed edge —
        // recordCommittedEdge is what lets a later "Next family member" screen's composition step
        // know what's already confirmed for THIS patient, and enqueueFamilyMember makes the
        // candidate itself available to cycle to. dob comes from medicusCard when it happens to
        // already be known (a search-result-sourced suggestion carries one) — most already-linked/
        // transitive candidates don't at commit time, so they sort last in the pool until loadCanvas'
        // own Step 1.8 picks up an accurate dob the next time this patient's own canvas (or a hub
        // that reaches them) is built.
        const committedMedicusCard =
          st.suggestedCards.find((c) => c.id === st.confirm.candidatePatientId) ||
          st.linkedCards.find((c) => c.id === st.confirm.candidatePatientId) ||
          st.transitiveCards.find((c) => c.id === st.confirm.candidatePatientId);
        st.familySession = window.ContactTree.recordCommittedEdge(
          st.familySession,
          st.patientId,
          st.tree.edges[st.tree.edges.length - 1]
        );
        st.familySession = window.ContactTree.enqueueFamilyMember(
          st.familySession,
          st.confirm.candidatePatientId,
          (committedMedicusCard && committedMedicusCard.dateOfBirth) || null
        );
        st.suggestedCards = st.suggestedCards.filter((c) => c.id !== st.confirm.candidatePatientId);
        st.addressCards = st.addressCards.filter((c) => c.id !== st.confirm.candidatePatientId);
      }
    } catch (err) {
      if (st === cs) {
        // The old copy here ("nothing further was changed") was actively misleading: this is a
        // sequence of up to four separate POSTs, so a failure part-way means some of them DID
        // land. Report which, keep the progress object on the confirm state so pressing Confirm
        // again resumes rather than restarting, and say that plainly — a GP who can't tell what
        // landed has no way to decide whether to retry here or finish up in Medicus directly.
        if (st.confirm) st.confirm.linkProgress = (err && err.progress) || st.confirm.linkProgress || null;
        const { done, remaining } = st.confirm
          ? describeLinkProgress(st.confirm, st.confirm.linkProgress)
          : { done: [], remaining: [] };
        const parts = [err.message || 'Failed to complete the link.'];
        parts.push(done.length ? `Already done: ${done.join('; ')}.` : 'Nothing was written.');
        if (remaining.length) {
          parts.push(`Still to do: ${remaining.join('; ')}. Confirm again to retry just those steps.`);
        }
        st.workingError = parts.join(' ');
      }
    } finally {
      if (st === cs) {
        st.confirming = false;
        render();
      }
    }
  }

  // ── Event binding ─────────────────────────────────────────────────────────────────────────────

  function bindEvents(overlay) {
    overlay.querySelector('#ms-cv-close')?.addEventListener('click', () => close());
    // Secondary path to the older inline widget (content-scripts/contacts-link-button.js), kept
    // reachable rather than dropped now the header opens this canvas directly — covers the one
    // thing this canvas doesn't: searching an ARBITRARY other patient (not just ones already
    // reciprocally connected via "Listed as Contact For") and bulk-selecting several of their
    // contacts in one action. The widget's OTHER original flow (single-contact pick → search →
    // confirm) was retired entirely 2026-07-28 once this canvas had fully superseded it — see the
    // build plan's status addendum and CHANGELOG v3.189.0. Closes this overlay WITHOUT the reload
    // close() normally does (see close()'s own comment) — the widget renders in place at its own
    // position on the page, not as an overlay on top of this.
    overlay.querySelector('#ms-cv-next-family')?.addEventListener('click', () => advanceToNextFamilyMember());
    overlay.querySelector('#ms-cv-open-import')?.addEventListener('click', () => {
      if (!confirmDiscardUnfinishedMerge()) return;
      closeOverlay();
      window.ContactsWidget.openImport();
    });

    let dragPayload = null;
    overlay.querySelectorAll('.ms-cv-card[draggable="true"]').forEach((el) => {
      el.addEventListener('dragstart', (e) => {
        dragPayload = { id: el.getAttribute('data-card-id'), kind: el.getAttribute('data-card-kind') };
        e.dataTransfer.setData('text/plain', JSON.stringify(dragPayload));
        e.dataTransfer.effectAllowed = 'move';
      });
      el.addEventListener('dragover', (e) => {
        if (!dragPayload) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      });
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        if (!dragPayload) return;
        const targetId = el.getAttribute('data-card-id');
        const targetKind = el.getAttribute('data-card-kind');
        if (dragPayload.id === targetId && dragPayload.kind === targetKind) return;
        tryMerge(dragPayload.id, dragPayload.kind, targetId, targetKind);
        dragPayload = null;
      });
    });

    overlay.querySelectorAll('.ms-cv-slot[data-slot-path], .ms-cv-tree-branch-item[data-slot-path]').forEach((zone) => {
      zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      });
      zone.addEventListener('drop', (e) => {
        e.preventDefault();
        const raw = e.dataTransfer.getData('text/plain');
        if (!raw) return;
        try {
          const payload = JSON.parse(raw);
          tryAssign(payload.id, payload.kind, zone.getAttribute('data-slot-path'));
        } catch (_) {
          /* ignore malformed drag payload */
        }
      });
    });

    overlay.querySelectorAll('[data-expand-slot]').forEach((btn) => {
      btn.addEventListener('click', () => {
        cs.expandedSlots[btn.getAttribute('data-expand-slot')] = true;
        render();
      });
    });

    overlay.querySelector('#ms-cv-base')?.addEventListener('change', (e) => {
      cs.confirm.baseId = e.target.value;
      cs.confirm.modifierId = null;
      const CR = window.ContactRelationships;
      if (!cs.confirm.existingReciprocal) {
        const indexGender =
          cs.indexPatientDetails.patientDetailsSection && cs.indexPatientDetails.patientDetailsSection.genderIdentity;
        const inv = CR.invertRelationship({
          baseId: cs.confirm.baseId,
          modifierId: cs.confirm.modifierId,
          indexGender,
        });
        cs.confirm.reverseAmbiguous = inv.ambiguous;
        cs.confirm.reverseBaseId = inv.ambiguous ? null : inv.baseId;
      }
      render();
    });
    overlay.querySelectorAll('input[name="ms-cv-mod"]').forEach((r) => {
      r.addEventListener('change', (e) => {
        if (!e.target.checked) return;
        cs.confirm.modifierId = e.target.value || null;
        render();
      });
    });
    overlay.querySelector('#ms-cv-fwd-nok')?.addEventListener('change', (e) => {
      cs.confirm.forwardIsNextOfKin = e.target.checked;
    });
    overlay.querySelector('#ms-cv-fwd-copy')?.addEventListener('change', (e) => {
      cs.confirm.forwardCopyCorrespondence = e.target.checked;
    });
    overlay.querySelector('#ms-cv-rev-nok')?.addEventListener('change', (e) => {
      cs.confirm.reverseIsNextOfKin = e.target.checked;
    });
    overlay.querySelector('#ms-cv-rev-copy')?.addEventListener('change', (e) => {
      cs.confirm.reverseCopyCorrespondence = e.target.checked;
    });

    overlay.querySelector('#ms-cv-confirm')?.addEventListener('click', () => doCanvasConfirm());
    overlay.querySelector('#ms-cv-drop-clear')?.addEventListener('click', () => {
      cs.confirmCardId = null;
      cs.confirmCardKind = null;
      cs.confirm = null;
      cs.doneSummary = null;
      cs.workingError = null;
      cs.reverseManualMatch = null;
      cs.reverseManualMatchError = null;
      render();
    });
    overlay.querySelector('#ms-cv-reload')?.addEventListener('click', () => location.reload());

    // The one write in this file with NO wrong-patient guard, deliberately: its target is a manual
    // contact on the CANDIDATE's own record (found by findReverseManualMatch, pinned to that
    // record's own server UUID), so the index patient's identity is not part of what it means — a
    // page that has since moved to another patient doesn't make this delete point anywhere else.
    // See contacts-api.js's "Shared write orchestration" header, which records the same exemption.
    // It DOES get an in-flight guard (cs.reverseManualRemoving, checked-and-set synchronously
    // before the first await, plus the rendered button disabled): the old `e.target.disabled =
    // true` alone was defeated by any render() in between, which rebuilds the whole overlay's
    // innerHTML and hands back a fresh, enabled button.
    overlay.querySelector('#ms-cv-remove-reverse-manual')?.addEventListener('click', async () => {
      const match = cs.reverseManualMatch;
      if (!match) return;
      if (cs.reverseManualRemoving) return;
      const st = cs;
      st.reverseManualRemoving = true;
      st.reverseManualMatchError = null;
      render();
      try {
        await window.ContactsApi.deletePatientContactRelationship(st.apiBase, match.patientContactId);
        if (st !== cs) return;
        st.reverseManualMatch = null;
        st.reverseManualMatchError = null;
      } catch (err) {
        if (st !== cs) return;
        st.reverseManualMatchError =
          err.message || 'Failed to remove that manual contact — try again or remove it in Medicus directly.';
      } finally {
        if (st === cs) {
          st.reverseManualRemoving = false;
          render();
        }
      }
    });

    overlay.querySelector('#ms-cv-merge-confirm')?.addEventListener('click', () => confirmMerge());
    overlay.querySelector('#ms-cv-merge-cancel')?.addEventListener('click', () => cancelMerge());
    overlay.querySelector('#ms-cv-merge-keep-phone')?.addEventListener('change', (e) => {
      cs.pendingMerge.keepManualPhone = e.target.checked;
    });
    overlay.querySelector('#ms-cv-merge-keep-email')?.addEventListener('change', (e) => {
      cs.pendingMerge.keepManualEmail = e.target.checked;
    });
    overlay.querySelector('#ms-cv-merge-keep-notes')?.addEventListener('change', (e) => {
      cs.pendingMerge.keepNotes = e.target.checked;
    });

    // One button per phone entry now (buildPhoneRows), not a single row — querySelectorAll, not a
    // single id, or every button after the first would silently do nothing.
    overlay.querySelectorAll('.ms-cv-merge-edit-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        startPhoneEdit(
          btn.getAttribute('data-telephone-id'),
          btn.getAttribute('data-medicus-id'),
          btn.getAttribute('data-candidate-name')
        );
      });
    });
    overlay.querySelectorAll('.ms-cv-merge-fixtype-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        fixPhoneType(btn.getAttribute('data-telephone-id'), btn.getAttribute('data-medicus-id'));
      });
    });
    overlay.querySelectorAll('.ms-cv-merge-delete-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        deletePhoneNumber(btn.getAttribute('data-telephone-id'), btn.getAttribute('data-medicus-id'));
      });
    });
    overlay.querySelectorAll('.ms-cv-delete-manual-btn').forEach((btn) => {
      btn.addEventListener('click', () => deleteBlankManualContact(btn.getAttribute('data-manual-id')));
    });
    overlay.querySelectorAll('.ms-cv-dupaddr-keep-radio').forEach((r) => {
      r.addEventListener('change', (e) => {
        if (!e.target.checked) return;
        const groupKey = r.getAttribute('data-address-group');
        const idx = Number(r.getAttribute('data-address-index'));
        const plan = cs.addressMergeGroups.find((g) => g.indexes.join(',') === groupKey);
        if (plan) plan.keepIndex = idx;
        render();
      });
    });
    overlay.querySelectorAll('.ms-cv-dupaddr-merge').forEach((btn) => {
      btn.addEventListener('click', () => mergeDuplicateAddressGroup(btn.getAttribute('data-address-group')));
    });
    overlay.querySelector('#ms-cv-phone-edit-cancel')?.addEventListener('click', () => cancelPhoneEdit());
    overlay.querySelector('#ms-cv-phone-edit-save')?.addEventListener('click', () => savePhoneEdit());
    overlay.querySelector('#ms-cv-phone-edit-number')?.addEventListener('input', (e) => {
      cs.phoneEdit.form.telephoneNumber = e.target.value;
    });
    overlay.querySelector('#ms-cv-phone-edit-type')?.addEventListener('change', (e) => {
      cs.phoneEdit.form.telephoneNumberType = e.target.value;
    });
    overlay.querySelector('#ms-cv-phone-edit-sms')?.addEventListener('change', (e) => {
      cs.phoneEdit.form.preferredTelephoneNumberForSms = e.target.checked;
    });
    overlay.querySelector('#ms-cv-phone-edit-notes')?.addEventListener('input', (e) => {
      cs.phoneEdit.form.notes = e.target.value;
    });
  }

  // ── Family cycling (cross-page) ──────────────────────────────────────────────────────────────
  // "Next family member" (the header button rendered when cs.familySession.pending is non-empty)
  // sounds like an in-page action but isn't one: loadCanvas() gets its patient entirely from
  // resolveContext()'s reading of location.href, and Medicus is one-patient-per-page, so there is
  // no in-place way to swap this canvas over to a different patient's data. Reaching the next
  // family member means a REAL browser navigation to their own care-record page, which destroys
  // this content script's in-memory `cs`/session — so the family session has to be persisted to
  // chrome.storage.local immediately before navigating, and rehydrated on the other side. This
  // module owns that persist/rehydrate decision itself (engine/contact-tree.js stays storage-free,
  // same "pure core, caller owns storage" split as shared/contact-ledger.js).
  //
  // The resume prompt is a small dismissible banner, not an auto-reopened overlay — live-testing
  // decision: popping a full-screen overlay the instant a new patient's record loads, before the
  // GP has got their bearings on who's now in front of them, is the riskier default for a tool
  // used mid-consultation.

  const FAMILY_SESSION_STORAGE_KEY = 'contactsCanvas.familySession';
  // A cycling session left idle longer than a single working consultation window is more likely
  // abandoned than genuinely paused — same bounded-by-age philosophy as shared/contact-ledger.js's
  // pruning, just for one short-lived record instead of a long-running log.
  const FAMILY_SESSION_MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4 hours

  // targetName travels alongside the session purely for display (the resume banner, so it can say
  // WHOSE record you've landed on) — deliberately kept in this wrapper object, not inside the pure
  // engine session shape itself (window.ContactTree's structure stays name-free, same as every
  // tree edge — see contact-tree.js's own makeEdge comment).
  async function persistFamilySession(session, targetName) {
    await chrome.storage.local.set({
      [FAMILY_SESSION_STORAGE_KEY]: { session, savedAt: Date.now(), targetName: targetName || null },
    });
  }

  async function loadPersistedFamilySession() {
    const result = await chrome.storage.local.get(FAMILY_SESSION_STORAGE_KEY);
    const rec = result && result[FAMILY_SESSION_STORAGE_KEY];
    if (!rec || !rec.session || typeof rec.savedAt !== 'number') return null;
    if (Date.now() - rec.savedAt > FAMILY_SESSION_MAX_AGE_MS) {
      await chrome.storage.local.remove(FAMILY_SESSION_STORAGE_KEY);
      return null;
    }
    return rec;
  }

  async function clearPersistedFamilySession() {
    await chrome.storage.local.remove(FAMILY_SESSION_STORAGE_KEY);
  }

  // buildNavigationUrl — the current URL definitely contains `fromPatientId` verbatim (that's
  // literally how resolveContext derived it, via detectMedicusContext's UUID match against
  // location.href), so swapping that substring for the target id is precise and pattern-agnostic —
  // no need to separately re-derive or assume which of care-record/patient/query-param form this
  // site happens to use.
  function buildNavigationUrl(fromPatientId, toPatientId) {
    return location.href.split(fromPatientId).join(toPatientId);
  }

  // advanceToNextFamilyMember — the skip loop for an inactive candidate runs HERE, on the current
  // page, before ever navigating: getPatientDetails is a plain credentialed fetch scoped by
  // apiBase, not a "must be on that patient's own page" action (the same pattern loadCanvas already
  // relies on for related-patient/grandparent fetches), so an inactive-access 403 can be discovered
  // without leaving this page at all. NOT silent, though — an inactive/deceased record is exactly
  // the "Inactive record" badge case (see cardHtml), so a skipped candidate's own card in THIS
  // patient's tree gets flagged rather than the signal just being thrown away; a dead next-of-kin
  // still listed as an emergency contact is a real thing a GP should be able to see. Only once a
  // genuinely openable target is found does this navigate — at most once, never a bounce through
  // several dead pages.
  //
  // PEEK, PROBE, THEN COMMIT — the ordering is the whole point. This used to call
  // ContactTree.advance() first, which CONSUMES the head of the pending pool (marks it visited,
  // sets it current) before anything had been decided: a transient network blip on the probe, or
  // the GP clicking CANCEL on the navigation confirm, permanently dropped that family member from
  // the review with nothing on screen to say a name had just been silently skipped. Reworked
  // against the engine's peekNext/commitAdvance pair (engine/contact-tree.js) so the pool is only
  // ever consumed for a reason:
  //   - inactive/ineligible candidate → commitAdvance (a genuine, correct "visited": there is
  //     nothing actionable on a record that can't be opened), badge it, and keep looping;
  //   - any OTHER failure (network, unexpected API shape) → stop and surface the real error with
  //     the session UNTOUCHED, so the next click retries the very same member rather than the
  //     one after them;
  //   - CANCEL on the confirm → session untouched too (bar any inactive skips already made above,
  //     which stay correctly consumed);
  //   - OK → commitAdvance, persist, navigate.
  // Peeking before probing also means the confirm dialog can ALWAYS name the target: the candidate
  // is known before the user is asked, not chosen by the same call that consumed it.
  async function advanceToNextFamilyMember() {
    if (!confirmDiscardUnfinishedMerge()) return;
    const st = cs;
    const fromPatientId = st.patientId;
    let session = window.ContactTree.setTreeFor(st.familySession, fromPatientId, st.tree);
    for (;;) {
      const peeked = window.ContactTree.peekNext(session);
      const candidateId = peeked && peeked.patientId;
      if (!candidateId) {
        // Pool exhausted — nothing left to cycle to. The header button disappears on its own now
        // cs.familySession.pending is empty; still worth a render so any recordInactive badges set
        // during the skip loop above actually show up.
        st.familySession = session;
        render();
        return;
      }
      let candidateDetails = null;
      try {
        candidateDetails = await window.ContactsApi.getPatientDetails(st.apiBase, candidateId);
        if (st !== cs) return;
      } catch (err) {
        if (st !== cs) return;
        if (err.errorCode === 'inactive-patient-access') {
          const lc = st.linkedCards.find((c) => c.id === candidateId);
          if (lc) lc.recordInactive = true;
          const skipped = window.ContactTree.commitAdvance(session, candidateId);
          // commitAdvance is a documented safe no-op for a patientId that isn't in the pool. That
          // can't happen for one we just peeked out of it — but if it ever did, continuing would
          // spin this loop on the same candidate forever, so bail out rather than hang the page.
          if (!skipped.patientId) {
            st.familySession = session;
            st.workingError = 'Could not skip past an inactive family member — stopped cycling.';
            render();
            return;
          }
          session = skipped.session;
          continue;
        }
        // Transient/unknown failure — consume NOTHING. The pending pool is exactly as it was, so
        // clicking again retries this same person; say so, rather than leaving the GP to wonder
        // whether they've just lost someone from the review.
        st.familySession = session;
        st.workingError = `Could not check the next family member — ${err.message || 'unknown error'}. Stopped cycling; nobody has been skipped, so try again to retry the same person.`;
        render();
        return;
      }
      // Navigating away from a patient's record mid-consultation needs an explicit, named
      // confirmation — a control that just quietly moves you to someone else's record, with only
      // the small print in a tooltip saying so, is a wrong-patient-documentation risk in a clinical
      // tool. The name comes from the record just fetched wherever possible (authoritative for
      // whose page is about to open), falling back to this canvas's own card for them.
      const targetCard = st.linkedCards.find((c) => c.id === candidateId);
      const targetName =
        (candidateDetails && candidateDetails.displayName) ||
        (targetCard && targetCard.name) ||
        'the next family member';
      const fromName = (st.indexPatientDetails && st.indexPatientDetails.displayName) || 'this patient';
      if (
        !window.confirm(
          `This will leave ${fromName}'s record and open ${targetName}'s own record to continue the family contacts review.\n\n` +
            'Click OK to continue, or CANCEL to stay on this record.'
        )
      ) {
        st.familySession = session; // untouched pool — this member is still next time round
        render();
        return;
      }
      session = window.ContactTree.commitAdvance(session, candidateId).session;
      st.familySession = session;
      await persistFamilySession(session, targetName);
      if (st !== cs) return;
      location.href = buildNavigationUrl(fromPatientId, candidateId);
      return;
    }
  }

  // renderResumeBanner — the banner outlives the moment it was created, which is the whole
  // problem it now guards against. checkResumableFamilySession validates session.current against
  // the live patient ONCE, at content-script load; Medicus is an SPA, so the GP can switch patient
  // (URL changes, no page load, no new content script) with this banner still sitting there
  // offering to resume a review of someone who is no longer on screen — and clicking Resume would
  // have opened the canvas on the WRONG patient's record. Two cheap guards, in order of how much
  // they'd cost if the other were missed:
  //   1. the Resume click re-derives the live context (the same resolveContext() every write guard
  //      in this feature uses) and refuses if the page's patient is no longer session.current;
  //   2. a lightweight URL poll that exists ONLY while the banner is in the DOM (cleared the
  //      moment it isn't, whichever way it went — Resume, Dismiss, or removal by this poll), so
  //      the stale offer disappears on a patient switch instead of waiting to be clicked. Polling
  //      is used rather than an SPA-navigation observer because this file has no navigation
  //      machinery of its own to hook (unlike task-inline.js's dom-observer-hub subscription), and
  //      a 1.5s interval that only lives while a banner is on screen is far cheaper than adding
  //      one.
  const RESUME_BANNER_URL_POLL_MS = 1500;

  function removeResumeBanner(el, timer) {
    clearInterval(timer);
    el.remove();
  }

  function renderResumeBanner(session, targetName) {
    if (document.getElementById('ms-cv-resume-banner')) return;
    const el = document.createElement('div');
    el.id = 'ms-cv-resume-banner';
    const count = session.pending.length;
    const who = targetName ? esc(targetName) : "this patient's";
    el.innerHTML = `
      <span>Resume family contacts review for ${who}${count ? ` — ${count} more to check` : ''}</span>
      <button id="ms-cv-resume-open">Resume</button>
      <button id="ms-cv-resume-dismiss">Dismiss</button>
    `;
    document.body.appendChild(el);
    let bannerHref = location.href;
    const timer = setInterval(() => {
      if (!document.getElementById('ms-cv-resume-banner')) {
        clearInterval(timer); // gone by some other route — never leave the interval running
        return;
      }
      if (location.href === bannerHref) return;
      bannerHref = location.href;
      // Re-derive rather than assuming any URL change is a patient change — Medicus moves between
      // tabs/sections of the SAME record constantly, and pulling the banner for those would be a
      // pointless loss of a still-valid offer. The persisted session is deliberately left in
      // storage (checkResumableFamilySession will offer it again if the GP navigates back, and
      // prunes it by age either way).
      const ctx = window.ContactsApi.resolveContext();
      if (!ctx || ctx.patientId !== session.current) removeResumeBanner(el, timer);
    }, RESUME_BANNER_URL_POLL_MS);
    el.querySelector('#ms-cv-resume-open').addEventListener('click', () => {
      // Same check again at the moment of the click: the poll runs on an interval, so a switch in
      // the last second-and-a-half may not have been noticed yet, and this is the one path that
      // would actually act on the stale session.
      const ctx = window.ContactsApi.resolveContext();
      if (!ctx || ctx.patientId !== session.current) {
        removeResumeBanner(el, timer);
        return;
      }
      removeResumeBanner(el, timer);
      open({ resumeSession: session });
    });
    el.querySelector('#ms-cv-resume-dismiss').addEventListener('click', () => {
      removeResumeBanner(el, timer);
      clearPersistedFamilySession();
    });
  }

  // checkResumableFamilySession — bootstrap, called once at the bottom of this file (fire-and-
  // forget, same eager-init pattern as contacts-api.js's relationships-data fetch). Calls
  // loadPersistedFamilySession() FIRST, unconditionally — that's what enforces the
  // FAMILY_SESSION_MAX_AGE_MS prune as a side effect, so a session gets cleaned up on the very next
  // Medicus page load of ANY kind, not only if the GP happens to land back on the exact page
  // cycling was heading to. Only shows the banner when this page's own patient is EXACTLY the one
  // cycling sent us to (session.current) — if the GP navigated somewhere else instead, the
  // (already-pruned-if-stale) persisted session is left inert in storage rather than surfacing a
  // confusing banner on an unrelated patient's record.
  async function checkResumableFamilySession() {
    const persisted = await loadPersistedFamilySession();
    if (!persisted) return;
    const ctx = window.ContactsApi.resolveContext();
    if (!ctx || persisted.session.current !== ctx.patientId) return;
    renderResumeBanner(persisted.session, persisted.targetName);
  }

  // ── Open / close ──────────────────────────────────────────────────────────────────────────────

  function open(opts) {
    if (document.getElementById('ms-contacts-canvas-overlay')) return;
    cs = blankCanvasState();
    if (opts && opts.resumeSession) {
      cs.familySession = opts.resumeSession;
      clearPersistedFamilySession(); // consumed — a later advance will persist a fresh copy as needed
    }
    const overlay = document.createElement('div');
    overlay.id = 'ms-contacts-canvas-overlay';
    document.body.appendChild(overlay);
    render();
    loadCanvas();
  }

  // A merged-but-not-yet-linked pairing lives only in cs, which is discarded on close — warn
  // before losing it, matching duplicate-checker.js's confirm() pattern for a similar
  // "in-progress decision about to be discarded" situation. Shared by every way of leaving the
  // canvas (Close, and the "Import from another patient" header link) — an unfinished merge is
  // equally lost whichever way the canvas closes.
  function confirmDiscardUnfinishedMerge() {
    if (!(cs && cs.manualCards.some((c) => c.mergedWith))) return true;
    // window.confirm's OK/Cancel buttons carry no inherent meaning of their own — spell out
    // which button does what rather than relying on the reader inferring it from context.
    return window.confirm(
      "You've merged one or more contacts that haven't been linked yet — nothing has been written to Medicus, so closing now will lose that pairing.\n\n" +
        'Click CANCEL to go back and drag the merged card down to the family tree to finish.\n' +
        'Click OK to close anyway and discard the unfinished merge.'
    );
  }

  function closeOverlay() {
    cs = null;
    const overlay = document.getElementById('ms-contacts-canvas-overlay');
    if (overlay) overlay.remove();
  }

  function close() {
    if (!confirmDiscardUnfinishedMerge()) return;
    closeOverlay();
    // Every write this canvas makes only ever updates local state (see the "Refresh now" buttons
    // sprinkled through the confirm/merge panels) — Medicus's own contacts card never reflects any
    // of it until the page is reloaded. Closing is by far the most common way anyone actually
    // leaves this canvas, so building the refresh into it removes a manual step most users would
    // otherwise have to remember to do themselves every single time. NOT used by the header's
    // "Import from another patient" link (closeOverlay directly, above) — that's switching to
    // another in-page flow, not leaving, so reloading there would just throw away the very widget
    // it's about to open.
    location.reload();
  }

  window.ContactsCanvas = { open, close };

  checkResumableFamilySession();
})();
