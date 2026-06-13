# Public shopfront — setup & migration

**This file is private.** `sync-public.yml` excludes `docs/internal/`, so it
never reaches the public repo.

## The shape

Two repos:

| Repo | Visibility | Contains | Role |
|---|---|---|---|
| `davetriska02-collab/medicus-suite` | **private** (after migration) | Everything: full code **+** `.claude/` skills, agents, scheduled-tasks, `CLAUDE.md`, internal strategy docs | The workshop — where you and Claude develop |
| `davetriska02-collab/medicus-suite-public` | **public** | Full extension code, tests, CHANGELOG, README, safety docs. **No method.** | The shopfront — releases live here, users download here, the update-checker polls here |

On every push to `main` in the workshop, `.github/workflows/sync-public.yml`
mirrors a **sanitised** copy of the tree into the public repo. The public
repo's own `release.yml` then cuts a release whenever the manifest version is
new. The shipped extension's update-checker polls
`api.github.com/repos/davetriska02-collab/medicus-suite-public/releases/latest`.

### What the sync strips (never published)

- `.claude/` — all skills, agents, scheduled-tasks
- `CLAUDE.md`
- `docs/appraisal/`, `docs/benchmark/`, `docs/archive/`, `docs/internal/`
- `.github/workflows/sync-public.yml` (the sync mechanism itself)
- `.github/workflows/rule-currency.yml` (internal maintenance automation)

Everything else mirrors, including `docs/` safety files (HAZARD-LOG, SOUP,
CLINICAL-SAFETY-NOTICE, INTENDED-PURPOSE, sentinel-DISCLAIMER, etc.).

## One-time setup

1. **Create the public repo** `davetriska02-collab/medicus-suite-public`
   (public, empty — no README/licence, the sync provides them).

2. **Create a fine-grained Personal Access Token**
   - Resource owner: `davetriska02-collab`
   - Repository access: **Only** `medicus-suite-public`
   - Permissions: **Contents → Read and write**
   - Copy the token.

3. **Add the token as a secret on the workshop (private) repo**
   - `medicus-suite` → Settings → Secrets and variables → Actions → New repository secret
   - Name: `PUBLIC_SYNC_TOKEN`
   - Value: the PAT from step 2.

4. **Verify, before going private:**
   - Merge the `claude/private-repo-updates-0ob6vx` branch to `main`.
   - Confirm the `Sync to public repo` action succeeds and the public repo
     fills with the sanitised tree (and that `.claude/`, `CLAUDE.md`, the
     excluded docs are **absent**).
   - Confirm the public repo's `Release` action cuts `v3.64.1` with the zip
     attached.
   - Load the v3.64.1 unpacked build and confirm the Options-page update
     banner reads from the public repo without error.

5. **Flip the workshop private:** `medicus-suite` → Settings → General →
   Danger Zone → Change visibility → Private.

## Migration note (existing installs)

Extensions already installed in the field poll the **old** endpoint
(`medicus-suite/releases/latest`). Once you flip the workshop private, those
polls 404 and those users stop seeing update notifications until they install
a build that points at the public repo (v3.64.1+).

Because this is a small, sideloaded user base, the simplest path:

- Keep the workshop **public** until v3.64.1 has propagated (give it >24h so
  the daily checker fires), telling existing users to reinstall once from the
  new public releases page, **then** flip it private.
- Or, if you flip immediately, send a one-time "we've moved — reinstall from
  `medicus-suite-public`" message to current users.

## If you pick a different public repo name

Update all of these to match:
- `PUBLIC_REPO` env in `.github/workflows/sync-public.yml`
- the `if: github.repository == ...` guard in `.github/workflows/release.yml`
- `REPO_NAME` in `shared/update-checker.js` (+ its test in `test-update-checker.js`)
- the `api.github.com` entry in `manifest.json` `host_permissions`
- the releases link in `README.md`
