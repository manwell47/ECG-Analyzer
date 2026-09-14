# ADR-011 — Worker Execution Model (real browser glue)

Status: Accepted
Date: 2026-09-13
Scope: Phase 10 — implement ADR-005 seam #3: real browser **Worker glue** for the
whole-record DSP/DWT stage and full-record model inference. **Relocation, not
optimization** — no scientific algorithm changes; the correctness gate is
byte-identical parity between the main-thread and worker paths.

## Context

ADR-005 decided the browser execution model (shared scientific modules running in
both main thread and Workers; thin worker shells; requestId/signalId identity
echo; latest-only stale-result rejection) but left the **real `Worker` glue
unwired** (seam #3). Phase 9 measured the workloads (ADR-010,
[`plans/phase-9-baseline.md`](../../plans/phase-9-baseline.md)) and showed the
whole-record DSP batch (4.8–340 ms at 650 000 samples) and the full-record
inference batch (121–214 ms) each exceed the ≈16.7 ms 60 fps frame budget
(rules §52), re-confirming the architecture §I placement while explicitly
leaving the glue for a later phase.

Phase 10 wires that glue. Constraints:

- **Relocation only** (rules §30): the identical `src/dsp` and `src/ml` functions
  must run on both paths with **byte-identical** results; no science is copied
  into a worker.
- **Inference stays seam-validation scope** (rules §47/§49; ADR-009): the only
  inference engine wired to a worker is the committed development probe.
- **No wall-clock gate** (rules §51): the before/after is recorded as a snapshot
  ([`plans/phase-10-measurement.md`](../../plans/phase-10-measurement.md)), never
  a CI assertion.
- **Resource release** (ADR-005; AGENTS §15): workers, clients and ONNX sessions
  are released on context change; nothing leaks a worker or object URL.

## Decision

### (a) A transport-free orchestration core with thin worker shells

- A minimal [`WorkerPort`](../../src/workers/port.ts:17) (`postMessage` +
  `onmessage`) is the *only* worker surface the shared code knows.
  [`bindDspCore`](../../src/workers/bind.ts:25) /
  [`bindInferenceCore`](../../src/workers/bind.ts:45) attach a
  [`DspWorkerCore`](../../src/workers/core.ts:154) /
  [`InferenceWorkerCore`](../../src/workers/core.ts:99) to any port, guard the
  inbound envelope kind, and return a **disposer** that detaches the handler.
- The worker entries
  ([`dsp.worker.ts`](../../src/workers/entries/dsp.worker.ts:1),
  [`inference.worker.ts`](../../src/workers/entries/inference.worker.ts:1)) are
  the thinnest possible shells: construct a core, bind it, done. No DSP or
  inference logic lives in a worker entry (rules §30).
- Because the core is transport-free, **all** orchestration/binder logic is
  unit-tested in Node with in-memory ports; only the two `*.worker.ts` entries and
  the browser glue are bundle-only (typecheck + lint + build).

### (b) One shared latest-only orchestration (no duplicated policy)

- The latest-only state machine lives **once** in
  [`LatestOnlyOrchestrator`](../../src/workers/orchestrator.ts:41): mint a
  monotonic `requestId`, immediately reject superseded in-flight requests as
  `request-superseded`, silently drop completions whose id is no longer current,
  and abort everything on `dispose`.
- Two thin clients compose it
  ([`client.ts`](../../src/workers/client.ts:81)):
  [`LatestOnlyInferenceClient`](../../src/workers/client.ts:81) (Phase 6; **public
  API unchanged**) and
  [`LatestOnlyDspClient`](../../src/workers/client.ts:153) (Phase 10). Each drops
  completions of the other envelope kind, so a DSP envelope can never resolve an
  inference request and vice versa. Extracting the shared core is
  behaviour-preserving: the existing Phase-6 inference client tests stay green
  unchanged.

### (c) Placement: DSP/DWT and inference off the main thread

- **DSP/DWT** runs behind a [`DspExecutor`](../../src/application/dspExecutor.ts:41)
  seam. `RecordAnalysisService` keeps the *workflow* (load record → ADC→mV →
  DSP/DWT stage → assemble result) and delegates only the stage;
  [`MainThreadDspExecutor`](../../src/application/dspExecutor.ts:49) is the
  **default** (existing behaviour/tests untouched) and
  [`WorkerDspExecutor`](../../src/application/dspExecutor.ts:67) relays the
  identical inputs over the DSP client. Both call the same single-sourced `src/dsp`
  functions, on the main thread or inside `DspWorkerCore`.
- **Full-record inference** runs behind
  [`WorkerInferenceEngine`](../../src/ml/onnx/workerInferenceEngine.ts:35)
  (`implements InferenceEngine`, `backendId = 'worker-onnx-web'`): it validates
  the realized input locally (loud, cheap), then posts one `inference-request`
  through the inference client and resolves the worker's `ModelPrediction`. The
  ONNX session and every `run` execute **inside** the inference worker; the main
  thread never imports `onnxruntime-web`. Because it is a drop-in
  `InferenceEngine`, the unchanged `runExperiment` uses it without modification.
- Browser composition happens in exactly **one** place,
  [`main.ts`](../../src/main.ts:34), via the browser glue
  [`browserWorkers.ts`](../../src/presentation/workers/browserWorkers.ts:1) —
  the only module that constructs real `Worker`s (Vite `?worker`) and pairs each
  with its latest-only client. `App.svelte` is unchanged.

### (d) Correctness gate: byte-identical parity

- [`workerAnalysis.parity.test.ts`](../../src/application/__tests__/workerAnalysis.parity.test.ts:1)
  drives an in-memory port → real `DspWorkerCore` and asserts the worker-backed
  service returns **byte-identical** results to the main-thread path (unfiltered
  and filtered), plus `request-superseded` on a superseded run.
- [`probeAsset.parity.test.ts`](../../src/ml/onnx/__tests__/probeAsset.parity.test.ts:1)
  pins the browser literal to the Node-parsed metadata + committed byte
  length/SHA-256.
- The binder tests assert a `dsp-request` answered through the binder is
  bit-identical to a direct call.
- This parity — not any timing — is the gate that proves the relocation changed
  *where* the work runs, not *what* it computes.

### (e) Main-thread fallback is preserved

The main-thread path is not removed or degraded: `MAIN_THREAD_DSP_EXECUTOR`
remains the `RecordAnalysisService` default, and the jsdom presentation slice
([`App.test.ts`](../../src/presentation/__tests__/App.test.ts:38)) keeps using the
main-thread default service. Worker offload is opt-in at the composition root, so
Node tests and non-worker hosts behave exactly as before.

### (f) DOM / worker typing decision

`tsconfig.json` does **not** add the `webworker` lib (which conflicts with the
`DOM` lib used by the rest of the app). Instead each worker entry narrows the
global `self` to the local `WorkerPort` surface with **one documented cast**
(`self as unknown as WorkerPort`), keeping the shared code DOM-lib-typed and
conflict-free. This was the Phase-10 typing decision and is unchanged from the
approach validated for the Phase-6/7 core.

### (g) Browser-loadable model asset

- [`probeAsset.ts`](../../src/ml/onnx/probeAsset.ts:1) is the **browser-safe**
  counterpart of the Node-only
  [`probeModel.ts`](../../src/ml/testing/probeModel.ts:1) (fs/crypto): it imports
  the committed `.onnx` through Vite's `?url` transform and re-states the probe's
  `ModelMetadata` as a frozen literal. The Node accessor must never enter the web
  bundle, so application/worker/presentation code imports only `probeAsset.ts`.
- Two Vite config decisions support this and are documented here:
  - **`worker.format = 'es'`** (top-level option, not under `build`). The
    inference worker dynamically imports `onnxruntime-web`, which code-splits the
    worker bundle; the default `'iife'` worker format cannot be code-split, so ES
    modules are required (Vite then constructs `new Worker(url, { type: 'module'
    })`).
  - **Targeted `build.assetsInlineLimit`** keeps the 543-byte probe `.onnx` a
    real, separately-cacheable emitted asset rather than a base64 data URL, so
    the build output names the model artifact the parity test pins.

### (h) Resource release

Every factory returns a handle exposing `terminate()`: the client is disposed
(rejecting in-flight requests as `request-superseded`), the `onmessage` handler is
detached and the worker is terminated. [`main.ts`](../../src/main.ts:34) registers
a single `pagehide` listener releasing **both** the DSP-backed service and the
inference engine. The inference worker releases its ONNX session on
unregister/dispose. No worker or object URL leaks across a context change.

## Consequences

- CPU-bound whole-record DSP/DWT and full-record inference no longer block the
  main thread; the main thread stays responsive (validated manually —
  `npm run dev`, see the measurement doc), while the *science is unchanged*
  (byte-identical parity).
- The authoritative policy remains ADR-005; this ADR records *how* seam #3 was
  implemented (placement, parity gate, fallback, shared orchestration, typing,
  asset, release) and does **not** re-decide the worker strategy.
- The measured before/after pair
  ([`plans/phase-10-measurement.md`](../../plans/phase-10-measurement.md)) shows
  the offload machinery adds negligible CPU next to the relocated work; it is a
  machine snapshot and never a CI gate (ADR-010; rules §51).
- **What it does not prove:** off-thread placement is *not* a faster algorithm;
  it makes no model-quality or clinical claim (rules §47/§49; ADR-009). The
  browser entry glue is build/type/lint-verified and validated manually, not
  unit-tested (vitest only runs `*.test.ts`).
- Worker glue / WASM / WebGPU status: glue is now **implemented**; WASM DWT and
  WebGPU remain deferred on the ADR-010 numbers.

## References

- Architecture plan §I (browser execution architecture → worker table now wired),
  §M item 10 (Phase 10)
- [`plans/phase-10-plan.md`](../../plans/phase-10-plan.md) — approved scope and
  item-by-item gates
- [`plans/phase-10-measurement.md`](../../plans/phase-10-measurement.md) —
  worker-path before/after snapshot + manual `npm run dev` validation note
- ADR-005 (browser worker strategy — superset decision this implements), ADR-004
  (ONNX runtime contract), ADR-009 (seam-validation scope), ADR-010
  (measurement-first policy & worker/WASM/WebGPU status)
- Rules §30/§31 (no duplicated science; stale-result rejection), §47/§49
  (seam-validation), §51/§52 (no wall-clock gate; frame budget), §35 (worker
  determinism); AGENTS §15 (resource release)
