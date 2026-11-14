import type { ProviderAdapter } from "@kiln/shared";
import { AnthropicProvider } from "./anthropic";
import { GeminiProvider } from "./gemini";
import { OpenAIProvider } from "./openai";

export class ProviderRegistry {
  private readonly providers = new Map<string, ProviderAdapter>();

  register(provider: ProviderAdapter): this {
    this.providers.set(provider.id, provider);
    return this;
  }

  get(id: string): ProviderAdapter | undefined {
    return this.providers.get(id);
  }

  has(id: string): boolean {
    return this.providers.has(id);
  }

  list(): ProviderAdapter[] {
    return [...this.providers.values()];
  }
}

export function createDefaultProviderRegistry(
  env: NodeJS.ProcessEnv = process.env,
): ProviderRegistry {
  const registry = new ProviderRegistry();

  if (env.ANTHROPIC_API_KEY) {
    registry.register(
      new AnthropicProvider({
        apiKey: env.ANTHROPIC_API_KEY,
        baseURL: env.ANTHROPIC_BASE_URL,
      }),
    );
  }

  if (env.OPENAI_API_KEY) {
    registry.register(
      new OpenAIProvider({
        id: "openai",
        apiKey: env.OPENAI_API_KEY,
        baseURL: env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      }),
    );
  }

  if (env.OPENROUTER_API_KEY) {
    const headers: Record<string, string> = {};
    if (env.OPENROUTER_REFERER) headers["HTTP-Referer"] = env.OPENROUTER_REFERER;
    if (env.OPENROUTER_TITLE) headers["X-Title"] = env.OPENROUTER_TITLE;
    registry.register(
      new OpenAIProvider({
        id: "openrouter",
        apiKey: env.OPENROUTER_API_KEY,
        baseURL: env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
        headers,
      }),
    );
  }

  const geminiKey = env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY;
  if (geminiKey) {
    registry.register(
      new GeminiProvider({
        apiKey: geminiKey,
        baseURL: env.GEMINI_BASE_URL,
      }),
    );
  }

  const ollamaHost = (env.OLLAMA_HOST ?? "http://localhost:11434").replace(/\/$/, "");
  registry.register(
    new OpenAIProvider({
      id: "ollama",
      baseURL: ollamaHost.endsWith("/v1") ? ollamaHost : `${ollamaHost}/v1`,
    }),
  );

  if (env.KILN_CUSTOM_BASE_URL) {
    registry.register(
      new OpenAIProvider({
        id: "custom",
        apiKey: env.KILN_CUSTOM_API_KEY,
        baseURL: env.KILN_CUSTOM_BASE_URL,
      }),
    );
  }

  return registry;
}

export function availableProviderIds(env: NodeJS.ProcessEnv = process.env): string[] {
  const ids: string[] = ["ollama"];
  if (env.ANTHROPIC_API_KEY) ids.push("anthropic");
  if (env.OPENAI_API_KEY) ids.push("openai");
  if (env.OPENROUTER_API_KEY) ids.push("openrouter");
  if (env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY) ids.push("gemini");
  if (env.KILN_CUSTOM_BASE_URL) ids.push("custom");
  return ids;
}
