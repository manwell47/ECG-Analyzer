import { describe, expect, it } from 'vitest';
import {
    crossCorrelationShift,
    DB4_DEC_HI,
    DB4_DEC_LO,
    DB4_NAME,
    DB4_ORDER,
    DB4_REC_HI,
    DB4_REC_LO,
    DB4_TAP_COUNT,
    innerProduct,
    qmfHighpass,
    reconstructionHighpass,
    reconstructionLowpass,
    sum,
    sumSquares,
} from '../db4';
import { loadGoldenDb4File } from '../golden';

const SQRT_2 = Math.sqrt(2);

describe('Db4 decomposition filter', () => {
    it('exposes the declared wavelet identity', () => {
        expect(DB4_NAME).toBe('db4');
        expect(DB4_ORDER).toBe(4);
        expect(DB4_TAP_COUNT).toBe(8);
        expect(DB4_DEC_LO).toHaveLength(8);
    });

    it('is unit-energy scaling filter summing to sqrt(2)', () => {
        // Tolerance 1e-11: the published taps are 16-digit decimal truncations,
        // so accumulated sums/squares carry ~1e-12 round-off vs the ideal values.
        expect(sum(DB4_DEC_LO)).toBeCloseTo(SQRT_2, 11);
        expect(sumSquares(DB4_DEC_LO)).toBeCloseTo(1, 11);
    });

    it('is orthogonal to its own even shifts (2 and 4)', () => {
        expect(crossCorrelationShift(DB4_DEC_LO, DB4_DEC_LO, 0)).toBeCloseTo(1, 11);
        expect(crossCorrelationShift(DB4_DEC_LO, DB4_DEC_LO, 2)).toBeCloseTo(0, 12);
        expect(crossCorrelationShift(DB4_DEC_LO, DB4_DEC_LO, 4)).toBeCloseTo(0, 12);
    });

    it('keeps its coefficients finite and in the expected range', () => {
        for (const tap of DB4_DEC_LO) {
            expect(Number.isFinite(tap)).toBe(true);
            expect(Math.abs(tap)).toBeLessThanOrEqual(1);
        }
    });
});

describe('QMF high-pass derivation', () => {
    it('implements g[n] = (-1)^n h[N-1-n]', () => {
        const n = DB4_DEC_LO.length;
        for (let k = 0; k < n; k += 1) {
            const sign = k % 2 === 0 ? 1 : -1;
            expect(DB4_DEC_HI[k]).toBeCloseTo(
                sign * DB4_DEC_LO[n - 1 - k]!,
                12,
            );
        }
    });

    it('is zero-sum, unit-energy and orthogonal to the low-pass', () => {
        expect(sum(DB4_DEC_HI)).toBeCloseTo(0, 12);
        expect(sumSquares(DB4_DEC_HI)).toBeCloseTo(1, 11);
        for (const shift of [-4, -2, 0, 2, 4]) {
            expect(crossCorrelationShift(DB4_DEC_HI, DB4_DEC_LO, shift)).toBeCloseTo(
                0,
                10,
            );
        }
    });

    it('matches the explicit qmfHighpass helper', () => {
        expect(DB4_DEC_HI).toEqual(qmfHighpass(DB4_DEC_LO));
    });
});

describe('reconstruction filter derivation', () => {
    it('time-reverses the analysis filters', () => {
        const reversedLo = [...DB4_DEC_LO].reverse();
        const reversedHi = [...DB4_DEC_HI].reverse();
        expect(DB4_REC_LO).toEqual(reversedLo);
        expect(DB4_REC_HI).toEqual(reversedHi);
        expect(DB4_REC_LO).toEqual(reconstructionLowpass(DB4_DEC_LO));
        expect(DB4_REC_HI).toEqual(reconstructionHighpass(DB4_DEC_LO));
    });

    it('preserves energy under time reversal', () => {
        expect(sumSquares(DB4_REC_LO)).toBeCloseTo(1, 11);
        expect(sumSquares(DB4_REC_HI)).toBeCloseTo(1, 11);
    });
});

describe('algebraic helpers', () => {
    it('innerProduct matches a manual dot product', () => {
        const a = [1, 2, 3];
        const b = [4, 5, 6];
        expect(innerProduct(a, b)).toBe(4 + 10 + 18);
    });
});

describe('committed db4 golden file agrees with the module', () => {
    // The committed file is read lazily inside each test so a first-run
    // generation (golden.test beforeAll writes it) can never race collection.
    it('records the same filterbank as the single-source module', () => {
        const file = loadGoldenDb4File();
        expect(file.wavelet).toBe(DB4_NAME);
        expect(file.order).toBe(DB4_ORDER);
        expect(file.tapCount).toBe(DB4_TAP_COUNT);
        expect(file.dec_lo).toEqual([...DB4_DEC_LO]);
        expect(file.dec_hi).toEqual([...DB4_DEC_HI]);
        expect(file.rec_lo).toEqual([...DB4_REC_LO]);
        expect(file.rec_hi).toEqual([...DB4_REC_HI]);
    });

    it('records invariants that still hold against the module', () => {
        const file = loadGoldenDb4File();
        expect(file.invariants.sumDecLo).toBeCloseTo(sum(DB4_DEC_LO), 12);
        expect(file.invariants.sumSquaresDecLo).toBeCloseTo(sumSquares(DB4_DEC_LO), 12);
        expect(file.invariants.sumDecHi).toBeCloseTo(sum(DB4_DEC_HI), 12);
        expect(file.invariants.sumSquaresDecHi).toBeCloseTo(
            sumSquares(DB4_DEC_HI),
            12,
        );
    });

    it('carries a provenance note rather than an empty string', () => {
        const file = loadGoldenDb4File();
        expect(file.provenance.length).toBeGreaterThan(50);
    });
});
