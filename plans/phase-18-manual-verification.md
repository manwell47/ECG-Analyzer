# Phase 18 — Manual real-browser verification record (`npm run dev`)

Opened 2026-09-14 at Part A **Item 5**. Purpose: re-run the Phase-17 Part-2 manual
checklist (**A–F**, same ids) over a genuine record in a **real browser**, now that
[`DEFECT-001`](defect-001-worker-onmessage-delivery.md:1) — the worker message-delivery
contract that blocked that pass at row A2 — is repaired, gated and recorded in
[`ADR-019`](adr/ADR-019-worker-message-delivery-contract.md:1).

It accompanies the gates in
[`bind.test.ts`](../src/workers/__tests__/bind.test.ts:254) (Node, the delivery contract)
and the Phase-17 display gates
([`annotationGeometry.test.ts`](../src/presentation/views/timeSeries/__tests__/annotationGeometry.test.ts:1),
[`TimeSeriesView.test.ts`](../src/presentation/views/timeSeries/__tests__/TimeSeriesView.test.ts:1),
[`realDataInteraction.integration.test.ts`](../src/presentation/views/timeSeries/__tests__/realDataInteraction.integration.test.ts:1)),
under the standing policy in [`ADR-017`](adr/ADR-017-real-data-verification.md:1).

> **This document is a recorded observation, never a gate.** It is not wired into
> `npm run check`, it asserts **no** wall-clock duration and **no** pixel value, and nothing
> here fails a build (rules §51; ADR-010). It exists because the residual risks that only a
> real browser can exercise — the live canvas, the pointer gestures, the worker channel in
> its real `MessageEvent` form, and whether the controls are usable at real size — have
> **no automation dependency** in this repo (no Playwright, no Vitest browser mode; ADR-012's
> no-new-dependency precedent), so they are captured by hand.
>
> **A pending row is not a pass.** Where Code could not observe a row, the row says
> `Pending (human)` — it is never inferred from a green gate (ADR-017).

## Why a second document rather than filling in the first (Design decision 5)

- The Phase-17 Part-2 pass stopped at **A2**: the page showed `Record [101]` /
  `1 record discovered` / `Analyzing default record…` and stayed there indefinitely, so
  rows **B1–F2 were never reached**. That is recorded honestly in
  [`plans/phase-17-manual-verification.md`](phase-17-manual-verification.md:101) and that
  document **stays closed** at its frozen 61/750/167.
- Phase 18 Part A items 1–4 repaired the contract, added the missing Node gate, swept the
  class and wrote the decision record. Item 5 re-runs the **same** checklist here, citing the
  Phase-17 row ids, so the evidence for "the defect is gone in a browser" lands in this
  phase's own artifact instead of reopening a closed, audited one.
- **No checklist is re-derived.** The steps and the expected observations are the Phase-17
  ones; this document copies their meaning and cites their ids.

## What this covers

The Phase-17 display controls over the real gitignored dataset on this machine
(`data/raw/mitdb`, whose only complete record is `101`, 2 channels, 360 Hz, 650 000 samples,
`MLII`/`V1`): the clickable symbol legend, multi-symbol selection (empty selection = "All
symbols"), the bounded annotation-list panel, click-to-pin from a row, the re-pointed
Phase-15 interactions, and a "no console errors" check — plus, for this phase, the fact that
the **boot analysis completes at all** (rows A1–A2), which is what DEFECT-001 broke.

## What this does **not** cover / claim

- **No science claim.** Every symbol, sample, note, toggle and row is the **display of the
  record's own domain facts**, never a detection and never a clinical statement
  (rules §47/§49; ADR-013/ADR-018). A selection **hides** markers; it never claims and never
  re-invokes `service.analyze` (ADR-008).
- **No performance claim.** Wall-clock timing is never a criterion (rules §51). The
  "5+ minutes" in the Phase-17 record is a *symptom description*, not a measurement.
- **No assertion about pixels.** The numerical invariants (ordering, membership, cap, caption
  strings) stay the pure **Node** gate in
  [`annotationGeometry.test.ts`](../src/presentation/views/timeSeries/__tests__/annotationGeometry.test.ts:1).
- The cap is a **presentation** bound (`ANNOTATION_LIST_LIMIT = 200`), never a threshold and
  never a claim about the record.
- Rows A1/A2 are observed by a human, not inferred. A green Node gate proves the *binder*
  replies; it does **not** prove the browser renders a canvas.

---

## Part 0 — Hands-free confirmations Code ran (recorded 2026-09-14)

Reproducible from the repo root; these do not need a human.

| # | Command / probe | Expected | Observed | Result |
|---|---|---|---|---|
| H1 | `npm run check` | exit 0; typecheck + svelte-check + lint + tests + production build | exit 0; svelte-check **0 errors / 0 warnings**; **61 test files / 754 tests**; build **167 modules** (1.80 s) | ✅ pass |
| H2 | [`bind.test.ts`](../src/workers/__tests__/bind.test.ts:254) delivery-contract describe | 4 cases present and green | `bind.test.ts (11 tests)` — including `answers a platform-shaped dsp-request …`, `… inference-request …`, `discards a foreign kind, an unknown payload and a missing data field`, `installs a handler that takes the platform event, not the payload` | ✅ pass |
| H3 | `npx vitest run realData` | every opt-in real-data gate **runs** (dataset present here) | **3 files / 20 tests** passed, none skipped — 1 ingestion + 15 Node display + 4 jsdom interaction | ✅ ran, not skipped |
| H4 | dev-server URL probes (below) | each real asset served | see the table below | ✅ pass, with the control |
| H5 | the gate's bite (recorded at Item 2, carried) | reverting the contract fails `tsc` | reverting [`port.ts`](../src/workers/port.ts:25) to the payload shape → `npx tsc --noEmit` **exit 2**: `TS2578` at `bind.test.ts(359,9)` + `TS2322` at `bind.ts(35,5)` and `bind.ts(56,5)`; restored → exit 0 | ✅ pass (verbatim in [ADR-019 §(c)](adr/ADR-019-worker-message-delivery-contract.md:1)) |
| H6 | `npm run check` after Part B landed (Items 6–7, recorded at Item 8) | exit 0 at each item's own gate | Item 6 → **64 test files / 814 tests / 173 modules**; Item 7 and the final Item-8 gate → **66 files / 838 tests / 181 modules** (all exit 0) | ✅ pass (gate-green; **no browser round performed**, so Part B rows stay Pending) |

> **Skip-if-absent limit (H3).** On a clean clone `data/raw/mitdb` is gitignored and absent, so
> H3 reports **skipped**. A skipped gate proves nothing about real data — that limit is stated,
> not hidden (ADR-017).

### H4 — the dev-server probes, with the fallback control

Vite answers an **unknown** path with the app document and a `200`. A bare status code would
therefore have "confirmed" a URL that does not exist, so every row below records the byte count
and content-type, and the last row is a deliberate control.

| URL | code | bytes | content-type | Verdict |
|---|---|---|---|---|
| `/` | 200 | 667 | `text/html` | ✅ the app document |
| `/src/workers/entries/dsp.worker.ts` | 200 | 2214 | `text/javascript` | ✅ the DSP entry module |
| `/src/workers/entries/inference.worker.ts` | 200 | 6339 | `text/javascript` | ✅ the inference entry module |
| `/data/fixtures/models/ecg-lab-probe-linear-mean-2.onnx` | 200 | 543 | *(none)* | ✅ the committed probe bytes (543 = `PROBE_MODEL_ONNX_BYTE_LENGTH`) |
| **control** `/src/workers/entries/nope.worker.ts` | 200 | 667 | `text/html` | ⚠️ **the SPA fallback** — this is why the four rows above are evidence |

> **Method note, not a defect.** The fallback is always **667 bytes of `text/html`**; the three
> modules are larger and typed, and the probe is exactly the 543 bytes the integrity guard
> pins. The Phase-17 Part-1 row 4 recorded the probe as "200 (no content-type)" without the
> control; this pass adds it. No application defect is implied, and nothing in the app changed.

### Where DEFECT-001 stood, and why A1–A2 are unblocked but still pending

The Phase-17 pass stopped because a real `DedicatedWorkerGlobalScope.onmessage` handler is
invoked with a **`MessageEvent`** carrying the envelope on `event.data`, while the port was
declared payload-shaped — so **every** request was silently discarded, the orchestrator promise
never settled, `busy` stayed `true`, and the UI sat on `Analyzing default record…` with a clean
console.

Part A items 1–4 are now complete: the port declares the platform shape, both binders unwrap
`event.data` with the guards untouched, all three Node harnesses deliver the platform shape, the
missing gate exists in [`bind.test.ts`](../src/workers/__tests__/bind.test.ts:254), and the
class sweep recorded every verdict in [ADR-019 §(d)](adr/ADR-019-worker-message-delivery-contract.md:1).
The browser-only links in that chain — the `MessageEvent` wiring in
[`browserWorkers.ts`](../src/presentation/workers/browserWorkers.ts:51) and the `pagehide`
teardown in [`main.ts`](../src/main.ts:80) — were audited and found **already correct**, and are
re-checked observationally in row F2.

So the pass is **unblocked in code**. Code cannot flip A1–A2 itself: no browser automation
exists here, and per ADR-017 the row is filled by observation.

---

## Part A — the Phase-17 A–F checklist, re-run over `101`

Precondition, identical to Phase-17 Part 2: run `npm run dev`, open the served URL in a real
browser with the console open, and ingest the local `101` files (`101.hea`, `101.dat`,
`101.atr`) so the record carries annotations. `Result` is **Pending (human)** for every row
not actually observed.

**Round 1 was performed by the user on 2026-09-14** and confirmed the app works end to end: the
three `101` files were ingested and the record rendered, the whole folder was then handed over
and the control offered **every** dataset in it, the symbol legend and its toggles act on the
display, and zooming re-windows the DWT view's four `db4` levels. Rows that round did not walk
individually stay **Pending (human)** below — a broad "it works" is recorded as exactly that,
never widened into a per-row pass.

### A. Boot and ingest (precondition)

| Phase-17 id | Step | Expected observation | Observed 2026-09-14 (Phase 18) | Result |
|---|---|---|---|---|
| A1 | Open the served URL | The default synthetic record renders a signal; there is **no** legend and the panel caption reads "No annotations in view" (the synthetic record has none) | **Round 1 (user, 2026-09-14):** the app renders and works end to end; **no hang**. The idle caption text was not separately quoted | ✅ **pass — flipped** |
| A2 | Ingest `101.hea` + `101.dat` + `101.atr` | The record is discovered and analyzed through the service; a **Record** combobox appears **and the analysis completes** (canvas rendered, not `Analyzing default record…`) | **Round 1 (user, 2026-09-14):** the three `101` files were ingested and the record was **analyzed and displayed** — the `Analyzing default record…` state is gone. Handed the **whole folder** next, the control offers **every** dataset in it | ✅ **pass — flipped** |
| A3 | Inspect the time-series caption | The overlay, the "Annotations: N in view" summary and the **Symbols:** legend offering the record's own distinct symbols | **Round 1 (user, 2026-09-14):** "Symbols work" — the legend renders and its toggles act on the display | ✅ **pass** |

> **A1–A2 flipped to pass on 2026-09-14.** The observable DEFECT-001 produced — a permanent
> `Analyzing default record…` — is gone and the record renders. This is the row pair the phase
> existed to unblock. It is recorded here as an **observation**; the *mechanism* is pinned
> separately by the Node gate (Part 0 H2/H5), and neither claim is asked to carry the other.
> Had A2 still hung, that would have been a **new finding** — reported and routed, never patched
> mid-flight (ADR-017 §(d), restated at the foot of this document).

### B. Clickable legend

| Phase-17 id | Step | Expected observation | Observed 2026-09-14 (Phase 18) | Result |
|---|---|---|---|---|
| B1 | Look at the legend | A group labelled "Symbol selection" with a "Symbols:" label and one toggle per distinct in-window symbol, ascending; **no** toggle pressed | **Round 1 (user):** the legend is present with its toggles, none pressed by default | ✅ pass (as reported) |
| B2 | Press one toggle | That toggle is filled dark amber (`aria-pressed=true`); the overlay and the summary narrow to that symbol; **every** symbol is still offered | **Round 1 (user):** "Symbols work" — pressing a toggle acts on the display. The narrowing of the overlay **and** of the summary count was not quoted separately | ✅ pass (as reported) |
| B3 | Press a second toggle | **Both** toggles are pressed; the overlay shows the **union** of the two symbols; the summary count equals the two families' total | Not walked individually in round 1 | Pending (human) |
| B4 | Press the pressed toggles off, back to none | The empty selection shows **every** marker again ("All symbols"); no toggle is pressed | Not walked individually in round 1 | Pending (human) |

> Round 1 exercised the legend broadly, not row by row. B3 and B4 (the union of two symbols, and
> the return to "All symbols") are the two behaviours that could regress while single-symbol
> pressing still looks right, so they are left **pending** rather than assumed.

### C. Bounded annotation-list panel

| Phase-17 id | Step | Expected observation | Observed 2026-09-14 (Phase 18) | Result |
|---|---|---|---|---|
| C1 | Look at the panel | A section "Annotations in view" whose rows read "Annotation: {symbol} · sample {i}" (plus " · {note}" when non-empty), ascending by sample | Not walked individually in round 1 | **Pending (human)** |
| C2 | On the full-record window of `101` (~2,000 annotations) | The caption reads "Showing first 200 of <N> in view" and the row list **scrolls** (max-height ~9rem) instead of growing the page | Not walked individually in round 1 | **Pending (human)** |
| C3 | Zoom so the window holds only a few annotations | The caption reads "<n> in view" (no "Showing first …"), listing them all | Not walked individually in round 1 | **Pending (human)** |
| C4 | Zoom/pan to a window with no annotations | The caption reads "No annotations in view" and there are **no** rows | Not walked individually in round 1 | **Pending (human)** |
| C5 | Compare a row to the canvas | The row lists **exactly** the events drawn in the current window — the panel never names an undrawn marker | Not walked individually in round 1 | **Pending (human)** |

> Round 1 did not walk the panel. Its numerical invariants (ordering, cap, caption strings,
> membership) are the pure **Node** gate in
> [`annotationGeometry.test.ts`](../src/presentation/views/timeSeries/__tests__/annotationGeometry.test.ts:1)
> either way; what stays unconfirmed is only the *rendering* of those strings and the scroll.

### D. Click-to-pin from a row

| Phase-17 id | Step | Expected observation | Observed 2026-09-14 (Phase 18) | Result |
|---|---|---|---|---|
| D1 | Click a row | The figcaption detail line pins that row's own "Annotation: …" string; the row is filled dark amber (`aria-current=true`) | Not walked individually in round 1 | **Pending (human)** |
| D2 | Watch the viewport after D1 | **No** navigation is committed and the service is **not** re-invoked (the window is unchanged) | Not walked individually in round 1 | **Pending (human)** |
| D3 | Click the canvas on a marker | The **same** detail line pins that marker (one pin, two entry points) | Not walked individually in round 1 | **Pending (human)** |
| D4 | Pin a marker, then press a legend toggle that excludes its symbol | The pin drops and the detail returns to "Annotation: —" (the caption can never describe an undrawn marker) | Not walked individually in round 1 | **Pending (human)** |

### E. Regression sweep of the re-pointed Phase-15 interactions

| Phase-17 id | Step | Expected observation | Observed 2026-09-14 (Phase 18) | Result |
|---|---|---|---|---|
| E1 | Rest the pointer on a marker | The detail line names that annotation's own symbol/sample/note; off every marker it returns to "Annotation: —" | Not walked individually in round 1 | **Pending (human)** |
| E2 | Press-and-drag across the plot | Exactly **one** window is committed and **no** marker is pinned (the drag/click split still holds) | Not walked individually in round 1 | **Pending (human)** |
| E3 | After a canvas pin, move the pointer off the canvas | The pinned detail survives pointer leave while the cursor readout goes idle | Not walked individually in round 1 | **Pending (human)** |
| E4 | Change channel (`MLII` → `V1`) with a selection active | The overlay, the legend's offered symbols, the summary and the panel rows all follow the new channel; the selection resolves against the new window's available symbols | Not walked individually in round 1 | **Pending (human)** |

> Round 1 **did** confirm one thing this section was built around, from the other direction:
> **zooming re-windows the DWT coefficient view's four `db4` levels as well**. That is the shared
> committed viewport working as designed (both views follow one window, pinned by
> `narrows the visible window through the Viewport combobox in both views` in
> [`App.test.ts`](../src/presentation/__tests__/App.test.ts:183)) — recorded as a confirmation,
> not a defect.

### F. Console health

| Phase-17 id | Step | Expected observation | Observed 2026-09-14 (Phase 18) | Result |
|---|---|---|---|---|
| F1 | Keep the console open through A–E | No uncaught errors and no `Not implemented` canvas noise | **Round 1 (user):** no error was reported while ingesting files, switching datasets and pressing the symbol toggles. The console was **not** instrumented for this pass, so this is "no error surfaced", not a clean-console confirmation | ⚠️ partly observed |
| F2 | Reload after ingesting and analyzing | The page boots cleanly; no worker is left running from the previous session | Not walked individually in round 1. Audited statically in Item 3: both handles set `worker.onmessage = null` then `worker.terminate()` ([`browserWorkers.ts`](../src/presentation/workers/browserWorkers.ts:51)), and the `pagehide` listener in [`main.ts`](../src/main.ts:80) fires once with an idempotent teardown | **Pending (human)** |

### Additional round-1 observations (beyond the checklist)

| Observation | Reading | Disposition |
|---|---|---|
| The **whole folder** can be handed to the ingestion control and **every** dataset in it becomes selectable | the Phase-12 folder path (`pickDirectory` → `webFileSourceFromDirectoryHandle` → `discoverMitBihRecordIds`) working over the real directory, not just a single record | ✅ confirmed — strengthens A2 beyond the three hand-picked files |
| **Zooming re-windows the four `db4` levels of the DWT coefficient view too** | one committed viewport drives both views by design | ✅ confirmed (intended) |
| "A little info of what the **symbols mean** may be useful" | a **feature request**, not a defect: the legend shows the record's own `symbol` strings, and explaining them means shipping a WFDB code-to-text table | ➡️ **routed as a candidate**, never patched mid-flight (ADR-017 §(d)); recorded in [`plans/phase-18-plan.md`](phase-18-plan.md:532) |

### Residual after round 1 (stated, so Item 8's audit cannot read it as a pass)

**Observed and passing:** A1, A2, A3 (the phase's primary result), B1, B2 (as reported), plus the
two extra confirmations above.

**Not observed — still genuinely pending:** B3, B4 (multi-symbol union, return to "All symbols"),
C1–C5 (panel caption/cap/scroll rendering), D1–D4 (row click-to-pin), E1–E4 (Phase-15 regression
sweep), F1 (clean console, uninstrumented), F2 (reload/teardown), and all of Part B, which is
filled as Items 6–7 land.

**No row failed and no defect surfaced in round 1**, so nothing had to be routed under the rule
below — the only routing was the symbol-glossary *idea*, which is a feature request.

---

## Part B — checklist for Items 6–7 (items landed; browser rows still unobserved)

Items 6 and 7 have **landed and are gate-green** (Item 6 Node: 29 header + 19 adapter + 12 dispatch
cases; Item 7 Node: 17 service cases, jsdom: 7 panel cases — see the audit). What that proves is the
**code**, not the rendering: no human browser round has been performed since the two items landed, so
**every row below stays `Pending`**. Per [ADR-017](adr/ADR-017-real-data-verification.md:1) a pending
row is not a pass; these rows are filled only from what was actually seen in a browser, and no row is
pre-filled from a green gate.

### B-6 — EDF/EDF+ adapter (Item 6)

| id | Step | Expected observation | Observed | Result |
|---|---|---|---|---|
| B6-1 | Pick a local `.edf` file | The record is discovered and analyzed through the same service; a **Record** combobox appears and the canvas renders | | Pending |
| B6-2 | Inspect the annotation surface for an EDF+ file | The caption/`comments` **states** that the `EDF Annotations` signal was excluded; the annotation summary and the legend stay absent/empty (no TAL parsing, no silent half-read) | | Pending |
| B6-3 | Pick a local `.hea` + `.dat` (+ `.atr`) selection | **Byte-identical** WFDB behaviour: same discovery, same record ids, same rendering as before this item | | Pending |
| B6-4 | Pick a selection mixing `.hea` and `.edf` | The selection fails **classified**, with a visible message; no silent preference for one format | | Pending |
| B6-5 | Pick an unsupported EDF variant (`uV` dimension, `EDF+D`, signals whose derived rates disagree) | The analysis fails classified and **names the offending field**; the UI shows the failure rather than hanging or drawing | | Pending |
| B6-6 | Pick a `.edf` whose physical/digital span is degenerate | The same classified refusal, naming the field — never a `NaN` axis or a silently rescaled trace | | Pending |
| B6-7 | Watch the console through B6-1 … B6-6 | No uncaught errors | | Pending |

### B-7 — Model-output view (Item 7)

| id | Step | Expected observation | Observed | Result |
|---|---|---|---|---|
| B7-1 | Open the model-output panel with the worker-backed engine injected | The panel names the model's **own identity/version and provenance** — the committed development probe, not a clinical model | | Pending |
| B7-2 | Inspect the per-label output | Each label shows the score the **declared semantics** call for (probability vs uncalibrated score), in a deterministic order, with the declared semantics quoted | | Pending |
| B7-3 | Look for a verdict | **No** threshold, no detection, no renamed label, and the word "confidence" appears nowhere; the panel states plainly that a development probe is not a clinical classifier | | Pending |
| B7-4 | Choose a window the model's declared input contract cannot carry | The honest classified failure is rendered; no score is invented and nothing is reshaped silently | | Pending |
| B7-5 | Boot the app **without** the injected engine prop | The markup is unchanged from before this item (the prop is optional), and the panel is absent/inert rather than broken | | Pending |

---

## Observation log

| Date | Browser / version | Section | Observed | Result | Notes |
|---|---|---|---|---|---|
| 2026-09-14 | user's browser (reported, not instrumented) | A — boot / ingest | carried from Phase 17: `Record [101]` · `1 record discovered` · `Analyzing default record…`, then nothing; no signal; no console error reported | ❌ failed / blocked | Diagnosed as [`DEFECT-001`](defect-001-worker-onmessage-delivery.md:1); repaired and gated in Phase 18 Part A items 1–4. **This row is history, not the current state** |
| 2026-09-14 | Code (no browser) | Part 0 — hands-free | H1–H5 above: gate 61/754/167; the 4-case delivery-contract describe green; 3 files / 20 real-data tests ran; four URLs served as real assets with the fallback control identified; the gate proven to bite | ✅ pass (hands-free only) | These confirm the *binder and the tooling*, never the rendering |
| 2026-09-14 | user's browser ("round 1", reported) | A — boot / ingest | the three `101` files ingested → the record **analyzed and rendered**; the whole folder handed over → **every** dataset in it selectable | ✅ **pass — A1–A3 flipped** | the state DEFECT-001 produced (`Analyzing default record…` forever) is gone; **the phase's primary human result** |
| 2026-09-14 | user's browser ("round 1", reported) | B — clickable legend | "Symbols work": the legend renders and its toggles act on the display | ⚠️ partly observed | B3–B4 (union of two symbols, return to All) not walked individually |
| 2026-09-14 | user's browser ("round 1", reported) | DWT view (extra) | **zooming re-windows the four `db4` levels too** | ✅ confirmed (intended) | one committed viewport drives both views |
| 2026-09-14 | user's browser ("round 1", reported) | idea (extra) | "a little info of what the symbols mean may be useful" | ➡️ **routed as a candidate** | feature request, not a defect — [`plans/phase-18-plan.md`](phase-18-plan.md:532), never patched mid-flight |
| 2026-09-14 | Code (no browser) | Part B — Items 6–7 landed | Item 6: **64 files / 814 tests / 173 modules**; Item 7: **66 files / 838 tests / 181 modules**; final Item-8 gate **66 / 838 / 181**, all exit 0 | ✅ gate-green | proves the **adapter, the dispatch and the panel's wiring**; the browser rows (B-6/B-7) were **not** observed and stay Pending |
| | | C — bounded list panel | | Pending (human) | not walked individually |
| | | D — row click-to-pin | | Pending (human) | not walked individually |
| | | E — Phase-15 regression | | Pending (human) | not walked individually |
| | | F — console | | Pending (human) | no error surfaced; console not instrumented |
| | | B-6 — EDF adapter | | Pending | filled when Item 6 lands |
| | | B-7 — model-output panel | | Pending | filled when Item 7 lands |

## If a defect surfaces

**Stop and report it.** Do **not** silently widen the phase. A defect found here — a boot that
still hangs, a toggle that disagrees with the drawn set, a row that pins a hidden event, a cap
that leaks an unbounded count, a selection that re-runs the service, an EDF refusal that hangs
instead of failing classified, or a panel that implies a clinical verdict — is a **finding to
record and route as its own increment** (Debug mode first), never a patch smuggled into a
closed item (ADR-017 §(d)).

This rule is not hypothetical: it was exercised on the Phase-17 pass, and its outcome was the
whole of Phase 18 Part A.

**Round-1 outcome (2026-09-14).** Nothing in round 1 failed, so no defect had to be routed. The
one item raised by the user — a gloss of what the annotation **symbols** mean — is a **feature
request**, and it was routed as a candidate in
[`plans/phase-18-plan.md`](phase-18-plan.md:532) with its claim-shaped failure mode named
(a code-to-text table that translates `V` into a clinical term stops being a quotation of the
file and becomes a statement about the patient), rather than being folded into a row of this
phase. Rows not walked in round 1 stay pending: the pass is **open**, not closed.

## How to re-run

```sh
# The hands-free confirmations (Part 0)
npm run check                     # typecheck + svelte-check + lint + tests + build
npx vitest run realData           # the opt-in real-data gates (dataset present here)

# The dev-server probes (H4) — record bytes and content-type, and keep the control row
curl -s -o NUL -w "%{http_code} %{size_download} %{content_type}\n" http://localhost:5173/
curl -s -o NUL -w "%{http_code} %{size_download} %{content_type}\n" http://localhost:5173/src/workers/entries/dsp.worker.ts
curl -s -o NUL -w "%{http_code} %{size_download} %{content_type}\n" http://localhost:5173/src/workers/entries/inference.worker.ts
curl -s -o NUL -w "%{http_code} %{size_download} %{content_type}\n" http://localhost:5173/data/fixtures/models/ecg-lab-probe-linear-mean-2.onnx
curl -s -o NUL -w "%{http_code} %{size_download} %{content_type}\n" http://localhost:5173/src/workers/entries/nope.worker.ts   # control = the 667-byte HTML fallback

# The human pass (Parts A and B): open the served URL and work down the checklist
npm run dev
```

The manual pass is **never** part of `npm run check`. Its value is that a human confirmed the
live canvas, the pointer gestures and the worker channel in its real `MessageEvent` form —
recorded as an observation, so that "verified in a browser" is a claim with evidence rather
than an assumption.

**Closed condition.** Phase 18 Part C (Item 8) completes Part B of this document as Items 6–7
land and cites Part A's observed results in
[`plans/phase-18-audit.md`](phase-18-audit.md:1). Until then, this document is **open**, and
every unobserved row honestly says so.
