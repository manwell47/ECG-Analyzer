/**
 * Real-data display-invariant Node gate (Phase 16 / ADR-017).
 *
 * Re-measures the display invariants Phases 12-15 pinned over synthetic
 * fixtures, but now over a *genuine* MIT-BIH record: its own annotations and its
 * own single audited ADC->mV signal. Nothing here runs the analysis pipeline.
 * The pure display helpers take the signal and the record's own events directly
 * (exactly as `TimeSeriesView.svelte` does), so the gate stays cheap,
 * deterministic and fast — no db4 DWT over 650k samples.
 *
 * Every assertion is a *structural property of the display mapping* — one
 * marker per populated column, consistent counts, contained windows, ordered
 * bounds — never a detection and never a clinical statement (ADR-013). Nothing
 * is mutated and the record is only read; the helpers are *measured*, never
 * changed.
 *
 * Opt-in by absence: the raw dataset is gitignored (ADR-006 local-first), so on
 * a clean clone `firstCompleteRecordId()` returns `undefined` and every case
 * **skips**. This file runs in the default Node environment (no
 * `@vitest-environment` directive).
 *
 * The record is read once at module scope rather than in a `beforeAll`, because
 * the plan requires the annotation-dependent cases to be driven by
 * `it.skipIf(...)` on the record's *own annotation count* — a value only known
 * after the read. The await resolves before any `describe`/`it` registers, so
 * the "read once per file" and "skip when absent / unannotated" guarantees both
 * hold exactly.
 */
import { describe, expect, it } from 'vitest';

import type { AnnotationEvent, SignalRecord } from '../../../../domain/record';
import { timeSecOfSample, type SamplingInfo } from '../../../../domain/sampling';
import type { Signal } from '../../../../domain/signal';
import {
    REAL_RECORD_SKIP_REASON,
    firstCompleteRecordId,
    loadRealRecord,
} from '../../../../datasets/__tests__/realRecordSupport';
import {
    ANNOTATION_DETAIL_IDLE_LABEL,
    annotationMarkers,
    filterAnnotationsBySymbol,
    formatAnnotationDetail,
    nearestAnnotationEventAtFraction,
    resolveSymbolFilter,
    type AnnotationMarkers,
} from '../annotationGeometry';
import {
    envelopeColumns,
    sampleWindowOfTime,
    visibleAmplitudeBounds,
    type SampleWindow,
    type TimeViewport,
} from '../geometry';
import {
    PAN_STEP_FRACTION,
    ZOOM_STEP_FACTOR,
    clampViewport,
    minViewportDurationSec,
    panViewport,
    readoutAtFraction,
    viewportBoundsOf,
    zoomViewport,
} from '../navigationGeometry';

/** Pixel columns the gate draws into (the view's own order of magnitude). */
const COLUMN_COUNT = 720;

const recordId = firstCompleteRecordId();
const loaded = recordId === undefined ? undefined : await loadRealRecord();
const datasetAbsent = loaded === undefined;
const hasAnnotations = loaded !== undefined && loaded.record.annotations.length > 0;

/** The shared view state, derived once from the real record. */
interface RealDisplayFixture {
    readonly record: SignalRecord;
    readonly signal: Signal;
    readonly sampling: SamplingInfo;
    readonly sampleCount: number;
    readonly viewport: TimeViewport;
    readonly window: SampleWindow;
    readonly inWindow: readonly AnnotationEvent[];
    readonly markers: AnnotationMarkers;
}

let fixture: RealDisplayFixture | undefined;

/** Build (once) the full-record view state the helpers are measured against. */
function display(): RealDisplayFixture {
    if (loaded === undefined) {
        throw new Error(REAL_RECORD_SKIP_REASON);
    }
    if (fixture === undefined) {
        const { record, signal } = loaded;
        const sampling = signal.sampling;
        const sampleCount = record.sampleCount;
        const bounds = viewportBoundsOf(sampling, sampleCount);
        const viewport: TimeViewport = {
            startSec: bounds.startSec,
            durationSec: bounds.durationSec,
        };
        const window = sampleWindowOfTime(viewport, sampling, sampleCount);
        const inWindow = record.annotations.filter(
            (annotation) =>
                annotation.sampleIndex >= window.startSample &&
                annotation.sampleIndex < window.endSample,
        );
        fixture = {
            record,
            signal,
            sampling,
            sampleCount,
            viewport,
            window,
            inWindow,
            markers: annotationMarkers(
                record.annotations,
                viewport,
                sampling,
                sampleCount,
                COLUMN_COUNT,
            ),
        };
    }
    return fixture;
}

/** The plot fraction of a sample, recomputed from the record's own facts. */
function xFractionOf(
    sampleIndex: number,
    viewport: TimeViewport,
    sampling: SamplingInfo,
): number {
    const timeSec = timeSecOfSample(sampleIndex, sampling);
    const fraction = (timeSec - viewport.startSec) / viewport.durationSec;
    if (!(fraction > 0)) {
        return 0;
    }
    return fraction > 1 ? 1 : fraction;
}

/** The display column a sample falls into (the documented density-cap mapping). */
function columnOf(
    sampleIndex: number,
    viewport: TimeViewport,
    sampling: SamplingInfo,
): number {
    return Math.min(
        COLUMN_COUNT - 1,
        Math.floor(xFractionOf(sampleIndex, viewport, sampling) * COLUMN_COUNT),
    );
}

/** The selection tie-break: nearer, then lower sample index, then smaller symbol. */
function bySampleThenSymbol(left: AnnotationEvent, right: AnnotationEvent): number {
    if (left.sampleIndex !== right.sampleIndex) {
        return left.sampleIndex - right.sampleIndex;
    }
    if (left.symbol === right.symbol) {
        return 0;
    }
    return left.symbol < right.symbol ? -1 : 1;
}

describe('real-data display invariants (opt-in integration)', () => {
    describe('overlay / density cap', () => {
        it.skipIf(!hasAnnotations)(
            'caps to one marker per populated pixel column, ordered left to right',
            () => {
                const { markers, inWindow, viewport, sampling } = display();

                const occupied = new Set(
                    inWindow.map((annotation) =>
                        columnOf(annotation.sampleIndex, viewport, sampling),
                    ),
                );
                expect(markers.markers.length).toBe(occupied.size);
                expect(markers.markers.length).toBeLessThanOrEqual(COLUMN_COUNT);

                markers.markers.forEach((marker, index) => {
                    expect(marker.xFraction).toBeGreaterThanOrEqual(0);
                    expect(marker.xFraction).toBeLessThanOrEqual(1);
                    const previous = markers.markers[index - 1];
                    if (previous !== undefined) {
                        expect(marker.xFraction).toBeGreaterThanOrEqual(
                            previous.xFraction,
                        );
                    }
                });
            },
        );

        it.skipIf(!hasAnnotations)(
            'counts the visible window annotations and the merged rest consistently',
            () => {
                const { markers, inWindow } = display();

                expect(markers.visibleCount).toBe(inWindow.length);
                expect(markers.mergedCount).toBe(
                    markers.visibleCount - markers.markers.length,
                );
                expect(markers.mergedCount).toBeGreaterThanOrEqual(0);
                const collapsed = markers.markers.reduce(
                    (total, marker) => total + (marker.mergedCount - 1),
                    0,
                );
                expect(collapsed).toBe(markers.mergedCount);
            },
        );

        it.skipIf(!hasAnnotations)(
            'keeps every marker sample inside the half-open drawn window',
            () => {
                const { markers, window } = display();

                for (const marker of markers.markers) {
                    expect(marker.sampleIndex).toBeGreaterThanOrEqual(
                        window.startSample,
                    );
                    expect(marker.sampleIndex).toBeLessThan(window.endSample);
                    expect(marker.symbol.length).toBeGreaterThan(0);
                    expect(marker.mergedCount).toBeGreaterThanOrEqual(1);
                }
            },
        );

        it.skipIf(!hasAnnotations)(
            'picks the lowest sample index of each column regardless of input order',
            () => {
                const { record, markers, inWindow, viewport, sampling, sampleCount } =
                    display();

                const lowestByColumn = new Map<number, number>();
                for (const annotation of inWindow) {
                    const column = columnOf(annotation.sampleIndex, viewport, sampling);
                    const lowest = lowestByColumn.get(column);
                    if (lowest === undefined || annotation.sampleIndex < lowest) {
                        lowestByColumn.set(column, annotation.sampleIndex);
                    }
                }
                const ascendingColumns = [...lowestByColumn.keys()].sort(
                    (left, right) => left - right,
                );
                expect(markers.markers.map((marker) => marker.sampleIndex)).toEqual(
                    ascendingColumns.map((column) => lowestByColumn.get(column)),
                );

                // Reversing the input cannot change a single marker.
                const shuffled = annotationMarkers(
                    [...record.annotations].reverse(),
                    viewport,
                    sampling,
                    sampleCount,
                    COLUMN_COUNT,
                );
                expect(shuffled.markers).toEqual(markers.markers);
            },
        );

        it.skipIf(!hasAnnotations)(
            'lists the window distinct symbols ascending without mutating the record',
            () => {
                const { record, markers, inWindow } = display();

                const expected = [
                    ...new Set(inWindow.map((annotation) => annotation.symbol)),
                ].sort();
                expect(markers.symbols).toEqual(expected);

                const snapshot = [...record.annotations];
                expect(record.annotations).toHaveLength(snapshot.length);
                snapshot.forEach((event, index) => {
                    expect(record.annotations[index]).toBe(event);
                });
            },
        );
    });

    describe('symbol filter', () => {
        it.skipIf(!hasAnnotations)(
            'treats "All symbols" as the identity, never a copy',
            () => {
                const { record } = display();

                expect(filterAnnotationsBySymbol(record.annotations, null)).toBe(
                    record.annotations,
                );
                expect(filterAnnotationsBySymbol(record.annotations, '')).toBe(
                    record.annotations,
                );
            },
        );

        it.skipIf(!hasAnnotations)(
            'returns the exact-match subset for a real window symbol',
            () => {
                const { record, markers } = display();

                const symbol = markers.symbols[0];
                expect(symbol).toBeDefined();
                if (symbol === undefined) {
                    return;
                }
                const subset = filterAnnotationsBySymbol(record.annotations, symbol);
                expect(subset.length).toBeGreaterThan(0);
                expect(subset.length).toBe(
                    record.annotations.filter(
                        (annotation) => annotation.symbol === symbol,
                    ).length,
                );
                for (const event of subset) {
                    expect(event.symbol).toBe(symbol);
                }
            },
        );

        it.skipIf(!hasAnnotations)(
            'resolves a legend symbol to itself and an unknown symbol to null',
            () => {
                const { markers } = display();

                const symbol = markers.symbols[0];
                expect(symbol).toBeDefined();
                if (symbol === undefined) {
                    return;
                }
                expect(resolveSymbolFilter(symbol, markers.symbols)).toBe(symbol);
                expect(
                    resolveSymbolFilter('__not_a_real_symbol__', markers.symbols),
                ).toBeNull();
                expect(resolveSymbolFilter(null, markers.symbols)).toBeNull();
            },
        );
    });

    describe('cursor / hover detail', () => {
        it.skipIf(!hasAnnotations)(
            "returns the record's own event when queried at its own x fraction",
            () => {
                const { record, inWindow, viewport, sampling, sampleCount } = display();

                const chosen = inWindow[0];
                expect(chosen).toBeDefined();
                if (chosen === undefined) {
                    return;
                }
                const cursorFraction = xFractionOf(chosen.sampleIndex, viewport, sampling);
                const hit = nearestAnnotationEventAtFraction(
                    record.annotations,
                    cursorFraction,
                    viewport,
                    sampling,
                    sampleCount,
                );
                expect(hit).not.toBeNull();

                // Every event sitting at distance zero, ordered by the documented
                // tie-break; the helper must return that winner verbatim.
                const zeroDistance = inWindow
                    .filter(
                        (annotation) =>
                            xFractionOf(annotation.sampleIndex, viewport, sampling) ===
                            cursorFraction,
                    )
                    .sort(bySampleThenSymbol);
                expect(hit?.event).toBe(zeroDistance[0]);
                expect(hit?.event.sampleIndex).toBe(chosen.sampleIndex);
            },
        );

        it.skipIf(!hasAnnotations)(
            "formats the detail line with the record's own symbol and sample index",
            () => {
                const { record, inWindow, viewport, sampling, sampleCount } = display();

                const chosen = inWindow[0];
                expect(chosen).toBeDefined();
                if (chosen === undefined) {
                    return;
                }
                const hit = nearestAnnotationEventAtFraction(
                    record.annotations,
                    xFractionOf(chosen.sampleIndex, viewport, sampling),
                    viewport,
                    sampling,
                    sampleCount,
                );
                expect(hit).not.toBeNull();
                if (hit === null) {
                    return;
                }

                const line = formatAnnotationDetail(hit);
                expect(line).toContain(
                    `Annotation: ${hit.event.symbol} \u00b7 sample ${hit.event.sampleIndex}`,
                );
                expect(line).not.toBe(ANNOTATION_DETAIL_IDLE_LABEL);
                expect(formatAnnotationDetail(null)).toBe(ANNOTATION_DETAIL_IDLE_LABEL);
            },
        );
    });

    describe('navigation', () => {
        it.skipIf(datasetAbsent)(
            "spans the record's acquisition window and keeps derived windows inside it",
            () => {
                const { sampling, sampleCount, viewport } = display();
                const bounds = viewportBoundsOf(sampling, sampleCount);

                expect(bounds.startSec).toBe(sampling.startTimeSec);
                expect(bounds.durationSec).toBeCloseTo(
                    sampleCount / sampling.sampleRateHz,
                    9,
                );

                const minimum = minViewportDurationSec(sampling);
                const derived = [
                    clampViewport(
                        {
                            startSec: sampling.startTimeSec - 1e6,
                            durationSec: 1e9,
                        },
                        bounds,
                        minimum,
                    ),
                    clampViewport(
                        { startSec: bounds.startSec, durationSec: 1e-12 },
                        bounds,
                        minimum,
                    ),
                    zoomViewport(viewport, bounds, ZOOM_STEP_FACTOR, 0.5, minimum),
                    zoomViewport(viewport, bounds, 1 / ZOOM_STEP_FACTOR, 0.5, minimum),
                    panViewport(viewport, bounds, PAN_STEP_FRACTION),
                    panViewport(viewport, bounds, -PAN_STEP_FRACTION),
                ];

                for (const candidate of derived) {
                    expect(candidate.durationSec).toBeGreaterThan(0);
                    expect(candidate.startSec).toBeGreaterThanOrEqual(
                        bounds.startSec - 1e-9,
                    );
                    expect(
                        candidate.startSec + candidate.durationSec,
                    ).toBeLessThanOrEqual(bounds.startSec + bounds.durationSec + 1e-9);
                }
            },
        );

        it.skipIf(datasetAbsent)(
            'preserves the duration across a pan while sliding a zoomed window',
            () => {
                const { sampling, sampleCount, viewport } = display();
                const bounds = viewportBoundsOf(sampling, sampleCount);
                const minimum = minViewportDurationSec(sampling);

                const zoomed = zoomViewport(
                    viewport,
                    bounds,
                    ZOOM_STEP_FACTOR,
                    0.5,
                    minimum,
                );
                const panned = panViewport(zoomed, bounds, PAN_STEP_FRACTION);
                expect(panned.durationSec).toBe(zoomed.durationSec);

                if (zoomed.durationSec < bounds.durationSec - 1e-9) {
                    expect(panned.startSec).toBeGreaterThan(zoomed.startSec);
                    const back = panViewport(panned, bounds, -PAN_STEP_FRACTION);
                    expect(back.durationSec).toBe(zoomed.durationSec);
                    expect(back.startSec).toBeLessThan(panned.startSec);
                }
            },
        );

        it.skipIf(datasetAbsent)(
            'keeps an interior readout inside the drawn sample window',
            () => {
                const { sampling, sampleCount, viewport } = display();
                const window = sampleWindowOfTime(viewport, sampling, sampleCount);
                const zoomed = zoomViewport(
                    viewport,
                    viewportBoundsOf(sampling, sampleCount),
                    ZOOM_STEP_FACTOR,
                    0.5,
                    minViewportDurationSec(sampling),
                );
                const zoomedWindow = sampleWindowOfTime(zoomed, sampling, sampleCount);

                for (const fraction of [0.1, 0.25, 0.5, 0.75, 0.9]) {
                    const full = readoutAtFraction(fraction, viewport, sampling);
                    expect(full.sampleIndex).toBeGreaterThanOrEqual(
                        window.startSample,
                    );
                    expect(full.sampleIndex).toBeLessThanOrEqual(window.endSample);

                    const zoom = readoutAtFraction(fraction, zoomed, sampling);
                    expect(zoom.sampleIndex).toBeGreaterThanOrEqual(
                        zoomedWindow.startSample,
                    );
                    expect(zoom.sampleIndex).toBeLessThanOrEqual(zoomedWindow.endSample);
                    expect(zoom.sampleIndex).toBeGreaterThanOrEqual(0);
                }
            },
        );
    });

    describe('envelope / amplitude', () => {
        it.skipIf(datasetAbsent)(
            'emits exactly one column per pixel column with ordered finite ranges',
            () => {
                const { signal, window } = display();
                const data = signal.channels[0]?.data;
                expect(data).toBeDefined();
                if (data === undefined) {
                    return;
                }

                const columns = envelopeColumns(data, window, COLUMN_COUNT);
                expect(columns).toHaveLength(COLUMN_COUNT);

                let populated = 0;
                for (const column of columns) {
                    expect(column.endSample).toBeGreaterThanOrEqual(
                        column.startSample,
                    );
                    if (!column.populated) {
                        continue;
                    }
                    populated += 1;
                    expect(Number.isFinite(column.min)).toBe(true);
                    expect(Number.isFinite(column.max)).toBe(true);
                    expect(column.min).toBeLessThanOrEqual(column.max);
                }
                expect(populated).toBeGreaterThan(0);
            },
        );

        it.skipIf(datasetAbsent)(
            'frames exactly the visible samples with finite ordered amplitude bounds',
            () => {
                const { signal, window } = display();
                const data = signal.channels[0]?.data;
                expect(data).toBeDefined();
                if (data === undefined) {
                    return;
                }
                expect(window.endSample).toBeGreaterThan(window.startSample);

                const columns = envelopeColumns(data, window, COLUMN_COUNT);
                const bounds = visibleAmplitudeBounds(columns);

                let min = Number.POSITIVE_INFINITY;
                let max = Number.NEGATIVE_INFINITY;
                for (let index = window.startSample; index < window.endSample; index += 1) {
                    const value = data[index] as number;
                    if (value < min) {
                        min = value;
                    }
                    if (value > max) {
                        max = value;
                    }
                }

                expect(bounds.populated).toBe(true);
                expect(Number.isFinite(bounds.min)).toBe(true);
                expect(Number.isFinite(bounds.max)).toBe(true);
                expect(bounds.min).toBeLessThanOrEqual(bounds.max);
                expect(bounds.min).toBe(min);
                expect(bounds.max).toBe(max);
            },
        );
    });
});
