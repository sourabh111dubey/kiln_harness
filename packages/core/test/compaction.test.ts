import type { ChatMessage } from "@kiln/shared";
import { describe, expect, it } from "vitest";
import {
  compactMessages,
  estimateMessagesTokens,
  estimateTokens,
  shouldCompact,
} from "../src/agent/compaction";

const messages: ChatMessage[] = Array.from({ length: 10 }, (_, index) => ({
  role: index % 2 === 0 ? "user" : "assistant",
  content: `message ${index}`,
}));

describe("compaction", () => {
  it("estimates tokens from text", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateMessagesTokens(messages)).toBeGreaterThan(0);
  });

  it("decides when to compact", () => {
    expect(shouldCompact(messages, { contextWindow: 10_000 })).toBe(false);
    expect(shouldCompact(messages, { contextWindow: 1 })).toBe(true);
    expect(shouldCompact(messages, { contextWindow: 10_000, systemTokens: 10_000 })).toBe(true);
  });

  it("keeps recent messages and summarizes older ones", () => {
    const result = compactMessages(messages, {
      contextWindow: 10_000,
      keepRecent: 3,
    });

    expect(result.omitted).toBe(7);
    expect(result.messages).toHaveLength(4);
    expect(result.messages[0]).toMatchObject({ role: "system" });
    expect(result.messages[0]?.content).toContain("message 0");
    expect(result.messages[0]?.content).toContain("message 6");
    expect(result.messages[1]?.content).toBe("message 7");
    expect(result.tokensAfter).toBe(estimateMessagesTokens(result.messages));
  });

  it("does not compact short histories", () => {
    const short = messages.slice(0, 3);
    const result = compactMessages(short, { contextWindow: 10, keepRecent: 6 });
    expect(result.omitted).toBe(0);
    expect(result.messages).toEqual(short);
  });
});
