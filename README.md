<div align="center">

# 🥊 AI Adversarial Protocol

**Multiple LLMs answer the same question, audit each other, ground claims in tools, and only keep what survives scrutiny.**

[![CI](https://github.com/laochendeai/ai-adversarial-protocol/actions/workflows/ci.yml/badge.svg)](https://github.com/laochendeai/ai-adversarial-protocol/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-43853d.svg)](https://nodejs.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

**English** · [简体中文](README.zh-CN.md)

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
                  ┌──── Phase 3: Auto-Challenge ────┐
                  │  every model audits every other  │
                  │  flags factual / logical / gaps  │
                  └──────────────┬───────────────────┘
                                 ▼
                  ┌──── Phase 4: Voting ────────────┐
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

---

## ✨ Features

### Multi-model adversarial loop
- Mix any vendors: OpenAI / Anthropic / Ollama protocols, OpenAI-compatible proxies (SiliconFlow, local multi-model gateways) all work
- **Multi-round**: 2 rounds by default; each round sees the previous round's answers and critiques to refine
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

### Observability (TUI)
- Live streaming output and token counts per model
- Cross-model challenges (type / severity / confidence / cited fragment / reason)
- **Tool-call panel**: which model called which tool, ok/✗, result preview
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

```bash
git clone git@github.com:laochendeai/ai-adversarial-protocol.git
cd ai-adversarial-protocol
npm install
npm run build
npm link               # makes `aap` globally available (optional)
```

Or run from source: `npm run dev`.

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
    "messages": [{"role":"user","content":"Explain entropy in one sentence"}]
  }'
```

The response is a standard OpenAI Chat Completion plus an `x_adversarial` extension carrying responses, challenges, voting, and tool-call logs.

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
```

---

## 📁 Persistence

Under `~/.aap/`:
- `config.json` — models + server config
- `audit-metrics.json` — cumulative reliability score per model
- `capabilities.json` — tool-calling capability cache (TTL 24 h)

---

## 🏗 Architecture

```
┌─────────────────── aap process ────────────────┐
│                                                │
│   TUI (ink)          HTTP Server (Hono)        │
│      ↑                    ↑                    │
│      └────── EngineHub ───┘  ← global event bus│
│                  ↓                             │
│        AdversarialEngine (per-run)             │
│           ↓        ↓        ↓                  │
│      ToolRegistry  ModelClient  ConcessionTracker
│           ↓             ↓                      │
│      [search, fetch, exec, concede]            │
│                         ↓                      │
│           OpenAI / Anthropic / Ollama          │
└────────────────────────────────────────────────┘
```

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

## 🗺 Roadmap

Near-term:
- [ ] Anthropic / Ollama tool-calling adapters (currently OpenAI only)
- [ ] Tool-calling during the challenge phase (let challengers cite evidence)
- [ ] Fix `streamWithTools` final-content merge bug
- [ ] Distinguish "model doesn't support tool-calling" from "upstream temporarily down" so the latter isn't frozen by the 24 h cache

Mid-term:
- [ ] Independent judge model (avoid self-grading bias)
- [ ] Convergence detection (stop early when high-severity challenges drop in multi-round)
- [ ] Bayesian voting aggregation (log-pool replaces arithmetic weighting)
- [ ] TUI: let users pick the round count per run from the input modal

Long-term:
- [ ] Position assignment (force some models to steelman the opposing view)
- [ ] Falsifiability requirement: every claim ships with "what observation would refute this"

---

## 📜 License

[MIT](LICENSE) © 2026

---

<div align="center">

**Why this project exists: turn "multi-model collaboration" from an intuition that says "this should sound more solid" into a verifiable engineering practice for finding truth.**

If you find this useful, a ⭐ on GitHub helps a lot.

</div>
