# ADR-005 — Browser Worker Strategy

Status: Accepted
Date: 2026-09-03
Scope: Execution model, concurrency, cancellation, memory

## Context

CPU-heavy DSP/DWT/feature/inference work must not block the UI thread (AGENTS.md §14;
rules §30, §52). Rules §30 forbid duplicating scientific logic between worker and main
thread. Long-running async work must be robust to stale results overwriting newer work
(rules §31; AGENTS.md §24 example: ECG A overwrites ECG B).

## Decision

- All scientific modules (`src/dsp`, `src/ml`, `src/datasets`) are runtime-agnostic and run
  in **both main thread and Web Workers**; workers are thin shells that transfer domain
  payloads via `postMessage` (TypedArrays as transferables, avoiding copies).
- CPU-bound work (WFDB parse, filtering long records, resampling, DWT, segmentation,
  feature extraction, model inference) executes in a worker by default; small
  UI/state transformations stay on the main thread.
- Every request carries `requestId` + `signalId`; every response echoes both. An
  application-level orchestrator keeps the latest issued identity and **rejects any
  completion whose identity is stale** — structural prevention of the overwrite race.
  Cooperative cancellation (stage-boundary checks) is supported where practical; no fake
  progress.
- Buffers stay typed end-to-end; no Array↔TypedArray churn; ONNX tensor lifecycle owned by
  the engine; workers/sessions/object URLs released on context change.
- WASM and WebGPU are deferred to measurement-driven optimization phases; no premature
  acceleration.

## Consequences

- Responsive UI under long analysis; single source of truth for DSP prevents drift.
- The identity/echo protocol makes stale-result bugs structurally impossible rather than
  discipline-dependent.
- Worker orchestration adds a small messaging layer; kept behind the application layer so
  scientific modules remain framework-free.

## References

- Architecture plan §I, §N
- AGENTS.md §14, §15; `.roo/rules-code/01-medical-engineering.md` §30, §31, §32, §52, §53
