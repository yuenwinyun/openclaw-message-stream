import type { NormalizedSessionMessage, PluginMessageRole } from "./types.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeRole(value: unknown): PluginMessageRole {
  if (!isObject(value)) {
    return "other";
  }
  const role = typeof value.role === "string" ? value.role.toLowerCase() : "other";
  if (role === "user" || role === "assistant" || role === "system" || role === "tool") {
    return role;
  }
  return "other";
}

function parseTimestamp(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 0 ? value : Date.now();
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : Date.now();
  }
  return Date.now();
}

function textFromStructuredContent(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }

  const chunks: string[] = [];
  for (const part of content) {
    if (!isObject(part)) {
      continue;
    }
    if (typeof part.type !== "string") {
      continue;
    }
    if (
      part.type === "text" ||
      part.type === "output_text" ||
      part.type === "input_text"
    ) {
      if (typeof part.text === "string") {
        chunks.push(part.text.trim());
      }
      continue;
    }
    if (typeof part.text === "string" && typeof part.type === "string") {
      chunks.push(`${part.type}: ${part.text}`.trim());
    }
  }
  return chunks.filter(Boolean).join(" ");
}

function fallbackText(raw: unknown): string {
  if (!isObject(raw)) {
    return "";
  }
  try {
    return JSON.stringify(raw).slice(0, 6000);
  } catch {
    return "";
  }
}

export function normalizeSessionMessage(
  sessionKey: string,
  payload: unknown,
): NormalizedSessionMessage | null {
  if (!sessionKey.trim()) {
    return null;
  }
  const normalizedSessionKey = sessionKey.trim();

  const raw = isObject(payload) ? payload : {};
  const message = isObject(raw.message) ? raw.message : raw;

  const __openclaw = isObject(message.__openclaw)
    ? (message.__openclaw as Record<string, unknown>)
    : isObject(raw.__openclaw)
      ? (raw.__openclaw as Record<string, unknown>)
      : {};
  const sender = isObject(message.sender) ? String(message.sender).trim() : undefined;
  const role = normalizeRole(message);
  const messageSeq =
    typeof raw.messageSeq === "number" && Number.isFinite(raw.messageSeq)
      ? Math.max(0, Math.floor(raw.messageSeq))
      : typeof __openclaw.seq === "number" && Number.isFinite(__openclaw.seq)
        ? Math.max(0, Math.floor(__openclaw.seq))
        : undefined;
  const messageId =
    typeof raw.messageId === "string" && raw.messageId.trim()
      ? raw.messageId.trim()
      : typeof __openclaw.id === "string" && __openclaw.id.trim()
        ? __openclaw.id.trim()
        : undefined;
  const timestamp =
    typeof message.timestamp === "number" && Number.isFinite(message.timestamp)
      ? message.timestamp
      : parseTimestamp(raw.timestamp);
  const attachments = Array.isArray(message.attachments) ? message.attachments.length : 0;
  const rawContent = textFromStructuredContent(message.content) || fallbackText(message);

  return {
    sessionKey: normalizedSessionKey,
    messageId,
    messageSeq,
    sender: sender,
    role,
    timestamp,
    content: rawContent.trim(),
    attachmentCount: attachments,
    raw: raw,
  };
}
