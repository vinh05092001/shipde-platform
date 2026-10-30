#!/usr/bin/env bash
# Installs the pinned repomix outside the workspace (no lockfile change) and
# runs the live context-pack proof through tools/ai-brain/context-pack.js.
set -euo pipefail
VERSION=1.18.1
HOME_DIR="${REPOMIX_HOME:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/shipde-repomix-$VERSION}"
BIN="$HOME_DIR/node_modules/.bin/repomix"
case "$(uname -s)" in MINGW* | MSYS* | CYGWIN*) BIN="$BIN.cmd" ;; esac
if [ ! -f "$HOME_DIR/node_modules/repomix/package.json" ]; then
  mkdir -p "$HOME_DIR"
  echo '{"private":true}' > "$HOME_DIR/package.json"
  (cd "$HOME_DIR" && npm install --no-audit --no-fund --no-save "repomix@$VERSION")
fi
export SHIPDE_REPOMIX_BIN="$BIN" SHIPDE_REPOMIX_VERSION="$VERSION"
exec node "$(dirname "$0")/proof.js"
