import { execFileSync } from 'node:child_process';

const MAX_WAIT_SECONDS = 60;
const POLL_INTERVAL_MS = 2000;

interface ServiceStatus {
  name: string;
  service: string;
  status: string;
  health: string;
}

function getComposeStatuses(): ServiceStatus[] {
  try {
    const raw = execFileSync(
      'docker',
      ['compose', '-f', 'infra/docker/compose.yml', 'ps', '--format', 'json'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );

    // Docker compose may output either a JSON array or newline-delimited JSON objects
    const trimmed = raw.trim();
    if (!trimmed) return [];

    if (trimmed.startsWith('[')) {
      const parsed = JSON.parse(trimmed);
      return parsed.map((item: any) => ({
        name: item.Name || item.name || '',
        service: item.Service || item.service || '',
        status: item.Status || item.status || '',
        health: item.Health || item.health || '',
      }));
    }

    const lines = trimmed.split('\n').filter((l) => l.trim().length > 0);
    return lines.map((line) => {
      const item = JSON.parse(line);
      return {
        name: item.Name || item.name || '',
        service: item.Service || item.service || '',
        status: item.Status || item.status || '',
        health: item.Health || item.health || '',
      };
    });
  } catch (err: any) {
    throw new Error(`Failed to query docker compose status: ${err.message}`);
  }
}

async function waitForInfrastructure(): Promise<void> {
  const startTime = Date.now();
  console.log(
    '⏳ Waiting for local infrastructure containers (PostgreSQL, Redis, MinIO) to be healthy...'
  );

  const requiredServices = ['postgres', 'redis', 'minio'];

  while (Date.now() - startTime < MAX_WAIT_SECONDS * 1000) {
    try {
      const services = getComposeStatuses();
      const serviceMap = new Map<string, ServiceStatus>();
      for (const s of services) {
        serviceMap.set(s.service, s);
      }

      const allPresent = requiredServices.every((req) => serviceMap.has(req));
      if (allPresent) {
        const statuses = requiredServices.map((req) => {
          const s = serviceMap.get(req)!;
          const isHealthy =
            s.health === 'healthy' ||
            s.status.toLowerCase().includes('(healthy)') ||
            (s.status.toLowerCase().startsWith('up') &&
              !s.status.toLowerCase().includes('unhealthy'));
          return { service: req, status: s.status, health: s.health, isHealthy };
        });

        const allHealthy = statuses.every((st) => st.isHealthy);
        if (allHealthy) {
          console.log('✅ All infrastructure services are healthy:');
          for (const st of statuses) {
            console.log(`   - ${st.service}: ${st.status || st.health || 'healthy'}`);
          }
          process.exit(0);
        }
      }
    } catch (err: any) {
      console.warn(`[infra:wait] Poll warning: ${err.message}`);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  console.error(`❌ Timeout after ${MAX_WAIT_SECONDS}s waiting for containers to become healthy.`);
  try {
    const current = getComposeStatuses();
    console.error('Current container statuses:', JSON.stringify(current, null, 2));
  } catch {}
  process.exit(1);
}

waitForInfrastructure().catch((err) => {
  console.error('Fatal error waiting for infrastructure:', err);
  process.exit(1);
});
