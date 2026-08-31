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
  not rebalance already-sitting work.

## Even split

- Destinations = people with a session on **today’s appointment book**.
- Cancelled sessions skipped; Medicus/rota absences drop out.
- Nurses / pharmacists / HCAs are excluded when any GP-looking session
  exists; otherwise fall back to everyone in today (so untitled locums
  still get work).
- Staging only. Review then write is unchanged.

## Copy that must not ship

- No Done / Sent / Filed / Allocated / Submitted / Booked / Issued / Signed
- Confirm: "changes who the task sits with — it does not issue, sign, or
  file the prescription"
- Pool title is "Non-routine prescriptions", never "Investigation reports"

## CSS

`#ms-rxac-overlay` / `#ms-rxac-launch` share `lab-allocate-canvas.css`.
Layout classes stay `.ms-lac-*`. The launcher is on `<html>`, so its
focus ring is a literal hex, not `var(--accent)`.
