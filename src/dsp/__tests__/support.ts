/**
 * Shared builders for DSP tests (not a test file itself).
 *
 * Test signals are built at a chosen fs/unit and wrapped into real domain
 * `Signal` values so the DSP primitives are exercised through their public
 * domain-types API (never raw arrays).
 */

import {
    createSamplingInfo,
    createSignal,
    type Signal,
} from '../../domain';

export function wrapSignal(
    data: Float64Array,
    fsHz = 360,
    unit: 'mV' | 'adc' | 'normalized' = 'mV',
    name = 'lead',
): Signal {
    return createSignal({
        id: `test-${name}`,
        channels: [{ name, unit, data }],
        sampling: createSamplingInfo(fsHz),
    });
}

/** Data of the first (or only) channel of a signal. */
export function channelOf(signal: Signal): Float64Array {
    return signal.channels[0]!.data;
}

/** A pure sinusoid with no DC offset. */
export function toneChannel(
    fsHz: number,
    frequencyHz: number,
    amplitude: number,
    lengthSamples: number,
    phaseRad = 0,
): Float64Array {
    const data = new Float64Array(lengthSamples);
    const omega = (2 * Math.PI * frequencyHz) / fsHz;
    for (let i = 0; i < lengthSamples; i += 1) {
        data[i] = amplitude * Math.sin(omega * i + phaseRad);
    }
    return data;
}

export function constantChannel(
    lengthSamples: number,
    value: number,
): Float64Array {
    const data = new Float64Array(lengthSamples);
    data.fill(value);
    return data;
}

export function rms(values: ArrayLike<number>, from = 0, to = values.length): number {
    if (to <= from) {
        return 0;
    }
    let sumSq = 0;
    for (let i = from; i < to; i += 1) {
        const v = values[i]!;
        sumSq += v * v;
    }
    return Math.sqrt(sumSq / (to - from));
}

export function maxAbs(values: ArrayLike<number>, from = 0, to = values.length): number {
    let max = 0;
    for (let i = from; i < to; i += 1) {
        const a = Math.abs(values[i]!);
        if (a > max) {
            max = a;
        }
    }
    return max;
}

export function mean(values: ArrayLike<number>, from = 0, to = values.length): number {
    if (to <= from) {
        return 0;
    }
    let sum = 0;
    for (let i = from; i < to; i += 1) {
        sum += values[i]!;
    }
    return sum / (to - from);
}

/**
 * Best integer lag (>= 0) aligning `shifted` to `reference` over the interior
 * window, by maximising the cross-correlation over `candidateLags`. A
 * zero-phase filter should return ~0; a linear-phase filter with integer group
 * delay M should return ~M (the input appears delayed by M in `shifted`).
 */
export function bestLagSamples(
    reference: ArrayLike<number>,
    shifted: ArrayLike<number>,
    from: number,
    to: number,
    candidateLags: readonly number[],
): { lag: number; score: number } {
    let bestLag = candidateLags[0] ?? 0;
    let bestScore = -Infinity;
    for (const lag of candidateLags) {
        let score = 0;
        for (let i = from; i < to; i += 1) {
            const s = i - lag;
            if (s >= 0 && s < shifted.length) {
                score += reference[i]! * shifted[s]!;
            }
        }
        if (score > bestScore) {
            bestScore = score;
            bestLag = lag;
        }
    }
    return { lag: bestLag, score: bestScore };
}
