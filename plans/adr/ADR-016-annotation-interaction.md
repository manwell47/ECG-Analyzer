# ADR-016 — Annotation interaction: hover detail, an optional symbol filter and a bounded click-to-pin (display only)

Status: Accepted
Date: 2026-09-13
Scope: Phase 15 — **presentation only**. The time-series view may show the `symbol`/`auxNote`
of the record's own nearest annotation in a detail line, may hide the markers of every other
symbol through a view-local symbol filter, and may pin that detail on a click. No domain,
DSP/DWT, ML, worker, parser, adapter or application-service change; no new science
configuration; the analysis is never re-invoked; no sample buffer is written.

## Context

Phase 12 (ADR-013) overlaid the record's own
[`AnnotationEvent`](../../src/domain/record.ts:46)s as display-only markers with a `Symbols:`
legend; Phase 14 (ADR-015) let the cursor *name* the nearest annotation's symbol. Both
deliberately stopped short of showing the rest of the event. `AnnotationEvent` already carries
`auxNote` (and a numeric `code`), and the Phase-14 checkpoint recorded "show `symbol`/`auxNote`
on hover, plus an optional symbol filter" as the natural next increment. Phase 15 closes that gap
without touching the science. Three hazards shaped the decision:

1. **A detail line is a detection in disguise.** The app performs no beat detection and makes no
   clinical claim (rules §47/§49). Naming a symbol *and* a note next to a marker reads even more
   readily than a single symbol as "the app found and classified a beat here". The detail line
   must therefore echo **only** fields already present in
   `result.sourceRecord.annotations`, under the same visibility rule the drawn overlay uses, and
   must never describe a marker the overlay is not drawing.
2. **A filter can read as a query or a claim.** Hiding the markers of other symbols is a display
   selection, not a search for findings. It must change only **what is drawn** (ADR-008), never
   what was computed, and it must never re-invoke the service.
3. **A pinned value can quietly stop being the record's own object.** A click pin is display
   state that must keep pointing at the *record's own* event so the "is it still drawn?" test
   against the drawn list (identity) holds. A Svelte 5 deep-reactive cell silently breaks that
   identity — see (d).

Constraints:

- **Display of a domain fact, never a detection** (ADR-013): every string is read verbatim from
  the record; the view owns no algorithm.
- **No science change / no UI-owned science** (ADR-008/009): the view displays exactly what the
  service returned and never re-runs it.
- **No duplicated sample maths:** the half-open window and every time<->sample conversion stay in
  [`geometry.ts`](../../src/presentation/views/timeSeries/geometry.ts:104) /
  [`src/domain/sampling.ts`](../../src/domain/sampling.ts:1) (ADR-001).
- **One spine:** the "which annotation" rule lives in exactly one place; the Phase-14 summary is
  a projection over it, never a second scan.
- **A readout is not a data access:**
  [`readoutAtFraction`](../../src/presentation/views/timeSeries/navigationGeometry.ts:273) warns
  its index can equal the window's exclusive end sample; nothing here indexes a buffer.
- **No new dependency, no tsconfig/lib change, no new prop.**

## Decision

### (a) One pure resolver returns the record's own event; the Phase-14 summary becomes a projection

[`annotationGeometry.ts`](../../src/presentation/views/timeSeries/annotationGeometry.ts:1) gains
the resolver the interaction is built on, beside the overlay mapping it shares conventions with:

- [`AnnotationHit`](../../src/presentation/views/timeSeries/annotationGeometry.ts:90) —
  `{ event: AnnotationEvent; distanceFraction: number }`, where `event` is the record's own object
  (never synthesised, never copied-then-edited);
- [`nearestAnnotationEventAtFraction()`](../../src/presentation/views/timeSeries/annotationGeometry.ts:300)
  — a clamped `xFraction` plus the annotations, viewport, sampling, sample count and an optional
  tolerance → the nearest annotation's own event within tolerance, else `null`.

Rules (every one tested), **identical to Phase 14** — only *what is returned* changed:

- **Same visibility rule as the overlay:** only annotations whose `sampleIndex` falls inside the
  half-open window `[startSample, endSample)` from `sampleWindowOfTime` are considered, so the
  detail can never describe a symbol the drawn overlay hides.
- **Clamped cursor:** `xFraction` is clamped to `[0, 1]` (non-finite -> `0`).
- **Deterministic nearest:** smallest `distanceFraction`, ties to the lower `sampleIndex`, then to
  the lexicographically smaller `symbol`, so the result never depends on input order.
- **`null` is first-class:** an empty list, a degenerate viewport or a nearest farther than
  `toleranceFraction` yields `null`, and the detail falls back to idle.
- **Validation:** a non-finite or negative `toleranceFraction` is classified `invalid-input`.
- **Read-only:** only `sampleIndex`/`symbol`/`auxNote` are read; no buffer is indexed or written
  and no input is mutated.

[`nearestAnnotationAtFraction()`](../../src/presentation/views/timeSeries/annotationGeometry.ts:348)
is **kept** and re-expressed as a projection over the new resolver (returning `null` when the hit
is `null`, else the three-field Phase-14 summary `{ symbol, sampleIndex, distanceFraction }`), so
its 11 existing Node cases stay green **unchanged** and there is exactly one selection spine.

Rejected alternative (the tempting one): **widen `NearestAnnotation` with `auxNote`/`code`.** The
summary type is a *display projection*; widening it makes the readout carry a data payload and
invites a second, divergent scan with its own tie-break rules. A projection keeps exactly one
definition of "nearest".

### (b) The symbol filter and its resolution are pure, Node-tested helpers

A filter must be a pure function of the annotation list, and a filter a *new window* no longer
contains must fall back deterministically. New exports in
[`annotationGeometry.ts`](../../src/presentation/views/timeSeries/annotationGeometry.ts:1):

- [`filterAnnotationsBySymbol()`](../../src/presentation/views/timeSeries/annotationGeometry.ts:252)
  — the events whose `symbol` equals the filter; `null`/`""` returns the input **unchanged**
  (identity, order preserved); otherwise the exact-match subset in input order. Read-only; never
  mutates the list or its events.
- [`resolveSymbolFilter()`](../../src/presentation/views/timeSeries/annotationGeometry.ts:273)
  — returns the active filter only when it is a non-empty member of `available`, else `null`
  ("All").

That second rule is what makes a filter that a channel/window change removed fall back to "All"
**without** an effect or a manual reset — a pure, order-independent rule. The available set is the
**unfiltered** window's distinct symbols, so the user can always switch back.

### (c) A pure detail formatter, next to the annotation types it formats

Mirroring [`formatCursorReadout`](../../src/presentation/views/timeSeries/navigationGeometry.ts:302)
(which sits beside the `CursorReadout` it renders), the annotation detail formatter lives beside
`AnnotationHit`, with
[`ANNOTATION_DETAIL_IDLE_LABEL`](../../src/presentation/views/timeSeries/annotationGeometry.ts:388)
(`Annotation: —`) as the no-hit case:

- [`formatAnnotationDetail()`](../../src/presentation/views/timeSeries/annotationGeometry.ts:390)
  — hit `null` -> `Annotation: —`;
- otherwise -> `Annotation: {symbol} · sample {sampleIndex}`, plus ` · {auxNote}` (the `\u00b7`
  middle dot, matching the cursor caption) when `auxNote` is a non-empty string;
- an empty/absent note adds **no** suffix, so the line never shows a dangling separator.

`code` is deliberately **not** rendered: the note is the human-readable field this increment is
about and the symbol is the marker vocabulary, so a numeric code would add noise without a fact
the note does not already carry. `code` stays available on the event — a documented decision, not
a loss.

### (d) The view composes the helpers, owns a view-local filter, and pins a clicked hit with `$state.raw`

[`TimeSeriesView.svelte`](../../src/presentation/views/timeSeries/TimeSeriesView.svelte:1) gains
the `series-annotation-detail` caption span, a view-local filter and the pin gesture. The props,
the navigation buttons, the overlay mapping and the `Symbols:` legend are untouched.

- **Filter:** `let symbolFilter = $state<string | null>(null)`
  ([line 143](../../src/presentation/views/timeSeries/TimeSeriesView.svelte:143)), an `allSymbols`
  derived from the **unfiltered** window, `resolvedFilter = resolveSymbolFilter(symbolFilter,
  allSymbols)`, and `annotationResult` computed from
  `filterAnnotationsBySymbol(annotations, resolvedFilter)`. A keyboard-accessible
  `<select aria-label="Symbol filter">` offers `All symbols` plus the window's distinct symbols;
  the summary/legend continue to describe **what is drawn** (the filtered set).
- **Detail:** [`detailHit`](../../src/presentation/views/timeSeries/TimeSeriesView.svelte:308)
  resolves the hit from the **filtered** `visibleAnnotations`, so the detail, the cursor readout
  and the drawn overlay can never disagree; `annotationDetail`
  ([line 317](../../src/presentation/views/timeSeries/TimeSeriesView.svelte:317)) is
  `formatAnnotationDetail(detailHit)`.
- **Pin, held raw:**
  [`pinnedEvent`](../../src/presentation/views/timeSeries/TimeSeriesView.svelte:158) is declared
  `let pinnedEvent = $state.raw<AnnotationEvent | null>(null)`, **not** `$state`. A plain `$state`
  deep-proxies an assigned plain object, so the pinned value would no longer be the record's own
  event; the identity test `visibleAnnotations.includes(pinned)` — which enforces "the caption
  never exceeds what is drawn" — and the promise that a hit is handed on verbatim would both break
  **silently** (no type error, no test failure until one is written). `$state.raw` stores the event
  as-is and stays reactive on reassignment, which is all this display state needs.
- **Gesture:** [`handlePointerDown`](../../src/presentation/views/timeSeries/TimeSeriesView.svelte:402)
  records the press fraction **unconditionally** (so a click can pin even when no
  `onViewportCommit` is supplied);
  [`handlePointerUp`](../../src/presentation/views/timeSeries/TimeSeriesView.svelte:448) treats a
  release within `PIN_MOVE_TOLERANCE_FRACTION`
  ([0.01](../../src/presentation/views/timeSeries/TimeSeriesView.svelte:165)) of the press as a
  **click** — [`pinNearestAtFraction`](../../src/presentation/views/timeSeries/TimeSeriesView.svelte:432)
  pins the nearest in-window event's own object, or clears the pin when none is close, and commits
  **no** window — otherwise it is a **drag** that commits exactly as today. This **replaces the
  Phase-13 implicit zero-width click-zoom**; `viewportFromFractions`, the drag geometry, is
  unchanged.
- The pin survives `pointerleave` (the cursor readout still goes idle on leave); a hover with no
  pin clears only the transient cursor, as before.
- No new prop; [`App.svelte`](../../src/presentation/App.svelte:1) and
  [`ViewControls.svelte`](../../src/presentation/views/controls/ViewControls.svelte:1) are
  untouched.

Rejected alternatives: (1) **derive the nearest symbol from the density-capped marker list** — the
overlay's `annotationMarkers` is density-capped to one marker per pixel column, so a symbol can be
absent from it purely for display reasons; naming it would make the detail depend on the plot's
pixel width rather than on the record, so the resolver scans the *record's* annotations under the
window rule. (2) **put the filter in `ViewControls`** — the toolbar is a channel/viewport control
wired by `App`, and routing an annotation filter up would add props and couple the generic toolbar
to annotation semantics. (3) **identify the pin by a symbol+index key** instead of the event
object — a key is a second source of truth that can drift from the list; identity against the
record's own events is the whole safety property, so the pin holds the event itself.

### (e) Testability split and the phase gates

- **Numerical:** [`annotationGeometry.test.ts`](../../src/presentation/views/timeSeries/__tests__/annotationGeometry.test.ts:1)
  — Node tests for the resolver (the exact hit returning the **same event object**, `auxNote`
  carried verbatim, the nearer of two, the deterministic tie-break, the half-open end exclusion, an
  interior window, an out-of-plot clamp, a tolerance override including `0`, `null` for
  empty/degenerate/beyond-tolerance, the `invalid-input` tolerance, no mutation, and agreement with
  the Phase-14 projection), for the filter (identity for `null`/`""`, exact-match subset in order,
  no-match empty, no mutation, and the `resolveSymbolFilter` fallbacks), and for the formatter (the
  idle branch, the symbol+sample branch, the non-empty-note branch and the empty-note
  no-dangling-separator branch).
- **Wiring (jsdom):** [`TimeSeriesView.test.ts`](../../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:459)
  — jsdom tests over a stubbed `200x100` `getBoundingClientRect`: the idle detail by default; the
  detail naming the hovered annotation's `symbol` + `auxNote`; the filter select listing the window
  symbols and narrowing the summary/legend while keeping every option; a reset to `All symbols`; a
  click pinning a marker's detail and committing **no** viewport; a drag still committing exactly
  one window with the detail idle; a later click clear of every marker clearing the pin; the pin
  surviving `pointerleave`; the pin dropped once the filter excludes its marker; and the pin held
  while the pointer hovers elsewhere as the cursor keeps tracking.
- **Never asserted:** canvas pixels (jsdom has no 2d context; the draw pass runs on its guarded
  path) and no wall-clock timing (rules §51).
- **Docs gate:** the §I bullet, §M item 15 and the decision-register entry are documentation only;
  `npm run check` stays green without a count change.

## Consequences

- The time-series view now shows the record's own `symbol` and `auxNote` for the annotation under
  the pointer, can narrow the overlay to a single symbol, and can pin a clicked annotation's detail.
  It does not replace the overlay or its `Symbols:` legend, which still enumerates the window's
  whole (unfiltered) set.
- **A filter hides; it never claims — structurally.** `filterAnnotationsBySymbol` reads only
  `annotation.symbol`; the service is never re-invoked and every sample buffer is untouched
  (ADR-008). The filter options derive from the **unfiltered** window, so a symbol can always be
  restored.
- **Never a detection — structurally.** Every displayed string is read from
  `result.sourceRecord.annotations`; the helper has no access to DSP/ML output, and it returns
  `null`/idle for the synthetic boot record (whose `annotations` is empty), so a non-idle detail
  line is reachable only via a real/local record.
- **Never a data access.** The returned event and its `sampleIndex` are readouts; nothing indexes a
  buffer with them.
- **The click gesture changed its meaning, deliberately.** A bare click no longer commits a
  zero-width zoom; it pins (or clears) the detail. The drag-zoom path is byte-for-byte the Phase-13
  geometry. Both are covered by jsdom tests over the stubbed rect.
- **A Svelte 5 hazard is now documented and guarded.** The pin is `$state.raw` because a deep
  reactive cell would break the identity the "still drawn?" test relies on; a regression test pins
  the pointer-elsewhere case so a future "tidy-up" back to `$state` fails loudly.
- **Cost is O(n) in the window's annotations per pointer move and per click**, over a handful of
  numbers — no new buffer, no new dependency.
- **Honest limits:** the pin/click tolerance is a **display** guard (a plot-fraction radius), not a
  measurement threshold, and the overlay's pixel-column density cap is independent of the resolver
  — the resolver may name an annotation whose column representative differs, and it never reports
  `mergedCount`. jsdom proves only the wiring; the geometry and the strings are the pure Node
  gates.
- **No new dependency, no tsconfig change, no science/application change**; ADR-001/008/009 and
  ADR-013/014/015 all hold unchanged.

## References

- Architecture plan §I (browser execution architecture — the interaction is main-thread and
  display-only), §M item 15 (Phase 15), decision register (ADR-016)
- [`plans/phase-15-plan.md`](../../plans/phase-15-plan.md) — approved scope and item-by-item gates
- ADR-013 (the display-only annotation overlay and legend this extends), ADR-014 (the cursor
  readout and navigation whose bare-click zoom this replaces with a pin), ADR-015 (the Phase-14
  nearest-annotation resolver this generalizes to the full event), ADR-008 (selection is a display
  concern over a full-record result), ADR-001 (sample i occurs at i / sampleRateHz)
- Rules §30 (no duplicated science), §47/§49 (no clinical claim — an annotation is never a
  detection), §51 (no wall-clock assertions), §56 (green check gate)
