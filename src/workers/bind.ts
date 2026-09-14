/**
 * Worker core ⇄ port binder (Phase 10 / ADR-005, ADR-011; delivery contract
 * corrected in Phase 18 / ADR-019).
 *
 * The thin shell that turns a `Worker`'s raw `onmessage` into the cores'
 * `handle` and posts the single envelope back. It contains **no logic of its
 * own** beyond dispatch: it reads the envelope off the platform's event, guards
 * its kind, delegates to the matching core, and posts the returned envelope.
 * Unknown or other-kind messages are ignored, so a DSP envelope can never reach
 * the inference core and vice versa (rules §30 — one shared implementation, no
 * duplicated science).
 *
 * **The delivery contract is the platform's, not the fake's.** A real
 * `DedicatedWorkerGlobalScope` invokes the handler with a `MessageEvent`, so the
 * envelope is on `event.data`; the guard must be applied to the *unwrapped*
 * value. Reading the event itself as the payload leaves every guard `false` and
 * silently discards every request — the request promise never settles, so the UI
 * waits forever with a clean console (DEFECT-001).
 *
 * Transport-free by construction: it depends only on {@link WorkerPort}, so it
 * is unit-tested in Node with an in-memory fake while the browser entry files
 * (`entries/*.worker.ts`) pass the real `self` unchecked.
 */

import type { DspWorkerCore, InferenceWorkerCore } from './core';
import type { WorkerPort } from './port';
import { isDspRequest, isInferenceRequest } from './types';

/**
 * Bind a DSP core to a port: every inbound `dsp-request` is answered with one
 * `dsp-result`/`dsp-error` envelope. Returns a disposer that detaches the
 * handler (used when a worker context is released — ADR-005).
 */
export function bindDspCore(port: WorkerPort, core: DspWorkerCore): () => void {
    port.onmessage = (event: { readonly data: unknown }): void => {
        const message = event.data;
        if (!isDspRequest(message)) {
            return;
        }
        void core.handle(message).then((result) => {
            port.postMessage(result);
        });
    };
    return () => {
        port.onmessage = null;
    };
}

/**
 * Bind an inference core to a port: every inbound `inference-request` is
 * answered with one `inference-result`/`inference-error` envelope. Returns a
 * disposer that detaches the handler (used when a worker context is released —
 * ADR-005).
 */
export function bindInferenceCore(port: WorkerPort, core: InferenceWorkerCore): () => void {
    port.onmessage = (event: { readonly data: unknown }): void => {
        const message = event.data;
        if (!isInferenceRequest(message)) {
            return;
        }
        void core.handle(message).then((result) => {
            port.postMessage(result);
        });
    };
    return () => {
        port.onmessage = null;
    };
}
