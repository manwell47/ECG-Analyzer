/**
 * Sampling metadata and explicit sample-index <-> time conversions.
 *
 * Hard rule (AGENTS.md / ADR-001): the sample rate is NEVER inferred from an
 * array length. Every signal carries an explicit `SamplingInfo`, and all
 * index/time arithmetic flows through the conversions defined here so a single
 * implementation (and its tests) is used everywhere.
 *
 * Time convention: with `startTimeSec` at sample index 0, samples are spaced
 * `1 / sampleRateHz` apart, so sample `i` occurs at
 * `startTimeSec + i / sampleRateHz`. The acquisition-window length of `N`
 * samples is `N / sampleRateHz` seconds.
 *
 * The window mapping a *visible* time span onto the half-open sample range it
 * covers (`sampleWindowOfTime`) lives here too: both the time-series renderer
 * and the application layer's model-output service need exactly this mapping,
 * and the application layer may not import from the presentation layer. One
 * definition is what keeps them from drifting apart.
 */

import { EcgError } from './error';
import { assertFiniteNumber, assertPositiveNumber } from './numeric';

export interface SamplingInfo {
    /** Samples per second. Must be finite and > 0. */
    readonly sampleRateHz: number;
    /** Time in seconds of sample index 0 (record start). Defaults to 0. */
    readonly startTimeSec: number;
}

/** How a fractional sample position is turned into an integer index. */
export type SampleIndexRoundingPolicy = 'floor' | 'round' | 'ceil';

export function assertValidSampleRate(sampleRateHz: number): void {
    assertPositiveNumber(sampleRateHz, 'sample rate (Hz)');
}

/** Build a validated, structurally immutable `SamplingInfo`. */
export function createSamplingInfo(
    sampleRateHz: number,
    startTimeSec = 0,
): SamplingInfo {
    assertValidSampleRate(sampleRateHz);
    assertFiniteNumber(startTimeSec, 'start time (seconds)');
    return Object.freeze({ sampleRateHz, startTimeSec });
}

function validateSamplingInfo(sampling: SamplingInfo): void {
    assertValidSampleRate(sampling.sampleRateHz);
    assertFiniteNumber(sampling.startTimeSec, 'start time (seconds)');
}

/**
 * Acquisition-window length in seconds for `numSamples` sampled at
 * `sampleRateHz` (convention: `N / fs`). `numSamples` must be a non-negative
 * integer.
 */
export function durationSecOf(numSamples: number, sampleRateHz: number): number {
    assertValidSampleRate(sampleRateHz);
    assertFiniteNumber(numSamples, 'sample count');
    if (!Number.isSafeInteger(numSamples) || numSamples < 0) {
        throw EcgError.invalidInput(
            `Sample count must be a non-negative safe integer, received ` +
            `${String(numSamples)}.`,
        );
    }
    return numSamples / sampleRateHz;
}

/**
 * Time in seconds of `sampleIndex` for `sampling`, i.e.
 * `startTimeSec + sampleIndex / sampleRateHz`. Sample index must be a
 * non-negative integer.
 */
export function timeSecOfSample(
    sampleIndex: number,
    sampling: SamplingInfo,
): number {
    validateSamplingInfo(sampling);
    if (!Number.isSafeInteger(sampleIndex) || sampleIndex < 0) {
        throw EcgError.invalidInput(
            `Sample index must be a non-negative safe integer, received ` +
            `${String(sampleIndex)}.`,
        );
    }
    return sampleIndex / sampling.sampleRateHz + sampling.startTimeSec;
}

/**
 * Map a time in seconds to an integer sample index for `sampling`.
 *
 * The raw (possibly fractional) sample position is
 * `(timeSec - startTimeSec) * sampleRateHz`, then `policy` decides rounding.
 * The returned index is NOT clamped to the signal length — callers must check
 * range against their actual sample count.
 */
export function sampleIndexOfTimeSec(
    timeSec: number,
    sampling: SamplingInfo,
    policy: SampleIndexRoundingPolicy = 'round',
): number {
    validateSamplingInfo(sampling);
    assertFiniteNumber(timeSec, 'time (seconds)');
    const rawSample = (timeSec - sampling.startTimeSec) * sampling.sampleRateHz;
    switch (policy) {
        case 'floor':
            return Math.floor(rawSample);
        case 'ceil':
            return Math.ceil(rawSample);
        case 'round':
            return Math.round(rawSample);
    }
}

/**
 * Exact equality of sample rates. Deliberately strict: merging a 360 Hz and a
 * 359.999 Hz signal must be an explicit, reviewed operation, never a silent
 * near-equality pass.
 */
export function equalSampleRate(aHz: number, bHz: number): boolean {
    return aHz === bHz;
}

/** Throw `incompatible-sample-rate` unless both rates are valid and equal. */
export function assertCompatibleSampleRate(aHz: number, bHz: number): void {
    assertValidSampleRate(aHz);
    assertValidSampleRate(bHz);
    if (aHz !== bHz) {
        throw EcgError.incompatibleSampleRate(
            `Sample rates differ (${aHz} Hz vs ${bHz} Hz); resample before combining.`,
            { detail: 'Combining signals of different sample rates requires an explicit resampling step.' },
        );
    }
}

/** Structural equality of two `SamplingInfo` (rate and start offset). */
export function sameSampling(a: SamplingInfo, b: SamplingInfo): boolean {
    return a.sampleRateHz === b.sampleRateHz && a.startTimeSec === b.startTimeSec;
}

/** Visible span of a signal's time axis, in seconds. */
export interface TimeSpan {
    /** Time (seconds) at the left edge of the span. */
    readonly startSec: number;
    /** Length of the span, in seconds (> 0 covers data). */
    readonly durationSec: number;
}

/** Half-open sample range `[startSample, endSample)` within a channel. */
export interface SampleWindow {
    /** First included sample (inclusive). */
    readonly startSample: number;
    /** One past the last included sample (exclusive). */
    readonly endSample: number;
}

/**
 * Map a time span to the half-open sample window it covers, for a channel of
 * `sampleCount` samples sampled per `sampling`.
 *
 * The left edge uses floor rounding (the first sample whose time is >= the span
 * start), the right edge uses ceil (the first sample whose time is >= the span
 * end, exclusive). Edges are clamped to `[0, sampleCount]`. A degenerate span
 * (non-positive duration, or one falling entirely between samples / off the
 * record) yields an empty window (`startSample === endSample`).
 *
 * A non-finite edge or a negative/non-integer sample count is a classified
 * `invalid-input`, never a silently truncated window.
 */
export function sampleWindowOfTime(
    span: TimeSpan,
    sampling: SamplingInfo,
    sampleCount: number,
): SampleWindow {
    if (!Number.isFinite(span.startSec)) {
        throw EcgError.invalidInput(
            'viewport start (seconds) must be a finite number, received ' +
            `${String(span.startSec)}.`,
        );
    }
    if (!Number.isFinite(span.durationSec)) {
        throw EcgError.invalidInput(
            'viewport duration (seconds) must be a finite number, received ' +
            `${String(span.durationSec)}.`,
        );
    }
    if (!Number.isSafeInteger(sampleCount) || sampleCount < 0) {
        throw EcgError.invalidInput(
            'sample count must be a non-negative safe integer, received ' +
            `${String(sampleCount)}.`,
        );
    }

    if (!(span.durationSec > 0)) {
        return { startSample: 0, endSample: 0 };
    }

    const clampToRecord = (index: number): number =>
        index < 0 ? 0 : index > sampleCount ? sampleCount : index;

    const startSample = clampToRecord(
        sampleIndexOfTimeSec(span.startSec, sampling, 'floor'),
    );
    const endSample = clampToRecord(
        sampleIndexOfTimeSec(span.startSec + span.durationSec, sampling, 'ceil'),
    );

    return endSample > startSample
        ? { startSample, endSample }
        : { startSample, endSample: startSample };
}
