/**
 * Viewport -> sample mapping and min/max column decimation for the canvas
 * time-series view (Phase 7 item #9).
 *
 * These are pure, DOM-free helpers. They map a visible *time viewport* onto
 * the *sample* domain of a signal channel and reduce runs of samples into
 * per-pixel-column min/max envelopes, so a canvas can draw a decimated trace
 * without scanning the whole record on every frame and without ever writing to
 * the source `Float64Array`.
 *
 * The time<->sample arithmetic is deliberately NOT re-implemented here. It is
 * the domain's own (`src/domain/sampling.ts`, ADR-001 — "sample i occurs at
 * i / sampleRateHz; rate is never inferred from length"), and as of Phase 18
 * item 7 the viewport -> sample-window mapping lives there too, because the
 * application layer needs exactly the same mapping and may not import from the
 * presentation layer. Both names are re-exported below for this module's
 * existing callers, so exactly one tested definition of the mapping exists
 * anywhere in the codebase.
 *
 * Conventions the renderer may rely on:
 * - a window is half-open `[startSample, endSample)` (`endSample` exclusive);
 * - windows produced by {@link sampleWindowOfTime} are clamped to
 *   `[0, sampleCount]` and therefore never exceed the data;
 * - column partitions (and therefore envelope columns) are contiguous,
 *   non-overlapping and gap-free, so their union covers exactly the window;
 * - sample data is only ever read here; buffers passed in are left untouched.
 */

import { EcgError } from '../../../domain/error';
import type { SampleWindow, TimeSpan } from '../../../domain/sampling';

// The window mapping belongs to the domain (single source, ADR-001). Both names
// stay exported from here so every existing caller and test path is unchanged.
export type { SampleWindow } from '../../../domain/sampling';
export { sampleWindowOfTime } from '../../../domain/sampling';

/**
 * Visible span of a signal's time axis, in seconds.
 *
 * An alias of the domain's own `TimeSpan` (Phase 18 item 7): the mapping is a
 * domain concern, this name is the view's.
 */
export type TimeViewport = TimeSpan;

/** One decimated pixel column of a trace (min/max over its samples). */
export interface EnvelopeColumn {
    /** First sample covered by this column (inclusive). */
    readonly startSample: number;
    /** One past the last sample covered (exclusive). */
    readonly endSample: number;
    /** True when at least one sample fell inside this column. */
    readonly populated: boolean;
    /** Minimum sample value over the covered samples (valid when `populated`). */
    readonly min: number;
    /** Maximum sample value over the covered samples (valid when `populated`). */
    readonly max: number;
}

/** Inclusive amplitude range over the populated columns of a window. */
export interface AmplitudeBounds {
    /** True when at least one populated column contributed. */
    readonly populated: boolean;
    readonly min: number;
    readonly max: number;
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
 * Split a half-open sample window into `columnCount` contiguous, non-overlapping,
 * gap-free buckets. Buckets use floor-rounded boundaries over the window span,
 * so their union is exactly `window` and empty buckets appear when there are
 * more columns than samples. An empty window partitions to no buckets.
 */
export function partitionSampleWindow(
    window: SampleWindow,
    columnCount: number,
): readonly SampleWindow[] {
    requirePositiveSafeInteger(columnCount, 'column count');

    const span = window.endSample - window.startSample;
    if (span <= 0) {
        return [];
    }

    const buckets: SampleWindow[] = [];
    for (let index = 0; index < columnCount; index += 1) {
        const bucketStart =
            window.startSample + Math.floor((index * span) / columnCount);
        const bucketEnd =
            window.startSample + Math.floor(((index + 1) * span) / columnCount);
        buckets.push({ startSample: bucketStart, endSample: bucketEnd });
    }
    return buckets;
}

/** Min/max reduction over the half-open range, clamped to the data length. */
function reduceRange(
    data: readonly number[] | Float64Array,
    startSample: number,
    endSample: number,
): { readonly min: number; readonly max: number; readonly populated: boolean } {
    const first = Math.max(0, startSample);
    const last = Math.min(data.length, endSample);
    if (last <= first) {
        return { min: 0, max: 0, populated: false };
    }

    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let index = first; index < last; index += 1) {
        const value = data[index] as number;
        if (value < min) {
            min = value;
        }
        if (value > max) {
            max = value;
        }
    }
    return { min, max, populated: true };
}

/**
 * Build one decimated min/max column per pixel column for the samples covered
 * by `window`. Read-only: the source data is never mutated. An empty window
 * produces no columns; a window shorter than `columnCount` produces empty
 * (`populated: false`) columns for the unused pixel positions.
 */
export function envelopeColumns(
    data: readonly number[] | Float64Array,
    window: SampleWindow,
    columnCount: number,
): readonly EnvelopeColumn[] {
    return partitionSampleWindow(window, columnCount).map((bucket) => {
        const { min, max, populated } = reduceRange(
            data,
            bucket.startSample,
            bucket.endSample,
        );
        return {
            startSample: bucket.startSample,
            endSample: bucket.endSample,
            populated,
            min,
            max,
        };
    });
}

/**
 * Inclusive amplitude bounds (min/max) across the *populated* columns of a
 * decimated window. This is the amplitude domain the view should fit, so the
 * trace is scaled to exactly the visible samples rather than the whole record.
 */
export function visibleAmplitudeBounds(
    columns: readonly EnvelopeColumn[],
): AmplitudeBounds {
    let populated = false;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const column of columns) {
        if (!column.populated) {
            continue;
        }
        populated = true;
        if (column.min < min) {
            min = column.min;
        }
        if (column.max > max) {
            max = column.max;
        }
    }
    return { populated, min, max };
}
