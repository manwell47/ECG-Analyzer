# ECG Signal Processing & AI Analysis Laboratory — Architecture Blueprint

Status: Architect proposal — pending review before implementation
Binding constraints: `AGENTS.md`, `.roo/rules-code/01-medical-engineering.md` (both read in full; treated as non-negotiable). This document does not restate them; it implements them.

---

## 0. Repository reality — audit result (read this first)

The task brief assumed the current workspace contained an existing "DWT + ONNX" application ("SIGIL DWT") to preserve and evolve. **That assumption is false for this workspace.** The audit established:

### 0.1 What is actually in `c:/APPs/ECG DWT Analyzer`
- `AGENTS.md` — project constitution (read fully).
- `.roo/rules-code/01-medical-engineering.md` — mandatory Code-mode rules (read fully).
- `docs/origin-brief.md` — the task brief itself.
- `.gitignore` — ignores `/data/raw/` and `/data/processed/`.
- `data/raw/mitdb/**` — a **gitignored local copy of the MIT-BIH Arrhythmia Database** (PhysioNet layout: `RECORDS`, `ANNOTATORS`, `SHA256SUMS.txt`, per-record `.hea/.dat/.atr`, plus stray `.at_/.at-/.xws` files and an `x_mitdb/` subfolder).
- `data/fixtures/`, `data/processed/` — **empty** directories.
- **Zero application source files** (no `package.json`, no `.ts/.tsx/.js/.jsx/.html/.css`, no tests, no build system, not a git repository).

A representative record header `data/raw/mitdb/100.hea` confirms standard WFDB format-212 (two channels MLII/V5, 360 Hz, 650 000 samples, gain 200 ADC-units/mV).

### 0.2 What "SIGIL DWT" actually is (found at `C:/APPs/steganography`)
- **Product:** SIGIL DWT — an **audio-steganography VST3/Standalone plugin** built with C++20 + JUCE. It injects image/typography watermarks into the 16–22 kHz band of audio.
- **DWT core** (`Source/WaveletProcessor.*`): a real-time, block-streaming, **single-level Daubechies-4** DWT/IDWT over `juce::AudioBuffer<float>`, with pre-allocated history state; implicit zero-padding at block boundaries. Db4 8-tap coefficients embedded in the constructor.
- **wavelib** (`wavelib/`, BSD-3, Rafat Hussain / Holger Nahrstaedt): a generic **C** wavelet library (DWT, MODWT, DWT2, WPT, CWT) supporting multiple families (`db`, `sym`, `coif`, biorthogonal, etc.), `per`/`sym` boundary extension, J-level decomposition, direct/FFT convolution. Ships its own tests.
- **ONNX** (`Source/OnnxWrapper.*`): native **ONNX Runtime C++ 1.17.1**, loads a model from embedded bytes, runs a **U2-Net 320×320 RGB image-saliency** model (NCHW, ImageNet mean/std), sigmoid on logits. **Preprocessing/model constants are hard-coded** in the wrapper (a pattern this blueprint explicitly rejects). Note: in the shipping path the ONNX output is computed but effectively bypassed in favor of a Sobel filter.
- **Concurrency pattern:** lock-free single-producer/single-consumer bridge between the audio thread and an inference worker thread + atomic mask flag — conceptually reusable as a *stale-result/cancellation* model.
- **Model artifact:** `Assets/model.onnx` is a U2-Net **image** model, unrelated to ECG classification. `Releases/SIGIL_DWT_v1.0_Windows.zip` is a packaged plugin.

### 0.3 Consequence for this blueprint
SIGIL DWT is a **different scientific domain (audio watermarking + image saliency), in a different runtime (native C++/JUCE/ORT-C++), and not ECG and not browser**. It cannot be copied or "extracted" into a TypeScript browser ECG lab without a rewrite that preserves no runtime code. The correct relationship is:

1. **wavelib (BSD-3)** becomes the **external scientific reference** for the browser DWT implementation — source of Db/Db4 filter coefficients, boundary-mode semantics (`per` vs `sym`), and golden test vectors. Its own `wavelib/test/*.txt` signals and test programs provide deterministic reference inputs.
2. **Db4 coefficients** in `WaveletProcessor.cpp` seed deterministic unit fixtures for the TypeScript DWT.
3. **wavelib compiled to WASM** is an *optional later-phase* numerical backend (Phase 8), not the initial architecture.
4. The **ONNX-wrapper lesson** is what transfers: never hard-code model preprocessing; externalize it into versioned `ModelMetadata`.
5. The **off-main-thread + generation-counter** concurrency model maps directly to the browser Worker architecture.

The existing SIGIL project is **not modified, not imported, and remains an independent desktop tool** under `C:/APPs/steganography`. The ECG Lab in this workspace is a **new codebase that reuses SIGIL as a scientific reference only**. This avoids the forbidden "old DWT + new DWT in parallel" trap precisely because the two targets are not parallel implementations of the same browser requirement — SIGIL is a reference vector generator, not a competing browser DWT.

---

## A. Executive assessment

**What exists:** a documented scientific constitution (AGENTS + rules), a complete local (gitignored) MIT-BIH copy, and empty `fixtures/`/`processed/` folders. No application code, no toolchain, no tests, no build.

**Is the foundation reusable?** The *governance and data* are reusable; there is no code foundation to preserve. This is effectively a **greenfield browser project operating under unusually strong engineering rules**, with one external scientific reference implementation (SIGIL/wavelib) available for validation. Because nothing needs to be migrated, the highest-value early work is establishing the **domain/DSP contracts and golden-test harness** before any UI exists.

**Readiness verdict:** building an "ECG lab" on this foundation is sound, provided the plan treats governance/data as assets, SIGIL/wavelib as reference-only, and does not pretend legacy code must be incrementally unwound.

---

## B. Current architecture

### B.1 Workspace (c:/APPs/ECG DWT Analyzer)
No runtime architecture exists. Actual data flow today: `data/raw/mitdb/*` (WFDB) → nothing. There is no module graph, no state management, no entry point, no CI, no tests.

### B.2 SIGIL project (reference, not part of this repo)
Actual module/data flow inside the plugin:

```
juce::AudioProcessor::processBlock
  → WaveletProcessor::processDWT  (Db4, 1 level, streaming, float32)
  → coefficient manipulation in 16–22 kHz subband
  → WaveletProcessor::processIDWT (reconstruction)
  → audio output
UI thread
  → SpectrogramComponent (Direct2D) fed by lock-free FIFO
Worker thread
  → OnnxWrapper (U2-Net 320×320 image saliency; output bypassed)
```

Scientific weaknesses observed that this blueprint will not reproduce: boundary handling is implicit (zero-padded state), only one wavelet, only one level, hard-coded model preprocessing, and a semi-bypassed ML path.

---

## C. SIGIL DWT assessment

For each relevant module:

| Module | Scientific responsibility | Input semantics | Output semantics | Reuse decision |
|---|---|---|---|---|
| `WaveletProcessor` (Db4 DWT/IDWT) | Single-level orthogonal Db4 decomposition/reconstruction | `float32` audio blocks, streaming | Half-rate approx/detail | **Reference coefficients only.** Not portable (JUCE/float/streaming/RT). Db4 taps seed TS fixtures. |
| `wavelib` (C) | Generic multi-family DWT/MODWT/CWT, per/sym extension, J levels | double arrays | Concatenated coefficient vector + per-level lengths | **External scientific reference** for TS implementation + golden vectors; later optional WASM backend. BSD-3 compatible. |
| `OnnxWrapper` | ORT session lifecycle, image→NCHW tensor→saliency | RGB image | sigmoid saliency map | **Pattern only.** Do not copy hard-coded 320×320/ImageNet constants. |
| `LockFreeBridge` | Cross-thread handoff | mask arrays | consumer copies | **Concept maps** to Worker + generation-counter stale rejection. |

**Preserve:** none of SIGIL's *code* is preserved inside the ECG repo (different runtime/domain). Preserve the *scientific constants and reference vectors* by capturing them into `data/fixtures/reference/` (Db4 coefficients; selected wavelib decomposition outputs regenerated deterministically and committed as small numeric fixtures, with provenance notes). This keeps every numerical claim checkable without a C toolchain in CI.

**Replace recommendation (with reason):** a browser DWT must be implemented in TypeScript because (a) it must run identically in main thread and Worker (AGENTS §30 forbids duplicated scientific logic across runtimes — a single TS module is the only way to guarantee this), (b) SIGIL's float32 streaming block DWT does not fit whole-record multilevel analysis semantics, and (c) WASM is premature until profiling justifies it. This is a *port with reference validation*, not a gratuitous rewrite: the algorithm family (orthogonal dyadic DWT, standard wavelet naming, per/sym extension) is preserved and cross-checked numerically against wavelib.

---

## D. Critical architectural / scientific problems

1. **No codebase exists** — every "preserve" assumption collapses to greenfield. (Highest-priority structural finding.)
2. **Scientific identity gap:** SIGIL is audio+image; target is ECG. Reusing its ONNX model, assets, or JUCE code would be a domain error.
3. **Sampling/units discipline is unimplemented.** MIT-BIH is 360 Hz ADC-counts→mV with format-212 packing; nothing yet converts or validates this. Any naive loader will produce silent unit/rate bugs.
4. **Boundary semantics for DWT must be chosen explicitly.** wavelib exposes `per`/`sym`; SIGIL used implicit zero-pad. Multilevel whole-record analysis needs an explicit, documented, tested extension mode; ECG use will also need a decision about whether level→frequency band mapping is ever presented (forbidden without scientific justification per rules).
5. **No leakage guardrails exist.** Once data ingestion and windowing exist, subject-level separation must be baked into the partition API, not left to callers.
6. **Model-contract discipline is absent and must be designed before any model is loaded.** A shape-compatible tensor is not scientifically compatible (rules §9, §16).
7. **Local data (`data/raw/mitdb`) is incomplete/inconsistent** (e.g., record `213` lacks `.dat/.atr`; stray `x_mitdb/`, `.at_`, `.at-`, `.xws` files). Anything reading the dataset must treat presence as untrusted and validate against `RECORDS`/headers.

---

## E. Target architecture

### E.1 Dependency direction (strict, enforced by module boundaries)

```
presentation (UI/views)        → application (orchestration) only
application (workflow/service) → domain contracts, dsp, ml
ml    (inference, metadata)    → domain contracts
dsp   (transforms)             → domain contracts  (never UI, never ML internals)
domain (entities/types)        → nothing
```

Enforced prohibitions:
- UI never imports `dsp/` internals or `ml/` tensor code.
- `dsp/` never imports `ml/` or any framework.
- `ml/` never imports `dsp/` algorithms; it only consumes prepared `ModelInput`.
- All cross-layer values cross as **domain types** (`Signal`, `WaveletDecomposition`, `ModelPrediction`, …), never anonymous arrays.

### E.2 Proposed monorepo layout (single package for now)

```
src/
  domain/          # pure types, units, invariants, no I/O
  dsp/             # filtering, resampling, normalization, dwt, idwt, segmentation, features
  ml/              # modelmetadata, modelinput, inference engine, predictions
  datasets/        # DatasetAdapter interface + wfdb/mitdb adapter + fixtures adapter
  workers/         # worker entry points (thin shells over shared dsp/ml modules)
  application/     # orchestration services, experiment runner, provenance capture
  presentation/    # components, canvas views, state-presentation adapters (never DSP math)
tests/
  unit/ integration/ regression/ ui/
docs/  (architecture, pipeline, datasets, models, testing)
data/
  raw/    (gitignored; local MIT-BIH)
  processed/ (gitignored)
  fixtures/  (committed: golden signals, reference vectors, metadata)
plans/        (this document + ADRs)
```

### E.3 Stage graph (the scientific pipeline is a first-class, inspectable object)

```
SignalRecord (raw, provenance)
 → Validate
 → Preprocess (filter/resample/normalize)      → PreprocessedSignal
 → DWT decompose (configurable)                 → WaveletDecomposition
 → Segment / window                             → Window[]
 → Feature/representation                        → FeatureVector
 → ModelInput construction (normalization)      → ModelInput
 → InferenceEngine.run                          → ModelPrediction
 → Postprocess / interpret                      → InterpretedPrediction
 → Visualize / record into ExperimentResult
```

Implemented as **composable pure stages** with an explicit `PipelineSpec` that records every configuration and each stage's input/output type. No monolithic `analyzeECG()`; each stage is independently unit-testable and independently inspectable (satisfies observability requirement: the UI can render any intermediate product).

---

## F. Domain model

Minimum entities (plain, strongly typed, immutable by convention; no framework deps):

- `Units` (`mV`, `ADC`, `normalized`) — every `Signal` carries amplitude units.
- `SamplingInfo` — `{ sampleRateHz: number; startTimeSec?: number; durationSec: number }`. Sample rate is **never** inferred from length.
- `SignalChannel` — `{ name: string; data: Float64Array | Float32Array; units: Units; metadata }`.
- `Signal` — channels + `SamplingInfo` + `Provenance` + `AcquisitionMetadata`.
- `SignalRecord` — dataset identity (`{ datasetId, recordId }`), source path, checksums, raw ADC buffer before scaling (so mV conversion is explicit and auditable).
- `Provenance` — source, loader version, timestamps, hash, transform history (append-only list of `{stage, config, version}`).
- `PreprocessingConfiguration` — typed: baseline-removal, filter spec, resampling spec, normalization spec; validation asserts sample-rate/unit consistency.
- `PreprocessedSignal` — `Signal` + `preprocessingConfig` + `appliedTo(original)` link.
- `Window` — `{ startSample, lengthSamples, channel?, sourceSegment }` with **explicit sample indices**, never seconds.
- `WaveletConfiguration` — `{ waveletFamily, name, decompositionLevel, extensionMode, lengthHandling }` (validated, versioned).
- `WaveletDecomposition` — per-channel `{ approximation, details[] : CoeffLevel[], level, inputLength }`; `CoeffLevel` carries `{ level, samples, approximateFreqBandHz? }` (band mapping only when computed from fs/level, flagged approximate).
- `FeatureVector` — `{ features: Map<string, FeatureValue>, featureConfigHash, sourceWindowIds }`.
- `ModelMetadata` — see H.1.
- `ModelInput` — `{ tensor, dtype, shape, modelId, modelVersion, provenance, preprocessingFingerprint }`.
- `ModelPrediction` — `{ modelId, version, rawOutput, interpreted }`.
- `InterpretedPrediction` — label/score with explicit semantics (`predictedProbability` vs `modelScore` vs `uncalibrated`), never fabricated confidence.
- Experiment/evaluation machinery is **not** part of the domain list:
  `PartitionSpec` + subject-aware partitioning live in `datasets/` (ADR-006),
  and `ExperimentConfiguration`, `ExperimentResult` (evaluation), metrics and
  the runner live in `application/` — see ADR-009 (supersedes the earlier
  "see L." grouping on this line).

Every transformation returns a new semantic type; the compiler prevents passing a `PreprocessedSignal` where a raw `Signal` is required unless the API explicitly permits it.

---

## G. DSP architecture

Pure functions, explicit configs, no mutation of inputs, deterministic, tolerance-tested.

- **Filtering:** `filterSignal(signal, FilterSpec)` where `FilterSpec` = `{ type, cutoffHz[], order, fs, phaseCharacteristic, purpose }`. No unexplained constants. Zero-phase filtering preferred for morphology-preserving inspection; any IIR phase effects documented. Rejection of invalid cutoffs relative to fs.
- **Resampling:** `resample(signal, targetRateHz, ResamplingSpec)`. Returns a **new `Signal` with updated `SamplingInfo`**; never mutates rate in place. Anti-aliasing must be explicit. Prefer a documented, tested implementation (sinc/polyphase with explicit kernel + anti-alias LPF, or a vetted small library after dependency review) — nearest-neighbor is banned for scientific signals.
- **Normalization:** `normalize(signal, NormalizationSpec)` where spec names the exact strategy (min-max / zscore / robust / per-channel / per-record) and any fitted parameters. Normalization statistics must be separable from the fit partition (leakage guard). `NormalizationFit` can be stored and re-applied to evaluation data.
- **Windowing / segmentation:** `segment(signal, WindowConfig)` with `{ windowLengthSamples, strideSamples, paddingMode, truncationPolicy, labelAssignment }`. Deterministic sample boundaries; nothing silently discarded.
- **DWT / IDWT:** a first-class subsystem — see below.
- **Features:** `extractFeatures(WaveletDecomposition | Window, FeatureConfig)` returning `FeatureVector`. Energy/entropy/statistical features per coefficient level are candidates, but no feature set is fixed now.
- **Validation helpers:** shared guards for empty/short/odd/NaN/Infinity/zero-variance/constant/invalid-fs/invalid-cutoff per rules §13.

### G.1 DWT subsystem contract

```
dwt(signal, WaveletConfiguration)  -> WaveletDecomposition
idwt(decomposition)                -> Signal (reconstructed)
```

- **Wavelet catalog:** implement in TS a deterministic set starting with orthogonal Daubechies (`db1..db?`) — coefficients sourced from wavelib and captured in fixtures. Family/name/level/extension are configuration, never literals in UI.
- **Extension mode:** explicit (`sym`/`per`/`zpd`), default chosen by ADR after validation; tested for reconstruction error.
- **Length handling:** non-power-of-two and odd lengths handled or rejected explicitly with documented behavior.
- **Validation:** reconstruction identity `idwt(dwt(x, cfg), cfg) ≈ x` within documented tolerance; coefficient lengths per level; deterministic output. These are the gate for any DWT change.
- **Level → band:** derived from fs and level only; exposed as *approximate*; no clinical-band claims without justification.

---

## H. ML / ONNX architecture

### H.1 ModelMetadata (externalized, versioned — the anti-SIGIL pattern)

```
{
  modelId, modelVersion,
  task,                  // e.g. "beat-classification"
  input: { shape, dtype, layout },
  expectedSamplingRateHz, expectedChannels, expectedWindowSamples,
  preprocessingAssumptions: [ { stage, config } ],  // the EXACT contract
  normalization: { strategy, fittedFrom },
  output: { rawSemantics, classLabels[], activation, logitsOrProbability },
  provenance: { trainingDataset, methodology, limitations },
}
```

Ships beside each `.onnx` as a strict schema (`.json`, validated at load). The UI never learns tensor shapes.

### H.2 Inference boundary

```
Signal → preprocess(per ModelMetadata) → segment → ModelInput
       → InferenceEngine.run(modelId, version, ModelInput) → ModelPrediction
```

- `InferenceEngine` validates **before** execution: modelId+version match, dtype, shape, sample rate, channel count, window length, normalization fingerprint. Shape compatibility alone is never treated as scientific compatibility; incompatible data **fails loudly** (never silently adapted).
- ONNX Runtime Web is an **inference backend behind the engine interface**. Raw output semantics (names, logits vs probabilities, class ordering) live in `ModelMetadata` and postprocessors — never in UI.
- No training logic anywhere in the runtime. Model artifacts are versioned and replaceable only by bumping id/version/metadata (rules §46).
- No fabricated predictions, no hard-coded metrics.

---

## I. Browser execution architecture

Decisions driven by workload, not fashion (per rules §52, §50):

| Workload | Where | Why |
|---|---|---|
| UI/state transforms, small derived values | Main thread | Latency-sensitive, tiny |
| WFDB parse (format 212), mV scaling | Worker (or main for small files, offload by size) | Blocking I/O/numeric |
| Filtering long records, resampling, normalization | Worker | CPU-bound; keeps UI responsive |
| DWT of long signals | Worker | CPU-bound; rules §30 |
| Segmentation / feature extraction | Worker | CPU-bound |
| Model inference | ONNX Runtime Web **inside a Worker** (WASM/CPU default; WebGPU opt-in later) | Rules §30; avoids blocking |
| Visualization decimation/rendering | Main thread (canvas) | Display; never mutates data |

- **Single shared scientific implementation** in `src/dsp` + `src/ml` runs in main *and* Worker (rules §30 forbids duplicated logic). Workers are thin shells that postMessage domain payloads (TypedArrays as transferables).
- **Messaging contract:** every worker request carries `requestId` + `signalId`; every response echoes `requestId`/`signalId`. An orchestration service keeps the latest issued identity and **rejects any completion whose identity is stale** (kills the "ECG A overwrites ECG B" race). Optional `AbortController`-style cooperative cancellation checked at stage boundaries.
- **WASM:** deferred until a benchmark baseline shows the TS path is the bottleneck. Candidate: wavelib compiled to WASM (validate parity first). Phase 9 now records a TS db4 baseline (143 ms decompose / 296 ms round-trip at 650 000 samples); DWT is not singled out as the TS bottleneck next to filter/resample, so the deferral stands — ADR-010.
- **WebGPU:** deferred until measurement + browser-support decision; only for batch inference where it demonstrably wins. Phase 9 records the CPU-WASM comparison point (≈0.12 ms/window, 121 ms/1000 windows); no GPU path measured, so WebGPU stays deferred — ADR-010.
- **Measured baseline (2026-09-04):** the worker table is now backed by a committed snapshot and policy — see ADR-010, [`plans/phase-9-baseline.md`](phase-9-baseline.md) (numbers) and [`plans/phase-9-bench-policy.md`](phase-9-bench-policy.md) (protocol). No §I deferral wording changed; the numbers re-confirm the existing placement.
- **Real worker glue — implemented (Phase 10, ADR-011).** ADR-005's "worker shells + identity rejection" is now realized as running browser glue: whole-record DSP/DWT behind the `DspExecutor` seam (main-thread default / `WorkerDspExecutor`) and full-record inference behind `WorkerInferenceEngine`, over the shared transport-free latest-only clients (`bindDspCore`/`bindInferenceCore` + a single `LatestOnlyOrchestrator`). The correctness gate is **byte-identical parity** between the main-thread and worker paths, never a wall-clock assertion (rules §51); the win is main-thread availability, not a faster algorithm. Measured before/after: [`plans/phase-10-measurement.md`](phase-10-measurement.md).
- **Display navigation is main-thread and display-only — implemented (Phase 13, ADR-014).** The time-series view's cursor readout and its zoom/pan/reset run on the main thread and are display-only: every step is a handful of pure arithmetic operations in [`navigationGeometry.ts`](../src/presentation/views/timeSeries/navigationGeometry.ts:1) (which delegates each time<->sample conversion to the domain, ADR-001), and a committed window **re-windows the one full-record `AnalysisResult`** rather than asking for a new one. The service, the DWT and every sample buffer are untouched — zoom is never a re-analysis (ADR-008). jsdom cannot measure layout, so the guarded pointer handlers are only proved *inert* while the drag geometry is the pure Node gate.
- **The cursor may name the record's own nearest annotation — implemented (Phase 14, ADR-015).** The time-series cursor readout appends the symbol of the nearest annotation already present in `result.sourceRecord.annotations`, resolved by the pure `nearestAnnotationAtFraction` helper in [`annotationGeometry.ts`](../src/presentation/views/timeSeries/annotationGeometry.ts:1) under the same half-open window rule as the drawn overlay and a **display-fraction** tolerance (`CURSOR_ANNOTATION_TOLERANCE_FRACTION`), then folded into the label by the pure `formatCursorReadout` in [`navigationGeometry.ts`](../src/presentation/views/timeSeries/navigationGeometry.ts:1). It is the display of a domain fact — never a detection and never a clinical claim (ADR-013) — and the returned sample index is a readout, not a data access. No service call, no science change, no new prop; `App.svelte` already forwards the annotations.
- **Annotation detail, a symbol filter and a click-to-pin are displayed — implemented (Phase 15, ADR-016).** The time-series view shows the record's own `symbol`/`auxNote` for the annotation nearest the pointer (a detail line), can narrow the drawn overlay and its summary/legend to a single symbol through a view-local `<select>`, and pins a clicked annotation's detail so it survives `pointerleave` — all resolved by the pure `nearestAnnotationEventAtFraction`/`filterAnnotationsBySymbol`/`resolveSymbolFilter`/`formatAnnotationDetail` helpers in [`annotationGeometry.ts`](../src/presentation/views/timeSeries/annotationGeometry.ts:1) over the same half-open window rule as the Phase-12 overlay and the Phase-14 readout (the Phase-14 `nearestAnnotationAtFraction` is now a projection over the event resolver, so there is exactly one selection spine). It is the display of a domain fact — never a detection and never a clinical claim (ADR-013) — and a filter hides markers, it never claims: the service is never re-invoked and the science output is unchanged (ADR-008), with the filter options derived from the **unfiltered** window so a removed filter falls back to "All". The pin holds the record's own event via `$state.raw` (a deep-reactive `$state` would proxy the record's object and silently break the identity test against the drawn list), and the click's display-fraction move tolerance replaces the Phase-13 implicit zero-width click-zoom while the drag geometry is unchanged. No new prop, no science/application change; `App.svelte` already forwards the annotations.
- **The worker channel's inbound contract is the platform's — corrected (Phase 18 Part A, ADR-019).** A real `DedicatedWorkerGlobalScope` invokes its `onmessage` handler with a **`MessageEvent`** carrying the envelope on `data`; [`WorkerPort`](../src/workers/port.ts:25) now declares exactly that (`(event: { readonly data: unknown }) => void`), the two binders in [`bind.ts`](../src/workers/bind.ts:34) unwrap `event.data` once and apply the **existing** guards unchanged, and every in-memory loopback delivers the platform's shape — so a fake imitates the platform instead of redefining it. The former payload-shaped declaration was `DEFECT-001`: every guard read `undefined`, every request was silently discarded, and the app hung on `Analyzing default record…` with **61 files / 750 tests** green, because no gate had ever delivered a platform-shaped message. A `tsc`-visible contract case in [`bind.test.ts`](../src/workers/__tests__/bind.test.ts:254) now fails the build if the handler is ever re-declared with a payload parameter (proved by deliberate revert: exit 2 with `TS2578` + two `TS2322`); the worker entries keep their single documented `self` cast (ADR-011's no-`webworker`-lib rule, unchanged), `transfer` stays deliberately unused (detaching the core's `Float64Array` buffers would empty a result), and [`browserWorkers.ts`](../src/presentation/workers/browserWorkers.ts:51)/[`main.ts`](../src/main.ts:80) remain browser-only — settled by the manual pass, never declared confirmed (ADR-017).
- **A model's own output is displayed through an application service, never by a view reaching an engine — implemented (Phase 18 Part B, ADR-021).** [`src/application/inference.ts`](../src/application/inference.ts:1) is the only path from a view to an [`InferenceEngine`](../src/ml/engine.ts:23): a `ModelOutputService` holds the injected engine plus the one `ModelMetadata` it may run and disposes neither (the `runExperiment.ts` rule), realises exactly one half-open sample window through the domain's single time→sample mapping ([`sampleWindowOfTime`](../src/domain/sampling.ts:170), ADR-001 — the same function the time-series view uses, **relocated** into `src/domain/sampling.ts` and re-exported by `views/timeSeries/geometry.ts` so `application/**` never imports `presentation/**`), and **refuses rather than reshapes**: a declared rate/channel/window/dtype mismatch is `model-compatibility-failure`, a window covering no samples `invalid-input`, a non-classified engine throw `inference-failure`. The frozen, display-ready description names the model's own identity, its declared input/output contract and provenance, the exact `[startSample, endSample)` window at the record's own sample rate, and the channel **actually** scored (first-channel fallback included); every per-label `semantics` comes from the declared metadata alone (`interpretPrediction`: declared probabilities, or logits under softmax/sigmoid, ⇒ `predicted-probability`; logits under no activation, or `model-scores`, ⇒ `model-score`) — never the word "confidence" (rules §47/§49, ADR-004). The display-only panel under `src/presentation/views/inference/` renders that description and nothing else — no window arithmetic, no score conversion, no label text of its own — and shows a refusal in a `role="alert"`, which is also the honest **boot state**, since the committed probe declares 360 samples/1 channel/360 Hz while the default record is 3600 samples. `App.svelte` takes one **optional** prop ([`main.ts`](../src/main.ts:74) injecting the existing worker-backed engine with the browser-safe frozen probe metadata), so absent it the markup and the pinned jsdom bootstrap slice are unchanged; scoring is a user-initiated action, so no analysis, navigation or record switch re-runs the model. Gates: 17 Node tests over the service and 7 jsdom tests over the view, asserting declaration, refusal, in-flight state and wiring only — never a pixel or a wall clock.
- **Memory:** buffers stay `Float64Array`/`Float32Array` end-to-end where possible; transferables avoid copies; ONNX tensor lifecycle owned by the engine; workers terminated/released on context change; no `Array→TypedArray→Array` churn without reason.

---

## J. Dataset architecture

- **Adapter boundary:** `DatasetAdapter` interface → canonical `SignalRecord`/`Signal`. The whole app depends on the canonical model only.
  ```
  DatasetAdapter (WFDB/MIT-BIH) --→ canonical SignalRecord (channels, rate, units, annotations)
  DatasetAdapter (fixtures/synthetic) --→ same canonical type
  ```
- **MIT-BIH adapter:** parses `.hea` (header: format, fs, gains/baseline/units per channel, ADC resolution), `.dat` (format 212 two-channel packed; also support 16-bit signed where encountered), `.atr` annotations (beat/rhythm codes as **annotation events**, not ground-truth fused into DSP). Validates record presence against `RECORDS`; rejects missing/inconsistent files (`213` case, stray files) with classified errors.
- **Units discipline:** raw ADC counts → mV via per-channel gain/baseline is an explicit, logged, tested conversion inside the adapter. Nothing downstream assumes ADC units.
- **Datasets are never committed:** `data/raw/` and `data/processed/` remain gitignored. The repo instead documents provenance (PhysioNet mitdb, license, download steps) and stores small **derived fixtures** (`data/fixtures/`) with licensing-appropriate excerpts/synthetic signals.
- **Browser-local ingestion — realized (Phase 11, ADR-012).** The `DatasetFileSource` seam gains its browser implementation [`WebFileSource`](../src/datasets/fileSource.ts:56) over the Web `File`/`Blob` API, fed by `<input type=file multiple>` / drag-and-drop (the portable, jsdom-testable floor) or a File System Access directory handle (Chromium-only progressive enhancement). Record ids are discovered from the `.hea` headers actually present ([`discoverMitBihRecordIds`](../src/datasets/mitbih/catalog.ts:113)) so a picked folder need not carry `RECORDS`; the strict `RECORDS` path (`listMitBihRecordIds`) is unchanged as the CLI/validation default. Parsers, adapter, DSP and ML are untouched — one source implementation sits behind both selections, and the gate is a byte-identical `SignalRecord` across `InMemoryFileSource` / `NodeFileSource` / `WebFileSource`. Local-first restated: no backend, no upload, no persistence.
- **Annotations are displayed, never fused — realized (Phase 12, ADR-013).** A record's canonical `AnnotationEvent`s (already carried by [`SignalRecord`](../src/domain/record.ts:85) and preserved on [`AnalysisResult.sourceRecord`](../src/application/analysis.ts:87)) now reach the time-series view: `App.svelte` forwards `result.sourceRecord.annotations`, and the pure [`annotationMarkers`](../src/presentation/views/timeSeries/annotationGeometry.ts:105) helper maps them onto the visible viewport with a one-marker-per-pixel-column density cap, so a long beat series stays readable (the caption states `none` / `n in view` / `(m merged)` plus a symbol legend). Display only: the science never consumes annotations, the source arrays are never mutated, and the markers are the *file's* annotations — never a detection. Presentation-only phase: no parser/adapter/DSP/ML/application change.
- **EDF/EDF+ — a second adapter realized (Phase 18 Part B, ADR-020).** `src/datasets/edf/` implements the **same** [`DatasetAdapter`](../src/datasets/types.ts:28) over the **same** [`DatasetFileSource`](../src/datasets/source.ts:20) seam as the WFDB adapter, so the boundary [ADR-006](adr/ADR-006-dataset-abstraction.md:16) asserted is now demonstrated by a second real format: a pure [`parseEdfHeader`](../src/datasets/edf/header.ts:207) reads the 256-byte fixed header plus one field-major 256-byte block per signal, so `gain` (digital span / physical span) and `baseline` (`digitalMin − physicalMin × gain`) **follow by arithmetic on declared numbers** rather than assumption, and [`EdfDatasetAdapter`](../src/datasets/edf/adapter.ts:85) yields canonical **raw-ADC** `Int16Array` channels — the ADC→mV conversion stays solely in [`recordToMillivoltSignal`](../src/datasets/load.ts:35). The canonical model is **narrower than EDF**, and every gap is a **classified refusal** rather than an invention: a declared dimension other than mV, per-signal rates that disagree, and `EDF+D` raise `unsupported-format`; blank/non-numeric fields, a signal count `<= 0`, a header byte count disagreeing with `256 × (signals + 1)`, a non-positive samples-per-record, duration or physical/digital span, a `-1` record count that does not divide the data section, and a declared count the bytes contradict raise `malformed-header` — each **naming the offending field** so a real file's rejection is actionable. An `EDF Annotations` signal is **excluded** from the channels with the exclusion stated in the record's `comments` and `annotations` left empty (EDF+ TAL parsing is a later increment, never a silent half-read), and out-of-range digits are read **as declared** with their count recorded as a provenance transform. Reachability is Part B's other half: the pure, **extension-keyed** [`detectDatasetFormat`](../src/datasets/dispatch.ts:59) (`.hea` ⇒ MIT-BIH, `.edf` ⇒ EDF, case-insensitive; a mixed or unrecognised selection refused classified — never content-sniffed) sits behind both `prepareBrowserDataset` and the file-ingestion funnel, with `createBrowserDatasetService` taking a **required** format so no caller can analyse EDF bytes as WFDB, while the WFDB path — `discoverMitBihRecordIds` and the pinned jsdom cases included — stays **byte-identical**. The gate is a Node suite over hermetic `InMemoryFileSource` fixtures whose builder restates the EDF field layout **independently of the parser**, with the mV rule asserted as an **exact per-sample** identity against the record's own `calibration`; EDF+ TAL annotations and `EDF+D` gaps remain documented gaps.
- **Future datasets** (e.g., a new ECG DB or synthetic generator) add an adapter; DSP/UI/ML layers are untouched.

---

## K. Testing architecture

- **Unit:** pure scientific functions (filter attenuation, resample output length/rate, normalization fit/apply, DWT coefficient sizes, IDWT reconstruction, window boundaries, feature determinism).
- **Integration:** `Signal → DSP → DWT → features → ModelInput → InferenceEngine` over a tiny committed ONNX test model and/or a deterministic stub engine isolated in `tests/` (never in production paths — rules §27).
- **Regression / golden:** `data/fixtures/reference/` holds deterministic signals (`impulse`, `sine`, `multi-frequency`, `constant`, `chirp`, `noise`, `synthetic ECG-like`) with recorded mathematical properties. DWT/IDWT results cross-validated against **wavelib reference outputs** (generated once, committed as numeric fixtures with provenance). Tolerance-based comparisons (rules §15); snapshot/screenshot tests are never the correctness gate.
- **UI tests:** only interaction behavior; they never substitute for numerical assertions.
- **Worker tests:** run the shared modules directly (same code path) plus a thin integration test of the messaging/identity contract (stale-result rejection).
- **Runner:** Vitest (Node for deterministic science; browser/jsdom for worker/UI slices). `npm run check` = typecheck + lint + unit + integration + build (rules §56).
- **Opt-in real-data verification:** the display-only presentation stack is re-measured against a real MIT-BIH record's own annotations and mV signal in **opt-in** gates that **skip** when the gitignored `data/raw/mitdb` is absent — a pure Node invariant gate over the display helpers plus a jsdom wiring slice over `TimeSeriesView`, sharing one test-only probe/loader (`firstCompleteRecordId`/`loadRealRecord`) so "which record" has exactly one definition. The default suite never depends on the dataset and a skipped gate proves nothing; the real-browser pass is a recorded **manual** observation, never a gate and never a wall-clock/pixel assertion (ADR-017, rules §51).
- **Annotation selection is displayed, never claimed:** the time-series annotation overlay is narrowed by a **set** of symbols whose **empty value is "All symbols"**, driven by a clickable legend (`aria-pressed` toggles offering the **unfiltered** window's symbols, so a pressed set can never hide its own off-switch) and mirrored by a **bounded**, scrollable list of the window's own events (cap `ANNOTATION_LIST_LIMIT`, deterministic `sampleIndex`-then-`symbol` order). The helpers — the set filter/resolver, the bounded list and the caption/detail formatters — are the pure **Node** gate; the **jsdom** gate proves only the toggle -> DOM and row -> pin wiring over a stubbed `getBoundingClientRect`. A selection **hides** markers and a cap **bounds** rendered rows; neither re-invokes the service, writes a sample buffer or implies a detection (ADR-008, ADR-013, ADR-018, rules §47/§49), and canvas pixels and wall-clock timings are never asserted (rules §51).

---

## L. Reproducibility architecture

- `ExperimentConfiguration` captures everything needed to re-run:
  dataset, record(s), channels, sample rate, preprocessing config, DWT config, segmentation, feature config, model id+version, thresholds (never in UI), evaluation config.
- `ExperimentResult` records config **and** software version + commit + full provenance chain of every signal consumed (transform history). No undocumented implicit state.
- **Partitioning API** (`PartitionSpec`) is **subject-aware from day one**: MIT-BIH records `100..` and `200..` belong to distinct subjects; the API separates by subject, and random sample/window-level splits are not exposed as a default for evaluation. Leakage guard is structural, not advisory.
- Training (offline, external pipeline) is out of scope for the runtime; the lab may *consume* pre-trained versioned artifacts and can *evaluate* them subject-level, but never trains in the browser.

---

## M. Migration plan (greenfield-adjusted phases)

Because there is no legacy app, the brief's Phase 1 ("preserve current functionality") is replaced by "establish contracts and toolchain". Each phase ends with green check (typecheck+lint+unit+build) and committed golden fixtures.

1. **Phase 1 — Toolchain + domain contracts.** `package.json` (TS strict, Vite, Vitest, lint), folder skeleton, `domain/` types + invariants, units/sample-rate guard utilities, classified error taxonomy, ADR-001..007 decision register, CI script.
2. **Phase 2 — Golden fixtures + reference capture.** `data/fixtures/` synthetic signals with recorded properties; Db4 coefficients; wavelib reference vectors (DWT outputs) captured with provenance. First regression tests proving the harness itself.
3. **Phase 3 — DSP core.** Filtering, normalization, resampling, windowing as pure functions + tests. No UI yet.
4. **Phase 4 — DWT/IDWT (TS).** Implementation validated against Phase-2 wavelib references; reconstruction-identity tests; extension-mode ADR outcome enforced; wavelet catalog seeded (db family).
5. **Phase 5 — Dataset ingestion.** `DatasetAdapter` + WFDB/MIT-BIH adapter (header/dat/atr), mV conversion, validation; fixture generator adapter; subject-aware `PartitionSpec`.
6. **Phase 6 — ML/ONNX contracts.** `ModelMetadata` schema + validator; `ModelInput` construction; `InferenceEngine` interface + ORT-web WASM backend in Worker; tiny committed test model + deterministic stub; stale-result/identity orchestration layer.
7. **Phase 7 — Scientific visualization.** Canvas time-series + DWT coefficient views driven by domain types; time axis = sampleIndex/fs; never mutates data. UI remains thin.
8. **Phase 8 — Experiment/evaluation.** `ExperimentConfiguration`/`Result`, per-record evaluation, subject-level splits, provenance export (machinery placed in `application/` + `datasets/` per ADR-009; probe-driven runs are seam-validation, not clinical).
9. **Phase 9 — Optimization (measurement-driven).** Benchmark harness; worker/WASM/WebGPU decisions only from baselines. **Completed 2026-09-04:** deterministic vitest-bench harness (`src/bench/`) + committed policy/baseline snapshot + ADR-010; worker/WASM/WebGPU deferrals re-confirmed by the numbers (no production-code optimization this phase).
10. **Phase 10 — Worker offload (ADR-005 seam #3).** Real browser Worker glue so whole-record DSP/DWT and full-record inference leave the main thread; transport-free cores + thin shells over the shared latest-only orchestrator; correctness gate is byte-identical parity and the public APIs are unchanged. **Completed 2026-09-13:** relocation, not optimization — no scientific algorithm changed and the measured DSP durations are unchanged (the win is main-thread availability); ADR-011; measurement in [`plans/phase-10-measurement.md`](phase-10-measurement.md).
11. **Phase 11 — Browser-local real-signal ingestion (WFDB).** The browser can read real WFDB/MIT-BIH files the user picks locally: a single browser `DatasetFileSource` (`WebFileSource` over `File`/`Blob`) fed by a portable `<input type=file multiple>` / drag-drop floor with the File System Access directory picker layered on as a Chromium-only enhancement; `RECORDS`-less record discovery from `.hea` headers in the browser while the strict CLI/validation path stays unchanged. **Ingestion only** — no parser/adapter/DSP/DWT/ML change; the gate is a byte-identical `SignalRecord` across `InMemoryFileSource` / `NodeFileSource` / `WebFileSource` plus an opt-in real-data test that skips when `data/raw/mitdb` is absent; local-first (no backend/upload/persistence). **Completed 2026-09-13:** ADR-012; scope and items in [`plans/phase-11-plan.md`](phase-11-plan.md).

12. **Phase 12 — Annotation rendering + proven multi-record selection (presentation only).** The time-series view overlays the analyzed record's own annotation events as display-only markers, density-capped to one per pixel column by the pure `annotationMarkers` helper, with an honest caption (`none` / `n in view` / `(m merged)` + symbol legend); `App.svelte` forwards `result.sourceRecord.annotations` and the application layer is untouched. The Phase-11 Record selector is *proved* by a two-record jsdom fixture that switches records and pins the identity/analysis-id change plus the first-channel/full-window display reset. **Completed 2026-09-13:** ADR-013; scope and items in [`plans/phase-12-plan.md`](phase-12-plan.md).

13. **Phase 13 — Interactive signal navigation (presentation only).** The time-series view gains a pointer cursor readout (`Cursor: {t} s · sample {i}`, derived by the pure `readoutAtFraction`) and zoom/pan/reset — five keyboard-accessible buttons plus guarded pointer drags — all computed by the pure [`navigationGeometry.ts`](../src/presentation/views/timeSeries/navigationGeometry.ts:1) helper. `App` stores a committed window as a display-only "Custom (zoomed)" option appended after the presets and draws that one window in **both** canvas views; navigation never re-invokes `service.analyze` and never writes a sample buffer (ADR-008). `ViewControls`/`presets.ts` are unmodified; no parser/adapter/DSP/DWT/ML/worker/application change. **Completed 2026-09-13:** ADR-014; scope and items in [`plans/phase-13-plan.md`](phase-13-plan.md).

14. **Phase 14 — Cursor annotation readout (presentation only).** The time-series cursor readout gains the symbol of the record's own nearest annotation when the pointer sits within a display-fraction tolerance of it (`Cursor: {t} s · sample {i} · nearest {symbol}`), computed by the pure [`nearestAnnotationAtFraction()`](../src/presentation/views/timeSeries/annotationGeometry.ts:244) in `annotationGeometry.ts` under the same half-open window rule as the Phase-12 overlay, and formatted by the pure [`formatCursorReadout()`](../src/presentation/views/timeSeries/navigationGeometry.ts:302) in `navigationGeometry.ts`. It is the display of a domain fact, never a detection (ADR-013) — the symbol is read verbatim from the record and the tolerance is a presentation guard, not a measurement threshold; the overlay, its `Symbols:` legend and the `App`/service path are unchanged. **Completed 2026-09-13:** ADR-015; scope and items in [`plans/phase-14-plan.md`](phase-14-plan.md).

15. **Phase 15 — Annotation interaction: hover detail, an optional symbol filter and a bounded click-to-pin (presentation only).** The time-series view shows the record's own `symbol`/`auxNote` for the annotation under the pointer, resolved by the pure [`nearestAnnotationEventAtFraction()`](../src/presentation/views/timeSeries/annotationGeometry.ts:300) in `annotationGeometry.ts` (which returns the record's own event under the same half-open window rule as the Phase-12 overlay and a display-fraction tolerance, with the Phase-14 [`nearestAnnotationAtFraction()`](../src/presentation/views/timeSeries/annotationGeometry.ts:348) kept as a projection over it), and renders the line with the pure [`formatAnnotationDetail()`](../src/presentation/views/timeSeries/annotationGeometry.ts:390). It adds a view-local `<select aria-label="Symbol filter">` fed by the pure `filterAnnotationsBySymbol`/`resolveSymbolFilter`, and a bounded click pins the nearest annotation's detail rather than committing the Phase-13 zero-width zoom (the drag geometry is unchanged). It is the display of a domain fact, never a detection (ADR-013): a filter hides markers and never re-invokes the service, and the detail/filter/overlay are all resolved from the same filtered list so the caption can never describe a marker that is not drawn. No new prop; `App.svelte`, the overlay, the `Symbols:` legend and the `App`/service path are unchanged. **Completed 2026-09-13:** ADR-016; scope and items in [`plans/phase-15-plan.md`](phase-15-plan.md).

16. **Phase 16 — Real-browser + real-data hardening: opt-in real-record verification of the display invariants (tests + docs only).** The display-only presentation stack (overlay/legend, symbol filter, detail line, cursor readout, navigation/envelope geometry) is re-measured against a genuine MIT-BIH record's own annotations and mV signal — closing the real-data gap the Phase 12–15 fixtures left open — while the residual real-browser risks are recorded as a **manual** `npm run dev` observation. Two **opt-in** gates **skip** when the gitignored `data/raw/mitdb` is absent (the default suite never depends on the dataset): a pure Node invariant gate over the display helpers ([`realDataDisplay.integration.test.ts`](../src/presentation/views/timeSeries/__tests__/realDataDisplay.integration.test.ts:1)) and a jsdom wiring slice over [`TimeSeriesView`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:1) ([`realDataInteraction.integration.test.ts`](../src/presentation/views/timeSeries/__tests__/realDataInteraction.integration.test.ts:1)), both sharing one test-only probe/loader ([`realRecordSupport.ts`](../src/datasets/__tests__/realRecordSupport.ts:1)) so "which record" has exactly one definition. Every assertion is a **display invariant over the record's own facts** — never a detection, never a clinical claim (ADR-013) — and the manual record is an observation, never a gate and never a wall-clock/pixel assertion (rules §51). No production, helper, config or `package.json` change; the default suite and the browser bundle are unchanged. **Completed 2026-09-13:** ADR-017; scope and items in [`plans/phase-16-plan.md`](phase-16-plan.md).

17. **Phase 17 — Annotation set filtering, a clickable legend and a bounded annotation list (presentation only).** The time-series view narrows the record's own annotation overlay to a **set** of symbols — the **empty set meaning "All symbols"** — through the pure [`filterAnnotationsBySymbols()`](../src/presentation/views/timeSeries/annotationGeometry.ts:258) and [`resolveSymbolFilters()`](../src/presentation/views/timeSeries/annotationGeometry.ts:302), with the Phase-15 single-symbol [`filterAnnotationsBySymbol()`](../src/presentation/views/timeSeries/annotationGeometry.ts:280) / [`resolveSymbolFilter()`](../src/presentation/views/timeSeries/annotationGeometry.ts:319) kept as **projections** over them so exactly one filter rule holds. The inert `Symbols:` legend **becomes the control** — one `aria-pressed` toggle per **unfiltered**-window symbol, superseding the Phase-15 single-select `<select>` — and the window's own events are listed in a **bounded**, scrollable panel built by the pure [`annotationList()`](../src/presentation/views/timeSeries/annotationGeometry.ts:496) (cap [`ANNOTATION_LIST_LIMIT`](../src/presentation/views/timeSeries/annotationGeometry.ts:450), caption [`formatAnnotationListCaption()`](../src/presentation/views/timeSeries/annotationGeometry.ts:534)), whose rows pin the clicked event through the **same** `$state.raw` `pinnedEvent` the canvas click sets, preserving event identity. It is the display of a domain fact, never a detection (ADR-013): a selection hides markers, the cap bounds rendered rows, and neither re-invokes the service nor writes a sample buffer (ADR-008). No new prop, no science/application change, no `package.json`/config change; the gate is the pure Node helpers plus a jsdom wiring slice, and the ADR-017 opt-in real-data slice is re-pointed to read the caption by class. **Completed 2026-09-14:** ADR-018; scope and items in [`plans/phase-17-plan.md`](phase-17-plan.md).

18. **Phase 18 — Worker-channel correctness, then two folded-in increments.** The real-browser manual pass finally run in Phase 17 surfaced a **blocking** defect and did not patch it (ADR-017 §(d)): `DEFECT-001` — the worker channel's inbound handler was declared payload-shaped while the platform delivers a `MessageEvent`, so every request was silently discarded and the whole UI hung on `Analyzing default record…` with **61 files / 750 tests** green. Part A repairs the contract where it lives ([`WorkerPort.onmessage`](../src/workers/port.ts:25) event-shaped; both binders unwrap `event.data` with the guards untouched; every in-memory harness corrected to deliver the platform's shape), adds the missing Node gate — a delivery-contract describe in [`bind.test.ts`](../src/workers/__tests__/bind.test.ts:254) whose compile-time case fails `tsc` if the handler is re-declared payload-shaped, proved to bite by deliberate revert — **sweeps the class** (every fake/stub claiming a platform contract, with a recorded verdict for each, in [`plans/adr/ADR-019-worker-message-delivery-contract.md`](adr/ADR-019-worker-message-delivery-contract.md:1)), and re-runs the Phase-17 A–F manual pass into this phase's own document rather than reopening the closed Phase-17 artifact. Part B then folds in two increments on that repaired channel: an **EDF/EDF+ dataset adapter** (a second `DatasetAdapter` over the *same* `DatasetFileSource` seam: a pure 256-byte-header parser with a field-major per-signal block, `gain`/`baseline` derived by arithmetic on the **declared** physical/digital ranges, an `EDF Annotations` signal excluded from the channels and stated in `comments` with `annotations` left empty, out-of-range digits read **as declared** with their count in provenance, and every canonical-model gap a classified refusal naming the offending field (a non-mV dimension, disagreeing per-signal rates, `EDF+D`, a degenerate span, an unknown `-1` count that does not divide the data section) — beside a pure **extension-keyed** format dispatch so the adapter is reachable from the picker while the WFDB path stays byte-identical — [ADR-020](adr/ADR-020-edf-adapter-refusals.md:1)) and a **display-only model-output view** consuming an application service over the injected `InferenceEngine` — never a detection and never a clinical claim. Part C audits and closes. A boundary correction plus two additive features: no science, no new dependency, no prop or config change, and no wall-clock or pixel assertion (rules §30/§51). **In progress (2026-09-14):** ADR-019 records Part A (item 6 complete — the EDF/EDF+ adapter and its extension-keyed dispatch, [ADR-020](adr/ADR-020-edf-adapter-refusals.md:1), gate green at **64 test files / 814 tests / 173 modules**); item 7 complete — the display-only model-output view, its window-realising application service and the injected worker-backed engine, [ADR-021](adr/ADR-021-model-output-display-rule.md:1), gate green at **66 test files / 838 tests / 181 modules**, with the panel rendering the frozen description (or a classified refusal in a `role="alert"`) and `App.svelte` taking only an **optional** prop so the pinned jsdom bootstrap slice is unchanged; scope and items in [`plans/phase-18-plan.md`](phase-18-plan.md).

The order above front-loads the scientific core (contracts → fixtures → DSP → DWT → data) before any UI/ML, so the "experimentation is cheap, accidental change is hard" principle is structural from the start.

---

## N. Architectural risks

| Risk | Mitigation |
|---|---|
| Scope creep toward a full app before science is validated | Phase gate: no UI/ML until Phase 6; each phase green-checks |
| DWT numerical divergence from reference semantics | Golden wavelib vectors + reconstruction-identity + tolerance tests committed in Phase 2/4; any change requires regression |
| Unit/rate/units corruption at boundaries | Typed `SamplingInfo`/`Units`; adapter performs the only ADC→mV conversion; guards against sample-rate inference |
| Data leakage in future evaluation | Subject-aware partition API only; normalization fit separated from apply |
| Domain-model over-engineering | Entities limited to F's list; added only when a consumer exists |
| ONNX model incompatibility silently ignored | `ModelMetadata` validation *before* inference; loud failure; no silent adaptation |
| Worker duplication of DSP logic | Shared `dsp/` module used by both main and worker shells |
| Stale result overwrite race | requestId/signalId echo + latest-identity rejection + cooperative cancellation |
| Importing SIGIL code wholesale | Explicit reference-only policy; provenance in fixtures; no C++/JUCE/U2-Net code enters repo |
| Dependency creep | Dependency-review checklist per rules §23/§39; prefer in-house deterministic glue for WFDB parsing |
| gitignored dataset assumed present/complete | Adapter validates against `RECORDS`; tests never require full dataset; fixtures self-contained |

---

## O. First coding task (recommended — exactly one)

**Phase 1 slice: establish the TypeScript/domain scaffold with a working, tested unit/units/sample-rate invariant layer — no UI, no DSP math yet.**

Concretely, in Code mode:
1. Initialize `package.json` (strict TypeScript, Vite + Vitest, eslint), `.gitignore` additions, `tsconfig` with `noUncheckedIndexedAccess`, `noImplicitAny`, `strict: true`.
2. Create `src/domain/` with `units.ts`, `sampling.ts` (`SamplingInfo`, `toTimeIndex`/`toSampleIndex` helpers), `signal.ts` (`Signal`, `SignalChannel`), `error.ts` (classified error taxonomy per rules §16).
3. Create `src/domain/__tests__/` with unit tests: rate/length/time conversions, unit conversions, empty/invalid-array guards.
4. Add npm scripts (`check` = typecheck + lint + test + build) and confirm green.

Rationale: it is the smallest coherent change that (a) establishes every downstream invariant (units sacred, sampling never inferred — the rules' most-frequently-violated constraint), (b) gives future phases a green CI harness, and (c) is a foundation rather than a flashy feature. It touches no scientific algorithm, so it cannot corrupt existing behavior — there is none to break.

---

## Decision register (ADRs — only material decisions)

- ADR-001 Core signal representation (typed `Signal` + `SamplingInfo` + units; sample rate never inferred).
- ADR-002 DSP architecture (pure functions; per-stage semantic types; DSP never imports UI/ML).
- ADR-003 DWT contract (TS DWT/IDWT validated against wavelib references; explicit family/level/extension; reconstruction identity gate; WASM deferred).
- ADR-004 ONNX runtime contract (`ModelMetadata` externalized; validation before inference; engine behind interface).
- ADR-005 Browser worker strategy (shared modules + worker shells; requestId/identity stale rejection).
- ADR-006 Dataset abstraction (adapter boundary; WFDB adapter; subject-aware partitioning).
- ADR-007 Experiment/reproducibility model (config+provenance; no implicit state).
- ADR-008 Display channel/viewport selection & view controls (selection is a display concern over a full-record `AnalysisResult`; thin fully controlled toolbar; pure viewport presets from sampling facts; Svelte presentation stack).
- ADR-009 Experiment machinery placement + seam-validation evaluation scope (`PartitionSpec` in `datasets/`; `ExperimentConfiguration`/`ExperimentResult`/metrics/runner in `application/`; Node-only seams confined to tests; probe-driven evaluation is seam-validation — never a clinical claim).
- ADR-010 Performance measurement policy & worker/WASM/WebGPU decision status (measurement-first: no optimization without a measured bottleneck; committed 2026-09-04 baseline backs the §I worker table; real worker glue / WASM DWT / WebGPU all remain deferred on the numbers).
- ADR-011 Worker execution model (ADR-005 seam #3 realized: transport-free cores behind `bindDspCore`/`bindInferenceCore` + a single `LatestOnlyOrchestrator`; thin worker shells for whole-record DSP/DWT via the `DspExecutor` seam and full-record inference via `WorkerInferenceEngine`; correctness gate is byte-identical parity between main-thread and worker paths, never a committed wall-clock assertion; main-thread fallback preserved; DOM/worker typing keeps no `webworker` lib with a single documented `self` cast; the probe `.onnx` stays a browser-loadable emitted asset via `worker.format='es'` + targeted `assetsInlineLimit`; resources released on `pagehide`).
- ADR-012 Browser-local real-signal ingestion (the `DatasetFileSource` seam gains its browser implementation `WebFileSource` over the Web `File`/`Blob` API; portable `<input type=file multiple>`/drag-drop floor with the File System Access directory picker as a Chromium-only progressive enhancement; `RECORDS`-less header-based discovery in the browser while the strict CLI/validation path is unchanged; single source implementation, parsers/adapter/DSP/ML untouched; local-first restated — no backend/upload/persistence; the DOM-lib type gap handled by a local ambient declaration with no new dependency or tsconfig lib; correctness gate is a byte-identical `SignalRecord` across `InMemoryFileSource`/`NodeFileSource`/`WebFileSource` plus an opt-in real-data test that skips when `data/raw/mitdb` is absent).

- ADR-013 Annotation display over the canonical record (+ the completed record selector) (a record's own `AnnotationEvent`s are overlaid on the time-series canvas as display-only markers — never fused into the signal and never a detection; the pure `annotationMarkers` helper is the single tested mapping, density-capped to one marker per pixel column with `visibleCount`/`mergedCount`/`symbols` stated in the caption; `App` forwards `result.sourceRecord.annotations` and no parser/adapter/DSP/ML/application file changes; the Phase-11 multi-record selector gains no production code and is proven by a two-record jsdom fixture that switches the Record combobox and asserts identity/analysis-id replacement plus the first-channel/full-window display reset; canvas pixels and wall-clock timings are never the gate).

- ADR-014 Signal navigation — cursor readout, zoom and pan (display only) (the time-series view gains a pointer cursor readout and zoom/pan/reset, every step computed by the pure `navigationGeometry.ts` helper which delegates each time<->sample conversion to `src/domain/sampling.ts` (ADR-001); `App` stores a committed window as a display-only "Custom (zoomed)" viewport option appended after the presets and passes the one window to both canvas views, so `ViewControls`/`presets.ts` stay unmodified; a commit landing exactly on the full record clears the custom window, as do a preset pick / re-analysis / record switch; navigation is main-thread and display-only — `service.analyze` is never re-invoked and no sample buffer is ever written (ADR-008); the minimum window is a two-sample *display* floor, not a measurement threshold; jsdom cannot measure layout, so the guarded pointer handlers are only proved inert while drag geometry is the pure Node gate; canvas pixels and wall-clock timings are never the gate).

- ADR-015 Cursor annotation readout — the nearest annotation symbol (display only) (the time-series cursor readout may append the symbol of the nearest annotation already present in `result.sourceRecord.annotations`, resolved by the pure `nearestAnnotationAtFraction` helper in `annotationGeometry.ts` under the same half-open window rule as the Phase-12 overlay and a display-fraction tolerance (`CURSOR_ANNOTATION_TOLERANCE_FRACTION`, documented as a presentation radius and never a measurement/detection threshold), with a deterministic nearest (distance → lower sample index → lexicographically smaller symbol) and `null` as a first-class fallback; the string is produced by the pure `formatCursorReadout`/`CURSOR_IDLE_LABEL` in `navigationGeometry.ts` so the idle and hover forms stay byte-identical to Phase 13; it is the display of a domain fact, never a detection and never a clinical claim (ADR-013), and the returned sample index is a readout, not a data access; no new prop, no service call, no science/application change (`App.svelte` already forwards the annotations); the gate is the pure Node resolver/formatter plus a jsdom wiring slice over a stubbed `getBoundingClientRect`, and canvas pixels and wall-clock timings are never the gate).

- ADR-016 Annotation interaction — detail line, symbol filter and click-to-pin (display only) (the time-series view shows the record's own `symbol`/`auxNote` for the nearest annotation, resolved by the pure `nearestAnnotationEventAtFraction` in `annotationGeometry.ts` which returns the record's own event under the same half-open window rule as the Phase-12 overlay and a display-fraction tolerance, with the Phase-14 `nearestAnnotationAtFraction` re-expressed as a projection over it so there is exactly one selection spine; the detail line and the view-local `<select>` symbol filter are the display of domain facts, never a detection (ADR-013), and the filter changes only what is drawn (ADR-008) — it never re-invokes `service.analyze` and never changes what the science computed, with its options derived from the **unfiltered** window so a removed filter falls back to "All" via `resolveSymbolFilter` and no manual reset; `formatAnnotationDetail` renders `Annotation: {symbol} · sample {i}` plus the non-empty `auxNote` and deliberately omits `code`; the view pins a clicked annotation's own event for the detail line, held with `$state.raw` since a deep-reactive `$state` would proxy the record's object and silently break the identity test against the drawn list, and a click's display-fraction move tolerance replaces the Phase-13 implicit zero-width click-zoom while the drag geometry is unchanged; no new prop, no service call, no science/application change (`App.svelte` already forwards the annotations); the gate is the pure Node resolver/filter/formatter plus a jsdom wiring slice over a stubbed `getBoundingClientRect`, and canvas pixels and wall-clock timings are never the gate).

- ADR-017 Real-data verification and the opt-in gate policy (tests + docs only) (the Phase 12–15 display-only presentation stack is re-measured against a genuine MIT-BIH record's own annotations and mV signal by two **opt-in** gates that **skip** when the gitignored `data/raw/mitdb` is absent, so the default suite never depends on the dataset and a skipped gate proves nothing; a pure Node gate asserts the display mapping's **structural invariants** — one marker per pixel column, counts consistent, half-open window containment, ordered amplitude bounds, contained navigation — and never a detection or a clinical claim (ADR-013), while a jsdom slice renders `TimeSeriesView` over the stubbed `200×100` rect and proves **wiring only**, the numbers and strings staying the pure Node gate; "which record" has exactly one definition in a test-only probe/loader (`firstCompleteRecordId`/`loadRealRecord`) that opens the dataset read-only, never hard-coding a record id; the real-browser pass is a recorded **manual** `npm run dev` observation (`plans/phase-16-manual-verification.md`), never a gate and never a wall-clock/pixel assertion, and **no browser-automation dependency** is added (ADR-012 no-new-dependency precedent); no production/helper/config/`package.json` change and no new script).

- ADR-018 Annotation set filtering, a clickable legend and a bounded annotation list (display only) (the Phase-17 time-series increment generalizes the ADR-016 single-symbol filter to a **set** whose **empty value is "All symbols"** — the identity for the pure `filterAnnotationsBySymbols` and the `null`-equivalent for `resolveSymbolFilters`, with the Phase-15 single-symbol helpers kept as **projections** so exactly one filter rule holds; the inert `Symbols:` legend **becomes the control** — one `aria-pressed` toggle per **unfiltered**-window symbol, superseding the Phase-15 single-select `<select>` so a pressed set can never hide its own off-switch; the window's own events are listed in a **bounded**, scrollable panel built from the **same filtered list the canvas draws** by the pure `annotationList` (cap `ANNOTATION_LIST_LIMIT`, deterministic `sampleIndex`-then-`symbol` order, `visibleCount` the uncapped total, caption `formatAnnotationListCaption`), and a row click pins the clicked event through the **same** `$state.raw` `pinnedEvent` the canvas click sets, preserving event identity so the detail line, the canvas highlight and the `aria-current` row cannot disagree; it is the display of a domain fact, never a detection (ADR-013) — a selection hides markers, the cap bounds only rendered rows, and neither re-invokes the service nor writes a sample buffer (ADR-008); the gate is the pure Node helpers plus a jsdom wiring slice over a stubbed `getBoundingClientRect` (and the ADR-017 opt-in real-data slice re-pointed to read the caption by class), and canvas pixels and wall-clock timings are never the gate).

- ADR-019 Worker message delivery contract (an event-shaped `onmessage`, and a fake that imitates the platform) (the Phase-18 Part A correction of `DEFECT-001`: a real `DedicatedWorkerGlobalScope` invokes its `onmessage` handler with a **`MessageEvent`** carrying the envelope on `data`, so `WorkerPort.onmessage` is declared exactly that and both binders in `bind.ts` unwrap `event.data` once and apply the **existing** guards unchanged — the previously declared payload shape made every guard `false` and silently discarded every request, hanging the app on `Analyzing default record…` while **61 files / 750 tests** stayed green because no gate ever delivered a platform-shaped message; every in-memory loopback (the `bind.test.ts` harness, the parity loopback and the bench loopback) now delivers the platform's shape, so a fake imitates the platform rather than redefining it, and the missing gate is added as a delivery-contract describe in `bind.test.ts` whose compile-time case fails `tsc` if the handler is ever re-declared payload-shaped — proved to bite by deliberate revert (exit 2 with `TS2578` + two `TS2322`); the class sweep of every fake/stub claiming a platform contract records a verdict for each, including the clean ones — both worker handles and the `pagehide` teardown already unwrap/tear down correctly but are browser-only and so handed to the manual pass rather than declared confirmed, the `postMessage` `transfer` argument deliberately unused because detaching the core's `Float64Array`-backed buffers would empty a returned result, the two worker entries' single documented `self` cast unchanged (the compensating control is the contract case), and the two `RecordingTransport` fakes narrowed only on the fake's own side under method bivariance — the opposite direction to the defect; no science/domain/parser/adapter/DSP/DWT/ML/application change, no new dependency, prop, script or config, and no wall-clock or pixel assertion).

- ADR-020 The EDF/EDF+ adapter, and what it refuses (an extension-keyed format dispatch) (the Phase-18 Part B second `DatasetAdapter`, realized over the **same** `DatasetFileSource` seam as WFDB: a pure 256-byte-header parser whose derived calibration (`gain` = digital span / physical span, `baseline` = `digitalMin − physicalMin × gain`) comes from the file's **declared** physical and digital ranges rather than assumption, and whose **only** failures are classified and name the offending field — `unsupported-format` for a version other than `"0"`, an unknown reserved tag, `EDF+D` discontinuities, a declared dimension other than mV and per-signal sample rates that disagree; `malformed-header` for a blank/non-numeric field, a signal count `<= 0`, a header byte count disagreeing with `256 × (signals + 1)`, fewer bytes than declared, a non-positive samples-per-data-record, duration or physical/digital span, a data-record count `< -1`, a `-1` count whose data section is not a whole number of records, and a declared count the bytes contradict; each rejection recorded with its **rejected alternative** (rescaling µV to mV, resampling to a common rate, concatenating an `EDF+D` gap, inventing a `gain`, clamping an out-of-range sample, half-reading a TAL) so "left out deliberately" can never be confused with "forgotten"; an `EDF Annotations` signal is excluded from the channels with the exclusion stated in `comments` and `annotations` left **empty**, and out-of-range digits are read **as declared** with their count carried as a provenance transform; the adapter is reachable through a pure **extension-keyed** `detectDatasetFormat` (`.hea` ⇒ MIT-BIH, `.edf` ⇒ EDF, case-insensitive; mixed or neither refused classified) implemented in a shared Node-testable module rather than inside `prepareBrowserDataset`, with `createBrowserDatasetService` taking a **required** format so no caller can silently analyse EDF bytes as WFDB, and the WFDB path including `discoverMitBihRecordIds` and the pinned jsdom cases byte-identical; the gate is a Node suite over hermetic in-memory fixtures whose builder restates the EDF layout independently of the parser and which asserts the mV conversion as an **exact per-sample** `adcToMillivolt` identity from `recordToMillivoltSignal` alone; no science/domain/DSP/DWT/ML/application change, no new dependency, prop, script or config, and no wall-clock or pixel assertion).

- ADR-021 The model-output view — declared semantics decide the word, the displayed window is the scored window, and one application door (the Phase-18 Part B display-only increment: [`src/application/inference.ts`](../src/application/inference.ts:1) is the only path from a view to an engine — a `ModelOutputService` holds an injected engine plus the one `ModelMetadata` it may run and never disposes either (the `runExperiment.ts` rule), realises exactly one half-open window through the domain's single time→sample mapping (ADR-001, **relocated** into `src/domain/sampling.ts` and re-exported by the view's `geometry.ts` so `application/**` never imports `presentation/**`), and refuses instead of reshaping — `model-compatibility-failure` for a declared rate/channel/window/dtype mismatch, `invalid-input` for a window covering no samples, `inference-failure` for a non-classified engine throw; the per-label word is the metadata's own (`predicted-probability` only for declared probabilities or logits under softmax/sigmoid, otherwise the uncalibrated `model-score`, and never "confidence"), the frozen description names the exact `[startSample, endSample)` window, the record's own sample rate and the channel actually scored including the first-channel fallback; the panel renders that description and nothing else (no window arithmetic, no score conversion, no label text of its own), shows a classified refusal in a `role="alert"` — the honest boot state, since the 360-sample probe cannot accept the 3600-sample default record — takes the service through one **optional** `App.svelte` prop so the pinned jsdom bootstrap slice is unchanged, and scores only on an explicit user action so no analysis, navigation or record switch re-runs the model; the engine stays the composition root's, `main.ts` injecting the existing worker-backed handle with the browser-safe frozen probe metadata; the gates are 17 Node tests over the service plus 7 jsdom tests over the view asserting declaration, refusal, in-flight state and wiring — no science change, no new dependency, script or config and no new **required** prop, and no wall-clock or pixel assertion).

Trivial decisions (file layout details, prettier config) are documented inline, not as ADRs.

## Open decisions to confirm before implementation
1. Frontend stack: **lean TypeScript + Vite**, UI framework choice deferred until Phase 7 — recommended default is **no global state library**, explicit orchestration services + thin views. Confirm or override.
2. WAVELET default family/level: not fixed now; Phase 4 experiments choose scientifically (rules forbid premature choice).
3. Whether to add `data/raw/mitdb` completeness fixes or treat as-is with validation (recommended: treat as-is, validate, do not modify gitignored data). **Refreshed (Phase 11, ADR-012):** still treat-as-is — the repo never depends on the gitignored dataset. A browser user may now supply their own files (local-first, nothing uploaded), and the real-data integration test is opt-in (skipped when `data/raw/mitdb` is absent).
