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
- `prescription_request_task_non_routine` **and** `prescription_request_task_routine`
  (hyphen twins too)

The live routine inbox (Witley 2026-08-31) is
`?statuses[]=pending-review&viewContext=homepage&masterAssignee=<inbox uuid>`.
That UUID **is** the routine box. Keep it on the GET. Rows from that
GET are the pile to allocate even when `assignedTo` is a person name
(they sit with the box, not a working-today GP). Stamp them
`rxInboxPile` / Unassigned so they appear in the unallocated list.
Bare GET of the slug returns already-allocated GP work as well.

Reject:

- EPS / cancellation slugs (W21)
- investigation/result slugs (lab canvas)
- document / workflow slugs (workflow canvas)

W8 (send-to-routine) is the overview DOM macro. This canvas is the
task-list bulk-reassign. They do not share a page.

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
- Not applied on open. Unallocated is the large pane; doctors sit in
  a sidebar. User clicks **Split equally** to propose. When the pile
  is empty, Unallocated greens out and doctors lay out as a grid.
- **Share this box** on a doctor folder even-splits *that folder
  only* among doctors in today (`planEvenSplit` `anyTile`). It is
  not the unallocated pile. Holiday/AWAY leftover is the point.
  Destinations skip the source and anyone away. Nothing in the box,
  or nobody in today, disables the control rather than hiding it
  when they still have tiles.
- After Split equally the board is explicitly a **proposal**: banner
  plus popping dest counts. **Re-split equally** is not offered —
  staged tiles have left the pile. Prompt: drag a patient from one
  doctor onto another. Review is a docked card in the panel, not a
  scrim over the folders. The prominent control is **Review then
  write N…**; confirm is **Write to Medicus**.
- **Top up empty boxes** (`planTopUp`) gives remaining unallocated
  work to dests with the fewest current tiles, so a trickle later in
  the day does not land on the first dests. **Distribute equally**
  (`planLevel`) re-deals in-today sitting + unallocated so totals
  differ by at most one. Away boxes are left unless Share this box.
  Both name the destinations (`To: Dr A, Dr B, and Duty GP`). Hover
  `title`s explain each control. Medicus teams from
  `harvestTeamDirectory` can be added (`addTeamColumn`) and join
  the dest list. The unallocated count is the visible pile;
  `markInboxRows` must not restamp a row whose `assignedId` is
  already a person UUID.
- Drag a request onto another doctor to move it. The split / top-up /
  level controls live outside the unallocated pool (that column is a
  drop target). Click always re-renders with a visible note — a
  failed split must not look like a dead button.

## Write path (same class of bugs as the lab canvas)

Write clicked, Medicus did not move the tasks. Four stacked no-ops:

1. `ensureLauncher` (1.5s) was overwriting `_route.search` with the page
   query. Pre-write re-GET then looked empty → vanished abort, no POST.
   Pin `_route` while the overlay is open. Re-GET via
   `fetchRxMergedTaskList` (inbox GET + bare GET, same merge as
   loadBoard). Inbox-only re-GET makes Distribute equally look like
   vanished tasks — sitting GP work is not on the masterAssignee
   filter. Do not `fetchTaskList(slug, pageSearch)` alone.
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
