#!/usr/bin/env bash
# Installs the pinned promptfoo outside the workspace (no lockfile change) and
# runs the offline Controller prompt contract eval.
set -euo pipefail
VERSION=0.120.0
HOME_DIR="${PROMPTFOO_HOME:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/shipde-promptfoo-$VERSION}"
if [ ! -f "$HOME_DIR/node_modules/promptfoo/package.json" ]; then
  mkdir -p "$HOME_DIR"
  echo '{"private":true}' > "$HOME_DIR/package.json"
  (cd "$HOME_DIR" && npm install --no-audit --no-fund --no-save "promptfoo@$VERSION")
fi
export PROMPTFOO_DISABLE_TELEMETRY=1 PROMPTFOO_DISABLE_UPDATE=1
NODE_PATH="$HOME_DIR/node_modules" exec node "$(dirname "$0")/run.js"
