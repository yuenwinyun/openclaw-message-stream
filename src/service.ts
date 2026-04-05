import { parseMessageStreamConfig } from "./config.js";
import { MessageStreamRuntime } from "./runtime.js";
import type { MessageStreamMode } from "./types.js";
import type { OpenClawConfig, OpenClawPluginApi, OpenClawPluginService } from "openclaw/plugin-sdk/plugin-entry";

const PLUGIN_ID = "openclaw-message-stream";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readPluginConfigFromOpenClawConfig(config?: OpenClawConfig): unknown {
  const entries = asRecord(config?.plugins)?.entries;
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
    return undefined;
  }
  const pluginEntry = asRecord((entries as Record<string, unknown>)[PLUGIN_ID]);
  if (!pluginEntry) {
    return undefined;
  }
  return pluginEntry.config ?? {};
}

function resolveRawPluginConfig(params: {
  api: OpenClawPluginApi;
  runtimeConfig?: OpenClawConfig;
}): unknown {
  return (
    params.api.pluginConfig ??
    readPluginConfigFromOpenClawConfig(params.runtimeConfig) ??
    readPluginConfigFromOpenClawConfig(params.api.config) ??
    {}
  );
}

function resolveMessageStreamConfig(params: {
  api: OpenClawPluginApi;
  runtimeConfig?: OpenClawConfig;
  modeOverride?: MessageStreamMode;
}): ReturnType<typeof parseMessageStreamConfig> {
  const raw = resolveRawPluginConfig(params);
  const parsed = parseMessageStreamConfig(raw);
  if (!params.modeOverride || parsed.mode === params.modeOverride) {
    return parsed;
  }
  return {
    ...parsed,
    mode: params.modeOverride,
  };
}

export function createMessageStreamRuntime(params: {
  api: OpenClawPluginApi;
  stateDir: string;
  runtimeConfig?: OpenClawConfig;
  modeOverride?: MessageStreamMode;
}): MessageStreamRuntime {
  const config = resolveMessageStreamConfig(params);
  return new MessageStreamRuntime({
    config,
    logger: params.api.logger,
    stateDir: params.stateDir,
  });
}

export function createMessageStreamService(api: OpenClawPluginApi): OpenClawPluginService {
  let runtime: MessageStreamRuntime | null = null;

  return {
    id: PLUGIN_ID,
    start: async (ctx) => {
      runtime = createMessageStreamRuntime({
        api,
        stateDir: ctx.stateDir,
        runtimeConfig: ctx.config,
      });
      await runtime.start();
    },
    stop: async () => {
      if (!runtime) {
        return;
      }
      try {
        await runtime.stop();
      } finally {
        runtime = null;
      }
    },
  };
}
