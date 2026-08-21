# CRX packaging

Medicus Suite can be issued as a signed Chrome / Edge **CRX3** for practice IT,
with a **stable extension id** that will match the Chrome Web Store listing if
Dave uploads the same private key when he creates the store item.

## Extension id

```
mnbhphomkajfoabindnmndboiipofnko
```

Pinned in `packaging/extension-id.txt`. Derived from `packaging/extension.pub.pem`.
Give this string to IT. It does not change between versions.

## What IT actually need

See [`docs/IT-ENTERPRISE-INSTALL.md`](../docs/IT-ENTERPRISE-INSTALL.md) — that is
the page to forward. Short version:

- Yes, we can give them a `.crx` and an id **now**.
- Modern Chrome / Edge will **not** install a `.crx` by double-click. They
  force-install it with enterprise policy (Intune / Chrome ADMX) pointing at
  an HTTPS `updates.xml` they host, **or** they wait for the Web Store and
  force-install by this same id.
- The store id is **not** imminent on its own. It appears the moment Dave
  creates a Chrome Web Store draft and uploads a zip (even before review).
  Upload `packaging/extension.pem` as the item's existing key so the store
  keeps `mnbhphomkajfoabindnmndboiipofnko`.

## Signing key (maintainers only)

The **private** key is `packaging/extension.pem` (gitignored) or the
`CRX_PRIVATE_KEY` GitHub Actions secret.

- Never commit the PEM. Never paste it into a PR.
- Losing it means a new id, and IT have to change their allow-list.
- The packer refuses to sign with a key that does not match
  `extension-id.txt` / `extension.pub.pem`.

Add the secret (repo → Settings → Secrets → Actions):

```
Name: CRX_PRIVATE_KEY
Value: the full PEM, including BEGIN/END lines
```

## Commands

```bash
# Local pack (needs packaging/extension.pem)
node scripts/pack-crx.js --zip --crx

# Print the id
node scripts/pack-crx.js --print-id

# Release workflow does the same; skips the CRX if the secret is missing
```
