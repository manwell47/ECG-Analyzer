/**
 * Worker-backed inference engine (Phase 10, item 5; ADR-004, ADR-005, ADR-011).
 *
 * An {@link InferenceEngine} adapter that moves the *execution* of full-record
 * inference off the main thread without changing any science: it validates the
 * realized input exactly as the direct ONNX adapter does, then posts one
 * `inference-request` to the dedicated inference worker through the shared
 * latest-only client and resolves the worker's `ModelPrediction`. The ONNX
 * session and every `run` therefore execute inside the worker; the main thread
 * never imports `onnxruntime-web` (rules §30 — no duplicated orchestration).
 *
 * The type import from `src/workers` is the transport-free orchestration layer
 * (the client is injected by the browser composition root), so this module adds
 * no worker glue of its own and stays usable anywhere an `InferenceEngine` is
 * accepted — including the unchanged `runExperiment` (rules §31, §51).
 */

import { EcgError } from '../../domain/error';
import type { ModelInput, ModelMetadata, ModelPrediction } from '../../domain/ml';
import type { InferenceEngine } from '../engine';
import { assertInputCompatibleWithModel } from '../engine';
import type { LatestOnlyInferenceClient } from '../../workers';

/**
 * The envelope echo tag for one window: the prepared window's own source
 * identity, falling back to the model identity when a window carries none. It is
 * diagnostic only (the latest-only gate keys on the request id).
 */
function inferenceSignalIdOf(input: Readonly<ModelInput>): string {
    return input.sourceWindowIds.length > 0
        ? input.sourceWindowIds.join('|')
        : `${input.modelId}@${input.modelVersion}`;
}

export class WorkerInferenceEngine implements InferenceEngine {
    readonly backendId = 'worker-onnx-web';

    private readonly client: LatestOnlyInferenceClient;

    private disposed = false;

    constructor(client: LatestOnlyInferenceClient) {
        this.client = client;
    }

    /**
     * Validate the input locally (loud, cheap) and delegate the actual run to the
     * worker. The worker re-validates against the metadata it registered, so a
     * mismatch can never be silently adapted; a superseded request rejects as
     * `request-superseded` (rules §31).
     */
    async run(
        metadata: Readonly<ModelMetadata>,
        input: Readonly<ModelInput>,
    ): Promise<ModelPrediction> {
        if (this.disposed) {
            throw EcgError.inference(
                'The worker-backed inference engine has been disposed and cannot run.',
            );
        }
        assertInputCompatibleWithModel(metadata, input);
        return this.client.request(
            metadata.modelId,
            metadata.modelVersion,
            inferenceSignalIdOf(input),
            input,
        );
    }

    /**
     * Abort in-flight requests and stop accepting new ones. The worker's ONNX
     * session is released separately through the client's worker teardown
     * (`terminate()` in the browser glue — ADR-005 resource release).
     */
    async dispose(): Promise<void> {
        if (!this.disposed) {
            this.disposed = true;
            this.client.dispose();
        }
    }
}
