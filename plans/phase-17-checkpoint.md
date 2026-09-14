# Phase 17 Checkpoint — resumable state

Recorded 2026-09-14T09:50Z (~11:50 Europe/Madrid, `c:/APPs/ECG DWT Analyzer`). Purpose:
start the next session with zero ambiguity about the verified state, the durable artifacts,
and the first step.

## Verified state (this workspace, 2026-09-14)

- **Phase 17 is complete and fully green.** The final full gate was run at the end of
  session and passed: `npm run check` → typecheck ✓, svelte-check (**0 errors / 0
  warnings**) ✓, lint ✓, **61 test files / 750 tests** ✓, Vite build ✓ (**167 modules**).
  Completion record: [`plans/phase-17-audit.md`](phase-17-audit.md:1).
- **Phases 1–17 are all complete, audited and green.** The active increment was
  **Phase 17 = Candidate 1 — multi-symbol selection + a clickable legend + a bounded
  annotation list panel** — a **presentation-only** phase. No domain, parser, adapter,
  DSP/DWT, ML, worker or application file changed, no new prop was added and
  [`package.json`](../package.json:1) was not touched. The scientific configuration stays
  `db4 / 4 / periodic`.
- **NOT a git repository.** `git rev-parse --is-inside-work-tree` fails — there is no
  `.git` in this workspace despite the `.gitignore`. The artifacts under `plans/` are the
  durable record.
- **Machine facts:** win32 x64, Windows 11, Node **v24.18.0**, npm **11.16.0**, Vitest
  **3.2.7**, Svelte 5.57, `@sveltejs/vite-plugin-svelte` 5.1.1, `@testing-library/svelte`
  5.4.2, jsdom 30, TypeScript 5.7, Vite 6.4.3, onnxruntime-web 1.29.0.

## What Phase 17 added / changed

| Purpose | File |
|---|---|
| ADR-018: the set-filter / clickable-legend / bounded-list decision | [`plans/adr/ADR-018-annotation-set-filtering.md`](adr/ADR-018-annotation-set-filtering.md:1) |
| Phase 17 audit / completion | [`plans/phase-17-audit.md`](phase-17-audit.md:1) |

The approved plan [`plans/phase-17-plan.md`](phase-17-plan.md:1) was authored in Architect
mode as the precursor.

**No new production or test file** — the phase extends one existing pure helper
(`annotationGeometry.ts`), its Node gate and the two jsdom view slices, so the
build-module count stays **167** and the test-file count stays **61**.

**Touched:**

- [`annotationGeometry.ts`](../src/presentation/views/timeSeries/annotationGeometry.ts:1)
  — added the pure
  [`filterAnnotationsBySymbols()`](../src/presentation/views/timeSeries/annotationGeometry.ts:258)
  (set-membership subset in the list's own order; the **empty selection a
  identity/`toBe`** = "All symbols") and
  [`resolveSymbolFilters()`](../src/presentation/views/timeSeries/annotationGeometry.ts:302)
  (keeps the available members in available order, drops the unavailable, dedups); added
  the bounded-list API — [`ANNOTATION_LIST_LIMIT`](../src/presentation/views/timeSeries/annotationGeometry.ts:450),
  the [`AnnotationList`](../src/presentation/views/timeSeries/annotationGeometry.ts:459)
  type, [`annotationList()`](../src/presentation/views/timeSeries/annotationGeometry.ts:496)
  (deterministic `sampleIndex`-then-`symbol` order, identity-preserving events, explicit
  cap) and [`formatAnnotationListCaption()`](../src/presentation/views/timeSeries/annotationGeometry.ts:534);
  and re-expressed the Phase-15 single-symbol helpers as **projections** over the set
  helpers (one filter rule) —
  [`filterAnnotationsBySymbol()`](../src/presentation/views/timeSeries/annotationGeometry.ts:280)
  and [`resolveSymbolFilter()`](../src/presentation/views/timeSeries/annotationGeometry.ts:319).
  The event resolver
  [`nearestAnnotationEventAtFraction()`](../src/presentation/views/timeSeries/annotationGeometry.ts:347)
  and the formatter
  [`formatAnnotationDetail()`](../src/presentation/views/timeSeries/annotationGeometry.ts:437)
  are reused **unchanged**.
- [`annotationGeometry.test.ts`](../src/presentation/views/timeSeries/__tests__/annotationGeometry.test.ts:1)
  — **28** new Node cases (13 for the set helpers in Item 1: `filterAnnotationsBySymbols`
  +6, `resolveSymbolFilters` +7; 15 for the bounded list in Item 3: `annotationList` +12,
  `formatAnnotationListCaption` +3); the file now carries **76** tests. The single-symbol
  describes are **unchanged** and still pass (via the projections).
- [`TimeSeriesView.svelte`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:1)
  — the view-local set state
  [`symbolFilters`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:163)
  (`readonly string[]`, empty = All), the **clickable legend** (a
  [`role="group" aria-label="Symbol selection"`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:776)
  of `aria-pressed` toggle buttons whose options always come from the **unfiltered** window
  [`allSymbols`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:163)), the
  filtered derivations ([`resolvedFilters`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:258),
  [`visibleAnnotations`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:267),
  [`annotationResult`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:275),
  [`annotationSummary`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:295),
  [`annotationListResult`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:303),
  [`annotationListCaption`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:318)),
  the **bounded, scrollable list panel**
  ([`<section class="series-annotation-list" aria-label="Annotations in view">`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:793)),
  and the **one shared pin** used by both the canvas click and a row click
  ([`pinnedEvent`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:178) held with
  `$state.raw`, [`toggleSymbol`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:537),
  [`pinEvent`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:551)). The
  superseded `annotationLegendOf`/`annotationLegend` (`Symbols: …`) and the Phase-15
  `<select aria-label="Symbol filter">` were **removed**. No new prop; it still owns no
  science and calls no service.
- [`TimeSeriesView.test.ts`](../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:1)
  — **10** new jsdom cases (4 for the multi-symbol legend in Item 2; 6 for the bounded list
  panel in Item 3) over the stubbed `200×100` `getBoundingClientRect`; the file now carries
  **45** tests. The Phase-15 detail/legend cases were **re-pointed** (never dropped) from
  the `Symbols:`/`<select>` shape to the toggle legend, and the pin cases read the detail
  through a class-scoped `detailLine()` helper.
- [`realDataInteraction.integration.test.ts`](../src/presentation/views/timeSeries/__tests__/realDataInteraction.integration.test.ts:1)
  — the opt-in jsdom slice was re-pointed to the clickable legend and `detailLine()`
  (still 4 cases, still `it.skipIf`-guarded).
- [`plans/ecg-lab-architecture.md`](ecg-lab-architecture.md:306) — §K bullet
  ("**Annotation selection is displayed, never claimed**" — a **set** filter whose empty
  value is All, a clickable legend offering the **unfiltered** window, a **bounded**,
  scrollable list capped at `ANNOTATION_LIST_LIMIT` in `sampleIndex`-then-`symbol` order;
  a selection hides and a cap bounds — neither re-invokes the service, writes a sample
  buffer nor implies a detection; ADR-008/ADR-013/ADR-018, rules §47/§49), §M item 17
  (Phase 17, `Completed 2026-09-14`), and the decision-register entry (+ADR-018).

**Not touched (by design):** all of `src/domain/**`; all of `src/datasets/**`; all of
`src/dsp/**`, `src/ml/**`, `src/workers/**`, `src/bench/*`; `src/application/**`;
[`src/main.ts`](../src/main.ts:1); `src/presentation/dataset/*`,
`src/presentation/workers/*`; [`App.svelte`](../src/presentation/App.svelte:1) (it already
forwards `annotations` and the commit callback — the interaction is entirely a view
concern); [`ViewControls.svelte`](../src/presentation/views/controls/ViewControls.svelte:1)
and `presets.ts`; [`DwtCoefficientView.svelte`](../src/presentation/views/dwt/DwtCoefficientView.svelte:1)
(the selection and the list are a time-series concern only);
[`navigationGeometry.ts`](../src/presentation/views/timeSeries/navigationGeometry.ts:1) and
[`geometry.ts`](../src/presentation/views/timeSeries/geometry.ts:1) (reused unchanged). **No
new dependency**, no `package.json` / `tsconfig.json` / `vite.config.ts` change.

## Headline behaviour (what this phase exercised)

- **Multi-symbol selection, empty = All (new).** The single-symbol filter became a **set**:
  an **empty** selection draws **every** marker (identity for the filter, `null`-equivalent
  for the resolver), and any subset of the window's annotation families can be shown at
  once. The set rules are pure, Node-tested, order-preserving and never mutate the input.
- **A clickable legend (new).** The `Symbols:` legend **text** became the **control**: one
  `aria-pressed` toggle per distinct symbol of the **unfiltered** window, so a filter can
  never hide its own off-switch. Empty selection reports **no symbol as pressed**.
- **A bounded annotation list panel (new).** A capped, scrollable list of the window's own
  `symbol`/`sample`/`auxNote`, one row per in-window event, built from the **same filtered
  list the canvas draws** so the panel can never describe an undrawn marker; rows
  **click-to-pin** the same detail the canvas click pins (one `$state.raw` `pinnedEvent`
  cell, two entry points, no viewport commit). The cap is a **presentation** bound and the
  caption states the in-view total.
- **Display of a domain fact, never a detection.** Every symbol, sample and note is read
  **verbatim from `result.sourceRecord.annotations`** under the same half-open window rule
  the overlay uses; a selection **hides; it never claims**, and neither the selection nor
  the list re-invokes `service.analyze`, queries the record or writes a sample buffer
  (ADR-008, ADR-013, ADR-018; rules §26/§28/§30/§47/§49).
- **Honest notes carried into the audit.** The click-to-pin describe carries **8**
  `detailLine()` assertions where the plan anticipated 7 (reported, not reconciled away);
  and because a list row reuses the same `formatAnnotationDetail()` string as the detail
  caption, the affected `getByText("Annotation: …")` assertions were **re-pointed** (never
  dropped) to the class-scoped `detailLine()` reader on `.series-annotation-detail`.

## Gate history (Phase 17)

`0 → 61/712/167` · `1 → 61/725/167` · `2 → 61/729/167` · `3 → 61/750/167` ·
`4 → 61/750/167` · `5 → 61/750/167` (files / tests / build modules).

The **+38 tests** are Phase 17's own (Item 1 **+13 Node**; Item 2 **+4 jsdom**; Item 3
**+15 Node + 6 jsdom**). There is **no new file** and the build-module count is unchanged
(**167**) because every new export lives in a file already in the graph. Items 4 (ADR-018 +
architecture edits) and 5 (the audit) were **docs-only** and left the counts unchanged.
**No red gate occurred in this phase.**

## Re-run commands

- Full green gate: `npm run check`
- Test suite only: `npm run test`
- Phase-17 helper/string gate only: `npx vitest run annotationGeometry`
- jsdom view slice only: `npx vitest run TimeSeriesView`
- Opt-in real-data gates only (dataset present in this workspace): `npx vitest run realData`
- Dev server (the **manual** real-browser pass — the clickable legend, the multi-symbol
  selection and the bounded list; jsdom cannot draw or measure layout): `npm run dev`
- Machine snapshot: `node -v && npm -v && npx vitest --version`

## What Phase 17 proves and does not prove (honest limits)

- **Proves** — that the annotation overlay can be narrowed by a **set** of symbols with the
  **empty set equal to "All symbols"** (identity for the filter, `null`-equivalent for the
  resolver); that a **clickable legend** offers the **unfiltered** window's symbols so an
  off-switch is never hidden and an empty selection reports nothing pressed; that a
  **bounded**, deterministically ordered list is built from the **same filtered events the
  canvas draws**, names each event's own symbol/sample/note, pins a clicked row's own event
  through the **one shared** pin and commits **no** viewport; and that the whole path is
  **display-only** (no service call, no science change, no new prop, no new dependency).
- **Does not prove** — that any marker visually overlaps a row or a toggle in a real
  browser (jsdom cannot measure layout, so the DOM slices stub the `200×100` rect and prove
  the wiring only; the geometry and the strings are the pure Node gates); nor canvas
  **pixel** fidelity, layout or wall-clock timing (never the gate, rules §51). The cap is a
  **presentation** bound, never a threshold; a selection is a **display**, never a
  detection; and a **skipped** opt-in real-data gate proves nothing (on a clean clone, where
  `data/raw/mitdb` is absent, it skips).

## Where the project stands / candidates for next

No next phase is proposed or approved. Phases 1–17 are complete; ADR-010 governs
optimization (measurement-first) and its deferrals still stand. Candidate directions —
**each a candidate only; none is auto-authorized**, and per rules §50/§52 any of them must
be planned as a measured, gated, itemized increment (Architect plan → approval → Code
execution with a green gate per item):

1. **A new dataset adapter** (e.g. another ECG DB or a richer synthetic generator) — adds an
   adapter behind the canonical `SignalRecord`; DSP/UI/ML untouched (§J), same discipline as
   ADR-006/ADR-012.
2. **Real-browser re-verification of the new controls (manual).** Re-run the manual pass in
   a real browser under `npm run dev` for the clickable legend, the multi-symbol selection
   and the bounded list (the residual manual-only risks); recorded as an **observation**,
   never a gate (ADR-017).
3. **WASM DWT** — still **deferred** (ADR-010). Phase 9's numbers do not single out DWT next
   to filter/resample; a WASM path would need a parity gate first.
4. **WebGPU inference** — still **deferred** (ADR-010). No GPU path has been measured; only
   batch inference where it demonstrably wins is in scope.

## First action next session (suggested)

1. Confirm green with a single `npm run check` (expect **61 files / 750 tests**, build
   **167 modules**; svelte-check 0/0).
2. Decide with the user which candidate (if any) is next; then author + approve a next-phase
   plan in **Architect** mode, itemized with a green `npm run check` gate per item — same
   cadence as [`plans/phase-17-plan.md`](phase-17-plan.md:1).
3. Read [`plans/phase-17-audit.md`](phase-17-audit.md:1) for the exact Phase-17
   scope/evidence (including the Wave A/Wave B re-pointed Phase-15 assertions) and
   [`plans/adr/ADR-018-annotation-set-filtering.md`](adr/ADR-018-annotation-set-filtering.md:1)
   before changing or extending the selection/legend/list behaviour.

## Key references

- [`plans/phase-17-plan.md`](phase-17-plan.md:1) — the approved plan executed this session
  (status line kept as written, per repo convention; completion is in the audit).
- [`plans/phase-17-audit.md`](phase-17-audit.md:1) — item map, evidence, re-pointed
  assertions, limits.
- [`plans/adr/ADR-018-annotation-set-filtering.md`](adr/ADR-018-annotation-set-filtering.md:1)
  — the set-filter / clickable-legend / bounded-list decision.
- [`plans/ecg-lab-architecture.md`](ecg-lab-architecture.md:306) — §K / §M item 17 /
  decision register (current source of truth for scope).
- [`plans/adr/ADR-016-annotation-interaction.md`](adr/ADR-016-annotation-interaction.md:1)
  — the single-symbol filter / detail / `$state.raw` pin this phase generalizes.
- [`plans/adr/ADR-013-annotation-display.md`](adr/ADR-013-annotation-display.md:1) —
  "display, never a detection"; [`plans/adr/ADR-008-display-selection-controls.md`](adr/ADR-008-display-selection-controls.md:1)
  — "selection is a display concern; the service is never re-run".
- [`plans/phase-16-checkpoint.md`](phase-16-checkpoint.md:1) — the checkpoint template this
  record mirrors.
