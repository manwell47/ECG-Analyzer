/**
 * Pure annotation -> visible-marker mapping / density-cap tests (Phase 12).
 *
 * Node environment (no `// @vitest-environment jsdom` directive) — this module
 * is DOM-free by design, so its unit tests run in the global Node default and
 * never need a canvas. Every assertion here is about pure arithmetic over
 * annotation events and the domain time<->sample conversions.
 */

import { describe, expect, it } from 'vitest';

import { EcgError } from '../../../../domain/error';
import type { AnnotationEvent } from '../../../../domain/record';
import { createSamplingInfo } from '../../../../domain/sampling';
import {
    ANNOTATION_DETAIL_IDLE_LABEL,
    ANNOTATION_LIST_LIMIT,
    CURSOR_ANNOTATION_TOLERANCE_FRACTION,
    annotationList,
    annotationMarkers,
    filterAnnotationsBySymbol,
    filterAnnotationsBySymbols,
    formatAnnotationDetail,
    formatAnnotationListCaption,
    nearestAnnotationAtFraction,
    nearestAnnotationEventAtFraction,
    resolveSymbolFilter,
    resolveSymbolFilters,
} from '../annotationGeometry';

const HZ = 2;
const sampling = createSamplingInfo(HZ, 0);
const FULL = { startSec: 0, durationSec: 4 } as const;

function annotations(
    entries: readonly (readonly [number, string])[],
): readonly AnnotationEvent[] {
    return entries.map(([sampleIndex, symbol]) => ({
        sampleIndex,
        symbol,
        auxNote: '',
    }));
}

describe('annotationMarkers (annotations -> visible markers)', () => {
    it('maps in-window annotations to their exact normalised x position', () => {
        const result = annotationMarkers(
            annotations([
                [0, 'N'],
                [2, 'A'],
                [6, 'V'],
            ]),
            FULL,
            sampling,
            8,
            8,
        );

        expect(result.visibleCount).toBe(3);
        expect(result.mergedCount).toBe(0);
        expect(result.markers.map((marker) => marker.xFraction)).toEqual([
            0, 0.25, 0.75,
        ]);
        expect(result.markers.map((marker) => marker.sampleIndex)).toEqual([
            0, 2, 6,
        ]);
        expect(result.markers.map((marker) => marker.mergedCount)).toEqual([
            1, 1, 1,
        ]);
    });

    it('includes an annotation exactly at the window start and excludes one at the end', () => {
        const result = annotationMarkers(
            annotations([
                [0, 'N'],
                [8, 'V'],
            ]),
            FULL,
            sampling,
            8,
            8,
        );

        expect(result.visibleCount).toBe(1);
        expect(result.markers.map((marker) => marker.sampleIndex)).toEqual([0]);
    });

    it('drops annotations outside an interior window', () => {
        // [1, 3) s at 2 Hz == samples [2, 6).
        const result = annotationMarkers(
            annotations([
                [1, 'N'],
                [4, 'A'],
                [6, 'V'],
            ]),
            { startSec: 1, durationSec: 2 },
            sampling,
            8,
            8,
        );

        expect(result.visibleCount).toBe(1);
        expect(result.markers.map((marker) => marker.sampleIndex)).toEqual([4]);
    });

    it('clamps a boundary annotation to the plot edge instead of drawing outside it', () => {
        // startSample floors to sample 2 (t = 1.0 s) BEFORE the 1.25 s edge, so
        // the raw fraction is negative and must clamp to 0.
        const result = annotationMarkers(
            annotations([
                [2, 'N'],
                [5, 'A'],
            ]),
            { startSec: 1.25, durationSec: 1.5 },
            sampling,
            8,
            8,
        );

        expect(result.markers.map((marker) => marker.xFraction)).toEqual([
            0, 5 / 6,
        ]);
        expect(result.markers.map((marker) => marker.sampleIndex)).toEqual([
            2, 5,
        ]);
    });

    it('density-caps to one marker per pixel column, counting the merged rest', () => {
        const result = annotationMarkers(
            annotations([
                [0, 'N'],
                [1, 'N'],
                [2, 'A'],
                [3, 'V'],
            ]),
            FULL,
            sampling,
            8,
            2,
        );

        expect(result.visibleCount).toBe(4);
        expect(result.markers).toHaveLength(1);
        expect(result.markers[0]?.sampleIndex).toBe(0);
        expect(result.markers[0]?.mergedCount).toBe(4);
        expect(result.mergedCount).toBe(3);
    });

    it('keeps the lowest sample index as the column representative regardless of input order', () => {
        const result = annotationMarkers(
            annotations([
                [3, 'V'],
                [1, 'A'],
                [2, 'N'],
                [0, 'N'],
            ]),
            FULL,
            sampling,
            8,
            2,
        );

        expect(result.markers[0]?.sampleIndex).toBe(0);
        expect(result.markers[0]?.symbol).toBe('N');
        expect(result.markers[0]?.mergedCount).toBe(4);
    });

    it('emits one marker per populated column and orders them left to right', () => {
        const result = annotationMarkers(
            annotations([
                [6, 'V'],
                [0, 'N'],
                [1, 'N'],
            ]),
            FULL,
            sampling,
            8,
            2,
        );

        expect(result.markers.map((marker) => marker.xFraction)).toEqual([
            0, 0.75,
        ]);
        expect(result.markers.map((marker) => marker.mergedCount)).toEqual([
            2, 1,
        ]);
    });

    it('reports the distinct symbols in the window, ascending', () => {
        const result = annotationMarkers(
            annotations([
                [2, 'V'],
                [4, 'N'],
                [6, 'V'],
            ]),
            FULL,
            sampling,
            8,
            8,
        );

        expect(result.symbols).toEqual(['N', 'V']);
    });

    it('returns no markers for an empty annotation list', () => {
        const result = annotationMarkers([], FULL, sampling, 8, 8);

        expect(result).toEqual({
            markers: [],
            visibleCount: 0,
            mergedCount: 0,
            symbols: [],
        });
    });

    it('returns no markers for a degenerate viewport even when annotations exist', () => {
        const result = annotationMarkers(
            annotations([[2, 'N']]),
            { startSec: 0, durationSec: 0 },
            sampling,
            8,
            8,
        );

        expect(result.markers).toEqual([]);
        expect(result.visibleCount).toBe(0);
    });

    it('returns no markers when the whole window falls after the record', () => {
        const result = annotationMarkers(
            annotations([[2, 'N']]),
            { startSec: 100, durationSec: 1 },
            sampling,
            8,
            8,
        );

        expect(result.markers).toEqual([]);
        expect(result.visibleCount).toBe(0);
    });

    it('rejects a non-positive column count', () => {
        expect(() =>
            annotationMarkers(annotations([[2, 'N']]), FULL, sampling, 8, 0),
        ).toThrowError(EcgError);
    });
});

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

describe('nearestAnnotationAtFraction (cursor -> nearest annotation)', () => {
    // HZ = 2, so sample i sits at i/2 s and, over the 4 s full record,
    // sample i is drawn at xFraction = i/8.
    it('names the annotation the cursor is sitting on', () => {
        const nearest = nearestAnnotationAtFraction(
            annotations([
                [2, 'A'],
                [6, 'V'],
            ]),
            0.25, // exactly over sample 2
            FULL,
            sampling,
            8,
        );

        expect(nearest).not.toBeNull();
        expect(nearest?.symbol).toBe('A');
        expect(nearest?.sampleIndex).toBe(2);
        expect(nearest?.distanceFraction).toBe(0);
    });

    it('picks the closer of two in-window annotations', () => {
        const list = annotations([
            [2, 'A'], // x = 0.25
            [6, 'V'], // x = 0.75
        ]);

        // Both cursors sit inside the default 2% tolerance of one marker only.
        expect(nearestAnnotationAtFraction(list, 0.26, FULL, sampling, 8)?.symbol).toBe('A');
        expect(nearestAnnotationAtFraction(list, 0.74, FULL, sampling, 8)?.symbol).toBe('V');
    });

    it('returns null when the cursor is beyond the tolerance of every annotation', () => {
        const list = annotations([
            [2, 'A'],
            [6, 'V'],
        ]);

        // Midway between the two markers: 0.25 away from each, far beyond 2%.
        expect(nearestAnnotationAtFraction(list, 0.5, FULL, sampling, 8)).toBeNull();
        expect(CURSOR_ANNOTATION_TOLERANCE_FRACTION).toBeLessThan(0.25);
    });

    it('honours an explicit tolerance and resolves a tie to the lower sample index', () => {
        const list = annotations([
            [2, 'A'], // x = 0.25
            [6, 'V'], // x = 0.75
        ]);

        // Both are exactly 0.25 away from the cursor; the lower index wins.
        const nearest = nearestAnnotationAtFraction(list, 0.5, FULL, sampling, 8, 0.25);
        expect(nearest?.sampleIndex).toBe(2);
        expect(nearest?.distanceFraction).toBeCloseTo(0.25, 12);
    });

    it('breaks a same-index tie by symbol, so the choice never depends on input order', () => {
        const list = annotations([
            [2, 'Z'],
            [2, 'A'],
        ]);

        expect(nearestAnnotationAtFraction(list, 0.25, FULL, sampling, 8)?.symbol).toBe('A');
    });

    it('reports the annotation\u2019s own sample index without snapping to the cursor', () => {
        // Sample 1 is drawn at x = 0.125; a cursor at 0.06 rounds to sample 0,
        // yet the readout must name the annotation's own index (1).
        const nearest = nearestAnnotationAtFraction(
            annotations([[1, 'N']]),
            0.06,
            FULL,
            sampling,
            8,
            0.1,
        );

        expect(nearest?.sampleIndex).toBe(1);
        expect(nearest?.distanceFraction).toBeCloseTo(0.065, 12);
    });

    it('drops annotations outside the half-open window', () => {
        const viewport = { startSec: 1, durationSec: 2 } as const; // samples [2, 6)
        const list = annotations([
            [0, 'N'], // before the window
            [4, 'A'], // inside (x = 0.5)
            [8, 'V'], // at/after the exclusive end
        ]);

        const nearest = nearestAnnotationAtFraction(list, 0.5, viewport, sampling, 8);
        expect(nearest?.symbol).toBe('A');
        expect(nearest?.sampleIndex).toBe(4);
    });

    it('clamps an out-of-plot cursor to the plot edges', () => {
        const list = annotations([[0, 'N']]);

        // Out of range and non-finite fractions both clamp to 0.
        expect(nearestAnnotationAtFraction(list, -3, FULL, sampling, 8)?.sampleIndex).toBe(0);
        expect(nearestAnnotationAtFraction(list, Number.NaN, FULL, sampling, 8)?.sampleIndex).toBe(0);
        // Clamped to 1 it is a whole plot away from the only annotation.
        expect(nearestAnnotationAtFraction(list, 2, FULL, sampling, 8)).toBeNull();
    });

    it('returns null for an empty list or a degenerate viewport', () => {
        expect(nearestAnnotationAtFraction([], 0.25, FULL, sampling, 8)).toBeNull();
        expect(
            nearestAnnotationAtFraction(
                annotations([[2, 'N']]),
                0.25,
                { startSec: 0, durationSec: 0 },
                sampling,
                8,
            ),
        ).toBeNull();
    });

    it('classifies non-finite or negative tolerances as invalid-input', () => {
        for (const tolerance of [Number.NaN, Number.POSITIVE_INFINITY, -0.01]) {
            expectInvalidInput(() =>
                nearestAnnotationAtFraction(
                    annotations([[2, 'N']]),
                    0.25,
                    FULL,
                    sampling,
                    8,
                    tolerance,
                ),
            );
        }
    });

    it('never mutates the annotation list it is given', () => {
        const list = Object.freeze(annotations([[2, 'A']]));
        const viewport = Object.freeze({ startSec: 0, durationSec: 4 });
        const before = JSON.stringify(list);

        nearestAnnotationAtFraction(list, 0.25, viewport, sampling, 8);

        expect(JSON.stringify(list)).toBe(before);
    });
});

describe('nearestAnnotationEventAtFraction (cursor -> nearest event)', () => {
    // HZ = 2, so sample i sits at i/2 s and, over the 4 s full record,
    // sample i is drawn at xFraction = i/8.
    it('returns the record\u2019s own event object, never a copy', () => {
        const target = { sampleIndex: 2, symbol: 'A', code: 1, auxNote: 'PVC' };
        const other = { sampleIndex: 6, symbol: 'V', auxNote: '' };

        const hit = nearestAnnotationEventAtFraction(
            [target, other],
            0.25, // exactly over sample 2
            FULL,
            sampling,
            8,
        );

        expect(hit).not.toBeNull();
        expect(hit?.event).toBe(target);
        expect(hit?.distanceFraction).toBe(0);
    });

    it('carries the annotation\u2019s auxNote and code verbatim', () => {
        const hit = nearestAnnotationEventAtFraction(
            [{ sampleIndex: 4, symbol: 'N', code: 5, auxNote: 'fusion beat' }],
            0.5,
            FULL,
            sampling,
            8,
        );

        expect(hit?.event.auxNote).toBe('fusion beat');
        expect(hit?.event.code).toBe(5);
    });

    it('picks the closer of two in-window annotations', () => {
        const list = annotations([
            [2, 'A'], // x = 0.25
            [6, 'V'], // x = 0.75
        ]);

        // Both cursors sit inside the default 2% tolerance of one marker only.
        expect(
            nearestAnnotationEventAtFraction(list, 0.26, FULL, sampling, 8)?.event
                .symbol,
        ).toBe('A');
        expect(
            nearestAnnotationEventAtFraction(list, 0.74, FULL, sampling, 8)?.event
                .symbol,
        ).toBe('V');
    });

    it('resolves ties to the lower sample index, then the smaller symbol', () => {
        const list = annotations([
            [6, 'V'], // x = 0.75, 0.25 away from a 0.5 cursor
            [2, 'A'], // x = 0.25, 0.25 away from a 0.5 cursor
        ]);

        const byIndex = nearestAnnotationEventAtFraction(
            list,
            0.5,
            FULL,
            sampling,
            8,
            0.25,
        );
        expect(byIndex?.event.sampleIndex).toBe(2);

        // Same index, different symbols: the lexicographically smaller wins.
        const sameIndex = annotations([
            [2, 'Z'],
            [2, 'A'],
        ]);
        expect(
            nearestAnnotationEventAtFraction(sameIndex, 0.25, FULL, sampling, 8)
                ?.event.symbol,
        ).toBe('A');
    });

    it('drops annotations outside the half-open window', () => {
        const viewport = { startSec: 1, durationSec: 2 } as const; // samples [2, 6)
        const list = annotations([
            [0, 'N'], // before the window
            [4, 'A'], // inside (x = 0.5)
            [6, 'V'], // exactly the exclusive end, dropped
        ]);

        const hit = nearestAnnotationEventAtFraction(
            list,
            0.5,
            viewport,
            sampling,
            8,
        );
        expect(hit?.event.symbol).toBe('A');
        expect(hit?.event.sampleIndex).toBe(4);
    });

    it('clamps an out-of-plot cursor to the plot edges', () => {
        const list = annotations([[0, 'N']]);

        expect(
            nearestAnnotationEventAtFraction(list, -3, FULL, sampling, 8)?.event
                .sampleIndex,
        ).toBe(0);
        expect(
            nearestAnnotationEventAtFraction(list, Number.NaN, FULL, sampling, 8)
                ?.event.sampleIndex,
        ).toBe(0);
        // Clamped to 1 it is a whole plot away from the only annotation.
        expect(
            nearestAnnotationEventAtFraction(list, 2, FULL, sampling, 8),
        ).toBeNull();
    });

    it('honours an explicit tolerance, including zero', () => {
        const list = annotations([[2, 'A']]); // x = 0.25

        // A zero tolerance still admits an exact hit but nothing off it.
        expect(
            nearestAnnotationEventAtFraction(list, 0.25, FULL, sampling, 8, 0)
                ?.event.symbol,
        ).toBe('A');
        expect(
            nearestAnnotationEventAtFraction(list, 0.26, FULL, sampling, 8, 0),
        ).toBeNull();
    });

    it('returns null for an empty list, a degenerate viewport or a distant cursor', () => {
        expect(
            nearestAnnotationEventAtFraction([], 0.25, FULL, sampling, 8),
        ).toBeNull();
        expect(
            nearestAnnotationEventAtFraction(
                annotations([[2, 'N']]),
                0.25,
                { startSec: 0, durationSec: 0 },
                sampling,
                8,
            ),
        ).toBeNull();
        // Midway between two markers: far beyond the default 2% tolerance.
        expect(
            nearestAnnotationEventAtFraction(
                annotations([
                    [2, 'A'],
                    [6, 'V'],
                ]),
                0.5,
                FULL,
                sampling,
                8,
            ),
        ).toBeNull();
    });

    it('classifies a non-finite or negative tolerance as invalid-input', () => {
        for (const tolerance of [Number.NaN, Number.POSITIVE_INFINITY, -0.01]) {
            expectInvalidInput(() =>
                nearestAnnotationEventAtFraction(
                    annotations([[2, 'N']]),
                    0.25,
                    FULL,
                    sampling,
                    8,
                    tolerance,
                ),
            );
        }
    });

    it('never mutates the annotation list it is given', () => {
        const list = Object.freeze(annotations([[2, 'A']]));
        const viewport = Object.freeze({ startSec: 0, durationSec: 4 });
        const before = JSON.stringify(list);

        nearestAnnotationEventAtFraction(list, 0.25, viewport, sampling, 8);

        expect(JSON.stringify(list)).toBe(before);
    });

    it('agrees with the nearestAnnotationAtFraction projection', () => {
        const list = annotations([
            [1, 'N'],
            [5, 'A'],
        ]);

        for (const fraction of [0.125, 0.3, 0.625, 0.9]) {
            const hit = nearestAnnotationEventAtFraction(
                list,
                fraction,
                FULL,
                sampling,
                8,
            );
            const summary = nearestAnnotationAtFraction(
                list,
                fraction,
                FULL,
                sampling,
                8,
            );
            expect(summary).toEqual(
                hit === null
                    ? null
                    : {
                        symbol: hit.event.symbol,
                        sampleIndex: hit.event.sampleIndex,
                        distanceFraction: hit.distanceFraction,
                    },
            );
        }
    });
});

describe('filterAnnotationsBySymbol (display selection over the record facts)', () => {
    it('returns the input unchanged (identity) for a null filter', () => {
        const list = annotations([
            [1, 'N'],
            [5, 'A'],
        ]);

        expect(filterAnnotationsBySymbol(list, null)).toBe(list);
    });

    it('returns the input unchanged (identity) for an empty-string filter', () => {
        const list = annotations([
            [1, 'N'],
            [5, 'A'],
        ]);

        expect(filterAnnotationsBySymbol(list, '')).toBe(list);
    });

    it("returns the exact-match subset in the list's own order", () => {
        const list = annotations([
            [1, 'N'],
            [5, 'A'],
            [7, 'N'],
        ]);

        const filtered = filterAnnotationsBySymbol(list, 'N');
        expect(filtered.map((entry) => entry.sampleIndex)).toEqual([1, 7]);
        expect(filtered.every((entry) => entry.symbol === 'N')).toBe(true);
    });

    it('returns an empty list when no symbol matches', () => {
        const list = annotations([
            [1, 'N'],
            [5, 'A'],
        ]);

        expect(filterAnnotationsBySymbol(list, 'V')).toEqual([]);
    });

    it('never mutates the list or its events', () => {
        const list = [
            { sampleIndex: 1, symbol: 'N', auxNote: 'normal' },
            { sampleIndex: 5, symbol: 'A', auxNote: '' },
        ];
        const before = JSON.stringify(list);

        filterAnnotationsBySymbol(list, 'A');
        filterAnnotationsBySymbol(list, null);

        expect(JSON.stringify(list)).toBe(before);
    });
});

describe('resolveSymbolFilter (stored filter -> effective filter)', () => {
    it('keeps a filter that the available symbols contain', () => {
        expect(resolveSymbolFilter('N', ['A', 'N'])).toBe('N');
    });

    it('falls back to null ("All") when the symbol is no longer available', () => {
        expect(resolveSymbolFilter('V', ['A', 'N'])).toBeNull();
    });

    it('falls back to null for a null or empty-string filter', () => {
        expect(resolveSymbolFilter(null, ['A', 'N'])).toBeNull();
        expect(resolveSymbolFilter('', ['A', 'N'])).toBeNull();
    });

    it('falls back to null when nothing is available', () => {
        expect(resolveSymbolFilter('N', [])).toBeNull();
    });
});

describe('filterAnnotationsBySymbols (multi-symbol display selection)', () => {
    it('returns the input unchanged (identity) for an empty selection', () => {
        const list = annotations([
            [1, 'N'],
            [5, 'A'],
        ]);

        expect(filterAnnotationsBySymbols(list, [])).toBe(list);
    });

    it('keeps every event whose symbol is a member of the selection, in order', () => {
        const list = annotations([
            [1, 'N'],
            [2, 'A'],
            [5, 'N'],
            [7, 'V'],
        ]);

        const filtered = filterAnnotationsBySymbols(list, ['N', 'V']);
        expect(filtered.map((entry) => entry.sampleIndex)).toEqual([1, 5, 7]);
        expect(filtered.every((entry) => entry.symbol !== 'A')).toBe(true);
    });

    it('treats a single-symbol selection as the exact-match subset', () => {
        const list = annotations([
            [1, 'N'],
            [5, 'A'],
        ]);

        expect(
            filterAnnotationsBySymbols(list, ['N']).map(
                (entry) => entry.sampleIndex,
            ),
        ).toEqual([1]);
    });

    it('returns an empty list when no event matches the selection', () => {
        const list = annotations([
            [1, 'N'],
            [5, 'A'],
        ]);

        expect(filterAnnotationsBySymbols(list, ['V'])).toEqual([]);
    });

    it('agrees with the single-symbol projection', () => {
        const list = annotations([
            [1, 'N'],
            [2, 'A'],
            [5, 'N'],
            [7, 'V'],
        ]);

        expect(filterAnnotationsBySymbols(list, ['N'])).toEqual(
            filterAnnotationsBySymbol(list, 'N'),
        );
        expect(filterAnnotationsBySymbols(list, ['V'])).toEqual(
            filterAnnotationsBySymbol(list, 'V'),
        );
        // The empty selection is the same identity no-op both ways.
        expect(filterAnnotationsBySymbols(list, [])).toBe(
            filterAnnotationsBySymbol(list, null),
        );
    });

    it('never mutates the annotation list it is given', () => {
        const list = Object.freeze(
            annotations([
                [1, 'N'],
                [5, 'A'],
            ]),
        );
        const before = JSON.stringify(list);

        filterAnnotationsBySymbols(list, ['N']);
        filterAnnotationsBySymbols(list, []);

        expect(JSON.stringify(list)).toBe(before);
    });
});

describe('resolveSymbolFilters (stored selection -> effective selection)', () => {
    it('falls back to the empty selection ("All") for an empty selection', () => {
        expect(resolveSymbolFilters([], ['A', 'N'])).toEqual([]);
    });

    it('keeps the members the available symbols still contain, in available order', () => {
        expect(resolveSymbolFilters(['N', 'A'], ['A', 'N', 'V'])).toEqual([
            'A',
            'N',
        ]);
    });

    it('drops every member that is no longer available', () => {
        expect(resolveSymbolFilters(['V', 'N'], ['A', 'N'])).toEqual(['N']);
    });

    it('deduplicates repeated members', () => {
        expect(resolveSymbolFilters(['N', 'N'], ['A', 'N'])).toEqual(['N']);
    });

    it('is independent of the order the selection is given in', () => {
        expect(resolveSymbolFilters(['N', 'A'], ['A', 'N'])).toEqual(
            resolveSymbolFilters(['A', 'N'], ['A', 'N']),
        );
    });

    it('falls back to the empty selection when nothing is available', () => {
        expect(resolveSymbolFilters(['N'], [])).toEqual([]);
    });

    it('agrees with the single-symbol projection', () => {
        expect(resolveSymbolFilters(['N'], ['A', 'N', 'V'])).toEqual(['N']);
        expect(resolveSymbolFilter('N', ['A', 'N', 'V'])).toBe('N');
        expect(resolveSymbolFilters(['V'], ['A', 'N'])).toEqual([]);
        expect(resolveSymbolFilter('V', ['A', 'N'])).toBeNull();
    });
});

describe('formatAnnotationDetail (hit -> caption detail line)', () => {
    function makeEvent(
        sampleIndex: number,
        symbol: string,
        auxNote = '',
    ): AnnotationEvent {
        return { sampleIndex, symbol, auxNote };
    }

    it('exposes the idle label the view shows when no marker is near', () => {
        expect(ANNOTATION_DETAIL_IDLE_LABEL).toBe('Annotation: \u2014');
        expect(formatAnnotationDetail(null)).toBe('Annotation: \u2014');
    });

    it("names the symbol and the annotation's own sample index", () => {
        const hit = { event: makeEvent(5, 'A'), distanceFraction: 0 } as const;

        expect(formatAnnotationDetail(hit)).toBe('Annotation: A \u00b7 sample 5');
    });

    it('appends a non-empty auxNote after a middle dot', () => {
        const hit = {
            event: makeEvent(5, 'A', 'premature beat'),
            distanceFraction: 0,
        } as const;

        expect(formatAnnotationDetail(hit)).toBe(
            'Annotation: A \u00b7 sample 5 \u00b7 premature beat',
        );
    });

    it('adds no dangling separator for an empty note', () => {
        const hit = { event: makeEvent(5, 'A', ''), distanceFraction: 0 } as const;

        expect(formatAnnotationDetail(hit)).toBe('Annotation: A \u00b7 sample 5');
        expect(formatAnnotationDetail(hit).endsWith('\u00b7')).toBe(false);
    });

    it('ignores the numeric code so the line never shows an unexplained number', () => {
        const hit = {
            event: { sampleIndex: 5, symbol: 'A', code: 42, auxNote: '' },
            distanceFraction: 0,
        } as const;

        expect(formatAnnotationDetail(hit)).toBe('Annotation: A \u00b7 sample 5');
    });
});

describe('annotationList (bounded listing of the window\u2019s own events)', () => {
    // HZ = 2 and the record is 8 samples (4 s), so the FULL window is the
    // half-open sample window [0, 8): sample 7 is inside, sample 8 is not.
    it('lists the window\u2019s events and excludes the half-open end', () => {
        const list = annotationList(
            annotations([
                [0, 'N'],
                [7, 'A'],
                [8, 'V'],
            ]),
            FULL,
            sampling,
            8,
            ANNOTATION_LIST_LIMIT,
        );

        expect(list.entries.map((event) => event.sampleIndex)).toEqual([0, 7]);
        expect(list.visibleCount).toBe(2);
        expect(list.truncated).toBe(false);
    });

    it('keeps only the events inside an interior window', () => {
        const list = annotationList(
            annotations([
                [1, 'N'],
                [2, 'A'],
                [5, 'V'],
                [6, 'N'],
            ]),
            { startSec: 1, durationSec: 2 }, // half-open sample window [2, 6)
            sampling,
            8,
            ANNOTATION_LIST_LIMIT,
        );

        expect(list.entries.map((event) => event.sampleIndex)).toEqual([2, 5]);
        expect(list.visibleCount).toBe(2);
    });

    it('orders ascending by sampleIndex, independent of input order', () => {
        const list = annotationList(
            annotations([
                [6, 'V'],
                [0, 'N'],
                [4, 'A'],
                [2, 'N'],
            ]),
            FULL,
            sampling,
            8,
            ANNOTATION_LIST_LIMIT,
        );

        expect(list.entries.map((event) => event.sampleIndex)).toEqual([
            0, 2, 4, 6,
        ]);
    });

    it('breaks a same-index tie by the lexicographically smaller symbol', () => {
        const list = annotationList(
            annotations([
                [2, 'V'],
                [2, 'A'],
                [2, 'N'],
            ]),
            FULL,
            sampling,
            8,
            ANNOTATION_LIST_LIMIT,
        );

        expect(list.entries.map((event) => event.symbol)).toEqual([
            'A',
            'N',
            'V',
        ]);
    });

    it('caps the entries and reports the uncapped total as visibleCount', () => {
        const list = annotationList(
            annotations([
                [0, 'N'],
                [2, 'A'],
                [4, 'V'],
                [6, 'N'],
            ]),
            FULL,
            sampling,
            8,
            2,
        );

        expect(list.entries.map((event) => event.sampleIndex)).toEqual([0, 2]);
        // The total is exact even though only the first slice is listed.
        expect(list.visibleCount).toBe(4);
        expect(list.truncated).toBe(true);
    });

    it('reports truncated = false when the whole window fits the cap', () => {
        const list = annotationList(
            annotations([
                [0, 'N'],
                [2, 'A'],
            ]),
            FULL,
            sampling,
            8,
            2,
        );

        expect(list.entries).toHaveLength(2);
        expect(list.visibleCount).toBe(2);
        expect(list.truncated).toBe(false);
    });

    it('returns the record\u2019s own events, never copies', () => {
        const events = annotations([
            [0, 'N'],
            [2, 'A'],
        ]);
        const list = annotationList(
            events,
            FULL,
            sampling,
            8,
            ANNOTATION_LIST_LIMIT,
        );

        expect(list.entries[0]).toBe(events[0]);
        expect(list.entries[1]).toBe(events[1]);
    });

    it('returns an empty list for an empty annotation list', () => {
        const list = annotationList([], FULL, sampling, 8, ANNOTATION_LIST_LIMIT);

        expect(list.entries).toEqual([]);
        expect(list.visibleCount).toBe(0);
        expect(list.truncated).toBe(false);
    });

    it('returns an empty list for a degenerate viewport', () => {
        const list = annotationList(
            annotations([[0, 'N']]),
            { startSec: 0, durationSec: 0 },
            sampling,
            8,
            ANNOTATION_LIST_LIMIT,
        );

        expect(list.entries).toEqual([]);
        expect(list.visibleCount).toBe(0);
        expect(list.truncated).toBe(false);
    });

    it('classifies a non-positive or non-integer limit as invalid-input', () => {
        const events = annotations([[0, 'N']]);

        expectInvalidInput(() => annotationList(events, FULL, sampling, 8, 0));
        expectInvalidInput(() => annotationList(events, FULL, sampling, 8, -1));
        expectInvalidInput(() => annotationList(events, FULL, sampling, 8, 1.5));
    });

    it('never mutates the annotation list it is given', () => {
        const events = Object.freeze(
            annotations([
                [4, 'V'],
                [0, 'N'],
            ]),
        );
        const before = JSON.stringify(events);

        annotationList(events, FULL, sampling, 8, ANNOTATION_LIST_LIMIT);

        expect(JSON.stringify(events)).toBe(before);
    });

    it('exposes a display cap of 200 rows', () => {
        expect(ANNOTATION_LIST_LIMIT).toBe(200);
    });
});

describe('formatAnnotationListCaption (bound -> caption line)', () => {
    it('states an empty window plainly', () => {
        expect(
            formatAnnotationListCaption({
                entries: [],
                visibleCount: 0,
                truncated: false,
            }),
        ).toBe('No annotations in view');
    });

    it('states the bound when the cap truncated the list', () => {
        expect(
            formatAnnotationListCaption({
                entries: annotations([
                    [0, 'N'],
                    [2, 'A'],
                ]),
                visibleCount: 5,
                truncated: true,
            }),
        ).toBe('Showing first 2 of 5 in view');
    });

    it('states the in-view total when nothing was truncated', () => {
        expect(
            formatAnnotationListCaption({
                entries: annotations([
                    [0, 'N'],
                    [2, 'A'],
                ]),
                visibleCount: 2,
                truncated: false,
            }),
        ).toBe('2 in view');
    });
});
