# Task Presence — practice setup

One-time setup for the shared "someone is on this request" store
(`content-scripts/task-presence.js`, v3.220.0). Background and evidence:
`docs/learnings-task-presence.md` — Medicus records **nothing** when a request
is opened (no write, no status, no presence channel), so the store has to be
the Suite's own.

## What you get

- **Queue chip `👁 <name>`** on any request a colleague currently has open.
- **Advisory banner** when you open a request someone else already has open:
  "_<name> opened this 4 min ago — they may be working on it._"
- **Queue chip `✎ <name> · <time>`** — who last actioned the task. This layer
  needs **no setup at all**: it reads fields Medicus already sends to the
  queue (`actionedBy` / `actionedDateTime`) and works from install.

## What it is NOT

- **Not a lock.** Nothing is blocked, claimed, or enforced. The failure being
  prevented is two clinicians unknowingly duplicating work; the fix is
  awareness.
- **No chip ≠ nobody there.** A colleague without the Suite, a machine with
  presence unconfigured, or an unreachable store all show nothing. Never
  treat absence as clearance.
- Presence stops being claimed when the tab is hidden or closed — rows go
  stale after 90 s, so a request left open over lunch releases itself.

## Data & governance

The only data ever written to the store: the practice site code, the opaque
task UUID, the staff member's UUID, their display label, and two timestamps.
**No patient data of any kind** — a task UUID is meaningless without an
authenticated Medicus session. The rows are staff activity data, visible to
anyone holding the practice's anon key; treat the key like any internal
credential. It is stored locally per machine and excluded from Suite backups
(same stance as the Transactional API caller key).

## Setup (once per practice, ~10 minutes)

### 1. Create the Supabase project

[supabase.com](https://supabase.com) → New project (free tier is fine — the
row volume is trivial). Note the **Project URL** (`https://<project>.supabase.co`)
and the **anon public key** (Project Settings → API).

### 2. Create the table + policies

SQL Editor → run:

```sql
create table public.task_presence (
  site        text        not null,
  task_uuid   uuid        not null,
  staff_id    uuid        not null,
  staff_label text        not null default 'A colleague',
  opened_at   timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  primary key (site, task_uuid, staff_id)
);

alter table public.task_presence enable row level security;

-- The anon key is shared inside one practice; presence rows are
-- non-clinical staff-activity data, so anon may read/write them.
create policy "presence read"   on public.task_presence for select to anon using (true);
create policy "presence insert" on public.task_presence for insert to anon with check (true);
create policy "presence update" on public.task_presence for update to anon using (true);
create policy "presence delete" on public.task_presence for delete to anon using (true);
```

Optional housekeeping (stale rows are ignored by the extension anyway, so
this is cosmetic): a daily cron `delete from task_presence where last_seen <
now() - interval '1 day';` via Supabase's pg_cron.

### 3. Configure every machine

Suite Options → **Task Presence**:

| Field                  | Value                                                                     |
| ---------------------- | ------------------------------------------------------------------------- |
| Enable shared presence | ticked                                                                    |
| Store URL              | `https://<project>.supabase.co`                                           |
| Store key (anon)       | the anon public key                                                       |
| Your display name      | optional — what colleagues see (else the login email's name part is used) |

Every machine must use the **same URL + key**. Identity (who you are) is not
typed anywhere — it comes from the Medicus session itself (staff UUID + login
email, read from the page's own realtime subscriptions), so a shared terminal
attributes presence to whoever is actually logged in to Medicus.

### 4. Check it works

Two machines (or two Chrome profiles), both configured, both logged in to
Medicus as **different users**: open the same request on machine A; within
~25 s machine B's queue shows the `👁` chip on that row, and opening the
request on B shows the banner naming A. Close A's tab; within ~90 s the chip
and banner clear on B.

## Mechanics (for future maintainers)

- Heartbeat upsert every 25 s **only while the task overview tab is visible**
  (`Prefer: resolution=merge-duplicates` on the `(site, task_uuid, staff_id)`
  key; `opened_at` sent only on the first beat so it never resets).
- Best-effort `DELETE` on SPA-nav away / pagehide (`keepalive: true`); the
  90 s TTL is the backstop when the delete never lands.
- Queue reads batch all visible task UUIDs into one `task_uuid=in.(...)`
  PostgREST filter, max 100, every 20 s while the queue tab is visible.
- All store I/O is silent-to-the-clinician on failure (debug via
  `localStorage.setItem('ch-debug','1')` + reload, `[MSTP]` prefix) — a
  broken advisory layer must not add noise to a clinical queue.
- Identity comes from `data-ch-staff` (stamped by
  `content-scripts/triage-lens/page-world.js` from the Pusher channel names
  `{site}-staff-task-counters-{staffUuid}` and `update-tenants-{email}`).
