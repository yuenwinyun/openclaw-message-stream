#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_PLUGIN_ROOT = process.cwd();
const DEFAULT_PLUGIN_ID = "openclaw-message-stream";
const DEFAULT_CONFIG_FILE = "openclaw.config.json";

const args = process.argv.slice(2);

function parseArgs() {
  const parsed = {
    action: "upsert",
    configPath: DEFAULT_CONFIG_FILE,
    mode: "hybrid",
    pluginRoot: DEFAULT_PLUGIN_ROOT,
    pluginId: DEFAULT_PLUGIN_ID,
    outputPath: null,
    write: false,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];

    if (arg === "--help" || arg === "-h") {
      console.log(
        [
          "Usage:",
          "  node scripts/openclaw-config.mjs --config <openclaw.json> --action upsert|remove [--write] [--mode hybrid|scheduled|streaming|hybrid]",
          "Options:",
          "  --config <file>         OpenClaw config file path (default: openclaw.config.json)",
          "  --action <action>       upsert|remove (default: upsert)",
          "  --mode <mode>           plugin mode for upsert (default: hybrid)",
          "  --plugin-root <path>    plugin root for load.paths (default: cwd)",
          "  --plugin-id <id>        plugin id (default: openclaw-message-stream)",
          "  --output <file>         output path (default: no file unless --write)",
          "  --write                 update --config in place",
          "  --dry-run               print result only",
        ].join("\n"),
      );
      process.exit(0);
    }

    if (arg === "--config" && next) {
      parsed.configPath = next;
      i += 1;
      continue;
    }

    if (arg === "--action" && next) {
      const action = next;
      if (action !== "upsert" && action !== "remove") {
        throw new Error(`Invalid action "${action}". Expected upsert|remove.`);
      }
      parsed.action = action;
      i += 1;
      continue;
    }

    if (arg === "--mode" && next) {
      const mode = next;
      if (
        mode !== "one-shot" &&
        mode !== "scheduled" &&
        mode !== "streaming" &&
        mode !== "hybrid"
      ) {
        throw new Error(`Invalid mode "${mode}". Expected one-shot|scheduled|streaming|hybrid.`);
      }
      parsed.mode = mode;
      i += 1;
      continue;
    }

    if (arg === "--plugin-root" && next) {
      parsed.pluginRoot = path.resolve(next);
      i += 1;
      continue;
    }

    if (arg === "--plugin-id" && next) {
      parsed.pluginId = next;
      i += 1;
      continue;
    }

    if (arg === "--output" && next) {
      parsed.outputPath = next;
      i += 1;
      continue;
    }

    if (arg === "--write") {
      parsed.write = true;
      continue;
    }

    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
  }

  return parsed;
}

function readConfig(configPath) {
  const content = readFileSync(configPath, "utf8");
  return JSON.parse(content);
}

function cleanArray(values = []) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function buildPluginConfig(pluginId, mode) {
  return {
    enabled: true,
    mode,
    pluginName: pluginId,
    output: {
      console: true,
    },
    analysis: {
      keyword: {
        weight: 1,
      },
    },
  };
}

function upsertPluginConfig(config, parsed) {
  const next = structuredClone(config);
  next.plugins ||= {};
  next.plugins.enabled = true;

  const existingAllow = Array.isArray(next.plugins.allow) ? next.plugins.allow : [];
  next.plugins.allow = cleanArray([...existingAllow, parsed.pluginId]);

  const existingPaths = Array.isArray(next.plugins.load?.paths)
    ? next.plugins.load.paths
    : [];
  next.plugins.load = {
    ...(next.plugins.load ?? {}),
    paths: cleanArray([...existingPaths, parsed.pluginRoot]),
  };

  const existingPluginConfig = next.plugins.entries?.[parsed.pluginId]?.config ?? {};
  const mergedPluginConfig = {
    ...existingPluginConfig,
    ...buildPluginConfig(parsed.pluginId, parsed.mode),
    pluginName: parsed.pluginId,
  };

  next.plugins.entries = {
    ...(next.plugins.entries ?? {}),
    [parsed.pluginId]: {
      ...(next.plugins.entries?.[parsed.pluginId] ?? {}),
      config: mergedPluginConfig,
    },
  };

  return next;
}

function removePluginConfig(config, parsed) {
  const next = structuredClone(config);
  if (!next.plugins) {
    return next;
  }

  if (Array.isArray(next.plugins.allow)) {
    next.plugins.allow = next.plugins.allow.filter((id) => id !== parsed.pluginId);
    if (next.plugins.allow.length === 0) {
      delete next.plugins.allow;
    }
  }

  if (next.plugins.load?.paths) {
    next.plugins.load.paths = next.plugins.load.paths.filter(
      (candidate) => candidate !== parsed.pluginRoot,
    );
    if (next.plugins.load.paths.length === 0) {
      delete next.plugins.load.paths;
    }
    if (Object.keys(next.plugins.load).length === 0) {
      delete next.plugins.load;
    }
  }

  if (next.plugins.entries && next.plugins.entries[parsed.pluginId]) {
    const nextEntries = { ...next.plugins.entries };
    delete nextEntries[parsed.pluginId];
    if (Object.keys(nextEntries).length === 0) {
      delete next.plugins.entries;
    } else {
      next.plugins.entries = nextEntries;
    }
  }

  if (!next.plugins.allow && !next.plugins.load && !next.plugins.entries) {
    delete next.plugins.enabled;
    delete next.plugins;
  }

  return next;
}

function main() {
  const parsed = parseArgs();
  const config = readConfig(parsed.configPath);
  const next = parsed.action === "remove"
    ? removePluginConfig(config, parsed)
    : upsertPluginConfig(config, parsed);
  const output = `${JSON.stringify(next, null, 2)}\n`;

  if (parsed.dryRun || parsed.outputPath) {
    if (parsed.outputPath) {
      writeFileSync(parsed.outputPath, output, "utf8");
      console.log(`openclaw plugin config written to ${parsed.outputPath}`);
      return;
    }
    process.stdout.write(output);
    return;
  }

  if (parsed.write || parsed.configPath) {
    writeFileSync(parsed.configPath, output, "utf8");
    console.log(`openclaw plugin config updated in ${parsed.configPath}`);
    return;
  }
}

main();
