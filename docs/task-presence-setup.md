# Task Presence — setup

The "someone is on this request" signal (`content-scripts/task-presence.js`,
v3.222.0). Background and evidence: `docs/learnings-task-presence.md` —
Medicus records **nothing** when a request is opened (no write, no status, no
presence channel), so the signal has to be the Suite's own.

## What you get

- **Queue chip `👁 <name>`** on any request a colleague currently has open.
- **Advisory banner** when you open a request someone else already has open:
  "_<name> opened this 4 min ago — they may be working on it._"

## Setup: one click per machine. That's it.

The store is **the practice's own shared folder** — the same one the
unpacked extension already loads from on every machine. Presence data never
leaves the practice network; there are no accounts, no cloud, no credentials,
no config files.

On each machine, once:

1. Suite Options → **Task Presence** → **Choose folder…**
2. Select the Medicus Suite shared folder (any folder every machine mounts
   works — the extension folder is the natural choice).
3. When Chrome asks, choose **"Allow on every visit"** (this is what makes
   the access survive browser restarts).

Done forever on that machine. If Chrome ever drops the grant, the Options
status line goes amber and a one-click **Re-allow access** button restores it.

Identity (who you are) is never typed — it comes from the Medicus session
itself (staff UUID + login email, read from the page's own realtime
subscriptions by `page-world.js` → `data-ch-staff`), so a shared terminal
attributes presence to whoever is actually logged in to Medicus. The display
name colleagues see defaults to the login email's name part; override it in
Options if wanted.

## How it works (and why there are no conflicts)

While a clinician has a task overview open **and visible**, the service
worker writes one tiny file into the shared folder every 25 s:

```
<chosen folder>/ms-presence/<site>-<staffId>.json
→ { site, task_uuid, staff_id, staff_label, opened_at, last_seen }
```

**One file per staff member, written only by its owner** — a heartbeat is a
whole-file replace, so no locking, no write conflicts, by construction.
Everyone else lists the folder (queue: every 20 s; open task: every 25 s) and
TTL-filters: a file older than 90 s is ignored everywhere. Files dead for a
day get swept opportunistically. The content script never touches the
filesystem — all IO goes through the service worker against the persisted
folder handle.

The files are staff-activity breadcrumbs only: site code, opaque task UUID,
staff UUID, display name, two timestamps. **No patient data of any kind**, and
none of it leaves the practice network.

## What it is NOT

- **Not a lock.** Nothing is blocked, claimed, or enforced. The failure being
  prevented is two clinicians unknowingly duplicating work; the fix is
  awareness.
- **No chip ≠ nobody there.** A colleague without the Suite, a machine whose
  folder access lapsed, or an unreachable share all show nothing. Never treat
  absence as clearance.
- Presence self-releases: heartbeats stop when the tab is hidden or closed,
  and rows go stale after 90 s — a request left open over lunch stops
  claiming its owner rather than warning colleagues off it.
- All folder IO is silent-to-the-clinician on failure (debug via
  `localStorage.setItem('ch-debug','1')` + reload, `[MSTP]` prefix) — a
  broken advisory layer must not add noise to a clinical queue.

## Alternative: hosted store (only if you have no shared folder)

A practice without a common mounted folder can instead point every machine at
a Supabase project: create the project, run the SQL below, then either drop a
`presence-config.json` (copy `presence-config.example.json`) into the
extension folder or enter URL + anon key per machine in Options. The folder
store, when connected, always takes precedence.

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

create policy "presence read"   on public.task_presence for select to anon using (true);
create policy "presence insert" on public.task_presence for insert to anon with check (true);
create policy "presence update" on public.task_presence for update to anon using (true);
create policy "presence delete" on public.task_presence for delete to anon using (true);
```

The anon key is shared inside one practice; the rows are non-clinical
staff-activity data. The key is stored locally per machine and excluded from
Suite backups (same stance as the Transactional API caller key).

## Check it works

Two machines (or two Chrome profiles), both set up, logged in to Medicus as
**different users**: open the same request on machine A; within ~25 s machine
B's queue shows the `👁` chip on that row, and opening the request on B shows
the banner naming A. Close A's tab; within ~90 s the chip and banner clear.

## Mechanics (for future maintainers)

- Folder store: `shared/presence-folder.js` (pure helpers + IDB handle
  persistence + FSA IO), driven by the service worker's `presence:folder*`
  message handlers; the Options page owns the picker and permission prompts
  (both need a user gesture a worker doesn't have).
- Transport dispatch in task-presence.js (`beatWrite`/`beatClear`/
  `readTaskRows`/`readManyRows`): folder when connected + granted, else the
  hosted store, else dormant. Folder beats carry `opened_at` every time
  (whole-file replace has no server-side merge to preserve it).
- Share contents are treated as UNTRUSTED on read: filename shape is the
  authorisation unit, rows are re-validated, a row contradicting its own
  filename is dropped, oversize files are skipped.
- Hosted-store details unchanged from v3.221.0 (25 s heartbeat upserts,
  `opened_at` only on the first beat, batched `in.()` queue reads).
- A "last actioned by" queue chip is wired but LATENT: live checks
  (2026-08-04) found Medicus sends `actionedBy`/`actionedDateTime` as empty
  strings on every queue row, so it renders nothing today. It lights up
  automatically if Medicus ever populates the fields.
