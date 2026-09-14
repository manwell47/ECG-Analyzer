/**
 * Db4 (Daubechies order-4) filterbank constants.
 *
 * Source discipline: these are the canonical Daubechies-4 analysis low-pass
 * taps in the same ordering used by wavelib (BSD-3) and PyWavelets/MATLAB
 * `db4 dec_lo`. The values were cross-read from wavelib via the SIGIL
 * `WaveletProcessor.cpp` embedded Db4 taps and match the literature to ~1e-12.
 *
 * This module is the *single source* for the Db4 golden coefficients used to
 * seed fixtures and (in later phases) the DWT wavelet catalog. Nothing else
 * in the codebase re-declares these numbers.
 */

/**
 * Db4 analysis/scaling (low-pass) decomposition filter, `dec_lo`.
 * Length 8; sums to sqrt(2); unit energy; orthogonal to its 2-shift.
 */
export const DB4_DEC_LO: readonly number[] = Object.freeze([
    0.230377813308855,
    0.714846570552542,
    0.63088076792959,
    -0.027983769416984,
    -0.187034811718881,
    0.030841381835987,
    0.032883011666983,
    -0.010597401784997,
]);

export const DB4_NAME = 'db4';
export const DB4_ORDER = 4;
export const DB4_TAP_COUNT = DB4_DEC_LO.length;

function reverse(values: readonly number[]): number[] {
    const n = values.length;
    const reversed = new Array<number>(n);
    for (let i = 0; i < n; i += 1) {
        reversed[i] = values[n - 1 - i]!;
    }
    return reversed;
}

/**
 * Quadrature-mirror high-pass analysis filter: g[n] = (-1)^n * h[N-1-n].
 * For orthonormal wavelets this makes {h, g} a perfect-reconstruction pair.
 */
export function qmfHighpass(lowpass: readonly number[]): number[] {
    const n = lowpass.length;
    const highpass = new Array<number>(n);
    for (let k = 0; k < n; k += 1) {
        const sign = k % 2 === 0 ? 1 : -1;
        highpass[k] = sign * lowpass[n - 1 - k]!;
    }
    return highpass;
}

/** Reconstruction low-pass = time-reversed analysis low-pass. */
export function reconstructionLowpass(lowpass: readonly number[]): number[] {
    return reverse(lowpass);
}

/** Reconstruction high-pass = time-reversed analysis high-pass. */
export function reconstructionHighpass(lowpass: readonly number[]): number[] {
    return reverse(qmfHighpass(lowpass));
}

/** Full derived Db4 filterbank in analysis (decomposition) order. */
export const DB4_DEC_HI: readonly number[] = Object.freeze(qmfHighpass(DB4_DEC_LO));
export const DB4_REC_LO: readonly number[] = Object.freeze(reconstructionLowpass(DB4_DEC_LO));
export const DB4_REC_HI: readonly number[] = Object.freeze(reconstructionHighpass(DB4_DEC_LO));

export function sum(values: readonly number[]): number {
    let total = 0;
    for (const value of values) {
        total += value;
    }
    return total;
}

export function sumSquares(values: readonly number[]): number {
    let total = 0;
    for (const value of values) {
        total += value * value;
    }
    return total;
}

/**
 * Inner product over the common index range of two equal-length sequences:
 * `<a, b> = sum_k a[k] * b[k]`.
 */
export function innerProduct(a: readonly number[], b: readonly number[]): number {
    const n = Math.min(a.length, b.length);
    let total = 0;
    for (let i = 0; i < n; i += 1) {
        total += a[i]! * b[i]!;
    }
    return total;
}

/** `<a, b>` shifted: `sum_k a[k] * b[k - shift]` treating out-of-range as 0. */
export function crossCorrelationShift(
    a: readonly number[],
    b: readonly number[],
    shift: number,
): number {
    let total = 0;
    for (let i = 0; i < a.length; i += 1) {
        const j = i - shift;
        if (j >= 0 && j < b.length) {
            total += a[i]! * b[j]!;
        }
    }
    return total;
}
