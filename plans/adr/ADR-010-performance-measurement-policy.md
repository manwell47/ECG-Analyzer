# ADR-010 — Performance Measurement Policy & Worker/WASM/WebGPU Decision Status

Status: Accepted
Date: 2026-09-04
Scope: Phase 9 — a committed measurement-first policy for scientific-pipeline
throughput, plus the measured decision status of worker offload, a WASM DWT
backend, and WebGPU inference. **Measurement only — no production-code
optimization.**

## Context

Phase 9 (architecture §M item 9 / §I worker + WASM/WebGPU bullets) is the
measurement phase: a deterministic vitest-bench harness over
[`src/bench/`](../../src/bench/scenarios.ts:1) records engineering throughput
for the DSP stage functions, `buildModelInput`, and a `runExperiment` seam over
the **real committed ONNX probe**. Rules §50/§51/§52 and AGENTS §15 forbid
optimization ahead of measurement and forbid timing as a CI gate; the three
§I "defer until measurement" bullets (worker offload, WASM DWT, WebGPU) are
exactly the decisions this baseline exists to inform.

The measured numbers are a **snapshot of one machine on 2026-09-04**
(committed in [`plans/phase-9-baseline.md`](../../plans/phase-9-baseline.md);
policy and protocol in
[`plans/phase-9-bench-policy.md`](../../plans/phase-9-bench-policy.md); raw
JSON is gitignored under `/bench-results/`). They are engineering throughput,
never a model-performance or clinical claim (rules §47/§49; ADR-009). Seam
bench scope is **seam-validation only**.

### The numbers behind the decisions (2026-09-04, mean per sample)

Whole-record DSP operations on the full-length ~30 min / 650 000-sample
synthetic record (360 Hz): segment 4.8 ms, normalize 16.5 ms, zero-phase filter
210 ms, DWT db4 decompose 143 ms / round-trip 296 ms, resample 340 ms. At
360 000 samples: filter 119 ms, DWT round-trip 165 ms, resample 195 ms.

The `runExperiment` seam over the real ONNX probe evaluates a whole record per
sample: 10 windows → 1.6 ms, 100 windows → 11.7 ms, 1000 windows → 121 ms,
1805 windows → 214 ms. Steady state ≈8.2–8.6k windows/second
(≈0.12 ms per window). `buildModelInput` packing is ≈5.4 µs per window.

The ≈16.7 ms 60 fps browser frame budget is the yardstick for main-thread
claims.

## Decision

### (a) A standing measurement-first policy

- No production-code optimization is made this phase, and none may be made in
  any later phase without a **measured bottleneck** from this harness.
- Every future optimization **re-runs the harness before/after on the same
  machine** (rules §50/§52); "faster/slower" is only ever written with that
  before/after pair (rules §51). Timing is a machine/environment-dependent
  snapshot, never a CI wall-clock gate.
- The protocol, axis → architecture §I worker-table mapping, and re-run
  commands are committed in
  [`plans/phase-9-bench-policy.md`](../../plans/phase-9-bench-policy.md);
  the 2026-09-04 numbers are committed in
  [`plans/phase-9-baseline.md`](../../plans/phase-9-baseline.md).
- No committed test asserts a duration; the non-timing scenario tests assert
  shape and determinism only. `npm run bench` stays local and out of
  `npm run check`.

### (b) Worker offload — measured support for the §I placement; real glue still a seam

The measured whole-record DSP costs (4.8–340 ms across ops at 650 000 samples;
119–195 ms at 360 000) and full-record seam batches (121–214 ms) each exceed
the ≈16.7 ms frame budget, which **supports** the existing architecture §I
placement of CPU-bound whole-record work (filtering, resampling, normalization,
DWT, segmentation) and model inference on a Worker rather than the main thread.
The numbers do not change §I; they now quantify it.

- Real browser **Worker glue remains unwired** (worker seam #3): the messaging
  core/contract exists in
  [`src/workers/`](../../src/workers/core.ts:1) /
  [`src/workers/client.ts`](../../src/workers/client.ts:1), but no production
  browser Worker wiring yet exists. Wiring it is a *later phase* task and will
  be driven by this baseline — not done here (measurement-only).
- The per-window seam cost (≈0.12 ms) is ~1/140 of a frame, so an alternative
  to whole-record worker offload — streaming window-by-window on the main
  thread — is also numerically open. Both options stay open; this snapshot
  quantifies the whole-record vs per-window trade-off either choice needs.
- `buildModelInput` (≈5.4 µs/window) is not a worker-offload candidate on these
  numbers; it is negligible next to per-window inference.

### (c) WASM DWT — TS db4 baseline now recorded; deferral re-confirmed

A TypeScript db4 periodic baseline now exists (143 ms decompose / 296 ms
round-trip on 650 000 samples; 85 ms / 165 ms at 360 000). These numbers do
**not** single out DWT as the TS bottleneck relative to other whole-record ops —
zero-phase filter (210 ms at 650 000) and resample (340 ms) are comparable or
larger — so the ADR-003 and architecture §I deferral stands: **WASM DWT remains
deferred** until a measured profile shows the TS DWT path specifically is the
bottleneck. Candidate (wavelib compiled to WASM, parity-validated first) is
unchanged.

### (d) WebGPU — remains deferred

Real-ONNX inference here runs single-threaded CPU WASM: ≈0.12 ms/window,
121 ms / 1000 windows, 214 ms / 1805 windows. WebGPU would target **batch**
inference, but no GPU path has been measured and the browser-support question
is unresolved, so there is no evidence it "demonstrably wins" (architecture §I).
**WebGPU remains deferred** pending measurement of an actual GPU path plus a
browser-support decision. This baseline is the CPU comparison point for that
future measurement.

## Consequences

- Optimization work in any later phase must open by re-running this harness and
  quoting the before/after numbers on the same machine (rules §50/§51).
- The §I worker-table rows now have measured backing (whole-record DSP,
  inference batch) instead of assertion; §I deferral wording is unchanged and
  points here.
- A future real scientific model or real dataset ingestion replaces the
  synthetic/probe operands; the harness and policy carry over unchanged.
- Worker glue, WASM DWT and WebGPU each remain open, now with a committed,
  dated CPU baseline any proposal must beat.

## References

- Architecture plan §I (Browser execution architecture: worker table, WASM /
  WebGPU deferral bullets), §M item 9 (Phase 9)
- [`plans/phase-9-bench-policy.md`](../../plans/phase-9-bench-policy.md) —
  protocol, machine snapshot, re-run commands, axis → §I mapping
- [`plans/phase-9-baseline.md`](../../plans/phase-9-baseline.md) — 2026-09-04
  snapshot numbers
- ADR-003 (WASM DWT deferred), ADR-005 (browser worker strategy), ADR-009
  (seam-validation scope)
- Rules §50/§51/§52, §47/§49 (`.roo/rules-code/01-medical-engineering.md`); AGENTS
  §15, §35; docs/origin-brief.md "Do not optimize before profiling"
