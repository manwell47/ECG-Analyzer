# Phase 10 Checkpoint — resumable state

Recorded 2026-09-04 ~20:20 (end of session, `c:/APPs/ECG DWT Analyzer`). Purpose:
start tomorrow with zero ambiguity about the verified state and the first step.

## Verified state (this workspace, 2026-09-04)

- **Phase 9 (measurement-only) is fully complete.** The final full gate was run
  at the end of session and passed: `npm run check` → typecheck ✓, svelte-check
  (0 errors / 0 warnings) ✓, lint ✓, **49 test files / 506 tests ✓**, Vite build
  ✓ (**135 modules / 76.32 kB**). Records: [`plans/phase-9-audit.md`](phase-9-audit.md:1).
- **NOT a git repository.** `git rev-parse` fails — there is no `.git` in this
  workspace despite the `.gitignore`. The committed artifacts below are the
  durable record; `bench-results/*.json` raw outputs are gitignored by
  convention (and would be untracked anyway).
- **Machine facts** (for the measurement snapshot): Windows 11, Node v24.18.0,
  npm 11.16.0, Vitest 3.2.7, Tinybench (vitest-bench) — see
  [`plans/phase-9-bench-policy.md`](phase-9-bench-policy.md:1).

## What exists (all built during Phase 9, no production-code change)

| Purpose | File |
|---|---|
| Deterministic per-size bench scenarios (3600 / 36 000 / 360 000 / 650 000 samples) | [`src/bench/scenarios.ts`](../src/bench/scenarios.ts:1) |
| Non-timing scenario tests (never wall-clock) | [`src/bench/__tests__/scenarios.test.ts`](../src/bench/__tests__/scenarios.test.ts:1) |
| DSP micro-benches (design+filter / normalize / segment / DWT db4 / resample × 4) | [`src/bench/dsp.bench.ts`](../src/bench/dsp.bench.ts:1) |
| `buildModelInput` + `runExperiment` real-ONNX seam (windows/sec) | [`src/bench/pipeline.bench.ts`](../src/bench/pipeline.bench.ts:1) |
| Measurement protocol (axis → §I worker table, machine snapshot, re-run cmds) | [`plans/phase-9-bench-policy.md`](phase-9-bench-policy.md:1) |
| 2026-09-04 baseline snapshot (numbers) | [`plans/phase-9-baseline.md`](phase-9-baseline.md:1) |
| ADR-010: measurement-first policy + worker/WASM/WebGPU decision status | [`plans/adr/ADR-010-performance-measurement-policy.md`](adr/ADR-010-performance-measurement-policy.md:1) |
| Phase 9 audit / completion | [`plans/phase-9-audit.md`](phase-9-audit.md:1) |

Raw outputs (gitignored, still on disk for reference):
`bench-results/2026-09-04-dsp-baseline.json`,
`bench-results/2026-09-04-pipeline-baseline.json`.

## 2026-09-04 headline numbers (snapshot, never a CI gate)

- **Whole-record DSP @650 000 samples:** segment 4.8 ms, normalize 16.5 ms, DWT
  db4 decompose 143 ms / round-trip 296 ms, zero-phase filter 210 ms, resample
  340 ms — all far over the ≈16.7 ms frame budget.
- **`buildModelInput`** ≈5.4 µs per 360-sample window — negligible.
- **`runExperiment` seam (real ONNX probe, whole-record sample):** 10 w → 1.6 ms,
  100 w → 11.7 ms, 1000 w → 121 ms, 1805 w → 214 ms; ≈8.2–8.6k windows/sec
  (≈0.12 ms/window). Seam-validation scope only.

## Re-run commands (if numbers are needed again)

- Full green gate: `npm run check`
- Full bench capture: `npm run bench` (writes nothing to disk unless asked)
- DSP capture: `npm run bench -- --run dsp.bench --outputJson ./bench-results/<date>-dsp-baseline.json`
- Pipeline/seam capture:
  `npm run bench -- --run pipeline.bench --outputJson ./bench-results/<date>-pipeline-baseline.json`
- Machine snapshot: `node -e "console.log(process.platform, process.arch, 'node', process.version)"`
  then `npm ls vitest tinybench`

## Where Phase 10 stands

**No Phase 10 plan exists and none is approved.** Phase 9 deliberately recorded
decisions without acting on them (ADR-010). Candidate directions the numbers
opened — each is a *candidate only*; none is auto-authorized, and per rules
§50/§52 any of them must be planned as a measured, gated increment:

1. **Worker offload (ADR-005 seam #3)** — wire real browser Worker glue so the
   whole-record DSP batch (4.8–340 ms) and the full-record inference batch
   (121–214 ms) leave the main thread. This is the strongest candidate from the
   numbers (matches §I worker table). Per-window streaming (≈0.12 ms/window)
   also remains numerically open.
2. **WASM DWT** — still deferred; DWT was not singled out vs filter/resample.
3. **WebGPU** — still deferred; no GPU path measured.

Also open (unrelated to measurement): nothing else is queued — Phases 1–9 are
all complete and audited.

## First action tomorrow (suggested)

1. Confirm green with a single `npm run check` (expect 49 files / 506 tests).
2. Author + approve a Phase 10 plan (Architect mode), item-by-item with green
   `npm run check` gates per item — same cadence as
   [`plans/phase-9-plan.md`](phase-9-plan.md:1). Start with deciding which
   candidate (if any) the user wants next; worker offload is the natural first.
