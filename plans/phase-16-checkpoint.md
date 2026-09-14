# Phase 16 Checkpoint — resumable state

Recorded 2026-09-13T22:48Z (~00:48 Europe/Madrid, end of session,
`c:/APPs/ECG DWT Analyzer`). Purpose: start the next session with zero ambiguity
about the verified state, the durable artifacts, and the first step.

## Verified state (this workspace, 2026-09-13)

- **Phase 16 is complete and fully green.** The final full gate was run at the end of
  session and passed: `npm run check` → typecheck ✓, svelte-check (**0 errors / 0
  warnings**) ✓, lint ✓, **61 test files / 712 tests** ✓, Vite build ✓ (**167
  modules**). Completion record: [`plans/phase-16-audit.md`](phase-16-audit.md:1).
- **Phases 1–16 are all complete, audited and green.** The active increment was
  **Phase 16 = Candidate 1 — real-browser + real-data hardening** — a **tests-and-docs-
  only** phase. No production, helper, config or `package.json` file changed. The
  scientific configuration stays `db4 / 4 / periodic`.
- **NOT a git repository.** `git rev-parse --is-inside-work-tree` fails — there is no
  `.git` in this workspace despite the `.gitignore`. The artifacts under `plans/` are
  the durable record.
- **Machine facts:** win32 x64, Windows 11, Node **v24.18.0**, npm **11.16.0**, Vitest
  **3.2.7**, Svelte 5.57, `@sveltejs/vite-plugin-svelte` 5.1.1, `@testing-library/svelte`
  5.4.2, jsdom 30, TypeScript 5.7, Vite 6.4.3, onnxruntime-web 1.29.0.

## What Phase 16 added / changed

| Purpose | File |
|---|---|
| Shared test-only probe + loader (one definition of "which real record") | [`src/datasets/__tests__/realRecordSupport.ts`](../src/datasets/__tests__/realRecordSupport.ts:1) |
| Opt-in Node display-invariant gate over the record's own annotations (no DWT) | [`src/presentation/views/timeSeries/__tests__/realDataDisplay.integration.test.ts`](../src/presentation/views/timeSeries/__tests__/realDataDisplay.integration.test.ts:1) |
| Opt-in jsdom `TimeSeriesView` wiring slice over the stubbed rect | [`src/presentation/views/timeSeries/__tests__/realDataInteraction.integration.test.ts`](../src/presentation/views/timeSeries/__tests__/realDataInteraction.integration.test.ts:1) |
| Manual real-browser verification record (an observation, never a gate) | [`plans/phase-16-manual-verification.md`](phase-16-manual-verification.md:1) |
| ADR-017: the real-data verification + opt-in gate policy | [`plans/adr/ADR-017-real-data-verification.md`](adr/ADR-017-real-data-verification.md:1) |
| Phase 16 audit / completion | [`plans/phase-16-audit.md`](phase-16-audit.md:1) |

The approved plan [`plans/phase-16-plan.md`](phase-16-plan.md:1) was authored in
Architect mode as the precursor.

**Touched:**

- [`src/datasets/__tests__/realData.integration.test.ts`](../src/datasets/__tests__/realData.integration.test.ts:1)
  — refactored to import `MITDB_DIR` / `firstCompleteRecordId` from the new shared
  support module instead of defining them locally; its single
  `it.skipIf(recordId === undefined)` case is **behaviourally unchanged** and still
  runs.
- [`plans/ecg-lab-architecture.md`](ecg-lab-architecture.md:306) — §K bullet
  ("**Opt-in real-data verification**" — the display-only stack re-measured against a
  real record's own annotations/mV in opt-in gates that **skip** when `data/raw/mitdb`
  is absent; a Node invariant gate + a jsdom wiring slice sharing one test-only
  probe/loader; the default suite never depends on the dataset and a skipped gate
  proves nothing; the real-browser pass is a **manual** observation, never a gate and
  never a wall-clock/pixel assertion; ADR-017, rules §51), §M item 16 (Phase 16,
  `Completed 2026-09-13`), and the decision-register entry (+ADR-017).

**Not touched (by design):** all of `src/domain/**`; all non-test production files in
`src/datasets/**`; all of `src/dsp/**`, `src/ml/**`, `src/workers/**`, `src/bench/*`;
`src/application/**`; [`src/main.ts`](../src/main.ts:1); all of
`src/presentation/views/**` and `src/presentation/dataset/**`; [`App.svelte`](../src/presentation/App.svelte:1);
`vite.config.ts` (the sole Vitest config) and `tsconfig.json`. **No new dependency**, no
`package.json` change, and no browser-automation dependency. The gitignored dataset is
never a dependency of the default suite.

## Headline behaviour (what this phase exercised)

- **One definition of the real record.** The shared test-only
  [`firstCompleteRecordId()`](../src/datasets/__tests__/realRecordSupport.ts:37) probes
  `data/raw/mitdb` with a synchronous `existsSync` + `readdirSync` and returns the first
  record with a complete `.hea`+`.dat`(+`.atr`) triple (today `101`), and
  [`loadRealRecord()`](../src/datasets/__tests__/realRecordSupport.ts:64) reads it
  through `NodeFileSource` → `MitBihDatasetAdapter.readRecord` →
  `recordToMillivoltSignal`. Both gates and the refactored ingestion test import this
  one module, so "which record" has exactly one definition.
- **Opt-in, and honest about it.** Every new case is guarded by `it.skipIf(...)`; on a
  clean clone (the dataset is gitignored and absent) the gates **skip**. A skipped gate
  proves nothing — this is stated in the ADR and the audit, not hidden. In this
  workspace the dataset is present, so both gates **ran** (15 Node cases + 4 jsdom
  cases, none skipped).
- **Node gate — the display invariants over the record's own facts, no DWT.** 15 cases
  (in five `describe`s) re-measure the pure display helpers against the real record's
  own annotations: the overlay/density cap emits one marker per populated pixel column,
  ordered left-to-right, keeping the lowest sample index per column and never mutating
  the input; the symbol filter is identity for `null`/`""`, an exact-match subset
  otherwise, and resolution maps a legend symbol to itself (an unknown to `null`);
  `nearestAnnotationEventAtFraction` returns the record's own event at its own x
  fraction with the documented tie-break and formats the detail line from the record's
  own symbol+sample; the navigation bounds span the acquisition window with derived
  windows contained, pan preserving duration, and an interior readout inside the drawn
  window; the envelope emits one column per pixel column with ordered finite ranges and
  amplitude bounds equal a recomputed min/max.
- **jsdom slice — wiring only, over the stubbed `200×100` rect.** 4 cases render
  `TimeSeriesView` over the real record: the idle detail line; the record's own
  annotation named when the pointer rests on it (asserting the exact
  `formatAnnotationDetail` string); the record's own distinct symbols offered in the
  `<select aria-label="Symbol filter">` (`["All symbols", ...distinctSymbols()]`); and
  the caption narrowed to a chosen real symbol while every option is kept. `cleanup()`
  runs in `afterEach`; `HTMLCanvasElement.prototype.getContext` is stubbed to `null`.
- **One documented implementation deviation.** The plan's Design decision 2 / Reminder 3
  said the record would be read inside a guarded `beforeAll`; both gates instead read it
  once at **module scope** via top-level `await`, because the annotation-count
  `it.skipIf(...)` must be a declaration-time condition (only known after the read). It
  is behaviour-preserving and recorded in the audit. Top-level `await` in a test file is
  allowed by `tsconfig.json` (`module: ESNext`, `target: ES2022`).
- **A test-only module under `__tests__` is safe.** `realRecordSupport.ts` is not named
  `*.test.ts`, so `test.include: ['src/**/*.test.ts']` does not collect it — it adds no
  test file and no build module.

## Gate history (Phase 16)

`0 → 59/693/167` · `1 → 59/693/167` · `2 → 60/708/167` · `3 → 61/712/167` ·
`4 → 61/712/167` · `5 → 61/712/167` · `6 → 61/712/167` (files / tests / build modules).

The **+19 tests** are Phase 16's own (15 Node + 4 jsdom); **+2 test files** (the Node
gate and the jsdom slice — the shared support module is not a test file). The build
module count is unchanged (**167**) because no production file entered the graph. Item 1
refactored the existing real-data ingestion test with **no count change**. Item 4 (the
manual verification record) and Item 5 (ADR-017 + architecture updates) were docs-only
and left the counts unchanged. **No red gate occurred in this phase.**

## Re-run commands

- Full green gate: `npm run check`
- Test suite only: `npm run test`
- Opt-in real-data gates only (dataset present in this workspace):
  `npx vitest run realData`
- Dev server (the **manual** real-browser pass — local ingestion, overlay, navigation,
  annotation detail/filter, click-to-pin; jsdom cannot draw or measure layout):
  `npm run dev`
- Machine snapshot: `node -v && npm -v && npx vitest --version`

## What Phase 16 proves and does not prove (honest limits)

- **Proves** — that the display-only presentation stack (the annotation overlay, the
  density cap, the symbol filter and its resolution, the nearest-event resolver and the
  detail formatter, the navigation bounds/zoom/pan/readout, the envelope and amplitude
  bounds) behaves consistently when driven by a **real MIT-BIH record's own**
  annotations and millivolt signal, with no DWT in the loop; that the jsdom
  `TimeSeriesView` renders that record's own annotation detail and offers its own
  distinct symbols (wiring only); and that the default suite never depends on the
  gitignored dataset.
- **Does not prove** — that the real-browser pass is a gate (it is a recorded **manual**
  observation in
  [`plans/phase-16-manual-verification.md`](phase-16-manual-verification.md:1)); that the
  numbers are record-independent (they depend on which record the probe picks — `101`
  today); nor anything about canvas **pixel** fidelity, layout, or wall-clock timing
  (never the gate). A **skipped** gate proves nothing: on a clean clone, where
  `data/raw/mitdb` is absent, both new gates skip. The jsdom slice cannot measure
  layout, so it stubs the `200×100` rect and proves the wiring only; the geometry and
  the strings are the Node gate's concern.

## Where the project stands / candidates for next

No next phase is proposed or approved. Phases 1–16 are complete; ADR-010 governs
optimization (measurement-first) and its deferrals still stand. Candidate directions —
**each a candidate only; none is auto-authorized**, and per rules §50/§52 any of them
must be planned as a measured, gated, itemized increment (Architect plan → approval →
Code execution with a green gate per item):

1. **Beyond single-symbol filtering (presentation follow-on).** Multi-symbol selection,
   a clickable legend that toggles symbols, or a small annotation list — display-only,
   must not imply detection, same gates (Node for the pure selection + jsdom wiring).
2. **A new dataset adapter** (e.g. another ECG DB or a richer synthetic generator) —
   adds an adapter behind the canonical `SignalRecord`; DSP/UI/ML untouched (§J).
3. **WASM DWT** — still **deferred** (ADR-010). Phase 9's numbers do not single out DWT
   next to filter/resample; a WASM path would need a parity gate first.
4. **WebGPU inference** — still **deferred** (ADR-010). No GPU path has been measured;
   only batch inference where it demonstrably wins is in scope.

## First action next session (suggested)

1. Confirm green with a single `npm run check` (expect **61 files / 712 tests**, build
   **167 modules**; svelte-check 0/0).
2. Decide with the user which candidate (if any) is next; then author + approve a
   next-phase plan in **Architect** mode, itemized with a green `npm run check` gate per
   item — same cadence as [`plans/phase-16-plan.md`](phase-16-plan.md:1).
3. Read [`plans/phase-16-audit.md`](phase-16-audit.md:1) for the exact Phase-16
   scope/evidence and
   [`plans/adr/ADR-017-real-data-verification.md`](adr/ADR-017-real-data-verification.md:1)
   for the opt-in gate policy (including the skipped-gate limit and the module-scope
   top-level `await` deviation) before adding or changing any real-data gate.

## Key references

- [`plans/phase-16-plan.md`](phase-16-plan.md:1) — the approved plan executed this
  session (status line kept as written, per repo convention; completion is in the
  audit).
- [`plans/phase-16-audit.md`](phase-16-audit.md:1) — item map, evidence, limits.
- [`plans/phase-16-manual-verification.md`](phase-16-manual-verification.md:1) — the
  manual real-browser verification record.
- [`plans/adr/ADR-017-real-data-verification.md`](adr/ADR-017-real-data-verification.md:1)
  — the real-data verification + opt-in gate policy.
- [`plans/ecg-lab-architecture.md`](ecg-lab-architecture.md:306) — §K / §M / decision
  register (current source of truth for scope).
- [`plans/adr/ADR-006-dataset-abstraction.md`](adr/ADR-006-dataset-abstraction.md:1) and
  [`plans/adr/ADR-012-real-dataset-ingestion.md`](adr/ADR-012-real-dataset-ingestion.md:1)
  — the dataset abstraction / ingestion decisions the opt-in gate must not contradict.
- [`plans/adr/ADR-013-annotation-display.md`](adr/ADR-013-annotation-display.md:1) —
  "display of domain facts, never science; never a detection".
- [`plans/adr/ADR-016-annotation-interaction.md`](adr/ADR-016-annotation-interaction.md:1)
  — the annotation-interaction decision the real-data slice exercises.
- [`plans/phase-15-checkpoint.md`](phase-15-checkpoint.md:1) — the checkpoint template
  this record mirrors.
