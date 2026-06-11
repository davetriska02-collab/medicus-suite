#!/usr/bin/env bash
# Medicus Suite — initial repo push
# Run from inside the unzipped medicus-suite-repo-init folder.
# Requires: git, and a GitHub Personal Access Token with "repo" scope.

set -e

REPO="davetriska02-collab/medicus-suite"

# Prompt for PAT (or set GH_PAT in your environment to skip the prompt)
if [ -z "$GH_PAT" ]; then
  read -rsp "GitHub PAT (repo scope): " GH_PAT
  echo ""
fi

if [ -z "$GH_PAT" ]; then
  echo "No PAT provided. Aborting."
  exit 1
fi

REMOTE="https://${GH_PAT}@github.com/${REPO}.git"

# Initialise repo if not already
if [ ! -d ".git" ]; then
  git init -b main
  git config user.email "dave@graysbrook.co.uk"
  git config user.name "Dave Triska"
fi

git add -A
git commit -m "Initial commit: Medicus Suite v1.3.1" || echo "(nothing to commit)"

# Set or update remote
git remote remove origin 2>/dev/null || true
git remote add origin "$REMOTE"

git push -u origin main

# Tag and push v1.3.1 — this triggers the GitHub Actions workflow which
# builds the release zip and publishes it as a GitHub release automatically.
git tag -f v1.3.1
git push origin v1.3.1 --force

echo ""
echo "Done. Watch the Actions tab on GitHub — within a minute or two the"
echo "release will be published with the zip attached. After that, the"
echo "in-extension update checker will pick it up on its next daily run."
echo ""
echo "https://github.com/${REPO}/actions"
echo "https://github.com/${REPO}/releases"
