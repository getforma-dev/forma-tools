#!/usr/bin/env bash
set -euo pipefail

# Sync FormaJS builds into E2E test fixtures.
# Called automatically by `npm run test:e2e` — no manual copy needed.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FIXTURES_DIR="$SCRIPT_DIR/fixtures"
FORMAJS_DIR="${FORMAJS_DIR:-$(cd "$SCRIPT_DIR/../../formajs" && pwd)}"

if [ ! -d "$FORMAJS_DIR" ]; then
  echo "Error: FormaJS directory not found at $FORMAJS_DIR"
  echo "Set FORMAJS_DIR environment variable to the formajs repo path."
  exit 1
fi

echo "Building FormaJS..."
(cd "$FORMAJS_DIR" && npm run build) > /dev/null 2>&1

echo "Copying fixtures..."
cp "$FORMAJS_DIR/dist/formajs-runtime.global.js" "$FIXTURES_DIR/"
cp "$FORMAJS_DIR/dist/formajs.global.js" "$FIXTURES_DIR/"

echo "✓ E2E fixtures synced from $FORMAJS_DIR/dist/"
