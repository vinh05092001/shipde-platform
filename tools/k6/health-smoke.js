// k6 workload (GOAL-AUTOCLAW-REPOS-8): a steady load against the API liveness
// route. Thresholds fail the run (non-zero exit) when latency or errors drift.
// Target: SHIPDE_K6_BASE_URL (default http://127.0.0.1:3300).
import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.SHIPDE_K6_BASE_URL || 'http://127.0.0.1:3300';

export const options = {
  scenarios: {
    liveness: {
      executor: 'constant-vus',
      vus: 20,
      duration: '20s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<200'],
    checks: ['rate>0.99'],
  },
};

export default function () {
  const res = http.get(`${BASE}/health/live`);
  check(res, {
    'status 200': (r) => r.status === 200,
    'body ok': (r) => r.json('status') === 'ok',
  });
}
