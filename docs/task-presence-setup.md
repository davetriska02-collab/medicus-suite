# Task Presence — setup

The "someone is on this request" signal (`content-scripts/task-presence.js`).
Background and evidence: `docs/learnings-task-presence.md`.

Medicus now subscribes to a per-request Pusher **presence** channel
(`presence-{site}-task-{taskUuid}`) while a request overview is open. The
Suite reads that channel in `page-world.js` and paints an advisory strip on
the open request. No shared folder is required for that native strip. The
folder / hosted store (below) remains as a fallback for queue chips and for
practices whose Medicus build does not yet expose the presence channel.

## What you get

- **Occupied strip** prepended into `<main>` when a colleague is in the same
  request you have open. One line, for example:

  `PN  Looking: Dr Priya Nair has this open. You can still work it.`

  Avatars use identity colours (never status red or amber). Two colleagues are
  named; more become "and N others", with a `+N` disc after three avatars.

- **Queue title strip** on a task-list: a compact named notice in the title
  row when a colleague also has that list open (native
  `presence-{site}-task-list-{slug}`). Example: `Looking: Dr Priya Nair is
  also on this list. You can still work it.` It replaces Medicus's unnamed "GP is
  also working this list" widget. Absence of the strip is not evidence
  nobody else is on the list. List occupancy is never treated as a
  per-request occupant and never becomes a row 👁 chip.

- **Hide** (this tab only) sits at the end of the strip. It hides the bar for
  this request and this set of people until someone new joins, or until the
  tab is closed. It is `sessionStorage`, never a cross-session memory, and it
  is not a lock.

- **LIVE** means the Pusher socket is connected. After this tab has noticed
  the same person for a minute or more, the token becomes
  `LIVE · seen here N min` — counted from when _this tab_ first saw them, not
  from when they opened the request. Membership has no opened-at. Store-backed
  fallback rows still say `Seen N min ago`.

- **Queue chip `👁 <name>`** on any request a colleague currently has open
  (folder / hosted store, when configured).

The strip is advisory. It never claims the request is locked, never blocks
Medicus's own UI, and never asks you to leave.

## Native strip (no setup)

Identity (who you are) is never typed — it comes from the Medicus session
itself (staff UUID + login email, read from the page's own realtime
subscriptions by `page-world.js` → `data-ch-staff`). Without a self id the
strip stays hidden (otherwise it would paint you as occupying your own
request). A colleague with empty `member.info` is labelled "Someone else",
unless the store already knows a name for that staff UUID.

## Setup: folder store (queue chips / fallback). One click per machine.

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

The display name colleagues see on store-backed chips defaults to the login
email's name part; override it in Options if wanted.

## How the folder store works (and why there are no conflicts)

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
  awareness. The strip says so in the line itself.
- **No chip / no strip ≠ nobody there.** A colleague without the Suite, a
  machine whose folder access lapsed, an unreachable share, or a dead Pusher
  socket all show nothing. Never treat absence as clearance.
- Native LIVE is withheld when the socket is not connected (the strip hides
  rather than claiming Live on a dead connection).
- Store presence self-releases: heartbeats stop when the tab is hidden or
  closed, and rows go stale after 90 s — a request left open over lunch stops
  claiming its owner rather than warning colleagues off it.
- All folder IO is silent-to-the-clinician on failure (debug via
  `localStorage.setItem('ch-debug','1')` + reload, `[MSTP]` prefix) — a
  broken advisory layer must not add noise to a clinical queue.

## Alternative: hosted store (only if you have no shared folder)

A practice without a common mounted folder can instead point every machine at
a Supabase project: create the project, run the SQL below, then either drop a
`presence-config.json` (copy `presence-config.example.json`) into the
extension folder or enter URL + anon key per machine in Options. The folder
store, when connected, always takes precedence. Native Pusher occupancy does
not use this store.

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

Two machines (or two Chrome profiles), logged in to Medicus as **different
users**: open the same request on machine A; machine B's overview should show
the occupied strip naming A (LIVE once Pusher has them both). Hide on B
clears the strip on that tab only; A joining still, then a third person
arriving, brings it back. Close A's tab; the strip clears when they leave the
presence channel.

For the folder fallback: within ~25 s machine B's queue shows the `👁` chip
on that row. Close A's tab; within ~90 s the chip clears.

## Mechanics (for future maintainers)

- Native occupancy: `content-scripts/triage-lens/page-world.js` polls
  Medicus's `$pusher` for two channels and never subscribes itself:
  - `presence-{site}-task-{taskUuid}` → `ch-native-task-presence` with
    `{ taskUuid, members, live? }` (occupied masthead on the open request).
  - `presence-{site}-task-list-{slug}` → `ch-native-list-presence` with
    `{ slug, members, live? }` (compact named strip in the **queue title
    row** only). The list channel is still never a per-request occupant
    and never feeds a row 👁 chip. Empty wipe on slug change; `idle`
    sentinel after leaving a list so the poll does not flap.
  Empty wipe on task change; `idle` sentinel after leaving an overview so
  the poll does not flap. `live: false` when `connection.state` is not
  `connected` or `pusher:subscription_error` fired. Identity re-stamped
  from the counters channel for the life of the page.
- Isolated world: `content-scripts/task-presence.js` prepends
  `#ms-tp-banner` into `<main>` on an overview, and `#ms-tp-list` into the
  queue title row (replacing Medicus's "is also working this list"
  widget; host styles recorded and restored when our strip is gone). Fail
  closed: no self id → no strip; wrong task/slug → no strip;
  `live === false` → hide. Missing `live` is treated as live. List
  members carry `listSlug`, never a request UUID.
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
