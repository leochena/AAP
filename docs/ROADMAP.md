# Roadmap

> **English** · [简体中文](ROADMAP.zh-CN.md)

AAP is pre-1.0. The priority is correctness, observability, and compatibility before adding broad product surface area.

## Now

- Stabilize tool-grounded streaming so final content and tool-call logs are always merged correctly.
- Distinguish "model does not support tool-calling" from "upstream temporarily failed" in capability caching.
- Improve TUI controls for large model lists, multi-round configuration, and run review.
- Keep OpenAI-compatible and Anthropic-compatible API responses regression-tested.

## Next

- Add Anthropic and Ollama tool-calling adapters when the upstream behavior is stable enough to test.
- Allow challengers to call tools during the challenge phase and cite the evidence they used.
- Add an independent judge mode for cases where self-grading creates obvious bias.
- Add convergence detection so multi-round runs can stop early when high-severity challenges disappear.
- Experiment with Bayesian/log-pool voting instead of arithmetic weighting.

## Later

- Position assignment: force selected models to steelman an opposing view before voting.
- Falsifiability metadata: require important claims to include what evidence would refute them.
- Run export/import so adversarial traces can be shared in issues and research notes.
- Provider compatibility matrix generated from real probes.

## Good First Issues

- Improve error messages for common provider misconfiguration.
- Add focused tests for CLI argument parsing and config migration.
- Expand documentation for local gateways and Ollama.
- Add more example `curl` requests for OpenAI and Anthropic compatibility.
- Improve TUI empty states and keyboard help copy.

## Non-goals

- A browser Web UI is not planned for the core project. The core surface is CLI + TUI + HTTP server.
- AAP will not silently scrape the web. External access should happen through configured tools with visible logs.
- AAP does not claim voting guarantees truth. It is designed to make uncertainty visible and reduce single-model failure modes.
