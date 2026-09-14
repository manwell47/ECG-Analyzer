/**
 * Worker port abstraction (Phase 10 / ADR-005, ADR-011; contract corrected in
 * Phase 18 / ADR-019).
 *
 * The minimal surface a real `DedicatedWorkerGlobalScope` and an in-memory fake
 * both satisfy, so the worker-side glue (`bindDspCore` / `bindInferenceCore` in
 * [`bind.ts`](./bind.ts)) stays transport-free and fully testable in Node.
 *
 * `onmessage` is **event-shaped**, exactly as the platform declares it: a
 * `DedicatedWorkerGlobalScope` invokes the handler with a `MessageEvent` and the
 * transmitted envelope is on its `data`. An in-memory fake therefore has to
 * model *that* delivery. When a fake hands the binder the bare payload instead,
 * the fake — not the platform — silently defines the contract, and the binder
 * stops answering real workers at all (DEFECT-001, ADR-019).
 *
 * Direction is worker-side: the port *posts* the outbound result/error envelopes
 * back to the main thread and *receives* inbound request envelopes through
 * `onmessage`. The scientific cores already contain every algorithm; this type
 * adds no logic (rules §30).
 */

import type { WorkerOutboundMessage } from './types';

/** The worker-side end of the message channel (mirrors `DedicatedWorkerGlobalScope`). */
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
