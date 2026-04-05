#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const files = {
  index: path.join(PROJECT_ROOT, "index.ts"),
  cli: path.join(PROJECT_ROOT, "src", "cli.ts"),
  service: path.join(PROJECT_ROOT, "src", "service.ts"),
  runtime: path.join(PROJECT_ROOT, "src", "runtime.ts"),
  config: path.join(PROJECT_ROOT, "src", "config.ts"),
};

const checks = [
  {
    id: "entry-config-schema",
    path: files.index,
    patterns: [
      "definePluginEntry",
      "messageStreamConfigSchema",
      "api.registerService",
      "registerMessageStreamCommand",
    ],
  },
  {
    id: "cli-registry",
    path: files.cli,
    patterns: [
      "registerMessageStreamCommand",
      "msgstream",
      "/msgstream",
      "runOnce(",
    ],
  },
  {
    id: "service-factory",
    path: files.service,
    patterns: [
      "createMessageStreamRuntime",
      "createMessageStreamService",
      "OpenClawPluginService",
      "runtime.start",
      "runtime.stop",
    ],
  },
  {
    id: "runtime-core",
    path: files.runtime,
    patterns: [
      "class MessageStreamRuntime",
      "handleGatewayEvent",
      "runOnce(",
      "scanAndReport(",
    ],
  },
  {
    id: "config-schema",
    path: files.config,
    patterns: [
      "parseMessageStreamConfig",
      "messageStreamConfigSchema",
      "gateway:",
      "analysis:",
      "output:",
    ],
  },
];

async function read(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (err) {
    throw new Error(`missing-file:${filePath} (${err.message})`);
  }
}

function assertAllMatches(fileName, content, patterns) {
  for (const pattern of patterns) {
    if (!content.includes(pattern)) {
      throw new Error(`${fileName}: expected pattern missing -> ${pattern}`);
    }
  }
}

async function run() {
  for (const check of checks) {
    const content = await read(check.path);
    assertAllMatches(check.id, content, check.patterns);
  }
  console.log("smoke-check: plugin wiring looks valid");
}

run().catch((err) => {
  console.error(`smoke-check: failed: ${err.message}`);
  process.exitCode = 1;
});
