# ADR-009 — Experiment/Evaluation Machinery Placement & Seam-Validation Scope

Status: Accepted
Date: 2026-09-04
Scope: Phase 8 — where `PartitionSpec`, experiment configuration and evaluation
types live; how probe-driven evaluation results may be phrased.

## Context

Phase 8 (architecture §M item 8) delivers the experiment/evaluation machinery:
subject-level splits, a per-record evaluation runner, and provenance export.
Earlier planning text listed the machinery inside the architecture §F "Domain
model" entity list (`ExperimentConfiguration`, `EvaluationResult`,
`PartitionSpec` — "see L.") as though they were minimal domain value types. In
practice these are **orchestration** concerns, and the enforced dependency
direction is `presentation → application → domain / dsp / datasets / ml`.

Two constraints shape placement:

- Domain ([`src/domain/`](../../src/domain/index.ts:1)) is deliberately the
  lean, immutable-value layer (architecture risk table: "entities limited to
  F's list; added only when a consumer exists"). Experiment/evaluation types
  orchestrate existing domain/dsp/datasets/ml stages and add I/O, validation
  and serialization concerns — the opposite of a pure domain value.
- Reproducibility (ADR-007) requires the configuration to be validated,
  serializable and re-runnable; subject-aware splits (ADR-006) partition
  *dataset identities* (`recordId`/`subjectId`), not domain values.

Separately, the only committed model artifact is a development
**seam-validation probe** (`ecg-lab-probe-linear-mean-2`). Evaluations that
consume it validate the evaluation *pipeline*, not predictive performance.
Rules §47/§49 (and ADR-007) forbid fabricated performance and clinical
terminology outside justified contexts, so the scope of such runs must be
stated in mandated non-clinical wording.

## Decision

### (a) Layer placement (supersedes the architecture §F/§L "domain list" grouping)

- `PartitionSpec`, `RecordSubjectRef`, `partitionSubjects`, `partitionRecords`,
  `assertNoSubjectLeakage` and `DEFAULT_PARTITION_SPEC` live in
  [`src/datasets/partition.ts`](../../src/datasets/partition.ts:1) — the
  **datasets abstraction layer** (ADR-006) — because they partition dataset
  identities that any dataset consumer can hold, independent of experiments.
- Experiment *configuration* — `ExperimentConfiguration`, `ExperimentSelection`
  (`records` | `subject-partition`), `ExperimentModelRef`,
  `ExperimentLabelerRef`, validation, `experimentIdOf`, and the subject-selection
  resolution helpers — lives in [`src/application/experiment.ts`](../../src/application/experiment.ts:1).
- Experiment *result/export* — `ExperimentResult` (the concrete type the
  planning text called `EvaluationResult`), `RecordEvaluation`, `WindowOutcome`,
  `windowIdOf`, and the canonical `serializeExperimentResult` /
  `parseExperimentResult` — lives in [`src/application/experimentResult.ts`](../../src/application/experimentResult.ts:1).
- Metrics — `ClassificationMetrics`, `ConfusionMatrix`, `ClassRates`,
  `computeClassificationMetrics` — live in [`src/application/metrics.ts`](../../src/application/metrics.ts:1).
- The runner — `runExperiment`, `GroundTruthLabeler`, `RunExperimentOptions` —
  lives in [`src/application/runExperiment.ts`](../../src/application/runExperiment.ts:1).
- The canonical probe-seam configuration factory
  `createProbeSeamExperimentConfiguration` lives in
  [`src/application/defaults.ts`](../../src/application/defaults.ts:95) so tests
  and any future runner wiring share one source of truth.

These modules may import `domain/`, `dsp/`, `datasets/` and `ml/`, but **never**
`ml/testing/` or `ml/onnx/`; Node-only seams enter only through Node seam tests
and demos. Architecture §F/§M are updated to point here.

### (b) Seam-validation evaluation scope (mandated non-clinical wording)

- The committed probe graph emits `logits = [+Σ, −Σ]`, so softmax argmax is the
  sign of the window mean (zero-sum tie → class index 0, `positive-mean`); the
  seam ground-truth labeler is the *same* analytic sign-of-sum rule, so agreement
  is near-perfect **by construction**.
- Any evaluation of the probe must therefore be described as
  **seam-validation scope — not clinical**, and may only be claimed to prove the
  pipeline wiring: record read → ADC→mV with provenance → windowing →
  `buildModelInput` → real ONNX session → `interpretPrediction` → labeler →
  computed metrics → canonical export. It never proves predictive performance or
  any medical/diagnostic property.
- The mandated wording is carried in the seam-test header, in the `scopeNote` /
  evaluation description of the canonical configuration (mandatory, non-empty),
  and in the metrics/result documentation. Reported metrics are always computed
  from documented evaluations; clinical terminology is prohibited outside
  explicitly justified contexts (rules §19/§47/§49).

## Consequences

- Domain remains a lean immutable-value list; orchestration additions land in
  `application/` and partition primitives in `datasets/`, preserving the
  boundedness of the §F entity list.
- Node-only seams stay confined to tests; application source never imports
  `ml/testing/` or `ml/onnx/`.
- A future scientific model replaces the probe artifact and re-runs the gate;
  the wording rules are unchanged.
- Anyone reading a probe-driven result sees explicit non-clinical scope, so no
  fabricated or clinical-adjacent claim can attach to a seam run.

## References

- Architecture plan §F (Domain model), §L (Reproducibility), §M (Phase 8)
- ADR-006 (dataset abstraction / subject-aware partition), ADR-007
  (reproducibility model), ADR-008 (presentation layer)
- AGENTS.md §8, §9; `.roo/rules-code/01-medical-engineering.md` §19, §47, §49
