# Phase 16 Audit / Completion — Real-browser + real-data hardening: opt-in real-record verification of the display invariants

Recorded 2026-09-13 (Code-mode completion record). Verdict: **Phase 16 implemented
and fully green.** The full `npm run check` gate passes at the end of every item and
again as the final gate: typecheck ✓, svelte-check (0 errors / 0 warnings) ✓, lint ✓,
**61 test files / 712 tests** ✓, Vite build ✓ (**167 modules**).

**Tests and documentation only:** no domain, DSP/DWT, ML, worker, parser, adapter,
application-service, view or configuration change, and no `package.json` change. The
display helpers are **measured, never modified**. The scientific configuration stays
`db4 / 4 / periodic`. Every assertion the phase adds is a **structural invariant of the
display mapping over the record's own facts** — never a detection, never a clinical
claim (rules §47/§49, ADR-013); the real-browser pass is a **recorded manual
observation**, never a gate (ADR-017).

## Scope / approved increment

> "The user approved **Candidate 1** from the Phase-15 checkpoint: **Real-browser +
> real-data hardening: an opt-in real-data interaction test plus re-measuring the
> display invariants on real MIT-BIH records.**
>
> This closes the two **verification gaps** the Phase 12–15 presentation phases left
> open, **without touching any production code**: (1) **Real-data** — re-measuring the
> display stack's invariants against a genuine MIT-BIH record's own annotations and its
> own mV signal, in an **opt-in** gate that **skips** when the gitignored dataset is
> absent; (2) **Real-browser** — the risks only a real browser can exercise, recorded as
> a **manual `npm run dev` observation**, never an automated gate.
>
> This is a **tests-and-docs** increment. […] The single most important honesty
> constraint: every claim is about the **display of domain facts already present in the
> record** — the density-capped overlay, the symbol legend/filter, the cursor/detail
> readouts and the navigation window are *displays*, never detections and never clinical
> claims (rules §47/§49, ADR-013)."
> — [`plans/phase-16-plan.md`](phase-16-plan.md:11)

The user's governing instruction was to **approve the plan as written** and to switch to
Code to execute it **item by item**, confirming a green `npm run check` between items.
That is exactly what was executed.

## Files added

| Purpose | File | Kind |
|---|---|---|
| Shared opt-in real-record probe + loader | [`src/datasets/__tests__/realRecordSupport.ts`](../src/datasets/__tests__/realRecordSupport.ts:1) | test-support (not collected) |
| Real-data display-invariant **Node** gate | [`src/presentation/views/timeSeries/__tests__/realDataDisplay.integration.test.ts`](../src/presentation/views/timeSeries/__tests__/realDataDisplay.integration.test.ts:1) | test (Node, 15 cases) |
| Real-data **jsdom** wiring slice | [`src/presentation/views/timeSeries/__tests__/realDataInteraction.integration.test.ts`](../src/presentation/views/timeSeries/__tests__/realDataInteraction.integration.test.ts:1) | test (jsdom, 4 cases) |
| Manual real-browser checklist + observation log | [`plans/phase-16-manual-verification.md`](phase-16-manual-verification.md:1) | docs |
| ADR-017: real-data verification + opt-in gate policy | [`plans/adr/ADR-017-real-data-verification.md`](adr/ADR-017-real-data-verification.md:1) | docs |
| Phase 16 audit (this record) | [`plans/phase-16-audit.md`](phase-16-audit.md:1) | docs |

The approved plan [`plans/phase-16-plan.md`](phase-16-plan.md:1) was authored in Architect
mode as the precursor to this phase.

**Touched:**

- [`src/datasets/__tests__/realData.integration.test.ts`](../src/datasets/__tests__/realData.integration.test.ts:1)
  — refactored to import the shared [`MITDB_DIR`](../src/datasets/__tests__/realRecordSupport.ts:25)
  and [`firstCompleteRecordId()`](../src/datasets/__tests__/realRecordSupport.ts:37) instead
  of an inline probe. Its single case stays byte-for-byte the same in behaviour and still
  **runs** on this machine (the dataset is present), not skipped.
- [`plans/ecg-lab-architecture.md`](ecg-lab-architecture.md:298) — a §K **Testing
  architecture** bullet (opt-in real-data verification), a §M **item 16** (Phase 16), and
  the decision-register entry (**ADR-017**).

**Not touched (by design):** all of `src/domain/**`, `src/dsp/**`, `src/ml/**`,
`src/workers/**`, `src/bench/*`, `src/application/**`, `src/main.ts`,
`src/presentation/App.svelte`, `src/presentation/dataset/*`,
`src/presentation/workers/*`, and every `src/datasets/*` production file (only the
test-support module was added — no parser/adapter/`load`/`catalog` change). The display
helpers themselves — [`annotationGeometry.ts`](../src/presentation/views/timeSeries/annotationGeometry.ts:1),
[`geometry.ts`](../src/presentation/views/timeSeries/geometry.ts:1),
[`navigationGeometry.ts`](../src/presentation/views/timeSeries/navigationGeometry.ts:1),
[`TimeSeriesView.svelte`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:1) —
are **unchanged**; this phase only *measures* them. Also untouched:
[`package.json`](../package.json:1) (**no new dependency and no new script**) and
[`vite.config.ts`](../vite.config.ts) (the existing `test` block already collects
`*.test.ts` and supports per-file jsdom). No new dependency, no `tsconfig` change.

## Item-by-item mapping

0. **Pre-flight** — `npm run check` green (**59 files / 693 tests / 167 modules**); no
   files touched.
1. **Shared opt-in real-record support** — created
   [`realRecordSupport.ts`](../src/datasets/__tests__/realRecordSupport.ts:1) exporting
   [`MITDB_DIR`](../src/datasets/__tests__/realRecordSupport.ts:25),
   [`REAL_RECORD_SKIP_REASON`](../src/datasets/__tests__/realRecordSupport.ts:28),
   [`firstCompleteRecordId()`](../src/datasets/__tests__/realRecordSupport.ts:37),
   [`RealRecord`](../src/datasets/__tests__/realRecordSupport.ts:53) and
   [`loadRealRecord()`](../src/datasets/__tests__/realRecordSupport.ts:64), and refactored
   [`realData.integration.test.ts`](../src/datasets/__tests__/realData.integration.test.ts:1)
   to import the shared probe. `npm run check` green (**59 files / 693 tests / 167
   modules**; no count change — the support module is **not** collected, and the existing
   case still runs).
2. **Opt-in real-data display-invariant Node gate** — created
   [`realDataDisplay.integration.test.ts`](../src/presentation/views/timeSeries/__tests__/realDataDisplay.integration.test.ts:1)
   (default Node env) with **15** cases across five `describe`s; `npm run check` green
   (**60 files / 708 tests / 167 modules**; +1 file, +15 tests).
3. **Opt-in real-data jsdom interaction slice** — created
   [`realDataInteraction.integration.test.ts`](../src/presentation/views/timeSeries/__tests__/realDataInteraction.integration.test.ts:1)
   (`// @vitest-environment jsdom`, stubbed `200×100` rect, `cleanup()` in `afterEach`)
   with **4** cases; `npm run check` green (**61 files / 712 tests / 167 modules**; +1
   file, +4 tests). The file reported `(4 tests) 156 ms` — i.e. the cases **ran**, not
   skipped, so the module-scope load resolved under jsdom too.
4. **Manual real-browser verification record** — created
   [`phase-16-manual-verification.md`](phase-16-manual-verification.md:1): the "never a
   gate" callout, "What this covers / does not cover", **Part 1** an automated-
   confirmations table, **Part 2** the manual checklist (sections A–K), **Part 3** a blank
   observation log, an "If a defect surfaces" clause, and a "How to re-run" section.
   `npm run check` green (**61 files / 712 tests / 167 modules** — docs-only).
5. **ADR-017 + architecture update** — created
   [`ADR-017-real-data-verification.md`](adr/ADR-017-real-data-verification.md:1) and
   edited [`ecg-lab-architecture.md`](ecg-lab-architecture.md:298) (§K bullet / §M item 16
   / decision register). `npm run check` green (**61 files / 712 tests / 167 modules** —
   docs-only).
6. **Audit + final gate (this record)** — final full `npm run check` green (**61 files /
   712 tests / 167 modules**).

## Evidence (the correctness gates)

The claims are pinned at two levels — a **pure Node** gate for the invariant numbers and
strings, and a **jsdom** gate for the wiring — never by pixels or timings:

- **Shared probe + loader (test-support).** `firstCompleteRecordId()` is a **sync** probe
  (`existsSync` + `readdirSync`) preferring a record whose `.hea`, `.dat` **and** `.atr`
  are all present; `loadRealRecord()` reads it read-only through
  [`NodeFileSource`](../src/datasets/nodeSource.ts:26) (deliberately absent from the
  datasets barrel, so nothing here reaches the web bundle) and returns the canonical
  `SignalRecord` plus the single audited ADC→mV `Signal`. No record id is hard-coded
  anywhere; the gates use whatever the probe returns.

- **Display-invariant gate (Node) —**
  [`realDataDisplay.integration.test.ts`](../src/presentation/views/timeSeries/__tests__/realDataDisplay.integration.test.ts:1),
  **15** cases, all `it.skipIf(...)`:
  - *overlay / density cap* (5 **Node** cases):
    [`caps to one marker per populated pixel column, ordered left to right`](../src/presentation/views/timeSeries/__tests__/realDataDisplay.integration.test.ts:167);
    [`counts the visible window annotations and the merged rest consistently`](../src/presentation/views/timeSeries/__tests__/realDataDisplay.integration.test.ts:193)
    (`visibleCount` equals an independently counted in-window total and
    `mergedCount === visibleCount − markers.length`, with the per-column `mergedCount − 1`
    summing to it); [`keeps every marker sample inside the half-open drawn window`](../src/presentation/views/timeSeries/__tests__/realDataDisplay.integration.test.ts:211);
    [`picks the lowest sample index of each column regardless of input order`](../src/presentation/views/timeSeries/__tests__/realDataDisplay.integration.test.ts:227)
    (a reversed copy yields an identical marker list); [`lists the window distinct symbols ascending without mutating the record`](../src/presentation/views/timeSeries/__tests__/realDataDisplay.integration.test.ts:260).
  - *symbol filter* (3): [`treats "All symbols" as the identity, never a copy`](../src/presentation/views/timeSeries/__tests__/realDataDisplay.integration.test.ts:280)
    (`toBe`, not a copy, for `null` and `""`); [`returns the exact-match subset for a real window symbol`](../src/presentation/views/timeSeries/__tests__/realDataDisplay.integration.test.ts:294);
    [`resolves a legend symbol to itself and an unknown symbol to null`](../src/presentation/views/timeSeries/__tests__/realDataDisplay.integration.test.ts:317).
  - *cursor / hover detail* (2): [`returns the record's own event when queried at its own x fraction`](../src/presentation/views/timeSeries/__tests__/realDataDisplay.integration.test.ts:337)
    (the hit's `event` is `toBe` the record's own object, chosen by the documented
    distance → lower index → smaller symbol tie-break); [`formats the detail line with the record's own symbol and sample index`](../src/presentation/views/timeSeries/__tests__/realDataDisplay.integration.test.ts:371)
    (the line contains `Annotation: {symbol} · sample {i}` and is never the idle label).
  - *navigation* (3): [`spans the record's acquisition window and keeps derived windows inside it`](../src/presentation/views/timeSeries/__tests__/realDataDisplay.integration.test.ts:404)
    (clamp/zoom/pan candidates stay inside and never invert); [`preserves the duration across a pan while sliding a zoomed window`](../src/presentation/views/timeSeries/__tests__/realDataDisplay.integration.test.ts:449);
    [`keeps an interior readout inside the drawn sample window`](../src/presentation/views/timeSeries/__tests__/realDataDisplay.integration.test.ts:475)
    (full and zoomed windows, never a negative sample index).
  - *envelope / amplitude* (2): [`emits exactly one column per pixel column with ordered finite ranges`](../src/presentation/views/timeSeries/__tests__/realDataDisplay.integration.test.ts:508);
    [`frames exactly the visible samples with finite ordered amplitude bounds`](../src/presentation/views/timeSeries/__tests__/realDataDisplay.integration.test.ts:538)
    (the bounds equal a directly recomputed min/max over the drawn window).

- **Wiring gate (jsdom) —**
  [`realDataInteraction.integration.test.ts`](../src/presentation/views/timeSeries/__tests__/realDataInteraction.integration.test.ts:193),
  **4** cases over a stubbed `200×100` rect, rendering `TimeSeriesView` directly with the
  real `Signal` + the record's annotations:
  [`shows the idle annotation detail before any pointer interaction`](../src/presentation/views/timeSeries/__tests__/realDataInteraction.integration.test.ts:205)
  (the idle label); [`names the record's own annotation a pointer rests on`](../src/presentation/views/timeSeries/__tests__/realDataInteraction.integration.test.ts:214)
  (a `pointerMove` at the chosen real event's own plot fraction makes the detail line the
  record's own `formatAnnotationDetail({ event, distanceFraction: 0 })`); [`offers the record's own distinct symbols in the symbol filter`](../src/presentation/views/timeSeries/__tests__/realDataInteraction.integration.test.ts:240)
  (the options are `["All symbols", ...distinctSymbols()]`); [`narrows the caption to a chosen real symbol, keeping every option`](../src/presentation/views/timeSeries/__tests__/realDataInteraction.integration.test.ts:252)
  (selecting a real symbol narrows the caption to `Annotations: N in view` /
  `Symbols: {symbol}` while the options still come from the unfiltered window). jsdom
  cannot measure layout, so this proves the fraction → helper → DOM **wiring** only; the
  numbers and strings are the Node gate above.

## Decisions recorded (ADR-017)

1. **Real-data gates are opt-in and skip when the gitignored dataset is absent** — the
   default suite never depends on `data/raw/mitdb` (ADR-006/ADR-012), and a skipped gate
   **proves nothing** (stated, not hidden).
2. **The gates re-measure display invariants over the record's own facts** — never a
   detection, never a clinical claim (ADR-013). The Node gate asserts *structural*
   properties of the display mapping (one marker per column, consistent counts, half-open
   containment, ordered bounds, contained navigation), never that a beat "exists".
3. **The jsdom slice proves wiring only**, over the stubbed `200×100` rect; the numbers
   and strings stay the pure Node gate.
4. **Real-browser verification is a recorded manual observation, never a gate**, and **no
   browser-automation dependency** is added (ADR-012 no-new-dependency precedent, rules
   §51).
5. **"Which real record" has exactly one definition**, in a test-only support module,
   never hard-coding a record id, opening the dataset read-only.

## What Phase 16 proves and does not prove

**Proves** — that the display helpers' **invariants hold on a genuine MIT-BIH record's
own annotations and mV signal**, not only on fixtures: the overlay caps to one marker per
populated pixel column and orders left→right inside `[0, 1]`; `visibleCount`/`mergedCount`
are internally consistent with an independent count; each column's representative is the
lowest sample index (invariant to input order); the window law is half-open; the legend
symbols are the distinct in-window symbols, ascending; the symbol filter is the identity
for `null`/`""`, the exact-match subset otherwise, and resolves a removed symbol to "All";
querying the resolver at a real event's own fraction returns the **record's own event
object** (`toBe`) and the formatted line names that event's real symbol/sample index; the
navigation window is contained, a pan preserves duration, and an interior readout lands
inside the drawn window with no negative index; the envelope emits exactly one column per
pixel column with finite ordered ranges and the amplitude bounds equal a directly
recomputed min/max. It also proves the **wiring** of those helpers to `TimeSeriesView`
over the real record (idle detail; a hover names a real symbol; the filter offers the real
window's symbols; selecting one narrows the caption while keeping every option). And it
proves the whole path is **display-only** — no service call, no science change, no buffer
write.

**Does not prove** — that the pointer, in a **real browser**, sits on a pixel that
visually overlaps a marker (jsdom has no layout; the rect is stubbed and the interactive
steps are left **pending human** in the manual record); canvas rendering fidelity (jsdom
cannot draw); or anything about real time. It does **not** prove that "real data was
verified" on a machine **without** the dataset — there the gates **skip**, and a skip
proves nothing. It makes **no** clinical or detection claim anywhere (rules §47/§49).

## Residual risk

- **A skip is silent unless read.** On a clean clone the opt-in gates skip and the green
  `npm run check` says only that the synthetic suites passed. This is inherent to
  local-first (ADR-006/ADR-012) and is stated in the ADR, the plan and the manual record;
  it is not detectable from the exit code alone.
- **The gates track whatever `firstCompleteRecordId()` returns.** A different machine may
  probe a different record with different annotator symbols; the gates are written against
  the probe's own facts (never a hard-coded id or symbol), so they remain correct — but the
  specific numbers they exercise differ per machine.
- **jsdom cannot measure layout.** The pointer-fraction path is covered by the pure Node
  tests plus the stubbed wiring slice and by the manual `npm run dev` check; the manual
  steps are honestly **pending human** and are not a gate.
- **The manual record is a snapshot, not a gate.** It records the automated confirmations
  Code could make (build already in the gate; a brief dev-server smoke of `/`, the two
  workers and the `.onnx`) and leaves every interactive step as a blank observation slot.
- **No new dependency, no config/`tsconfig`/`package.json` change** — so there is no
  dependency or toolchain risk introduced by this phase.

## Test counts

Final `npm run check`: **61 test files / 712 tests** (Phase-15 close: 59 / 693; **+2 test
files, +19 tests, +1 non-collected test-support module**). Build: **167 modules**
(unchanged from the Phase-15 close — the two new gates and the support module are not in
the browser graph).

| File | Tests | Level |
|---|---|---|
| [`realDataDisplay.integration.test.ts`](../src/presentation/views/timeSeries/__tests__/realDataDisplay.integration.test.ts:1) | +15 (new file) | Node (opt-in) |
| [`realDataInteraction.integration.test.ts`](../src/presentation/views/timeSeries/__tests__/realDataInteraction.integration.test.ts:1) | +4 (new file) | jsdom (opt-in) |
| [`realData.integration.test.ts`](../src/datasets/__tests__/realData.integration.test.ts:1) | 1 → 1 (refactored, unchanged) | Node (opt-in) |

**Documented implementation deviation (honest note):** Design decision 2 / Reminder 3 of
the plan called for the record to be read **inside a `beforeAll` guarded by the probe**.
Both new gates instead read it once at **module scope via top-level `await`** (allowed by
the project's `module: ESNext` / `target: ES2022` config). Reason: the plan also requires
the annotation-dependent cases to be driven by `it.skipIf(...)` on the record's **own
annotation count**, which is only known *after* the read; a `beforeAll` load cannot supply
a declaration-time condition. The module-scope load resolves before any `describe`/`it`
registers, so both guarantees ("read once per file" and "skip when absent / unannotated")
hold exactly, and the gates were confirmed to **run** (not skip) on this machine in both
environments. This is the only deviation from the approved plan and it is behavior-
preserving; it is recorded here per Reminder 8.

**Gate history:** 0 → 59/693/167 · 1 → 59/693/167 · 2 → 60/708/167 · 3 → 61/712/167 ·
4 → 61/712/167 · 5 → 61/712/167 · 6 → 61/712/167.

## References

- [phase-16-plan.md](phase-16-plan.md:1) — the approved plan executed above.
- [ADR-017-real-data-verification.md](adr/ADR-017-real-data-verification.md:1) — the
  real-data verification / opt-in gate policy this phase records.
- [phase-16-manual-verification.md](phase-16-manual-verification.md:1) — the manual
  real-browser checklist + observation log (never a gate).
- [ADR-012-browser-local-ingestion.md](adr/ADR-012-browser-local-ingestion.md:1) —
  no-new-dependency, local-first, the opt-in real-data test, and the manual-validation
  convention.
- [ADR-013-annotation-display.md](adr/ADR-013-annotation-display.md:1) — the display-only
  annotation overlay and legend ("display of domain facts, never a detection").
- [ADR-014-signal-navigation.md](adr/ADR-014-signal-navigation.md:1),
  [ADR-015-cursor-annotation-readout.md](adr/ADR-015-cursor-annotation-readout.md:1) and
  [ADR-016-annotation-interaction.md](adr/ADR-016-annotation-interaction.md:1) — the
  navigation / readout / interaction display decisions whose invariants this phase
  re-measures over real data.
- [ecg-lab-architecture.md](ecg-lab-architecture.md:298) — §K bullet / §M item 16 /
  decision register (+ADR-017).
- [phase-15-audit.md](phase-15-audit.md:1) and
  [phase-15-checkpoint.md](phase-15-checkpoint.md:1) — the audit/checkpoint templates
  this phase mirrors.
