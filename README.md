# openclaw-message-stream

Plugin that scans OpenClaw session transcripts and emits analysis findings for keyword/regex/PII/sentiment signals.

## Installation

The plugin is a local package and is expected to be configured in OpenClaw’s plugin list. The package metadata is already set to:

- package: `@yuenwinyun/openclaw-message-stream`
- entry: `index.ts`
- id: `openclaw-message-stream`

## Modes

`mode` controls runtime behavior:

- `hybrid` (default): one-time scan (with checkpoint state), then subscribe to selected sessions for live stream events.
- `scheduled`: periodically scan sessions on interval.
- `streaming`: subscribe only, process real-time events.
- `one-shot`: one-time scan (without periodic resync).

## Plugin Command

Use `/msgstream` inside an authorized channel to run an immediate analysis pass.

Examples:

```text
/msgstream
/msgstream one-shot
/msgstream one-shot --dry-run
/msgstream --mode scheduled --sessions session-a,session-b
/msgstream --help
```

### Command options

- `--mode <one-shot|scheduled|streaming|hybrid>`: Override mode for this invocation.
- `--sessions` / `--session` / `--session-keys`: Optional comma-separated session filters.
- `--dry-run` / `--no-dry-run`: Override output emission behavior.
- `help`: Show usage text.

## Configuration

Set plugin config under `plugins.entries.openclaw-message-stream.config`.

### Core

- `enabled` (boolean, default: `true`)
- `pluginName` (string, default: `"openclaw-message-stream"`)
- `mode` (string, default: `"hybrid"`)

### Scan

- `scan.limit` (number): max sessions from `sessions.list`
- `scan.batchSize` (number): max messages fetched per `sessions.get`
- `scan.maxSessions` (number): safety cap per scan run
- `scan.intervalMs` (number): scheduled interval

### Filters

- `filters.includeGlobal` (boolean)
- `filters.includeUnknown` (boolean)
- `filters.label` (string)
- `filters.spawnedBy` (string)
- `filters.agentId` (string)
- `filters.search` (string)

### Analysis

- `analysis.keyword.terms` (comma-separated / array)
- `analysis.keyword.weight`
- `analysis.regex.patterns`
- `analysis.regex.enabled`
- `analysis.pii.detectEmail`
- `analysis.pii.detectPhone`
- `analysis.pii.detectApiKey`
- `analysis.sentiment.enabled`

### Gateway

- `gateway.url`
- `gateway.token`
- `gateway.password`
- `gateway.connectTimeoutMs`
- `gateway.scopes`

### Output

- `output.filePath` (JSONL path)
- `output.webhookUrl`
- `output.console` (boolean)
- `output.consoleMaxText`
- `output.payloadMaxBytes`
- `output.webhookTimeoutMs`
- `output.emitNoMatches`
- `output.dryRun`
- `checkpointFile`
- `sessionKeys` (optional bootstrap list)

## Runtime Outputs

Each emitted record includes:

- plugin id
- mode
- session key
- message id/seq
- sender + role
- content
- score and findings
- match boolean

Output sinks:

- append to configured `filePath` as JSONL
- POST each record to `webhookUrl`
- concise console summary (`console` enabled by default)

## Notes

- Dry-run mode still performs analysis and checkpoint updates but skips file/webhook output.
- Checkpoint state is persisted under the plugin state directory and uses message sequence/id/hash for dedupe.
- Streaming mode requires valid gateway credentials/scopes in config.

## Smoke check

From the plugin folder:

```bash
node scripts/smoke-check.cjs
```

or

```bash
npm run smoke-check
```

## E2E tests

From the plugin folder:

```bash
npm run test:e2e
```

Host-level OpenClaw smoke checks in this repo can run either with a local `openclaw` CLI install or directly through Docker.

```bash
# Use local CLI (defaults to ./node_modules/openclaw/openclaw.mjs)
OPENCLAW_CLI_PATH=/absolute/path/to/openclaw.mjs npm run test:e2e

# Or containerized OpenClaw CLI (uses ghcr.io/openclaw/openclaw:latest by default)
OPENCLAW_DOCKER_IMAGE=ghcr.io/openclaw/openclaw:latest npm run test:e2e
```

## OpenClaw integration E2E tests (optional)

Set the following environment variables and run the same command to run a real gateway-backed e2e path:

```bash
OPENCLAW_GATEWAY_URL=http://127.0.0.1:PORT
OPENCLAW_MSGSTREAM_SESSION_KEYS=session-a,session-b
OPENCLAW_GATEWAY_TOKEN=... # optional if your gateway requires it
OPENCLAW_GATEWAY_PASSWORD=... # optional
OPENCLAW_GATEWAY_SCOPES=... # optional, comma-separated
OPENCLAW_GATEWAY_CONNECT_TIMEOUT_MS=15000 # optional

npm run test:e2e
```

If `OPENCLAW_GATEWAY_URL` is not set, the OpenClaw integration test is skipped automatically.
