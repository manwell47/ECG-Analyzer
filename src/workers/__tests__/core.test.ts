/**
 * Worker-side inference core tests (Phase 6 / ADR-005).
 *
 * The core is the whole worker-side scientific surface: a registry keyed by
 * `(modelId, modelVersion)` and one entry point that turns an InferenceRequest
 * into a single classified result/error envelope. It contains no duplicated
 * scientific logic — it delegates to the registered InferenceEngine, and any
 * engine failure (including pre-execution validation) becomes a classified
 * `inference-error`, never an unhandled rejection.
 */

import { describe, expect, it } from 'vitest';
import { EcgError } from '../../domain/error';
import type { ModelInput, ModelMetadata, ModelPrediction } from '../../domain/ml';
import type { InferenceEngine } from '../../ml/engine';
import { createStubEngine } from '../../ml/testing/stub';
import { makeMetadata, makePrediction, makeRawInput } from '../../ml/__tests__/support';
import { InferenceWorkerCore } from '../core';
import type { InferenceRequest } from '../types';

class FakeEngine implements InferenceEngine {
    readonly backendId = 'fake';

    disposeCount = 0;

    constructor(
        private readonly runImpl: (
            metadata: Readonly<ModelMetadata>,
            input: Readonly<ModelInput>,
        ) => Promise<ModelPrediction>,
    ) { }

    run(metadata: Readonly<ModelMetadata>, input: Readonly<ModelInput>): Promise<ModelPrediction> {
        return this.runImpl(metadata, input);
    }

    async dispose(): Promise<void> {
        this.disposeCount += 1;
    }
}

function request(
    modelId: string,
    modelVersion: string,
    signalId: string,
    input: Readonly<ModelInput>,
): InferenceRequest {
    return { kind: 'inference-request', requestId: 'req-1', signalId, modelId, modelVersion, input };
}

function throwsCode(fn: () => unknown, code: string): void {
    let caught: unknown;
    try {
        fn();
    } catch (cause) {
        caught = cause;
    }
    expect(caught instanceof EcgError).toBe(true);
    if (caught instanceof EcgError) {
        expect(caught.code).toBe(code);
    }
}

describe('InferenceWorkerCore', () => {
    it('serves a registered model via its engine and echoes the request identity', async () => {
        const metadata = makeMetadata();
        const core = new InferenceWorkerCore();
        core.register(metadata.modelId, metadata.modelVersion, {
            metadata,
            engine: createStubEngine(),
        });

        const envelope = await core.handle(
            request(metadata.modelId, metadata.modelVersion, 'sig-7', makeRawInput(metadata)),
        );
        expect(envelope.kind).toBe('inference-result');
        if (envelope.kind === 'inference-result') {
            expect(envelope.requestId).toBe('req-1');
            expect(envelope.signalId).toBe('sig-7');
            expect(envelope.prediction.modelId).toBe(metadata.modelId);
            expect(envelope.prediction.modelVersion).toBe(metadata.modelVersion);
        }
    });

    it('refuses to register the same model twice as model-loading-failure', () => {
        const metadata = makeMetadata();
        const core = new InferenceWorkerCore();
        const entry = { metadata, engine: createStubEngine() };
        core.register(metadata.modelId, metadata.modelVersion, entry);
        throwsCode(
            () => core.register(metadata.modelId, metadata.modelVersion, entry),
            'model-loading-failure',
        );
    });

    it('returns a model-loading error envelope when no model is registered', async () => {
        const metadata = makeMetadata();
        const core = new InferenceWorkerCore();
        const envelope = await core.handle(
            request('missing', '1.0.0', 'sig-1', makeRawInput(metadata)),
        );
        expect(envelope.kind).toBe('inference-error');
        if (envelope.kind === 'inference-error') {
            expect(envelope.error.code).toBe('model-loading-failure');
            expect(envelope.requestId).toBe('req-1');
            expect(envelope.signalId).toBe('sig-1');
        }
    });

    it('wraps a classified engine rejection (validation) into a classified envelope', async () => {
        const metadata = makeMetadata();
        const core = new InferenceWorkerCore();
        core.register(metadata.modelId, metadata.modelVersion, {
            metadata,
            engine: createStubEngine(),
        });

        const badInput = makeRawInput(metadata, { modelId: 'other' });
        const envelope = await core.handle(
            request(metadata.modelId, metadata.modelVersion, 'sig-1', badInput),
        );
        expect(envelope.kind).toBe('inference-error');
        if (envelope.kind === 'inference-error') {
            expect(envelope.error.code).toBe('model-compatibility-failure');
        }
    });

    it('wraps an arbitrary engine throw as an inference-failure', async () => {
        const metadata = makeMetadata();
        const core = new InferenceWorkerCore();
        const engine = new FakeEngine(async () => {
            throw new Error('boom');
        });
        core.register(metadata.modelId, metadata.modelVersion, { metadata, engine });

        const envelope = await core.handle(
            request(metadata.modelId, metadata.modelVersion, 'sig-1', makeRawInput(metadata)),
        );
        expect(envelope.kind).toBe('inference-error');
        if (envelope.kind === 'inference-error') {
            expect(envelope.error.code).toBe('inference-failure');
            expect(envelope.error.message).toMatch(/boom/);
        }
    });

    it('unregister disposes the engine, removes the model, and is idempotent', async () => {
        const metadata = makeMetadata();
        const core = new InferenceWorkerCore();
        const engine = new FakeEngine(async () => makePrediction(metadata));
        core.register(metadata.modelId, metadata.modelVersion, { metadata, engine });

        await core.unregister(metadata.modelId, metadata.modelVersion);
        expect(engine.disposeCount).toBe(1);

        // Unregistering again is a no-op and never disposes twice.
        await core.unregister(metadata.modelId, metadata.modelVersion);
        expect(engine.disposeCount).toBe(1);

        const envelope = await core.handle(
            request(metadata.modelId, metadata.modelVersion, 'sig-1', makeRawInput(metadata)),
        );
        expect(envelope.kind).toBe('inference-error');
        if (envelope.kind === 'inference-error') {
            expect(envelope.error.code).toBe('model-loading-failure');
        }
    });
});
