import { type Attributes, type Span, SpanStatusCode, trace } from "@opentelemetry/api";

export const tracer = trace.getTracer("kilncraft");

export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes: Attributes = {},
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error instanceof Error ? error : String(error));
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

export interface TelemetryOptions {
  enabled: boolean;
  serviceName?: string;
  endpoint?: string;
}

type NodeSdk = import("@opentelemetry/sdk-node").NodeSDK;

let sdk: NodeSdk | undefined;
let started = false;

export async function initTelemetry(
  options: TelemetryOptions,
): Promise<{ enabled: boolean; reason?: string }> {
  if (started) return { enabled: true };
  if (!options.enabled) return { enabled: false, reason: "telemetry disabled" };

  try {
    const [sdkModule, exporterModule] = await Promise.all([
      import("@opentelemetry/sdk-node"),
      import("@opentelemetry/exporter-trace-otlp-http"),
    ]);

    sdk = new sdkModule.NodeSDK({
      serviceName: options.serviceName ?? "kilncraft",
      traceExporter: new exporterModule.OTLPTraceExporter(
        options.endpoint ? { url: options.endpoint } : {},
      ),
    });
    sdk.start();
    started = true;
    return { enabled: true };
  } catch (error) {
    return {
      enabled: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function shutdownTelemetry(): Promise<void> {
  if (!sdk) return;
  const current = sdk;
  sdk = undefined;
  started = false;
  try {
    await current.shutdown();
  } catch {
    // Telemetry shutdown must never crash the process.
  }
}
