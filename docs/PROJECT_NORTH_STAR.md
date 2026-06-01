# AAP Project North Star

AAP is a lightweight, model-evolving adversarial adjudication protocol.

The project should become stronger as frontier models improve. It should not become a large local data organization, a hard-coded domain predictor, or a warehouse of facts. Local code owns the protocol: how models are constrained, challenged, scored, calibrated, and forced to expose evidence.

## Core Thesis

Use the strongest available models as replaceable reasoning engines, but require them to operate inside a truth-seeking protocol:

1. Models answer blind before user opinion is shown.
2. User opinion becomes verifiable claims, not instructions or votes.
3. Evidence is fetched, summarized, cited, and connected to claims.
4. Models challenge each other and must distinguish support, refutation, partial support, and insufficient evidence.
5. Sycophancy is detected by comparing blind answers with post-opinion assessments.
6. Voting and final adjudication are weighted by model behavior, evidence quality, and calibration history.
7. The system may abstain or require review when evidence is insufficient.

## What Counts As Core

Core runtime work must improve at least one protocol primitive:

- Claim extraction and normalization.
- Evidence-adversarial graph construction (`src/lib/features/claim-graph`).
- Structured blackboard / roundtable control metadata (`src/lib/features/structured-deliberation`).
- Evidence quality, source reliability, and traceability.
- Anti-sycophancy detection and scoring (`src/lib/features/user-opinion` and protocol output).
- Dynamic model profiling, role assignment, and vote weighting (`src/lib/features/model-profile`).
- Calibration memory based on later outcomes and benchmark results (`src/lib/features/calibration-memory`).
- Generic adjudication rules for conflicts, uncertainty, and review thresholds (`src/lib/features/adjudication`).
- Required final answer contract (`src/lib/features/output-contract`).
- Protocol-level benchmark comparison (`src/lib/features/protocol-benchmark`).
- Plugin interfaces for search, data APIs, document parsers, and benchmarks.

## What Does Not Count As Core

The following are allowed only as examples, plugins, fixtures, or benchmark cases unless they directly generalize into a protocol primitive:

- World Cup, election, finance, legal, medical, standards, or other domain-specific predictors.
- Large local scraped corpora.
- Hard-coded current-event facts, winners, candidates, teams, or provider rankings.
- Data-source-specific business logic embedded into the engine.
- UI copy or demos that imply AAP guarantees truth or replaces expert review.

## Model-Evolving Rule

Do not assume today's best model remains best tomorrow. GPT, Opus, DeepSeek, Qwen, local models, and future providers must be treated as interchangeable participants.

Prefer:

- capability probing over provider assumptions;
- measured benchmark performance over reputation;
- per-task role assignment over fixed model roles;
- calibration history over one-off subjective preference;
- explicit uncertainty over forced consensus.

## Lightweight Local State Rule

AAP may persist lightweight metadata:

- questions, claims, evidence URLs, evidence summaries, and verdicts;
- model responses, challenges, sycophancy signals, and vote weights;
- benchmark scores, calibration outcomes, and reliability summaries.

AAP should not require a bulky local knowledge base to deliver its core value. Heavy datasets belong behind optional plugin boundaries.

## Required Output Contract

When a feature affects final answers, it must preserve or improve this output contract:

- final conclusion;
- confidence or probability when applicable;
- evidence chain;
- conflict points;
- user claims adopted, rejected, partially adopted, or unresolved;
- sycophancy risks and penalties;
- explicit uncertainty and human-review triggers.

## Development Gate

Before adding or changing core runtime logic, answer:

1. Which protocol primitive does this improve?
2. Does it remain useful when the underlying models improve?
3. Is domain-specific logic isolated as a plugin, example, fixture, or benchmark?
4. Does it improve evidence traceability, calibration, anti-sycophancy, or conflict adjudication?
5. What test, benchmark, or documented limitation prevents overclaiming?

If the answer is unclear, do not put the change in core runtime code.
