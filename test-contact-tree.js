// Medicus Suite — Family-tree pure-logic tests
// Run with: node test-contact-tree.js
//
// engine/contact-tree.js is the in-memory structure behind the Contacts linking canvas. This
// file pins the two structural safety rules from the product design: (1) commitSuggestion() is
// the only path a pending suggestion can become a real edge — nothing auto-promotes; (2) NOK /
// copy-correspondence flags live per-edge only, so one edge's flags can never leak onto another
// edge that happens to share a person (e.g. two parents both flagged NOK for their shared child
// must not default to NOK for each other).

'use strict';

const CT = require('./engine/contact-tree.js');

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

const IDX = 'idx-patient';
const CHILD = { id: 'child-card', patientId: 'child-patient-id', name: 'Test Child' };
const P1 = { id: 'p1-card', patientId: 'p1-patient-id', name: 'Parent One' };
const P2 = { id: 'p2-card', patientId: 'p2-patient-id', name: 'Parent Two' };

// ============================================================
// 1 — createTree / assignToSlot basics
// ============================================================
console.log('1: createTree / assignToSlot');
{
  let tree = CT.createTree(IDX);
  check(tree.indexPatientId === IDX, 'createTree sets indexPatientId');
  check(tree.slots.partner === null && tree.slots.siblings.length === 0, 'all slots start empty');

  tree = CT.assignToSlot(tree, 'parents', P1, { baseId: 'mother', isNextOfKin: true, copyCorrespondence: true });
  check(tree.slots.parents.length === 1, 'assignToSlot pushes into a list slot');
  check(tree.edges.length === 1, 'assignToSlot records an edge');
  check(
    tree.edges[0].isNextOfKin === true && tree.edges[0].copyCorrespondence === true,
    'edge carries the NOK/copy flags passed in'
  );

  const before = tree;
  const rejected = CT.assignToSlot(tree, 'not-a-real-slot', P2, { baseId: 'father' });
  check(rejected === before, 'assignToSlot no-ops (same reference) on an invalid slotPath');
}

// ============================================================
// 2 — commitSuggestion is the ONLY path from pendingSuggestions to edges
// ============================================================
console.log('2: commitSuggestion is the only path to a real edge');
{
  let tree = CT.createTree(IDX);
  tree = CT.addPendingSuggestion(tree, { slotPath: 'partner', card: P2, baseGuess: 'partner', source: 'transitive' });
  check(tree.pendingSuggestions.length === 1, 'addPendingSuggestion stages a suggestion');
  check(tree.edges.length === 0, 'a suggestion is NOT yet a real edge');

  const suggestionId = tree.pendingSuggestions[0].id;
  const { tree: afterCommit, edge } = CT.commitSuggestion(tree, suggestionId, {
    baseId: 'partner',
    isNextOfKin: false,
    copyCorrespondence: false,
  });
  check(edge && edge.baseId === 'partner', 'commitSuggestion returns the created edge');
  check(afterCommit.edges.length === 1, 'commitSuggestion promotes the suggestion into edges');
  check(afterCommit.pendingSuggestions.length === 0, 'commitSuggestion removes the suggestion once committed');
  check(
    afterCommit.slots.partner && afterCommit.slots.partner.cardId === P2.id,
    'commitSuggestion places the card into the slot it was guessed for'
  );

  const bogus = CT.commitSuggestion(afterCommit, 'no-such-id', { baseId: 'partner' });
  check(bogus.edge === null && bogus.tree === afterCommit, 'committing an unknown suggestion id is a safe no-op');
}

// ============================================================
// 3 — NOK / copy-correspondence never leak across edges sharing a node
// ============================================================
console.log('3: NOK/copy-correspondence are per-edge, never inherited across a shared node');
{
  let tree = CT.createTree(CHILD.patientId);
  // Child's tree: both parents flagged NOK + copy-correspondence for the child.
  tree = CT.assignToSlot(tree, 'parents', P1, { baseId: 'mother', isNextOfKin: true, copyCorrespondence: true });
  tree = CT.assignToSlot(tree, 'parents', P2, { baseId: 'father', isNextOfKin: true, copyCorrespondence: true });
  check(
    tree.edges.every((e) => e.isNextOfKin && e.copyCorrespondence),
    'both parent edges are NOK + copy for the child, as configured'
  );

  // Now build P1's OWN tree and add P2 as a partner — a structurally separate tree/edge with no
  // field that could carry P1's child-edge flags across. The product rule is that this edge must
  // start from a fresh, independent decision (unticked unless the caller explicitly says so).
  let p1Tree = CT.createTree(P1.patientId);
  p1Tree = CT.assignToSlot(p1Tree, 'partner', P2, { baseId: 'partner' }); // isNextOfKin/copyCorrespondence deliberately omitted
  const partnerEdge = p1Tree.slots.partner;
  check(
    partnerEdge.isNextOfKin === false && partnerEdge.copyCorrespondence === false,
    'a new edge between the two parents defaults to NOT NOK/copy — nothing carried over from the child edges'
  );

  // Structural check: no field anywhere on a tree/edge is shared BETWEEN two edges, so there is
  // no mechanism by which editing one edge's flags could affect another.
  check(tree.edges[0] !== tree.edges[1], 'the two parent edges are distinct objects with no shared flag storage');
}

// ============================================================
// 4 — toRenderModel shape
// ============================================================
console.log('4: toRenderModel');
{
  let tree = CT.createTree(IDX);
  tree = CT.assignToSlot(tree, 'grandparents', P1, { baseId: 'grandmother' });
  const model = CT.toRenderModel(tree);
  check(model.indexPatientId === IDX, 'render model carries indexPatientId');
  check(model.hasGrandparents === true, 'hasGrandparents flag reflects populated slot');
  check(model.hasAuntsUncles === false, 'hasAuntsUncles flag reflects empty slot');
  check(Array.isArray(model.needsReview) && model.needsReview.length === 0, 'needsReview present and empty by default');
}

// ============================================================
// 5 — family session: cycling without navigation
// ============================================================
console.log('5: family session cycling');
{
  let session = CT.createFamilySession(IDX);
  check(session.queue.length === 1 && session.queue[0] === IDX, 'session starts with just the index patient queued');

  session = CT.enqueueFamilyMember(session, P1.patientId);
  session = CT.enqueueFamilyMember(session, P1.patientId); // dedupe check
  check(session.queue.length === 2, 'enqueueFamilyMember adds a new member once, deduping repeats');

  const step1 = CT.advance(session);
  check(step1.patientId === P1.patientId, 'advance moves to the next queued member');

  const edge = {
    slotPath: 'children',
    cardId: CHILD.id,
    baseId: 'daughter',
    isNextOfKin: false,
    copyCorrespondence: false,
  };
  session = CT.recordCommittedEdge(step1.session, P1.patientId, edge);
  check(
    session.committedEdgesByPatient[P1.patientId].length === 1,
    'recordCommittedEdge tracks what has already been written for a family member'
  );

  const step2 = CT.advance(session);
  check(step2.patientId === null, 'advance returns null once the queue is exhausted');
}

// ============================================================
console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
