/**
 * Amplitude units and explicit ADC <-> physical-unit (mV) calibration.
 *
 * Rationale: MIT-BIH and other WFDB records store raw ADC integer samples with
 * a per-channel `gain` (ADC counts per physical unit). Sample *value* is
 * meaningless without its unit + calibration, so conversions are explicit,
 * validated, and never inferred from context (see ADR-001).
 */

import { EcgError } from './error';
import { assertFiniteNumber, assertPositiveNumber } from './numeric';

/** Physical amplitude representations understood by the domain layer. */
export type AmplitudeUnit = 'adc' | 'mV' | 'normalized';

export const AMPLITUDE_UNITS: readonly AmplitudeUnit[] = [
    'adc',
    'mV',
    'normalized',
] as const;

export function isAmplitudeUnit(value: unknown): value is AmplitudeUnit {
    return (
        typeof value === 'string' &&
        (AMPLITUDE_UNITS as readonly string[]).includes(value)
    );
}

export function assertValidAmplitudeUnit(
    value: unknown,
    label = 'amplitude unit',
): asserts value is AmplitudeUnit {
    if (!isAmplitudeUnit(value)) {
        throw EcgError.invalidInput(
            `Expected ${label} to be one of ${AMPLITUDE_UNITS.join(', ')}; ` +
            `received ${JSON.stringify(value)}.`,
        );
    }
}

/**
 * ADC-to-physical calibration for one channel.
 *
 * `gain` is expressed in ADC counts per physical unit (mV) — e.g. 200 for
 * MIT-BIH record 100. `baseline` is the ADC value that maps to zero physical
 * amplitude (commonly 0, sometimes 1024 on certain acquisition hardware).
 */
export interface GainCalibration {
    /** ADC counts per mV. Must be finite and > 0. */
    readonly gain: number;
    /** ADC value corresponding to zero amplitude. Defaults to 0. */
    readonly baseline: number;
}

/**
 * Convert a raw ADC sample to millivolts: `(adc - baseline) / gain`.
 */
export function adcToMillivolt(
    adcValue: number,
    calibration: GainCalibration,
): number {
    assertFiniteNumber(adcValue, 'ADC sample value');
    assertPositiveNumber(calibration.gain, 'gain');
    assertFiniteNumber(calibration.baseline, 'baseline');
    return (adcValue - calibration.baseline) / calibration.gain;
}

/**
 * Convert a millivolt value back to raw ADC counts: `mV * gain + baseline`.
 * Inverse of {@link adcToMillivolt} (up to floating-point rounding).
 */
export function millivoltToAdc(
    millivoltValue: number,
    calibration: GainCalibration,
): number {
    assertFiniteNumber(millivoltValue, 'physical (mV) value');
    assertPositiveNumber(calibration.gain, 'gain');
    assertFiniteNumber(calibration.baseline, 'baseline');
    return millivoltValue * calibration.gain + calibration.baseline;
}
