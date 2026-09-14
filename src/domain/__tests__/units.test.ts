import { describe, expect, it } from 'vitest';

import { EcgError } from '../error';
import {
    AMPLITUDE_UNITS,
    adcToMillivolt,
    assertValidAmplitudeUnit,
    isAmplitudeUnit,
    millivoltToAdc,
} from '../units';

/** MIT-BIH record 100 style calibration: 200 ADC counts per mV, baseline 0. */
const MIT_200 = { gain: 200, baseline: 0 } as const;

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

describe('amplitude units', () => {
    it('recognises exactly the supported units', () => {
        expect(AMPLITUDE_UNITS).toEqual(['adc', 'mV', 'normalized']);
        expect(isAmplitudeUnit('adc')).toBe(true);
        expect(isAmplitudeUnit('mV')).toBe(true);
        expect(isAmplitudeUnit('normalized')).toBe(true);
        expect(isAmplitudeUnit('V')).toBe(false);
        expect(isAmplitudeUnit('uV')).toBe(false);
        expect(isAmplitudeUnit('')).toBe(false);
        expect(isAmplitudeUnit(null)).toBe(false);
    });

    it('assertValidAmplitudeUnit accepts valid units and rejects others', () => {
        expect(() => assertValidAmplitudeUnit('mV')).not.toThrow();
        expect(() => assertValidAmplitudeUnit('volt')).toThrow(EcgError);
        expect(() => assertValidAmplitudeUnit(undefined)).toThrow(EcgError);
    });
});

describe('adcToMillivolt', () => {
    it('converts ADC counts to mV with gain 200 / baseline 0', () => {
        expect(adcToMillivolt(0, MIT_200)).toBe(0);
        expect(adcToMillivolt(200, MIT_200)).toBeCloseTo(1, 10);
        expect(adcToMillivolt(-200, MIT_200)).toBeCloseTo(-1, 10);
        expect(adcToMillivolt(512, MIT_200)).toBeCloseTo(2.56, 10);
    });

    it('applies a non-zero baseline (acquisition offset)', () => {
        const cal = { gain: 200, baseline: 1024 } as const;
        expect(adcToMillivolt(1024, cal)).toBe(0);
        expect(adcToMillivolt(1224, cal)).toBeCloseTo(1, 10);
    });

    it('is inverted by millivoltToAdc (round-trip)', () => {
        for (const adc of [0, 1, 512, 1023, 40_000, -512]) {
            const mv = adcToMillivolt(adc, MIT_200);
            expect(millivoltToAdc(mv, MIT_200)).toBeCloseTo(adc, 6);
        }
    });

    it('rejects invalid calibrations and non-finite samples', () => {
        expect(errorCodeOf(() => adcToMillivolt(1, { gain: 0, baseline: 0 }))).toBe(
            'invalid-input',
        );
        expect(errorCodeOf(() => adcToMillivolt(1, { gain: -200, baseline: 0 }))).toBe(
            'invalid-input',
        );
        expect(errorCodeOf(() => adcToMillivolt(1, { gain: Number.NaN, baseline: 0 }))).toBe(
            'invalid-input',
        );
        expect(
            errorCodeOf(() => adcToMillivolt(1, { gain: 200, baseline: Number.POSITIVE_INFINITY })),
        ).toBe('invalid-input');
        expect(errorCodeOf(() => adcToMillivolt(Number.NaN, MIT_200))).toBe(
            'invalid-input',
        );
        expect(errorCodeOf(() => adcToMillivolt(Number.POSITIVE_INFINITY, MIT_200))).toBe(
            'invalid-input',
        );
    });
});

describe('millivoltToAdc', () => {
    it('converts mV back to ADC counts', () => {
        expect(millivoltToAdc(0, MIT_200)).toBe(0);
        expect(millivoltToAdc(2.5, MIT_200)).toBeCloseTo(500, 10);
        expect(millivoltToAdc(2.56, MIT_200)).toBeCloseTo(512, 10);
    });

    it('rejects non-positive gain', () => {
        expect(errorCodeOf(() => millivoltToAdc(1, { gain: 0, baseline: 0 }))).toBe(
            'invalid-input',
        );
    });
});
