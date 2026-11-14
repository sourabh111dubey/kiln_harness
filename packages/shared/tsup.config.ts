import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node24",
  platform: "node",
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  external: [
    "@opentelemetry/api",
    "@opentelemetry/exporter-trace-otlp-http",
    "@opentelemetry/sdk-node",
    "jsonc-parser",
    "pino",
    "zod",
  ],
});
