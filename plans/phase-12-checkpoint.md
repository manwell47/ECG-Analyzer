# Phase 12 Checkpoint — resumable state

Recorded 2026-09-13 ~22:36 (end of session, `c:/APPs/ECG DWT Analyzer`). Purpose:
start the next session with zero ambiguity about the verified state, the durable
artifacts, and the first step.

## Verified state (this workspace, 2026-09-13)

- **Phase 12 is complete and fully green.** The final full gate was run at the end
  of session and passed: `npm run check` → typecheck ✓, svelte-check
  (**0 errors / 0 warnings**) ✓, lint ✓, **58 test files / 574 tests** ✓, Vite
  build ✓ (**166 modules**). Completion record:
  [`plans/phase-12-audit.md`](phase-12-audit.md:1).
- **Phases 1–12 are all complete, audited and green.** The active increment was
  **Phase 12 = A (multi-record selection) + B (annotation rendering)** — a
  **presentation-only** phase. No domain, parser, adapter, DSP/DWT, ML, worker or
  application file changed.
- **NOT a git repository.** `git rev-parse --is-inside-work-tree` fails — there is
  no `.git` in this workspace despite the `.gitignore`. The committed artifacts
  under `plans/` are the durable record.
- **Machine facts:** win32 x64, Windows 11, Node **v24.18.0**, npm **11.16.0**,
  Vitest **3.2.7**, Svelte 5.57, `@sveltejs/vite-plugin-svelte` 5.1.1,
  `@testing-library/svelte` 5.4.2, jsdom 30, TypeScript 5.7, Vite 6.4.3,
  onnxruntime-web 1.29.0.

## What Phase 12 added / changed

| Purpose | File |
|---|---|
| Pure, DOM-free annotation→marker helper (`AnnotationMarker`, `AnnotationMarkers`, `annotationMarkers()`, `EMPTY_MARKERS`) | [`src/presentation/views/timeSeries/annotationGeometry.ts`](../src/presentation/views/timeSeries/annotationGeometry.ts:1) |
| Node numerical gate for the helper (12 tests) | [`src/presentation/views/timeSeries/__tests__/annotationGeometry.test.ts`](../src/presentation/views/timeSeries/__tests__/annotationGeometry.test.ts:1) |
| ADR-013: annotation display decision | [`plans/adr/ADR-013-annotation-display.md`](adr/ADR-013-annotation-display.md:1) |
| Phase 12 audit / completion | [`plans/phase-12-audit.md`](phase-12-audit.md:1) |

**Touched:**

- [`TimeSeriesView.svelte`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:51)
  — optional `annotations` prop (default `[]`), the `annotationResult` derived from
  `annotationMarkers(...)` (positive-safe-integer `columnCount` guard), the marker
  draw pass in `drawTrace()`, and the caption spans (`Annotations: none` /
  `{n} in view` / ` ({m} merged)` + `Symbols: …`). The figure `aria-label` is
  unchanged.
- [`TimeSeriesView.test.ts`](../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:1)
  — +4 jsdom cases (caption none / count / merged / symbols); existing assertions
  unchanged.
- [`App.svelte`](../src/presentation/App.svelte:400) — forwards
  `annotations={result.sourceRecord.annotations}` and extends the view note. **No**
  service call, option or science configuration added.
- [`App.test.ts`](../src/presentation/__tests__/App.test.ts:1) — generalized the
  local fixture (`localHeader(recordId, frames)`, `localChannels(frames,
  baselines)`, a hand-built `.atr` via `pairBytes()` / `localAnnotations()`,
  `localRecordFiles(recordId, frames, annotations?)`) over two records `700`/`701`,
  plus **2** new cases (end-to-end annotation caption; switch-record proof). The
  previous six cases are unchanged.
- [`plans/ecg-lab-architecture.md`](ecg-lab-architecture.md:279) — §J bullet
  ("Annotations are displayed, never fused — realized"), §M item 12, and the
  decision-register entry (+ADR-013).

**Not touched (by design):** all of `src/domain/**`; all of `src/datasets/**`
(the `.atr` parser stays **parse-only — no encoder was added**); all of
`src/dsp/**`, `src/ml/**`, `src/workers/**`, `src/bench/*`; and
`src/application/analysis.ts` / `defaults.ts` / `dspExecutor.ts`,
`src/presentation/dataset/*`, `src/presentation/workers/*`, `src/main.ts`. No new
dependency and no `tsconfig` / `vite.config.ts` change.

## Headline behaviour (what now visibly works)

- **Annotation overlay (B, new).** The analyzed record's own annotation events are
  drawn on the time-series canvas as display-only markers, **density-capped to one
  per pixel column**, with an exact caption (`Annotations: none` / `n in view` /
  `(m merged)` + a `Symbols:` legend). The marker pass only reads; source
  `Float64Array`s are never mutated; nothing fuses annotations into DSP/analysis.
- **Multi-record selection (A, proved).** The `Record` combobox delivered in
  Phase 11 now has the missing evidence: a two-record jsdom fixture switches to
  record `701` and asserts the identity + analysis-id change
  (`… / 701`, `…/701 :: dwt-db4-level4-periodic`) plus the first-channel / full-window
  display reset. **No production selection code was changed.**
- The synthetic boot record still renders `Annotations: none` (its generator always
  sets `annotations: []`); a non-empty overlay is reachable only via a real/local
  record, where the test hand-builds a minimal `.atr`.

## Gate history (Phase 12)

`0 → 57/556/165` · `1 → 58/568/165` · `2 → 58/572/166` · `3 → 58/573/166` ·
`4 → 58/574/166` · `5 → 58/574/166` · `6 → 58/574/166`
(files / tests / build modules). The +1 test file and +18 tests are Phase 12's own;
the +1 build module is the new annotation helper imported by the view.

## Re-run commands

- Full green gate: `npm run check`
- Test suite only: `npm run test`
- Dev server (manual canvas / ingestion check — jsdom cannot draw):
  `npm run dev`
- Machine snapshot: `node -v && npm -v && npx vitest --version`

## What Phase 12 proves and does not prove (honest limits)

- **Proves** — annotations are rendered as display-only events with a tested,
  deterministic caption; the helper maps samples to columns using only the domain
  conversions; a non-empty overlay is reachable end-to-end through the real
  application service; and switching records re-analyzes and resets the display
  selection.
- **Does not prove** — that markers are **detections** (they are the *file's*
  annotations, never a beat detector — no clinical/model claim; rules §47/§49);
  canvas pixel fidelity (jsdom has no 2d context, so drawing is manual-only); any
  WFDB **encoding** (parser is parse-only, fixtures are hand-built); or the
  annotation path over the full real MIT-BIH dataset (the Phase-11 opt-in real-data
  test is unchanged and dataset-absence-skipped).

## Where the project stands / candidates for next

No next phase is proposed or approved. Phases 1–12 are complete; ADR-010 governs
optimization (measurement-first) and its deferrals still stand. Candidate
directions — **each a candidate only; none is auto-authorized**, and per rules
§50/§52 any of them must be planned as a measured, gated, itemized increment
(Architect plan → approval → Code execution with a green gate per item):

1. **WASM DWT** — still **deferred** (ADR-010). Phase 9's numbers do not single out
   DWT next to filter/resample; a WASM path would need a parity gate first.
2. **WebGPU inference** — still **deferred** (ADR-010). No GPU path has been
   measured; only batch inference where it demonstrably wins is in scope.
3. **Annotation interaction (presentation follow-on).** e.g. hover/click a marker to
   show its `symbol` / `auxNote`, or a symbol filter — display-only, must not imply
   detection, and would extend `annotationGeometry` + `TimeSeriesView` with jsdom
   tests (same gates as Phase 12).
4. **Real-browser + real-data hardening.** Manually exercise the local-ingestion and
   annotation overlay under `npm run dev` in a real browser (the residual manual-only
   risks), and consider an opt-in real-data annotation integration test alongside the
   existing real-data ingestion test.
5. **A new dataset adapter** (e.g. another ECG DB or a richer synthetic generator) —
   adds an adapter behind the canonical `SignalRecord`; DSP/UI/ML untouched (§J).

## First action next session (suggested)

1. Confirm green with a single `npm run check` (expect **58 files / 574 tests**,
   build **166 modules**; svelte-check 0/0).
2. Decide with the user which candidate (if any) is next; then author + approve a
   next-phase plan in **Architect** mode, itemized with a green `npm run check` gate
   per item — same cadence as [`plans/phase-12-plan.md`](phase-12-plan.md:1) and
   [`plans/phase-10-plan.md`](phase-10-plan.md:1).
3. Read [`plans/phase-12-audit.md`](phase-12-audit.md:1) for the exact Phase-12
   scope/evidence and [`plans/adr/ADR-013-annotation-display.md`](adr/ADR-013-annotation-display.md:1)
   for the display decision before changing any view code.

## Key references

- [`plans/phase-12-plan.md`](phase-12-plan.md:1) — the approved plan executed this
  session (status line kept as written, per repo convention; completion is in the
  audit).
- [`plans/phase-12-audit.md`](phase-12-audit.md:1) — item map, evidence, limits.
- [`plans/adr/ADR-013-annotation-display.md`](adr/ADR-013-annotation-display.md:1) —
  the annotation-display decision.
- [`plans/ecg-lab-architecture.md`](ecg-lab-architecture.md:279) — §J / §M /
  decision register (current source of truth for scope).
- [`plans/phase-11-audit.md`](phase-11-audit.md:1) — the ingestion increment this
  phase built on.
- [`plans/phase-10-checkpoint.md`](phase-10-checkpoint.md:1) — the checkpoint
  template this record mirrors.
