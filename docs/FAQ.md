# FAQ

> **English** · [简体中文](FAQ.zh-CN.md)

## Is AAP a replacement for RAG?

No. AAP is an orchestration layer for adversarial model collaboration. RAG is a way to provide retrieval context. They work well together: RAG can provide documents, while AAP can ask multiple models to inspect, challenge, and vote on the answer.

## Does multi-model voting guarantee truth?

No. Voting only helps when the voters have independent evidence and different failure modes. AAP therefore treats voting as the final step after tool grounding, peer challenges, and possible concession. If the result is not strong enough, AAP reports that human review is needed.

## Why tool grounding?

Models can claim they "searched" or "checked" even when they did not call a tool. AAP records actual tool calls in the run log and TUI, so you can tell whether a model used `search`, `fetch_url`, `exec_python`, or `concede`.

## Why probe tool-calling capability?

Many OpenAI-compatible gateways list models that do not actually support function/tool calling. AAP probes capability before tool-grounded runs and caches the result for 24 hours. Unsupported models can still be used in non-tool mode.

## Can I use local models?

Yes. AAP supports Ollama and OpenAI-compatible local gateways. Tool-calling support depends on the specific gateway and model. Use `aap config discover` to list models and `aap probe` to test tool support.

## How do I add many models from one endpoint?

Run:

```bash
aap config add
```

The interactive flow calls `/v1/models`, lists the available models, lets you select multiple entries, then loops so you can add another endpoint without restarting the app.

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
