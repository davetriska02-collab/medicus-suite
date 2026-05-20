# IT Slowness Tracker — Cloudflare Worker

This worker accepts session submissions from the static site and creates (then immediately closes) a GitHub Issue per session, keeping the GitHub PAT server-side.

## Prerequisites

- Node.js 18+
- Wrangler CLI: `npm i -g wrangler`
- A free Cloudflare account

## Deployment

### 1. Log in to Cloudflare

```bash
wrangler login
```

### 2. Set the GitHub token secret

Create a fine-grained GitHub PAT scoped to `davetriska02-collab/medicus-suite` with **Issues: Read & Write** permission only. Then run:

```bash
wrangler secret put GITHUB_TOKEN
```

Paste the token when prompted. It is stored encrypted in Cloudflare and never appears in source control.

### 3. Deploy the worker

From inside the `worker/` directory:

```bash
wrangler deploy
```

Wrangler will print the deployed URL, e.g.:

```
https://it-slowness-proxy.YOURNAME.workers.dev
```

### 4. Wire up the frontend

Copy that URL into `it-slowness-tracker/config.json` as the value of `workerUrl`:

```json
{
  "workerUrl": "https://it-slowness-proxy.YOURNAME.workers.dev"
}
```

Commit and push; the GitHub Pages site will pick it up on next load.

## Token rotation

No redeployment is needed. Simply run:

```bash
wrangler secret put GITHUB_TOKEN
```

Enter the new token. Cloudflare applies it immediately to all running instances.
