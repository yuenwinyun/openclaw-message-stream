---
name: openclaw-message-stream
description: Set up and use @yuenwinyun/openclaw-message-stream in OpenClaw projects with minimal commands and config.
metadata:
  short-description: Integrate OpenClaw message stream analyzer plugin
---

# OpenClaw Message Stream Skill

Use this skill when you need to install, configure, or verify this plugin in an OpenClaw environment.

## Install

1. Add the package:
   - `npm i -D @yuenwinyun/openclaw-message-stream`
   - or `pnpm add -D @yuenwinyun/openclaw-message-stream`

2. Generate a starter OpenClaw config file:
   - `node skills/openclaw-message-stream/scripts/generate-openclaw-config.mjs --output openclaw-message-stream.config.json`

3. Copy the generated config section into your OpenClaw configuration format and keep `plugins.enabled`, `plugins.allow`, and `plugins.load.paths` set so OpenClaw can load the plugin.

## Configuration defaults

The generated config uses:
- `plugins.allow: ["openclaw-message-stream"]`
- `plugins.load.paths: [plugin root path]`
- default plugin config:
  - `enabled: true`
  - `mode: "hybrid"`
  - `output.console: true`
  - `analysis.keyword.weight: 1`

## Quick validation

From the OpenClaw host environment:
- `openclaw plugins list --json` should include `openclaw-message-stream` with status `loaded`.
- `openclaw plugins inspect openclaw-message-stream --json` should include command `msgstream` and service `openclaw-message-stream`.

If `openclaw` is unavailable locally, set `OPENCLAW_DOCKER_IMAGE=ghcr.io/openclaw/openclaw:latest` and run via your normal test path.

## Runtime invocation

- Chat command: `/msgstream [mode] [options]`
- Plugin command options:
  - `--mode one-shot|scheduled|streaming|hybrid`
  - `--dry-run`
  - `--session`, `--sessions`, `--session-keys`

Example:

```bash
/msgstream --mode one-shot --dry-run
```

## Cronjob usage

For scheduled runs, set plugin config mode to `scheduled` and let your job/environment trigger the plugin command cadence you need.

Use this flow:
- run `generate-openclaw-config.mjs` with `--mode scheduled`
- ensure OpenClaw service/reloader reads the updated config
- monitor plugin logs for `/msgstream` reports
