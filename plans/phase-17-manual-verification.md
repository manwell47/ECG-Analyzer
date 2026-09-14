# Phase 17 — Manual real-browser verification record (`npm run dev`)

Recorded 2026-09-14. Purpose: the honest, reproducible **observation record** for the
Phase-17 controls — the clickable symbol legend, the multi-symbol selection and the
bounded annotation-list panel — over a genuine record in a **real browser**. It
accompanies the Phase-17 gates in
[`annotationGeometry.test.ts`](../src/presentation/views/timeSeries/__tests__/annotationGeometry.test.ts:1)
(Node) and
[`TimeSeriesView.test.ts`](../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:1)
plus the opt-in
[`realDataInteraction.integration.test.ts`](../src/presentation/views/timeSeries/__tests__/realDataInteraction.integration.test.ts:1)
(jsdom), and the standing policy pinned in [`ADR-017`](adr/ADR-017-real-data-verification.md:1).

> **This document is a recorded observation, never a gate.** It is not wired into
> `npm run check`, it asserts **no** wall-clock duration and **no** pixel value, and
> nothing here fails a build (rules §51; ADR-010). It exists because the residual risks
> that only a real browser can exercise — the live canvas, the pointer gestures and
> whether the new controls are usable at real size — have **no automation dependency**
> in this repo (no Playwright / Vitest browser mode; ADR-012's no-new-dependency
> precedent), so they are captured by hand.

## What this covers

The **Phase-17 display controls** over the real gitignored dataset on this machine
(`data/raw/mitdb`, whose only complete record is `101`, 2 channels, 360 Hz, 650 000
samples, `MLII`/`V1`), plus a regression sweep of the Phase-15/16 interactions whose
assertions this phase re-pointed:

- the **clickable symbol legend** (`role="group" aria-label="Symbol selection"`) and its
  `aria-pressed` toggles;
- **multi-symbol selection**, including the **empty selection = "All symbols"** rule and
  the "off-switch can never be hidden" rule;
- the **bounded annotation-list panel** (`aria-label="Annotations in view"`): the caption,
  the deterministic row order, the cap and the scroll;
- **click-to-pin from a row** through the same single pin the canvas click uses;
- the re-pointed Phase-15 interactions: the hover **annotation detail**, the canvas
  **click-to-pin**, and the "a filter that excludes a pinned marker drops the pin" rule;
- a "no console errors" check.

## What this does **not** cover / claim

- No science claim. Every symbol, sample, note, toggle and row is the **display of the
  record's own domain facts**, never a detection and never a clinical statement
  (rules §47/§49; ADR-013/ADR-018). Selecting symbols **hides** markers; it never claims
  and never re-invokes `service.analyze` (ADR-008).
- No performance claim. Wall-clock timing is never a criterion (rules §51).
- No assertion about pixels. The observation is of the rendered result a human sees; the
  numerical invariants (ordering, membership, cap, caption strings) stay the pure **Node**
  gate in
  [`annotationGeometry.test.ts`](../src/presentation/views/timeSeries/__tests__/annotationGeometry.test.ts:1).
- The cap is a **presentation** bound (`ANNOTATION_LIST_LIMIT = 200`), never a threshold
  and never a claim about the record.

## Ground truth this pass checks against (from the code)

- The legend renders only when the window has symbols (`allSymbols.length > 0`): a
  `Symbols:` label plus one `<button class="series-legend-toggle" aria-pressed=…>` per
  distinct symbol of the **unfiltered** window
  ([`TimeSeriesView.svelte`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:776)).
  A pressed toggle is filled dark amber
  ([`.series-legend-toggle[aria-pressed="true"]`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:920)).
- The panel is a `<section class="series-annotation-list" aria-label="Annotations in view">`
  with a caption and an `<ol class="series-annotation-list-rows">` of row buttons; the
  rows list is **scrollable** (`max-height: 9rem; overflow-y: auto`)
  ([`TimeSeriesView.svelte`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:938)).
  A pinned row is filled dark amber
  ([`.series-annotation-row[aria-current="true"]`](../src/presentation/views/timeSeries/TimeSeriesView.svelte:957)).
- Caption strings ([`formatAnnotationListCaption()`](../src/presentation/views/timeSeries/annotationGeometry.ts:534)):
  `No annotations in view` · `Showing first {listed} of {total} in view` (when the cap bit)
  · `{total} in view` (otherwise).
- Row and detail strings
  ([`formatAnnotationDetail()`](../src/presentation/views/timeSeries/annotationGeometry.ts:437)):
  `Annotation: {symbol} · sample {i}` plus ` · {auxNote}` when the note is non-empty; the
  idle line is `Annotation: —`.
- Row order ([`annotationList()`](../src/presentation/views/timeSeries/annotationGeometry.ts:496)):
  ascending `sampleIndex`, ties broken by the lexicographically smaller `symbol`.
- **The default synthetic boot record carries no annotations** (`annotations: []`), so the
  legend and the panel rows only appear after a real/local record with an `.atr` is
  ingested.

---

## Part 1 — Automated confirmations Code can make (recorded)

Reproducible from the repo root; they do **not** need a human.

| # | Command / probe | Expected | Observed | Result |
|---|---|---|---|---|
| 1 | `npm run check` | exit 0; typecheck + svelte-check (0/0) + lint + tests + production build | 2026-09-14: exit 0; **61 test files / 750 tests**, build **167 modules** | ✅ pass |
| 2 | opt-in real-data **Node** display gate | 15 cases **run** (dataset present here) | `realDataDisplay.integration.test.ts (15 tests)` — ran, not skipped | ✅ ran |
| 3 | opt-in real-data **jsdom** interaction slice | 4 cases **run** (dataset present here) | `realDataInteraction.integration.test.ts (4 tests)` — ran, not skipped | ✅ ran |
| 4 | Dev-server serves `index.html`, both `.worker.ts` entries and the probe `.onnx` | each URL → **200** | 2026-09-14: Vite ready in 810 ms; `/` → 200 `text/html`; `dsp.worker.ts` → 200 `text/javascript`; `inference.worker.ts` → 200 `text/javascript`; probe `.onnx` → 200 (no content-type) | ✅ pass |
| 5 | `npx vitest run realData` (all opt-in real-data gates) | every real-data gate **runs** (dataset present here) | **3 files / 20 tests** passed — 1 ingestion + 15 Node display + 4 jsdom interaction, none skipped | ✅ ran |

> **Skip-if-absent limit.** On a clean clone `data/raw/mitdb` is gitignored and absent, so
> probes 2–3 report **skipped**. A skipped gate **proves nothing** about real data — that
> limit is stated, not hidden (ADR-017).

---

## Part 2 — Manual browser checklist (human, pending)

Run `npm run dev`, open the served URL in a real browser with the console open, ingest the
local `101` files (`101.hea`, `101.dat`, `101.atr`) so the record has annotations, then work
down the list. `Result` starts **Pending (human)** for every interactive step.

> **Observed 2026-09-14 — the pass is BLOCKED by a defect, not merely unfinished.** The first
> real-browser attempt stopped at A2: the page showed `Record [101]` / `1 record discovered` /
> `Analyzing default record…` and stayed there indefinitely with no canvas. That is the literal
> rendering of `App`'s `{#if busy}` branch with `result === null`, i.e. the analysis promise never
> settled. It is **not** a Phase-17 control defect: the cause is in the Phase-10 worker glue and it
> blocks the boot analysis as well, so **no** step below can be observed until it is fixed. It is
> recorded and routed as its own increment in
> [`plans/defect-001-worker-onmessage-delivery.md`](defect-001-worker-onmessage-delivery.md)
> (ADR-017 §(d): a defect surfaced here is reported, never silently patched into this record).
> Rows B1–F2 remain **Pending (human)** — untouched, not passed.

### A. Boot and ingest (precondition)

| # | Step | Expected observation | Result |
|---|---|---|---|
| A1 | Open the served URL | The default synthetic record renders; there is **no** legend and the panel caption reads "No annotations in view" (the synthetic record has none) | ❌ **Blocked** — the boot analysis never settled (DEFECT-001); no canvas was rendered |
| A2 | Ingest `101.hea` + `101.dat` + `101.atr` (file input or drag-drop) | The record is discovered and analyzed through the service; a **Record** combobox appears | ⚠️ **Partly observed — FAIL** — `101` **was** discovered (`Record [101]`, `1 record discovered`), but the analysis never completed: the page stayed on `Analyzing default record…` for 5+ minutes (DEFECT-001) |
| A3 | Inspect the time-series caption | The overlay, the "Annotations: N in view" summary and the **Symbols:** legend offering the record's own distinct symbols | Blocked — never reached |

### B. Clickable legend

| # | Step | Expected observation | Result |
|---|---|---|---|
| B1 | Look at the legend | A group labelled "Symbol selection" with a "Symbols:" label and one toggle per distinct in-window symbol, ascending; **no** toggle pressed | Pending (human) |
| B2 | Press one toggle | That toggle is filled dark amber (`aria-pressed=true`); the overlay and the summary narrow to that symbol; **every** symbol is still offered | Pending (human) |
| B3 | Press a second toggle | **Both** toggles are pressed; the overlay shows the **union** of the two symbols; the summary count equals the two families' total | Pending (human) |
| B4 | Press the pressed toggles off, back to none | The empty selection shows **every** marker again ("All symbols"); no toggle is pressed | Pending (human) |

### C. Bounded annotation-list panel

| # | Step | Expected observation | Result |
|---|---|---|---|
| C1 | Look at the panel | A section "Annotations in view" whose rows read "Annotation: {symbol} · sample {i}" (plus " · {note}" when the note is non-empty), ascending by sample | Pending (human) |
| C2 | On the full-record window of `101` (~2,000 annotations) | The caption reads "Showing first 200 of <N> in view" and the row list **scrolls** (max-height ~9rem) instead of growing the page | Pending (human) |
| C3 | Zoom so the window holds only a few annotations | The caption reads "<n> in view" (no "Showing first …"), listing them all | Pending (human) |
| C4 | Zoom/pan to a window with no annotations | The caption reads "No annotations in view" and there are **no** rows | Pending (human) |
| C5 | Compare a row to the canvas | The row lists **exactly** the events drawn in the current window — the panel never names an undrawn marker | Pending (human) |

### D. Click-to-pin from a row

| # | Step | Expected observation | Result |
|---|---|---|---|
| D1 | Click a row | The figcaption detail line pins that row's own "Annotation: …" string; the row is filled dark amber (`aria-current=true`) | Pending (human) |
| D2 | Watch the viewport after D1 | **No** navigation is committed and the service is **not** re-invoked (the window is unchanged) | Pending (human) |
| D3 | Click the canvas on a marker | The **same** detail line pins that marker (one pin, two entry points) | Pending (human) |
| D4 | Pin a marker, then press a legend toggle that excludes its symbol | The pin drops and the detail returns to "Annotation: —" (the caption can never describe an undrawn marker) | Pending (human) |

### E. Regression sweep of the re-pointed Phase-15 interactions

| # | Step | Expected observation | Result |
|---|---|---|---|
| E1 | Rest the pointer on a marker | The detail line names that annotation's own symbol/sample/note; off every marker it returns to "Annotation: —" | Pending (human) |
| E2 | Press-and-drag across the plot | Exactly **one** window is committed and **no** marker is pinned (the drag/click split still holds) | Pending (human) |
| E3 | After a canvas pin, move the pointer off the canvas | The pinned detail survives pointer leave while the cursor readout goes idle | Pending (human) |
| E4 | Change channel (`MLII` → `V1`) with a selection active | The overlay, the legend's offered symbols, the summary and the panel rows all follow the new channel; the selection resolves against the new window's available symbols | Pending (human) |

### F. Console health

| # | Step | Expected observation | Result |
|---|---|---|---|
| F1 | Keep the console open through A–E | No uncaught errors and no `Not implemented` canvas noise | Pending (human) |
| F2 | Reload after ingesting and analyzing | The page boots cleanly; no worker is left running from the previous session | Pending (human) |

---

## Part 3 — Observation log (to be completed by a human)

Each row is a **blank, honestly-pending** slot. Record what was actually seen — including
any surprise. Do not pre-fill a "pass".

| Date | Browser / version | Section | Observed | Result | Notes |
|---|---|---|---|---|---|
| 2026-09-14 | user's browser (reported, not instrumented) | A — boot / ingest | `Record [101]` · `1 record discovered` · `Analyzing default record…`, then nothing for 5+ minutes; no signal rendered; no console error reported | ❌ Fail / blocked | DIAGNOSED 2026-09-14: [`DEFECT-001`](defect-001-worker-onmessage-delivery.md) — the worker `onmessage` delivery contract; routed to Phase 18 item 1 |
| | | B — clickable legend | | Pending | not reached (blocked by DEFECT-001) |
| | | B — clickable legend | | Pending | |
| | | C — bounded list panel | | Pending | |
| | | D — row click-to-pin | | Pending | |
| | | E — Phase-15 regression | | Pending | |
| | | F — console | | Pending | |

## If a defect surfaces

**Stop and report it.** Do **not** silently widen Phase 17: the phase is closed and green
at 61/750/167. A defect found here — a toggle that disagrees with the drawn set, a row that
pins a hidden event, a cap that leaks an unbounded count, or a selection that re-runs the
service — is a **finding to record and route as its own increment** (Debug mode first), not
a patch smuggled into this record.

**Outcome (2026-09-14).** This rule was exercised on the very first attempt. The defect is **not**
one of the Phase-17 control defects anticipated above — it is a **Phase-10 worker-channel** defect
that predates this phase and blocks it at the precondition — and it was recorded in
[`plans/defect-001-worker-onmessage-delivery.md`](defect-001-worker-onmessage-delivery.md) and
routed into **Phase 18 as its first item**. Phase 17 therefore stays closed at 61/750/167 and **no**
Phase-17 file was modified; this Part-2 pass is blocked, not failed, and is re-run once Phase 18
item 1 lands.

## How to re-run

```sh
# The hands-free confirmations (Part 1)
npm run check          # typecheck + svelte-check + lint + tests + build
npx vitest run realData # the opt-in real-data gates (dataset present here)

# The human pass (Part 2): open the served URL and work down the checklist
npm run dev
```

The manual pass is **never** part of `npm run check`. Its value is that a human confirmed
the live canvas, the pointer gestures and the new controls at real size — recorded as an
observation, so that "verified in a browser" is a claim with evidence rather than an
assumption.
