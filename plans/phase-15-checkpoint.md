# Phase 15 Checkpoint — resumable state

Recorded 2026-09-13 ~23:51 (end of session, `c:/APPs/ECG DWT Analyzer`). Purpose:
start the next session with zero ambiguity about the verified state, the durable
artifacts, and the first step.

## Verified state (this workspace, 2026-09-13)

- **Phase 15 is complete and fully green.** The final full gate was run at the end
  of session and passed: `npm run check` → typecheck ✓, svelte-check
  (**0 errors / 0 warnings**) ✓, lint ✓, **59 test files / 693 tests** ✓, Vite
  build ✓ (**167 modules**). Completion record:
  [`plans/phase-15-audit.md`](phase-15-audit.md:1).
- **Phases 1–15 are all complete, audited and green.** The active increment was
  **Phase 15 = Candidate 1 — annotation interaction (hover detail, an optional symbol
  filter, and the approved optional click-to-pin)** — a **presentation-only** phase.
  No domain, parser, adapter, DSP/DWT, ML, worker or application file changed, and
  `App.svelte` was not touched (it already forwards
  `annotations={result.sourceRecord.annotations}` and `onViewportCommit`). The
  scientific configuration stays `db4 / 4 / periodic`.
- **NOT a git repository.** `git rev-parse --is-inside-work-tree` fails — there is
  no `.git` in this workspace despite the `.gitignore`. The artifacts under `plans/`
  are the durable record.
- **Machine facts:** win32 x64, Windows 11, Node **v24.18.0**, npm **11.16.0**,
  Vitest **3.2.7**, Svelte 5.57, `@sveltejs/vite-plugin-svelte` 5.1.1,
  `@testing-library/svelte` 5.4.2, jsdom 30, TypeScript 5.7, Vite 6.4.3,
  onnxruntime-web 1.29.0.

## What Phase 15 added / changed

| Purpose | File |
|---|---|
| ADR-016: the annotation-interaction decision | [`plans/adr/ADR-016-annotation-interaction.md`](adr/ADR-016-annotation-interaction.md:1) |
| Phase 15 audit / completion | [`plans/phase-15-audit.md`](phase-15-audit.md:1) |

The approved plan [`plans/phase-15-plan.md`](phase-15-plan.md:1) was authored in
Architect mode as the precursor.

**No new production or test file** — the phase extends one existing pure helper
(`annotationGeometry.ts`), its Node gate and the one jsdom view slice, so the
build-module count stays **167** and the test-file count stays **59**.

**Touched:**

- [`annotationGeometry.ts`](../src/presentation/views/timeSeries/annotationGeometry.ts:1)
  — added the [`AnnotationHit`](../src/presentation/views/timeSeries/annotationGeometry.ts:90)
  type and the pure
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
- [`annotationGeometry.test.ts`](../src/presentation/views/timeSeries/__tests__/annotationGeometry.test.ts:1)
  — **25** new Node cases (event resolver +11, filter +5, symbol-filter resolution +4,
  detail formatter +5); the 23 existing cases are unchanged (including all 11
  `nearestAnnotationAtFraction` cases, now the projection).
- [`TimeSeriesView.svelte`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:1)
  — the `series-annotation-detail` span
  ([`annotationDetail`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:317)),
  the view-local [`symbolFilter`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:143)
  with its keyboard-accessible `<select aria-label="Symbol filter">`, the
  `allSymbols`/`resolvedFilter` derivations and the `filterAnnotationsBySymbol`-filtered
  `annotationResult`, the
  [`detailHit`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:308) resolving
  from the **filtered** list, and the bounded click-to-pin
  ([`pinnedEvent`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:158) held
  with `$state.raw`, [`PIN_MOVE_TOLERANCE_FRACTION`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:165),
  [`pinNearestAtFraction`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:432),
  the [`handlePointerUp`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:448)
  click/drag split). No new prop; the props, the five navigation buttons, the overlay
  and the `Symbols:` legend are untouched. It still owns no science and calls no
  service.
- [`TimeSeriesView.test.ts`](../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:1)
  — **11** new jsdom cases (5 detail/filter + 6 click-to-pin) over a stubbed `200×100`
  `getBoundingClientRect`; the 24 existing cases are unchanged.
- [`plans/ecg-lab-architecture.md`](ecg-lab-architecture.md:277) — §I bullet (the
  annotation detail and an optional symbol filter are displayed; display of a domain
  fact, never a detection; a filter hides, it never claims), §M item 15 (Phase 15),
  and the decision-register entry (+ADR-016).

**Not touched (by design):** all of `src/domain/**`; all of `src/datasets/**`; all of
`src/dsp/**`, `src/ml/**`, `src/workers/**`, `src/bench/*`;
[`src/application/analysis.ts`](../src/application/analysis.ts:1) / `defaults.ts` /
`dspExecutor.ts`; [`src/main.ts`](../src/main.ts:1); `src/presentation/dataset/*`,
`src/presentation/workers/*`; [`App.svelte`](../src/presentation/App.svelte:1) (it
already forwards the annotations and the commit callback — the interaction is entirely
a view concern); [`ViewControls.svelte`](../src/presentation/views/controls/ViewControls.svelte:1)
and [`presets.ts`](../src/presentation/views/controls/presets.ts:1); and
[`DwtCoefficientView.svelte`](../src/presentation/views/dwt/DwtCoefficientView.svelte:1)
(the detail and filter are a time-series concern only). No new dependency and no
`tsconfig` / `vite.config.ts` change.

## Headline behaviour (what now visibly works)

- **Annotation detail on hover (new).** When the pointer sits within a
  **display-fraction** tolerance of an annotation already in
  `result.sourceRecord.annotations`, the caption shows
  `Annotation: {symbol} · sample {i}` and, when the event's `auxNote` is non-empty,
  ` · {auxNote}`; otherwise it shows the idle `Annotation: —`. The `code` field is
  deliberately not rendered (documented in ADR-016).
- **Optional symbol filter (new).** A view-local, keyboard-accessible
  `<select aria-label="Symbol filter">` offers `All symbols` plus the **unfiltered**
  window's distinct symbols; choosing one hides every other marker and narrows the
  summary/legend to the chosen symbol, while the options always offer the whole
  window so a reset is always possible. A filter that a window/channel change removed
  falls back to `All` through the pure `resolveSymbolFilter` with no effect and no
  manual reset.
- **Bounded click-to-pin (new; the approved optional item).** A canvas click (a
  press/release within `PIN_MOVE_TOLERANCE_FRACTION = 0.01` of the press) **pins** the
  clicked annotation's own event for the detail line and commits **no** viewport —
  replacing the Phase-13 implicit zero-width click-zoom; a drag still commits exactly
  one window unchanged. The pin survives `pointerleave`, and is dropped as soon as the
  symbol filter (or the window) no longer draws that event.
- **Display of a domain fact, never a detection.** Every displayed string is read
  verbatim from the record under the **same half-open window rule** the Phase-12
  overlay uses, so the detail, the cursor readout and the drawn overlay can never
  disagree; the synthetic boot record sets `annotations: []`, so a non-idle detail
  line is reachable only via a real/local record (ADR-013 / ADR-016; rules §47/§49).
- **Never a re-analysis, never a data access.** The helpers only read
  `sampleIndex`/`symbol`/`auxNote`; no service call, no buffer write, and the returned
  index is a readout (the ADR-014 caveat still applies to `readoutAtFraction`).
- **A Svelte 5 correctness note worth remembering:** the pin is stored with
  `$state.raw`, not `$state`. A deep reactive `$state` proxies the assigned record
  object, silently breaking the identity test (`visibleAnnotations.includes(pinned)`)
  the detail relies on. A regression test guards it.

## Gate history (Phase 15)

`0 → 59/657/167` · `1 → 59/668/167` · `2 → 59/682/167` · `3 → 59/687/167` ·
`4 → 59/693/167` · `5 → 59/693/167` · `6 → 59/693/167` (files / tests / build
modules). The **+36 tests** are Phase 15's own (25 Node + 11 jsdom); there is **no new
file** and the build module count is unchanged (the new exports live in a file already
in the graph). One transient red occurred in Item 4 — 4 of the 6 new pin tests failed
because `pinnedEvent` was a plain `$state` cell whose deep proxy broke the identity
check; fixed in the production declaration with `$state.raw` (see the audit's "Honest
notes").

## Re-run commands

- Full green gate: `npm run check`
- Test suite only: `npm run test`
- Dev server (manual canvas / pointer-drag / annotation detail / symbol filter /
  click-to-pin / ingestion check — jsdom cannot draw or measure layout): `npm run dev`
- Machine snapshot: `node -v && npm -v && npx vitest --version`

## What Phase 15 proves and does not prove (honest limits)

- **Proves** — hovering within a display tolerance of a plotted annotation shows the
  record's **own** `symbol` and `auxNote`; the choice is deterministic and
  order-independent; the filter narrows the drawn overlay **and** the summary/legend
  while always offering the whole unfiltered window, so a removed filter falls back to
  `All`; a click pins the clicked annotation's detail and commits **no** viewport while
  a drag still commits exactly one window; the pin survives `pointerleave` but drops as
  soon as the filter excludes its marker; the detail, the cursor readout and the
  overlay share one filtered list and cannot disagree; and the whole path is
  display-only (no service call, no science change, no new prop).
- **Does not prove** — that the pointer *pixel* visually overlaps a marker in a real
  browser (jsdom cannot measure layout, so the DOM slices stub the rect and prove the
  wiring only; the geometry, the filter and the strings are the pure Node gates); nor
  canvas pixel fidelity or any wall-clock timing (never the gate); nor that the
  overlay's per-pixel **density cap** agrees with the resolver (they are independent —
  the resolver may name an annotation whose column representative differs, and it
  never reports `mergedCount`); and that the pin/click tolerance is anything other than
  a **display guard** (a plot-fraction radius, never a measurement/clinical threshold).

## Where the project stands / candidates for next

No next phase is proposed or approved. Phases 1–15 are complete; ADR-010 governs
optimization (measurement-first) and its deferrals still stand. Candidate directions —
**each a candidate only; none is auto-authorized**, and per rules §50/§52 any of them
must be planned as a measured, gated, itemized increment (Architect plan → approval →
Code execution with a green gate per item):

1. **Real-browser + real-data hardening.** Manually exercise local ingestion, the
   annotation overlay, the navigation, the new annotation detail/filter **and** the
   click-to-pin under `npm run dev` in a real browser (the residual manual-only risks),
   and consider an opt-in real-data integration test alongside the existing real-data
   ingestion test.
2. **Beyond single-symbol filtering (presentation follow-on).** Multi-symbol selection,
   a clickable legend that toggles symbols, or a small annotation list — display-only,
   must not imply detection, same gates (Node for the pure selection + jsdom wiring).
3. **A new dataset adapter** (e.g. another ECG DB or a richer synthetic generator) —
   adds an adapter behind the canonical `SignalRecord`; DSP/UI/ML untouched (§J).
4. **WASM DWT** — still **deferred** (ADR-010). Phase 9's numbers do not single out
   DWT next to filter/resample; a WASM path would need a parity gate first.
5. **WebGPU inference** — still **deferred** (ADR-010). No GPU path has been measured;
   only batch inference where it demonstrably wins is in scope.

## First action next session (suggested)

1. Confirm green with a single `npm run check` (expect **59 files / 693 tests**, build
   **167 modules**; svelte-check 0/0).
2. Decide with the user which candidate (if any) is next; then author + approve a
   next-phase plan in **Architect** mode, itemized with a green `npm run check` gate
   per item — same cadence as [`plans/phase-15-plan.md`](phase-15-plan.md:1).
3. Read [`plans/phase-15-audit.md`](phase-15-audit.md:1) for the exact Phase-15
   scope/evidence and
   [`plans/adr/ADR-016-annotation-interaction.md`](adr/ADR-016-annotation-interaction.md:1)
   for the interaction decision (including the `$state.raw` pin hazard) before changing
   any view code.

## Key references

- [`plans/phase-15-plan.md`](phase-15-plan.md:1) — the approved plan executed this
  session (status line kept as written, per repo convention; completion is in the
  audit).
- [`plans/phase-15-audit.md`](phase-15-audit.md:1) — item map, evidence, limits.
- [`plans/adr/ADR-016-annotation-interaction.md`](adr/ADR-016-annotation-interaction.md:1)
  — the annotation-interaction decision.
- [`plans/ecg-lab-architecture.md`](ecg-lab-architecture.md:277) — §I / §M /
  decision register (current source of truth for scope).
- [`plans/adr/ADR-013-annotation-display.md`](adr/ADR-013-annotation-display.md:1)
  — "display of domain facts, never science; never a detection".
- [`plans/adr/ADR-014-signal-navigation.md`](adr/ADR-014-signal-navigation.md:1)
  and [`plans/adr/ADR-015-cursor-annotation-readout.md`](adr/ADR-015-cursor-annotation-readout.md:1)
  — the navigation/readout decisions this extends.
- [`plans/phase-14-checkpoint.md`](phase-14-checkpoint.md:1) — the checkpoint
  template this record mirrors.
