# Workflow allocation canvas — learnings

Sibling of the lab allocation canvas (`docs/learnings-lab-allocate.md`). Do not
fork-edit the lab overlay into a dual-mode monster.

## What it is

A parallel stage → confirm → bulk-reassign workbench for **inbound documents**
and other **workflow** task-lists. Same W23 write (`LabAllocateCore.createClient`).
The new files never POST.

## Launch gate

Accept:

- `/{site}/tasks/{slug}/task-list` (also `/tasks/data/{slug}/task-list`)
- slug matches `/document|inbound|filing|correspondence|letter|scan/i`, **or**
  `viewContext=workflow` in the query

Reject:

- investigation/result slugs (lab canvas owns those)
- prescription / privacy / eps / officer / cancellation slugs (own bulk widgets)

Document list slug vocabulary is fail-open via `viewContext=workflow`.

## Placement / grouping

- `homeColumnKey` stays assignment-only. Named GP is **never** auto-placement.
- Pool groups by requester if present, else registered GP (`groupTiles` in
  `workflow-allocate-core.js`). Copy says "registered GP" / "grouped as",
  never "who ordered".
- Skip the lab `enrichRequesters` overview walker (wrong fields). Still harvest
  staff UUIDs from a few overviews + the create-task form.

## Copy that must not ship

- No Done / Sent / Filed / Allocated / Submitted / Booked
- Confirm: "changes who the task sits with — it does not file the document"
- Pool title is "Inbound documents" / "Unallocated", never "Investigation reports"

## CSS

`#ms-wac-overlay` / `#ms-wac-launch` share `lab-allocate-canvas.css`. Layout
classes stay `.ms-lac-*`. The launcher is on `<html>`, so its focus ring is a
literal hex, not `var(--accent)`.
