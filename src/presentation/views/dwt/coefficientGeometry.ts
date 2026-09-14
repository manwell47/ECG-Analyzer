/**
 * Pure coefficient-geometry helpers for the canvas DWT coefficient view
 * (Phase 7 item #10).
 *
 * A `WaveletDecomposition` stores, per channel, one `Float64Array` per detail
 * band plus a final approximation array (see `src/dsp/dwt/dwt.ts`). Those
 * arrays are NOT on the source signal's sample grid: after `j` levels a band
 * has `N / 2^j` coefficients, and each coefficient represents the octave of
 * the original signal that spans `2^j` original samples. This module factors
 * that bookkeeping — the things a coefficient canvas must know that a raw
 * time-series canvas does not:
 *
 * - the per-level *stride* (`2^j` original samples, or seconds) that maps a
 *   coefficient index onto the source signal's own time axis;
 * - the *approximate frequency band* (in Hz) that each band occupies, derived
 *   ONLY from the sample rate and the level (ADR-003). These bands tile the
 *   Nyquist interval and are always flagged `approximate: true` — the view may
 *   show them with an "approximately" label but must never present them as a
 *   clinical-band claim;
 * - mapping a half-open window of ORIGINAL samples onto the half-open range of
 *   COEFFICIENT indices it intersects for a given level (so every lane stays
 *   aligned to one shared time axis / viewport);
 * - decimating a coefficient buffer into per-pixel min/max columns.
 *
 * This module is deliberately DOM-free. The column decimation delegates to the
 * generic (already Node-tested) envelope machinery in
 * `../timeSeries/geometry.ts`, and all sample<->time arithmetic stays in
 * `src/domain/sampling.ts`; nothing scientific is re-implemented here.
 *
 * Conventions the renderer may rely on (mirroring item #9):
 * - all windows/ranges are half-open (`end` exclusive);
 * - the envelope columns returned here carry COEFFICIENT indices in their
 *   `startSample`/`endSample` fields — for drawing, multiply by the level's
 *   stride to recover original sample indices;
 * - coefficient buffers are only ever READ.
 */

import { EcgError } from '../../../domain/error';
import { envelopeColumns, visibleAmplitudeBounds } from '../timeSeries/geometry';
import type {
    AmplitudeBounds,
    EnvelopeColumn,
    SampleWindow,
} from '../timeSeries/geometry';

/**
 * An octave frequency band (in Hz) that one DWT band approximately covers.
 *
 * `approximate` is always `true` because these bands are derived from the
 * sample rate and level alone (the wavelet's true transition bands are not
 * measured). The view must surface that approximation (ADR-003).
 */
export interface FrequencyBandHz {
    /** Lower edge of the band, in Hz (`>= 0`). */
    readonly lowHz: number;
    /** Upper edge of the band, in Hz (`<= sampleRateHz / 2`). */
    readonly highHz: number;
    /** Always `true`: the band is an fs/level derivation, not a measurement. */
    readonly approximate: true;
}

/** Half-open range of coefficient indices `[startCoefficient, endCoefficient)`. */
export interface CoefficientIndexRange {
    /** First included coefficient (inclusive). */
    readonly startCoefficient: number;
    /** One past the last included coefficient (exclusive). */
    readonly endCoefficient: number;
}

function requireLevel(level: number): number {
    if (!Number.isSafeInteger(level) || level < 1) {
        throw EcgError.invalidInput(
            `DWT level must be a positive safe integer, received ${String(level)}.`,
        );
    }
    return level;
}

function requireSampleRateHz(sampleRateHz: number): number {
    if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
        throw EcgError.invalidInput(
            `Sample rate must be a positive finite number, received ` +
            `${String(sampleRateHz)}.`,
        );
    }
    return sampleRateHz;
}

function requireNonNegativeSafeInteger(value: number, label: string): number {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw EcgError.invalidInput(
            `${label} must be a non-negative safe integer, received ${String(value)}.`,
        );
    }
    return value;
}

function requirePositiveSafeInteger(value: number, label: string): number {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw EcgError.invalidInput(
            `${label} must be a positive safe integer, received ${String(value)}.`,
        );
    }
    return value;
}

/**
 * Number of original source samples spanned by one coefficient at `level`
 * (i.e. `2^level`). A level-`j` band has `N / 2^j` coefficients, so the whole
 * band always covers the full `N`-sample record.
 */
export function coefficientStrideSamples(level: number): number {
    const safeLevel = requireLevel(level);
    const stride = 2 ** safeLevel;
    if (!Number.isSafeInteger(stride)) {
        throw EcgError.invalidInput(
            `DWT level ${safeLevel} implies a stride larger than a safe integer.`,
        );
    }
    return stride;
}

/** Time in seconds spanned by one coefficient at `level` for `sampleRateHz`. */
export function coefficientStrideSec(
    level: number,
    sampleRateHz: number,
): number {
    return coefficientStrideSamples(level) / requireSampleRateHz(sampleRateHz);
}

/**
 * Approximate octave band of a detail (high-pass) band at `level`, derived
 * from `sampleRateHz` alone: level `j` covers `[fs/2^(j+1), fs/2^j]` Hz.
 * Level 1 is the finest band, touching the Nyquist frequency at its top edge.
 */
export function detailFrequencyBandHz(
    level: number,
    sampleRateHz: number,
): FrequencyBandHz {
    const safeLevel = requireLevel(level);
    const fs = requireSampleRateHz(sampleRateHz);
    return {
        lowHz: fs / 2 ** (safeLevel + 1),
        highHz: fs / 2 ** safeLevel,
        approximate: true,
    };
}

/**
 * Approximate band of the final (coarsest) approximation after `level`
 * decomposition levels: `[0, fs/2^(level+1)]` Hz. Together with the detail
 * bands the intervals tile `[0, fs/2]` (the whole Nyquist interval) exactly.
 */
export function approximationFrequencyBandHz(
    level: number,
    sampleRateHz: number,
): FrequencyBandHz {
    const safeLevel = requireLevel(level);
    const fs = requireSampleRateHz(sampleRateHz);
    return {
        lowHz: 0,
        highHz: fs / 2 ** (safeLevel + 1),
        approximate: true,
    };
}

/**
 * Map a half-open window of ORIGINAL source samples onto the half-open range
 * of coefficient indices it touches for a band at `level`, whose coefficient
 * buffer has `coefficientCount` entries.
 *
 * Coefficient `k` covers original samples `[k*2^level, (k+1)*2^level)`, so the
 * left edge uses floor and the right edge uses ceil (outward rounding — the
 * returned range never silently shrinks below the samples actually visible).
 * Both edges are clamped to `[0, coefficientCount]`. A degenerate or
 * off-record window yields an empty range (`startCoefficient ===
 * endCoefficient`).
 */
export function coefficientIndexRangeOfWindow(
    window: SampleWindow,
    level: number,
    coefficientCount: number,
): CoefficientIndexRange {
    requireNonNegativeSafeInteger(window.startSample, 'window start sample');
    requireNonNegativeSafeInteger(window.endSample, 'window end sample');
    const count = requirePositiveSafeInteger(coefficientCount, 'coefficient count');
    const stride = coefficientStrideSamples(level);

    if (window.endSample <= window.startSample) {
        return { startCoefficient: 0, endCoefficient: 0 };
    }

    const clampToBand = (index: number): number =>
        index < 0 ? 0 : index > count ? count : index;

    const startCoefficient = clampToBand(
        Math.floor(window.startSample / stride),
    );
    const endCoefficient = clampToBand(Math.ceil(window.endSample / stride));

    return endCoefficient > startCoefficient
        ? { startCoefficient, endCoefficient }
        : { startCoefficient, endCoefficient: startCoefficient };
}

/**
 * Decimate the coefficient buffer `data` over `range` into one min/max column
 * per pixel. Read-only: the buffer is never mutated.
 *
 * The returned columns reuse the generic item-#9 `EnvelopeColumn` shape; for a
 * coefficient lane the `startSample`/`endSample` fields carry COEFFICIENT
 * indices (multiply by the band's stride to reach original sample indices).
 * An empty range produces no columns.
 */
export function coefficientEnvelopeColumns(
    data: readonly number[] | Float64Array,
    range: CoefficientIndexRange,
    columnCount: number,
): readonly EnvelopeColumn[] {
    requireNonNegativeSafeInteger(
        range.startCoefficient,
        'range start coefficient',
    );
    requireNonNegativeSafeInteger(range.endCoefficient, 'range end coefficient');
    return envelopeColumns(
        data,
        { startSample: range.startCoefficient, endSample: range.endCoefficient },
        columnCount,
    );
}

/**
 * Inclusive amplitude bounds (min/max) across the *populated* columns of a
 * decimated coefficient lane. This is the amplitude domain the lane should
 * fit, so each lane is scaled independently to its own visible coefficients.
 */
export function coefficientAmplitudeBounds(
    columns: readonly EnvelopeColumn[],
): AmplitudeBounds {
    return visibleAmplitudeBounds(columns);
}

/**
 * Stable, human-readable rendering of an fs-derived band edge in Hz. Inputs
 * produced by {@link detailFrequencyBandHz}/{@link approximationFrequencyBandHz}
 * are integers or exact binary halves (`fs / 2^k`), so `String` yields clean
 * decimals with no trailing noise (e.g. `180`, `11.25`, `0.5`).
 */
export function formatFrequencyHz(value: number): string {
    if (!Number.isFinite(value) || value < 0) {
        throw EcgError.invalidInput(
            `Frequency must be a finite non-negative number, received ` +
            `${String(value)}.`,
        );
    }
    return String(value);
}
