# Phase 9 Audit / Completion — Optimization (Measurement-Driven)

Recorded 2026-09-04 (Code-mode completion record). Verdict: **Phase 9
implemented and fully green.** The full `npm run check` gate passes at the end
of every item and again as the final gate: typecheck ✓, svelte-check (0 errors /
0 warnings) ✓, lint ✓, **49 test files / 506 tests** ✓, Vite build ✓ (135
modules). **Measurement-only:** no production scientific code was changed; the
only non-`plans/` edits are harness/config (`.gitignore`, `package.json`
`bench` script, `vite.config.ts` bench block, `src/bench/**`).

## Scope / approved increment

> "Measurement-only Phase 9: build the vitest-bench harness over `src/bench/`,
> deterministic scenario inputs (3600..650000 samples), run baselines for DSP
> (filter/normalize/segment/DWT db4/resample), `buildModelInput`, and a
> `runExperiment` seam over the real ONNX probe; record numbers + a gitignored
> raw-output dir + committed policy/README; record worker/WASM/WebGPU deferral
> decisions in ADR-010 with the measured numbers. NO production-code
> optimization this phase … Also delete the stray `tmp_split_oracle.cjs`
> pre-flight."

## Files added (Items 1–7)

| Purpose | File |
|---|---|
| Deterministic per-size scenarios + prepared operands (no I/O) | [`src/bench/scenarios.ts`](../src/bench/scenarios.ts:1) |
| Non-timing scenario tests — size/determinism/validity only (never duration) | [`src/bench/__tests__/scenarios.test.ts`](../src/bench/__tests__/scenarios.test.ts:1) |
| DSP micro-benchmarks: design+filter / normalize / segment / DWT db4 / resample × 4 sizes | [`src/bench/dsp.bench.ts`](../src/bench/dsp.bench.ts:1) |
| ML/pipeline bench: `buildModelInput` + `runExperiment` real-ONNX seam (seam-validation scope) | [`src/bench/pipeline.bench.ts`](../src/bench/pipeline.bench.ts:1) |
| Measurement policy / protocol (machine snapshot, re-run, §I axis mapping, "not a CI gate") | [`plans/phase-9-bench-policy.md`](phase-9-bench-policy.md:1) |
| 2026-09-04 baseline snapshot (this machine's numbers, labelled a snapshot) | [`plans/phase-9-baseline.md`](phase-9-baseline.md:1) |
| ADR-010: measurement-first policy + worker/WASM/WebGPU decision status | [`plans/adr/ADR-010-performance-measurement-policy.md`](adr/ADR-010-performance-measurement-policy.md:1) |
| Phase 9 audit (this record) | [`plans/phase-9-audit.md`](phase-9-audit.md:1) |

**Touched:** `.gitignore` (`/bench-results/`), `package.json` (`bench` script —
never added to `check`), `vite.config.ts` (`test.bench.include` confines `vitest
bench` to `src/bench/**/*.bench.ts`), and
[`plans/ecg-lab-architecture.md`](ecg-lab-architecture.md:255) (§I WASM/WebGPU
bullets annotated + measured-baseline pointer, §M item 9 completion note,
decision register +ADR-010 line).

**Deleted (Item 0):** the stray throwaway
[`tmp_split_oracle.cjs`](../tmp_split_oracle.cjs) from the repo root (its oracle
is fully covered by committed tests).

**Gitignored raw outputs (not committed):**
`bench-results/2026-09-04-dsp-baseline.json`,
`bench-results/2026-09-04-pipeline-baseline.json` (raw per-case JSON from
`vitest bench --outputJson`).

## Item-by-item mapping

0. **Pre-flight cleanup** — deleted `tmp_split_oracle.cjs`; `npm run check`
   green (48 files / 492 tests).
1. **Harness scaffold + config** — bench include in `vite.config.ts`, `bench`
   npm script (out of `check`), `/bench-results/` in `.gitignore`; verified
   `vitest bench` reports only `src/bench/` files; `npm run check` green.
2. **Deterministic scenario inputs** — `scenarios.ts` (4 sizes, memoized
   operands) + `scenarios.test.ts` asserting size/determinism/validity only;
   `npm run check` green (test-file count → 49, +14 tests).
3. **DSP micro-benchmarks** — `dsp.bench.ts` (design/filter, normalize,
   segment, DWT db4 decompose+round-trip, resample) across the four sizes;
   `npm run check` green; local capture → `2026-09-04-dsp-baseline.json`.
4. **ML/pipeline bench (seam-validation)** — `pipeline.bench.ts`
   (`buildModelInput` packing + `runExperiment` real-ONNX seam); header states
   seam-validation / non-clinical scope; `npm run check` green; local capture →
   `2026-09-04-pipeline-baseline.json`. (See measurement note below: the seam
   runner does not execute suite hooks, so the seam engine is created lazily on
   the first warm-up sample.)
5. **Policy + baseline snapshot** — `phase-9-bench-policy.md` +
   `phase-9-baseline.md` committed; raw JSON stays gitignored; `npm run check`
   green.
6. **ADR-010 + architecture update** — ADR-010 written (numbers behind the
   decisions); architecture §I annotated + pointer, §M item 9 completion noted,
   decision register +ADR-010; `npm run check` green.
7. **Audit + final gate (this record)** — full `npm run check` green (49 files
   / 506 tests).

## Headline numbers (2026-09-04 snapshot — not a gate)

Mean per sample, engineering throughput only; full tables in
[`plans/phase-9-baseline.md`](phase-9-baseline.md:1).

- **Whole-record DSP on the 650 000-sample (~30 min) record:** segment 4.8 ms,
  normalize 16.5 ms, DWT db4 decompose 143 ms / round-trip 296 ms, zero-phase
  filter 210 ms, resample 340 ms. At 360 000 samples: filter 119 ms, DWT
  round-trip 165 ms, resample 195 ms. Ops scale ~linearly with record length.
- **`buildModelInput` (float32, lead-b):** ≈5.4 µs per 360-sample window —
  negligible next to inference.
- **`runExperiment` seam over the real ONNX probe (whole-record sample):**
  10 w → 1.6 ms, 100 w → 11.7 ms, 1000 w → 121 ms, 1805 w → 214 ms; steady
  state ≈8.2–8.6k windows/second (≈0.12 ms/window). Seam-validation scope only.

## Decisions recorded (ADR-010)

1. **Measurement-first policy** — no optimization without a measured bottleneck;
   every optimization re-runs the harness before/after on the same machine;
   timing is a snapshot, never a CI gate (rules §50/§51/§52).
2. **Worker offload** — whole-record DSP (4.8–340 ms) and full-record seam
   batches (121–214 ms) exceed the ≈16.7 ms frame budget, supporting the §I
   worker placement for CPU-bound whole-record work and inference; real browser
   **Worker glue stays unwired (seam #3)** — a later-phase task. Per-window
   streaming (≈0.12 ms) also remains numerically open.
3. **WASM DWT** — TS db4 baseline now recorded; DWT is not singled out as the TS
   bottleneck next to filter/resample, so the ADR-003/§I **deferral stands**.
4. **WebGPU** — CPU-WASM comparison point recorded; no GPU path measured and
   the browser-support question is unresolved, so **WebGPU remains deferred**.

## What measurement proves and does not prove

**Proves** — the harness is wired and reproducible: deterministic in-memory
operands (`scenarios.ts`), non-timing shape tests under `check`, clean per-file
captures with `npm run bench -- --run … --outputJson`, and a committed
2026-09-04 snapshot whose scaling shapes (whole-record ≈ linear; per-window
constants) are the stable facts. It proves the real-ONNX seam runs to
steady-state throughput on this machine and exits cleanly.

**Does not prove** — any clinical/model-performance property (seam numbers are
throughput only, §47/§49); any timing claim on another machine or under load;
that any optimization is warranted. A number alone never authorizes changing
scientific results or duplicating logic across runtimes (rules §30). The
650 000-sample seam row (and the 360 000 seam row) is a single/two-sample
snapshot — each sample is a full-record real-ONNX evaluation — and the
vitest-bench limitation (no suite hooks in benchmark mode) shaped the harness
design, which is documented in the policy and bench header.

## Test counts

Final `npm run check`: **49 test files / 506 tests** (Phase-8 close: 48 / 492).
The only increase is [`scenarios.test.ts`](../src/bench/__tests__/scenarios.test.ts:1)
(+14 non-timing tests). No committed test asserts a wall-clock duration (rules
§51); `npm run bench` is local-only and outside `npm run check`.
