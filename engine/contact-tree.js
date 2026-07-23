// engine/contact-tree.js — In-memory family-tree structure for the Contacts linking canvas
// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
//
// Pure engine for the Contacts linking tool. Represents ONE patient's own family-tree canvas
// state (slots, committed edges, pending suggestions, needs-review holding area) plus, for the
// multi-member "cycling" flow, a family-session that tracks which family members have been
// visited and what's already been committed for each — all purely in-memory (nothing persisted
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
      needsReview: [],
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
    };
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
      next.slots.partner = edge;
    } else {
      next.slots[slotPath].push(edge);
    }
    next.edges.push(edge);
    // A card just assigned to a real slot no longer belongs in the "needs review" holding area.
    next.needsReview = next.needsReview.filter((c) => c.id !== card.id);
    return next;
  }

  // removeFromSlot(tree, slotPath, cardId) -> tree'
  function removeFromSlot(tree, slotPath, cardId) {
    if (!tree || !isValidSlotPath(slotPath)) return tree;
    const next = clone(tree);
    if (slotPath === 'partner') {
      if (next.slots.partner && (!cardId || next.slots.partner.cardId === cardId)) {
        next.edges = next.edges.filter((e) => e !== next.slots.partner);
        next.slots.partner = null;
      }
    } else {
      const removed = next.slots[slotPath].filter((e) => !cardId || e.cardId === cardId);
      next.slots[slotPath] = next.slots[slotPath].filter((e) => cardId && e.cardId !== cardId);
      next.edges = next.edges.filter((e) => !removed.includes(e));
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

  // addNeedsReview(tree, card) -> tree' — a manual/linked contact whose free-text relationship
  // didn't map to a canonical id. Held separately rather than guessed into a slot.
  function addNeedsReview(tree, card) {
    if (!tree || !card || !card.id) return tree;
    const next = clone(tree);
    if (next.needsReview.some((c) => c.id === card.id)) return tree;
    next.needsReview.push(card);
    return next;
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
      needsReview: t.needsReview,
      hasGrandparents: t.slots.grandparents.length > 0,
      hasAuntsUncles: t.slots.auntsUncles.length > 0,
      hasOther: t.slots.other.length > 0,
    };
  }

  // ── Family session (cycling through multiple family members, no navigation required) ─────────
  // Plain objects (not Map) throughout, matching this codebase's pure-store convention (e.g.
  // shared/contact-ledger.js) and keeping the whole session trivially JSON-serialisable/testable.

  function createFamilySession(indexPatientId) {
    return {
      queue: indexPatientId ? [indexPatientId] : [],
      cursor: 0,
      byPatient: {}, // patientId -> tree
      committedEdgesByPatient: {}, // patientId -> edge[]
    };
  }

  // enqueueFamilyMember(session, patientId) -> session' — adds a newly-discovered family member
  // to the review queue if not already present (dedup by patientId).
  function enqueueFamilyMember(session, patientId) {
    if (!session || !patientId || session.queue.includes(patientId)) return session;
    const next = clone(session);
    next.queue.push(patientId);
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
  // the queue is exhausted (cycling stops; the caller decides whether to end or let the user quit
  // early — this function never forces completion of every member).
  function advance(session) {
    if (!session) return { session, patientId: null };
    const nextCursor = session.cursor + 1;
    if (nextCursor >= session.queue.length) {
      return { session: Object.assign(clone(session), { cursor: nextCursor }), patientId: null };
    }
    const next = clone(session);
    next.cursor = nextCursor;
    return { session: next, patientId: next.queue[nextCursor] };
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
    addNeedsReview,
    toRenderModel,
    createFamilySession,
    enqueueFamilyMember,
    getTreeFor,
    setTreeFor,
    advance,
    recordCommittedEdge,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else if (global) {
    global.ContactTree = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
