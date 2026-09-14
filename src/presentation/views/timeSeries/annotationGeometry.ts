/**
 * Annotation -> visible-marker mapping for the canvas time-series view
 * (Phase 12).
 *
 * These are pure, DOM-free helpers. They map a record's domain
 * {@link AnnotationEvent} list onto the x positions of a visible *time
 * viewport* so a canvas can draw one annotation marker per pixel column
 * without ever scanning outside the window and without mutating anything.
 *
 * Like `./geometry.ts`, the time<->sample arithmetic is deliberately NOT
 * re-implemented here: the visible sample window comes from
 * {@link sampleWindowOfTime} and each annotation's time comes from the
 * domain's own `timeSecOfSample` (ADR-001 — "sample i occurs at
 * i / sampleRateHz"). Exactly one tested definition of the mapping exists
 * anywhere in the codebase.
 *
 * Conventions the renderer may rely on:
 * - an annotation is visible when its `sampleIndex` falls inside the
 *   half-open sample window `[startSample, endSample)` (`endSample`
 *   exclusive), consistent with {@link sampleWindowOfTime};
 * - marker positions are normalised to `xFraction` in `[0, 1]`, clamped so a
 *   boundary annotation never draws outside the plot;
 * - {@link nearestAnnotationEventAtFraction} exposes the *same* mapping (window
 *   and x position) as the drawn markers and returns the record's own event, so
 *   a cursor readout or hover detail can name the annotation it is sitting on
 *   without a second, divergent definition; {@link nearestAnnotationAtFraction}
 *   is a projection over it;
 * - markers are density-capped to at most one per pixel column: annotations
 *   that fall in the same column are merged into the column's representative
 *   (the lowest `sampleIndex`), whose `mergedCount` records how many were
 *   collapsed, so `visibleCount` still counts every event in the window;
 * - `symbols` is the distinct, ascending symbol set present in the window; the
 *   Phase-17 legend toggles are built from it, so a selection can never hide its
 *   own off-switch (ADR-018);
 * - {@link annotationList} lists the record's own in-window events,
 *   deterministically ordered (ascending `sampleIndex`, then symbol) and capped
 *   to {@link ANNOTATION_LIST_LIMIT}, for the annotation-list panel; it shares
 *   the half-open window rule with the drawn markers;
 * - annotation data is only ever read here; buffers passed in are untouched.
 */

import { EcgError } from '../../../domain/error';
import type { AnnotationEvent } from '../../../domain/record';
import type { SamplingInfo } from '../../../domain/sampling';
import { timeSecOfSample } from '../../../domain/sampling';
import { sampleWindowOfTime, type TimeViewport } from './geometry';

/** One drawn annotation marker (one per populated pixel column). */
export interface AnnotationMarker {
    /** Representative sample index (the lowest in the merged column). */
    readonly sampleIndex: number;
    /** Representative annotation symbol. */
    readonly symbol: string;
    /** Horizontal position across the plot, normalised to `[0, 1]`. */
    readonly xFraction: number;
    /** Annotations collapsed into this marker (always >= 1). */
    readonly mergedCount: number;
}

/** Result of mapping a record's annotations onto a visible time viewport. */
export interface AnnotationMarkers {
    /** Drawable markers, ordered left to right. */
    readonly markers: readonly AnnotationMarker[];
    /** Annotations whose `sampleIndex` fell inside the window. */
    readonly visibleCount: number;
    /** Annotations merged away by the density cap (`visibleCount - markers.length`). */
    readonly mergedCount: number;
    /** Distinct symbols present in the window, ascending. */
    readonly symbols: readonly string[];
}

/**
 * Default tolerance, as a fraction of the visible window width, within which a
 * cursor is considered to sit "on" an annotation. Roughly the width of a drawn
 * marker at typical plot sizes — a presentation radius, never a measurement or
 * a detection threshold (ADR-015).
 */
export const CURSOR_ANNOTATION_TOLERANCE_FRACTION = 0.02;

/** The annotation nearest a cursor, when one lies within tolerance. */
export interface NearestAnnotation {
    /** Symbol of the nearest annotation, verbatim from the record. */
    readonly symbol: string;
    /** That annotation's own sample index (never derived, never snapped). */
    readonly sampleIndex: number;
    /** Distance from the cursor, as a fraction of the plot width (`>= 0`). */
    readonly distanceFraction: number;
}

/**
 * The record's own annotation nearest a cursor, with the display distance used
 * to pick it. Carries the event verbatim (Phase 15), so a hover detail can
 * render its `symbol`/`auxNote` without a second scan or a defensive copy.
 */
export interface AnnotationHit {
    /** The event exactly as it appears in the record (never synthesised). */
    readonly event: AnnotationEvent;
    /** Distance from the cursor, as a fraction of the plot width (`>= 0`). */
    readonly distanceFraction: number;
}

/** Per-column accumulator used while scanning the window. */
interface AnnotationBucket {
    sampleIndex: number;
    symbol: string;
    xFraction: number;
    count: number;
}

const EMPTY_MARKERS: AnnotationMarkers = {
    markers: [],
    visibleCount: 0,
    mergedCount: 0,
    symbols: [],
};

function requirePositiveSafeInteger(value: number, label: string): number {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw EcgError.invalidInput(
            `${label} must be a positive safe integer, received ${String(value)}.`,
        );
    }
    return value;
}

/** Clamp to `[0, 1]`, mapping a non-finite fraction to 0. */
function clampUnitFraction(value: number): number {
    if (!(value > 0)) {
        return 0;
    }
    return value > 1 ? 1 : value;
}

/** Validate the cursor tolerance: a non-negative finite fraction. */
function requireToleranceFraction(value: number): number {
    if (!Number.isFinite(value) || value < 0) {
        throw EcgError.invalidInput(
            `cursor annotation tolerance must be a non-negative finite fraction, received ${String(value)}.`,
        );
    }
    return value;
}

/**
 * Total order on candidates: nearer first, then the lower sample index, then
 * the lexicographically smaller symbol. The symbol tie-break keeps the choice
 * independent of the annotation list's order.
 */
function isNearer(
    distanceFraction: number,
    event: AnnotationEvent,
    incumbent: AnnotationHit,
): boolean {
    if (distanceFraction !== incumbent.distanceFraction) {
        return distanceFraction < incumbent.distanceFraction;
    }
    if (event.sampleIndex !== incumbent.event.sampleIndex) {
        return event.sampleIndex < incumbent.event.sampleIndex;
    }
    return event.symbol < incumbent.event.symbol;
}

/**
 * Map the annotations of a record onto the visible time viewport of a channel
 * of `sampleCount` samples sampled per `sampling`, using `columnCount` pixel
 * columns for the density cap.
 *
 * Annotations outside the half-open window are dropped; those inside are
 * positioned by the domain time conversion and clamped to the plot; at most
 * one marker is emitted per pixel column, with the column's remaining events
 * counted in `mergedCount`. A degenerate viewport (non-positive duration) or an
 * empty annotation list yields no markers.
 */
export function annotationMarkers(
    annotations: readonly AnnotationEvent[],
    viewport: TimeViewport,
    sampling: SamplingInfo,
    sampleCount: number,
    columnCount: number,
): AnnotationMarkers {
    requirePositiveSafeInteger(columnCount, 'column count');

    const window = sampleWindowOfTime(viewport, sampling, sampleCount);
    if (window.endSample <= window.startSample) {
        return EMPTY_MARKERS;
    }

    const buckets = new Map<number, AnnotationBucket>();
    const symbols = new Set<string>();
    let visibleCount = 0;

    for (const annotation of annotations) {
        const { sampleIndex } = annotation;
        // Half-open inclusion; a NaN index fails both bounds and is skipped.
        if (!(sampleIndex >= window.startSample && sampleIndex < window.endSample)) {
            continue;
        }
        visibleCount += 1;
        symbols.add(annotation.symbol);

        const timeSec = timeSecOfSample(sampleIndex, sampling);
        const xFraction = clampUnitFraction(
            (timeSec - viewport.startSec) / viewport.durationSec,
        );
        const column = Math.min(
            columnCount - 1,
            Math.floor(xFraction * columnCount),
        );

        const existing = buckets.get(column);
        if (existing === undefined) {
            buckets.set(column, {
                sampleIndex,
                symbol: annotation.symbol,
                xFraction,
                count: 1,
            });
        } else {
            existing.count += 1;
            // The representative is the lowest sample index, independent of
            // iteration order, so the marker never depends on input sorting.
            if (sampleIndex < existing.sampleIndex) {
                existing.sampleIndex = sampleIndex;
                existing.symbol = annotation.symbol;
                existing.xFraction = xFraction;
            }
        }
    }

    const markers = [...buckets.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, bucket]) => ({
            sampleIndex: bucket.sampleIndex,
            symbol: bucket.symbol,
            xFraction: bucket.xFraction,
            mergedCount: bucket.count,
        }));

    return {
        markers,
        visibleCount,
        mergedCount: visibleCount - markers.length,
        symbols: [...symbols].sort(),
    };
}

/**
 * The events whose `symbol` is a member of `symbols`, in the list's own order
 * (Phase 17 — the multi-symbol generalization of {@link filterAnnotationsBySymbol}).
 *
 * An **empty** set is the identity: the input is returned **unchanged** (the
 * same reference), so "All symbols" is a no-op the renderer can rely on.
 * Otherwise the membership subset is returned in input order. Read-only: no
 * event is copied or mutated and nothing is synthesised. This is a display
 * selection over facts the record already carries — never a query, never a
 * detection (ADR-013/ADR-016/ADR-018).
 */
export function filterAnnotationsBySymbols(
    annotations: readonly AnnotationEvent[],
    symbols: readonly string[],
): readonly AnnotationEvent[] {
    if (symbols.length === 0) {
        return annotations;
    }
    const selected = new Set(symbols);
    return annotations.filter((annotation) => selected.has(annotation.symbol));
}

/**
 * The events whose `symbol` equals `symbol`, in the list's own order.
 *
 * `null` and `""` are the identity: the input is returned **unchanged** (the
 * same reference), so "All symbols" is a no-op the renderer can rely on.
 * Otherwise the exact-match subset is returned in input order. Read-only: no
 * event is copied or mutated and nothing is synthesised. This is a display
 * selection over facts the record already carries — never a query, never a
 * detection (ADR-013/ADR-016). Kept as the one-symbol projection over
 * {@link filterAnnotationsBySymbols} so there is exactly one filter rule.
 */
export function filterAnnotationsBySymbol(
    annotations: readonly AnnotationEvent[],
    symbol: string | null,
): readonly AnnotationEvent[] {
    return filterAnnotationsBySymbols(
        annotations,
        symbol === null || symbol === '' ? [] : [symbol],
    );
}

/**
 * Resolve a stored selection against the symbols a window actually contains:
 * the members of `active` that remain `available`, deduplicated and returned in
 * `available` order (which is ascending). An empty result is "All symbols"
 * (Phase 17 — the multi-symbol generalization of {@link resolveSymbolFilter}).
 *
 * Pure and order-independent, so a selection that a channel/window change
 * removed falls back deterministically without an effect or a manual reset.
 * Callers pass the **unfiltered** window symbols, so the user can always switch
 * back on a symbol the current selection is hiding; the window that is drawn
 * stays the annotated record's own, never a claim about it.
 */
export function resolveSymbolFilters(
    active: readonly string[],
    available: readonly string[],
): readonly string[] {
    if (active.length === 0) {
        return [];
    }
    const wanted = new Set(active);
    return available.filter((symbol) => wanted.has(symbol));
}

/**
 * Resolve a stored single-symbol filter against the symbols a window actually
 * contains: `active` when it is a non-empty member of `available`, else `null`
 * ("All symbols"). Kept as the one-element projection over
 * {@link resolveSymbolFilters} so there is exactly one resolution rule.
 */
export function resolveSymbolFilter(
    active: string | null,
    available: readonly string[],
): string | null {
    if (active === null || active === '') {
        return null;
    }
    const [first] = resolveSymbolFilters([active], available);
    return first ?? null;
}

/**
 * The record's own annotation closest to the cursor at `xFraction` across
 * `viewport`, or `null` when none lies within `toleranceFraction`.
 *
 * This is the single selection spine. The window test is the half-open
 * `[startSample, endSample)` rule used for the drawn markers, and an
 * annotation's x position is the same domain-derived normalised fraction — so
 * the event returned here always belongs to an annotation the canvas is
 * actually drawing. The cursor fraction is clamped to `[0, 1]` (non-finite ->
 * 0). Ties resolve deterministically to the lower sample index, then the
 * lexicographically smaller symbol.
 *
 * `toleranceFraction` defaults to {@link CURSOR_ANNOTATION_TOLERANCE_FRACTION};
 * a non-finite or negative tolerance is `invalid-input`. Nothing is mutated and
 * no buffer is indexed: the returned event is the record's own object, read
 * verbatim (its `sampleIndex` is a readout only).
 */
export function nearestAnnotationEventAtFraction(
    annotations: readonly AnnotationEvent[],
    xFraction: number,
    viewport: TimeViewport,
    sampling: SamplingInfo,
    sampleCount: number,
    toleranceFraction: number = CURSOR_ANNOTATION_TOLERANCE_FRACTION,
): AnnotationHit | null {
    const tolerance = requireToleranceFraction(toleranceFraction);

    const window = sampleWindowOfTime(viewport, sampling, sampleCount);
    if (window.endSample <= window.startSample) {
        return null;
    }

    const cursorFraction = clampUnitFraction(xFraction);
    let nearest: AnnotationHit | null = null;

    for (const annotation of annotations) {
        const { sampleIndex } = annotation;
        // Half-open inclusion; a NaN index fails both bounds and is skipped.
        if (!(sampleIndex >= window.startSample && sampleIndex < window.endSample)) {
            continue;
        }

        const timeSec = timeSecOfSample(sampleIndex, sampling);
        const x = clampUnitFraction(
            (timeSec - viewport.startSec) / viewport.durationSec,
        );
        const distanceFraction = Math.abs(x - cursorFraction);
        if (distanceFraction > tolerance) {
            continue;
        }

        if (nearest === null || isNearer(distanceFraction, annotation, nearest)) {
            nearest = { event: annotation, distanceFraction };
        }
    }

    return nearest;
}

/**
 * The Phase-14 projection of {@link nearestAnnotationEventAtFraction}: the
 * `{ symbol, sampleIndex, distanceFraction }` summary a cursor readout renders,
 * or `null` when no annotation is within `toleranceFraction`. Kept so the
 * readout and the full-event detail share exactly one selection spine.
 */
export function nearestAnnotationAtFraction(
    annotations: readonly AnnotationEvent[],
    xFraction: number,
    viewport: TimeViewport,
    sampling: SamplingInfo,
    sampleCount: number,
    toleranceFraction?: number,
): NearestAnnotation | null {
    const hit = nearestAnnotationEventAtFraction(
        annotations,
        xFraction,
        viewport,
        sampling,
        sampleCount,
        toleranceFraction,
    );
    if (hit === null) {
        return null;
    }
    return {
        symbol: hit.event.symbol,
        sampleIndex: hit.event.sampleIndex,
        distanceFraction: hit.distanceFraction,
    };
}

/** Caption label shown when the cursor is clear of every drawn marker. */
export const ANNOTATION_DETAIL_IDLE_LABEL = 'Annotation: \u2014';

/**
 * Render an {@link AnnotationHit} as the annotation detail caption line, or
 * {@link ANNOTATION_DETAIL_IDLE_LABEL} when there is no hit.
 *
 * The line echoes the record's own `symbol` and, when non-empty, its `auxNote`
 * (separated by the same `\u00b7` middle dot as the cursor caption) — the
 * display of a domain fact, never a detection and never a clinical claim
 * (ADR-013/ADR-016). An empty note adds no suffix, so the line never ends in a
 * dangling separator. The numeric `code` is deliberately not rendered: the
 * symbol is the marker vocabulary and the note is the human-readable field,
 * while a numeric code would add noise without adding a fact the note does not
 * already carry (ADR-016).
 */
export function formatAnnotationDetail(hit: AnnotationHit | null): string {
    if (hit === null) {
        return ANNOTATION_DETAIL_IDLE_LABEL;
    }
    const { symbol, sampleIndex, auxNote } = hit.event;
    const base = `Annotation: ${symbol} \u00b7 sample ${sampleIndex}`;
    return auxNote.length > 0 ? `${base} \u00b7 ${auxNote}` : base;
}

/**
 * Display cap on the bounded annotation-list panel (Phase 17): a DOM-size
 * bound, never a detection threshold and never a claim about the record.
 */
export const ANNOTATION_LIST_LIMIT = 200;

/**
 * A bounded, deterministic listing of the events a window contains, for the
 * annotation-list panel (Phase 17). Built from the record's own annotation
 * list only — nothing indexes a sample buffer (rules §26) — and carrying the
 * record's OWN event objects, so a row's click-to-pin keeps the exact identity
 * the canvas pin uses (ADR-018).
 */
export interface AnnotationList {
    /** In-window events, ascending by `sampleIndex`, capped to the limit. */
    readonly entries: readonly AnnotationEvent[];
    /** In-window total, before the cap. */
    readonly visibleCount: number;
    /** True when only the first slice is listed (`visibleCount > entries.length`). */
    readonly truncated: boolean;
}

/**
 * Deterministic listing order: ascending `sampleIndex`, then the
 * lexicographically smaller `symbol` — the same tie-break the nearest-annotation
 * spine uses, so "which comes first" has exactly one definition. In-window
 * indices are finite (a NaN index fails the half-open bounds), so the numeric
 * subtraction is well-defined.
 */
function compareBySampleThenSymbol(
    a: AnnotationEvent,
    b: AnnotationEvent,
): number {
    if (a.sampleIndex !== b.sampleIndex) {
        return a.sampleIndex - b.sampleIndex;
    }
    return a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0;
}

/**
 * List the record's own annotations that fall inside a viewport's half-open
 * sample window `[startSample, endSample)`, exactly as the drawn markers define
 * it, in a deterministic order and capped to `limit`.
 *
 * Order is ascending `sampleIndex`, ties broken by the lexicographically smaller
 * `symbol`, so the first slice never depends on the input order. `entries` holds
 * the record's own event objects (never copies); `visibleCount` is the uncapped
 * in-window total and `truncated` says whether the cap bit. A non-positive,
 * non-integer `limit` is `invalid-input`. Nothing is mutated.
 */
export function annotationList(
    annotations: readonly AnnotationEvent[],
    viewport: TimeViewport,
    sampling: SamplingInfo,
    sampleCount: number,
    limit: number,
): AnnotationList {
    const cap = requirePositiveSafeInteger(limit, 'annotation list limit');

    const window = sampleWindowOfTime(viewport, sampling, sampleCount);
    if (window.endSample <= window.startSample) {
        return { entries: [], visibleCount: 0, truncated: false };
    }

    const inWindow: AnnotationEvent[] = [];
    for (const annotation of annotations) {
        const { sampleIndex } = annotation;
        // Half-open inclusion; a NaN index fails both bounds and is skipped.
        if (sampleIndex >= window.startSample && sampleIndex < window.endSample) {
            inWindow.push(annotation);
        }
    }

    inWindow.sort(compareBySampleThenSymbol);

    return {
        entries: inWindow.slice(0, cap),
        visibleCount: inWindow.length,
        truncated: inWindow.length > cap,
    };
}

/**
 * Caption for the bounded annotation-list panel (Phase 17): states the bound
 * honestly. `No annotations in view` when the window is empty; `Showing first
 * {listed} of {total} in view` when the cap truncated the list; `{total} in
 * view` otherwise.
 */
export function formatAnnotationListCaption(list: AnnotationList): string {
    if (list.visibleCount === 0) {
        return 'No annotations in view';
    }
    if (list.truncated) {
        return `Showing first ${list.entries.length} of ${list.visibleCount} in view`;
    }
    return `${list.visibleCount} in view`;
}
