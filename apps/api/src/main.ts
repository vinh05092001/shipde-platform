import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import {
  validateConfig,
  formatStructuredLog,
  ConfigValidationError,
  initTelemetry,
} from '@shipde/config';

export async function bootstrap(): Promise<void> {
  initTelemetry('shipde-api');

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
          service: 'api',
          message: `Fatal configuration error on startup: ${err.message}`,
        })
      );
    } else {
      console.error(
        formatStructuredLog({
          level: 'error',
          service: 'api',
          message: 'Unknown error validating environment configuration',
        })
      );
    }
    process.exit(1);
  }

  const app = await NestFactory.create(AppModule, {
    logger: false, // Structured JSON logs are handled directly
  });

  app.enableShutdownHooks();

  await app.listen(config.PORT);

  console.log(
    formatStructuredLog({
      level: 'info',
      service: 'api',
      message: `Ship Dễ API service started successfully on port ${config.PORT}`,
      metadata: {
        port: config.PORT,
        nodeEnv: config.NODE_ENV,
        carrierMode: config.CARRIER_MODE,
      },
    })
  );
}

if (require.main === module) {
  bootstrap().catch((err) => {
    console.error(
      formatStructuredLog({
        level: 'error',
        service: 'api',
        message: `Unhandled exception during API bootstrap: ${err.message}`,
      })
    );
    process.exit(1);
  });
}
