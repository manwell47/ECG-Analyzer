/**
 * Basic statistical measurements over deterministic sample arrays.
 *
 * These record the *measured* properties of synthetic fixtures (independent of
 * any implementation being validated) so that (a) each fixture carries its
 * recorded mathematical properties and (b) tests can assert that a generated
 * signal matches its declared recipe — the "signal has the property it claims"
 * check that makes fixtures meaningful rather than just deterministic bytes.
 */

export interface BasicStats {
    readonly sampleCount: number;
    readonly min: number;
    readonly max: number;
    readonly mean: number;
    readonly rms: number;
    /** Index of the sample with the largest absolute value (first occurrence). */
    readonly peakAbsIndex: number;
    readonly peakAbsValue: number;
}

/** Throw-style guard mirroring the domain invariant: no empty signal stats. */
function assertNonEmpty(n: number): void {
    if (n === 0) {
        throw new Error('basicStats requires at least one sample.');
    }
}

export function basicStats(samples: ArrayLike<number>): BasicStats {
    const n = samples.length;
    assertNonEmpty(n);

    let min = samples[0]!;
    let max = samples[0]!;
    let sum = 0;
    let sumSq = 0;
    let peakAbsIndex = 0;
    let peakAbsValue = Math.abs(samples[0]!);

    for (let i = 0; i < n; i += 1) {
        const value = samples[i]!;
        if (value < min) {
            min = value;
        }
        if (value > max) {
            max = value;
        }
        sum += value;
        sumSq += value * value;
        const absValue = Math.abs(value);
        if (absValue > peakAbsValue) {
            peakAbsValue = absValue;
            peakAbsIndex = i;
        }
    }

    return {
        sampleCount: n,
        min,
        max,
        mean: sum / n,
        rms: Math.sqrt(sumSq / n),
        peakAbsIndex,
        peakAbsValue,
    };
}

/**
 * Estimate the fundamental frequency (Hz) of a near-sinusoidal, zero-mean
 * signal from the *mean spacing between consecutive upward zero crossings*.
 *
 * Spacing-based estimation is window-boundary insensitive: unlike dividing a
 * crossing count by the window duration, it does not care whether a cycle is
 * clipped at either end of the window. It is exact for signals containing
 * several integer cycles regardless of phase — important because a phase-0 sine
 * evaluates to a tiny negative (not exactly 0) at whole-period samples in
 * floating point, which would otherwise drop a boundary crossing.
 */
export function estimateFrequencyHzZeroCrossing(
    samples: ArrayLike<number>,
    sampleRateHz: number,
): number {
    const n = samples.length;
    assertNonEmpty(n);
    if (sampleRateHz <= 0 || !Number.isFinite(sampleRateHz)) {
        throw new Error('estimateFrequencyHzZeroCrossing requires fs > 0.');
    }

    const crossings: number[] = [];
    for (let i = 1; i < n; i += 1) {
        const previous = samples[i - 1]!;
        const current = samples[i]!;
        if (previous < 0 && current >= 0) {
            crossings.push(i);
        }
    }
    if (crossings.length < 2) {
        throw new Error(
            'estimateFrequencyHzZeroCrossing requires at least two upward zero crossings.',
        );
    }

    // One full cycle elapses between consecutive upward crossings.
    let gapSum = 0;
    for (let k = 1; k < crossings.length; k += 1) {
        gapSum += crossings[k]! - crossings[k - 1]!;
    }
    const meanGap = gapSum / (crossings.length - 1);
    return sampleRateHz / meanGap;
}
