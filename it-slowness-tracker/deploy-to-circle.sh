#!/usr/bin/env bash
set -euo pipefail

TRACKER_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST_REPO="https://github.com/davetriska02-collab/circle-of-death-tracker.git"
WORK_DIR="$(mktemp -d)"

echo "==> Cloning circle-of-death-tracker..."
git clone "$DEST_REPO" "$WORK_DIR/circle-of-death-tracker"
cd "$WORK_DIR/circle-of-death-tracker"

echo "==> Copying tracker files..."
cp -r "$TRACKER_DIR"/.nojekyll \
      "$TRACKER_DIR"/index.html \
      "$TRACKER_DIR"/app.css \
      "$TRACKER_DIR"/app.js \
      "$TRACKER_DIR"/storage.js \
      "$TRACKER_DIR"/config.json \
      .

cp -r "$TRACKER_DIR"/admin   ./admin
cp -r "$TRACKER_DIR"/worker  ./worker
cp -r "$TRACKER_DIR"/analytics ./analytics

# Remove the deploy script itself — it belongs in medicus-suite, not here
rm -f deploy-to-circle.sh

echo "==> Committing..."
git add -A
git commit -m "Add IT Slowness Tracker (Cranleigh + Guildowns)"

echo "==> Pushing to main..."
git push origin main

echo ""
echo "Done. Files are live at:"
echo "  https://github.com/davetriska02-collab/circle-of-death-tracker"
echo ""
echo "Next: enable GitHub Pages in the repo settings:"
echo "  Settings → Pages → Source: main branch, / (root)"
echo "  Your app URL will be: https://davetriska02-collab.github.io/circle-of-death-tracker/"
echo ""
echo "Cleaning up temp dir..."
rm -rf "$WORK_DIR"
