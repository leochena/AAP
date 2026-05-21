# Support

> For security issues, do **not** open a public issue. See [SECURITY.md](SECURITY.md).

## Ask a question

Use [GitHub Discussions](https://github.com/laochendeai/ai-adversarial-protocol/discussions) for:

- setup questions
- model-provider configuration
- tool-calling / SearXNG / Docker troubleshooting
- design ideas that are not yet concrete feature requests

## Report a bug

Use the [bug report template](https://github.com/laochendeai/ai-adversarial-protocol/issues/new?template=bug_report.yml).

Please include:

- AAP version: `aap --version`
- Node version: `node -v`
- OS and terminal
- minimal commands to reproduce
- redacted config snippets from `~/.aap/config.json`

## Request a feature

Use the [feature request template](https://github.com/laochendeai/ai-adversarial-protocol/issues/new?template=feature_request.yml).

Good proposals explain:

- the real workflow pain
- why current AAP behavior is insufficient
- what the success criteria look like
- whether the change affects engine, CLI, HTTP API, TUI, or tools

## Maintainer expectations

This project is pre-1.0 and moving quickly. The maintainers prioritize:

1. correctness and truth-seeking behavior over cosmetic output
2. reproducible bugs with exact commands
3. changes that preserve OpenAI/Anthropic compatibility
4. small PRs with focused tests
