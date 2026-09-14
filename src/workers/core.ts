/**
 * Worker-side DSP + inference cores (Phase 6–7 / ADR-005).
 *
 * Each core is the whole worker-side scientific surface for one request kind:
 *  - {@link InferenceWorkerCore}: a registry of loaded models keyed by
 *    `(modelId, modelVersion)` and one entry point that turns an
 *    {@link InferenceRequest} into an {@link InferenceResult} or
 *    {@link InferenceError}.
 *  - {@link DspWorkerCore}: one entry point that turns a {@link DspRequest}
 *    into a {@link DspResult} or {@link DspError} by delegating to the shared
 *    DSP/domain modules.
 *
 * No core contains duplicated scientific logic (rules §30) — each delegates to
 * shared `src/dsp` / `src/domain` modules or to the registered
 * {@link InferenceEngine}, which itself validates before executing. The actual
 * worker glue (constructing a `Worker`, wiring `onmessage`) is a thin shell over
 * `handle` and lives with the browser wiring, not here.
 */

import { EcgError } from '../domain/error';
import type { ErrorCode } from '../domain/error';
import type { ModelMetadata } from '../domain/ml';
import { assertValidSignal } from '../domain/signal';
import { decomposeSignal } from '../dsp/dwt';
import { filterSignal } from '../dsp/filter';
import type { InferenceEngine } from '../ml/engine';
import type {
    DspError,
    DspRequest,
    DspResult,
    InferenceError,
    InferenceRequest,
    InferenceResult,
} from './types';

export interface RegisteredModel {
    readonly metadata: Readonly<ModelMetadata>;
    readonly engine: InferenceEngine;
}

function modelKey(modelId: string, modelVersion: string): string {
    return `${modelId}@${modelVersion}`;
}

/** Error payload shared by every failure envelope kind. */
interface ClassifiedErrorBody {
    readonly code: ErrorCode;
    readonly message: string;
    readonly detail?: string;
}

/** Prefer a thrown classified EcgError; otherwise construct the given fallback. */
function classified(cause: unknown, fallback: EcgError): EcgError {
    return cause instanceof EcgError ? cause : fallback;
}

/** Message text for a non-Error thrown value, labelled by worker kind. */
function unknownMessage(cause: unknown, workerLabel: string): string {
    return cause instanceof Error
        ? cause.message
        : `${workerLabel} failed with an unknown error.`;
}

/** Extract the serializable error body from a classified EcgError. */
function toErrorBody(err: EcgError): ClassifiedErrorBody {
    return {
        code: err.code,
        message: err.message,
        detail: err.context.detail,
    };
}

/** Serialize any thrown value into a classified inference error envelope. */
function toInferenceErrorEnvelope(
    requestId: string,
    signalId: string,
    cause: unknown,
): InferenceError {
    const err = classified(
        cause,
        EcgError.inference(unknownMessage(cause, 'Inference worker'), { cause }),
    );
    return { kind: 'inference-error', requestId, signalId, error: toErrorBody(err) };
}

/** Serialize any thrown value into a classified DSP error envelope. */
function toDspErrorEnvelope(
    requestId: string,
    signalId: string,
    cause: unknown,
): DspError {
    const err = classified(
        cause,
        EcgError.dsp(unknownMessage(cause, 'DSP worker'), { cause }),
    );
    return { kind: 'dsp-error', requestId, signalId, error: toErrorBody(err) };
}

export class InferenceWorkerCore {
    private readonly models = new Map<string, RegisteredModel>();

    /** Register a loaded model so requests for it can be served. */
    register(
        modelId: string,
        modelVersion: string,
        entry: RegisteredModel,
    ): void {
        const key = modelKey(modelId, modelVersion);
        if (this.models.has(key)) {
            throw EcgError.modelLoading(
                `Model "${modelId}" version "${modelVersion}" is already registered in this worker.`,
            );
        }
        this.models.set(key, entry);
    }

    /** Unregister a model and release its engine/session resources. */
    async unregister(modelId: string, modelVersion: string): Promise<void> {
        const key = modelKey(modelId, modelVersion);
        const entry = this.models.get(key);
        if (entry === undefined) {
            return;
        }
        this.models.delete(key);
        await entry.engine.dispose();
    }

    /**
     * Handle one request and return the single envelope to post back. Any engine
     * failure (including pre-execution validation) becomes a classified
     * `inference-error`, never an unhandled rejection.
     */
    async handle(message: InferenceRequest): Promise<InferenceResult | InferenceError> {
        const { requestId, signalId, modelId, modelVersion } = message;
        const entry = this.models.get(modelKey(modelId, modelVersion));
        if (entry === undefined) {
            return toInferenceErrorEnvelope(
                requestId,
                signalId,
                EcgError.modelLoading(
                    `No model "${modelId}" version "${modelVersion}" is registered in this worker.`,
                ),
            );
        }
        try {
            const prediction = await entry.engine.run(entry.metadata, message.input);
            return { kind: 'inference-result', requestId, signalId, prediction };
        } catch (cause) {
            return toInferenceErrorEnvelope(requestId, signalId, cause);
        }
    }
}

export class DspWorkerCore {
    /**
     * Handle one DSP/DWT request and return the single envelope to post back.
     * The worker is a thin shell: it validates the payload (`assertValidSignal`),
     * applies the optional pre-filter (`filterSignal`), then decomposes
     * (`decomposeSignal`) — reusing the shared DSP/domain modules with no
     * duplicated scientific logic (rules §30). The envelope `signalId` echoes the
     * request tag unchanged, while the analyzed `signal`/`decomposition` carry
     * the precise post-filter identity. Any classified failure (`invalid-input`,
     * `malformed-signal`, ...) becomes a `dsp-error` envelope, never an unhandled
     * rejection.
     */
    async handle(message: DspRequest): Promise<DspResult | DspError> {
        const { requestId, signalId, signal, filter, dwt } = message;
        try {
            assertValidSignal(signal);
            const analyzed = filter === undefined ? signal : filterSignal(signal, filter);
            const decomposition = decomposeSignal(analyzed, dwt);
            return {
                kind: 'dsp-result',
                requestId,
                signalId,
                signal: analyzed,
                decomposition,
            };
        } catch (cause) {
            return toDspErrorEnvelope(requestId, signalId, cause);
        }
    }
}
