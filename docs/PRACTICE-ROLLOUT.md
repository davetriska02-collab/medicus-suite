# Practice rollout — keep the suite on the machine, not the share

This is the playbook for rolling Medicus Suite out across a practice without
it vanishing after a restart. It is written for the person doing the first
install (Pete's case: loaded from a mapped / Y: / "wide" drive, then Chrome
or Edge dropped it on reboot) and for whoever then copies it onto the rest
of the PCs.

## Why it works on your drive (and not Pete's)

A local disk — C:, `D:\`, `%LOCALAPPDATA%`, a laptop folder you never
unmap — is already there when Chrome or Edge starts. The browser re-reads
the unpacked folder at launch, finds `manifest.json`, and keeps the
extension. That is why a home PC or a surgery PC that Load-unpacked from
its own disk stays stable across restart.

Pete's Y: / wide / practice share is a **mapped network drive**. Windows
often maps it *after* the browser has already started (especially if Edge
is in the startup list). The folder looks missing for a few seconds, and
Chrome/Edge drop the unpacked extension. Developer mode can still look on.
The next launch does not put it back.

Same suite. Different path. The share is not "wrong" — it is the wrong
place to **Load unpacked** from.

IT policy (Developer mode reset, allowlists) is a second, separate reason
it can vanish. Check that only after a **local** copy still drops.

The share stays the **gold copy**: `practice-profile.json`, presence,
Knowledge, and new zips. It is not the folder the browser should load from.

## Updates without walking every desk

Load unpacked is **once per PC**. After that, connect the gold folder and
this PC's folder in Options → Backup & Restore → **Automatic updates from
the gold copy** (or click **Use Task Presence folder** if presence already
points at the gold copy). The service worker copies newer files every 15
minutes and on browser start, then reloads when the PC is idle — the same
polite reload the suite already used when everyone loaded from the share.

Staff do not open `edge://extensions` on each release. An admin drops the
new zip on the gold copy; each connected PC pulls it.

`copy-to-this-pc.cmd` is still the first-time (or emergency) copy, and
still works as a login script if you want a belt-and-braces refresh.

## The two folders

| Folder | Where | What it is for |
|---|---|---|
| **Gold copy** | Practice share (Y:, S:, `\\server\...`) | One canonical set of files. Admins drop a new zip here. `practice-profile.json` lives here. Presence / Knowledge publish here. |
| **Local clone** | `%LOCALAPPDATA%\MedicusSuite` on each PC | What Edge/Chrome **Load unpacked**. Survives restart because it is on the disk that is already there when the browser starts. |

A double-click script does the copy: `copy-to-this-pc.cmd` in the gold
folder. It robocopies onto this PC and prints the path to Load unpacked.

Re-run that script after a suite update (or as a Windows login script). The
suite already watches `manifest.json` on the loaded folder and reloads
itself when the PC is idle, so a login-time copy is enough for code updates
to land.

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
7. On the same extensions page, **Remove** the old install whose source is
   the share / Y: / `\\server\...`. Leave only the local one.
8. Restart the PC. Open Edge/Chrome. The suite should still be there. If it
   is gone, skip to [If it still drops](#if-it-still-drops--it-policy).
9. Options → Backup & Restore → **Choose gold folder** (the share) and
   **Choose this PC's folder** (`%LOCALAPPDATA%\MedicusSuite`). Allow on
   every visit. Click **Sync now** once to prove it.

Pin the icon. Open a Medicus tab and confirm the side panel comes back.

## Then — the rest of the practice

Do this once per PC. About two minutes after the first one.

1. Double-click `copy-to-this-pc.cmd` on the gold copy (or run it as a
   login script so you never touch each desk again).
2. Load unpacked from `%LOCALAPPDATA%\MedicusSuite`. Developer mode on.
3. Pin the icon. Open Options once so the practice code can auto-detect
   from a Medicus tab.
4. **Do not** Load unpacked from the share on these PCs either.
5. Connect gold + this-PC folders (or Use Task Presence folder + pick local).
   That is the last time that person touches extensions settings.

Practice settings (rules, Knowledge, module defaults) do **not** require
everyone to load from the share. Publish them with **Options → Backup &
Restore → Publish to shared folder** onto the gold copy's
`practice-profile.json`. Connected PCs copy that file on the next start or
within about 15 minutes.

Task presence: Options → Task Presence → **Choose folder…** and pick the
**gold copy** (the share). That grant is File System Access, not the
Load-unpacked path. "Allow on every visit."

## Optional: login script so you never walk the desks again

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
share is no longer the cause. Ask practice IT / CSU to look at:

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
   finishes applying policy (less common once the folder is local).

What to ask for, in one sentence: "Please allow this unpacked extension
from `%LOCALAPPDATA%\MedicusSuite` to persist, or tell us the policy that
is removing it." A Chrome Web Store / force-install CRX is the long-term
enterprise path; it is not required to get a practice live if Developer
mode is allowed to stay on.

IT did not invent the drop-on-reboot from a Y: drive. That is the browser.
IT may still be a second, separate reason it will not stay loaded once it
is local.

## What not to do

- Do not Load unpacked from `Y:\`, `S:\`, `\\server\share`, or a USB stick.
- Do not "fix" a dropped install by loading from the share again. It will
  drop the next time the PC sleeps or restarts.
- Do not skip the Export before changing the Load-unpacked path. Unpacked
  extension IDs follow the folder path; a new path is a blank install.
- Do not put `practice-profile.json` only on one person's local clone.
  Publish it to the gold copy so every PC can sync it.

## Check it worked

- After a full restart, `edge://extensions` (or Chrome) still shows
  Medicus Suite, source path under `%LOCALAPPDATA%\MedicusSuite`.
- Opening a Medicus patient still shows the side panel / chips.
- Options → Backup & Restore → Practice Profile shows the published
  profile after a copy + Check for update (or within ~15 minutes).
- A second PC, same gold copy, same local path, same result after restart.
