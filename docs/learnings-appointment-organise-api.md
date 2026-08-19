# Learnings: Appointment organise API (cancel / move / extend)

Captured live on 2026-08-19 (BST) against Witley & Milford `560b6c` Medicus,
**dummy patient only**: banner-locked **Mr Micky Mouse**, DOB **02 Sep 1924**,
uuid `01970c67-06e9-70d7-802c-944574315c44`. Sunday dummy lists only
(**2026-08-23**). SMS/email confirmation checkboxes were toggled **Off** on
every write. Nobody except Mouse was booked, moved, or cancelled. Today's
Wednesday live book was viewed briefly then left; no weekday list was written.

Same discovery rule as `docs/learnings-patient-journal-api.md` and
`scripts/booking-flow-capture.js`: **do not invent Medicus slugs**. Paths
below are what `chBook` recorded (XHR) while the UI ran.

Raw per-action files:
`C:\Users\Dave\Desktop\appt-organise-captures\00.json` … `04.json`.

---

## Page URLs (observed, not guessed)

- Scheduling homepage: `/560b6c/scheduling/homepage`
- Appointment Book (date query): `/560b6c/scheduling/appointment-book?date=YYYY-MM-DD`
- Appointment Book via homepage tab: `/560b6c/scheduling/homepage?tab=appointment-book&date=YYYY-MM-DD`

API host is the site API subdomain (`{siteId}.api.england.medicus.health`),
same as `shared/booking-core.js`. Page host serves the Vue shells
(`/scheduling/ui/…vue`).

---

## Dummy session used

Sunday **2026-08-23** was empty (no non-Mouse patients). Two ad-hoc diaries
were created via Appointment Book → Open Actions → **Add new appointment diary**:

1. Staff resource **A Nurse Practitioner Clinic** (auto-filled when Staff 1
   left blank then resolved) / General Appointments / GP Appointment /
   **10:00–11:00** / Witley Surgery / Timed / Copy forward **Off** /
   "Also create this diary on" **empty**.
2. **Unassigned** / same type / **11:00–12:00** / Witley / Timed /
   Copy forward Off. Needed for cross-list move.

Create-diary writes (chBook):

| Method | Path | Status |
|---|---|---|
| GET | `/scheduling/data/appointment-service/create-appointment-diary` | 200 |
| GET | `/scheduling/ui/appointment-service/create-appointment-diary.vue` | 304 |
| GET | `/organisation/data/location/site/room/room-options-with-availability` | 200 |
| POST | `/scheduling/data/non-delivery-period/periods-between-range-for-sites` | 200 |
| POST | `/scheduling/data/appointment-service/appointment-diary-preview` | 200 |
| POST | `/scheduling/appointment-service/create-appointment-diary` | 200 |
| GET | `/scheduling/data/appointment-book` | 200 |

There is **no free-text session name** on the New Appointment Diary form.
The column title is the Staff 1 resource (or "Unassigned"). "SUITE TEST — delete"
could not be set as a label without creating a new staff/service record
(we did **not** create a live service).

---

## Book (00) — success

From the Sunday book, **Book … 10:00 for 15 mins** opened Find a Patient.
**Only** the locked recent row `Select Mr Micky "Mick- Eeee" Mouse` was
clicked. Booking Confirmation "Send to" email checkbox was **toggled Off**
via TogglePattern before **Book**. Duration landed as **60 mins** (filled
the hour).

| Method | Path | Status |
|---|---|---|
| POST | `/scheduling/slot-reservation/reserve-slot-and-broadcast-appointment-booking-in-progress` | 200 |
| POST | `/scheduling/slot-reservation/update-slot-reservation` | 200 |
| GET | `/scheduling/data/appointment-service/manage-partial-slot` | 200 |
| POST | `/scheduling/appointment/create-appointment` | 200 |
| POST | `/scheduling/slot-reservation/remove-slot-reservation-and-broadcast-appointment-booking-ended` | 200 |

These booking/reserve paths already exist in `shared/booking-core.js`.
Organise does **not** need a third copy of create/reserve.

---

## A — Cancel (01) — success

View appointment → **Open More actions** → **Cancel appointment**.

Form: required **Cancellation reason**; **Send to** email checkbox
(default On — must turn Off); a second checkbox listing Mouse's **Thu 20 Aug
2026 11:20 Nurse/HCA** weekday appointment (left **Off** — do not cancel
live lists).

Confirm button label: **Cancel appointment**.

| Method | Path | Status |
|---|---|---|
| GET | `/scheduling/data/appointment/appointment-overview/{appointmentId}` | 200 |
| GET | `/scheduling/data/appointment/cancel-appointment/{appointmentId}` | 200 |
| GET | `/scheduling/ui/appointment/cancel-appointment.vue` | 200 |
| POST | `/scheduling/appointment/cancel-appointment` | 200 |

Ids seen: `01a018e2-04b1-72dd-a9c4-fdf551f98b4c` (post-move booking).
After POST both Sunday dummy diaries showed **No patients booked**.

---

## B — Move same list (02) — BLOCKED

**Open More actions** → **Move appointment**.

UI: "Move Appointment" / Mouse banner / **"There are no available
appointments."** Same diary was 60 mins with the booking filling 10:00–11:00.

| Method | Path | Status |
|---|---|---|
| GET | `/scheduling/data/appointment/move-appointment/{appointmentId}` | 200 |
| GET | `/scheduling/ui/appointment/move-appointment.vue` | 200 |

**No POST.** Do not invent a same-list move write slug. Re-run on a diary
with spare slots (shorten duration or lengthen the dummy session) to
capture the confirm write.

---

## C — Move cross list (03) — success

**Open More actions** → **Move appointment to another diary**.

UI listed only the other **Sunday** dummy (Unassigned 11:00–12:00). Picked
**11:00**. Confirm: **Confirm and move**. Email Send-to **Off**.

From `Sun 23 Aug 2026, 10:00` General Appointments →
`Sun 23 Aug 2026, 11:00` General Appointments. Mouse only.

Writes reused the **create-appointment + slot-reservation** lifecycle
(same as book), not a distinct `/move` POST in this capture:

| Method | Path | Status |
|---|---|---|
| GET | `/scheduling/data/appointment/move-appointment/{appointmentId}` | 200 |
| GET | `/scheduling/ui/appointment/move-appointment.vue` | 200 |
| POST | `/scheduling/slot-reservation/reserve-slot-and-broadcast-appointment-booking-in-progress` | 200 |
| POST | `/scheduling/slot-reservation/update-slot-reservation` | 200 |
| POST | `/scheduling/appointment/create-appointment` | 200 |
| POST | `/scheduling/slot-reservation/remove-slot-reservation-and-broadcast-appointment-booking-ended` | 200 |

Treat cross-list move as: load move UI → reserve new slot →
`create-appointment` → release reservation. Confirm whether the source
appointment is cancelled implicitly (cancel POST was **not** in the move
burst; a later cancel used a **new** appointment id
`01a018e2-…` vs original `01a018d9-…`).

---

## D — Extend (04) — BLOCKED

**Edit Details** opened. GET returned
`intendedStartDateTime: "2026-08-23 10:00:00"`, `intendedDuration: 60`,
`versionId`, `deliveryMode`, `nhsNationalSlotTypeCategory`, `siteName`.
Duration control did not offer a longer slot that fits a 60-min diary.
**Save changes was not clicked.**

| Method | Path | Status |
|---|---|---|
| GET | `/scheduling/data/appointment/edit-appointment/{appointmentId}` | 200 |
| GET | `/scheduling/ui/appointment/edit-appointment.vue` | 200 |

**No write path captured.** Do not guess PUT/PATCH. Next time: dummy
diary ≥ 90 mins, book 15–30 mins, Edit Details → longer duration → Save
with email Off, then capture the write.

---

## UI map (More actions)

On **View Appointment Details**:

- **Edit Details** → duration / delivery / reason (extend lives here)
- **Open More actions**
  - Move appointment (same list)
  - Move appointment to another diary (cross list)
  - Move appointment to a queue (not exercised)
  - Reschedule (not exercised)
  - Cancel appointment

---

## Safety notes for implementers

- Identity: only book/cancel/move the caller-supplied patient id
  (same H-043 rule as `shared/booking-core.js`).
- Never default "Send to" email/SMS On.
- Cancel form can offer **other upcoming appointments** (including weekday
  live lists). The suite must not tick those.
- Do not open or write weekday live books.
- Vue `GET /scheduling/ui/…vue` is the SDUI shell, not the data API.

---

## Implement next

v1 shipped on branch `appointment-organise-v1` (suite v3.234.2):
`shared/appointment-organise-core.js` + appointment-book canvas.
Cancel + cross-list reschedule only. Leave same-list move and extend
as **blocked / needs a second dummy capture** until those writes are
seen. Do not tidy or rename the byte-for-byte paths.
