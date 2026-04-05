import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOpenClawHostRunner } from "./utils/openclaw-host-runner.ts";

const PLUGIN_ID = "openclaw-message-stream";
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stateDir = mkdtempSync(path.join(tmpdir(), `${PLUGIN_ID}-host-e2e-`));
const configPath = path.join(stateDir, "openclaw-host-e2e.json");
const openclawCliPath = process.env.OPENCLAW_CLI_PATH;
const openclawDockerImage = process.env.OPENCLAW_DOCKER_IMAGE?.trim();

const runner = createOpenClawHostRunner({
  pluginRoot: PLUGIN_ROOT,
  stateDir,
  configPath,
  ...(openclawCliPath ? { openclawCliPath } : {}),
  ...(openclawDockerImage ? { openclawDockerImage } : {}),
});

const hostDescribe = runner.canRun ? describe : describe.skip;
const hostSkipReason = runner.cliAvailable
  ? ""
  : `Skipped: install OpenClaw locally (defaults to ./node_modules/openclaw/openclaw.mjs) or set OPENCLAW_DOCKER_IMAGE to run containerized host tests.`;

function writeOpenClawConfig() {
  const config = {
    plugins: {
      enabled: true,
      allow: [PLUGIN_ID],
      load: {
        paths: [PLUGIN_ROOT],
      },
    },
  };
  writeFileSync(configPath, JSON.stringify(config), "utf8");
}

function parseOpenClawJsonOutput(rawOutput: string): unknown {
  const output = rawOutput.trim();
  const jsonStart = output.indexOf("{");
  const jsonEnd = output.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd <= jsonStart) {
    throw new Error(`No JSON payload found in OpenClaw output: ${output}`);
  }
  const jsonText = output.slice(jsonStart, jsonEnd + 1);
  return JSON.parse(jsonText);
}

hostDescribe(`openclaw plugin host e2e${hostSkipReason ? ` (${hostSkipReason})` : ""}`, () => {
  beforeAll(() => {
    writeOpenClawConfig();
  });

  it("exposes the plugin in openclaw list --json", async () => {
    const result = await runner.runOpenClaw(["plugins", "list", "--json"], { timeoutMs: 60_000 });
    const parsed = parseOpenClawJsonOutput(result.output) as {
      plugins?: {
        id?: string;
        status?: string;
        source?: string;
      }[];
    };

    const plugin = parsed.plugins?.find((candidate) => candidate.id === PLUGIN_ID);
    expect(plugin).toBeDefined();
    expect(plugin?.status).toBe("loaded");
    expect(plugin?.source).toContain(PLUGIN_ROOT);
  });

  it("discovers plugin metadata and /msgstream command via openclaw inspect", async () => {
    const result = await runner.runOpenClaw(["plugins", "inspect", PLUGIN_ID, "--json"], { timeoutMs: 60_000 });
    const parsed = parseOpenClawJsonOutput(result.output) as {
      plugin?: { id?: string; status?: string; commands?: string[]; services?: string[] };
      commands?: string[];
      services?: string[];
    };

    const plugin = parsed.plugin;

    expect(plugin?.id).toBe(PLUGIN_ID);
    expect(plugin?.status).toBe("loaded");
    expect((plugin?.commands ?? parsed.commands ?? []).includes("msgstream")).toBe(true);
    expect((plugin?.services ?? parsed.services ?? []).includes(PLUGIN_ID)).toBe(true);
  });

  it("passes openclaw plugin doctor checks after registration", async () => {
    const output = await runner.runOpenClaw(["plugins", "doctor"]);
    expect(output.output).toContain("No plugin issues detected.");
  });

  afterAll(() => {
    rmSync(stateDir, { recursive: true, force: true });
  });
});
