# Learnings — is a task tagged as "being worked on"?

**Captured:** 2026-08-04, live Medicus, `communication-thread` task opened from a
`medical_patient_request_task` queue, via `scripts/task-presence-capture.js`.
28 timeline entries, 20 network calls, the request opened **twice**.

**Question:** when a clinician opens a triage/patient request, does Medicus record or
broadcast that anywhere, so a colleague can see somebody is already on it?

## Answer: no. Nothing is recorded on open, and there is no status for it.

Three independent lines of evidence, all from the same capture.

### 1. Opening a request writes nothing

The request was opened, navigated away from, and opened again. Across the whole capture
there were **20 network calls and zero writes** — every one a `GET`. No claim, no lock,
no heartbeat, no "viewed" ping.

A claim or lock mechanism has to write on open. Medicus does not, so it has nothing to
show anyone else. This is the decisive finding: any "someone is on this" indicator has
to be ours to build.

### 2. The status vocabulary has no room for one

Confirmed twice over, from two different endpoints:

`GET /tasks/data/{slug}/task-list` → `filters.categories[filterKey=statuses].options`:

| value                         | label                       |
| ----------------------------- | --------------------------- |
| `new-request`                 | New                         |
| `awaiting-recipient-response` | Awaiting recipient response |
| `reply-received`              | Reply received              |
| `snoozed`                     | Scheduled for later         |

`GET /tasks/data/{slug}/overview/{taskUuid}` → `taskStatusOptions[]`, i.e. what the task
page itself will let you set: `new-request`, `reply-received`, `awaiting-recipient-response`,
`resolved` (each carrying `isPendingInitialReview` / `isAwaitingRecipientResponse` /
`isReplyReceived` / `isResolved` / `isRejected` booleans, so `rejected` exists too).

`defaultStatuses` on the list response: `['new-request', 'awaiting-recipient-response',
'reply-received']`.

**There is no `in-progress`.** A request is either untouched, waiting on someone else,
replied to, snoozed, or finished. "Being looked at right now" is not a state Medicus models.

### 3. No presence channel on Pusher

17 Pusher channels subscribed on a task page, **zero presence channels** — so no member
list and nobody broadcasting their arrival. What is there:

| channel                                | events                                                   |
| -------------------------------------- | -------------------------------------------------------- |
| `{site}-task-{taskUuid}`               | `updated`                                                |
| `{site}-task-{taskTypeSlug}`           | (none bound)                                             |
| `{site}-staff-task-counters-{staffId}` | `counter-updated`                                        |
| `{site}-team-task-counters-{teamId}`   | `counter-updated` (one per team you're in)               |
| `{site}-encounter-{uuid}`              | `updated`                                                |
| `{site}-chatparticipant-{staffId}`     | `all_messages_read`, `chat_updated`, `message_updated`   |
| `{site}-telephony-{staffId}`           | `inbound_call_initiated`, `inbound_call_ended`           |
| `{site}-panic-alerts-{uuid}`           | `panic-alert-created`, `-cancelled`, `-response-created` |
| `{site}-scheduling`                    | (bound by our own pusher-relay.js)                       |

So Medicus **does** have a live per-task broadcast (`{site}-task-{uuid}` → `updated`) —
but it fires on _change_, not on _view_.

All 17 are **public** channels (no `private-` / `presence-` prefix). Pusher client events
require a private or presence channel and a `client-` prefix, so we **cannot** publish our
own presence event onto these from the extension. Any suite-built indicator needs its own
shared store.

## What the queue row already carries (and we don't read)

`GET /tasks/data/{slug}/task-list` → `tasks[]`, full row key set:

```
summary, summaryLabel, cellStyles, patientName, dateOfBirth,
namedGp, namedGpId,
actionedBy, actionedById, actionedDateTime,      ← never read by the suite
id, priority, priorityDisplay, dueDate, isOverdue,
assignedTo, assignedId,                          ← never read by the suite
status, statusValue, statusText,                 ← never read by the suite
createdAt, overviewURL
```

`shared/request-monitor.js` reads only `id`, `patientName`, `summary`/`summaryLabel`,
`priority`, `priorityDisplay`, `createdAt`. The seven marked fields are free — already on
the wire, no new endpoint.

On the captured (untouched, `New`) task, `actionedBy` / `actionedById` /
`actionedDateTime` were all `""`. They are therefore **last-actioned**, not
currently-open — they populate once somebody does something, which is exactly the
half-signal available without new infrastructure.

`assignedTo` was a **team** ("Triage Doctor"), and `assignedId` matched the
`masterAssignee` query param — so assignment is the routing dimension, not a personal claim,
unless someone re-assigns a task to themselves.

`columnDefs` (what the queue is allowed to show) is: `patientName`, `dateOfBirth`,
`priorityDisplay`, `dueDate`, `namedGp`, `statusText`, `createdAt` — `actionedBy` is in the
payload but **not** in the visible columns.

## Consequences for anything we build

- **Cheapest real signal:** a queue chip reading `actionedBy` + `actionedDateTime`
  ("last actioned by X, 11:42"). Read-only, no new endpoint, no write. Does **not** cover
  the case that matters most — opened but not yet actioned, which is precisely when two
  clinicians collide.
- **True "I'm on this now"** needs a store shared between staff (the suite already carries
  Supabase host permissions). It would be a _soft advisory_, never a lock: an extension-side
  indicator cannot stop anyone using Medicus's own UI, and must not imply it has.
- **Do not** try to publish presence on the existing Pusher channels — they are public, so
  client events are impossible.

## Capture-tool notes

`scripts/task-presence-capture.js` had two defects this run, both fixed in v3.219.2:

- `apiBaseUrl()` stripped the first host label before prefixing `api`, producing
  `{code}.api.medicus.health` (does not resolve) instead of
  `{code}.api.england.medicus.health`. Both active probe GETs failed with
  "Failed to fetch"; **every finding above came from the passive fetch/XHR wrap**
  catching the app's own calls, which is why the capture still worked.
- `BODY_KEEP_CAP` of 20 000 truncated the overview body mid-`taskStatusOptions`
  (that array starts ~17 600 chars in). Raised to 80 000.

The DOM scan found `statusControls: []` — Medicus's status control is a custom Vue
component, not a native `<select>` or `role="combobox"`, so the selector missed it. The
payload inventories above are authoritative, so this was not worth widening.
