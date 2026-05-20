# Contributing

> **English** · [简体中文](CONTRIBUTING.zh-CN.md)

Thanks for considering a contribution! The project is moving quickly — code, design, and tests are all welcome territory.

## Development environment

- Node.js **>= 20** (the codebase relies on Node 20+ fetch / streaming APIs)
- Platform: Linux / macOS / Windows (on Windows, the `exec_python` tool needs WSL2 + Docker)
- Recommended editor: VS Code (TS strict mode is on; type-driven autocomplete pays off)

```bash
git clone git@github.com:laochendeai/ai-adversarial-protocol.git
cd ai-adversarial-protocol
npm install
npm run dev          # run from source via tsx
```

## Pre-submission checks

```bash
npm run type-check   # tsc --noEmit
npm test             # vitest --run
npm run build        # tsup → dist/cli.js
```

**All three must pass.** CI runs the same checks (see [`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

## Engineering principles

- **Surgical commits**: one commit, one thing. Refactors required to ship a feature go in their own commit.
- **Test-first**: bug fixes start with a regression test that proves the bug; new functions ship with at least a happy path and one edge case. See [TESTING.md](TESTING.md).
- **Avoid premature abstraction**: three similar lines beat one early generalization. Don't design for hypothetical future needs.
- **No silent error swallowing**: errors should propagate to the caller or be emitted as events. No bare `catch {}`.

More conventions in [AGENTS.md](AGENTS.md).

## Commit format

[Conventional Commits](https://www.conventionalcommits.org/) is required:

```
<type>(<scope>): <short description>

<longer body, why over what>
```

Common types:
- `feat` — new feature
- `fix` — bug fix
- `refactor` — internal rework with no external behavior change
- `test` — add / fix tests
- `docs` — docs only
- `chore` — build, deps, config

Example: `feat(tools): add concede tool for honest withdrawal`

## PR workflow

1. Branch off `main` (`feat/<short-name>` / `fix/<...>` / `chore/<...>`).
2. Write code + tests; run the three checks above.
3. Push and open a PR using [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md).
4. CI must be green on all three required checks (Type Check, Tests, GitGuardian).
5. The PR description should answer two questions:
   - **Why**: what problem does this solve? what observation triggered it?
   - **What**: which core files changed; what was added/modified/removed?
6. Default merge strategy is `--merge` (preserve commit history + a merge node), so surgical commits remain visible on `main`.

## Major changes

For changes that touch architecture, the engine flow, event contracts, or the HTTP API shape: open an issue first to discuss, then write the code. Saves throwaway work.

## Releases and npm publishing

The npm package is public and published as [`ai-adversarial-protocol`](https://www.npmjs.com/package/ai-adversarial-protocol).

Publishing uses npm Trusted Publishing (OIDC), not long-lived npm tokens.

npm package settings must match the workflow:

- Provider: GitHub Actions
- Organization/user: `laochendeai`
- Repository: `ai-adversarial-protocol`
- Workflow filename: `release.yml`
- Environment: empty
- Publishing access: `Require two-factor authentication and disallow tokens (recommended)`

Release checklist:

1. Bump `package.json` + `package-lock.json`.
2. Run `npm run type-check`, `npm test`, `npm run build`, and `npm pack --dry-run`.
3. Merge through PR.
4. Push a `v*` tag from `main`.

The tag-triggered workflow runs the same checks and publishes with `npm publish --access public`.

## Security

If you find a security vulnerability, see [SECURITY.md](SECURITY.md). **Do not file a public issue.**

## Resources

- [ARCHITECTURE.md](ARCHITECTURE.md) — module responsibilities + data flow
- [TESTING.md](TESTING.md) — testing conventions
- [AGENTS.md](AGENTS.md) — agent rules and governance
- [CHANGELOG.md](CHANGELOG.md) — version history
