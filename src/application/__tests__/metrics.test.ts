/**
 * Pure classification metrics tests (Phase 8 / ADR-007; rules §24, §47, §49).
 *
 * The metrics module is the single source of the numbers an experiment result
 * reports: every rate is computed from recorded outcomes, and a rate whose
 * denominator is undefined is `null`, never a fabricated 0/NaN. These tests pin
 * both the arithmetic and the honesty semantics.
 */
import { describe, expect, it } from 'vitest';
import { EcgError } from '../../domain/error';
import {
    computeClassificationMetrics,
    computeConfusionMatrix,
    type ClassifiedOutcome,
} from '../metrics';

/** The committed probe model's two declared classes (Phase 6/7). */
const BINARY = Object.freeze(['positive-mean', 'nonpositive-mean']);

function outcome(
    trueLabel: string,
    predictedLabel: string,
): ClassifiedOutcome {
    return Object.freeze({ trueLabel, predictedLabel });
}

function rate(label: string, outcomes: readonly ClassifiedOutcome[]): {
    precision: number | null;
    recall: number | null;
    specificity: number | null;
    f1: number | null;
    support: number;
    truePositives: number;
    falseNegatives: number;
    falsePositives: number;
    trueNegatives: number;
} {
    const metrics = computeClassificationMetrics(BINARY, outcomes);
    const entry = metrics.perClass.find((rateEntry) => rateEntry.label === label);
    if (entry === undefined) {
        throw new Error(`expected a per-class entry for "${label}"`);
    }
    return {
        precision: entry.precision,
        recall: entry.recall,
        specificity: entry.specificity,
        f1: entry.f1,
        support: entry.support,
        truePositives: entry.truePositives,
        falseNegatives: entry.falseNegatives,
        falsePositives: entry.falsePositives,
        trueNegatives: entry.trueNegatives,
    };
}

describe('confusion matrix', () => {
    it('tallies counts indexed [true][predicted] over the declared class order', () => {
        const outcomes = [
            outcome('positive-mean', 'positive-mean'),
            outcome('positive-mean', 'nonpositive-mean'),
            outcome('nonpositive-mean', 'positive-mean'),
            outcome('nonpositive-mean', 'nonpositive-mean'),
        ];
        const matrix = computeConfusionMatrix(BINARY, outcomes);
        expect(matrix.classLabels).toEqual(BINARY);
        expect(matrix.cells).toEqual([
            [1, 1],
            [1, 1],
        ]);
    });

    it('rejects an outcome whose true label is not declared', () => {
        let caught: unknown;
        try {
            computeConfusionMatrix(BINARY, [outcome('arrhythmia', 'positive-mean')]);
        } catch (cause) {
            caught = cause;
        }
        expect(caught instanceof EcgError).toBe(true);
        if (caught instanceof EcgError) {
            expect(caught.code).toBe('invalid-input');
        }
    });

    it('rejects an outcome whose predicted label is not declared', () => {
        let caught: unknown;
        try {
            computeConfusionMatrix(BINARY, [outcome('positive-mean', 'arrhythmia')]);
        } catch (cause) {
            caught = cause;
        }
        expect(caught instanceof EcgError).toBe(true);
        if (caught instanceof EcgError) {
            expect(caught.code).toBe('invalid-input');
        }
    });

    it('rejects an empty or duplicated declared class set', () => {
        let caught: unknown;
        try {
            computeConfusionMatrix([], []);
        } catch (cause) {
            caught = cause;
        }
        expect(caught instanceof EcgError).toBe(true);
        if (caught instanceof EcgError) {
            expect(caught.code).toBe('invalid-input');
        }

        let duplicate: unknown;
        try {
            computeConfusionMatrix(['a', 'a'], []);
        } catch (cause) {
            duplicate = cause;
        }
        expect(duplicate instanceof EcgError).toBe(true);
        if (duplicate instanceof EcgError) {
            expect(duplicate.code).toBe('invalid-input');
        }
    });
});

describe('perfect binary agreement', () => {
    const outcomes = [
        ...Array.from({ length: 6 }, () => outcome('positive-mean', 'positive-mean')),
        ...Array.from({ length: 4 }, () => outcome('nonpositive-mean', 'nonpositive-mean')),
    ];

    it('reports accuracy 1 and unit rates for both classes', () => {
        const metrics = computeClassificationMetrics(BINARY, outcomes);
        expect(metrics.total).toBe(10);
        expect(metrics.accuracy).toBe(1);
        for (const label of BINARY) {
            expect(rate(label, outcomes)).toMatchObject({
                precision: 1,
                recall: 1,
                specificity: 1,
                f1: 1,
            });
        }
    });

    it('records per-class support from the true labels', () => {
        expect(rate('positive-mean', outcomes).support).toBe(6);
        expect(rate('nonpositive-mean', outcomes).support).toBe(4);
    });
});

describe('an absent predicted class is reported honestly', () => {
    const outcomes = [
        outcome('positive-mean', 'positive-mean'),
        outcome('positive-mean', 'positive-mean'),
        outcome('positive-mean', 'positive-mean'),
        outcome('nonpositive-mean', 'positive-mean'),
    ];

    it('never fabricates precision/f1 for a class that is predicted nowhere', () => {
        expect(rate('nonpositive-mean', outcomes)).toMatchObject({
            support: 1,
            truePositives: 0,
            falseNegatives: 1,
            falsePositives: 0,
            trueNegatives: 3,
            precision: null,
            recall: 0,
            specificity: 1,
            f1: 0,
        });
    });

    it('computes the predicted class with its real false positives', () => {
        expect(rate('positive-mean', outcomes)).toMatchObject({
            support: 3,
            truePositives: 3,
            falseNegatives: 0,
            falsePositives: 1,
            trueNegatives: 0,
            precision: 0.75,
            recall: 1,
            specificity: 0,
        });
        expect(rate('positive-mean', outcomes).f1).toBeCloseTo(6 / 7, 12);
        expect(computeClassificationMetrics(BINARY, outcomes).accuracy).toBe(0.75);
    });
});

describe('multi-class confusion arithmetic', () => {
    const labels = ['a', 'b', 'c'];
    const outcomes = [
        outcome('a', 'a'),
        outcome('a', 'b'),
        outcome('b', 'b'),
        outcome('b', 'c'),
        outcome('c', 'a'),
    ];

    it('counts every cell and derives rates per class', () => {
        const metrics = computeClassificationMetrics(labels, outcomes);
        expect(metrics.confusion.cells).toEqual([
            [1, 1, 0],
            [0, 1, 1],
            [1, 0, 0],
        ]);
        expect(metrics.total).toBe(5);
        expect(metrics.accuracy).toBe(0.4);

        const a = metrics.perClass.find((entry) => entry.label === 'a')!;
        expect(a).toMatchObject({
            support: 2,
            truePositives: 1,
            falseNegatives: 1,
            falsePositives: 1,
            trueNegatives: 2,
            precision: 0.5,
            recall: 0.5,
            specificity: 2 / 3,
            f1: 0.5,
        });

        const c = metrics.perClass.find((entry) => entry.label === 'c')!;
        expect(c).toMatchObject({
            support: 1,
            truePositives: 0,
            falseNegatives: 1,
            falsePositives: 1,
            trueNegatives: 3,
            precision: 0,
            recall: 0,
            specificity: 0.75,
            f1: 0,
        });
    });
});

describe('degenerate evaluations stay honest', () => {
    it('reports accuracy null and all-null rates for no outcomes', () => {
        const metrics = computeClassificationMetrics(BINARY, []);
        expect(metrics.total).toBe(0);
        expect(metrics.accuracy).toBe(null);
        for (const label of BINARY) {
            expect(rate(label, [])).toMatchObject({
                support: 0,
                truePositives: 0,
                falseNegatives: 0,
                falsePositives: 0,
                trueNegatives: 0,
                precision: null,
                recall: null,
                specificity: null,
                f1: null,
            });
        }
    });

    it('does not report a positive specificity for a class never seen at all', () => {
        const outcomes = [outcome('positive-mean', 'positive-mean')];
        const metrics = computeClassificationMetrics(BINARY, outcomes);
        const unseen = metrics.perClass.find(
            (entry) => entry.label === 'nonpositive-mean',
        )!;
        expect(unseen).toMatchObject({
            support: 0,
            precision: null,
            recall: null,
            f1: null,
        });
    });
});

describe('determinism and hygiene', () => {
    it('is deterministic across repeated computation', () => {
        const outcomes = [
            outcome('positive-mean', 'positive-mean'),
            outcome('nonpositive-mean', 'nonpositive-mean'),
            outcome('nonpositive-mean', 'positive-mean'),
        ];
        const first = computeClassificationMetrics(BINARY, outcomes);
        const second = computeClassificationMetrics(BINARY, outcomes);
        expect(second).toEqual(first);
    });

    it('does not mutate the caller outcome sequence', () => {
        const outcomes = [
            outcome('positive-mean', 'positive-mean'),
            outcome('nonpositive-mean', 'positive-mean'),
        ];
        const snapshot = outcomes.map((entry) => ({ ...entry }));
        computeClassificationMetrics(BINARY, outcomes);
        expect(outcomes.map((entry) => ({ ...entry }))).toEqual(snapshot);
    });
});
