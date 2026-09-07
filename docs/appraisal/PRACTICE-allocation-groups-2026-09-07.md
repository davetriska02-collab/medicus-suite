# Synthetic appraisal — allocation groups (2026-09-07, post red-team)

Panel is synthetic. Not user research. Not “a GP said”. Second pass after first build: 10 Practice personas on dest-strip fixtures plus 10 coder lenses on the staged tree.

## Verdict

The job is findable: **Share out this inbox…** then **Split equally**. Dest-set chips (In today / named groups / New group) match the product. Write on the request canvas stays fail-closed until a dummy capture. The first red-team left lab dest-set unioning leftover In-today columns, Rx encircle doing the same, and surname+initial collisions first-winning. Those are adopted and fixed on this branch. The floor still hears **In today** as “this morning’s doctors”; that chip name is locked for v1.

## Panel (ease /10)

| Handle | Role | Score | One line |
|---|---|---|---|
| Margaret Aldous | Partner, technophobe | 3 | Launcher is English; “Write not captured” is not |
| Maureen Castle | Secretary, technophobe | 4 | Morning triage chip is English; encircle is invisible |
| Eileen Cobb | Nurse, reluctant | 6 | Away skip is the sentence she needed; first contact is In today (8) |
| Chloe Danvers | Reception, savvy consumer | 5 | Can propose; medical-request write is blocked on purpose |
| Tom Hollis | Salaried GP, pragmatist | 5 | Five clicks; wants names in the boxes after split |
| Sam Okonkwo | Locum | 4 | In today cold-start works; wants Write on medical requests (overruled) |
| Priya Nair | Registrar | 6.5 | Away + two-step write are registrar-grade; All groups is a mystery menu |
| Janet Briggs | Practice manager | 5 | Wants headcount on every chip; 5 vs 47 was a fixture artefact |
| Raj Patel | Pharmacist | 7 | Confirm does not claim issue/sign/file; Rx copy said “requests” |
| Geoff Pellew | Partner tinkerer | 6.5 | Schedule should default the chip when in window (already does if only one) |

## Adopted from the panel

- Keep **Split equally** user-initiated (not on open). Tom asked to auto-split; doctrine stays propose-on-click.
- Keep **Write blocked** on medical/admin until capture. Sam/Maureen cannot finish the write; that is fail-closed, not a bug. **Copy** is adopted: Review then write stays visible, English capture-gap, no “Cannot move these yet. Write not captured…” as the only status.
- **In today** copy is a known misread. Not renamed this cut (tests and dest-strip lock the chip). Group chips now show a headcount so Morning triage (3) sits next to In today (8).
- Header / Share this box copy says **current destinations**, not “those in today”, when a group is selected.
- Rx confirm says **prescriptions**, not requests.
- Empty unallocated after a proposal: those patients are **proposed**, not written.
- Options: last-member × confirms before deleting the group. Schedule persist waits for a complete window.

## Adopted from the coder red team (fixed on this branch)

- Lab dest-set change **replaces** leftover In-today columns (`replaceDestColumns`). Custom dests go through `destsFromSet` (away skip + cap 12).
- Rx encircle / New group / working-day change **replaces** leftover dest columns (chip pick already did).
- `asSplitDests` refuses two people who share surname+initial; canvases do not Split equally onto the survivor.
- `pinDestStaffIds` keeps UUIDs only; a non-UUID inbound id is not name-resolved.
- Pinned dest UUID that disagrees with the sitting assignedId is **dest-mismatch**, not a guess.
- Request people-drag keeps `_personDrag` until drop; `people:` cannot `requestStage`; marquee hit-tests folder heads on the rail, not patient tiles; cap 12 on custom; no Add-team on request.
- Request `createClient.commitAllocations` is wrapped with `canWriteRequestAllocations`. Sitting GET on Write is `requireSitting` fail-closed.
- `_writing` stays true until `loadBoard` finishes.
- Confirm lists refused **patient names**.
- Tests pin team-skip, collisions, leftover-move drop, EPS/privacy list slugs, dest-strip XSS, people: payload, Review then write while gated.

## Overruled / later

- Auto-split on overlay open.
- Enable Write on medical/admin before dummy capture.
- Rename In today to “this morning’s doctors” / “On the book”.
- Unique `ms-ags-*` ids per overlay. One queue page at a time is the live shape.
- Practice-profile publish rewrite (pre-existing share clobber). Not this feature’s write path.
- Workflow fail-open on unknown `viewContext=workflow` slugs (pre-existing).
- Host-local `todayISO` for the appointment book vs Europe/London chip visibility — locked: book is host-local, chips are London.
- Fixture 47-vs-5 / 16/16/15-vs-5 on confirm: harness shots, not the live canvas (tiles live in dest folders after split).

## Reproduce

Branch `allocation-groups-v1`. Tests: `node test-allocation-groups-core.js`, `node test-allocation-dest-strip.js`, `node test-request-allocate-core.js`, `node test-rx-allocate-core.js`, `node test-lab-allocate-core.js`, `node test-write-path-inventory.js`.
