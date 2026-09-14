# ADR-015 — Cursor annotation readout: the nearest annotation symbol (display only)

Status: Accepted
Date: 2026-09-13
Scope: Phase 14 — **presentation only**. The time-series cursor readout may append
the symbol of the record's own nearest annotation when the pointer is within a
display tolerance of it. No domain, DSP/DWT, ML, worker, parser, adapter or
application-service change; no new science configuration; the analysis is never
re-invoked; no sample buffer is written.

## Context

Phase 13 (ADR-014) added the pointer cursor readout, but its approved item spec
deliberately narrowed the label to time + sample (`Cursor: {t} s · sample {i}`).
The Phase-13 checkpoint recorded the broader "A" wording — pointing at the trace
also reports the nearest annotation symbol when one is close by — as the one
piece left out. Phase 12 (ADR-013) had already overlaid the record's own
[`AnnotationEvent`](../../src/domain/record.ts:46)s as display-only markers via
the pure `annotationMarkers` mapping and its `Symbols:` legend. Phase 14 closes
the gap by letting the cursor name the one annotation it is sitting on. Two
hazards shaped the decision:

1. **A named symbol is a detection in disguise.** The app performs no beat
   detection and makes no clinical claim (rules §47/§49). A symbol appearing next
   to the cursor reads very easily as "the app found a beat here". The readout
   must therefore name **only** a symbol already present in
   `result.sourceRecord.annotations`, under the same visibility rule the drawn
   overlay uses, and must never state a symbol the overlay hides.
2. **The tolerance is a screen convenience, not a measurement.** "Close by" is a
   matter of pointer distance in *plot fractions* — roughly the width of a drawn
   marker. Presenting it as a threshold (a millisecond window, an amplitude gate)
   would smuggle a science claim into a label.

Constraints:

- **Display of a domain fact, never a detection** (ADR-013): the symbol is read
  verbatim from the record; the readout owns no algorithm.
- **No science change / no UI-owned science** (ADR-008/009): the view displays
  exactly what the service returned.
- **No duplicated sample maths:** the half-open window and every time<->sample
  conversion stay in
  [`geometry.ts`](../../src/presentation/views/timeSeries/geometry.ts:104) /
  [`src/domain/sampling.ts`](../../src/domain/sampling.ts:1) (ADR-001).
- **A readout is not a data access:**
  [`readoutAtFraction`](../../src/presentation/views/timeSeries/navigationGeometry.ts:273)
  warns its index can equal the window's exclusive end sample; nothing
  downstream may index a buffer with it.
- **No new dependency, no tsconfig/lib change, no new prop.**

## Decision

### (a) One pure, DOM-free resolver owns the "which annotation" arithmetic

[`annotationGeometry.ts`](../../src/presentation/views/timeSeries/annotationGeometry.ts:1)
gains the resolver beside the overlay mapping it shares conventions with:

- [`CURSOR_ANNOTATION_TOLERANCE_FRACTION`](../../src/presentation/views/timeSeries/annotationGeometry.ts:71)
  (`0.02`) — the default tolerance as a fraction of the visible window width,
  documented as a presentation radius, never a measurement or detection
  threshold;
- [`NearestAnnotation`](../../src/presentation/views/timeSeries/annotationGeometry.ts:74)
  — `{ symbol, sampleIndex, distanceFraction }`, where `sampleIndex` is the
  annotation's **own** index (never derived, never snapped to the cursor);
- [`nearestAnnotationAtFraction()`](../../src/presentation/views/timeSeries/annotationGeometry.ts:244)
  — a clamped `xFraction` plus the annotations, viewport, sampling, sample count
  and an optional tolerance → the nearest annotation within tolerance, else
  `null`.

Rules (every one tested):

- **Same visibility rule as the overlay:** only annotations whose `sampleIndex`
  falls inside the half-open window `[startSample, endSample)` from
  `sampleWindowOfTime` are considered, so the readout can never name a symbol the
  drawn overlay hides.
- **Clamped cursor:** `xFraction` is clamped to `[0, 1]` (non-finite -> `0`),
  matching
  [`clampFraction`](../../src/presentation/views/timeSeries/navigationGeometry.ts:113)/`clampUnitFraction`.
- **Deterministic nearest:** smallest `distanceFraction`, ties to the lower
  `sampleIndex`, then to the lexicographically smaller `symbol`, so the result
  never depends on input order.
- **`null` is first-class:** an empty list, a degenerate viewport or a nearest
  farther than `toleranceFraction` yields `null`, and the readout falls back to
  time + sample only.
- **Validation:** a non-finite or negative `toleranceFraction` is classified
  `invalid-input` (the existing taxonomy); nothing is silently coerced.
- **Read-only:** only `sampleIndex`/`symbol` are read; no sample buffer is
  indexed or written and no input is mutated.

### (b) The cursor label becomes a pure, Node-tested formatter

Phase 13 left the hover label as an inline template literal in the view, with no
test on the hovering branch (jsdom cannot easily set a pointer fraction). Phase
14 removes that gap by extracting the string into
[`formatCursorReadout()`](../../src/presentation/views/timeSeries/navigationGeometry.ts:302)
next to the [`CursorReadout`](../../src/presentation/views/timeSeries/navigationGeometry.ts:47)
it renders, with
[`CURSOR_IDLE_LABEL`](../../src/presentation/views/timeSeries/navigationGeometry.ts:291)
(`Cursor: —`) as the no-cursor case:

- readout `null` -> `Cursor: —` (byte-identical to the Phase-13 idle string);
- otherwise -> `Cursor: {timeSec.toFixed(2)} s · sample {sampleIndex}`, plus
  ` · nearest {symbol}` when a non-empty symbol is supplied;
- an absent or empty symbol adds **no** suffix, so the label never shows a
  dangling `nearest`.

The symbol is folded in *after* the geometry readout: the formatter takes the two
facts separately and cannot alter the time or the sample.

### (c) The view composes the two helpers; no new prop, no science, no service call

[`TimeSeriesView.svelte`](../../src/presentation/views/timeSeries/TimeSeriesView.svelte:1)
gains **one** derived
([`nearestAnnotation`](../../src/presentation/views/timeSeries/TimeSeriesView.svelte:206))
and changes **one**
([`cursorLabel`](../../src/presentation/views/timeSeries/TimeSeriesView.svelte:220),
now `formatCursorReadout(cursorReadout, nearestAnnotation?.symbol ?? null)`). The
props, the navigation buttons, the guarded pointer handlers, the overlay, the
summary and the legend are all untouched.

- The view keeps owning the transient cursor state and the caption span; it
  imports no service and writes no buffer.
- `cursorReadout` (time + sample) and `nearestAnnotation` (the symbol) stay
  **separate** derivations, so a symbol cannot leak into the sample maths.
- No new prop is added; [`App.svelte`](../../src/presentation/App.svelte:1) needs
  no change because it already forwards `result.sourceRecord.annotations`.

Rejected alternative (the tempting one): **derive the nearest symbol inside the
view from the drawn marker list.** The overlay's `annotationMarkers` is
density-capped to one marker per pixel column and reports `mergedCount`, so a
symbol can be absent from it purely for display reasons — naming it would make the
label depend on the plot's pixel width rather than on the record. The resolver
therefore scans the *record's* annotations under the same window rule, so the
named symbol is a fact of the data and the overlay and the readout cannot disagree
about *which* annotations are in the window. A second rejected alternative is to
name the nearest symbol with **no** tolerance ("whatever annotation is nearest,
always"): that would put a symbol under nearly every cursor position, turning a
readout into a claim.

### (d) Testability split and the phase gates

- **Numerical:**
  [`annotationGeometry.test.ts`](../../src/presentation/views/timeSeries/__tests__/annotationGeometry.test.ts:252)
  — 11 new Node tests: the exact hit; the nearer of two (cursor `0.26` against a
  marker at `0.25`, i.e. inside the 2% default); `null` beyond tolerance; an
  explicit tolerance with a tie resolved to the lower sample index; a same-index
  tie broken by symbol (independent of input order); the reported index is the
  annotation's own; annotations outside the half-open window dropped; an
  out-of-plot / non-finite cursor clamped; `null` for an empty list or a
  degenerate viewport; `invalid-input` for a non-finite / negative tolerance; and
  no input mutation.
- **Formatting:**
  [`navigationGeometry.test.ts`](../../src/presentation/views/timeSeries/__tests__/navigationGeometry.test.ts:509)
  — 6 new Node tests: the idle label byte-for-byte; `null` with and without a
  symbol; the hover form `Cursor: 1.25 s · sample 5`; two fixed decimals for a
  whole second; the ` · nearest A` suffix; and no suffix for an absent / empty
  symbol.
- **Wiring (jsdom):**
  [`TimeSeriesView.test.ts`](../../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:362)
  — 4 new jsdom tests over a stubbed `200x100` `getBoundingClientRect`: idle with
  no `/nearest/`; `Cursor: 1.00 s · sample 2 · nearest A` at `clientX 50`; the
  hover label with **no** suffix at `clientX 150`; and a return to idle on
  `pointerleave`.
- **Never asserted:** canvas pixels (jsdom has no 2d context; the draw pass runs
  on its guarded path) and no wall-clock timing (rules §51).
- **Docs gate:** the §I bullet, §M item 14 and the decision-register entry are
  documentation only; `npm run check` stays green without a count change.

## Consequences

- The time-series cursor readout now reports time, sample **and** the record's own
  nearest annotation symbol when one is close by — completing the approved
  Phase-13 "A" wording. It does not replace the overlay or its `Symbols:` legend,
  which still enumerates the window's whole set.
- **Cost is O(n) in the window's annotations per pointer move**, over a handful of
  numbers — no new buffer, no new dependency.
- **Never a detection — structurally.** The resolver reads only
  `annotation.symbol`; it has no access to DSP/ML output, and it returns `null`
  for the synthetic boot record (whose `annotations` is empty), so a non-empty
  suffix is reachable only via a real/local record.
- **Never a data access.** The returned `sampleIndex` is a readout; nothing
  indexes a buffer with it.
- **Honest limits:** the tolerance is a **display** guard (a plot-fraction
  radius), not a measurement threshold, and the overlay's pixel-column density cap
  is independent of the resolver — the resolver may name an annotation whose
  column representative differs, and it never reports `mergedCount`. jsdom proves
  only the wiring; the geometry and the string are the pure Node gates.
- **No new dependency, no tsconfig change, no science/application change**;
  ADR-001/008/009 and ADR-013/014 all hold unchanged.

## References

- Architecture plan §I (browser execution architecture — the readout is
  main-thread and display-only), §M item 14 (Phase 14), decision register
  (ADR-015)
- [`plans/phase-14-plan.md`](../../plans/phase-14-plan.md) — approved scope and
  item-by-item gates
- ADR-013 (the display-only annotation overlay this extends), ADR-014 (the cursor
  readout and navigation this adds the symbol to), ADR-008 (selection is a
  display concern over a full-record result), ADR-001 (sample i occurs at
  i / sampleRateHz)
- Rules §30 (no duplicated science), §47/§49 (no clinical claim — an annotation
  is never a detection), §51 (no wall-clock assertions), §56 (green check gate)
