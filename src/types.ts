export type MessageStreamMode = "one-shot" | "scheduled" | "streaming" | "hybrid";

export type PluginMode = MessageStreamMode;

export type PluginMessageRole = "user" | "assistant" | "system" | "tool" | "other";

export type MessageStreamGatewayConfig = {
  url?: string;
  token?: string;
  password?: string;
  connectTimeoutMs?: number;
  scopes?: string[];
};

export type MessageStreamFilterConfig = {
  includeGlobal?: boolean;
  includeUnknown?: boolean;
  label?: string;
  spawnedBy?: string;
  agentId?: string;
  search?: string;
};

export type MessageStreamScanConfig = {
  enabled?: boolean;
  mode?: PluginMode;
  limit?: number;
  batchSize?: number;
  maxSessions?: number;
  intervalMs?: number;
};

export type MessageStreamOutputConfig = {
  emitNoMatches?: boolean;
  filePath?: string;
  webhookUrl?: string;
  console?: boolean;
  consoleMaxText?: number;
  payloadMaxBytes?: number;
  webhookTimeoutMs?: number;
  dryRun?: boolean;
};

export type MessageStreamRuleConfig = {
  enabled?: boolean;
  weight?: number;
  terms?: string[];
};

export type MessageStreamPatternConfig = {
  enabled?: boolean;
  weight?: number;
  patterns?: string[];
  caseSensitive?: boolean;
};

export type MessageStreamPiiConfig = {
  enabled?: boolean;
  detectEmail?: boolean;
  detectPhone?: boolean;
  detectApiKey?: boolean;
  weight?: number;
};

export type MessageStreamAnalysisConfig = {
  keyword?: MessageStreamRuleConfig;
  regex?: MessageStreamPatternConfig;
  pii?: MessageStreamPiiConfig;
  sentiment?: {
    enabled?: boolean;
    weight?: number;
  };
};

export type MessageStreamConfig = {
  enabled: boolean;
  pluginName: string;
  mode: PluginMode;
  scan: {
    limit: number;
    batchSize: number;
    maxSessions: number;
    intervalMs: number;
  };
  filters: MessageStreamFilterConfig;
  analysis: MessageStreamAnalysisConfig;
  gateway: MessageStreamGatewayConfig;
  output: Required<MessageStreamOutputConfig>;
  checkpointFile: string;
  sessionKeys?: string[];
};

export type NormalizedSessionMessage = {
  sessionKey: string;
  messageId?: string;
  messageSeq?: number;
  sender?: string;
  role: PluginMessageRole;
  timestamp: number;
  content: string;
  attachmentCount: number;
  raw: unknown;
};

export type MessageStreamFinding = {
  rule: string;
  label: string;
  confidence: number;
  count: number;
  details: Record<string, unknown>;
};

export type MessageStreamMessageAnalysis = {
  score: number;
  findings: MessageStreamFinding[];
  hasFinding: boolean;
};

export type MessageStreamOutputRecord = {
  runId: string;
  ts: number;
  plugin: string;
  mode: PluginMode;
  sessionKey: string;
  messageId?: string;
  messageSeq?: number;
  sender?: string;
  messageRole: PluginMessageRole;
  messageTimestamp: number;
  content: string;
  score: number;
  findings: MessageStreamFinding[];
  matched: boolean;
};

export type MessageStreamRunReport = {
  runId: string;
  mode: PluginMode;
  startedAt: number;
  durationMs: number;
  sessionsTotal: number;
  sessionsProcessed: number;
  messagesScanned: number;
  messagesAnalyzed: number;
  matchesFound: number;
  emitted: number;
  errors: number;
};
