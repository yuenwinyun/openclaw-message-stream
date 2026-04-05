# openclaw-message-stream developer guide

This guide is for contributors and maintainers.

## Prerequisites

- OpenClaw `>= 2026.4.1`
- Node.js 18+
- `npm` or `pnpm`
- OpenClaw CLI available, or Dockerized OpenClaw image

## Useful scripts

- `npm run smoke-check`
- `npm run openclaw:config`
- `npm run openclaw:config:merge`
- `npm run openclaw:config:remove`
- `npm run test:e2e`
- `npm run release:check`
- `npm run release:publish`
- `npm run release`

## Smoke check

Run:

```bash
npm run smoke-check
```

## E2E checks

Run runtime e2e:

```bash
npm run test:e2e
```

Host-level OpenClaw smoke checks:

```bash
OPENCLAW_CLI_PATH=/absolute/path/to/openclaw.mjs npm run test:e2e
```

Containerized OpenClaw checks:

```bash
OPENCLAW_DOCKER_IMAGE=ghcr.io/openclaw/openclaw:latest npm run test:e2e
```

Real gateway-backed OpenClaw integration path:

```bash
OPENCLAW_GATEWAY_URL=http://127.0.0.1:PORT
OPENCLAW_MSGSTREAM_SESSION_KEYS=session-a,session-b
OPENCLAW_GATEWAY_TOKEN=...
OPENCLAW_GATEWAY_PASSWORD=...
OPENCLAW_GATEWAY_SCOPES=...
OPENCLAW_GATEWAY_CONNECT_TIMEOUT_MS=15000
npm run test:e2e
```

If `OPENCLAW_GATEWAY_URL` is not set, integration e2e is skipped automatically.

## Skill helper usage

From package root:

```bash
npm run openclaw:config
```

Or:

```bash
node skills/openclaw-message-stream/scripts/generate-openclaw-config.mjs --mode scheduled --output openclaw-message-stream.config.json
```

## Release workflow

Release flow:

```bash
npm run release:check
npm version patch
npm run release:publish
```

`npm run release` runs:

- `release:check`
- `npm version patch`
- `release:publish`

2FA publish:

```bash
NPM_OTP=123456 npm run release
```

Or direct publish:

```bash
npm publish --access public --otp 123456 --no-git-checks
```

## Package publication note

`npm publish` does not rebuild automatically unless you add build scripts.
Current scripts are validated through e2e before release.

## GitHub release workflow

This repo includes:

- `.github/workflows/release.yml`

It supports:

- automatic publish when a `v*` tag is pushed (for example `v0.1.5`)
- manual workflow dispatch from GitHub Actions page

To run a tag-based release:

1. update/package version locally (or manually edit `package.json`)
2. create and push a matching tag:

```bash
git tag -a v0.1.5 -m "release 0.1.5"
git push origin v0.1.5
```

The workflow will validate that the tag matches `package.json` version and then run `npm publish`.

For manual release:

- run the workflow from GitHub Actions with `run_release_checks=true` (default).
