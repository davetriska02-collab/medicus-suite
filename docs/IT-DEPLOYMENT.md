# IT Deployment — managed install of Medicus Suite (.crx)

This page is for the IT team deploying Medicus Suite to managed machines, plus a
maintainer section on key custody. The extension is not yet on the Chrome Web
Store; it is self-hosted from this repository's GitHub releases.

## The numbers IT asked for

|                              |                                                                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Extension ID**             | `chmahnaddhlahghnbbgambgckmmdfmgj`                                                                                                 |
| **Update URL (policy feed)** | `https://github.com/davetriska02-collab/medicus-suite/releases/latest/download/update.xml`                                         |
| **.crx download**            | `medicus-suite-v<version>.crx` asset on the [latest release](https://github.com/davetriska02-collab/medicus-suite/releases/latest) |
| **Checksums**                | `SHA256SUMS.txt` asset on the same release                                                                                         |

The extension ID is permanent: it is derived from the signing key, and stays the
same across every version. The update URL is also permanent — GitHub redirects
`releases/latest/download/` to the newest release, so once policy is set,
machines auto-update as new versions are released (Chrome polls the feed every
few hours).

## Deploying (Chrome, managed Windows)

Off-store extensions cannot be installed by double-clicking a .crx — Chrome only
accepts them via enterprise policy on managed machines, which is the route IT
will be using anyway. Force-install via either policy:

**`ExtensionInstallForcelist`** (GPO: _Computer Configuration → Administrative
Templates → Google → Google Chrome → Extensions → Configure the list of
force-installed apps and extensions_), one entry:

```
chmahnaddhlahghnbbgambgckmmdfmgj;https://github.com/davetriska02-collab/medicus-suite/releases/latest/download/update.xml
```

**Or `ExtensionSettings`** (JSON policy, gives finer control):

```json
{
  "chmahnaddhlahghnbbgambgckmmdfmgj": {
    "installation_mode": "force_installed",
    "update_url": "https://github.com/davetriska02-collab/medicus-suite/releases/latest/download/update.xml"
  }
}
```

Use `"installation_mode": "normal_installed"` instead if users should be able to
disable it. If `ExtensionInstallBlocklist` contains `*`, the force-list entry
still wins — no extra allowlisting needed.

**Microsoft Edge:** the same extension runs unchanged; the equivalent policies
are `ExtensionInstallForcelist` / `ExtensionSettings` under the Edge ADMX, with
the identical `id;update-url` string.

**Network prerequisite:** clients must be able to reach
`https://github.com` and `https://objects.githubusercontent.com` (release asset
downloads redirect there). If GitHub is blocked, IT can instead host the .crx
and `update.xml` on an internal web server — edit `update.xml`'s `codebase` URL
to the internal location and point the policy at the internal `update.xml`.
Serving it from an intranet URL needs no MIME configuration beyond
`application/x-chrome-extension` for the .crx (most servers work without this,
since Chrome fetches it via the update mechanism, not the browser UI).

**Verifying an install:** on a deployed machine, `chrome://extensions` should
show _Medicus Suite_ with ID `chmahnaddhlahghnbbgambgckmmdfmgj` and "Installed
by your administrator". `chrome://policy` shows the force-list entry.

For what the extension does, its permissions, and data handling, see
[SECURITY.md](../SECURITY.md) and the [README](../README.md).

## Maintainer section (Dave / future Claude sessions)

### Building a .crx

```
npm run pack:crx
```

Outputs `dist/medicus-suite-v<version>.crx` and `dist/update.xml`, signed with
`keys/medicus-suite.pem`. The script self-verifies the signature and prints the
extension ID; file selection is `git ls-files` minus the same exclude list as
the release zip in `.github/workflows/release.yml` — **keep the two lists in
sync**.

### Key custody — read before touching `keys/`

- `keys/medicus-suite.pem` is the RSA signing key. **The extension ID is the
  hash of its public key.** A regenerated key = a different extension ID = every
  policy entry breaks and installed copies stop updating. Never regenerate;
  never commit (it is gitignored); keep an offline copy.
- CI needs the same key: paste the PEM into the repo's Actions secret
  **`CRX_PRIVATE_KEY`** (_Settings → Secrets and variables → Actions_). With the
  secret set, every release automatically gets `medicus-suite-v<version>.crx` +
  `update.xml` attached and managed installs auto-update. Without it, releases
  are zip-only and the crx step skips itself.
- If the key is ever compromised, treat it as an incident: a holder can push a
  malicious "update" to any machine whose policy trusts the update URL feed
  _and_ can sign packages with the stolen key. Rotate (new key, new ID), issue
  IT a new policy string, and remove the old force-list entry.

### Chrome Web Store, when we get there

A Web Store upload normally gets a **new** store-generated ID. To keep
`chmahnaddhlahghnbbgambgckmmdfmgj` (and with it users' `chrome.storage.local`
data and IT's policy entries), the **first** zip uploaded to the Web Store must
contain this same key: copy `keys/medicus-suite.pem` into the zip root as
`key.pem`. After that first upload the store holds the association and `key.pem`
must not be included again. Once store-published, IT can switch policy to the
store listing (drop the update URL from the force-list entry) at leisure —
the ID being identical means the transition is invisible to users.
