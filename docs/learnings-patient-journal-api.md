> **Status (2026-07-02):** the fixes this doc identifies have been applied —
> `extractDayGroups()` now reads `patientJournalRecords` first,
> `flattenJournal()` collects `linkedProblems` from all three confirmed
> levels (deduped per-encounter by problem id), flat top-level
> `investigation-request` items are now handled, flat `prescription` items
> now carry `recordedBy`/`recordedByOrganisation`/`linkedProblems` like the
> `note` branch does, and `duplicate-checker.js`'s `describeShape()` bug is
> fixed. Still open: GP2GP-wrapper/transfer-encounter text markers not
> cross-checked live, prescription/investigation-request field names not
> cross-checked live, and the `api-discovery.js` auto-capture mystery (see
> Open Questions below) — none of those blocked landing the confirmed fixes.

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
   empty (`[]`) in every example seen so far, not yet seen populated.
3. `consultationTopics[].headings[].entries[].linkedProblems` (individual
   entry level, i.e. per-note/per-prescription) — also present as a key,
   also only seen empty so far.

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

Also worth noting: the `consultationTopics[]` item itself carries
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

**Still outstanding:**
1. **GP2GP import markers** — the `"Problem Info: Problem Notes:
   ...{Episodicity...}"` text wrapper and `"Data Transferred from other
   system"` `consultationTopics[].title` marker (both load-bearing
   assumptions in `record-duplicate-parser.js`, from the original 2026-07-01
   manual sample) still not cross-checked against this endpoint.
2. **Field names specifically for `prescription`/`investigation-request`
   entries** (`entry.productName`/`dosageText`/`issueQuantity` /
   `entry.investigationRequestItems`/`requestedBy`) — entryType values are
   now confirmed real, but those specific field names within them are still
   unverified guesses from the original manual sample.
3. **Why `content-scripts/api-discovery.js`'s automatic capture never
   fired**, even on a page URL matching its gate regex exactly. Two live
   attempts both showed zero `suite.discoveredAllJournalUrls` entries, forcing
   this whole session to fall back to manual DevTools inspection. Root cause
   not yet diagnosed.
4. **`topicCode: { topicCode: object }`** — odd doubly-nested field on
   `consultationTopics[]` items, not inspected further.
