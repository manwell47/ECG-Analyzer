# Phase 18 Checkpoint — resumable state

Recorded 2026-09-14T12:27Z (~14:27 Europe/Madrid, `c:/APPs/ECG DWT Analyzer`). Purpose: start the
next session with zero ambiguity about the verified state, the durable artifacts, and the first
step.

## Verified state (this workspace, 2026-09-14)

- **Phase 18 is complete and fully green.** The final full gate was run at the end of session and
  passed: `npm run check` → typecheck ✓, svelte-check (**0 errors / 0 warnings**) ✓, lint ✓,
  **66 test files / 838 tests** ✓, Vite build ✓ (**181 modules**). Completion record:
  [`plans/phase-18-audit.md`](phase-18-audit.md:1).
- **Phases 1–18 are all complete, audited and green.** The active increment was **Phase 18 = a
  defect-driven hardening of the worker channel (Part A) that absorbed two user-approved
  increments (Part B)**: a second, non-WFDB dataset adapter (EDF/EDF+) and a view that displays a
  model's own output. Part A changed **no science** — it restored the transport the Phase-10
  worker model always assumed. Part B added **no threshold, detection, DSP/DWT stage, model
  semantic or renamed label**. The scientific configuration stays `db4 / 4 / periodic`.
- **NOT a git repository.** `git rev-parse --is-inside-work-tree` fails — there is no `.git` in
  this workspace. The artifacts under `plans/` are the durable record.
- **Machine facts:** win32 x64, Windows 11, Node **v24.18.0**, npm **11.16.0**, Vitest **3.2.7**,
  Svelte 5.57, `@sveltejs/vite-plugin-svelte` 5.1.1, `@testing-library/svelte` 5.4.2, jsdom 30,
  TypeScript 5.7, Vite 6.4.3, onnxruntime-web 1.29.0.

## What Phase 18 added / changed

| Part | Purpose | File |
|---|---|---|
| A | The defect that opened the phase (root cause, repro, blast radius) | [`plans/defect-001-worker-onmessage-delivery.md`](defect-001-worker-onmessage-delivery.md:1) |
| A | ADR-019: the worker message-delivery contract | [`plans/adr/ADR-019-worker-message-delivery-contract.md`](adr/ADR-019-worker-message-delivery-contract.md:1) |
| A | The corrected inbound handler type | [`src/workers/port.ts`](../src/workers/port.ts:33) |
| A | Both binders unwrap `event.data` once | [`src/workers/bind.ts`](../src/workers/bind.ts:34) |
| A | The delivery-contract Node gate (the phase's own gate) | [`src/workers/__tests__/bind.test.ts`](../src/workers/__tests__/bind.test.ts:254) |
| A | Phase-18 real-browser manual pass (Parts 0/A/B) | [`plans/phase-18-manual-verification.md`](phase-18-manual-verification.md:1) |
| B | EDF/EDF+ fixed-header parser | [`src/datasets/edf/header.ts`](../src/datasets/edf/header.ts:1) |
| B | Declared-range calibration derivation | [`src/datasets/edf/calibration.ts`](../src/datasets/edf/calibration.ts:1) |
| B | Little-endian data-record decoder | [`src/datasets/edf/decode.ts`](../src/datasets/edf/decode.ts:1) |
| B | The second `DatasetAdapter` | [`src/datasets/edf/adapter.ts`](../src/datasets/edf/adapter.ts:1) |
| B | Browser-safe EDF barrel | [`src/datasets/edf/index.ts`](../src/datasets/edf/index.ts:1) |
| B | Pure extension-keyed format dispatch | [`src/datasets/dispatch.ts`](../src/datasets/dispatch.ts:1) |
| B | EDF header / adapter / dispatch gates | [`header.test.ts`](../src/datasets/edf/__tests__/header.test.ts:1) · [`adapter.test.ts`](../src/datasets/edf/__tests__/adapter.test.ts:1) · [`dispatch.test.ts`](../src/datasets/__tests__/dispatch.test.ts:1) |
| B | Hermetic EDF fixture builder (independent of the parser) | [`src/datasets/edf/__tests__/support.ts`](../src/datasets/edf/__tests__/support.ts:1) |
| B | ADR-020: the EDF adapter and its refusals | [`plans/adr/ADR-020-edf-adapter-refusals.md`](adr/ADR-020-edf-adapter-refusals.md:1) |
| B | The model-output application service | [`src/application/inference.ts`](../src/application/inference.ts:1) |
| B | Service gate (Node) | [`src/application/__tests__/inference.test.ts`](../src/application/__tests__/inference.test.ts:1) |
| B | Display-only panel | [`src/presentation/views/inference/ModelOutputPanel.svelte`](../src/presentation/views/inference/ModelOutputPanel.svelte:1) |
| B | Panel gate (jsdom) | [`ModelOutputPanel.test.ts`](../src/presentation/views/inference/__tests__/ModelOutputPanel.test.ts:1) |
| B | ADR-021: the model-output display rule | [`plans/adr/ADR-021-model-output-display-rule.md`](adr/ADR-021-model-output-display-rule.md:1) |
| C | Phase 18 audit / completion | [`plans/phase-18-audit.md`](phase-18-audit.md:1) |
| C | Phase 18 checkpoint (this record) | [`plans/phase-18-checkpoint.md`](phase-18-checkpoint.md:1) |

The approved plan [`plans/phase-18-plan.md`](phase-18-plan.md:1) was authored in Architect mode and
carries the two verbatim 2026-09-14 approvals (Part A's shape, then the revision that promoted the
two candidates into Items 6–7 **after** every hardening item).

**Touched (production):**

- [`src/workers/port.ts`](../src/workers/port.ts:33) — `WorkerPort.onmessage` corrected to the
  platform's shape, `(event: { readonly data: unknown }) => void`; a fake must now model the
  platform's delivery.
- [`src/workers/bind.ts`](../src/workers/bind.ts:34) — [`bindDspCore`](../src/workers/bind.ts:34)
  and [`bindInferenceCore`](../src/workers/bind.ts:55) unwrap `event.data` once; guards unchanged;
  detach still sets `onmessage = null`.
- [`src/datasets/index.ts`](../src/datasets/index.ts:26) — export the `./edf` and `./dispatch`
  barrels.
- [`src/presentation/dataset/browserDatasetService.ts`](../src/presentation/dataset/browserDatasetService.ts:50)
  — [`createBrowserDatasetService`](../src/presentation/dataset/browserDatasetService.ts:50) takes a
  **required** `format` (no default);
  [`prepareBrowserDataset`](../src/presentation/dataset/browserDatasetService.ts:76) delegates
  detection to the pure dispatch.
- [`src/presentation/dataset/fileIngestion.ts`](../src/presentation/dataset/fileIngestion.ts:82) —
  both ingestion funnels resolve format + ids through
  [`prepareDatasetSource`](../src/datasets/dispatch.ts:117) and now **throw** the classified
  `unsupported-format` for a mixed/unrecognised selection instead of returning an empty list.
- [`src/main.ts`](../src/main.ts:50) — `prepareFrom` forwards the detected `format`; `boot()`
  constructs `new ModelOutputService(inference.engine, PROBE_MODEL_METADATA)`
  ([line 89](../src/main.ts:89)) over the same worker handle it already terminates on `pagehide`.
- [`src/application/inference.ts`](../src/application/inference.ts:1) — new service
  ([`scoreModelOutput`](../src/application/inference.ts:207),
  [`ModelOutputService`](../src/application/inference.ts:339)); its **domain relocation** touched
  [`src/domain/sampling.ts`](../src/domain/sampling.ts:142), where `TimeSpan`, `SampleWindow` and
  `sampleWindowOfTime` were **moved** (not copied) out of the view.
- [`src/presentation/views/timeSeries/geometry.ts`](../src/presentation/views/timeSeries/geometry.ts:34)
  — re-exports both names, so every existing import path and the unedited sampling/geometry tests
  stay green.
- [`src/presentation/App.svelte`](../src/presentation/App.svelte:109) — one **optional** `modelOutput`
  prop ([line 109](../src/presentation/App.svelte:109)) and one conditional block
  ([line 542](../src/presentation/App.svelte:542)); absent, the markup is unchanged.
- [`plans/ecg-lab-architecture.md`](ecg-lab-architecture.md:278) — §I bullets
  ([line 278](ecg-lab-architecture.md:278), [line 279](ecg-lab-architecture.md:279)), a §J bullet
  ([line 296](ecg-lab-architecture.md:296)), §M **item 18**
  ([line 352](ecg-lab-architecture.md:352)) and the decision-register entries
  ([line 417](ecg-lab-architecture.md:417), [line 419](ecg-lab-architecture.md:419),
  [line 421](ecg-lab-architecture.md:421)).

**Touched (test harnesses) — Part A alignment:**

- [`src/workers/__tests__/bind.test.ts`](../src/workers/__tests__/bind.test.ts:47) — the shared
  `PortHarness.receive`/`deliver()` helper now wraps every inbound envelope as the platform does
  (Item 1), plus the new `worker-side delivery contract` describe (Item 2).
- [`src/application/__tests__/workerAnalysis.parity.test.ts`](../src/application/__tests__/workerAnalysis.parity.test.ts:56)
  — the loopback now delivers `{ data: message }` (count unchanged).
- [`src/bench/worker.bench.ts`](../src/bench/worker.bench.ts:109) — the same alignment for
  measurement; the loopback performs no structured clone, so measured numbers are unaffected.

**Not touched (by design):** all of `src/dsp/**` and every existing ML semantic (the engine
contract, `buildModelInput`, the compatibility rule and `interpretPrediction` are consumed
unchanged); `src/datasets/mitbih/**`, `src/datasets/synthetic/**`, `src/datasets/load.ts`,
`src/datasets/source.ts` and the format-212/`.atr` readers (so the WFDB path is byte-identical and
its pinned jsdom App cases are unedited and green);
[`src/application/analysis.ts`](../src/application/analysis.ts:1) and
[`src/application/dspExecutor.ts`](../src/application/dspExecutor.ts:1) (correct — they merely
awaited a reply that never came); the worker entries
([`dsp.worker.ts`](../src/workers/entries/dsp.worker.ts:1),
[`inference.worker.ts`](../src/workers/entries/inference.worker.ts:1)); the existing views
(`TimeSeriesView.svelte`, `DwtCoefficientView.svelte`, `ViewControls.svelte` and their helpers);
and the configuration ([`package.json`](../package.json:1), `tsconfig.json`, `vitest.config.ts`,
[`eslint.config.mjs`](../eslint.config.mjs:1), `index.html`) — **no new dependency, script or
config**.

## Headline behaviour (what this phase exercised)

- **The worker channel answers again (Part A).** [`DEFECT-001`](defect-001-worker-onmessage-delivery.md:1)
  was a **correctness** failure, not a performance one: the port was declared payload-shaped, so a
  platform-shaped `MessageEvent` never matched and no reply ever came. One line per binder (unwrap
  `event.data`) plus one corrected interface restored the channel the Phase-10 worker model always
  assumed; a real `MessageEvent`-shaped delivery now reaches both binders and is answered
  **bit-identically** to a direct core call. A regression to the payload shape **fails `tsc`** (the
  `@ts-expect-error` case), not the user.
- **A second dataset format (Part B, Item 6).** EDF/EDF+ flows through the **same**
  `DatasetAdapter` seam into the canonical record with **no** DSP/UI/ML change. Calibration is
  **derived from the file's declared numbers** (`gain = digitalSpan / physicalSpan`,
  `baseline = digitalMin − physicalMin × gain`), and the mV conversion comes from the single
  audited step ([`recordToMillivoltSignal`](../src/datasets/load.ts:35)); every EDF gap (µV
  dimension, disagreeing rates, `EDF+D`, annotations, degenerate ranges, unknown record count) is a
  **classified refusal** with a rejected alternative, never an invention.
- **Display of a model's own output (Part B, Item 7).** A model's output is rendered **without
  becoming a claim**: the declared semantics decide the word per score (`predicted-probability` vs
  `model-score`, never a silent softmax), the displayed window **is** the scored window (one domain
  mapping, no resampling/padding/truncation), and an incompatible window is a first-class
  classified refusal rendered in `role="alert"`. The ML slice is reachable from a view through
  exactly **one** application door, with the worker-backed engine injected by the composition root.
- **Honest notes carried into the audit.** The Item-6 mV rule used the **identity** per-sample form
  (`recordToMillivoltSignal(record).channels[0].data[i] === adcToMillivolt(digit, calibration)`);
  the cross-adapter mV-buffer parity the plan offered as an alternative was **not** used and is
  **not claimed**. Three deviations are recorded (dispatch placement, the WFDB-path throw, and the
  `src/domain/**` relocation forced by the dependency direction), plus the Item-7 compatibility
  re-assertion, the Item-3 "no further defect found" result, and the partly-pending manual pass.

## Gate history (Phase 18)

`Phase-17 close → 61/750/167` · `Item 0 → 61/750/167` · `Item 1 → 61/750/167` ·
`Item 2 → 61/754/167` · `Item 3 → 61/754/167` · `Item 4 → 61/754/167` · `Item 5 → 61/754/167`
(docs-only) · `Item 6 → 64/814/173` · `Item 7 → 66/838/181` · `Item 8 → 66/838/181`
(files / tests / build modules).

The **+88 tests** and **+14 build modules** are Phase 18's own: Item 2 **+4 Node**; Item 6 **+29
header + 19 adapter + 12 dispatch = +60 Node** and **+6 modules** (the five `src/datasets/edf`
modules plus dispatch, 167 → 173); Item 7 **+17 Node + 7 jsdom = +24** and **+8 modules** (the ML
input/interpretation modules enter the **main** bundle for the first time, 173 → 181). Counts stayed
**61 / 750 / 167** through Items 0–1 by design — a drifting count there would have exposed a
silently edited assertion. Items 3–5 (the sweep, the ADR, the manual pass) were **docs-only**.
**No red gate occurred in this phase.** The only red event was **deliberate and temporary**: to
prove the Item-2 gate bites, `port.ts` was reverted once (`TS2578` + two `TS2322`, `tsc` exit 2)
and then restored.

## Re-run commands

- Full green gate: `npm run check`
- Test suite only: `npm run test`
- Part A delivery-contract gate only: `npx vitest run bind`
- Item 6 EDF gates only: `npx vitest run header adapter dispatch`
- Item 7 gates only: `npx vitest run inference ModelOutputPanel`
- Opt-in real-data gates only (dataset present in this workspace): `npx vitest run realData`
- Dev server (the **manual** real-browser pass — the live worker, the EDF adapter and the panel;
  jsdom cannot draw, measure layout or run a live `Worker`): `npm run dev`
- Machine snapshot: `node -v && npm -v && npx vitest --version`

## What Phase 18 proves and does not prove (honest limits)

- **Proves** — that the worker channel's inbound contract is the platform's and that a real
  event-shaped delivery reaches both binders, is dispatched once and answered bit-identically to a
  direct core call, with a foreign/unknown/missing payload discriminated (silent, then still
  answering a valid follow-up) and a payload-shape regression failing the build; that the
  `DatasetAdapter` boundary is **demonstrated, not asserted** — a second, real, non-WFDB format
  reaches the canonical record with no DSP/UI/ML change, its calibration derived from the file's
  declared numbers and its mV conversion from the single audited step, every gap a classified
  refusal; and that a model's own output is displayed **without becoming a claim** through exactly
  one application door, the declared semantics deciding the word per score and an incompatible
  window a first-class classified refusal. It also proves the Part A class sweep was performed with
  verdicts, clean results included.
- **Does not prove** — that a real EDF file is read by a browser, that the panel looks right, or
  that the live worker/`pagehide` glue behaves in a **real** browser (jsdom and Node prove wiring
  and numbers only; the browser half is the manual pass, rows F2 / B6-x / B7-x); that EDF+ **TAL
  annotations** are handled (they are explicitly not — `annotations` stay empty and the excluded
  signal is named in `comments`) or that `EDF+D` discontinuities are supported (refused by
  decision); that the development probe is anything but a development probe (it is explicitly **not**
  a clinical classifier, and the honest boot state renders the classified refusal on purpose);
  nor any pixel, layout or wall-clock timing (never the gate, rules §51). A **skipped** opt-in
  real-data gate proves nothing (on a clean clone, where `data/raw/mitdb` is absent, it skips).

## Residual risk (open, carried forward)

- **The manual pass is open.** Part A rows B3–B4, C1–C5, D1–D4, E1–E4, F1–F2 and **all** of Part B
  (B6-1…B6-7, B7-1…B7-5) are unobserved in a real browser. Their numerical invariants are covered by
  Node/jsdom gates, but rendering, scroll, pointer and live-worker behaviour are **not**; no
  Playwright and no Vitest browser mode exist in this repo, so this is captured by hand under
  [ADR-017](adr/ADR-017-real-data-verification.md:1), never promoted to a gate. Round 1 (user,
  2026-09-14) confirmed A1–A3, B1–B2 and that the whole folder is selectable;
  [`plans/phase-18-manual-verification.md`](phase-18-manual-verification.md:1) closes **open**,
  honestly labelled — a **pending row is not a pass**.
- **A dead, WFDB-only message survives in the UI.** `App.svelte` still contains "No WFDB records
  (.hea files) were found in the selection." and the picker hint says WFDB. They are unreachable
  (the newer classified throw fires first) and are pinned assertions, so they were not edited; a
  future copy change is a small, separate increment.
- **EDF+ TAL annotations and `EDF+D` are unsupported** (documented refusals, not silent partial
  reads). **The EDF gate is hermetic** — it runs over `InMemoryFileSource` fixtures and never reads
  a real `.edf`; the only real-file EDF evidence would be the (pending) manual rows.
- **Browser-only modules are not unit-tested.** `browserWorkers.ts`, `browserDatasetService.ts` and
  `fileIngestion.ts` are covered by typecheck, lint and the production build only.
- **No new dependency, config or toolchain risk** was introduced anywhere in the phase.

## Where the project stands / candidates for next

No next phase is proposed or approved. Phases 1–18 are complete; ADR-010 governs optimization
(measurement-first) and its deferrals still stand. Candidate directions — **each a candidate only;
none is auto-authorized**, and per rules §50/§52 any of them must be planned as a measured, gated,
itemized increment (Architect plan → approval → Code execution with a green gate per item):

1. **Real-browser re-verification (manual).** Walk the open manual rows — the Phase-17 A–F
   checklist (B3–F2) and the whole Part B set (B6-x / B7-x) — under `npm run dev`; recorded as an
   **observation**, never a gate ([ADR-017](adr/ADR-017-real-data-verification.md:1)).
2. **EDF+ TAL annotations / `EDF+D`.** Currently classified refusals
   ([ADR-020](adr/ADR-020-edf-adapter-refusals.md:1)); supporting either is a new, documented
   increment, not a silent extension.
3. **A further dataset format** (a third adapter) or a richer synthetic generator — same
   `DatasetAdapter` discipline as [ADR-006](adr/ADR-006-dataset-abstraction.md:1)/ADR-012; DSP/UI/ML
   untouched.
4. **Wire a real model asset / model picker** into the composition root — the panel exists but the
   probe remains a development artifact ([ADR-021](adr/ADR-021-model-output-display-rule.md:1),
   [ADR-004](adr/ADR-004-onnx-runtime-contract.md:1)).
5. **WASM DWT** — still **deferred** ([ADR-010](adr/ADR-010-performance-measurement-policy.md:1)); a
   WASM path would need a parity gate first.
6. **WebGPU inference** — still **deferred** ([ADR-010](adr/ADR-010-performance-measurement-policy.md:1));
   only batch inference where it demonstrably wins is in scope.

## First action next session (suggested)

1. Confirm green with a single `npm run check` (expect **66 files / 838 tests**, build **181
   modules**; svelte-check 0/0).
2. Decide with the user which candidate (if any) is next; then author + approve a next-phase plan in
   **Architect** mode, itemized with a green `npm run check` gate per item — same cadence as
   [`plans/phase-18-plan.md`](phase-18-plan.md:1).
3. Read [`plans/phase-18-audit.md`](phase-18-audit.md:1) for the exact Phase-18 scope/evidence and
   the recorded deviations, and the three ADRs
   ([ADR-019](adr/ADR-019-worker-message-delivery-contract.md:1),
   [ADR-020](adr/ADR-020-edf-adapter-refusals.md:1),
   [ADR-021](adr/ADR-021-model-output-display-rule.md:1)) before changing or extending the worker
   channel, the dataset seam or the model-output view.

## Key references

- [`plans/phase-18-plan.md`](phase-18-plan.md:1) — the approved plan executed this session (status
  line kept as written, per repo convention; completion is in the audit).
- [`plans/phase-18-audit.md`](phase-18-audit.md:1) — item map, evidence, the 13-row class sweep,
  deviations, limits.
- [`plans/defect-001-worker-onmessage-delivery.md`](defect-001-worker-onmessage-delivery.md:1) — the
  defect that opened the phase.
- [`plans/adr/ADR-019-worker-message-delivery-contract.md`](adr/ADR-019-worker-message-delivery-contract.md:1)
  — Part A: the delivery contract, the gate that pins it and the class sweep.
- [`plans/adr/ADR-020-edf-adapter-refusals.md`](adr/ADR-020-edf-adapter-refusals.md:1) — Item 6: the
  second adapter, its calibration derivation and each classified refusal.
- [`plans/adr/ADR-021-model-output-display-rule.md`](adr/ADR-021-model-output-display-rule.md:1) —
  Item 7: declared semantics, the scored window, one application door.
- [`plans/phase-18-manual-verification.md`](phase-18-manual-verification.md:1) — the recorded
  observation (Part 0 hands-free, Part A round 1, Part B pending).
- [`plans/ecg-lab-architecture.md`](ecg-lab-architecture.md:278) — §I / §J bullets, §M item 18 and
  the decision register (ADR-019/020/021; current source of truth for scope).
- [`plans/phase-17-checkpoint.md`](phase-17-checkpoint.md:1) — the checkpoint template this record
  mirrors.
- [ADR-006](adr/ADR-006-dataset-abstraction.md:1), [ADR-011](adr/ADR-011-worker-execution-model.md:1),
  [ADR-004](adr/ADR-004-onnx-runtime-contract.md:1), [ADR-013](adr/ADR-013-annotation-display.md:1),
  [ADR-017](adr/ADR-017-real-data-verification.md:1) — the boundaries and policy the phase inherits.
