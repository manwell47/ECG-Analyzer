# ADR-018 — Annotation set filtering, a clickable legend and a bounded annotation list (display only)

Status: Accepted
Date: 2026-09-14
Scope: Phase 17 — **presentation only**. The time-series view may narrow the drawn annotation
overlay to a **set** of symbols (the empty set meaning "All symbols"), turn its `Symbols:` legend
into the control that selects that set, and list the window's own events (symbol/sample/note) in a
bounded, scrollable panel whose rows pin through the **same** pin the canvas click sets. No domain,
DSP/DWT, ML, worker, parser, adapter or application-service change; no new science configuration;
the analysis is never re-invoked; no sample buffer is written.

## Context

Phase 12 (ADR-013) overlaid the record's own
[`AnnotationEvent`](../../src/domain/record.ts:46)s as display-only markers with a `Symbols:`
legend; Phase 15 (ADR-016) added a hover **detail line**, a view-local **single-symbol** `<select>`
filter and a bounded **click-to-pin**. Both deliberately stopped at one symbol: the `Symbols:`
legend enumerated the window's distinct symbols as **inert text** — it described the vocabulary but
was not itself the control — and the `<select>` could only ever narrow to exactly one symbol or
back to "All". A reader wanting "P and V together" or "everything that is not N" had no way to
express it, and the window's own events could not be read as a list without hovering each marker
one at a time. Phase 17 closes both gaps without touching the science. Three hazards shaped the
decision:

1. **A multi-symbol selection can still read as a query or a detection.** The app performs no beat
   detection and makes no clinical claim (rules §47/§49). A set that draws two symbols at once
   reads even more readily as "the app found and grouped these beats" than a single-symbol filter,
   so the selection must be explained as **what is drawn** only — it hides markers and never
   re-invokes the service (ADR-008), never changes what the science computed, and never describes
   an event the overlay is not drawing.
2. **A listed, capped set can read as a finding — and a count.** Listing the window's own events is
   the display of record facts, but a cap on that list is a **DOM-size guard**, not a threshold: a
   panel that silently stopped at the cap, or that let the cap change *which* events are considered,
   would imply the app had selected "the first N detections" or "the important ones". The cap must
   be explicit in the caption, must bound only the rendered rows, and the boundary between drawn,
   listed and counted must stay one rule.
3. **A row click and a canvas click must name the same annotation.** The detail line already
   depends on the pin being the *record's own* event object (the "is it still drawn?" identity test
   against the drawn list, ADR-016 (d)). A second entry point must feed the **same** cell with the
   **same** object identity, or the row and the canvas would be able to disagree — silently.

Constraints:

- **Display of a domain fact, never a detection** (ADR-013): every string is read verbatim from
  the record; the view owns no algorithm.
- **No science change / no UI-owned science** (ADR-008/009): the view displays exactly what the
  service returned and never re-runs it.
- **No duplicated sample maths:** the half-open window and every time<->sample conversion stay in
  [`geometry.ts`](../../src/presentation/views/timeSeries/geometry.ts:104) /
  [`src/domain/sampling.ts`](../../src/domain/sampling.ts:1) (ADR-001).
- **One spine:** there is exactly one "which annotation" rule and exactly one symbol-filter rule;
  the single-symbol helpers are projections over the set helpers, never a second scan.
- **The legend options are the window's own facts:** always the **unfiltered** window's distinct
  symbols, so a toggle can never hide its own off-switch.
- **No new dependency, no tsconfig/lib change, no new prop.**

## Decision

### (a) The selection is a set of symbols; the empty set is "All symbols"

[`annotationGeometry.ts`](../../src/presentation/views/timeSeries/annotationGeometry.ts:1) gains a
set-shaped filter and its resolver, beside the single-symbol helpers they generalize:

- [`filterAnnotationsBySymbols()`](../../src/presentation/views/timeSeries/annotationGeometry.ts:258)
  — the events whose `symbol` is a member of the selection; an **empty** selection returns the
  input **unchanged** (identity, order preserved); otherwise the membership subset in input order.
  Read-only; never mutates the list or its events.
- [`resolveSymbolFilters()`](../../src/presentation/views/timeSeries/annotationGeometry.ts:302)
  — the stored selection narrowed to the members the available set still contains, in the
  available set's own order; the **empty** result ("All symbols") when nothing remains.

The empty set is the identity for the filter and the `null`-equivalent ("All") for the resolver, so
a selection a channel/window change invalidated falls back to "All" **without** an effect or a
manual reset — a pure, order-independent rule — and the user can always switch every symbol back on.
The available set is the **unfiltered** window's distinct symbols.

### (b) The single-symbol helpers stay projections over the set helpers

[`filterAnnotationsBySymbol()`](../../src/presentation/views/timeSeries/annotationGeometry.ts:280)
and [`resolveSymbolFilter()`](../../src/presentation/views/timeSeries/annotationGeometry.ts:319)
are **kept** and re-expressed as projections over the set helpers (a single symbol as a one-element
set; the Phase-15 `null`/`""` fallback as the empty set). Their existing Node cases stay green
**unchanged** and there is exactly one filter rule, not two that can drift apart.

Rejected alternative (the tempting one): **write the set filter as a fresh scan.** A second scan
would duplicate the membership semantics and the "empty means All" rule, and the two would be free
to disagree after any later edit — precisely the "one spine" hazard ADR-016 (a) already rejected for
the resolver. A projection keeps exactly one definition of "which symbols are drawn".

### (c) The legend becomes the control, superseding the Phase-15 single-select

The `Symbols:` legend stops being inert text and **is** the selection control: one toggle
`<button>` per window symbol inside a `role="group" aria-label="Symbol selection"`, each carrying
`aria-pressed={resolvedFilters.includes(symbol)}` and toggling its symbol through
[`toggleSymbol()`](../../src/presentation/views/timeSeries/TimeSeriesView.svelte:537).

- The `<select aria-label="Symbol filter">` and `resolveSymbolFilter`'s **view-side** use are
  **removed**; the single-symbol **helpers** remain (b) but the view no longer routes through them.
  This **supersedes the Phase-15 single-select**: the same bounded display selection, now a set,
  expressed by a control the user can already read.
- `toggleSymbol` derives the new stored selection from the **effective** one, so it only ever holds
  symbols the current window offers, in the window's own order; toggling the last pressed symbol off
  returns to "All symbols" (the empty set). Nothing is re-analysed and no window is committed.
- The options come from [`allSymbols`](../../src/presentation/views/timeSeries/TimeSeriesView.svelte:226)
  — the **unfiltered** window — so a pressed selection can never remove a symbol's own toggle.

Rejected alternative: **keep the `<select>` beside the legend.** Two controls over one selection
would either duplicate state or need syncing, and a `<select>` cannot express a set without a
multi-select widget whose affordances are worse than the label the user is already reading.

### (d) The annotation list is bounded, built from the same filtered list the canvas draws, and shares the single pin

[`annotationGeometry.ts`](../../src/presentation/views/timeSeries/annotationGeometry.ts:1) gains the
pure listing helper the panel is built on:

- [`ANNOTATION_LIST_LIMIT`](../../src/presentation/views/timeSeries/annotationGeometry.ts:450) — the
  documented display cap (a DOM-size guard, never a threshold);
- [`AnnotationList`](../../src/presentation/views/timeSeries/annotationGeometry.ts:459) —
  `{ entries; visibleCount; truncated }`;
- [`annotationList()`](../../src/presentation/views/timeSeries/annotationGeometry.ts:496) — the
  record's own in-window events, sorted by `sampleIndex` then lexicographically smaller `symbol`,
  capped to `entries.slice(0, limit)` with `visibleCount` the **uncapped** total and `truncated`
  whether the cap bit; the entries are the record's own objects (never copies);
- [`formatAnnotationListCaption()`](../../src/presentation/views/timeSeries/annotationGeometry.ts:534)
  — `No annotations in view` / `Showing first {n} of {total} in view` / `{total} in view`.

[`TimeSeriesView.svelte`](../../src/presentation/views/timeSeries/TimeSeriesView.svelte:1) renders
that as a `series-annotation-list` `<section aria-label="Annotations in view">` with a caption `<p>`
and a scrollable `<ol>` of row `<button>`s; each row's label is
[`formatAnnotationDetail()`](../../src/presentation/views/timeSeries/annotationGeometry.ts:437)
(one formatter, no second) and its accessible state is
`aria-current={pinnedEvent === entry ? "true" : undefined}`.

The list is built from
[`visibleAnnotations`](../../src/presentation/views/timeSeries/TimeSeriesView.svelte:267) — the
**same** filtered list the canvas draws — under the same half-open window, so a row can never name
an event the overlay hides. A row click calls
[`pinEvent()`](../../src/presentation/views/timeSeries/TimeSeriesView.svelte:551), which sets the
**same** `$state.raw` [`pinnedEvent`](../../src/presentation/views/timeSeries/TimeSeriesView.svelte:178)
the canvas click path sets, with the **same** event-object identity — one pin, two entry points.

Rejected alternatives: (1) **derive the list from the density-capped marker list** — the overlay's
`annotationMarkers` is capped to one marker per pixel column, so the list would depend on the plot's
pixel width rather than on the record; the helper scans the *record's* annotations under the window
rule. (2) **cap by "the most interesting" events** — ordering by anything but `sampleIndex`/`symbol`
would smuggle in a judgement the app does not make; the order is a deterministic display order and
the caption states the cap. (3) **a second `pinnedEvent` for rows** — a second pin could disagree
with the canvas highlight and the detail line; identity against the record's own events is the whole
safety property, so there is exactly one pin cell.

### (e) Display only — a selection hides and a cap bounds; neither claims

- `filterAnnotationsBySymbols` reads only `annotation.symbol`; `annotationList` reads only
  `sampleIndex`/`symbol`/`auxNote`. Neither reaches DSP/ML output and neither writes a buffer.
- The service is **never** re-invoked: a toggle and a row click are display actions (ADR-008) — the
  jsdom gate pins the "no viewport committed" and "never re-analysis" facts.
- The cap is a **presentation** bound stated in the caption; it bounds the rendered rows only, never
  the window's considered events (`visibleCount` is always the uncapped total).
- The detail line stays the display of a domain fact, never a detection (ADR-013): it is reachable
  only via a real/local record, never the synthetic boot record (whose `annotations` is empty).

### (f) Testability split and the phase gates

- **Numerical (Node):** [`annotationGeometry.test.ts`](../../src/presentation/views/timeSeries/__tests__/annotationGeometry.test.ts:1)
  — the set filter (identity for the empty set, membership subset in order, single-symbol agreement
  with the projection, no-match empty, no mutation), the set resolver (members kept in available
  order, order-independent, single-symbol agreement), and the list (window containment incl. the
  half-open end, ascending `sampleIndex` then smaller `symbol`, the cap with the uncapped
  `visibleCount`, `truncated = false` when the window fits, the record's own objects, empty/
  degenerate cases, invalid-input limit, no mutation) plus the caption's three branches.
- **Wiring (jsdom):** [`TimeSeriesView.test.ts`](../../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:1)
  — over the stubbed `200x100` `getBoundingClientRect`: the toggle group offering the window's
  symbols with the union of several pressed, the count, the empty selection reporting none pressed,
  one row per in-window event naming symbol/sample/note, the window exclusion, a row click pinning
  its own event via `aria-current` while committing **no** viewport, the list shrinking with the
  selection, the empty-window caption, and the cap stating the in-view total.
- **Never asserted:** canvas pixels (jsdom has no 2d context; the draw pass runs on its guarded
  path) and no wall-clock timing (rules §51).
- **Opt-in real-data slice:** the [`realDataInteraction.integration.test.ts`](../../src/presentation/views/timeSeries/__tests__/realDataInteraction.integration.test.ts:1)
  gate (ADR-017) still runs when `data/raw/mitdb` is present; its detail assertion reads the caption
  line by class (`.series-annotation-detail`) so the new row labels cannot satisfy it by accident.
- **Docs gate:** the §K bullet, §M item 17 and the decision-register entry are documentation only;
  `npm run check` stays green without a count change.

## Consequences

- The time-series view can now select **any set** of the window's symbols (the empty set meaning
  "All"), the `Symbols:` legend **is** that control, and the window's own events are listed in a
  bounded, scrollable panel whose rows pin through the same pin the canvas click sets.
- **A selection hides; it never claims — structurally.** Every marker drawn, counted and listed
  comes from the one filtered list; the service is never re-invoked and every sample buffer is
  untouched (ADR-008).
- **The Phase-15 single-select is superseded.** The `<select>` is gone; its three behaviours —
  *offer the window's symbols*, *narrow what is drawn while keeping every option*, *return to the
  whole window* — are re-pointed to the toggle group with no behavioural assertion dropped. The
  single-symbol **helpers** remain as projections, so the Node cases stay green unchanged.
- **A cap is honest about itself.** The panel states `Showing first … of … in view` when it bounds
  the rows, and `visibleCount` is always the uncapped total; the cap guards DOM size, never the
  record.
- **One pin, two entry points.** The canvas click and a row click set the same `$state.raw`
  `pinnedEvent` with the record's own event identity, so the detail line, the canvas highlight and
  the `aria-current` row can never disagree.
- **Cost is O(n log n) in the window's annotations** per selection change (a sort) and O(n) per
  list build — over a handful of numbers, no new buffer, no new dependency.
- **Honest limits:** jsdom proves only the wiring; the geometry, ordering, cap and strings are the
  pure Node gates. The list's order and cap are **display** choices, never a ranking; the selection
  tolerance and the pin move-tolerance remain presentation guards, never measurement thresholds. A
  large window still lists at most `ANNOTATION_LIST_LIMIT` rows, and the caption is the only place
  the uncapped total is visible.
- **No new dependency, no tsconfig change, no science/application change**; ADR-001/008/009 and
  ADR-013/014/015/016/017 all hold unchanged.

## References

- Architecture plan §K (testing architecture — the annotation selection is displayed, never
  claimed), §M item 17 (Phase 17), decision register (ADR-018)
- [`plans/phase-17-plan.md`](../../plans/phase-17-plan.md) — approved scope and item-by-item gates
- ADR-016 (the detail line, single-symbol filter and `$state.raw` pin this generalizes; its
  single-select is superseded by the toggle legend here), ADR-013 (the display-only annotation
  overlay and legend this makes interactive), ADR-015 (the nearest-annotation resolver reused
  unchanged), ADR-008 (selection is a display concern over a full-record result), ADR-017 (the
  opt-in real-data gate policy the re-pointed real-data slice honours), ADR-001 (sample i occurs at
  i / sampleRateHz)
- Rules §26/§28/§30 (no duplicated science; the service is never re-run for a display action),
  §47/§49 (no clinical claim — an annotation is never a detection), §51 (no wall-clock/pixel
  assertions), §56 (green check gate)
