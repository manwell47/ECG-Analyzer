/**
 * InferenceEngine boundary tests (Phase 6 / ADR-004; rules §16).
 *
 * Shape helpers plus the pre-execution compatibility validator: a realized input
 * is refused before execution unless identity, tensor name, dtype, concrete
 * shape and the preprocessing fingerprint all agree with the model metadata.
 * Shape compatibility alone is never treated as scientific compatibility.
 */

import { describe, expect, it } from 'vitest';
import { EcgError } from '../../domain/error';
import type { ModelInput } from '../../domain/ml';
import {
    assertInputCompatibleWithModel,
    describeInputCompatibilityProblems,
    isConcreteShape,
    realizeShape,
    tensorElementCount,
} from '../engine';
import { makeMetadata, makeRawInput } from './support';

describe('shape helpers', () => {
    it('isConcreteShape requires every dimension to be a positive integer', () => {
        expect(isConcreteShape([1, 1, 512])).toBe(true);
        expect(isConcreteShape([-1, 1, 512])).toBe(false);
        expect(isConcreteShape([1, 0, 512])).toBe(false);
        expect(isConcreteShape([1, 1.5, 512])).toBe(false);
    });

    it('tensorElementCount multiplies concrete dimensions and is undefined otherwise', () => {
        expect(tensorElementCount([1, 1, 512])).toBe(512);
        expect(tensorElementCount([1, 2, 3])).toBe(6);
        expect(tensorElementCount([-1, 1, 512])).toBeUndefined();
    });

    it('realizeShape resolves dynamic axes against a flat element count', () => {
        expect(realizeShape([-1, 1, 512], 512)).toEqual([1, 1, 512]);
        expect(realizeShape([1, 1, 512], 512)).toEqual([1, 1, 512]);
        expect(realizeShape([-1, -1, 512], 1024)).toEqual([2, 2, 512]);
    });

    it('realizeShape returns undefined when a count cannot be represented', () => {
        expect(realizeShape([1, 1, 512], 1024)).toBeUndefined();
        expect(realizeShape([-1, 1, 512], 100)).toBeUndefined();
        expect(realizeShape([0, 1, 512], 512)).toBeUndefined();
    });
});

describe('describeInputCompatibilityProblems', () => {
    const metadata = makeMetadata();
    const problems = (input: ModelInput): string =>
        describeInputCompatibilityProblems(metadata, input).join('\n');

    it('reports no problems for a fully compatible realized input', () => {
        expect(describeInputCompatibilityProblems(metadata, makeRawInput(metadata))).toEqual([]);
    });

    it('flags identity, tensor name and dtype mismatches', () => {
        expect(problems(makeRawInput(metadata, { modelId: 'other' }))).toMatch(
            /input targets model "other"/,
        );
        expect(problems(makeRawInput(metadata, { modelVersion: '9.9.9' }))).toMatch(
            /input targets version "9.9.9"/,
        );
        expect(problems(makeRawInput(metadata, { tensorName: 'other' }))).toMatch(
            /input feeds tensor "other"/,
        );
        expect(problems(makeRawInput(metadata, { dtype: 'float64' }))).toMatch(
            /input dtype is float64/,
        );
    });

    it('flags shape rank, concreteness and element-count mismatches', () => {
        expect(problems(makeRawInput(metadata, { shape: [1, 512] }))).toMatch(
            /declared rank 3 but the input has rank 2/,
        );
        expect(problems(makeRawInput(metadata, { shape: [-1, 1, 512] }))).toMatch(
            /input shape must be fully concrete/,
        );
        expect(problems(makeRawInput(metadata, { shape: [1, 1, 513] }))).toMatch(
            /implies 513 elements/,
        );
    });

    it('flags a preprocessing fingerprint mismatch even when the shape matches', () => {
        const compatible = makeRawInput(metadata);
        const sameShapeDifferentPreprocessing = {
            ...compatible,
            preprocessingFingerprint: 'deadbeef',
        };
        const reported = describeInputCompatibilityProblems(
            metadata,
            sameShapeDifferentPreprocessing,
        );
        expect(reported.join('\n')).toMatch(
            /preprocessing\/normalization fingerprint does not match/,
        );
    });

    it('aggregates every mismatch rather than stopping at the first', () => {
        const reported = describeInputCompatibilityProblems(
            metadata,
            makeRawInput(metadata, { modelId: 'other', dtype: 'float64', tensorName: 'x' }),
        );
        expect(reported.length).toBeGreaterThanOrEqual(3);
    });
});

describe('assertInputCompatibleWithModel', () => {
    const metadata = makeMetadata();

    it('does not throw for a compatible input', () => {
        expect(() => assertInputCompatibleWithModel(metadata, makeRawInput(metadata))).not.toThrow();
    });

    it('throws a single classified model-compatibility-failure carrying problems', () => {
        let caught: unknown;
        try {
            assertInputCompatibleWithModel(metadata, makeRawInput(metadata, { modelId: 'other' }));
        } catch (cause) {
            caught = cause;
        }
        expect(caught instanceof EcgError).toBe(true);
        if (caught instanceof EcgError) {
            expect(caught.code).toBe('model-compatibility-failure');
            expect(Array.isArray(caught.context.meta?.problems)).toBe(true);
        }
    });
});
