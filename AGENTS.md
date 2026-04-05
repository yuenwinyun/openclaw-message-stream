# Repository Guidelines

## Project Structure & Module Organization
This plugin is a TypeScript module with a small runtime surface and dedicated OpenClaw integration scripts.

- `index.ts`: package entrypoint exported by OpenClaw hosts.
- `src/`: plugin implementation (`analyzers`, `runtime`, `service`, `checkpoint`, etc.).
- `test/`: end-to-end tests and host runner utilities.
  - Test files use `*.e2e.test.ts` and run via Vitest.
- `scripts/`: support scripts (`smoke-check`, OpenClaw config helpers).
- `skills/openclaw-message-stream/`: shipped skill docs and helper script.
- `README.md`, `DEVELOPER.md`, `openclaw.plugin.json`: primary usage and maintainer docs.

## Build, Test, and Development Commands
- `pnpm install` or `npm install`: install dependencies from `package.json`/`pnpm-lock.yaml`.
- `npm run smoke-check` (`pnpm` equivalent): quick local sanity check.
- `npm run test:e2e` (`pnpm run test:e2e`): run all end-to-end tests.
- `npm run release:check`: alias for `test:e2e` before release.
- `npm run openclaw:config`: generate `openclaw-message-stream.config.json`.
- `npm run openclaw:config:merge|openclaw:config:remove`: merge/remove plugin config for an OpenClaw host.

## Coding Style & Naming Conventions
- TypeScript is strict (`tsconfig.json` uses `"strict": true`, `target`: ES2022).
- Use 2-space indentation and existing style in repo files (camelCase identifiers, explicit types where useful).
- Prefer explicit, descriptive filenames and functions: `*.service.ts`, `*.runtime.ts`, `test/<feature>.e2e.test.ts`.
- Keep runtime/plugin-facing logic in `src/` and test-only helpers under `test/utils/`.

## Testing Guidelines
- Framework: `vitest` with Node environment.
- Configuration is in `vitest.config.ts` and only includes:
  - `test/**/*.e2e.test.ts`
- Run `npm run test:e2e` before code changes; add/adjust tests when behavior changes around parsing, checkpointing, scanning, or output emission.
- Prefer deterministic tests with isolated fixture inputs over host-dependent integration where possible.

## Commit & Pull Request Guidelines
- No commit-message convention file exists in-tree; use concise, imperative messages (e.g. `feat(runtime): add...`) and include a short scope.
- Keep commits focused and include config/test updates with behavioral changes.
- PRs should include:
  - what changed and why,
  - commands run (`test:e2e`, `smoke-check`),
  - sample config/output impact,
  - links to related issues and any manual verification notes.

## Security & Configuration Tips
- Never commit credentials (`OPENCLAW_GATEWAY_TOKEN`, `OPENCLAW_GATEWAY_PASSWORD`, etc.).
- For OpenClaw or gateway runs, pass secrets via environment variables.
- Before release, verify runtime prerequisites (`OpenClaw >= 2026.4.1`) and run release checks.

