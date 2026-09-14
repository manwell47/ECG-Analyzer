# Phase 17 Audit / Completion — Annotation set filtering, a clickable legend and a bounded annotation list (presentation only)

Recorded 2026-09-14 (Code-mode completion record). Verdict: **Phase 17 implemented and fully
green.** The full `npm run check` gate passed at the end of every item and again as the final
gate: typecheck ✓, svelte-check (0 errors / 0 warnings) ✓, lint ✓, **61 test files / 750 tests**
✓, Vite build ✓ (**167 modules**).

**Presentation only:** the change is confined to two presentation files
([`annotationGeometry.ts`](../src/presentation/views/timeSeries/annotationGeometry.ts:1) and
[`TimeSeriesView.svelte`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:1)) plus
their tests. No domain, DSP/DWT, ML, worker, parser, adapter, application-service,
`App.svelte`, `ViewControls` or configuration change, and **no `package.json` change**. The
scientific configuration stays `db4 / 4 / periodic`. Every annotation shown, hidden, listed,
counted or pinned is read verbatim from the record's own `AnnotationEvent`s — **never a
detection, never a clinical claim** (rules §47/§49, ADR-013); a selection **hides** markers and
the list cap **bounds** rendered rows, and neither re-invokes the service or writes a sample
buffer (ADR-008).

## Scope / approved increment

> "The whole candidate: multi-symbol selection + clickable legend + a bounded annotation list
> panel (the window's own symbol/sample/note, capped and scrollable, click-to-pin), each with
> its own Node + jsdom gate. Empty selection = All symbols."
> — user instruction (executed item by item in Code mode, per [`plans/phase-17-plan.md`](phase-17-plan.md:1))

The plan was authored in Architect mode and approved as written; the user's governing
instruction was to **execute the approved plan item by item**, confirming a green `npm run
check` between items (plan Reminder 1). That is exactly what was executed.

## Files added

| Purpose | File | Kind |
|---|---|---|
| ADR-018: set filtering, clickable legend + bounded list | [`plans/adr/ADR-018-annotation-set-filtering.md`](adr/ADR-018-annotation-set-filtering.md:1) | docs |
| Phase 17 audit (this record) | [`plans/phase-17-audit.md`](phase-17-audit.md:1) | docs |

**No production file and no new test file was added.** The Node and jsdom gates extend the two
existing presentation test files.

## Files touched

- [`src/presentation/views/timeSeries/annotationGeometry.ts`](../src/presentation/views/timeSeries/annotationGeometry.ts:1)
  — added [`filterAnnotationsBySymbols()`](../src/presentation/views/timeSeries/annotationGeometry.ts:258)
  (Item 1) and [`resolveSymbolFilters()`](../src/presentation/views/timeSeries/annotationGeometry.ts:302)
  (Item 1), re-expressed the Phase-15
  [`filterAnnotationsBySymbol()`](../src/presentation/views/timeSeries/annotationGeometry.ts:280)
  and [`resolveSymbolFilter()`](../src/presentation/views/timeSeries/annotationGeometry.ts:319) as
  **projections** over them, and added
  [`ANNOTATION_LIST_LIMIT`](../src/presentation/views/timeSeries/annotationGeometry.ts:450),
  [`AnnotationList`](../src/presentation/views/timeSeries/annotationGeometry.ts:459),
  [`annotationList()`](../src/presentation/views/timeSeries/annotationGeometry.ts:496) and
  [`formatAnnotationListCaption()`](../src/presentation/views/timeSeries/annotationGeometry.ts:534)
  (Item 3); the module header documents the empty set as "All symbols" and the cap as a display
  bound.
- [`src/presentation/views/timeSeries/TimeSeriesView.svelte`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:1)
  — replaced the Phase-15 `symbolFilter` scalar with the
  [`symbolFilters`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:163) **set** (Item 2),
  turned the inert `Symbols:` legend into the `role="group" aria-label="Symbol selection"` toggle
  group driven by [`toggleSymbol()`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:537)
  (Item 2), added the bounded `series-annotation-list` panel wired to the shared
  [`pinnedEvent`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:178) through
  [`pinEvent()`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:551) with
  `aria-current` (Item 3), and **removed** the superseded `<select>`/`annotationLegendOf()` (Item 2).
- [`src/presentation/views/timeSeries/__tests__/annotationGeometry.test.ts`](../src/presentation/views/timeSeries/__tests__/annotationGeometry.test.ts:1)
  — the two new set-helper describes (Item 1) and the list + caption describes (Item 3).
- [`src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts`](../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:1)
  — the new multi-symbol legend describe (Item 2) and the bounded-panel describe (Item 3), plus the
  re-pointed Phase-15 assertions (below).
- [`src/presentation/views/timeSeries/__tests__/realDataInteraction.integration.test.ts`](../src/presentation/views/timeSeries/__tests__/realDataInteraction.integration.test.ts:1)
  — the Phase-15 single-select case re-pointed to the toggle legend, and the detail assertion
  re-pointed to the class-scoped `detailLine()`.
- [`plans/ecg-lab-architecture.md`](ecg-lab-architecture.md:298) — a §K **Testing architecture**
  bullet (annotation selection is displayed, never claimed), a §M **item 17** (Phase 17), and the
  decision-register entry (**ADR-018**).

## Not touched (by design)

All of `src/domain/**`, `src/dsp/**`, `src/ml/**`, `src/workers/**`, `src/bench/*`,
`src/application/**`, `src/datasets/**`, `src/main.ts`, `src/presentation/App.svelte`,
`src/presentation/dataset/*`, `src/presentation/workers/*`, `src/presentation/views/controls/*`
(there is **no new prop** on `TimeSeriesView` and no `ViewControls` change), plus
[`package.json`](../package.json:1) (**no new dependency and no new script**) and
[`vite.config.ts`](../vite.config.ts) (the existing `test` block already collects `*.test.ts` and
supports per-file jsdom). The DWT/resolver/navigation helpers —
[`navigationGeometry.ts`](../src/presentation/views/timeSeries/navigationGeometry.ts:1),
[`geometry.ts`](../src/presentation/views/timeSeries/geometry.ts:1) and the resolver
[`nearestAnnotationEventAtFraction()`](../src/presentation/views/timeSeries/annotationGeometry.ts:347)
— are reused **unchanged**. `plans/phase-16-*.md` and earlier phase records are read-only history.
No new test-support module and no `tsconfig` change.

## Item-by-item mapping

0. **Pre-flight** — `npm run check` green (**61 files / 712 tests / 167 modules**); no files
   touched.
1. **Multi-symbol selection helpers (pure Node gate)** — added `filterAnnotationsBySymbols` and
   `resolveSymbolFilters`, re-expressed the single-symbol helpers as projections; the two new
   `annotationGeometry` describes add **13** Node cases. `npm run check` green (**61 files / 725
   tests / 167 modules**; +13 tests).
2. **Clickable legend + multi-symbol wiring (jsdom gate)** — `symbolFilters`, the toggle legend
   group replacing the `<select>`, the derived `resolvedFilters`/`visibleAnnotations`, and the new
   `multi-symbol legend selection` describe adding **4** jsdom cases. `npm run check` green (**61
   files / 729 tests / 167 modules**; +4 tests).
3. **Bounded annotation list (Node + jsdom gates)** — added `ANNOTATION_LIST_LIMIT`,
   `AnnotationList`, `annotationList` and `formatAnnotationListCaption` with **15** new Node cases,
   plus the panel markup/wiring and **6** new jsdom cases. `npm run check` green (**61 files / 750
   tests / 167 modules**; +15 Node, +6 jsdom).
4. **ADR-018 + architecture updates** — created the ADR and edited the architecture doc. `npm run
   check` green (**61 files / 750 tests / 167 modules** — docs-only).
5. **Audit + final gate (this record)** — final full `npm run check` green (**61 files / 750 tests
   / 167 modules**).

## Evidence (the correctness gates)

The claims are pinned at two levels — a **pure Node** gate for the numbers and strings, and a
**jsdom** gate for the wiring — never by pixels or timings (rules §51):

- **Node gate —** [`annotationGeometry.test.ts`](../src/presentation/views/timeSeries/__tests__/annotationGeometry.test.ts:1),
  **76** cases (48 → 76 across the phase). New describes:
  - [`filterAnnotationsBySymbols (multi-symbol display selection)`](../src/presentation/views/timeSeries/__tests__/annotationGeometry.test.ts:690) — **6** cases: identity (`toBe`) for the empty selection; the membership subset in input order; a single-symbol selection as the exact-match subset; the empty result for no match; agreement with the single-symbol projection; no mutation of a frozen list.
  - [`resolveSymbolFilters (stored selection -> effective selection)`](../src/presentation/views/timeSeries/__tests__/annotationGeometry.test.ts:771) — **7** cases: the empty selection falls back to "All"; members kept in **available** order; unavailable members dropped; duplicates removed; order-independent; empty when nothing is available; agreement with the single-symbol projection.
  - [`annotationList (bounded listing of the window's own events)`](../src/presentation/views/timeSeries/__tests__/annotationGeometry.test.ts:857) — **12** cases: window containment incl. the half-open end; an interior window; ascending `sampleIndex` regardless of input order; same-index tie-break by the lexicographically smaller `symbol`; the cap with the **uncapped** `visibleCount` and `truncated`; `truncated = false` when the whole window fits; the record's own objects (never copies); empty and degenerate cases; invalid-input limit; no mutation.
  - [`formatAnnotationListCaption (bound -> caption line)`](../src/presentation/views/timeSeries/__tests__/annotationGeometry.test.ts:1038) — **3** cases: the empty window; the truncated line; the untruncated in-view line.
- **jsdom gate —** [`TimeSeriesView.test.ts`](../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:1),
  **45** cases (35 → 45), over the stubbed `200x100` `getBoundingClientRect`, `getContext` stubbed
  to `null` in `beforeEach`, `cleanup()` in `afterEach`:
  - [`multi-symbol legend selection (Phase 17 item 2)`](../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:661) — **4** cases: the union of several pressed symbols in **window** order; the count of every event whose symbol is pressed; every window symbol kept on offer whichever are pressed; none pressed while the selection is empty ("All"). A module-level [`pressedSymbols()`](../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:92) reads the `aria-pressed` state back.
  - [`bounded annotation list panel (Phase 17 item 3)`](../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:743) — **6** cases: one row per in-window event naming symbol/sample/note; only the visible window's own events (half-open `viewport: {startSec: 0, durationSec: 1}`); a row click **pins that row's own event** through the shared pin (`aria-current="true"` on the clicked row, null on the other) and commits **no** viewport; the list shrinking to the legend's selection; the empty-window caption with no rows; and the cap stating `Showing first 200 of 205 in view`.
- **Opt-in real-data slice —** [`realDataInteraction.integration.test.ts`](../src/presentation/views/timeSeries/__tests__/realDataInteraction.integration.test.ts:1),
  **4** cases (unchanged in count) over a real MIT-BIH record (ADR-017): the legend offers the
  record's own distinct symbols as toggles, a real symbol click narrows the caption while keeping
  every option and reads `aria-pressed="true"`, the hover names the record's own event, and the
  idle line holds before any pointer interaction. The detail assertion now reads the caption by
  class so a panel row cannot satisfy it by accident.
- **Never asserted:** canvas pixels (jsdom has no 2d context; the draw pass runs on its guarded
  path) and no wall-clock timing.

## Re-pointed Phase-15 assertions (listed explicitly)

Per plan Design decision 6 / Reminder 7, **no behavioural assertion was deleted** — each was
re-pointed to the new control or the class-scoped read, because (a) the `Symbols:` text and the
`<select>` were replaced by the toggle legend and (b) the panel rows reuse the
`formatAnnotationDetail` string, so a bare `getByText("Annotation: …")` would match **both** the
detail caption and a row.

**Wave A — `Symbols:` text / `<select>` → the toggle legend (Item 2):**

| Phase-15 assertion | Phase-17 form | Where |
|---|---|---|
| `Symbols:` text listing the distinct symbols | `legendSymbols()` toEqual `["A","N","V"]` + `pressedSymbols()` `[]` | test *"counts the window's annotations and lists the distinct symbols"* ([L235](../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:235)) |
| `Symbols:` text under the density cap | `legendSymbols()` toEqual `["A","N","V"]` | test *"reports merged annotations…"* ([L256](../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:256)) |
| `Symbols:` text for an interior window | `legendSymbols()` toEqual `["A"]` | test *"excludes annotations outside the visible viewport…"* ([L273](../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:273)) |
| no-annotations default | `Annotations: none` **and** no `Symbol selection` group | test *"states that there are no annotations in the window by default"* ([L216](../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:216)) |
| `<select>` options = the window symbols | *"offers the window's distinct symbols as legend toggles"* via `legendSymbols()`/`pressedSymbols()` | Phase-15 describe, renamed *"annotation detail and symbol legend (Phase 15 item 3, Phase 17 item 2)"* ([L602](../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:602)) |
| `<select>` narrows the summary | *"narrows the summary to a pressed symbol, keeping every toggle"* via `fireEvent.click(legendToggle("A"))` + `pressedSymbols()` | ([L618](../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:618)) |
| `<select>` reset to All | *"returns to the whole window when the pressed symbol is toggled off"* | ([L639](../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:639)) |
| filter excludes the pinned marker (via `<select>`) | same behaviour via `fireEvent.click(legendToggle("N"))` | pin describe ([L1020](../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:1020), click at [L1038](../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:1038)) |
| real-data "symbol filter" options | *"offers the record's own distinct symbols as legend toggles"* | [realDataInteraction](../src/presentation/views/timeSeries/__tests__/realDataInteraction.integration.test.ts:270) |
| real-data `<select>` narrows the caption | *"narrows the caption to a chosen real symbol, keeping every option"* via `legendToggle(symbol)` + `aria-pressed` | [realDataInteraction](../src/presentation/views/timeSeries/__tests__/realDataInteraction.integration.test.ts:279) |

**Wave B — detail-line reads → the class-scoped `detailLine()` (Item 3):** the
`.series-annotation-detail` caption is read by class in every case whose bare text could now also
match a panel row:

- *"shows the idle annotation detail until a marker is hovered"* ([L581](../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:581));
- *"names the hovered annotation's own symbol and auxNote in the detail line"* ([L597](../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:597));
- *"pins a clicked marker's detail and commits no viewport"* ([L947](../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:947));
- *"still commits exactly one window for a drag, leaving the detail idle"* ([L976](../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:976));
- *"clears the pin when a later click lands clear of every marker"* ([L990](../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:990), [L996](../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:996));
- *"keeps the pinned detail after the pointer leaves, while the cursor goes idle"* ([L1014](../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:1014));
- *"drops a pinned detail once the symbol filter excludes its marker"* ([L1034](../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:1034), [L1042](../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:1042));
- *"keeps the pin while the pointer hovers elsewhere, and the cursor keeps tracking"* ([L1063](../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:1063));
- real-data *"names the record's own annotation a pointer rests on"* ([L266](../src/presentation/views/timeSeries/__tests__/realDataInteraction.integration.test.ts:266)).

That is **10** `detailLine()` sites in `TimeSeriesView.test.ts` (2 in the legend/detail describe +
8 in the click-to-pin describe) and **1** in the real-data slice — **11** re-pointed sites in all.
The plan's Design decision 6 anticipated "the idle + hover detail assertions and all 7 pin-describe
detail assertions"; the click-to-pin describe in fact carries **8** detail assertions, all
re-pointed (recorded here honestly, per Reminder 11). The real-data idle case keeps
`getByText(ANNOTATION_DETAIL_IDLE_LABEL)` because that idle label is unique and cannot collide.

## Decisions recorded (ADR-018)

1. **The selection is a set; the empty set is "All symbols"** — the identity for
   `filterAnnotationsBySymbols` and the `null`-equivalent for `resolveSymbolFilters`, so a
   selection a window change invalidated falls back to "All" with no effect and no manual reset.
2. **The single-symbol helpers stay projections** over the set helpers, so there is exactly one
   filter rule and the Phase-15 Node cases stay green **unchanged**.
3. **The legend *is* the control**, superseding the Phase-15 single-select `<select>`; the options
   come from the **unfiltered** window, so a pressed set can never hide its own off-switch.
4. **The list is bounded** (`ANNOTATION_LIST_LIMIT`), built from the **same filtered list the
   canvas draws**, deterministic (`sampleIndex` then `symbol`) and identity-preserving, and it
   shares the single `$state.raw` `pinnedEvent` with the canvas click — one pin, two entry points.
5. **Display only** — a selection hides markers and a cap bounds rendered rows; neither
   re-invokes the service nor writes a sample buffer (ADR-008, rules §26/§28/§30).
6. **Test split** — pure Node for numbers/strings, jsdom for wiring; canvas pixels and wall-clock
   timing are never asserted (rules §51).

## What Phase 17 proves and does not prove

**Proves** — that the annotation overlay's selection can be **any set** of the window's symbols
with the empty set meaning "All"; that the `Symbols:` legend drives that set through
`aria-pressed` toggles whose options always come from the unfiltered window; that the filter and
its resolution are pure, order-independent and agree with the single-symbol projections; that the
window's own events are listed deterministically and capped, with an honest caption and the
uncapped total reported; and that a **row click** and a **canvas click** set the same pin with the
record's own event identity, so the detail line, the canvas highlight and the `aria-current` row
cannot disagree. It also proves the wiring is **display-only** — no viewport is committed by a
toggle or a row click, and the analysis is never re-invoked.

**Does not prove** — that the pointer in a **real browser** sits on a pixel that visually overlaps
a marker (jsdom has no layout; the rect is stubbed); canvas rendering fidelity (jsdom cannot
draw); anything about real time; or that the toggle/row controls are keyboard-beautiful beyond the
native button semantics. It makes **no** clinical or detection claim anywhere (rules §47/§49): a
selection is a display, the cap is a display bound, and there is no detection.

## Residual risk

- **The cap is a display bound that a large window hits silently.** A window with more than
  `ANNOTATION_LIST_LIMIT` (200) in-window events lists only the first 200; the caption states the
  uncapped total (`Showing first 200 of N in view`), but the omitted rows are not reachable without
  narrowing the selection or the window. This is deliberate (a DOM-size guard) and is stated in
  the ADR and the plan; it is a **display** limit, never a threshold on the science.
- **jsdom cannot measure layout.** The toggle → set and row → pin paths are proved over a stubbed
  `200×100` rect; the scroll behaviour (`max-height`/`overflow-y`) is CSS and is not asserted by
  any gate. A real-browser look is the Phase-16 manual-record convention, never a gate (ADR-017).
- **The re-pointed assertions depend on the `.series-annotation-detail` class staying unique.** If
  a future change moved the detail line's class or duplicated it, `detailLine()` would either throw
  (loud) or read the wrong node; the helper throws when the selector is absent, so a rename fails
  loudly rather than silently.
- **The panel rows reuse `formatAnnotationDetail`.** This is the "one spine" choice, but it means a
  future change to that formatter changes both the caption and every row — intended, and covered
  by the Node formatter cases.
- **No new dependency, no config/`tsconfig`/`package.json` change** — so there is no dependency or
  toolchain risk introduced by this phase.

## Test counts

Final `npm run check`: **61 test files / 750 tests** (Phase-16 close: 61 / 712; **+38 tests, no
new test file, no new test-support module**). Build: **167 modules** (unchanged — the new helpers
and markup are already in the presentation graph).

| File | Tests | Level |
|---|---|---|
| [`annotationGeometry.test.ts`](../src/presentation/views/timeSeries/__tests__/annotationGeometry.test.ts:1) | 48 → **76** (+13 Item 1, +15 Item 3) | Node |
| [`TimeSeriesView.test.ts`](../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:1) | 35 → **45** (+4 Item 2, +6 Item 3) | jsdom |
| [`realDataInteraction.integration.test.ts`](../src/presentation/views/timeSeries/__tests__/realDataInteraction.integration.test.ts:1) | 4 (unchanged; 1 assertion re-pointed) | jsdom (opt-in) |

**Gate history:** 0 → 61/712/167 · 1 → 61/725/167 · 2 → 61/729/167 · 3 → 61/750/167 · 4 →
61/750/167 · 5 → 61/750/167.

## References

- [phase-17-plan.md](phase-17-plan.md:1) — the approved plan executed above.
- [ADR-018-annotation-set-filtering.md](adr/ADR-018-annotation-set-filtering.md:1) — the
  set-filter / clickable-legend / bounded-list decision this phase records.
- [ADR-016-annotation-interaction.md](adr/ADR-016-annotation-interaction.md:1) — the detail line,
  single-symbol filter and `$state.raw` pin generalized here; its single-select is superseded.
- [ADR-013-annotation-display.md](adr/ADR-013-annotation-display.md:1) — the display-only overlay
  and legend ("display of domain facts, never a detection").
- [ADR-008-display-selection-controls.md](adr/ADR-008-display-selection-controls.md:1) — selection
  is a display concern; the service is never re-run.
- [ADR-017-real-data-verification.md](adr/ADR-017-real-data-verification.md:1) — the opt-in
  real-data gate policy the re-pointed real-data slice honours.
- [ecg-lab-architecture.md](ecg-lab-architecture.md:298) — §K bullet / §M item 17 / decision
  register (+ADR-018).
- [phase-16-audit.md](phase-16-audit.md:1) and [phase-15-audit.md](phase-15-audit.md:1) — the
  audit templates this phase mirrors.
