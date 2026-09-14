/**
 * Deterministic stub engine tests (Phase 6 / ADR-004) — TEST ONLY.
 *
 * The stub is a real InferenceEngine used to exercise the contract wiring: it
 * validates before executing, is deterministic, is self-consistent with the
 * metadata's declared output semantics, and honours its lifecycle (dispose).
 * Its numeric rule is arbitrary and carries no scientific meaning.
 */

import { describe, expect, it } from 'vitest';
import { EcgError } from '../../../domain/error';
import { createStubEngine, StubInferenceEngine } from '../stub';
import { makeMetadata, makeRawInput } from '../../__tests__/support';

async function rejectsCode(promise: Promise<unknown>, code: string): Promise<void> {
    let caught: unknown;
    try {
        await promise;
    } catch (cause) {
        caught = cause;
    }
    expect(caught instanceof EcgError).toBe(true);
    if (caught instanceof EcgError) {
        expect(caught.code).toBe(code);
    }
}

describe('StubInferenceEngine', () => {
    const metadata = makeMetadata();

    it('exposes a stable backend id defaulting to stub', () => {
        expect(createStubEngine().backendId).toBe('stub');
        expect(createStubEngine({ backendId: 'test-backend' }).backendId).toBe('test-backend');
        expect(createStubEngine()).toBeInstanceOf(StubInferenceEngine);
    });

    it('runs a compatible input and echoes the model metadata in its raw output', async () => {
        const engine = createStubEngine();
        const input = makeRawInput(metadata);
        const prediction = await engine.run(metadata, input);
        expect(prediction.modelId).toBe(metadata.modelId);
        expect(prediction.modelVersion).toBe(metadata.modelVersion);
        expect(prediction.outputName).toBe(metadata.output.name);
        expect(prediction.semantics).toBe(metadata.output.semantics);
        expect(prediction.values.length).toBe(metadata.output.classLabels.length);
        expect(Object.isFrozen(prediction)).toBe(true);
    });

    it('is deterministic: identical inputs give identical outputs', async () => {
        const engine = createStubEngine();
        const input = makeRawInput(metadata);
        const first = await engine.run(metadata, input);
        const second = await engine.run(metadata, input);
        expect(second.values).toEqual(first.values);
    });

    it('computes the documented deterministic raw logits from window statistics', async () => {
        const engine = createStubEngine();
        const input = makeRawInput(metadata); // constant 0.5
        const prediction = await engine.run(metadata, input);
        const mean = 0.5;
        const rms = 0.5;
        const classCount = metadata.output.classLabels.length;
        for (let index = 0; index < classCount; index += 1) {
            const expected = mean * 0.1 * (index + 1) + rms * 0.05 * (classCount - index);
            expect(prediction.values[index]!).toBeCloseTo(expected, 10);
        }
        // A higher-amplitude window shifts the (still raw) logits deterministically.
        const louder = await engine.run(
            metadata,
            makeRawInput(metadata, { data: new Float64Array(512).fill(1.0) }),
        );
        expect(louder.values[0]!).toBeGreaterThan(prediction.values[0]!);
    });

    it('lets a logit bias steer the argmax class', async () => {
        const engine = createStubEngine({ logitBias: [10, 0, 0, 0, 0] });
        const out = await engine.run(metadata, makeRawInput(metadata));
        let argmax = 0;
        for (let index = 1; index < out.values.length; index += 1) {
            if (out.values[index]! > out.values[argmax]!) {
                argmax = index;
            }
        }
        expect(argmax).toBe(0);
    });

    it('emits an activated probability vector for probabilities semantics', async () => {
        const probMetadata = makeMetadata({
            output: { semantics: 'probabilities', activation: 'softmax' },
        });
        const engine = createStubEngine();
        const result = await engine.run(probMetadata, makeRawInput(probMetadata));
        expect(result.semantics).toBe('probabilities');
        let total = 0;
        for (const value of result.values) {
            expect(value).toBeGreaterThan(0);
            total += value;
        }
        expect(total).toBeCloseTo(1, 6);
    });

    it('validates the input before executing (incompatible input is refused)', async () => {
        const engine = createStubEngine();
        await rejectsCode(
            engine.run(metadata, makeRawInput(metadata, { modelId: 'other' })),
            'model-compatibility-failure',
        );
    });

    it('refuses to run after dispose', async () => {
        const engine = createStubEngine();
        await engine.dispose();
        await rejectsCode(engine.run(metadata, makeRawInput(metadata)), 'inference-failure');
    });

    it('does not mutate its input payload', async () => {
        const data = new Float64Array(512);
        for (let index = 0; index < data.length; index += 1) {
            data[index] = Math.sin(index) * 0.1;
        }
        const snapshot = Float64Array.from(data);
        const input = makeRawInput(metadata, { data });
        const engine = createStubEngine();
        await engine.run(metadata, input);
        expect(input.data).toEqual(snapshot);
    });
});
