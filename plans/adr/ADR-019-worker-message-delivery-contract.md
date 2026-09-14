# ADR-019 — The worker message delivery contract (an event-shaped `onmessage`, and a fake that imitates the platform)

Status: Accepted
Date: 2026-09-14
Scope: Phase 18 Part A (items 1–3) — a **boundary correction** in the worker channel. The inbound
contract of [`WorkerPort`](../../src/workers/port.ts:25) is the platform's: the handler receives the
platform's event and the transmitted envelope is on its `data`. The binder unwraps once, the existing
guards are applied unchanged, and every in-memory harness is corrected to model the platform rather
than the other way round. **No** science, domain, parser, adapter, DSP/DWT, ML, application or
presentation change; no new dependency, prop, script or config; no wall-clock or pixel assertion
(rules §51). This ADR also records the class sweep it demanded.

## Context

Phase 10 ([ADR-011](ADR-011-worker-execution-model.md:1)) realized [ADR-005](ADR-005-browser-worker-strategy.md:1)
as running browser glue: transport-free cores behind [`bindDspCore`](../../src/workers/bind.ts:34) /
[`bindInferenceCore`](../../src/workers/bind.ts:55), a single `LatestOnlyOrchestrator`, and thin worker
entries that hand the real global scope to a binder. The channel was unit-tested in Node against an
in-memory fake and manually verified "when a human runs `npm run dev`" — the manual pass being an
**observation, never a gate** ([ADR-017](ADR-017-real-data-verification.md:1)).

On 2026-09-14 a human finally ran that pass, and the application was dead: after ingesting
`101.hea`/`101.dat`/`101.atr` the UI sat on `Analyzing default record…` indefinitely with a **clean
console**. [`DEFECT-001`](../defect-001-worker-onmessage-delivery.md:1) root-caused it by execution:
`onmessage` was declared **payload-shaped** while a real `DedicatedWorkerGlobalScope` invokes it with
a **`MessageEvent`**, so every guard saw `undefined` for `.kind`, took its "ignore unknown messages"
branch, and silently discarded every request. The pending promise never settled, `busy` stayed
`true`, and nothing threw — which is exactly why **61 test files / 750 tests** stayed green.

Three hazards shaped the decision:

1. **The fake was believed over the platform.** The type claimed to be "the surface a real
   `DedicatedWorkerGlobalScope` and an in-memory fake **both** satisfy". They satisfied it in **name
   only**: the fake delivered the raw payload, the platform delivered an event. Because the fake was
   the thing every gate exercised, the suite was self-consistent and **wrong about reality** — the
   failure mode this ADR exists to prevent (rules §56 protects the gate, not the claim).
2. **The failure was silent by design.** Discarding a message whose `kind` is unrecognized is
   deliberate and correct behaviour for an unsolicited message; it becomes a defect only when the
   delivery contract is wrong, because then it swallows *every* message and produces no error to
   notice. A contract error and a legitimate "ignore that" are indistinguishable at the guard.
3. **An instance is one `onmessage`; the class is every hand-written double asserted to satisfy a
   platform contract.** Fixing the one handler and stopping would leave the same trap for the next
   binder/entry pair — which is why the fix item also owed a sweep, with verdicts, including the
   sites that turn out clean.

Constraints:

- **Transport-free cores stay transport-free** (ADR-011): the fix lives in the port type and the two
  binders; no science moves and no logic is added (rules §30).
- **The guards are correct and are not to be touched** — [`isDspRequest`](../../src/workers/types.ts:136)
  and [`isInferenceRequest`](../../src/workers/types.ts:68) test their **argument**; the bug was the
  argument they were handed.
- **No new dependency, no `tsconfig`/lib change, no new prop.** The DOM-only `lib` (no `webworker`) is
  retained, so the entry files keep their single documented `self` cast.
- **Every existing assertion keeps its meaning:** no case deleted, no expected value changed.
- **Manual browser observations are recorded, never promoted to gates** (ADR-017).

## Decision

### (a) `WorkerPort.onmessage` **is** the platform contract, and the fake imitates the platform

[`WorkerPort`](../../src/workers/port.ts:25) declares the handler the platform actually calls:

```ts
export interface WorkerPort {
    /** Post one completed envelope back to the main thread. */
    postMessage(message: WorkerOutboundMessage, transfer?: readonly Transferable[]): void;
    /**
     * The inbound handler the binder installs; `null` until bound/detached.
     * Takes the platform's event and carries the envelope on `data` — reading the
     * event itself as the payload is DEFECT-001.
     */
    onmessage: ((event: { readonly data: unknown }) => void) | null;
}
```

The type is deliberately **structural and minimal** (`{ readonly data: unknown }`) rather than
`MessageEvent<…>`: the binder needs nothing else from the event, a narrower parameter keeps the fake
trivially honest, and the module stays DOM-lib-only. The header now states the rule the fix encodes —
an in-memory fake **must model the platform's delivery**; when it hands the binder a bare payload
instead, the *fake* silently defines the contract and the binder stops answering real workers at all.

### (b) The binder unwraps once, and the guards are untouched

[`bindDspCore`](../../src/workers/bind.ts:34) and [`bindInferenceCore`](../../src/workers/bind.ts:55)
now read:

```ts
port.onmessage = (event: { readonly data: unknown }): void => {
    const message = event.data;
    if (!isDspRequest(message)) {   // isInferenceRequest in bindInferenceCore
        return;
    }
    void core.handle(message).then((result) => {
        port.postMessage(result);
    });
};
```

One added line per binder. Detach still sets `port.onmessage = null`, which is the platform's own
"no handler" value. No dispatch logic, no new module, no cast away from the problem.

The two worker entries are **unchanged**, as the plan required: their
`const port = self as unknown as WorkerPort;` (a single documented cast forced by the DOM-only `lib`)
now narrows the global to a surface that is *true* rather than aspirational. That double cast is also
precisely what kept the type system silent on the worker side, which is why (c) exists.

### (c) The gate pins the **delivery**, not the dispatch

The existing cases answered "does the binder dispatch correctly **given a payload**". None asked
"is the binder reachable **at all through the platform's delivery**". Item 2 adds a
`worker-side delivery contract` describe to [`bind.test.ts`](../../src/workers/__tests__/bind.test.ts:254):

- a platform-shaped `{ data: DspRequest }` yields **exactly one** `dsp-result`, compared **per band**
  against a direct `DspWorkerCore.handle` call (bit-identical);
- a platform-shaped `{ data: InferenceRequest }` yields an `inference-result`;
- a **foreign kind, an unknown payload and a missing `data`** yield **nothing** from either binder —
  and each binder still answers a valid follow-up afterwards, so "silent" is proved to be
  discrimination, not breakage;
- a **compile-time** case: `// @ts-expect-error a bare payload is not the platform delivery shape.`
  above a call that hands the handler a bare payload. If `onmessage` ever regresses to the payload
  shape the directive becomes unused and `tsc` fails the gate.

This gate was **proved to bite** rather than assumed: temporarily restoring the payload shape in
[`port.ts`](../../src/workers/port.ts:33) produced, in the terminal,

```
src/workers/__tests__/bind.test.ts(359,9): error TS2578: Unused '@ts-expect-error' directive.
src/workers/bind.ts(35,5): error TS2322: Type '(event: { readonly data: unknown; }) => void' is not assignable to type '(message: unknown) => void'.
src/workers/bind.ts(56,5): error TS2322: Type '(event: { readonly data: unknown; }) => void' is not assignable to type '(message: unknown) => void'.
```

(`npx tsc --noEmit` exit code **2**). Reverting restored `npm run check` exit 0. The gate is therefore
not a comment: a regression fails the build, and it fails it in the **same** run that would otherwise
have been green — the exact failure of Phase 10–17.

### (d) The class sweep — every fake or stub claiming a platform contract, with a verdict

The instance is one `onmessage`; the class is any hand-written double asserted to satisfy a platform
contract without comparison to the platform's real signature. Every claimant in the tree was audited,
**including the ones that came back clean** (defect record §8: the useful output is the class).
`src/**/*.ts` was swept for `onmessage`/`postMessage`/`WorkerPort`/`WorkerClientTransport`/`MessageEvent`/
`Transferable`/`terminate()`/`pagehide`, and `*.svelte` for any worker messaging (none: a single
unrelated doc comment in [`App.svelte`](../../src/presentation/App.svelte:1)).

| # | Claimant | What it claims | Verdict |
|---|---|---|---|
| 1 | [`WorkerPort.onmessage`](../../src/workers/port.ts:33) | the platform's inbound handler | **Defect site → repaired.** Event-shaped, documented as the platform's contract. |
| 2 | [`bindDspCore`](../../src/workers/bind.ts:34) / [`bindInferenceCore`](../../src/workers/bind.ts:55) | consumes the inbound channel | **Defect site → repaired.** Unwraps `event.data`; guards unchanged; detach sets `null`. |
| 3 | [`bind.test.ts`](../../src/workers/__tests__/bind.test.ts:47) `PortHarness.receive` | an in-memory `WorkerPort` | **Was aligned to the fake → now aligned to the platform.** One shared `deliver()` helper wraps every inbound envelope as the platform does. |
| 4 | [`workerAnalysis.parity.test.ts`](../../src/application/__tests__/workerAnalysis.parity.test.ts:56) loopback | a `WorkerClientTransport` driving a real binder | **Same → aligned.** The loopback now delivers `{ data: message }`. |
| 5 | [`worker.bench.ts`](../../src/bench/worker.bench.ts:109) loopback | same, for measurement | **Same → aligned.** `queueMicrotask(() => workerPort.onmessage?.({ data: message }))`. Measured numbers are unaffected (no optimization; the loopback performs no structured clone). |
| 6 | [`createDspWorker`](../../src/presentation/workers/browserWorkers.ts:51) / [`createInferenceWorker`](../../src/presentation/workers/browserWorkers.ts:74) | the real `Worker` glue, both directions | **Already correct: the *outbound* half unwraps.** `worker.onmessage = (event: MessageEvent<WorkerOutboundMessage>) => dsp.handleWorkerMessage(event.data)`, and `terminate()` disposes, nulls `onmessage` and terminates. It is the main-thread half of the very channel that was broken. Browser-reachable only → handed to Item 5 as an **observation**, not declared confirmed. |
| 7 | [`main.ts`](../../src/main.ts:80) `pagehide` teardown | resource release claiming a lifecycle contract | **Correct by design.** The listener is never removed, but it fires once as the page is torn down and `terminate()` is idempotent (`dispose()` + `worker.terminate()`), so a second call is harmless. Browser-only → Item 5. |
| 8 | [`WorkerPort.postMessage`](../../src/workers/port.ts:27)'s `transfer?: readonly Transferable[]` | the platform's transfer-list capability | **Correct by design, deliberately unused.** No call site in the tree passes a second argument (a sweep for `postMessage(<args>,` matches only the declaration). Transferring the core's `Float64Array`-backed coefficient buffers would **detach** them and silently empty a returned result; the binder posts the result whole. |
| 9 | [`entries/dsp.worker.ts`](../../src/workers/entries/dsp.worker.ts:23) / [`entries/inference.worker.ts`](../../src/workers/entries/inference.worker.ts:34) `self as unknown as WorkerPort` | the real global scope satisfies `WorkerPort` | **Correct by design, unchanged (the plan forbade touching it).** The double cast is required by the DOM-only `lib` and is what silenced the type system on the worker side; the compensating control is the (c) gate. A wrong shape here is now a `tsc` failure, not a runtime silence. |
| 10 | [`RecordingTransport`](../../src/workers/__tests__/client.test.ts:25) in `client.test.ts` and [`dspClient.test.ts`](../../src/workers/__tests__/dspClient.test.ts:40) | an in-memory `WorkerClientTransport` | **Narrowed on the fake's own side — safe, and the opposite direction to DEFECT-001.** It records `DspRequest[]`/`InferenceRequest[]` against a union-typed transport method, valid under method bivariance and documented in both files. It narrows what the *client may send*, which is the subset the client already sends; it cannot widen or misdeclare what production receives. |
| 11 | [`src/workers/index.ts`](../../src/workers/index.ts:1) barrel | re-exports the port types | **Not a claimant.** Type re-exports only. |
| 12 | [`probeAsset.ts`](../../src/ml/onnx/probeAsset.ts:1) | a browser-safe model asset | **Not a claimant.** No transport surface; its parity test pins metadata and bytes, not delivery. |
| 13 | [`fileSystemAccess.d.ts`](../../src/presentation/dataset/fileSystemAccess.d.ts:1) | ambient DOM globals (`values()`, `showDirectoryPicker`) | **Not a delivery contract.** A two-shape shim whose availability is a runtime concern, guarded by a `typeof` feature test in [`fileIngestion.ts`](../../src/presentation/dataset/fileIngestion.ts:91); no handler is involved. |

**No further mismatch required a correction.** Items 1–2 are the only code changes; rows 3–5 are the
harness alignment item 1 already owed; rows 6–13 are recorded as checked, with 6 and 7 handed to the
manual pass rather than declared confirmed.

Rejected alternative (the tempting one): **accept both shapes.** Making the binder tolerant —
`const message = 'data' in event ? event.data : event` — would have kept the 750 tests green without
touching a single fake. It was rejected because it *institutionalizes* the ambiguity: the interface
would keep claiming a contract the platform does not honour, every future binder would have to
re-derive the same defensive dance, and the ambiguity would make a genuine malformed envelope
indistinguishable from a mis-shaped delivery. A contract that tolerates its own violation cannot
detect it.

Rejected alternative: **keep the payload contract and adapt inside `entries/*.worker.ts`**
(`self.onmessage = (event) => inner(event.data)`). This is the minimal-diff fix and it was rejected in
the defect record too: it leaves the false type claim in place, moves the knowledge of the platform
into the file the gates cannot reach, and guarantees the next binder/entry pair repeats the mistake.
**The interface is where the contract belongs.**

### (e) A boundary correction, not a behaviour change

- No request or response envelope changed, no guard changed, no orchestrator/client/core changed: the
  same messages, the same identity echo, the same latest-only supersession. The only difference is
  **which** value the guards are applied to.
- No science is touched: the DSP/DWT path, the inference path, the adapters and the application
  services are byte-identical, which is why the existing parity and per-band identity assertions pass
  **unchanged**.
- Counts: item 1 left the suite at **61 files / 750 tests / 167 modules** — deliberately unchanged, so
  a drifting count would have exposed a silently edited assertion. Item 2 raised the test count to
  **754** with `bind.test.ts` at 11 tests; files and modules stay 61 / 167.

### (f) Testability split and the phase gates

- **Node gate (the fix):** [`bind.test.ts`](../../src/workers/__tests__/bind.test.ts:1) — the
  pre-existing dispatch cases (now driven through the platform's shape) plus the delivery-contract
  describe, including the compile-time case. This is the gate whose absence let DEFECT-001 pass 750
  green tests.
- **Node gates (unchanged, re-run):** the worker parity slice
  ([`workerAnalysis.parity.test.ts`](../../src/application/__tests__/workerAnalysis.parity.test.ts:1))
  and the client/core/identity suites — the same science, now over a channel that is actually
  reachable.
- **Never asserted:** `MessageEvent` construction semantics beyond `{ data }`, structured-clone
  fidelity, wall-clock timing and canvas pixels (rules §51).
- **Not automated, and not claimed to be:** [`browserWorkers.ts`](../../src/presentation/workers/browserWorkers.ts:1)
  and [`main.ts`](../../src/main.ts:1) construct real `Worker`s and real DOM listeners. They are
  covered by typecheck, lint and the production build, and by a **human** `npm run dev` observation
  recorded in [`plans/phase-18-manual-verification.md`](../phase-18-manual-verification.md:1) — an
  observation, never a gate (ADR-017). Rows 6 and 7 of the sweep table are settled there or not at all.
- **Benchmarks:** [`worker.bench.ts`](../../src/bench/worker.bench.ts:1) is aligned like the other
  loopbacks but remains measurement-only — no CI gate, no committed number re-derived from it here.

## Consequences

- **The application answers its workers again.** The boot analysis, every ingestion path and the first
  inference call all settle, because the binder now reads the value the platform actually delivers.
  The end-to-end proof is the re-run manual pass (Item 5), not a Node assertion.
- **The fake can no longer define the contract.** Every harness that drives a binder now delivers the
  platform's shape, so "the tests pass" and "a browser would work" are no longer independent claims.
  A future harness that feeds a bare payload will fail the delivery-contract cases (or the
  compile-time case, if it types it as such).
- **A regression fails the build, not the user.** Restoring the payload-shaped declaration now yields
  `TS2578` + two `TS2322` (exit 2), demonstrated by deliberately reverting it.
- **The double cast in the entries is no longer load-bearing.** `self as unknown as WorkerPort` was
  what hid the mismatch from `tsc`; with the contract and the gate corrected, it is a documented
  lib-shim on a surface that is now true, and any future divergence surfaces as a type error at
  [`bind.ts`](../../src/workers/bind.ts:34).
- **`transfer` is deliberately unused, and that is now written down.** The `postMessage` signature
  advertises the platform's transfer list; nothing passes one, because detaching the coefficient
  buffers would empty a result. A future optimization that wants zero-copy must move the ownership
  question first, not just add an argument.
- **Honest limits.** This ADR proves the *worker-side inbound* contract and the honesty of every
  in-memory double; it proves **nothing** about `browserWorkers.ts`, `main.ts` or any other
  browser-only path, which is why the manual pass is re-run rather than presumed. It is also not a
  science or timing claim: no algorithm changed and no measurement is asserted (rules §30/§51).
- **Cost:** one line per binder, one shared test helper, four cases, one documented type; no new
  dependency, no config change, no new module. ADR-001/005/008/009/011/017 all hold unchanged.

## References

- Architecture plan §I (browser execution — the messaging contract this tightens; the worker table
  and the Phase-10/11 entries that introduced the channel), §M item 18 (Phase 18), decision register
  (ADR-019)
- [`plans/phase-18-plan.md`](../phase-18-plan.md) — approved scope, items 1–3 and their gates
- [`plans/defect-001-worker-onmessage-delivery.md`](../defect-001-worker-onmessage-delivery.md) —
  the symptom as reported, the chain, the root cause, the probe transcript (§4) and §8's class mandate
- [`plans/phase-17-manual-verification.md`](../phase-17-manual-verification.md) — where the defect
  surfaced (A2), left pending rather than patched mid-phase
- [ADR-011](ADR-011-worker-execution-model.md:1) (the worker model this repairs — transport-free cores,
  thin shells, byte-identical parity as the correctness gate), [ADR-005](ADR-005-browser-worker-strategy.md:1)
  (the messaging contract), [ADR-017](ADR-017-real-data-verification.md:1) (a manual pass is an
  observation, never a gate; a finding is routed as its own increment)
- Rules §30 (no duplicated science), §51 (no wall-clock/pixel assertions), §56 (the green check gate),
  and the AGENTS constitution's demand that a defect is fixed at its cause rather than its symptom
