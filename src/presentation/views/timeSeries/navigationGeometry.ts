/**
 * Viewport navigation arithmetic for the canvas time-series view (Phase 13).
 *
 * These are pure, DOM-free helpers. They describe how a visible *time
 * viewport* may be narrowed (zoom), slid (pan) and rebuilt from a pointer drag
 * (a pair of normalised fractions), always staying inside the full acquisition
 * window and never collapsing below a minimum number of samples.
 *
 * Like `./geometry.ts` and `./annotationGeometry.ts`, the time<->sample
 * arithmetic is deliberately NOT re-implemented here: any sample index that is
 * derived comes from the domain's own `sampleIndexOfTimeSec` and the full span
 * from `durationSecOf` (ADR-001 — "sample i occurs at i / sampleRateHz; the rate
 * is never inferred from a length"). Exactly one tested definition of the
 * mapping exists anywhere in the codebase.
 *
 * Conventions the renderer may rely on:
 * - the navigable span is a {@link ViewportBounds} (`startTimeSec` .. +
 *   `sampleCount / sampleRateHz`); every returned viewport is contained in it,
 *   so a window can neither drift off the record nor grow past it;
 * - a returned viewport always has a finite `startSec` and a positive
 *   `durationSec` of at least the effective floor
 *   (`min(minDurationSec, bounds.durationSec)`), so a short record is never
 *   asked to show more samples than it has;
 * - a fraction is a normalised position across the plot in `[0, 1]` (0 = left
 *   edge, 1 = right edge); non-finite fractions clamp to 0, exactly like
 *   `./annotationGeometry.ts`;
 * - a drag that runs right-to-left is normalised, and a zero-width drag
 *   collapses to the minimum window at that point;
 * - nothing here mutates its inputs or touches the DOM; zoom and pan change
 *   only what is *drawn* and never re-invoke the analysis service (ADR-008).
 */

import { EcgError } from '../../../domain/error';
import type { SamplingInfo } from '../../../domain/sampling';
import { durationSecOf, sampleIndexOfTimeSec } from '../../../domain/sampling';
import type { TimeViewport } from './geometry';

/** The full extent a viewport may be navigated within, in seconds. */
export interface ViewportBounds {
    /** Time (seconds) of the left edge of the navigable span. */
    readonly startSec: number;
    /** Length of the navigable span, in seconds (> 0). */
    readonly durationSec: number;
}

/** Time and sample position reported for a cursor at a normalised x fraction. */
export interface CursorReadout {
    /** Time (seconds) under the cursor, along the record's own time axis. */
    readonly timeSec: number;
    /** Nearest sample index, never negative. */
    readonly sampleIndex: number;
}

/** One zoom step halves (in) or doubles (out) the visible window. */
export const ZOOM_STEP_FACTOR = 0.5;

/** One pan step slides the window by a quarter of its own width. */
export const PAN_STEP_FRACTION = 0.25;

/**
 * Display guard: a navigated window never resolves fewer samples than this.
 * This is a presentation floor — below a couple of samples a window cannot
 * convey anything and the canvas / DWT lane mapping degrades — deliberately NOT
 * a science or measurement threshold.
 */
export const MIN_VIEWPORT_SAMPLES = 2;

function requireFiniteNumber(value: number, label: string): void {
    if (!Number.isFinite(value)) {
        throw EcgError.invalidInput(
            `${label} must be a finite number, received ${String(value)}.`,
        );
    }
}

function requirePositiveNumber(value: number, label: string): void {
    if (!Number.isFinite(value) || value <= 0) {
        throw EcgError.invalidInput(
            `${label} must be a positive finite number, received ${String(value)}.`,
        );
    }
}

function requireBounds(bounds: ViewportBounds): void {
    requireFiniteNumber(bounds.startSec, 'viewport bounds start (seconds)');
    requirePositiveNumber(bounds.durationSec, 'viewport bounds duration (seconds)');
}

function requireMinDuration(minDurationSec: number): void {
    requirePositiveNumber(minDurationSec, 'minimum viewport duration (seconds)');
}

/**
 * The minimum duration actually applied: the guard, or the whole record when
 * the record is shorter than the guard. Never larger than `bounds.durationSec`,
 * so a tiny record still yields a valid (full-record) window.
 */
function floorDuration(bounds: ViewportBounds, minDurationSec: number): number {
    return Math.min(minDurationSec, bounds.durationSec);
}

function clampRange(value: number, lower: number, upper: number): number {
    if (value < lower) {
        return lower;
    }
    if (value > upper) {
        return upper;
    }
    return value;
}

/** Clamp to `[0, 1]`, mapping a non-finite fraction to 0. */
export function clampFraction(fraction: number): number {
    if (!(fraction > 0)) {
        return 0;
    }
    return fraction > 1 ? 1 : fraction;
}

/**
 * The navigable span of a record of `sampleCount` samples: from the record's
 * own time origin to the end of its acquisition window
 * (`durationSecOf(sampleCount, sampling.sampleRateHz)`).
 */
export function viewportBoundsOf(
    sampling: SamplingInfo,
    sampleCount: number,
): ViewportBounds {
    requireFiniteNumber(sampling.startTimeSec, 'start time (seconds)');
    return {
        startSec: sampling.startTimeSec,
        durationSec: durationSecOf(sampleCount, sampling.sampleRateHz),
    };
}

/** Seconds spanned by {@link MIN_VIEWPORT_SAMPLES} at `sampling`'s rate. */
export function minViewportDurationSec(sampling: SamplingInfo): number {
    return durationSecOf(MIN_VIEWPORT_SAMPLES, sampling.sampleRateHz);
}

/**
 * Force a viewport to lie inside `bounds` with a duration between the effective
 * floor and the bounds' own duration. A non-positive duration is grown to the
 * floor rather than silently drawing nothing.
 */
export function clampViewport(
    viewport: TimeViewport,
    bounds: ViewportBounds,
    minDurationSec: number,
): TimeViewport {
    requireBounds(bounds);
    requireMinDuration(minDurationSec);
    requireFiniteNumber(viewport.startSec, 'viewport start (seconds)');
    requireFiniteNumber(viewport.durationSec, 'viewport duration (seconds)');

    const floor = floorDuration(bounds, minDurationSec);
    const durationSec = clampRange(viewport.durationSec, floor, bounds.durationSec);
    const maxStartSec = bounds.startSec + bounds.durationSec - durationSec;
    const startSec = clampRange(viewport.startSec, bounds.startSec, maxStartSec);
    return { startSec, durationSec };
}

/**
 * Scale the window by `factor` (`< 1` zooms in, `> 1` zooms out) while keeping
 * the time under `anchorFraction` fixed, then clamp the result inside `bounds`.
 * An anchor at 0 keeps the left edge, an anchor at 1 keeps the right edge, and a
 * clamped edge makes the window "stick" to the record boundary instead of
 * overshooting it.
 */
export function zoomViewport(
    viewport: TimeViewport,
    bounds: ViewportBounds,
    factor: number,
    anchorFraction: number,
    minDurationSec: number,
): TimeViewport {
    requireBounds(bounds);
    requireMinDuration(minDurationSec);
    requirePositiveNumber(factor, 'zoom factor');

    const current = clampViewport(viewport, bounds, minDurationSec);
    const anchor = clampFraction(anchorFraction);
    const floor = floorDuration(bounds, minDurationSec);

    const durationSec = clampRange(
        current.durationSec * factor,
        floor,
        bounds.durationSec,
    );
    const anchorTimeSec = current.startSec + anchor * current.durationSec;
    const maxStartSec = bounds.startSec + bounds.durationSec - durationSec;
    const startSec = clampRange(
        anchorTimeSec - anchor * durationSec,
        bounds.startSec,
        maxStartSec,
    );
    return { startSec, durationSec };
}

/**
 * Slide the window by `deltaFraction` of its own width (positive moves later in
 * time) and clamp it inside `bounds`. For any window already inside `bounds` —
 * the only kind this module and the views ever produce — the duration is
 * preserved *exactly*: panning never zooms. A pathological window wider than the
 * record is capped to the record rather than left sticking out, and a duration
 * below the display floor is preserved as-is (the floor is applied where windows
 * are created, not where they are slid).
 */
export function panViewport(
    viewport: TimeViewport,
    bounds: ViewportBounds,
    deltaFraction: number,
): TimeViewport {
    requireBounds(bounds);
    requireFiniteNumber(deltaFraction, 'pan delta fraction');
    requireFiniteNumber(viewport.startSec, 'viewport start (seconds)');
    requirePositiveNumber(viewport.durationSec, 'viewport duration (seconds)');

    const durationSec = Math.min(viewport.durationSec, bounds.durationSec);
    const maxStartSec = bounds.startSec + bounds.durationSec - durationSec;
    const startSec = clampRange(
        viewport.startSec + deltaFraction * durationSec,
        bounds.startSec,
        maxStartSec,
    );
    return { startSec, durationSec };
}

/**
 * Build a viewport from two normalised drag positions. The pair is normalised
 * (a right-to-left drag selects the same window as left-to-right) and clamped
 * to the plot; a zero-width drag collapses to the minimum window anchored at
 * that point, which is then clamped inside `bounds` like any other window.
 */
export function viewportFromFractions(
    bounds: ViewportBounds,
    startFraction: number,
    endFraction: number,
    minDurationSec: number,
): TimeViewport {
    requireBounds(bounds);
    requireMinDuration(minDurationSec);

    const from = clampFraction(startFraction);
    const to = clampFraction(endFraction);
    const lower = Math.min(from, to);
    const upper = Math.max(from, to);
    const floor = floorDuration(bounds, minDurationSec);
    const durationSec = clampRange(
        (upper - lower) * bounds.durationSec,
        floor,
        bounds.durationSec,
    );
    return clampViewport(
        {
            startSec: bounds.startSec + lower * bounds.durationSec,
            durationSec,
        },
        bounds,
        minDurationSec,
    );
}

/**
 * Time and nearest sample index under a cursor at `xFraction` across
 * `viewport`. The fraction is clamped to `[0, 1]` and the sample index comes
 * from the domain's `sampleIndexOfTimeSec` (round rounding), floored at 0.
 *
 * The index is a *readout*, not a data access: at the right edge it can equal
 * the window's exclusive end sample, so callers must not use it to index a
 * buffer without their own range check.
 */
export function readoutAtFraction(
    xFraction: number,
    viewport: TimeViewport,
    sampling: SamplingInfo,
): CursorReadout {
    requireFiniteNumber(viewport.startSec, 'viewport start (seconds)');
    requireFiniteNumber(viewport.durationSec, 'viewport duration (seconds)');

    const fraction = clampFraction(xFraction);
    const timeSec = viewport.startSec + fraction * viewport.durationSec;
    const sampleIndex = Math.max(
        0,
        sampleIndexOfTimeSec(timeSec, sampling, 'round'),
    );
    return { timeSec, sampleIndex };
}

/** Caption label shown before the cursor has entered the plot. */
export const CURSOR_IDLE_LABEL = 'Cursor: \u2014';

/**
 * Render the cursor caption. A `null` readout (no cursor yet) yields
 * {@link CURSOR_IDLE_LABEL}; otherwise the time and sample under the cursor,
 * plus the symbol of the nearest annotation when one is supplied and non-empty.
 *
 * The symbol is folded in *after* the geometry readout and only ever names an
 * annotation the record already contains — it is never a detection result and
 * never alters the time or sample (ADR-015).
 */
export function formatCursorReadout(
    readout: CursorReadout | null,
    annotationSymbol?: string | null,
): string {
    if (readout === null) {
        return CURSOR_IDLE_LABEL;
    }
    const base = `Cursor: ${readout.timeSec.toFixed(2)} s \u00b7 sample ${readout.sampleIndex}`;
    const symbol = annotationSymbol ?? '';
    return symbol.length > 0 ? `${base} \u00b7 nearest ${symbol}` : base;
}
