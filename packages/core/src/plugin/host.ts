import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  ChatMessage,
  HarnessEvent,
  Plugin,
  PluginContext,
  PluginModule,
  ToolCall,
  ToolOutput,
} from "@harness/shared";

export class PluginHost {
  constructor(
    readonly plugins: Plugin[],
    readonly context: PluginContext,
  ) {}

  getTools() {
    return this.plugins.flatMap((plugin) => plugin.tools ?? []);
  }

  getCommands() {
    return this.plugins.flatMap((plugin) => plugin.commands ?? []);
  }

  async sessionStart(payload: { sessionID: string; cwd: string; model: string }): Promise<void> {
    for (const plugin of this.plugins) {
      await plugin.hooks?.["session.start"]?.(this.context, payload);
    }
  }

  async messageReceived(payload: {
    sessionID: string;
    message: ChatMessage;
  }): Promise<ChatMessage | undefined> {
    let message: ChatMessage | undefined;
    for (const plugin of this.plugins) {
      const result = await plugin.hooks?.["message.received"]?.(this.context, {
        sessionID: payload.sessionID,
        message: message ?? payload.message,
      });
      if (result) message = result;
    }
    return message;
  }

  async toolBefore(payload: {
    sessionID: string;
    call: ToolCall;
  }): Promise<ToolCall | "block" | undefined> {
    let call: ToolCall | undefined;
    for (const plugin of this.plugins) {
      const result = await plugin.hooks?.["tool.before"]?.(this.context, {
        sessionID: payload.sessionID,
        call: call ?? payload.call,
      });
      if (result === "block") return "block";
      if (result) call = result;
    }
    return call;
  }

  async toolAfter(payload: {
    sessionID: string;
    call: ToolCall;
    output: ToolOutput;
  }): Promise<ToolOutput | undefined> {
    let output: ToolOutput | undefined;
    for (const plugin of this.plugins) {
      const result = await plugin.hooks?.["tool.after"]?.(this.context, {
        sessionID: payload.sessionID,
        call: payload.call,
        output: output ?? payload.output,
      });
      if (result) output = result;
    }
    return output;
  }

  async emit(event: HarnessEvent): Promise<void> {
    for (const plugin of this.plugins) {
      await plugin.hooks?.event?.(this.context, event);
    }
  }
}

function unwrapPlugin(module: PluginModule): Plugin | undefined {
  if ("default" in module) return module.default;
  if ("plugin" in module) return module.plugin;
  return module as Plugin;
}

export async function loadPlugins(paths: string[], context: PluginContext): Promise<PluginHost> {
  const plugins: Plugin[] = [];

  for (const entry of paths) {
    const resolved =
      entry.startsWith(".") || entry.startsWith("/")
        ? pathToFileURL(resolve(context.cwd, entry)).href
        : entry;
    const imported = (await import(resolved)) as PluginModule;
    const plugin = unwrapPlugin(imported);
    if (!plugin || typeof plugin.id !== "string" || plugin.id.length === 0) {
      throw new Error(`Invalid plugin at ${entry}: missing string id`);
    }
    plugins.push(plugin);
  }

  return new PluginHost(plugins, context);
}
