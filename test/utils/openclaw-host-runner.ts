import { accessSync, constants } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

type RunCommandResult = {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
};

export type OpenClawCommandResult = {
  stdout: string;
  stderr: string;
  output: string;
};

export type OpenClawHostRunner = {
  canRun: boolean;
  cliAvailable: boolean;
  dockerAvailable: boolean;
  useContainer: boolean;
  runOpenClaw: (args: string[], options?: { timeoutMs?: number; input?: string }) => Promise<OpenClawCommandResult>;
};

type OpenClawHostRunnerOptions = {
  pluginRoot: string;
  stateDir: string;
  configPath: string;
  openclawCliPath?: string;
  openclawDockerImage?: string;
};

const DEFAULT_OPENCLAW_CLI_PATH = "node_modules/openclaw/openclaw.mjs";
const DEFAULT_OPENCLAW_DOCKER_IMAGE = "ghcr.io/openclaw/openclaw:latest";

function buildOpenClawRunnerEnv(stateDir: string, configPath: string, inputEnv: NodeJS.ProcessEnv = {}) {
  return {
    ...process.env,
    ...inputEnv,
    VITEST: undefined,
    OPENCLAW_STATE_DIR: stateDir,
    OPENCLAW_CONFIG_PATH: configPath,
  };
}

async function runCommand(
  command: string[],
  options: { timeoutMs?: number; input?: string; env: NodeJS.ProcessEnv },
): Promise<RunCommandResult> {
  const { timeoutMs = 90_000, input, env } = options;

  return await new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const stdoutBuffers: Buffer[] = [];
    const stderrBuffers: Buffer[] = [];

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdoutBuffers.push(Buffer.from(chunk as Buffer));
    });
    child.stderr?.on("data", (chunk) => {
      stderrBuffers.push(Buffer.from(chunk as Buffer));
    });

    if (input) {
      child.stdin?.write(input);
      child.stdin?.end();
    }

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        status: code,
        signal,
        stdout: Buffer.concat(stdoutBuffers).toString("utf8"),
        stderr: Buffer.concat(stderrBuffers).toString("utf8"),
      });
    });
  });
}

export function createOpenClawHostRunner(options: OpenClawHostRunnerOptions): OpenClawHostRunner {
  const {
    pluginRoot,
    stateDir,
    configPath,
    openclawCliPath = DEFAULT_OPENCLAW_CLI_PATH,
    openclawDockerImage = DEFAULT_OPENCLAW_DOCKER_IMAGE,
  } = options;
  const resolvedOpenclawCliPath = path.resolve(process.cwd(), openclawCliPath);

  const cliAvailable = (() => {
    try {
      accessSync(resolvedOpenclawCliPath, constants.R_OK);
      return true;
    } catch {
      return false;
    }
  })();
  const dockerAvailable = (() => {
    const dockerVersion = spawnSync("docker", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return dockerVersion.status === 0;
  })();
  const useContainer = !cliAvailable && dockerAvailable;

  const dockerBaseArgs = [
    "run",
    "--rm",
    "-e",
    "OPENCLAW_STATE_DIR=/tmp/openclaw-host-e2e-state",
    "-e",
    "OPENCLAW_CONFIG_PATH=/tmp/openclaw-host-e2e.json",
    "-w",
    "/tmp/openclaw-message-stream",
    "-v",
    `${pluginRoot}:/tmp/openclaw-message-stream:ro`,
    "-v",
    `${configPath}:/tmp/openclaw-host-e2e.json:ro`,
    "-v",
    `${stateDir}:/tmp/openclaw-host-e2e-state`,
  ];

  async function runOpenClaw(args: string[], options: { timeoutMs?: number; input?: string } = {}): Promise<OpenClawCommandResult> {
    const { timeoutMs = 90_000, input } = options;
    const env = buildOpenClawRunnerEnv(stateDir, configPath);
    const commandTemplates: Array<string[]> = useContainer
      ? [
          ["docker", ...dockerBaseArgs, openclawDockerImage, "openclaw", ...args],
          ["docker", ...dockerBaseArgs, "--entrypoint", "node", openclawDockerImage, "dist/index.js", ...args],
        ]
      : [[process.execPath, resolvedOpenclawCliPath, ...args]];

    let status: number | null = null;
    let signal: NodeJS.Signals | null = null;
    let stdout = "";
    let stderr = "";

    if (useContainer) {
      let lastStatus: number | null = null;
      let lastSignal: NodeJS.Signals | null = null;
      let lastStdout = "";
      let lastStderr = "";

      for (const template of commandTemplates) {
        const attempt = await runCommand(template, { timeoutMs, input, env });
        const attemptOutput = `${attempt.stdout}\n${attempt.stderr}`;

        lastStatus = attempt.status;
        lastSignal = attempt.signal;
        lastStdout = attempt.stdout;
        lastStderr = attempt.stderr;

        if (attempt.status === 0) {
          break;
        }
        if (attempt.status === null && attempt.signal === "SIGKILL") {
          break;
        }
        if (/openclaw: not found|node: cannot find/.test(attemptOutput)) {
          continue;
        }
        break;
      }

      status = lastStatus;
      signal = lastSignal;
      stdout = lastStdout;
      stderr = lastStderr;
    } else {
      const attempt = await runCommand([process.execPath, resolvedOpenclawCliPath, ...args], { timeoutMs, input, env });
      status = attempt.status;
      signal = attempt.signal;
      stdout = attempt.stdout;
      stderr = attempt.stderr;
    }

    const output = `${stdout}\n${stderr}`.trim();
    if (status !== 0) {
      const detail = status !== null ? `${status}` : `signal ${signal ?? "unknown"}`;
      throw new Error(
        `openclaw command failed (${detail}): ${[
          `openclaw ${args.join(" ")}`,
          output && `\n${output}`,
        ]
          .filter(Boolean)
          .join("\n")}`,
      );
    }

    return { stdout, stderr, output };
  }

  return {
    canRun: cliAvailable || dockerAvailable,
    cliAvailable,
    dockerAvailable,
    useContainer,
    runOpenClaw,
  };
}
