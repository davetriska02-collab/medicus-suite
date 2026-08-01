> **Recovered 2026-07-26** from a session transcript on Nick's old laptop (`ExitPlanMode` call,
> session `7cead2f2-9902-47ce-b6eb-4219d44ffef2`, dated 2026-07-23) after that machine's Windows
> profile was corrupted and this repo was moved to a new machine without it. Never previously
> committed to this repo — the `engine/contact-relationships.js` header comment referencing "the
> Contacts Management build plan" pointed at this document, but it only ever existed in that
> session's chat history until now. Saved here so it can't be orphaned like this again.
>
> **Status as of 2026-07-26** (see CHANGELOG.md for the full detail):
> - **Phase 0 (Foundations)** — done. `rules/contact-relationships.json`, `engine/contact-relationships.js`, `engine/contact-match.js`, `engine/contact-tree.js`, all tested.
> - **Phase 1 (Manual→linked conversion)** — done, and its own dedicated UI (the widget's single-contact pick → search → confirm flow) was retired 2026-07-28 once the canvas fully superseded it — see the open-decision entry near the bottom of this status block.
> - **Phase 2 (Bulk import of already-linked contacts)** — done.
> - **Phase 3 (Three-column canvas)** — done.
> - **Phase 4 (Visual family tree)** — done, plus substantial rework beyond the original scope: needs-review/unrecognised-relationship handling, a unified "any linked contact can match a manual duplicate" mechanism, writing a corrected relationship back to Medicus for an unrecognised-but-real link, immediate manual-duplicate deletion for an already-placed match, and full per-number phone rows in the merge-compare panel (replacing the single guessed value described in the matching section below).
> - **Phase 5 (Cycling + transitive suggestions)** — **done, as of 2026-07-29**. Cycling (`createFamilySession`/`advance`/`recordCommittedEdge` in `engine/contact-tree.js`) is now wired into the canvas via a "Next family member" header button — see CHANGELOG v3.190.0 for the full mechanism (turned out to require a real browser navigation + `chrome.storage.local` persistence + a resume banner, not an in-page state swap, since Medicus is one-patient-per-page). Transitive suggestions shipped in v3.186.0 (see below) plus a first slice of relationship COMPOSITION landed alongside cycling in v3.190.0: `ContactRelationships.composeViaHub` auto-fills a hub's other relatives relative to a newly-cycled-to patient, restricted to the two structurally-safe cases (grandparent/grandchild, in-law) — see the composition memory note two lines down for what's still deliberately excluded (sibling, step-parent) and why.
> - v3.186.0 also fixed a real gap in Phase 2 itself while folding it in: the wizard's `linkContactsBulk` bulk-import only ever wrote the forward link, never the reverse — the canvas version always writes both, via the same path every other new link uses.
> - **Phase 6 (Side-panel review module + backup/IO wiring)** — **RETIRED 2026-08-01, superseded rather than built.** Discussed directly with the user before starting: both halves of this phase were designed back on 2026-07-23, before Phases 1-5 existed, and the actual implementation that followed made both unnecessary. `contacts.relationshipOverrides` (a local-only relationship classification store) has nothing left to override — classification now writes straight back to Medicus via `changePatientContact` once a picker choice is made, so Medicus's own record is always the live source, not a local shadow copy. `contacts.conversionLog` (envisioned as: convert 4 contacts on patient A, remember them, reuse on patients B-E) is superseded by three mechanisms that together already solve it at the source rather than via a local cache: `performLinkAndCleanup` always fires a REAL reverse write onto the other patient's own Medicus record (not just a forward one), so opening patient B natively shows the link back to A already, no replay needed; the transitive pool (v3.186.0) auto-surfaces a hub's own already-linked contacts; and cycling (Phase 5, "Next family member") carries committed-edge state directly from one patient's canvas to the next via `chrome.storage.local`. The side-panel review module is likewise superseded — the canvas itself (opened from the specific patient's own admin page) already shows every linked contact, its NOK/cc flags, shared-contact-info warnings, duplicate-address detection and gap warnings, all in the one place a GP would actually be looking; a separate read-only side-panel browser would only duplicate that with less context. No code written for this phase — decision recorded here so it doesn't resurface as an open item.
> - Two further ideas from 2026-07-26 aren't in this original plan at all: flagging when a patient shares a non-Home phone/email with one of their own linked contacts (a natural extension of the matching section's own stated caution below about shared family contact details) — **built 2026-07-30, see CHANGELOG v3.191.0** (`ContactRelationships.findSharedContactInfo`/`emailOwnerHint`, badge + expandable detail on the linked contact's card) — and flagging a number stored under the wrong type (e.g. a mobile-format number filed as "Home") — **built 2026-07-28, see CHANGELOG v3.189.0** ("Fix type" in the merge-compare panel's Phone rows).
> - **NOK / copy-correspondence gaps and reciprocal flags, added 2026-07-30, see CHANGELOG v3.191.0**: a read-only warning when a patient has no next-of-kin contact set (any age), or when an under-13 patient has no contact set to receive copy correspondence. Separately, the confirm panel now offers NOK/copy-correspondence checkboxes for the RECIPROCAL relationship too (previously forward-only) — the write path had supported this since the canvas was built, it just had no UI.
> - **General relationship composition — narrower slice done, rest still deliberately parked, as of 2026-07-29.** `ContactRelationships.composeViaHub` (CHANGELOG v3.190.0) covers grandparent/grandchild and in-law composition via one unmodified parent/partner hop each — both structurally unconditional, no way to be wrong. Sibling-via-shared-parent (can't tell full- vs half- from one hop) and step-parent-via-partner (the partner could already independently be that child's own parent) remain unbuilt — the plan discussed with the user is to surface those later WITH an explicit prompt asking the user to resolve the full/half or step/bio ambiguity, rather than composing silently. Also parked: what happens when a composable relationship becomes knowable only AFTER the relevant tree(s) were already built/visited earlier in the same cycling session (retroactively adding a composed edge to an already-defined tree) — flagged by the user as a real gap, not yet scoped.
> - **RESOLVED 2026-07-28 — retired.** `content-scripts/contacts-link-button.js`'s original Phase 1 single-contact "convert" mode (pick → search → confirm → done) has been fully superseded by the canvas since it was built, and the user found little use for it once the header started opening the canvas directly — decided to retire it rather than keep carrying it as a quiet header link. Removed entirely: `renderPick`/`renderSearch`/`renderConfirm`/`renderDone` and their state/handlers, `window.ContactsWidget.openConvert`, the canvas's "Convert a single contact" header link, and now-orphaned CSS. `content-scripts/contacts-link-button.js` itself is KEPT — the "import from another patient" flow in the same file was never part of this decision (genuine capability gap the canvas doesn't cover: arbitrary-patient search + true bulk-select) and is now the file's sole remaining purpose. See CHANGELOG v3.189.0 for the full removal list and regression-check result.
> - **RESOLVED 2026-07-28** (was: deferred 2026-07-27 until the tree structure was more robust — that work landed, see below, so this was picked back up): the Parents branch's third "Drop here" slot, once both parents are placed, now shows a "Step-parent" hint rather than reading as an unexplained anomaly. Decided NOT to route step-parents to "Other family / contacts" instead — reasoned that a step-parent is the same generation/household role as a biological parent, and the vocabulary's own modifier system already treats "Step-" as a generationally-equivalent variant (step-siblings already stay in the Siblings row, not Other) — the confusion was purely that Parents is the one row people expect to be capped at exactly two, unlike every other row's ever-present "add another" placeholder. See CHANGELOG v3.189.0.
> - A second item noted the same day (Partner box rendering outside the visible canvas once the sibling row got wide) turned out to be a symptom of a deeper bug — the index<->partner connection's whole `position:absolute` attachment mechanism — and got fixed properly (not just parked) the same day, once that mechanism was replaced with a `parentsBranchHtml`-style joined "couple" line. See CHANGELOG v3.188.0.

---

# Contacts Management — turning "dumb" GP2GP contacts into live Medicus links

## Context

Medicus imports family/contact data from GP2GP as flat, disconnected records — name/phone/email/relationship typed as free text, not linked to any real Medicus patient record. Medicus separately supports linking a contact directly to another real patient record (dynamic, shows that patient's own current details, carries `isNextOfKin` and `copyCorrespondence` flags that drive the Medicus header and message-destination lists). Converting a family from the former to the latter today is entirely manual and repetitive: search, link, define relationship+flags, then repeat in reverse on the other patient's own record, then delete the original. For a family of five this is a lot of tedious, error-prone clicking.

This plan builds a tool, injected directly onto Medicus's own patient admin-record page, that automates this end-to-end: matching existing manual contacts against real Medicus patients, letting the user confirm relationships via a drag-and-drop family tree, and firing the correct linking/deletion calls on both sides of each relationship. Every relevant Medicus endpoint takes an explicit `patientId`, so **writing** "the other patient's side" of a relationship never requires navigating anywhere — it's always a background credentialed fetch from wherever the user already is, regardless of which patient's own page happens to be open.

> Note (2026-07-29): the sentence above originally also claimed the whole TOOL never navigates away
> from the page the user started on. That held for every write, and for Phases 0-4, but Phase 5
> (cycling) broke it deliberately: moving to the next family member turned out to require a REAL
> browser navigation to that patient's own admin-record page, not an in-canvas state swap, because
> Medicus is one-patient-per-page (see the correction at "Key architectural decision" below, and the
> Family-session note further down). Writes still never navigate; the cycling UI now does, for
> viewing purposes only.

The full Medicus API surface below was reverse-engineered via live HAR capture (redacted test-patient traffic) across several rounds with the GP building this; every endpoint/payload shape listed here is a confirmed, observed call, not a guess.

**One correction from our discussion worth flagging**: I said "24 base relationships" when proposing the modifier collapse, but the agreed table actually sums to **32** base relationships (4 partner + 4 parent/child + 2 sibling + 4 grandparent/grandchild + 5 extended + 6 in-law + 4 care + 3 other). The JSON below uses the correct count of 32 — just flagging the arithmetic slip so it isn't a silent surprise later.

---

## Architecture

Three layers, following this repo's existing `engine/` (pure logic) vs `content-scripts/` (browser/DOM) vs `side-panel/` (module UI) boundary:

- **`engine/`** — pure, dual-mode (Node/browser) files, zero DOM/chrome dependency, unit-testable under plain `node`. Canonical relationship data, inversion logic, matching/scoring, and the in-memory family-tree structure all live here, mirroring `engine/reception-match.js`'s template exactly (JSON data file + hand-authored alias tables + `module.exports`/`global.X` dual export).
- **`content-scripts/`** — the injected button, the family-tree canvas, and all the actual credentialed writes to Medicus.
- **`side-panel/modules/contacts/`** — deliberately deferred to the last phase: a read-only review/config surface, never where writing happens.

**Key architectural decision, as originally planned (superseded for cycling — see the note immediately below)**: the canvas never navigates the browser to another family member's own Medicus page. Every endpoint we need (`link-patient`, `create-patient-contact`, etc.) takes an explicit `patientId`/`linkPatientId` argument, so "moving to the next family member" is an in-memory re-render of the same canvas, still parked on the index patient's admin page — both directions of a relationship get written as two background fetches from wherever the user already is.

> Note (2026-07-29): this held through Phase 4, but Phase 5 (cycling) found it technically
> unworkable and deliberately did the opposite. Medicus is one-patient-per-page — there is no way
> to re-render the canvas against a different patient's live data without the browser actually being
> on that patient's own admin-record page. So "moving to the next family member" via the "Next
> family member" button means: persist the in-progress family session to `chrome.storage.local`,
> then perform a REAL browser navigation to the next patient's own record, where a resume banner
> picks the session back up. The WRITE side of the architecture is unaffected by this — both
> directions of a relationship still get written as background credentialed fetches, never
> requiring navigation — only the cycling UI's own act of moving between patients to VIEW them
> navigates. See CHANGELOG v3.190.0 for the full mechanism.

### Credentialed fetch to Medicus's own API
Do the fetch directly from the isolated-world content script: `fetch(url, { credentials: 'include', headers: {...} })` — confirmed working pattern in `content-scripts/task-inline.js:84-118` (`apiFetch`/`apiBaseUrl`). The MAIN-world bridge (`content-scripts/triage-lens/page-world.js`) is not needed for our own outbound writes — it exists only because Medicus's CSP blocks *inline-script* interception of the page's *own* traffic; content scripts already share the page's cookie jar regardless of world.

**Wrong-patient guard (non-negotiable, this is a real clinical-record write)**: immediately before every write, re-derive the current patientId from the live URL/DOM and compare it to the id the UI was opened with; abort on mismatch. Pin local state to a variable before any `await` and check it's still current afterwards, since `task-inline.js`'s own state object gets replaced wholesale on SPA navigation — copy its `doCreate()` guard (marked "WRONG-PATIENT GUARD" in that file) near-verbatim.

### Patient identity / API base resolution
Reuse `engine/api-client.js`'s `detectMedicusContext(href)` (URL-based patientId + `{siteId}.api.<host>` base) and `findPatientUuidFromDom(doc)` (DOM fallback, "fails closed on ambiguity" — refuses to guess if 0 or >1 candidates found) rather than duplicating `task-inline.js`'s own ad-hoc pathname-split. Since manifest content-script blocks execute in a shared isolated world in listed order, but there's no existing precedent in this codebase of one block relying on a global set by an earlier block, **add `engine/api-client.js` explicitly to our own new manifest block too** (harmless — it just reassigns `global.SentinelApiClient` idempotently) rather than assuming cross-block sharing.

The admin/record page is already classified `pageType() === 'record'` by `content-scripts/triage-lens/content.js:722-724` — no new page-classification work needed.

### Injected button/UI durability
The admin-record page has no AG-Grid rows, so `content-scripts/task-inline.js`/`routine-rx-button.js` (floating widget on an ordinary Vue page) are the right precedent, not the queue-chip family. Replicate: the shared `MutationObserver` hub (`content-scripts/dom-observer-hub.js`, `window.__chObserverHub.subscribe`), own-mutation filtering, `withObserverPaused` around our own writes, a cheap `isConnected`/`parentElement` check before any expensive anchor re-search, and explicit teardown on navigation-away. Universal rules still apply: **prepend, never append**; de-dupe via `querySelector` before inserting.

**On DOM contracts**: `shared/dom-contracts.js`'s own header states it's "a RELOCATION of truth mined from the existing consumers, not a redesign" — selectors are added *from* real consumer code, not speculatively ahead of it. So the manual-contacts card anchor selector should just live directly in `contacts-link-button.js` for now; registering it in `dom-contracts.js` is a reasonable follow-up once the selector's been live and stable, not a Phase-1 prerequisite.

**CSS scoping**: `hud.css`'s token-block selector rule (CLAUDE.md rule 5) is specific to the `triage-lens` HUD family. `task-inline.css`/`booking-inline.css` prove this repo's other injected-widget family is fully self-contained with its own hard-coded palette, scoped under its own root id, independent of `hud.css`. Follow that: scope everything under `#ms-contacts-widget`/`#ms-contacts-canvas` with a small self-contained palette — no `hud.css` edit needed.

---

## 1. Data model — `rules/contact-relationships.json`

Same shape family as `rules/reception-pathways.json` (`schemaVersion`, `lastUpdated`, `sourceNotes`, domain arrays). Reviewed by the GP product owner, not the CSO — this is relationship semantics, not clinical content — but held to the same coverage-tested discipline as `SYNONYM_TERMS`.

```json
{
  "schemaVersion": 1,
  "lastUpdated": "2026-07-24",
  "sourceNotes": "Canonical family-relationship vocabulary for the Contacts linking tool, replacing GP2GP free-text relationship fields. Gender fields are soft, non-blocking scoring/inversion hints only — never a hard filter against a patient's genderIdentity.",
  "tiers": [
    { "id": "partner", "label": "Partner" },
    { "id": "parent-child", "label": "Parent / child" },
    { "id": "sibling", "label": "Sibling" },
    { "id": "grandparent-grandchild", "label": "Grandparent / grandchild" },
    { "id": "extended", "label": "Extended family" },
    { "id": "in-law", "label": "In-law" },
    { "id": "care", "label": "Care" },
    { "id": "other", "label": "Other" }
  ],
  "modifiers": [
    { "id": "ex", "label": "Ex-", "appliesToTiers": ["partner"] },
    { "id": "step", "label": "Step-", "appliesToTiers": ["parent-child", "sibling"] },
    { "id": "half", "label": "Half-", "appliesToTiers": ["sibling"] }
  ],
  "relationships": [
    { "id": "husband", "label": "Husband", "tier": "partner", "subjectGender": "m", "reciprocal": { "m": "husband", "f": "wife" } },
    { "id": "wife", "label": "Wife", "tier": "partner", "subjectGender": "f", "reciprocal": { "m": "husband", "f": "wife" } },
    { "id": "partner", "label": "Partner", "tier": "partner", "subjectGender": "n", "reciprocal": "partner" },
    { "id": "civil-partner", "label": "Civil Partner", "tier": "partner", "subjectGender": "n", "reciprocal": "civil-partner" },
    { "id": "mother", "label": "Mother", "tier": "parent-child", "subjectGender": "f", "reciprocal": { "m": "son", "f": "daughter" } },
    { "id": "father", "label": "Father", "tier": "parent-child", "subjectGender": "m", "reciprocal": { "m": "son", "f": "daughter" } },
    { "id": "son", "label": "Son", "tier": "parent-child", "subjectGender": "m", "reciprocal": { "m": "father", "f": "mother" } },
    { "id": "daughter", "label": "Daughter", "tier": "parent-child", "subjectGender": "f", "reciprocal": { "m": "father", "f": "mother" } },
    { "id": "brother", "label": "Brother", "tier": "sibling", "subjectGender": "m", "reciprocal": { "m": "brother", "f": "sister" } },
    { "id": "sister", "label": "Sister", "tier": "sibling", "subjectGender": "f", "reciprocal": { "m": "brother", "f": "sister" } }
    /* ... full 32-entry list per the agreed relationship table: grandparent/grandchild (4),
       aunt/uncle/niece/nephew/cousin (5), the 6 in-law entries, the 4 care entries
       (reciprocal: null — no auto-reverse), friend/neighbour/other (other is the
       free-text escape hatch, alias-free by design) ... */
  ]
}
```

Modelling choices that shape the engine's function signatures:
- `reciprocal` is one of: a plain string (unambiguous), a `{m, f}` object keyed by the **index patient's** gender bucket, or `null` (Care tier — no auto-reverse link ever fires for these four).
- No default in `{m,f}` objects. If the index patient's gender is unknown/non-binary, inversion returns `ambiguous: true` rather than guessing — the confirm panel must show the computed reverse label as an editable line, never a silent write.
- Modifiers are **single-select per tier** (radio, not checkboxes) — Step and Half are mutually exclusive on the sibling tier by definition. `validModifiersForBase(baseId)` derives valid choices from `relationship.tier` against `modifiers[].appliesToTiers`.
- Modifiers invert unchanged — only the base id flips via `reciprocal`.

### `engine/contact-relationships.js`
Dual Node/browser IIFE (same export pattern as `engine/reception-match.js`):
```
getRelationship(id, data?) -> relationship | null
validModifiersForBase(baseId, data?) -> modifierId[]
formatLabel(baseId, modifierId, data?) -> string        // "Step-mother", "Ex-husband"
invertRelationship({ baseId, modifierId, indexGender }, data?) -> { baseId, modifierId, ambiguous }
normaliseFreeText(text, data?) -> { baseId, modifierId, confidence } | null   // colours column-1 cards
ALIAS_TERMS   // { mother: ['mum','mother','mam'], ... } — coverage-tested like SYNONYM_TERMS
buildLinkPatientBody({ patientId, linkPatientId, baseId, modifierId, isNextOfKin, copyCorrespondence, notes }, data?)
buildManualContactBody({ patientId, name, baseId, modifierId, phones, email, address, isNextOfKin, copyCorrespondence, notes }, data?)
```

---

## 2. Confirmed Medicus API (all live-verified via HAR)

Base `https://{siteId}.api.{hostname}`, `credentials: 'include'`, JSON.

| Call | Notes |
|---|---|
| `GET /patient/patient-finder?query=` | Typeahead search → `{patientId, displayName, dateOfBirth, genderIdentity, address, ...}[]` |
| `GET /patient/data/patient/patient-details/{patientId}` | Canonical read — `patientContactsSection` (own cards, manual = `patientContactPatientId: null`), `patientLinkedContactsSection` (read-only reverse index — confirmed **not** a smart inversion, just raw free text from the other side), `patientDetailsSection.formerNames[]` |
| `GET /patient/data/patient-contact/add-patient-contact/{patientId}` | `existingContactPatientIds` for de-dup; `verifiedCandidateRelationships` confirmed always empty — not usable |
| `GET .../link-patient/{A}/{B}` → `POST .../link-patient` | Preview then create ONE direct link. Body: `{patientId, linkPatientId, patientContactRelationship, patientContactIsNextOfKin, patientContactCopyCorrespondence, patientContactNotes}` → `{patientContactRelationshipId}`. Call twice (swap patientId/linkPatientId, invert relationship) for both directions |
| `GET .../lookup-patient-contacts/{A}/{B}` → `POST .../link-contacts` | Bulk-import B's own contact list onto A. **Confirmed behaviour**: this is a dumb copy that preserves whatever the source contact already was — copying a still-manual source produces another manual entry, NOT a real link. Only useful for importing contacts that are already real Medicus links on the source side |
| `GET .../create-patient-contact/{patientId}` → `POST .../create-patient-contact` | Creates a genuine manual contact — confirmed clean structured fields (title/first/middle/last/phones/email/address), not crammed text |
| `GET .../view-patient-contact/{relationshipId}` | Full card detail |
| `POST .../delete-patient-contact-relationship/{relationshipId}` | Delete one relationship |
| `GET /patient/data/home-address/overview/{addressId}` | `alsoAtThisAddress: [{id, displayName}]` — minimal shape, no DOB/gender; needs a follow-up per-candidate `patient-details` fetch for scoring |

---

## 3. Matching/scoring — `engine/contact-match.js`

Pure, no fetch/DOM. Reuse the token-Jaccard technique already proven in `shared/knowledge-utils.js`'s `findSimilar` (exact → substring → Jaccard token-overlap) rather than inventing new fuzzy matching.

```
nameSimilarity(a, b) -> 0..1
scoreCandidate(manualContact, candidate, opts?) -> { score: 0-100, tier: 'strong'|'possible'|'weak', signals }
rankCandidates(manualContact, candidates, opts?) -> sorted array
```

Weights (100-point budget, deliberately capping phone/email per the explicit caution about shared family emails and children's records wrongly carrying a parent's contact details):

| Signal | Weight |
|---|---|
| Name match (current name + `formerNames[]`) | 55 |
| Same registered address | 20 |
| Age plausibility vs. the relationship word (soft nudge, not a filter) | 8 |
| Gender consistency vs. relationship word (mismatch scores neutral, never 0 — genderIdentity may differ from assumed sex, explicitly parked) | 7 |
| Phone match | 5 |
| Email match | 5 |

`tier`: ≥70 strong, ≥40 possible, else weak — **purely a sort/badge aid**, every match is human-confirmed by drag regardless of score, nothing auto-applies at any threshold.

---

## 4. Family-tree structure — `engine/contact-tree.js`

Pure, in-memory. Two product rules are enforced structurally, not just by UI convention:

```
createTree(indexPatientId) -> { indexPatientId, slots: {partner, siblings[], parents[], children[], grandparents[], auntsUncles[], other[]}, edges: [], pendingSuggestions: [], needsReview: [] }
assignToSlot(tree, slotPath, card, relationshipChoice) -> tree'
addPendingSuggestion(tree, {slotPath, card, baseGuess, source}) -> tree'
commitSuggestion(tree, suggestionId, decision) -> {tree', edge}   // the ONLY path a suggestion can become a real edge
toRenderModel(tree) -> render-ready plain object
```
- `commitSuggestion` is the only function that writes to `edges` from a suggestion — nothing auto-promotes, structurally preventing an unconfirmed transitive suggestion (e.g. two parents suggested as partners of each other) from silently becoming real.
- NOK/copy-correspondence live **per-edge only**, never on a shared node — structurally prevents one edge's flags leaking onto another edge sharing a person (the "two parents both NOK for their child ≠ NOK for each other" rule from our discussion).

> Note (2026-07-26): `needsReview` as a distinct tree-structure field was later removed — see the
> current `engine/contact-tree.js` and CHANGELOG v3.183.0/v3.185.0. The problem it addressed
> (an already-linked contact whose relationship text doesn't map to a canonical id) is now handled
> without a separate holding structure at all.

**Family-session, as originally planned (superseded — see the note below)**:
```
createFamilySession(indexPatientId) -> { queue: [indexPatientId], cursor: 0, byPatient: Map, committedEdgesByPatient: Map }
advance(session) -> nextPatientId | null
recordCommittedEdge(session, patientId, edge)   // called right after a successful dual link-patient write, before the next screen renders, so pre-placed locked boxes stay in sync with what's actually in Medicus
```
Lives entirely in the canvas's JS closure — a closed tab loses in-progress-but-unconfirmed work in v1. Worth calling out as a known limitation rather than solving speculatively; persisting to `chrome.storage.local` is a natural later enhancement if it turns out to matter in practice.

> Note (2026-07-29): both paragraphs above turned out to be wrong once Phase 5 was actually built.
> "Enables cycling without navigation" didn't hold — see the note on the "Key architectural
> decision" above; cycling requires a real browser navigation per family member, since Medicus is
> one-patient-per-page. And `chrome.storage.local` persistence wasn't an optional nice-to-have that
> "might matter in practice" — it became load-bearing and mandatory from the start: without it, the
> in-progress session would be destroyed by the very navigation cycling depends on, before the next
> screen could even render. The shape also grew beyond this sketch (`queue`/`cursor` became
> `current`/`visited`/`pending`, since a newly-discovered relative can sort older than someone
> already visited — a cursor-in-array model can't express that) and gained a `recordInactive`/
> deceased-aware skip loop and a resume banner. See CHANGELOG v3.190.0 for what actually shipped.

---

## 5. Phased build sequence

Each phase ships something real and independently testable. The riskiest primitives (wrong-patient guard, dual `link-patient` writes, deleting the superseded manual contact) land in **Phase 1**, before any drag/tree/matching UI exists — validates the write path in production early, per your own stated preference for incremental delivery.

- **Phase 0 — Foundations.** `rules/contact-relationships.json`, `engine/contact-relationships.js`, `engine/contact-match.js`, `engine/contact-tree.js`. Fully tested, unused by any content script yet.
- **Phase 1 — Single-contact manual→linked conversion (the real MVP).** `content-scripts/contacts-api.js` (all endpoint wrappers above), `content-scripts/contacts-link-button.js` + `.css` — button on the admin-record page's manual-contacts card; modal: search pre-filled with the manual contact's name (ranked via `rankCandidates`), preview, confirm panel (relationship + single-select modifier + NOK/copy checkboxes, both unticked by default except pre-ticked from the manual entry's own values, editable computed-reciprocal line), fire forward link → reverse link → delete old manual contact. New manifest content_scripts block (`contacts-api.js` + `contacts-link-button.js` + own copy of `engine/api-client.js`); add `rules/contact-relationships.json` to `web_accessible_resources` (both `sentinel.js` and `triage-lens/content.js` already prove isolated-world fetches of bundled JSON need this listing, not just MAIN-world/page fetches). Version bump: minor.
- **Phase 2 — Bulk import of already-linked contacts.** Adds `lookup-patient-contacts`/`link-contacts` to the same modal for importing family members who are already real links on another patient's record. Explicit code comment on the "dumb bulk-copy preserves manual status" behaviour, and the UI must only ever offer this against sources that are already real Medicus links — never manual ones.
- **Phase 3 — Three-column canvas, flat assignment (no visual tree yet).** `content-scripts/contacts-canvas.js` + `.css`. Full `contact-match.js` scoring powers columns 2/3; drag-to-merge and drag-to-assign land here. Crib `reception.js`'s `wireTileDrag` event handling; consider `panel.js`'s nav-tab reorder's before/after drop-indicator styling over `reception.js`'s plainer "over" highlight. Wires in `home-address/overview` for column 3.
- **Phase 4 — Visual family tree.** `contact-tree.js`'s slot/edge model gets a renderer: parent row, partner slot (direct line, no ancestry connector), sibling slot(s) (line up to shared parent box — half-siblings connect to only the one shared parent), children row, "+" expand targets, "needs review" holding area.
- **Phase 5 — Cycling + transitive suggestions.** `createFamilySession`/`advance`/`recordCommittedEdge`. Already-committed edges pre-placed and locked; transitively-inferable relationships (e.g. two parents of a shared child, suggested as partners) shown dashed/tentative, requiring their own explicit drag-confirm on that screen — never auto-committed.
- **Phase 6 — Side-panel review module + backup wiring.** `side-panel/modules/contacts/` (read-only relationship-list browser + conversion audit log), registered per the standard 6-point checklist (`panel.js`/`panel.html`/`pop-out.js`/`pop-out.html`/`tab-catalog.js`/`tab-help.js`). `contacts.conversionLog` — not backed up (derivative audit trail, same doctrine as `shared/contact-ledger.js`) — added to `test-backup-coverage.js`'s `ALLOWLIST` with a citing comment; `contacts.relationshipOverrides` (genuine user config) gets the full IO treatment: `shared/io/contacts-io.js`, `VALID_SCOPES` in `suite-envelope.js`, wired into `options.js`'s `doFullExport`/`applyEnvelope`, preview line in `previewEnvelope`, script tag + export card in `options.html`.

---

## 6. Tests per phase

Convention confirmed: plain script (not `node:test` API), local `assert()` helper, `process.exit(1)` on failure, loads the *real* shipped JSON fixture (not a mock) — mirrors `test-reception-match.js`/`test-contact-ledger.js` exactly.

- `test-contact-relationships.js` (Phase 0) — every relationship id has a non-empty `ALIAS_TERMS` entry except `other`; no stale alias keys; `invertRelationship` round-trips sensibly for every non-care relationship, and asserts `ambiguous`/no-auto-reverse for the 4 care entries; every modifier's `appliesToTiers` matches a real tier; spot-check `formatLabel` output (`Step-mother`, `Ex-husband`, `Half-brother`).
- `test-contact-match.js` (Phase 0) — exact-name+same-address scores strong; shared-family-email-different-name scores low despite the email hit (proves phone/email can't dominate); gender mismatch never zeroes a score; a candidate too young for "Mother" loses only the small age component.
- `test-contact-tree.js` (Phase 0) — `commitSuggestion` is the only path into `edges`; NOK/copy flags on one edge never leak onto a sibling edge sharing a node; `toRenderModel` shape is stable for a hand-built fixture.
- Phase 1 — payload-builder tests for `buildLinkPatientBody`/`buildManualContactBody`, plus an integration-shaped test confirming the reverse call really swaps `patientId`/`linkPatientId` and inverts the relationship string correctly.
- Phase 6 — `test-tab-catalog.js`/`test-tab-help-coverage.js` already fail closed on a missing entry; extend `test-backup-coverage.js`'s `KEY_PREFIXES`/`ALLOWLIST` only (that file scans all source automatically).

---

## Verification (end-to-end, per phase)

1. `node --test --test-concurrency=1 test-contact-*.js` — pure-logic tests pass in isolation before any browser code exists (Phase 0).
2. Load the unpacked extension, open a test patient's admin-record page in the Browser tool, confirm the button appears on the manual-contacts card and survives a manual page refresh / Vue re-render (Phase 1).
3. Live-fire Phase 1's conversion against real test patients (the same test family already used for HAR capture), then re-fetch `patient-details` for both patients and confirm: forward link created, reverse link created with the correctly-inverted relationship, old manual contact gone, NOK/copy-correspondence flags match what was ticked.
4. `npm run lint` / `npm run format:check` before each phase's commit; bump `manifest.json` version + `CHANGELOG.md` entry per phase per this repo's convention.
5. Once the canvas (Phase 3+) exists, re-run the same test-family scenario through the UI instead of firing calls directly, confirming the ranked suggestions surface the right candidates and the drag interactions produce the same API calls verified in step 3.
