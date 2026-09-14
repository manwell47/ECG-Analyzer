/**
 * EDF calibration derivation and range accounting (Phase 18 item 6 / ADR-020,
 * architecture §J).
 *
 * EDF states, per signal, the physical span the signal was recorded across and
 * the digital span those values were stored as, so the ADC mapping is derived
 * from the file's own declaration rather than guessed:
 *
 * ```
 * gain     = (digitalMax - digitalMin) / (physicalMax - physicalMin)
 * baseline =  digitalMin - physicalMin * gain
 * ```
 *
 * That pair satisfies `physicalMin -> digitalMin` and `physicalMax ->
 * digitalMax` exactly, so `adcToMillivolt` reproduces the file's declared
 * mapping for every sample. This module performs no scaling of its own: the
 * ADC -> mV step stays single-sourced in `src/datasets/load.ts`
 * (`recordToMillivoltSignal`), exactly as MIT-BIH does (ADR-006).
 *
 * A file may nevertheless store a digit outside the range it declared. That is
 * a fact about the file, not a failure to hide: the sample is kept verbatim (a
 * signed 16-bit value the canonical channel can carry) and the deviation is
 * counted here so the adapter can record it as a provenance transform.
 */
import type { GainCalibration } from '../../domain/units';
import type { EdfSignalDescriptor } from './header';

/** Provenance transform name for samples outside a signal's declared range. */
export const EDF_OUT_OF_RANGE_STEP = 'edf-out-of-declared-range';

/** A signal's derived ADC calibration plus its declared ADC resolution. */
export interface EdfCalibration extends GainCalibration {
    /** Declared ADC resolution in bits: `ceil(log2(digitalSpan + 1))`. */
    readonly adcResolutionBits: number;
}

/**
 * Derive the ADC calibration an EDF signal declares.
 *
 * Both spans are guaranteed positive by {@link parseEdfHeader}, so `gain` is
 * always finite and > 0 and `baseline` always finite — the invariants
 * `createSignalRecord` requires of a channel calibration.
 */
export function edfCalibrationOf(signal: EdfSignalDescriptor): EdfCalibration {
    const physicalSpan = signal.physicalMax - signal.physicalMin;
    const digitalSpan = signal.digitalMax - signal.digitalMin;
    const gain = digitalSpan / physicalSpan;
    const baseline = signal.digitalMin - signal.physicalMin * gain;
    const adcResolutionBits = Math.ceil(Math.log2(digitalSpan + 1));
    return { gain, baseline, adcResolutionBits };
}

/**
 * Count the samples outside the digital range a signal declared (inclusive
 * bounds; a sample exactly at either bound is inside).
 */
export function countOutOfDeclaredRange(
    samples: Int16Array,
    signal: EdfSignalDescriptor,
): number {
    let count = 0;
    for (let index = 0; index < samples.length; index += 1) {
        const value = samples[index] ?? 0;
        if (value < signal.digitalMin || value > signal.digitalMax) {
            count += 1;
        }
    }
    return count;
}
