# System Architecture: AI Adversarial Protocol

Technical map for the repository. Defines module responsibilities and data flow so future contributors (human or AI) stay aligned.

## 0. Product North Star

AAP is a lightweight, model-evolving adversarial adjudication protocol. The core runtime must stay domain-agnostic and should improve as stronger external models are plugged in. Domain-specific modules such as sports, elections, standards, finance, or legal workflows are examples, plugins, or benchmarks unless they generalize into protocol primitives.

The governing rules live in `AGENTS.md`; the product and algorithm north star lives in `docs/PROJECT_NORTH_STAR.md`.

## 1. Runtime Shape

`aap` is a single Node.js process that runs **two front-ends sharing one event bus**:

```
TUI (ink)  ──┐                  ┌── HTTP Server (Hono)
             │                  │
             └──> EngineHub <───┘     ← global EventEmitter singleton
                     │
                     └── AdversarialEngine (per-run)
                              │
                              └── ModelClient
                                    ├── openai-protocol
                                    ├── anthropic-protocol
                                    └── ollama-protocol
```

Both the TUI and HTTP routes call `hub.startRun(...)`. Engine events (`run-start`, `chunk`, `phase-change`, `challenge`, `user-opinion-result`, `voting-result`, `model-complete`, `run-complete`, `run-failed`) are re-emitted on `hub` as `engine-event`. The TUI subscribes for rendering; the HTTP layer subscribes per-request to translate events into OpenAI/Anthropic SSE chunks.

## 2. Module Responsibilities

### 2.1 Engine (`src/engine/`)
| File | Responsibility |
| :--- | :--- |
| `AdversarialEngine.ts` | One instance per run. Drives generating → auto-challenge → optional user-opinion review → voting, emits events, returns final `RunResult`. |
| `EngineHub.ts` | Global singleton. Tracks active + last-50 completed runs, broadcasts events, owns the `AppConfig`. |
| `ModelClient.ts` | Dispatches to a protocol client based on `ModelConfig.protocol`. Returns a unified streaming async iterator + a non-stream variant. Extracts `<thinking>` blocks. |

### 2.2 Protocol Clients (`src/lib/clients/`)
| File | Protocol |
| :--- | :--- |
| `openai-protocol.ts` | `POST /chat/completions` + SSE `data: ...` parsing. Used for any OpenAI-compatible upstream (incl. local multi-model endpoints). |
| `anthropic-protocol.ts` | `POST /v1/messages` + Anthropic event-typed SSE (`message_start`, `content_block_delta`, `message_delta`). |
| `ollama-protocol.ts` | Native Ollama `/api/chat` ndjson. |

Each exports a streaming function and a `*NonStream` variant.

### 2.3 Feature Modules (`src/lib/features/`)
Self-contained capabilities consumed by `AdversarialEngine`. Each is keyed by `modelId: string` (no provider enum).

| Feature | Responsibility | Key files |
| :--- | :--- | :--- |
| **voting** | Multi-model consensus with majority / weighted / consensus / unanimous modes. | `calculator.ts`, `prompt.ts` |
| **auto-challenge** | Each model audits others' outputs; parser extracts typed challenges. | `prompt.ts`, `parser.ts` |
| **user-opinion** | Treats user opinion as verifiable claims, not votes. Models review claims after the blind first pass; aggregation reports verdicts, evidence fetch results, adoption matrix, evidence graph, and anti-sycophancy vote penalties. | `parser.ts`, `prompt.ts`, `aggregator.ts`, `evidence.ts`, `graph.ts`, `format.ts` |
| **forecasting** | Deterministic structured probability models for forecast rankings. LLM text can be a capped qualitative signal, not a direct probability source. | `framework.ts`, `world-cup.ts`, `us-election.ts` |
| **standards** | Clause-level standards conflict adjudication by scope, authority, mandatory/recommended wording, specificity, effective date, replacement, and transition period. | `adjudicator.ts` |
| **eval** | Offline benchmark helpers for user-opinion truthfulness, sycophancy, review precision, and evidence coverage. | `user-opinion-benchmark.ts` |
| **audit-metrics** | Reliability scoring (A+ ~ D), persisted to `~/.aap/audit-metrics.json`. | `calculator.ts`, `storage.ts` |
| **thinking-visualization** | Extracts `<thinking>...</thinking>` blocks from model output. | `parser.ts` |

### 2.4 Server (`src/server/`)
| File | Responsibility |
| :--- | :--- |
| `index.ts` | Hono app + `@hono/node-server` startup. Accepts `EngineHub` via DI. Returns `{ url, close() }`. |
| `sse.ts` | `buildOpenAIStream(hub, req)` and `buildAnthropicStream(hub, req)`. Subscribes to engine events, translates to wire format. Multi-model output is merged with `## modelId` markdown headers; final chunk carries `x_adversarial` metadata. |
| `routes/openai-compat.ts` | `POST /v1/chat/completions` (sync + stream), `GET /v1/models`. Parses the `model` field for `adversarial:*` modes. |
| `routes/anthropic-compat.ts` | `POST /v1/messages` (sync + stream). |

### 2.5 TUI (`src/tui/`)
| File | Responsibility |
| :--- | :--- |
| `App.tsx` | ink top-level. Subscribes to `EngineHub`, renders run list + selected detail + input modal. |
| `hooks/useHub.ts` | React hook turning hub events into `{ runs, order }` state. |
| `components/RunListPanel.tsx` | List of all active/recent runs (TUI-triggered + HTTP-triggered). |
| `components/RunDetailView.tsx` | Phase indicator + per-model output panels + challenges + user-opinion verdicts + voting result for the selected run. |
| `components/InputModal.tsx` | Three-stage modal (model multi-select → question entry → optional user opinion/evidence). |
| `components/ModelPanel.tsx` | Single model's streaming output column. |
| `components/PhaseIndicator.tsx`, `ChallengeView.tsx`, `UserOpinionView.tsx`, `VoteView.tsx` | Sub-views. |

### 2.6 CLI + Config
| File | Responsibility |
| :--- | :--- |
| `src/cli.ts` | commander entry. Default action runs TUI + Server. Subcommands: `config init/list/add/remove/enable/disable/path`. |
| `src/config/loader.ts` | Reads/writes `~/.aap/config.json`. Provides `loadConfig`, `saveConfig`, `addModel`, `removeModel`, `updateModel`. |

## 3. Data Flow

### 3.1 TUI-triggered run
1. User presses `n`, picks models, types question, and may add optional opinion/evidence links.
2. `App.tsx` → `hub.startRun({ question, modelIds, source: 'tui-input', userOpinion? })`.
3. `useHub` receives `engine-event`s, updates React state, panels re-render with each `chunk`.
4. On `run-complete`, audit metrics are written to disk.

### 3.2 HTTP-triggered run
1. External agent → `POST /v1/chat/completions` with `model: "adversarial:vote"`.
2. Route parses `model` → `modelIds` + `mode`.
3. Optional `user_opinion`, `user_evidence`, or `x_adversarial.user_opinion` is normalized into `RunRequest.userOpinion`.
4. Calls `hub.startRun({ question, modelIds, source: 'http-openai', mode, userOpinion? })`.
5. User evidence URLs are verified during the user-opinion phase and included in claim review prompts.
6. SSE handler subscribes to that `runId`'s events, translates them into OpenAI chunks.
7. Final chunk includes `x_adversarial` metadata; closes with `data: [DONE]`.
8. The TUI is also subscribed to the same hub, so the run appears in its list in real time.

## 4. Configuration

`~/.aap/config.json`:

```ts
interface AppConfig {
  models: ModelConfig[];        // any number, any protocol
  server: { port: number; host: string };
  adversarial: {
    autoChallenge: { enabled: boolean; threshold: number };
    voting: { enabled: boolean; mode: 'majority'|'weighted'|'consensus'|'unanimous' };
  };
  storageDir: string;
}

interface ModelConfig {
  id: string;                   // user alias, e.g. "deepseek-v3"
  protocol: 'openai' | 'anthropic' | 'ollama';
  baseUrl: string;
  apiKey: string;
  model: string;                // upstream model name
  weight?: number;              // voting weight (default 1.0)
  enabled: boolean;
}
```

No env-var or LocalStorage layering — config file is the single source of truth.

## 5. Build

`tsup` bundles `src/cli.ts` to a single `dist/cli.js` (ESM, target node20). React/ink/ink-* are externals because they ship as ESM and don't need bundling. Shebang is injected by tsup banner; the source file must NOT have its own shebang or it duplicates.
