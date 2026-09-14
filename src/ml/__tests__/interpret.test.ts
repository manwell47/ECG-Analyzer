/**
 * Explicit output interpretation tests (Phase 6 / ADR-004; rules §18, §19, §49).
 *
 * interpretPrediction converts raw engine output into labelled scores whose
 * `semantics` truthfully state whether the value is a real probability or an
 * uncalibrated model score. Any inconsistency with the authoritative metadata
 * (identity, output name, semantics, class count) or a non-finite value fails
 * loudly as an `inference-failure`.
 */

import { describe, expect, it } from 'vitest';
import { EcgError } from '../../domain/error';
import { interpretPrediction } from '../interpret';
import { CLASS_LABELS, makeMetadata, makePrediction } from './support';

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

describe('logits + softmax (default fixture)', () => {
    const metadata = makeMetadata();

    it('converts logits into probabilities with the argmax class first', () => {
        const raw = Float64Array.from([0.1, 0.2, 3.0, 0.3, 0.4]);
        const interpreted = interpretPrediction(metadata, makePrediction(metadata, { values: raw }));
        expect(interpreted[0]!.label).toBe(CLASS_LABELS[2]);
        expect(interpreted[0]!.semantics).toBe('predicted-probability');
        expect(interpreted[0]!.score).toBeGreaterThan(0.5);
        const total = interpreted.reduce((sum, entry) => sum + entry.score, 0);
        expect(total).toBeCloseTo(1, 10);
        for (const entry of interpreted) {
            expect(entry.score).toBeGreaterThanOrEqual(0);
            expect(entry.score).toBeLessThanOrEqual(1);
        }
    });

    it('returns every declared class exactly once', () => {
        const raw = Float64Array.from([0.5, -1, 2, 0, 1]);
        const interpreted = interpretPrediction(metadata, makePrediction(metadata, { values: raw }));
        expect(interpreted).toHaveLength(CLASS_LABELS.length);
        expect(interpreted.map((entry) => entry.label).sort()).toEqual([...CLASS_LABELS].sort());
    });

    it('orders results by descending score', () => {
        const raw = Float64Array.from([0.5, -1, 2, 0, 1]);
        const interpreted = interpretPrediction(metadata, makePrediction(metadata, { values: raw }));
        for (let index = 1; index < interpreted.length; index += 1) {
            expect(interpreted[index]!.score).toBeLessThanOrEqual(interpreted[index - 1]!.score);
        }
        expect(interpreted[0]!.score).toBeGreaterThan(interpreted[interpreted.length - 1]!.score);
    });

    it('breaks ties deterministically by declared class order', () => {
        const raw = Float64Array.from([1, 1, 0, 0, 0]);
        const interpreted = interpretPrediction(metadata, makePrediction(metadata, { values: raw }));
        expect(interpreted[0]!.label).toBe(CLASS_LABELS[0]);
        expect(interpreted[1]!.label).toBe(CLASS_LABELS[1]);
        expect(interpreted[0]!.score).toBe(interpreted[1]!.score);
    });
});

describe('semantics handling', () => {
    it('treats declared probabilities as already probabilities (no conversion)', () => {
        const metadata = makeMetadata({
            output: { semantics: 'probabilities', activation: 'softmax' },
        });
        const values = Float64Array.from([0.6, 0.2, 0.1, 0.05, 0.05]);
        const interpreted = interpretPrediction(metadata, makePrediction(metadata, { values }));
        expect(interpreted[0]!.semantics).toBe('predicted-probability');
        expect(interpreted[0]!.label).toBe(CLASS_LABELS[0]);
        expect(interpreted[0]!.score).toBeCloseTo(0.6, 10);
    });

    it('surfaces logits with no declared activation as uncalibrated model-scores', () => {
        const metadata = makeMetadata({ output: { activation: 'none' } });
        const values = Float64Array.from([-2, -1, 0, 1, 2]);
        const interpreted = interpretPrediction(metadata, makePrediction(metadata, { values }));
        expect(interpreted[0]!.semantics).toBe('model-score');
        expect(interpreted[0]!.label).toBe(CLASS_LABELS[4]);
        expect(interpreted[0]!.score).toBe(2);
    });

    it('never converts model-scores, even when an activation is declared', () => {
        const metadata = makeMetadata({
            output: { semantics: 'model-scores', activation: 'softmax' },
        });
        const values = Float64Array.from([-5, -1, 0, 1, 5]);
        const interpreted = interpretPrediction(metadata, makePrediction(metadata, { values }));
        expect(interpreted[0]!.semantics).toBe('model-score');
        expect(interpreted[0]!.label).toBe(CLASS_LABELS[4]);
        expect(interpreted[0]!.score).toBe(5);
    });
});

describe('inconsistent predictions fail loudly', () => {
    const metadata = makeMetadata();

    it('rejects a prediction whose model identity does not match the metadata', () => {
        throwsCode(
            () => interpretPrediction(metadata, makePrediction(metadata, { modelId: 'other' })),
            'inference-failure',
        );
    });

    it('rejects a mismatched model version', () => {
        throwsCode(
            () =>
                interpretPrediction(metadata, makePrediction(metadata, { modelVersion: '2.0.0' })),
            'inference-failure',
        );
    });

    it('rejects a prediction from an undeclared output', () => {
        throwsCode(
            () => interpretPrediction(metadata, makePrediction(metadata, { outputName: 'other' })),
            'inference-failure',
        );
    });

    it('rejects a prediction whose semantics disagree with the metadata', () => {
        throwsCode(
            () =>
                interpretPrediction(metadata, makePrediction(metadata, { semantics: 'model-scores' })),
            'inference-failure',
        );
    });

    it('rejects a value count that does not match the declared classes', () => {
        throwsCode(
            () =>
                interpretPrediction(
                    metadata,
                    makePrediction(metadata, { values: new Float64Array(3).fill(0) }),
                ),
            'inference-failure',
        );
    });

    it('rejects non-finite raw values', () => {
        const values = new Float64Array(5).fill(0);
        values[2] = Number.NaN;
        throwsCode(
            () => interpretPrediction(metadata, makePrediction(metadata, { values })),
            'inference-failure',
        );
    });
});
