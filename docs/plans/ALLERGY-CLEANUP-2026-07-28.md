# Allergy tidy-up — provenance & reaction from the notes (plan, 2026-07-28)

**Status: PLAN ONLY — no code yet.** Phase 0 (live API capture) is the gate on
everything else; nothing below it can be built until that session has run.

## The idea (Dave, 2026-07-28)

On the clinical-summary screen the suite already scrutinises problems
(`content-scripts/problem-description-cleanup.js` — "Fix description" +
retired-code scan; `problem-bulk-end.js` — bulk end). Allergies on the same
screen are the obvious next target: **the provenance of an allergy entry is
often unknown, and frequently so is the reaction** — a bare "Penicillin
allergy" with no manifestation, no date that means anything, recorded-by lost
in a GP2GP transfer. But the answer is usually *somewhere in the notes*: the
original consultation ("widespread urticarial rash after amoxicillin"), a
discontinued prescription, a hospital letter.

Feature: for each under-specified allergy, **trawl the patient journal for the
evidence** — what the reaction was, when it happened, who recorded it — show
that evidence to the clinician with verbatim snippets, and offer a guided,
clinician-confirmed tidy-up of the allergy entry via Medicus's own edit
contract.

## Why this is buildable with what we already have

- **The notes are one API call away.** `clinical/data/patient-journal/overview/{patientId}`
  is fully mapped (`docs/learnings-patient-journal-api.md`): one unfiltered
  request returns the entire history (210 day-groups on the test patient),
  including 697 `note` entries with plain-string `note` text,
  `clinicalCodeDescription`, `recordedBy`, `recordedByOrganisation`, dates —
  plus prescriptions (`productName`), documents, and encounters with the
  `"Data Transferred from other system"` GP2GP marker. Everything a trawl
  needs is already confirmed-shape.
- **The widget pattern is proven.** problem-description-cleanup.js already
  solved: injection into the Vue-rendered clinical-summary card (anchor by
  exact text match, MutationObserver hub, own-mutation filter, 400ms
  throttle), per-row fix buttons, a card-level opt-in scan trigger, prefill
  round-trip apply with the §3b option-object flatten, fail-soft with the
  server response body surfaced. The allergy widget is the same skeleton
  pointed at the allergies card.
- **The edit-contract discipline is established.** The problem work proved the
  capture-first method end-to-end (GET prefill → full-replace POST). We do
  the same one-time capture for allergies — never construct URLs from
  scratch.

## What we do NOT yet know (Phase 0 closes these)

1. **Where the summary screen's allergy list comes from.** Does
   `clinical/data/clinical-summary/summary/{patientId}` carry an
   `allergies[]` array alongside the confirmed `problems[]`? What are the
   field names — substance description, reaction/manifestation, severity,
   status, recordedDate, recorded-by? (The suite's only current allergy
   source is the GP Connect Structured FHIR feed —
   `shared/fhir-normaliser.js` maps `AllergyIntolerance` to
   `{label, code, status, recordedDate}` only — which is a *read* feed for
   the rules engine, not the edit surface.)
2. **The edit-allergy contract.** The analogue of
   `clinical/data/problem/edit-problem/{id}` (prefill) and
   `clinical/problem/edit-problem/{id}` (full-replace save): does it exist,
   what fields does the form carry (is the reaction a coded manifestation, a
   free-text field, or both?), which fields are select-backed `{value,label}`
   option objects (the §3b flatten trap), and what the substance-code search
   endpoint is (drug allergies may search dm+d, not the problem-search's
   SNOMED parent set).
3. **What "untidy" looks like in real data.** Is the dominant case a degraded
   GP2GP import, a free-text-only entry, or a coded entry with an empty
   reaction field? Detection heuristics should be written against captured
   examples, not guessed.

## Phases

### Phase 0 — live capture (blocking; one Medicus session with Dave)

Same method as `docs/learnings-problem-description-cleanup.md`:

- On a patient with a known scruffy allergy, capture the clinical-summary
  response and record the allergies array shape (PHI-safe `describeShape`
  convention — types and field names only, never clinical values, plus the
  established safe-value allowlist of ids/booleans/dates).
- Perform ONE real allergy edit end-to-end through Medicus's own UI with
  `scripts/document-create-capture.js` (`chDocCap`, `.all()` mode) running —
  capturing the prefill GET, any substance/reaction search calls, and the
  save POST body verbatim.
- Write `docs/learnings-allergy-cleanup.md` in the established format:
  confirmed contract, option-object fields, what's NOT confirmed.
- Also note the allergies card's DOM shape on the clinical-summary tab
  (expected to be the same `li.item` / `m-card-v2` pattern as Active
  Problems, but confirm — the anchor-by-text trick depends on it).

### Phase 1 — detection: which allergies get flagged

Cheap first pass over the summary allergy list (mirroring `looksOutdated()`):

- **Missing reaction** — empty/`Unknown`/`Unspecified` manifestation (exact
  field per Phase 0).
- **Legacy description markers** — reuse
  `shared/legacy-coded-description.js` unchanged (it was deliberately built
  entity-agnostic for exactly this second consumer): ICD bracket prefixes,
  `NOS`/`NEC`, `H/O`, generic import text.
- **Provenance gaps** — recorded at another organisation with no
  practitioner/organisation carried over, or a record date that clusters
  with a GP2GP transfer encounter (the confirmed
  `"Data Transferred from other system"` topic marker) — i.e. "the date on
  this entry is the import date, not the event date".

### Phase 2 — the notes trawl (`engine/allergy-evidence.js`, pure + Node-testable)

New engine module, no DOM, no fetch — takes the allergy entry + the journal
payload, returns ranked evidence. Tested the same way as
`engine/record-duplicate-parser.js` (fixture JSON, `node --test`).

- **Flattening:** reuse/extend the journal-walking already proven in
  `record-duplicate-parser.js` (`patientJournalRecords[].items[]`, flat +
  `consultationTopics→headings→entries` nested, all three `linkedProblems`
  levels known). Do not write a third journal walker from scratch.
- **Substance matching:** normalise the allergy label (strip
  "Allergy to" / "Adverse reaction to" / "H/O:" wrappers), then
  case-insensitive word match across note text, `clinicalCodeDescription`,
  prescription `productName`, and document titles. Brand↔generic bridging
  can reuse the `drug-rules.json` match lists where a rule covers the
  substance — but must degrade gracefully to plain text match for anything
  not in the rules (most food/environmental allergies).
- **Reaction extraction:** a curated reaction lexicon (rash, urticaria,
  hives, itch/pruritus, swelling, angioedema, lip/tongue/facial swelling,
  anaphylaxis, wheeze, breathless/SOB, collapse, nausea, vomiting,
  diarrhoea, headache, "felt unwell", intolerance…) matched within a
  proximity window of the substance mention. Deterministic lexicon + window
  scoring only — **no LLM, no inference**; the tool finds and quotes, the
  clinician judges. (Same philosophy as the whole rules engine.)
- **Output evidence items:** `{date, sourceType (note/prescription/document/
  encounter), recordedBy, recordedByOrganisation, snippet, matchedReactionTerms,
  score}` — ranked: substance + reaction term in the same entry first, then
  substance-only mentions, then prescription-history corroboration (e.g. the
  substance was actually issued then never again / discontinued near the
  earliest mention).
- **Provenance answer:** earliest dated mention = likely origin event;
  entries inside a GP2GP transfer encounter are labelled "imported — original
  authorship at previous practice" rather than pretending the importer is
  the author.

### Phase 3 — UI (`content-scripts/allergy-cleanup.js/.css`)

Clone the problem-description-cleanup skeleton against the Allergies card:

- Per-flagged-row button ("Find evidence?") + a card-level opt-in trigger
  ("Check allergies?") — same idle→scanning→done states, same
  `ms-*`-prefixed classes, own CSS file, manifest registration alongside the
  other two summary-screen scripts.
- Panel: current entry (substance / reaction / date / recorded-by as
  Medicus holds them) above the evidence timeline — dated verbatim snippets
  with source + author, ranked. Wording must say **"possible documented
  reaction found — open and review the source entry"**, never "the reaction
  was X".
- Every snippet links/points to its journal date so the clinician can open
  the real entry before acting.
- Same re-injection discipline: observer hub, own-mutation filter, throttle,
  de-dupe, prepend.
- (Later, not v1:) a read-only line in the Record tab's safety card — "2
  allergies have no documented reaction" — once the detection is trusted.

### Phase 4 — apply (guarded; only after Phase 0 confirms the contract)

- GET the edit-allergy prefill, round-trip the FULL payload with only the
  clinician-chosen fields changed (full-replace assumption until proven
  otherwise, per the problem precedent), `unwrapOptionValue()` flatten on
  select-backed fields, surface the server response body on failure.
- v1 apply scope — **additive only**:
  - fill in the reaction/manifestation field,
  - correct/complete the event date,
  - append an `additionalInformation` citation, e.g. *"Reaction documented
    in note of 12 Mar 2019 (Dr Smith): 'widespread urticarial rash' —
    completed via evidence review."*
- One entry at a time, clinician-confirmed each time. **No bulk apply.**

## Safety rules (hard lines — this is an allergy record)

An allergy entry is the highest-stakes record type the suite has touched with
a write. Before the Phase 4 apply ships, HAZARD-LOG.md gets entries and CSO
review, same as every other write path. Non-negotiables, v1:

1. **Never delete, end, downgrade, or mark-incorrect an allergy.** Not in
   scope, not offered, even when the evidence suggests it ("no mention
   anywhere in the notes" is ABSENCE of evidence, not evidence the allergy
   is wrong). If Dave later wants a "review candidate for removal" flag,
   that is a separate feature with its own hazard analysis.
2. **Never change the substance code.** Same-concept discipline as the
   problem tool, but stricter: v1 doesn't offer description swaps at all —
   reaction/date/notes only. Rationale: `evaluateDrugAllergyRule`
   (`engine/rules-engine.js`) matches on the allergy **label** by substring,
   so a label change could silently stop a drug-allergy chip firing — the
   exact silent-failure class CLAUDE.md warns about for drug rules. If
   description tidy-up is added later, it must ship with a regression guard:
   evaluate the drug-allergy rule set against the before/after label and
   block/warn if any rule that matched before no longer matches.
3. **Evidence is quoted, never summarised or paraphrased**, and always
   dated + attributed, so the clinician is reading the record, not the tool.
4. **Additive writes only** (fill blanks, append citation) — the tool never
   overwrites a populated reaction field with a different value; a conflict
   between the entry and the notes is surfaced for the clinician to resolve
   in Medicus's own UI.
5. Fail-soft everywhere: any fetch/parse failure just means "no evidence
   panel", never a broken summary screen (same posture as
   `buildAllergyPrompts`'s try/catch).

## Open questions for Dave (don't need answers to start Phase 0)

- Scope: drug allergies only for v1, or food/environmental too? (Trawl works
  for both; brand↔generic bridging only helps drugs.)
- In practice, are the scruffy entries mostly GP2GP imports, or home-grown
  entries where the reaction just never got filled in? (Shapes detection
  priority; Phase 0's captures will partly answer it.)
- Does Medicus's own edit-allergy form expose reaction as coded, free-text,
  or both? (Phase 0 answers; determines what "fill in the reaction" can
  actually write.)
- Entry point: assumed the clinical-summary Allergies card, matching the
  problems tools — confirm that's where you'd want it.

## Deliverables checklist (when built)

- `docs/learnings-allergy-cleanup.md` (Phase 0 capture)
- `engine/allergy-evidence.js` + `test-allergy-evidence.js`
- `content-scripts/allergy-cleanup.js` / `.css` + manifest registration
- HAZARD-LOG.md entries + CSO review before the Phase 4 apply ships
- CHANGELOG + minor version bump on first shipped phase
