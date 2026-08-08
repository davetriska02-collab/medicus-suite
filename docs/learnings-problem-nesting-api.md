# Learnings — problem parent/child ("nesting") API

> Source: live capture 2026-08-03 (`scripts/problem-nesting-capture.js`, run by Dave on a
> test record, care-record Clinical Summary; four writes + before/after read probes).
> This is the contract `content-scripts/problem-nesting.js` is built on. The unlink shape
> (below) was confirmed separately, 2026-08-08, via two real HAR captures Nick recorded
> (`48-removing-parent-problem.har`, `49-removing-child.har` — outside the repo, per the
> usual patient-data handling; not committed).

## The two write endpoints

Medicus exposes problem nesting through two slideover forms, each with its own
prefill GET + submit POST. Both POSTs return `200 {}`.

### 1. Update Parent Problem (child-side — "link this problem to a parent")

**Prefill** — `GET /clinical/data/problem/update-parent-problem/{patientId}/{problemId}`:

```json
{
  "patientId": "…",
  "problemId": "…",
  "parentProblemId": null,
  "linkableProblems": [
    {
      "value": "<problemId>",
      "label": "New patient health check (12 Aug 2014 - 10 Sep 2014)",
      "conceptId": "171324002",
      "hasEnded": true,
      "startDate": "12 Aug 2014",
      "endedDate": "2014-09-10",
      "isMarkedIncorrect": false,
      "hiddenFromPatientFacingServices": false,
      "confidentialFromThirdParties": false
    }
  ]
}
```

- `parentProblemId` is the CURRENT parent (null when unparented).
- `linkableProblems` includes **ended problems too** (the Vue form groups them
  under "Inactive Problems"), each labelled with its date range.

**Write** — `POST /clinical/problem/update-parent-problem`:

```json
{ "patientId": "…", "problemId": "…", "parentProblemId": "…" }
```

Exactly these three fields — NOT a full-record replace (unlike edit-problem).

**Unlink — CONFIRMED live, 2026-08-08 (HAR 48).** Same endpoint, same three
fields, `parentProblemId: null`:

```json
{
  "patientId": "01923625-8042-7071-a04d-1c610de03944",
  "problemId": "019f3280-8440-736e-9286-564a7e1e6279",
  "parentProblemId": null
}
```

→ `200 {}`. Before/after `slideover/overview` GETs on the same problem confirm
it stuck: `parentProblem`/`parentProblemId` go from `"Rheumatoid arthritis"` /
a real uuid to `null`/`null`; every other field (code, onset, significance,
additionalInformation, recordDate, …) unchanged. Exactly the shape
`buildUpdateParentProblemPayload` already builds for CREATING a link — the
same function, the same POST, `parentProblemId` simply passed as `null`
instead of a real id. No new payload builder needed.

**Also confirmed the same session (HAR 49, parent-side): do NOT use this for
unlink either.** `POST /clinical/problem/update-child-problems` with
`childProblemsToAdd: []` removes a child too (confirmed: the parent's only
child was removed, `childProblems` went from `["Methotrexate therapy"]` to
`[]`) — but this is still the same FULL-REPLACE endpoint documented below
(§2): an empty array removes **every** child, not just one. Fine when a
parent has exactly one child (as in this capture); silently wrong the moment
it has more than one. The child-side `update-parent-problem` unlink above has
no such trap — stick with it, per Nick's own read of the two captures.

**Bonus confirmation, same captures: `recordDate` IS present on
`slideover/overview`** (`"recordDate":"2025-01-15"`, `"recordDate":"2024-09-30"`
in the two captures) — resolves the "read speculatively, unconfirmed on this
endpoint" caveat `problem-nesting.js`'s scan carried since the canvas's
onset/record-date-fallback feature (2026-08-08) was first built.

### 2. Update Child Problems (parent-side — "set this problem's children")

**Prefill** — `GET /clinical/data/problem/update-child-problems/{patientId}/{problemId}`:
same shape as above but the option list is named `linkable` and the current
children come back in `childProblems`.

**Write** — `POST /clinical/problem/update-child-problems`:

```json
{ "patientId": "…", "problemId": "…", "childProblemsToAdd": ["<childProblemId>"] }
```

⚠ **`childProblemsToAdd` is a FULL REPLACE of the child set, despite the name.**
The captured Vue source seeds the multi-select with the existing children on
load (`created() { this.childProblemsToAdd = this.childProblems; }`), so what
the form submits is always the complete new child list. Posting a single id to
a parent that already has children would silently UNLINK the others.
`content-scripts/problem-nesting.js` therefore only ever writes through the
parent-side endpoint (#1) — one child, one parent, no replace semantics to get
wrong.

## Where links are readable

- `GET /clinical/data/problem/slideover/overview/{problemId}` → carries
  `parentProblemId` (uuid), `parentProblem` (display label), and
  `childProblems` (array of child display labels). Confirmed to reflect links
  written via both endpoints above. This is the cheapest per-problem read for
  building the record's existing link graph.
- `GET /clinical/data/problem/end-problem/{problemId}` → `activeChildProblems:
[{childProblemId, childProblem, childProblemSignificance, isMarkedAsIncorrect,
hasEnded, childProblems}]` — note the nested `childProblems`, i.e. the
  hierarchy can be more than two levels deep.
- `GET /clinical/data/clinical-summary/summary/{patientId}`'s `problems[]` is
  **flat** — no hierarchy fields at all. The summary page's indenting is
  rendered from other data; don't try to read structure from this list.
- The confirmed `edit-problem` prefill/POST carries **no parent field**
  (`contextId`/`contextType`/`episode` are unrelated — episode is the
  First/Subsequent flag). Re-parenting via edit-problem is not a thing.

## Linked problems — a SEPARATE, non-hierarchical relationship (2026-08-08)

**FULLY CONFIRMED** via four real HAR captures Nick recorded
(`50-linking problems.har`, `51-removing links.har`,
`52-linktomultiple.har`, `53-remove-one-from-multiple.har` — outside the
repo, not committed, same handling as the unlink captures). Medicus models a
genuinely DIFFERENT relationship from parent/child nesting: peer-to-peer
"linked problems" — no hierarchy, no implied ownership, either side can
create/remove the link.

**Prefill** — `GET /clinical/data/problem/update-problem-links/{patientId}/{problemId}`
(found in HAR 52/53 — a third slideover drawer, `update-problem-links.vue`,
alongside the parent/child ones):

```json
{
  "patientId": "…",
  "problemId": "…",
  "linkableProblems": [
    { "value": "<problemId>", "label": "Fracture of patella (Onset unknown)", "conceptId": "51037009", "hasEnded": false, … }
  ],
  "existingLinkedProblems": ["01924220-…", "0193bf5b-…", "01946bb5-…"]
}
```

- `linkableProblems` — same shape as the parent/child prefills' own list
  (every other active/inactive problem, ended ones included).
- **`existingLinkedProblems` is a plain array of problem IDs** (bare strings,
  cross-referenced against `linkableProblems` for display) — this is the
  ids-not-descriptions source the two earlier captures were missing.

**Write — ONE endpoint for both linking and unlinking:**

```
POST /clinical/problem/update-problem-links
{ "patientId": "…", "problemId": "…", "problemIdsToLink": [...] }
→ 200 {}
```

- HAR 50: Hypertension linked to CABG from empty — `problemIdsToLink:
["019349eb-…"]` (CABG's id). `linkedProblems` (overview) goes `[]` →
  `["Coronary artery bypass grafting"]`.
- HAR 51: the SAME link removed from the OTHER side (CABG's own `problemId`,
  not hypertension's) — `problemIdsToLink: []`. `linkedProblems` goes
  `["Hypertension"]` → `[]`.
- **Confirms bidirectional and symmetric**: creating it from one side made
  it readable from the other, and it can be removed from EITHER side.

**⚠ CONFIRMED FULL REPLACE — HAR 53 is conclusive, not inferred.** STEMI
started linked to THREE problems (`existingLinkedProblems` on its own
prefill: Asthma, Hypertension, Hydroxychloroquine therapy — 3 ids). Removing
just Asthma required POSTing `problemIdsToLink: ["0193bf5b-…", "01946bb5-…"]`
— the OTHER TWO ids, not `[]` and not just Asthma's id. After: STEMI's
`linkedProblems` (overview) is `["Hypertension","Hydroxychloroquine
therapy"]` — Hypertension and Hydroxychloroquine correctly preserved, Asthma
correctly gone. Exactly the same trap already documented for
`update-child-problems`' `childProblemsToAdd` above — except here there is
**no alternate single-field endpoint to dodge into** (unlike parent/child,
where `update-parent-problem` sidesteps the trap entirely). Every write to
this relationship — adding a link OR removing one — MUST:

1. Fetch a FRESH `update-problem-links` prefill immediately before writing
   (never reuse a scan-time cache — the set may have changed since);
2. Take `existingLinkedProblems`, add or remove exactly the one id changing;
3. POST the resulting FULL array back.

A widget built on this relationship needs its own read-modify-write commit
path — it cannot reuse `commitParentLink`/`commitUnlink`'s single-field
pattern, which only works because that relationship has a genuinely
different (non-full-replace) endpoint.

## UI route (for reference)

Three server-driven slideover drawers, each with its own prefill GET +
submit POST: `update-parent-problem.vue` ("Update Parent Problem"),
`update-child-problems.vue` ("Update Child Problems") — the parent-side
sibling this codebase deliberately never writes through — and
`update-problem-links.vue` (confirmed 2026-08-08, HAR 52/53), title not yet
seen in a capture but presumably "Update Linked Problems" or similar.
