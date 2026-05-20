# Changelog

> **English** · [简体中文](CHANGELOG.zh-CN.md)

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- Anthropic / Ollama tool-calling protocol adapters
- Tool-calling during challenge phase (challengers cite evidence)
- Independent judge model (avoid self-grading bias)
- Convergence detection in multi-round loop
- Bayesian aggregation in voting (log-pooling)

---

## [0.1.0] — 2026-05-02

First feature-complete release. Multi-LLM adversarial protocol with truth-grounding.

### Added

#### Tier 3 — Truth Grounding
- **Tool runtime** (`src/lib/tools/`): typed registry + dispatcher for in-generation tool calls.
  - `search` — SearXNG search backend.
  - `fetch_url` — URL fetch with HTML→text extraction (capped).
  - `exec_python` — sandboxed Python execution (`docker --network none`, stdlib only).
  - `concede` — engine-intercepted withdrawal mechanism; models can admit error and exit a run with optional `defer_to`.
- **OpenAI tool-calling adapter** (`src/lib/clients/openai-tool-loop.ts`): streaming + dispatch loop until `finish_reason=stop` or `maxIterations`.
- **Capability probe + cache** (`src/engine/capability-probe.ts`, `capability-cache.ts`): per-model tool-calling support detection, cached at `~/.aap/capabilities.json` with TTL.
- **Concession-aware voting**: withdrawn models excluded from candidates; concession reasons surfaced in voting prompt as honor signals.
- **Current-date system message**: injected into every prompt so models don't fall back to training cutoff.
- CLI: `aap probe [ids...] [--all]`, `aap tools list`.
- TUI: `ToolCallView` panel (per-model tool-call grouping, ✓/✗ + color-coded names, concession block).
- Deploy: `scripts/start-searxng.sh` (WSL2 Docker SearXNG on `:28080`).

#### Tier 1+2 — Discovery, Preflight, Multi-Round
- **Model auto-discovery**:
  - `aap config discover --base-url --protocol [--api-key]` — non-interactive list of upstream models.
  - `aap config add` (no flags) — interactive walk: URL → protocol → key → multi-select → save; loops to chain endpoints.
- **Preflight health check** before run starts (`src/engine/preflight.ts`): dedupes endpoints, pings list-models, returns `{ok, failed}`. TUI integrates `PreflightWarning` modal with drop / abort / continue choices.
- **Multi-round adversarial loop**: `AdversarialConfig.maxRounds` (default 2). Round n>1 prompt appends prior round's responses + cross-model challenges. Voting on final round only.
- **EngineHub**: `addModelsAndSave` + `reloadConfig` + `config-change` event so TUI sees newly added models without restart.
- **TUI improvements**:
  - `DiscoverModal` scrolling viewport with PgUp/PgDn for >20 models.
  - Multi-endpoint chain: success page lets user add another endpoint without leaving the modal.
  - `useHub` chunk-event batching at 50ms (kills flicker on streaming).
  - `ModelPanel` keeps tail-N lines under terminal-rows budget instead of unbounded growth.

#### Foundation (preserved from `0.0.1`)
- Three-phase adversarial engine: generating → auto-challenge → voting.
- Multi-protocol clients: OpenAI / Anthropic / Ollama.
- HTTP server compatible with OpenAI `/v1/chat/completions` and Anthropic `/v1/messages` (sync + streaming).
- TUI based on ink showing live multi-panel run progress.
- Audit metrics persisted to `~/.aap/audit-metrics.json`.

### Fixed
- CI: `npm run test -- --run` expanded to `vitest --run --run`, rejected by vitest 2.1+. Now uses `npm test` directly.

### Tested
- 69 unit + integration tests across 10 files (vitest).
- End-to-end smoke tests against a real OpenAI-compatible multi-model proxy (8 models, 4 with verified tool-calling support).

---

## [0.0.1] — 2026-04 (initial CLI/TUI rewrite)

Migrated from a Next.js Web UI to Node.js CLI + TUI + HTTP server (PR #11).
See `docs/history/phase-2/` for the migration narrative.
