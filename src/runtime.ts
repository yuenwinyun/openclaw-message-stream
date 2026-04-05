import { createHash } from "node:crypto";

import { GatewayClient } from "openclaw/plugin-sdk/gateway-runtime";
import type { EventFrame } from "openclaw/plugin-sdk/gateway-runtime";
import type { PluginLogger } from "openclaw/plugin-sdk/plugin-entry";

import { analyzeMessage } from "./analyzers.js";
import { createCheckpointStore, type CheckpointStore } from "./checkpoint.js";
import { emitMessageMatch } from "./emitter.js";
import { normalizeSessionMessage } from "./normalizer.js";
import type {
  MessageStreamConfig,
  MessageStreamMode,
  MessageStreamOutputRecord,
  MessageStreamRunReport,
} from "./types.js";

type SessionsListResult = {
  sessions?: Array<{ key?: unknown }>;
};

type SessionsGetResult = {
  messages?: unknown[];
};

type SessionsMessagesSubscribeResult = {
  subscribed?: unknown;
  key?: unknown;
};

type RunOptions = {
  mode?: MessageStreamMode;
  sessionKeys?: string[];
  dryRun?: boolean;
};

type ScanResult = {
  report: MessageStreamRunReport;
  sessionKeys: string[];
};

const PLUGIN_ID = "openclaw-message-stream";

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toStringIfDefined(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

function normalizeKeyValue(value: unknown): string | undefined {
  const normalized = toStringIfDefined(value);
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

function parseMode(value: unknown): MessageStreamMode {
  if (value === "one-shot" || value === "scheduled" || value === "streaming" || value === "hybrid") {
    return value;
  }
  return "hybrid";
}

function normalizeSessionKeys(values: unknown): string[] {
  if (!Array.isArray(values)) {
    const single = normalizeKeyValue(values);
    return single ? [single] : [];
  }
  return uniqueStrings(
    values
      .flatMap((value) =>
        normalizeKeyValue(value)
          ?.split(",")
          .map((item) => item.trim())
          .filter(Boolean) ?? [],
      ),
  ).slice(0, 1024);
}

function hashText(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

function now(): number {
  return Date.now();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatReportText(report: MessageStreamRunReport): string {
  const mode = report.mode;
  const lines = [
    `Mode: ${mode}`,
    `Run id: ${report.runId}`,
    `Duration: ${report.durationMs}ms`,
    `Sessions: ${report.sessionsProcessed}/${report.sessionsTotal}`,
    `Messages: scanned ${report.messagesScanned}, analyzed ${report.messagesAnalyzed}`,
    `Matches: ${report.matchesFound}`,
    `Emitted: ${report.emitted}`,
    `Errors: ${report.errors}`,
  ];
  return lines.join("\n");
}

export class MessageStreamRuntime {
  private readonly config: MessageStreamConfig;
  private readonly logger: PluginLogger;
  private readonly stateDir: string;
  private checkpointStore: CheckpointStore | null = null;
  private gatewayClient: GatewayClient | null = null;
  private isStopping = false;
  private activeTimer: NodeJS.Timeout | null = null;
  private scanInProgress = false;
  private subscribedSessionKeys = new Set<string>();

  constructor(params: { config: MessageStreamConfig; logger: PluginLogger; stateDir: string }) {
    this.config = params.config;
    this.logger = params.logger;
    this.stateDir = params.stateDir;
  }

  public async start(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.info(`[${PLUGIN_ID}] disabled by config`);
      return;
    }

    const mode = this.config.mode;
    this.isStopping = false;

    if (mode === "one-shot") {
      await this.runOnce({ mode: "one-shot" });
      await this.stop();
      return;
    }

    if (mode === "streaming" || mode === "hybrid") {
      if (mode === "hybrid") {
        const { sessionKeys } = await this.scanAndReport({ mode });
        await this.syncStreamingSubscriptions(sessionKeys);
      } else {
        const sessionKeys = await this.resolveSessionKeys();
        await this.syncStreamingSubscriptions(sessionKeys);
      }
    }

    if (mode === "scheduled" || mode === "hybrid") {
      const intervalMs = this.config.scan.intervalMs;
      if (this.activeTimer) {
        clearInterval(this.activeTimer);
      }
      await this.scanAndReport({ mode });
      this.activeTimer = setInterval(() => {
        void this.runPeriodic(mode);
      }, intervalMs);
    }

    this.logger.info(`[${PLUGIN_ID}] runtime started in ${mode} mode`);
  }

  public async runOnce(params?: RunOptions): Promise<MessageStreamRunReport> {
    const requestedMode = parseMode(params?.mode);
    const mode: MessageStreamMode = params?.mode ? requestedMode : this.config.mode;
    const { report } = await this.scanAndReport({
      mode,
      sessionKeys: params?.sessionKeys,
      dryRun: params?.dryRun,
      includeSubscriptionRefresh: false,
    });
    this.logger.info(formatReportText(report));
    return report;
  }

  public async stop(): Promise<void> {
    this.isStopping = true;

    if (this.activeTimer) {
      clearInterval(this.activeTimer);
      this.activeTimer = null;
    }

    if (this.checkpointStore) {
      try {
        await this.checkpointStore.close();
      } catch (err) {
        this.logger.error(`[${PLUGIN_ID}] failed to close checkpoint state: ${String(err)}`);
      }
      this.checkpointStore = null;
    }

    if (this.gatewayClient) {
      try {
        await this.gatewayClient.stopAndWait({ timeoutMs: 1_000 });
      } catch (err) {
        this.logger.error(`[${PLUGIN_ID}] failed to close gateway connection: ${String(err)}`);
      }
      this.gatewayClient = null;
    }

    this.subscribedSessionKeys.clear();
  }

  private async runPeriodic(mode: MessageStreamMode): Promise<void> {
    if (this.scanInProgress || this.isStopping) {
      return;
    }
    this.scanInProgress = true;
    try {
      const includeSubscriptionRefresh = mode === "hybrid";
      const { report, sessionKeys } = await this.scanAndReport({
        mode,
        includeSubscriptionRefresh,
      });
      if (includeSubscriptionRefresh) {
        await this.syncStreamingSubscriptions(sessionKeys);
      }
      this.logger.debug?.(`[${PLUGIN_ID}] periodic run complete: ${formatReportText(report)}`);
    } catch (err) {
      this.logger.error(`[${PLUGIN_ID}] periodic scan failed: ${String(err)}`);
    } finally {
      this.scanInProgress = false;
    }
  }

  private async scanAndReport(params: {
    mode: MessageStreamMode;
    sessionKeys?: string[];
    dryRun?: boolean;
    includeSubscriptionRefresh?: boolean;
  }): Promise<ScanResult> {
    const startedAt = now();
    const mode = params.mode;
    const report: MessageStreamRunReport = {
      runId: `${now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      mode,
      startedAt,
      durationMs: 0,
      sessionsTotal: 0,
      sessionsProcessed: 0,
      messagesScanned: 0,
      messagesAnalyzed: 0,
      matchesFound: 0,
      emitted: 0,
      errors: 0,
    };

    const explicitKeys = normalizeSessionKeys(params.sessionKeys);
    const sessionKeys = await this.resolveSessionKeys(explicitKeys);
    report.sessionsTotal = sessionKeys.length;

    for (const sessionKey of sessionKeys) {
      if (this.isStopping) {
        break;
      }
      report.sessionsProcessed += 1;
      try {
        const payload = await this.request<SessionsGetResult>("sessions.get", {
          key: sessionKey,
          limit: this.config.scan.batchSize,
        });
        const rawMessages = Array.isArray(payload.messages) ? payload.messages : [];
        for (const rawMessage of rawMessages) {
          if (this.isStopping) {
            break;
          }
          report.messagesScanned += 1;
          const normalized = normalizeSessionMessage(sessionKey, rawMessage);
          if (!normalized) {
            continue;
          }
          const contentHash = hashText(normalized.content);
          const checkpointStore = await this.getCheckpointStore();
          const shouldSkip = await checkpointStore.shouldSkip(
            normalized.sessionKey,
            normalized.messageId,
            normalized.messageSeq,
            contentHash,
          );
          if (shouldSkip) {
            continue;
          }

          report.messagesAnalyzed += 1;
          const analysis = analyzeMessage(normalized, this.config.analysis);
          if (analysis.hasFinding) {
            report.matchesFound += 1;
          }

          const record: MessageStreamOutputRecord = {
            runId: report.runId,
            ts: now(),
            plugin: this.config.pluginName,
            mode,
            sessionKey: normalized.sessionKey,
            messageId: normalized.messageId,
            messageSeq: normalized.messageSeq,
            sender: normalized.sender,
            messageRole: normalized.role,
            messageTimestamp: normalized.timestamp,
            content: normalized.content,
            score: analysis.score,
            findings: analysis.findings,
            matched: analysis.hasFinding,
          };

          if (!params.dryRun && !this.config.output.dryRun) {
            if (JSON.stringify(record).length <= this.config.output.payloadMaxBytes) {
              await emitMessageMatch({
                runId: report.runId,
                mode,
                record,
                analyzedText: normalized.content,
                matched: analysis,
                config: this.config.output,
                logger: this.logger,
              });
              if (analysis.hasFinding || this.config.output.emitNoMatches) {
                report.emitted += 1;
              }
            } else {
              report.errors += 1;
              this.logger.warn(
                `[${PLUGIN_ID}] skipped oversize output payload for ${sessionKey} message ${normalized.messageId ?? "<no-id>"}`,
              );
            }
          }

          await checkpointStore.markSeen(
            normalized.sessionKey,
            normalized.messageId,
            normalized.messageSeq,
            contentHash,
          );
        }
      } catch (err) {
        report.errors += 1;
        this.logger.error(`[${PLUGIN_ID}] failed to process session ${sessionKey}: ${String(err)}`);
      }

      if (params.includeSubscriptionRefresh && sessionKeys.length > 0 && !this.isStopping) {
        await this.syncStreamingSubscriptions(sessionKeys);
      }
    }

    report.durationMs = now() - startedAt;
    return { report, sessionKeys };
  }

  private async resolveSessionKeys(explicitKeys: string[] = []): Promise<string[]> {
    if (explicitKeys.length > 0) {
      return uniqueStrings(explicitKeys).slice(0, this.config.scan.maxSessions);
    }

    const payload = await this.request<SessionsListResult>("sessions.list", {
      limit: this.config.scan.limit,
      includeGlobal: this.config.filters.includeGlobal,
      includeUnknown: this.config.filters.includeUnknown,
      label: this.config.filters.label,
      spawnedBy: this.config.filters.spawnedBy,
      agentId: this.config.filters.agentId,
      search: this.config.filters.search,
    });

    const rows = Array.isArray(payload?.sessions) ? payload.sessions : [];
    const discovered = rows
      .map((entry) => normalizeKeyValue((entry as { key?: unknown }).key))
      .filter((key): key is string => Boolean(key))
      .slice(0, this.config.scan.limit);

    return uniqueStrings(discovered).slice(0, this.config.scan.maxSessions);
  }

  private async syncStreamingSubscriptions(sessionKeys: string[]): Promise<void> {
    if (this.isStopping) {
      return;
    }
    const wanted = new Set(sessionKeys);
    const toUnsubscribe = [...this.subscribedSessionKeys].filter((key) => !wanted.has(key));
    const toSubscribe = [...wanted].filter((key) => !this.subscribedSessionKeys.has(key));

    for (const key of toUnsubscribe) {
      try {
        await this.request<SessionsMessagesSubscribeResult>("sessions.messages.unsubscribe", { key });
      } catch (err) {
        this.logger.warn(
          `[${PLUGIN_ID}] failed to unsubscribe session ${key}: ${String(err)}`,
        );
      }
      this.subscribedSessionKeys.delete(key);
    }

    for (const key of toSubscribe) {
      try {
        const response = await this.request<SessionsMessagesSubscribeResult>(
          "sessions.messages.subscribe",
          {
            key,
          },
        );
        if (response?.subscribed === true) {
          this.subscribedSessionKeys.add(key);
        }
      } catch (err) {
        this.logger.warn(`[${PLUGIN_ID}] failed to subscribe session ${key}: ${String(err)}`);
      }
    }

    // Ensure callback stays attached for the live message stream.
    if (this.subscribedSessionKeys.size > 0 && this.gatewayClient) {
      this.logger.debug?.(
        `[${PLUGIN_ID}] subscribed to ${this.subscribedSessionKeys.size} session message streams`,
      );
    }
  }

  private async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const client = await this.getGatewayClient();
    try {
      return await client.request<T>(method, params);
    } catch (err) {
      if (this.isStopping) {
        throw err;
      }
      // Best-effort reconnect for transient connection races.
      const message = String(err);
      if (!message.includes("not connected") && !message.includes("timeout")) {
        throw err;
      }
      this.logger.warn(`[${PLUGIN_ID}] gateway request failed, reconnecting: ${String(err)}`);
      await this.resetGatewayClient();
      const retriedClient = await this.getGatewayClient();
      return await retriedClient.request<T>(method, params, { timeoutMs: 12_000, expectFinal: true });
    }
  }

  private async getGatewayClient(): Promise<GatewayClient> {
    if (!this.gatewayClient) {
      this.gatewayClient = new GatewayClient({
        url: this.config.gateway.url,
        token: this.config.gateway.token,
        password: this.config.gateway.password,
        connectChallengeTimeoutMs: this.config.gateway.connectTimeoutMs,
        scopes: this.config.gateway.scopes,
        onEvent: (evt) => {
          void this.handleGatewayEvent(evt);
        },
        onConnectError: (error) => {
          this.logger.error(`[${PLUGIN_ID}] gateway connect error: ${String(error)}`);
        },
        onClose: (code, reason) => {
          this.logger.warn(`[${PLUGIN_ID}] gateway closed (${code}): ${reason}`);
        },
      });
      this.gatewayClient.start();
      // Give the underlying client a chance to negotiate before first request.
      await delay(100);
    }
    return this.gatewayClient;
  }

  private async resetGatewayClient(): Promise<void> {
    if (this.gatewayClient) {
      try {
        await this.gatewayClient.stopAndWait({ timeoutMs: 1_000 });
      } catch {
        // ignore
      }
      this.gatewayClient = null;
    }
    await this.getGatewayClient();
  }

  private async getCheckpointStore(): Promise<CheckpointStore> {
    if (!this.checkpointStore) {
      this.checkpointStore = await createCheckpointStore(
        this.stateDir,
        this.config.checkpointFile,
        this.logger,
      );
    }
    return this.checkpointStore;
  }

  private async handleGatewayEvent(frame: EventFrame): Promise<void> {
    if (this.config.mode !== "streaming" && this.config.mode !== "hybrid") {
      return;
    }
    if (frame.event !== "session.message") {
      return;
    }
    if (this.isStopping) {
      return;
    }

    const payload = isObject(frame.payload) ? frame.payload : null;
    if (!payload) {
      return;
    }
    const sessionKey = normalizeKeyValue(payload.sessionKey);
    if (!sessionKey) {
      return;
    }
    const message = isObject(payload.message) ? payload.message : null;
    if (!message) {
      return;
    }

    const sourceMessage = {
      ...message,
      ...(typeof payload.messageId === "string" ? { messageId: payload.messageId } : {}),
      ...(typeof payload.messageSeq === "number" ? { messageSeq: payload.messageSeq } : {}),
    };

    const normalized = normalizeSessionMessage(sessionKey, sourceMessage);
    if (!normalized) {
      return;
    }

    const contentHash = hashText(normalized.content);
    const checkpoint = await this.getCheckpointStore();
    const shouldSkip = await checkpoint.shouldSkip(
      normalized.sessionKey,
      normalized.messageId,
      normalized.messageSeq,
      contentHash,
    );
    if (shouldSkip) {
      return;
    }

    const analysis = analyzeMessage(normalized, this.config.analysis);
    const runId = `${now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const record: MessageStreamOutputRecord = {
      runId,
      ts: now(),
      plugin: this.config.pluginName,
      mode: this.config.mode,
      sessionKey: normalized.sessionKey,
      messageId: normalized.messageId,
      messageSeq: normalized.messageSeq,
      sender: normalized.sender,
      messageRole: normalized.role,
      messageTimestamp: normalized.timestamp,
      content: normalized.content,
      score: analysis.score,
      findings: analysis.findings,
      matched: analysis.hasFinding,
    };

    if (!this.config.output.dryRun && JSON.stringify(record).length <= this.config.output.payloadMaxBytes) {
      await emitMessageMatch({
        mode: this.config.mode,
        runId,
        record,
        analyzedText: normalized.content,
        matched: analysis,
        config: this.config.output,
        logger: this.logger,
      });
    }

    await checkpoint.markSeen(normalized.sessionKey, normalized.messageId, normalized.messageSeq, contentHash);
  }
}

export { parseMode, formatReportText };
