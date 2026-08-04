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
- **Queue chip `✎ <name> · <time>`** — who last actioned the task. LATENT:
  live checks (2026-08-04, both a `New` and a `Reply received` row) found
  Medicus sends `actionedBy` / `actionedDateTime` as **empty strings** in the
  queue payload, so this chip currently renders nothing. The code stays wired
  so it lights up the day Medicus populates the fields — but do not expect to
  see it today. The presence layers below are the real signal.

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

### 3. Drop ONE file into the shared extension folder — that's every machine done

Practices load the unpacked extension from a shared folder; every machine
reads the same files. So: copy `presence-config.example.json` (in the
extension folder) to **`presence-config.json`** in the same folder, and fill
in the two values:

```json
{
  "url": "https://<project>.supabase.co",
  "key": "<anon public key>"
}
```

That's the whole rollout. Each machine picks it up automatically (on browser
start, extension reload, or first Medicus page after) and presence turns
itself on — nobody opens Options, nothing is typed per machine. The picked-up
credentials are also cached per machine, so presence keeps working even if a
later folder update forgets to carry the file over (re-drop it to change
stores).

Identity (who you are) is never typed either — it comes from the Medicus
session itself (staff UUID + login email, read from the page's own realtime
subscriptions), so a shared terminal attributes presence to whoever is
actually logged in to Medicus.

**Per-machine control (optional), Suite Options → Task Presence:** a status
line shows whether the shared file was detected; "Presence active on this
machine" unticked opts one machine out; the URL/key fields are a manual
override for machines that don't load from the shared folder; display name
overrides what colleagues see (default: the login email's name part).

`presence-config.json` is git-ignored and never in release zips — it is the
practice's own credential and lives only in the practice's folder.

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
- Config resolution (`resolvePresenceConfig`): manual Options values (url+key
  both set) win, else the `presence.fileCache` synced by the service worker
  from the packaged `presence-config.json`; enabled is "on unless this
  machine explicitly opted out".
- Identity comes from `data-ch-staff` (stamped by
  `content-scripts/triage-lens/page-world.js` from the Pusher channel names
  `{site}-staff-task-counters-{staffUuid}` and `update-tenants-{email}`).
