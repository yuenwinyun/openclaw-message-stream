import type { MessageStreamConfig, MessageStreamFilterConfig } from "./types.js";

const DEFAULT_SCAN_LIMIT = 200;
const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_MAX_SESSIONS = 120;
const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_FILE_PATH = "openclaw-message-stream-output.jsonl";
export const DEFAULT_LOCAL_GATEWAY_URL = "ws://127.0.0.1:18789";
const DEFAULT_REQUIRED_GATEWAY_SCOPES = ["operator.read"];

export const DEFAULT_PLUGN_MSG_STREAM_KEYWORDS = [
  "password",
  "api key",
  "api token",
  "secret",
  "credential",
  "token",
  "ssn",
  "social security",
  "credit card",
  "card number",
];

export const DEFAULT_PLUGN_MSG_STREAM_PATTERNS = [
  String.raw`(?i)\b(bypass|ignore|override|elevate|escalate)\b.*\b(permissions|privileges)\b`,
  String.raw`(?i)\b(risk|threat|attack|exploit)\b`,
  String.raw`(?i)\b(beta|debug|internal)\s+api\s+route\b`,
];

function normalizeNumber(value: unknown, fallback: number, min = 1, max = 100_000): number {
  const parsed =
    typeof value === "number" && Number.isFinite(value)
      ? value
      : typeof value === "string" && value.trim()
        ? Number.parseInt(value.trim(), 10)
        : NaN;
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === "true") {
      return true;
    }
    if (trimmed === "false") {
      return false;
    }
  }
  return fallback;
}

function normalizeString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) =>
        typeof item === "string"
          ? item
              .split(",")
              .map((entry) => entry.trim())
              .filter(Boolean)
          : [],
      )
      .map((entry) => entry.toLowerCase())
      .filter((entry, i, arr) => arr.indexOf(entry) === i);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => entry.toLowerCase());
  }
  return [];
}

function normalizeScopeList(value: unknown): string[] {
  return normalizeStringArray(value).filter(Boolean).slice(0, 32);
}

function normalizeScopesWithRequiredDefaults(scopes: string[]): string[] {
  const merged = scopes
    .filter((scope) => scope)
    .map((scope) => scope.toLowerCase())
    .slice(0, 32);
  const set = new Set(merged);
  for (const scope of DEFAULT_REQUIRED_GATEWAY_SCOPES) {
    set.add(scope);
  }
  return Array.from(set);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function resolveHostGatewayToken(hostGateway: Record<string, unknown> | null): string {
  const hostAuth = asRecord(hostGateway?.auth);
  return normalizeString(hostAuth?.token || hostGateway?.token);
}

function resolveHostGatewayPassword(hostGateway: Record<string, unknown> | null): string {
  const hostAuth = asRecord(hostGateway?.auth);
  return normalizeString(hostAuth?.password || hostGateway?.password);
}

function resolveHostGatewayUrl(hostGateway: Record<string, unknown> | null): string {
  const hostRemote = asRecord(hostGateway?.remote);
  const remoteUrl = normalizeString(hostRemote?.url);
  if (remoteUrl) {
    return remoteUrl;
  }
  const directUrl = normalizeString(hostGateway?.url);
  if (directUrl) {
    return directUrl;
  }
  const mode = normalizeString(hostGateway?.mode).toLowerCase();
  if (mode === "remote") {
    return "";
  }
  return DEFAULT_LOCAL_GATEWAY_URL;
}

export function mergeGatewayConfigWithHost(
  pluginGateway: unknown,
  hostGateway: unknown,
): Record<string, unknown> {
  const plugin = asRecord(pluginGateway) ?? {};
  const host = asRecord(hostGateway) ?? {};

  return {
    ...host,
    ...plugin,
    url: normalizeString(plugin.url) || resolveHostGatewayUrl(host),
    token: normalizeString(plugin.token) || resolveHostGatewayToken(host),
    password: normalizeString(plugin.password) || resolveHostGatewayPassword(host),
    connectTimeoutMs: plugin.connectTimeoutMs === undefined ? host.connectTimeoutMs : plugin.connectTimeoutMs,
    scopes: normalizeScopesWithRequiredDefaults(
      normalizeScopeList(plugin.scopes === undefined ? host.scopes : plugin.scopes),
    ),
  };
}

function normalizeFilterConfig(value: unknown): MessageStreamFilterConfig {
  const parsed = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    includeGlobal: parsed.includeGlobal === undefined ? true : normalizeBoolean(parsed.includeGlobal, true),
    includeUnknown: normalizeBoolean(parsed.includeUnknown, true),
    label: normalizeString(parsed.label),
    spawnedBy: normalizeString(parsed.spawnedBy),
    agentId: normalizeString(parsed.agentId),
    search: normalizeString(parsed.search),
  };
}

export function parseMessageStreamConfig(value: unknown): MessageStreamConfig {
  const parsed = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const analysis = parsed.analysis && typeof parsed.analysis === "object" ? (parsed.analysis as Record<string, unknown>) : {};
  const output = parsed.output && typeof parsed.output === "object" ? (parsed.output as Record<string, unknown>) : {};
  const gateway = parsed.gateway && typeof parsed.gateway === "object" ? (parsed.gateway as Record<string, unknown>) : {};
  const scan = parsed.scan && typeof parsed.scan === "object" ? (parsed.scan as Record<string, unknown>) : {};

  const filters = normalizeFilterConfig(parsed.filters);
  const mode = normalizeString(scan.mode || parsed.mode, "hybrid") as MessageStreamConfig["mode"];

  const resolvedMode: MessageStreamConfig["mode"] = (
    mode === "one-shot" || mode === "scheduled" || mode === "streaming" || mode === "hybrid"
      ? mode
      : "hybrid"
  ) satisfies MessageStreamConfig["mode"];

  const resolvedKeywords = normalizeStringArray(analysis.keyword && typeof analysis.keyword === "object"
    ? (analysis.keyword as { terms?: unknown }).terms
    : undefined);

  const resolvedPatterns = normalizeStringArray(analysis.regex && typeof analysis.regex === "object"
    ? (analysis.regex as { patterns?: unknown }).patterns
    : undefined);

  return {
    enabled: normalizeBoolean(parsed.enabled, true),
    pluginName: normalizeString(parsed.pluginName, "openclaw-message-stream"),
    mode: resolvedMode,
    scan: {
      limit: normalizeNumber(scan.limit, DEFAULT_SCAN_LIMIT, 1, 10000),
      batchSize: normalizeNumber(scan.batchSize, DEFAULT_BATCH_SIZE, 1, 50000),
      maxSessions: normalizeNumber(scan.maxSessions, DEFAULT_MAX_SESSIONS, 1, 50000),
      intervalMs: normalizeNumber(scan.intervalMs, DEFAULT_INTERVAL_MS, 100, 24 * 60 * 60 * 1000),
    },
    filters,
    analysis: {
      keyword: {
        enabled: normalizeBoolean((analysis.keyword as { enabled?: unknown } | undefined)?.enabled, true),
        weight: normalizeNumber((analysis.keyword as { weight?: unknown } | undefined)?.weight, 1, 1, 10),
        terms:
          resolvedKeywords.length > 0
            ? resolvedKeywords
            : DEFAULT_PLUGN_MSG_STREAM_KEYWORDS,
      },
      regex: {
        enabled: normalizeBoolean((analysis.regex as { enabled?: unknown } | undefined)?.enabled, false),
        weight: normalizeNumber((analysis.regex as { weight?: unknown } | undefined)?.weight, 1, 1, 10),
        caseSensitive: normalizeBoolean((analysis.regex as { caseSensitive?: unknown } | undefined)?.caseSensitive, false),
        patterns:
          resolvedPatterns.length > 0
            ? resolvedPatterns
            : DEFAULT_PLUGN_MSG_STREAM_PATTERNS,
      },
      pii: {
        enabled: normalizeBoolean((analysis.pii as { enabled?: unknown } | undefined)?.enabled, true),
        detectEmail: normalizeBoolean((analysis.pii as { detectEmail?: unknown } | undefined)?.detectEmail, true),
        detectPhone: normalizeBoolean((analysis.pii as { detectPhone?: unknown } | undefined)?.detectPhone, true),
        detectApiKey: normalizeBoolean((analysis.pii as { detectApiKey?: unknown } | undefined)?.detectApiKey, true),
        weight: normalizeNumber((analysis.pii as { weight?: unknown } | undefined)?.weight, 1, 1, 10),
      },
      sentiment: {
        enabled: normalizeBoolean((analysis.sentiment as { enabled?: unknown } | undefined)?.enabled, false),
        weight: normalizeNumber((analysis.sentiment as { weight?: unknown } | undefined)?.weight, 1, 1, 10),
      },
    },
    gateway: {
      url: normalizeString(gateway.url),
      token: normalizeString(gateway.token),
      password: normalizeString(gateway.password),
      connectTimeoutMs: normalizeNumber(gateway.connectTimeoutMs, 15000, 100, 120_000),
      scopes: normalizeScopeList(gateway.scopes),
    },
    output: {
      emitNoMatches: normalizeBoolean(output.emitNoMatches, false),
      filePath: normalizeString(output.filePath, DEFAULT_FILE_PATH),
      webhookUrl: normalizeString(output.webhookUrl),
      console: normalizeBoolean(output.console, true),
      consoleMaxText: normalizeNumber(output.consoleMaxText, 300, 40, 4000),
      payloadMaxBytes: normalizeNumber(output.payloadMaxBytes, 2_097_152, 64 * 1024, 1024 * 1024),
      webhookTimeoutMs: normalizeNumber(output.webhookTimeoutMs, 8_000, 500, 120_000),
      dryRun: normalizeBoolean(output.dryRun, false),
    },
    checkpointFile: normalizeString(output.checkpointFile, ".openclaw-message-stream-state.json"),
    sessionKeys: normalizeStringArray(parsed.sessionKeys),
  };
}

export const messageStreamConfigSchema = {
  parse: parseMessageStreamConfig as (value: unknown) => MessageStreamConfig,
  uiHints: {
    enabled: { label: "Enable plugin", help: "Disable for quick rollback without unloading plugin." },
    mode: { label: "Mode", help: "one-shot, scheduled, streaming, or hybrid." },
    "scan.limit": { label: "Session list limit", help: "Maximum sessions returned by each listing call." },
    "scan.batchSize": { label: "Session get batch size", help: "Message rows per session in each scan." },
    "scan.maxSessions": { label: "Max sessions per run", help: "Safety cap for each scan run." },
    "scan.intervalMs": {
      label: "Interval (ms)",
      help: "Used by scheduled mode and streaming resyncs.",
    },
    "filters.label": { label: "Session label", placeholder: "support|inbox" },
    "filters.spawnedBy": { label: "Spawned by", placeholder: "agent:main:xyz" },
    "filters.agentId": { label: "Agent ID", placeholder: "support-bot" },
    "analysis.keyword.terms": { label: "Keyword list", help: "Comma-separated tokens." },
    "analysis.regex.patterns": { label: "Regex list", help: "Regex patterns for high-risk message detection." },
    "analysis.pii.detectEmail": { label: "PII email", help: "Detect raw email addresses." },
    "analysis.pii.detectPhone": { label: "PII phone", help: "Detect phone-like numbers." },
    "analysis.pii.detectApiKey": { label: "PII API key", help: "Detect API key-like secrets." },
    "output.filePath": { label: "Output file", placeholder: "./message-stream-results.jsonl" },
    "output.webhookUrl": { label: "Webhook URL", placeholder: "https://example.com/webhook" },
  } as Record<string, unknown>,
};
