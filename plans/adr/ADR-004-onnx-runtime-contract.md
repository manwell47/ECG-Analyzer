# ADR-004 — ONNX Runtime Contract

Status: Accepted
Date: 2026-09-03
Scope: Model metadata, validation, and inference boundary

## Context

ONNX models are external, versioned scientific artifacts (AGENTS.md §9; rules §16–§19).
The SIGIL reference project hard-codes model-specific preprocessing (320x320 RGB,
ImageNet mean/std) inside `OnnxWrapper` — the anti-pattern this project must avoid. Shape
compatibility is not scientific compatibility (rules §16, AGENTS.md §9).

## Decision

- Every model ships with an externalized, versioned **`ModelMetadata`** document validated
  against a strict schema at load: modelId, modelVersion, input shape/dtype/layout,
  expected sampling rate, channel configuration, window length, exact preprocessing
  assumptions, normalization strategy, output semantics (logits vs probabilities,
  activation, class labels/ordering), training provenance and limitations.
- Inference goes through an `InferenceEngine` interface: `run(modelId, version, ModelInput)
  -> ModelPrediction`. ONNX Runtime Web is an inference backend *behind* this interface;
  the UI never knows tensor shapes or raw output semantics.
- **Validation happens before execution**: id/version match, dtype, shape, sample rate,
  channel count, window length, and normalization fingerprint. Incompatible data fails
  loudly; data is never silently reshaped or adapted to satisfy a dimension.
- Output interpretation (labels, scores, probability semantics) belongs to
  `ModelMetadata` + explicit postprocessors, never to presentation code. No fabricated
  predictions or hard-coded metrics anywhere.
- Runtime contains no training logic; model replacement requires id/version/metadata bump
  (rules §46).

## Consequences

- Model input/output semantics are inspectable and auditable per model.
- UI stays decoupled from model internals; model changes do not ripple into components.
- Strict validation prevents accidental scientific incompatibility from being masked by
  shape coercion.

## References

- Architecture plan §E.1, §H, Phase 6
- AGENTS.md §9, §10; `.roo/rules-code/01-medical-engineering.md` §16, §17, §18, §19, §46
