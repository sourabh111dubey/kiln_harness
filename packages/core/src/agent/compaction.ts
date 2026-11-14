import type { ChatMessage } from "@harness/shared";

export interface CompactionOptions {
  contextWindow: number;
  threshold?: number;
  keepRecent?: number;
  systemTokens?: number;
}

export interface CompactionResult {
  messages: ChatMessage[];
  summary: string;
  omitted: number;
  tokensBefore: number;
  tokensAfter: number;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce(
    (total, message) =>
      total +
      estimateTokens(message.content) +
      (message.toolCalls?.length ?? 0) * 40 +
      (message.toolCallID ? 20 : 0),
    0,
  );
}

export function shouldCompact(messages: ChatMessage[], options: CompactionOptions): boolean {
  const used = estimateMessagesTokens(messages) + (options.systemTokens ?? 0);
  return used > options.contextWindow * (options.threshold ?? 0.8);
}

function summarize(message: ChatMessage, index: number): string {
  const text = message.content.replace(/\s+/g, " ").trim();
  const preview = text.length > 180 ? `${text.slice(0, 180)}...` : text;
  const tools = (message.toolCalls ?? []).map((call) => call.name).join(", ");
  return `${index + 1}. ${message.role}: ${preview || "(no text)"}${tools ? ` [tools: ${tools}]` : ""}`;
}

export function compactMessages(
  messages: ChatMessage[],
  options: CompactionOptions,
): CompactionResult {
  const keepRecent = options.keepRecent ?? 6;
  const tokensBefore = estimateMessagesTokens(messages);

  if (messages.length <= keepRecent + 1) {
    return {
      messages,
      summary: "",
      omitted: 0,
      tokensBefore,
      tokensAfter: tokensBefore,
    };
  }

  const omittedMessages = messages.slice(0, messages.length - keepRecent);
  const recent = messages.slice(-keepRecent);
  const summary = [
    `Earlier conversation summary (${omittedMessages.length} messages omitted):`,
    ...omittedMessages.map(summarize),
  ].join("\n");

  const compacted: ChatMessage[] = [{ role: "system", content: summary }, ...recent];

  return {
    messages: compacted,
    summary,
    omitted: omittedMessages.length,
    tokensBefore,
    tokensAfter: estimateMessagesTokens(compacted),
  };
}
