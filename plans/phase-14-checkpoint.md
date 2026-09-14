# Phase 14 Checkpoint — resumable state

Recorded 2026-09-13 ~23:28 (end of session, `c:/APPs/ECG DWT Analyzer`). Purpose:
start the next session with zero ambiguity about the verified state, the durable
artifacts, and the first step.

## Verified state (this workspace, 2026-09-13)

- **Phase 14 is complete and fully green.** The final full gate was run at the end
  of session and passed: `npm run check` → typecheck ✓, svelte-check
  (**0 errors / 0 warnings**) ✓, lint ✓, **59 test files / 657 tests** ✓, Vite
  build ✓ (**167 modules**). Completion record:
  [`plans/phase-14-audit.md`](phase-14-audit.md:1).
- **Phases 1–14 are all complete, audited and green.** The active increment was
  **Phase 14 = Candidate 3 — the nearest-annotation symbol in the cursor readout**
  — a **presentation-only** phase. No domain, parser, adapter, DSP/DWT, ML, worker
  or application file changed, and `App.svelte` was not touched (it already
  forwards `result.sourceRecord.annotations`). The scientific configuration stays
  `db4 / 4 / periodic`.
- **NOT a git repository.** `git rev-parse --is-inside-work-tree` fails — there is
  no `.git` in this workspace despite the `.gitignore`. The committed artifacts
  under `plans/` are the durable record.
- **Machine facts:** win32 x64, Windows 11, Node **v24.18.0**, npm **11.16.0**,
  Vitest **3.2.7**, Svelte 5.57, `@sveltejs/vite-plugin-svelte` 5.1.1,
  `@testing-library/svelte` 5.4.2, jsdom 30, TypeScript 5.7, Vite 6.4.3,
  onnxruntime-web 1.29.0.

## What Phase 14 added / changed

| Purpose | File |
|---|---|
| ADR-015: the cursor-annotation-readout decision | [`plans/adr/ADR-015-cursor-annotation-readout.md`](adr/ADR-015-cursor-annotation-readout.md:1) |
| Phase 14 audit / completion | [`plans/phase-14-audit.md`](phase-14-audit.md:1) |

**No new production or test file** — the phase extends two existing pure helpers,
their two Node gates and the one jsdom view slice, so the build-module count stays
**167**.

**Touched:**

- [`annotationGeometry.ts`](../src/presentation/views/timeSeries/annotationGeometry.ts:1)
  — added [`CURSOR_ANNOTATION_TOLERANCE_FRACTION`](../src/presentation/views/timeSeries/annotationGeometry.ts:71)
  (`0.02`), the [`NearestAnnotation`](../src/presentation/views/timeSeries/annotationGeometry.ts:74)
  type, the private `requireToleranceFraction` / `isNearer` helpers, and the pure
  [`nearestAnnotationAtFraction()`](../src/presentation/views/timeSeries/annotationGeometry.ts:244)
  resolver (same half-open window rule as `annotationMarkers`, clamped cursor,
  deterministic nearest, `null` first-class, `invalid-input` tolerance,
  read-only / no mutation).
- [`navigationGeometry.ts`](../src/presentation/views/timeSeries/navigationGeometry.ts:1)
  — added [`CURSOR_IDLE_LABEL`](../src/presentation/views/timeSeries/navigationGeometry.ts:291)
  (`Cursor: —`, byte-identical to the Phase-13 idle string) and the pure
  [`formatCursorReadout()`](../src/presentation/views/timeSeries/navigationGeometry.ts:302)
  (idle / hover / hover-with-symbol / empty-symbol).
- [`annotationGeometry.test.ts`](../src/presentation/views/timeSeries/__tests__/annotationGeometry.test.ts:252)
  — **11** new Node cases; the twelve existing marker cases are unchanged.
- [`navigationGeometry.test.ts`](../src/presentation/views/timeSeries/__tests__/navigationGeometry.test.ts:509)
  — **6** new Node cases; the 46 existing cases are unchanged.
- [`TimeSeriesView.svelte`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:206)
  — the [`nearestAnnotation`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:206)
  derived and the [`cursorLabel`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:220)
  re-route through `formatCursorReadout(...)`. No new prop; the props, the five
  navigation buttons, the guarded pointer handlers, the overlay and the
  summary/legend are untouched. It still owns no science and calls no service.
- [`TimeSeriesView.test.ts`](../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:362)
  — **4** new jsdom cases over a stubbed `200×100` `getBoundingClientRect`; the
  twenty existing cases are unchanged.
- [`plans/ecg-lab-architecture.md`](ecg-lab-architecture.md:276) — §I bullet (the
  cursor may name the record's own nearest annotation; display of a domain fact,
  never a detection), §M item 14 (Phase 14), and the decision-register entry
  (+ADR-015).

**Not touched (by design):** all of `src/domain/**`; all of `src/datasets/**`; all
of `src/dsp/**`, `src/ml/**`, `src/workers/**`, `src/bench/*`;
[`src/application/analysis.ts`](../src/application/analysis.ts:1) / `defaults.ts` /
`dspExecutor.ts`; [`src/main.ts`](../src/main.ts:1);
`src/presentation/dataset/*`, `src/presentation/workers/*`;
[`App.svelte`](../src/presentation/App.svelte:1) (it already forwards the
annotations — the readout is entirely a view concern);
[`ViewControls.svelte`](../src/presentation/views/controls/ViewControls.svelte:1)
and [`presets.ts`](../src/presentation/views/controls/presets.ts:1); and
[`DwtCoefficientView.svelte`](../src/presentation/views/dwt/DwtCoefficientView.svelte:1)
(the readout is a time-series concern only). No new dependency and no `tsconfig` /
`vite.config.ts` change.

## Headline behaviour (what now visibly works)

- **Cursor readout names the record's own annotation (new).** When the pointer sits
  within a **display-fraction** tolerance (`CURSOR_ANNOTATION_TOLERANCE_FRACTION =
  0.02`) of an annotation already in `result.sourceRecord.annotations`, the caption
  reads `Cursor: {t} s · sample {i} · nearest {symbol}`; otherwise it stays
  `Cursor: {t} s · sample {i}` (and `Cursor: —` while idle). This completes the
  approved Phase-13 "A" wording.
- **Display of a domain fact, never a detection.** The symbol is read verbatim from
  the record under the **same half-open window rule** the Phase-12 overlay uses, so
  the readout can never name a symbol the drawn overlay hides; the synthetic boot
  record sets `annotations: []`, so a non-empty suffix is reachable only via a
  real/local record (ADR-013 / ADR-015; rules §47/§49).
- **Deterministic and boundary-safe.** The nearest is chosen by smallest distance,
  ties to the lower `sampleIndex`, then to the lexicographically smaller `symbol`;
  `null` (no annotations / beyond tolerance / degenerate viewport) is first-class.
- **Never a re-analysis, never a data access.** The resolver only reads
  `sampleIndex`/`symbol`; no service call, no buffer write, and the returned index
  is a readout (the ADR-014 caveat still applies to `readoutAtFraction`).

## Gate history (Phase 14)

`0 → 59/636/167` · `1 → 59/653/167` · `2 → 59/657/167` · `3 → 59/657/167` ·
`4 → 59/657/167` (files / tests / build modules). The **+21 tests** are Phase 14's
own (11 Node resolver + 6 Node formatter + 4 jsdom wiring); there is **no new
file** and the build module count is unchanged (the new exports live in files
already in the graph). One transient red occurred in Item 1 — a test-authoring
error (cursor fractions outside the 2% default tolerance), fixed in the test; see
the audit's "Honest notes".

## Re-run commands

- Full green gate: `npm run check`
- Test suite only: `npm run test`
- Dev server (manual canvas / pointer-drag / annotation-readout / ingestion check —
  jsdom cannot draw or measure layout): `npm run dev`
- Machine snapshot: `node -v && npm -v && npx vitest --version`

## What Phase 14 proves and does not prove (honest limits)

- **Proves** — pointing within a display tolerance of a plotted annotation names
  the record's **own** symbol (` · nearest {symbol}`); the choice is deterministic
  and order-independent; the resolver considers exactly the annotations the overlay
  draws (half-open window) and falls back cleanly to time + sample when nothing is
  close by; the idle and hover label forms are byte-identical to Phase 13 (the two
  `t = … s → … s` captions and the Phase-12 regressions stay green); and the whole
  path is display-only (no service call, no science change, no new prop).
- **Does not prove** — that the pointer *pixel* visually overlaps a marker in a
  real browser (jsdom cannot measure layout, so the DOM slice stubs the rect and
  proves the wiring only; the geometry and the string are the pure Node gates); nor
  canvas pixel fidelity or any wall-clock timing (never the gate); nor that the
  overlay's per-pixel **density cap** agrees with the resolver (they are
  independent — the resolver may name an annotation whose column representative
  differs, and it never reports `mergedCount`); and that the tolerance is anything
  other than a **display guard** (a plot-fraction radius, never a
  measurement/clinical threshold).

## Where the project stands / candidates for next

No next phase is proposed or approved. Phases 1–14 are complete; ADR-010 governs
optimization (measurement-first) and its deferrals still stand. Candidate
directions — **each a candidate only; none is auto-authorized**, and per rules
§50/§52 any of them must be planned as a measured, gated, itemized increment
(Architect plan → approval → Code execution with a green gate per item):

1. **Annotation interaction (presentation follow-on).** Hover/click a marker to
   show its `symbol` / `auxNote`, or a symbol filter — display-only, must not imply
   detection, and would extend `annotationGeometry` + `TimeSeriesView` with jsdom
   tests (same gates as Phase 12/13/14). The natural next presentation step now that
   the cursor can name a marker.
2. **Real-browser + real-data hardening.** Manually exercise local ingestion, the
   annotation overlay, the navigation **and** the new nearest-annotation readout
   under `npm run dev` in a real browser (the residual manual-only risks), and
   consider an opt-in real-data integration test alongside the existing real-data
   ingestion test.
3. **A new dataset adapter** (e.g. another ECG DB or a richer synthetic generator)
   — adds an adapter behind the canonical `SignalRecord`; DSP/UI/ML untouched (§J).
4. **WASM DWT** — still **deferred** (ADR-010). Phase 9's numbers do not single out
   DWT next to filter/resample; a WASM path would need a parity gate first.
5. **WebGPU inference** — still **deferred** (ADR-010). No GPU path has been
   measured; only batch inference where it demonstrably wins is in scope.

## First action next session (suggested)

1. Confirm green with a single `npm run check` (expect **59 files / 657 tests**,
   build **167 modules**; svelte-check 0/0).
2. Decide with the user which candidate (if any) is next; then author + approve a
   next-phase plan in **Architect** mode, itemized with a green `npm run check` gate
   per item — same cadence as [`plans/phase-14-plan.md`](phase-14-plan.md:1) and
   [`plans/phase-13-plan.md`](phase-13-plan.md:1).
3. Read [`plans/phase-14-audit.md`](phase-14-audit.md:1) for the exact Phase-14
   scope/evidence and
   [`plans/adr/ADR-015-cursor-annotation-readout.md`](adr/ADR-015-cursor-annotation-readout.md:1)
   for the readout decision before changing any view code.

## Key references

- [`plans/phase-14-plan.md`](phase-14-plan.md:1) — the approved plan executed this
  session (status line kept as written, per repo convention; completion is in the
  audit).
- [`plans/phase-14-audit.md`](phase-14-audit.md:1) — item map, evidence, limits.
- [`plans/adr/ADR-015-cursor-annotation-readout.md`](adr/ADR-015-cursor-annotation-readout.md:1)
  — the cursor-annotation-readout decision.
- [`plans/ecg-lab-architecture.md`](ecg-lab-architecture.md:276) — §I / §M /
  decision register (current source of truth for scope).
- [`plans/adr/ADR-013-annotation-display.md`](adr/ADR-013-annotation-display.md:1)
  — "display of domain facts, never science; never a detection".
- [`plans/adr/ADR-014-signal-navigation.md`](adr/ADR-014-signal-navigation.md:1)
  — the navigation decision and the cursor readout this extends.
- [`plans/phase-13-checkpoint.md`](phase-13-checkpoint.md:1) — the checkpoint
  template this record mirrors.
