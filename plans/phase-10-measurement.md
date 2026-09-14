# Phase 10 — Worker Offload Measurement (before / after)

Recorded 2026-09-13. Purpose: the honest, reproducible measurement record for
Phase 10's **worker offload** (ADR-005 seam #3, architecture §I worker table).
It accompanies the harness in
[`src/bench/worker.bench.ts`](../src/bench/worker.bench.ts:1) and the standing
policy in
[`plans/phase-9-bench-policy.md`](phase-9-bench-policy.md:1) and
[`ADR-010`](adr/ADR-010-performance-measurement-policy.md:1).

> **This directory is a snapshot, never a CI gate.** Timing is machine- and
> environment-dependent; no committed test asserts a wall-clock duration
> (rules §51). `npm run bench` is a local, human-invoked activity and is
> deliberately **not** part of `npm run check`.

## The one sentence that matters

**The DSP durations are unchanged — worker offload does not make the algorithm
faster; the win is main-thread availability.** Phase 10 is *relocation, not
optimization* (rules §30): the identical `decomposeSignal` runs either way, so
the two columns below are the same scientific pipeline, one inline and one
relayed.

## What was measured

Two ways to run the **same** whole-record DSP/DWT stage over the fixed
deterministic scenarios in [`src/bench/scenarios.ts`](../src/bench/scenarios.ts:1)
(3600 / 36 000 / 360 000 / 650 000 samples @ 360 Hz):

- **Before — `main-thread DspExecutor`.** `MAIN_THREAD_DSP_EXECUTOR.execute(signal,
  { dwt })`: the exact inline `decomposeSignal` chain the application ran before
  Phase 10 (the Phase-9 baseline path). One sample = one whole-record
  decomposition on the calling thread.
- **After — `Node loopback`.** The **real production glue in a single Node
  process**: `bindDspCore` on one in-memory `WorkerPort` `⇄`
  `LatestOnlyDspClient` on the other, wired only by `queueMicrotask` hops. One
  sample = one whole-record request that awaits its reply, so it measures the
  **same** decomposition plus the envelope / latest-only / promise-scheduling
  overhead of the offload machinery. No orchestration is re-implemented
  (rules §30) — the binder and client are the shipped ones.

## Machine snapshot

| Fact | Value |
|---|---|
| Platform / arch | win32 / x64 |
| OS | Windows 11 |
| Node | v24.18.0 |
| npm | 11.16.0 |
| Vitest (built-in `vitest bench`) | 3.2.7 |
| Tinybench | 2.9.0 |
| onnxruntime-web | 1.29.0 |

Numbers do **not** transfer to other machines, other toolchain versions, or a
different thermal/load state.

## Results (mean per whole-record operation)

| Operand | Before — main-thread `DspExecutor` (mean ms) | After — Node loopback (mean ms) | Δ (ms) | Samples (n) |
|---|---|---|---|---|
| 3600 samples (10 s), db4 level 4 | 0.6443 | 0.6494 | +0.0051 | 311 / 308 |
| 36 000 samples (100 s), db4 level 5 | 6.3299 | 6.3808 | +0.0509 | 40 / 40 |
| 360 000 samples (1000 s), db4 level 6 | 63.8768 | 63.0559 | −0.8209 | 12 / 12 |
| 650 000 samples (full-record-size ≈30 min), db4 level 4 | 106.83 | 107.86 | +1.03 | 5 / 5 |

Relative margin of error per case was ≤ ±2.1% (the 360 000-sample before-case
reported ±3.83%; all other cases ≤ ±2.05%). The 360 000-sample row shows the
loopback *faster* by 0.82 ms, which is inside that error — i.e. the handoff
overhead is at or below the noise floor of a single machine run.

### Repeatability (two captures, same session, 2026-09-13)

The numbers above are capture **A**. A second capture **B** (minutes later, after
a non-behavioural refactor of the bench harness) is recorded here so neither is
presented as definitive:

| Operand | A before | A after | B before | B after |
|---|---|---|---|---|
| 3600 samples | 0.6443 | 0.6494 | 0.6519 | 0.6932 |
| 36 000 samples | 6.3299 | 6.3808 | 6.4431 | 6.5982 |
| 360 000 samples | 63.8768 | 63.0559 | 64.0627 | 65.0951 |
| 650 000 samples | 106.83 | 107.86 | 109.81 | 116.66 |

The **direction flips run to run** (in capture A the loopback is faster at
360 000 samples; in capture B it is slower at every size), and capture B's
650 000-sample loopback case reported ±8.64% rme. The conclusion is unchanged:
the handoff delta is small (sub-millisecond at small sizes, ~1–7 ms at the largest
and noisiest) and is dominated by run-to-run variance, while the absolute
per-size durations are stable. That is exactly the "offload adds negligible CPU;
the algorithm's cost class is unchanged" reading — and the reason a single mean
is never a pass/fail criterion (rules §51).

## How to read the pair

1. **The offload machinery is cheap relative to the work it relocates.** Across
   every size the loopback mean tracks the inline mean to within ≈1 ms (≈0.8%
   at small sizes, ≈1% at 650 000 samples, and negative at 360 000). The
   envelope + latest-only + two microtask hops add a negligible constant next to
   a 0.6–107 ms decomposition.
2. **Nothing got faster.** The absolute durations match the Phase-9 baseline
   within error for the same operand; this is the same `decomposeSignal`
   (byte-identical parity is proven separately in
   [`workerAnalysis.parity.test.ts`](../src/application/__tests__/workerAnalysis.parity.test.ts:1)).
   The value of offload is that a 63–107 ms whole-record batch — far over the
   ≈16.7 ms 60 fps frame budget (rules §52) — no longer runs on the main thread,
   so the UI stays responsive while it completes.

### Honesty boundary: this is NOT a browser

The loopback runs in **one process**. It performs **no** structured clone, **no**
serialization, **no** cross-thread scheduling and **no** real `postMessage` task
boundary — none of those costs exist in-process. The loopback number is therefore
a **lower bound** on real in-browser handoff overhead, and it deliberately does
**not** claim to measure the true `postMessage`/clone cost. What it does show is
that the shipped orchestration logic adds no meaningful CPU work of its own, so
the residual cost of the real handoff is the platform's clone/schedule cost, not
ours.

## Manual browser validation (`npm run dev`)

The loopback is a Node stand-in; the real browser path must be confirmed by hand.
The manual check is:

1. `npm run dev`, open the served URL; the App loads the default record and
   renders both canvases.
2. Confirm the browser stays responsive (controls respond, window resizes
   smoothly) while a whole-record analysis is running — i.e. the DSP/inference
   batch is off the main thread.
3. Confirm the analysis result is identical to the main-thread path (same record
   identity, same coefficients rendered).
4. Confirm a `pagehide`/reload leaves no worker running (the two workers are
   terminated via the registered release listener).

This is a **manual** observation, recorded here as the validation note; it is not
automated and is not a gate. The browser-only entry glue
(`src/main.ts`, `src/presentation/workers/browserWorkers.ts`, `*.worker.ts`) is
covered by typecheck + lint + build, not by vitest (rules §51; plans §Reminders).

## Re-running the capture

From the repo root (raw output stays in the **gitignored** `/bench-results/` and
is never committed):

```sh
# This measurement (worker before/after only)
npm run bench -- --run worker.bench

# With raw JSON persisted for reference
npm run bench -- --run worker.bench --outputJson ./bench-results/<yyyy-mm-dd>-worker.json

# Machine snapshot
node -e "console.log(process.platform, process.arch, 'node', process.version)"
npm ls vitest tinybench onnxruntime-web
```

The bench file is typecheck- and lint-covered by `npm run check`, but is **not
executed** by `npm test` (`vitest run` includes only `*.test.ts`); `vitest bench`
includes `src/bench/**/*.bench.ts`. Per-size iteration budgets live in the bench
source (`WORKER_BENCH_TIMING`), matching the Phase-9 protocol: small sizes
collect many cheap samples, whole-record sizes collect few expensive ones.

## Scope statement

This measurement covers **engineering throughput only**. It says nothing about
model quality or clinical behaviour (rules §47/§49; ADR-009) — inference remains
seam-validation scope. It does not authorize any change to scientific results or
numerical contracts (rules §30), and it is never a pass/fail criterion
(rules §51).
