# Agent Rules & Governance

This file defines the behavioral constraints and operational standards for all AI agents working on this repository. These rules are non-negotiable and override general model behavior.

## 🛠 Project-Specific Guidelines

### Non-negotiable north star
AAP is a **lightweight, model-evolving adversarial adjudication protocol**. It is not a sports predictor, election predictor, standards database, local research institution, or large local knowledge warehouse.

Every core change must strengthen at least one of these protocol primitives:
- **Blind-first user-claim protocol**: models answer before seeing user opinion; user opinion enters later only as claims to verify.
- **Evidence-adversarial graph**: user claims, model claims, evidence, challenges, conflicts, and verdicts are connected by explicit support/refute/qualify/depend/conflict edges.
- **Anti-sycophancy mechanism**: models that support user claims without evidence are detected, penalized, and surfaced in the output.
- **Model-evolving controller**: model roles, weights, and trust must come from capability probing, benchmark performance, and calibration history, not hard-coded provider prestige.
- **Calibration memory**: store lightweight adjudication metadata and later outcomes for scoring and calibration; do not build a bulky local corpus by default.
- **Plugin boundary**: external data sources, search providers, domain examples, and benchmark datasets should be replaceable plugins, not baked into the protocol core.

Protocol drift is a blocking defect. Do not merge or present as complete any change that:
- turns AAP into a domain-specific predictor as the core product;
- requires a large local data institution to be useful;
- treats user opinion as an instruction, vote, or fact source;
- hard-codes conclusions, model rankings, provider superiority, or current-event assumptions;
- weakens evidence traceability, uncertainty reporting, or anti-sycophancy behavior;
- adds a domain module that cannot be framed as an example, benchmark, or plugin around the generic protocol.

Before implementing a feature, identify the protocol primitive it improves. If it does not improve one, keep it in `docs/`, `examples/`, or tests/benchmarks instead of core runtime code. The target output contract is always: conclusion, confidence/probability when applicable, evidence chain, conflict points, user-claim adoption/rejection, sycophancy risk, and explicit uncertainty or review conditions.

### Stack reality check
This project was migrated from a Next.js Web UI to a **Node.js CLI + HTTP server**. There is no Next.js, no Tailwind, no Web UI, no React DOM, no `src/app/`. If something still references those, it's stale and should be removed, not preserved.
- Front-end: **ink** (React-for-CLI). It shares React but not components with browser React.
- Server: **Hono** + `@hono/node-server`. Routes are in `src/server/routes/`.
- Bundler: **tsup**. Entry `src/cli.ts`, output `dist/cli.js` (ESM, single file).
- Read `ARCHITECTURE.md` before editing engine, server, or TUI code.

## 🛡 Meta-Rules (Mother-Repo Standards)

### 1. Closed-Loop Delivery
- **No Validation Skip**: Never report a task as "complete" without executing the relevant tests.
- **Surgical Commits**: Do not include unrelated changes in a single commit. If a refactor is needed to implement a feature, do it in a separate commit.
- **Clean State**: After merging a feature branch, always return to a clean default branch.
- **Ambiguity Resolution**: If an issue is ambiguous, use existing codebase evidence to converge on a solution before requesting user clarification.

### 2. Regression-First Quality Gate
- **Beyond the Diff**: Do not only verify the lines you changed.
- **High-Risk Areas**: Be extra vigilant when touching shared modules, entry points, configuration read/write, or global event bindings.
- **Evidence-Based Fixes**: When reporting bugs, provide a minimal reproduction path and exact file location.

### 3. Memory & Persistence Discipline
- **Stability Promotion**: Only promote rules that are stable and repeatable into this file.
- **Context Layering**: Keep temporary session notes and personal preferences in session memory; do not persist them here.

## 🔐 Permission Policy
- **Read-Only (Allow)**: Standard file reads, greps, and directory listings.
- **Recoverable Writes (Ask)**: Edits to source code, creating new files, modifying tests.
- **Destructive Ops (Deny/Confirm)**: `rm -rf`, `git reset --hard`, `git push --force`, dropping database tables. These require explicit user confirmation.

## 📝 Commit Standards
All commits must follow the Conventional Commits specification:
- `feat:` New feature
- `fix:` Bug fix
- `test:` Adding or correcting tests
- `docs:` Documentation only changes
- `refactor:` Code change that neither fixes a bug nor adds a feature
- `chore:` Updating build tasks, package manager configs, etc.

**Format**: `<<<typetype>>(scope): <<<shortshort summary>`
**Example**: `feat(voting): implement weighted voting logic`
