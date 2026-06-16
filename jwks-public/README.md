# Medicus Suite — Transactional API JWKS (public)

This folder contains the **public** key material for authenticating to the Medicus
Transactional API using the `private_key_jwt` flow. Everything here is safe to publish —
it is **public keys only**. The matching private signing key is **never** stored in this
repository (see `.gitignore`); it must live in a secret manager / token-minting backend.

## Files

| File | Purpose |
|---|---|
| `.well-known/jwks.json` | The JSON Web Key Set served to Medicus for signature verification. |
| `.nojekyll` | Forces GitHub Pages to serve the `.well-known/` dotfolder (Jekyll skips dotfiles otherwise). |

## How the auth works

1. We hold a private RSA key (RS256) in a secure backend — **not** in the extension bundle.
2. We publish the matching public key as the JWKS in this folder.
3. To call the API, the backend mints a short-lived JWT signed with the private key,
   carrying the `kid` of the published key in its header.
4. Medicus fetches our **JWKS URL**, finds the key by `kid`, and verifies the signature.
   No shared secret is ever exchanged.

## Publishing this as the JWKS URL (GitHub Pages)

> ⚠️ Do **not** point GitHub Pages at this repo's `/docs` folder — it contains internal
> documents (DPIA, security audits, hazard log). Publish from a dedicated branch that
> contains **only** the contents of `jwks-public/`.

Recommended one-time setup (creates an isolated `gh-pages` branch with only these files):

```bash
# from a clean checkout of main
git switch --orphan gh-pages
git rm -rf . >/dev/null 2>&1 || true
git checkout claude/api-access-setup-q8bl8l -- jwks-public
mv jwks-public/* jwks-public/.[!.]* . 2>/dev/null
rmdir jwks-public
git add -A && git commit -m "Publish Transactional API JWKS"
git push -u origin gh-pages
```

Then in **Settings → Pages**, set **Source = Deploy from a branch**, **Branch = `gh-pages` / `(root)`**.

The resulting JWKS URL to give Medicus will be:

```
https://davetriska02-collab.github.io/medicus-suite/.well-known/jwks.json
```

Verify it serves correctly before sending it to Tim:

```bash
curl -s https://davetriska02-collab.github.io/medicus-suite/.well-known/jwks.json | jq .
```

## Key rotation

To rotate: generate a new key pair, **add** the new public JWK to the `keys` array
(keep the old one until all in-flight tokens expire), deploy, switch signing to the new
`kid`, then remove the old key on the next deploy.
