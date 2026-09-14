# Phase 9 — Baseline Snapshot (2026-09-04)

**This is a machine-dependent snapshot, not a gate.** Numbers are engineering
throughput (operation duration, windows per second) measured locally on
**2026-09-04**; they are *not* model-performance or clinical claims (rules
§47/§49) and no committed test asserts any duration (rules §51). See the
[measurement policy](phase-9-bench-policy.md) for protocol, warm-up/iteration
rationale, re-run steps and the axis → architecture §I worker-table mapping.

## Machine / environment

| Fact | Value |
|---|---|
| OS | Windows 11 |
| Runtime | Node v24.18.0 (npm 11.16.0) |
| Benchmark runner | Vitest 3.2.7 `vitest bench` (tinybench) |
| Captures | `bench-results/2026-09-04-dsp-baseline.json`, `bench-results/2026-09-04-pipeline-baseline.json` (raw, gitignored) |
| Operands | Deterministic in-memory synthetic records (`generateSyntheticRecord` + `recordToMillivoltSignal`), no I/O |

Re-running on another machine (or under load) will shift means by several
percent; the stable facts are the *scaling shapes* below.

## Scenario grid

Deterministic synthetic records at 360 Hz. DWT db4 level = the maximum
orthogonal periodic level the length supports
(`maxOrthogonalPeriodicLevelForLength(n, tapCount = 8)`).

| Samples @360 Hz | Nominal duration | 360/360 windows | DWT db4 level |
|---|---|---|---|
| 3 600 | 10 s | 10 | 4 |
| 36 000 | 100 s | 100 | 5 |
| 360 000 | ≈16.7 min | 1000 | 6 |
| 650 000 | ≈30 min (full MIT-BIH-size) | 1805 | 4 |

## DSP — whole-record operations (mean ms per sample)

`designFirFilter` is constant (one-off, negligible); every other row is a
full-record operation on the lead-b mV channel.

**Filter — 65-tap zero-phase lowpass @ 360 Hz** ([`dsp.bench.ts`](../src/bench/dsp.bench.ts:64))

| Samples | `designFirFilter` | `filterSignal` |
|---|---|---|
| 3 600 | 0.0036 (n=41 924) | **1.346** (n=149) |
| 36 000 | — | **11.905** (n=40) |
| 360 000 | — | **118.96** (n=12) |
| 650 000 | — | **210.09** (n=5) |

**Normalize — whole-record z-score** ([`dsp.bench.ts`](../src/bench/dsp.bench.ts:82))

| Samples | `normalizeSignal` |
|---|---|
| 3 600 | **0.104** (n=1917) |
| 36 000 | **0.663** (n=302) |
| 360 000 | **10.114** (n=20) |
| 650 000 | **16.460** (n=13) |

**Segment — non-overlapping 360/360** ([`dsp.bench.ts`](../src/bench/dsp.bench.ts:90))

| Samples | `segmentSignal` |
|---|---|
| 3 600 | **0.031** (n=6387) |
| 36 000 | **0.325** (n=615) |
| 360 000 | **3.279** (n=61) |
| 650 000 | **4.812** (n=42) |

**DWT — db4 periodic decompose + full round-trip** ([`dsp.bench.ts`](../src/bench/dsp.bench.ts:98))

| Samples (level) | `decomposeSignal` | `decompose + reconstruct` |
|---|---|---|
| 3 600 (L4) | **0.882** (n=227) | **1.819** (n=110) |
| 36 000 (L5) | **8.947** (n=40) | **17.596** (n=40) |
| 360 000 (L6) | **84.913** (n=12) | **164.657** (n=12) |
| 650 000 (L4) | **142.981** (n=5) | **295.572** (n=5) |

**Resample — whole record 360 → 128 Hz** ([`dsp.bench.ts`](../src/bench/dsp.bench.ts:122))

| Samples | `resampleSignal` |
|---|---|
| 3 600 | **2.051** (n=98) |
| 36 000 | **20.070** (n=40) |
| 360 000 | **195.039** (n=12) |
| 650 000 | **339.518** (n=5) |

## Pipeline — `buildModelInput` (float32, lead-b)

One sample = pack **every** 360-sample window of the record
([`pipeline.bench.ts`](../src/bench/pipeline.bench.ts:292)). Per-window time =
mean ÷ window count.

| Samples | Windows | Whole-record mean ms | Per-window µs |
|---|---|---|---|
| 3 600 | 10 | 0.057 (n=3498) | ≈5.7 |
| 36 000 | 100 | 0.540 (n=371) | ≈5.4 |
| 360 000 | 1000 | 5.375 (n=38) | ≈5.4 |
| 650 000 | 1805 | 9.720 (n=21) | ≈5.4 |

## Pipeline — `runExperiment` seam over the real ONNX probe

One sample = one complete evaluation of the record (read → window →
`buildModelInput` → real `onnxruntime-web` session inference per window →
sign-of-sum labeler → metrics) on the committed probe
`ecg-lab-probe-linear-mean-2` v1.0.0 ([`pipeline.bench.ts`](../src/bench/pipeline.bench.ts:325)).
**Seam-validation scope only.** Windows/second = window count ÷ (mean ms ÷ 1000).

| Samples | Windows | Whole-record mean ms | Windows / second | Per-window ms |
|---|---|---|---|---|
| 3 600 | 10 | 1.602 (n=125) | **≈6 244** | ≈0.160 |
| 36 000 | 100 | 11.670 (n=18) | **≈8 569** | ≈0.117 |
| 360 000 | 1000 | 121.203 (n=2) | **≈8 251** | ≈0.121 |
| 650 000 | 1805 | 214.221 (n=1)† | **≈8 426** | ≈0.119 |

† The 650 000 / 1805-window and 360 000 / 1000-window seam rows are
single/two-sample snapshots (each sample is a full-record real-ONNX
evaluation); the 650 000 row reports mean = min = the one sample.

## Headline reading (engineering throughput only)

- **Whole-record single-shot DSP ops on the ~30 min / 650 000-sample record**
  are 210 ms (filter), ~296 ms (DWT round-trip) and ~340 ms (resample) — all an
  order of magnitude above the ≈16.7 ms 60 fps frame budget. At 360 000 samples
  the same ops are ~119–195 ms. Whether these run on the main thread depends on
  whether the workload is processed whole-record or streamed window-by-window;
  the snapshot records both the whole-record cost and (for the seam) the
  per-window cost so that choice can be made from numbers.
- **Steady-state `runExperiment` seam throughput over real ONNX** is
  ≈8.2–8.6k windows/s at 100–1805 windows (per-window ≈0.12 ms) — the per-window
  cost is ~1/140 of a 60 fps frame; the thing that exceeds a frame is the
  *whole-record batch* (1000–1805 windows → 121–215 ms), which is the axis the
  worker-offload decision turns on (ADR-010).
- **`buildModelInput` packing is ~5.4 µs per window**, negligible relative to the
  per-window seam cost (~0.12 ms) — packing is not a bottleneck candidate.
- Cost scales ~linearly with record length for every whole-record axis, as
  expected for these algorithms.

These statements describe measured engineering throughput only. They prove what
the harness measured on this machine on this date; they do not by themselves
justify any optimization — per policy, any optimization re-runs this harness
before/after on the same machine, and the decisions the numbers support are
recorded in ADR-010.
