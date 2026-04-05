import fs from "node:fs/promises";
import path from "node:path";
import type { PluginLogger } from "openclaw/plugin-sdk/plugin-entry";

type SessionCheckpoint = {
  lastSeq?: number;
  lastMessageId?: string;
  lastContentHash?: string;
};

type CheckpointState = {
  version: 1;
  updatedAt: number;
  sessions: Record<string, SessionCheckpoint>;
};

function defaultState(): CheckpointState {
  return {
    version: 1,
    updatedAt: Date.now(),
    sessions: {},
  };
}

function resolveStatePath(stateDir: string, filename: string): string {
  return path.resolve(stateDir || process.cwd(), filename);
}

function normalizeHash(value: string | undefined): string | undefined {
  return value ? value.trim().slice(0, 64) : undefined;
}

export type CheckpointStore = {
  close: () => Promise<void>;
  getStateForSession: (sessionKey: string) => SessionCheckpoint | undefined;
  shouldSkip: (sessionKey: string, messageId?: string, messageSeq?: number, contentHash?: string) => Promise<boolean>;
  markSeen: (sessionKey: string, messageId?: string, messageSeq?: number, contentHash?: string) => Promise<void>;
};

export async function createCheckpointStore(
  stateDir: string,
  filename: string,
  logger: PluginLogger,
): Promise<CheckpointStore> {
  const statePath = resolveStatePath(stateDir, filename);
  let state: CheckpointState;
  let persisted = false;
  let dirty = false;
  let flushTimer: NodeJS.Timeout | null = null;

  try {
    const raw = await fs.readFile(statePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.version === 1) {
      state = {
        version: 1,
        updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
        sessions: parsed.sessions && typeof parsed.sessions === "object" ? parsed.sessions : {},
      };
      persisted = true;
    } else {
      state = defaultState();
    }
  } catch {
    state = defaultState();
  }

  const ensureDir = async () => {
    try {
      await fs.mkdir(path.dirname(statePath), { recursive: true });
    } catch {
      // no-op
    }
  };

  const persist = async () => {
    if (!dirty) {
      return;
    }
    await ensureDir();
    try {
      const payload = JSON.stringify(
        {
          ...state,
          updatedAt: Date.now(),
        },
        null,
        2,
      );
      await fs.writeFile(statePath, payload, "utf-8");
      dirty = false;
      persisted = true;
    } catch (err) {
      logger.warn(`message-stream: checkpoint write failed for ${statePath}: ${String(err)}`);
    }
  };

  const scheduleFlush = () => {
    if (flushTimer) {
      return;
    }
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void persist();
    }, 250);
  };

  const getStateForSession = (sessionKey: string): SessionCheckpoint | undefined => {
    return state.sessions[sessionKey];
  };

  return {
    async close() {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (dirty) {
        await persist();
      }
    },
    async shouldSkip(sessionKey, messageId, messageSeq, contentHash) {
      const existing = state.sessions[sessionKey];
      const normalizedContentHash = normalizeHash(contentHash);
      if (!existing) {
        return false;
      }
      if (messageSeq !== undefined && existing.lastSeq !== undefined && messageSeq <= existing.lastSeq) {
        return true;
      }
      if (
        messageSeq === undefined &&
        existing.lastMessageId &&
        messageId &&
        existing.lastMessageId === messageId
      ) {
        return true;
      }
      if (
        messageSeq === undefined &&
        messageSeq === existing.lastSeq &&
        normalizedContentHash &&
        existing.lastContentHash === normalizedContentHash
      ) {
        return true;
      }
      return false;
    },
    async markSeen(sessionKey, messageId, messageSeq, contentHash) {
      const next = state.sessions[sessionKey] ?? {};
      const normalizedContentHash = normalizeHash(contentHash);
      if (
        typeof messageSeq === "number" &&
        (next.lastSeq === undefined || messageSeq > next.lastSeq)
      ) {
        next.lastSeq = messageSeq;
      }
      if (messageId) {
        next.lastMessageId = messageId;
      }
      if (normalizedContentHash) {
        next.lastContentHash = normalizedContentHash;
      }
      next.lastSeq = next.lastSeq ?? messageSeq;
      state.sessions[sessionKey] = next;
      dirty = true;
      scheduleFlush();
    },
  };
}
