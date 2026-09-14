# Phase 12 Audit / Completion — Annotation rendering + proven multi-record selection

Recorded 2026-09-13 (Code-mode completion record). Verdict: **Phase 12 implemented
and fully green.** The full `npm run check` gate passes at the end of every item
and again as the final gate: typecheck ✓, svelte-check (0 errors / 0 warnings) ✓,
lint ✓, **58 test files / 574 tests** ✓, Vite build ✓ (**166 modules**).
**Presentation only:** no domain, parser, DSP/DWT, ML, worker or application code
changed. The scientific configuration stays `db4 / 4 / periodic`; annotations are
drawn as **events over the trace, never fused into the signal**, and no analysis
option or algorithm choice was added (ADR-008/009 hold).

## Scope / approved increment

> "Phase 12 = **A + B**: **A — Multi-record selection.** Choose among the records a
> local WFDB dataset exposes and re-analyze on switch. **B — Annotation
> rendering.** Draw the analyzed record's annotation events on the time-series
> view. This is a **presentation-layer** increment. No domain, DSP/DWT, ML, worker,
> parser or adapter code changes. Data still reaches the views only through the
> application service; the views stay display-only and never mutate source
> buffers."

This is a **display** increment. The two halves are deliberately asymmetric:

- **A was completed by evidence, not by code.** The `Record` combobox shipped in
  Phase 11 as a consequence of local ingestion and was already asserted (the option
  `700` appeared) but was **never switched** — there was no switch-record test and
  no multi-record fixture. Phase 12 adds the two-record fixture and the
  switch-record slice and changes **no production selection code**. The
  considered-and-rejected alternative (sourcing options from
  `service.listRecordIds()` on every render) is recorded in ADR-013.
- **B is genuinely new and needed no application change.** `AnalysisResult` already
  carries `sourceRecord.annotations` to the views (Phase 5 doc: "annotations and
  per-channel calibration remain available to the views without any downstream
  fusion"); the only production wiring is a single prop in `App.svelte`.

## Files added

| Purpose | File |
|---|---|
| Pure, DOM-free annotation→marker geometry helper (`AnnotationMarker`, `AnnotationMarkers`, `annotationMarkers()`, `EMPTY_MARKERS`) | [`src/presentation/views/timeSeries/annotationGeometry.ts`](../src/presentation/views/timeSeries/annotationGeometry.ts:1) |
| Node numerical gate for the helper (window mapping, half-open edges, clamp, non-zero start axis, density cap + `mergedCount`, `visibleCount`/`symbols`, empty, degenerate window) | [`src/presentation/views/timeSeries/__tests__/annotationGeometry.test.ts`](../src/presentation/views/timeSeries/__tests__/annotationGeometry.test.ts:1) |
| ADR-013: annotation display decision | [`plans/adr/ADR-013-annotation-display.md`](adr/ADR-013-annotation-display.md:1) |
| Phase 12 audit (this record) | [`plans/phase-12-audit.md`](phase-12-audit.md:1) |

**Touched:**

- [`src/presentation/views/timeSeries/TimeSeriesView.svelte`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:51)
  — added the `annotations?: readonly AnnotationEvent[]` prop (default `[]`), the
  `annotationResult` derived from `annotationMarkers(...)` (with a
  positive-safe-integer `columnCount` guard), the marker draw pass in `drawTrace()`
  (vertical stems + short symbol label), and the caption spans
  (`Annotations: none` / `Annotations: {n} in view` / ` ({m} merged)` and
  `Symbols: N, V`). The figure `aria-label` (channel identity) is unchanged.
- [`src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts`](../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:1)
  — four jsdom cases for the annotation caption (none / count / merged form /
  `Symbols:` legend); the existing caption and aria assertions are unchanged.
- [`src/presentation/App.svelte`](../src/presentation/App.svelte:400) — passes
  `annotations={result.sourceRecord.annotations}` to `TimeSeriesView` and extends the
  view note to state the events are display-only and never fused. No service call,
  option or science configuration added.
- [`src/presentation/__tests__/App.test.ts`](../src/presentation/__tests__/App.test.ts:1)
  — generalized the local fixture (`localHeader(recordId, frames)`,
  `localChannels(frames, baselines)`, a hand-built `.atr` via `pairBytes()` /
  `localAnnotations()`, and `localRecordFiles(recordId, frames, annotations?)` over
  two records `700` / `701`), plus **two** new cases: the end-to-end annotation
  caption and the switch-record slice. The previous six cases are unchanged.
- [`plans/ecg-lab-architecture.md`](ecg-lab-architecture.md:279) — §J bullet
  ("Annotations are displayed, never fused — realized"), §M item 12, and the
  decision-register entry (+ADR-013).

**Not touched (by design):** all of `src/domain/**` (`record.ts`, `sampling.ts`,
`signal.ts`, `units.ts`, `numeric.ts`, `error.ts`); all of `src/datasets/**`
(parsers [`header.ts`](../src/datasets/mitbih/header.ts:1) / `format212.ts` /
`atr.ts`, [`adapter.ts`](../src/datasets/mitbih/adapter.ts:182),
[`fileSource.ts`](../src/datasets/fileSource.ts:56), `catalog.ts`, `load.ts`) —
**no `.atr` encoder was added; the parser stays parse-only**; all of `src/dsp/**`,
`src/ml/**`, `src/workers/**`, `src/bench/*`; and
[`src/application/analysis.ts`](../src/application/analysis.ts:1) /
`defaults.ts` / `dspExecutor.ts`, `src/presentation/dataset/*`,
`src/presentation/workers/*`, [`src/main.ts`](../src/main.ts:34). No new dependency
and no `tsconfig`/`vite.config.ts` change. Rules §30 (no duplicated science) held.

## Item-by-item mapping

0. **Pre-flight** — `npm run check` green (**57 files / 556 tests, 165 modules**);
   no files touched.
1. **Pure annotation helper** — `annotationGeometry.ts` +
   `annotationGeometry.test.ts`; `npm run check` green (**58 files / 568 tests,
   165 modules**; +1 file, +12 tests).
2. **`TimeSeriesView` annotation rendering** — prop, marker draw pass, caption
   spans + 4 jsdom cases; `npm run check` green (**58 files / 572 tests, 166
   modules**; +4 tests; the +1 module is the new helper imported by the view).
3. **App wiring + end-to-end non-empty annotation** — one prop in `App.svelte`,
   the hand-built `.atr` fixture and the annotation-caption case in `App.test.ts`;
   `npm run check` green (**58 files / 573 tests, 166 modules**; +1 test).
4. **Multi-record selection proof** — two-record fixture + switch-record case;
   `npm run check` green (**58 files / 574 tests, 166 modules**; +1 test; **no
   production change**).
5. **ADR-013 + architecture update** — ADR-013 written; §J / §M item 12 / decision
   register updated; `npm run check` green (**58 files / 574 tests, 166 modules** —
   docs-only, counts unchanged).
6. **Audit + final gate (this record)** — final full `npm run check` green
   (**58 files / 574 tests, 166 modules**).

## Evidence (the correctness gates)

The correctness claims are pinned by tests at three levels, never by pixels or
timings:

- **Numerical gate (Node) —**
  [`annotationGeometry.test.ts`](../src/presentation/views/timeSeries/__tests__/annotationGeometry.test.ts:1)
  covers the pure helper directly: window mapping through
  [`sampleWindowOfTime()`](../src/presentation/views/timeSeries/geometry.ts:104);
  half-open edges (an annotation exactly at `startSample` is included, at
  `endSample` excluded); `xFraction` clamping to `[0, 1]`; a non-zero `startTimeSec`
  axis; the density cap (at most one marker per column) with `mergedCount`
  accounting; `visibleCount` and the sorted `symbols` legend; empty annotations; and
  a degenerate window. All time↔sample arithmetic goes through
  [`src/domain/sampling.ts`](../src/domain/sampling.ts:1) — the sample math is never
  re-implemented.
- **Markup gate (jsdom) —**
  [`TimeSeriesView.test.ts`](../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:1)
  asserts the exact caption strings (`Annotations: none`, `Annotations: {n} in
  view`, the `(N merged)` form, `Symbols: N, V`) while `getContext` is stubbed to
  `null`. jsdom has no 2d canvas context, so canvas **drawing** is never the gate;
  the numerical truth lives in the Node helper test above.
- **End-to-end gate (jsdom over the real service path) —**
  [`App.test.ts`](../src/presentation/__tests__/App.test.ts:341) opens the local
  files, awaits `mit-bih-arrhythmia / 700`, and asserts `Annotations: 2 in view` and
  `Symbols: N, V` (and that `Annotations: none` is gone), with the non-empty
  rendering reached through genuine `File` bytes — the `.atr` is hand-built with the
  byte-pair pattern from
  [`adapter.test.ts`](../src/datasets/mitbih/__tests__/adapter.test.ts:28)
  (`[3, 4]` → `'N'` at sample 3, `[241, 21]` → `'V'` at sample 500, `[0, 0]` EOF).
  The switch-record case at
  [`App.test.ts`](../src/presentation/__tests__/App.test.ts:369) moves the display
  selection (Channel `V5`, Viewport index `2`) before switching, so the
  post-switch assertions (identity `… / 701` and `…/701 :: dwt-db4-level4-periodic`,
  the `700` identity gone, Channel back to `MLII`, Viewport back to `0`, `512
  samples`, `Annotations: none`) prove `analyzeRecordById` actually re-ran and reset
  the display selection rather than leaving it coincidentally equal.

## Decisions recorded (ADR-013)

1. **The geometry is a single pure, tested helper** —
   [`annotationMarkers()`](../src/presentation/views/timeSeries/annotationGeometry.ts:1)
   is the only annotation→marker mapping; the view consumes it and adds no
   arithmetic of its own.
2. **Annotations are displayed as events, never fused** — markers are drawn in the
   same canvas pass but never enter the signal, DSP or analysis; no clinical claim
   is made and no detection is implied.
3. **The view owns rendering, the parent owns data** —
   [`TimeSeriesView.svelte`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:51)
   gains an optional `annotations` prop; `App.svelte` forwards
   `result.sourceRecord.annotations`. No application change (ADR-009 holds).
4. **Multi-record selection is proved, not rebuilt** — the Phase-11 discovery
   wiring (`recordIds`, `selectedRecordId`, `handleRecordChange`,
   `analyzeRecordById`) is kept exactly; Phase 12 adds only the two-record fixture
   and the switch test. The alternative of calling `service.listRecordIds()` per
   render was **rejected** (a second source of truth and a redundant round trip for
   no behavioural gain).
5. **Testability split** — the numerical truth is the Node helper test; the jsdom
   tests assert markup/caption only (canvas pixels are never a gate).

## What Phase 12 proves and does not prove

**Proves** — the analyzed record's own annotation events are rendered on the
time-series view as display-only markers, with an exact, tested caption
(`Annotations: …` / `Symbols: …`) and density accounting that never silently drops
events from the count; the helper maps samples to visible columns using only the
domain conversions; a non-empty rendering is reachable end-to-end from genuine
local WFDB bytes through the real application service; and switching the `Record`
combobox re-analyzes the chosen id and resets the display selection (multi-record
selection works, proven without production change).

**Does not prove** — that the markers are **detections**. They are the file's own
annotations, not a beat detector, and no clinical or model-quality claim is made
(rules §47/§49; ADR-009). It does not prove canvas rendering fidelity — jsdom
cannot draw, so pixel output is unverified and remains a manual concern. It does
not add or verify any WFDB encoding: the `.atr` parser stays parse-only and the
test `.atr` is fabricated by hand, so no round-trip claim is made. It does not
exercise the annotation path over the full MIT-BIH dataset (the opt-in real-data
test from Phase 11 is unchanged and dataset-absence-skipped).

## Residual risk

- **Canvas drawing is not the gate** — jsdom has no 2d context, so the marker pass
  in [`drawTrace()`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:117)
  is covered by typecheck + lint + build and by the helper's numerical tests, but
  the actual pixels are verified only by hand under `npm run dev`.
- **The `.atr` fixtures are hand-built** — the repo has a parser but no encoder, so
  the App fixtures construct byte pairs directly (the established `adapter.test.ts`
  pattern). A malformed hand-built `.atr` would fail the slice loudly, not silently.
- **Density behaviour on very large records is reasoned, not measured** — the cap
  merges per column and `visibleCount` still counts every event, but no wall-clock
  timing is asserted (performance is never a Phase-12 gate; ADR-010 governs
  measurement).

## Test counts

Final `npm run check`: **58 test files / 574 tests** (Phase-11 close: 57 / 556;
+1 file, +18 tests). Build: **166 modules** (Phase-11 close: 165; +1 for the
annotation helper imported by the view).

New test file and its contribution:

| File | Tests |
|---|---|
| [`annotationGeometry.test.ts`](../src/presentation/views/timeSeries/__tests__/annotationGeometry.test.ts:1) | +12 (Node) |

Added to existing files:
[`TimeSeriesView.test.ts`](../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:1)
(+4 jsdom) and [`App.test.ts`](../src/presentation/__tests__/App.test.ts:1)
(+2 end-to-end; the previous six cases unchanged).

**Gate history:** 0 → 57/556/165 · 1 → 58/568/165 · 2 → 58/572/166 · 3 →
58/573/166 · 4 → 58/574/166 · 5 → 58/574/166 · 6 → 58/574/166.

## References

- [phase-12-plan.md](phase-12-plan.md:1) — the approved plan executed above.
- [ADR-013-annotation-display.md](adr/ADR-013-annotation-display.md:1) — the
  annotation-display decision.
- [ADR-008-display-selection-controls.md](adr/ADR-008-display-selection-controls.md:1)
  / [ADR-009-application-experiment-placement.md](adr/ADR-009-application-experiment-placement.md:1)
  — "selection is a display concern"; no UI-owned science.
- [phase-11-audit.md](phase-11-audit.md:1) — the ingestion increment this phase
  builds on.
- [ecg-lab-architecture.md](ecg-lab-architecture.md:279) — §J / §M item 12 /
  decision register.
