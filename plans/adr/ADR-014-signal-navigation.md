# ADR-014 — Signal navigation: cursor readout, zoom and pan (display only)

Status: Accepted
Date: 2026-09-13
Scope: Phase 13 — **presentation only**. The time-series view gains a pointer
cursor readout and a zoom / pan / reset that re-window what is drawn. No domain,
DSP/DWT, ML, worker, parser, adapter or application-service change; no new
science configuration; the analysis is never re-invoked.

## Context

Phase 7 (ADR-008) established that channel + viewport selection is a display
concern over **one full-record** `AnalysisResult`: the one visible-window type,
[`TimeViewport`](../../src/presentation/views/timeSeries/geometry.ts:31), already
maps a window onto the trace with sample-exact, domain-delegated arithmetic. But
that window could only ever be *chosen from a fixed preset list*: a user could
not point at the trace to read a value, nor narrow or slide the window
interactively. Two hazards shaped the decision:

1. **Zoom must not be a re-analysis.** The tempting implementation of "zoom" is
   to ask the service for a shorter window. That would re-run filter → DWT on
   every drag, contradicting ADR-008 ("selection is a display concern over a
   full-record result") and silently changing what has been computed. Zoom must
   change **only what is drawn**.
2. **jsdom cannot measure layout.** `getBoundingClientRect()` returns a
   zero-width rect in jsdom, so pointer geometry can never be a DOM-test gate.
   If the pointer handlers are not guarded the DOM slices divide by zero or
   throw; if they are guarded, the DOM proof is only that they are *inert* — the
   geometry itself must live in a pure, Node-testable helper.

Constraints:

- **No science change / no UI-owned science** (ADR-008/009): the view displays
  exactly what the service returned and owns no algorithm.
- **No duplicated sample maths:** every time<->sample conversion stays in
  [`src/domain/sampling.ts`](../../src/domain/sampling.ts:1) (ADR-001).
- **Display-only reads:** the source `Float64Array`s are read, never written; no
  sample buffer is mutated.
- **The toolbar stays thin:** `ViewControls.svelte`/`presets.ts` are not
  modified; `App` composes any extra option itself (the ADR-008/012 precedent).
- **No new dependency, no tsconfig/lib change.**

## Decision

### (a) One pure, DOM-free navigation helper owns all arithmetic

[`navigationGeometry.ts`](../../src/presentation/views/timeSeries/navigationGeometry.ts:1)
is the single definition of navigation arithmetic, exactly mirroring
`geometry.ts`/`annotationGeometry.ts`:

- the [`ViewportBounds`](../../src/presentation/views/timeSeries/navigationGeometry.ts:39)
  and [`CursorReadout`](../../src/presentation/views/timeSeries/navigationGeometry.ts:47)
  types plus the display constants
  [`ZOOM_STEP_FACTOR`](../../src/presentation/views/timeSeries/navigationGeometry.ts:55)
  (`0.5`), `PAN_STEP_FRACTION` (`0.25`) and `MIN_VIEWPORT_SAMPLES` (`2`);
- [`clampFraction`](../../src/presentation/views/timeSeries/navigationGeometry.ts:113)
  → `[0, 1]` (a non-finite fraction maps to `0`, like `annotationGeometry`);
- [`viewportBoundsOf`](../../src/presentation/views/timeSeries/navigationGeometry.ts:125)
  builds the navigable span from the record's own sampling facts
  (`startTimeSec` .. `durationSecOf(sampleCount, sampleRateHz)`);
- [`minViewportDurationSec`](../../src/presentation/views/timeSeries/navigationGeometry.ts:137)
  expresses the floor **in samples**, not seconds
  (`durationSecOf(MIN_VIEWPORT_SAMPLES, rate)`);
- [`clampViewport`](../../src/presentation/views/timeSeries/navigationGeometry.ts:146),
  [`zoomViewport`](../../src/presentation/views/timeSeries/navigationGeometry.ts:170),
  [`panViewport`](../../src/presentation/views/timeSeries/navigationGeometry.ts:209)
  and
  [`viewportFromFractions`](../../src/presentation/views/timeSeries/navigationGeometry.ts:235)
  create and keep every window **inside `bounds`** with
  `durationSec >= min(floor, bounds.durationSec)`; panning preserves the
  duration exactly, a reversed drag is normalised and a zero-width drag collapses
  to the floor;
- [`readoutAtFraction`](../../src/presentation/views/timeSeries/navigationGeometry.ts:273)
  derives the time directly and the nearest sample through the domain's own
  `sampleIndexOfTimeSec(..., 'round')`, floored at `0`.

The helper duplicates no time<->sample arithmetic (it imports
`durationSecOf`/`sampleIndexOfTimeSec` from the domain), and non-finite /
non-positive inputs are classified `invalid-input` through the existing taxonomy
rather than silently coerced.

### (b) The view owns transient pointer state; the parent owns the committed window

[`TimeSeriesView`](../../src/presentation/views/timeSeries/TimeSeriesView.svelte:61)
gains **one** prop,
[`onViewportCommit`](../../src/presentation/views/timeSeries/TimeSeriesView.svelte:78).
All transient state — `cursorFraction`, `dragStartFraction`, `dragEndFraction` —
stays local `$state` ([line 102](../../src/presentation/views/timeSeries/TimeSeriesView.svelte:102)),
and the committed window leaves the component only through the callback, via the
single local
[`emitViewport()`](../../src/presentation/views/timeSeries/TimeSeriesView.svelte:204).

- **Keyboard-accessible controls (the jsdom gate):** when `onViewportCommit` is
  provided, the figure renders a `role="group"` `aria-label="View navigation"`
  row of five buttons — `Zoom in`, `Zoom out`, `Pan left`, `Pan right`,
  `Reset view` ([line 536](../../src/presentation/views/timeSeries/TimeSeriesView.svelte:536)).
  They require no layout and are the deterministic DOM surface (the canvas is
  `aria-hidden`).
- **Guarded pointer handlers:** `onpointerdown`/`move`/`up`/`leave`/`cancel` map
  `clientX` to a fraction and **return early when `rect.width <= 0`**
  ([`fractionFromPointer()`](../../src/presentation/views/timeSeries/TimeSeriesView.svelte:266)),
  so jsdom runs the inert path instead of throwing or dividing by zero. A live
  drag paints a translucent band
  ([`drawDragBand()`](../../src/presentation/views/timeSeries/TimeSeriesView.svelte:458));
  the band is decoration, carries no data and is never asserted.
- **Cursor readout:** a caption span `Cursor: —` (idle) /
  `Cursor: {time} s · sample {index}` ([line 563](../../src/presentation/views/timeSeries/TimeSeriesView.svelte:563)).
  It deliberately uses a **distinct format**, never the `t = … → … s` window
  string that the Phase-12 test pins to exactly two elements.

### (c) `App` stores the committed window and keeps the Viewport control honest

`App` adds [`customViewport = $state<TimeViewport | null>(null)`](../../src/presentation/App.svelte:126)
and derives:

- [`activeViewport`](../../src/presentation/App.svelte:319) = the custom window
  when one exists, else the preset at `selectedViewportIndex` — passed to
  **both** canvas views, so the trace and the coefficient stack share the one
  window;
- the base option list stays `viewportPresets(...)`; a custom window is appended
  as `{ label: "Custom (zoomed)", viewport }` and reported as the selected index
  ([line 292](../../src/presentation/App.svelte:292)), so the toolbar can never
  claim "Full record" while the view draws a narrow window;
- a commit that lands **exactly** on the full record clears the custom window and
  restores `Full record` ([`isFullViewport()`](../../src/presentation/App.svelte:337),
  [`handleViewportCommit()`](../../src/presentation/App.svelte:353)), so
  "Reset view" (or zooming all the way back out) is a plain return, not a second
  full-record option;
- selecting a preset clears the custom window
  ([`handleViewportChange()`](../../src/presentation/App.svelte:367)) and
  [`analyzeRecordById()`](../../src/presentation/App.svelte:152) clears it too, so
  a record switch or a re-run restores the full window.
- **No clamping is duplicated in `App`:** the view emits an already-bounded
  window, so `App` stores it verbatim and never imports the navigation helper.

Rejected alternative (the tempting one): **re-run the service for a zoomed
window.** Requesting `analyze({ viewport })` would re-implement "zoom" as a
science change, re-running filter/DWT on every drag, and would require
`RecordAnalysisOptions` to grow display fields — exactly what ADR-008 fixed
against. Navigation is therefore a re-window of the *same* `AnalysisResult`.

### (d) Testability split and the phase gates

- **Numerical:** [`navigationGeometry.test.ts`](../../src/presentation/views/timeSeries/__tests__/navigationGeometry.test.ts:1)
  — 46 Node tests: clamp bounds incl. non-finite; bounds from sampling, a
  non-zero start and an invalid count; the samples-based floor; clamp
  inside/off-left/off-right/over-long/short-record; zoom in/out about the centre
  and the edges, edge sticking, the floor, a clamped anchor and an invalid
  factor; pan left/right, edge clamping, duration preservation, the over-wide cap
  and invalid input; drags forward/reversed/zero-width/out-of-plot/sub-floor/with
  an offset start/invalid; readout at 0/½/1, clamping, window-following,
  domain-matching rounding, an absolute axis, a non-negative index and an invalid
  viewport; and the cross-cutting invariants (every derived window inside the
  record; panning at the floor preserves the duration; a readout stays inside the
  drawn sample window).
- **Markup/interaction:** [`TimeSeriesView.test.ts`](../../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:185)
  — 11 new jsdom tests (8 for the controls/readout, 3 for pointer inertness): no
  navigation group and an idle readout without a callback; the five accessible
  button names; `Zoom in` narrows strictly inside the current bounds; `Zoom out`
  at the full record stays full; `Reset view` emits exactly the full bounds; pan
  moves `startSec` without changing `durationSec`, clamped at both edges; and the
  drag path emits **nothing** with no layout (including a `pointerleave`
  cancellation and the no-callback case).
- **End-to-end:** [`App.test.ts`](../../src/presentation/__tests__/App.test.ts:490)
  — 5 jsdom tests through the real service: the base presets with no
  `Custom (zoomed)` option by default; `Zoom in` adds + selects the custom option
  and narrows **both** captions; `Reset view` returns the select to
  `Full record` and restores the full window; switching the Record combobox
  clears the custom zoom; and `analyzeSpy` is **not** called by any navigation
  action.
- **Never asserted:** canvas pixels (jsdom has no 2d context; the draw pass runs
  on its guarded path) and no wall-clock timing (rules §51).

## Consequences

- The time-series trace is now **interactive**: pointing reads time + sample, and
  the window can be narrowed, slid and reset by pointer drag or by
  keyboard-accessible buttons — with the window shown honestly by the Viewport
  combobox and the two captions. `DwtCoefficientView` receives the same window
  unchanged because it already accepted a `viewport` prop.
- **Cost is O(1) per interaction.** Every step is a handful of pure arithmetic
  operations on four numbers, and a new window is one redraw of the existing
  decimated pass. No new buffer and no new dependency.
- **Zoom is never a re-analysis — structurally.** The only commit path is
  `emitViewport() → onViewportCommit → handleViewportCommit`, which assigns
  state; the navigation code cannot reach `service.analyze`, and the App test
  pins the spy count.
- **Honest limits:** the index from `readoutAtFraction` is a *readout*, not a
  data access — at the right edge it can equal the window's exclusive end sample,
  so nothing downstream may use it to index a buffer without its own range check.
  The cursor readout reports time + sample; it does **not** name the nearest
  annotation (that one-line mention in the Phase-12 checkpoint's candidate A is
  not part of the approved item spec, which defines the readout as time and
  sample). Drag *geometry* is proved by the pure Node helper; jsdom only proves
  the handlers are inert without layout; and the minimum window is a **display**
  floor (two samples), never a measurement threshold.
- **No new dependency, no tsconfig change, no science/application change**;
  ADR-001/008/009 and ADR-012/013 all hold unchanged.

## References

- Architecture plan §I (browser execution architecture — navigation is
  main-thread and display-only), §M item 13 (Phase 13), decision register
  (ADR-014)
- [`plans/phase-13-plan.md`](../../plans/phase-13-plan.md) — approved scope and
  item-by-item gates
- ADR-008 (selection is a display concern over a full-record result), ADR-009
  (probe-driven work is seam-validation, never a clinical claim), ADR-001
  (sample i occurs at i / sampleRateHz), ADR-013 (the sibling display-only
  overlay this builds on)
- Rules §30 (no duplicated science), §47/§49 (no clinical claim), §51 (no
  wall-clock assertions), §56 (green check gate)
