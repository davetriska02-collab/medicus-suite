# Geoff Mayer (Cranleigh) — allocation canvas tweaks

**Status:** PLAN — red-teamed. **STOP. Awaiting Dave go.** No product code in this run.

**Who:** Geoff Mayer, Cranleigh, Medicus Users Group (2026-09-14). **Not** Geoff Pellew / dream-feature Geoff.

**Dave:** “simple ask about allocations… Just needs tweaks in canvas.” Update: Admin↔Medical type-change may be impossible — investigate honestly, do not fake a half-solution. Knock it out of the park on **meds → named / own GP**. Stretch only if it fits the same thin PR.

---

## The two asks (verbatim intent)

1. **Flagship — meds requests → usual / own GP.** He can allocate incoming work to teams or named individuals. He cannot send medication requests to the patient’s named GP automatically.
2. **Admin ↔ Medical task type.** In incoming triage, if someone submitted Admin but it belongs in Medical Requests (or vice versa), can they change the type without recreating the task?

---

## What already exists (do not rediscover)

Four sibling canvases. Same stage → confirm → W23 bulk-reassign. None POST themselves; `shared/lab-allocate-core.js` `createClient` owns the write.

| Surface | Files | Queue | Named / usual GP today |
|---|---|---|---|
| **Rx (flagship)** | `shared/rx-allocate-core.js`, `content-scripts/rx-allocate-canvas.js` | `prescription_request_task_non_routine` + `_routine` (hyphen twins) | Groups the unallocated pile by usual GP. **Never auto-places.** Split equally / Top up / Distribute equally **ignore** named GP. Write is live (H-068). |
| Request | `shared/request-allocate-core.js`, `content-scripts/request-allocate-canvas.js` | Homepage `medical_patient_request_task` / `admin_patient_request_task` | Same caption-only grouping. **Write fail-closed** (`REQUEST_WRITE_CAPTURED = false`, H-071). |
| Workflow | `shared/workflow-allocate-core.js`, `content-scripts/workflow-allocate-canvas.js` | Documents + `viewContext=workflow` (incoming triage view of the same slugs) | Caption-only. Drag to a person or team. No even-split strip. Write live (H-066). |
| Lab | `shared/lab-allocate-core.js`, `content-scripts/lab-allocate-canvas.js` | Investigation results | Named GP is a caption. **Who ordered** is a different field. Already has **Send N to who ordered** (v3.261.42) — user-initiated, in-day default, not-in opt-in. **This is the template.** |

Task-list rows already carry `namedGp` and `namedGpId` (`docs/learnings-task-presence.md`, `docs/learnings-lab-allocate.md`). `harvestStaffDirectory` already indexes `namedGpId`. Tests pin the safety rule: `homeColumnKey` stays assignment-only; decorate never writes named GP onto `requester` (`test-rx-allocate-core.js`).

Practice pack `suite.ui.allocateCanvases` (Options → Allocate canvases) already arms every canvas. No new module. No new write class.

W23 body is **exactly four keys**: `assigneeId`, `assigneeType`, `taskList`, `taskIds`. The queue **slug is the URL**, not a field.

---

## Ask 2 — Admin ↔ Medical: IMPOSSIBLE / DEFERRED

**Verdict:** Suite cannot change task type without recreating the request. **Do not build anything for this ask.** Not a canvas control, not a “send to the Medical team” label, not a recreate helper.

### Why (honest)

1. **Type is identity, not a field.** Admin and Medical are different slugs (`admin_patient_request_task` vs `medical_patient_request_task`). List GETs are per-slug. A task that was created as Admin is an Admin task for its whole life on the captured API.
2. **W23 cannot change type.** Bulk-reassign posts assignee + token + ids. There is no type key. Posting an Admin task to `/tasks/admin_patient_request_task/task-list/bulk-reassign` and pointing `assigneeId` at the Medical Requests **team** still leaves it as Admin. It will **not** appear on `GET …/medical_patient_request_task/task-list`. Geoff would think it had moved. It has not.
3. **That team-reassign is the half-solution we refuse.** He can already allocate to teams in Medicus and on the workflow/request canvases. Shipping “Move to Medical” as a team dest would lie about the queue. Dave: do not fake it.
4. **Suite cannot create a patient-request of either type.** W4/W5 create **general** tasks (`POST /patient/workflow/general-task/create` in `shared/task-api.js`). There is no captured create-medical-request or create-admin-request.
5. **Recreate is worse than leaving it.** New Medical request + complete/discard the Admin one is two uncaptured writes, a broken patient-facing thread, a possible second notification, and an audit hole (“the thing they submitted vanished”). Forbidden.
6. **No captured Next Steps “change type”.** Write-path inventory, CSN W23, learnings for request/workflow/lab, and `test-write-path-inventory.js` have no type-change endpoint or DOM macro. W8 (send-to-routine) is a **prescription list** macro on the overview, not Admin↔Medical, and it does not share a page with these canvases.

### What to tell Cranleigh (when Dave wants to reply)

Medicus treats Admin and Medical as two different task types. The suite can change **who** a task sits with. It cannot change **what kind of task it is** without deleting it and making a new one, which we will not do. Until Medicus ships a native type-change, the honest path is still: open the request, recreate in the other inbox, complete the original.

### If Medicus later ships a native type-change

New dummy-patient capture, new write id, new plan. Not a follow-up commit on this PR.

---

## Ask 1 — Flagship: Send meds requests to usual GP

Geoff’s “automatically” is **one click for the pile**, then Review then write — not silent placement on canvas open. Silent auto-place on load is a pinned H-068 control. The lab canvas already solved the same verb: **Send N to who ordered**.

Copy that shape onto the **prescription-request canvas** (routine + non-routine). That is the meds-request queue. Homepage medical/admin and workflow stay out of this PR (request Write is gated; different hazard).

### What the user sees

Unallocated Rx pile, already grouped as **Usual GP Dr X**. Today they must drag each group onto a person. After this:

1. A loud offer strip above Split equally (same chrome as lab `.ms-lac-nwd-offer`):
   - **Send 12 to usual GP if they are working Tue 15 Sep?**
   - Preview, always visible, before any click: `12 can go to their usual GP (session that day). 3 stay in the pile — those GPs are not in. 2 have no usual GP on the request. 1 stays — two staff match that name.`
   - Primary button: **Send 12 to usual GP**
   - Opt-in, off by default: **Also send 3 to usual GPs who are not in on Tue 15 Sep**
2. Click stages only. Tiles land on that GP’s folder. Leftovers stay in Unallocated with the same skip reasons.
3. Drag still wins: pull a staged tile onto another GP or an added **team**. Team override and Split equally on the leftover pile keep working.
4. Review then write lists **patient → destination**. Copy stays honest: usual GP **on the record**, not “this GP should issue this”. Confirm already says the write does not issue, sign, or file.
5. Opening the canvas does **not** move anything.

### Resolution rules (core, not UI)

New `planSendToUsualGp(tiles, inDayPeople, opts)` + `applySendToUsualGp` in `shared/rx-allocate-core.js`. Sibling of lab `planSendToRequester` — **do not** reuse that function. Requester on an Rx row is not the usual GP (pharmacy / patient / another clinician).

For each **unallocated** tile only (`isRxUnallocated`; sitting GP work stays put):

| Data | Action |
|---|---|
| `namedGpId` is a unique staff UUID | Prefer it. Pin it on the dest column. Match in-day by that id, else by `sameClinician(namedGp)`. |
| Name only, unique match on the working-day book or staff directory | Use that person. |
| No `namedGp` / no id | **Stay in pile.** `skippedUnknown`. Never guess duty / first dest / requester. |
| Two staff share the name and there is no unique `namedGpId` | **Stay in pile.** `skippedAmbiguous`. Refuse, do not pick. |
| Usual GP not on that day’s book | **Stay in pile** unless the not-in box is ticked. `skippedNotIn`. |
| Name looks like a team inbox | **Stay in pile.** Usual GP is always `assigneeType: "staff"`. |
| Already sitting with a person | Ignore. Not in the send pool. |

`homeColumnKey` / `decorateRxRow` stay assignment-only. The existing “named GP never auto-places” tests must still pass.

### Team override still works

After the usual-GP proposal:

- Add team / dest-set strip / drag-to-team unchanged.
- Split equally / Top up apply to whatever is **still** in Unallocated (no usual GP, not-in, ambiguous).
- Distribute equally still rebalances sitting + unallocated as today’s proposal.
- Confirm writes the **final** dest (the override), not the first usual-GP suggestion.
- Groups never write `assigneeType: "team"` for a usual-GP dest.

### Settings / affordance (thin — no new storage key)

- **Canvas is the setting.** The offer strip is the affordance. Do not add an Options toggle for “auto usual GP” — that would become silent-on-open.
- Practice pack **Allocate canvases** already arms this surface. One-line sub copy tweak only: `Labs, Rx (incl. send to usual GP), requests, appointments`.
- Not-in checkbox is session state on the overlay (`_sendToNotIn`), same as lab. Not a `chrome.storage` key.

### Stretch (same PR only if it stays small)

Fit:

- Per-group **Send this pile to usual GP** on a Usual-GP group header (bulk apply for one named pile, not the whole inbox).
- After stage, proposal line names the dest counts: `12 prescriptions would sit with their usual GP: 4 with Dr A, 3 with Dr B…` then the existing drag hint.
- Pin `namedGpId` into `columnStaffIds` so Write does not name-guess an empty folder.

Do **not** stretch into: request/workflow canvases, auto-run on open, a new Options page, type-change, or a recreate helper.

---

## Red team (folded into the plan above)

| Risk | Why it is real | Control in this plan |
|---|---|---|
| Silent auto-place on open | Entire H-068/H-064 family; tests pin it; locum-registered / left-practice / on-leave usual GP | User-initiated only. `homeColumnKey` unchanged. |
| Wrong GP (false positive) | Surname+initial collision; requester mistaken for usual GP; `rxGroupName` already prefers requester for **grouping** | Send path uses `namedGp` / `namedGpId` only. Ambiguous name without id → skip. |
| Missing usual GP | New patients, temp residents, empty field | Stay in pile; preview names the count; Split equally still available. |
| Away / not-in usual GP | Night-before allocation; partner on leave | Default leave in pile. Opt-in not-in, off. Working-day control already on this canvas. |
| Team dest pretending to be usual GP | Cranleigh allocate-to-teams habit | Usual-GP dest is staff-only. Teams remain a later drag override. |
| “Automatically” misread as written | Banned verbs; Geoff may think the button files it | Offer + post-click: “Proposal only”. Confirm list. No Allocate / Done / Sent / Filed. |
| Request-canvas scope creep | Same caption exists there; Write is gated | Out of this PR. Rx write is the one that can land in Cranleigh this week. |
| Admin→Medical half-fix | Assigning to the Medical team looks like a type change | Deferred. Not in this PR. |
| Recreate helper | Uncaptured writes + broken thread | Forbidden. |

---

## Slice order (after Dave go — one PR)

0. **Dave go** on this plan. Until then, nothing below is built.
1. **Pure core + tests.** `planSendToUsualGp` / `applySendToUsualGp` in `shared/rx-allocate-core.js`. Pins in `test-rx-allocate-core.js`: in-day send, not-in skip/opt-in, missing name, ambiguous name, namedGpId preferred, requester ignored, sitting work ignored, `homeColumnKey` still pool, no completion verbs in new copy helpers.
2. **Rx canvas offer.** `content-scripts/rx-allocate-canvas.js`: offer strip, preview counts, primary button, not-in checkbox, bind like lab `#ms-lac-send-who`. Source-grep pins: still “never auto-placement”; new ids; no Allocate/Done/Sent.
3. **Stretch if slice 2 is clean.** Per-group send; dest-count proposal phrase; pin `namedGpId` on dest columns.
4. **Docs on the same commit as the feature.** `docs/learnings-rx-allocate.md`, H-068 addendum (usual-GP send is staging, same write, still not auto-place), CSN item 50 sentence, `CHANGELOG.md`, `docs/feature-list.md`, Options sub-line, `manifest.json` patch bump.

Do not fork the lab overlay into a dual-mode monster. Do not call `planSendToRequester` from the Rx canvas.

---

## Files (implementation, not this plan commit)

| File | Change |
|---|---|
| `shared/rx-allocate-core.js` | `planSendToUsualGp`, `applySendToUsualGp`, export |
| `content-scripts/rx-allocate-canvas.js` | Offer strip + handlers; optional per-group button |
| `test-rx-allocate-core.js` | Behaviour + source-grep pins |
| `docs/learnings-rx-allocate.md` | Placement: send-to-usual-GP is staging; still never auto-place |
| `docs/HAZARD-LOG.md` | H-068 control addendum |
| `docs/CLINICAL-SAFETY-NOTICE.md` | Item 50 |
| `CHANGELOG.md` / `docs/feature-list.md` / `manifest.json` | Patch + entry |
| `options/options.html` | Allocate canvases sub-line only |

No new IO key. No `defaults.json` bump. No request/workflow/lab edits unless a shared helper is extracted and lab tests stay green.

---

## Success (Dave can tick these)

- [ ] Opening the Rx canvas does not move a single tile onto a usual GP.
- [ ] Offer strip names **will-send / not-in / no-usual-GP / ambiguous** before click.
- [ ] One click stages only unallocated rows that resolve to a unique staff usual GP.
- [ ] Missing or colliding usual GP stay in Unallocated; Split equally still works on that leftover.
- [ ] Not-in usual GPs stay in the pile unless the box is ticked.
- [ ] User can drag a staged tile onto a team or another person; confirm shows that dest.
- [ ] Write is still W23 four keys; usual-GP dest is `assigneeType: "staff"`; unique UUID or refuse.
- [ ] Copy never claims Done / Sent / Allocated / Submitted / Booked / Issued / Signed.
- [ ] Existing “named GP never auto-places” tests still pass.
- [ ] Ask 2 is **absent** from the product diff. Plan section above is the record.

---

## STOP

Awaiting **Dave go** to build slice 1. This document is the plan, not the feature. Reply to Mayer when you want — suggested line is in Ask 2.
