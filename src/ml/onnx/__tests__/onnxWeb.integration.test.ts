/**
 * Real ONNX Runtime Web session integration test (Phase 7 item #4).
 *
 * Closes the Phase-6 "real-ONNX path compile-only" seam: this test actually
 * loads the committed probe `.onnx` (see `data/fixtures/models/`) into a real
 * ONNX session created by {@link createOnnxWebEngine} and drives the full
 * contract: metadata → `assertValidModelMetadata` → `buildModelInput` from a
 * prepared 360 Hz single-channel window → `engine.run` → deterministic raw
 * logits → `interpretPrediction` → label + honest semantics.
 *
 * Runs in Node: `onnxruntime-web` 1.29 ships a dedicated Node build
 * (`dist/ort.node.*` under the package "node" export condition), so no browser
 * or `onnxruntime-node` binding is needed.
 *
 * The oracle is closed-form: the probe graph emits `logits = [+Σ, −Σ]` of the
 * float32 window. We use *constant* windows whose every sample is exactly
 * representable in float32, so Σ is exact (e.g. ±0.5 mV × 360 → ±180.0) and the
 * raw-logit assertions are exact rather than tolerance-dependent.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EcgError } from '../../../domain/error';
import type { ModelInput, ModelMetadata } from '../../../domain/ml';
import { FIXTURE_SAMPLE_RATE_HZ, generateSignal } from '../../../fixtures/signals';
import { buildModelInput } from '../../input';
import { interpretPrediction } from '../../interpret';
import { assertValidModelMetadata } from '../../metadata';
import { createOnnxWebEngine } from '../ortWebEngine';
import {
    loadProbeModelBytes,
    loadProbeModelMetadata,
    PROBE_MODEL_CHANNELS,
    PROBE_MODEL_INPUT_NAME,
    PROBE_MODEL_OUTPUT_NAME,
    PROBE_MODEL_SAMPLE_RATE_HZ,
    PROBE_MODEL_WINDOW_SAMPLES,
} from '../../testing/probeModel';
import type { InferenceEngine } from '../../engine';

/** A prepared 360 Hz, single-channel, 360-sample window plus its identity. */
function constantWindow(offsetMv: number, windowId: string): { source: object; data: Float64Array } {
    const samples = generateSignal({
        kind: 'constant',
        sampleRateHz: FIXTURE_SAMPLE_RATE_HZ,
        length: PROBE_MODEL_WINDOW_SAMPLES,
        offset: offsetMv,
    });
    return {
        source: {
            sampleRateHz: PROBE_MODEL_SAMPLE_RATE_HZ,
            channelCount: PROBE_MODEL_CHANNELS,
            windowSamples: PROBE_MODEL_WINDOW_SAMPLES,
            windowId,
        },
        data: samples,
    };
}

function referenceSum(offsetMv: number): number {
    return offsetMv * PROBE_MODEL_WINDOW_SAMPLES;
}

describe('onnx-web real-session integration (probe model)', () => {
    let metadata: ModelMetadata;
    let engine: InferenceEngine;
    let modelBytes: Uint8Array;

    beforeAll(async () => {
        // 1. Load + strictly validate the committed metadata document.
        metadata = loadProbeModelMetadata();
        assertValidModelMetadata(metadata);
        // 2. Load the committed model bytes and build a real session.
        modelBytes = loadProbeModelBytes();
        engine = await createOnnxWebEngine({ metadata, modelBytes });
    });

    afterAll(async () => {
        await engine?.dispose();
    });

    it.each([
        { name: 'positive mean (0.5 mV)', offsetMv: 0.5, expectedLabel: 'positive-mean' },
        { name: 'negative mean (-0.5 mV)', offsetMv: -0.5, expectedLabel: 'nonpositive-mean' },
        { name: 'zero mean', offsetMv: 0, expectedLabel: 'positive-mean' },
    ])(
        '$name: builds a ModelInput, runs the real session, and interprets deterministically',
        async ({ offsetMv, expectedLabel }) => {
            const window = constantWindow(offsetMv, `window-${String(offsetMv)}`);

            // 3. Realize the prepared window into a validated ModelInput.
            const input = buildModelInput({
                metadata,
                source: window.source as never,
                data: window.data,
            });
            expect(input.tensorName).toBe(PROBE_MODEL_INPUT_NAME);
            expect(input.shape).toEqual([PROBE_MODEL_WINDOW_SAMPLES]);
            expect(input.dtype).toBe('float32');

            // 4. Run through the real ONNX session.
            const prediction = await engine.run(metadata, input);
            expect(prediction.modelId).toBe(metadata.modelId);
            expect(prediction.modelVersion).toBe(metadata.modelVersion);
            expect(prediction.outputName).toBe(PROBE_MODEL_OUTPUT_NAME);
            expect(prediction.semantics).toBe('logits');
            expect(prediction.values).toHaveLength(2);

            // 5. Raw logits must equal the exact closed-form [+Σ, −Σ].
            const expected = referenceSum(offsetMv);
            expect(prediction.values[0]!).toBeCloseTo(expected, 4);
            expect(prediction.values[1]!).toBeCloseTo(-expected, 4);

            // 6. Interpretation must yield honest predicted-probability semantics
            //    (logits + declared softmax activation) with the sign-determined
            //    argmax label on top.
            const interpreted = interpretPrediction(metadata, prediction);
            expect(interpreted).toHaveLength(2);
            expect(interpreted[0]!.label).toBe(expectedLabel);
            expect(interpreted[0]!.semantics).toBe('predicted-probability');
            const total = interpreted.reduce((acc, entry) => acc + entry.score, 0);
            expect(total).toBeCloseTo(1, 6);
            for (const entry of interpreted) {
                expect(entry.modelId).toBe(metadata.modelId);
                expect(entry.modelVersion).toBe(metadata.modelVersion);
                expect(entry.score).toBeGreaterThanOrEqual(0);
                expect(entry.score).toBeLessThanOrEqual(1);
            }
        },
    );

    it('refuses to run an input prepared for a different model version (loud compatibility)', async () => {
        const window = constantWindow(0.5, 'window-foreign');
        const foreignMetadata: ModelMetadata = { ...metadata, modelVersion: '0.0.0-other' };
        const foreignInput = buildModelInput({
            metadata: foreignMetadata,
            source: window.source as never,
            data: window.data,
        });

        await expect(engine.run(foreignMetadata, foreignInput)).rejects.toMatchObject({
            code: 'model-compatibility-failure',
        });
    });

    it('refuses to run after the engine is disposed', async () => {
        const window = constantWindow(0.5, 'window-dispose');
        const input: ModelInput = buildModelInput({
            metadata,
            source: window.source as never,
            data: window.data,
        });
        const disposable = await createOnnxWebEngine({ metadata, modelBytes });
        await disposable.dispose();

        await expect(disposable.run(metadata, input)).rejects.toMatchObject({
            code: 'inference-failure',
        });
        await expect(disposable.run(metadata, input)).rejects.toBeInstanceOf(EcgError);
    });
});
