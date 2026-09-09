# Optional native-messaging host (not required)

The **supported** B path does **not** need native messaging. `Sync-MedicusSuite.ps1` copies bits; Suite reads `suite-release.json` / `sync-status.json` / `manifest.json` from the **local** Source via `chrome.runtime.getURL` and shows **Suite files updated — Reload**.

Use this stub only if practice IT wants the helper to poke the extension the instant a promote finishes *and* they are willing to add the `nativeMessaging` permission themselves. **The shipped `manifest.json` does not include `nativeMessaging`.** Without that permission, `connectNative` is a no-op and this host is unused.

## What the stub does

`MedicusSuiteNativeHost.ps1` speaks Chrome/Edge native-messaging framing on stdin/stdout. It answers `{ "type": "ping" }` with `{ "ok": true, "copiedVersion": "<from sync-status.json>" }`. It does **not** copy files (the scheduled script does that) and it does **not** call `reload()` (only the extension can).

## Register (Edge first, then Chrome if needed)

1. Edit `com.medicus.suite.sync.json` so `path` is the full path to `MedicusSuiteNativeHost.cmd`.
2. Edge (HKCU):

```bat
reg add "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.medicus.suite.sync" /ve /t REG_SZ /d "C:\full\path\to\com.medicus.suite.sync.json" /f
```

3. Chrome, only if that PC also Load unpacked Suite:

```bat
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.medicus.suite.sync" /ve /t REG_SZ /d "C:\full\path\to\com.medicus.suite.sync.json" /f
```

4. Add `"nativeMessaging"` to that PC's unpacked `manifest.json` permissions (local overlay — do not expect this in the GitHub zip) and reload the extension once.

Allowed origins in the host manifest must list the **unpacked extension ID**. That ID is derived from the folder path. If you ever Load unpacked from a different folder, the ID changes and this registration breaks — another reason the local path must stay `%LOCALAPPDATA%\MedicusSuite\extension`.
