# Phase 18 Audit / Completion — Worker-channel correctness, then two folded-in increments (EDF/EDF+ adapter + model-output view)

Recorded 2026-09-14 (Code-mode completion record). Verdict: **Phase 18 implemented and fully
green.** The full `npm run check` gate passed at the end of every item that changed code and
again as the final gate: typecheck ✓, svelte-check (**0 errors / 0 warnings**) ✓, lint ✓,
**66 test files / 838 tests** ✓, Vite build ✓ (**181 modules**).

The phase is a single increment in **three parts**, in the order the plan fixed:

- **Part A (Items 0–5) — defect-driven hardening.** The fix for
  [`DEFECT-001`](defect-001-worker-onmessage-delivery.md:1), the missing delivery-contract gate,
  the class sweep, the decision record, and the re-run of the Phase-17 real-browser manual pass.
- **Part B (Items 6–7) — the two folded-in increments**, approved by the user on 2026-09-14: a
  second, non-WFDB dataset adapter (EDF/EDF+) and a view that displays the model's own output.
- **Part C (Item 8) — audit and close-out** for all three parts.

**Part A changes no science.** It restores the transport the Phase-10/[ADR-011](adr/ADR-011-worker-execution-model.md:1)
worker model always assumed: one line per binder (unwrap `event.data`), one corrected interface,
one new Node gate, one class sweep, one ADR, one manual pass. No domain, DSP/DWT, ML, parser,
adapter, application-service or presentation file changed. The hang was a **correctness** failure
(never answered), not a performance one — no wall-clock or pixel assertion exists anywhere in the
phase (rules §51; [ADR-010](adr/ADR-010-performance-measurement-policy.md:1)).

**Part B carries no science either.** Item 6 adds **one** adapter that ends at the canonical record
shape through the *same* single ADC→mV step ([`recordToMillivoltSignal`](../src/datasets/load.ts:35),
[ADR-006](adr/ADR-006-dataset-abstraction.md:1)); Item 7 adds **one** view that renders what a model
already declares and outputs. Neither adds a threshold, a detection, a new DSP/DWT stage, a new
model semantic or a renamed label ([ADR-004](adr/ADR-004-onnx-runtime-contract.md:1),
[ADR-013](adr/ADR-013-annotation-display.md:1), rules §47/§49).

## Scope / approved increment (verbatim)

The two approvals, both 2026-09-14, both recorded in [`plans/phase-18-plan.md`](phase-18-plan.md:20):

> "Do not change code yet — record the defect report in the plan docs, and plan Phase 18 (which then
> absorbs this fix as its first item) in Architect mode."

> "Revise the plan first: also fold the second dataset adapter (and/or wiring a view to
> WorkerInferenceEngine) into Phase 18 as later items."

The first approval fixed Part A's shape and its first item. The second **revised** it, promoting the
two candidates into approved scope as Items 6 and 7 — **after** every hardening item, never
interleaved. Part A was **blocking**: until Item 1 landed the application rendered nothing in a real
browser, so no Part B observation was possible by hand and no Part B item could start. That order
was executed as written.

## Files added

| Part | Item | Purpose | File | Kind |
|---|---|---|---|---|
| A | 4 | ADR-019: the worker message-delivery contract | [`plans/adr/ADR-019-worker-message-delivery-contract.md`](adr/ADR-019-worker-message-delivery-contract.md:1) | docs |
| A | 5 | Phase-18 real-browser manual pass (Parts 0/A/B) | [`plans/phase-18-manual-verification.md`](phase-18-manual-verification.md:1) | docs |
| B | 6 | EDF/EDF+ fixed-header parser | [`src/datasets/edf/header.ts`](../src/datasets/edf/header.ts:1) | src |
| B | 6 | Declared-range calibration derivation | [`src/datasets/edf/calibration.ts`](../src/datasets/edf/calibration.ts:1) | src |
| B | 6 | Little-endian data-record decoder | [`src/datasets/edf/decode.ts`](../src/datasets/edf/decode.ts:1) | src |
| B | 6 | The second `DatasetAdapter` | [`src/datasets/edf/adapter.ts`](../src/datasets/edf/adapter.ts:1) | src |
| B | 6 | Browser-safe EDF barrel | [`src/datasets/edf/index.ts`](../src/datasets/edf/index.ts:1) | src |
| B | 6 | Pure extension-keyed format dispatch | [`src/datasets/dispatch.ts`](../src/datasets/dispatch.ts:1) | src |
| B | 6 | EDF header gate | [`src/datasets/edf/__tests__/header.test.ts`](../src/datasets/edf/__tests__/header.test.ts:1) | test |
| B | 6 | EDF adapter gate | [`src/datasets/edf/__tests__/adapter.test.ts`](../src/datasets/edf/__tests__/adapter.test.ts:1) | test |
| B | 6 | Hermetic EDF fixture builder (independent of the parser) | [`src/datasets/edf/__tests__/support.ts`](../src/datasets/edf/__tests__/support.ts:1) | test |
| B | 6 | Format-dispatch gate | [`src/datasets/__tests__/dispatch.test.ts`](../src/datasets/__tests__/dispatch.test.ts:1) | test |
| B | 6 | ADR-020: the EDF adapter and its refusals | [`plans/adr/ADR-020-edf-adapter-refusals.md`](adr/ADR-020-edf-adapter-refusals.md:1) | docs |
| B | 7 | The model-output application service | [`src/application/inference.ts`](../src/application/inference.ts:1) | src |
| B | 7 | Service gate (Node) | [`src/application/__tests__/inference.test.ts`](../src/application/__tests__/inference.test.ts:1) | test |
| B | 7 | Display-only panel | [`src/presentation/views/inference/ModelOutputPanel.svelte`](../src/presentation/views/inference/ModelOutputPanel.svelte:1) | src |
| B | 7 | Panel gate (jsdom) | [`src/presentation/views/inference/__tests__/ModelOutputPanel.test.ts`](../src/presentation/views/inference/__tests__/ModelOutputPanel.test.ts:1) | test |
| B | 7 | ADR-021: the model-output display rule | [`plans/adr/ADR-021-model-output-display-rule.md`](adr/ADR-021-model-output-display-rule.md:1) | docs |
| C | 8 | Phase 18 audit (this record) | [`plans/phase-18-audit.md`](phase-18-audit.md:1) | docs |
| C | 8 | Phase 18 checkpoint (resumable state) | [`plans/phase-18-checkpoint.md`](phase-18-checkpoint.md:1) | docs |

Item 0 added a **throwaway probe outside `src/`** and deleted it in the same item; no unapproved
file survives (recorded below).

## Files touched

### Part A (Items 1–2 only; Items 3–5 are docs-only)

- [`src/workers/port.ts`](../src/workers/port.ts:25) — `WorkerPort.onmessage` corrected to the
  platform's shape, `(event: { readonly data: unknown }) => void` ([line 33](../src/workers/port.ts:33)),
  and its comment rewritten to state that a fake **must model the platform's delivery**.
- [`src/workers/bind.ts`](../src/workers/bind.ts:34) — [`bindDspCore`](../src/workers/bind.ts:34) and
  [`bindInferenceCore`](../src/workers/bind.ts:55) unwrap `event.data` once and apply the **existing**
  guards unchanged. One added line per binder; detach still sets `onmessage = null`.
- [`src/workers/__tests__/bind.test.ts`](../src/workers/__tests__/bind.test.ts:1) — the shared
  `PortHarness.receive`/`deliver()` helper now wraps every inbound envelope as the platform does
  (Item 1), plus the new `worker-side delivery contract` describe (Item 2,
  [line 254](../src/workers/__tests__/bind.test.ts:254)).
- [`src/application/__tests__/workerAnalysis.parity.test.ts`](../src/application/__tests__/workerAnalysis.parity.test.ts:56)
  — the loopback now delivers `{ data: message }`.
- [`src/bench/worker.bench.ts`](../src/bench/worker.bench.ts:109) — same alignment for measurement;
  the loopback performs no structured clone, so measured numbers are unaffected.
- [`plans/ecg-lab-architecture.md`](ecg-lab-architecture.md:278) — a §I worker bullet
  ([line 278](ecg-lab-architecture.md:278)), a §M **item 18** ([line 352](ecg-lab-architecture.md:352))
  and the decision-register entry ([line 417](ecg-lab-architecture.md:417)).

### Part B — Item 6

- [`src/datasets/index.ts`](../src/datasets/index.ts:26) — export the `./edf` and `./dispatch` barrels
  (the barrel already omits the Node-only `nodeSource`).
- [`src/presentation/dataset/browserDatasetService.ts`](../src/presentation/dataset/browserDatasetService.ts:50)
  — [`createBrowserDatasetService`](../src/presentation/dataset/browserDatasetService.ts:50) takes a
  **required** `format`; [`prepareBrowserDataset`](../src/presentation/dataset/browserDatasetService.ts:76)
  delegates detection to the pure dispatch.
- [`src/presentation/dataset/fileIngestion.ts`](../src/presentation/dataset/fileIngestion.ts:82) — both
  ingestion funnels resolve format + ids through
  [`prepareDatasetSource`](../src/datasets/dispatch.ts:117) and now **throw** the classified
  `unsupported-format` for a mixed/unrecognised selection instead of returning an empty list.
- [`src/main.ts`](../src/main.ts:50) — `prepareFrom` forwards the detected `format`.
- [`plans/ecg-lab-architecture.md`](ecg-lab-architecture.md:296) — a §J bullet
  ([line 296](ecg-lab-architecture.md:296)), the §M item 18 line and the register entry
  ([line 419](ecg-lab-architecture.md:419)).

### Part B — Item 7

- [`src/application/inference.ts`](../src/application/inference.ts:1) — new service, but its
  **domain relocation** touched [`src/domain/sampling.ts`](../src/domain/sampling.ts:142):
  [`TimeSpan`](../src/domain/sampling.ts:142), [`SampleWindow`](../src/domain/sampling.ts:150) and
  [`sampleWindowOfTime`](../src/domain/sampling.ts:170) were **moved** (not copied) out of the view.
- [`src/presentation/views/timeSeries/geometry.ts`](../src/presentation/views/timeSeries/geometry.ts:34)
  — re-exports both names, so every existing import path and the unedited sampling/geometry tests
  stay green.
- [`src/presentation/App.svelte`](../src/presentation/App.svelte:109) — one **optional** `modelOutput`
  prop ([line 109](../src/presentation/App.svelte:109)) and one conditional block
  ([line 542](../src/presentation/App.svelte:542)); absent, the markup is unchanged.
- [`src/main.ts`](../src/main.ts:74) — [`boot()`](../src/main.ts:74) constructs
  `new ModelOutputService(inference.engine, PROBE_MODEL_METADATA)`
  ([line 89](../src/main.ts:89)) over the same worker handle it already terminates on `pagehide`.
- [`plans/ecg-lab-architecture.md`](ecg-lab-architecture.md:279) — a §I bullet
  ([line 279](ecg-lab-architecture.md:279)), the §M item 18 line and the register entry
  ([line 421](ecg-lab-architecture.md:421)).

## Not touched (by design)

- **Science:** all of `src/dsp/**` and every existing ML semantic — the engine contract
  ([`InferenceEngine`](../src/ml/engine.ts:23)), the input constructor
  ([`buildModelInput`](../src/ml/input.ts:61)), the compatibility rule
  ([`describeInputCompatibilityProblems`](../src/ml/engine.ts:101)) and
  [`interpretPrediction`](../src/ml/interpret.ts:73) are consumed unchanged.
- **Existing adapters and the single ADC→mV step:** `src/datasets/mitbih/**`,
  `src/datasets/synthetic/**`, `src/datasets/load.ts`, `src/datasets/source.ts` (read-only seams)
  and `src/datasets/format212`/`atr` are unmodified.
- **The executor and assembly path:** [`src/application/analysis.ts`](../src/application/analysis.ts:1)
  and [`src/application/dspExecutor.ts`](../src/application/dspExecutor.ts:1) are correct — they
  merely awaited a reply that never came.
- **Worker entries:** [`src/workers/entries/dsp.worker.ts`](../src/workers/entries/dsp.worker.ts:1)
  and [`src/workers/entries/inference.worker.ts`](../src/workers/entries/inference.worker.ts:1) are
  **unchanged**, as the plan required; the `self as unknown as WorkerPort` cast is a documented
  lib-shim on a surface that is now *true*.
- **Existing views:** `TimeSeriesView.svelte`, `DwtCoefficientView.svelte`, `ViewControls.svelte`
  and their helpers are unchanged; Part B adds a new view rather than re-purposing one.
- **Configuration:** [`package.json`](../package.json:1), `tsconfig.json`, `vitest.config.ts`,
  [`eslint.config.mjs`](../eslint.config.mjs:1) and `index.html` — **no new dependency, script or
  config** ([ADR-012](adr/ADR-012-browser-local-ingestion.md:1) precedent). The ONNX runtime is
  the only heavyweight dependency and was already present.
- **Pinned jsdom App cases** for local WFDB ingestion and record switching — unedited and green.
- `plans/phase-1x-*` and earlier phase records — read-only history; the Phase-17 artifact was **not**
  reopened.

## Item-by-item map

0. **Pre-flight** — `npm run check` green at the unchanged baseline (**61 files / 750 tests / 167
   modules**); [`DEFECT-001`](defect-001-worker-onmessage-delivery.md:1) re-confirmed with a
   throwaway `vite-node` probe outside `src/` (raw payload answers, `MessageEvent` does not), probe
   **deleted in the same item**. No production file touched.
1. **Repair the delivery contract and align every harness** — `port.ts` + both binders + the three
   in-memory harnesses. Counts stayed **61 / 750 / 167** exactly: a drifting count here would have
   exposed a silently edited assertion.
2. **The delivery-contract gate** — the `worker-side delivery contract` describe in `bind.test.ts`
   (4 cases, including the compile-time `@ts-expect-error` case) → **61 / 754 / 167**. Proved to
   bite by temporarily reverting `port.ts` (`TS2578` + two `TS2322`, `tsc` exit 2), then reverting
   the revert.
3. **Sweep the class** — 13 claimants audited with a verdict each, **including the clean ones**;
   recorded in [ADR-019 §(d)](adr/ADR-019-worker-message-delivery-contract.md:137). No further
   mismatch required a code change. Browser-only rows handed to Item 5.
4. **ADR-019 + architecture** — created the ADR; added the §I bullet, the §M item 18 and the
   register entry. Docs-only (**61 / 754 / 167**).
5. **Re-run the real-browser manual pass** — created
   [`plans/phase-18-manual-verification.md`](phase-18-manual-verification.md:1) with Part 0
   (hands-free H1–H5), Part A (the Phase-17 A–F checklist, round 1 by the user) and a blank Part B.
   **A1–A2 flipped to pass** — the phase's primary human result. Observation only; no gate change.
6. **Second dataset adapter: EDF/EDF+** — `src/datasets/edf/**` + the pure dispatch + ADR-020.
   Gate **64 / 814 / 173**.
7. **Display the model's own output** — the application service, the display-only panel, the
   optional prop and the composition-root injection + ADR-021. Gate **66 / 838 / 181**.
8. **Audit + close-out (this record)** — final full `npm run check` green (**66 / 838 / 181**).

## Evidence (the correctness gates)

The claims are pinned at two levels — a **Node** gate for the numbers, strings and contracts, and a
**jsdom** gate for the wiring — never by pixels or timings (rules §51).

### Part A

- **Delivery contract (Node) —** [`bind.test.ts`](../src/workers/__tests__/bind.test.ts:254),
  **11 tests total**, of which the new describe contributes:
  - a platform-shaped `{ data: DspRequest }` yields exactly one `dsp-result`, compared **per band**
    against a direct `DspWorkerCore.handle` call (bit-identical);
  - a platform-shaped `{ data: InferenceRequest }` yields an `inference-result`;
  - a foreign kind, an unknown payload and a missing `data` yield **nothing** from either binder —
    and each binder still answers a valid follow-up afterwards, so "silent" is proved to be
    discrimination rather than breakage;
  - a compile-time case (`@ts-expect-error` above a call handing the handler a bare payload), so a
    regression to the payload shape fails `tsc`.
- **Worker parity (Node, unchanged, re-run) —**
  [`workerAnalysis.parity.test.ts`](../src/application/__tests__/workerAnalysis.parity.test.ts:1)
  (4 tests) plus the client/core/identity suites: the same science, now over a channel that is
  actually reachable.
- **Never asserted:** `MessageEvent` construction semantics beyond `{ data }`, structured-clone
  fidelity, wall-clock timing, canvas pixels.

### Part B — Item 6 (EDF/EDF+ adapter)

- **Header gate (Node) —** [`header.test.ts`](../src/datasets/edf/__tests__/header.test.ts:1),
  **29 tests**, in two describes: [`parseEdfHeader structure`](../src/datasets/edf/__tests__/header.test.ts:42)
  (the declared facts of plain/`EDF+C` files) and
  [`parseEdfHeader refusals`](../src/datasets/edf/__tests__/header.test.ts:207) (one case per
  documented refusal — version, tag, dimension, disagreeing rates, blank/non-numeric fields, short
  buffer, signal count ≤ 0, header-byte mismatch, samples ≤ 0, degenerate spans, duration ≤ 0,
  count < −1, non-integral data section, declared-count mismatch — each asserting the classified
  code **and** the named field).
- **Adapter gate (Node) —** [`adapter.test.ts`](../src/datasets/edf/__tests__/adapter.test.ts:1),
  **19 tests**: [`readRecord`](../src/datasets/edf/__tests__/adapter.test.ts:53) (the decoded
  `Int16Array`s equal the file's own declared digits exactly; an `EDF Annotations` signal is absent
  from the channels and named in `comments`; the out-of-range count travels as a provenance
  transform), [`listRecordIds`](../src/datasets/edf/__tests__/adapter.test.ts:253) (`.edf` stems,
  deduplicated and ascending — independent of directory order), and
  [error paths](../src/datasets/edf/__tests__/adapter.test.ts:273) (`file-not-found` and the
  classified refusals).
- **Fixtures are hermetic and independent of the parser —**
  [`support.ts`](../src/datasets/edf/__tests__/support.ts:1) lays out the EDF field offsets and
  widths as a hard-coded restatement of the format (so the parser is checked against EDF as
  specified, not against itself); its `patch` mechanism **throws on an unknown key**, so a mistyped
  refusal fixture cannot silently test a valid file.
- **Dispatch gate (Node) —** [`dispatch.test.ts`](../src/datasets/__tests__/dispatch.test.ts:1),
  **12 tests** across [`detectDatasetFormat`](../src/datasets/__tests__/dispatch.test.ts:41),
  [`discoverRecordIdsFor`](../src/datasets/__tests__/dispatch.test.ts:81),
  [`createDatasetAdapter`](../src/datasets/__tests__/dispatch.test.ts:102) and
  [`prepareDatasetSource`](../src/datasets/__tests__/dispatch.test.ts:118): `.hea` ⇒ MIT-BIH,
  `.edf` ⇒ EDF (case-insensitively), and a mixed or unrecognised selection raises the classified
  `unsupported-format` naming the counts.
- **The mV rule — the parity form used (stated, as the plan required).** The gate asserts the **exact
  per-sample identity form**: after asserting `calibration` is the fixture's literal
  `{ gain, baseline }`, it checks `recordToMillivoltSignal(record).channels[0].data[i] ===
  adcToMillivolt(digit, calibration)` for every sample
  ([adapter.test.ts:312](../src/datasets/edf/__tests__/adapter.test.ts:312)). The alternative the plan
  offered — a cross-adapter parity of the mV buffers between the EDF and MIT-BIH paths — was **not**
  used: no EDF test constructs a MIT-BIH adapter, so that form is **not claimed**. The identity form
  is the stronger of the two (it pins the declared calibration and the single audited conversion step
  for every sample, and cannot pass vacuously).
- **WFDB path byte-identical:** `discoverMitBihRecordIds`, the MIT-BIH parser, the format-212
  decoder, the `.atr` reader and `load.ts` are unmodified; the pinned jsdom App cases for local WFDB
  ingestion and record switching are **unedited and green**.

### Part B — Item 7 (model-output view)

- **Service gate (Node) —** [`inference.test.ts`](../src/application/__tests__/inference.test.ts:1),
  **17 tests** across:
  [`scoreModelOutput`](../src/application/__tests__/inference.test.ts:123) (scores exactly the
  committed window and describes it for display),
  [`declared semantics decide the score kind`](../src/application/__tests__/inference.test.ts:282)
  (logits + softmax → `predicted-probability`; logits + none → `model-score`, never a silent
  softmax), [`honest, classified refusals`](../src/application/__tests__/inference.test.ts:342)
  (the whole-record window refuses as `model-compatibility-failure` instead of being reshaped) and
  [`engine and prediction failures stay classified`](../src/application/__tests__/inference.test.ts:401)
  plus [`ModelOutputService`](../src/application/__tests__/inference.test.ts:460) (scores through the
  injected engine without disposing it). Ordering is deterministic; `'confidence'` is asserted
  absent.
- **Panel gate (jsdom) —** [`ModelOutputPanel.test.ts`](../src/presentation/views/inference/__tests__/ModelOutputPanel.test.ts:49),
  **7 tests**: identity/labels/scores rendered for the stub engine, the classified refusal rendered
  in `role="alert"`, the in-flight disable-and-relabel state, and **nothing at all** rendered
  without an injected service. Every expected string is derived from the metadata accessor rather
  than hard-coded.
- **Never asserted:** a pixel, a wall clock, or any probability the metadata does not declare.

## Item 3 — the class sweep, with verdicts

The instance was one `onmessage`; the class is *any hand-written double asserted to satisfy a
platform contract without comparison against the platform's real signature*. Every claimant was
audited, **including the ones that came back clean** — a short list of what was checked and how,
so "audited" is evidence rather than a word. Full table: [ADR-019 §(d)](adr/ADR-019-worker-message-delivery-contract.md:137).

| # | Claimant | What it claims | Verdict |
|---|---|---|---|
| 1 | [`WorkerPort.onmessage`](../src/workers/port.ts:33) | the platform's inbound handler | **Defect site → repaired.** Event-shaped, documented as the platform's contract. |
| 2 | [`bindDspCore`](../src/workers/bind.ts:34) / [`bindInferenceCore`](../src/workers/bind.ts:55) | consumes the inbound channel | **Defect site → repaired.** Unwraps `event.data`; guards untouched; detach sets `null`. |
| 3 | [`bind.test.ts`](../src/workers/__tests__/bind.test.ts:47) `PortHarness.receive` | an in-memory `WorkerPort` | **Was aligned to the fake → now aligned to the platform.** |
| 4 | [`workerAnalysis.parity.test.ts`](../src/application/__tests__/workerAnalysis.parity.test.ts:56) loopback | a `WorkerClientTransport` driving a real binder | **Same → aligned.** Delivers `{ data: message }`. |
| 5 | [`worker.bench.ts`](../src/bench/worker.bench.ts:109) loopback | same, for measurement | **Same → aligned.** No structured clone, so numbers are unaffected. |
| 6 | [`createDspWorker`](../src/presentation/workers/browserWorkers.ts:51) / [`createInferenceWorker`](../src/presentation/workers/browserWorkers.ts:74) | the real `Worker` glue, both directions | **Already correct: the outbound half unwraps.** Browser-reachable only → handed to Item 5 (row F2). |
| 7 | [`main.ts`](../src/main.ts:80) `pagehide` teardown | resource release claiming a lifecycle contract | **Correct by design** (fires once; `terminate()` idempotent). Browser-only → Item 5 (row F2). |
| 8 | [`WorkerPort.postMessage`](../src/workers/port.ts:27) `transfer` | the platform's transfer-list capability | **Correct by design, deliberately unused** — transferring the coefficient buffers would detach them. |
| 9 | [`entries/*.worker.ts`](../src/workers/entries/dsp.worker.ts:23) `self as unknown as WorkerPort` | the real global scope satisfies `WorkerPort` | **Correct by design, unchanged**; the compensating control is the Item-2 gate. |
| 10 | [`RecordingTransport`](../src/workers/__tests__/client.test.ts:25) and `dspClient.test.ts` | an in-memory `WorkerClientTransport` | **Narrowed on the fake's own side — safe**, and the opposite direction to DEFECT-001. |
| 11 | [`src/workers/index.ts`](../src/workers/index.ts:1) barrel | re-exports the port types | **Not a claimant.** Type re-exports only. |
| 12 | [`probeAsset.ts`](../src/ml/onnx/probeAsset.ts:1) | a browser-safe model asset | **Not a claimant.** No transport surface. |
| 13 | [`fileSystemAccess.d.ts`](../src/presentation/dataset/fileSystemAccess.d.ts:1) | ambient DOM globals | **Not a delivery contract.** A feature-tested shim; no handler involved. |

**No further mismatch required a correction.** Items 1–2 are the only Part A code changes; rows 3–5
are the harness alignment Item 1 already owed; rows 6–13 are recorded as checked, with 6 and 7 handed
to the manual pass rather than declared confirmed.

## Item 6 — the dispatch decision

The plan placed the dispatch *inside* `prepareBrowserDataset`. It is instead a **pure, Node-testable**
module, [`src/datasets/dispatch.ts`](../src/datasets/dispatch.ts:1), consumed by both the browser
service factory and the file-ingestion funnel, so the rule has exactly one definition and one gate
(the plan's own "one definition per rule" discipline). The rule is **extension-keyed, never
content-sniffed** and never dependent on pick order:

- `.hea` present (and no `.edf`) ⇒ `'mit-bih'`;
- `.edf` present (and no `.hea`) ⇒ `'edf'`;
- both ⇒ classified `unsupported-format` naming the counts (a mixed selection has no single record
  space);
- neither ⇒ classified `unsupported-format` naming what was looked for.

Two recorded deviations make the rule impossible to bypass silently:
[`createBrowserDatasetService`](../src/presentation/dataset/browserDatasetService.ts:50) takes a
**required** `format` with no default, and the ingestion funnels **throw** instead of returning an
empty record list for a mixed/unrecognised selection. The now-effectively-dead WFDB-only string
("No WFDB records (.hea files) were found…") and the WFDB-only picker hint in
[`App.svelte`](../src/presentation/App.svelte:1)/[`DatasetPicker.svelte`](../src/presentation/dataset/DatasetPicker.svelte:1)
are **left untouched** — they are pinned assertions — and are carried below as residual risk.

## What each part proves and does not prove

### Part A

**Proves** — that the worker channel's inbound contract is the platform's; that a real
`MessageEvent`-shaped delivery reaches both binders, is dispatched once and answered bit-identically
to a direct core call; that a foreign/unknown/missing payload is discriminated (silent, then still
answering a valid follow-up); and that a regression to the payload shape **fails the build** rather
than the user. It also proves the class sweep was performed with verdicts, clean results included.

**Does not prove** — anything about the browser-only halves:
[`browserWorkers.ts`](../src/presentation/workers/browserWorkers.ts:1) and
[`main.ts`](../src/main.ts:1) construct real `Worker`s and real DOM listeners, which are covered by
typecheck, lint and the build, and by a **human** observation (rows F2 / B7-x). It makes **no**
science claim (no algorithm changed) and **no** timing claim (the defect was "never answered"; the
gate proves the answer, not its speed — rules §30/§51).

### Part B — Item 6

**Proves** — that the `DatasetAdapter` boundary is **demonstrated, not asserted**: a second, real,
non-WFDB format flows through the same seam into the canonical record with no DSP/UI/ML change; that
its calibration is **derived from the file's declared numbers** (`gain = digitalSpan / physicalSpan`,
`baseline = digitalMin − physicalMin × gain`) and then checked by `createSignalRecord`; that the mV
conversion comes from the single audited step alone, asserted per sample; and that every EDF gap
(µV dimension, disagreeing rates, `EDF+D`, annotations, degenerate ranges, unknown record count) is a
**classified refusal** with a rejected alternative, never an invention.

**Does not prove** — that a real EDF file on disk is read by a browser (the gate is hermetic
`InMemoryFileSource`; the browser path is the manual pass, rows B6-x); that EDF+ **TAL annotations**
are handled (they are explicitly not: `annotations` stay empty and the excluded signal is stated);
or that `EDF+D` discontinuities are supported (refused by decision).

### Part B — Item 7

**Proves** — that a model's own output is displayed **without becoming a claim**: the declared
semantics decide the word per score (`predicted-probability` vs `model-score`, never a silent
softmax), the displayed window **is** the scored window (one domain mapping, no resampling,
padding or truncation), an incompatible window is a first-class classified refusal rendered in
`role="alert"`, ordering is deterministic, the description is frozen, and the panel renders no rule
of its own. It proves the ML slice is reachable from a view through exactly one application door,
with the worker-backed engine injected by the composition root.

**Does not prove** — that the panel looks right in a real browser (jsdom proves wiring only; the
live canvas/render is the manual pass, rows B7-x), or that the development probe is anything but a
development probe: it is explicitly **not** a clinical classifier, and the honest boot state
(the 360-sample probe against the 3600-sample default record) renders the classified refusal on
purpose. Nothing here detects, thresholds, renames a label or prints "confidence"
(rules §47/§49; [ADR-004](adr/ADR-004-onnx-runtime-contract.md:1)).

## Honest deviations (recorded, not glossed)

1. **Item 6 — the dispatch's placement.** The plan said `prepareBrowserDataset`; it is a pure shared
   module [`src/datasets/dispatch.ts`](../src/datasets/dispatch.ts:1) consumed by two callers
   (recorded in [ADR-020 §(d)](adr/ADR-020-edf-adapter-refusals.md:123)).
2. **Item 6 — a WFDB-path behaviour change.** `ingestFiles`/`ingestDirectoryHandle` now throw
   `unsupported-format` for a selection matching neither/both formats where they previously returned
   an empty list. Verified by search that no test or assertion depended on the empty-list path; the
   dead WFDB-only message is left untouched as a pinned assertion and carried as residual risk.
3. **Item 7 — a domain relocation.** The plan's "Do not touch `src/domain/**`" was overridden by the
   dependency direction: `application` may not import from `presentation`, so `TimeSpan`,
   `SampleWindow` and `sampleWindowOfTime` were **moved** into
   [`src/domain/sampling.ts`](../src/domain/sampling.ts:142) and re-exported from
   [`geometry.ts`](../src/presentation/views/timeSeries/geometry.ts:34) so every existing import path
   and test is unchanged (recorded in [ADR-021 §(d)](adr/ADR-021-model-output-display-rule.md:149)).
4. **Item 7 — a compatibility re-assertion.** `scoreModelOutput` calls
   `describeInputCompatibilityProblems` on the input it just built and refuses if anything is
   reported — expected to be empty by construction; a guard against future edits, not a path that
   normally fires.
5. **Item 6 — the parity form.** The plan offered an identity form *or* a cross-adapter mV-buffer
   parity; the **identity form** was used and the cross-adapter form is **not claimed** (above).
6. **Item 3 — the sweep found no new defect.** The instance (rows 1–2) was the defect; rows 3–5 were
   the harness alignment Item 1 owed; rows 6–13 were already correct. "Audited, nothing further
   found" is the recorded result, not a hidden extra fix.
7. **Item 5 — the manual pass is partly pending.** Round 1 (user, 2026-09-14) confirmed A1–A3 and B1–B2
   and that the whole folder is selectable; B3–B4, C1–C5, D1–D4, E1–E4, F1–F2 were **not walked
   individually** and Part B was **not** run in a browser. Those rows stay **Pending (human)** — a
   pending row is not a pass (ADR-017).

## Residual risk

- **The manual pass is open.** Rows B3–B4, C1–C5, D1–D4, E1–E4, F1–F2 (Part A) and **all** of
  Part B (B6-1…B6-7, B7-1…B7-5) are unobserved in a real browser. Their numerical invariants are
  covered by Node/jsdom gates, but the **rendering, scroll, pointer and live-worker** behaviour is
  not: no Playwright and no Vitest browser mode exist in this repo (ADR-012 precedent), so this is
  captured by hand under [ADR-017](adr/ADR-017-real-data-verification.md:1), never promoted to a gate.
  The phase therefore closes with an **open** manual-verification document, honestly labelled.
- **A dead, WFDB-only message survives in the UI.** `App.svelte` still contains "No WFDB records
  (.hea files) were found in the selection." and the picker hint says WFDB. They are unreachable
  (the newer classified throw fires first) and are pinned assertions, so they were not edited; a
  future copy change is a small, separate increment.
- **EDF+ TAL annotations and `EDF+D` are not supported.** Both are documented refusals, not silent
  partial reads; the excluded `EDF Annotations` signal is named in the record's `comments` and
  `annotations` stay empty.
- **The EDF gate is hermetic.** On a clean clone it runs over `InMemoryFileSource` fixtures and
  never reads a real `.edf`; the only real-file EDF evidence would be the (pending) manual rows.
- **The probe is a development artifact.** The panel's honest refusal on a whole-record window is
  the correct display, not a defect to be worked around; nothing in the panel claims clinical
  meaning.
- **Browser-only modules are not unit-tested.** `browserWorkers.ts`, `browserDatasetService.ts` and
  `fileIngestion.ts` are covered by typecheck, lint and the production build only.
- **No new dependency, config or toolchain risk** was introduced anywhere in the phase.

## Test counts

Final `npm run check`: **66 test files / 838 tests**, production build **181 modules**.

| File | Tests | Level | Change |
|---|---|---|---|
| [`bind.test.ts`](../src/workers/__tests__/bind.test.ts:1) | **11** | Node | +4 (Item 2 delivery contract); driven through the platform shape (Item 1) |
| [`workerAnalysis.parity.test.ts`](../src/application/__tests__/workerAnalysis.parity.test.ts:1) | 4 | Node | harness re-pointed (Item 1), count unchanged |
| [`header.test.ts`](../src/datasets/edf/__tests__/header.test.ts:1) | **29** | Node | +29 (Item 6, new) |
| [`adapter.test.ts`](../src/datasets/edf/__tests__/adapter.test.ts:1) | **19** | Node | +19 (Item 6, new) |
| [`dispatch.test.ts`](../src/datasets/__tests__/dispatch.test.ts:1) | **12** | Node | +12 (Item 6, new) |
| [`inference.test.ts`](../src/application/__tests__/inference.test.ts:1) | **17** | Node | +17 (Item 7, new) |
| [`ModelOutputPanel.test.ts`](../src/presentation/views/inference/__tests__/ModelOutputPanel.test.ts:1) | **7** | jsdom | +7 (Item 7, new) |
| [`sampling.test.ts`](../src/domain/__tests__/sampling.test.ts:1) | 16 | Node | unchanged, unedited and green after the Item-7 relocation |
| [`geometry.test.ts`](../src/presentation/views/timeSeries/__tests__/geometry.test.ts:1) | 21 | Node | unchanged, import paths preserved by the re-export |

New modules in the production build: Item 6 added the five `src/datasets/edf` modules plus the
dispatch (**+6**, 167 → 173). Item 7 brought the ML input/interpretation modules into the **main**
bundle for the first time via `main.ts → application/inference.ts` and `ml/onnx/probeAsset`
(**+8**, 173 → 181).

**Gate history** (files / tests / build modules):

`Phase-17 close → 61/750/167` · `Item 0 → 61/750/167` · `Item 1 → 61/750/167` ·
`Item 2 → 61/754/167` · `Item 3 → 61/754/167` · `Item 4 → 61/754/167` · `Item 5 → 61/754/167`
(docs-only) · `Item 6 → 64/814/173` · `Item 7 → 66/838/181` · `Item 8 → 66/838/181`.

Counts stayed **61 / 750 / 167** through Items 0–1 by design — a drifting count there would have
exposed a silently edited assertion. **No red gate occurred in this phase.**

## References

- [`plans/phase-18-plan.md`](phase-18-plan.md:1) — the approved plan executed above.
- [`plans/defect-001-worker-onmessage-delivery.md`](defect-001-worker-onmessage-delivery.md:1) — the
  defect that opened the phase: root cause, reproduction transcript, blast radius.
- [`plans/adr/ADR-019-worker-message-delivery-contract.md`](adr/ADR-019-worker-message-delivery-contract.md:1)
  — Part A: the delivery contract, the gate that pins it and the class sweep.
- [`plans/adr/ADR-020-edf-adapter-refusals.md`](adr/ADR-020-edf-adapter-refusals.md:1) — Item 6: the
  second adapter, its calibration derivation and each classified refusal.
- [`plans/adr/ADR-021-model-output-display-rule.md`](adr/ADR-021-model-output-display-rule.md:1) —
  Item 7: declared semantics, the scored window, one application door.
- [`plans/phase-18-manual-verification.md`](phase-18-manual-verification.md:1) — the recorded
  observation (Part 0 hands-free, Part A round 1, Part B pending).
- [`plans/phase-18-checkpoint.md`](phase-18-checkpoint.md:1) — the resumable end state.
- [`plans/ecg-lab-architecture.md`](ecg-lab-architecture.md:278) — §I / §J bullets, §M item 18 and
  the decision register (ADR-019/020/021).
- [`plans/phase-17-audit.md`](phase-17-audit.md:1) — the audit template this record mirrors.
- [ADR-006](adr/ADR-006-dataset-abstraction.md:1), [ADR-011](adr/ADR-011-worker-execution-model.md:1),
  [ADR-004](adr/ADR-004-onnx-runtime-contract.md:1), [ADR-013](adr/ADR-013-annotation-display.md:1),
  [ADR-017](adr/ADR-017-real-data-verification.md:1) — the boundaries and policy the phase inherits.
