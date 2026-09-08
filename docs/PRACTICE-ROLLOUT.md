# Practice rollout — share is fine when it stays up

Two setups are valid. Pick per PC, not as a religion.

**Load unpacked from the practice share** works when that drive is already
mounted as Chrome or Edge starts. Plenty of surgery PCs do this all day
and never drop the suite. Updates are free: one gold folder, every machine
already pointed at it sees the new files.

**Load unpacked from a local clone** is for the PCs that *do* drop it after
a restart — typically Edge/Chrome in the startup list, racing Windows
mapping Y: / S:. Same suite. Different race. Those machines copy the gold
folder onto `%LOCALAPPDATA%\MedicusSuite` once, then (optionally) connect
automatic updates so later zips still land without walking the desk.

Pete's "wide drive" drop is the race. A machine that lives on the share
and survives reboot is not broken and should not be moved for dogma.

IT policy (Developer mode reset, allowlists) is a second, separate reason
it can vanish. Check that only after the path itself has been ruled in or
out: if a **local** copy still drops, it is policy; if only the share-load
drops, it is the mount race.

## Updates

- **Share-loaded PCs:** drop the new zip on the gold copy. Done.
- **Local-clone PCs:** connect gold + this-PC folders in Options → Backup
  & Restore → **Automatic updates from the gold copy** (or Use Task
  Presence folder + pick local). The service worker copies newer files
  every 15 minutes and on browser start, then reloads when idle.

`copy-to-this-pc.cmd` is the first-time (or emergency) copy onto a PC that
needs a local clone. It also works as a login script if you want a
belt-and-braces refresh.

## The two folders

| Folder | Where | What it is for |
|---|---|---|
| **Gold copy** | Practice share (Y:, S:, `\\server\...`) | Canonical files. New zips land here. `practice-profile.json`, presence, Knowledge. Share-loaded PCs Load unpacked from here. |
| **Local clone** | `%LOCALAPPDATA%\MedicusSuite` | Only on PCs that drop the share-load after restart. What those PCs Load unpacked. |

## Today — one PC that keeps dropping (Pete)

1. On the PC that is dropping the suite, open Suite Options → **Backup &
   Restore** → **Export entire suite**. Save the JSON somewhere local (Desktop
   is fine). A new Load-unpacked path is a new install and does not keep the
   old settings.
2. From the gold copy on the share, double-click `copy-to-this-pc.cmd`.
   It copies to `%LOCALAPPDATA%\MedicusSuite` (usually
   `C:\Users\<you>\AppData\Local\MedicusSuite`).
3. Edge: `edge://extensions`. Chrome: `chrome://extensions`.
4. Developer mode **on** (top right).
5. **Load unpacked** → pick `%LOCALAPPDATA%\MedicusSuite`. Confirm
   `manifest.json` is in that folder, not inside a subfolder.
6. **Import** the backup from step 1.
7. On the same extensions page, **Remove** the old share-load install.
8. Restart the PC. Open Edge/Chrome. The suite should still be there. If it
   is gone, skip to [If it still drops](#if-it-still-drops--it-policy).
9. Options → Backup & Restore → **Choose gold folder** (the share) and
   **Choose this PC's folder** (`%LOCALAPPDATA%\MedicusSuite`). Allow on
   every visit. Click **Sync now** once to prove it.

Pin the icon. Open a Medicus tab and confirm the side panel comes back.

Leave any PC that already survives reboot on the share exactly where it is.

## Then — the rest of the practice

On each PC, after a restart: is the suite still there?

- **Yes, and it is loaded from the share** — leave it. Pin the icon. Open
  Options once so the practice code can auto-detect.
- **No, or it vanishes after the next reboot** — follow the Pete steps
  above (about two minutes). Connect automatic updates so you do not walk
  that desk again.

Practice settings (rules, Knowledge, module defaults) live in
`practice-profile.json` on the gold copy. Publish with **Options → Backup
& Restore → Publish to shared folder**. Share-loaded PCs see it via the
folder they already load. Local-clone PCs see it after the next gold sync
(or `copy-to-this-pc`).

Task presence: Options → Task Presence → **Choose folder…** and pick the
**gold copy** (the share). That grant is File System Access, not the
Load-unpacked path. "Allow on every visit."

## Optional: login script for the local-clone PCs

A scheduled task or login script that runs the same copy is enough:

```bat
\\server\share\MedicusSuite\copy-to-this-pc.cmd
```

Or PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "\\server\share\MedicusSuite\copy-to-this-pc.ps1" -Quiet
```

`-Quiet` still copies; it just skips the "NEXT" instructions so a login
script does not hang on `pause`. The `.cmd` wrapper always pauses when
double-clicked; call the `.ps1` directly from Task Scheduler.

Once the local folder exists, Edge/Chrome keep loading from it. The script
only refreshes the files.

## If it still drops — IT policy

If a **local** `%LOCALAPPDATA%` install still vanishes after restart, the
share race is no longer the cause. Ask practice IT / CSU to look at:

1. `edge://policy` or `chrome://policy` on that PC. Screenshot the
   Extension and Developer-tools rows.
2. **DeveloperToolsAvailability** — if this is `2` (disallowed), Developer
   mode will not stay on and unpacked extensions will not persist.
3. **ExtensionInstallBlocklist** / **ExtensionInstallAllowlist** — a
   blocklist of `*` with no allowlist exception removes sideloaded
   extensions on every launch.
4. **ExtensionAllowedTypes** — if `extension` is omitted, unpacked
   extensions are stripped.
5. Whether a login item starts Edge/Chrome **before** the user profile
   finishes applying policy.

What to ask for, in one sentence: "Please allow this unpacked extension
to persist, or tell us the policy that is removing it." A Chrome Web Store
/ force-install CRX is the long-term enterprise path; it is not required
to get a practice live if Developer mode is allowed to stay on.

## What not to do

- Do not move a PC off the share if a restart already keeps the suite.
- Do not "fix" a dropping share-load by loading from the same share again
  and hoping. Copy local on *that* PC.
- Do not skip the Export before changing the Load-unpacked path. Unpacked
  extension IDs follow the folder path; a new path is a blank install.
- Do not put `practice-profile.json` only on one person's local clone.
  Publish it to the gold copy so every PC can see it.

## Check it worked

- After a full restart, `edge://extensions` (or Chrome) still shows
  Medicus Suite — share path or `%LOCALAPPDATA%\MedicusSuite`, whichever
  you chose for that PC.
- Opening a Medicus patient still shows the side panel / chips.
- Options → Backup & Restore → Practice Profile shows the published
  profile after a sync + Check for update (or within ~15 minutes).
