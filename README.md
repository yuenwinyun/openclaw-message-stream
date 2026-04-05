# openclaw-message-stream

Plugin that scans OpenClaw session transcripts and emits structured findings for keyword, regex, PII, and sentiment signals.

The output is designed for AI agents, assistants, and runtime orchestrators that need clear message-level alerts.

## Quick onboarding

### Install

- Install from npm:

```bash
npm install --save-dev @yuenwinyun/openclaw-message-stream
```

- Or with pnpm:

```bash
pnpm add --save-dev @yuenwinyun/openclaw-message-stream
```

### Add plugin to an OpenClaw host

Run in the OpenClaw host project:

```bash
npm install --save-dev @yuenwinyun/openclaw-message-stream
```

Then merge plugin settings into OpenClaw config:

```bash
node node_modules/@yuenwinyun/openclaw-message-stream/scripts/openclaw-config.mjs \
  --config /path/to/openclaw.config.json \
  --plugin-root /path/to/openclaw-host/node_modules/@yuenwinyun/openclaw-message-stream \
  --mode hybrid \
  --write
```

Reload OpenClaw and verify:

```bash
openclaw plugins list --json
openclaw plugins inspect openclaw-message-stream --json
openclaw plugins doctor
```

### One-line starter config (optional)

From this package folder:

```bash
npm run openclaw:config
```

## Runtime commands for agents

Use `/msgstream` in authorized sessions:

```text
/msgstream
/msgstream one-shot
/msgstream one-shot --dry-run
/msgstream --mode scheduled --sessions session-a,session-b
```

## Configuration

Set under `plugins.entries.openclaw-message-stream.config`.

- `mode`: `hybrid`, `scheduled`, `streaming`, `one-shot` (default `hybrid`)
- `scan.limit`: max sessions returned from session list
- `scan.batchSize`: max messages fetched per session scan
- `scan.maxSessions`: per-run session safety cap
- `scan.intervalMs`: poll interval for scheduled mode
- `filters`: label/agent/spawnedBy/search filters
- `analysis`: keyword + regex + PII + sentiment config
- `gateway`: OpenClaw gateway connection settings
- `output`: file/webhook/console output controls
- `output.dryRun`: analyze and checkpoint without external output

`gateway.scopes` defaults to include `operator.read` so the plugin can read sessions for scanning.

## Emitted message record

Each emitted record contains:

- plugin
- mode
- session key
- message id and seq
- sender and role
- message content
- score and findings
- match boolean

Common outputs:

- console summary
- JSONL file output (optional)
- webhook POST payload (optional)

## Notes

- `dry-run` mode still runs analysis and updates checkpoint state.
- Checkpoint deduplication is based on message id/sequence and content hash.
- Streaming mode needs valid gateway credentials/scopes.

## Remove plugin safely

- Remove from OpenClaw config (plugin entry + allowed list + load paths).
- Uninstall package:

```bash
npm remove @yuenwinyun/openclaw-message-stream
# or
pnpm remove @yuenwinyun/openclaw-message-stream
```

## AI skill support

This package also ships an OpenClaw/assistant skill at:

- `skills/openclaw-message-stream/SKILL.md`

You can copy it into your assistant skill folder for easier onboarding and common workflows.

## Developer docs

For test, release, and publishing workflows, see:

- [DEVELOPER.md](./DEVELOPER.md)
