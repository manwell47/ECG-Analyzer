/**
 * Pure coefficient-geometry tests (Phase 7 item #10).
 *
 * Node environment (no `// @vitest-environment jsdom` directive) — the module
 * under test is DOM-free, so these unit tests run in the global Node default.
 * Every assertion is about pure arithmetic over levels, sample rates and
 * coefficient buffers: octave frequency bands (flagged approximate), per-level
 * strides, original-sample -> coefficient-index mapping and min/max column
 * decimation. The canvas that consumes these helpers is exercised separately
 * in the jsdom `DwtCoefficientView.test.ts` slice.
 */

import { describe, expect, it } from 'vitest';

import {
    approximationFrequencyBandHz,
    coefficientAmplitudeBounds,
    coefficientEnvelopeColumns,
    coefficientIndexRangeOfWindow,
    coefficientStrideSamples,
    coefficientStrideSec,
    detailFrequencyBandHz,
    formatFrequencyHz,
} from '../coefficientGeometry';

const HZ = 360;
const LEVEL = 4;

describe('coefficient stride (original samples and seconds per coefficient)', () => {
    it('is 2^level original samples per coefficient', () => {
        expect(coefficientStrideSamples(1)).toBe(2);
        expect(coefficientStrideSamples(2)).toBe(4);
        expect(coefficientStrideSamples(LEVEL)).toBe(16);
    });

    it('is the sample stride divided by the sample rate in seconds', () => {
        expect(coefficientStrideSec(1, HZ)).toBeCloseTo(2 / 360, 10);
        expect(coefficientStrideSec(LEVEL, HZ)).toBeCloseTo(16 / 360, 10);
    });

    it('rejects non-positive levels and invalid sample rates', () => {
        expect(() => coefficientStrideSamples(0)).toThrow(/DWT level/);
        expect(() => coefficientStrideSamples(-1)).toThrow(/DWT level/);
        expect(() => coefficientStrideSamples(1.5)).toThrow(/DWT level/);
        expect(() => coefficientStrideSec(1, 0)).toThrow(/Sample rate/);
        expect(() => coefficientStrideSec(1, Number.NaN)).toThrow(/Sample rate/);
        expect(() => coefficientStrideSec(1, -360)).toThrow(/Sample rate/);
    });
});

describe('octave frequency bands derived from fs (flagged approximate)', () => {
    it('gives the finest detail band the top octave up to the Nyquist rate', () => {
        expect(detailFrequencyBandHz(1, HZ)).toEqual({
            lowHz: 90,
            highHz: 180, // fs / 2 == Nyquist
            approximate: true,
        });
    });

    it('halves the band with each detail level', () => {
        expect(detailFrequencyBandHz(2, HZ)).toEqual({
            lowHz: 45,
            highHz: 90,
            approximate: true,
        });
        expect(detailFrequencyBandHz(3, HZ)).toEqual({
            lowHz: 22.5,
            highHz: 45,
            approximate: true,
        });
        expect(detailFrequencyBandHz(LEVEL, HZ)).toEqual({
            lowHz: 11.25,
            highHz: 22.5,
            approximate: true,
        });
    });

    it('covers [0, fs/2^(level+1)] for the final approximation', () => {
        expect(approximationFrequencyBandHz(1, HZ)).toEqual({
            lowHz: 0,
            highHz: 90,
            approximate: true,
        });
        expect(approximationFrequencyBandHz(LEVEL, HZ)).toEqual({
            lowHz: 0,
            highHz: 11.25,
            approximate: true,
        });
    });

    it('tiles the whole Nyquist interval contiguously', () => {
        // A4 high edge == D4 low edge; D1 high edge == Nyquist == fs/2.
        expect(approximationFrequencyBandHz(LEVEL, HZ).highHz).toBe(
            detailFrequencyBandHz(LEVEL, HZ).lowHz,
        );
        expect(detailFrequencyBandHz(1, HZ).highHz).toBe(HZ / 2);
        // Every returned band is explicitly flagged approximate (ADR-003).
        expect(detailFrequencyBandHz(1, HZ).approximate).toBe(true);
        expect(approximationFrequencyBandHz(LEVEL, HZ).approximate).toBe(true);
    });

    it('rejects invalid levels and sample rates', () => {
        expect(() => detailFrequencyBandHz(0, HZ)).toThrow(/DWT level/);
        expect(() => detailFrequencyBandHz(-LEVEL, HZ)).toThrow(/DWT level/);
        expect(() => detailFrequencyBandHz(1.25, HZ)).toThrow(/DWT level/);
        expect(() => detailFrequencyBandHz(1, 0)).toThrow(/Sample rate/);
        expect(() => detailFrequencyBandHz(1, Number.POSITIVE_INFINITY)).toThrow(
            /Sample rate/,
        );
        expect(() => approximationFrequencyBandHz(1, Number.NaN)).toThrow(
            /Sample rate/,
        );
    });
});

describe('coefficient index range (original sample window -> coefficient indices)', () => {
    it('maps the full record to the whole band for every level', () => {
        // 3600 original samples: level 1 -> 1800 coeffs, level 4 -> 225 coeffs.
        expect(
            coefficientIndexRangeOfWindow(
                { startSample: 0, endSample: 3600 },
                1,
                1800,
            ),
        ).toEqual({ startCoefficient: 0, endCoefficient: 1800 });
        expect(
            coefficientIndexRangeOfWindow(
                { startSample: 0, endSample: 3600 },
                LEVEL,
                225,
            ),
        ).toEqual({ startCoefficient: 0, endCoefficient: 225 });
    });

    it('maps aligned edges exactly (coefficient k covers [k*stride, (k+1)*stride))', () => {
        // Level 1 stride 2: original samples [200, 300) == coefficients [100, 150).
        expect(
            coefficientIndexRangeOfWindow(
                { startSample: 200, endSample: 300 },
                1,
                1800,
            ),
        ).toEqual({ startCoefficient: 100, endCoefficient: 150 });
    });

    it('rounds fractional edges outward so visible coefficients never shrink', () => {
        // [201, 299) touches coefficient 100 (samples 200-202) through 149.
        expect(
            coefficientIndexRangeOfWindow(
                { startSample: 201, endSample: 299 },
                1,
                1800,
            ),
        ).toEqual({ startCoefficient: 100, endCoefficient: 150 });
        // Level 2 stride 4: [205, 210) touches coefficients 51 (204-208) and 52.
        expect(
            coefficientIndexRangeOfWindow(
                { startSample: 205, endSample: 210 },
                2,
                900,
            ),
        ).toEqual({ startCoefficient: 51, endCoefficient: 53 });
    });

    it('clamps a window off the end of the record to an empty tail', () => {
        expect(
            coefficientIndexRangeOfWindow(
                { startSample: 5000, endSample: 5100 },
                LEVEL,
                225,
            ),
        ).toEqual({ startCoefficient: 225, endCoefficient: 225 });
    });

    it('returns an empty range for a degenerate window', () => {
        expect(
            coefficientIndexRangeOfWindow(
                { startSample: 5, endSample: 5 },
                LEVEL,
                225,
            ),
        ).toEqual({ startCoefficient: 0, endCoefficient: 0 });
    });

    it('rejects malformed windows and counts', () => {
        expect(() =>
            coefficientIndexRangeOfWindow(
                { startSample: -1, endSample: 3 },
                1,
                10,
            ),
        ).toThrow(/window start sample/);
        expect(() =>
            coefficientIndexRangeOfWindow(
                { startSample: 0, endSample: 3 },
                0,
                10,
            ),
        ).toThrow(/DWT level/);
        expect(() =>
            coefficientIndexRangeOfWindow(
                { startSample: 0, endSample: 3 },
                1,
                0,
            ),
        ).toThrow(/coefficient count/);
        expect(() =>
            coefficientIndexRangeOfWindow(
                { startSample: 0, endSample: 1.5 },
                1,
                10,
            ),
        ).toThrow(/window end sample/);
    });
});

describe('coefficient envelope decimation (min/max per column)', () => {
    const COEFFICIENTS = [1, 3, -2, 4, -5] as const;

    it('reduces the whole range to one column for a single pixel', () => {
        const columns = coefficientEnvelopeColumns(
            COEFFICIENTS,
            { startCoefficient: 0, endCoefficient: 5 },
            1,
        );
        expect(columns).toEqual([
            {
                startSample: 0,
                endSample: 5,
                populated: true,
                min: -5,
                max: 4,
            },
        ]);
    });

    it('partitions into contiguous coefficient-index columns with floor edges', () => {
        const columns = coefficientEnvelopeColumns(
            COEFFICIENTS,
            { startCoefficient: 0, endCoefficient: 5 },
            3,
        );
        // Partition of [0,5) into 3 columns: [0,1), [1,3), [3,5).
        expect(columns.map((column) => column.startSample)).toEqual([0, 1, 3]);
        expect(columns.map((column) => column.endSample)).toEqual([1, 3, 5]);
        expect(columns[0]).toMatchObject({ populated: true, min: 1, max: 1 });
        expect(columns[1]).toMatchObject({ populated: true, min: -2, max: 3 });
        expect(columns[2]).toMatchObject({ populated: true, min: -5, max: 4 });
    });

    it('leaves unused pixel positions as empty columns when columns exceed samples', () => {
        const columns = coefficientEnvelopeColumns(
            COEFFICIENTS,
            { startCoefficient: 0, endCoefficient: 2 },
            4,
        );
        expect(columns).toHaveLength(4);
        // 2 coefficients across 4 pixel columns: floor-edge buckets are
        // [0,0), [0,1), [1,1), [1,2) so the two visible coefficients (indices
        // 0 and 1) each appear exactly once and two positions stay empty.
        const populated = columns.filter((column) => column.populated);
        expect(populated).toHaveLength(2);
        expect(populated.map((column) => [column.startSample, column.endSample])).toEqual([
            [0, 1],
            [1, 2],
        ]);
        expect(columns.some((column) => !column.populated)).toBe(true);
    });

    it('does not mutate the input buffer', () => {
        const source = Float64Array.from(COEFFICIENTS);
        const snapshot = Float64Array.from(source);
        coefficientEnvelopeColumns(
            source,
            { startCoefficient: 0, endCoefficient: 5 },
            2,
        );
        expect(Array.from(source)).toEqual(Array.from(snapshot));
    });

    it('returns no columns for an empty range', () => {
        expect(
            coefficientEnvelopeColumns(COEFFICIENTS, {
                startCoefficient: 3,
                endCoefficient: 3,
            }, 4),
        ).toEqual([]);
    });

    it('aggregates amplitude bounds over the populated columns', () => {
        const columns = coefficientEnvelopeColumns(
            COEFFICIENTS,
            { startCoefficient: 0, endCoefficient: 5 },
            2,
        );
        expect(coefficientAmplitudeBounds(columns)).toEqual({
            populated: true,
            min: -5,
            max: 4,
        });
        expect(
            coefficientAmplitudeBounds([
                { startSample: 0, endSample: 1, populated: false, min: 0, max: 0 },
            ]),
        ).toEqual({ populated: false, min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY });
    });

    it('rejects a non-positive column count', () => {
        expect(() =>
            coefficientEnvelopeColumns(COEFFICIENTS, {
                startCoefficient: 0,
                endCoefficient: 5,
            }, 0),
        ).toThrow(/column count/);
    });
});

describe('formatFrequencyHz (stable band-edge rendering)', () => {
    it('renders integers and exact binary halves without noise', () => {
        expect(formatFrequencyHz(0)).toBe('0');
        expect(formatFrequencyHz(90)).toBe('90');
        expect(formatFrequencyHz(180)).toBe('180');
        expect(formatFrequencyHz(22.5)).toBe('22.5');
        expect(formatFrequencyHz(11.25)).toBe('11.25');
        expect(formatFrequencyHz(0.5)).toBe('0.5');
    });

    it('rejects non-finite or negative frequencies', () => {
        expect(() => formatFrequencyHz(Number.NaN)).toThrow(/Frequency/);
        expect(() => formatFrequencyHz(Number.POSITIVE_INFINITY)).toThrow(
            /Frequency/,
        );
        expect(() => formatFrequencyHz(-1)).toThrow(/Frequency/);
    });
});
