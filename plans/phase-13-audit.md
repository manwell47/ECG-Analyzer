# Phase 13 Audit / Completion — Interactive signal navigation: cursor readout, zoom and pan

Recorded 2026-09-13 (Code-mode completion record). Verdict: **Phase 13 implemented
and fully green.** The full `npm run check` gate passes at the end of every item
and again as the final gate: typecheck ✓, svelte-check (0 errors / 0 warnings) ✓,
lint ✓, **59 test files / 636 tests** ✓, Vite build ✓ (**167 modules**).
**Presentation only:** no domain, parser, DSP/DWT, ML, worker or application code
changed. The scientific configuration stays `db4 / 4 / periodic`; zoom and pan
**change only what is drawn** — the analysis is never re-invoked, and the source
`Float64Array`s are read, never written (ADR-008/014 hold).

## Scope / approved increment

> "The user approved planning **Phase 13 = A + B**: **A — Cursor readout.**
> Pointing at the plotted trace reports the time and sample under the cursor, and
> the nearest annotation symbol when one is close by. **B — Zoom and pan.** Narrow
> and slide the visible time window — by pointer drag over the trace and by
> keyboard-accessible controls — with an explicit reset back to the full record.
> This is a **presentation-layer** increment. No domain, DSP/DWT, ML, worker,
> parser, adapter or application-service change. Data still reaches the views only
> through the application service; the views stay display-only and never mutate
> source buffers."

The single most important honesty constraint of the increment is that **zoom and
pan change only what is drawn**: they never re-invoke the service, never re-run
the DWT and never alter the analysis — a zoomed window is a *display* selection
over the one full-record `AnalysisResult`, exactly like the existing viewport
presets (ADR-008). That constraint is enforced structurally (one commit path that
only assigns state) and pinned by a spy-count test.

## Files added

| Purpose | File |
|---|---|
| Pure, DOM-free navigation arithmetic (`ViewportBounds`, `CursorReadout`, `ZOOM_STEP_FACTOR`, `PAN_STEP_FRACTION`, `MIN_VIEWPORT_SAMPLES`, `clampFraction`, `viewportBoundsOf`, `minViewportDurationSec`, `clampViewport`, `zoomViewport`, `panViewport`, `viewportFromFractions`, `readoutAtFraction`) | [`src/presentation/views/timeSeries/navigationGeometry.ts`](../src/presentation/views/timeSeries/navigationGeometry.ts:1) |
| Node numerical gate for the helper (clamp, bounds, floor, zoom/pan/drag, readout, invariants, `invalid-input`) | [`src/presentation/views/timeSeries/__tests__/navigationGeometry.test.ts`](../src/presentation/views/timeSeries/__tests__/navigationGeometry.test.ts:1) |
| ADR-014: signal-navigation decision | [`plans/adr/ADR-014-signal-navigation.md`](adr/ADR-014-signal-navigation.md:1) |
| Phase 13 audit (this record) | [`plans/phase-13-audit.md`](phase-13-audit.md:1) |

**Touched:**

- [`src/presentation/views/timeSeries/TimeSeriesView.svelte`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:61)
  — added the optional
  [`onViewportCommit`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:78)
  prop; the transient `cursorFraction` / `dragStartFraction` / `dragEndFraction`
  `$state`; the [`cursorReadout`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:186)
  derived from `readoutAtFraction` and its `Cursor: —` / `Cursor: {t} s · sample
  {i}` caption span ([line 563](../src/presentation/views/timeSeries/TimeSeriesView.svelte:563));
  the five-button `role="group"` navigation row
  ([line 536](../src/presentation/views/timeSeries/TimeSeriesView.svelte:536));
  the single commit path [`emitViewport()`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:204);
  the guarded pointer handlers via
  [`fractionFromPointer()`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:266)
  (`rect.width > 0` early-return) and the decorative `drawDragBand()` pass
  ([line 458](../src/presentation/views/timeSeries/TimeSeriesView.svelte:458)). It
  owns no science and calls no service.
- [`src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts`](../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:185)
  — **11** new jsdom cases in two `describe` blocks (controls/readout and pointer
  inertness); the nine existing caption/channel/annotation cases are unchanged.
- [`src/presentation/App.svelte`](../src/presentation/App.svelte:126) — added
  `customViewport` state; the `customViewportOption` /
  [`displayedViewportOptions`](../src/presentation/App.svelte:302) /
  `effectiveViewportIndex` /
  [`activeViewport`](../src/presentation/App.svelte:319) derivations;
  [`isFullViewport()`](../src/presentation/App.svelte:337),
  [`handleViewportCommit()`](../src/presentation/App.svelte:353) and the rewritten
  `handleViewportChange()` ([line 367](../src/presentation/App.svelte:367)); the
  clear-on-`analyzeRecordById()` ([line 152](../src/presentation/App.svelte:152));
  and passing `onViewportCommit` to `TimeSeriesView`
  ([line 488](../src/presentation/App.svelte:488)). No service call, option or
  science configuration added; `App` never imports the navigation helper (no
  duplicated clamping).
- [`src/presentation/__tests__/App.test.ts`](../src/presentation/__tests__/App.test.ts:490)
  — **5** new jsdom end-to-end cases; the eight existing cases are unchanged.
- [`plans/ecg-lab-architecture.md`](ecg-lab-architecture.md:255) — §I bullet
  (display navigation is main-thread and display-only, never a re-analysis), §M
  item 13 (Phase 13), and the decision-register entry (+ADR-014).

**Not touched (by design):** all of `src/domain/**` (`record.ts`, `sampling.ts`,
`signal.ts`, `units.ts`, `numeric.ts`, `error.ts`); all of `src/datasets/**`;
all of `src/dsp/**`, `src/ml/**`, `src/workers/**`, `src/bench/*`;
[`src/application/analysis.ts`](../src/application/analysis.ts:1) / `defaults.ts` /
`dspExecutor.ts`; [`src/main.ts`](../src/main.ts:1);
`src/presentation/dataset/*`, `src/presentation/workers/*`;
[`ViewControls.svelte`](../src/presentation/views/controls/ViewControls.svelte:1)
and [`presets.ts`](../src/presentation/views/controls/presets.ts:1) (the toolbar
stays thin — `App` composes the "Custom (zoomed)" option itself); and
[`DwtCoefficientView.svelte`](../src/presentation/views/dwt/DwtCoefficientView.svelte:1)
(it already accepted a `viewport` prop, so it only ever *reads* the new window). No
new dependency and no `tsconfig` / `vite.config.ts` change. Rules §30 (no
duplicated science) held.

## Item-by-item mapping

0. **Pre-flight** — `npm run check` green (**58 files / 574 tests, 166 modules**);
   no files touched.
1. **Pure navigation helper** — `navigationGeometry.ts` +
   `navigationGeometry.test.ts`; `npm run check` green (**59 files / 620 tests,
   166 modules**; +1 file, +46 Node tests).
2. **`TimeSeriesView` controls + cursor readout** — the prop, the five-button
   group, the `Cursor:` span and the readout wiring + 8 jsdom cases; `npm run
   check` green (**59 files / 628 tests, 167 modules**; +8 tests; the +1 module is
   the new helper imported by the view).
3. **Pointer drag to zoom (guarded)** — handlers, transient drag state, the drag
   band and 3 inertness cases; `npm run check` green (**59 files / 631 tests, 167
   modules**; +3 tests).
4. **`App` custom-viewport wiring + end-to-end proof** — `customViewport`, the
   option/index/active derivations, `onViewportCommit` and 5 App cases; `npm run
   check` green (**59 files / 636 tests, 167 modules**; +5 tests).
5. **ADR-014 + architecture update** — ADR-014 written; §I / §M item 13 / decision
   register updated; `npm run check` green (**59 files / 636 tests, 167 modules** —
   docs-only, counts unchanged).
6. **Audit + final gate (this record)** — final full `npm run check` green
   (**59 files / 636 tests, 167 modules**).

## Evidence (the correctness gates)

The correctness claims are pinned by tests at three levels, never by pixels or
timings:

- **Numerical gate (Node) —**
  [`navigationGeometry.test.ts`](../src/presentation/views/timeSeries/__tests__/navigationGeometry.test.ts:1)
  (46 tests) covers the pure helper directly: `clampFraction` bounds incl. NaN →
  0; `viewportBoundsOf` from sampling, a non-zero `startTimeSec` and an invalid
  sample count; the samples-based floor (`minViewportDurationSec`); `clampViewport`
  inside / off-left / off-right / over-long / short-record / sub-floor; `zoomViewport`
  in (`factor < 1`) and out (`factor > 1`) about the centre and the edges, edge
  sticking, the floor, a clamped anchor and an invalid factor; `panViewport` left /
  right, edge clamping, **duration preservation**, the over-wide cap and invalid
  input; `viewportFromFractions` forward / reversed / zero-width / out-of-plot /
  sub-floor / offset start / invalid; `readoutAtFraction` at 0 / ½ / 1, out-of-range
  clamping, window-following, domain-matching `round` rounding, an absolute axis,
  a non-negative index and an invalid viewport; and the cross-cutting invariants
  (every derived window stays inside the record; panning at the zoom floor never
  changes the duration; an interior readout stays inside the drawn sample window).
  All time↔sample arithmetic goes through
  [`src/domain/sampling.ts`](../src/domain/sampling.ts:1) — never re-implemented.
- **Markup / interaction gate (jsdom) —**
  [`TimeSeriesView.test.ts`](../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:185)
  asserts the deterministic button path while `getContext` is stubbed to `null`: no
  navigation group and an idle `Cursor: —` when the callback is omitted; the five
  accessible button names when it is provided; `Zoom in` emits a strictly narrower
  window inside the current bounds; `Zoom out` at the full record stays full;
  `Reset view` emits exactly the full bounds; `Pan right` / `Pan left` move
  `startSec` without changing `durationSec` and clamp at both edges. The pointer
  block ([line 303](../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:303))
  proves **inertness**: with a zero-width `getBoundingClientRect()`, a synthetic
  `pointerdown`/`move`/`up` emits **nothing** and the readout stays idle, a
  `pointerleave` cancels a drag without emitting, and the handlers stay inert even
  without a commit callback. jsdom cannot measure layout, so canvas **drawing** and
  drag **geometry** are never the DOM gate — the geometry truth is the Node helper
  test above.
- **End-to-end gate (jsdom over the real service path) —**
  [`App.test.ts`](../src/presentation/__tests__/App.test.ts:490) (5 tests) drives the
  real `App` over the injected service: the Viewport combobox reports the base
  presets (`Full record`, `0.00–2.50 s`, …) with **no** `Custom (zoomed)` option by
  default; `Zoom in` adds the `Custom (zoomed)` option, selects it, and narrows the
  window reported by **both** captions while the full-window string disappears;
  `Reset view` returns the select to `Full record` and restores the full window;
  switching the `Record` combobox (the Phase-12 two-record fixture) clears the
  custom zoom; and — the honesty pin — the `analyzeSpy` call count stays at **1**
  through `Zoom in` / `Zoom out` / `Pan right` / `Pan left` / `Reset view`, so no
  navigation action re-invokes the analysis service.
- The Phase-12 regression that pins **exactly two** `t = … s → … s` window
  elements still passes: the cursor readout deliberately uses the distinct
  `Cursor: … s · sample …` format and adds no fourth window string.

## Decisions recorded (ADR-014)

1. **All navigation arithmetic is one pure, DOM-free helper** —
   [`navigationGeometry.ts`](../src/presentation/views/timeSeries/navigationGeometry.ts:1)
   is the single definition; the view consumes it and adds no sample maths of its
   own (ADR-001 delegation preserved).
2. **The view owns transient pointer state, the parent owns the committed window** —
   `cursorFraction` / drag endpoints are local `$state`; every commit leaves via
   [`onViewportCommit`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:78)
   through the single `emitViewport()` path, keeping the view a controlled
   component like the existing channel/viewport props.
3. **`App` stores a display-only custom window and keeps the Viewport control
   honest** — the base list stays `viewportPresets(...)`; the custom window is
   appended as `{ label: "Custom (zoomed)" }` and reported as selected, so the
   toolbar can never claim "Full record" while a narrow window is drawn. A commit
   landing exactly on the full record, a preset pick, a re-analysis or a record
   switch all clear it. No clamping is duplicated in `App`.
4. **Zoom is a re-window, not a re-analysis (rejected alternative)** — requesting
   `analyze({ viewport })` was rejected: it would re-run filter/DWT on every drag
   and require `RecordAnalysisOptions` to grow display fields, exactly what
   ADR-008 fixed against. Navigation re-windows the *same* `AnalysisResult`.
5. **Testability split** — the numerical truth is the Node helper test; the jsdom
   tests assert markup/interaction and pointer *inertness* only (canvas pixels and
   wall-clock timings are never a gate; rules §51).

## What Phase 13 proves and does not prove

**Proves** — the visible window can be narrowed, slid and reset by
keyboard-accessible controls (and, under real layout, by pointer drags), every
derived window stays inside the record and never collapses below a two-sample
display floor, the resets are exact (the full acquisition window), the cursor
readout reports the domain-consistent time and nearest sample, `App` reflects the
committed window honestly in the Viewport combobox and draws it in **both** canvas
views, and **no navigation action re-invokes the analysis service** (spy count
pinned at 1). The default (un-zoomed) markup is unchanged.

**Does not prove** — that the drag *geometry* behaves correctly in a real browser.
jsdom returns a zero-width rect, so the pointer handlers are only proved **inert**;
the drag→window maths is proved by the pure Node helper, not end-to-end through a
DOM event with a real layout. It does not prove canvas rendering fidelity (jsdom
cannot draw), so the drawn window is verified only by hand under `npm run dev`. It
does not add or verify any annotation naming at the cursor: the readout reports
time and sample only — the checkpoint's one-line mention of a nearby annotation
symbol in candidate A is **not** implemented, because the approved item spec
(Item 2) defines the readout as `Cursor: {t} s · sample {i}`. No science or
clinical claim is made anywhere (rules §47/§49).

## Residual risk

- **Pointer geometry in a real browser is not machine-verified** — the guarded
  handlers return early under jsdom, so the fraction→window path is covered only
  by the pure helper's tests plus a manual `npm run dev` check. This is inherent to
  jsdom (no layout) and was accepted in the plan.
- **Canvas drawing is not the gate** — jsdom has no 2d context, so `drawTrace()`
  and the drag band are covered by typecheck + lint + build and by the helper's
  numerical tests, while the actual pixels remain a manual concern.
- **The minimum window is a display floor, not a measurement threshold** — two
  samples (`MIN_VIEWPORT_SAMPLES`) is chosen so the canvas and the DWT lane mapping
  stay usable; it is deliberately not a scientific parameter.
- **The readout index is a readout, not a data access** — at the right edge it can
  equal the window's exclusive end sample; nothing downstream may index a buffer
  with it without its own range check (documented in the helper).
- **The "Custom (zoomed)" option is composed in `App`, not the toolbar** — this
  keeps `ViewControls`/`presets.ts` unmodified (their single "selection is a
  display concern" contract), at the cost of `App` knowing the option label; a
  future toolbar change must respect that split.

## Test counts

Final `npm run check`: **59 test files / 636 tests** (Phase-12 close: 58 / 574;
+1 file, +62 tests). Build: **167 modules** (Phase-12 close: 166; +1 for the
navigation helper imported by the view).

New test file and its contribution:

| File | Tests |
|---|---|
| [`navigationGeometry.test.ts`](../src/presentation/views/timeSeries/__tests__/navigationGeometry.test.ts:1) | +46 (Node) |

Added to existing files:
[`TimeSeriesView.test.ts`](../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:1)
(+11 jsdom: 8 controls/readout, 3 pointer inertness) and
[`App.test.ts`](../src/presentation/__tests__/App.test.ts:1) (+5 end-to-end; the
previous eight cases unchanged).

**Gate history:** 0 → 58/574/166 · 1 → 59/620/166 · 2 → 59/628/167 · 3 →
59/631/167 · 4 → 59/636/167 · 5 → 59/636/167 · 6 → 59/636/167.

## References

- [phase-13-plan.md](phase-13-plan.md:1) — the approved plan executed above.
- [ADR-014-signal-navigation.md](adr/ADR-014-signal-navigation.md:1) — the
  signal-navigation decision.
- [ADR-008-display-selection-controls.md](adr/ADR-008-display-selection-controls.md:1)
  / [ADR-009-application-experiment-placement.md](adr/ADR-009-application-experiment-placement.md:1)
  — "selection is a display concern"; no UI-owned science.
- [ADR-013-annotation-display.md](adr/ADR-013-annotation-display.md:1) — the
  sibling display-only overlay this phase builds on.
- [phase-12-audit.md](phase-12-audit.md:1) — the presentation increment this phase
  builds on.
- [ecg-lab-architecture.md](ecg-lab-architecture.md:255) — §I / §M item 13 /
  decision register.
