import { afterEach, describe, expect, it, vi } from "vitest";

const createMessageStreamRuntimeMock = vi.hoisted(() => vi.fn());

vi.mock("../src/service.js", () => ({
  createMessageStreamRuntime: createMessageStreamRuntimeMock,
}));

const runtimeStop = vi.hoisted(() => vi.fn(async () => undefined));

afterEach(() => {
  createMessageStreamRuntimeMock.mockReset();
  runtimeStop.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const { registerMessageStreamCommand } = await import("../src/cli.js");

  describe("message stream /msgstream command e2e", () => {
  function createRuntimeMock() {
    const runOnce = vi.fn(async ({ mode = "one-shot" }: { mode?: string } = {}) => ({
      runId: "run-001",
      mode,
      startedAt: 1,
      durationMs: 0,
      sessionsTotal: 1,
      sessionsProcessed: 1,
      messagesScanned: 1,
      messagesAnalyzed: 1,
      matchesFound: 1,
      emitted: 1,
      errors: 0,
    }));
    return { runOnce, stop: runtimeStop };
  }

  function registerCommand(api: Record<string, unknown>) {
    let command: Record<string, unknown> | undefined;
    createMessageStreamRuntimeMock.mockReturnValue(createRuntimeMock());
    registerMessageStreamCommand({
      ...api,
      registerCommand: (definition: Record<string, unknown>) => {
        command = definition;
      },
    } as never);

    if (!command) {
      throw new Error("/msgstream command was not registered");
    }

    return {
      command: command as unknown as {
        handler: (ctx: { args?: string | undefined }) => Promise<{ text: string }>;
      },
    };
  }

  function createApi(runtimeConfig: Record<string, unknown> = {}) {
    return {
      runtime: {
        config: {
          loadConfig: vi.fn(() => runtimeConfig),
        },
        state: {
          resolveStateDir: vi.fn(() => "/tmp/openclaw-state"),
        },
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
    };
  }

  it("renders usage for --help", async () => {
    const api = createApi();
    const { command } = registerCommand(api);

    const result = await command.handler({ args: "--help" });

    expect(result.text).toContain("Usage: /msgstream");
  });

  it("returns invalid-mode errors before runtime instantiation", async () => {
    const api = createApi();
    const { command } = registerCommand(api);

    const result = await command.handler({ args: "--mode turbo" });

    expect(result.text).toContain('Invalid mode "turbo"');
    expect(createMessageStreamRuntimeMock).not.toHaveBeenCalled();
  });

  it("invokes runtime with parsed mode and session filters", async () => {
    const { command } = registerCommand(
      createApi({
        plugins: {
          entries: {
            "openclaw-message-stream": {
              config: {
                scan: {
                  batchSize: 99,
                },
              },
            },
          },
        },
      }),
    );

    const result = await command.handler({
      args: "scheduled --sessions session-a,session-b --dry-run",
    });

    expect(createMessageStreamRuntimeMock).toHaveBeenCalledTimes(1);
    const runtimeCall = createMessageStreamRuntimeMock.mock.calls[0]?.[0] as {
      runtimeConfig: unknown;
      modeOverride?: string;
      stateDir: string;
    };
    expect(runtimeCall).toBeDefined();
    expect(runtimeCall.stateDir).toBe("/tmp/openclaw-state");
    expect(runtimeCall.modeOverride).toBe("scheduled");
    expect(result.text).toContain("Mode: scheduled");
    expect(result.text).toContain("Dry run: true");
    expect(result.text).toContain("Session filter: session-a, session-b");
  });
});
