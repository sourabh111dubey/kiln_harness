import type { ModelInfo } from "@kiln/shared";

export const MODEL_CATALOG: Record<string, ModelInfo> = {
  "openrouter/anthropic/claude-sonnet-4.5": {
    id: "anthropic/claude-sonnet-4.5",
    provider: "openrouter",
    name: "Claude Sonnet 4.5 (OpenRouter)",
    contextWindow: 200_000,
    maxOutput: 64_000,
    pricing: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    capabilities: {
      tools: true,
      vision: true,
      reasoning: true,
      promptCache: true,
      streaming: true,
      maxContext: 200_000,
    },
  },
  "openrouter/anthropic/claude-haiku-4.5": {
    id: "anthropic/claude-haiku-4.5",
    provider: "openrouter",
    name: "Claude Haiku 4.5 (OpenRouter)",
    contextWindow: 200_000,
    maxOutput: 64_000,
    pricing: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
    capabilities: {
      tools: true,
      vision: true,
      reasoning: true,
      promptCache: true,
      streaming: true,
      maxContext: 200_000,
    },
  },
  "anthropic/claude-sonnet-4-5": {
    id: "claude-sonnet-4-5",
    provider: "anthropic",
    name: "Claude Sonnet 4.5",
    contextWindow: 200_000,
    maxOutput: 64_000,
    pricing: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    capabilities: {
      tools: true,
      vision: true,
      reasoning: true,
      promptCache: true,
      streaming: true,
      maxContext: 200_000,
    },
  },
  "anthropic/claude-haiku-4-5": {
    id: "claude-haiku-4-5",
    provider: "anthropic",
    name: "Claude Haiku 4.5",
    contextWindow: 200_000,
    maxOutput: 64_000,
    pricing: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
    capabilities: {
      tools: true,
      vision: true,
      reasoning: true,
      promptCache: true,
      streaming: true,
      maxContext: 200_000,
    },
  },
  "anthropic/claude-opus-4-1": {
    id: "claude-opus-4-1",
    provider: "anthropic",
    name: "Claude Opus 4.1",
    contextWindow: 200_000,
    maxOutput: 32_000,
    pricing: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
    capabilities: {
      tools: true,
      vision: true,
      reasoning: true,
      promptCache: true,
      streaming: true,
      maxContext: 200_000,
    },
  },
  "ollama/llama3.1": {
    id: "llama3.1",
    provider: "ollama",
    name: "Llama 3.1",
    contextWindow: 128_000,
    maxOutput: 8_192,
    pricing: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    capabilities: {
      tools: true,
      vision: false,
      reasoning: false,
      promptCache: false,
      streaming: true,
      maxContext: 128_000,
    },
  },
};

export function modelInfoFor(provider: string, model: string): ModelInfo {
  const known = MODEL_CATALOG[`${provider}/${model}`];
  if (known) return known;

  return {
    id: model,
    provider,
    name: model,
    contextWindow: 128_000,
    maxOutput: 8_192,
    pricing: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    capabilities: {
      tools: true,
      vision: false,
      reasoning: false,
      promptCache: false,
      streaming: true,
      maxContext: 128_000,
    },
  };
}

export function listKnownModels(): ModelInfo[] {
  return Object.values(MODEL_CATALOG);
}
