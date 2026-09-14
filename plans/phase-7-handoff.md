# Phase 7 Handoff — resumable state

Recorded 2026-09-03 (before a planned PC shutdown). Purpose: resume tomorrow
with zero ambiguity about where the increment stands.

## Active increment (approved)

> "Plan Phase 7 AND close the Phase-6 ONNX seam first: install onnxruntime-web,
> commit a tiny test `.onnx` + metadata, add the real-session integration test
> (Signal → ModelInput → session → interpret), then build the views."

Frontend decision already made: **Svelte** for the presentation layer
(`@testing-library/svelte` in jsdom); ADR-008 is to be written to record it.

The executable plan lives as a 13-item checklist (items 1–13 below). Only item
#1 has been started. Baseline was fully green before starting.

## Verified state

- **Baseline green** (just before item #1): `npm run check` passed — typecheck,
  lint, **31 test files / 324 tests**, Vite build. Node v24.18.0, npm 11.16.0.
- **Phase 6 audit complete & conformant**, recorded in `plans/phase-6-audit.md`
  (ADR-004/005 conformance tables + 3 non-blocking seams: real-ONNX path
  compile-only, worker protocol inference-only, no real Worker wiring).
- Phases 1–6 implemented (`src/domain`, `src/dsp` incl. `dwt`, `src/datasets`
  incl. mitbih/synthetic, `src/ml` incl. `onnx` + `testing`, `src/workers`).
  No `src/application/`, no `src/presentation/` yet. `src/main.ts` is still the
  Phase-1 stub.

## Item #1 status — package present; verify `package.json` on resume

`npm install onnxruntime-web` was started at ~23:45. Before shutdown,
`node_modules/onnxruntime-web/` was confirmed **present and fully extracted**
(`package.json`, `types.d.ts`, `README.md`, `lib/`, `docs/`) — the dependency
effectively installed.

Resume steps for item #1 (quick verify only):

1. `npm ls onnxruntime-web` and inspect `package.json`: expect a new
   `"dependencies": { "onnxruntime-web": "^…" }` block (there was previously
   **no** `dependencies` section, only `devDependencies`). If `package.json`
   was left un-written by the shutdown, re-run `npm install onnxruntime-web`.
2. If node_modules looks partial: re-run `npm install onnxruntime-web`.
3. Also install `onnxruntime-node` **as a devDependency** only if the Node-based
   vitest integration test needs the native binding:
   `npm install -D onnxruntime-node`. First try running `onnxruntime-web` in a
   Node vitest file (it supports Node); externalize it if needed via
   `test.server.deps.external` in `vitest.config.ts`.

## Remaining checklist (items 2–13)

2. **Delete** `src/ml/onnx/onnxruntime-web.d.ts` (its header says so once the
   real package is installed), then adjust `src/ml/onnx/ortWebEngine.ts` typing
   (`env`/session surface) so it compiles against the **real** package types
   with zero behavior change. Gate: `npm run typecheck`.
3. Produce a tiny **committed deterministic ONNX model** + matching
   `ModelMetadata.json` (float32; a 360 Hz single-channel window) with
   provenance; place under a committed fixtures location (see
   `data/fixtures/reference/` precedent and `src/fixtures/` loader pattern) and
   add a test-readable loader.
4. Add a **real-session integration test** (Node vitest file; onnxruntime-node
   only if needed): parse metadata → `assertValidModelMetadata` →
   `buildModelInput` from a prepared window → `createOnnxWebEngine` → `run` →
   assert deterministic outputs → `interpretPrediction` → assert semantics/label.
5. Introduce **`src/application/`** minimal orchestration (load record via
   dataset adapter, run preprocessing/DWT, return a domain-typed
   `AnalysisResult`) used by tests and views; dependency direction
   presentation → application → domain/dsp/datasets/workers is preserved.
6. **Generalize the worker protocol** to a DSP/DWT request kind sharing the
   requestId/signalId identity echo (`src/workers/types.ts`, `core.ts`), with a
   worker-side handler reusing shared dsp modules (no duplicated logic) plus an
   in-memory Node test.
7. **Adopt the Svelte stack**: `svelte` + `@sveltejs/vite-plugin-svelte` +
   `@testing-library/svelte` + `jsdom` + `svelte-check` devDependencies, a
   `svelte.config.js`, Svelte plugin in `vite.config`, and jsdom test slices.
   Record as **ADR-008**.
8. Replace the `src/main.ts` stub with a real **bootstrap**: mount a Svelte
   app, load a default fixture record through the application service, render
   views.
9. Canvas **time-series Svelte view** driven by domain types (`sampleIndex`/fs
   time axis, explicit unit labels, amplitude from signal units; never mutates
   data). Factor viewport→sample mapping into pure helpers with Node unit tests.
10. Canvas **DWT coefficient Svelte view** driven by `WaveletDecomposition`
    (approx + per-level details; approximate level→freq band from fs where
    flagged); factor math into pure tested helpers.
11. Thin Svelte **interaction controls** (channel + viewport selection) wired to
    the application service; UI behavior tests in jsdom only, never the
    numerical correctness gate.
12. **Full green gate**: `npm run check` (typecheck + lint + test + build), fix
    failures, confirm coverage for new modules.
13. **Docs**: write ADR-008, close the ONNX-seam record in
    `plans/phase-6-audit.md`, note model-artifact provenance.

## Key files to touch next

- `src/ml/onnx/onnxruntime-web.d.ts` → delete (item 2)
- `src/ml/onnx/ortWebEngine.ts` → retype against real package (item 2)
- `data/fixtures/` or a new committed model-artifact dir + `src/` loader
  (item 3); note `src/ml/onnx/index.ts` and `src/ml/index.ts` barrels
- Integration test location: `src/ml/onnx/__tests__/*.test.ts` (item 4)
- New `src/application/*` + `__tests__` (item 5)
- `src/workers/{types,core}.ts` + tests (item 6)
- `svelte.config.js`, `vite.config.ts` (none exists yet — only
  `vitest.config.ts`), `index.html`, new `src/presentation/**` (items 7–11)
- `src/main.ts` (item 8)
