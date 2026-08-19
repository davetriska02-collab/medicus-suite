# Learnings: Appointment organise API (cancel / move / extend)

Captured live on 2026-08-19 (BST) against Witley & Milford `560b6c` Medicus,
**dummy patient only**: banner-locked **Mr Micky Mouse**, DOB **02 Sep 1924**,
uuid `01970c67-06e9-70d7-802c-944574315c44`. Sunday dummy lists only
(**2026-08-23**). SMS/email confirmation checkboxes were toggled **Off** on
every write (`bookingConfirmationRecipients` / `cancellationConfirmationRecipients`
were `[]`). Nobody except Mouse was booked, moved, or cancelled. No weekday
list was written.

Same discovery rule as `docs/learnings-patient-journal-api.md` and
`scripts/booking-flow-capture.js`: **do not invent Medicus slugs**. Paths
below are what `chBook` recorded (XHR) while the UI ran.

Raw per-action files:
`C:\Users\Dave\Desktop\appt-organise-captures\00.json` … `04.json`
plus `full-chbook-dump.json`.

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

Sunday **2026-08-23** was empty of non-Mouse patients. Diaries created via
Appointment Book → Open Actions → **Add new appointment diary**:

1. Staff resource **A Nurse Practitioner Clinic** / General Appointments /
   **10:00–11:00** / Witley / Timed / Copy forward **Off**.
2. **Unassigned** / same type / **11:00–12:00** / Witley / Timed /
   Copy forward Off. Used for the first cross-list move.
3. **Unassigned** / General Appointments / GP Appointment /
   **13:00–15:00** / Witley / Timed / Copy forward Off / "Also create this
   diary on" empty. Eight 15-min slots. Used for the same-list move recapture.

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

From the Sunday book, **Book … 13:00 for 15 mins** opened Find a Patient.
Search `mick mouse` → **"There is 1 match for "mick mouse"."** Only
`Select Mr Micky "Mick- Eeee" Mouse` was clicked. Booking Confirmation
"Send to" email checkbox was **toggled Off** before **Book**. Duration
stayed **15 minutes** (do not leave it to default into 60).

| Method | Path | Status |
|---|---|---|
| POST | `/scheduling/slot-reservation/reserve-slot-and-broadcast-appointment-booking-in-progress` | 200 |
| POST | `/scheduling/slot-reservation/update-slot-reservation` | 200 (seen on some book/move paths, not all) |
| GET | `/scheduling/data/appointment-service/manage-partial-slot` | 200 |
| POST | `/scheduling/appointment/create-appointment` | 200 |
| POST | `/scheduling/slot-reservation/remove-slot-reservation-and-broadcast-appointment-booking-ended` | 200 |

Book body (15-min dummy): `context=create-booked-appointment`,
`patientId=01970c67-06e9-70d7-802c-944574315c44`,
`intendedStartDateTime=2026-08-23 13:00:00`, `intendedDuration=15`,
`bookingConfirmationRecipients=[]`,
`diaryId=01a018eb-e836-7072-9110-6f5e7115410b`.

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

Body: `targetAppointmentId`, `otherAppointmentIds=[]`,
`cancellationReason`, `cancellationConfirmationRecipients=[]`.

Ids seen: `01a018e2-04b1-72dd-a9c4-fdf551f98b4c` (post-move booking from the
first pass). After POST both original Sunday dummy diaries showed
**No patients booked**.

---

## B — Move same list (02) — success (recaptured)

**Open More actions** → **Move appointment**.

First pass (10:00–11:00 diary filled by a 60-min book) showed
"There are no available appointments." **No POST.** Recapture used the
13:00–15:00 dummy with a 15-min book: UI listed later slots 13:15–14:45.
Picked **14:00**. Confirm: **Confirm and move**. Email Send-to **Off**.

From `Sun 23 Aug 2026, 13:00` → `Sun 23 Aug 2026, 14:00` on the **same**
Unassigned General Appointments diary. Mouse only.

| Method | Path | Status |
|---|---|---|
| GET | `/scheduling/data/appointment/move-appointment/{appointmentId}` | 200 |
| GET | `/scheduling/ui/appointment/move-appointment.vue` | 200 |
| POST | `/scheduling/slot-reservation/reserve-slot-and-broadcast-appointment-booking-in-progress` | 200 |
| POST | `/scheduling/appointment/create-appointment` | 200 |
| POST | `/scheduling/slot-reservation/remove-slot-reservation-and-broadcast-appointment-booking-ended` | 200 |

Write body (chBook, 07:32:36Z / 08:32 BST):

```json
{
  "context": "reschedule-appointment",
  "patientId": "01970c67-06e9-70d7-802c-944574315c44",
  "rescheduledAppointmentId": "01a018ed-44a8-7231-8400-1f638c2ec019",
  "intendedStartDateTime": "2026-08-23 14:00:00",
  "intendedDuration": 15,
  "bookingConfirmationRecipients": [],
  "diaryId": "01a018eb-e836-7072-9110-6f5e7115410b"
}
```

Same `diaryId` as the source booking. New appointment id after move:
`01a018ef-b029-7245-ac45-6f70ecc11929`.
`update-slot-reservation` did **not** fire on this 15-min same-list move
(it did on the earlier 60-min cross-list). Do not require it for same-list.

---

## C — Move cross list (03) — success

**Open More actions** → **Move appointment to another diary**.

UI listed only the other **Sunday** dummy (Unassigned 11:00–12:00). Picked
**11:00**. Confirm: **Confirm and move**. Email Send-to **Off**.

From `Sun 23 Aug 2026, 10:00` General Appointments →
`Sun 23 Aug 2026, 11:00` General Appointments. Mouse only.

Writes reused the **create-appointment + slot-reservation** lifecycle
(same as book / same-list move), not a distinct `/move` POST:

| Method | Path | Status |
|---|---|---|
| GET | `/scheduling/data/appointment/move-appointment/{appointmentId}` | 200 |
| GET | `/scheduling/ui/appointment/move-appointment.vue` | 200 |
| POST | `/scheduling/slot-reservation/reserve-slot-and-broadcast-appointment-booking-in-progress` | 200 |
| POST | `/scheduling/slot-reservation/update-slot-reservation` | 200 |
| POST | `/scheduling/appointment/create-appointment` | 200 |
| POST | `/scheduling/slot-reservation/remove-slot-reservation-and-broadcast-appointment-booking-ended` | 200 |

Cross-list body used `context=reschedule-appointment` with a **different**
`diaryId`. `update-slot-reservation` carried `rescheduledAppointmentId` and
the new diary/start. Source appointment id `01a018d9-…` became
`01a018e2-…` after the move.

---

## D — Extend (04) — BLOCKED

**Edit Details** opened. GET returned the booked appointment
(`intendedStartDateTime: "2026-08-23 14:00:00"`, `intendedDuration: 15`
on the recapture). UI Date/time is a **read-only** description-list item
`23 Aug 2026, 14:00 (15 mins)`. **No duration radios.** Spare later slots
on a 2-hour diary did not add a duration control.

The Vue shell (`GET /scheduling/ui/appointment/edit-appointment.vue`)
contains:

```
<m-edit-form url="/scheduling/appointment/change-appointment">
```

That path is **observed in the template**, not a captured write.
**Save changes was not clicked.** Do not treat
`/scheduling/appointment/change-appointment` as a confirmed duration API
until a Save with a changed duration is captured.

| Method | Path | Status |
|---|---|---|
| GET | `/scheduling/data/appointment/edit-appointment/{appointmentId}` | 200 |
| GET | `/scheduling/ui/appointment/edit-appointment.vue` | 200 |

**No write path captured for extend.**

---

## UI map (More actions)

On **View Appointment Details**:

- **Edit Details** → reason / additional info / delivery / NHS slot
  (duration is display-only for timed appointments)
- **Open More actions**
  - Set arrival status
  - Move appointment (same list)
  - Move appointment to another diary (cross list)
  - Move appointment to a queue (not exercised)
  - Reschedule (not exercised)
  - Cancel appointment
  - Patient did not attend (not exercised)
  - Send booking confirmation (not exercised — would be SMS/email)
  - Log communication (not exercised)

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

v1 on branch `appointment-organise-v1` (suite v3.234.2): cancel +
same-list + cross-list. Move reserve is the captured 3-field POST.
`update-slot-reservation` is cross-list only. Create/release go through
`shared/booking-core.js`. Extend stays blocked. Do not tidy or rename
the byte-for-byte paths.

---

## E — Change type (05) — BLOCKED

Recaptured 2026-08-19 on the same locked dummy (Mr Micky Mouse, Sunday 2026-08-23, appointment `01a018ef-b029-7245-ac45-6f70ecc11929`). Overlay staged drag was Discarded first. Book stayed 14:00 / 15 min. No Save. No POST.

**Edit Details** fields:

| Field | State |
|---|---|
| Date/time | display-only `23 Aug 2026, 14:00 (15 mins)` |
| Reason for appointment | editable |
| Additional information | editable |
| Delivery mode | ComboBox, Face-to-face (editable) |
| Site | display-only Witley Surgery |
| NHS slot category | ComboBox, General Consultation Routine (editable) |
| Redacted from patient online access | checkbox Off (editable) |
| Appointment type | **absent** (shown as `GP Appointment` on View Appointment Details only) |
| Duration | no standalone control; only the Date/time display text |

Prefill only:

| Method | Path | Status |
|---|---|---|
| GET | `/scheduling/data/appointment/appointment-overview/{id}` | 200 |
| GET | `/scheduling/ui/appointment/appointment-overview.vue` | 200 |
| GET | `/scheduling/data/appointment/edit-appointment/{id}` | 200 |
| GET | `/scheduling/ui/appointment/edit-appointment.vue` | 200 |

Vue shell still has `m-edit-form url="/scheduling/appointment/change-appointment"`. Save was not clicked. That path is **not** a captured write.

Raw: `C:\Users\Dave\Desktop\appt-organise-captures\05-edit-type.json`

**Do not use:** a canvas type picker. Native UI has no type control after booking.

---

## F — Change duration / length (06, 07) — BLOCKED

Tried three native paths. None can lengthen 15 to 30 on the same start.

1. **Edit Details** — duration is display-only inside Date/time. No radios. Save not clicked.
2. **Reschedule** — slot picker only. Chip `GP Appointment 15`. Every slot `for 15 mins`. No 30-min option. Closed, no write.
   - GET `/scheduling/data/appointment/create-appointment?context=reschedule-appointment&rescheduledAppointmentId={id}`
   - GET `/scheduling/ui/appointment/create-appointment.vue`
3. **Move appointment** (same list) — same-diary 15-min slot picker (13:00–13:45, 14:15–14:45). No duration control. Closed, no write.
   - GET `/scheduling/data/appointment/move-appointment/{id}?moveType=to-same-diary`
   - GET `/scheduling/ui/appointment/move-appointment.vue`

Raw: `06-edit-duration.json` (blocked note), `07-reschedule-or-move-duration.json` (GET/prefill only).

**Do not use:** `/scheduling/appointment/change-appointment` as a duration API. **Do not** treat create-appointment `duration` on a reschedule as a length-change contract. That field was only captured on book/move at the original 15 minutes.

---

## G — TEST A (cancel + update-reservation 30 + create 30) — REJECTED

Tried to lengthen a 15-min booking by:

1. `POST /scheduling/appointment/cancel-appointment` — reason `Snooze`, `cancellationConfirmationRecipients: []`
2. `POST /scheduling/slot-reservation/update-slot-reservation` — `intendedDuration: 30`, `allowOverlappingAppointments: "allow"`
3. `POST /scheduling/appointment/create-appointment` — duration 30

A 30-min option **was offered**. SMS off. Neighbour at **14:15 stayed 15 min**. Both tiles then showed **Overlapping Appointment**.

That is not an extend. It is a new 30-min booking overlapping the next patient. The organise canvas must not do this: never cancel-then-create to change length; a move keeps the source `intendedDuration`.

SMS/email: no Send-to left on. Nobody except Mouse. Book still 14:00 / 15 min Face-to-face.

---

## Canvas UI implication

Do not ship length or appointment-type chips. They would be fake. Do not
offer a 30-min drop that cancels and rebooks: TEST A overlapped the
14:15 neighbour.

The only Edit Details fields that look writable and were not captured as POSTs yet are **reason**, **additional info**, **delivery mode**, **NHS slot category**, and **Redacted**. Capture a Save on Mouse before wiring any of them. Length and type stay greyed: Medicus will not change these after booking. There is **no Edit slot** control.

### Addendum — 14:15 View Appointment Details (same Sunday, same Mouse)

After the same-list move, View Appointment Details at **14:15 (15 mins)**. Top-right Edit is the 14×14 pencil labelled **Edit Details**. Opens **Edit Appointment**. Date/time is a read-only description-list item `23 Aug 2026, 14:15 (15 mins)` — no duration radios, no type combo. Writable: Reason, Additional info, Delivery mode, NHS slot category, Redacted. **Save was not clicked** (it would not change length). More actions on this card: Move appointment, Move to another diary, Move to a queue, Reschedule, Cancel appointment, Patient did not attend, Send booking confirmation. **No Edit slot. No POST.**

---

Operational note (driving bot, not a Medicus contract): AVG "ALLOW APP" did not land and hid the dialog. `cmd` writes to Desktop work; PowerShell Desktop writes still blocked because `fileprotection.paths` still includes Desktop.


---

## G — Stretch length via cancel + rebook (20, 21) — captured 2026-08-19

Native Edit Appointment cannot change length. Dave's theory: a canvas stretch is cancel + rebook at the new duration.

Dummy only: Mr Micky Mouse, Sunday 2026-08-23, UNASSIGNED 13:00–15:00. SMS/email off (`cancellationConfirmationRecipients=[]`, Send-to unchecked).

### Test A — neighbour booked

14:00 and 14:15 both Mouse 15 min. Cancel 14:00, rebook 14:00 at 30 min while 14:15 still booked.

30 / 45 / 60 were offered. Book succeeded. 14:15 stayed, still 15 min, not moved. Both tiles labelled **Overlapping Appointment**. Neighbour did **not** auto-change.

### Test B — neighbour free

14:00 Mouse 15, 14:15 free. Cancel 14:00, rebook 14:00 at 30 min.

Succeeded. 14:15 free slot consumed. Next free 14:30. No ghost 15. One 30-min tile. No overlap label.

### Writes (both tests, chBook)

| Method | Path | Notes |
|---|---|---|
| POST | `/scheduling/appointment/cancel-appointment` | `otherAppointmentIds: []`, reason Snooze |
| POST | `/scheduling/slot-reservation/reserve-slot-and-broadcast-appointment-booking-in-progress` | `intendedDuration: 15` first |
| POST | `/scheduling/slot-reservation/update-slot-reservation` | `intendedDuration: 30`, `allowOverlappingAppointments: "allow"` |
| POST | `/scheduling/appointment/create-appointment` | `intendedDuration: 30` |
| POST | `/scheduling/slot-reservation/remove-slot-reservation-and-broadcast-appointment-booking-ended` | |

Raw: `C:\Users\Dave\Desktop\20-stretch-adjacent-cancel-rebook.json`, `21-stretch-booked-then-free.json`

### Canvas implication

Stretch is allowed only into a **free** following slot (Test B). Refuse if the next slot is booked (Test A would overlap). Do not send `allowOverlappingAppointments: allow` for a stretch. Do not treat this as a native duration PATCH. Type change was not part of this test.

v1 GUI: resize handle / +15 min only when `followingSlotsFree`. Next slot booked → no handle, snap back, do not stage, do not Finalise. Confirm bar: cancel then rebook at the new length, names the patient. Re-GET before commit.

