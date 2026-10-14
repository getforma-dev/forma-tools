#!/usr/bin/env bash
set -euo pipefail

# Build the SSR e2e site: compile each case with THIS repo's compiler and build
# package, render it with forma's Rust walker and page template, and leave the
# result in e2e/ssr/out/site/ for e2e/ssr/serve.mjs.
#
#   FORMAJS_DIR  FormaJS checkout, already built (e2e/sync-fixtures.sh builds it).
#                Default: ../formajs beside this repo.
#   FORMA_DIR    forma checkout (forma-ir, forma-server). Default: ../forma.
#
# Needs Node and cargo. Every step fails loudly; nothing is skipped.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
FORMAJS_DIR="${FORMAJS_DIR:-$REPO_DIR/../formajs}"
FORMA_DIR="${FORMA_DIR:-$REPO_DIR/../forma}"

for dir_var in FORMAJS_DIR FORMA_DIR; do
  if [ ! -d "${!dir_var}" ]; then
    echo "Error: $dir_var not found at ${!dir_var}" >&2
    exit 1
  fi
done
FORMAJS_DIR="$(cd "$FORMAJS_DIR" && pwd)"
FORMA_DIR="$(cd "$FORMA_DIR" && pwd)"

if [ ! -f "$FORMAJS_DIR/dist/index.js" ]; then
  echo "Error: $FORMAJS_DIR/dist/index.js not found; build FormaJS first (e2e/sync-fixtures.sh does)" >&2
  exit 1
fi
for crate in forma-ir forma-server; do
  if [ ! -f "$FORMA_DIR/crates/$crate/Cargo.toml" ]; then
    echo "Error: $FORMA_DIR/crates/$crate/Cargo.toml not found; FORMA_DIR must be a getforma-dev/forma checkout" >&2
    exit 1
  fi
done

echo "FormaJS: $FORMAJS_DIR ($(git -C "$FORMAJS_DIR" rev-parse --short HEAD 2>/dev/null || echo 'not a git checkout'))"
echo "forma:   $FORMA_DIR ($(git -C "$FORMA_DIR" rev-parse --short HEAD 2>/dev/null || echo 'not a git checkout'))"

# The cases import '@getforma/core'; resolve it to the FormaJS checkout under test.
mkdir -p "$SCRIPT_DIR/node_modules/@getforma"
ln -sfn "$FORMAJS_DIR" "$SCRIPT_DIR/node_modules/@getforma/core"

# The compiler and build package under test are this working tree's.
(cd "$REPO_DIR" && npm run build > /dev/null)

node "$SCRIPT_DIR/build-cases.mjs"

# render/Cargo.toml depends on forma's crates through this link.
ln -sfn "$FORMA_DIR" "$SCRIPT_DIR/render/forma"
# Cargo fingerprints a path dependency by its files' mtimes, not by where the
# link points: after re-pointing it at an OLDER checkout, cargo would reuse the
# previous walker and the pages would be rendered by the wrong forma. Rebuild
# forma's two crates every time (a few seconds) so the walker is FORMA_DIR's.
cargo clean --quiet --manifest-path "$SCRIPT_DIR/render/Cargo.toml" \
  -p forma-ir -p forma-server -p forma-e2e-render
# --locked: render/Cargo.lock is the only pin of the crates this job compiles
# (forma commits no lockfile). When forma's crates add or change a dependency
# this fails loudly; refresh the lock by running
#   cargo build --manifest-path e2e/ssr/render/Cargo.toml
# once without --locked, and commit render/Cargo.lock.
cargo run --quiet --locked --manifest-path "$SCRIPT_DIR/render/Cargo.toml" -- \
  "$SCRIPT_DIR/cases" "$SCRIPT_DIR/out/build" "$SCRIPT_DIR/out/site"

echo "✓ SSR e2e site built in $SCRIPT_DIR/out/site/"
