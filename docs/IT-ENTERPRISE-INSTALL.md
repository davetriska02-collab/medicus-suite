# Medicus Suite — enterprise install (for practice IT)

**Product:** Medicus Suite  
**Publisher:** Dr Dave Triska / Graysbrook Ltd  
**Chrome / Edge extension id:** `mnbhphomkajfoabindnmndboiipofnko`  
**Package:** `medicus-suite-vX.Y.Z.crx` (CRX3, signed)

This note is for ICB / practice IT who have agreed to install the extension
ahead of a Chrome Web Store listing.

## What to put on the allow-list

| Field | Value |
|---|---|
| Extension name | Medicus Suite |
| Extension identifier | `mnbhphomkajfoabindnmndboiipofnko` |
| Package type | Chrome / Edge CRX3 |
| Host permissions | `https://*.medicus.health/*`, NHS terminology hosts listed in the manifest |

That id is **stable**. Every CRX we issue, and the future Web Store listing
(once published with the same signing key), uses this identifier. You will not
need to change the allow-list when we ship a new version.

## How installation actually works

A `.crx` is the official packed form. **Chrome and Edge no longer install a
`.crx` from a double-click or a drag onto `chrome://extensions`.** That has
been blocked for years. Two supported routes:

### 1. Force-install from a file you host (works today)

1. Put the `.crx` on an **HTTPS** intranet path your managed browsers can
   reach (SharePoint will not do — it needs a raw file URL).
2. Next to it, host an update manifest (copy
   [`packaging/updates.xml.example`](../packaging/updates.xml.example)):

```xml
<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='mnbhphomkajfoabindnmndboiipofnko'>
    <updatecheck
      codebase='https://YOUR-INTRANET.example.nhs.uk/apps/medicus-suite.crx'
      version='3.236.16' />
  </app>
</gupdate>
```

3. In Chrome or Edge enterprise policy (Intune / ADMX / registry), force-install:

```
mnbhphomkajfoabindnmndboiipofnko;https://YOUR-INTRANET.example.nhs.uk/apps/updates.xml
```

Chrome ADMX: **ExtensionInstallForcelist**  
Edge ADMX: the same policy name under Microsoft Edge.  
Intune Settings Catalog equivalent: **Extension management settings** /
`ExtensionSettings` — see [`packaging/extension-settings.json.example`](../packaging/extension-settings.json.example).

Bump `version` in `updates.xml` when you replace the `.crx`. Managed browsers
then update themselves.

### 2. Chrome Web Store (when the listing is live)

Force-install the **same id** from the store. Update URL becomes
`https://clients2.google.com/service/update2/crx`. No file hosting on your
side. Until that listing exists, use route 1.

## What this is not

- **Not an App Store / Play Store / Microsoft Store package.** Chrome
  extensions are not published there. The store in question is the
  [Chrome Web Store](https://chromewebstore.google.com/).
- **Not a user-sideload.** Please do not ask clinicians to open Developer
  mode. That is the unofficial unpacked zip path, not the managed path.
- **Not a different id per version.** If a pack arrives with a different
  32-character id, it is not from us — discard it.

## Verification

Each GitHub release attaches `SHA256SUMS.txt`. On a workstation:

```bash
sha256sum -c SHA256SUMS.txt
```

The CRX header is signed with the publisher key whose public half is
`packaging/extension.pub.pem` in the source repository.

## Support

Dave Triska — davetriska02@gmail.com  
Source and release notes: the practice's Medicus Suite GitHub repository.
