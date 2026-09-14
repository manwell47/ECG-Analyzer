/**
 * Phase-3 DSP — FIR filtering (windowed-sinc, linear-phase).
 *
 * Design rationale (architecture §G.1; ADR-002):
 * - Filters are FIR, designed with the **windowed-sinc method** (Hamming
 *   window). FIR is unconditionally stable, has no feedback state, and is a
 *   single pure function of a finite input — the right default for an
 *   inspectable, deterministic scientific core. No unexplained constants:
 *   every tap is derived from an explicit cutoff and an explicit window.
 * - `forward` phase applies the causal FIR once (group delay
 *   `(numTaps - 1) / 2` samples, linear phase).
 * - `zero` phase applies the FIR forward then backward (forward-backward /
 *   filtfilt) with reflected edges, yielding zero phase distortion — preferred
 *   for morphology-preserving inspection. Note the magnitude response is
 *   squared because the filter is applied twice.
 * - Cutoffs are validated against the signal's own sample rate; `dsp` never
 *   guesses `fs` and never carries a rate that could disagree with the signal
 *   (ADR-002: config validated against `SamplingInfo`).
 *
 * Limitations (documented, not silently hidden): IIR/notch and magnitude
 * equalisation are out of Phase-3 scope.
 */

import {
    createSignal,
    EcgError,
    type Signal,
    type SignalChannel,
} from '../domain';
import { deriveTransformId, reflectSample, withTransform } from './helpers';

export type FilterType = 'lowpass' | 'highpass' | 'bandpass';
export type PhaseCharacteristic = 'forward' | 'zero';

export interface FilterSpec {
    readonly type: FilterType;
    /**
     * Single cutoff (Hz) for `lowpass`/`highpass`; ordered `[lowHz, highHz]`
     * for `bandpass`. All cutoffs must lie strictly inside (0, fs/2).
     */
    readonly cutoffHz: number | readonly [number, number];
    /** Number of FIR taps; must be an odd integer >= 5. */
    readonly numTaps: number;
    /**
     * `forward`: single causal pass (linear phase, group delay).
     * `zero`: forward-backward (filtfilt) — no phase shift, magnitude squared.
     */
    readonly phaseCharacteristic: PhaseCharacteristic;
    /** Free-text scientific intent (no unexplained filters). */
    readonly purpose: string;
}

export interface DesignedFir {
    readonly type: FilterType;
    /** Symmetric causal taps, length `numTaps`, index 0..numTaps-1. */
    readonly coefficients: Float64Array;
    readonly numTaps: number;
    /** Integer group delay in samples for a single forward pass. */
    readonly groupDelaySamples: number;
    /** Normalised cutoffs actually used, in Hz. */
    readonly cutoffsHz: readonly number[];
    readonly phaseCharacteristic: PhaseCharacteristic;
    readonly purpose: string;
}

/** sinc(x) = sin(pi x) / (pi x), with sinc(0) := 1. */
function sinc(x: number): number {
    if (x === 0) {
        return 1;
    }
    const px = Math.PI * x;
    return Math.sin(px) / px;
}

/** Hamming window over a length-N causal index `k` in [0, N-1]. */
function hamming(k: number, n: number): number {
    return 0.54 - 0.46 * Math.cos((2 * Math.PI * k) / (n - 1));
}

/**
 * Ideal (brick-wall) low-pass impulse response evaluated at integer offset `t`
 * samples from centre, for a cutoff of `fcCyclesPerSample` cycles/sample:
 * h(t) = 2 fc sinc(2 fc t).
 */
function lowpassIdealTap(t: number, fcCyclesPerSample: number): number {
    return 2 * fcCyclesPerSample * sinc(2 * fcCyclesPerSample * t);
}

function finiteSum(values: readonly number[] | Float64Array): number {
    let acc = 0;
    for (let i = 0; i < values.length; i += 1) {
        acc += values[i]!;
    }
    return acc;
}

function parseCutoffs(cutoffHz: FilterSpec['cutoffHz'], type: FilterType): number[] {
    if (type === 'bandpass') {
        if (!Array.isArray(cutoffHz)) {
            throw EcgError.invalidInput(
                'bandpass FilterSpec.cutoffHz must be [lowHz, highHz].',
            );
        }
        return [cutoffHz[0]!, cutoffHz[1]!];
    }
    if (typeof cutoffHz !== 'number') {
        throw EcgError.invalidInput(
            `FilterSpec.cutoffHz must be a number for type "${type}".`,
        );
    }
    return [cutoffHz];
}

function validateCutoffs(
    cutoffsHz: readonly number[],
    sampleRateHz: number,
    type: FilterType,
): void {
    const nyquist = sampleRateHz / 2;
    for (const cutoff of cutoffsHz) {
        if (!Number.isFinite(cutoff) || cutoff <= 0 || cutoff >= nyquist) {
            throw EcgError.invalidInput(
                `Cutoff ${String(cutoff)} Hz must be finite and strictly ` +
                `inside (0, ${nyquist}) Hz for fs = ${sampleRateHz} Hz.`,
            );
        }
    }
    if (type === 'bandpass' && cutoffsHz[0]! >= cutoffsHz[1]!) {
        throw EcgError.invalidInput(
            `Bandpass cutoffs must be ordered low < high; received ` +
            `${cutoffsHz[0]} and ${cutoffsHz[1]}.`,
        );
    }
}

/**
 * Design a windowed-sinc FIR filter for `spec` at `sampleRateHz`. Pure and
 * deterministic: identical inputs always produce identical taps.
 */
export function designFirFilter(
    spec: FilterSpec,
    sampleRateHz: number,
): DesignedFir {
    if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
        throw EcgError.invalidInput(
            `designFirFilter requires fs > 0, received ${String(sampleRateHz)}.`,
        );
    }
    const numTaps = spec.numTaps;
    if (
        !Number.isSafeInteger(numTaps) ||
        numTaps < 5 ||
        numTaps % 2 !== 1
    ) {
        throw EcgError.invalidInput(
            `FilterSpec.numTaps must be an odd integer >= 5, received ${String(numTaps)}.`,
        );
    }

    const cutoffsHz = parseCutoffs(spec.cutoffHz, spec.type);
    validateCutoffs(cutoffsHz, sampleRateHz, spec.type);

    const n = numTaps;
    const m = (n - 1) / 2;
    const coefficients = new Float64Array(n);
    const taps = new Float64Array(n);

    if (spec.type === 'highpass') {
        // Low-pass prototype first (normalised to unity DC gain) ...
        const fc = cutoffsHz[0]! / sampleRateHz;
        for (let k = 0; k < n; k += 1) {
            taps[k] = hamming(k, n) * lowpassIdealTap(k - m, fc);
        }
        const dc = finiteSum(taps);
        if (dc === 0 || !Number.isFinite(dc)) {
            throw EcgError.invalidInput(
                'High-pass prototype produced zero DC gain; reduce filter order or cutoffs.',
            );
        }
        // ... then spectral inversion: hp = delta - lp (exactly zero DC sum).
        for (let k = 0; k < n; k += 1) {
            const prototype = taps[k]!;
            coefficients[k] = (k === m ? 1 : 0) - prototype / dc;
        }
    } else if (spec.type === 'bandpass') {
        const fcLow = cutoffsHz[0]! / sampleRateHz;
        const fcHigh = cutoffsHz[1]! / sampleRateHz;
        // Two windowed low-pass prototypes (Hamming), each normalised to
        // unity DC gain, are differenced to form the band-pass. Differencing
        // two unity-DC low-passes makes the DC response ~0 by construction,
        // matching the high-pass branch's exact zero-DC behaviour: an ideal
        // band-pass is the difference of two ideal unity-DC low-passes.
        const highTaps = taps;
        const lowTaps = new Float64Array(n);
        for (let k = 0; k < n; k += 1) {
            const w = hamming(k, n);
            const t = k - m;
            highTaps[k] = w * lowpassIdealTap(t, fcHigh);
            lowTaps[k] = w * lowpassIdealTap(t, fcLow);
        }
        const dcHigh = finiteSum(highTaps);
        const dcLow = finiteSum(lowTaps);
        if (
            !Number.isFinite(dcHigh) ||
            !Number.isFinite(dcLow) ||
            dcHigh === 0 ||
            dcLow === 0
        ) {
            throw EcgError.invalidInput(
                'Band-pass prototype produced zero DC gain; reduce filter order or cutoffs.',
            );
        }
        for (let k = 0; k < n; k += 1) {
            coefficients[k] =
                highTaps[k]! / dcHigh - lowTaps[k]! / dcLow;
        }
    } else {
        // lowpass
        const fc = cutoffsHz[0]! / sampleRateHz;
        for (let k = 0; k < n; k += 1) {
            taps[k] = hamming(k, n) * lowpassIdealTap(k - m, fc);
        }
        const dc = finiteSum(taps);
        if (dc === 0 || !Number.isFinite(dc)) {
            throw EcgError.invalidInput(
                'Low-pass prototype produced zero DC gain; reduce filter order or cutoffs.',
            );
        }
        for (let k = 0; k < n; k += 1) {
            coefficients[k] = taps[k]! / dc;
        }
    }

    return {
        type: spec.type,
        coefficients,
        numTaps: n,
        groupDelaySamples: m,
        cutoffsHz: [...cutoffsHz],
        phaseCharacteristic: spec.phaseCharacteristic,
        purpose: spec.purpose,
    };
}

/** Canonical, stable transform name for provenance. */
export function filterTransformName(spec: FilterSpec): string {
    const c = Array.isArray(spec.cutoffHz)
        ? spec.cutoffHz.join('-')
        : String(spec.cutoffHz);
    return `filter-${spec.type}-${c}hz-${spec.phaseCharacteristic}`;
}

/**
 * Apply a designed FIR once (causal). `y[i] = sum_k coeff[k] x[i-k]` with
 * out-of-range input read as 0. Returns an array of the same length as input;
 * the first `groupDelaySamples` outputs carry the initial transient.
 */
export function firOnce(
    input: ArrayLike<number>,
    coefficients: ArrayLike<number>,
): Float64Array {
    const length = input.length;
    const n = coefficients.length;
    const out = new Float64Array(length);
    for (let i = 0; i < length; i += 1) {
        let acc = 0;
        for (let k = 0; k < n; k += 1) {
            const s = i - k;
            if (s >= 0) {
                acc += coefficients[k]! * input[s]!;
            }
        }
        out[i] = acc;
    }
    return out;
}

function reverse(values: ArrayLike<number>): Float64Array {
    const out = new Float64Array(values.length);
    for (let i = 0; i < values.length; i += 1) {
        out[values.length - 1 - i] = values[i]!;
    }
    return out;
}

/**
 * Forward-backward (filtfilt-style) filtering for zero phase. The input is
 * extended at both ends by reflection before the two causal passes; the
 * reflected margin is trimmed so the result has the same length as the input.
 * Interior samples (away from the edges by roughly `groupDelaySamples`) have
 * essentially zero phase distortion.
 */
export function firZeroPhase(
    input: ArrayLike<number>,
    coefficients: ArrayLike<number>,
    marginSamples: number,
): Float64Array {
    const length = input.length;
    const pad = marginSamples;
    const extended = new Float64Array(length + 2 * pad);
    for (let j = 0; j < extended.length; j += 1) {
        extended[j] = reflectSample(input, j - pad);
    }

    const pass1 = firOnce(extended, coefficients);
    const reversed1 = reverse(pass1);
    const pass2 = firOnce(reversed1, coefficients);
    const reversed2 = reverse(pass2);

    // Trim the reflected margin. `length` is guaranteed small enough: each
    // causal pass over a buffer of length `length + 2*pad` preserves length.
    const out = new Float64Array(length);
    for (let i = 0; i < length; i += 1) {
        out[i] = reversed2[pad + i]!;
    }
    return out;
}

/**
 * Apply a windowed-sinc filter to every channel of `signal`, returning a new
 * `Signal` (never mutating the input). Sample rate and start time are
 * preserved; the unit is preserved (mV stays mV). A provenance `TransformStep`
 * is appended so the returned signal documents its own history.
 */
export function filterSignal(signal: Signal, spec: FilterSpec): Signal {
    const sampleRateHz = signal.sampling.sampleRateHz;
    const designed = designFirFilter(spec, sampleRateHz);

    const channels: SignalChannel[] = signal.channels.map((channel) => {
        let filtered: Float64Array;
        if (spec.phaseCharacteristic === 'zero') {
            filtered = firZeroPhase(
                channel.data,
                designed.coefficients,
                designed.groupDelaySamples,
            );
        } else {
            filtered = firOnce(channel.data, designed.coefficients);
        }
        return {
            name: channel.name,
            unit: channel.unit,
            data: filtered,
        };
    });

    const transformName = filterTransformName(spec);
    return createSignal({
        id: deriveTransformId(signal.id, transformName),
        channels,
        sampling: signal.sampling,
        provenance: withTransform(signal.provenance, {
            name: transformName,
            parameters: {
                type: spec.type,
                cutoffsHz: [...designed.cutoffsHz],
                numTaps: spec.numTaps,
                phaseCharacteristic: spec.phaseCharacteristic,
                sampleRateHz,
                purpose: spec.purpose,
            },
        }),
    });
}
