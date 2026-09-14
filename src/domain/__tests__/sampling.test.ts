import { describe, expect, it } from 'vitest';

import { EcgError } from '../error';
import {
    assertCompatibleSampleRate,
    createSamplingInfo,
    durationSecOf,
    equalSampleRate,
    sameSampling,
    sampleIndexOfTimeSec,
    timeSecOfSample,
} from '../sampling';

/** Runs `fn`, returning the classified code of any thrown EcgError. */
function errorCodeOf(fn: () => unknown): string | undefined {
    try {
        fn();
    } catch (err) {
        if (err instanceof EcgError) {
            return err.code;
        }
    }
    return undefined;
}

const AT_360 = createSamplingInfo(360);
const AT_360_START_2 = createSamplingInfo(360, 2);

describe('createSamplingInfo', () => {
    it('builds metadata with a default start offset of 0', () => {
        expect(AT_360).toEqual({ sampleRateHz: 360, startTimeSec: 0 });
    });

    it('honours an explicit start offset', () => {
        expect(AT_360_START_2).toEqual({ sampleRateHz: 360, startTimeSec: 2 });
    });

    it('returns a structurally immutable object', () => {
        expect(Object.isFrozen(AT_360)).toBe(true);
    });

    it('rejects non-positive and non-finite sample rates', () => {
        expect(errorCodeOf(() => createSamplingInfo(0))).toBe('invalid-input');
        expect(errorCodeOf(() => createSamplingInfo(-360))).toBe('invalid-input');
        expect(errorCodeOf(() => createSamplingInfo(Number.NaN))).toBe('invalid-input');
        expect(errorCodeOf(() => createSamplingInfo(Number.POSITIVE_INFINITY))).toBe(
            'invalid-input',
        );
    });

    it('rejects non-finite start offsets', () => {
        expect(errorCodeOf(() => createSamplingInfo(360, Number.NaN))).toBe(
            'invalid-input',
        );
    });
});

describe('durationSecOf', () => {
    it('uses the N/fs acquisition-window convention', () => {
        expect(durationSecOf(3600, 360)).toBe(10);
        expect(durationSecOf(650000, 360)).toBeCloseTo(650000 / 360, 10);
        expect(durationSecOf(0, 360)).toBe(0);
    });

    it('rejects invalid sample counts', () => {
        expect(errorCodeOf(() => durationSecOf(-1, 360))).toBe('invalid-input');
        expect(errorCodeOf(() => durationSecOf(1.5, 360))).toBe('invalid-input');
        expect(errorCodeOf(() => durationSecOf(Number.NaN, 360))).toBe('invalid-input');
    });
});

describe('timeSecOfSample', () => {
    it('maps sample index to seconds', () => {
        expect(timeSecOfSample(0, AT_360)).toBe(0);
        expect(timeSecOfSample(180, AT_360)).toBeCloseTo(0.5, 10);
        expect(timeSecOfSample(0, AT_360_START_2)).toBe(2);
        expect(timeSecOfSample(180, AT_360_START_2)).toBeCloseTo(2.5, 10);
    });

    it('rejects negative or non-integer indices', () => {
        expect(errorCodeOf(() => timeSecOfSample(-1, AT_360))).toBe('invalid-input');
        expect(errorCodeOf(() => timeSecOfSample(0.5, AT_360))).toBe('invalid-input');
        expect(errorCodeOf(() => timeSecOfSample(Number.NaN, AT_360))).toBe(
            'invalid-input',
        );
    });
});

describe('sampleIndexOfTimeSec', () => {
    it('rounds to the nearest sample by default', () => {
        expect(sampleIndexOfTimeSec(0.5, AT_360)).toBe(180);
        expect(sampleIndexOfTimeSec(2.5, AT_360_START_2)).toBe(180);
    });

    it('applies floor/round/ceil policies on fractional positions', () => {
        // raw position 90.5 samples
        const t = (90.5 / 360) as number;
        expect(sampleIndexOfTimeSec(t, AT_360, 'floor')).toBe(90);
        expect(sampleIndexOfTimeSec(t, AT_360, 'round')).toBe(91); // Math.round(90.5)
        expect(sampleIndexOfTimeSec(t, AT_360, 'ceil')).toBe(91);
    });

    it('does not clamp to a signal length (caller checks range)', () => {
        expect(sampleIndexOfTimeSec(-0.01, AT_360, 'floor')).toBe(-4);
    });
});

describe('sample-rate compatibility', () => {
    it('equalSampleRate is exact and symmetric', () => {
        expect(equalSampleRate(360, 360)).toBe(true);
        expect(equalSampleRate(360, 359.999)).toBe(false);
    });

    it('assertCompatibleSampleRate accepts matching rates', () => {
        expect(() => assertCompatibleSampleRate(360, 360)).not.toThrow();
    });

    it('assertCompatibleSampleRate reports a classified error on mismatch', () => {
        expect(errorCodeOf(() => assertCompatibleSampleRate(360, 250))).toBe(
            'incompatible-sample-rate',
        );
    });

    it('sameSampling compares rate and start offset', () => {
        expect(sameSampling(AT_360, createSamplingInfo(360))).toBe(true);
        expect(sameSampling(AT_360, AT_360_START_2)).toBe(false);
        expect(sameSampling(AT_360, createSamplingInfo(250))).toBe(false);
    });
});
