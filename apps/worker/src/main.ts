import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { WorkerAppModule } from './app.module';
import {
  validateConfig,
  formatStructuredLog,
  ConfigValidationError,
  initTelemetry,
} from '@shipde/config';

export async function bootstrap(): Promise<void> {
  initTelemetry('shipde-worker');

  // Explicitly load .env file from root monorepo or local directory (Node 24 native, Finding 2)
  if (typeof (process as any).loadEnvFile === 'function') {
    const candidateEnvPaths = [
      path.resolve(process.cwd(), '../../.env'),
      path.resolve(__dirname, '../../.env'),
      path.resolve(__dirname, '../../../.env'),
      path.resolve(process.cwd(), '.env'),
    ];
    for (const envPath of candidateEnvPaths) {
      try {
        (process as any).loadEnvFile(envPath);
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          // ignore missing .env file, fallback to environment variables
        }
      }
    }
  }

  let config;
  try {
    config = validateConfig();
  } catch (err: any) {
    if (err instanceof ConfigValidationError) {
      console.error(
        formatStructuredLog({
          level: 'error',
          service: 'worker',
          message: `Fatal configuration error on startup: ${err.message}`,
        })
      );
    } else {
      console.error(
        formatStructuredLog({
          level: 'error',
          service: 'worker',
          message: 'Unknown error validating environment configuration',
        })
      );
    }
    process.exit(1);
  }

  const app = await NestFactory.create(WorkerAppModule, {
    logger: false,
  });

  app.enableShutdownHooks();

  await app.listen(config.WORKER_HEALTH_PORT);

  console.log(
    formatStructuredLog({
      level: 'info',
      service: 'worker',
      message: `Ship Dễ Worker service and health listener started on port ${config.WORKER_HEALTH_PORT}`,
      metadata: {
        workerHealthPort: config.WORKER_HEALTH_PORT,
        nodeEnv: config.NODE_ENV,
      },
    })
  );
}

if (require.main === module) {
  bootstrap().catch((err) => {
    console.error(
      formatStructuredLog({
        level: 'error',
        service: 'worker',
        message: `Unhandled exception during Worker bootstrap: ${err.message}`,
      })
    );
    process.exit(1);
  });
}
