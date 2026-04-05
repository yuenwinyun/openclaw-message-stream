import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT_PATH = path.resolve(PLUGIN_ROOT, "scripts", "openclaw-config.mjs");

const tempDirs = new Set<string>();

function writeTempConfig(value: unknown) {
  const dir = mkdtempSync(path.join(tmpdir(), "openclaw-message-stream-config-"));
  tempDirs.add(dir);
  const configPath = path.join(dir, "openclaw.config.json");
  writeFileSync(configPath, JSON.stringify(value), "utf8");
  return configPath;
}

function runConfig(args: string[]) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    encoding: "utf8",
  });
}

describe("openclaw config helper e2e", () => {
  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.clear();
  });

  it("upserts plugin config with dedupe and deterministic defaults", () => {
    const configPath = writeTempConfig({
      existing: true,
      plugins: { enabled: false, allow: ["other"] },
    });

    const first = runConfig([
      "--config",
      configPath,
      "--plugin-root",
      PLUGIN_ROOT,
      "--mode",
      "scheduled",
      "--write",
    ]);
    expect(first.status).toBe(0);
    expect(first.stdout).toContain("openclaw plugin config updated");

    const second = runConfig([
      "--config",
      configPath,
      "--plugin-root",
      PLUGIN_ROOT,
      "--mode",
      "streaming",
      "--write",
    ]);
    expect(second.status).toBe(0);

    const content = JSON.parse(readFileSync(configPath, "utf8")) as {
      plugins?: {
        enabled?: boolean;
        allow?: string[];
        load?: { paths?: string[] };
        entries?: Record<string, { config?: Record<string, unknown> }>;
      };
    };
    expect(content.plugins?.enabled).toBe(true);
    expect(content.plugins?.allow).toEqual([ "other", "openclaw-message-stream" ]);
    expect(content.plugins?.load?.paths).toEqual([PLUGIN_ROOT]);
    expect(content.plugins?.entries?.["openclaw-message-stream"]?.config?.mode).toBe("streaming");
    expect(content.plugins?.entries?.["openclaw-message-stream"]?.config?.enabled).toBe(true);
  });

  it("removes plugin config and prunes plugin sections cleanly", () => {
    const configPath = writeTempConfig({
      plugins: {
        enabled: true,
        allow: ["openclaw-message-stream", "another-plugin"],
        load: {
          paths: [PLUGIN_ROOT, "/other/path"],
        },
        entries: {
          "openclaw-message-stream": {
            config: {
              enabled: true,
              mode: "hybrid",
            },
          },
          "another-plugin": {
            config: {
              enabled: true,
            },
          },
        },
      },
    });

    const result = runConfig([
      "--action",
      "remove",
      "--config",
      configPath,
      "--plugin-root",
      PLUGIN_ROOT,
      "--write",
    ]);
    expect(result.status).toBe(0);

    const content = JSON.parse(readFileSync(configPath, "utf8")) as { plugins?: { allow?: string[]; load?: { paths?: string[] }; entries?: Record<string, { config?: unknown }> } };
    expect(content.plugins?.allow).toEqual(["another-plugin"]);
    expect(content.plugins?.load?.paths).toEqual(["/other/path"]);
    expect(content.plugins?.entries?.["openclaw-message-stream"]).toBeUndefined();
  });

  it("rejects unknown flags instead of silently defaulting", () => {
    const configPath = writeTempConfig({});
    const result = runConfig(["--config", configPath, "--unknown"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unknown option");
  });

  it("prints usage with --help and exits successfully", () => {
    const result = runConfig(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("--write");
  });

  it("fails when --write is used without a readable config source", () => {
    const result = runConfig(["--write"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  });
});
