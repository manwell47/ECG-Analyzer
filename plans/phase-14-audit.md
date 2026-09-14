# Phase 14 Audit / Completion — Cursor annotation readout: the nearest annotation symbol

Recorded 2026-09-13 (Code-mode completion record). Verdict: **Phase 14 implemented
and fully green.** The full `npm run check` gate passes at the end of every item
and again as the final gate: typecheck ✓, svelte-check (0 errors / 0 warnings) ✓,
lint ✓, **59 test files / 657 tests** ✓, Vite build ✓ (**167 modules**).
**Presentation only:** no domain, parser, DSP/DWT, ML, worker or application code
changed. The scientific configuration stays `db4 / 4 / periodic`; the cursor
readout **names only an annotation the record already contains** — it is never a
detection, never a re-analysis, and the source `Float64Array`s are read, never
written (ADR-008/013/015 hold).

## Scope / approved increment

> "The user approved **Candidate 3** from the Phase-13 checkpoint: **add the
> nearest-annotation symbol to the cursor readout** — the one remaining piece of
> the approved Phase-13 "A" wording ("Pointing at the plotted trace reports the
> time and sample under the cursor, **and the nearest annotation symbol when one
> is close by**") that the executed Item-2 spec deliberately narrowed to time +
> sample only. This is a **presentation-layer** increment. No domain, DSP/DWT, ML,
> worker, parser, adapter or application-service change; `App.svelte` is unchanged
> (it already forwards `result.sourceRecord.annotations`)."
> — [`plans/phase-14-plan.md`](phase-14-plan.md:11)

The single most important honesty constraint of the increment is that the readout
is the **display of a domain fact, never a detection**: it echoes a `symbol`
already present in `result.sourceRecord.annotations`, under the same half-open
window rule the Phase-12 overlay uses, so it can never name a symbol the drawn
overlay hides; and a non-empty suffix is reachable only via a real/local record
(the synthetic boot record sets `annotations: []`). The tolerance is a
**presentation** fraction of the plot width, not a measurement threshold
(ADR-013/015; rules §47/§49).

## Files added

| Purpose | File |
|---|---|
| ADR-015: the cursor-annotation-readout decision | [`plans/adr/ADR-015-cursor-annotation-readout.md`](adr/ADR-015-cursor-annotation-readout.md:1) |
| Phase 14 audit (this record) | [`plans/phase-14-audit.md`](phase-14-audit.md:1) |

**No new production or test file** was added: the phase extends the two existing
pure helpers and their Node gates plus the existing jsdom view slice, so the
build-module count stays **167**.

**Touched:**

- [`src/presentation/views/timeSeries/annotationGeometry.ts`](../src/presentation/views/timeSeries/annotationGeometry.ts:1)
  — added [`CURSOR_ANNOTATION_TOLERANCE_FRACTION`](../src/presentation/views/timeSeries/annotationGeometry.ts:71)
  (`0.02`), the [`NearestAnnotation`](../src/presentation/views/timeSeries/annotationGeometry.ts:74)
  type, the private `requireToleranceFraction` / `isNearer` helpers, and the pure
  [`nearestAnnotationAtFraction()`](../src/presentation/views/timeSeries/annotationGeometry.ts:244)
  resolver (same half-open window rule as `annotationMarkers`, clamped cursor,
  deterministic nearest, `null` first-class, `invalid-input` tolerance,
  read-only/no mutation).
- [`src/presentation/views/timeSeries/navigationGeometry.ts`](../src/presentation/views/timeSeries/navigationGeometry.ts:1)
  — added [`CURSOR_IDLE_LABEL`](../src/presentation/views/timeSeries/navigationGeometry.ts:291)
  (`Cursor: —`, byte-identical to the Phase-13 idle string) and the pure
  [`formatCursorReadout()`](../src/presentation/views/timeSeries/navigationGeometry.ts:302)
  (idle / hover / hover-with-symbol / empty-symbol).
- [`src/presentation/views/timeSeries/__tests__/annotationGeometry.test.ts`](../src/presentation/views/timeSeries/__tests__/annotationGeometry.test.ts:252)
  — **11** new Node cases in a new `describe`; the twelve existing marker cases are
  unchanged.
- [`src/presentation/views/timeSeries/__tests__/navigationGeometry.test.ts`](../src/presentation/views/timeSeries/__tests__/navigationGeometry.test.ts:509)
  — **6** new Node cases in a new `describe`; the 46 existing cases are unchanged.
- [`src/presentation/views/timeSeries/TimeSeriesView.svelte`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:206)
  — added the [`nearestAnnotation`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:206)
  derived (`cursorFraction` + `resolvedViewport` → the pure resolver) and routed
  [`cursorLabel`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:220)
  through `formatCursorReadout(...)`. No new prop; the props, the five navigation
  buttons, the guarded pointer handlers, the overlay and the summary/legend are
  untouched; the view still imports no service and writes no buffer.
- [`src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts`](../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:362)
  — **4** new jsdom cases (`cursor annotation readout (Phase 14 item 2)`) over a
  stubbed `200×100` `getBoundingClientRect`; the twenty existing cases are
  unchanged.
- [`plans/ecg-lab-architecture.md`](ecg-lab-architecture.md:276) — §I bullet (the
  cursor may name the record's own nearest annotation; display of a domain fact,
  never a detection), §M item 14 (Phase 14), and the decision-register entry
  (+ADR-015).

**Not touched (by design):** all of `src/domain/**` (`record.ts`, `sampling.ts`,
`signal.ts`, `units.ts`, `numeric.ts`, `error.ts`); all of `src/datasets/**`;
all of `src/dsp/**`, `src/ml/**`, `src/workers/**`, `src/bench/*`;
[`src/application/analysis.ts`](../src/application/analysis.ts:1) / `defaults.ts` /
`dspExecutor.ts`; [`src/main.ts`](../src/main.ts:1);
`src/presentation/dataset/*`, `src/presentation/workers/*`;
[`App.svelte`](../src/presentation/App.svelte:1) — it already forwards
`result.sourceRecord.annotations`, so the readout is entirely a view concern;
[`ViewControls.svelte`](../src/presentation/views/controls/ViewControls.svelte:1)
and [`presets.ts`](../src/presentation/views/controls/presets.ts:1) (the toolbar
stays thin); and
[`DwtCoefficientView.svelte`](../src/presentation/views/dwt/DwtCoefficientView.svelte:1)
(the readout is a time-series concern only). No new dependency and no `tsconfig` /
`vite.config.ts` change. Rules §30 (no duplicated science) held: every
time↔sample conversion still goes through
[`src/domain/sampling.ts`](../src/domain/sampling.ts:1), and the resolver reuses
`sampleWindowOfTime` / `timeSecOfSample`.

## Item-by-item mapping

0. **Pre-flight** — `npm run check` green (**59 files / 636 tests / 167
   modules**); no files touched.
1. **Pure resolver + label formatter** — `annotationGeometry.ts` +
   `navigationGeometry.ts` and their new Node `describe`s; `npm run check` green
   (**59 files / 653 tests / 167 modules**; +17 Node tests — 11 resolver + 6
   formatter; no new file, build unchanged). One transient red on the first run
   (see "Honest notes" below), fixed in the test.
2. **`TimeSeriesView` wiring** — the `nearestAnnotation` derived and the
   `cursorLabel` re-route + 4 jsdom cases; `npm run check` green (**59 files / 657
   tests / 167 modules**; +4 tests; build unchanged — the two helpers were already
   in the graph).
3. **ADR-015 + architecture update** — ADR-015 written; §I bullet / §M item 14 /
   decision register updated; `npm run check` green (**59 files / 657 tests / 167
   modules** — docs-only, counts unchanged).
4. **Audit + final gate (this record)** — final full `npm run check` green
   (**59 files / 657 tests / 167 modules**).

## Evidence (the correctness gates)

The correctness claims are pinned by tests at two levels — a **pure Node** gate
for the geometry and the string, and a **jsdom** gate for the wiring — never by
pixels or timings:

- **Numerical gate (Node) —**
  [`annotationGeometry.test.ts`](../src/presentation/views/timeSeries/__tests__/annotationGeometry.test.ts:252)
  (the 11 new resolver cases) covers the exact hit; the nearer of two in-window
  annotations (cursor `0.26` against a marker at `0.25`, i.e. inside the 2% default
  tolerance); `null` when every annotation is beyond tolerance; an explicit
  tolerance with a tie resolved to the **lower sample index**; a same-index tie
  broken by the **lexicographically smaller symbol** (so the result never depends
  on input order); that the reported index is the annotation's **own** sample index
  (never snapped to the cursor); that annotations outside the **half-open** window
  are dropped; that an out-of-plot / non-finite cursor is clamped; `null` for an
  empty list or a degenerate viewport; `invalid-input` for a non-finite / negative
  tolerance; and that the resolver never mutates the list it is given.
- **Formatting gate (Node) —**
  [`navigationGeometry.test.ts`](../src/presentation/views/timeSeries/__tests__/navigationGeometry.test.ts:509)
  (the 6 new formatter cases) covers the idle label byte-for-byte
  (`Cursor: —`), `null` with and without a symbol, the hover form
  `Cursor: 1.25 s · sample 5`, two fixed decimals for a whole second, the
  ` · nearest A` suffix, and that an absent / empty symbol adds **no** suffix (no
  dangling `nearest`).
- **Wiring gate (jsdom) —**
  [`TimeSeriesView.test.ts`](../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:362)
  renders the real view with annotations and a stubbed `200×100`
  `getBoundingClientRect`, then dispatches a synthetic `pointermove`: the idle
  readout shows **no** `/nearest/`; at `clientX 50` (sample 2, `1.00 s`,
  fraction `0.25`) the label becomes `Cursor: 1.00 s · sample 2 · nearest A`; at
  `clientX 150` (sample 6, `3.00 s`, clear of every annotation) it is
  `Cursor: 3.00 s · sample 6` with **no** suffix; and a `pointerleave` returns it
  to idle. jsdom cannot measure layout, so the DOM slice proves only the view's
  **wiring** — the geometry and the string truth are the Node gates above.
- The Phase-12 regression that pins **exactly two** `t = … s → … s` window
  elements still passes: the cursor readout keeps the distinct `Cursor: …` format
  and only appends ` · nearest {symbol}`.

## Decisions recorded (ADR-015)

1. **The nearest-annotation resolver is one pure, DOM-free helper** —
   [`nearestAnnotationAtFraction()`](../src/presentation/views/timeSeries/annotationGeometry.ts:244)
   is the single definition, placed beside the overlay mapping it shares
   conventions with (half-open window, clamped fraction, domain-delegated maths).
2. **The cursor label is a pure, Node-tested formatter** —
   [`formatCursorReadout()`](../src/presentation/views/timeSeries/navigationGeometry.ts:302)
   + [`CURSOR_IDLE_LABEL`](../src/presentation/views/timeSeries/navigationGeometry.ts:291)
   replace the inline template literal, so every branch (idle / hover /
   hover-with-symbol / empty-symbol) is pinned without a DOM slice.
3. **The view composes the two helpers; no new prop, no science, no service call** —
   `nearestAnnotation` and `cursorReadout` stay separate derivations, so a symbol
   cannot leak into the sample maths; `App` needs no change.
4. **The resolver scans the record, not the drawn markers (rejected alternative)** —
   deriving the symbol from `annotationMarkers` was rejected: that list is
   density-capped to one marker per pixel column (with `mergedCount`), so a symbol
   could be absent purely for display reasons and the label would depend on the
   plot's pixel width rather than on the record. A second rejected alternative —
   naming the nearest symbol with **no** tolerance — would put a symbol under
   nearly every cursor position, turning a readout into a claim.
5. **Testability split** — the numerical truth is the Node resolver/formatter
   tests; the jsdom slice asserts the wiring only (canvas pixels and wall-clock
   timings are never a gate; rules §51).

## What Phase 14 proves and does not prove

**Proves** — pointing at a plotted annotation (within a display-fraction tolerance)
names the record's **own** symbol in the cursor readout; the choice is
deterministic (distance → lower sample index → lexicographically smaller symbol)
and independent of input order; the resolver considers exactly the annotations the
overlay draws (same half-open window rule) and never names one outside it the
readout falls back cleanly to time + sample when nothing is close by; the idle and
hover label forms are byte-identical to Phase 13 (the two window captions and the
Phase-12 assertions are untouched); and the whole path is **display-only** — no
service call, no science change, no new prop, no buffer write.

**Does not prove** — that the pointer sits on a *pixel* that visually overlaps a
marker in a real browser: jsdom has no layout, so the DOM slice stubs the rect and
proves the wiring only; the tolerance is a plot-fraction radius, and the overlay's
per-pixel **density cap** is independent of the resolver (the resolver may name an
annotation whose column representative differs, and it never reports
`mergedCount`). It does not prove canvas rendering fidelity (jsdom cannot draw), so
the drawn marker and the readout are confirmed to agree only by hand under
`npm run dev`. No science or clinical claim is made anywhere (rules §47/§49).

## Residual risk

- **The tolerance is a presentation guard, not a measurement threshold** — `0.02`
  of the plot width (~the width of a drawn marker at typical sizes) is chosen so
  "close by" matches what a user sees; it is deliberately not a scientific
  parameter and is documented as such (ADR-015).
- **The resolver and the density-capped overlay are independent** — the resolver
  scans the record's annotations, so it can name an annotation that the overlay
  folded into a merged column; this is intended (the symbol is a data fact, not a
  pixel fact) and is stated in ADR-015.
- **The readout index is a readout, not a data access** — the returned
  `sampleIndex` is the annotation's own index; nothing indexes a buffer with it
  (the ADR-014 caveat still applies to `readoutAtFraction`'s index).
- **The hover label is exercised through a stubbed rect** — jsdom cannot measure
  layout, so the pointer→fraction path is covered by the pure formatter/resolver
  tests plus the stubbed wiring slice, and by a manual `npm run dev` check.

## Test counts

Final `npm run check`: **59 test files / 657 tests** (Phase-13 close: 59 / 636;
**+21 tests, no new file**). Build: **167 modules** (unchanged from the Phase-13
close — the new exports live in files already in the graph).

Added to existing files:

| File | Tests | Level |
|---|---|---|
| [`annotationGeometry.test.ts`](../src/presentation/views/timeSeries/__tests__/annotationGeometry.test.ts:1) | +11 (12 → 23) | Node |
| [`navigationGeometry.test.ts`](../src/presentation/views/timeSeries/__tests__/navigationGeometry.test.ts:1) | +6 (46 → 52) | Node |
| [`TimeSeriesView.test.ts`](../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:1) | +4 (20 → 24) | jsdom |

**Honest notes:** the Item-1 gate went red once — the "nearer of two" case first
used cursor fractions `0.3`/`0.7`, which are `0.05` from markers at `0.25`/`0.75`
and therefore *outside* the 2% default tolerance, so the (correct) resolver
returned `null`. That was a test-authoring error, not a production bug; the cursors
were moved to `0.26`/`0.74` (inside tolerance) and the gate went green.

**Gate history:** 0 → 59/636/167 · 1 → 59/653/167 · 2 → 59/657/167 · 3 →
59/657/167 · 4 → 59/657/167.

## References

- [phase-14-plan.md](phase-14-plan.md:1) — the approved plan executed above.
- [ADR-015-cursor-annotation-readout.md](adr/ADR-015-cursor-annotation-readout.md:1)
  — the cursor-annotation-readout decision.
- [ADR-013-annotation-display.md](adr/ADR-013-annotation-display.md:1) — the
  display-only annotation overlay this extends ("display of domain facts, never
  science; never a detection").
- [ADR-014-signal-navigation.md](adr/ADR-014-signal-navigation.md:1) — the cursor
  readout and navigation this adds the symbol to.
- [ADR-008-display-selection-controls.md](adr/ADR-008-display-selection-controls.md:1)
  / [ADR-009-application-experiment-placement.md](adr/ADR-009-application-experiment-placement.md:1)
  — "selection is a display concern"; no UI-owned science.
- [ecg-lab-architecture.md](ecg-lab-architecture.md:276) — §I / §M item 14 /
  decision register.
- [phase-13-audit.md](phase-13-audit.md:1) — the presentation increment this phase
  builds on.
