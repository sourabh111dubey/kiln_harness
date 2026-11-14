import { describe, expect, it } from "vitest";
import {
  createSandbox,
  DockerSandbox,
  LinuxBubblewrapSandbox,
  MacSeatbeltSandbox,
} from "../src/index";

describe("sandbox adapters", () => {
  it("wraps commands with bubblewrap and no network by default", () => {
    const sandbox = new LinuxBubblewrapSandbox({ workspace: "/tmp/work" });
    const wrapped = sandbox.wrap("printf hi");
    expect(wrapped.command).toBe("bwrap");
    expect(wrapped.args).toContain("--ro-bind");
    expect(wrapped.args).toContain("--unshare-net");
    expect(wrapped.args).toContain("/tmp/work");
    expect(wrapped.args.at(-3)).toBe("/bin/bash");
  });

  it("allows network when configured", () => {
    const sandbox = new LinuxBubblewrapSandbox({ workspace: "/tmp/work", network: true });
    expect(sandbox.wrap("true").args).not.toContain("--unshare-net");
  });

  it("builds a seatbelt profile with workspace write access", () => {
    const sandbox = new MacSeatbeltSandbox({ workspace: "/tmp/work" });
    const wrapped = sandbox.wrap("printf hi");
    expect(wrapped.command).toBe("/usr/bin/sandbox-exec");
    expect(wrapped.args[1]).toContain("/tmp/work");
    expect(wrapped.args[1]).toContain("deny network*");
  });

  it("uses Docker with no network and the workspace mounted", () => {
    const sandbox = new DockerSandbox({ workspace: "/tmp/work" });
    const wrapped = sandbox.wrap("printf hi");
    expect(wrapped.command).toBe("docker");
    expect(wrapped.args).toContain("none");
    expect(wrapped.args).toContain("/tmp/work:/work");
    expect(wrapped.args).toContain("node:24-slim");
  });

  it("selects an adapter by platform", () => {
    expect(createSandbox({ workspace: "/tmp/work", platform: "linux" }).id).toBe("bubblewrap");
    expect(createSandbox({ workspace: "/tmp/work", platform: "darwin" }).id).toBe("seatbelt");
    expect(createSandbox({ workspace: "/tmp/work", platform: "win32" }).id).toBe("docker");
  });
});
