# FAQ

> **English** · [简体中文](FAQ.zh-CN.md)

## Is AAP a replacement for RAG?

No. AAP is an orchestration layer for adversarial model collaboration. RAG is a way to provide retrieval context. They work well together: RAG can provide documents, while AAP can ask multiple models to inspect, challenge, and vote on the answer.

## Does multi-model voting guarantee truth?

No. Voting only helps when the voters have independent evidence and different failure modes. AAP therefore treats voting as the final step after tool grounding, peer challenges, and possible concession. If the result is not strong enough, AAP reports that human review is needed.

## Why tool grounding?

Models can claim they "searched" or "checked" even when they did not call a tool. AAP records actual tool calls in the run log and TUI, so you can tell whether a model used `search`, `fetch_url`, `exec_python`, or `concede`.

## Can AAP audit my local code safely?

Yes, but only through the optional local-repo tools. In the TUI, press `[r]` to add a source path interactively; from CLI, run `aap tools repo add <path>` and `aap tools enable`. The TUI started by `npm run dev` shows whether `tools` and `local-repo` are ready. The tools are read-only and bounded: they list files, search text, read limited file snippets, and optionally run exact allowlisted validation commands. They hard-exclude `.git`, `dist`, `assets`, `node_modules`, Python environments, caches, generated outputs, and common secret files. If a model reports a code defect without file/line/test evidence from these tools, treat it as unresolved.

## Where do I see the full final result for a code audit?

The TUI top summary is intentionally compact. After a run completes, it shows a `完整报告` path pointing to `~/.aap/runs/<runId>.md`. That Markdown report contains the full final conclusion, evidence chain, structured blackboard, all challenges, user-claim verdicts, tool-call summary, and every model's final output. HTTP responses expose the same location as `x_adversarial.reportPath`.

## Can user opinions participate in the debate?

Yes. Pass `user_opinion`, `user_evidence`, or `x_adversarial.user_opinion` through the HTTP API. In the TUI, start the blind run first, then press `u` on the selected run to add user opinion / evidence links. AAP parses the text into claims, fetches evidence URLs when `fetch_url` is enabled, asks models to review each claim after the blind first pass, and returns adopted / rejected / partial / unresolved verdicts. User opinion never receives direct voting power.

## How does AAP avoid flattering the user?

The first model answer is blind: it does not see the user opinion. If a model later supports a non-preference user claim without evidence, AAP records a sycophancy signal and applies a per-run vote-weight penalty. The output also includes an adoption matrix and evidence graph so users can see which claim was supported, refuted, or left unresolved.

## What is the structured blackboard?

AAP converts every generation round into structured claims, evidence refs, consensus clusters, controller events, and revision directives. Peer challenges are also registered back into the blackboard, so the next refinement round receives challenge-derived revision directives instead of only free-form debate text. Low-independence consensus, protected minority claims, identity-drift signals, per-round summaries, and challenge refs are surfaced in TUI, HTTP output, and `x_adversarial.structuredDeliberation`.

## Does AAP stop after exactly two rounds?

No. AAP now uses adaptive round control. It runs at least `adversarial.roundControl.minRounds` and stops only when configured continuation signals disappear, or when `adversarial.maxRounds` is reached. `maxRounds` is a cost and latency cap, not a truth guarantee; if unresolved challenges remain at the cap, the final protocol contract marks human review required.

## How does AAP improve as models improve?

AAP does not hard-code provider rankings. Each run writes lightweight model-profile events to `~/.aap/model-profiles.json`: blind answer completion, tool use, evidence review, challenge behavior, identity drift, and anti-sycophancy signals. Future voting reads those profiles and adjusts weights by measured behavior. When a later real-world outcome is known, add it with `aap calibration add`; that writes `calibration-memory.json` and feeds a calibration event back into the model profile. Raw confidence alone is not treated as truth.

## Why probe tool-calling capability?

Many OpenAI-compatible gateways list models that do not actually support function/tool calling. AAP probes capability before tool-grounded runs and caches the result for 24 hours. In tool-grounded adversarial runs, unsupported models are dropped before debate because they cannot use AAP's search evidence path.

## Can I use local models?

Yes. AAP supports Ollama and OpenAI-compatible local gateways. Tool-calling support depends on the specific gateway and model. Use `aap config discover` to list models and `aap probe` to test tool support.

## How do I add many models from one endpoint?

Run:

```bash
aap config add
```

The interactive flow calls `/v1/models`, lists the available models, lets you select multiple entries, then loops so you can add another endpoint without restarting the app.

## How should I configure third-party Opus, DeepSeek, or Qwen providers?

If the provider is OpenAI-compatible, use `--protocol openai` and a base URL that usually ends in `/v1`:

```bash
aap config add my-model --protocol openai --base-url https://provider.example/v1 --api-key sk-... --model provider/model-id
```

Native Anthropic-compatible providers do not have a public model-list endpoint in AAP, so use an explicit `--model`. Search requires a separate SearXNG endpoint in `adversarial.tools.searxngUrl`; AAP's server URL, SearXNG URL, and model-provider URL are three different addresses. Never paste real API keys into issues, PRs, logs, or chat transcripts.

## Why is there no Web UI?

This project is intentionally a Node.js CLI + Ink TUI + Hono HTTP server. There is no Next.js, Tailwind, browser React UI, or `src/app`. AAP is meant to sit in the terminal and act as a local compatible upstream for tools such as Claude Code, Cursor, or custom agents.

## What does `concede()` mean?

`concede()` is an explicit withdrawal tool. If a model sees evidence that proves its own answer wrong, it can exit the competition, explain why, and optionally defer to another model. This is a core part of the truth-seeking behavior: admitting error is treated as a good outcome, not a failure.

## Why does AAP default to port `28788`?

Older versions used `8788`, which can fall inside Windows excluded port ranges on some machines and fail with `EACCES`. The default is now `28788`. If your local `~/.aap/config.json` still contains an old port, it can override the source default.

## Can I run it headless?

Yes:

```bash
aap --no-tui
```

The HTTP server still exposes OpenAI-compatible and Anthropic-compatible endpoints.

## Is the npm package free to use?

Yes. `ai-adversarial-protocol` is published as a public MIT-licensed npm package.
