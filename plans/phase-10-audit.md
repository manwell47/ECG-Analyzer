# Phase 10 Audit / Completion — Worker Offload (ADR-005 seam #3)

Recorded 2026-09-13 (Code-mode completion record). Verdict: **Phase 10
implemented and fully green.** The full `npm run check` gate passes at the end of
every item and again as the final gate: typecheck ✓, svelte-check (0 errors /
0 warnings) ✓, lint ✓, **53 test files / 530 tests** ✓, Vite build ✓ (**149
modules**). **Relocation, not optimization:** no scientific algorithm was changed;
the correctness gate is **byte-identical parity** between the main-thread and
worker paths, and no committed test asserts a wall-clock duration (rules §51).
The worker offload (ADR-005 seam #3) is now real running browser glue.

## Scope / approved increment

> "Phase 10 — Worker offload (ADR-005 seam #3): real browser Worker glue so
> whole-record DSP/DWT + full-record inference leave the main thread. … Every item
> ends with a green `npm run check`. Relocation, not optimization — the
> correctness gate is byte-identical parity; inference stays seam-validation
> scope (§47/§49, ADR-009); no duplicated orchestration/science (§30); resource
> release per ADR-005."

## Files added

| Purpose | File |
|---|---|
| Transport-free worker port abstraction (mirrors `DedicatedWorkerGlobalScope`) | [`src/workers/port.ts`](../src/workers/port.ts:17) |
| Core ⇄ port binder (dispatch only) + Node tests | [`src/workers/bind.ts`](../src/workers/bind.ts:25), [`src/workers/__tests__/bind.test.ts`](../src/workers/__tests__/bind.test.ts:1) |
| Shared latest-only orchestrator (extracted from the inference client; public API unchanged) | [`src/workers/orchestrator.ts`](../src/workers/orchestrator.ts:41) |
| Latest-only DSP client + Node tests | [`src/workers/client.ts`](../src/workers/client.ts:153) (class), [`src/workers/__tests__/dspClient.test.ts`](../src/workers/__tests__/dspClient.test.ts:1) |
| Real worker entry files (browser-only; `self` cast) | [`src/workers/entries/dsp.worker.ts`](../src/workers/entries/dsp.worker.ts:1), [`src/workers/entries/inference.worker.ts`](../src/workers/entries/inference.worker.ts:1) |
| Vite `?worker` browser glue (factories + `terminate()`) | [`src/presentation/workers/browserWorkers.ts`](../src/presentation/workers/browserWorkers.ts:51) |
| DSP/DWT executor seam (main-thread + worker) | [`src/application/dspExecutor.ts`](../src/application/dspExecutor.ts:41) |
| Worker DSP parity gate (byte-identical, in-memory loopback) | [`src/application/__tests__/workerAnalysis.parity.test.ts`](../src/application/__tests__/workerAnalysis.parity.test.ts:1) |
| Browser-loadable probe asset (`?url` model + frozen metadata literals) | [`src/ml/onnx/probeAsset.ts`](../src/ml/onnx/probeAsset.ts:1) |
| Worker-backed inference engine (`InferenceEngine`) | [`src/ml/onnx/workerInferenceEngine.ts`](../src/ml/onnx/workerInferenceEngine.ts:35) |
| Probe-asset parity gate (literals + length + SHA-256) | [`src/ml/onnx/__tests__/probeAsset.parity.test.ts`](../src/ml/onnx/__tests__/probeAsset.parity.test.ts:1) |
| Worker-path bench (before/after) + measurement record | [`src/bench/worker.bench.ts`](../src/bench/worker.bench.ts:1), [`plans/phase-10-measurement.md`](phase-10-measurement.md:1) |
| ADR-011: worker execution model | [`plans/adr/ADR-011-worker-execution-model.md`](adr/ADR-011-worker-execution-model.md:1) |
| Phase 10 audit (this record) | [`plans/phase-10-audit.md`](phase-10-audit.md:1) |

**Touched:**

- [`src/workers/client.ts`](../src/workers/client.ts:47) — extracted the shared
  latest-only state machine into `orchestrator.ts`; the inference client's
  constructor/method surface is unchanged (its existing tests stay green
  unchanged — the proof the extraction is behaviour-preserving).
- [`src/workers/index.ts`](../src/workers/index.ts:1) — barrel exports the binder
  (`bindDspCore`/`bindInferenceCore`) and `LatestOnlyDspClient`.
- [`src/application/analysis.ts`](../src/application/analysis.ts:174) — extracted
  `assembleAnalysis` and added the `DspExecutor` seam;
  [`RecordAnalysisService`](../src/application/analysis.ts:218) defaults to the
  main-thread executor so existing behaviour/tests are untouched.
- [`src/application/defaults.ts`](../src/application/defaults.ts:70) — the service
  factory takes an optional `DspExecutor` (omitted ⇒ main thread).
- [`src/main.ts`](../src/main.ts:34) — composes the worker-backed service and the
  `WorkerInferenceEngine`; releases workers/object URLs on `pagehide`.
- [`vite.config.ts`](../vite.config.ts:1) — top-level `worker: { format: 'es' }`
  (the inference worker code-splits `onnxruntime-web`) + a targeted
  `assetsInlineLimit` keeping the probe `.onnx` a real emitted asset.
- [`plans/ecg-lab-architecture.md`](ecg-lab-architecture.md:255) — §I seam-#3
  implemented bullet, §M item 10, decision register +ADR-011.

**Not touched (by design):** [`src/presentation/App.svelte`](../src/presentation/App.svelte:1)
and [`src/presentation/__tests__/App.test.ts`](../src/presentation/__tests__/App.test.ts:38)
(the jsdom slice keeps the main-thread default), `runExperiment` + its tests, the
`tsconfig.json` libs, and every scientific algorithm under `src/dsp` / `src/ml`
(rules §30).

## Item-by-item mapping

0. **Pre-flight** — `npm run check` green (49 files / 506 tests); no code change.
1. **Transport-free port + binder** — `port.ts` + `bind.ts` (dispatch only) +
   `bind.test.ts` (bit-identical core answers, classified errors, kind isolation,
   detach); barrel exports; `npm run check` green (**50 files / 513 tests**).
2. **Shared latest-only core + DSP client** — extracted
   [`LatestOnlyOrchestrator`](../src/workers/orchestrator.ts:41), added
   `LatestOnlyDspClient`; the inference client tests stayed green *unchanged*;
   `dspClient.test.ts`; `npm run check` green (**51 files / 522 tests**).
3. **Worker entry files + Vite glue** — `entries/dsp.worker.ts` +
   `entries/inference.worker.ts` + `browserWorkers.ts`; `npm run check` green;
   build emits separate worker chunks (dsp 11.16 kB / inference 13.25 kB).
4. **Worker-backed DSP + parity gate** — `assembleAnalysis` extraction,
   `dspExecutor.ts` (`MainThreadDspExecutor` / `WorkerDspExecutor`), optional
   executor on `RecordAnalysisService`, `workerAnalysis.parity.test.ts`
   (byte-identical unfiltered/filtered + `request-superseded` race); `npm run
   check` green (**52 files / 526 tests**).
5. **Full-record inference off the main thread** — `probeAsset.ts` (`?url` +
   frozen literals), `WorkerInferenceEngine`, inference worker registers the probe
   from the asset URL, `main.ts` wiring, `probeAsset.parity.test.ts`; `npm run
   check` green (**53 files / 530 tests**; build emits the `.onnx` asset, the two
   worker chunks, the ORT bundle + wasm).
6. **Measurement honesty** — `worker.bench.ts` (main-thread vs Node-loopback,
   labelled "NOT a browser") + `phase-10-measurement.md` (before/after pair,
   "DSP durations unchanged — the win is main-thread availability", repeatability
   note, manual `npm run dev` note); `npm run check` green; local bench captured.
7. **ADR-011 + architecture update** — ADR-011 written; §I seam-#3 bullet, §M
   item 10, decision register +ADR-011; `npm run check` green.
8. **Audit + final gate (this record)** — final full `npm run check` green
   (**53 files / 530 tests**, 149 modules).

## Parity evidence (the correctness gate)

The offload's only correctness claim is that moving the DSP/DWT stage and
inference off the main thread changes **where** they run, not **what** they
compute. That is pinned, not asserted:

- [`workerAnalysis.parity.test.ts`](../src/application/__tests__/workerAnalysis.parity.test.ts:137)
  runs the same analysis through `MainThreadDspExecutor` and through a
  `WorkerDspExecutor` wired to a **real** `DspWorkerCore` over an in-memory
  loopback, and compares every produced double's **raw bytes** (signal channels +
  every DWT coefficient band), identity, provenance and `generatedAtIso`
  (fixed clock) — unfiltered and filtered. It also pins the latest-only race:
  a superseded run rejects as `request-superseded` (rules §31).
- [`bind.test.ts`](../src/workers/__tests__/bind.test.ts:1) asserts the binder
  answers with envelopes bit-identical to a direct core call, returns classified
  errors, isolates DSP vs inference envelopes, and detaches via the disposer.
- [`probeAsset.parity.test.ts`](../src/ml/onnx/__tests__/probeAsset.parity.test.ts:36)
  pins the browser-safe literals to the committed metadata, the emitted URL to the
  committed `.onnx`, and the artifact's byte length + SHA-256 (recomputed
  independently) so the browser bundle can never silently name a different model.
- The existing inference-client tests are green **unchanged** after the
  orchestrator extraction — the proof the refactor duplicated no orchestration
  (§30).

## Measured before/after (2026-09-13 snapshot — not a gate)

Full tables + method in [`plans/phase-10-measurement.md`](phase-10-measurement.md:1).
Before = main-thread `DspExecutor`; After = Node loopback over the real
`bindDspCore` ⇄ `LatestOnlyDspClient` (**not a browser** — a lower bound, no
structured clone or thread hop). Mean ms per scenario:

| Samples | Before (main) | After (loopback) |
|---|---|---|
| 3 600 | 0.6443 | 0.6494 |
| 36 000 | 6.3299 | 6.3808 |
| 360 000 | 63.8768 | 63.0559 |
| 650 000 | 106.83 | 107.86 |

A second capture (after a lint fix changed the file) put the loopback slightly
*slower* at every size (650 000: 116.66 ms, rme ±8.64%), i.e. run-to-run variance
dominates the handoff delta. Both captures are recorded in the measurement doc;
no single run is cherry-picked.

## Decisions recorded (ADR-011)

1. **Transport-free cores + thin shells** — `WorkerPort` + `bindDspCore` /
   `bindInferenceCore` contain dispatch only; all science stays single-sourced in
   `src/dsp` / `src/ml` (rules §30).
2. **One shared latest-only orchestrator** — `LatestOnlyInferenceClient` and
   `LatestOnlyDspClient` compose the same state machine; no duplicated
   orchestration; the inference client's public API is unchanged.
3. **Placement** — whole-record DSP/DWT behind the `DspExecutor` seam
   (main-thread **default**, worker-backed opt-in) and full-record inference
   behind `WorkerInferenceEngine`; a single composition root in `main.ts`.
4. **Correctness gate = byte-identical parity**, never a committed wall-clock
   assertion (rules §51).
5. **Main-thread fallback preserved** — omitting the executor keeps the
   historical inline path; the jsdom slice and `runExperiment` are untouched.
6. **DOM/worker typing** — no `webworker` lib; the worker entries cast `self` to
   the local `WorkerPort` once, documented, avoiding DOM-global conflicts.
7. **Browser-loadable model asset** — `probeAsset.ts` (`?url` + literals) with
   `worker.format='es'` and a targeted `.onnx` `assetsInlineLimit`; the browser
   bundle never imports the Node-only `ml/testing/probeModel.ts`.
8. **Resource release** — worker factories expose `terminate()`; the inference
   worker releases its ONNX session on unregister/dispose; `main.ts` releases on
   `pagehide`.

## What the offload proves and does not prove

**Proves** — the real worker glue runs end-to-end with byte-identical results:
whole-record DSP/DWT leaves the main thread behind the `DspExecutor` seam, and
full-record inference leaves it behind `WorkerInferenceEngine`, over one shared
latest-only orchestration. It proves the browser bundle builds with the two
worker chunks + the emitted `.onnx` asset, and that the browser-safe probe
literals cannot drift from the committed model.

**Does not prove** — a faster algorithm (**relocation, not optimization**: the
DSP durations are unchanged; the win is main-thread availability), any timing
claim (the bench is a machine-specific, non-browser snapshot and is never a CI
gate), or any clinical / model-quality property (inference stays seam-validation
scope — §47/§49, ADR-009). Browser responsiveness under real load is validated
**manually** via `npm run dev`, not by a test.

## Residual risk

- **The browser entry glue is not unit-tested** —
  [`entries/*.worker.ts`](../src/workers/entries/dsp.worker.ts:1) and
  [`browserWorkers.ts`](../src/presentation/workers/browserWorkers.ts:51) touch
  browser globals and are covered by typecheck + lint + build only; all
  transport-free logic they call is Node-tested. The response-time/UX benefit is
  validated by hand (`npm run dev`).
- **The bench is a lower bound** — the Node loopback omits the real structured
  clone + thread hop, so it understates the true handoff cost; it exists to show
  the work is *relocated*, not to rank the paths.

## Test counts

Final `npm run check`: **53 test files / 530 tests** (Phase-9 close: 49 / 506).
The four additions are all new worker/parity tests:
[`bind.test.ts`](../src/workers/__tests__/bind.test.ts:1) (+7),
[`dspClient.test.ts`](../src/workers/__tests__/dspClient.test.ts:1) (+9),
[`workerAnalysis.parity.test.ts`](../src/application/__tests__/workerAnalysis.parity.test.ts:1)
(+4), [`probeAsset.parity.test.ts`](../src/ml/onnx/__tests__/probeAsset.parity.test.ts:1)
(+4). No committed test asserts a wall-clock duration (rules §51); `npm run bench`
is local-only and outside `npm run check`.
