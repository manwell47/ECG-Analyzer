# Phase 15 Audit / Completion — Annotation interaction: hover detail, an optional symbol filter and a bounded click-to-pin

Recorded 2026-09-13 (Code-mode completion record). Verdict: **Phase 15 implemented
and fully green.** The full `npm run check` gate passes at the end of every item
and again as the final gate: typecheck ✓, svelte-check (0 errors / 0 warnings) ✓,
lint ✓, **59 test files / 693 tests** ✓, Vite build ✓ (**167 modules**).
**Presentation only:** no domain, parser, DSP/DWT, ML, worker or application code
changed. The scientific configuration stays `db4 / 4 / periodic`; the detail line
names only an annotation the record already contains and the filter only *hides*
markers — neither is ever a detection, a re-analysis, or a claim, and the source
`Float64Array`s are read, never written (ADR-008/013/015/016 hold).

## Scope / approved increment

> "The user approved **Candidate 1** from the Phase-14 checkpoint: **annotation
> interaction** — hover/click a marker to show its `symbol` / `auxNote`, plus an
> **optional symbol filter** — the natural presentation follow-on now that the
> Phase-14 cursor readout can already *name* the nearest marker.
>
> This is a **presentation-layer** increment. No domain, DSP/DWT, ML, worker,
> parser, adapter or application-service change; `App.svelte` is unchanged (it
> already forwards `annotations={result.sourceRecord.annotations}` and
> `onViewportCommit`). Data still reaches the views only through the application
> service; the views stay display-only and never mutate source buffers."
> — [`plans/phase-15-plan.md`](phase-15-plan.md:11)

The user's governing instruction was to **approve the plan as written**, keeping
every item **including the optional click-to-pin (Item 4)**, and to switch to Code
to execute it item by item. That is exactly what was executed.

The single most important honesty constraint of the increment is that the detail
line and the filter operate on the **record's own** annotations — the *display* of a
domain fact, exactly like the Phase-12 overlay legend and the Phase-14 readout, and
**never a detection** and never a clinical/model claim (rules §47/§49). A filter
**hides** markers; it never asserts a finding, never re-runs the analysis, and never
changes what the science computed. The detail, the cursor readout and the drawn
overlay are all resolved from the **same filtered list**, so the caption can never
describe a marker that is not drawn.

## Files added

| Purpose | File |
|---|---|
| ADR-016: the annotation-interaction decision | [`plans/adr/ADR-016-annotation-interaction.md`](adr/ADR-016-annotation-interaction.md:1) |
| Phase 15 audit (this record) | [`plans/phase-15-audit.md`](phase-15-audit.md:1) |

The approved plan [`plans/phase-15-plan.md`](phase-15-plan.md:1) was authored in
Architect mode as the precursor to this phase.

**No new production or test file** was added: the phase extends the existing pure
[`annotationGeometry.ts`](../src/presentation/views/timeSeries/annotationGeometry.ts:1)
helper and its Node gate plus the existing jsdom view slice, so the build-module
count stays **167** and the test-file count stays **59**.

**Touched:**

- [`src/presentation/views/timeSeries/annotationGeometry.ts`](../src/presentation/views/timeSeries/annotationGeometry.ts:1)
  — added the [`AnnotationHit`](../src/presentation/views/timeSeries/annotationGeometry.ts:90)
  type, the pure
  [`nearestAnnotationEventAtFraction()`](../src/presentation/views/timeSeries/annotationGeometry.ts:300)
  resolver (returns the record's own event; same half-open window rule as
  `annotationMarkers`, clamped cursor, deterministic nearest, `null` first-class,
  `invalid-input` tolerance, read-only), re-expressed
  [`nearestAnnotationAtFraction()`](../src/presentation/views/timeSeries/annotationGeometry.ts:348)
  as a **projection** over it (one selection spine), and added the pure
  [`filterAnnotationsBySymbol()`](../src/presentation/views/timeSeries/annotationGeometry.ts:252),
  [`resolveSymbolFilter()`](../src/presentation/views/timeSeries/annotationGeometry.ts:273),
  [`ANNOTATION_DETAIL_IDLE_LABEL`](../src/presentation/views/timeSeries/annotationGeometry.ts:388)
  and [`formatAnnotationDetail()`](../src/presentation/views/timeSeries/annotationGeometry.ts:390).
- [`src/presentation/views/timeSeries/__tests__/annotationGeometry.test.ts`](../src/presentation/views/timeSeries/__tests__/annotationGeometry.test.ts:1)
  — **25** new Node cases across three new `describe`s (event resolver +11, filter
  +5, symbol-filter resolution +4, detail formatter +5); the 23 existing cases stay
  green **unchanged**, including all 11 `nearestAnnotationAtFraction` cases (now the
  projection).
- [`src/presentation/views/timeSeries/TimeSeriesView.svelte`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:1)
  — added the `series-annotation-detail` caption span
  ([`annotationDetail`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:317)),
  the view-local [`symbolFilter`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:143)
  with its keyboard-accessible `<select aria-label="Symbol filter">`, the
  [`allSymbols`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:1) /
  `resolvedFilter` derivations and a `filterAnnotationsBySymbol`-filtered
  `annotationResult`, the
  [`detailHit`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:308) derived
  resolving the hit from the **filtered** list, and the bounded click-to-pin
  ([`pinnedEvent`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:158) held
  with `$state.raw`, [`PIN_MOVE_TOLERANCE_FRACTION`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:165),
  [`pinNearestAtFraction`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:432),
  the [`handlePointerUp`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:448)
  click/drag split). No new prop; the props, the five navigation buttons, the overlay
  and the `Symbols:` legend are untouched; the view still imports no service and
  writes no buffer.
- [`src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts`](../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:1)
  — **11** new jsdom cases (5 for the detail + filter in
  `annotation detail and symbol filter (Phase 15 item 3)`, 6 for the pin in
  `bounded click-to-pin (Phase 15 item 4)`) over a stubbed `200×100`
  `getBoundingClientRect`; the 24 existing cases stay green **unchanged**.
- [`plans/ecg-lab-architecture.md`](ecg-lab-architecture.md:277) — §I bullet (the
  annotation detail and an optional symbol filter are displayed; display of a domain
  fact, never a detection; a filter hides, it never claims), §M item 15 (Phase 15),
  and the decision-register entry (+ADR-016).

**Not touched (by design):** all of `src/domain/**` (`record.ts`, `sampling.ts`,
`signal.ts`, `units.ts`, `numeric.ts`, `error.ts`); all of `src/datasets/**`; all of
`src/dsp/**`, `src/ml/**`, `src/workers/**`, `src/bench/*`;
[`src/application/analysis.ts`](../src/application/analysis.ts:1) / `defaults.ts` /
`dspExecutor.ts`; [`src/main.ts`](../src/main.ts:1); `src/presentation/dataset/*`,
`src/presentation/workers/*`;
[`App.svelte`](../src/presentation/App.svelte:1) — it already forwards
`annotations` and `onViewportCommit`, so the interaction is entirely a view concern;
[`ViewControls.svelte`](../src/presentation/views/controls/ViewControls.svelte:1) and
[`presets.ts`](../src/presentation/views/controls/presets.ts:1) (the toolbar stays
thin); and
[`DwtCoefficientView.svelte`](../src/presentation/views/dwt/DwtCoefficientView.svelte:1)
(the detail and filter are a time-series concern only). No new dependency and no
`tsconfig` / `vite.config.ts` change. Rules §30 (no duplicated science) held: every
time↔sample conversion still goes through
[`src/domain/sampling.ts`](../src/domain/sampling.ts:1), and the resolver reuses
`sampleWindowOfTime` / `timeSecOfSample`.

## Item-by-item mapping

0. **Pre-flight** — `npm run check` green (**59 files / 657 tests / 167 modules**);
   no files touched.
1. **Pure hit resolver** — `annotationGeometry.ts` gained `AnnotationHit` and
   `nearestAnnotationEventAtFraction()`, and `nearestAnnotationAtFraction()` became a
   projection over it; a new Node `describe` of **11** cases; `npm run check` green
   (**59 files / 668 tests / 167 modules**; +11 Node tests; no new file, build
   unchanged). The 11 existing resolver cases stayed green unchanged.
2. **Pure filter + detail formatter** — `filterAnnotationsBySymbol()`,
   `resolveSymbolFilter()`, `ANNOTATION_DETAIL_IDLE_LABEL` and `formatAnnotationDetail()`
   added with **14** new Node cases; `npm run check` green (**59 files / 682 tests /
   167 modules**; +14 Node tests).
3. **`TimeSeriesView` hover detail + optional symbol filter** — the detail span, the
   `symbolFilter` state / `allSymbols` / `resolvedFilter` derivations and the filtered
   `annotationResult` / `detailHit`, plus **5** jsdom cases; `npm run check` green
   (**59 files / 687 tests / 167 modules**; +5 jsdom tests).
4. **(Optional) bounded click-to-pin** — kept as the user approved: the press
   fraction is recorded unconditionally, `handlePointerUp` splits a click (pin, commit
   **no** window) from a drag (commit as today), and the pin is held with `$state.raw`;
   **6** jsdom cases; `npm run check` green (**59 files / 693 tests / 167 modules**;
   +6 jsdom tests). One transient red on the first run (see "Honest notes" below),
   fixed in the production declaration.
5. **ADR-016 + architecture update** — ADR-016 written; §I bullet / §M item 15 /
   decision register updated; `npm run check` green (**59 files / 693 tests / 167
   modules** — docs-only, counts unchanged).
6. **Audit + final gate (this record)** — final full `npm run check` green
   (**59 files / 693 tests / 167 modules**).

## Evidence (the correctness gates)

The correctness claims are pinned by tests at two levels — a **pure Node** gate for
the geometry, the filter and the strings, and a **jsdom** gate for the wiring — never
by pixels or timings:

- **Resolver gate (Node) —**
  [`annotationGeometry.test.ts`](../src/presentation/views/timeSeries/__tests__/annotationGeometry.test.ts:399)
  (the 11 `nearestAnnotationEventAtFraction` cases) covers that the hit is the
  record's **own event object** (identity, never a copy); that `auxNote` and `code`
  are carried verbatim; the nearer of two in-window annotations; the deterministic
  tie-break (lower sample index, then smaller symbol) independent of input order;
  that annotations outside the **half-open** window are dropped; that an out-of-plot
  cursor is clamped; a tolerance override including `0`; `null` for an empty list, a
  degenerate viewport or a distant cursor; `invalid-input` for a non-finite / negative
  tolerance; that the list is never mutated; and that the function **agrees with the
  `nearestAnnotationAtFraction` projection**.
- **Filter + formatter gate (Node) —**
  [`annotationGeometry.test.ts`](../src/presentation/views/timeSeries/__tests__/annotationGeometry.test.ts:612)
  (the 5 `filterAnnotationsBySymbol`, 4 `resolveSymbolFilter` and 5
  `formatAnnotationDetail` cases) covers the filter **identity** for `null`/`""`, the
  exact-match subset in input order, the empty result for no match, no mutation of the
  list or its events; the `resolveSymbolFilter` membership / empty-string / absent
  fallbacks; the formatter idle branch (`Annotation: —` byte-for-byte), the
  symbol+sample branch, the non-empty-note branch, the empty-note
  **no-dangling-separator** branch, and that `code` is never rendered.
- **Wiring gate (jsdom) —**
  [`TimeSeriesView.test.ts`](../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:459)
  renders the real view with annotations and a stubbed `200×100`
  `getBoundingClientRect`: the idle `Annotation: —` detail by default; the detail
  naming the hovered annotation's `symbol` + `auxNote` at `clientX 50`; the filter
  select listing the window symbols and narrowing the summary/legend to the chosen
  symbol **while keeping every option**; the reset to `All symbols`; a click pinning a
  marker's detail and committing **no** viewport (asserted through a recorded-commit
  callback); a drag still committing **exactly one** window (0.4 s → 2.4 s) with the
  detail idle; a later click clear of every marker **clearing** the pin; the pin
  surviving `pointerleave` while the cursor goes idle; the pin **dropped** once the
  symbol filter excludes its marker; and the pin held while the pointer hovers
  elsewhere as the cursor keeps tracking. jsdom cannot measure layout, so the DOM
  slice proves only the view's **wiring** — the geometry, the filter and the strings
  are the Node gates above.
- The Phase-12 regression that pins **exactly two** `t = … s → … s` window elements
  and the Phase-14 `Cursor: …` forms still pass unchanged.

## Decisions recorded (ADR-016)

1. **One resolver returns the record's own event; the Phase-14 summary is a
   projection** —
   [`nearestAnnotationEventAtFraction()`](../src/presentation/views/timeSeries/annotationGeometry.ts:300)
   is the single scan, and
   [`nearestAnnotationAtFraction()`](../src/presentation/views/timeSeries/annotationGeometry.ts:348)
   is re-expressed over it, so the two can never diverge and the 11 existing cases
   stay green unchanged.
2. **The filter and its resolution are pure, order-independent helpers** —
   [`filterAnnotationsBySymbol()`](../src/presentation/views/timeSeries/annotationGeometry.ts:252)
   is the identity for `null`/`""` and the exact-match subset otherwise, and
   [`resolveSymbolFilter()`](../src/presentation/views/timeSeries/annotationGeometry.ts:273)
   makes a filter a window change removed fall back to "All" **without** an effect or
   a manual reset; the option set derives from the **unfiltered** window so a symbol
   can always be restored.
3. **The detail line is a pure, Node-tested formatter** —
   [`formatAnnotationDetail()`](../src/presentation/views/timeSeries/annotationGeometry.ts:390)
   + [`ANNOTATION_DETAIL_IDLE_LABEL`](../src/presentation/views/timeSeries/annotationGeometry.ts:388)
   render `Annotation: {symbol} · sample {i}` plus the non-empty `auxNote`, and
   deliberately omit `code` (a documented decision; `code` stays on the event).
4. **The view composes the helpers; the filter is view-local; the detail resolves from
   the filtered list** — the detail, the cursor readout and the drawn overlay share one
   filtered list, so the caption can never describe a marker the filter has hidden; no
   new prop, `App.svelte` unchanged.
5. **A click pins the nearest annotation's own event; the pin is `$state.raw`** — the
   press fraction is recorded unconditionally, a release within
   `PIN_MOVE_TOLERANCE_FRACTION` (`0.01`) of it is a **click** that pins (or clears)
   the detail and commits **no** window, replacing the Phase-13 implicit zero-width
   click-zoom; the pin holds the record's own event and is honoured only while that
   event is still in the drawn (filtered) list. The pin must be a raw cell — a deep
   reactive `$state` proxies the assigned object and silently breaks the identity test.
6. **Rejected alternatives** — widening `NearestAnnotation` with `auxNote`/`code`
   (would make the display projection carry a data payload and invite a second scan);
   deriving the nearest symbol from the density-capped marker list (would make the
   detail depend on plot pixel width); putting the filter in `ViewControls` (would add
   props and couple the generic toolbar to annotation semantics); identifying the pin
   by a symbol+index key instead of the event object (a second source of truth that can
   drift from the list).
7. **Testability split** — the numerical truth and the strings are the Node
   resolver/filter/formatter tests; the jsdom slices assert the wiring only (canvas
   pixels and wall-clock timings are never a gate; rules §51).

## What Phase 15 proves and does not prove

**Proves** — hovering a plotted annotation (within a display-fraction tolerance) shows
the record's **own** `symbol` and `auxNote` in the detail line; the detail is resolved
deterministically (distance → lower sample index → lexicographically smaller symbol)
and independent of input order; the symbol filter narrows the drawn overlay **and** the
summary/legend to one symbol while the options always offer the whole unfiltered
window (so a removed filter falls back to "All" with no manual reset); a click pins the
clicked annotation's detail and commits **no** viewport while a drag still commits
exactly one window; the pin survives `pointerleave` but is dropped as soon as the
filter excludes its marker; the detail, the cursor readout and the overlay can never
disagree because they share one filtered list; and the whole path is **display-only** —
no service call, no science change, no new prop, no buffer write.

**Does not prove** — that the pointer sits on a *pixel* that visually overlaps a
marker in a real browser: jsdom has no layout, so the DOM slices stub the rect and
prove the wiring only. It does not prove canvas rendering fidelity (jsdom cannot draw),
so the drawn marker/overlay and the detail/filter are confirmed to agree only by hand
under `npm run dev`. The overlay's per-pixel **density cap** is independent of the
resolver (the resolver may name an annotation whose column representative differs, and
it never reports `mergedCount`). The pin/click tolerance is a plot-fraction radius, not
a measurement threshold. No science or clinical claim is made anywhere (rules §47/§49).

## Residual risk

- **The pin/click tolerance is a presentation guard, not a measurement threshold** —
  `0.01` of the plot width distinguishes a click from a drag for the mouse/keyboard
  gesture; it is deliberately not a scientific parameter and is documented as such
  (ADR-016).
- **The Svelte 5 deep-proxy hazard is real and silent** — `pinnedEvent` must stay
  `$state.raw`. A regression test (pin held while the pointer hovers elsewhere) fails
  loudly if a future change reverts it to `$state`, but the underlying footgun is a
  framework behaviour, not something the app can assert against in general.
- **The filter option set and the drawn set are computed separately** — `allSymbols`
  (unfiltered) feeds the options and `annotationResult` (filtered) feeds the drawing;
  this is intended (so a filter can always be reset) and stated in ADR-016.
- **The hover/click path is exercised through a stubbed rect** — jsdom cannot measure
  layout, so the pointer→fraction path is covered by the pure Node tests plus the
  stubbed wiring slices, and by a manual `npm run dev` check.

## Test counts

Final `npm run check`: **59 test files / 693 tests** (Phase-14 close: 59 / 657;
**+36 tests, no new file**). Build: **167 modules** (unchanged from the Phase-14
close — the new exports live in files already in the graph).

Added to existing files:

| File | Tests | Level |
|---|---|---|
| [`annotationGeometry.test.ts`](../src/presentation/views/timeSeries/__tests__/annotationGeometry.test.ts:1) | +25 (23 → 48) | Node |
| [`TimeSeriesView.test.ts`](../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:1) | +11 (24 → 35) | jsdom |

**Honest notes:** the Item-4 gate went red once — 4 of the 6 new pin tests failed
while the drag test passed. A temporary diagnostic slice
(`pinDebug.test.ts`, deleted before the gate) proved the click branch ran with **no**
commit yet produced no pin, and the pin followed the *hover* rather than the click.
Root cause: `let pinnedEvent = $state<AnnotationEvent | null>(null)` — Svelte 5
`$state` deep-proxies an assigned plain object, so the pinned value was no longer the
record's own event and `visibleAnnotations.includes(pinned)` (identity) was false, so
`detailHit` silently fell back to the hover hit. Fix:
`let pinnedEvent = $state.raw<AnnotationEvent | null>(null)` (a raw cell stores the
event as-is and stays reactive on reassignment); the probe then passed, the debug file
was removed, and the regression test "keeps the pin while the pointer hovers elsewhere"
was added so a revert fails loudly.

**Gate history:** 0 → 59/657/167 · 1 → 59/668/167 · 2 → 59/682/167 · 3 →
59/687/167 · 4 → 59/693/167 · 5 → 59/693/167 · 6 → 59/693/167.

## References

- [phase-15-plan.md](phase-15-plan.md:1) — the approved plan executed above.
- [ADR-016-annotation-interaction.md](adr/ADR-016-annotation-interaction.md:1)
  — the annotation-interaction decision.
- [ADR-013-annotation-display.md](adr/ADR-013-annotation-display.md:1) — the
  display-only annotation overlay and legend this extends ("display of domain facts,
  never science; never a detection").
- [ADR-014-signal-navigation.md](adr/ADR-014-signal-navigation.md:1) and
  [ADR-015-cursor-annotation-readout.md](adr/ADR-015-cursor-annotation-readout.md:1)
  — the navigation/readout decisions whose bare-click zoom this replaces with a pin
  and whose nearest-annotation resolver this generalizes to the full event.
- [ecg-lab-architecture.md](ecg-lab-architecture.md:277) — §I bullet / §M item 15 /
  decision register (+ADR-016).
- [phase-14-audit.md](phase-14-audit.md:1) and
  [phase-14-checkpoint.md](phase-14-checkpoint.md:1) — the audit/checkpoint templates
  this phase mirrors.
