> **Status (updated 2026-07-17):** the fixes this doc identifies have been
> applied — `extractDayGroups()` now reads `patientJournalRecords` first,
> `flattenJournal()` collects `linkedProblems` from all three confirmed
> levels (deduped per-encounter by problem id), flat top-level
> `investigation-request` items are now handled, flat `prescription` items
> now carry `linkedProblems` like the `note` branch does (their
> `recordedBy`/`recordedByOrganisation` were later found NOT to exist — see
> below), and `duplicate-checker.js`'s `describeShape()` bug is fixed. Since
> then, the GP2GP-wrapper text marker, the `api-discovery.js` auto-capture
> mystery, the `"Data Transferred from other system"` transfer-encounter
> marker's live hit rate, and the prescription/investigation-request field
> names have all been independently confirmed/fixed live (2026-07-05,
> 2026-07-08, and twice more on 2026-07-17 — see "Open questions" and "Live
> verification" below). Only the low-priority `topicCode` double-nesting
> question remains open on the Journal side. A **companion investigation**
> on a different tab/endpoint entirely (the Medication history tab) is now
> closed — hypothesis rejected, no duplicates found, no feature needed — see
> `docs/learnings-medication-regimen-duplicates.md`.

# Learnings: Patient Journal API (`clinical/data/patient-journal/overview/{patientId}`)

Findings from live inspection of the Medicus Journal tab's network traffic
(2026-07-02), gathered to build the per-patient duplicate-record analysis in
`duplicate-checker.js` / `engine/record-duplicate-parser.js`. Same discovery
pattern as `docs/learnings-referrals-tracker.md`: never construct Medicus API
URLs from scratch — capture and replay.

---

## Already known before this session (existing shipped code)

The endpoint and part of its shape were **already in production use** —
independently discovered/confirmed by earlier work, before the duplicate-
checker project touched it at all:

- **`content-scripts/sentinel.js` `fetchJournalObservations()`** (comment:
  "for AST007 and future encounter-coded rules") already calls this exact
  endpoint and parses `patientJournalRecords[].items[].data
  .consultationTopics[].headings[].entries[]`, filtering on
  `entry.entryType === 'observation'`. This is the proof that the
  `consultationTopics → headings → entries` nesting is real and safe to rely
  on (not just a guess) — it's the same nesting record-duplicate-parser.js
  independently assumed for note/prescription/investigation-request entries.
- **`engine/api-client.js` `resolveEncounterToPatient()`** hits a related but
  different endpoint, `/clinical/data/encounter/overview/{encounterUuid}`,
  and falls back to `data.consultationTopics[0].patientId` — confirms
  `consultationTopics[]` items also each carry a `patientId` field.
- **`engine/extractors/patient-context.js`** recognises
  `careRecordTab=medication/observations/problems/summary` as page-context
  markers, but had **no** `journal` case — nobody had previously wired up
  page-context detection for the Journal tab specifically.

`engine/record-duplicate-parser.js` (built 2026-07-01, before any live check)
guessed the same `consultationTopics → headings → entries` shape independently
of `sentinel.js` — the two converging is good corroboration, but the parser's
guess also got things **wrong** (see below), which only a live check caught.

---

## New in this session (2026-07-02, confirmed via DevTools + console `describeShape`)

### Endpoint & URL

- **URL:** `GET https://{siteCode}.api.england.medicus.health/clinical/data/patient-journal/overview/{patientId}`
  (matches `sentinel.js`'s `getMedicusApiOrigin()` + path — no new endpoint,
  but this is the first time the *response shape* was inspected end-to-end
  rather than just the one `observation` slice sentinel.js needed.)
- **Page URL that triggers it:** `https://england.medicus.health/{code}/patient/patient/care-record/{patientUuid}?careRecordTab=journal` —
  optionally with `&year[]=YYYY&initialCat=year` filters. Confirms
  `content-scripts/api-discovery.js`'s journal-page gate regex
  (`/\/care-record\//i` + `careRecordTab=journal`) targets the right route.
- A **single unfiltered request returns the full history** — one patient
  returned 210 day-groups spanning back to 2025, not just a recent window.

### Top-level response shape

```
{
  patientJournalRecords: [ {...day...}, ... ],   // the array we need
  patient: { id, displayName },
  filters: {
    categories: [                                 // UI filter-panel definitions
      { title: "Entry type", filterKey, options: [{ label, value, entryCount, selected }], displayMaxOpts },
      ... 9 more categories
    ],
    search, filteredEntriesCount
  },
  filtersApplied: boolean
}
```

**Correction to the parser:** `engine/record-duplicate-parser.js`'s
`extractDayGroups()` guessed the array would be under `journal` / `timeline`
/ `entries` / `days`. It is none of those — it's **`patientJournalRecords`**.
Needs a fix.

**Unexplored but promising:** `filters.categories[0]` is titled `"Entry
type"` with an `options[]` list of `{label, value, entryCount}` — this is
almost certainly the full enum of valid `item.type` / `entry.entryType`
values, straight from the API, with per-value counts. Reading this once
would replace hunting through 210 days manually to find each type. Next
person to resume this: check `filters.categories[0].options` first.

### Day-group shape

```
{ title: "Thu 02 Jul 2026", items: [ {...item...}, ... ] }
```
Confirms the parser's `day.title` / `day.items[]` assumption. `title` format
is `"DayName DD Mon YYYY"` — different from `entry.observationDate`'s
`"DD Mon YYYY"` (no day name) seen in `sentinel.js`, so date-parsing code
must not assume both are the same format.

### All 11 top-level `item.type` values (confirmed, scanned across all 210 days)

```
encounter, investigation, document, prescription, future-action, note,
communication, medication-statement-prescribed-elsewhere, referral,
observation, investigation-request
```

This resolves the earlier open question — `"note"` and `"prescription"` DO
exist as **flat top-level item types** (not just nested inside an
encounter's `consultationTopics`), which matches
`record-duplicate-parser.js`'s existing flat-item branches
(`item.type === 'note'` / `'prescription'`) exactly — those were correct
guesses. But the other 8 types (`investigation`, `document`,
`future-action`, `communication`,
`medication-statement-prescribed-elsewhere`, `referral`, `observation`,
`investigation-request`) have **no branch at all** in `flattenJournal()` —
they fall through the `if/else if/else if` with no `else`, so they're
silently skipped. Per the file's own header comment this is intentional for
`investigation` ("Investigation *results* (lab values) are flattened for
future use but not tiered"), but note that **`investigation-request` is a
distinct top-level type from `investigation`**, and isn't obviously covered
by that same carve-out — worth a decision when the parser is reworked,
not assumed either way here.

### Item shape (top level of `items[]`)

```
{
  type: "encounter",              // one of the 11 values above
  id, title, descriptionText,
  data: {...},                    // shape depends on `type`; see below for "encounter"
  badges: [],                     // empty in every sample seen so far, purpose unconfirmed
  isDraft: boolean,
  isMarkedIncorrect: boolean,     // NOTE: "isMarkedIncorrect", NOT "isMarkedAsIncorrect"
                                   // (the problem-listing endpoint used elsewhere in
                                   // duplicate-checker.js uses isMarkedAsIncorrect — different
                                   // endpoint, different field name, don't conflate them)
  createdDateTime: null,          // null in every sample seen so far
}
```

This is flatter than `record-duplicate-parser.js` assumed — it does NOT
assume a `badges`/`isDraft`/`isMarkedIncorrect` wrapper, but that's harmless
(extra fields, ignored). No conflict there.

### `data` shape for an `encounter`-type item

```
{
  patientId, encounterType, startTime, endTime,
  responsiblePractitioner: "string",       // plain string, not an object — matches parser's usage
  responsibleOrganisation, otherParticipants, additionalStaff, seenInEstablishment,
  hiddenFromPatientFacingServices: boolean,
  confidentialFromThirdParties: boolean,
  isRetrospectivelyAmended: boolean,
  consultationTopics: [...] | null,
  linkedProblems: [...] | null,
  linkedCommunicationThreadTaskId,
}
```

**Correction to my own earlier note in this doc:** I previously wrote this up
as "`linkedProblems` is a sibling of `consultationTopics`, not nested inside
each topic — the parser's `topic.linkedProblems` read is a bug." That was
premature — a later, populated example shows **`linkedProblems` actually
appears at three separate levels**, all structurally real:

1. `data.linkedProblems` (encounter level) — **confirmed populated** by a
   real example: `{ id: "string", problemCodeDescription: "string" }` (only
   two keys on that object — nothing else present).
2. `consultationTopics[].linkedProblems` (topic level) — present as a key,
   empty (`[]`) in every example seen at the time this doc was first
   written. **CORRECTED 2026-08-12** (HAR capture, real patient, an
   umbilical-hernia note+problem pair, feature: journal-duplicate detection
   for "Clean up code" — see `shared/journal-problem-matching.js`): this
   level CAN be populated, and can be the ONLY level populated for a given
   entry (encounter- and entry-level both empty on that same note while
   topic-level correctly named the linked problem). "Empty in every sample
   so far" was true only of the samples looked at then — not a structural
   guarantee. Any code reading `linkedProblems` must union all three levels,
   never trust encounter-level alone.
3. `consultationTopics[].headings[].entries[].linkedProblems` (individual
   entry level, i.e. per-note/per-prescription) — also present as a key,
   empty in every sample seen via the BULK `patient-journal/overview`
   endpoint so far. Note the separate per-note detail endpoint below can
   disagree with this field for the same note (see "Per-note detail
   endpoint" section) — the bulk endpoint's entry-level `linkedProblems`
   appears to not always be reliable/complete even when populated data
   exists elsewhere for the same note.

So the parser's existing `topic.linkedProblems` read isn't wrong, it's
**incomplete** — a problem can apparently be linked at the encounter, the
topic, or the individual entry, and the parser currently only reads the
topic level. Whether that matters for duplicate-detection purposes (vs. just
being defensive) needs a decision when the parser is actually reworked —
noting the finding here rather than prescribing the fix, per the "no code
changes yet" instruction.

`problemCodeDescription` as the field name is now **confirmed** (matches
`record-duplicate-parser.js`'s `pushProblem()` assumption exactly).

### `consultationTopics[].headings[].entries[]`

Now confirmed with a real non-null example (previously only inferred via
`sentinel.js`'s `observation`-only usage). One heading (of 8 on this
encounter) had 2 entries, each shaped:

```
{
  entryType: "string",                    // value not yet captured — see Open Questions
  id,
  note: object,                           // null in this sample — genuinely nullable, or a
                                           // wrapper object rather than a plain string? unconfirmed
  clinicalCodeDescription: "string",      // CONFIRMED — matches parser's assumption exactly
  recordedBy: "string",                   // CONFIRMED — matches parser's assumption exactly
  recordedByOrganisation: object,         // null in this sample — is it a plain string when
                                           // populated (as the parser assumes) or an {id,name}-style
                                           // object? unconfirmed, matters for the parser's Set-based
                                           // org-grouping logic
  isMarkedIncorrect, hiddenFromPatientFacingServices, confidentialFromThirdParties,
  isExplicitlyIncludedInSCR, isRetrospectivelyAmended: booleans,
  patientBannerFlags: [],                 // empty in every sample so far
  linkedProblems: [],                     // see above — entry-level linkedProblems, empty so far
  createdDateTime: object,                // null in this sample
  matchesFilters: boolean,
}
```

### Per-note detail endpoint — `GET /clinical/data/note/overview/{noteId}` (new, 2026-08-12)

Discovered via HAR capture while debugging the journal-duplicate-detection
feature (`shared/journal-problem-matching.js`) — a live user report that a
genuinely-linked note wasn't being surfaced. **This is a DIFFERENT endpoint
from the bulk `patient-journal/overview` this doc otherwise covers** — one
request per note, not part of the day-grouped payload. Real captured
response (patient/problem-identifying values redacted, structure/field
names real):

```json
{
  "noteId": "...",
  "patientId": "...",
  "consultationTopicHeading": "Intervention",
  "noteSNOMEDctCode": {
    "conceptId": "428649003",
    "description": "Primary repair of umbilical hernia NOS",
    "descriptionId": null,
    "originalCodes": []
  },
  "note": "(para umbilicAL)",
  "recordDate": "2009-07-17",
  "created": "2024-09-28 04:27:01",
  "isMarkedAsIncorrect": false,
  "linkedProblems": [{ "id": "...", "problemCodeDescription": "...", "isMarkedIncorrect": false, "hasEnded": false, "hiddenFromPatientFacingServices": false, "confidentialFromThirdParties": false, "significance": "Major" }],
  "allowEditLinkedProblems": false,
  "hiddenFromPatientFacingServices": false,
  "confidentialFromThirdParties": false,
  "inRcgpExclusionList": false,
  "recordedBy": "...",
  "includedExcludedLabel": "Included (additional item)",
  "patientBannerFlags": [],
  "isExplicitlyIncludedInSCR": false,
  "hasUnresolvedDegradedCode": false,
  "unresolvedDegradedCodeId": null,
  "contextType": "consultation-topic-heading",
  "createdInOriginalSystemDateTime": "2009-07-29 16:07:06",
  "clinicalCase": null
}
```

Notable, all confirmed live:

- **`noteSNOMEDctCode: {conceptId, description, descriptionId, originalCodes}`
  — a journal note DOES carry a full structured code, just not via the bulk
  journal endpoint.** This directly matters for the future journal-code
  write path (currently blocked, see `shared/journal-problem-matching.js`'s
  header) — the shape is structurally identical to a problem's
  `problemCode.value` (`content-scripts/problem-description-cleanup.js`'s
  own documented contract), suggesting an analogous edit endpoint may exist,
  though **no write/POST counterpart has been captured yet** — this is a
  read-only GET capture only, don't assume a write contract from it.
- **`linkedProblems` here was POPULATED for a note whose entry-level
  `linkedProblems` in the bulk `patient-journal/overview` payload was
  empty** (`[]`) for that exact same note id. The bulk endpoint's
  entry-level field cannot be trusted as complete — see the topic-level
  correction above.
- **`recordDate` (`"2009-07-17"`) differs from the day-group `title` this
  note was filed under in the bulk payload (`"Wed 29 Jul 2009"`)** — the
  day-group date lines up with this response's
  `createdInOriginalSystemDateTime` (`"2009-07-29 16:07:06"`), not
  `recordDate`. **Open question, not yet resolved:** any code that compares
  a problem's `recordDate` against a bulk-journal day-group's `title` (as
  `shared/journal-problem-matching.js`'s date-tier matching currently does)
  may be comparing the wrong pair of dates for older/GP2GP-migrated
  records, where the two can differ by days to weeks. Not yet fixed —
  flagging for whoever picks this up next; the 2026-08-12 live bug this
  note was captured for was fixed via the topic-linkedProblems correction
  above and didn't require resolving this date question, but a future
  false-negative on date-tier matching alone (no linkedProblems hit at any
  level) should look here first.

  **Why this drift happens at all (Nick, 2026-08-12):** it isn't a Medicus
  quirk specifically — it's a structural feature of how UK GP clinical
  systems handle information coded from an incoming document (e.g. a
  hospital discharge letter). The system routinely dates that information
  against when the document was RECEIVED or CODED at the practice, not the
  date the clinical event actually happened. A single real episode can
  therefore carry up to five genuinely different dates, any pair of which
  might end up on the two sides of a duplicate-detection comparison:
  1. the actual event date (e.g. when the patient had the heart attack),
  2. the document date (e.g. when they were discharged after treatment for
     it),
  3. the document SEND date (when the hospital posted/transmitted the
     letter),
  4. the document RECEIPT date (when it reached the practice), and
  5. the CODING date (when practice staff actually entered it against the
     record).

  A problem and its journal duplicate can each have been dated against a
  DIFFERENT one of these five, independently of each other — which is why
  `shared/journal-problem-matching.js`'s fuzzy fallback tolerates a ±30-day
  window (`FUZZY_DATE_TOLERANCE_DAYS`) rather than requiring exact-day
  equality: Nick's judgement call on a window wide enough to reasonably span
  this cross-system drift without being unbounded, not a measured optimum.

- **`created` is a bulk-migration timestamp, NOT clinically meaningful —
  confirmed live 2026-08-14** on a real patient's paediatric surveillance
  history: 8 journal entries spanning 1994-1997 (all descendants of a GP2GP
  import) ALL shared the exact same `created` value
  (`"2026-04-30 14:40:06"`) — the moment that patient's whole record was
  migrated/imported into Medicus, not anything about any individual entry.
  Confirms this field must never be used for duplicate-matching or
  disambiguation (`shared/journal-problem-matching.js`'s
  `applyDateConfirmation` deliberately does not read it — only the entry's
  own `recordDate`). `createdInOriginalSystemDateTime`, by contrast, DID
  vary per entry in this same sample and tracked each entry's own
  `recordDate` closely (`recordDate + " 01:00:00"` in every case observed)
  — genuinely entry-specific, just not an independent signal beyond
  `recordDate` in this particular sample; not yet seen a case where the two
  diverge.

### `topicCode`

The `consultationTopics[]` item itself carries
`topicCode: { topicCode: object }` — an odd doubly-nested key name, not yet
inspected further (unclear if this is a copy-paste field name in the API or
if `topicCode.topicCode` is itself a `{code, displayName}`-style sub-object).

Also from `sentinel.js`'s independent, already-shipped usage (still valid):
- `entry.type` — the coded name (e.g. drug/observation display name)
- `entry.value`
- `entry.observationDate` — `"DD Mon YYYY"` format (only seen for
  `entryType === 'observation'` so far)

---

## Bug found in tooling (not the API) while doing this investigation

`describeShape()` — the structure-only debug helper already shipped in
`duplicate-checker.js` (used by its "Show patient fields" panel) — has a
latent bug: for an array whose first element is an object, the array branch
does `` `Array(${n}) of ${describeShape(obj[0], depth+1)}` ``, and because
template-literal interpolation stringifies its operand, a nested object
result collapses to the string `"[object Object]"` instead of showing its
keys. Only noticed because we reused the same function in a console snippet
and got `"Array(210) of [object Object]"` instead of a real shape. **Not yet
fixed in the shipped file** — holding off per instruction to not touch code
until live testing is complete. A corrected version (return a
`{arrayLength, itemShape}` object instead of interpolating into a string) was
used ad hoc in the console during this session and should be ported back into
`duplicate-checker.js` when work resumes.

---

## Open questions — resolved vs still outstanding (updated after second live probe, 2026-07-02)

**Resolved:**
- ~~Other `item.type` values~~ — all 11 confirmed (see list above).
- ~~`clinicalCodeDescription`/`recordedBy` field names for note entries~~ —
  confirmed correct as the parser assumed.
- ~~`problemCodeDescription` field name~~ — confirmed correct.
- ~~Whether `consultationTopics`/`headings`/`entries` nesting is real~~ —
  confirmed directly (previously only inferred via `sentinel.js`).
- ~~Where `linkedProblems` lives~~ — resolved as "at three levels", see above
  (this also **retracts** my earlier claim in this doc that the parser's
  `topic.linkedProblems` read was a bug — it wasn't wrong, just incomplete).

**Resolved (third probe — full-entry scan, 1104 entries across 210 days, type-only introspection so no PHI logged):**
- ~~`entryType` value for note entries~~ — confirmed literally `"note"`
  (697 occurrences), matching the parser's `entry.entryType === 'note'`
  check exactly.
- ~~`entry.note` nullable-string vs wrapper object~~ — confirmed **plain
  string** when populated (real examples: 72 chars nested, 29 chars flat).
- ~~`recordedByOrganisation` string vs `{id,name}` object~~ — confirmed
  **plain string** when populated (17–21 chars in every example) — the
  parser's Set-based dedup and `esc()` display are safe as written, no bug.
- **`entryType === 'prescription'` and `'investigation-request'` also
  confirmed as real, literal values** (80 and 9 occurrences respectively)
  — the parser's corresponding branches are correct as written.

**New finding — flat top-level items carry a finer-grained `entryType` on
`.data` than the coarse `item.type` wrapper.** Full entryType/subtype tally
across all 1104 entries (flat + nested combined):

```
note: 697, document: 144, observation: 89, prescription: 80,
communication: 23, investigation: 30, prescription-issue: 17,
investigation-request: 9, future-action: 8, outbound-referral: 4,
fit-note: 2, medication-statement-prescribed-elsewhere: 1
```

Note `outbound-referral` here vs `referral` in the top-level `item.type`
list earlier — a flat item with `item.type: "referral"` apparently carries
`data.entryType: "outbound-referral"` as a more specific subtype (same for
`document` → `fit-note`, `prescription` → `prescription-issue`). The parser
currently only branches on the coarse `item.type` for flat items; if
finer-grained matching ever matters, `item.data.entryType` is there to use.

**Resolved since (updated 2026-07-17, reconciling this doc against later commits — it had gone stale):**
- ~~GP2GP `"Problem Info: Problem Notes: ...{Episodicity...}"` text wrapper~~
  — confirmed live 2026-07-08 on a real GP2GP note pair (original
  `note:null` vs reimport copy `note:"{Episodicity...}"` — see
  `record-duplicate-parser.js`'s `normText()` header comment). The null-vs-
  empty-string mistiering bug this surfaced was fixed the same session.
- ~~Why `api-discovery.js`'s automatic capture never fired~~ — root-caused
  and fixed in v3.152.1 (commit `3e729ac`, 2026-07-05): the Resource Timing
  buffer (default 250 entries) was silently dropping entries before the
  Journal tab was ever reached, and a later-fetched UI asset could clobber
  an already-good endpoint guess. Both fixed; `suite.apiDiscoveryLastRun`
  now confirms a reload picked up the fix.
- ~~`"Data Transferred from other system"` `consultationTopics[].title`
  marker's real hit rate~~ — confirmed live 2026-07-17: the developer ran
  the duplicate-checker against real patients with GP2GP transfer history
  and read the `X/Y GP2GP transfer encounter(s) content-confirmed` count
  (`markTransferConfirmation()`) off the analysis panel — no meaningful
  unconfirmed-transfer bucket turned up, the marker's self-validation
  agrees with reality in practice.

- ~~Field names specifically for `prescription`/`investigation-request`
  entries~~ — confirmed live 2026-07-17, see "Live verification" below.
  `productName`/`dosageText`/`issueQuantity`/`investigationRequestItems`/
  `requestedBy` were all correct as guessed; `recordedBy`/
  `recordedByOrganisation` turned out not to exist on prescription entries
  at all (now read as `null` rather than guessed), and
  `requestingOrganisation` turned out to be a real investigation-request
  field that was being discarded as a hardcoded `null` (now read properly).
  Landed in v3.176.1.

**Still outstanding:**
1. **`topicCode: { topicCode: object }`** — odd doubly-nested field on
   `consultationTopics[]` items, not inspected further. Not load-bearing
   (unused by the parser) — low priority.

---

## Live verification — prescription/investigation-request field names (RESOLVED 2026-07-17)

**Trigger (2026-07-17):** the developer observed that prescriptions seem to
duplicate via GP2GP reimport on some patients where investigation results
don't. That partly echoes an existing n=1 finding above (a lab *result*,
`item.type === 'investigation'`, was found NOT to duplicate under the same
reimport event that duplicated notes/prescriptions/documents — see the file
header comment in `engine/record-duplicate-parser.js`) — but that finding is
about `investigation` (lab **results**), not `investigation-request` (a
request/**order**, already flattened and duplicate-checked). The developer's
phrasing could mean either, so rather than guess, the probe below reports
both side by side and the developer can see which bucket is actually
non-empty/relevant for their patient.

This also finally answers outstanding item 1 above (prescription/
investigation-request field names), last resting on the original 2026-07-01
manual sample.

### Main probe — paste into the **Medicus page console** (not the extension console)

On the target patient's Journal tab. Structure only — field names/types,
never clinical values — following `duplicate-checker.js`'s `describeShape()`
convention (lines 385-397: type-only, 3 levels deep, arrays sample only
`[0]`), extended with a small fixed allowlist of genuinely non-clinical
fields (ids/booleans/counts/date-presence) whose actual value is safe and
useful to see. Derives the URL live from the page route (same pattern as
`sentinel.js`'s `getMedicusApiOrigin()` / `api-discovery.js`'s
`currentPatientUuid()`) rather than hardcoding it, and does a credentialed
`fetch()` sharing the page's cookie auth (per CLAUDE.md's queue-chip
debugging section).

```js
// ── PHI-safe journal field-shape probe (paste into the Medicus PAGE console) ──
// Structure/presence only — never logs a clinical-content VALUE. Reuses the
// exact no-values convention as duplicate-checker.js's describeShape()
// (duplicate-checker.js:385-397): field names + types, 3 levels deep, arrays
// inspect only element [0]. Extended here with a small explicit allowlist of
// genuinely non-clinical fields (ids, booleans, counts, dates-as-presence)
// where the actual value is safe and useful to see, per this repo's "never
// guess API field names, capture and replay live" rule.
(async function () {
  'use strict';

  // Same URL-construction pattern as sentinel.js's getMedicusApiOrigin() and
  // api-discovery.js's currentPatientUuid() — derived live from the page
  // route, not hardcoded, per this repo's "never construct Medicus API URLs
  // from scratch" rule.
  const siteCode = location.pathname.split('/').filter(Boolean)[0];
  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const patientId = (location.pathname.match(UUID_RE) || [])[0];
  if (!siteCode || !patientId) {
    console.error('[probe] Not on a patient care-record page — open the patient\'s Journal tab first.');
    return;
  }
  const url = `https://${siteCode}.api.${location.hostname}/clinical/data/patient-journal/overview/${patientId}`;

  // Explicit value-safe allowlist — ids/booleans/counts/dates ONLY, never
  // clinical text (no productName, dosageText, note, title, etc. value ever
  // appears here, even truncated).
  const SAFE_VALUE_FIELDS = new Set([
    'id', 'entryType', 'type',
    'encounterId', 'consultationTopic', // presence/id, not the coded content
    'createdDateTime', 'recordDate', 'authorisedDate', 'startDate', // presence/format, not compared to clinical meaning
    'isMarkedIncorrect', 'isDraft', 'hiddenFromPatientFacingServices',
    'confidentialFromThirdParties', 'isRetrospectivelyAmended',
  ]);

  // describeShape, ported from duplicate-checker.js:385-397 verbatim (same
  // depth limit, same array-of-[0] sampling, same "type only" default) plus
  // the SAFE_VALUE_FIELDS carve-out above.
  function describeShape(obj, depth, keyName) {
    if (depth > 3 || obj === null || obj === undefined) return typeof obj;
    if (Array.isArray(obj)) {
      return { arrayLength: obj.length, itemShape: obj.length ? describeShape(obj[0], depth + 1, keyName) : 'unknown' };
    }
    if (typeof obj === 'object') {
      return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, describeShape(v, depth + 1, k)]));
    }
    // Scalar leaf: only ever return the raw value for an explicitly
    // allowlisted field name. Everything else — including short-looking
    // strings — stays type-only.
    if (keyName && SAFE_VALUE_FIELDS.has(keyName)) return { type: typeof obj, safeValue: obj };
    return typeof obj;
  }

  let payload;
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    payload = await res.json();
  } catch (e) {
    console.error('[probe] Fetch failed:', e.message);
    return;
  }

  const days = payload.patientJournalRecords || [];
  const report = {
    prescription: { flat: [], nested: [] },
    'investigation-request': { flat: [], nested: [] },
    investigation: { flat: [], nested: [] }, // lab RESULTS — separate from investigation-request, see below
  };

  const MAX_SAMPLES_PER_BUCKET = 3; // cap so console output stays scannable

  for (const day of days) {
    for (const item of day.items || []) {
      // Flat top-level items
      if (report[item.type] && report[item.type].flat.length < MAX_SAMPLES_PER_BUCKET) {
        report[item.type].flat.push({
          date: day.title, // day title only — a date bucket, not clinical content
          shape: describeShape(item.data || {}, 1, null),
        });
      }
      // Nested entries inside encounters
      if (item.type === 'encounter') {
        const enc = item.data || {};
        for (const topic of enc.consultationTopics || []) {
          for (const heading of topic.headings || []) {
            for (const entry of heading.entries || []) {
              const bucket = report[entry.entryType];
              if (bucket && bucket.nested.length < MAX_SAMPLES_PER_BUCKET) {
                bucket.nested.push({
                  date: day.title,
                  encounterId: item.id, // id only — safe, structural
                  shape: describeShape(entry, 1, null),
                });
              }
            }
          }
        }
      }
    }
  }

  console.log('[probe] Structure-only journal field report (no clinical values logged).');
  console.log('[probe] "investigation-request" = a REQUEST/ORDER (already handled by the parser).');
  console.log('[probe] "investigation" = a lab RESULT (deliberately NOT flattened — see record-duplicate-parser.js header).');
  console.log('[probe] If your "duplicated prescriptions but not investigation results" observation means');
  console.log('[probe] lab RESULTS specifically, look at report.investigation, not report["investigation-request"].');
  console.log(JSON.stringify(report, null, 2));
  window.__journalFieldProbe = report; // also left on window for further inspection this session
})();
```

### Optional follow-up — compare a known duplicate prescription pair structurally

Run after the main probe, in the same console session, once you've filled in
the two entry ids you can see are duplicates in the Journal UI (ids are not
PHI):

```js
// ── Optional: compare a KNOWN duplicate prescription pair structurally ──
// Fill in the two entry ids you can see are duplicates in the Journal UI
// (e.g. right-click → copy, or read off __journalFieldProbe above), then
// paste this as a follow-up in the same console session.
(function () {
  const ID_A = 'PASTE_FIRST_ENTRY_ID_HERE';
  const ID_B = 'PASTE_SECOND_ENTRY_ID_HERE';
  const report = window.__journalFieldProbe;
  if (!report) { console.error('[probe] Run the main probe first.'); return; }

  function decodeIdTimestamp(id) {
    // Same UUIDv7 decode as record-duplicate-parser.js's decodeIdTimestamp()
    const UUIDV7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (typeof id !== 'string' || !UUIDV7_RE.test(id)) return null;
    const ms = parseInt(id.replace(/-/g, '').slice(0, 12), 16);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  console.log('[probe] id A decodes to (dual-render vs reimport clue — near-identical = same event):', decodeIdTimestamp(ID_A));
  console.log('[probe] id B decodes to:', decodeIdTimestamp(ID_B));
})();
```

A near-identical decoded timestamp between the pair is the existing "same
reimport batch" signal; a gap of real minutes is the existing "genuinely
separate event" signal already used by `hasPrescriptionTimingMismatch()`
(`engine/record-duplicate-parser.js:1256-1264`) — this lets you eyeball which
case your reported pair actually is before any code change is decided.

### Results (captured 2026-07-17)

Real shapes confirmed (structure only, one patient, three sample entries per
bucket where available):

**`prescription`** (flat and nested — same shape both places):
`productName`/`dosageText`/`issueQuantity` confirmed real strings, exactly as
guessed. **No `recordedBy`/`recordedByOrganisation` field exists at all** —
the real field set is `prescriptionTypeLabel`, `isAcutePrescription`,
`numberOfIssues`, `displayStatus`, `requiresAction`, `isDiscontinued`, none
of which are an authorship signal. `linkedProblems` (flat only, confirmed
already) still present and empty in every sample.

**`investigation-request`** (flat and nested): `investigationRequestItems`
(array of strings) and `requestedBy` confirmed real, exactly as guessed.
**`requestingOrganisation` is a real field** the parser was discarding as a
hardcoded `null` — also present: `isAwaitingResults`, `requestedDate`,
`requestedDateIsNotEncounterDate`, `requestedDateIsNotDocumentDate`,
`sortOrder`.

**`investigation`** (lab results, flat only — confirms the header's
"nested: []" expectation, never seen nested in this sample): a much richer,
structurally distinct shape — `reportIdentifier`, `filingStatus`,
`investigationGroups[]` (with `results`/`multilineResults`),
`filingComments[]` (each carrying `createdInOriginalSystemDateTime`,
`recordAuthorIsLocal`, `responsiblePractitioner`/`responsibleOrganisation`),
`investigationDetails[]`. No `recordedBy` here either, but `reportIdentifier`
is a plausible candidate for the stable external key the file header
speculates results carry on ingestion — see the new header-comment bullet in
`engine/record-duplicate-parser.js` for the caveat (structural evidence only,
not a confirmed server-side mechanism).

**Applied in v3.176.1:** `flattenJournal` now passes `null` for prescription
`recordedBy`/`recordedByOrganisation` (confirmed-absent, not guessed) and
reads the real `requestingOrganisation` for investigation-request instead of
discarding it. 6 new tests cover the previously-untested nested prescription/
investigation-request branches plus the `requestingOrganisation` fix — see
CHANGELOG.md v3.176.1.

**Follow-on (2026-07-17, separate investigation):** the `reportIdentifier`
hypothesis above prompted a look at whether prescriptions might be
duplicating somewhere Journal-based detection can't see at all — a
different tab, the Medication history view, backed by a different endpoint
(`clinical/data/medication/medication-regimen/{patientId}`) that represents
medication **regimens/courses**, not individual issue events. **Result:
hypothesis rejected** — the one apparent duplicate found cross-referenced
directly to two real, distinct, already-correctly-recorded journal issue
events (a mid-course reauthorization, not a reimport artifact), and a
manual sweep of several further patients (including suspected
SystemOne/EMIS-sourced records) found no definite journal-level medication
duplicates either. See `docs/learnings-medication-regimen-duplicates.md`
for the full trace — no code changes resulted.
