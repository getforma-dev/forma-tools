#!/usr/bin/env bash
set -euo pipefail

# Build the preview-frame e2e lane (FORMA-175): pack @getforma/core from a
# FormaJS checkout as npm publishes it, install the tarball into the fixture
# application (e2e/frame/app) as an application installs it, build that
# application with THIS repo's @getforma/build (`previewFrame: true`, and
# without it), and build the Rust server (e2e/frame/server) that embeds the
# output and serves forma-server's `PageResponse::frame` from it, for
# e2e/frame/frame.spec.ts.
#
#   FORMAJS_DIR  FormaJS checkout, already built (e2e/sync-fixtures.sh builds
#                it); its dist must hold formajs-frame.global.js (core 2.1.0,
#                FORMA-128). Default: ../formajs beside this repo.
#   FORMA_DIR    forma checkout (forma-server's frame.rs, FORMA-125).
#                Default: ../forma.
#
# Needs Node, npm and cargo. Every step fails loudly; nothing is skipped.

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

if [ ! -f "$FORMAJS_DIR/dist/formajs-frame.global.js" ]; then
  echo "Error: $FORMAJS_DIR/dist/formajs-frame.global.js not found; build FormaJS first (e2e/sync-fixtures.sh does), from a checkout with the frame runtime (FORMA-128)" >&2
  exit 1
fi
if [ ! -f "$FORMA_DIR/crates/forma-server/src/frame.rs" ]; then
  echo "Error: $FORMA_DIR/crates/forma-server/src/frame.rs not found; FORMA_DIR must be a getforma-dev/forma checkout with the preview frame (FORMA-125)" >&2
  exit 1
fi

echo "FormaJS: $FORMAJS_DIR ($(git -C "$FORMAJS_DIR" rev-parse --short HEAD 2>/dev/null || echo 'not a git checkout'))"
echo "forma:   $FORMA_DIR ($(git -C "$FORMA_DIR" rev-parse --short HEAD 2>/dev/null || echo 'not a git checkout'))"

OUT="$SCRIPT_DIR/out"
rm -rf "$OUT" "$SCRIPT_DIR/app/node_modules"
mkdir -p "$OUT/pack"

# The packed tarball, as npm publishes core: its `files` decide what an
# application receives, so a frame runtime left out of the package fails here.
(cd "$FORMAJS_DIR" && npm pack --ignore-scripts --silent --pack-destination "$OUT/pack" > /dev/null)
TARBALL="$(ls "$OUT"/pack/getforma-core-*.tgz)"
npm install --prefix "$SCRIPT_DIR/app" --no-save --no-package-lock --ignore-scripts --no-audit --no-fund "$TARBALL" > /dev/null
echo "core:    $(node -p "require('$SCRIPT_DIR/app/node_modules/@getforma/core/package.json').version") from $(basename "$TARBALL")"

# The build package under test is this working tree's.
(cd "$REPO_DIR" && npm run build > /dev/null)

node "$SCRIPT_DIR/build-app.mjs"

# server/Cargo.toml depends on forma's crates through this link. As in the
# SSR lane (e2e/ssr/build.sh), cargo fingerprints a path dependency by its
# files' mtimes, not by where the link points, and the server embeds the
# output at compile time: rebuild forma's two crates and the server every time.
ln -sfn "$FORMA_DIR" "$SCRIPT_DIR/server/forma"
cargo clean --quiet --manifest-path "$SCRIPT_DIR/server/Cargo.toml" \
  -p forma-ir -p forma-server -p forma-e2e-frame
# --locked: server/Cargo.lock is the only pin of the crates this lane
# compiles (forma commits no lockfile). When forma's crates add or change a
# dependency this fails loudly; refresh the lock by running
#   cargo build --manifest-path e2e/frame/server/Cargo.toml
# once without --locked, and commit server/Cargo.lock.
cargo build --quiet --locked --manifest-path "$SCRIPT_DIR/server/Cargo.toml"

echo "✓ preview-frame e2e lane built: $OUT, $SCRIPT_DIR/server/target/debug/forma-e2e-frame"
