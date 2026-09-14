# ADR-007 — Experiment / Reproducibility Model

Status: Accepted
Date: 2026-09-03
Scope: Experiment configuration, provenance, evaluation

## Context

Any experiment must be reproducible and never depend on undocumented implicit state
(AGENTS.md §8). Evaluation must be subject-aware to prevent leakage. The system should
record enough to identify an experiment without becoming a full MLOps platform
(prompt §18).

## Decision

- `ExperimentConfiguration` captures everything required to re-run an experiment:
  dataset, record(s), channels, sample rate, preprocessing configuration, DWT
  configuration, segmentation, feature configuration, model id + version, thresholds
  (never in UI), and evaluation configuration.
- `ExperimentResult` records the configuration plus software version/commit and the full
  **provenance transform-history** of every signal consumed. No undocumented implicit
  state; configuration objects are validated and serializable (e.g., JSON) for archival.
- Evaluation uses the subject-aware `PartitionSpec` (ADR-006); training-derived parameters
  originate exclusively from training partitions; thresholds have explicit rationale and
  never live in presentation code.
- Reported metrics are always computed from documented evaluations — never fabricated,
  hard-coded, or inferred from demo data. Clinical terminology is prohibited outside
  explicitly justified contexts; calibrated-probability wording is used only when
  scientifically valid (rules §19, §48, §49).
- Training stays external/offline; the runtime consumes versioned model artifacts and can
  evaluate them, but never trains in the browser.

## Consequences

- Reproducible scientific claims and auditable evaluation methodology.
- Scope remains bounded (no MLOps platform); provenance is captured at natural attach
  points defined in ADR-001.
- Any experiment can be re-run or challenged by another engineer.

## References

- Architecture plan §L, Phase 8
- AGENTS.md §8, §9, §10, §11; `.roo/rules-code/01-medical-engineering.md` §20, §24, §25, §47, §48, §49
