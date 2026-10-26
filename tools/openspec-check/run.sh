#!/usr/bin/env bash
# Installs the pinned OpenSpec CLI outside the workspace (no lockfile change)
# and validates every Work Item acceptance matrix with it.
set -euo pipefail
VERSION=1.14.3
HOME_DIR="${OPENSPEC_HOME:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/shipde-openspec-$VERSION}"
if [ ! -f "$HOME_DIR/node_modules/@fission-ai/openspec/package.json" ]; then
  mkdir -p "$HOME_DIR"
  echo '{"private":true}' > "$HOME_DIR/package.json"
  (cd "$HOME_DIR" && npm install --no-audit --no-fund --no-save "@fission-ai/openspec@$VERSION")
fi
OPENSPEC_BIN="$HOME_DIR/node_modules/.bin/openspec" exec node "$(dirname "$0")/run.js"
