export interface SandboxCommand {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
}

export interface SandboxAdapter {
  readonly id: string;
  wrap(command: string, options?: { cwd?: string }): SandboxCommand;
}
