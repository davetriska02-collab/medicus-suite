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

## Grouping and absences (v3.242.1 / v3.242.5)

The canvas is one **Investigation reports** pool, grouped by who
requested the test, plus small **clinician chips** on the right. Every
row on this queue starts in the pool — including rows whose
`assignedTo` is the inbox name "Investigation Reports" (that is not a
person). Drag or multi-select onto a chip. Who requested is read from
the task-list `requestedBy` field when present; overview fetch is the
fallback.

Same-requester tiles group under one header and drag as a set. The drag
ghost names who ordered them. That only works when requester evidence
is on the payload — unknown rows stay in their own pile.

**One person, two wire formats (v3.242.8).** The task-list Requested By
column carries `AZADIAN N` (surname then initial); the appointment book
and rota carry `Dr Natalie Azadian`. `personNameKey` canonicalises both
to `azadian|n`, so chips, pool groups, presence lookups and absence
warnings all agree. Until this landed, rota leave and the today-book
match silently failed on every caps-format chip — the Away flag simply
never fired. A bare surname matches any initial; two clinicians sharing
surname AND first initial would merge (documented trade — the canvas is
stage-only and Medicus's Reassign remains the write).

**Workbench UI (v3.242.8, from a three-critic design review).**
Full-bleed, one-line rows under sticky group headers, group select-all,
a selection bar, and click-a-chip-to-stage as the primary (and keyboard)
path — drag is the shortcut, not the requirement. Closing with staged
moves asks first.

Dropping onto a **person** consults, in this order:

1. A Medicus absence record that names them and overlaps today (only
   when we have actually parsed one — see the Staff scheduling capture).
2. This machine’s `rota.staff` + `rota.leave` (approved, then requested).
3. Today’s appointment book (`staffSchedules[].name`) — **In today**.

Not being on today’s book is **not** absence. Many clinicians simply
have no diary. Chips stay quiet unless (1) or (2) fires. The drop
warns only for `away` / `away-pending`, never for “we don’t know”.

---

## Staff scheduling capture (2026-08-25, Witley & Milford)

Pasted from `https://england.medicus.health/560b6c/scheduling/staff-schedule`
(`capturedAt` 2026-08-25T09:12:40Z). This is the live contract. Do not
invent a different slug.

### Confirmed GETs (canvas may call these)

| Path | What we saw |
|---|---|
| `GET /scheduling/data/appointment-book/embedded-overview?date=YYYY-MM-DD&filterByUsualLocation=false` | Today’s book. Root keys include `staffSchedules` (11 that day), `staffOptions` (91), `teamOptions`, `jobRoleOptions`, `loggedInStaffId`, `scheduleDiaryType` = `"diary"`, `scheduleUnavailabilityPeriodType` = `"unavailability-period"`. |
| `GET /scheduling/data/staff-schedule` | Page data for Staff Schedule. **No response body sampled** (XHR, not fetch). Path is real; fields are not. |
| `GET /scheduling/data/staff-absence/absence-overview/{absenceId}` | Opens when an absence block is clicked. IDs seen: `019e8211-…`, `019c65be-…`, `019cd2ef-…`. **No body sampled.** Do not guess field names; do not enumerate IDs we have not seen on a list. |
| `GET /scheduling/data/staff-absence/edit-absence/{absenceId}` | Edit form seed. Same IDs. Not needed for a chip caption. |
| `GET /scheduling/data/staff-unavailability-entry/find-conflicting-assignments-for-staff-between-range?staffIds[]=…&minDateTime=…&maxDateTime=…&ignoredAbsenceIds[]=…` | Conflict check while editing an absence. Not a who’s-away list. |
| `GET /scheduling/data/appointment-service/unfulfilled-staff-requirements-between-range?minDateTime=…&maxDateTime=…` | Unfulfilled requirements strip. Not presence. |

`staffSchedules[n]` shape (from `staffShaped` + `todayBook`):

```
name                              e.g. "Dr Natalie Azadian"
schedule[]                        diaries for that day
  scheduleType                    "diary"
  summary.site.name               "Witley Surgery" / "Milford Surgery"
  summary.service.name            "General Appointments"
  summary.defaultAppointmentType.name
  summary.diaryTimeline[]
  entries[].diaryId
  entries[].diaryEntryType        { value, label, isSlot | isAppointment | isStaffBreakAssignment }
```

That day’s `todayBook.staff` (session = `schedule.length`): Nhs 111,
Dr Natalie Azadian, Subancely Heelas-Ebance, Helen Hughes, Linda Inskip,
Rachel Nilsen, Dr Amy Offer, Dr Dhivyaa Shanker,
Helene Steenfeldt-Kristensen, Samantha Thomason, Dr David Triska.

The week-view landmark blob also contained `1Absence 00:00 - 23:59`, so
all-day absences render on that grid. The grid itself is **not** this GET.

### Writes seen — never call from the canvas

| Method | Path | Why it fired |
|---|---|---|
| `POST /scheduling/staff-absence/change-absence` | Dave edited an absence. Keys: `absenceId`, `startDate`, `startTime`, `endDate`, `endTime`, `absenceDetails`, `coveringAssigneeId`. **A write.** |
| `POST /scheduling/data/staff-schedule/calendar-resources` | Week calendar query. Keys: `minDateTime`, `maxDateTime`, `staffIds`, `teamIds`. Read-shaped POST; still not a GET we will invent usage for. |
| `POST /scheduling/data/staff-unavailability-entry/find-assignments-for-staff-between-range` | Same refresh. Keys: `minDateTime`, `maxDateTime`, `staffIds`. |

The canvas stays GET-only. It must not POST `change-absence`,
`calendar-resources`, or the assignment finder.

### What this does *not* tell us

Absence-overview / edit-absence / `GET staff-schedule` bodies were not
in the dump (the capture script only sampled `fetch` JSON; Vue used
XHR). We therefore **cannot** list every absence by name from this
paste. Next paste, after the XHR sampler is in, should include those
keys. Until then: **In today** from `embedded-overview`; **Away** from
a parsed absence record or this machine’s rota leave list — never from
“not in the 11”.

---

## Shipped in this pass

- `shared/lab-allocate-core.js` — route, row, requester walker, pool + chips,
  today’s-book parser, presence merge, draft.
- `content-scripts/lab-allocate-canvas.js` — launch button on a results
  task-list, reports pool, clinician chips, In today / Away, copy working list.
- `scripts/lab-allocate-capture.js` — live Reassign-path scoping.
- `scripts/staff-scheduling-capture.js` — live Staff scheduling scoping
  (fetch + XHR samples; re-reads embedded-overview and staff-schedule).
- `scripts/lab-requester-capture.js` — live Requested By / report-page scoping.
- `test-lab-allocate-core.js` — placement rules, no-write lock, GET-only client,
  captured today-book shape.
