import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import { Composer } from "../src/components/Composer";
import { defaultTheme } from "../src/theme";

describe("composer", () => {
  it("submits typed text on Enter", async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(
      <Composer
        theme={defaultTheme}
        history={[]}
        onSubmit={onSubmit}
        onInterrupt={() => {}}
        onExit={() => {}}
      />,
    );

    stdin.write("hello");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(onSubmit).toHaveBeenCalledWith("hello");
  });

  it("does not submit empty input", () => {
    const onSubmit = vi.fn();
    const { stdin } = render(
      <Composer
        theme={defaultTheme}
        history={[]}
        onSubmit={onSubmit}
        onInterrupt={() => {}}
        onExit={() => {}}
      />,
    );

    stdin.write("\r");
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
