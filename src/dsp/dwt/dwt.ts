/**
 * Phase-4 DWT / IDWT (ADR-003).
 *
 * Scope
 * -----
 * This module provides the discrete wavelet transform (decomposition) and its
 * inverse (reconstruction) for the laboratory. It operates on real, evenly
 * sampled `Signal` values through the domain API and on raw arrays through the
 * low-level primitives. All functions are pure and deterministic: input buffers
 * are never mutated, no hidden state or global configuration is consulted, and
 * identical inputs always produce bit-identical outputs (shared verbatim by the
 * main thread and workers, rules §30).
 *
 * Scientific reference (periodic / circular extension)
 * ----------------------------------------------------
 * The implemented mode is *periodic* (circular) extension, matching the wavelib
 * reference library's direct `per` transform semantics (the `C` reference is
 * external and read-only at the SIGIL checkout; this project never imports or
 * ships it). The analysis alignment is the wavelib convention
 * `t = 2*i + tapCount/2` with coefficient taps read circularly
 * (`idx = wrap(t - l, n)`); synthesis upsamples and circularly filters into an
 * even/odd interleaved buffer and then applies wavelib's central extraction
 * (`out[k] = X[tapCount/2 - 1 + k]`). Because every per-level signal length is
 * required to be at least the filter length, the resulting circular filter
 * shifts are mutually orthogonal and the transform is an orthogonal
 * (energy-preserving / Parseval) map whose inverse is the synthesis below.
 *
 * Explicit length policy (documented behavior, architecture §G.1)
 * ---------------------------------------------------------------
 * Only the periodic mode is implemented in Phase 4. A decomposition of `level`
 * levels is accepted iff the source length `n` satisfies
 *   1. `2^level` divides `n` (every per-level input stays even), and
 *   2. the coarsest per-level input is at least the filter tap count
 *      (`n / 2^(level-1) >= tapCount`) so the circular shifts stay orthogonal.
 * Any other length, or the `symmetric` extension mode, is *rejected explicitly*
 * with a classified `invalid-input` error rather than silently approximated.
 *
 * Validation gate
 * ---------------
 * The reconstruction identity `idwt(dwt(x, cfg), cfg) ~= x` is the ADR-003 gate
 * and is asserted by the Phase-4 test suite together with Parseval energy
 * preservation, coefficient-size accounting, determinism and no-mutation
 * hygiene. True numeric coefficient cross-validation against the compiled
 * wavelib library (and the resulting extension of the wavelet catalog beyond
 * db4) remains a documented *external-capture* gate that requires a C toolchain
 * and is therefore deferred; nothing in this module is fabricated to match an
 * unverified expectation.
 */

import { createSignal, EcgError } from '../../domain';
import type {
    AmplitudeUnit,
    Provenance,
    SamplingInfo,
    Signal,
    SignalChannel,
} from '../../domain';
import { deriveTransformId, withTransform } from '../helpers';
import { getWavelet, type WaveletFilters } from './catalog';

/** Signal extension used at edges while filtering. Only periodic is supported in Phase 4. */
export type DwtExtensionMode = 'periodic';

/** The extension modes implemented in Phase 4 (stable, frozen). */
export const SUPPORTED_DWT_EXTENSION_MODES: readonly DwtExtensionMode[] =
    Object.freeze(['periodic']);

/** Explicit, validated configuration for a DWT / IDWT operation. */
export interface DwtConfig {
    /** Wavelet name present in the catalog (Phase 4: `db4`). */
    readonly waveletName: string;
    /** Number of decomposition levels; a positive integer (`>= 1`). */
    readonly level: number;
    /** Edge-extension mode; only `periodic` is implemented (Phase 4). */
    readonly extensionMode: DwtExtensionMode;
}

/** One detail (wavelet, high-pass) band at a given decomposition level. */
export interface DwtChannelLevel {
    /** 1-based decomposition level; level 1 is the finest band. */
    readonly level: number;
    /** Wavelet coefficients of this band (length `sourceLength / 2^level`). */
    readonly detail: Float64Array;
}

/** Per-channel DWT output: detail bands plus the final scaling coefficients. */
export interface DwtChannelDecomposition {
    readonly channelName: string;
    /** Physical unit of the source amplitudes; DWT is linear so it is preserved. */
    readonly unit: AmplitudeUnit;
    /** Detail bands, finest (level 1) first. */
    readonly detailLevels: readonly DwtChannelLevel[];
    /** Final (coarsest) scaling coefficients; length `sourceLength / 2^level`. */
    readonly approximate: Float64Array;
}

/** Result of `decomposeSignal`; consumed by {@link reconstructSignal}. */
export interface WaveletDecomposition {
    /** Id of the source signal (unchanged; transforms are recorded separately). */
    readonly signalId: string;
    /** Provenance of the source signal *before* the DWT was applied. */
    readonly signalProvenance: Provenance;
    /** Sampling metadata of the source signal (preserved through the transform). */
    readonly sampling: SamplingInfo;
    /** Total number of samples per channel in the source signal. */
    readonly sourceLengthSamples: number;
    readonly waveletName: string;
    readonly level: number;
    readonly extensionMode: DwtExtensionMode;
    readonly channels: readonly DwtChannelDecomposition[];
}

/**
 * The largest `level` `J` such that `2^J` divides `lengthSamples` — i.e. every
 * per-level periodic signal stays even when halved `J` times. Pure divisibility
 * bound; it does *not* encode the orthogonal-length condition (see
 * {@link maxOrthogonalPeriodicLevelForLength}).
 */
export function maxPeriodicLevelForLength(lengthSamples: number): number {
    if (!Number.isInteger(lengthSamples) || lengthSamples <= 0) {
        throw EcgError.invalidInput(
            `Expected a positive integer sample count, received ${String(lengthSamples)}.`,
        );
    }
    let level = 0;
    let value = lengthSamples;
    while (value % 2 === 0) {
        value /= 2;
        level += 1;
    }
    return level;
}

/**
 * The largest periodic decomposition `level` that keeps the transform an
 * orthogonal (energy-preserving) map for the given length and filter tap count:
 * the coarsest per-level input must still hold the full filter support so the
 * circular filter shifts remain mutually orthogonal (no aliasing between taps).
 * Returns 0 when no valid level exists.
 */
export function maxOrthogonalPeriodicLevelForLength(
    lengthSamples: number,
    tapCount: number,
): number {
    if (!Number.isInteger(tapCount) || tapCount < 2 || tapCount % 2 !== 0) {
        throw EcgError.invalidInput(
            `Expected an even filter tap count >= 2, received ${String(tapCount)}.`,
        );
    }
    let level = maxPeriodicLevelForLength(lengthSamples);
    while (level >= 1 && lengthSamples / 2 ** (level - 1) < tapCount) {
        level -= 1;
    }
    return level;
}

/** Deterministic non-negative modulo wrap for circular indexing. */
function wrapIndex(index: number, length: number): number {
    const mod = index % length;
    return mod < 0 ? mod + length : mod;
}

/** Validate the filter bank shape shared by analysis and synthesis. */
function assertValidFilterBank(filters: WaveletFilters): void {
    const { decLo, decHi, recLo, recHi } = filters;
    const tapCount = decLo.length;
    if (tapCount < 2 || tapCount % 2 !== 0) {
        throw EcgError.invalidInput(
            `DWT filters must have an even tap count >= 2, received ${tapCount}.`,
        );
    }
    for (const [label, taps] of [
        ['dec_hi', decHi],
        ['rec_lo', recLo],
        ['rec_hi', recHi],
    ] as const) {
        if (taps.length !== tapCount) {
            throw EcgError.invalidInput(
                `DWT filter bank is inconsistent: ${label} has ${taps.length} taps but dec_lo has ${tapCount}.`,
            );
        }
    }
}

/** One level of analysis output (approximate + detail coefficient arrays). */
export interface LevelPair {
    readonly approximate: Float64Array;
    readonly detail: Float64Array;
}

/**
 * Single-level periodic DWT analysis of an even-length input, following the
 * wavelib `per` convention: coefficient `i` is
 * `sum_l filter[l] * x[wrap(2*i + tapCount/2 - l, n)]`.
 * Returns two arrays of length `n / 2`.
 */
export function analyzePeriodicLevel(
    values: ArrayLike<number>,
    filters: WaveletFilters,
): LevelPair {
    const n = values.length;
    if (n < 2 || n % 2 !== 0) {
        throw EcgError.invalidInput(
            `Periodic DWT analysis requires an even input length >= 2, received ${n}.`,
        );
    }
    assertValidFilterBank(filters);
    const { decLo, decHi } = filters;
    const tapCount = decLo.length;
    const l2 = tapCount / 2;
    const half = n / 2;
    const approximate = new Float64Array(half);
    const detail = new Float64Array(half);
    for (let i = 0; i < half; i += 1) {
        const t = 2 * i + l2;
        let sumLo = 0;
        let sumHi = 0;
        for (let l = 0; l < tapCount; l += 1) {
            const sample = values[wrapIndex(t - l, n)]!;
            sumLo += decLo[l]! * sample;
            sumHi += decHi[l]! * sample;
        }
        approximate[i] = sumLo;
        detail[i] = sumHi;
    }
    return { approximate, detail };
}

/**
 * Single-level periodic DWT synthesis (the inverse of
 * {@link analyzePeriodicLevel} for orthogonal filters): upsampling + circular
 * filtering into an even/odd interleaved buffer followed by the wavelib central
 * extraction `out[k] = X[tapCount/2 - 1 + k]`. Returns a buffer of length
 * `2 * approximate.length`.
 */
export function synthesizePeriodicLevel(
    approximate: ArrayLike<number>,
    detail: ArrayLike<number>,
    filters: WaveletFilters,
): Float64Array {
    assertValidFilterBank(filters);
    const half = approximate.length;
    if (half < 1) {
        throw EcgError.invalidInput(
            'Periodic DWT synthesis requires at least one approximation coefficient.',
        );
    }
    if (detail.length !== half) {
        throw EcgError.invalidInput(
            `Periodic DWT synthesis length mismatch: approximation has ${half} samples ` +
            `but detail has ${detail.length}.`,
        );
    }
    const { recLo, recHi } = filters;
    const tapCount = recLo.length;
    const l2 = tapCount / 2;
    const outLength = 2 * half;
    // Interleaved accumulation buffer with head room for the central extraction.
    const interleaved = new Float64Array(outLength + 2 * l2);
    for (let i = 0; i < half + l2 - 1; i += 1) {
        const evenPos = 2 * i;
        const oddPos = evenPos + 1;
        let sumEven = 0;
        let sumOdd = 0;
        for (let l = 0; l < l2; l += 1) {
            const t = 2 * l;
            const source = wrapIndex(i - l, half);
            const a = approximate[source]!;
            const d = detail[source]!;
            sumEven += recLo[t]! * a + recHi[t]! * d;
            sumOdd += recLo[t + 1]! * a + recHi[t + 1]! * d;
        }
        interleaved[evenPos] = sumEven;
        interleaved[oddPos] = sumOdd;
    }
    const out = new Float64Array(outLength);
    for (let k = 0; k < outLength; k += 1) {
        out[k] = interleaved[l2 - 1 + k]!;
    }
    return out;
}

/**
 * Multi-level periodic DWT decomposition of `values` into `level` detail bands
 * (finest first) plus the final approximate. Pure array primitive; the caller is
 * responsible for the length/level policy (see {@link decomposeSignal}).
 */
export function decomposePeriodicLevels(
    values: ArrayLike<number>,
    filters: WaveletFilters,
    level: number,
): { readonly detailLevels: readonly DwtChannelLevel[]; readonly approximate: Float64Array } {
    if (!Number.isInteger(level) || level < 1) {
        throw EcgError.invalidInput(
            `DWT level must be a positive integer, received ${String(level)}.`,
        );
    }
    assertValidFilterBank(filters);
    let current: Float64Array = new Float64Array(values);
    const detailLevels: DwtChannelLevel[] = [];
    for (let j = 1; j <= level; j += 1) {
        if (current.length % 2 !== 0) {
            throw EcgError.invalidInput(
                `Periodic DWT level ${j} requires an even per-level length; got ${current.length}. ` +
                'The source length must be divisible by 2^level (documented Phase-4 behavior).',
            );
        }
        const pair = analyzePeriodicLevel(current, filters);
        detailLevels.push({ level: j, detail: pair.detail });
        current = pair.approximate;
    }
    return { detailLevels, approximate: current };
}

/**
 * Multi-level periodic DWT reconstruction: invert `detailLevels.length` levels,
 * walking from the coarsest band toward the finest, ending at the original
 * sample count. `detailLevels` must be ordered finest (level 1) first. When
 * `expectedLengthSamples` is provided the final length is asserted.
 */
export function reconstructPeriodicLevels(
    detailLevels: readonly DwtChannelLevel[],
    approximate: ArrayLike<number>,
    filters: WaveletFilters,
    expectedLengthSamples?: number,
): Float64Array {
    assertValidFilterBank(filters);
    if (detailLevels.length === 0) {
        throw EcgError.invalidInput(
            'Periodic DWT reconstruction requires at least one detail band.',
        );
    }
    let current: Float64Array = new Float64Array(approximate);
    for (let j = detailLevels.length; j >= 1; j -= 1) {
        const band = detailLevels[j - 1]!;
        if (band.level !== j) {
            throw EcgError.invalidInput(
                `DWT detail bands are not a contiguous 1..${detailLevels.length} sequence ` +
                `(found level ${band.level} where level ${j} was expected).`,
            );
        }
        current = synthesizePeriodicLevel(current, band.detail, filters);
    }
    if (expectedLengthSamples !== undefined && current.length !== expectedLengthSamples) {
        throw EcgError.invalidInput(
            `DWT reconstruction produced ${current.length} samples but ${expectedLengthSamples} were expected.`,
        );
    }
    return current;
}

/** Validate the explicit configuration fields (wavelet names are validated by the catalog). */
function requireValidConfig(config: DwtConfig): void {
    if (!Number.isInteger(config.level) || config.level < 1) {
        throw EcgError.invalidInput(
            `DWT level must be a positive integer, received ${String(config.level)}.`,
        );
    }
    if (config.extensionMode !== 'periodic') {
        throw EcgError.invalidInput(
            `Unsupported DWT extension mode ${JSON.stringify(config.extensionMode)}. ` +
            "Phase 4 implements periodic (circular) extension only; 'symmetric' " +
            'extension is deferred and non-supported modes are rejected (ADR-003).',
        );
    }
}

/** Enforce the explicit periodic length policy on a source of `n` samples. */
function assertLengthPolicy(n: number, level: number, tapCount: number): void {
    const maxLevel = maxOrthogonalPeriodicLevelForLength(n, tapCount);
    if (level > maxLevel) {
        throw EcgError.invalidInput(
            `Periodic DWT level ${level} is not supported for a ${n}-sample signal. ` +
            `The periodic mode needs every per-level input even (n divisible by 2^level) ` +
            `and at least the filter length (${tapCount} taps) so the circular filter ` +
            `shifts stay orthogonal; this length supports up to level ${maxLevel}. ` +
            'Non-divisible lengths and symmetric extension are rejected explicitly ' +
            '(documented behavior, ADR-003 / architecture §G.1).',
        );
    }
}

/** Canonical, stable transform name for a DWT configuration. */
export function dwtTransformName(config: DwtConfig): string {
    return `dwt-${config.waveletName}-level${config.level}-${config.extensionMode}`;
}

/** Canonical, stable transform name for the inverse of a decomposition. */
export function idwtTransformName(decomposition: WaveletDecomposition): string {
    return `idwt-${decomposition.waveletName}-level${decomposition.level}-${decomposition.extensionMode}`;
}

/**
 * Decompose every channel of `signal` with the configured periodic DWT.
 * Never mutates the input. Validation is explicit: unsupported wavelets
 * (catalog), non-`periodic` extensions, invalid levels, and lengths that do not
 * satisfy the periodic policy are rejected with `invalid-input` errors.
 */
export function decomposeSignal(
    signal: Signal,
    config: DwtConfig,
): WaveletDecomposition {
    requireValidConfig(config);
    const wavelet = getWavelet(config.waveletName);
    const sourceLengthSamples = signal.channels[0]!.data.length;
    assertLengthPolicy(sourceLengthSamples, config.level, wavelet.filters.decLo.length);

    const channels: DwtChannelDecomposition[] = signal.channels.map((channel) => {
        const result = decomposePeriodicLevels(channel.data, wavelet.filters, config.level);
        return {
            channelName: channel.name,
            unit: channel.unit,
            detailLevels: result.detailLevels,
            approximate: result.approximate,
        };
    });

    return {
        signalId: signal.id,
        signalProvenance: signal.provenance,
        sampling: signal.sampling,
        sourceLengthSamples,
        waveletName: config.waveletName,
        level: config.level,
        extensionMode: config.extensionMode,
        channels,
    };
}

/**
 * Reconstruct a `Signal` from a {@link WaveletDecomposition} produced by
 * {@link decomposeSignal}. Sampling and per-channel unit are preserved and the
 * output length equals `sourceLengthSamples`. Provenance records both the DWT
 * and IDWT steps applied to the source so the returned signal documents its own
 * full processing history (architecture E.3).
 */
export function reconstructSignal(decomposition: WaveletDecomposition): Signal {
    if (decomposition.channels.length === 0) {
        throw EcgError.invalidInput(
            'Cannot reconstruct: the decomposition contains no channels.',
        );
    }
    const wavelet = getWavelet(decomposition.waveletName);
    const { sourceLengthSamples } = decomposition;

    const channels: SignalChannel[] = decomposition.channels.map((channel) => {
        const data = reconstructPeriodicLevels(
            channel.detailLevels,
            channel.approximate,
            wavelet.filters,
            sourceLengthSamples,
        );
        return { name: channel.channelName, unit: channel.unit, data };
    });

    const sampleRateHz = decomposition.sampling.sampleRateHz;
    const dwtParameters = {
        waveletName: decomposition.waveletName,
        level: decomposition.level,
        extensionMode: decomposition.extensionMode,
        sourceLengthSamples,
        sampleRateHz,
    };
    const idwtName = idwtTransformName(decomposition);

    // The decomposition itself is the DWT of the source, so a reconstruction
    // documents the chain: source -> dwt -> idwt.
    let provenance = withTransform(decomposition.signalProvenance, {
        name: dwtTransformName({
            waveletName: decomposition.waveletName,
            level: decomposition.level,
            extensionMode: decomposition.extensionMode,
        }),
        parameters: dwtParameters,
    });
    provenance = withTransform(provenance, {
        name: idwtName,
        parameters: {
            ...dwtParameters,
            reconstructedLengthSamples: sourceLengthSamples,
        },
    });

    return createSignal({
        id: deriveTransformId(decomposition.signalId, idwtName),
        channels,
        sampling: decomposition.sampling,
        provenance,
    });
}
