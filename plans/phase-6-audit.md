# Phase 6 Audit — ML/ONNX Contracts & Worker Orchestration

Status: Audit record (Architect review). Verdict: **No blocking ADR-004/005 violations found in code.** The two recorded seams below are **closed** by Phase 7 (see §6 addendum): #1 real-ONNX is now exercised end-to-end, and #2 the worker protocol now carries DSP/DWT request kinds. The live green `npm run check` acceptance was delivered at Phase-7 items #11/#12. Seam #3 (real `Worker` wiring) remains open by design.

Scope audited: `src/ml/**`, `src/ml/onnx/**`, `src/workers/**` against ADR-004 (ONNX Runtime Contract) and ADR-005 (Browser Worker Strategy). Static source review only — this Architect session has no terminal, so the check gate is delegated to Code mode.

---

## 1. ADR-004 conformance (ML / ONNX runtime contract)

| ADR-004 requirement | Evidence | Status |
|---|---|---|
| Externalized, versioned `ModelMetadata` | [`src/domain/ml.ts`](src/domain/ml.ts:116) types; strict schema validator [`src/ml/metadata.ts`](src/ml/metadata.ts:130) (`describeModelMetadataProblems`, `assertValidModelMetadata`, `parseModelMetadataJson`) | Conformant |
| Validation before execution; never silent adaptation | [`src/ml/engine.ts`](src/ml/engine.ts:147) `assertInputCompatibleWithModel` checks identity, tensor name, dtype, concrete shape, element count, preprocessing fingerprint | Conformant |
| Fingerprint guards "same shape ≠ scientific match" | [`src/ml/fingerprint.ts`](src/ml/fingerprint.ts:64) FNV-1a over canonicalized metadata; checked in `engine` + stamped on every `ModelInput` | Conformant |
| Scientific context validated at `ModelInput` build | [`src/ml/input.ts`](src/ml/input.ts:61) `buildModelInput` validates fs/channels/window/length/finiteness before packing | Conformant |
| Raw output semantics explicit; honest interpretation | [`src/ml/interpret.ts`](src/ml/interpret.ts:73) logits→softmax/sigmoid only when declared; otherwise uncalibrated `model-score`, never fabricated probability | Conformant |
| ONNX Runtime Web behind `InferenceEngine`; session lifecycle owned | [`src/ml/onnx/ortWebEngine.ts`](src/ml/onnx/ortWebEngine.ts:160) guarded lazy `import('onnxruntime-web')`, validated create, owned `dispose`/release, float32 enforced | Conformant (compile-only — see gap 1) |
| Test-only stub never in production path | [`src/ml/testing/stub.ts`](src/ml/testing/stub.ts:69) under `src/ml/testing/`, excluded from [`src/ml/index.ts`](src/ml/index.ts:1) production barrel | Conformant |

## 2. ADR-005 conformance (worker strategy)

| ADR-005 requirement | Evidence | Status |
|---|---|---|
| Shared runtime-agnostic scientific code; workers are thin shells, no duplicated logic | [`src/workers/core.ts`](src/workers/core.ts:54) `InferenceWorkerCore` delegates to a registered `InferenceEngine` only | Conformant |
| requestId + signalId echo on every envelope | [`src/workers/types.ts`](src/workers/types.ts:23) request/result/error all carry both ids | Conformant |
| Keep-only-latest; stale completion structurally dropped | [`src/workers/identity.ts`](src/workers/identity.ts:12) `LatestIdentityGate`; [`src/workers/client.ts`](src/workers/client.ts:46) `LatestOnlyInferenceClient` rejects superseded + drops unknown/stale | Conformant |
| Classified failures cross the boundary | `InferenceError` envelope carries `ErrorCode`; arbitrary throws coerced to `inference-failure` | Conformant |
| Transport-free so unit-testable in Node | `InferenceClientTransport` abstraction; real `Worker` wiring deferred to browser/presentation phase (documented) | Conformant (wiring absent by design — gap 3) |

## 3. Green-check evidence

- [`tsconfig.json`](tsconfig.json:1): `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`, `isolatedModules`, `noEmit`; DOM lib present for worker/browser code; `src/ml/onnx` compiles via the guarded ambient declaration.
- [`vitest.config.ts`](vitest.config.ts:1): node environment, `src/**/*.test.ts`.
- Test files exist and are substantive for every Phase 6 module: `engine`, `fingerprint`, `input`, `interpret`, `metadata`, `stub`, `client`, `core`, `identity` (spot-reviewed `engine`, `client`, `core`, `identity` — they assert exactly the ADR invariants, e.g. fingerprint-mismatch-while-shape-matches, superseded-request rejection, stale-result drop, double-dispose safety).
- [`package.json`](package.json:14) `check` = typecheck + lint + test + build.

## 4. Findings / recorded seams (non-blocking, must not be silently "done")

1. **Real ONNX path is compiled but never exercised.** `onnxruntime-web` is not installed and no committed test `.onnx` exists. Blueprint Phase 6 named "tiny committed test model + deterministic stub"; only the deterministic stub was realized. The ORT backend and the "delete `onnxruntime-web.d.ts` when installed" note ([`src/ml/onnx/onnxruntime-web.d.ts`](src/ml/onnx/onnxruntime-web.d.ts:1)) are a deliberate guard, but the real-session integration seam (`Signal → ModelInput → onnx session → ModelPrediction → interpret`) has zero runtime verification until a model artifact lands. Decide: introduce a tiny committed test model now, or defer to a model-integration task in the next phase. **→ CLOSED — Phase 7 items #1–#4 (see §6 addendum).**
2. **Worker protocol is inference-only.** ADR-005's workload table also routes filtering/DWT/segmentation/features through workers. Only the inference slice was built (correct Phase 6 scope). Generalizing envelopes or adding sibling DSP/DWT request kinds under the same identity echo belongs to the application/orchestration layer, not Phase 6. **→ CLOSED — Phase 7 item #6 (see §6 addendum).**
3. **Real `Worker` wiring** (construct worker, `onmessage`, transferable list) is intentionally absent and belongs to browser/presentation wiring. When it lands, [`src/workers/client.ts`](src/workers/client.ts:89) should pass a transfer list for the `Float32Array` payload.

## 5. Recommended next increment

Phase 6 core is complete and conformant. Per blueprint ordering ([`plans/ecg-lab-architecture.md`](plans/ecg-lab-architecture.md:316)) and the dependency rule `presentation → application → workers`, the next increment is **Phase 7 — scientific visualization**, gated on the deferred frontend-stack decision (blueprint open decision #1) and delivered with a minimal application orchestration slice so views consume domain results and never DSP internals. See the todo plan for details.

---

## 6. Addendum — Phase 7 closure (recorded 2026-09-04)

Phase 7 (Code mode) closed the two recorded seams while building the
application/presentation increment. Both were validated by the full green
`npm run check` gate at Phase-7 items #11/#12 (43 test files / 422 tests,
Vite build 135 modules).

### Seam #1 — real ONNX path now exercised (CLOSED)

- `onnxruntime-web` is installed as a real dependency ([`package.json`](package.json:1));
  the ambient [`src/ml/onnx/onnxruntime-web.d.ts`](src/ml/onnx/onnxruntime-web.d.ts:1)
  was deleted and [`src/ml/onnx/ortWebEngine.ts`](src/ml/onnx/ortWebEngine.ts:1)
  retyped against the real package types with zero behavior change (item #2).
- A tiny deterministic committed model now exists under
  `data/fixtures/models/`: `ecg-lab-probe-linear-mean-2.onnx` (543 bytes) +
  `ecg-lab-probe-linear-mean-2.metadata.json`, regenerated byte-identically by
  `generate-probe-model.py` (item #3).
- The real-session integration seam is exercised:
  [`src/ml/onnx/__tests__/onnxWeb.integration.test.ts`](src/ml/onnx/__tests__/onnxWeb.integration.test.ts:1)
  runs the committed bytes through an actual ONNX Runtime session (metadata →
  `assertValidModelMetadata` → `buildModelInput` → `createOnnxWebEngine` →
  `run` → `interpretPrediction`); [`probeModel.test.ts`](src/ml/testing/__tests__/probeModel.test.ts:1)
  asserts the recorded byte length + SHA-256 (item #4).

### Seam #2 — worker protocol generalized to DSP/DWT (CLOSED)

- [`src/workers/types.ts`](src/workers/types.ts:29) now carries DSP/DWT
  request/result/error kinds alongside inference, all sharing the
  requestId/signalId identity echo; [`src/workers/core.ts`](src/workers/core.ts:154)
  adds a `DspWorkerCore` handler that reuses the shared dsp modules (no
  duplicated logic), exercised by the in-memory Node test
  [`src/workers/__tests__/dspCore.test.ts`](src/workers/__tests__/dspCore.test.ts:1)
  (item #6).

### Model-artifact provenance (noted)

The committed probe model carries its provenance in three co-located places so
it can never silently drift or be mistaken for a scientific model: the
`provenance` block of `data/fixtures/models/ecg-lab-probe-linear-mean-2.metadata.json`,
the module docstring + pinned producer fields of
`data/fixtures/models/generate-probe-model.py`, and the "Provenance /
reproducibility gate" section of
[`data/fixtures/models/README.md`](../data/fixtures/models/README.md:74), which
records the development seam-validation status and the current size/SHA-256
integrity record.

### Seam #3 — real `Worker` wiring (still open by design)

Unchanged: constructing an actual browser `Worker` (`onmessage`, transferable
list) still belongs to later browser/presentation wiring; the worker transport
remains the abstract `InferenceClientTransport`, unit-tested in Node.
