# Allocation groups — synthetic panel (2026-09-08)

**Surface:** dest-set strip + request/lab/Rx canvases + Options (v3.261.4)
**Caveat:** synthetic Practice roster. Not user research. Not “a GP said”.

## Verdict

Not 9/10. Practice-lead score **7.5/10**.

The job is findable: **Plan a share-out of this inbox…** → Working today or Morning triage → **Split equally** → a named proposal that Medicus has not changed. Write is omitted while gated. Dest cards after split are readable columns. Remainder doctor is named. Raj (pharmacist) scored 9 on the no-completion-claim rule.

What holds the score down: Maureen still gets lost between five queue rows and 47 on the canvas, and between Working today (12) and Morning triage (3). Tom wants Write to work (overruled until dummy capture). Cold-start with an empty book is a locum trap even with the new “type a name” line.

## Panel (ease /10)

| Handle | Role | Score | One line |
|---|---|---|---|
| Margaret Aldous | Partner, technophobe | 7 | Default Working today + Split equally; empty-book screen would drop her to 2 |
| Maureen Castle | Secretary, technophobe | 5 | Can pick Morning triage and see 16/16/15 not saved; launcher 5-vs-47 still scares her |
| Eileen Cobb | Nurse | 6 | Labs plan is clear; Away never appeared in the shots |
| Chloe Danvers | Reception | 7 | Did not think she had sent it; Split equally still sounds final |
| Tom Hollis | Salaried GP | 8 | Two clicks to a proposal; Write-off does not slow him |
| Sam Okonkwo | Locum | 7 | Cold-start readable; wants “type your name” next to the empty book |
| Priya Nair | Registrar | 8 | All groups / hours found; wants hours on the chip (now shipped) |
| Janet Briggs | Practice manager | 8 | 11×4 + named remainder; still scrolls to see all three |
| Raj Patel | Pharmacist | 9 | No issue / sign / file / sent / done |
| Geoff Pellew | Partner tinkerer | 7 | Wants Ctrl/Tab on the request canvas like labs |

First-pass scores (2026-09-07) were 3–7. Adopted copy and layout are why the floor moved from 3 to 5.

## Adopted

- Cherry-pick of All groups editor + `refusedPatientsPhrase` (was sitting on `origin/allocation-groups-v1` after merge).
- Working today / Working 8 Sep chip; hours on group chips; ✓ + `aria-pressed`.
- Launcher “Plan a share-out…”. Split equally does not rename to Distribute equally.
- Write control omitted while `REQUEST_WRITE_CAPTURED` is false.
- Dest folder flag follows the dest set (Morning triage, not Working today).
- After-split dest grid grows; review hides the board; remainder doctor named.
- Merge-by-id, overnight windows, empty-id collisions, book-count on Rx, Split vs Top up.

## Overruled

- Enable request Write before dummy capture (Tom). Fail-closed. Reverse: set `REQUEST_WRITE_CAPTURED` after a dummy-patient capture.
- Auto-split on overlay open.
- Rename Working today to “this morning’s doctors”.
- Chloe-style “Preview equal split” (kept Split equally; Tom’s two-click path).

## Addendum — inbox count + dest-set footer (v3.261.6–.7)

Synthetic panel on fresh rig shots (`request-launcher`, `request-group-selected`, `request-after-split-morning`, `request-confirm-morning`). Not user research.

Maureen’s 5-vs-47 scare is addressed on the queue: **47 in this inbox** beside **Draft a split of 47 (nothing is sent)…**. The five visible fixture rows are not the inbox size; the task-list bridge is. Footer and split notes now say **3 destinations for Morning triage** / **onto 3 doctors on Morning triage** when that dest set is on.

| Handle | Score | One line |
|---|---|---|
| Maureen | 8 | Same 47 on the chip and the button; Morning triage already ticked |
| Margaret | 8 | Nothing is sent; Morning triage named after the split |
| Tom | 8 | Two clicks to a proposal; Write-off is the capture gate (overruled) |
| Chloe | 8 | Plan only / Medicus has not changed |
| Janet | 8 | 47 = 16+16+15; dest set named in the footer |

Five-person mean **8.0**. Tom’s ask to enable Write stays overruled. Empty-book cold start still hurts a locum (Sam) and is not in this five.

Feature average with occupied 8.0 is **8.0**.

## Reproduce

`node test-allocation-groups-core.js`, `node test-allocation-dest-strip.js`, `node test-request-allocate-core.js`, `node test-rx-allocate-core.js`, `node test-lab-allocate-core.js`. Rig: `/tmp/the-practice/rig/run.sh` (includes `request-after-split-morning`).
