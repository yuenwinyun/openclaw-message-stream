import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { PluginLogger } from "openclaw/plugin-sdk/plugin-entry";
import type {
  MessageStreamMessageAnalysis,
  MessageStreamOutputRecord,
  MessageStreamOutputConfig,
} from "./types.js";

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) {
    return text;
  }
  return text.slice(0, maxLen - 1).trim() + "…";
}

function hashPayload(record: MessageStreamOutputRecord): string {
  return createHash("sha1")
    .update(
      JSON.stringify({
        sessionKey: record.sessionKey,
        messageId: record.messageId,
        messageSeq: record.messageSeq,
        score: record.score,
        findings: record.findings,
      }),
    )
    .digest("hex");
}

export type OutputEmitInput = {
  mode: MessageStreamOutputRecord["mode"];
  runId: string;
  record: MessageStreamOutputRecord;
  matched: MessageStreamMessageAnalysis;
  analyzedText: string;
  config: MessageStreamOutputConfig;
  logger: PluginLogger;
};

function formatConsole(record: MessageStreamOutputRecord, output: MessageStreamOutputConfig): string {
  const compact = `${record.sessionKey} ${record.sender ?? "unknown"} [${record.messageRole}] ${
    record.matched ? "MATCH" : "NO-MATCH"
  } score=${record.score.toFixed(2)} findings=${record.findings.length}`;
  const text = truncateText(record.content, output.consoleMaxText);
  return `${compact}\n  ${record.messageId ? `id=${record.messageId} ` : ""}text=${text}`;
}

async function emitToFile(record: MessageStreamOutputRecord, output: MessageStreamOutputConfig, logger: PluginLogger) {
  if (!output.filePath) {
    return;
  }
  const filePath = path.resolve(process.cwd(), output.filePath);
  const line = JSON.stringify(record);
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, `${line}\n`, "utf-8");
  } catch (err) {
    logger.error(`message-stream: failed to append file output ${filePath}: ${String(err)}`);
  }
}

async function emitToWebhook(record: MessageStreamOutputRecord, output: MessageStreamOutputConfig, logger: PluginLogger) {
  if (!output.webhookUrl) {
    return;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), output.webhookTimeoutMs);
  try {
    const body = JSON.stringify({
      id: hashPayload(record),
      ts: Date.now(),
      source: "openclaw-message-stream",
      payload: record,
    });

    const response = await fetch(output.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: controller.signal,
    });
    if (!response.ok) {
      logger.warn(`message-stream: webhook returned ${response.status} ${response.statusText}`);
      return;
    }
  } catch (err) {
    logger.warn(`message-stream: webhook emit failed: ${String(err)}`);
  } finally {
    clearTimeout(timeout);
  }
}

export async function emitMessageMatch(input: OutputEmitInput): Promise<void> {
  const record = {
    ...input.record,
    findings: input.record.findings,
    ts: Date.now(),
    runId: input.runId,
    mode: input.mode,
  };
  const output = input.config;
  const shouldEmitMatch = input.matched.hasFinding || output.emitNoMatches;
  if (!shouldEmitMatch) {
    return;
  }

  if (output.console) {
    const text = formatConsole(record, output);
    output.consoleMaxText > 0 ? input.logger.info(text) : input.logger.info(text.slice(0, 200));
  }

  if (output.webhookUrl || output.filePath) {
    if (output.filePath) {
      await emitToFile(record, output, input.logger);
    }
    if (output.webhookUrl) {
      await emitToWebhook(record, output, input.logger);
    }
  }
}
