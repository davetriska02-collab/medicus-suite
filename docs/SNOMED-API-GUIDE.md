# SNOMED CT access in Medicus — a reference for building on it elsewhere

This document consolidates everything `medicus-suite` has learned, by live capture against
a real Medicus instance and a real public terminology service, about working with SNOMED CT
codes in Medicus. It is written to be portable: hand it to a Claude (or any developer)
working on a *different* Medicus-integrated project, and they should be able to build a
SNOMED search/hierarchy/retirement feature without re-deriving any of this by trial and
error.

It covers **two entirely separate systems** — keep them distinct, they are not
interchangeable and answer different questions:

| | Medicus's own internal API | Public NHS SNOMED CT termbrowser API |
|---|---|---|
| Auth | Requires an authenticated Medicus session (`credentials: 'include'`) | None — public, no-auth |
| Answers | "What SNOMED concepts/descriptions does Medicus's own index know about, and how are they related by IS-A hierarchy?" | "Is this concept active or retired? If retired, what replaced it?" |
| Scope | Whatever Medicus's own index carries for coded entries (problems confirmed; other entity types not yet checked) | The full published SNOMED CT UK edition |

Everything below was confirmed by live capture (HAR files, direct browser-console `fetch`
probes credentialed as a real clinician, or public no-auth requests) — never guessed. Where
something is *not yet* confirmed, it's flagged as such; don't silently upgrade an unconfirmed
assumption to a fact when reusing this elsewhere.

---

## 1. Medicus's own internal SNOMED search API

### Base URL

Medicus is multi-tenant per practice ("site"). The site id lives in the URL path, and the
API host is a subdomain built from it:

```
https://<siteId>.api.<hostname>
```

e.g. on a page at `https://england.medicus.health/e38a9f/patient/patient/care-record/{patientId}`,
the API base is `https://e38a9f.api.england.medicus.health`. Extract `siteId` from the page's
own URL — don't hardcode a site.

A confirmed regex for the record-page URL shape (matches both the long and short forms
Medicus uses):

```js
const RECORD_URL_RE = /\/([0-9a-f]{4,})\/(?:patient\/patient\/care-record|care-record)\/([0-9a-f-]{36})/i;
const [, siteId, patientId] = location.pathname.match(RECORD_URL_RE);
```

### The search/hierarchy endpoint

```
GET /clinical/gb/snomed/search/description/constrained
      ?constrainingParentConcepts=<comma-joined SCTIDs>
      [&excludeConstrainingConcepts=<comma-joined SCTIDs>]
      [&outputParentConceptIds=1]
      &query=<text OR a bare SCTID OR empty string>
```

Response shape:

```json
{
  "results": [
    {
      "label": "Attention deficit disorder",
      "value": {
        "description": "Attention deficit disorder",
        "conceptId": "35253001",
        "descriptionId": "486108019",
        "parentConceptIds": ["…"]   // only present when outputParentConceptIds=1 was passed
      }
    }
  ]
}
```

One `conceptId` typically has several rows in a result set (its different active synonyms) —
this is genuinely a live search over a description index, not a lookup into a single
canonical string per concept.

### `constrainingParentConcepts` — the six broad "any clinical code" roots

For a general clinical-finding/procedure-type search (what a GP problem list, diagnosis, or
similar coded entry would use), the confirmed working root set is:

```
constrainingParentConcepts=404684003,71388002,243796009,48176007,272379006
&excludeConstrainingConcepts=307824009
```

- `404684003` = Clinical finding, `71388002` = Procedure (confirmed general SNOMED root
  concepts). The other three (`243796009`, `48176007`, `272379006`) were carried over from a
  working capture but not independently re-verified against a SNOMED browser — treat as
  "known to work in combination", not individually confirmed.
- `307824009` ("Administrative statuses (finding)") is explicitly EXCLUDED here as "not a
  real clinical finding" — a properly-scoped subtree of Clinical finding that's
  administrative noise, not a real diagnosis/finding. (Interestingly, this same conceptId is
  used as an *inclusion* root elsewhere in this codebase for a completely different
  purpose — flagging non-problem administrative noise on a problem list. Same concept,
  opposite use depending on what you're trying to do with it.)

**This constraining set is not universal.** It's what works for problem/diagnosis-style
codes. Other SNOMED hierarchies live entirely outside it — see the "other hierarchies" note
below.

### Narrowing to true descendants of ONE concept

Passing a single concept's own ID as `constrainingParentConcepts` scopes results to its
actual descendants (confirmed live, real case: a knee-replacement concept and its
left/right-laterality children):

```
constrainingParentConcepts=<conceptId>&outputParentConceptIds=1&query=<word>
```

Combined with `outputParentConceptIds=1`, each candidate result carries its own
`parentConceptIds` — the full ancestor (IS-A) closure, **denormalized and stored on the
concept itself** by Medicus (not computed by live tree traversal on your side). This is the
mechanism for proving "is X a genuine descendant of Y": **does Y's own conceptId appear in
X's `parentConceptIds`?** If yes, X is a safe, hierarchy-proven specialisation of Y. This is
the load-bearing safety check for any "suggest a more specific code" feature — never assume
descent from a code number or wording alone.

### Three query tricks worth knowing

1. **A bare SCTID as the query text** (`query=<conceptId>`, not free text) reliably returns
   that exact concept's own synonyms, regardless of how they're worded. Useful as a
   supplementary fetch alongside a text-based query, cheap (same endpoint, same cost).

2. **An explicitly empty query** (`query=` — present, but blank) against a
   `constrainingParentConcepts` scoped to one concept's own ID returns that concept's **full
   descendant set directly**, bypassing text matching entirely. **Omitting the `query`
   parameter altogether causes a 500** — it must be present, just empty. This is the
   reliable way to enumerate "everything under X" rather than word-guessing. It is **not
   provably complete** — the response carries no `total`/pagination field, so a very broad
   parent concept could in principle have more descendants than one page returns. Confirmed
   far more complete than guessing individual words, but don't claim exhaustiveness.

3. A **blank-query fetch scoped to a big, non-specific root** (e.g. one of the six broad
   roots directly, not narrowed to a specific concept) caps at roughly 20 results with no
   pagination — unusable for enumerating a big subtree "up front". Checking one specific
   candidate's own conceptId against a root (via `query=<conceptId>`) never hits this cap,
   regardless of how deep or wide the hierarchy is — always prefer per-candidate checks over
   trying to enumerate a whole subtree in advance.

### The query is AND-of-words, not fuzzy — a real, repeatable failure mode

Medicus's search requires **every word** in the query text to appear somewhere in a result's
description (order-independent, but not partial/fuzzy matching). A legacy/migrated
description can contain a word the modern SNOMED wording has dropped entirely — e.g. a
Read-code-migrated "Primary total knee replacement" query returns **zero** results, because
the real modern descendants are worded "Total replacement of left/right knee joint" (no
"Primary" anywhere). One mismatched word zeroes the *entire* query, silently — no error,
just nothing found. This has bitten this codebase more than once and is worth designing
around from the start:

- Never rely on a single combined free-text query built from a whole legacy description.
- Prefer the bare-SCTID trick and the narrowed-descendant blank-query trick (above) as
  supplements — neither depends on wording matching.
- If you must search on multiple extracted keywords (e.g. hint words pulled from free text),
  fire **one query per word**, never one combined multi-word query — concatenate the result
  sets before filtering. A combined query silently zero-results the moment any one word
  doesn't literally appear in the target's own wording.

### Other SNOMED hierarchies exist entirely outside the "six broad roots"

Not every clinically-relevant concept lives under Clinical finding/Procedure/etc. Two
confirmed examples:

- **Body structure** (`123037004`) — anatomical-structure concepts (e.g. "Rotator cuff
  (structure)") are invisible to the six-broad-root search regardless of query wording,
  because they're on a structurally different SNOMED axis. Search for them by narrowing
  `constrainingParentConcepts` to `123037004` (or a suitable subtree of it) directly.
- **Morphologic abnormality** — same story; concepts like "Benign tubular adenoma
  (morphologic abnormality)" sit on yet another axis, connected to the disorder axis (if at
  all) only via an "Associated morphology" *attribute* relationship — never an IS-A path.
  `outputParentConceptIds`'s ancestry check can **never** bridge two different axes; don't
  expect it to, and don't build a feature that assumes it can. If a target concept isn't
  found on the axis you're used to searching, that's the signal to try a different
  `constrainingParentConcepts` root, not that the search is broken.

### There is no "is this concept active/retired" signal anywhere in this API

Checked directly (multiple response shapes probed for a confirmed-retired concept): no field
here exposes SNOMED active/inactive status. `descriptionId: null` on a coded entry
correlates with a *historic display string* needing a cosmetic relabel, but that is a
completely different question from "has this SNOMED concept itself been retired" — don't
conflate the two. For retirement, use the external termbrowser API (§2).

### Reading and writing a coded entry (worked example: a GP "problem")

This is Medicus-entity-specific (confirmed for problems; not yet checked for other coded
entity types — procedures, referrals, journal entries, etc. — re-verify per entity type
before assuming this transfers).

**Read** — `GET /clinical/data/problem/edit-problem/{problemId}`:

```json
{
  "problemCode": { "conceptId": "35253001", "description": "[X]Attention deficit disorder", "descriptionId": null },
  "significance": "major",
  "recordedAtAnotherOrganisation": true,
  "recordedByOrganisation": { "organisationName": "…", "organisationIdentifierType": null, "organisationIdentifierValue": null },
  "recordedByPractitioner": "…",
  "staff": [ /* {value, label} — only relevant when recordedAtAnotherOrganisation=false */ ],
  "additionalInformation": "…"
  /* … every other field the edit form needs */
}
```

**Write** — `POST /clinical/problem/edit-problem/{problemId}` is a **full replace, not a
partial patch**, confirmed via a real captured request: every field from the GET prefill
must be resent unchanged except whichever one you're actually changing. Sending only the
changed field has never been confirmed safe and is likely to blank the others, given the
form's full-object binding.

Two gotchas worth carrying into any similar integration:

1. **Which authorship fields are required depends on `recordedAtAnotherOrganisation`** — if
   `true`, send `recordedByOrganisation` + `recordedByPractitioner`; if `false`, send
   `recordedByStaff` instead. Mirror whichever branch the GET prefill indicates; never assume
   one.
2. **`recordedByOrganisation` can come back from the GET wrapped in a UI-select shape**
   instead of the plain object the POST validates against:
   ```json
   { "label": "Park Road Surgery", "value": { "organisationName": "Park Road Surgery", "organisationIdentifierType": "nhs-england-ods-code", "organisationIdentifierValue": "H84002" } }
   ```
   Round-tripping this wrapper verbatim into the POST 400s: `{"recordedByOrganisation.organisationName": ["This field is missing."], ".label"/".value": ["This field was not expected."]}`.
   Confirmed real cause: a GP2GP-imported record with no defined original author/org. **Both
   the wrapped shape and the plain unwrapped shape are genuinely real** (confirmed on
   different records) — detect which one you have (does `.value` itself look like
   `{organisationName: ...}`?) and unwrap only when needed; don't assume either shape
   universally.

**Safety rule, confirmed and load-bearing across every feature built on this API in this
codebase:** when offering an alternative *description* for a code, only ever offer another
description whose `conceptId` matches the current one — never silently re-code to a
different concept. When offering a genuinely different/more specific concept (a real
re-code), it must be justified by hard evidence: either a confirmed `parentConceptIds`
ancestry proof (§ above), or SNOMED's own `REPLACED BY` pointer (§2), or — as a clearly
lower-confidence, always clinician-reviewed last resort — an exact text match to a different
concept. Never a guessed synonym pairing (see §4).

---

## 2. The public NHS SNOMED CT termbrowser API

A completely separate, no-auth, public service — **not** the official NHS England
Terminology Server FHIR API (`digital.nhs.uk/developer/api-catalogue/terminology-server-fhir`),
which needs a system-to-system account unsuitable for a distributed browser extension. This
is `termbrowser.nhs.uk`'s own backing API, and it needs no authentication at all — it can be
called directly by a developer, an AI agent (`WebFetch`/`curl`), or from inside a live
Medicus page, interchangeably, since it carries zero patient data.

### Base URL and the "release" gotcha

```
https://termbrowser.nhs.uk/sct-browser-api/snomed/{edition}/v{release}/concepts/{conceptId}
```

`edition` is `uk-edition`. **`release` changes roughly twice a year and is not
auto-discoverable via any confirmed endpoint.** A wrong or stale release string doesn't 404
or error — it returns the **literal JSON value `false`**, which silently looks like "concept
not found" if you're not watching for it. To find the current release string: open
`https://termbrowser.nhs.uk/?perspective=full&edition=uk-edition&release=` (blank release)
in a real browser and read the actual API call's `release` param from DevTools' Network tab.
**Store this as data in a small versioned config file** (this codebase uses
`rules/snomed-terminology-server.json` — `{baseUrl, edition, release, lastVerified}`), not a
hardcoded constant, and update it when queries start silently returning `false`. Code calling
this API must fail closed to "unknown, skip" on anything that isn't a well-formed concept
object — including a bare `false` — never guess active/inactive when the check itself
didn't cleanly resolve.

### Concept lookup

```
GET /concepts/{conceptId}
→ { "active": boolean, "memberships": [...], "relationships": [...], "fsn": "...", "conceptId": "...", "defaultTerm": "...", "effectiveTime": "..." }
```

### Determining retirement and replacement

```js
if (response.active === false) {
  // retired — look through response.memberships[] for:

  // the INACTIVATION REASON:
  //   type === 'ATTRIBUTE_VALUE'
  //   && refset.conceptId === '900000000000489007'  // "Concept inactivation indicator attribute value reference set"
  //   -> membership.cidValue = { conceptId, defaultTerm }  is the reason (e.g. "Outdated component")

  // the REPLACEMENT concept, if one exists:
  //   type === 'ASSOCIATION'
  //   && refset.conceptId === '900000000000526001'  // "REPLACED BY association reference set"
  //   -> membership.cidValue = { conceptId, defaultTerm }  is the active successor concept
}
```

**Confusable, explicitly exclude**: retired concepts commonly *also* carry an
`ASSOCIATION`-type membership with `refset.conceptId === '1322291000000109'` ("National
Health Service Care Record Element association reference set") — this is an NHS
classification tag, completely unrelated to retirement/replacement. Only
`900000000000526001` is a genuine replacement pointer.

**Only `REPLACED BY` is implemented/confirmed here.** SNOMED's historical-association family
also includes `SAME AS`, `POSSIBLY EQUIVALENT TO`, `MOVED TO`, `WAS A`, and others, each with
their own refset conceptId — none have been seen in a live capture, so don't hardcode a
guessed ID for them. Extend only after confirming a real example the same way
`900000000000526001` was confirmed (a real retired concept, checked against the termbrowser
UI's own red "inactive" highlighting as ground truth, before trusting the API response).

**A retired concept is not "junk"** — retirement means the *code* needs attention, not that
the underlying clinical data/record is invalid. Don't route a retirement finding into any
kind of "delete/end this" workflow; route it to a "here's a better code" workflow instead.

### Walking the IS-A hierarchy via this API

Read direct IS-A parents from `relationships[]` where `type.conceptId == "116680003"` (the
IS-A relationship type) and `active == true`. The `/parents`, `/ancestors`, and
`/descendants` shortcut endpoints exist in principle but have been found unreliable
(502s/crashes, or a confirmed-missing `/ancestors` 404) — build a closure by walking one hop
at a time via the base `/concepts/{id}` endpoint, memoized, rather than trusting a shortcut.
No rate-limiting trouble observed at roughly 8 concurrent requests.

### Free-text search

```
GET /sct-browser-api/snomed/{edition}/v{release}/descriptions?query=<text>
```

Useful for pure terminology research (e.g. confirming an IS-A chain, or checking whether a
site-specific/narrower concept exists at all) without needing any Medicus session — an AI
agent can call this directly to verify a hierarchy fact before writing code, with zero
patient data involved.

---

## 3. Cross-cutting safety rules

These apply regardless of which of the two APIs above you're using, and were arrived at the
hard way (real near-misses) in this codebase:

- **Never silently re-code to a different SNOMED concept.** Every suggestion category needs
  one of: (a) exact `conceptId` match [safest — a relabel, not a recode], (b) a confirmed
  `parentConceptIds` ancestry proof [a genuine specialisation], (c) SNOMED's own `REPLACED
  BY` pointer [a confirmed successor], or (d) as an explicitly lower-confidence, always
  visually-distinguished-and-clinician-reviewed last resort, an exact text match to a
  different concept. Never a guessed synonym pairing (e.g. hand-mapping "treatment" ~
  "care") — a wrong pairing produces a wrong-but-confident suggestion, which is worse than
  no suggestion at all. If synonym-level matching is ever genuinely wanted, that needs an
  explicit architecture discussion (real semantic-similarity data/NLP), not ad hoc word
  pairs added one at a time.
- **Never auto-apply a code or description change.** Every apply path in this codebase
  requires an explicit clinician click, however confident the underlying match is.
- **Never hardcode a SNOMED metadata ID (a root concept, a refset ID, a release string)
  without a live-confirmed real example.** Store these in a small versioned JSON config/rules
  file with a `notes`/`rationale` field explaining how each one was confirmed, not as bare
  constants buried in code — this keeps the provenance visible and makes the file reviewable
  by someone who isn't a SNOMED expert.
- **A text-based pre-check must never GATE whether a code-based check runs.** If a problem
  is genuinely coded a certain way, the fact that its free-text description doesn't "look
  like" a match must never hide the code-based finding — text can rank/highlight results,
  but the code is authoritative on whether something exists at all.

## 4. Practical debugging technique

- **Capture before assuming, always.** Every mechanism documented above was derived from a
  real HAR capture or a live console `fetch`, never guessed from general SNOMED knowledge
  or documentation. If something "should" work based on this document but doesn't in your
  own Medicus instance/version, capture the real request/response before patching further.
- **Live console scripts must be single-line/minified** when pasted into DevTools — a
  multi-line paste has been observed to throw "invalid or unexpected token" in this exact
  browser/console combination. An IIFE like `(async()=>{...})();` on one line is reliable.
- **`console.table` collapses nested objects to `{…}`.** If a field looks like an opaque
  blob in a table dump, don't assume it's a plain string — re-run with
  `console.log(JSON.stringify(value, null, 2))` to see the real shape before writing any
  logic against it. (This exact mistake cost a debugging round-trip in this codebase: a
  `significance` field was assumed to be a plain string until asked to stringify, and turned
  out to be `{value, label}`.)
- A content script (isolated JS world) **cannot** read a page's own in-memory JS
  state/closures (Vue store, etc.), but it **can** read the same-origin `localStorage`,
  `sessionStorage`, and cookies the page uses — those are shared browser storage, not
  JS-world-scoped. If you need "current user" type context, check those first before
  assuming you need a page-world bridge script.

## 5. Where this lives in `medicus-suite`, if you want the actual code

- `shared/legacy-coded-description.js` — outdated-description detection (bracket/NOS/NEC/H-O
  patterns) and the same-concept-alternatives safety filter. Entity-agnostic by design.
- `shared/coding-specificity.js` — descendant/laterality/cross-concept/hint-expanded
  suggestion logic, all built on the `parentConceptIds` ancestry mechanism above.
- `shared/snomed-retirement.js` — parses a termbrowser concept response into
  `{active, inactivationReason, replacement}`.
- `rules/snomed-terminology-server.json` — the external API's `{baseUrl, edition, release}`
  config, versioned and dated.
- `rules/non-problem-root-codes.json` — a real example of the "roots as data, not hardcoded
  constants" convention for `constrainingParentConcepts`-based flagging.
- `content-scripts/problem-description-cleanup.js` ("Clean up code" widget) — the fullest
  worked example tying all of the above together against a real Medicus entity type
  (problems).
- `docs/learnings-problem-description-cleanup.md` — the original phase-0 HAR capture this
  guide was distilled from, including the exact confirmed request/response bodies.
