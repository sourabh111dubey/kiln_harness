import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  ChatMessage,
  KilncraftEvent,
  Plugin,
  PluginContext,
  PluginModule,
  ToolCall,
  ToolOutput,
} from "@kilncraft/shared";

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
      try {
        await plugin.hooks?.["session.start"]?.(this.context, payload);
      } catch (error) {
        this.context.logger.warn({ err: error, plugin: plugin.id }, "session.start hook failed");
      }
    }
  }

  async messageReceived(payload: {
    sessionID: string;
    message: ChatMessage;
  }): Promise<ChatMessage | undefined> {
    let message: ChatMessage | undefined;
    for (const plugin of this.plugins) {
      try {
        const result = await plugin.hooks?.["message.received"]?.(this.context, {
          sessionID: payload.sessionID,
          message: message ?? payload.message,
        });
        if (result) message = result;
      } catch (error) {
        this.context.logger.warn({ err: error, plugin: plugin.id }, "message.received hook failed");
      }
    }
    return message;
  }

  async toolBefore(payload: {
    sessionID: string;
    call: ToolCall;
  }): Promise<ToolCall | "block" | undefined> {
    let call: ToolCall | undefined;
    for (const plugin of this.plugins) {
      try {
        const result = await plugin.hooks?.["tool.before"]?.(this.context, {
          sessionID: payload.sessionID,
          call: call ?? payload.call,
        });
        if (result === "block") return "block";
        if (result) {
          if (result.id !== payload.call.id) {
            this.context.logger.warn(
              { plugin: plugin.id, expected: payload.call.id, actual: result.id },
              "tool.before hook cannot change the tool call id",
            );
            continue;
          }
          call = result;
        }
      } catch (error) {
        this.context.logger.warn({ err: error, plugin: plugin.id }, "tool.before hook failed");
      }
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
      try {
        const result = await plugin.hooks?.["tool.after"]?.(this.context, {
          sessionID: payload.sessionID,
          call: payload.call,
          output: output ?? payload.output,
        });
        if (result) output = result;
      } catch (error) {
        this.context.logger.warn({ err: error, plugin: plugin.id }, "tool.after hook failed");
      }
    }
    return output;
  }

  async emit(event: KilncraftEvent): Promise<void> {
    for (const plugin of this.plugins) {
      try {
        await plugin.hooks?.event?.(this.context, event);
      } catch (error) {
        this.context.logger.warn({ err: error, plugin: plugin.id }, "event hook failed");
      }
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

  for (const [index, entry] of paths.entries()) {
    const resolved =
      entry.startsWith(".") || entry.startsWith("/")
        ? pathToFileURL(resolve(context.cwd, entry)).href
        : entry;
    const imported = (await import(`${resolved}?v=${Date.now()}-${index}`)) as PluginModule;
    const plugin = unwrapPlugin(imported);
    if (!plugin || typeof plugin.id !== "string" || plugin.id.length === 0) {
      throw new Error(`Invalid plugin at ${entry}: missing string id`);
    }
    plugins.push(plugin);
  }

  return new PluginHost(plugins, context);
}
