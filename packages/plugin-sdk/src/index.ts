import type {
  Plugin,
  PluginCommand,
  PluginContext,
  PluginHooks,
  PluginModule,
} from "@harness/shared";

export type { Plugin, PluginCommand, PluginContext, PluginHooks, PluginModule };

export function definePlugin(plugin: Plugin): Plugin {
  if (typeof plugin.id !== "string" || plugin.id.length === 0) {
    throw new Error("Plugin id must be a non-empty string");
  }
  return plugin;
}
