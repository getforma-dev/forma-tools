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
RUNTIME_BUNDLE="$FORMAJS_DIR/dist/formajs-runtime.global.js"
ESM_BUNDLE="$FORMAJS_DIR/dist/forma.esm.js"
ESBUILD_BIN="$FORMAJS_DIR/node_modules/.bin/esbuild"

for required_file in "$RUNTIME_BUNDLE" "$ESM_BUNDLE" "$ESBUILD_BIN"; do
  if [ ! -f "$required_file" ]; then
    echo "Error: required FormaJS build input not found at $required_file"
    exit 1
  fi
done

cp "$RUNTIME_BUNDLE" "$FIXTURES_DIR/formajs-runtime.global.js"
"$ESBUILD_BIN" "$ESM_BUNDLE" \
  --bundle --format=iife --global-name=FormaJS --target=es2022 \
  --outfile="$FIXTURES_DIR/formajs.global.js"

node -e "
  const source = require('fs').readFileSync('$FIXTURES_DIR/formajs.global.js', 'utf8');
  if (!/var FormaJS\\s*=/.test(source)) {
    console.error('Error: rebuilt formajs.global.js does not define the FormaJS global.');
    process.exit(1);
  }
"

echo "✓ E2E fixtures synced from $FORMAJS_DIR/dist/"
