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

  check(tree.edges[0].locked === false, 'an edge defaults to unlocked (a fresh decision) when not specified');
  const lockedTree = CT.assignToSlot(CT.createTree(IDX), 'parents', P2, { baseId: 'father', locked: true });
  check(
    lockedTree.edges[0].locked === true,
    'locked:true marks an edge as already-real-in-Medicus, pre-placed rather than a pending decision'
  );
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
  // no mechanism by which editing one edge's flags could affect another. Asserting the two edges
  // are merely `!==` is near-vacuous (any two object literals are), so pin the actual property:
  // push the tree through a real clone round-trip (every write in this module does one), mutate
  // ONE edge's flags on the result, and assert neither the sibling edge nor the pre-clone tree
  // moves. That is the only thing standing between "per-edge NOK" and one parent's tick leaking
  // onto the other.
  const roundTripped = CT.assignToSlot(tree, 'other', { id: 'unrelated-card' }, { baseId: 'other' });
  roundTripped.slots.parents[0].isNextOfKin = false;
  roundTripped.slots.parents[0].copyCorrespondence = false;
  roundTripped.slots.parents[0].notes = 'mutated';
  check(
    roundTripped.slots.parents[1].isNextOfKin === true &&
      roundTripped.slots.parents[1].copyCorrespondence === true &&
      roundTripped.slots.parents[1].notes === null,
    'mutating one parent edge leaves the sibling edge untouched — no shared flag storage between edges'
  );
  check(
    tree.slots.parents[0].isNextOfKin === true && tree.slots.parents[0].notes === null,
    'and the mutation cannot reach back through the clone into the tree it came from'
  );
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
}

// ============================================================
// 5 — family session: cycling without navigation
// ============================================================
console.log('5: family session cycling');
{
  let session = CT.createFamilySession(IDX);
  check(
    session.current === IDX && session.visited[IDX] === true && session.pending.length === 0,
    'session starts current on the index patient, already visited, nothing pending'
  );

  session = CT.enqueueFamilyMember(session, P1.patientId, '1970-01-01');
  session = CT.enqueueFamilyMember(session, P1.patientId, '1970-01-01'); // dedupe check
  check(session.pending.length === 1, 'enqueueFamilyMember adds a new member once, deduping repeats');

  // P2 is younger than P1 but enqueued after — should still sort ahead of anyone older added later,
  // and behind P1 (oldest-to-youngest), proving insertion isn't just append order.
  session = CT.enqueueFamilyMember(session, P2.patientId, '1995-06-15');
  const grandad = { id: 'gp1-card', patientId: 'gp1-patient-id', name: 'Great Grandad' };
  session = CT.enqueueFamilyMember(session, grandad.patientId, '1940-03-02');
  check(
    session.pending.map((p) => p.patientId).join(',') === [grandad.patientId, P1.patientId, P2.patientId].join(','),
    'pending pool stays sorted oldest-to-youngest as members are discovered, not insertion order'
  );

  const step0 = CT.advance(session);
  check(step0.patientId === grandad.patientId, 'advance moves to the oldest pending member first');
  session = step0.session;
  check(session.current === grandad.patientId, 'advance updates current to the newly visited member');

  session = CT.enqueueFamilyMember(session, grandad.patientId, '1940-03-02'); // already visited
  check(
    session.pending.length === 2,
    'enqueueFamilyMember no-ops for a patientId already visited, even if not currently pending'
  );

  const step1 = CT.advance(session);
  check(step1.patientId === P1.patientId, 'advance continues in dob order after the first member');

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
  check(step2.patientId === P2.patientId, 'advance reaches the last pending member');
  session = step2.session;

  const step3 = CT.advance(session);
  check(step3.patientId === null, 'advance returns null once the pending pool is exhausted');
  check(step3.session.current === null, 'current clears to null once cycling ends');
}

// ============================================================
// 6 — tree.edges stays in sync with the slots (removal + partner displacement)
// ============================================================
// Every edge lives in TWO places: the slot that renders it, and `tree.edges` — which is what a
// caller iterates when it writes the links into Medicus. If a removal empties the slot but leaves
// the edge in `tree.edges`, the canvas shows nothing while the commit still writes the link: a
// relationship the user explicitly deleted gets created anyway. These assertions pin the two
// halves staying in step.
console.log('6: removeFromSlot / partner displacement keep tree.edges in sync');
{
  let tree = CT.createTree(IDX);
  tree = CT.assignToSlot(tree, 'parents', P1, { baseId: 'mother' });
  check(tree.edges.length === 1, 'baseline: assigning into a list slot records one edge');
  tree = CT.removeFromSlot(tree, 'parents', P1.id);
  check(tree.slots.parents.length === 0, 'removeFromSlot empties the list slot');
  check(tree.edges.length === 0, 'removeFromSlot also drops the edge from tree.edges (list slot)');

  let pt = CT.createTree(IDX);
  pt = CT.assignToSlot(pt, 'partner', P2, { baseId: 'partner' });
  pt = CT.removeFromSlot(pt, 'partner', P2.id);
  check(pt.slots.partner === null, 'removeFromSlot clears the partner slot');
  check(pt.edges.length === 0, 'removeFromSlot also drops the edge from tree.edges (partner slot)');

  // Same again for an edge that arrived via commitSuggestion — that path clones twice, so an
  // edge removal that relied on object identity is doubly broken there.
  let ct = CT.createTree(IDX);
  ct = CT.addPendingSuggestion(ct, { slotPath: 'siblings', card: P1, baseGuess: 'brother', source: 'address' });
  const committed = CT.commitSuggestion(ct, ct.pendingSuggestions[0].id, { baseId: 'brother' });
  ct = CT.removeFromSlot(committed.tree, 'siblings', P1.id);
  check(
    ct.slots.siblings.length === 0 && ct.edges.length === 0,
    'an edge created via commitSuggestion is removed from tree.edges too'
  );

  let all = CT.createTree(IDX);
  all = CT.assignToSlot(all, 'children', P1, { baseId: 'son' });
  all = CT.assignToSlot(all, 'children', P2, { baseId: 'daughter' });
  all = CT.removeFromSlot(all, 'children');
  check(
    all.slots.children.length === 0 && all.edges.length === 0,
    'removeFromSlot with no cardId clears the whole list slot and all of its edges'
  );

  // Removal must be targeted, not a blunt "drop everything for this slot".
  let two = CT.createTree(IDX);
  two = CT.assignToSlot(two, 'children', P1, { baseId: 'son' });
  two = CT.assignToSlot(two, 'children', P2, { baseId: 'daughter' });
  two = CT.removeFromSlot(two, 'children', P1.id);
  check(
    two.slots.children.length === 1 && two.edges.length === 1 && two.edges[0].cardId === P2.id,
    "removing one card from a list slot leaves the other cards' edges alone"
  );

  // The same person can legitimately sit in two slots; removing one must not take the other out.
  let same = CT.createTree(IDX);
  same = CT.assignToSlot(same, 'parents', P1, { baseId: 'mother' });
  same = CT.assignToSlot(same, 'other', P1, { baseId: 'other' });
  same = CT.removeFromSlot(same, 'parents', P1.id);
  check(
    same.edges.length === 1 && same.edges[0].slotPath === 'other',
    'the same card in a different slot keeps its own edge when one slot is cleared'
  );

  // partner is a single slot: assigning over it displaces the sitting partner, whose edge must go.
  let disp = CT.createTree(IDX);
  disp = CT.assignToSlot(disp, 'partner', P1, { baseId: 'partner' });
  disp = CT.assignToSlot(disp, 'partner', P2, { baseId: 'partner' });
  check(disp.slots.partner.cardId === P2.id, 'assigning over an occupied partner slot replaces the sitting partner');
  check(
    disp.edges.length === 1 && disp.edges[0].cardId === P2.id,
    "the displaced partner's edge is removed from tree.edges, not orphaned there"
  );
}

// ============================================================
// 7 — deferred-commit cycling: peekNext / commitAdvance
// ============================================================
// advance() consumes the head of the pool the moment it is called, but the caller has to call it
// BEFORE the user has actually navigated (it needs to know who's next in order to ask). A Cancel,
// or a transient probe failure, therefore burned a family member permanently. peekNext/
// commitAdvance split that in two so nobody is consumed until navigation really happened.
console.log('7: deferred-commit cycling (peekNext / commitAdvance)');
{
  const GP = 'gp1-patient-id';
  check(CT.peekNext(null).patientId === null, 'peekNext on a missing session returns null rather than throwing');

  let session = CT.createFamilySession(IDX);
  check(CT.peekNext(session).patientId === null, 'peekNext returns null when the pending pool is empty');
  check(CT.commitAdvance(session, 'anyone').patientId === null, 'commitAdvance against an empty pool is a safe no-op');

  session = CT.enqueueFamilyMember(session, P1.patientId, '1970-01-01');
  session = CT.enqueueFamilyMember(session, P2.patientId, '1995-06-15');
  session = CT.enqueueFamilyMember(session, GP, '1940-03-02');

  const snapshot = JSON.stringify(session);
  check(CT.peekNext(session).patientId === GP, 'peekNext reports the head of the pending pool (oldest first)');
  check(JSON.stringify(session) === snapshot, 'peekNext mutates nothing — a Cancel leaves the session identical');
  check(CT.peekNext(session).patientId === GP, 'peekNext is repeatable — peeking does not consume the member');
  check(session.visited[GP] === undefined, 'a peeked member is NOT marked visited');

  const noop = CT.commitAdvance(session, null);
  check(
    noop.patientId === null && noop.session.current === IDX && noop.session.pending.length === 3,
    'commitAdvance(session, null) is a safe no-op — current unchanged, nobody consumed'
  );
  const unknown = CT.commitAdvance(session, 'never-heard-of-them');
  check(
    unknown.patientId === null && unknown.session.current === IDX && unknown.session.pending.length === 3,
    'commitAdvance with a patientId that is not pending is a safe no-op'
  );

  // The head (GP) 403s as an inactive patient, so the caller confirms a LATER member instead —
  // commitAdvance must consume that one from the middle of the pool, not the head.
  const done = CT.commitAdvance(session, P1.patientId);
  check(done.patientId === P1.patientId, 'commitAdvance returns the patientId it actually consumed');
  check(done.session.current === P1.patientId, 'commitAdvance sets current to the committed member');
  check(done.session.visited[P1.patientId] === true, 'commitAdvance marks the committed member visited');
  check(
    done.session.pending.map((p) => p.patientId).join(',') === [GP, P2.patientId].join(','),
    'commitAdvance consumes a NON-head member and preserves the order of everyone else'
  );
  check(done.session.visited[GP] === undefined, 'the skipped-over head stays pending and unvisited');
  check(
    session.pending.length === 3 && session.current === IDX,
    'commitAdvance leaves the session it was handed untouched (immutable clone pattern)'
  );
  check(CT.peekNext(done.session).patientId === GP, 'after a commit, peekNext offers the still-pending head again');
}

// ============================================================
console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
