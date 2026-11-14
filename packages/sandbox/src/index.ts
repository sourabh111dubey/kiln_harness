import type { SandboxAdapter, SandboxCommand } from "@harness/shared";

export interface SandboxOptions {
  workspace: string;
  network?: boolean;
  image?: string;
  platform?: NodeJS.Platform;
}

export class LinuxBubblewrapSandbox implements SandboxAdapter {
  readonly id = "bubblewrap";

  constructor(private readonly options: SandboxOptions) {}

  wrap(command: string, options: { cwd?: string } = {}): SandboxCommand {
    const workspace = this.options.workspace;
    const cwd = options.cwd ?? workspace;
    return {
      command: "bwrap",
      args: [
        "--ro-bind",
        "/",
        "/",
        "--dev",
        "/dev",
        "--proc",
        "/proc",
        "--tmpfs",
        "/tmp",
        "--bind",
        workspace,
        workspace,
        "--chdir",
        cwd,
        "--setenv",
        "HOME",
        "/tmp",
        "--unshare-pid",
        "--unshare-ipc",
        "--unshare-uts",
        ...(this.options.network ? [] : ["--unshare-net"]),
        "--die-with-parent",
        "--new-session",
        "--cap-drop",
        "ALL",
        "/bin/bash",
        "-c",
        command,
      ],
    };
  }
}

function seatbeltProfile(workspace: string, network: boolean): string {
  const lines = [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    `(allow file-write* (subpath "${workspace}"))`,
    '(allow file-write* (subpath "/tmp"))',
    "(allow process-exec)",
    "(allow process-fork)",
  ];
  if (!network) lines.push("(deny network*)");
  return lines.join("\n");
}

export class MacSeatbeltSandbox implements SandboxAdapter {
  readonly id = "seatbelt";

  constructor(private readonly options: SandboxOptions) {}

  wrap(command: string, options: { cwd?: string } = {}): SandboxCommand {
    return {
      command: "/usr/bin/sandbox-exec",
      args: [
        "-p",
        seatbeltProfile(this.options.workspace, this.options.network ?? false),
        "/bin/bash",
        "-c",
        `cd ${JSON.stringify(options.cwd ?? this.options.workspace)} && ${command}`,
      ],
    };
  }
}

export class PassthroughSandbox implements SandboxAdapter {
  readonly id = "passthrough";

  wrap(command: string): SandboxCommand {
    if (process.platform === "win32") {
      return {
        command: process.env.COMSPEC ?? "cmd.exe",
        args: ["/c", command],
      };
    }
    return {
      command: process.env.SHELL ?? "/bin/bash",
      args: ["-c", command],
    };
  }
}

export class DockerSandbox implements SandboxAdapter {
  readonly id = "docker";

  constructor(private readonly options: SandboxOptions) {}

  wrap(command: string): SandboxCommand {
    return {
      command: "docker",
      args: [
        "run",
        "--rm",
        "-i",
        "--network",
        this.options.network ? "bridge" : "none",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "-v",
        `${this.options.workspace}:/work`,
        "-w",
        "/work",
        this.options.image ?? "node:24-slim",
        "bash",
        "-c",
        command,
      ],
    };
  }
}

export function createSandbox(options: SandboxOptions): SandboxAdapter {
  const platform = options.platform ?? process.platform;
  if (platform === "linux") return new LinuxBubblewrapSandbox(options);
  if (platform === "darwin") return new MacSeatbeltSandbox(options);
  if (platform === "win32") return new PassthroughSandbox();
  return new DockerSandbox(options);
}

export function describeSandbox(adapter: SandboxAdapter): string {
  const wrapped = adapter.wrap("true");
  return `${adapter.id}: ${wrapped.command} ${wrapped.args.slice(0, 8).join(" ")}...`;
}
