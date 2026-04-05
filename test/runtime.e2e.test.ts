import { beforeEach, describe, expect, it, vi } from "vitest";

const emitMessageMatchMock = vi.hoisted(() => vi.fn(async () => undefined));
const createCheckpointStoreMock = vi.hoisted(() => vi.fn());
const gatewayRequestMock = vi.hoisted(() => vi.fn(async () => ({ messages: [] })));
const gatewayClientStartMock = vi.hoisted(() => vi.fn());
const gatewayClientStopMock = vi.hoisted(() => vi.fn(async () => undefined));

let checkpointStoreState: {
  shouldSkip: ReturnType<typeof vi.fn>;
  markSeen: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  getStateForSession: ReturnType<typeof vi.fn>;
};

vi.mock("../src/emitter.js", () => ({
  emitMessageMatch: emitMessageMatchMock,
}));

vi.mock("../src/checkpoint.js", () => ({
  createCheckpointStore: createCheckpointStoreMock,
}));

vi.mock("openclaw/plugin-sdk/gateway-runtime", () => ({
  GatewayClient: vi.fn(function () {
    return {
    request: gatewayRequestMock,
    start: gatewayClientStartMock,
    stopAndWait: gatewayClientStopMock,
    };
  }),
}));

const { createMessageStreamRuntime } = await import("../src/service.js");

describe("message stream runtime e2e", () => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  beforeEach(() => {
    checkpointStoreState = {
      shouldSkip: vi.fn(async () => false),
      markSeen: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      getStateForSession: vi.fn(),
    };
    createCheckpointStoreMock.mockReset();
    createCheckpointStoreMock.mockResolvedValue(checkpointStoreState);
    gatewayRequestMock.mockReset();
    gatewayClientStartMock.mockClear();
    gatewayClientStopMock.mockClear();
    emitMessageMatchMock.mockClear();
    vi.mocked(gatewayRequestMock).mockReset();
    vi.mocked(gatewayClientStartMock).mockReset();
    vi.mocked(gatewayClientStopMock).mockReset();
    vi.clearAllMocks();
  });

  it("supports dry-run scans without emitting output", async () => {
    const runtime = createMessageStreamRuntime({
      api: {
        logger,
      },
      stateDir: "/tmp/openclaw-message-stream",
      runtimeConfig: {
        plugins: {
          entries: {
            "openclaw-message-stream": {
              config: {
                output: { dryRun: false },
              },
            },
          },
        },
      },
    });

    await (runtime as unknown as { getGatewayClient: () => Promise<unknown> }).getGatewayClient();

    gatewayRequestMock.mockResolvedValue({
      messages: [
        {
          messageId: "m1",
          timestamp: 1,
          sender: "agent",
          role: "assistant",
          content: "password was exposed in the session",
        },
      ],
    });

    const report = await runtime.runOnce({
      mode: "one-shot",
      sessionKeys: ["session-a"],
      dryRun: true,
    });

    expect(report.mode).toBe("one-shot");
    expect(report.sessionsTotal).toBe(1);
    expect(report.sessionsProcessed).toBe(1);
    expect(gatewayClientStartMock).toHaveBeenCalledTimes(1);
    expect(gatewayRequestMock).toHaveBeenCalledTimes(1);
    expect(gatewayRequestMock).toHaveBeenCalledWith(
      "sessions.get",
      {
        key: "session-a",
        limit: 200,
      },
      expect.objectContaining({
        timeoutMs: 12000,
      }),
    );
    expect(report.messagesScanned).toBe(1);
    expect(report.messagesAnalyzed).toBe(1);
    expect(report.matchesFound).toBe(1);
    expect(report.emitted).toBe(0);
    expect(report.errors).toBe(0);
    expect(gatewayRequestMock).toHaveBeenCalledWith(
      "sessions.get",
      {
        key: "session-a",
        limit: 200,
      },
      expect.objectContaining({
        timeoutMs: 12000,
      }),
    );
    expect(checkpointStoreState.markSeen).toHaveBeenCalledTimes(1);
    expect(emitMessageMatchMock).not.toHaveBeenCalled();
    await runtime.stop();
  });

  it("skips emission when checkpoint indicates already seen messages", async () => {
    let skipNext = false;
    const runtime = createMessageStreamRuntime({
      api: {
        logger,
      },
      stateDir: "/tmp/openclaw-message-stream",
      runtimeConfig: {
        plugins: {
          entries: {
            "openclaw-message-stream": {
              config: {
                output: { dryRun: false },
              },
            },
          },
        },
      },
    });

    checkpointStoreState.shouldSkip = vi.fn(async () => {
      const result = skipNext;
      skipNext = true;
      return result;
    });

    gatewayRequestMock.mockResolvedValue({
      messages: [
        {
          messageId: "m2",
          timestamp: 1,
          sender: "agent",
          role: "assistant",
          content: "api key leaked: sk-123456789012345678901234",
        },
      ],
    });

    const first = await runtime.runOnce({
      mode: "one-shot",
      sessionKeys: ["session-a"],
    });

    const second = await runtime.runOnce({
      mode: "one-shot",
      sessionKeys: ["session-a"],
    });

    expect(first.messagesAnalyzed).toBe(1);
    expect(second.messagesAnalyzed).toBe(0);
    expect(first.matchesFound).toBe(1);
    expect(second.matchesFound).toBe(0);
    expect(emitMessageMatchMock).toHaveBeenCalledTimes(1);
    await runtime.stop();
  });

  it("respects api plugin config mode override over runtime config", async () => {
    const runtime = createMessageStreamRuntime({
      api: {
        logger,
        pluginConfig: {
          mode: "streaming",
        },
      },
      stateDir: "/tmp/openclaw-message-stream",
      runtimeConfig: {
        plugins: {
          entries: {
            "openclaw-message-stream": {
              config: {
                mode: "scheduled",
              },
            },
          },
        },
      },
    });

    gatewayRequestMock.mockResolvedValue({ messages: [] });

    const report = await runtime.runOnce({
      sessionKeys: ["session-a"],
      dryRun: true,
    });

    expect(report.mode).toBe("streaming");
    await runtime.stop();
  });
});
