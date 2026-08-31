# Non-routine prescription allocation canvas — learnings

Sibling of the lab allocation canvas (`docs/learnings-lab-allocate.md`) and
the workflow canvas (`docs/learnings-workflow-allocate.md`). Do not
fork-edit either overlay into a dual-mode monster.

## What it is

A stage → confirm → bulk-reassign workbench for **non-routine
prescription-request** task-lists. Same W23 write
(`LabAllocateCore.createClient`). The new files never POST.

## Launch gate

Accept:

- `/{site}/tasks/{slug}/task-list` (also `/tasks/data/{slug}/task-list`)
- slug matches `/non[_-]?routine/` **and** `/prescription/`

Reject:

- `prescription_request_task_routine` (W8 send-to-routine)
- EPS / cancellation slugs (W21)
- investigation/result slugs (lab canvas)
- document / workflow slugs (workflow canvas)

## Placement / grouping

- `homeColumnKey` stays assignment-only. Named GP is **never** auto-placement.
- Pool groups by requester if present, else registered GP.
- Even-split among doctors working today **ignores named GP** and does
  not rebalance already-sitting work. Only the unallocated Non-Routine
  Prescription Requests pile (Unassigned / that inbox name). Requests
  already sitting with a GP stay on that field and are not in the split
  counts. The bare task-list GET returns the whole open list of that
  type — do not even-split the ones that already have a person assignee.

## Even split

- Destinations = people with a session on **today’s appointment book**.
- Cancelled sessions skipped; Medicus/rota absences drop out.
- Nurses / pharmacists / HCAs are excluded when any GP-looking session
  exists; otherwise fall back to everyone in today (so untitled locums
  still get work).
- Applied as the starting board on open (staged, not written).
- Drag a request onto another doctor to move it. **Re-split equally**
  resets to the even split. The control lives outside the unallocated
  pool (that column is a drop target). Click always re-renders with a
  visible note — a failed split must not look like a dead button.
- Review then write is unchanged.

## Write path (same class of bugs as the lab canvas)

Write clicked, Medicus did not move the tasks. Four stacked no-ops:

1. `ensureLauncher` (1.5s) was overwriting `_route.search` with the page
   query. Pre-write re-GET then looked empty → vanished abort, no POST.
   Pin `_route` while the overlay is open. Re-GET via `fetchRxTaskList`
   (bare GET first), not `fetchTaskList(slug, pageSearch)`.
2. POST 404 on `/tasks/{slug}/task-list/bulk-reassign` never tried the
   hyphen/underscore twin. `bulkReassignPaths` is slug, twin, then the
   captured literal `/tasks/task-list/bulk-reassign`.
3. Even-split dests were names without a staff UUID. Empty In-today
   fields have no sitting `assignedId`, so name-match against an empty
   directory failed. Pin `columnStaffIds` from the appointment book
   (or a unique directory match) and pass that into `resolveStaffForColumn`.
4. After Write, `loadBoard()` restaged the even split, so the canvas
   looked unchanged even when Medicus had moved them. Pass
   `{ skipSplit: true }`. `draftSummary` already drops `to === from`;
   even-split must only stage `homeColumnKey === POOL` rows.

After Write the canvas shows Medicus, it does not re-split.

Sequential dest POSTs must not abort the rest of the even-split when
one dest fails — that is “only a couple moved each click”. Continue
the remaining dests; retry 400/409/429/5xx once with a fresh list
token. Task-list GET uses `cache: 'no-store'` so reload is not the
pre-write pile. Reassign does not complete the task, so the open-list
total can stay the same while unallocated drops.

## Copy that must not ship

- No Done / Sent / Filed / Allocated / Submitted / Booked / Issued / Signed
- Confirm: "changes who the task sits with — it does not issue, sign, or
  file the prescription"
- Pool title is "Non-routine prescriptions", never "Investigation reports"

## CSS

`#ms-rxac-overlay` / `#ms-rxac-launch` share `lab-allocate-canvas.css`.
Layout classes stay `.ms-lac-*`. The launcher is on `<html>`, so its
focus ring is a literal hex, not `var(--accent)`.
