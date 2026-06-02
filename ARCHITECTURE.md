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

Both the TUI and HTTP routes call `hub.startRun(...)`. Engine events (`run-start`, `chunk`, `phase-change`, `deliberation-result`, `challenge`, `user-opinion-result`, `voting-result`, `model-complete`, `run-complete`, `run-failed`) are re-emitted on `hub` as `engine-event`. The TUI subscribes for rendering; the HTTP layer subscribes per-request to translate events into OpenAI/Anthropic SSE chunks.

## 2. Module Responsibilities

### 2.1 Engine (`src/engine/`)
| File | Responsibility |
| :--- | :--- |
| `AdversarialEngine.ts` | One instance per run. Drives generating → structured deliberation blackboard → auto-challenge → blackboard update → optional user-opinion review → voting, emits events, returns final `RunResult`. |
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
| **claim-graph** | Generic evidence-adversarial graph primitive. Represents user claims, model claims, evidence, challenges, verdicts, support/refute/qualify/dependency/conflict edges, and evidence-chain traversal. | `graph.ts`, `user-opinion-adapter.ts` |
| **structured-deliberation** | Generic blackboard/roundtable controller updated throughout the run. Every generation round contributes structured claims and evidence refs; every challenge round contributes challenge refs; the controller emits consensus clusters, identity-drift signals, minority-protection signals, revision directives, per-round summaries, and event logs. This is protocol control metadata, not a domain predictor. | `controller.ts`, `format.ts` |
| **adjudication** | Domain-agnostic claim adjudication by evidence stance, confidence, source reliability, recency, scope match, conflict gaps, and review thresholds. | `engine.ts` |
| **output-contract** | Required protocol answer contract: conclusion, confidence, evidence chain, conflict points, user-claim decisions, sycophancy risks, and review triggers. Wired into `RunResult`, HTTP metadata, and non-stream/stream output. | `contract.ts` |
| **model-profile** | Lightweight model-evolving profile scores and role suggestions from probe, benchmark, calibration, challenge, evidence-audit, and sycophancy events. Engine writes run events to `model-profiles.json`; voting reads them back for per-run weight adjustment. | `types.ts`, `scoring.ts`, `store.ts`, `run-events.ts` |
| **calibration-memory** | Lightweight calibration records and aggregation helpers. `aap calibration add` records later outcomes and also feeds calibration events back into model profiles. | `types.ts`, `scoring.ts`, `store.ts` |
| **protocol-benchmark** | Protocol-level metrics for comparing single-model, naive-vote, and AAP-style results. Tracks hallucination, sycophancy, evidence coverage, conflict resolution, abstention quality, and calibration error. | `metrics.ts`, `compare.ts` |
| **voting** | Multi-model consensus with majority / weighted / consensus / unanimous modes. | `calculator.ts`, `prompt.ts` |
| **auto-challenge** | Each model audits others' outputs; parser extracts typed challenges. | `prompt.ts`, `parser.ts` |
| **user-opinion** | Treats user opinion as verifiable claims, not votes. Models review claims after the blind first pass; aggregation reports verdicts, evidence fetch results, adoption matrix, evidence graph, and anti-sycophancy vote penalties. | `parser.ts`, `prompt.ts`, `aggregator.ts`, `evidence.ts`, `graph.ts`, `format.ts` |
| **forecasting** | Example/benchmark probability models. Keep domain logic here or in plugins; do not let sports/election examples become the core product. | `framework.ts`, `world-cup.ts`, `us-election.ts` |
| **standards** | Example clause-level adjudication for standard conflicts. Generalizable rules belong in **adjudication**; domain-specific metadata stays here or in plugins. | `adjudicator.ts` |
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
| `components/RunDetailView.tsx` | Phase indicator + per-model output panels + tool calls + structured blackboard + challenges + user-opinion verdicts + voting result for the selected run. |
| `components/InputModal.tsx` | Two-stage modal (model multi-select → question entry). User opinion/evidence is intentionally added later with `[u]` after blind answers are visible. |
| `components/ModelPanel.tsx` | Single model's streaming output column. |
| `components/PhaseIndicator.tsx`, `StructuredDeliberationView.tsx`, `ChallengeView.tsx`, `UserOpinionView.tsx`, `VoteView.tsx` | Sub-views. |

### 2.6 CLI + Config
| File | Responsibility |
| :--- | :--- |
| `src/cli.ts` | commander entry. Default action runs TUI + Server. Subcommands: `config init/list/add/remove/enable/disable/path`. |
| `src/config/loader.ts` | Reads/writes `~/.aap/config.json`. Provides `loadConfig`, `saveConfig`, `addModel`, `removeModel`, `updateModel`. |

## 3. Data Flow

### 3.1 TUI-triggered run
1. User presses `n`, picks models, and types the question. After blind answers are visible, the user may press `[u]` to add opinion/evidence links as claims to verify.
2. `App.tsx` → `hub.startRun({ question, modelIds, source: 'tui-input' })`; later `[u]` updates the selected run with `userOpinion`.
3. After each generation phase, the engine emits `deliberation-result`: the blackboard records structured claims, evidence refs, low-independence consensus risk, identity drift, minority protection, and revision directives before any user opinion is introduced. After auto-challenge, the same round's challenges are registered back into the blackboard and converted into revision directives for the next refinement prompt.
4. `useHub` receives `engine-event`s, updates React state, panels re-render with each `chunk`.
5. On `run-complete`, audit metrics and model-profile events are written to disk.

### 3.2 HTTP-triggered run
1. External agent → `POST /v1/chat/completions` with `model: "adversarial:vote"`.
2. Route parses `model` → `modelIds` + `mode`.
3. Optional `user_opinion`, `user_evidence`, or `x_adversarial.user_opinion` is normalized into `RunRequest.userOpinion`.
4. Calls `hub.startRun({ question, modelIds, source: 'http-openai', mode, userOpinion? })`.
5. The structured blackboard is emitted after each generation phase and updated again after auto-challenge; stream text and final `x_adversarial.structuredDeliberation` include the accumulated rounds, claims, challenge refs, events, and directives.
6. User evidence URLs are verified during the user-opinion phase and included in claim review prompts.
7. SSE handler subscribes to that `runId`'s events, translates them into OpenAI chunks.
8. Final chunk includes `x_adversarial` metadata; closes with `data: [DONE]`.
9. The TUI is also subscribed to the same hub, so the run appears in its list in real time.
10. Run metadata is converted into model-profile events. The next run uses stored profile scores plus current sycophancy and identity-drift signals to adjust voting weights.

### 3.3 Adaptive round control
`adversarial.maxRounds` is a safety cap, not a claim that truth has been reached. The engine runs at least `adversarial.roundControl.minRounds`; after that it continues while configured continuation signals remain:

- high-severity challenges;
- medium-severity challenges;
- required structured-blackboard revision directives from the current round.

If no continuation signal remains, the run stops as `converged`. If `maxRounds` is reached while such signals remain, the run stops as `max-rounds` and the protocol output contract marks review required.

### 3.4 Calibration feedback loop
1. After a real-world outcome is known, the operator runs `aap calibration add --model <id> --task-type <type> --probability <p> --outcome true|false`.
2. A lightweight calibration record is appended to `calibration-memory.json`.
3. The same outcome is also appended to `model-profiles.json` as a `calibration_result` event.
4. Future runs read the model profile and adjust model roles/weights from measured behavior, not provider prestige.

## 4. Configuration

`~/.aap/config.json`:

```ts
interface AppConfig {
  models: ModelConfig[];        // any number, any protocol
  server: { port: number; host: string };
  adversarial: {
    autoChallenge: { enabled: boolean; threshold: number };
    voting: { enabled: boolean; mode: 'majority'|'weighted'|'consensus'|'unanimous' };
    roundControl?: {
      minRounds: number;
      continueOnHighSeverityChallenge: boolean;
      continueOnMediumSeverityChallenge: boolean;
      continueOnRequiredRevision: boolean;
    };
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
