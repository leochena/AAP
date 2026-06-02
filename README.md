<div align="center">

<img src="assets/aap-hero.svg" alt="AI Adversarial Protocol" width="100%">

# 🥊 AI Adversarial Protocol

**Multiple LLMs answer the same question, audit each other, ground claims in tools, and only keep what survives scrutiny.**

[![CI](https://github.com/laochendeai/ai-adversarial-protocol/actions/workflows/ci.yml/badge.svg)](https://github.com/laochendeai/ai-adversarial-protocol/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/ai-adversarial-protocol.svg)](https://www.npmjs.com/package/ai-adversarial-protocol)
[![npm downloads](https://img.shields.io/npm/dm/ai-adversarial-protocol.svg)](https://www.npmjs.com/package/ai-adversarial-protocol)
[![GitHub release](https://img.shields.io/github/v/release/laochendeai/ai-adversarial-protocol.svg)](https://github.com/laochendeai/ai-adversarial-protocol/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-43853d.svg)](https://nodejs.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![GitHub stars](https://img.shields.io/github/stars/laochendeai/ai-adversarial-protocol?style=social)](https://github.com/laochendeai/ai-adversarial-protocol/stargazers)

**English** · [简体中文](README.zh-CN.md)

[`npm install -g ai-adversarial-protocol`](https://www.npmjs.com/package/ai-adversarial-protocol) · [Quick Start](#-quick-start) · [FAQ](docs/FAQ.md) · [Roadmap](docs/ROADMAP.md) · [Support](SUPPORT.md) · [Contributing](CONTRIBUTING.md)

</div>

---

## What is this

**AAP** (AI Adversarial Protocol) is a Node.js CLI + HTTP server that wires any number of LLMs from any vendor into an **adversarial collaboration pipeline**:

```
                  ┌──── Phase 1: Generating ────┐
                  │  N models answer in parallel │
                  └──────────────┬───────────────┘
                                 ▼
                  ┌──── Phase 2: Tool Grounding (optional) ──┐
                  │  search / fetch_url / exec_python         │
                  │  models proven wrong → concede() and exit │
                  └──────────────┬────────────────────────────┘
                                 ▼
                  ┌──── Phase 3: Structured Blackboard ───────┐
                  │  claims / evidence / consensus risk       │
                  │  identity drift / minority protection     │
                  └──────────────┬────────────────────────────┘
                                 ▼
                  ┌──── Phase 4: Auto-Challenge ────┐
                  │  every model audits every other  │
                  │  flags factual / logical / gaps  │
                  │  challenges write back to board  │
                  └──────────────┬───────────────────┘
                                 ▼
                  ┌──── Phase 5: Voting ────────────┐
                  │  majority / weighted / consensus │
                  │  / unanimous                     │
                  │  no consensus → "needs review"   │
                  │  (no fake winner)                │
                  └──────────────────────────────────┘
                                 │
                                 ▼
                  Multi-round (default 2): round-2 prompt
                  carries round-1 responses + critiques.
```

**Why adversarial?** A single LLM's RLHF bias makes it confidently fabricate when it doesn't know. Naive multi-LLM voting amplifies same-direction bias (overlapping training data → same wrong answer → majority approves). Adding **external tool grounding** + **honest concession** + **peer audit** is an engineering path that puts *truth* above *sounding complete*.

## Why AAP

| Approach | What usually happens | AAP's stance |
|---|---|---|
| Single model | Fast answer, but confident hallucinations are hard to detect | Treat every answer as a claim that can be challenged |
| Naive model voting | Shared training data can produce shared wrong answers | Require critique, provenance, and explicit "needs review" states |
| Tool-only agent | Tools help, but the model can still overstate evidence | Show tool calls, let peers audit claims, and allow `concede()` |
| AAP | Generate, ground, challenge, revise, vote | Prefer verified uncertainty over a fake winner |

## Demo Gallery

Each demo is a short terminal-style trace of the same protocol: independent answers, optional tool grounding, structured blackboard review, peer challenge, revision, and voting.

| World Cup result | Code understanding |
|---|---|
| <img src="assets/demos/world-cup-result.gif" alt="AAP demo: World Cup result adversarial verification" width="100%"> | <img src="assets/demos/code-understanding.gif" alt="AAP demo: code understanding adversarial review" width="100%"> |

| Question verification | Standards interpretation |
|---|---|
| <img src="assets/demos/question-verification.gif" alt="AAP demo: question verification with tool evidence" width="100%"> | <img src="assets/demos/standards-interpretation.gif" alt="AAP demo: standards interpretation adversarial review" width="100%"> |

---

## ✨ Features

### Multi-model adversarial loop
- Mix any vendors: OpenAI / Anthropic / Ollama protocols, OpenAI-compatible proxies (SiliconFlow, local multi-model gateways) all work
- **Multi-round**: minimum 2 rounds and maximum 4 rounds by default; each refinement round sees the previous answers, critiques, and blackboard control signals
- **Adaptive round control**: `maxRounds` is a safety cap; after the minimum rounds, AAP keeps going while high/medium challenges or required blackboard revisions remain, and marks review required if the cap is reached unresolved
- **Weighted voting**: per-model weights; modes are majority / weighted / consensus / unanimous

### Truth grounding (Tier 3)
- **Tools** invoked by the model itself:
  - `search` — local SearXNG search
  - `fetch_url` — fetch a URL and extract readable text
  - `exec_python` — sandboxed Python (one-shot Docker container, `--network none`, stdlib only)
  - `concede` — **honest withdrawal**: a model that sees evidence proving it wrong can declare so and optionally `defer_to` a peer
- **Capability probe**: each model is tested for genuine tool-calling support; results cached 24 h, unsupported models are auto-dropped when tools are active
- **Current-date system message**: every prompt is told today's ISO date so models don't fall back to their training cutoff
- **Truth > convergence**: if voting can't reach the threshold the system outputs "needs human review" rather than fabricating a winner

### User opinion adversarial review
- User opinion is parsed into verifiable claims, not treated as a vote or source of truth
- User-provided evidence URLs are fetched, summarized, and attached to claim review prompts
- Output includes adopted / rejected / partial / unresolved verdicts, evidence status, an adoption matrix, and a compact evidence graph
- Anti-sycophancy scoring down-weights models that support a user claim without evidence after a blind first pass

### Structured blackboard protocol
- Every generation round updates structured claims, evidence refs, consensus clusters, and controller events
- Peer challenges are registered back into the blackboard and become revision directives for the next round
- Low-independence consensus is flagged so "two models agree" is not treated as truth by itself
- Divergent minority claims are preserved for adjudication instead of being overwritten by majority wording
- Identity drift is surfaced when a runtime participant claims to be a different model family, and the signal feeds model-profile scoring

### Structured decision engines
- Forecasting framework for probability rankings with base rates, weighted signals, uncertainty intervals, Brier score, and log loss
- World Cup champion model MVP using rating/form/health/path inputs with deterministic seeded simulations
- US presidential election model MVP splitting nomination probability from general-election probability
- Standards conflict adjudication by applicability, authority, mandatory vs recommended language, specificity, effective date, replacement, and transition periods

### Observability (TUI)
- Live streaming output and token counts per model
- Final truth-seeking contract summary near the top of the run detail: representative answer, confidence, review state, and stop reason
- Cross-model challenges (type / severity / confidence / cited fragment / reason)
- **Tool-call panel**: which model called which tool, ok/✗, result preview
- Structured blackboard panel for per-round claims, registered challenges, consensus risk, identity drift, minority protection, and revision directives
- Concession block (purple ⚐) for honest withdrawals
- Voting distribution
- Multi-round progress indicator

### Deployment
- One process runs both TUI and HTTP server
- HTTP server is compatible with OpenAI `/v1/chat/completions` and Anthropic `/v1/messages`
- Drop-in upstream for Claude Code / Cursor / your own agent — every external request is run through the adversarial pipeline; the TUI sees them live

---

## 🚀 Quick Start

### 1. Install

From npm:

```bash
npm install -g ai-adversarial-protocol
aap --help
```

Or from source:

```bash
git clone git@github.com:laochendeai/ai-adversarial-protocol.git
cd ai-adversarial-protocol
npm install
npm run build
npm link               # makes `aap` globally available (optional)
```

Run from source without linking: `npm run dev`.

### 2. Add models (**interactive — easiest**)

```bash
aap config add
```

It walks you through: endpoint base URL → protocol → API key → automatically calls the upstream `/v1/models` and lists what's available → pick. You can chain multiple endpoints in one session.

Scripted form is also supported:

```bash
aap config add deepseek-v3 \
  --protocol openai \
  --base-url https://api.example.com/v1 \
  --api-key sk-... \
  --model deepseek-ai/DeepSeek-V3.2
```

Pure discovery (print only, don't save):

```bash
aap config discover --base-url https://api.example.com/v1 --protocol openai --api-key sk-...
```

Provider notes:
- OpenAI-compatible third-party gateways should normally use `--protocol openai` and a base URL ending in `/v1`.
- Native Anthropic endpoints do not expose a public model-list endpoint in AAP; add them with an explicit `--model`.
- Keep API keys in `~/.aap/config.json` only. Do not paste keys into issues, PRs, logs, or chat transcripts.

### 3. (Optional) Enable truth-grounding mode

```bash
# Bring up the local SearXNG search backend
bash scripts/start-searxng.sh

# Probe each model's tool-calling support
aap probe

# Inspect probe results + tool config
aap tools list

# Edit ~/.aap/config.json and set adversarial.tools.enabled to true
```

Search and link verification are separate services: AAP's HTTP server defaults to `127.0.0.1:28788`; SearXNG usually runs on `127.0.0.1:28080`; model providers are your upstream `/v1` endpoints.

### 4. Run

```bash
aap                      # TUI + Server
aap --no-tui             # Headless server only
aap --no-server          # TUI only
aap --port 9000          # Override port
```

---

## 🖥 TUI keys

| Key | Action |
|---|---|
| `n` | New run (pick models, then type the question) |
| `a` | Add a model (opens the discovery flow) |
| `↑` / `↓` | Switch between runs |
| `q` / `Ctrl+C` | Exit |

The `n` modal: space to toggle a model selection, Enter to confirm → type the question → Enter to dispatch.

After Enter, AAP runs **preflight** (dedupes endpoints, pings `/v1/models` to verify each chosen model is alive). If anything fails you get three options: drop the failing models, abort, or continue anyway.

---

## 🌐 HTTP API

The server listens on `http://127.0.0.1:28788` by default. The `model` field decides what happens:

| `model` value | Behavior |
|---|---|
| `adversarial:all` | Call every enabled model and return them in parallel |
| `adversarial:vote` | All models + voting; the primary response is the winner's |
| `adversarial:debate` | All models + cross-challenge; primary response is a merged multi-model output |
| `adversarial:m1,m2,m3` | Specific model ids |
| `qwen-235b` | Pass-through, no adversarial |

### OpenAI-compatible

```bash
curl -X POST http://127.0.0.1:28788/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "adversarial:vote",
    "messages": [{"role":"user","content":"Explain entropy in one sentence"}],
    "user_opinion": "The answer should mention microstates.",
    "user_evidence": ["https://example.com/evidence"]
  }'
```

The response is a standard OpenAI Chat Completion plus an `x_adversarial` extension carrying responses, structured deliberation, challenges, voting, user-opinion verdicts, evidence results, adoption matrix, and tool-call logs.

Streaming: add `"stream": true`, get standard OpenAI SSE; per-model output is separated with `## modelId` markdown headers; the final chunk carries `x_adversarial`, then `data: [DONE]`.

### Anthropic-compatible

```bash
curl -X POST http://127.0.0.1:28788/v1/messages \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "adversarial:debate",
    "max_tokens": 1024,
    "messages": [{"role":"user","content":"1+1=?"}]
  }'
```

Returns a standard Anthropic Message (`type: "message"`, `content: [{type:"text",...}]`) with `x_adversarial`. Streaming follows Anthropic's `message_start` / `content_block_delta` / `message_delta` / `message_stop` protocol.

### Plug into Claude Code

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:28788
export ANTHROPIC_AUTH_TOKEN=any
claude
```

Or pin it in `~/.claude/settings.json`. Every Claude Code request will run through the adversarial pipeline; the TUI sees them in real time.

---

## 🧰 Command reference

```
aap                              # default: TUI + Server
aap --no-tui|--no-server         # one or the other
aap --port <n> | --host <addr>

aap config init                  # initialize config
aap config list                  # list all models
aap config add [<id>]            # add (with id = scripted; without id = interactive)
aap config discover --...        # probe an endpoint, list available models
aap config remove <id>           # delete
aap config enable|disable <id>   # toggle
aap config path                  # print config.json path

aap probe [ids...] [--all]       # probe tool-calling support
aap tools list                   # show tool config + per-model capability
aap profile list                 # show model profile, sycophancy risk, vote multiplier
aap calibration add --model <id> --task-type <type> --probability <0-1> --outcome true|false
aap calibration summary          # summarize later outcome feedback
```

In the TUI, `[n]` starts a blind-first run. After the blind answer is visible, press `[u]` on the selected run to add user opinion or evidence links as claims to verify.

---

## 📁 Persistence

Under `~/.aap/`:
- `config.json` — models + server config
- `audit-metrics.json` — cumulative reliability score per model
- `capabilities.json` — tool-calling capability cache (TTL 24 h)
- `model-profiles.json` — lightweight per-run model profile events for future dynamic weighting
- `calibration-memory.json` — later outcome feedback for probability / verdict calibration

---

## 🏗 Architecture

AAP is a **Node.js CLI + HTTP protocol server**. The current product is not a Next.js app, Tailwind UI, browser Web UI, local knowledge warehouse, or domain-specific predictor.

```text
┌──────────────────────── aap Node.js process ────────────────────────┐
│                                                                      │
│  CLI / TUI (Ink)  ───┐                  ┌─── HTTP Server (Hono)      │
│                      └──── EngineHub ───┘     global event bus       │
│                                │                                     │
│                       AdversarialEngine                              │
│                              per run                                 │
│                                │                                     │
│  generation → structured blackboard update → auto-challenge          │
│       → blackboard challenge writeback → adaptive round control      │
│       → user-opinion claim review → voting → protocol output         │
│                                │                                     │
│  ModelClient: OpenAI-compatible | Anthropic | Ollama                 │
│  Tools/plugins: search | fetch | exec | capability probes            │
└──────────────────────────────────────────────────────────────────────┘
```

Technical shape:
- **Runtime**: Node.js 20+, TypeScript, ESM.
- **TUI**: Ink (`src/tui/`), sharing the same `EngineHub` event stream as HTTP runs.
- **Server**: Hono + `@hono/node-server` (`src/server/`), exposing OpenAI-compatible and Anthropic-compatible routes.
- **Bundling**: `tsup` builds `src/cli.ts` into `dist/cli.js`; React/Ink packages remain external runtime dependencies.
- **Configuration**: `~/.aap/config.json` is the single local source of truth for model endpoints, protocols, server settings, adversarial options, tools, and storage.
- **Provider protocols**: OpenAI-compatible chat completions, Anthropic messages, and Ollama chat are normalized by `ModelClient`.
- **Search/tools**: A model is not assumed to have native search. Search participation is controlled by AAP tool capability probing and the configured tool loop.

Core protocol modules:
- `structured-deliberation` is a round-aware blackboard controller, not a one-time summary. It accumulates `rounds`, `claims`, `evidenceRefs`, `challengeRefs`, `events`, and `revisionDirectives`.
- `claim-graph` connects user claims, model claims, evidence, challenges, conflicts, and verdicts through explicit support/refute/qualify/depend/conflict edges.
- `user-opinion` injects user text and evidence links only after blind model answers, then records adoption/refutation and sycophancy risk.
- `model-profile` and `calibration-memory` keep lightweight behavioral metadata so later runs can adjust roles and voting weights from measured performance instead of provider prestige.
- `output-contract` requires conclusion, confidence, evidence chain, conflict points, user-claim adoption/rejection, sycophancy risk, and explicit uncertainty/review conditions.

Round control is adaptive: AAP runs at least 2 rounds and at most 4 rounds by default. `maxRounds` is a safety cap, not proof that truth was reached; unresolved high/medium challenges or required blackboard revisions are surfaced as review conditions.

HTTP responses remain standard OpenAI/Anthropic-compatible responses, with `x_adversarial.structuredDeliberation` carrying the accumulated round-aware blackboard data.

Details: [ARCHITECTURE.md](ARCHITECTURE.md).

---

## 🛠 Development

```bash
npm run dev              # tsx src/cli.ts (run from source)
npm run build            # tsup → dist/cli.js
npm run type-check       # tsc --noEmit
npm test                 # vitest --run
npm run test:watch       # vitest watch mode
```

The build produces a single ~150 KB ESM file plus sourcemap; runtime depends only on `react/ink/ink-*` (external).

Test conventions: [TESTING.md](TESTING.md). Project agreements: [AGENTS.md](AGENTS.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

---

## 📦 Publishing

This package is published on npm as [`ai-adversarial-protocol`](https://www.npmjs.com/package/ai-adversarial-protocol).

Manual install:

```bash
npm install -g ai-adversarial-protocol
```

Release publishing uses npm Trusted Publishing (OIDC), not `NPM_TOKEN`.

Required npm package settings:

- Provider: GitHub Actions
- Organization/user: `laochendeai`
- Repository: `ai-adversarial-protocol`
- Workflow filename: `release.yml`
- Environment: empty
- Publishing access: `Require two-factor authentication and disallow tokens (recommended)`

After bumping the version on `main`, push a `v*` tag to publish:

```bash
git tag v0.1.2
git push origin v0.1.2
```

The release workflow runs type-check, tests, build, then `npm publish --access public`.

---

## 🗺 Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md) for the current plan, good first issue areas, and non-goals.

---

## Friends

- [linux.do](https://linux.do/) - developer community for builders and AI tool users.

---

## 📜 License

[MIT](LICENSE) © 2026

---

<div align="center">

**Why this project exists: turn "multi-model collaboration" from an intuition that says "this should sound more solid" into a verifiable engineering practice for finding truth.**

If you find this useful, a ⭐ on GitHub helps a lot.

</div>
