/**
 * Pure viewport navigation arithmetic tests (Phase 13).
 *
 * Node environment (no `// @vitest-environment jsdom` directive) — this module
 * is DOM-free by design, so its unit tests run in the global Node default and
 * never need layout or a canvas. jsdom cannot measure
 * `getBoundingClientRect()` (it returns zeros), so every navigation guarantee
 * that matters numerically is pinned here, on arithmetic, while the component
 * test only asserts the inert pointer path.
 */

import { describe, expect, it } from 'vitest';

import { EcgError } from '../../../../domain/error';
import { createSamplingInfo } from '../../../../domain/sampling';
import {
    CURSOR_IDLE_LABEL,
    MIN_VIEWPORT_SAMPLES,
    PAN_STEP_FRACTION,
    ZOOM_STEP_FACTOR,
    clampFraction,
    clampViewport,
    formatCursorReadout,
    minViewportDurationSec,
    panViewport,
    readoutAtFraction,
    viewportBoundsOf,
    viewportFromFractions,
    zoomViewport,
} from '../navigationGeometry';

const HZ = 2; // 0.5 s between samples: sample i sits at i/2 s.
const sampling = createSamplingInfo(HZ, 0);
const SAMPLE_COUNT = 8; // 4 s
const BOUNDS = { startSec: 0, durationSec: 4 } as const;
const MIN = minViewportDurationSec(sampling); // 1 s == 2 samples

/** Assert the call throws a classified `invalid-input` EcgError. */
function expectInvalidInput(run: () => unknown): void {
    let threw = false;
    try {
        run();
    } catch (error) {
        threw = true;
        expect(error).toBeInstanceOf(EcgError);
        expect((error as EcgError).code).toBe('invalid-input');
    }
    expect(threw).toBe(true);
}

/** Assert a viewport lies entirely inside `bounds`. */
function expectContained(
    viewport: { startSec: number; durationSec: number },
    bounds: { startSec: number; durationSec: number },
): void {
    expect(Number.isFinite(viewport.startSec)).toBe(true);
    expect(Number.isFinite(viewport.durationSec)).toBe(true);
    expect(viewport.durationSec).toBeGreaterThan(0);
    expect(viewport.durationSec).toBeLessThanOrEqual(bounds.durationSec + 1e-12);
    expect(viewport.startSec).toBeGreaterThanOrEqual(bounds.startSec - 1e-12);
    expect(
        viewport.startSec + viewport.durationSec,
    ).toBeLessThanOrEqual(bounds.startSec + bounds.durationSec + 1e-12);
}

/**
 * Assert a viewport is contained in `bounds` AND honours the display floor.
 * Only the functions that *create* a window enforce the floor; `panViewport`
 * slides whatever it is given (see its doc comment).
 */
function expectInsideBounds(
    viewport: { startSec: number; durationSec: number },
    bounds: { startSec: number; durationSec: number },
    minDurationSec: number,
): void {
    expectContained(viewport, bounds);
    expect(viewport.durationSec).toBeGreaterThanOrEqual(
        Math.min(minDurationSec, bounds.durationSec) - 1e-12,
    );
}

describe('clampFraction (normalised position -> [0, 1])', () => {
    it('passes an interior fraction through unchanged', () => {
        expect(clampFraction(0)).toBe(0);
        expect(clampFraction(0.25)).toBe(0.25);
        expect(clampFraction(0.5)).toBe(0.5);
        expect(clampFraction(1)).toBe(1);
    });

    it('clamps outside the plot to its edges', () => {
        expect(clampFraction(-3)).toBe(0);
        expect(clampFraction(2)).toBe(1);
        expect(clampFraction(Number.NEGATIVE_INFINITY)).toBe(0);
        expect(clampFraction(Number.POSITIVE_INFINITY)).toBe(1);
    });

    it('maps a non-finite (NaN) fraction to 0', () => {
        expect(clampFraction(Number.NaN)).toBe(0);
    });
});

describe('viewportBoundsOf / minViewportDurationSec', () => {
    it('spans the whole acquisition window of the record', () => {
        expect(viewportBoundsOf(sampling, SAMPLE_COUNT)).toEqual({
            startSec: 0,
            durationSec: 4,
        });
    });

    it('honours a record with a non-zero acquisition start', () => {
        expect(viewportBoundsOf(createSamplingInfo(HZ, 10), 4)).toEqual({
            startSec: 10,
            durationSec: 2,
        });
    });

    it('rejects an invalid sample count as invalid-input', () => {
        expectInvalidInput(() => viewportBoundsOf(sampling, -1));
        expectInvalidInput(() => viewportBoundsOf(sampling, 1.5));
    });

    it('expresses the minimum window in samples, not seconds', () => {
        expect(MIN_VIEWPORT_SAMPLES).toBe(2);
        expect(minViewportDurationSec(sampling)).toBe(1);
        expect(minViewportDurationSec(createSamplingInfo(4, 0))).toBe(0.5);
    });
});

describe('clampViewport (keep a window inside the record)', () => {
    it('leaves an already-valid window untouched', () => {
        expect(clampViewport({ startSec: 1, durationSec: 2 }, BOUNDS, MIN)).toEqual({
            startSec: 1,
            durationSec: 2,
        });
    });

    it('pulls a window that starts before the record back to the left edge', () => {
        expect(clampViewport({ startSec: -3, durationSec: 1 }, BOUNDS, MIN)).toEqual({
            startSec: 0,
            durationSec: 1,
        });
    });

    it('pulls a window that runs past the record back to the right edge', () => {
        expect(clampViewport({ startSec: 10, durationSec: 2 }, BOUNDS, MIN)).toEqual({
            startSec: 2,
            durationSec: 2,
        });
    });

    it('shrinks an over-long window to the whole record', () => {
        expect(clampViewport({ startSec: 1, durationSec: 9 }, BOUNDS, MIN)).toEqual({
            startSec: 0,
            durationSec: 4,
        });
    });

    it('grows a window below the display floor and re-clamps its start', () => {
        expect(clampViewport({ startSec: 2, durationSec: 0.25 }, BOUNDS, MIN)).toEqual({
            startSec: 2,
            durationSec: 1,
        });
        expect(clampViewport({ startSec: 3.9, durationSec: 0.25 }, BOUNDS, MIN)).toEqual({
            startSec: 3,
            durationSec: 1,
        });
    });

    it('never returns a zero or negative duration', () => {
        expect(clampViewport({ startSec: 0, durationSec: 0 }, BOUNDS, MIN)).toEqual({
            startSec: 0,
            durationSec: 1,
        });
        expect(clampViewport({ startSec: 0, durationSec: -2 }, BOUNDS, MIN)).toEqual({
            startSec: 0,
            durationSec: 1,
        });
    });

    it('never grows a window past a record shorter than the display floor', () => {
        // 1 sample at 2 Hz == 0.5 s, which is below the 1 s floor: the floor is
        // lowered to the record so a full-record window is still returned.
        const tiny = { startSec: 0, durationSec: 0.5 } as const;
        expect(clampViewport({ startSec: 0, durationSec: 3 }, tiny, MIN)).toEqual({
            startSec: 0,
            durationSec: 0.5,
        });
    });

    it('classifies non-finite / non-positive inputs as invalid-input', () => {
        expectInvalidInput(() => clampViewport({ startSec: Number.NaN, durationSec: 1 }, BOUNDS, MIN));
        expectInvalidInput(() => clampViewport({ startSec: 0, durationSec: Number.NaN }, BOUNDS, MIN));
        expectInvalidInput(() => clampViewport({ startSec: 0, durationSec: 1 }, { startSec: 0, durationSec: 0 }, MIN));
        expectInvalidInput(() => clampViewport({ startSec: 0, durationSec: 1 }, BOUNDS, 0));
    });
});

describe('zoomViewport (scale about a fixed anchor)', () => {
    it('halves the window about its centre, keeping the centre fixed', () => {
        expect(zoomViewport({ startSec: 0, durationSec: 4 }, BOUNDS, ZOOM_STEP_FACTOR, 0.5, MIN)).toEqual({
            startSec: 1,
            durationSec: 2,
        });
    });

    it('doubles the window about its centre', () => {
        expect(zoomViewport({ startSec: 1, durationSec: 2 }, BOUNDS, 2, 0.5, MIN)).toEqual({
            startSec: 0,
            durationSec: 4,
        });
    });

    it('keeps the left edge when anchored at 0 and the right edge when anchored at 1', () => {
        expect(zoomViewport({ startSec: 0, durationSec: 4 }, BOUNDS, ZOOM_STEP_FACTOR, 0, MIN)).toEqual({
            startSec: 0,
            durationSec: 2,
        });
        expect(zoomViewport({ startSec: 0, durationSec: 4 }, BOUNDS, ZOOM_STEP_FACTOR, 1, MIN)).toEqual({
            startSec: 2,
            durationSec: 2,
        });
    });

    it('sticks to the record edge instead of overshooting when zooming out', () => {
        expect(zoomViewport({ startSec: 1, durationSec: 2 }, BOUNDS, 2, 1, MIN)).toEqual({
            startSec: 0,
            durationSec: 4,
        });
    });

    it('respects the display floor for an extreme zoom-in', () => {
        const zoomed = zoomViewport({ startSec: 0, durationSec: 4 }, BOUNDS, 0.1, 0.5, MIN);
        expect(zoomed).toEqual({ startSec: 1.5, durationSec: 1 });
    });

    it('clamps an out-of-plot anchor into the plot', () => {
        expect(zoomViewport({ startSec: 0, durationSec: 4 }, BOUNDS, 0.5, -5, MIN)).toEqual({
            startSec: 0,
            durationSec: 2,
        });
        expect(zoomViewport({ startSec: 0, durationSec: 4 }, BOUNDS, 0.5, 5, MIN)).toEqual({
            startSec: 2,
            durationSec: 2,
        });
    });

    it('classifies a non-positive factor as invalid-input', () => {
        expectInvalidInput(() => zoomViewport({ startSec: 0, durationSec: 4 }, BOUNDS, 0, 0.5, MIN));
        expectInvalidInput(() => zoomViewport({ startSec: 0, durationSec: 4 }, BOUNDS, -2, 0.5, MIN));
        expectInvalidInput(() => zoomViewport({ startSec: 0, durationSec: 4 }, BOUNDS, Number.NaN, 0.5, MIN));
    });
});

describe('panViewport (slide without rescaling)', () => {
    it('slides right by the pan step, preserving the duration', () => {
        expect(panViewport({ startSec: 0, durationSec: 1 }, BOUNDS, PAN_STEP_FRACTION)).toEqual({
            startSec: 0.25,
            durationSec: 1,
        });
    });

    it('sticks to the left edge instead of sliding off the record', () => {
        expect(panViewport({ startSec: 0.25, durationSec: 1 }, BOUNDS, -1)).toEqual({
            startSec: 0,
            durationSec: 1,
        });
    });

    it('sticks to the right edge instead of sliding off the record', () => {
        expect(panViewport({ startSec: 2, durationSec: 2 }, BOUNDS, 1)).toEqual({
            startSec: 2,
            durationSec: 2,
        });
    });

    it('is a no-op for a full-record window', () => {
        expect(panViewport({ startSec: 0, durationSec: 4 }, BOUNDS, 0.5)).toEqual({
            startSec: 0,
            durationSec: 4,
        });
    });

    it('caps a window wider than the record instead of letting it stick out', () => {
        expect(panViewport({ startSec: 0, durationSec: 9 }, BOUNDS, PAN_STEP_FRACTION)).toEqual({
            startSec: 0,
            durationSec: 4,
        });
        expect(panViewport({ startSec: 99, durationSec: 9 }, BOUNDS, -1)).toEqual({
            startSec: 0,
            durationSec: 4,
        });
    });

    it('classifies a non-finite delta or non-positive duration as invalid-input', () => {
        expectInvalidInput(() => panViewport({ startSec: 0, durationSec: 1 }, BOUNDS, Number.NaN));
        expectInvalidInput(() => panViewport({ startSec: 0, durationSec: 0 }, BOUNDS, 0.25));
    });
});

describe('viewportFromFractions (pointer drag -> window)', () => {
    it('maps a forward drag to the window it covers', () => {
        expect(viewportFromFractions(BOUNDS, 0.25, 0.75, MIN)).toEqual({
            startSec: 1,
            durationSec: 2,
        });
    });

    it('normalises a reversed drag to the same window', () => {
        expect(viewportFromFractions(BOUNDS, 0.75, 0.25, MIN)).toEqual({
            startSec: 1,
            durationSec: 2,
        });
    });

    it('collapses a zero-width drag to the minimum window at that point', () => {
        expect(viewportFromFractions(BOUNDS, 0.5, 0.5, MIN)).toEqual({
            startSec: 2,
            durationSec: 1,
        });
    });

    it('clamps a zero-width drag at the right edge inside the record', () => {
        expect(viewportFromFractions(BOUNDS, 1, 1, MIN)).toEqual({
            startSec: 3,
            durationSec: 1,
        });
    });

    it('clamps out-of-plot fractions to the full record', () => {
        expect(viewportFromFractions(BOUNDS, -1, 2, MIN)).toEqual({
            startSec: 0,
            durationSec: 4,
        });
    });

    it('grows a sub-floor drag to the display floor', () => {
        expect(viewportFromFractions(BOUNDS, 0, 0.05, MIN)).toEqual({
            startSec: 0,
            durationSec: 1,
        });
        expect(viewportFromFractions(BOUNDS, 0.9, 1, MIN)).toEqual({
            startSec: 3,
            durationSec: 1,
        });
    });

    it('honours a non-zero acquisition start', () => {
        const offset = { startSec: 10, durationSec: 4 } as const;
        expect(viewportFromFractions(offset, 0.5, 1, 1)).toEqual({
            startSec: 12,
            durationSec: 2,
        });
    });

    it('classifies invalid bounds or floor as invalid-input', () => {
        expectInvalidInput(() => viewportFromFractions({ startSec: 0, durationSec: 0 }, 0, 1, MIN));
        expectInvalidInput(() => viewportFromFractions(BOUNDS, 0, 1, -1));
    });
});

describe('readoutAtFraction (cursor -> time and sample)', () => {
    it('reads time and sample at the left, middle and right of the window', () => {
        const viewport = { startSec: 0, durationSec: 4 } as const;
        expect(readoutAtFraction(0, viewport, sampling)).toEqual({
            timeSec: 0,
            sampleIndex: 0,
        });
        expect(readoutAtFraction(0.5, viewport, sampling)).toEqual({
            timeSec: 2,
            sampleIndex: 4,
        });
        expect(readoutAtFraction(1, viewport, sampling)).toEqual({
            timeSec: 4,
            sampleIndex: 8,
        });
    });

    it('clamps fractions outside the plot to its edges', () => {
        const viewport = { startSec: 0, durationSec: 4 } as const;
        expect(readoutAtFraction(-1, viewport, sampling)).toEqual({
            timeSec: 0,
            sampleIndex: 0,
        });
        expect(readoutAtFraction(2, viewport, sampling)).toEqual({
            timeSec: 4,
            sampleIndex: 8,
        });
        expect(readoutAtFraction(Number.NaN, viewport, sampling)).toEqual({
            timeSec: 0,
            sampleIndex: 0,
        });
    });

    it('follows the window rather than the record', () => {
        const viewport = { startSec: 1, durationSec: 2 } as const;
        expect(readoutAtFraction(0, viewport, sampling)).toEqual({
            timeSec: 1,
            sampleIndex: 2,
        });
        expect(readoutAtFraction(0.25, viewport, sampling)).toEqual({
            timeSec: 1.5,
            sampleIndex: 3,
        });
        expect(readoutAtFraction(0.75, viewport, sampling)).toEqual({
            timeSec: 2.5,
            sampleIndex: 5,
        });
        expect(readoutAtFraction(1, viewport, sampling)).toEqual({
            timeSec: 3,
            sampleIndex: 6,
        });
    });

    it('rounds to the nearest sample, matching the domain conversion', () => {
        // t = 0.25 s at 2 Hz is sample 0.5 -> round -> 1.
        expect(readoutAtFraction(0.25, { startSec: 0, durationSec: 1 }, sampling)).toEqual({
            timeSec: 0.25,
            sampleIndex: 1,
        });
    });

    it('respects an absolute time axis', () => {
        expect(
            readoutAtFraction(0.5, { startSec: 10, durationSec: 2 }, createSamplingInfo(HZ, 10)),
        ).toEqual({ timeSec: 11, sampleIndex: 2 });
    });

    it('never reports a negative sample index', () => {
        // A cursor before the record's first sample rounds to a negative index
        // and must floor at 0 (this is a readout, never a buffer access).
        expect(
            readoutAtFraction(0.5, { startSec: 9.5, durationSec: 0.5 }, createSamplingInfo(HZ, 10)),
        ).toEqual({ timeSec: 9.75, sampleIndex: 0 });
    });

    it('classifies a non-finite viewport as invalid-input', () => {
        expectInvalidInput(() =>
            readoutAtFraction(0.5, { startSec: Number.NaN, durationSec: 1 }, sampling),
        );
        expectInvalidInput(() =>
            readoutAtFraction(0.5, { startSec: 0, durationSec: Number.NaN }, sampling),
        );
    });
});

describe('navigation invariants', () => {
    it('keeps every derived window inside the record', () => {
        const seeds = [
            { startSec: 0, durationSec: 4 },
            { startSec: 1, durationSec: 2 },
            { startSec: 2.5, durationSec: 1.5 },
            { startSec: -5, durationSec: 0.05 },
            { startSec: 99, durationSec: 12 },
        ] as const;
        const factors = [0.1, 0.5, 1.5, 8] as const;
        const anchors = [0, 0.25, 0.5, 1] as const;
        const deltas = [-4, -0.25, 0, 0.25, 4] as const;

        for (const seed of seeds) {
            expectInsideBounds(clampViewport(seed, BOUNDS, MIN), BOUNDS, MIN);
            for (const factor of factors) {
                for (const anchor of anchors) {
                    expectInsideBounds(
                        zoomViewport(seed, BOUNDS, factor, anchor, MIN),
                        BOUNDS,
                        MIN,
                    );
                }
            }
            for (const delta of deltas) {
                // Pan only slides: containment is guaranteed, the floor is not
                // re-applied (it belongs to a window's creation, not its slide).
                expectContained(panViewport(seed, BOUNDS, delta), BOUNDS);
            }
            for (const end of anchors) {
                expectInsideBounds(viewportFromFractions(BOUNDS, 0.5, end, MIN), BOUNDS, MIN);
            }
        }
    });

    it('never changes the duration when panning at the zoom floor', () => {
        const seeded = zoomViewport({ startSec: 0, durationSec: 4 }, BOUNDS, 0.1, 0.5, MIN);
        for (const delta of [-1, -0.25, 0, 0.25, 1]) {
            expect(panViewport(seeded, BOUNDS, delta).durationSec).toBe(seeded.durationSec);
        }
    });

    it('keeps a readout inside the drawn sample window for interior fractions', () => {
        const viewport = { startSec: 1, durationSec: 2 } as const;
        // Window is samples [2, 6): a fraction that is clearly inside the plot
        // reads a drawn sample strictly before the exclusive end.
        for (const fraction of [0, 0.1, 0.25, 0.5, 0.75]) {
            const { sampleIndex } = readoutAtFraction(fraction, viewport, sampling);
            expect(sampleIndex).toBeGreaterThanOrEqual(2);
            expect(sampleIndex).toBeLessThan(6);
        }
        // Nearest-sample rounding may reach the exclusive end sample (6) at the
        // right edge; the readout is a position, never a buffer access, so it is
        // allowed to equal the window's exclusive end but never to exceed it.
        for (const fraction of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99, 1]) {
            const { sampleIndex } = readoutAtFraction(fraction, viewport, sampling);
            expect(sampleIndex).toBeGreaterThanOrEqual(2);
            expect(sampleIndex).toBeLessThanOrEqual(6);
            expect(sampleIndex).toBeLessThanOrEqual(SAMPLE_COUNT);
        }
    });
});

describe('formatCursorReadout (readout -> caption label)', () => {
    it('exposes the idle label the view shows before the cursor enters', () => {
        expect(CURSOR_IDLE_LABEL).toBe('Cursor: \u2014');
        expect(formatCursorReadout(null)).toBe('Cursor: \u2014');
    });

    it('shows the idle label for a null readout even when a symbol is supplied', () => {
        expect(formatCursorReadout(null, 'N')).toBe('Cursor: \u2014');
    });

    it('renders the time and sample with two-decimal seconds and a middle dot', () => {
        expect(formatCursorReadout({ timeSec: 1.25, sampleIndex: 5 })).toBe(
            'Cursor: 1.25 s \u00b7 sample 5',
        );
    });

    it('keeps two fixed decimals for a whole-second time', () => {
        expect(formatCursorReadout({ timeSec: 2, sampleIndex: 4 })).toBe(
            'Cursor: 2.00 s \u00b7 sample 4',
        );
    });

    it('appends the nearest annotation symbol when one is supplied', () => {
        expect(formatCursorReadout({ timeSec: 1.25, sampleIndex: 5 }, 'A')).toBe(
            'Cursor: 1.25 s \u00b7 sample 5 \u00b7 nearest A',
        );
    });

    it('ignores an absent or empty symbol', () => {
        const readout = { timeSec: 1.25, sampleIndex: 5 } as const;
        const plain = 'Cursor: 1.25 s \u00b7 sample 5';

        expect(formatCursorReadout(readout, null)).toBe(plain);
        expect(formatCursorReadout(readout, undefined)).toBe(plain);
        expect(formatCursorReadout(readout, '')).toBe(plain);
    });
});
