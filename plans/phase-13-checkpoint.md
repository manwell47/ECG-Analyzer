# Phase 13 Checkpoint — resumable state

Recorded 2026-09-13 ~23:13 (end of session, `c:/APPs/ECG DWT Analyzer`). Purpose:
start the next session with zero ambiguity about the verified state, the durable
artifacts, and the first step.

## Verified state (this workspace, 2026-09-13)

- **Phase 13 is complete and fully green.** The final full gate was run at the end
  of session and passed: `npm run check` → typecheck ✓, svelte-check
  (**0 errors / 0 warnings**) ✓, lint ✓, **59 test files / 636 tests** ✓, Vite
  build ✓ (**167 modules**). Completion record:
  [`plans/phase-13-audit.md`](phase-13-audit.md:1).
- **Phases 1–13 are all complete, audited and green.** The active increment was
  **Phase 13 = A (cursor readout) + B (zoom and pan)** — a **presentation-only**
  phase. No domain, parser, adapter, DSP/DWT, ML, worker or application file
  changed. The scientific configuration stays `db4 / 4 / periodic`.
- **NOT a git repository.** `git rev-parse --is-inside-work-tree` fails — there is
  no `.git` in this workspace despite the `.gitignore`. The committed artifacts
  under `plans/` are the durable record.
- **Machine facts:** win32 x64, Windows 11, Node **v24.18.0**, npm **11.16.0**,
  Vitest **3.2.7**, Svelte 5.57, `@sveltejs/vite-plugin-svelte` 5.1.1,
  `@testing-library/svelte` 5.4.2, jsdom 30, TypeScript 5.7, Vite 6.4.3,
  onnxruntime-web 1.29.0.

## What Phase 13 added / changed

| Purpose | File |
|---|---|
| Pure, DOM-free navigation arithmetic (`ViewportBounds`, `CursorReadout`, `ZOOM_STEP_FACTOR`, `PAN_STEP_FRACTION`, `MIN_VIEWPORT_SAMPLES`, `clampFraction`, `viewportBoundsOf`, `minViewportDurationSec`, `clampViewport`, `zoomViewport`, `panViewport`, `viewportFromFractions`, `readoutAtFraction`) | [`src/presentation/views/timeSeries/navigationGeometry.ts`](../src/presentation/views/timeSeries/navigationGeometry.ts:1) |
| Node numerical gate for the helper (46 tests) | [`src/presentation/views/timeSeries/__tests__/navigationGeometry.test.ts`](../src/presentation/views/timeSeries/__tests__/navigationGeometry.test.ts:1) |
| ADR-014: signal-navigation decision | [`plans/adr/ADR-014-signal-navigation.md`](adr/ADR-014-signal-navigation.md:1) |
| Phase 13 audit / completion | [`plans/phase-13-audit.md`](phase-13-audit.md:1) |

**Touched:**

- [`TimeSeriesView.svelte`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:61)
  — optional [`onViewportCommit`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:78)
  prop; transient `cursorFraction` / `dragStartFraction` / `dragEndFraction`
  `$state`; the [`cursorReadout`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:186)
  derived from `readoutAtFraction` and its distinct
  `Cursor: —` / `Cursor: {t} s · sample {i}` span
  ([line 563](../src/presentation/views/timeSeries/TimeSeriesView.svelte:563));
  the five-button `role="group"` navigation row
  ([line 536](../src/presentation/views/timeSeries/TimeSeriesView.svelte:536));
  the single commit path [`emitViewport()`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:204);
  guarded pointer handlers via
  [`fractionFromPointer()`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:266)
  (`rect.width > 0` early-return) and the decorative
  [`drawDragBand()`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:458).
  It owns no science and calls no service.
- [`TimeSeriesView.test.ts`](../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:185)
  — **11** new jsdom cases (controls/readout + pointer inertness); the nine
  existing caption/channel/annotation cases are unchanged.
- [`App.svelte`](../src/presentation/App.svelte:126) — `customViewport` state; the
  `customViewportOption` / [`displayedViewportOptions`](../src/presentation/App.svelte:302)
  / `effectiveViewportIndex` / [`activeViewport`](../src/presentation/App.svelte:319)
  derivations; [`isFullViewport()`](../src/presentation/App.svelte:337),
  [`handleViewportCommit()`](../src/presentation/App.svelte:353), the rewritten
  `handleViewportChange()` ([line 367](../src/presentation/App.svelte:367)), the
  clear-on-`analyzeRecordById()` ([line 152](../src/presentation/App.svelte:152)),
  and passing `onViewportCommit` to `TimeSeriesView`
  ([line 488](../src/presentation/App.svelte:488)). No service call, option or
  science configuration added; `App` never imports the navigation helper (no
  duplicated clamping).
- [`App.test.ts`](../src/presentation/__tests__/App.test.ts:490) — **5** new jsdom
  end-to-end cases (custom option, reset, record switch, no-re-analysis spy); the
  eight existing cases are unchanged.
- [`plans/ecg-lab-architecture.md`](ecg-lab-architecture.md:255) — §I bullet
  ("Display navigation is main-thread and display-only — implemented"), §M item 13
  (Phase 13), and the decision-register entry (+ADR-014).

**Not touched (by design):** all of `src/domain/**`; all of `src/datasets/**`; all
of `src/dsp/**`, `src/ml/**`, `src/workers/**`, `src/bench/*`;
[`src/application/analysis.ts`](../src/application/analysis.ts:1) / `defaults.ts` /
`dspExecutor.ts`; [`src/main.ts`](../src/main.ts:1); `src/presentation/dataset/*`,
`src/presentation/workers/*`;
[`ViewControls.svelte`](../src/presentation/views/controls/ViewControls.svelte:1)
and [`presets.ts`](../src/presentation/views/controls/presets.ts:1) (the toolbar
stays thin — `App` composes the "Custom (zoomed)" option itself); and
[`DwtCoefficientView.svelte`](../src/presentation/views/dwt/DwtCoefficientView.svelte:1)
(it already accepted a `viewport` prop, so it only ever *reads* the new window). No
new dependency and no `tsconfig` / `vite.config.ts` change.

## Headline behaviour (what now visibly works)

- **Cursor readout (A, new).** Pointing at the trace reports `Cursor: {t} s ·
  sample {i}`, derived by the pure `readoutAtFraction` (which delegates every
  time↔sample conversion to [`src/domain/sampling.ts`](../src/domain/sampling.ts:1));
  idle shows `Cursor: —`. The readout uses a **distinct** format from the two
  `t = … s → … s` view captions (which the existing regression still pins at
  exactly two).
- **Zoom / pan / reset (B, new).** Five keyboard-accessible buttons (zoom in, zoom
  out, pan left, pan right, reset) plus guarded pointer drags commit a single
  display-only window through one `emitViewport()` path. `App` appends a
  **"Custom (zoomed)"** viewport option after the presets and draws that one window
  in **both** canvas views; a commit landing exactly on the full record clears it,
  as do a preset pick / re-analysis / record switch.
- **Zoom is never a re-analysis.** Navigation never calls `service.analyze`, never
  re-runs the DWT and never writes a sample buffer — it only changes which window of
  the one full-record `AnalysisResult` is read (ADR-008 / ADR-014). Pinned by an
  `analyzeSpy`-count test.

## Gate history (Phase 13)

`0 → 58/574/166` · `1 → 59/620/166` · `2 → 59/628/167` · `3 → 59/631/167` ·
`4 → 59/636/167` · `5 → 59/636/167` · `6 → 59/636/167`
(files / tests / build modules). The +1 test file and +62 tests (46 Node + 11
TimeSeriesView jsdom + 5 App jsdom) are Phase 13's own; the +1 build module is the
new navigation helper imported by the view.

## Re-run commands

- Full green gate: `npm run check`
- Test suite only: `npm run test`
- Dev server (manual canvas / pointer-drag / ingestion check — jsdom cannot draw or
  measure layout): `npm run dev`
- Machine snapshot: `node -v && npm -v && npx vitest --version`

## What Phase 13 proves and does not prove (honest limits)

- **Proves** — the navigation arithmetic is correct and boundary-safe under the
  pure Node gate (clamp / bounds / display floor / zoom / pan / drag-to-window /
  cursor readout / invariants / `invalid-input`, 46 tests); the DOM controls, the
  `Cursor:` readout markup and the **inert** pointer path are asserted in jsdom
  (11 tests); and end-to-end that a zoom appends + selects the "Custom (zoomed)"
  option and re-windows both canvas views **without** re-invoking the analysis
  service (5 App tests + the spy-count case).
- **Does not prove** — canvas pixel fidelity or any wall-clock timing (jsdom has no
  2d context, and timings are never the gate); **real-browser pointer-drag
  geometry** (jsdom cannot measure layout, so the DOM only proves the handlers are
  *inert* — the drag geometry itself is the pure Node gate); that the cursor
  readout names a **nearest annotation symbol** (the executable Item-2 spec defines
  it as time + sample only, so that part of the approved A wording is **not
  implemented** — see candidates below); and that the minimum window is anything
  other than a **two-sample display floor** (a presentation guard, never a
  measurement/clinical threshold).

## Where the project stands / candidates for next

No next phase is proposed or approved. Phases 1–13 are complete; ADR-010 governs
optimization (measurement-first) and its deferrals still stand. Candidate
directions — **each a candidate only; none is auto-authorized**, and per rules
§50/§52 any of them must be planned as a measured, gated, itemized increment
(Architect plan → approval → Code execution with a green gate per item):

1. **WASM DWT** — still **deferred** (ADR-010). Phase 9's numbers do not single out
   DWT next to filter/resample; a WASM path would need a parity gate first.
2. **WebGPU inference** — still **deferred** (ADR-010). No GPU path has been
   measured; only batch inference where it demonstrably wins is in scope.
3. **Nearest-annotation symbol in the cursor readout (small presentation
   follow-on).** The approved A wording mentioned "the nearest annotation symbol
   when one is close by"; the executed Item-2 spec narrowed the readout to time +
   sample. Adding the symbol would extend the pure helper + `TimeSeriesView` with
   jsdom tests (same gates as Phase 13), display-only, never implying detection.
4. **Annotation interaction (presentation follow-on).** e.g. hover/click a marker to
   show its `symbol` / `auxNote`, or a symbol filter — display-only, must not imply
   detection, and would extend `annotationGeometry` + `TimeSeriesView` with jsdom
   tests (same gates as Phase 12/13).
5. **Real-browser + real-data hardening.** Manually exercise local ingestion, the
   annotation overlay **and** the new navigation under `npm run dev` in a real
   browser (the residual manual-only risks), and consider an opt-in real-data
   integration test alongside the existing real-data ingestion test.
6. **A new dataset adapter** (e.g. another ECG DB or a richer synthetic generator)
   — adds an adapter behind the canonical `SignalRecord`; DSP/UI/ML untouched (§J).

## First action next session (suggested)

1. Confirm green with a single `npm run check` (expect **59 files / 636 tests**,
   build **167 modules**; svelte-check 0/0).
2. Decide with the user which candidate (if any) is next; then author + approve a
   next-phase plan in **Architect** mode, itemized with a green `npm run check` gate
   per item — same cadence as [`plans/phase-13-plan.md`](phase-13-plan.md:1) and
   [`plans/phase-10-plan.md`](phase-10-plan.md:1).
3. Read [`plans/phase-13-audit.md`](phase-13-audit.md:1) for the exact Phase-13
   scope/evidence and
   [`plans/adr/ADR-014-signal-navigation.md`](adr/ADR-014-signal-navigation.md:1)
   for the navigation decision before changing any view code.

## Key references

- [`plans/phase-13-plan.md`](phase-13-plan.md:1) — the approved plan executed this
  session (status line kept as written, per repo convention; completion is in the
  audit).
- [`plans/phase-13-audit.md`](phase-13-audit.md:1) — item map, evidence, limits.
- [`plans/adr/ADR-014-signal-navigation.md`](adr/ADR-014-signal-navigation.md:1) —
  the signal-navigation decision.
- [`plans/ecg-lab-architecture.md`](ecg-lab-architecture.md:255) — §I / §M /
  decision register (current source of truth for scope).
- [`plans/phase-12-audit.md`](phase-12-audit.md:1) — the display increment this
  phase built on.
- [`plans/adr/ADR-008-display-selection-controls.md`](adr/ADR-008-display-selection-controls.md:1)
  — "selection is a display concern over a full-record result".
- [`plans/phase-12-checkpoint.md`](phase-12-checkpoint.md:1) — the checkpoint
  template this record mirrors.
