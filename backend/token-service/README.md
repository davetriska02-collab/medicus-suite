# Medicus Suite — Transactional API token service

A tiny Cloudflare Worker that is the **only** place the private signing key lives at
runtime. It mints OAuth access tokens for the Medicus Transactional API using the
`private_key_jwt` flow, so the private key never touches the extension bundle or the repo.

```
caller ──POST /token (Bearer CALLER_TOKEN)──▶  Worker
                                                 │  signs a client-assertion JWT (RS256)
                                                 │  with PRIVATE_KEY_PEM
                                                 ▼
                                        Medicus token endpoint
                                                 │  returns access_token
                                                 ▼
caller ◀────────── { access_token } ─────────────
```

The caller then uses that short-lived `access_token` as a normal `Authorization: Bearer`
header against the Transactional API. Access tokens are disposable; the private key stays
locked in the Worker.

## What's a secret vs. what's config

| Where | Value | How it's set |
|---|---|---|
| **Secret** | `PRIVATE_KEY_PEM` | `npx wrangler secret put PRIVATE_KEY_PEM` |
| **Secret** | `CALLER_TOKEN` | `npx wrangler secret put CALLER_TOKEN` |
| Config (`wrangler.toml`) | `KEY_ID`, `CLIENT_ID`, `TOKEN_ENDPOINT`, `TOKEN_AUDIENCE`, `SCOPE` | edit `[vars]` |

The `TODO-from-medicus` values in `wrangler.toml` come straight from the Transactional API
docs — fill them in once Tim confirms the client id, token URL, and required `aud`.

## Setup

```bash
cd backend/token-service
npm install

# generate a strong caller secret and store it
openssl rand -hex 32          # paste the output when prompted below
npx wrangler secret put CALLER_TOKEN

# store the private key (paste the PKCS#8 PEM when prompted)
npx wrangler secret put PRIVATE_KEY_PEM

# edit wrangler.toml [vars] with the Medicus values, then:
npx wrangler deploy
```

> 🔑 **Best practice:** generate a *fresh* key pair on the machine doing this setup
> (`openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out private-key.pem`),
> put **that** key in the Worker, and publish its public half in `jwks-public/`. That way
> the production key never travels through email/chat. The key currently in the JWKS was
> generated in a throwaway environment — rotate it before go-live (see
> `jwks-public/README.md`).

## Local dev

```bash
cp .dev.vars.example .dev.vars   # fill in real values; .dev.vars is git-ignored
npx wrangler dev
curl -s -X POST http://localhost:8787/token \
  -H "Authorization: Bearer <your CALLER_TOKEN>" | jq .
```

## Notes / next steps

- The access token is cached in memory per Worker isolate and refreshed ~60s before expiry.
- `/token` is guarded by `CALLER_TOKEN`. Lock it down further (mTLS, IP allow-list, or
  Cloudflare Access) before production — it mints credentials to patient data.
- This scaffold assumes the standard OAuth client_credentials + private_key_jwt shape.
  If the Medicus docs describe a different flow (e.g. the signed JWT *is* the bearer
  token, with no exchange step), simplify `getAccessToken` accordingly.
