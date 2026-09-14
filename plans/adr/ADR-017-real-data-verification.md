# ADR-017 — Real-data verification and the opt-in gate policy (tests + docs only)

Status: Accepted
Date: 2026-09-13
Scope: Phase 16 — **tests and documentation only**. Two opt-in gates re-measure the
presentation stack's own invariants against a genuine MIT-BIH record (a pure **Node** gate over the
display helpers and a **jsdom** wiring slice over `TimeSeriesView`), plus a recorded manual
`npm run dev` observation. No domain, DSP/DWT, ML, worker, parser, adapter, application-service,
view, config or `package.json` change; the display helpers are **measured, never modified**; no new
dependency; no browser-automation dependency.

## Context

Phase 12–15 (ADR-013/014/015/016) built the display-only presentation stack — the density-capped
annotation overlay, the `Symbols:` legend, the view-local symbol filter, the detail line, the cursor
readout, the pointer/click gestures and the window/envelope geometry. Every one of those increments
was gated over **synthetic fixtures** only. Two verification gaps were left open, recorded at the
Phase-15 checkpoint as the "real-browser + real-data hardening" candidate:

1. **Real-data.** The display mapping's invariants (one marker per pixel column, counts consistent,
   the window containment rule, the amplitude ordering, the navigation containment) have never been
   exercised against a genuine record's **own** annotation list and **own** mV signal — only against
   `makeAnnotations`-style fixtures with a handful of hand-placed events.
2. **Real-browser.** The residual risks that only a real browser can exercise — both local-ingestion
   paths, the live canvas draw pass, the pointer gestures against real layout — have never been
   recorded outside the jsdom stubs.

Four hazards shaped the decision:

1. **A "real-data test" can quietly become a dependency on the gitignored dataset.** `data/raw/mitdb`
   is gitignored by design (ADR-006/ADR-012, local-first). A gate that *requires* it would be red on
   every clean clone and would make the default suite depend on a file the repo deliberately does not
   ship.
2. **A manual browser pass can masquerade as a gate.** With no browser-automation dependency in
   [`package.json`](../../package.json:1), an `npm run dev` pass is inherently machine-dependent,
   layout-sensitive and flaky. Recording it as a pass/fail gate would be a lie; it must be an
   **observation**.
3. **A re-measurement on real data can drift into a finding.** The app performs no beat detection and
   makes no clinical claim (rules §47/§49). A test asserting anything about a real record's beats
   would be exactly the detection-in-disguise the display phases forbid — the gate must assert
   *structural properties of the display mapping*, never that a beat "exists".
4. **"Which real record" can become several definitions that drift.** The probe already existed once
   ([`realData.integration.test.ts`](../../src/datasets/__tests__/realData.integration.test.ts:32));
   copying it into two new gates would create three probing rules that can disagree about which
   record is complete.

Constraints:

- **Display of a domain fact, never a detection** (ADR-013): every string the gates inspect is read
  from `record.annotations` (the record's own `AnnotationEvent`s) and the mV signal; the pure helpers
  own no algorithm and no threshold beyond the documented display fractions.
- **A re-measurement is an invariant check, not a finding:** the Node gate asserts *structural*
  properties (one marker per column, counts consistent, windows contained, bounds ordered) — never a
  clinical statement.
- **The default suite never depends on the gitignored dataset** (ADR-006/ADR-012): the dataset is
  absent on a clean clone, so every real-data gate **skips** there — and a skipped gate **proves
  nothing**, a limit stated rather than hidden.
- **Timing is never a CI gate** (rules §51, ADR-010): no wall-clock assertion, and the manual pass is
  not wired into `npm run check`.
- **Node-only seams confined to tests** (ADR-009, rules §27): the shared probe/loader is a
  test-support module, not production code a browser bundle could pull in.
- **jsdom cannot measure layout or pixels:** the jsdom slice proves **wiring only**, over a stubbed
  `getBoundingClientRect`; canvas pixels and window geometry are never asserted.
- **No new dependency, no new script, no config change.**

## Decision

### (a) One test-only support module owns the probe and the loader; the default suite never depends on the dataset

The probe in [`realData.integration.test.ts`](../../src/datasets/__tests__/realData.integration.test.ts:1)
is factored into a single **test-support** module,
[`src/datasets/__tests__/realRecordSupport.ts`](../../src/datasets/__tests__/realRecordSupport.ts:1),
mirroring the existing shared-support precedent
([`src/dsp/__tests__/support.ts`](../../src/dsp/__tests__/support.ts:1),
[`src/ml/__tests__/support.ts`](../../src/ml/__tests__/support.ts:1)), which is **not** collected as
a test because it does not match `*.test.ts`:

- [`MITDB_DIR`](../../src/datasets/__tests__/realRecordSupport.ts:1) — the absolute path of the
  gitignored raw dataset root;
- [`firstCompleteRecordId()`](../../src/datasets/__tests__/realRecordSupport.ts:37) — a **sync**
  probe (`existsSync` + `readdirSync`) returning the first record whose `.hea` (and `.dat`,
  preferring `.atr`) is present, else `undefined`;
- [`REAL_RECORD_SKIP_REASON`](../../src/datasets/__tests__/realRecordSupport.ts:1) — the stable
  reason a real-data gate is skipped when the dataset is absent;
- [`RealRecord`](../../src/datasets/__tests__/realRecordSupport.ts:53) — `{ recordId, record
  (canonical, raw-ADC, annotations preserved), signal (the single audited ADC→mV step) }`;
- [`loadRealRecord()`](../../src/datasets/__tests__/realRecordSupport.ts:64) — `undefined` when the
  dataset is absent, else the probed record + its mV signal, opened **read-only** through the
  existing [`NodeFileSource`](../../src/datasets/nodeSource.ts:26) (deliberately absent from the
  datasets barrel, so nothing here can reach the web bundle).

Rules (every one exercised):

- **The skip decision is sync; the load is async.** Each gate calls the sync
  `firstCompleteRecordId()` at declaration time to drive `it.skipIf(...)`, and reads the record
  **once** per file.
- **Never hard-code a record id.** The gates use whatever `firstCompleteRecordId()` returns, so a
  machine with a different (or no) real record behaves correctly. No record id is named in a test.
- **Read-only and browser-safe.** The dataset is opened read-only and never modified
  (ADR-006/ADR-012 — "treat as-is").

Rejected alternatives: (1) **duplicate the probe in each gate** — three copies drift, and "which
record" must have exactly one definition (the "one spine" rule). (2) **place the support outside
`__tests__`** (e.g. `src/testing/`) — a Node-only helper outside `__tests__` could be pulled into
the browser bundle and would breach "Node-only seams confined to tests" (ADR-009, rules §27). (3)
**ship the dataset or make the tests non-optional** — the dataset is gitignored by design; local-first
with an opt-in gate is the whole point (ADR-012).

### (b) The Node gate re-measures the display invariants over the record's own facts, with no DWT

New Node gate
[`src/presentation/views/timeSeries/__tests__/realDataDisplay.integration.test.ts`](../../src/presentation/views/timeSeries/__tests__/realDataDisplay.integration.test.ts:1)
loads the real record once and asserts the invariants below over its own annotations and mV signal.
It uses the pure display helpers directly (as
[`TimeSeriesView.svelte`](../../src/presentation/views/timeSeries/TimeSeriesView.svelte:1) does) and
therefore needs **no `analyzeRecord`/DWT** — it is cheap, deterministic and fast:

- **Overlay / density cap** ([`annotationMarkers()`](../../src/presentation/views/timeSeries/annotationGeometry.ts:169)):
  `markers.length ≤ columnCount`; one marker per populated column; markers ordered left→right by
  ascending `xFraction`, each `xFraction ∈ [0, 1]`; every marker's sample inside `[startSample,
  endSample)`; `visibleCount` equals an independently counted in-window total; `mergedCount ===
  visibleCount - markers.length ≥ 0`; each column representative is the **lowest** sample index
  (asserted by feeding a shuffled copy and comparing); `symbols` equals the distinct in-window
  symbols derived independently, ascending; the input list is **not mutated**.
- **Filter** ([`filterAnnotationsBySymbol()`](../../src/presentation/views/timeSeries/annotationGeometry.ts:252) /
  [`resolveSymbolFilter()`](../../src/presentation/views/timeSeries/annotationGeometry.ts:273)):
  `null` returns the input **unchanged** (identity); a real symbol returns the exact-match subset
  whose symbols are all that symbol; a legend symbol resolves to itself; an unknown symbol resolves
  to `null`; nothing is mutated.
- **Detail** ([`nearestAnnotationEventAtFraction()`](../../src/presentation/views/timeSeries/annotationGeometry.ts:300) /
  [`formatAnnotationDetail()`](../../src/presentation/views/timeSeries/annotationGeometry.ts:390)):
  querying at a real event's own `xFraction` returns the **record's own event object** (`toBe`); the
  formatted line carries that event's real `symbol` and `sampleIndex`.
- **Navigation** ([`viewportBoundsOf()`](../../src/presentation/views/timeSeries/navigationGeometry.ts:125),
  [`clampViewport()`](../../src/presentation/views/timeSeries/navigationGeometry.ts:146),
  [`zoomViewport()`](../../src/presentation/views/timeSeries/navigationGeometry.ts:170),
  [`panViewport()`](../../src/presentation/views/timeSeries/navigationGeometry.ts:209),
  [`readoutAtFraction()`](../../src/presentation/views/timeSeries/navigationGeometry.ts:273)): the
  bounds span `[startTimeSec, startTimeSec + sampleCount / fs]`; a clamped/zoomed/panned window stays
  inside the record and never grows past it; a pan preserves duration; a readout at an interior
  fraction lands inside the drawn [`sampleWindowOfTime()`](../../src/presentation/views/timeSeries/geometry.ts:104)
  window and never reports a negative sample index.
- **Envelope / amplitude** ([`envelopeColumns()`](../../src/presentation/views/timeSeries/geometry.ts:192) /
  [`visibleAmplitudeBounds()`](../../src/presentation/views/timeSeries/geometry.ts:218)): exactly
  `columnCount` columns; every populated column has finite `min ≤ max`; the amplitude bounds are
  finite and ordered when populated. *(Amplitude bounds carry no clinical meaning — they frame the
  drawing.)*

Annotation-dependent cases are **guarded**: when the probed record happens to carry no `.atr` (zero
annotations), the annotation/filter/detail cases use `it.skipIf(...)` on that record's annotation
count, while the navigation/envelope cases still run. The probe prefers an annotated record, so on a
machine holding a complete record every case runs.

Rejected alternative: **exercise the full `analyzeRecord` pipeline on the real record.** Rejected —
a db4 level-4 DWT over ~650k×2 samples risks the default per-test timeout, and the pipeline is
already gated against fixtures; "display invariants" are a property of the *display helpers*, which
take the signal and annotations directly. (A full-pipeline real-data smoke is deliberately out of
scope here; it belongs to its own phase with an explicit timeout budget.)

### (c) The jsdom slice proves wiring only, over the stubbed rect

New jsdom gate
[`src/presentation/views/timeSeries/__tests__/realDataInteraction.integration.test.ts`](../../src/presentation/views/timeSeries/__tests__/realDataInteraction.integration.test.ts:1)
(`// @vitest-environment jsdom`) renders
[`TimeSeriesView.svelte`](../../src/presentation/views/timeSeries/TimeSeriesView.svelte:30) with the
real `Signal` + the record's real annotations, over the stubbed `200×100` `getBoundingClientRect`
precedent ([`TimeSeriesView.test.ts`](../../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:466)),
and asserts **wiring** with explicit `cleanup()` in `afterEach`:

- the idle detail by default;
- a `pointerMove` over a real annotation's plot fraction making the detail **non-idle and naming
  that event's own symbol/note**;
- the symbol filter offering the real window's distinct symbols;
- selecting a real symbol narrowing the summary/legend caption while keeping every option.

It renders the view **directly** (not `App`) and reuses the shared `loadRealRecord()` so "which
record" stays single-sourced. The **numbers and strings stay the Node gate** (decision (b)); the
jsdom slice only proves the pointer-fraction → helper → DOM wiring, guarded on `rect.width > 0`.

Rejected alternative: **mount `App.svelte`** as
[`App.test.ts`](../../src/presentation/__tests__/App.test.ts:50) does. Rejected — that requires a
service and an analysis pass over the whole real record, which is slow and unnecessary for a
display-wiring claim.

### (d) Real-browser verification is a recorded manual observation; no browser-automation dependency

The candidate is named "real-browser", but the honest scope is a **manual** pass recorded in
[`plans/phase-16-manual-verification.md`](../../plans/phase-16-manual-verification.md:1), exactly as
the repo already records manual `npm run dev` checks
([`plans/phase-10-measurement.md`](../../plans/phase-10-measurement.md:1)) — the same convention
ADR-012 used for "validated manually". The document is a **checklist + observation log** covering
both ingestion paths (`<input type=file multiple>`/drag-drop floor and the Chromium-only directory
picker), the annotation overlay/legend, navigation (zoom/pan/reset + the "Custom (zoomed)" option),
the cursor readout, the hover detail, the symbol filter and the click-to-pin, plus a "no console
errors" check. Code records the confirmations it can make without a human (the production `build` is
already in the gate; a brief `npm run dev` smoke proves the dev server serves `index.html` and
resolves the worker/`.onnx` assets) and leaves the interactive steps as **blank, honestly-pending**
observation slots for a human.

A defect surfaced during the manual pass is **reported, never silently fixed here** — the phase does
not widen into a production change.

Rejected alternative: **add a browser-automation dependency** (Playwright / Vitest browser mode).
Rejected — it adds a heavy dependency, contradicts ADR-012's no-new-dependency precedent, and would
turn a machine-dependent, flaky, layout-sensitive check into a supposed gate — contrary to rules §51
and the project's "never a committed wall-clock/pixel assertion" stance.

### (e) Testability split and the phase gates, and the skipped-gate limit

- **Numbers/strings (Node):** [`realDataDisplay.integration.test.ts`](../../src/presentation/views/timeSeries/__tests__/realDataDisplay.integration.test.ts:1)
  — the invariant gate of decision (b), every case `it.skipIf(datasetAbsent)` and the
  annotation-dependent cases additionally guarded on the record's own annotation count.
- **Wiring (jsdom):** [`realDataInteraction.integration.test.ts`](../../src/presentation/views/timeSeries/__tests__/realDataInteraction.integration.test.ts:1)
  — the slice of decision (c).
- **Never asserted:** canvas pixels (jsdom has no 2d context), real layout/window geometry, and no
  wall-clock timing (rules §51).
- **Docs/record:** ADR-017, the manual verification record, and the §K/§M/decision-register entries
  are documentation only; `npm run check` stays green without a count change beyond the two new test
  files.
- **The skipped-gate limit:** when the dataset is absent the gates **skip**, and a skip proves
  **nothing** about real data. The green `npm run check` on a clean clone therefore says only "the
  display invariants hold over the synthetic fixtures and the opt-in cases were skipped", never
  "real data was verified".

## Consequences

- The presentation stack's invariants are now re-measured against a genuine MIT-BIH record's own
  annotations and mV signal, closing the real-data gap the Phase 12–15 fixtures left open — and the
  re-measurement is a **structural invariant check** on the display mapping, never a finding
  (ADR-013).
- **The default suite still never depends on the gitignored dataset — structurally.** Every real-data
  case is `it.skipIf(...)` on the sync probe; on a clean clone the gates skip and `npm run check`
  stays green. The support module is not collected (`*.test.ts` only) and opens the dataset read-only.
- **One definition of "which record."** The datasets test and both new gates import the shared
  probe/loader, so no record id is hard-coded and the completeness rule cannot drift.
- **Real-browser verification is honest.** It is a recorded observation in
  [`plans/phase-16-manual-verification.md`](../../plans/phase-16-manual-verification.md:1), never a
  gate; the interactive steps are left "Pending (human)", and no browser-automation dependency is
  added.
- **No new dependency, no config/tsconfig/`package.json` change**; the production bundle is
  unchanged (the support module is test-only and Node-only). ADR-001/008/009/010/012/013/014/015/016
  all hold unchanged.
- **Honest limits:** the jsdom slice proves **wiring only** over the stubbed rect (jsdom cannot
  measure layout); the invariant numbers and strings are the pure Node gate; the manual record is an
  observation; and the opt-in gates **skip** where the dataset is absent, so a skip proves nothing
  about real data.

## References

- Architecture plan §K (testing architecture), §M item 16 (Phase 16), decision register (ADR-017)
- [`plans/phase-16-plan.md`](../../plans/phase-16-plan.md) — approved scope and item-by-item gates
- [`plans/phase-16-manual-verification.md`](../../plans/phase-16-manual-verification.md) — the manual
  real-browser checklist + observation log (never a gate)
- ADR-012 (no new dependency, local-first, the opt-in real-data test and the manual-validation
  convention), ADR-006 (the dataset abstraction — the dataset is gitignored and treated as-is),
  ADR-013 (a display of a domain fact, never a detection — the constraint every assertion here
  honours), ADR-009 (Node-only seams confined to tests), ADR-010 (timing is never a CI gate),
  ADR-016 (the annotation-interaction display stack this phase re-measures, and the ADR template
  mirrored here)
- Rules §27 (no Node-only code in production paths), §47/§49 (no clinical claim — an annotation is
  never a detection), §51 (no wall-clock assertions), §56 (green check gate)
