# Practice install: local Source + OS sync (path B)

Printable one-pager for Pete: [`PETE-LOCAL-INSTALL-GUIDE.pdf`](PETE-LOCAL-INSTALL-GUIDE.pdf)
(HTML source: [`PETE-LOCAL-INSTALL-GUIDE.html`](PETE-LOCAL-INSTALL-GUIDE.html)).

Edge-first. Windows. Pete packs; practice IT (or Pete) schedules the copy. **The extension never copies its own files and never reads a UNC path to patch itself.**

| Channel | What it is | What it is not |
|---|---|---|
| **Bits** (this doc) | Extension files on disk. Helper copies `reference` → **local** Load unpacked folder. Suite notices a **newer** `manifest.json` / `suite-release.json` and shows **Suite files updated — Reload**. | Not Practice Profile. Not GitHub Releases. |
| **Practice Profile** | Settings only (`practice-profile.json`). | Does not unpack or replace extension files. |
| **GitHub update banner** | Options link to a public release zip. | Not Pete’s blessed tree. Hide it when a practice stamp is present. |

`chrome.runtime.reload()` only re-reads the **existing** Source path after an **external** actor has already changed those bytes. Unpacked extensions cannot change Source, cannot rewrite the install dir, and `requestUpdateCheck()` does nothing for Load unpacked.

---

## What Pete does

1. Unpack the release zip (or build tree) into a **staging** folder on the share, e.g. `\\PracticeShare\MedicusSuite\incoming\`.
2. Copy `tools/windows/suite-release.example.json` to `incoming\suite-release.json`. Set `"version"` to the same `manifest.json` version. Keep `"ready": false` until the copy is finished. Leave `"allowDowngrade": false` unless you are deliberately rolling back.
3. When the tree is complete, set `"ready": true`.
4. Atomically replace `\\PracticeShare\MedicusSuite\current\` with `incoming\` (rename swap). PCs must always read **`current`**, never a versioned folder name.
5. Do **not** ask staff to Load unpacked from the share. That is the slow path and is documented only as a legacy exception.

Publish **settings** separately (Options → Backup & Restore → Practice Profile). That JSON is settings. If you also keep `practice-profile.json` inside `current\`, the helper will copy it onto each local Source and the existing 15‑minute profile apply will see it **after** the helper has run — not because the extension pulled bits from the share.

---

## What each machine does (once)

1. Run `tools/windows/Sync-MedicusSuite.ps1` once (or copy `current\` by hand) so this folder exists:

   `%LOCALAPPDATA%\MedicusSuite\extension`

2. **Edge (NHS default):** `edge://extensions` → Developer mode → **Load unpacked** → select **that local folder**. Confirm Details → Source is the local path, not `\\server\...`.
3. Chrome, only if that PC uses Chrome: same steps on `chrome://extensions`, **same local folder**.
4. Pin the icon. Open Options once.
5. Register the logon task (once per PC, or GPO):

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File "\\PracticeShare\MedicusSuite\tools\windows\Register-SyncTask.ps1" -Reference "\\PracticeShare\MedicusSuite\current"
   ```

   Or Task Scheduler by hand:

   ```text
   Program: powershell.exe
   Arguments: -NoProfile -ExecutionPolicy Bypass -File "C:\path\to\Sync-MedicusSuite.ps1" -Reference "\\PracticeShare\MedicusSuite\current"
   Trigger: At logon (current user)
   ```

6. **Never Load unpacked from a new path.** Unpacked ID = folder path. A new folder wipes `chrome.storage` (settings, tour, everything).

Manual robocopy (equivalent to the script’s staging copy; still do **not** `/MIR` onto a live Source while Edge is open):

```bat
robocopy "\\PracticeShare\MedicusSuite\current" "%LOCALAPPDATA%\MedicusSuite\staging" /MIR /R:2 /W:5
```

Then promote only when Edge and Chrome are closed (the script checks this unless `-Force`).

---

## What happens on a normal day

1. At logon the task copies `current` → staging, verifies `suite-release.json` (`ready` + semver), refuses a **silent downgrade**, then rename-swaps onto the local Source if the browser is not running.
2. Share offline → script exits 0 and leaves the last good local tree.
3. Mid-publish (`ready` false) → no copy.
4. Edge already running with the old worker → files on disk may already be new (if someone ran the script with `-Force` or the browser was closed at logon). Suite polls the **local** stamps and shows **Suite files updated — Reload**. Click Reload, or wait until the machine is idle (existing polite reload). Older stamps are ignored.

Optional native messaging (poke the extension the instant a copy finishes) is documented in `tools/windows/native-host/README.md`. It is **not** required and is **not** in the shipped manifest.

---

## Legacy: Source *is* the share

If Details → Source is already `\\PracticeShare\...`, the old “everyone Load unpacked from the share” story still describes that PC: profile apply and the idle reload read files from that Source. It is slow. It is **not** the recommended install. Do not tell a local-Source PC to “point at the same shared folder.”

---

## Failure modes (short)

| Symptom | Action |
|---|---|
| Staff see a GitHub “View release” zip | Practice stamp missing; add `suite-release.json` to `current\`. |
| “Suite files updated” never appears | Helper has not promoted (browser open, share down, `ready` false, or same version). |
| Settings changed for everyone but UI looks old | Profile is settings; bits need a helper run + Reload. |
| Extension “forgot” everyone | Someone Load unpacked a different folder. Put Source back to the original local path. |
