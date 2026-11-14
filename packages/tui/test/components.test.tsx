import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import { PermissionModal } from "../src/components/PermissionModal";
import { SessionPicker } from "../src/components/SessionPicker";
import { Transcript, type TranscriptEntry } from "../src/components/Transcript";
import { defaultTheme } from "../src/theme";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("permission modal", () => {
  it("resolves allow on y", async () => {
    const onResolve = vi.fn();
    const { stdin } = render(
      <PermissionModal
        theme={defaultTheme}
        request={{ tool: "write", input: { path: "a.txt" } }}
        onResolve={onResolve}
        onAlwaysAllow={() => {}}
      />,
    );

    stdin.write("y");
    await delay(30);
    expect(onResolve).toHaveBeenCalledWith("allow");
  });

  it("resolves deny on escape", async () => {
    const onResolve = vi.fn();
    const { stdin } = render(
      <PermissionModal
        theme={defaultTheme}
        request={{ tool: "bash", input: { command: "rm -rf /" } }}
        onResolve={onResolve}
        onAlwaysAllow={() => {}}
      />,
    );

    stdin.write("\u001B");
    await delay(30);
    expect(onResolve).toHaveBeenCalledWith("deny");
  });
});

describe("session picker", () => {
  it("selects the highlighted session", async () => {
    const onSelect = vi.fn();
    const { stdin } = render(
      <SessionPicker
        theme={defaultTheme}
        sessions={[
          {
            id: "ses_1",
            title: "one",
            cwd: "/tmp",
            model: "a/b",
            agent: "build",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            status: "idle",
            tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            cost: 0,
            permissions: "default",
            metadata: {},
          },
          {
            id: "ses_2",
            title: "two",
            cwd: "/tmp",
            model: "a/b",
            agent: "build",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            status: "idle",
            tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            cost: 0,
            permissions: "default",
            metadata: {},
          },
        ]}
        onSelect={onSelect}
        onClose={() => {}}
      />,
    );

    stdin.write("\u001B[B");
    await delay(20);
    stdin.write("\r");
    await delay(30);
    expect(onSelect).toHaveBeenCalledWith("ses_2");
  });
});

describe("transcript", () => {
  it("renders user, assistant, tool, and error entries", () => {
    const entries: TranscriptEntry[] = [
      { id: "1", kind: "user", text: "hello" },
      { id: "2", kind: "assistant", text: "hi there" },
      {
        id: "3",
        kind: "tool",
        call: { id: "call_1", name: "write", input: { path: "a.txt" } },
        result: {
          kind: "diff",
          diff: "--- a.txt\n+++ a.txt\n@@ -1 +1 @@\n-old\n+new",
          files: [],
        },
        decision: "allow",
        durationMs: 4,
      },
      {
        id: "4",
        kind: "tool",
        call: { id: "call_2", name: "bash", input: { command: "printf hi" } },
        result: { kind: "terminal", stdout: "hi", stderr: "", exitCode: 0 },
        decision: "allow",
      },
      { id: "5", kind: "error", text: "boom" },
    ];

    const { lastFrame } = render(<Transcript entries={entries} theme={defaultTheme} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("hello");
    expect(frame).toContain("hi there");
    expect(frame).toContain("write");
    expect(frame).toContain("+ new");
    expect(frame).toContain("bash");
    expect(frame).toContain("boom");
  });
});
