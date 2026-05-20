# Security Policy

> **English** · [简体中文](SECURITY.zh-CN.md)

## Supported versions

Only the `main` branch receives security updates. Pre-1.0 we don't backport to old tags.

| Version | Supported |
| ------- | --------- |
| `main` (HEAD) | ✅ |
| Older tags / forks | ❌ |

## Reporting a vulnerability

**Please don't disclose security issues in public issues.**

Private channels (pick one):

1. **GitHub Security Advisory** (recommended)
   Go to https://github.com/laochendeai/ai-adversarial-protocol/security/advisories/new . GitHub delivers it privately to the maintainer and we can coordinate on a fix and disclosure.

2. **GitHub DM**
   Reach out to [@laochendeai](https://github.com/laochendeai).

Include in the report:
- Description and your assessment of severity
- Reproduction steps (ideally a minimal repro snippet/command)
- Environment (Node version, OS, AAP version / commit)
- Suggested fix direction (optional)

## Response

| Time | Action |
| ---- | ------ |
| 48 hours | Acknowledgement |
| 7 days | Severity assessment + plan |
| 30 days (typical) | Fix shipped; faster for high severity |

## Risk surface we actively care about

We welcome targeted testing in these areas:

- **Tool sandbox escape**: `exec_python` is supposed to run with no network and no host filesystem access. If you find a way out — to the host network or filesystem — please report immediately.
- **Prompt injection → tool abuse**: malicious questions causing the model to invoke `exec_python` with destructive code (even sandboxed it can DoS), or to use `fetch_url` to probe internal networks.
- **Credential leakage**: API keys, config file paths, sensitive fields echoed in HTTP error responses.
- **HTTP API input validation**: injection / DoS via the `model` field in `/v1/chat/completions`.

## Acknowledgements

Reporters of responsibly disclosed vulnerabilities are credited in the CHANGELOG's Security section (if they wish).
