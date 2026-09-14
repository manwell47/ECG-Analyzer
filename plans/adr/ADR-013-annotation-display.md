# ADR-013 — Annotation display over the canonical record (+ the completed record selector)

Status: Accepted
Date: 2026-09-13
Scope: Phase 12 — **presentation only**. The time-series view overlays a record's
canonical `AnnotationEvent`s as display-only markers, and the already-implemented
Record selector is *proved* to re-analyze another discovered record. No parser,
adapter, DSP/DWT, ML or application-service change; no new science configuration
in the UI.

## Context

The canonical model has carried annotations since Phase 5 and the application has
carried them to the UI since Phase 7:

- [`AnnotationEvent`](../../src/domain/record.ts:46) on
  [`SignalRecord.annotations`](../../src/domain/record.ts:85) — absolute,
  ascending sample indices with a symbol/code and an aux note;
- the MIT-BIH adapter decodes `.atr` through
  [`parseMitBihAtr`](../../src/datasets/mitbih/atr.ts:143) and degrades a missing
  file to `annotations: []` (never synthetic data);
- [`AnalysisResult.sourceRecord`](../../src/application/analysis.ts:87) already
  documents that the record's annotations stay available to views "without any
  downstream fusion" — no filter, DWT, feature or model path consumes them.

Until Phase 12 **no view drew them**. A user who analyzed a real annotated record
saw a trace and a coefficient stack but no beats: the data was present in the
result and invisible in the lab. Two hazards shaped the rendering decision:

1. **Scale.** A 30-minute beat series is ~100k events; a naive DOM marker list
   (or a per-sample scan) would drown both the trace and the main thread.
2. **Meaning.** Markers must never read as *detections*. They are the source
   file's own annotations; the phase may not imply a model or algorithm produced
   them (rules §47/§49; ADR-009's "seam-validation, never a clinical claim").

A third, separate honesty point drove the rest of the phase: the Record
`<select>`, `handleRecordChange` and `analyzeRecordById` were written in Phase 11
and asserted, but **never switched in a test**, so multi-record selection was
implemented and unproven.

Constraints:

- **No science change** and no UI-owned science (ADR-008/009): the view displays
  exactly what the service returned.
- **Display-only:** signal and annotation buffers are read, never mutated, and
  never fused into the signal.
- **jsdom has no 2d canvas context:** the mapping must be a pure, Node-testable
  helper; the DOM slice can only assert markup/caption.
- **No new dependency, no tsconfig/lib change**, and no production selection code
  changes for the multi-record proof.

## Decision

### (a) One pure helper maps annotations onto the visible viewport

[`annotationMarkers(annotations, viewport, sampling, sampleCount, columnCount)`](../../src/presentation/views/timeSeries/annotationGeometry.ts:105)
is the single definition of the mapping (returning
[`AnnotationMarkers`](../../src/presentation/views/timeSeries/annotationGeometry.ts:51)):

- **visibility** — half-open sample window `[startSample, endSample)` from
  [`sampleWindowOfTime`](../../src/presentation/views/timeSeries/geometry.ts),
  i.e. the same window the trace is decimated with, so markers and trace can
  never disagree about what "in view" means;
- **position** — `xFraction` from the domain's own
  `timeSecOfSample`/`SamplingInfo` conversion (ADR-001), clamped to `[0, 1]` so
  a boundary event never draws outside the plot;
- **density cap** — at most one marker per pixel column
  (`floor(xFraction * columnCount)`, clamped), merged per column with the
  **lowest** sample index as representative regardless of input order; every
  event stays counted in `visibleCount`, every collapsed one in `mergedCount`, and
  `symbols` still lists the distinct symbols actually present;
- **validation** — `columnCount` must be a positive safe integer (classified
  `invalid-input`); a degenerate window or an empty list yields no markers.

The helper duplicates no time<->sample arithmetic: it delegates to
`sampleWindowOfTime`/`timeSecOfSample` exactly like `./geometry.ts` does, so
exactly one tested definition of the mapping exists anywhere in the codebase.

### (b) The view owns the rendering, the parent owns the data

[`TimeSeriesView`](../../src/presentation/views/timeSeries/TimeSeriesView.svelte:51)
gains an optional `annotations?: readonly AnnotationEvent[]` prop defaulting to
`[]`, derives
[`annotationResult`](../../src/presentation/views/timeSeries/TimeSeriesView.svelte:110),
draws the markers in the **same canvas pass** as the trace (amber stems + symbol
labels, early-return when there are none), and states the outcome in its
figcaption: `Annotations: none` / `Annotations: {n} in view` /
`… ({m} merged)` plus a `Symbols: A, N, V` legend when any are visible. The
caption is the honest, testable summary; the pixels are never the gate. The view
still owns no science configuration, calls no service, and never writes the
source arrays.

### (c) `App` forwards the record's own annotations; the application layer is untouched

The only wiring change in production code is one prop:
`annotations={result.sourceRecord.annotations}`
([`App.svelte`](../../src/presentation/App.svelte:400)). **No** application,
dataset, DSP, ML or worker file was modified in Phase 12 — the annotations
already reached the view; Phase 12 made them visible and made their provenance
explicit (the view note and docstrings state they are the source's own events
and are never fused). The canonical `db4 / 4 / periodic` analysis is unchanged.

### (d) The multi-record selector is completed by proof, not by new selection code

The Phase-11 selector is already real
([`handleRecordChange`](../../src/presentation/App.svelte:214) →
[`analyzeRecordById`](../../src/presentation/App.svelte:128), which resets the
display selection to first channel + full window). Phase 12 adds **no**
production selection code; it adds the missing evidence: the App jsdom slice now
ingests a **two-record** local selection (`700` annotated, `701` plain and
shorter) through the real ingestion factory + service, asserts the first id is
analyzed on ingest, switches the Record combobox, then asserts that the second
record's identity and stable analysis id replace the first's *and* that the
display selection really reset (channel back to `MLII`, viewport back to
`Full record`, the new record's own sample count and `Annotations: none`).

Rejected alternative: deriving the option list from `service.listRecordIds()`.
Nothing of the sort is needed for a **display** concern; the option list already
comes from the ingestion factory's discovered ids while the science never takes
a channel/viewport option (ADR-008). Widening the application API for the
selector would add surface area without adding a guarantee.

### (e) Testability split and the phase gates

- **Numerical:** [`annotationGeometry.test.ts`](../../src/presentation/views/timeSeries/__tests__/annotationGeometry.test.ts:1)
  — 12 Node tests: exact positions, half-open boundary inclusion/exclusion,
  interior exclusion, clamping, the density cap/merge and its counts, the lowest
  representative under descending input, distinct ascending symbols, empty and
  degenerate windows, window after the record, and the `columnCount` rejection.
- **Markup:** [`TimeSeriesView.test.ts`](../../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:1)
  — 4 new jsdom tests: `none` by default, count + legend, merged count at
  `width: 2`, and viewport exclusion of out-of-window events.
- **End-to-end:** [`App.test.ts`](../../src/presentation/__tests__/App.test.ts:341)
  — a hand-built minimal `.atr` (the annotation layer is parse-only, so the test
  writes WFDB byte pairs) proves the caption through the real
  `ingestFiles` → `RecordAnalysisService` path, and the
  [record-switch test](../../src/presentation/__tests__/App.test.ts:369) proves
  multi-record selection.
- **Never asserted:** canvas pixels (jsdom has no 2d context; the draw pass runs
  on its guarded path) and no wall-clock timing (rules §51).

## Consequences

- An analyzed annotated record now **shows its beats over the trace** with an
  honest, tested caption, closing the "annotations exist but are invisible" gap
  without touching the science. The synthetic fixture still declares
  `annotations: []`, so the boot record intentionally renders `Annotations: none`.
- **Cost is O(annotations) time and O(columns) markers.** The density cap keeps a
  long recording readable without a DOM marker list, and the whole overlay is one
  extra pass in the existing canvas draw.
- **Multi-record selection is now evidence-backed, not assumed:** the JSdom slice
  switches records and pins the identity/id change plus the display reset. The
  production selector was already correct; the phase adds no new selection path.
- **Honest limits:** the markers are the *file's* annotations, not detections —
  no model or algorithm in this repo produces them; nothing here is a clinical or
  quality claim (rules §47/§49). `.atr` remains parse-only, so tests hand-build
  bytes; and markup assertions can never prove pixel correctness (the pure helper
  is the numerical gate).
- **No new dependency, no tsconfig change, no application change**; ADR-008/009
  (display selection, no UI-owned science) and ADR-012 (local-first ingestion)
  both hold unchanged.

## References

- Architecture plan §J (dataset architecture — the canonical model the overlay
  reads), §M item 12 (Phase 12), decision register (ADR-013)
- [`plans/phase-12-plan.md`](../../plans/phase-12-plan.md) — approved scope and
  item-by-item gates
- ADR-008 (display selection is a display concern over a full-record result),
  ADR-009 (probe-driven work is seam-validation, never a clinical claim),
  ADR-001 (sample i occurs at i / sampleRateHz), ADR-006 (canonical record /
  dataset boundary), ADR-012 (local-first ingestion this display consumes)
- Rules §30 (no duplicated science), §47/§49 (no clinical claim),
  §51 (no wall-clock assertions), §56 (green check gate)
