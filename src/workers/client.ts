/**
 * Latest-only worker clients (Phase 6 / Phase 10 / ADR-005, ADR-011; rules
 * §30, §31).
 *
 * The main-thread orchestrators. Each client mints a monotonic request identity
 * per call, posts the request envelope to the worker, and keeps ONLY the latest
 * pending request meaningful — the shared policy lives once in
 * {@link LatestOnlyOrchestrator} (rules §30). Two thin clients compose it:
 *
 *  - {@link LatestOnlyInferenceClient} (Phase 6): run one prepared window
 *    against a registered model, resolving a `ModelPrediction`;
 *  - {@link LatestOnlyDspClient} (Phase 10): decompose one whole ECG signal
 *    (optional pre-filter), resolving the analyzed signal + its
 *    `WaveletDecomposition`.
 *
 * Both drop completions of the other kind, so a DSP envelope can never resolve
 * an inference request and vice versa. The transport is intentionally a thin
 * {@link WorkerClientTransport} (only `postMessage`) so the clients are
 * unit-testable in Node with an in-memory fake; real `Worker` wiring supplies
 * that transport and forwards `onmessage` into `handleWorkerMessage`.
 */

import { EcgError } from '../domain/error';
import type { ErrorCode } from '../domain/error';
import type { ModelInput, ModelPrediction } from '../domain/ml';
import type { Signal } from '../domain/signal';
import type { DwtConfig, WaveletDecomposition } from '../dsp/dwt';
import type { FilterSpec } from '../dsp/filter';
import { LatestIdentityGate } from './identity';
import { LatestOnlyOrchestrator, type LatestOnlyLabels } from './orchestrator';
import { isDspError, isDspResult, isInferenceError, isInferenceResult } from './types';
import type {
    DspRequest,
    InferenceRequest,
    WorkerInboundMessage,
    WorkerOutboundMessage,
} from './types';

/** The minimal worker side a client drives (post one inbound envelope). */
export interface WorkerClientTransport {
    postMessage(message: WorkerInboundMessage): void;
}

/**
 * The inference client's transport. A named alias of
 * {@link WorkerClientTransport} kept so existing wiring/tests read the same;
 * both clients share the one transport shape (rules §30).
 */
export type InferenceClientTransport = WorkerClientTransport;

/**
 * The analyzed-signal payload a `dsp-result` resolves to, without the envelope
 * identity (which the orchestrator has already consumed).
 */
export interface DspExecution {
    /** The signal that was actually decomposed (post-filter when a filter ran). */
    readonly signal: Readonly<Signal>;
    /** Wavelet bands over the analyzed signal (see `decomposition.signalId`). */
    readonly decomposition: WaveletDecomposition;
}

/** Rebuild the classified error a worker serialized into an error envelope. */
function ecgErrorFromEnvelope(error: {
    readonly code: ErrorCode;
    readonly message: string;
    readonly detail?: string;
}): EcgError {
    return new EcgError(error.code, error.message, { detail: error.detail });
}

const INFERENCE_LABELS: LatestOnlyLabels = {
    requestIdPrefix: 'inference',
    disposedError: () => EcgError.inference('The inference client has been disposed.'),
};

const DSP_LABELS: LatestOnlyLabels = {
    requestIdPrefix: 'dsp',
    disposedError: () => EcgError.dsp('The DSP client has been disposed.'),
};

export class LatestOnlyInferenceClient {
    private readonly transport: WorkerClientTransport;

    private readonly orchestrator: LatestOnlyOrchestrator<ModelPrediction>;

    constructor(
        transport: WorkerClientTransport,
        gate: LatestIdentityGate = new LatestIdentityGate(),
    ) {
        this.transport = transport;
        this.orchestrator = new LatestOnlyOrchestrator<ModelPrediction>(INFERENCE_LABELS, gate);
    }

    /** The signal identity of the most recent request, if any. */
    currentSignalId(): string | undefined {
        return this.orchestrator.currentSignalId();
    }

    /**
     * Ask the worker to run one prepared window. Only the most recently issued
     * request can resolve; older outstanding requests are rejected as
     * `request-superseded` as soon as a newer one is issued.
     */
    request(
        modelId: string,
        modelVersion: string,
        signalId: string,
        input: Readonly<ModelInput>,
    ): Promise<ModelPrediction> {
        const { requestId, promise } = this.orchestrator.issue(signalId);
        const message: InferenceRequest = {
            kind: 'inference-request',
            requestId,
            signalId,
            modelId,
            modelVersion,
            input,
        };
        this.transport.postMessage(message);
        return promise;
    }

    /**
     * Route one worker envelope. Wire the real `Worker.onmessage` here. Results
     * or errors that belong to superseded/unknown requests are dropped.
     */
    handleWorkerMessage(message: WorkerOutboundMessage): void {
        if (!isInferenceResult(message) && !isInferenceError(message)) {
            // A DSP/DWT envelope (Phase 7) can never complete an inference
            // request; ignore it so it can neither resolve nor reject a pending
            // inference promise.
            return;
        }
        if (message.kind === 'inference-result') {
            this.orchestrator.resolveRequest(message.requestId, message.prediction);
        } else {
            this.orchestrator.rejectRequest(
                message.requestId,
                ecgErrorFromEnvelope(message.error),
            );
        }
    }

    /**
     * Abort every in-flight request and stop accepting new ones. Resources are
     * released on the worker separately (e.g. model unregistration/dispose).
     */
    dispose(): void {
        this.orchestrator.dispose();
    }
}

export class LatestOnlyDspClient {
    private readonly transport: WorkerClientTransport;

    private readonly orchestrator: LatestOnlyOrchestrator<DspExecution>;

    constructor(
        transport: WorkerClientTransport,
        gate: LatestIdentityGate = new LatestIdentityGate('dsp'),
    ) {
        this.transport = transport;
        this.orchestrator = new LatestOnlyOrchestrator<DspExecution>(DSP_LABELS, gate);
    }

    /** The signal identity of the most recent request, if any. */
    currentSignalId(): string | undefined {
        return this.orchestrator.currentSignalId();
    }

    /**
     * Ask the worker to decompose one whole ECG signal into DWT bands (with an
     * optional pre-filter), resolving the analyzed signal and its decomposition.
     * Only the most recently issued request can resolve; older outstanding
     * requests are rejected as `request-superseded` as soon as a newer one is
     * issued (rules §31).
     */
    request(
        signalId: string,
        signal: Readonly<Signal>,
        dwt: DwtConfig,
        filter?: FilterSpec,
    ): Promise<DspExecution> {
        const { requestId, promise } = this.orchestrator.issue(signalId);
        const message: DspRequest = {
            kind: 'dsp-request',
            requestId,
            signalId,
            signal,
            ...(filter === undefined ? {} : { filter }),
            dwt,
        };
        this.transport.postMessage(message);
        return promise;
    }

    /**
     * Route one worker envelope. Wire the real `Worker.onmessage` here. Results
     * or errors that belong to superseded/unknown requests are dropped, and an
     * inference envelope can never complete a DSP request.
     */
    handleWorkerMessage(message: WorkerOutboundMessage): void {
        if (!isDspResult(message) && !isDspError(message)) {
            return;
        }
        if (message.kind === 'dsp-result') {
            this.orchestrator.resolveRequest(message.requestId, {
                signal: message.signal,
                decomposition: message.decomposition,
            });
        } else {
            this.orchestrator.rejectRequest(
                message.requestId,
                ecgErrorFromEnvelope(message.error),
            );
        }
    }

    /**
     * Abort every in-flight request and stop accepting new ones. The worker is
     * released separately (via `terminate()` in the browser glue — ADR-005).
     */
    dispose(): void {
        this.orchestrator.dispose();
    }
}
