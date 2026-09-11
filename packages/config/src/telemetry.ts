import {
  trace,
  context,
  propagation,
  Span,
  Tracer,
  SpanStatusCode,
  ROOT_CONTEXT,
  Context,
} from '@opentelemetry/api';
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
  InMemorySpanExporter,
  SpanExporter,
} from '@opentelemetry/sdk-trace-base';
import { resourceFromAttributes } from '@opentelemetry/resources';

let provider: BasicTracerProvider | null = null;
let inMemoryExporter: InMemorySpanExporter | null = null;

class NoopSpanExporter implements SpanExporter {
  export(_spans: unknown[], resultCallback: (result: { code: number }) => void): void {
    resultCallback({ code: 0 });
  }
  async shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

export interface TelemetryOptions {
  inMemory?: boolean;
}

/**
 * Initializes OpenTelemetry distributed tracing foundation with standard service resource.
 * In production/default runtime, uses NoopSpanExporter so finished spans are not retained in memory.
 * InMemorySpanExporter is strictly restricted to test harnesses.
 */
export function initTelemetry(
  serviceName: string,
  serviceVersion = '0.1.0',
  options: TelemetryOptions = {}
): {
  tracer: Tracer;
  shutdown: () => Promise<void>;
  getRecordedSpans: () => unknown[];
} {
  if (!provider) {
    if (options.inMemory) {
      inMemoryExporter = new InMemorySpanExporter();
      provider = new BasicTracerProvider({
        resource: resourceFromAttributes({
          'service.name': serviceName,
          'service.version': serviceVersion,
        }),
        spanProcessors: [new SimpleSpanProcessor(inMemoryExporter)],
      });
    } else {
      inMemoryExporter = null;
      provider = new BasicTracerProvider({
        resource: resourceFromAttributes({
          'service.name': serviceName,
          'service.version': serviceVersion,
        }),
        spanProcessors: [new SimpleSpanProcessor(new NoopSpanExporter())],
      });
    }
    trace.setGlobalTracerProvider(provider);
  }

  const tracer = trace.getTracer(serviceName, serviceVersion);

  return {
    tracer,
    shutdown: async () => {
      if (provider) {
        await provider.shutdown();
        trace.disable();
        provider = null;
        inMemoryExporter = null;
      }
    },
    getRecordedSpans: () => inMemoryExporter?.getFinishedSpans() || [],
  };
}

/**
 * Retrieves a named tracer from the active OpenTelemetry provider.
 */
export function getTracer(serviceName = 'shipde-foundation'): Tracer {
  return trace.getTracer(serviceName);
}

/**
 * Wraps an async operation in an OpenTelemetry span with error recording and status management.
 */
export async function withSpan<T>(
  tracer: Tracer,
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Record<string, string | number | boolean>,
  parentContext?: Context
): Promise<T> {
  const activeCtx = parentContext || context.active();
  return context.with(activeCtx, () => {
    return tracer.startActiveSpan(name, async (span) => {
      if (attributes) {
        span.setAttributes(attributes);
      }
      try {
        const result = await fn(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (err: unknown) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: err instanceof Error ? err.message : String(err),
        });
        span.recordException(err instanceof Error ? err : new Error(String(err)));
        throw err;
      } finally {
        span.end();
      }
    });
  });
}

/**
 * Extracts W3C trace context from incoming HTTP headers or message carrier.
 */
export function extractTraceContext(headers: Record<string, string | string[] | undefined>) {
  const carrier: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      carrier[key.toLowerCase()] = value;
    } else if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
      carrier[key.toLowerCase()] = value[0];
    }
  }
  return propagation.extract(ROOT_CONTEXT, carrier);
}

/**
 * Injects active W3C trace context into an outbound carrier object (e.g. queue job headers).
 */
export function injectTraceContext(carrier: Record<string, string>): void {
  propagation.inject(context.active(), carrier);
}

/**
 * Retrieves current active traceId and spanId if an OpenTelemetry span is active.
 */
export function getCurrentTraceAndSpanId(): { traceId?: string; spanId?: string } {
  const currentSpan = trace.getActiveSpan();
  if (currentSpan) {
    const spanContext = currentSpan.spanContext();
    return {
      traceId: spanContext.traceId,
      spanId: spanContext.spanId,
    };
  }
  return {};
}
