#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PLUGIN_ROOT = path.resolve(SKILL_DIR, "../../");
const args = process.argv.slice(2);

function parseArgs() {
  const parsed = {
    mode: "hybrid",
    output: "openclaw-message-stream.config.json",
    pluginRoot: DEFAULT_PLUGIN_ROOT,
    pluginId: "openclaw-message-stream",
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg) {
      continue;
    }
    if (arg === "--mode" && args[i + 1]) {
      const mode = args[i + 1];
      if (
        mode === "one-shot" ||
        mode === "scheduled" ||
        mode === "streaming" ||
        mode === "hybrid"
      ) {
        parsed.mode = mode;
      } else {
        throw new Error(`Invalid mode "${mode}". Expected one-shot|scheduled|streaming|hybrid.`);
      }
      i += 1;
      continue;
    }
    if (arg === "--output" && args[i + 1]) {
      parsed.output = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--plugin-root" && args[i + 1]) {
      parsed.pluginRoot = path.resolve(args[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--plugin-id" && args[i + 1]) {
      parsed.pluginId = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(
        [
          "Usage:",
          "  node generate-openclaw-config.mjs --output path/to/file.json --mode [one-shot|scheduled|streaming|hybrid]",
          "Options:",
          "  --output <file>         Config output path (default: openclaw-message-stream.config.json)",
          "  --mode <mode>           Plugin default mode (default: hybrid)",
          "  --plugin-root <path>    Plugin path for load.paths (default: this repo root)",
          "  --plugin-id <id>        Plugin id (default: openclaw-message-stream)",
        ].join("\n"),
      );
      process.exit(0);
    }
  }
  return parsed;
}

function buildConfig(pluginRoot, pluginId, mode) {
  return {
    plugins: {
      enabled: true,
      allow: [pluginId],
      load: {
        paths: [pluginRoot],
      },
      entries: {
        [pluginId]: {
          config: {
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
          },
        },
      },
    },
  };
}

function main() {
  const parsed = parseArgs();
  const config = buildConfig(parsed.pluginRoot, parsed.pluginId, parsed.mode);
  writeFileSync(parsed.output, JSON.stringify(config, null, 2), "utf8");
  console.log(`OpenClaw plugin config written to ${parsed.output}`);
}

main();
