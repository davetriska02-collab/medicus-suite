# Learnings — problem parent/child ("nesting") API

> Source: live capture 2026-08-03 (`scripts/problem-nesting-capture.js`, run by Dave on a
> test record, care-record Clinical Summary; four writes + before/after read probes).
> This is the contract `content-scripts/problem-nesting.js` is built on.

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
The captured Vue form (`update-parent-problem.vue`) renders the select as
`clearable`, so `parentProblemId: null` is presumably the unlink shape — **not
yet captured live**; treat unlink as unconfirmed until someone captures one.

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

## UI route (for reference)

Both forms are server-driven slideover drawers: the app fetches
`/clinical/ui/problem/update-parent-problem.vue` /
`…/update-child-problems.vue` and binds them to the prefill data. Titles:
"Update Parent Problem" / "Update Child Problems".
