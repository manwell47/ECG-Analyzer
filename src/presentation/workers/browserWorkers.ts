/**
 * Browser worker glue (Phase 10, item 3; ADR-005, ADR-011).
 *
 * The only module that constructs real `Worker`s. Vite's `?worker` transform
 * bundles each thin `entries/*.worker.ts` shell into its own worker chunk and
 * hands back a constructor; this module pairs that worker with the matching
 * latest-only client from the transport-free orchestration layer
 * ([`src/workers`](../../workers/index.ts:1)), so browser code never hand-wires
 * `onmessage`/`postMessage` and the latest-only policy is not duplicated
 * (rules §30).
 *
 * Resource release (ADR-005; AGENTS §15): each factory returns a handle whose
 * `terminate()` disposes the client (rejecting any in-flight request as
 * `request-superseded`), detaches the message handler and shuts the worker
 * down. Nothing leaks a worker or an object URL.
 *
 * Browser-only by construction: no Node test imports this module (vitest only
 * scans `*.test.ts`), so it is covered by typecheck, lint and the production
 * build, and validated end-to-end manually via `npm run dev`.
 */

import type { RecordAnalysisService } from '../../application/analysis';
import { createDefaultLabService } from '../../application/defaults';
import { WorkerDspExecutor } from '../../application/dspExecutor';
import type { InferenceEngine } from '../../ml/engine';
import { WorkerInferenceEngine } from '../../ml/onnx/workerInferenceEngine';
import { LatestOnlyDspClient, LatestOnlyInferenceClient } from '../../workers';
import type { WorkerOutboundMessage } from '../../workers';
import DspWorker from '../../workers/entries/dsp.worker?worker';
import InferenceWorker from '../../workers/entries/inference.worker?worker';

/** A live DSP worker: its latest-only client plus a release hook. */
export interface DspWorkerHandle {
    readonly dsp: LatestOnlyDspClient;
    /** Dispose the client and terminate the worker (idempotent). */
    terminate(): void;
}

/** A live inference worker: its latest-only client plus a release hook. */
export interface InferenceWorkerHandle {
    readonly inference: LatestOnlyInferenceClient;
    /** Dispose the client and terminate the worker (idempotent). */
    terminate(): void;
}

/**
 * Spawn the DSP/DWT worker and pair it with a {@link LatestOnlyDspClient}.
 * Requests are issued via `handle.dsp.request(...)`; completions are routed
 * back through `handleWorkerMessage` (only the current request resolves).
 */
export function createDspWorker(): DspWorkerHandle {
    const worker = new DspWorker();
    const dsp = new LatestOnlyDspClient(worker);
    worker.onmessage = (event: MessageEvent<WorkerOutboundMessage>): void => {
        dsp.handleWorkerMessage(event.data);
    };
    return {
        dsp,
        terminate(): void {
            dsp.dispose();
            worker.onmessage = null;
            worker.terminate();
        },
    };
}

/**
 * Spawn the inference worker and pair it with a
 * {@link LatestOnlyInferenceClient}. The worker context registers the
 * committed development probe engine itself (phase 10, item 5), so this factory
 * only needs to build the client; requests are issued via
 * `handle.inference.request(...)`.
 */
export function createInferenceWorker(): InferenceWorkerHandle {
    const worker = new InferenceWorker();
    const inference = new LatestOnlyInferenceClient(worker);
    worker.onmessage = (event: MessageEvent<WorkerOutboundMessage>): void => {
        inference.handleWorkerMessage(event.data);
    };
    return {
        inference,
        terminate(): void {
            inference.dispose();
            worker.onmessage = null;
            worker.terminate();
        },
    };
}

/** A live worker-backed lab service plus a release hook for its worker. */
export interface WorkerBackedLabService {
    readonly service: RecordAnalysisService;
    /** Dispose the service's worker and release its resources (idempotent). */
    terminate(): void;
}

/**
 * Compose the canonical default lab service with the whole-record DSP/DWT
 * stage offloaded to a dedicated worker (phase 10, item 4). The dataset,
 * options and result shape are unchanged — only *where* the DSP/DWT runs moves,
 * and the worker path is parity-gated byte-identical to the main-thread path.
 */
export function createWorkerBackedLabService(): WorkerBackedLabService {
    const dsp = createDspWorker();
    const service = createDefaultLabService(new WorkerDspExecutor(dsp.dsp));
    return { service, terminate: () => dsp.terminate() };
}

/** A live worker-backed inference engine plus a release hook for its worker. */
export interface WorkerInferenceEngineHandle {
    readonly engine: InferenceEngine;
    /** Dispose the engine's worker and release its resources (idempotent). */
    terminate(): void;
}

/**
 * Compose the full-record inference engine with the whole-record inference stage
 * offloaded to a dedicated worker (phase 10, item 5). The engine is a drop-in
 * {@link InferenceEngine}: callers such as `runExperiment` cannot tell whether
 * the ONNX session runs here or behind the worker port — the relocation is
 * behaviour-preserving, and the committed probe engine is registered inside the
 * worker itself from its build-time asset URL.
 */
export function createWorkerInferenceEngine(): WorkerInferenceEngineHandle {
    const inference = createInferenceWorker();
    return {
        engine: new WorkerInferenceEngine(inference.inference),
        terminate: () => inference.terminate(),
    };
}
