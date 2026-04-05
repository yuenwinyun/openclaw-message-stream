import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMessageStreamRuntime } from "../src/service.js";

const sessionKeys = (process.env.OPENCLAW_MSGSTREAM_SESSION_KEYS ?? "")
  .split(",")
  .map((sessionKey) => sessionKey.trim())
  .filter(Boolean);
const hasIntegrationConfig = Boolean(process.env.OPENCLAW_GATEWAY_URL) && sessionKeys.length > 0;
const runtimeDescribe = hasIntegrationConfig ? describe : describe.skip;
const integrationRequirementMessage = `
  Skipped: requires OPENCLAW_GATEWAY_URL and OPENCLAW_MSGSTREAM_SESSION_KEYS (comma-separated session keys).
  Optional: OPENCLAW_GATEWAY_TOKEN, OPENCLAW_GATEWAY_PASSWORD, OPENCLAW_GATEWAY_CONNECT_TIMEOUT_MS, OPENCLAW_GATEWAY_SCOPES.
`.trim();

const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL ?? "";
const token = process.env.OPENCLAW_GATEWAY_TOKEN;
const password = process.env.OPENCLAW_GATEWAY_PASSWORD;
const connectTimeoutMs = Number.isFinite(Number(process.env.OPENCLAW_GATEWAY_CONNECT_TIMEOUT_MS))
  ? Number(process.env.OPENCLAW_GATEWAY_CONNECT_TIMEOUT_MS)
  : 15000;
const scopes = (process.env.OPENCLAW_GATEWAY_SCOPES ?? "")
  .split(",")
  .map((scope) => scope.trim())
  .filter(Boolean);
const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

runtimeDescribe(
  `openclaw runtime integration e2e${
    hasIntegrationConfig ? "" : ` ( ${integrationRequirementMessage} )`
  }`,
  () => {
  let stateDir = "/tmp/openclaw-message-stream-e2e";

  beforeEach(async () => {
    stateDir = await mkdtemp(path.join(tmpdir(), "openclaw-message-stream-e2e-"));
  });

  it(
    "runs a one-shot scan against a real OpenClaw gateway",
    { timeout: 60_000 },
    async () => {
      expect(sessionKeys.length).toBeGreaterThan(0);

      const runtime = createMessageStreamRuntime({
        api: {
          logger,
        },
        stateDir,
        runtimeConfig: {
          plugins: {
            entries: {
              "openclaw-message-stream": {
                config: {
                  gateway: {
                    url: gatewayUrl,
                    token,
                    password,
                    connectTimeoutMs,
                    scopes,
                  },
                  output: {
                    dryRun: true,
                    console: false,
                  },
                },
              },
            },
          },
        },
      });

      const report = await runtime.runOnce({
        mode: "one-shot",
        sessionKeys,
        dryRun: true,
      });

      expect(report.mode).toBe("one-shot");
      expect(report.sessionsTotal).toBe(sessionKeys.length);
      expect(report.sessionsProcessed).toBe(sessionKeys.length);
      expect(report.messagesScanned).toBeGreaterThanOrEqual(0);
      expect(report.durationMs).toBeGreaterThanOrEqual(0);
      expect(report.runId).toBeTypeOf("string");
      expect(report.errors).toBe(0);

      await runtime.stop();
    },
  );

  afterEach(async () => {
    await rm(stateDir, { recursive: true, force: true });
  });
});
