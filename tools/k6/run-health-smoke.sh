#!/usr/bin/env bash
# Start the built API with the placeholder example env, wait for liveness,
# run the k6 workload, then stop the API. The k6 exit status is the result.
set -euo pipefail
PORT="${SHIPDE_K6_PORT:-3300}"
cd "$(dirname "$0")/../.."
PORT="$PORT" NODE_ENV=test LOG_LEVEL=warn node --env-file=.env.example --env-file-if-exists=/dev/null apps/api/dist/main.js > k6-api.log 2>&1 &
API_PID=$!
trap 'kill "$API_PID" 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do
  curl -sf "http://127.0.0.1:${PORT}/health/live" > /dev/null && break
  sleep 1
done
curl -sf "http://127.0.0.1:${PORT}/health/live" > /dev/null || { echo "API did not become live"; cat k6-api.log; exit 2; }
SHIPDE_K6_BASE_URL="http://127.0.0.1:${PORT}" k6 run --summary-export=k6-summary.json tools/k6/health-smoke.js
