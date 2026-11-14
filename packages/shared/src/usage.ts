export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning?: number;
}

export function emptyUsage(): Usage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
}

export function addUsage(left: Usage, right: Usage): Usage {
  return {
    input: left.input + right.input,
    output: left.output + right.output,
    cacheRead: left.cacheRead + right.cacheRead,
    cacheWrite: left.cacheWrite + right.cacheWrite,
    reasoning: (left.reasoning ?? 0) + (right.reasoning ?? 0),
  };
}

/** USD per 1M tokens. */
export interface ModelPricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ModelCapabilities {
  tools: boolean;
  vision: boolean;
  reasoning: boolean;
  promptCache: boolean;
  streaming: boolean;
  maxContext: number;
}

export interface ModelInfo {
  id: string;
  provider: string;
  name: string;
  contextWindow: number;
  maxOutput: number;
  pricing: ModelPricing;
  capabilities: ModelCapabilities;
}

export interface ModelRef {
  provider: string;
  model: string;
}

export function parseModelRef(value: string): ModelRef | null {
  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1) return null;
  return { provider: value.slice(0, separator), model: value.slice(separator + 1) };
}

export function formatModelRef(ref: ModelRef): string {
  return `${ref.provider}/${ref.model}`;
}

export function estimateCost(model: ModelInfo, usage: Usage): number {
  const perToken = (tokens: number, usdPerMillion: number) => (tokens / 1_000_000) * usdPerMillion;
  return (
    perToken(usage.input, model.pricing.input) +
    perToken(usage.output, model.pricing.output) +
    perToken(usage.cacheRead, model.pricing.cacheRead) +
    perToken(usage.cacheWrite, model.pricing.cacheWrite)
  );
}
