// engine/contact-tree.js — In-memory family-tree structure for the Contacts linking canvas
// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
//
// Pure engine for the Contacts linking tool. Represents ONE patient's own family-tree canvas
// state (slots, committed edges, pending suggestions) plus, for the multi-member "cycling" flow,
// a family-session that tracks which family members have been visited and what's already been
// committed for each — all purely in-memory (nothing persisted
// to chrome.storage.local by this module; the caller owns that decision entirely, per this
// codebase's "pure core, caller owns storage" doctrine — see shared/contact-ledger.js).
//
// Two product rules are enforced STRUCTURALLY here, not just by UI convention:
//   1. commitSuggestion() is the ONLY function that can move something from `pendingSuggestions`
//      into `edges` — there is no other exported function that writes to `edges` from a
//      suggestion, so "never auto-commit a relationship the user hasn't explicitly confirmed on
//      screen" is a property of this module's API surface, not a convention a caller could forget.
//   2. NOK / copy-correspondence flags live PER-EDGE ONLY (edges[].isNextOfKin/copyCorrespondence)
//      — there is no shared per-node/per-patient field either could be read from, so one edge's
//      flags cannot leak onto another edge that happens to share a person (e.g. two parents both
//      flagged NOK for their shared child must never default to NOK for each other).
//
// Dual-mode export: Node `require` AND browser global (`window.ContactTree`).

(function (global) {
  'use strict';

  const VALID_SINGLE_SLOTS = ['partner'];
  const VALID_LIST_SLOTS = ['siblings', 'parents', 'children', 'grandparents', 'auntsUncles', 'other'];
  const VALID_SLOT_KEYS = VALID_SINGLE_SLOTS.concat(VALID_LIST_SLOTS);

  function clone(x) {
    return JSON.parse(JSON.stringify(x));
  }

  // ── Single-patient tree ───────────────────────────────────────────────────────────────────────

  function createTree(indexPatientId) {
    return {
      indexPatientId: indexPatientId || null,
      slots: {
        partner: null,
        siblings: [],
        parents: [],
        children: [],
        grandparents: [],
        auntsUncles: [],
        other: [],
      },
      edges: [],
      pendingSuggestions: [],
    };
  }

  function isValidSlotPath(slotPath) {
    return VALID_SLOT_KEYS.includes(slotPath);
  }

  function makeEdge(slotPath, card, relationshipChoice) {
    return {
      slotPath,
      cardId: card && card.id,
      patientId: (card && card.patientId) || null,
      baseId: relationshipChoice.baseId,
      modifierId: relationshipChoice.modifierId || null,
      isNextOfKin: !!relationshipChoice.isNextOfKin,
      copyCorrespondence: !!relationshipChoice.copyCorrespondence,
      notes: relationshipChoice.notes || null,
      reciprocalCommitted: !!relationshipChoice.reciprocalCommitted,
      // locked: true means this edge is already real in Medicus (pre-placed from an existing
      // linked contact when the tree is first built) — a caller renders it read-only rather than
      // as a pending decision. False/absent means it's a fresh decision made this session.
      locked: !!relationshipChoice.locked,
    };
  }

  // Every edge is stored TWICE — once in the slot that renders it, once in `tree.edges` (what a
  // caller iterates when it writes the links into Medicus). They are NOT the same object: clone()
  // is a JSON round-trip, so every write forks the shared reference, and the two copies can only
  // ever be matched BY VALUE. Reference-equality filtering (`e !== next.slots.partner`) matched
  // nothing at all — the slot emptied while the edge stayed in `tree.edges`, i.e. a relationship
  // the user deleted on screen still got written. Identity here is the (slotPath, cardId) pair:
  // a given card occupies a given slot once, so that pair names an edge stably across a clone.
  function isSameEdge(a, b) {
    return !!a && !!b && a.slotPath === b.slotPath && a.cardId === b.cardId;
  }

  // dropEdges(edges, gone) -> edges' — removes from `edges` every entry matching (by the value
  // identity above) any edge in `gone`. Used by both removal paths in removeFromSlot AND by the
  // partner-displacement path in assignToSlot, so there is exactly one notion of "this edge is
  // the same edge" in the module.
  function dropEdges(edges, gone) {
    if (!gone || !gone.length) return edges;
    return edges.filter((e) => !gone.some((g) => isSameEdge(e, g)));
  }

  // assignToSlot(tree, slotPath, card, relationshipChoice) -> tree'
  //   card: { id, patientId?: string|null, name?: string }
  //   relationshipChoice: { baseId, modifierId?, isNextOfKin?, copyCorrespondence?, notes?, reciprocalCommitted? }
  // No-ops (returns the same tree unchanged) on an invalid slotPath or a missing card.id, rather
  // than throwing — consistent with this codebase's defensive pure-store style (contact-ledger.js).
  function assignToSlot(tree, slotPath, card, relationshipChoice) {
    if (!tree || !isValidSlotPath(slotPath) || !card || !card.id || !relationshipChoice || !relationshipChoice.baseId) {
      return tree;
    }
    const next = clone(tree);
    const edge = makeEdge(slotPath, card, relationshipChoice);
    if (slotPath === 'partner') {
      // partner is a SINGLE slot, so assigning into an occupied one displaces the sitting partner.
      // Their edge has to leave `tree.edges` with them, or the replaced relationship silently
      // survives in the commit list while nothing on the canvas shows it any more.
      next.edges = dropEdges(next.edges, next.slots.partner ? [next.slots.partner] : []);
      next.slots.partner = edge;
    } else {
      next.slots[slotPath].push(edge);
    }
    next.edges.push(edge);
    return next;
  }

  // removeFromSlot(tree, slotPath, cardId) -> tree'
  // Omitting cardId clears the whole slot (the single partner, or every card in a list slot).
  // Removal always takes the slot entry AND its `tree.edges` twin — see dropEdges/isSameEdge for
  // why that match is by value and never by object reference.
  function removeFromSlot(tree, slotPath, cardId) {
    if (!tree || !isValidSlotPath(slotPath)) return tree;
    const next = clone(tree);
    if (slotPath === 'partner') {
      if (next.slots.partner && (!cardId || next.slots.partner.cardId === cardId)) {
        next.edges = dropEdges(next.edges, [next.slots.partner]);
        next.slots.partner = null;
      }
    } else {
      const removed = next.slots[slotPath].filter((e) => !cardId || e.cardId === cardId);
      next.slots[slotPath] = next.slots[slotPath].filter((e) => cardId && e.cardId !== cardId);
      next.edges = dropEdges(next.edges, removed);
    }
    return next;
  }

  // addPendingSuggestion(tree, { slotPath, card, baseGuess, source }) -> tree'
  //   source: 'transitive' | 'address' | 'name' — where the suggestion came from, for the UI badge.
  function addPendingSuggestion(tree, suggestion) {
    if (!tree || !suggestion || !suggestion.card || !suggestion.card.id || !isValidSlotPath(suggestion.slotPath)) {
      return tree;
    }
    const next = clone(tree);
    const id = `${suggestion.slotPath}:${suggestion.card.id}`;
    if (next.pendingSuggestions.some((s) => s.id === id)) return tree; // already suggested, no-op
    next.pendingSuggestions.push({
      id,
      slotPath: suggestion.slotPath,
      card: suggestion.card,
      baseGuess: suggestion.baseGuess || null,
      source: suggestion.source || null,
    });
    return next;
  }

  function dismissSuggestion(tree, suggestionId) {
    if (!tree) return tree;
    const next = clone(tree);
    next.pendingSuggestions = next.pendingSuggestions.filter((s) => s.id !== suggestionId);
    return next;
  }

  // commitSuggestion(tree, suggestionId, decision) -> { tree: tree', edge: edge|null }
  //   decision: { slotPath?, baseId, modifierId?, isNextOfKin?, copyCorrespondence?, notes? }
  // THE ONLY path from pendingSuggestions into edges. `decision.slotPath` lets the user re-target
  // the drop (e.g. drag the suggestion to a different box than the one it was guessed into)
  // without needing a separate dismiss+reassign round-trip.
  function commitSuggestion(tree, suggestionId, decision) {
    if (!tree || !decision || !decision.baseId) return { tree, edge: null };
    const suggestion = tree.pendingSuggestions.find((s) => s.id === suggestionId);
    if (!suggestion) return { tree, edge: null };
    const slotPath = decision.slotPath || suggestion.slotPath;
    const afterAssign = assignToSlot(tree, slotPath, suggestion.card, decision);
    if (afterAssign === tree) return { tree, edge: null }; // assignToSlot rejected the input
    const next = clone(afterAssign);
    next.pendingSuggestions = next.pendingSuggestions.filter((s) => s.id !== suggestionId);
    const edge = next.edges[next.edges.length - 1];
    return { tree: next, edge };
  }

  function toRenderModel(tree) {
    if (!tree) return null;
    const t = clone(tree);
    return {
      indexPatientId: t.indexPatientId,
      partner: t.slots.partner,
      siblings: t.slots.siblings,
      parents: t.slots.parents,
      children: t.slots.children,
      grandparents: t.slots.grandparents,
      auntsUncles: t.slots.auntsUncles,
      other: t.slots.other,
      pendingSuggestions: t.pendingSuggestions,
      hasGrandparents: t.slots.grandparents.length > 0,
      hasAuntsUncles: t.slots.auntsUncles.length > 0,
      hasOther: t.slots.other.length > 0,
    };
  }

  // ── Family session (cycling through multiple family members, no CANVAS RE-OPEN required) ──────
  // NOTE: this does still involve a real browser navigation — the canvas itself cannot swap to
  // another patient's data in place (Medicus is one-patient-per-page). "No navigation required"
  // was this section's original framing before that was discovered; corrected here so this
  // comment doesn't contradict what the caller (contacts-canvas.js) actually does. See that file's
  // own "Family cycling" section for the full mechanism.
  // Plain objects (not Map) throughout, matching this codebase's pure-store convention (e.g.
  // shared/contact-ledger.js) and keeping the whole session trivially JSON-serialisable/testable.
  //
  // Shape: { current, visited, pending, byPatient, committedEdgesByPatient }.
  //   - `current` is whichever patientId's canvas is on screen right now (null once cycling ends).
  //   - `visited` is every patientId ever shown (never re-added, however many times a later
  //     confirmed edge rediscovers them — e.g. two siblings both pointing back at the same parent).
  //   - `pending` is the not-yet-visited pool, kept sorted oldest-to-youngest by dob as members are
  //     discovered, so advance() always has a deterministic "who's next" without re-sorting.
  // Deliberately NOT a fixed queue + moving cursor: the pool grows mid-session as edges get
  // committed, and a newly-discovered member can sort older than someone already visited — a
  // cursor-in-a-fixed-array model can't express "insert behind where we already walked past".
  // Excluding inactive patients is NOT this module's job: whether a patientId is even openable is
  // only knowable by trying (Medicus 403s with inactive-patient-access on the fetch, there is no
  // upfront boolean) — the caller tries the fetch after advance() and calls advance() again on
  // failure, this module just tracks who's been visited vs who's still waiting.

  function createFamilySession(indexPatientId) {
    return {
      current: indexPatientId || null,
      visited: indexPatientId ? { [indexPatientId]: true } : {},
      pending: [], // [{ patientId, sortValue }], sorted ascending (unknown dob sorts last) — see dobSortValue
      byPatient: {}, // patientId -> tree
      committedEdgesByPatient: {}, // patientId -> edge[]
    };
  }

  // dobSortValue(dob) -> a plain number, never the dob itself. The pending pool only ever needs an
  // ORDERING, not the calendar date — storing the raw dob would mean a persisted session (see
  // contacts-canvas.js's cross-page "Family cycling" section) carries actual dates-of-birth on
  // disk for longer than strictly necessary; a precomputed sort value carries none of that.
  function dobSortValue(dob) {
    const t = dob ? new Date(dob).getTime() : NaN;
    return Number.isFinite(t) ? t : Infinity;
  }

  // enqueueFamilyMember(session, patientId, dob) -> session' — adds a newly-discovered family
  // member to the pending pool if not already visited or already pending (dedup by patientId).
  // Inserted in sortValue order, not appended, so the pool stays sorted oldest-to-youngest as it
  // grows. `dob` itself is converted to a plain sortValue immediately and never stored — see
  // dobSortValue's own comment.
  function enqueueFamilyMember(session, patientId, dob) {
    if (
      !session ||
      !patientId ||
      session.visited[patientId] ||
      session.pending.some((p) => p.patientId === patientId)
    ) {
      return session;
    }
    const next = clone(session);
    const value = dobSortValue(dob);
    const entry = { patientId, sortValue: value };
    const insertAt = next.pending.findIndex((p) => p.sortValue > value);
    if (insertAt === -1) next.pending.push(entry);
    else next.pending.splice(insertAt, 0, entry);
    return next;
  }

  function getTreeFor(session, patientId) {
    return session && session.byPatient[patientId];
  }

  function setTreeFor(session, patientId, tree) {
    if (!session || !patientId) return session;
    const next = clone(session);
    next.byPatient[patientId] = tree;
    return next;
  }

  // advance(session) -> { session: session', patientId: string|null } — patientId is null once
  // the pending pool is exhausted (cycling stops; the caller decides whether to end or let the
  // user quit early — this function never forces completion of every member).
  function advance(session) {
    if (!session) return { session, patientId: null };
    if (!session.pending.length) {
      const next = clone(session);
      next.current = null;
      return { session: next, patientId: null };
    }
    const next = clone(session);
    const head = next.pending.shift();
    next.visited[head.patientId] = true;
    next.current = head.patientId;
    return { session: next, patientId: head.patientId };
  }

  // ── Deferred commit: peekNext + commitAdvance ────────────────────────────────────────────────
  // advance() consumes the head of the pool the instant it is called — but the caller has to know
  // who's next BEFORE the user has agreed to go there (it can't put a name in the confirm dialog
  // otherwise), and the patient's page may not even open (Medicus 403s inactive patients only on
  // the fetch — see the pool notes above). So advance()'s single step conflated two different
  // moments: "who is next?" and "we are now on their page". A Cancel, or one transient probe
  // error, therefore marked a family member visited and dropped them from the pool for good —
  // silently losing a person the user still needs to link.
  //
  // These two split that in half. The caller's flow is: peekNext -> probe/confirm -> commitAdvance
  // ONLY on success. Every failure path simply returns without calling commitAdvance, and the
  // session is byte-for-byte what it was, so the member comes round again on the next peek.
  // advance() is kept exported and unchanged for existing callers.

  // peekNext(session) -> { patientId: string|null } — the head of the pending pool, or null when
  // the pool is exhausted. Side-effect free and cheap by contract: callers poll it freely, and it
  // must stay safe to call on a session that is about to be discarded (a Cancel), so it neither
  // clones nor writes. Returns the same {patientId} shape as advance()/commitAdvance so the three
  // are interchangeable at the call site.
  function peekNext(session) {
    if (!session || !session.pending || !session.pending.length) return { patientId: null };
    return { patientId: session.pending[0].patientId };
  }

  // commitAdvance(session, patientId) -> { session: session', patientId: string|null } — records
  // that we have actually landed on `patientId`: consumes them from the pending pool, marks them
  // visited, and makes them current. Takes the patientId explicitly rather than assuming the head,
  // because the caller may legitimately have skipped past members whose page would not open, and
  // whoever they DID reach must be the one consumed. An absent/null patientId, or one not in the
  // pool, is a safe no-op: the session comes back unchanged (same reference, `current` untouched)
  // with patientId null, never a throw — the Cancel and probe-failure paths rely on that.
  function commitAdvance(session, patientId) {
    if (!session || !patientId || !session.pending) return { session, patientId: null };
    const idx = session.pending.findIndex((p) => p.patientId === patientId);
    if (idx === -1) return { session, patientId: null };
    const next = clone(session);
    next.pending.splice(idx, 1);
    next.visited[patientId] = true;
    next.current = patientId;
    return { session: next, patientId };
  }

  // recordCommittedEdge(session, patientId, edge) -> session' — called immediately after a
  // successful dual link-patient write, BEFORE the canvas re-renders for that patient, so a later
  // screen's pre-placed locked boxes are always in sync with what's actually in Medicus.
  function recordCommittedEdge(session, patientId, edge) {
    if (!session || !patientId || !edge) return session;
    const next = clone(session);
    const list = next.committedEdgesByPatient[patientId] || (next.committedEdgesByPatient[patientId] = []);
    list.push(edge);
    return next;
  }

  const api = {
    VALID_SLOT_KEYS,
    createTree,
    isValidSlotPath,
    assignToSlot,
    removeFromSlot,
    addPendingSuggestion,
    dismissSuggestion,
    commitSuggestion,
    toRenderModel,
    createFamilySession,
    enqueueFamilyMember,
    getTreeFor,
    setTreeFor,
    advance,
    peekNext,
    commitAdvance,
    recordCommittedEdge,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else if (global) {
    global.ContactTree = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
