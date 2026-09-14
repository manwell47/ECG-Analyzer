/**
 * Worker message envelopes (Phase 6–7 / ADR-005; rules §30, §31).
 *
 * Every unit of work crosses the worker boundary as one of these envelopes. The
 * protocol is a requestId + signalId echo: the main thread issues a monotonic
 * `requestId`, tags it with the identity of the ECG signal (`signalId`) it was
 * computed from, and the worker echoes BOTH back on every completion. The
 * orchestrator keeps only the latest identity and drops any completion whose
 * `requestId` is not current — the structural prevention of "ECG A overwrites
 * ECG B" (rules §31). Buffers are typed end-to-end inside the envelopes.
 *
 * Two request kinds share the protocol:
 *  - inference (Phase 6): run one prepared window against a registered model.
 *  - dsp/dwt (Phase 7): decompose a whole ECG signal into DWT bands. The worker
 *    side is a thin shell over the shared `src/dsp` / `src/domain` modules, so
 *    this request kind adds no duplicated scientific logic (rules §30).
 */

import type { DwtConfig, WaveletDecomposition } from '../dsp/dwt';
import type { FilterSpec } from '../dsp/filter';
import type { ErrorCode } from '../domain/error';
import type { ModelInput, ModelPrediction } from '../domain/ml';
import type { Signal } from '../domain/signal';

/** Main-thread → worker messages. */
export type WorkerInboundMessage = InferenceRequest | DspRequest;

/** Worker → main-thread messages. */
export type WorkerOutboundMessage =
    | InferenceResult
    | InferenceError
    | DspResult
    | DspError;

/** A request to run one prepared window against a registered model. */
export interface InferenceRequest {
    readonly kind: 'inference-request';
    /** Monotonic, unique id issued by the orchestrator (echoed back). */
    readonly requestId: string;
    /** Identity of the ECG signal these samples came from (echoed back). */
    readonly signalId: string;
    readonly modelId: string;
    readonly modelVersion: string;
    /** The realized, validated input (buffers are typed end-to-end). */
    readonly input: Readonly<ModelInput>;
}

/** A successful raw inference result for one request. */
export interface InferenceResult {
    readonly kind: 'inference-result';
    readonly requestId: string;
    readonly signalId: string;
    readonly prediction: Readonly<ModelPrediction>;
}

/** A classified failure for one request. */
export interface InferenceError {
    readonly kind: 'inference-error';
    readonly requestId: string;
    readonly signalId: string;
    readonly error: {
        readonly code: ErrorCode;
        readonly message: string;
        readonly detail?: string;
    };
}

export function isInferenceRequest(message: unknown): message is InferenceRequest {
    return (
        typeof message === 'object' &&
        message !== null &&
        (message as { kind?: unknown }).kind === 'inference-request'
    );
}

export function isInferenceResult(message: unknown): message is InferenceResult {
    return (
        typeof message === 'object' &&
        message !== null &&
        (message as { kind?: unknown }).kind === 'inference-result'
    );
}

export function isInferenceError(message: unknown): message is InferenceError {
    return (
        typeof message === 'object' &&
        message !== null &&
        (message as { kind?: unknown }).kind === 'inference-error'
    );
}

/** A request to decompose a whole ECG signal into DWT bands (Phase 7). */
export interface DspRequest {
    readonly kind: 'dsp-request';
    /** Monotonic, unique id issued by the orchestrator (echoed back). */
    readonly requestId: string;
    /** Identity tag of the requested analysis; echoed back unchanged. */
    readonly signalId: string;
    /** The structured-cloneable signal to analyze (the worker never mutates it). */
    readonly signal: Readonly<Signal>;
    /**
     * Optional pre-filter applied before the DWT. When present the worker reuses
     * `filterSignal` and the analyzed signal (and `decomposition.signalId`) carry
     * the derived `filter-*` transform identity; the envelope `signalId` still
     * echoes the request tag.
     */
    readonly filter?: FilterSpec;
    /** Explicit, validated DWT configuration (worker reuses `decomposeSignal`). */
    readonly dwt: DwtConfig;
}

/** A successful DSP/DWT result for one request. */
export interface DspResult {
    readonly kind: 'dsp-result';
    readonly requestId: string;
    /** Echo of the request tag; equals `message.signalId` unchanged. */
    readonly signalId: string;
    /** The signal that was actually decomposed (post-filter when a filter ran). */
    readonly signal: Readonly<Signal>;
    /** Wavelet bands over the analyzed signal (see `decomposition.signalId`). */
    readonly decomposition: WaveletDecomposition;
}

/** A classified failure for one request. */
export interface DspError {
    readonly kind: 'dsp-error';
    readonly requestId: string;
    readonly signalId: string;
    readonly error: {
        readonly code: ErrorCode;
        readonly message: string;
        readonly detail?: string;
    };
}

export function isDspRequest(message: unknown): message is DspRequest {
    return (
        typeof message === 'object' &&
        message !== null &&
        (message as { kind?: unknown }).kind === 'dsp-request'
    );
}

export function isDspResult(message: unknown): message is DspResult {
    return (
        typeof message === 'object' &&
        message !== null &&
        (message as { kind?: unknown }).kind === 'dsp-result'
    );
}

export function isDspError(message: unknown): message is DspError {
    return (
        typeof message === 'object' &&
        message !== null &&
        (message as { kind?: unknown }).kind === 'dsp-error'
    );
}
