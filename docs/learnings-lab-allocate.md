# Learnings: batch allocation of incoming labs

**Question:** when labs come in for various people, they should carry who
ordered them. Can we automate batch-marking that — a canvas, drag and drop,
move them — instead of allocating one result at a time?

**Answer:** the *read and stage* half is possible now. The *write* half is
not, until one live Reassign is captured. Do not invent a Medicus slug.

Captured from the suite's own confirmed contracts (not a fresh live session):
task-list row keys in `docs/learnings-task-presence.md` (2026-08-04), OIR
label parsing in `engine/outstanding-match.js`, journal `requestedBy` in
`docs/learnings-patient-journal-api.md`, and the filing-screen Next Steps
in `scripts/labfiling-capture.js`. Requester-on-the-report-payload is still
the June 2026 unknown (lab-filing wishlist P9).

---

## What the practice does today

Incoming investigation-report tasks land in a **shared inbox** (a team
assignee such as Results / Triage Doctor — `assignedTo` on the task-list,
confirmed as the routing dimension on request queues). Someone then walks
the pile and sends each result to the clinician who ordered it.

The native path is one-at-a-time:

1. Open the Review Investigation Report task.
2. Read the Outstanding Investigation Requests card. Labels already encode
   the requester: `Full Lipid Profile (Dr David Triska • 09 Jun 2026, 13:31)`.
   `parseRequestLabel` in `engine/outstanding-match.js` splits that into
   `{ name, requester, requestedDate }`.
3. On the same screen, Next Steps includes **Reassign task**. The commit
   button is even labelled "Reassign task" until a next-step radio is
   chosen (`scripts/labfiling-capture.js`).
4. Repeat for the next result.

That is the batch-allocation job: not filing, not ticking OIR rows, just
**routing the task to the person who ordered it**.

Filing (lab-filing profiles, H-049-adjacent) is a later, different write.
P4 in `docs/appraisal/GP-WISHLIST-RESPONSE-labfiling-2026-06-29.md` (bulk
inbox-level *filing*) stays deferred.

---

## What the wire already carries

### Task-list (`GET /tasks/data/{slug}/task-list`)

Confirmed on a *request* queue (`docs/learnings-task-presence.md`). The
results queue is the same AG-Grid family; the canvas treats these fields
as present-or-empty and never requires them:

```
assignedTo, assignedId          ← routing (team or staff)
status, statusValue, statusText ← task status, not "who ordered"
namedGp, namedGpId              ← patient's registered GP
patientName, summary, createdAt, overviewURL, id
actionedBy, actionedById, actionedDateTime
```

`assignedTo` on the captured request was a **team**. Status vocabulary on
that capture was `new-request` / `awaiting-recipient-response` / … — a
workflow state, **not** a clinician name. The user's "status i.e. who
ordered them" is the OIR requester (or a report `requestedBy` if it
exists), not this status field.

Results-queue confirmation of the same keys is what
`scripts/lab-allocate-capture.js` is for. Until that paste-back, we read
them fail-open.

### Overview (`GET /tasks/data/{slug}/overview/{taskUuid}`)

Used today to grade the report (`normaliseInvestigationReport`). The
normaliser keeps analyte values and does **not** look for a requester.
Lab-filing P9 deferred "who requested this test" because the field was
**not confirmed on captured report payloads**.

Journal investigation-**request** entries *do* carry `requestedBy`
(live-confirmed 2026-07-17). That is the order, not the incoming report
task. Matching a report to its request is what OIR does on the review
screen; we do not yet have a queue-level API for that card.

### What we will never treat as "who ordered"

- **`namedGp`** — registered GP. Useful hint on the tile; a false
  auto-allocation if we placed on it.
- **Current `assignedTo`** when it is a team inbox.
- **Task `status`** until a results-queue capture shows it is actually a
  clinician list (the request-queue capture says it is not).

Auto-placement on the canvas is **requester evidence only**. Everything
else stays in Unallocated or the current inbox column.

---

## Can we automate it?

| Step | Automatable now? | How |
|---|---|---|
| List every incoming lab | Yes | Same task-list GET the bulk-action widget already uses |
| See current assignee / status / named GP | Yes, if the results queue matches the confirmed row keys | Fail-open if a field is missing |
| See who ordered | **Sometimes** | Overview walker for `requestedBy` / aliases; OIR-style `Panel (Dr X • date)` strings if they appear in the payload. Not confirmed. |
| Suggest a column | Stage only | Requester groups the reports pool. Drag onto a clinician chip to stage. Named GP is a caption only. |
| Drag / batch-mark on a canvas | Yes | Stage-only, same doctrine as appointment-organise |
| Write the allocation back to Medicus | **No** | Reassign-task endpoint has not been captured. `canWriteAllocations()` is hard-false. |

A working list can be copied off the canvas so the current one-by-one
Medicus reassign is at least ordered by clinician.

---

## What would unlock Finalise

On the live results queue, with a **dummy patient only**:

1. Paste `scripts/lab-allocate-capture.js` into the page console.
2. Confirm the task-list sample: `assignedTo`, `status*`, `namedGp`, and
   whether anything already looks like a requester.
3. Open one overview (the script fetches the first). Check
   `requesterShaped` — if `requestedBy` (or equivalent) is there, the
   canvas can group the reports pool without any new code.
4. In Medicus, reassign that one dummy result the native way. The script
   records the POST/PUT/PATCH path and body keys.
5. Those bytes become the write contract — same discipline as
   `docs/learnings-appointment-organise-api.md`. Then, and only then, a
   confirmed Finalise can be wired, with a CSN W-row and a hazard.

Until that paste-back, the canvas is a **planning board**.

---

## Grouping and absences (v3.242.1 / v3.242.4)

The canvas is one **Investigation reports** pool, grouped by who
requested the test, plus small **clinician chips** on the right. A
requester does not auto-move out of the pool — drag the group onto
their chip. Click a chip to see anything already assigned to them in
Medicus, or staged onto them on this canvas.

Same-requester tiles group under one header and drag as a set. The drag
ghost names who ordered them. That only works when requester evidence
is on the payload — unknown rows stay in their own pile.

Dropping onto a **person** always consults `rota.staff` + `rota.leave`
on this machine (approved and requested leave for today, matching
`name` or `medicusName`). If they are away, or we cannot tell, the drop
does not stage until the warning is acknowledged. An empty rota is
**absence unknown**, not “everyone is in”.

Medicus's own Staff scheduling page is still a discovery gap. Paste
`scripts/staff-scheduling-capture.js` on that screen and click around
so we can see who's in / leave / sessions from the host app, not only
this machine's rota store.

---

## Shipped in this pass

- `shared/lab-allocate-core.js` — route, row, requester walker, pool + chips, draft.
- `content-scripts/lab-allocate-canvas.js` — launch button on a results
  task-list, reports pool, clinician chips, copy working list.
- `scripts/lab-allocate-capture.js` — live Reassign-path scoping.
- `scripts/staff-scheduling-capture.js` — live Staff scheduling scoping.
- `test-lab-allocate-core.js` — placement rules, no-write lock, GET-only client.
