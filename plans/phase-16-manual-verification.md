# Phase 16 — Manual real-browser verification record (`npm run dev`)

Recorded 2026-09-13. Purpose: the honest, reproducible **observation record** for
Phase 16's "real-browser" half (Candidate 1). It accompanies the opt-in real-data
gates in
[`realDataDisplay.integration.test.ts`](../src/presentation/views/timeSeries/__tests__/realDataDisplay.integration.test.ts:1)
(Node) and
[`realDataInteraction.integration.test.ts`](../src/presentation/views/timeSeries/__tests__/realDataInteraction.integration.test.ts:1)
(jsdom), and the standing policy pinned in
[`ADR-017`](adr/ADR-017-real-data-verification.md:1).

> **This document is a recorded observation, never a gate.** It is not wired into
> `npm run check`, it asserts **no** wall-clock duration and **no** pixel value,
> and nothing here fails a build (rules §51; ADR-010). It exists because the
> residual risks that only a real browser can exercise — local ingestion, the
> live canvas, the pointer gestures — have **no automation dependency** in this
> repo (no Playwright / Vitest browser mode; ADR-012's no-new-dependency
> precedent), so they are captured by hand.

## What this covers

Both ingestion paths and every **display** interaction added in Phases 12–15,
over the real gitignored dataset on this machine (`data/raw/mitdb`, whose only
complete record is `101`, 2 channels, 360 Hz, 650 000 samples, `MLII`/`V1`):

- the default synthetic boot record and both canvases;
- the portable file-input / drag-drop ingestion **and** the Chromium-only
  directory picker;
- record switching and re-analysis;
- channel and viewport selection, including the "Custom (zoomed)" option;
- navigation (zoom / pan / reset and drag-to-select a window);
- the cursor readout, the hover annotation detail, the symbol filter and the
  bounded click-to-pin;
- a "no console errors" check.

## What this does **not** cover / claim

- No science claim. Every marker, legend, readout and filter is the **display of
  the record's own domain facts**, never a detection and never a clinical
  statement (rules §47/§49; ADR-013). This record says nothing about model
  quality or physiological meaning (ADR-009).
- No performance claim. Wall-clock timing is never a criterion (rules §51).
- No assertion about pixels. The observation is of the rendered result a human
  sees; the numerical invariants stay the pure **Node** gate.

---

## Part 1 — Automated confirmations Code can make (recorded)

These are reproducible from the repo root and do **not** need a human. They were
captured on 2026-09-13 (win32 x64, Windows 11, Node v24.18.0, Vite v6.4.3).

| # | Command / probe | Expected | Observed (2026-09-13) | Result |
|---|---|---|---|---|
| 1 | `npm run check` | exit 0; typecheck + svelte-check (0/0) + lint + tests + production build | exit 0; **61 test files / 712 tests**, build **167 modules** | ✅ pass |
| 2 | `npm run dev`, then `GET /` | the dev server serves `index.html` | Vite ready in 680 ms; `http://localhost:5173/` → **200** `[text/html]` | ✅ pass |
| 3 | `GET /src/workers/entries/dsp.worker.ts` | the DSP worker module resolves | → **200** `[text/javascript]` | ✅ pass |
| 4 | `GET /src/workers/entries/inference.worker.ts` | the inference worker module resolves | → **200** `[text/javascript]` | ✅ pass |
| 5 | `GET /data/fixtures/models/ecg-lab-probe-linear-mean-2.onnx` | the probe `.onnx` asset resolves | → **200** | ✅ pass |
| 6 | opt-in real-data **Node** display gate | 15 cases **run** (dataset present here) | `realDataDisplay.integration.test.ts (15 tests)` — ran, not skipped | ✅ pass |
| 7 | opt-in real-data **jsdom** interaction slice | 4 cases **run** (dataset present here) | `realDataInteraction.integration.test.ts (4 tests)` — ran, not skipped | ✅ pass |

Probes 2–5 were a self-contained smoke: the dev server was started, the four URLs
requested, and the process tree terminated afterwards. They prove the dev server
**serves** the entry document and **resolves** the worker and model assets; they
do **not** prove the interactive behaviour below, which is Part 2.

> **Skip-if-absent limit.** On a clean clone `data/raw/mitdb` is gitignored and
> absent, so probes 6–7 report **skipped**. A skipped gate **proves nothing**
> about real data — that limit is stated, not hidden (ADR-017).

---

## Part 2 — Manual browser checklist (human, pending)

Run `npm run dev`, open the served URL in a real browser, and work down the list.
`Result` starts **Pending (human)** for every interactive step; a human completes
it with the browser, the console open, and — for the ingestion steps — the local
`data/raw/mitdb` files (`101.hea`, `101.dat`, `101.atr`).

### A. Boot and default record

| # | Step | Expected observation | Result |
|---|---|---|---|
| A1 | Open the served URL | Header "ECG Signal Processing & AI Analysis Laboratory"; the default synthetic record's identity is shown | Pending (human) |
| A2 | Look at both canvases | "Time-series view (signal)" and "DWT coefficient view" each render a trace; the time-series caption names the channel, unit, sample rate, sample count and window | Pending (human) |
| A3 | Press "Re-run analysis" | The same identity and the same rendered coefficients come back (a display refresh, not a new detection) | Pending (human) |

### B. Ingestion path 1 — file input / drag-and-drop (portable)

| # | Step | Expected observation | Result |
|---|---|---|---|
| B1 | Use "Open local WFDB files" and select `101.hea` + `101.dat` (+ `101.atr`) | The record is discovered and analyzed; a **Record** combobox appears | Pending (human) |
| B2 | Repeat by dragging the same files onto the "Drop WFDB files here" zone | Same outcome as B1 | Pending (human) |
| B3 | Select a selection with no `.hea` | The message "No WFDB records (.hea files) were found in the selection." is shown; no crash | Pending (human) |

### C. Ingestion path 2 — directory picker (Chromium-only)

| # | Step | Expected observation | Result |
|---|---|---|---|
| C1 | In a Chromium browser, click "Open folder" and choose `data/raw/mitdb` | The complete record is discovered and analyzed | Pending (human) |
| C2 | In a non-Chromium browser | The "Open folder" button is not offered; the portable file input (B) still works | Pending (human) |

### D. Record switching and the annotation overlay

| # | Step | Expected observation | Result |
|---|---|---|---|
| D1 | Switch records through the **Record** combobox | The newly chosen record is analyzed; the identity, both canvases and the captions update | Pending (human) |
| D2 | Inspect the time-series caption for an annotated record | "Annotations: N in view" (or "(M merged)" when the density cap collapses a column) and "Symbols: …" reflecting the record's **own** annotations | Pending (human) |
| D3 | Switch to a record with no annotations (if available) | "Annotations: none" and no symbol legend/filter; no error | Pending (human) |

### E. Channel and viewport selection

| # | Step | Expected observation | Result |
|---|---|---|---|
| E1 | Change the **Channel** combobox (e.g. `MLII` → `V1`) | The time-series trace, its channel/unit caption, the DWT view and the annotation overlay all follow the new channel | Pending (human) |
| E2 | Change the **Viewport** combobox through the base presets | The window narrows to each preset; the "t = a → b s" caption follows | Pending (human) |
| E3 | Return the **Viewport** combobox to "Full record" | The whole acquisition window is restored | Pending (human) |

### F. Navigation (zoom / pan / reset / drag)

| # | Step | Expected observation | Result |
|---|---|---|---|
| F1 | Press "Zoom in" | The window becomes strictly narrower and stays inside the record; the "Viewport" combobox gains and selects a **"Custom (zoomed)"** option | Pending (human) |
| F2 | Press "Zoom out" repeatedly | The window grows back toward the full record and never overshoots past it | Pending (human) |
| F3 | Press "Pan left" / "Pan right" | The window slides without changing its duration; it sticks at each record edge instead of sliding off | Pending (human) |
| F4 | Drag across the plot (press, move, release) | Exactly one new window covering the dragged span is committed; the drag commits **no** science and calls **no** service | Pending (human) |
| F5 | Press "Reset view" | The window returns to exactly the full record; the "Custom (zoomed)" option is cleared | Pending (human) |
| F6 | Navigate, then switch records (D1) | The custom zoom is cleared for the newly analyzed record | Pending (human) |

### G. Cursor readout

| # | Step | Expected observation | Result |
|---|---|---|---|
| G1 | Move the pointer across the plot | The readout shows the time (two decimals) and the sample index (a middle dot); it follows the **window**, not the record | Pending (human) |
| G2 | Move the pointer off the canvas | The readout returns to its idle placeholder | Pending (human) |
| G3 | Rest the pointer on a visible marker | The readout additionally names that annotation's own **symbol** (never a detection) | Pending (human) |

### H. Hover annotation detail

| # | Step | Expected observation | Result |
|---|---|---|---|
| H1 | Before pointing at a marker | The detail line reads the idle label "Annotation: —" | Pending (human) |
| H2 | Rest the pointer on a marker | The detail line names that annotation's own `symbol`, its `sample` index and its `auxNote` (e.g. "Annotation: N · sample 12 · …") | Pending (human) |
| H3 | Move the pointer clear of every marker | The detail line returns to "Annotation: —" | Pending (human) |

### I. Symbol filter

| # | Step | Expected observation | Result |
|---|---|---|---|
| I1 | Open the **Symbol filter** select | It offers "All symbols" plus the window's **distinct** symbols, ascending | Pending (human) |
| I2 | Choose one symbol | The overlay, the "Annotations: N in view" summary and the "Symbols: …" legend narrow to that symbol; every option (including "All symbols") is still offered | Pending (human) |
| I3 | Reset to "All symbols" | The whole window is shown again | Pending (human) |
| I4 | Choose a symbol, then zoom so it leaves the window | The filter falls back to "All symbols" with no effect and no error | Pending (human) |

### J. Bounded click-to-pin

| # | Step | Expected observation | Result |
|---|---|---|---|
| J1 | Click a marker (press and release at one point) | The detail line pins that marker's own symbol/sample/note and commits **no** window | Pending (human) |
| J2 | Move the pointer off the canvas after J1 | The pinned detail survives pointer leave (the cursor readout itself goes idle) | Pending (human) |
| J3 | Click clear of every marker | The pin clears and the detail returns to "Annotation: —" | Pending (human) |
| J4 | Pin a marker, then choose a symbol filter that excludes it | The pinned detail drops (the caption can never describe an undrawn marker) | Pending (human) |
| J5 | Press-and-drag (a real drag) | One window is committed (F4) and no marker is pinned | Pending (human) |

### K. Console health

| # | Step | Expected observation | Result |
|---|---|---|---|
| K1 | Keep the browser console open through steps A–J | No uncaught errors and no `Not implemented` canvas noise | Pending (human) |
| K2 | Reload the page after ingesting and analyzing | The page boots cleanly; no worker is left running from the previous session | Pending (human) |

---

## Part 3 — Observation log (to be completed by a human)

Each row is a **blank, honestly-pending** slot. Record what was actually seen —
including any surprise. Do not pre-fill a "pass".

| Date | Browser / version | Section | Observed | Result | Notes |
|---|---|---|---|---|---|
| | | A — boot | | Pending | |
| | | B — file input / drag-drop | | Pending | |
| | | C — directory picker | | Pending | |
| | | D — record switch / overlay | | Pending | |
| | | E — channel / viewport | | Pending | |
| | | F — navigation | | Pending | |
| | | G — cursor readout | | Pending | |
| | | H — hover detail | | Pending | |
| | | I — symbol filter | | Pending | |
| | | J — click-to-pin | | Pending | |
| | | K — console | | Pending | |

## If a defect surfaces

**Stop and report it.** Do **not** silently widen Phase 16 into a production fix
(Reminder 8): this phase is tests-and-docs only and touches no display helper, no
view and no configuration. A defect found here is a finding to record and route
as its own increment, not a patch smuggled into this one.

## How to re-run

```sh
# The hands-free confirmations (Part 1)
npm run check          # typecheck + svelte-check + lint + tests + build
npm run dev            # then GET / and the worker/.onnx URLs as in the probe table

# The human pass (Part 2): open the served URL and work down the checklist
npm run dev
```

The manual pass is **never** part of `npm run check`. Its value is that a human
confirmed the live canvas, the pointer gestures and the local ingestion that no
committed test can reach — recorded as an observation, so that "verified in a
browser" is a claim with evidence rather than an assumption.
