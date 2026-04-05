import { formatReportText } from "./runtime.js";
import { createMessageStreamRuntime } from "./service.js";
import type { MessageStreamMode } from "./types.js";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";

const ALLOWED_MODES = ["one-shot", "scheduled", "streaming", "hybrid"] as const;

type ParsedRunArgs = {
  help: boolean;
  mode?: MessageStreamMode;
  invalidMode: string | null;
  sessionKeys: string[];
  dryRun: boolean;
};

function asMode(value: string): MessageStreamMode | null {
  const normalized = value.trim().toLowerCase();
  return ALLOWED_MODES.includes(normalized as MessageStreamMode)
    ? (normalized as MessageStreamMode)
    : null;
}

function splitCsvList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 1024);
}

function parseRunArgs(raw: string | undefined): ParsedRunArgs {
  const args = raw?.trim().split(/\s+/).filter(Boolean) ?? [];
  const result: ParsedRunArgs = {
    help: false,
    invalidMode: null,
    sessionKeys: [],
    dryRun: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (!token) {
      continue;
    }

    if (token === "--help" || token === "-h" || token.toLowerCase() === "help") {
      result.help = true;
      return result;
    }

    if (token === "--dry-run" || token === "--dryrun") {
      result.dryRun = true;
      continue;
    }

    if (token === "--no-dry-run" || token === "--noDryRun") {
      result.dryRun = false;
      continue;
    }

    if (token === "--mode" || token === "-m") {
      const next = args[i + 1];
      if (next) {
        const mode = asMode(next);
        result.mode = mode ?? undefined;
        if (!mode) {
          result.invalidMode = next;
        }
        i += 1;
      } else {
        result.invalidMode = token;
      }
      continue;
    }

    if (token.startsWith("--mode=")) {
      const modeRaw = token.replace(/^--mode=/, "");
      const mode = asMode(modeRaw);
      result.mode = mode ?? undefined;
      if (!mode) {
        result.invalidMode = modeRaw;
      }
      continue;
    }

    if (
      token === "--session" ||
      token === "--sessions" ||
      token === "--session-keys"
    ) {
      const next = args[i + 1];
      if (next) {
        result.sessionKeys.push(...splitCsvList(next));
        i += 1;
      }
      continue;
    }

    if (
      token.startsWith("--session=") ||
      token.startsWith("--sessions=") ||
      token.startsWith("--session-keys=")
    ) {
      const value = token.includes("=") ? token.split("=", 2)[1] : "";
      result.sessionKeys.push(...splitCsvList(value));
      continue;
    }

    if (!result.mode) {
      const mode = asMode(token);
      if (mode) {
        result.mode = mode;
        continue;
      }
    }

    result.sessionKeys.push(...splitCsvList(token));
  }

  return result;
}

function formatHelpText(): string {
  return [
    "Usage: /msgstream [mode] [options] [session_key...][,session2]",
    "Examples:",
    "  /msgstream",
    "  /msgstream one-shot --dry-run",
    "  /msgstream --mode scheduled --sessions session-a,session-b",
    "  /msgstream --help",
    "",
    "Modes:",
    "  one-shot   - one-time scan (default)",
    "  scheduled  - force one-time scheduled report in manual run",
    "  streaming  - force streaming-mode report in manual run",
    "  hybrid     - force hybrid-mode report in manual run",
    "",
    "Options:",
    "  --dry-run          simulate without emission",
    "  --mode <mode>      override mode",
    "  --session <key>     include session key",
    "  --sessions <a,b,c>  include many keys",
  ].join("\n");
}

function formatModeError(mode: string): string {
  return `Invalid mode "${mode}".\n\n${formatHelpText()}`;
}

function formatRunSummary(input: {
  mode: string;
  report: string;
  sessionKeys: string[];
  dryRun: boolean;
}): string {
  return [
    `Mode: ${input.mode}`,
    `Dry run: ${input.dryRun ? "true" : "false"}`,
    input.sessionKeys.length > 0
      ? `Session filter: ${input.sessionKeys.join(", ")}`
      : "Session filter: all matching sessions",
    input.report,
  ].join("\n");
}

export function registerMessageStreamCommand(api: OpenClawPluginApi): void {
  api.registerCommand({
    name: "msgstream",
    description: "Scan and analyze OpenClaw session messages.",
    acceptsArgs: true,
    handler: async (ctx) => {
      const parsed = parseRunArgs(ctx.args);
      if (parsed.help) {
        return { text: formatHelpText() };
      }

      if (parsed.invalidMode) {
        return { text: formatModeError(parsed.invalidMode) };
      }

      const requestedMode = parsed.mode ?? "one-shot";
      const runtimeConfig = api.runtime.config.loadConfig();
      const stateDir = api.runtime.state.resolveStateDir();
      const runtime = createMessageStreamRuntime({
        api,
        stateDir,
        runtimeConfig,
        modeOverride: requestedMode,
      });

      try {
        const report = await runtime.runOnce({
          mode: requestedMode,
          sessionKeys: parsed.sessionKeys,
          dryRun: parsed.dryRun,
        });
        await runtime.stop();
        return {
          text: formatRunSummary({
            mode: report.mode,
            report: formatReportText(report),
            sessionKeys: parsed.sessionKeys,
            dryRun: parsed.dryRun,
          }),
        };
      } catch (err) {
        try {
          await runtime.stop();
        } catch {
          // noop
        }
        return {
          text: `msgstream: run failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  });
}
