# Patient-request allocation canvas - learnings

Sibling of the Rx allocation canvas (`docs/learnings-rx-allocate.md`). Do not
fork-edit the Rx overlay into a dual-mode monster.

## What it is

A stage → confirm → bulk-reassign workbench for **homepage medical and
admin patient-request** task-lists. Same W23 write
(`LabAllocateCore.createClient`). The new files never POST.

## Launch gate

Accept:

- `/{site}/tasks/{slug}/task-list` (also `/tasks/data/{slug}/task-list`)
- `medical_patient_request_task` **and** `admin_patient_request_task`
  (hyphen twins too)
- homepage view. Keep `masterAssignee` on the GET. Rows from that GET
  are the pile to share out even when `assignedTo` is a person name
  (they sit with the box, not a working-today GP). Stamp them
  `requestInboxPile` / Unassigned so they appear in the unallocated
  list. Bare GET of the slug returns already-sitting GP work as well.

Reject:

- `viewContext=workflow` (workflow canvas owns that view of the same
  slugs)
- investigation/result slugs (lab canvas)
- prescription / Rx slugs (rx canvas)
- EPS / cancellation slugs

## Placement / grouping

- `homeColumnKey` stays assignment-only. Named GP is **never**
  auto-placement. It is a grouping caption only (`Usual GP …`).
- Pool groups by requester if present, else registered GP.
- Dest-set groups are **people**, not Medicus team inboxes. Split /
  top-up / level stage onto the current dest set (Working today, a named
  group, or a custom encircle). Away members are skipped.

## Even split

- Default dest set is Working today (people with a session on the
  appointment book for the working day), unless a scheduled group is
  in window. Last-used dest set is stored per surface
  (`lastUsedBySurface.request`). A scheduled auto-pick is named in one
  reversible sentence under the strip ("Using Morning triage (3)
  because it is 09:30 on a Monday. Or pick Working today (12).").
- Overnight group hours wrap past midnight (end at or before start;
  in-window is minutes >= start or minutes < end, carrying into the
  next morning).
- Practice-profile merge is a union by group `id`. Incoming wins on
  the same id only when its `updatedAt` is newer; local-only ids are
  never dropped. Replace still swaps the whole set.
- Split equally / Top up / Distribute equally are local staging.
  They do not write. After Split equally the proposal line names the
  even-split numbers a manager can check ("47 requests would sit with
  12 people: 11 with 4, 1 with 3.") then the drag hint.
- Share this box on a person folder even-splits _that folder only_
  among the current dest set.

## Write path

W23 four-key bulk-reassign (`assigneeId`, `assigneeType`, `taskList`,
`taskIds`) via `LabAllocateCore.createClient`. **Fail closed** until a
dummy-patient capture of bulk-reassign on these slugs is recorded
here. `REQUEST_WRITE_CAPTURED=false`. The canvas calls
`canWriteRequestAllocations` before `requestWrite` and does not call
`commitAllocations` while that gate fails. Staging and split still
work. Confirm lists named patient → person. Keep planning vs Write to
Medicus (Write is blocked while uncaptured). While Write is gated the
primary control is **Review plan (N)**, not Review then write. The
review headline is "This is a plan on this canvas only. Medicus has
not changed." then "To move these today, assign them in Medicus.
Writing from this canvas is switched off for this queue until it has
been checked on a test patient." The disabled button is "Write to
Medicus (not yet available for this queue)".

Re-GET the vanish-check via `fetchRequestMergedTaskList` (inbox GET +
bare GET). Pin `_route` while the overlay is open.

## Copy that must not ship

- No Done / Sent / Filed / Allocated / Submitted / Replied
- Dest chip: **Working today (N)**; when the working day is not
  calendar today, **Working 8 Sep (N)** (`d MMM`). Element id stays
  `#ms-ags-in-today`.
- Confirm: "changes who the task sits with - it does not complete,
  file, or reply to the request"
- Pool titles are "Medical requests" / "Admin requests"

## CSS

`#ms-qac-overlay` / `#ms-qac-launch` share `lab-allocate-canvas.css`.
Layout classes stay `.ms-lac-*` / `.ms-rxac-*`. Dest-set strip is
`.ms-ags-*`. The launcher is on `<html>`, so its focus ring is a
literal hex, not `var(--accent)`.

After Split equally the dest grid (`.ms-rxac-board-clear .ms-rxac-folders`)
must size cards to their contents (`height: auto; max-height: none`).
`max-height: 100%` plus `min-height: 0` on dest folders crushes the
folder-head into the patient list. Folder-head is `flex-shrink: 0`.
Dest minmax is 280px so name + proposed count + Share this box fit.
An empty leftover team folder (the queue inbox, 0 tiles) is omitted
from that dest grid; a team that still has sitting tiles stays.
While Review is open the panel gets `ms-rxac-reviewing` and the board
is hidden so the page is the proposal list + Keep planning + Write.
