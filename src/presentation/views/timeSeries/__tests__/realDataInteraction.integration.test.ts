// @vitest-environment jsdom
/**
 * Real-data jsdom interaction slice (Phase 16 item 3).
 *
 * The companion `realDataDisplay.integration.test.ts` measures the *numbers*
 * the display helpers derive from a real MIT-BIH record under the default Node
 * environment. This slice measures the *wiring* of the Phase-12..15 display
 * interactions to that same real record: the view is rendered directly (never
 * through `App`) with the record's own signal and annotations, and the DOM is
 * asserted for the idle detail line, the annotation a pointer names, the
 * distinct symbols the legend offers, and the caption a symbol selection
 * narrows.
 *
 * It is an OPT-IN gate, never a CI gate (ADR-017): the gitignored `data/raw`
 * dataset is probed synchronously at module scope, and every case skips when
 * the dataset is absent (a clean clone). A skipped gate proves nothing — it is
 * reported as skipped, never silently passed.
 *
 * jsdom cannot measure layout, so the canvas rect is stubbed to a fixed
 * 200x100 box and the pointer cases exercise only the fraction -> wiring path.
 * The formatting branches stay pinned by the pure Node `annotationGeometry`
 * gate. `getContext("2d")` is stubbed to return null so the view degrades to
 * its markup-only path without jsdom virtual-console noise, exactly as the
 * other DOM slices do.
 *
 * The record is read ONCE at module scope (top-level await, allowed by the
 * project's `module: ESNext` / `target: ES2022` config) rather than in a
 * `beforeAll`, so the annotation-dependent cases can be driven by
 * `it.skipIf(...)` on the record's own annotation count — a value only known
 * after the load. This is the same single-sourced load the Node gate uses, so
 * "which record" is decided in exactly one place.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import TimeSeriesView from "../TimeSeriesView.svelte";
import {
    ANNOTATION_DETAIL_IDLE_LABEL,
    formatAnnotationDetail,
} from "../annotationGeometry";
import type { TimeViewport } from "../geometry";
import type { AnnotationEvent, SignalRecord } from "../../../../domain/record";
import type { Signal, SignalChannel } from "../../../../domain/signal";
import { durationSecOf, timeSecOfSample } from "../../../../domain/sampling";
import {
    REAL_RECORD_SKIP_REASON,
    firstCompleteRecordId,
    loadRealRecord,
} from "../../../../datasets/__tests__/realRecordSupport";

/** The fixed plot box the pointer maths is anchored to (px), as in Phase 14/15. */
const PLOT_WIDTH = 200;
const PLOT_HEIGHT = 100;

const recordId = firstCompleteRecordId();
const loaded = recordId === undefined ? undefined : await loadRealRecord();
const datasetAbsent = loaded === undefined;
const hasAnnotations =
    loaded !== undefined && loaded.record.annotations.length > 0;

interface RealInteractionFixture {
    readonly channel: SignalChannel;
    readonly signal: Signal;
    readonly record: SignalRecord;
    /** The view's own default window: the whole acquisition. */
    readonly viewport: TimeViewport;
    /** The figure's accessible name, derived from the record's own channel. */
    readonly figureLabel: string;
}

let fixture: RealInteractionFixture | undefined;

/** The real record, loaded once; throws if a case runs without the dataset. */
function real(): RealInteractionFixture {
    if (loaded === undefined) {
        throw new Error(REAL_RECORD_SKIP_REASON);
    }
    if (fixture === undefined) {
        const channel = loaded.signal.channels[0];
        if (channel === undefined) {
            throw new Error("the real record has no channel to display");
        }
        fixture = {
            channel,
            signal: loaded.signal,
            record: loaded.record,
            viewport: {
                startSec: loaded.signal.sampling.startTimeSec,
                durationSec: durationSecOf(
                    channel.data.length,
                    loaded.signal.sampling.sampleRateHz,
                ),
            },
            figureLabel: `${channel.name} time series, unit ${channel.unit}`,
        };
    }
    return fixture;
}

function clamp01(value: number): number {
    if (value < 0) {
        return 0;
    }
    if (value > 1) {
        return 1;
    }
    return value;
}

/**
 * The fraction across the drawn plot a sample index sits at, recomputed here
 * from the domain conversion rather than read back from a production helper.
 */
function fractionOfSample(sampleIndex: number): number {
    const { signal, viewport } = real();
    const timeSec = timeSecOfSample(sampleIndex, signal.sampling);
    return clamp01((timeSec - viewport.startSec) / viewport.durationSec);
}

/** The real annotation nearest the middle of the record, to hover over. */
function midpointAnnotation(): AnnotationEvent {
    const { record } = real();
    let best: AnnotationEvent | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const event of record.annotations) {
        const distance = Math.abs(fractionOfSample(event.sampleIndex) - 0.5);
        if (distance < bestDistance) {
            bestDistance = distance;
            best = event;
        }
    }
    if (best === undefined) {
        throw new Error("the real record has no annotation to hover");
    }
    return best;
}

/** The record's own distinct annotation symbols, ascending, recomputed. */
function distinctSymbols(): readonly string[] {
    return Array.from(
        new Set(real().record.annotations.map((event) => event.symbol)),
    ).sort();
}

/** Render the real record into the view and assert the real figure mounted. */
function renderRealView(): void {
    const { signal, record, figureLabel } = real();
    render(TimeSeriesView, {
        props: { signal, annotations: record.annotations },
    });
    // The real signal must render the canvas view, not the "no channel" status:
    // assert the figure is named by the record's own channel.
    expect(screen.getByRole("img", { name: figureLabel })).toBeTruthy();
}

/**
 * Stub the canvas rect to the fixed 200x100 box, since jsdom cannot measure
 * layout. Only the fraction -> wiring path is exercised through it.
 */
function measurableCanvas(): HTMLCanvasElement {
    const graphic = screen.getByRole("img", { name: real().figureLabel });
    const surface = graphic.querySelector("canvas");
    if (surface === null) {
        throw new Error("expected the figure to contain a canvas");
    }
    surface.getBoundingClientRect = () =>
        ({
            x: 0,
            y: 0,
            top: 0,
            left: 0,
            right: PLOT_WIDTH,
            bottom: PLOT_HEIGHT,
            width: PLOT_WIDTH,
            height: PLOT_HEIGHT,
            toJSON: () => ({}),
        }) as DOMRect;
    return surface;
}

/**
 * The clickable symbol-legend toggles of the current render, in DOM order.
 * Phase 17 supersedes the Phase-15 `<select>` with this `role="group"` of
 * `aria-pressed` buttons, one per symbol of the UNFILTERED window — so a
 * selection can never hide its own off-switch.
 */
function legendToggles(): HTMLButtonElement[] {
    const group = screen.queryByRole("group", { name: "Symbol selection" });
    return group === null ? [] : Array.from(group.querySelectorAll("button"));
}

/** The symbols the legend offers, in DOM order (the toggle labels). */
function legendSymbols(): string[] {
    return legendToggles().map((button) => button.textContent ?? "");
}

/** The toggle for one symbol; throws when the legend does not offer it. */
function legendToggle(symbol: string): HTMLButtonElement {
    const button = legendToggles().find(
        (candidate) => candidate.textContent === symbol,
    );
    if (button === undefined) {
        throw new Error(`expected a legend toggle for ${symbol}`);
    }
    return button;
}

/**
 * The annotation-detail caption's own text. The Phase-17 list panel labels each
 * row with the SAME `formatAnnotationDetail()` string, so the detail line must
 * be read back by its class rather than by a bare `getByText`, which would now
 * match both the caption and a row.
 */
function detailLine(): string {
    const line = document.querySelector(".series-annotation-detail");
    if (line === null) {
        throw new Error("expected a series-annotation-detail caption line");
    }
    return line.textContent ?? "";
}

describe("TimeSeriesView over a real MIT-BIH record (opt-in jsdom slice)", () => {
    beforeEach(() => {
        // jsdom ships no canvas implementation; stubbing getContext to return
        // null runs the component's guarded, markup-only path without jsdom
        // printing "Not implemented" virtual-console noise on every mount.
        HTMLCanvasElement.prototype.getContext = () => null;
    });

    afterEach(() => {
        cleanup();
    });

    it.skipIf(datasetAbsent)(
        "shows the idle annotation detail before any pointer interaction",
        () => {
            renderRealView();

            expect(screen.getByText(ANNOTATION_DETAIL_IDLE_LABEL)).toBeTruthy();
        },
    );

    it.skipIf(!hasAnnotations)(
        "names the record's own annotation a pointer rests on",
        async () => {
            renderRealView();
            const surface = measurableCanvas();
            const chosen = midpointAnnotation();

            // Hover exactly on the chosen annotation's plot fraction, so its
            // own real event is the (zero-distance) nearest.
            const clientX = fractionOfSample(chosen.sampleIndex) * PLOT_WIDTH;
            await fireEvent.pointerMove(surface, {
                clientX,
                clientY: PLOT_HEIGHT / 2,
            });

            const expected = formatAnnotationDetail({
                event: chosen,
                distanceFraction: 0,
            });
            // The detail must be the record's own event, never the idle line.
            expect(expected).not.toBe(ANNOTATION_DETAIL_IDLE_LABEL);
            expect(expected).toContain(chosen.symbol);
            expect(detailLine()).toBe(expected);
        },
    );

    it.skipIf(!hasAnnotations)(
        "offers the record's own distinct symbols as legend toggles",
        () => {
            renderRealView();

            expect(legendSymbols()).toEqual([...distinctSymbols()]);
        },
    );

    it.skipIf(!hasAnnotations)(
        "narrows the caption to a chosen real symbol, keeping every option",
        async () => {
            renderRealView();

            const symbols = distinctSymbols();
            const symbol = symbols[0];
            if (symbol === undefined) {
                throw new Error("the real record has no symbol to filter");
            }
            // The filtered window's drawn-event count is the record's own
            // number of events carrying that symbol (full window).
            const count = real().record.annotations.filter(
                (event) => event.symbol === symbol,
            ).length;

            await fireEvent.click(legendToggle(symbol));

            // The density cap may merge adjacent events, so the count may carry
            // a "(N merged)" suffix; the in-view count itself is exact.
            expect(
                screen.getByText(new RegExp(`^Annotations: ${count} in view`)),
            ).toBeTruthy();
            expect(legendSymbols()).toEqual([...symbols]);
            // Toggles still come from the unfiltered window, so a selection can
            // never hide its own off-switch; the chosen one reads as pressed.
            expect(legendToggle(symbol).getAttribute("aria-pressed")).toBe(
                "true",
            );
        },
    );
});
