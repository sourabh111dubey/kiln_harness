import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { Markdown } from "../src/markdown";
import { defaultTheme } from "../src/theme";

describe("markdown renderer", () => {
  it("renders headings, lists, and code fences", () => {
    const { lastFrame } = render(
      <Markdown
        theme={defaultTheme}
        text={"# Title\n\n- one\n- two\n\n```ts\nconst value = 1;\n```"}
      />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("Title");
    expect(frame).toContain("one");
    expect(frame).toContain("two");
    expect(frame).toContain("const value = 1;");
  });

  it("renders inline formatting", () => {
    const { lastFrame } = render(
      <Markdown
        theme={defaultTheme}
        text={"**bold** and `code` and [link](https://example.com)"}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("bold");
    expect(frame).toContain("code");
    expect(frame).toContain("https://example.com");
  });
});
