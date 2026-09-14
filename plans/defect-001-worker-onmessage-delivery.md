# DEFECT-001 — The worker channel never answers in a real browser (the app hangs on `Analyzing default record…`)

Reported **2026-09-14** during the real-browser pass of the Phase-17 controls
([`plans/phase-17-manual-verification.md`](phase-17-manual-verification.md)).
Status: **root-caused and reproduced; not yet fixed** — routed to **Phase 18** as its first item
(ADR-017 §(d): a defect surfaced in the manual pass is *reported and routed as its own increment*,
never silently patched into the closed phase).

**Severity: blocking.** In a real browser the application renders **no signal at all** — the boot
analysis and every local-ingestion analysis never settle, so the whole UI is dead, not just the
Phase-17 controls.

---

## 1. Symptom as reported (verbatim)

> i DID THE '"Ingest `101.hea` + `101.dat` + `101.atr`"' and nothing seems to happen: Record [101]
> ^1 record discovered / Analyzing default record... and nothing happens, no signal display or
> anything and i've been waiting for 5 mins. it will be better if you perform those tests

The three visible strings are diagnostic, not incidental:

- `Record [101]` and `1 record discovered` come from the record-picker branch
  (`{#if recordIds.length > 0}`), which **is** rendered — so Phase-11/12 ingestion succeeded on the
  main thread and `ingest()` reached `analyzeRecordById(first)`.
- `Analyzing default record…` is the literal text of the `{#if busy}` branch in
  [`App.svelte`](../src/presentation/App.svelte:432). It renders **iff** `busy === true` **and**
  `result === null` — i.e. the awaited analysis promise **never settled**. It is not a slow
  analysis and not a rendering bug: nothing threw, so the `catch` branch (`failureMessage`) never
  ran and the console stayed clean.

## 2. What the code does (the chain)

1. [`App.analyzeRecordById()`](../src/presentation/App.svelte:1) sets `busy = true` and awaits
   `serviceForAnalysis().analyze({...options, recordId})`.
2. [`RecordAnalysisService.analyze()`](../src/application/analysis.ts:235) →
   [`analyzeRecord()`](../src/application/analysis.ts:199) → `adapter.readRecord` →
   `recordToMillivoltSignal` → `executor.execute(...)`.
3. The executor for both the boot service and the ingested-dataset service is
   [`WorkerDspExecutor`](../src/application/dspExecutor.ts:67), whose
   `execute` is `client.request(signal.id, signal, request.dwt, request.filter)`.
4. [`LatestOnlyDspClient.request()`](../src/workers/client.ts:178) issues through the orchestrator
   and posts `{kind:'dsp-request', …}` onto the worker. The returned promise is stored as *pending*
   in [`LatestOnlyOrchestrator`](../src/workers/orchestrator.ts:65) and is settled **only** when a
   `dsp-result` / `dsp-error` comes back via `handleWorkerMessage`.
5. Worker-side, [`dsp.worker.ts`](../src/workers/entries/dsp.worker.ts) passes the real global
   scope to `bindDspCore`: `const port = self as unknown as WorkerPort`.
6. [`bindDspCore(port, core)`](../src/workers/bind.ts:25) installs
   `port.onmessage = (message: unknown) => { if (!isDspRequest(message)) { return; } … }`.

**Step 6 is where the request dies.**

## 3. Root cause

**`bind.ts` installs a payload-shaped handler on an event-shaped channel.**

- A real `DedicatedWorkerGlobalScope.onmessage` handler is invoked with a **`MessageEvent`**; the
  envelope is on `event.data`.
- [`isDspRequest()`](../src/workers/types.ts:136) tests `message.kind === 'dsp-request'` on its
  **argument**. Given a `MessageEvent`, `message.kind` is `undefined`, the guard is `false`, and
  [`bindDspCore`](../src/workers/bind.ts:27) takes the bare `return`.
- No result is ever posted, so the orchestrator's pending promise is never settled, so
  `App`'s `busy` stays `true` and the UI sits on `Analyzing default record…` **forever** — with no
  error, because nothing failed; the message was silently discarded by design ("Unknown or
  other-kind messages are ignored").

The type that was supposed to prevent this,
[`WorkerPort.onmessage`](../src/workers/port.ts:21), is declared
`((message: unknown) => void) | null` and documented as the surface "a real
`DedicatedWorkerGlobalScope` and an in-memory fake **both** satisfy". They satisfy it in **name
only**: the fake delivers the raw payload, the platform delivers an event. That is the leaky
abstraction — and the fake, not the platform, was mistaken for the truth.

[`bindInferenceCore()`](../src/workers/bind.ts:45) carries the identical defect against
[`isInferenceRequest()`](../src/workers/types.ts:68). It is currently dormant in the UI
(`WorkerInferenceEngine` is constructed at boot but never called by a view), so it did not
contribute to this symptom — it is the same bug waiting for the first caller.

## 4. Evidence — reproduced, not inferred

A throwaway probe (written outside `src/`, run with the repo's own `vite-node`, then deleted) bound
a real [`DspWorkerCore`](../src/workers/core.ts:154) to a recording fake port and delivered one
valid `dsp-request` two ways — the way the repo's Node harnesses deliver it, and the way a real
worker scope delivers it:

```
MessageEvent available in this runtime: function
A  raw payload    -> posts: 1  kind: dsp-result
B  MessageEvent   -> posts: 0  kind: undefined
isDspRequest(raw payload)  : true
isDspRequest(MessageEvent) : false
isInferenceRequest(event)  : false
D  handler argument is a MessageEvent: true
```

- **A** — the delivery every in-repo harness uses: answered, one `dsp-result`.
- **B** — the delivery a real `DedicatedWorkerGlobalScope` uses: **nothing posted, no error**.
- **D** — confirms the premise: a handler assigned to a scope receives a `MessageEvent`.

Static corroboration: the **main-thread half of the same channel** already unwraps the event
correctly — [`createDspWorker()`](../src/presentation/workers/browserWorkers.ts:51) does
`worker.onmessage = (event) => dsp.handleWorkerMessage(event.data)` — while the worker half does
not. A grep of `src/` for `onmessage|postMessage` finds `.data` unwrapping **only** in
`browserWorkers.ts` (and `window.addEventListener` in `main.ts`); there is no worker-side shim.

## 5. Why 61 test files / 750 tests stayed green

The bug is invisible to every existing gate because **no gate ever delivers a platform-shaped
message**:

| Harness | How it delivers | What it therefore proves |
|---|---|---|
| [`bind.test.ts`](../src/workers/__tests__/bind.test.ts:51) | `port.onmessage?.(payload)` — the raw envelope | the binder's *dispatch*, not its delivery contract |
| [`workerAnalysis.parity.test.ts`](../src/application/__tests__/workerAnalysis.parity.test.ts:1) | in-memory loopback feeding the binder's `onmessage` directly | parity of the *shared science*, bypassing browser event semantics |
| [`worker.bench.ts`](../src/bench/worker.bench.ts:1) | `queueMicrotask(() => workerPort.onmessage?.(message))` | throughput, same bypass |
| [`App.test.ts`](../src/presentation/__tests__/App.test.ts:1) | a fake `service` in jsdom | the view's wiring, never a Worker |

`bind.test.ts` and the parity/bench loopbacks are the *right* shape for what they test, but they
encode the fake's contract as if it were the platform's, so the suite is self-consistent and wrong
about reality. And [`browserWorkers.ts`](../src/presentation/workers/browserWorkers.ts:1) — the one
module that owns the real `Worker` — states in its header that it is "covered by typecheck, lint and
the production build, and validated end-to-end manually via `npm run dev`": the truthful part is
that nothing automated reaches it.

The real-browser gap these gates were relying on is the one
[ADR-017](adr/ADR-017-real-data-verification.md:1) declared an **observation, never a gate** — and
every manual browser step recorded in Phases 10–17 was left "Pending (human)". This defect has
therefore been live in the app since the worker channel was introduced (Phase 10) and was never
exercised by a human.

## 6. Blast radius

- **The boot analysis hangs too.** [`createWorkerBackedLabService()`](../src/presentation/workers/browserWorkers.ts:103)
  builds the default service over the *same* `createDspWorker()` glue, so the app never renders its
  first canvas either — the user reached the record picker only because ingestion sets `recordIds`
  independently of `result`.
- **Every ingestion path hangs.** File input and the Chromium folder picker both funnel into
  `createBrowserDatasetService()` (a second worker, same binder).
- **Inference would hang identically** the first time any view calls the engine.
- **Node, tests and the production build are unaffected** — which is exactly why the gate was green.

## 7. The minimal fix (proposed — Phase 18 item 1)

Repair the contract where the contract lives, so a fake must imitate the platform rather than the
platform being blamed for the fake:

1. **Make `WorkerPort.onmessage` the real contract** — an event-shaped handler:
   `onmessage: ((event: { readonly data: unknown }) => void) | null`, with the doc comment corrected
   to state that the *fake* models the platform's `MessageEvent` delivery.
2. **Unwrap in the binder** — `bindDspCore` / `bindInferenceCore` read `event.data` and then apply
   the existing guards unchanged. No logic is added and no science moves (rules §30).
3. **Update the Node harnesses** to deliver `{ data: payload }` — `bind.test.ts`, the
   `workerAnalysis.parity.test.ts` loopback and `worker.bench.ts` — so they now model the platform.
4. **Add the missing gate**: a Node case that drives the binder through **both** delivery shapes and
   asserts the answer is produced for the browser-shaped one, so this exact regression cannot return
   silently.

Rejected alternative — *keep the payload contract and adapt inside `entries/*.worker.ts`*
(`self.onmessage = (event) => inner(event.data)`): it leaves the false type claim in place and
guarantees the next binder/entry pair repeats the mistake. The interface is where the contract
belongs.

Explicitly **not** in scope: no science/domain/parser/adapter/DSP/DWT/ML change, no new dependency,
no `package.json`/config change, no wall-clock or pixel assertion (rules §51).

## 8. What the increment must also answer

The single most useful output of a defect like this is the class, not the instance. The fix item
must include an audit for the same failure mode elsewhere: **any place where a hand-written fake or
stub is asserted to satisfy a platform contract should be checked against the platform's real
shape** (`DspWorkerHandle`/`InferenceWorkerHandle`, the transfer argument, `pagehide` teardown, and
the remaining loopback harnesses).

## 9. Routing

| | |
|---|---|
| Found in | Phase-17 real-browser pass (A2), recorded in [`phase-17-manual-verification.md`](phase-17-manual-verification.md) |
| Phase 17 status | **closed and untouched** — 61 files / 750 tests / 167 modules; no Phase-17 file modified |
| Routed to | **Phase 18**, item 1 ([`plans/phase-18-plan.md`](phase-18-plan.md)) |
| Phase-17 pass | **blocked**, not failed: rows B1–F2 stay *Pending (human)* until Phase 18 item 1 lands and the pass is re-run |

## 10. References

- [`src/workers/bind.ts`](../src/workers/bind.ts:25) — the payload-shaped handler (defect site)
- [`src/workers/port.ts`](../src/workers/port.ts:17) — the contract that claimed both shapes
- [`src/workers/types.ts`](../src/workers/types.ts:136) — the guards; correct, but fed the wrong argument
- [`src/workers/entries/dsp.worker.ts`](../src/workers/entries/dsp.worker.ts) / [`inference.worker.ts`](../src/workers/entries/inference.worker.ts) — where the real scope is passed as a `WorkerPort`
- [`src/presentation/workers/browserWorkers.ts`](../src/presentation/workers/browserWorkers.ts:51) — the main-thread half, which unwraps correctly
- [ADR-005](adr/ADR-005-browser-worker-strategy.md:1) / [ADR-011](adr/ADR-011-worker-execution-model.md:1) — the worker strategy this channel realizes
- [ADR-017](adr/ADR-017-real-data-verification.md:1) — manual pass is an observation, never a gate; a finding is routed as its own increment
