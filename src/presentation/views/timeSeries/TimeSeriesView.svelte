<script lang="ts">
    // Canvas time-series view (Phase 7 item #9).
    //
    // Renders a decimated trace of ONE signal channel on a <canvas>, driven
    // entirely by domain types:
    //
    // - the time axis is the signal's own `sampleIndex / sampleRateHz`
    //   convention (ADR-001): every viewport/window conversion goes through
    //   `./geometry.ts`, which delegates the time<->sample arithmetic to
    //   `src/domain/sampling.ts` (never re-implemented here);
    // - amplitude is drawn in the channel's own `unit` (e.g. mV for the
    //   canonical records) and shown as an explicit label;
    // - the source `Float64Array` is only ever READ (never written): the trace
    //   is decimated to one min/max column per x pixel by `envelopeColumns`.
    //
    // - the record's domain annotation events are drawn as density-capped
    //   vertical markers over the trace (Phase 12), positioned by the pure
    //   `./annotationGeometry.ts` helper; the markers are display only and are
    //   never fused into the signal.
    //
    // - the visible window may be narrowed or slid by the user (Phase 13): the
    //   five keyboard-accessible navigation buttons (and the guarded pointer
    //   drags) commit a new window to the parent through `onViewportCommit`.
    //   Every time<->sample conversion is the pure `./navigationGeometry.ts`
    //   helper, and zoom/pan change only what is DRAWN — the analysis is never
    //   re-invoked and no sample buffer is ever written (ADR-008).
    //
    // - the cursor readout may also name the annotation the pointer is sitting
    //   on (Phase 14): the nearest in-window annotation within a small display
    //   tolerance, resolved by the same pure helper that positions the markers.
    //   The name is always one of the record's own events — never a detection —
    //   and it never alters the reported time or sample (ADR-015).
    //
    // - the annotation detail line names the nearest annotation's own `symbol`
    //   and `auxNote`, and a view-local annotation symbol SELECTION hides
    //   markers of every symbol it does not list (Phase 15, generalised to a
    //   multi-symbol set in Phase 17). Both are display selections over the
    //   record's own events — never a detection — and both are resolved by the
    //   pure `./annotationGeometry.ts` helpers from the SAME filtered list the
    //   overlay draws, so the caption can never describe an undrawn marker
    //   (ADR-016, ADR-018). A click (as opposed to a drag) pins the annotation
    //   it lands on so the detail survives pointer leave, and commits no window:
    //   the bare click no longer performs an implicit zero-width zoom.
    //
    // - the window's distinct symbols are ALSO the control that drives that
    //   selection (Phase 17): a `role="group"` of `aria-pressed` toggles, one
    //   per unfiltered-window symbol, replaces the Phase-15 <select>. An empty
    //   selection is "All symbols", and the toggle set always comes from the
    //   UNFILTERED window, so a selection can never hide its own off-switch.
    //
    // - the window's own events are ALSO listed in a bounded, scrollable panel
    //   (Phase 17): the pure `./annotationGeometry.ts` helper sorts them by
    //   sample and caps them at `ANNOTATION_LIST_LIMIT`, and a row click pins
    //   that row's own event through the SAME `pinnedEvent` the canvas click
    //   sets — one pin, two entry points, so the detail line, the canvas
    //   highlight and the marked row can never disagree. The cap is a display
    //   bound (a DOM-size guard), never a claim.
    //
    // The view is display-only: it owns no science configuration and calls no
    // service. The parent decides which signal/channel/viewport to show —
    // item #11 wires those choices as interaction controls.
    import type { AnnotationEvent } from "../../../domain/record";
    import type { Signal, SignalChannel } from "../../../domain/signal";
    import type { SamplingInfo } from "../../../domain/sampling";
    import { durationSecOf, timeSecOfSample } from "../../../domain/sampling";
    import {
        ANNOTATION_LIST_LIMIT,
        annotationList,
        annotationMarkers,
        filterAnnotationsBySymbols,
        formatAnnotationDetail,
        formatAnnotationListCaption,
        nearestAnnotationEventAtFraction,
        resolveSymbolFilters,
        type AnnotationHit,
        type AnnotationList,
        type AnnotationMarkers,
    } from "./annotationGeometry";
    import {
        envelopeColumns,
        sampleWindowOfTime,
        visibleAmplitudeBounds,
        type AmplitudeBounds,
        type TimeViewport,
    } from "./geometry";
    import {
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
        type CursorReadout,
        type ViewportBounds,
    } from "./navigationGeometry";

    interface Props {
        /** Source signal to display; never mutated by this view. */
        signal: Signal;
        /** Channel to draw; defaults to the signal's first channel. */
        channelName?: string;
        /** Visible time window; defaults to the full acquisition window. */
        viewport?: TimeViewport;
        /**
         * Record annotation events to overlay as markers (Phase 12). Display
         * only: the view never detects, filters or fuses annotations.
         */
        annotations?: readonly AnnotationEvent[];
        /**
         * Receives a newly committed visible window from a zoom/pan/reset
         * (Phase 13). When omitted the view stays read-only and renders no
         * navigation controls. The view never calls the analysis service.
         */
        onViewportCommit?: ((viewport: TimeViewport) => void) | undefined;
        /** Canvas pixel width. */
        width?: number;
        /** Canvas pixel height. */
        height?: number;
    }

    let {
        signal,
        channelName,
        viewport,
        annotations = [],
        onViewportCommit,
        width = 720,
        height = 220,
    }: Props = $props();

    let canvas = $state<HTMLCanvasElement | undefined>(undefined);

    /**
     * Transient, UI-only cursor position (a normalised x fraction across the
     * drawn plot), or null when the pointer is not over the trace. Never a
     * committed window; it only feeds the readout caption.
     */
    let cursorFraction = $state<number | null>(null);

    /**
     * Transient press/drag endpoints (normalised x fractions), null when no
     * press is in progress. They are UI-only. On release, a movement smaller
     * than `PIN_MOVE_TOLERANCE_FRACTION` is a *click* — it pins the nearest
     * annotation and commits nothing (Phase 15) — while anything larger commits
     * the covered window through `onViewportCommit`, exactly as in Phase 13.
     */
    let dragStartFraction = $state<number | null>(null);
    let dragEndFraction = $state<number | null>(null);

    /**
     * View-local annotation symbol SELECTION (Phase 17): the symbols whose
     * markers are drawn. Display-only state — it hides markers of every symbol
     * it does not list and never re-runs the analysis. The EMPTY set means
     * "All symbols" (the identity), and symbols a window/channel change removed
     * fall back to "All" through `resolveSymbolFilters`, with no effect and no
     * manual reset (ADR-016, ADR-018).
     */
    let symbolFilters = $state<readonly string[]>([]);

    /**
     * The annotation a click pinned for the detail line (Phase 15), or null.
     * View-local display state: it survives pointer leave so the detail keeps
     * naming the clicked annotation, and it is only honoured while that event
     * is still drawn. Never a detection result (ADR-016).
     *
     * Held with `$state.raw` on purpose: a plain `$state` would deep-proxy the
     * assigned record event, and the pin would then no longer be the record's
     * own object — so the "still drawn?" test against the drawn list (identity,
     * `includes`) and the promise that a hit is handed on verbatim would both
     * break silently. A raw cell stores the event as-is and stays reactive on
     * reassignment, which is all this display state needs.
     */
    let pinnedEvent = $state.raw<AnnotationEvent | null>(null);

    /**
     * Display-width fraction a pointer may move between down and up and still
     * count as a *click* rather than a drag (Phase 15). A presentation guard
     * for the pin gesture — never a measurement threshold (ADR-016).
     */
    const PIN_MOVE_TOLERANCE_FRACTION = 0.01;

    let channel = $derived.by((): SignalChannel | null => {
        const named =
            channelName === undefined
                ? undefined
                : signal.channels.find(
                      (candidate) => candidate.name === channelName,
                  );
        return named ?? signal.channels[0] ?? null;
    });

    let resolvedViewport = $derived.by((): TimeViewport | null => {
        if (viewport !== undefined) {
            return viewport;
        }
        if (channel === null) {
            return null;
        }
        return {
            startSec: signal.sampling.startTimeSec,
            durationSec: durationSecOf(
                channel.data.length,
                signal.sampling.sampleRateHz,
            ),
        };
    });

    let sampleCount = $derived(channel === null ? 0 : channel.data.length);
    let sampleRateHz = $derived(signal.sampling.sampleRateHz);

    // The full acquisition window a zoom/pan is always kept inside, and the
    // display floor expressed in samples by the pure helper. Both delegate the
    // time<->sample maths to the domain.
    let navBounds = $derived.by(
        (): ViewportBounds => viewportBoundsOf(signal.sampling, sampleCount),
    );
    let minDurationSec = $derived(minViewportDurationSec(signal.sampling));
    let visibleStartSec = $derived(
        resolvedViewport === null ? 0 : resolvedViewport.startSec,
    );
    let visibleEndSec = $derived(
        resolvedViewport === null
            ? 0
            : resolvedViewport.startSec + resolvedViewport.durationSec,
    );

    /**
     * Distinct symbols of the **unfiltered** window (Phase 15): the options the
     * symbol filter offers. Deliberately separate from `annotationResult` so a
     * filter can never hide its own off-switch — the user can always switch
     * back to a symbol the current filter is hiding.
     */
    let allSymbols = $derived.by((): readonly string[] => {
        const active = channel;
        const view = resolvedViewport;
        if (active === null || view === null) {
            return [];
        }
        return annotationMarkers(
            annotations,
            view,
            signal.sampling,
            active.data.length,
            Math.max(1, Math.floor(width)),
        ).symbols;
    });

    /**
     * The effective selection: the stored symbols the window still offers, in
     * the window's own order — the EMPTY set ("All symbols") unless something
     * remains.
     */
    let resolvedFilters = $derived(
        resolveSymbolFilters(symbolFilters, allSymbols),
    );

    /**
     * The events the overlay draws: the record's own annotations narrowed to
     * the effective symbol selection (the identity for an empty selection).
     * Display only — nothing is detected and nothing is re-analysed.
     */
    let visibleAnnotations = $derived(
        filterAnnotationsBySymbols(annotations, resolvedFilters),
    );

    // Annotations of the filtered list mapped onto the visible window by the
    // pure helper (the sample maths is never re-implemented here). Markers are
    // density-capped to one per pixel column so a long recording cannot drown
    // the trace; the counts still reflect every drawn event inside the window.
    let annotationResult = $derived.by((): AnnotationMarkers => {
        const active = channel;
        const view = resolvedViewport;
        if (active === null || view === null) {
            return {
                markers: [],
                visibleCount: 0,
                mergedCount: 0,
                symbols: [],
            };
        }
        return annotationMarkers(
            visibleAnnotations,
            view,
            signal.sampling,
            active.data.length,
            Math.max(1, Math.floor(width)),
        );
    });

    let annotationSummary = $derived(annotationSummaryOf(annotationResult));

    /**
     * The bounded annotation list panel's rows (Phase 17): the SAME filtered
     * list the canvas draws, in window order, capped at `ANNOTATION_LIST_LIMIT`
     * by the pure helper. Display only — the entries are the record's own
     * events, so a row click pins the exact object the canvas pin would.
     */
    let annotationListResult = $derived.by((): AnnotationList => {
        const view = resolvedViewport;
        if (view === null) {
            return { entries: [], visibleCount: 0, truncated: false };
        }
        return annotationList(
            visibleAnnotations,
            view,
            signal.sampling,
            sampleCount,
            ANNOTATION_LIST_LIMIT,
        );
    });

    /** The panel's caption line, honest about the cap (pure helper). */
    let annotationListCaption = $derived(
        formatAnnotationListCaption(annotationListResult),
    );

    // Cursor readout: derived from the pointer fraction through the pure
    // helper, idle (`null`) while the pointer is away.
    let cursorReadout = $derived.by((): CursorReadout | null => {
        const view = resolvedViewport;
        if (cursorFraction === null || view === null) {
            return null;
        }
        return readoutAtFraction(cursorFraction, view, signal.sampling);
    });

    // The annotation the cursor is sitting on, if any: the same pure helper
    // that positions the drawn markers resolves it, from the SAME filtered list
    // the overlay draws, so the symbol/detail named here always belongs to a
    // marker the canvas is showing. Display only, never a detection (ADR-016).
    let annotationHit = $derived.by((): AnnotationHit | null => {
        const view = resolvedViewport;
        if (cursorFraction === null || view === null) {
            return null;
        }
        return nearestAnnotationEventAtFraction(
            visibleAnnotations,
            cursorFraction,
            view,
            signal.sampling,
            sampleCount,
        );
    });

    /**
     * The hit the detail line renders. A click-pinned annotation takes
     * precedence so the detail survives pointer leave, but only while it is
     * still drawn (`visibleAnnotations`), so the caption can never describe a
     * marker the symbol filter has hidden; otherwise the hovered hit.
     */
    let detailHit = $derived.by((): AnnotationHit | null => {
        const pinned = pinnedEvent;
        if (pinned !== null && visibleAnnotations.includes(pinned)) {
            return { event: pinned, distanceFraction: 0 };
        }
        return annotationHit;
    });

    /** The annotation detail caption line: the hit's own symbol/note, or idle. */
    let annotationDetail = $derived(formatAnnotationDetail(detailHit));

    let cursorLabel = $derived(
        formatCursorReadout(cursorReadout, annotationHit?.event.symbol ?? null),
    );

    /**
     * The single commit path for every navigation input (buttons and, in
     * Phase 13 item 3, pointer drags): the only place `onViewportCommit` is
     * called. It never re-analyses and never writes to a sample buffer.
     */
    function emitViewport(next: TimeViewport): void {
        onViewportCommit?.(next);
    }

    /** True when a window can be navigated (a channel and a positive span). */
    function navigable(view: TimeViewport | null): view is TimeViewport {
        return view !== null && navBounds.durationSec > 0;
    }

    function commitZoom(factor: number): void {
        const view = resolvedViewport;
        if (!navigable(view)) {
            return;
        }
        emitViewport(
            zoomViewport(view, navBounds, factor, 0.5, minDurationSec),
        );
    }

    function commitPan(deltaFraction: number): void {
        const view = resolvedViewport;
        if (!navigable(view)) {
            return;
        }
        emitViewport(panViewport(view, navBounds, deltaFraction));
    }

    function zoomIn(): void {
        commitZoom(ZOOM_STEP_FACTOR);
    }

    function zoomOut(): void {
        commitZoom(1 / ZOOM_STEP_FACTOR);
    }

    function panLeft(): void {
        commitPan(-PAN_STEP_FRACTION);
    }

    function panRight(): void {
        commitPan(PAN_STEP_FRACTION);
    }

    function resetView(): void {
        emitViewport(
            clampViewport(
                {
                    startSec: navBounds.startSec,
                    durationSec: navBounds.durationSec,
                },
                navBounds,
                minDurationSec,
            ),
        );
    }

    /**
     * Map a pointer event to a normalised fraction across the plot, or null
     * when the surface has no measurable width. jsdom returns a zero-width
     * rect, so every pointer handler below follows this inert path in the DOM
     * tests rather than diving by zero or throwing.
     */
    function fractionFromPointer(event: PointerEvent): number | null {
        const surface = canvas;
        if (surface === undefined) {
            return null;
        }
        const rect = surface.getBoundingClientRect();
        if (!(rect.width > 0)) {
            return null;
        }
        return clampFraction((event.clientX - rect.left) / rect.width);
    }

    function handlePointerDown(event: PointerEvent): void {
        const fraction = fractionFromPointer(event);
        if (fraction === null) {
            return;
        }
        // Recorded unconditionally (Phase 15): a click must be able to pin a
        // marker for the detail line even when the view has no navigation
        // callback. Whether this press becomes a click or a drag is decided on
        // release.
        dragStartFraction = fraction;
        dragEndFraction = fraction;
    }

    function handlePointerMove(event: PointerEvent): void {
        const fraction = fractionFromPointer(event);
        if (fraction === null) {
            return;
        }
        cursorFraction = fraction;
        if (dragStartFraction !== null) {
            dragEndFraction = fraction;
        }
    }

    /**
     * Pin (or clear) the annotation detail for a click at `fraction` (Phase
     * 15). The nearest in-window event within the display tolerance is pinned
     * verbatim; a click clear of every marker clears the pin. Display only:
     * nothing is detected, nothing is re-analysed, and no window is committed.
     */
    function pinNearestAtFraction(fraction: number): void {
        const view = resolvedViewport;
        if (view === null) {
            pinnedEvent = null;
            return;
        }
        const hit = nearestAnnotationEventAtFraction(
            visibleAnnotations,
            fraction,
            view,
            signal.sampling,
            sampleCount,
        );
        pinnedEvent = hit === null ? null : hit.event;
    }

    function handlePointerUp(): void {
        const start = dragStartFraction;
        const end = dragEndFraction ?? start;
        dragStartFraction = null;
        dragEndFraction = null;
        if (start === null || end === null) {
            return;
        }
        if (Math.abs(end - start) <= PIN_MOVE_TOLERANCE_FRACTION) {
            // A click, not a drag: pin the nearest annotation (or clear the
            // pin) and commit NO window — the Phase-13 implicit zero-width
            // zoom on a bare click is replaced by this display selection.
            pinNearestAtFraction(end);
            return;
        }
        if (onViewportCommit === undefined || !(navBounds.durationSec > 0)) {
            return;
        }
        emitViewport(
            viewportFromFractions(navBounds, start, end, minDurationSec),
        );
    }

    function handlePointerLeave(): void {
        cursorFraction = null;
        dragStartFraction = null;
        dragEndFraction = null;
    }

    function handlePointerCancel(): void {
        dragStartFraction = null;
        dragEndFraction = null;
    }

    /**
     * Toggle one legend symbol in or out of the display selection (Phase 17).
     * The stored selection is derived from the EFFECTIVE one, so it only ever
     * holds symbols the current window offers, in the window's own order;
     * toggling the last symbol off returns to "All symbols" (the empty set).
     * Nothing is re-analysed and no window is committed.
     */
    function toggleSymbol(symbol: string): void {
        const current = resolvedFilters;
        symbolFilters = current.includes(symbol)
            ? current.filter((candidate) => candidate !== symbol)
            : [...current, symbol];
    }

    /**
     * Pin the annotation detail from the list panel's row click (Phase 17). It
     * sets the SAME `pinnedEvent` the canvas click path (Phase 15) sets, so the
     * detail line, the canvas highlight and the `aria-current` row all agree on
     * one annotation. A row is a DOM control, not the canvas: no window is
     * committed, nothing is detected and nothing is re-analysed (ADR-016).
     */
    function pinEvent(event: AnnotationEvent): void {
        pinnedEvent = event;
    }

    $effect(() => {
        const surface = canvas;
        if (surface === undefined) {
            return;
        }
        if (channel === null || resolvedViewport === null) {
            return;
        }
        const context = surface.getContext("2d");
        if (context === null) {
            // jsdom (and therefore the DOM test slices) has no canvas drawing
            // implementation; the view degrades to markup-only rather than throw.
            return;
        }
        surface.width = width;
        surface.height = height;
        drawTrace(
            context,
            channel,
            signal.sampling,
            resolvedViewport,
            width,
            height,
        );
        drawAnnotations(context, annotationResult, width, height);
        drawDragBand(context, width, height);
    });

    /** Draw one decimated trace over the whole surface. Read-only on the data. */
    function drawTrace(
        context: CanvasRenderingContext2D,
        traceChannel: SignalChannel,
        sampling: SamplingInfo,
        view: TimeViewport,
        pixelWidth: number,
        pixelHeight: number,
    ): void {
        context.clearRect(0, 0, pixelWidth, pixelHeight);

        const window = sampleWindowOfTime(
            view,
            sampling,
            traceChannel.data.length,
        );
        const columns = envelopeColumns(
            traceChannel.data,
            window,
            Math.max(1, Math.floor(pixelWidth)),
        );
        const bounds = visibleAmplitudeBounds(columns);
        if (!bounds.populated || window.endSample <= window.startSample) {
            // Nothing in range: leave an empty, labelled canvas for the caller.
            return;
        }

        const domain = paddedDomain(bounds);
        const xOfTime = (timeSec: number): number =>
            ((timeSec - view.startSec) / view.durationSec) * pixelWidth;
        const yOfAmplitude = (value: number): number => {
            const fraction = (value - domain.min) / (domain.max - domain.min);
            return pixelHeight * (1 - fraction);
        };

        // Light background and a zero-amplitude baseline when it is in range.
        context.fillStyle = "#fbfcfe";
        context.fillRect(0, 0, pixelWidth, pixelHeight);
        if (domain.min < 0 && domain.max > 0) {
            context.strokeStyle = "#d7dde3";
            context.lineWidth = 1;
            context.beginPath();
            context.moveTo(0, yOfAmplitude(0));
            context.lineTo(pixelWidth, yOfAmplitude(0));
            context.stroke();
        }

        // One vertical min/max segment per pixel column (decimated trace).
        context.strokeStyle = "#0b6bcb";
        context.lineWidth = 1;
        context.beginPath();
        for (const column of columns) {
            if (!column.populated) {
                continue;
            }
            const startTime = timeSecOfSample(column.startSample, sampling);
            const endTime = timeSecOfSample(column.endSample, sampling);
            const x = xOfTime((startTime + endTime) / 2);
            context.moveTo(x + 0.5, yOfAmplitude(column.max));
            context.lineTo(x + 0.5, yOfAmplitude(column.min));
        }
        context.stroke();

        // Amplitude scale numbers at the plot's left edge.
        context.fillStyle = "#5a6470";
        context.font = "11px system-ui, sans-serif";
        context.fillText(formatAmplitude(domain.max), 6, 14);
        context.fillText(formatAmplitude(domain.min), 6, pixelHeight - 6);
    }

    /**
     * Overlay the window's annotation markers: one vertical stem per populated
     * pixel column, labelled with the column's representative symbol. All
     * positions come from the pure `annotationGeometry` helper; every input is
     * only ever read.
     */
    function drawAnnotations(
        context: CanvasRenderingContext2D,
        markers: AnnotationMarkers,
        pixelWidth: number,
        pixelHeight: number,
    ): void {
        if (markers.markers.length === 0) {
            return;
        }
        context.strokeStyle = "#b45309";
        context.fillStyle = "#b45309";
        context.font = "10px system-ui, sans-serif";
        context.lineWidth = 1;
        for (const marker of markers.markers) {
            const x = marker.xFraction * pixelWidth;
            context.beginPath();
            context.moveTo(x + 0.5, 0);
            context.lineTo(x + 0.5, pixelHeight);
            context.stroke();
            if (marker.symbol.length > 0) {
                context.fillText(marker.symbol, x + 2, 10);
            }
        }
    }

    /**
     * Paint the translucent band selected by a live drag (decoration only — it
     * is never asserted and carries no data).
     */
    function drawDragBand(
        context: CanvasRenderingContext2D,
        pixelWidth: number,
        pixelHeight: number,
    ): void {
        const from = dragStartFraction;
        const to = dragEndFraction;
        if (from === null || to === null) {
            return;
        }
        if (Math.abs(to - from) <= PIN_MOVE_TOLERANCE_FRACTION) {
            // A click, not a drag: the pin gesture draws no band.
            return;
        }
        const left = Math.min(from, to) * pixelWidth;
        const right = Math.max(from, to) * pixelWidth;
        context.fillStyle = "rgba(11, 107, 203, 0.12)";
        context.fillRect(left, 0, Math.max(1, right - left), pixelHeight);
    }

    /** Deterministic annotation caption for the figcaption (Phase 12). */
    function annotationSummaryOf(markers: AnnotationMarkers): string {
        if (markers.visibleCount === 0) {
            return "Annotations: none";
        }
        if (markers.mergedCount > 0) {
            return `Annotations: ${markers.visibleCount} in view (${markers.mergedCount} merged)`;
        }
        return `Annotations: ${markers.visibleCount} in view`;
    }

    /** Expand the visible min/max into a padded drawing domain (never empty). */
    function paddedDomain(bounds: AmplitudeBounds): {
        readonly min: number;
        readonly max: number;
    } {
        let min = bounds.min;
        let max = bounds.max;
        let span = max - min;
        if (!Number.isFinite(span) || span <= 0) {
            const half = max === 0 ? 0.5 : Math.abs(max) * 0.5;
            min = max - half;
            max = max + half;
            span = max - min;
        }
        const margin = span * 0.08;
        return { min: min - margin, max: max + margin };
    }

    function formatAmplitude(value: number): string {
        return Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(2);
    }
</script>

{#if channel === null}
    <p class="view-status" role="status">
        No channel available to render in the time-series view.
    </p>
{:else}
    <figure
        class="time-series-view"
        role="img"
        aria-label={`${channel.name} time series, unit ${channel.unit}`}
    >
        <canvas
            aria-hidden="true"
            bind:this={canvas}
            {width}
            {height}
            onpointerdown={handlePointerDown}
            onpointermove={handlePointerMove}
            onpointerup={handlePointerUp}
            onpointerleave={handlePointerLeave}
            onpointercancel={handlePointerCancel}
        ></canvas>
        {#if onViewportCommit !== undefined}
            <div
                class="view-navigation"
                role="group"
                aria-label="View navigation"
            >
                <button type="button" onclick={zoomIn}>Zoom in</button>
                <button type="button" onclick={zoomOut}>Zoom out</button>
                <button type="button" onclick={panLeft}>Pan left</button>
                <button type="button" onclick={panRight}>Pan right</button>
                <button type="button" onclick={resetView}>Reset view</button>
            </div>
        {/if}
        {#if allSymbols.length > 0}
            <div
                class="series-legend"
                role="group"
                aria-label="Symbol selection"
            >
                <span class="series-legend-label">Symbols:</span>
                {#each allSymbols as symbol (symbol)}
                    <button
                        type="button"
                        class="series-legend-toggle"
                        aria-pressed={resolvedFilters.includes(symbol)}
                        onclick={() => toggleSymbol(symbol)}>{symbol}</button
                    >
                {/each}
            </div>
        {/if}
        <section
            class="series-annotation-list"
            aria-label="Annotations in view"
        >
            <p class="series-annotation-list-caption">
                {annotationListCaption}
            </p>
            <ol class="series-annotation-list-rows">
                {#each annotationListResult.entries as entry (entry)}
                    <li>
                        <button
                            type="button"
                            class="series-annotation-row"
                            aria-current={pinnedEvent === entry
                                ? "true"
                                : undefined}
                            onclick={() => pinEvent(entry)}
                        >
                            {formatAnnotationDetail({
                                event: entry,
                                distanceFraction: 0,
                            })}
                        </button>
                    </li>
                {/each}
            </ol>
        </section>
        <figcaption>
            <span class="series-title">{channel.name}</span>
            <span class="series-unit">Unit: {channel.unit}</span>
            <span class="series-rate">Sample rate: {sampleRateHz} Hz</span>
            <span class="series-count">{sampleCount} samples</span>
            <span class="series-window"
                >t = {visibleStartSec.toFixed(2)} s &rarr; {visibleEndSec.toFixed(
                    2,
                )} s</span
            >
            <span class="series-annotations">{annotationSummary}</span>
            <span class="series-cursor">{cursorLabel}</span>
            <span class="series-annotation-detail">{annotationDetail}</span>
        </figcaption>
    </figure>
{/if}

<style>
    .time-series-view {
        margin: 0;
    }

    canvas {
        display: block;
        max-width: 100%;
        height: auto;
        background: #fbfcfe;
        border: 1px solid #cbd2d9;
        border-radius: 4px;
    }

    figcaption {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        margin-top: 0.4rem;
        font-size: 0.85rem;
        color: #3c4650;
    }

    .series-title {
        font-weight: 700;
        color: #0b2a47;
    }

    .series-annotations {
        font-weight: 600;
        color: #b45309;
    }

    .view-navigation {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
        margin-top: 0.4rem;
    }

    .view-navigation button {
        font: inherit;
        font-size: 0.8rem;
        padding: 0.15rem 0.5rem;
        color: #0b2a47;
        background: #eef3f8;
        border: 1px solid #cbd2d9;
        border-radius: 4px;
        cursor: pointer;
    }

    .series-cursor {
        font-variant-numeric: tabular-nums;
        color: #0b6bcb;
    }

    .series-annotation-detail {
        color: #b45309;
    }

    .series-legend {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.4rem;
        margin-top: 0.4rem;
    }

    .series-legend-label {
        color: #b45309;
    }

    .series-legend-toggle {
        font: inherit;
        font-size: 0.8rem;
        padding: 0.15rem 0.5rem;
        color: #0b2a47;
        background: #eef3f8;
        border: 1px solid #cbd2d9;
        border-radius: 4px;
        cursor: pointer;
    }

    .series-legend-toggle[aria-pressed="true"] {
        color: #ffffff;
        background: #b45309;
        border-color: #b45309;
    }

    .series-annotation-list {
        margin-top: 0.4rem;
        font-size: 0.85rem;
        color: #3c4650;
    }

    .series-annotation-list-caption {
        margin: 0 0 0.25rem;
        font-weight: 600;
        color: #b45309;
    }

    .series-annotation-list-rows {
        margin: 0;
        padding-left: 1.2rem;
        max-height: 9rem;
        overflow-y: auto;
    }

    .series-annotation-row {
        font: inherit;
        font-size: 0.8rem;
        padding: 0.1rem 0.35rem;
        color: #3c4650;
        background: transparent;
        border: 1px solid transparent;
        border-radius: 4px;
        cursor: pointer;
        text-align: left;
    }

    .series-annotation-row[aria-current="true"] {
        color: #ffffff;
        background: #b45309;
        border-color: #b45309;
    }

    .view-status {
        font-style: italic;
        color: #5a6470;
    }
</style>
