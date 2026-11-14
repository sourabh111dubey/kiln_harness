import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { StatusBar } from "../src/components/StatusBar";
import { defaultTheme } from "../src/theme";

describe("status bar", () => {
  it("shows session, model, usage, and cost", () => {
    const { lastFrame } = render(
      <StatusBar
        theme={defaultTheme}
        sessionID="ses_0123456789ab"
        model="fake/test"
        cwd="/tmp/project"
        status="idle"
        usage={{ input: 10, output: 5, cacheRead: 0, cacheWrite: 0 }}
        cost={0.00125}
      />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("ses_01234567");
    expect(frame).toContain("fake/test");
    expect(frame).toContain("project");
    expect(frame).toContain("↑10 ↓5");
    expect(frame).toContain("$0.0013");
  });
});
