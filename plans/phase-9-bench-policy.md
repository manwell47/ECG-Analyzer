# Phase 9 — Benchmark & Performance Measurement Policy

Recorded 2026-09-04. Purpose: the standing policy for *measuring* scientific
pipeline throughput in this repository and for making optimization decisions
from those measurements — never the reverse. It accompanies the committed
2026-09-04 snapshot in [`plans/phase-9-baseline.md`](phase-9-baseline.md) and
the decision record in
[`plans/adr/ADR-010-performance-measurement-policy.md`](adr/ADR-010-performance-measurement-policy.md).

## Scope and ground rules

- The benchmark harness lives under [`src/bench/`](../src/bench/scenarios.ts:1)
  and measures **engineering throughput** (operation duration, windows per
  second) of deterministic in-memory operands. Throughput numbers are **never**
  phrased as model-performance or clinical claims (rules §47/§49; ADR-009).
  The `runExperiment` seam bench is **seam-validation scope only**, exactly like
  the Phase-8 seam test, and its file header says so.
- **This phase changes no production scientific code.** Measurement-only. Any
  real optimization is a *later* phase and must be driven by a re-run of this
  harness before/after on the same machine (rules §50/§52, AGENTS §15, first
  prompt "Do not optimize before profiling").
- **Timing is machine- and environment-dependent. A benchmark is a snapshot,
  never a CI gate.** No committed test may assert a wall-clock duration
  (rules §51). `npm run bench` is a local, human-invoked activity and is
  deliberately **not** part of `npm run check`.

## What is measured, and how to read it

Two bench files cover the measured axes, each across the four canonical input
sizes (3600 / 36 000 / 360 000 / 650 000 samples @ 360 Hz):

| File | Axes |
|---|---|
| [`src/bench/dsp.bench.ts`](../src/bench/dsp.bench.ts:1) | `designFirFilter` (constant), `filterSignal` (zero-phase), `normalizeSignal` (z-score), `segmentSignal` (360/360), DWT db4 periodic `decomposeSignal` + full `decompose+reconstruct` round-trip, `resampleSignal` (360→128 Hz) — each over whole records |
| [`src/bench/pipeline.bench.ts`](../src/bench/pipeline.bench.ts:1) | `buildModelInput` (float32, lead-b) packing every 360-sample window; `runExperiment` seam over the **real committed ONNX probe** (windows/second) |

Each reported case carries the input size, sample rate, algorithm config and
iteration/sample count. The runner reports mean/p99 ms and relative margin of
error per sample. One bench **sample** is:

- DSP: one full-record operation (`filterSignal`, `normalizeSignal`, …).
- `buildModelInput`: one full-record pack (all windows of the record); divide
  mean by the window count for the per-window packing time.
- `runExperiment` seam: one complete evaluation of the record (read → window →
  `buildModelInput` → real ONNX inference per window → labeler → metrics);
  windows/second = window count ÷ (mean seconds).

### Axis → architecture §I worker-table mapping

The measured axis of each row below is what a future §I worker/WASM/WebGPU
decision is taken from. Rows are verbatim descriptions of the architecture
[`§I execution model`](ecg-lab-architecture.md:261) worker table.

| Architecture §I row | Measured axis in this harness |
|---|---|
| WFDB parse (format 212), mV scaling — Worker (or main for small files, offload by size) | (dataset I/O; *not* benchmarked — out of harness scope, see Reproducibility) |
| Filtering long records, resampling, normalization — Worker, CPU-bound | `filterSignal`, `resampleSignal`, `normalizeSignal` whole-record mean ms per size |
| DWT of long signals — Worker, CPU-bound (rules §30) | DWT db4 `decomposeSignal` + round-trip mean ms per size |
| Segmentation / feature extraction — Worker, CPU-bound | `segmentSignal` whole-record mean ms per size |
| Model inference — ONNX Runtime Web inside a Worker | `buildModelInput` per-window packing + `runExperiment` seam windows/second per size |
| UI/state transforms — main thread | (not benchmarked; latency-sensitive tiny work) |
| Visualization decimation/rendering — main thread | (out of harness scope) |

The ≈16.7 ms 60 fps browser frame budget (rules §52) is the yardstick for any
main-thread claim; the baseline records each whole-record duration so the
streaming-versus-batch question can be judged per op.

## Protocol

### Machine snapshot

Run once per capture session and record in the snapshot doc:

```sh
node -e "console.log(process.platform, process.arch, 'node', process.version)"
npm ls vitest tinybench onnxruntime-web 2>NUL || npm ls vitest tinybench
```

Machine facts recorded for the 2026-09-04 baseline: Windows 11, Node v24.18.0,
npm 11.16.0, Vitest 3.2.7 (built-in `vitest bench`). Numbers do **not**
transfer to other machines.

### Re-running a capture

From the repo root. Parent directories of `--outputJson` are created
automatically; raw output stays in the **gitignored** `/bench-results/`
directory and is never committed.

```sh
# All bench files (full suite, longest wall time)
npm run bench -- --run --outputJson ./bench-results/<yyyy-mm-dd>-<label>.json

# Per-file captures (faster, used for the DSP vs pipeline snapshots)
npm run bench -- --run dsp.bench --outputJson ./bench-results/<yyyy-mm-dd>-dsp-baseline.json
npm run bench -- --run pipeline.bench --outputJson ./bench-results/<yyyy-mm-dd>-pipeline-baseline.json
```

`vitest bench` reports console tables and, with `--outputJson`, writes the raw
per-sample JSON (name / mean / p99 / hz / sample count / rme per case). The
filename-substring filter (for example `pipeline.bench`) restricts the run to
that file, which is how the seam capture stays fast.

### Warm-up and iteration rationale

Vitest bench warms up each case, then collects timed samples. Tinybench stops a
case once **both** the `time` budget has elapsed **and** the minimum
`iterations` were collected. Iteration budgets per size are set in the bench
sources so:

- small sizes collect thousands of samples for tight relative error,
- whole-record DSP cases at 360 000 / 650 000 samples use fewer samples (each
  is a tens-to-hundreds-of-ms operation),
- the real-ONNX `runExperiment` seam at 1000 / 1805 windows is effectively a
  **single-sample snapshot** (iterations 1 + one warm-up) because each sample
  evaluates the whole record on the real session and can take 120–215 ms.

**Known vitest-bench constraint:** benchmark mode does not execute suite
`beforeAll`/`afterAll` hooks, so the seam engine is created lazily on its first
invocation (that first call lands inside the discarded warm-up sample) and is
deliberately not disposed — the bench process is single-shot and the ORT Web
WASM allocation is reclaimed at process exit. See the header of
[`src/bench/pipeline.bench.ts`](../src/bench/pipeline.bench.ts:1).

### Committing results

- Raw per-run JSON → `/bench-results/` (gitignored). Never commit it.
- A labelled, human-readable snapshot of one machine/date → committed as
  [`plans/phase-9-baseline.md`](phase-9-baseline.md) (a snapshot, not a gate).
- Decisions the snapshot supports → recorded in
  [`ADR-010`](adr/ADR-010-performance-measurement-policy.md).

## Reproducibility mapping (rules §35 / AGENTS §35)

The operands are deterministic and in-memory:

- Inputs are `generateSyntheticRecord` + `recordToMillivoltSignal` (pure
  functions of their spec — no randomness, no I/O), prepared once per size by
  [`src/bench/scenarios.ts`](../src/bench/scenarios.ts:1). The ~650 000-sample
  full-length reference is synthesized in memory only; it is never written to
  `data/` or committed.
- Algorithm configuration is derived deterministically and held in the scenario
  (filter spec, DWT db4 level via the length policy, 360/360 windowing, 360→128
  resample). Config + sample rate + input size are recorded with every case.
- [`src/bench/__tests__/scenarios.test.ts`](../src/bench/__tests__/scenarios.test.ts:1)
  asserts shape and determinism only — **never duration** (rules §51). These
  tests run under `npm run check`; the timing files do not.

What reproducibility means here: given the same machine, toolchain versions,
commit and command, a capture reproduces the *shape* of these numbers (input
size → linear whole-record scaling; per-window constants). Exact means vary
with machine load and thermal state and are not a pass/fail criterion.

## Decision framework (what a number may and may not do)

- A number may justify moving an axis to a Worker, choosing a WASM backend, or
  deferring WebGPU — but only after the same harness is re-run before/after on
  the same machine (rules §50/§52).
- A number does **not** authorize changing scientific results, softening
  numerical contracts, or duplicating logic across runtimes (rules §30).
- Worker/WASM/WebGPU conclusions from the 2026-09-04 numbers are recorded in
  ADR-010; this policy keeps them reviewable against the committed snapshot.
