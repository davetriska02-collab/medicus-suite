# Spike — bulk-moving registered patients to another list

Status: **investigation only — no product write path added.** Capture tooling
lives in `scripts/patient-list-move-capture.js` (not shipped). Nothing here
authorises a new W-id.

**The question:** can the suite — or Medicus itself — move a _batch_ of
registered patients from one usual-GP list to another, the way a practice
does when a partner leaves or lists are rebalanced?

**Product direction (2026-08-27):** if we build, it is a **canvas** (same
family as lab / workflow allocate and appointment organise). The pool is
not given — you have to **define which patients**, and that definition is
a **search** (plus the listing's Usual GP filter). See [Canvas +
search-defined cohort](#canvas--search-defined-cohort).

---

## VERDICT (desk research)

**Read the register, filtered by usual GP: already reachable.** Duplicate
Checker paginates the Patient Registration listing API once
`api-discovery.js` has captured the URL. Medicus's own listing page filters
by Usual GP and shows a match count.

**Change usual GP for one patient: documented native UI, write contract
unknown.** Administrative Record → Registration tab. Editable field. The
suite has never captured that POST/PUT.

**Bulk-move a chosen set of patients: not documented as a listing or report
action.** Report Builder bulk actions are code / recall / immunisation /
communication only. The only documented _bulk_ usual-GP write is the
prompt when **archiving a Doctor who is anyone's usual GP** — you must pick
a replacement before Archive enables. That is "move this GP's whole list
because they are leaving", not "move these 40 patients onto Dr Y".

**A suite write is therefore gated on a live capture.** Do not invent a
slug. The next step is the capture script on a **test patient** (single
change) and, only if needed, a cancelled staff-archive prompt (no archive).

The spike may fail: Medicus may only expose the one-at-a-time Registration
save plus the archive-time whole-list reassign. That is still a useful
answer.

---

## What "list" means here

In UK GP language a GP's **list** is the set of patients who have that
clinician as usual / named GP. Medicus help uses **Usual GP** on the
patient list and Registration tab, and **named GP** on task rows, automated
registration, and FP34D grouping. The suite already treats those as the
same idea (`namedGP` on the banner, `namedGp` / `namedGpId` on task-list
rows).

This spike is **not** about:

- **Appointment diaries** ("move to another list" in
  `docs/learnings-appointment-organise-api.md`) — already shipped as
  cross-list appointment moves.
- **Task-list bulk-reassign** (`POST /tasks/{slug}/task-list/bulk-reassign`,
  W23) — that moves _work_, not registration.
- **Deduction / transfer-out** — leaving the practice, not changing usual
  GP inside it.

---

## What Medicus documents (help centre, 2026-08-27)

Fetched from the public Zendesk Help Centre API (not guessed). Articles:

| Article                                                                                                                                                                                                                                                                               | Id                              | What it settles                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Viewing the Patient List](https://medicus-health.zendesk.com/hc/en-gb/articles/16626072626717-Viewing-the-Patient-List)                                                                                                                                                              | 16626072626717                  | Patient Registration module. Default rows: active permanent / temporary / immediately-necessary. Columns: Patient, NHS Number, **Usual GP**, Registration Status. Filters: registration status, **Usual GP**. Inactive filtered out by default. Filtered view shows **"x patients selected"**. Row click opens the care record. **No bulk-change action is described.** |
| [How to View and Update a Patient's Registration Details](https://medicus-health.zendesk.com/hc/en-gb/articles/16746495260701-How-to-View-and-Update-a-Patient-s-Registration-Details)                                                                                                | 16746495260701                  | Administrative Record → Registration tab. **Usual GP is writable.** Also writable: preferred location, responsible health authority, care-home / school flags, dispensing-doctor nomination, FP69 removal, manual deduction. Read-only: registration type, dates, PCSE status, PDS-linked NHS number.                                                                   |
| [Managing Staff Members](https://medicus-health.zendesk.com/hc/en-gb/articles/35184717089693-Managing-Staff-Members)                                                                                                                                                                  | 35184717089693                  | **The documented bulk path.** Archiving a Doctor who is usual GP for any patients: prompt to pick a replacement; Archive stays disabled until that reassign happens. Unarchive does **not** put the list back.                                                                                                                                                          |
| [Automated registrations](https://medicus-health.zendesk.com/hc/en-gb/articles/38284967084957-Automated-registrations)                                                                                                                                                                | 38284967084957                  | On auto-accept, Medicus _sets_ named GP: family contact's GP, else same-address GP, else active GMC-holding clinician with the fewest named patients.                                                                                                                                                                                                                   |
| [Managing Staff Job Roles](https://medicus-health.zendesk.com/hc/en-gb/articles/37907854871325-Managing-Staff-Job-Roles-in-Medicus)                                                                                                                                                   | 37907854871325                  | "Exclude from auto registration GP allocation" keeps trainees/locums out of that fewest-patients pick. **Does not affect a manual usual-GP change.**                                                                                                                                                                                                                    |
| [Custom Report Builder](https://medicus-health.zendesk.com/hc/en-gb/articles/37814498847389-Custom-Report-Builder-for-Advanced-Reports) / [Bulk Adding a Code…](https://medicus-health.zendesk.com/hc/en-gb/articles/37943416612893-Bulk-Adding-a-Code-Future-Action-or-Immunisation) | 37814498847389 / 37943416612893 | Report-result bulk actions: add SNOMED code, future action/recall, immunisation, send communication. **Usual GP is not in that menu.**                                                                                                                                                                                                                                  |

"x patients selected" on the listing page is almost certainly the filter
match count (how many rows the grid is showing), not a multi-select
toolbar. Live capture must confirm — if there _is_ a checkbox column and a
Change usual GP action, that is the missing native bulk path.

---

## What the suite already knows (verified in this repo)

### Reading the register

- Page: `https://england.medicus.health/{siteId}/patient/listing`
  (`duplicate-checker.js`, `content-scripts/api-discovery.js`).
- Discovery: `api-discovery.js` stores the listing-like `/patient/` call
  the page itself fires (`suite.discoveredPatientListUrl`). Replay that
  URL; do not construct one.
- Registration-type filter already used (Regular / Temporary / Immediately
  Necessary UUIDs in `duplicate-checker.js` `REG_TYPE_IDS`).
- Pagination: AG-Grid `startRow` / `endRow`.
- Row shape is **not pinned**. Duplicate Checker is tolerant
  (`patients` / `results` / `data`; name/NHS/DOB/uuid aliases) and dumps
  the first-row shape to `suite.patientFieldDebug`. Whether listing rows
  carry `usualGp` / `namedGp` / a staff UUID is **unknown here**.
- Eligibility filter today is `registrationStatus` text (drops deducted /
  deceased / transferred). It does not filter by usual GP.

### Reading usual / named GP (per patient or per task)

| Source                                            | Field                      | Used for                                                        |
| ------------------------------------------------- | -------------------------- | --------------------------------------------------------------- |
| `GET /patient/data/patient/patient-banner/{uuid}` | `namedGP` (display string) | Record tab, SMR pack (`engine/normalisers.js`)                  |
| Task-list rows                                    | `namedGp`, `namedGpId`     | Lab / workflow allocate **caption only** — never auto-placement |

Nothing in the suite **writes** usual GP. Banner `namedGP` is a string;
task rows sometimes have a staff UUID. A write will almost certainly need
that UUID, not the display name.

### Neighbouring write paths — do not reuse

| Path                                             | Why it is the wrong tool                                    |
| ------------------------------------------------ | ----------------------------------------------------------- |
| W23 `POST /tasks/{slug}/task-list/bulk-reassign` | Moves a _task_ assignee. Named GP is grouping-only (H-066). |
| Appointment organise cross-list move             | Moves a _booking_ between diaries.                          |
| Contacts / problem / duplicate tidy              | Different patient-admin writes; none touch usual GP.        |

Inventing a `/patient/.../bulk-reassign` from the task shape would be a
clinical-safety failure: it would either 404 or write the wrong thing.

---

## Safety (why this is not "another allocate canvas")

Changing usual GP changes **who the patient is registered with** inside
the practice. That is continuity, QOF grouping (FP34D already groups by
named GP), automated-registration family matching, and the clinician the
patient believes is "theirs". It is not inbox routing.

If a suite write is ever built it is a **new W-id**, user-initiated,
named-patient confirm, stop-on-first-failure, re-GET before commit, and
it must call **exactly** the captured Medicus body. Test-patient first.
Never archive a real GP to discover the bulk prompt.

Hazard class if it ships: wrong patient moved, or moved to the wrong GP,
or a whole list moved when a subset was intended. Residual risk will be
at least in the same band as H-062 / H-066 (wrong identity on a write).

---

## Make-or-break questions (live Medicus only)

These cannot be answered from the repo or the help centre.

1. **Listing row keys.** After opening Patient Registration → patient
   list, what keys does the listing GET return? Specifically: usual/named
   GP display name, staff UUID, registration status, patient UUID.
2. **Listing filter params.** Filtering the grid by Usual GP — which query
   params appear (`usualGpId[]`, `namedGpId[]`, something else)? Replay
   those; do not guess names.
3. **"x patients selected".** Is that a filter count, or a multi-select
   with a bulk action? If there is a checkbox + Change usual GP / Move to
   list control, that is the native subset-bulk path. Capture it.
4. **Single-patient write.** On a **test patient**, Administrative Record
   → Registration → change Usual GP → Save. Method, path, body keys and
   value _types_ (not names/NHS). Is it one patient id + one staff id?
   Does it touch preferred location or anything else if those fields are
   left alone?
5. **Idempotency / audit.** Does a no-op save (same GP) still POST? Does
   the journal or an audit event record the change?
6. **Staff-archive prompt (observe only).** Open Staff Administration → a
   Doctor who has named patients → Archive, **do not confirm**. Capture
   the GET that lists their patients and the shape of the replacement
   dropdown. Cancel. Do **not** archive anyone for this spike.
7. **Report Builder.** Open "All current patients" (or a usual-GP-filtered
   patient report). Does Bulk actions grow a Change usual GP item that
   help omitted? If yes, capture that write — it may be the subset-bulk
   we want.

If (3) and (7) are both empty, subset-bulk is **not** a native Medicus
action. The honest product options then are: drive the one-patient
Registration save in a tightly gated loop, or tell the practice to use
the archive-time whole-list reassign (or Medicus support) for a partner
leaving.

---

## How to capture

`scripts/patient-list-move-capture.js` — paste into the **page** console
(MAIN world), same doctrine as `scripts/booking-flow-capture.js` /
`scripts/lab-allocate-capture.js`. Observation only. It never POSTs.
Redacts patient identifiers; keeps staff names (the destination _is_ the
finding). Do not commit the JSON (patient-data CI guard).

```
1. Open Patient Registration → patient list. Paste the script. "[listcap] armed".
2. chList.probe()          ← listing URL, row keys, filter/bulk DOM.
3. Filter by Usual GP.     chList.mark('filtered by usual GP')
4. chList.ui()             ← buttons / "patients selected" / checkboxes.
5. TEST PATIENT ONLY: Administrative Record → Registration → change Usual GP.
   chList.mark('about to save usual GP') … Save … chList.writes()
6. Optional: staff Archive prompt, then Cancel. chList.mark('archive prompt')
7. Optional: Report Builder patient report → Bulk actions menu. chList.ui()
8. Patient Finder: type a TEST name. chList.mark('finder search') then
   chList.finder(). Open Advanced options, note whether Usual GP is a
   field, Cancel.
9. chList.summary() / chList.save()  → send the JSON back. chList.stop()
```

Use a dummy / test patient for step 5. Put the usual GP **back** after
the capture if you changed a real test record.

---

## Canvas + search-defined cohort

The other canvases start with a pool the page already has: today's book,
the results queue, this patient's contacts. A list-move canvas does
**not**. Opening it onto "every registered patient" would dump 8–12k
tiles. So the first act is **define who**, and the tool for that is
search.

```
┌─────────────────────────────────────────────────────────────┐
│ Define who                                                  │
│   Search  [ name / NHS / DOB              ]  Find           │
│   or source list: Usual GP [ Dr X ▾ ]                       │
│   12 in the pool · 0 staged                                 │
├────────────────────────────┬────────────────────────────────┤
│ POOL                       │ Move onto                      │
│ SMITH, Ann  · now Dr X     │  [ Dr Y ]  [ Dr Z ]            │
│ SMITH, Ben  · now Dr X     │  click a chip or drag          │
└────────────────────────────┴────────────────────────────────┘
```

Nothing is pre-staged. Closing with staged moves asks first. Confirm
names every patient, current GP → new GP. Copy does not say Moved /
Reassigned / Done until Medicus accepts. Destination is a **staff
UUID**, never a typed name (same refuse-if-ambiguous rule as W23).

### Two ways to fill the pool (both are "search")

| Mode            | What the user does                                                                                                             | What we already know                                                                                                                                                                                                                                                                                                                                     | What capture must settle                                                                                                                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Finder**      | Type name / NHS / DOB (Medicus Patient Finder text search). Hits _are_ the pool — add one, or take the result set under a cap. | Confirmed: `GET /patient/patient-finder?query=` → `{ patientId, displayName, dateOfBirth, genderIdentity, address, … }[]` (`contacts-api.js`, contacts build plan). Help: [Using the Patient Finder](https://medicus-health.zendesk.com/hc/en-gb/articles/16305852109725-Using-the-Patient-Finder). Deceased come back with a badge — do not stage them. | Does a hit carry usual / named GP (name + staff UUID)? If not, each hit needs a banner (or listing) join before it can sit on the board. Advanced-search field list and params (help says e.g. last-seen clinician — that is **not** usual GP). |
| **Source list** | Pick Usual GP. That clinician's current named patients _are_ the pool. Optional name box narrows it.                           | Help: listing filters by Usual GP. Suite already paginates the discovered listing URL.                                                                                                                                                                                                                                                                   | Filter query-param names. Row keys (usualGpId?). Whether the listing itself has a text search, or only the finder.                                                                                                                              |

A third, later mode — Report Builder cohort — can wait. It already has
its own bulk menu (code / recall / jab / letter) and is the wrong
surface for "move the Smiths".

**Finder and source-list are not interchangeable.** Finder is how you
name _these people_. Source-list is how you name _this GP's pile_. A
partner-leaving job is source-list (possibly then search-narrow). "Put
this household on Dr Y" is finder. The canvas should offer both, and
say which definition is live.

Changing the definition rebuilds the pool. If anything is already
staged, ask first — do not silently drop a staged move.

### What we will not do

- Open onto the whole register.
- Treat last-seen clinician (finder advanced) as usual GP.
- Auto-place anyone from named GP (same rule as the allocate canvases).
- Invent a bulk body if Medicus only exposes the one-patient
  Registration save — then the canvas still stages, and the write is a
  loop with stop-on-first-failure.
- Use W23. That moves a _task_.

### Size

Sweep caps a fan-out at 40. A real GP list is 1,500–2,000. Confirm
cannot paint 2,000 named rows; it can show the count, the destination,
and a scrollable / exportable patient list the user has to acknowledge.
A first build should refuse above a stated cap (or page it) rather than
pretend a 2,000-tile board is the same product as the lab canvas.

### Capture extras this shape needs

On top of the write-path questions above:

8. Type a test name in **Patient Finder**. `chList.mark('finder search')`
   then `chList.finder()` — path, query params, result keys (is usual GP
   on the hit?).
9. Open **Advanced options**. Which fields exist? Does Usual GP appear,
   or only last-seen clinician? Params, then Cancel.
10. On the listing page, is there a **name/NHS box** as well as the Usual
    GP filter?

Until those three and the Registration save are captured: **do not
build the canvas**.

### If the write lands

1. Pool from finder and/or listing filter — replay captured URLs only.
2. Stage onto destination chips keyed by staff UUID.
3. Confirm: every patient named, current → new GP, count, escape.
4. Write exactly the captured endpoint(s). One-patient save → loop,
   stop on first failure. Archive-reassign → whole-list tool, labelled
   as such, not a subset canvas.
5. New W-id, hazard, CSN row, `test-write-path-inventory.js`. Intended
   purpose re-freeze if this is a new class of registration write.

---

## Honesty — verified vs inferred

- **VERIFIED in Medicus help (Zendesk API, 2026-08-27):** listing columns
  and filters; one-patient usual-GP edit on the Registration tab;
  archive-time whole-list reassign; automated named-GP allocation;
  report bulk-action menu contents.
- **VERIFIED in this repo:** listing discovery + pagination; banner
  `namedGP`; task-row `namedGp` / `namedGpId`; no usual-GP write; W23
  must not be reused; patient-finder text search
  (`GET /patient/patient-finder?query=`) used by contacts, result shape
  as captured in the contacts build plan (usual GP **not** among the
  confirmed keys).
- **INFERENCE (live capture only):** listing JSON keys; filter param
  names; whether "patients selected" is multi-select; the Registration
  save contract; whether a hidden listing/report bulk-change exists;
  whether archive-reassign is a single bulk POST or N single saves;
  whether finder hits or advanced search carry usual GP.

Treat every write-shaped sentence above as **unproven** until
`chList.writes()` has a row from a test-patient save.
