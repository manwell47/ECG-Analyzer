// @vitest-environment jsdom
/**
 * Canvas time-series view smoke slice (Phase 7 item #9).
 *
 * jsdom has no real 2d context, so `getContext("2d")` returns null and the
 * component deliberately degrades to markup-only. These tests assert the
 * markup surface a user sees (channel identity, explicit unit label, fs-based
 * window) and that the view mounts safely without a canvas implementation.
 * They never assert on drawn pixels — the numerical/decimation correctness is
 * the pure Node `geometry.test.ts` gate.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import TimeSeriesView from "../TimeSeriesView.svelte";
import { ANNOTATION_LIST_LIMIT } from "../annotationGeometry";
import type { AnnotationEvent } from "../../../../domain/record";
import type { Signal } from "../../../../domain/signal";
import { createSamplingInfo } from "../../../../domain/sampling";
import type { TimeViewport } from "../geometry";

const SAMPLING = createSamplingInfo(2, 0);

function makeSignal(): Signal {
    return {
        id: "test/ecg",
        channels: [
            {
                name: "lead-a",
                unit: "mV",
                data: new Float64Array([0, 0.5, 1, 0.5, 0, -0.5, -1, -0.5]),
            },
            {
                name: "lead-b",
                unit: "mV",
                data: new Float64Array([1, 1, 1, 1, 1, 1, 1, 1]),
            },
        ],
        sampling: SAMPLING,
        provenance: { transforms: [] },
    };
}

function makeAnnotations(
    entries: readonly (readonly [number, string])[],
): readonly AnnotationEvent[] {
    return entries.map(([sampleIndex, symbol]) => ({
        sampleIndex,
        symbol,
        auxNote: "",
    }));
}

/** One annotation with an explicit note, for the Phase-15 detail cases. */
function annotated(
    sampleIndex: number,
    symbol: string,
    auxNote: string,
): AnnotationEvent {
    return { sampleIndex, symbol, auxNote };
}

/**
 * The clickable symbol-legend toggles of the current render, in DOM order.
 * Phase 17 replaces the Phase-15 `<select>` with this `role="group"` of
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

/** The symbols whose toggle is currently pressed (the active selection). */
function pressedSymbols(): string[] {
    return legendToggles()
        .filter((button) => button.getAttribute("aria-pressed") === "true")
        .map((button) => button.textContent ?? "");
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

/** The bounded annotation-list panel of the current render, if present. */
function annotationPanel(): HTMLElement | null {
    return document.querySelector<HTMLElement>(
        '[aria-label="Annotations in view"]',
    );
}

/** The panel's caption line (the pure `formatAnnotationListCaption` string). */
function annotationCaption(): string {
    const caption = annotationPanel()?.querySelector(
        ".series-annotation-list-caption",
    );
    if (caption === undefined || caption === null) {
        throw new Error("expected an annotation list caption line");
    }
    return caption.textContent ?? "";
}

/** The panel's row buttons, in DOM order. */
function annotationRows(): HTMLButtonElement[] {
    const panel = annotationPanel();
    return panel === null ? [] : Array.from(panel.querySelectorAll("button"));
}

/** The panel's row labels, in DOM order. */
function annotationRowLabels(): string[] {
    return annotationRows().map((row) => row.textContent ?? "");
}

describe("TimeSeriesView (jsdom slice)", () => {
    beforeEach(() => {
        // jsdom ships no canvas implementation; stubbing getContext to return
        // null runs the component's guarded, markup-only path without jsdom
        // printing "Not implemented" virtual-console noise on every mount.
        HTMLCanvasElement.prototype.getContext = () => null;
    });

    afterEach(() => {
        cleanup();
    });

    it("renders a labelled canvas and the channel/unit/rate caption by default", () => {
        render(TimeSeriesView, { props: { signal: makeSignal() } });

        // The figure carries the graphic role + accessible name; the canvas is
        // the decorative drawing surface inside it (default = first channel).
        const graphic = screen.getByRole("img", { name: "lead-a time series, unit mV" });
        expect(graphic.querySelector("canvas")).toBeTruthy();

        expect(screen.getByText("lead-a")).toBeTruthy();
        expect(screen.getByText("Unit: mV")).toBeTruthy();
        expect(screen.getByText("Sample rate: 2 Hz")).toBeTruthy();
        expect(screen.getByText("8 samples")).toBeTruthy();
        // Full-window default viewport: [0, 4.00) s at 2 Hz over 8 samples.
        expect(screen.getByText("t = 0.00 s \u2192 4.00 s")).toBeTruthy();
    });

    it("selects the requested channel by name", () => {
        render(TimeSeriesView, {
            props: { signal: makeSignal(), channelName: "lead-b" },
        });

        expect(screen.getByRole("img", { name: "lead-b time series, unit mV" })).toBeTruthy();
        expect(screen.getByText("lead-b")).toBeTruthy();
        expect(screen.queryByRole("img", { name: /lead-a/ })).toBeNull();
    });

    it("falls back to the first channel for an unknown channel name", () => {
        render(TimeSeriesView, {
            props: { signal: makeSignal(), channelName: "does-not-exist" },
        });

        expect(screen.getByRole("img", { name: "lead-a time series, unit mV" })).toBeTruthy();
    });

    it("honours an explicit viewport in the caption window", () => {
        render(TimeSeriesView, {
            props: {
                signal: makeSignal(),
                viewport: { startSec: 1, durationSec: 2 },
            },
        });

        // [1.00, 3.00) s maps onto samples [2, 6) -> still 8-sample channel.
        expect(screen.getByText("t = 1.00 s \u2192 3.00 s")).toBeTruthy();
        expect(screen.getByText("8 samples")).toBeTruthy();
    });

    it("renders a status instead of a canvas when the signal has no channels", () => {
        const emptySignal: Signal = {
            ...makeSignal(),
            channels: [],
        };
        render(TimeSeriesView, { props: { signal: emptySignal } });

        expect(
            screen.getByText("No channel available to render in the time-series view."),
        ).toBeTruthy();
        expect(screen.queryByRole("img")).toBeNull();
    });

    it("states that there are no annotations in the window by default", () => {
        render(TimeSeriesView, { props: { signal: makeSignal() } });

        expect(screen.getByText("Annotations: none")).toBeTruthy();
        // A window with no symbols offers no legend control at all.
        expect(
            screen.queryByRole("group", { name: "Symbol selection" }),
        ).toBeNull();
    });

    it("counts the window's annotations and lists the distinct symbols", () => {
        render(TimeSeriesView, {
            props: {
                signal: makeSignal(),
                annotations: makeAnnotations([
                    [0, "N"],
                    [2, "A"],
                    [6, "V"],
                ]),
            },
        });

        expect(screen.getByText("Annotations: 3 in view")).toBeTruthy();
        expect(legendSymbols()).toEqual(["A", "N", "V"]);
        // Nothing pressed yet: the empty selection is "All symbols".
        expect(pressedSymbols()).toEqual([]);
    });

    it("reports merged annotations when the density cap collapses a pixel column", () => {
        render(TimeSeriesView, {
            props: {
                signal: makeSignal(),
                // Two pixel columns for the whole record: samples 0..3 merge.
                width: 2,
                annotations: makeAnnotations([
                    [0, "N"],
                    [1, "N"],
                    [2, "A"],
                    [3, "V"],
                ]),
            },
        });

        expect(screen.getByText("Annotations: 4 in view (3 merged)")).toBeTruthy();
        expect(legendSymbols()).toEqual(["A", "N", "V"]);
    });

    it("excludes annotations outside the visible viewport from the count", () => {
        render(TimeSeriesView, {
            props: {
                signal: makeSignal(),
                viewport: { startSec: 1, durationSec: 2 },
                annotations: makeAnnotations([
                    [1, "N"],
                    [4, "A"],
                    [6, "V"],
                ]),
            },
        });

        expect(screen.getByText("Annotations: 1 in view")).toBeTruthy();
        expect(legendSymbols()).toEqual(["A"]);
    });

    describe("navigation controls and cursor readout (Phase 13 item 2)", () => {
        /** Render the view with a callback that records every commit. */
        function renderWithCommits(
            props: Record<string, unknown> = {},
        ): TimeViewport[] {
            const commits: TimeViewport[] = [];
            render(TimeSeriesView, {
                props: {
                    signal: makeSignal(),
                    onViewportCommit: (viewport: TimeViewport) => {
                        commits.push(viewport);
                    },
                    ...props,
                },
            });
            return commits;
        }

        it("renders no navigation group and an idle cursor readout without a callback", () => {
            render(TimeSeriesView, { props: { signal: makeSignal() } });

            expect(
                screen.queryByRole("group", { name: "View navigation" }),
            ).toBeNull();
            expect(screen.queryByRole("button")).toBeNull();
            expect(screen.getByText("Cursor: \u2014")).toBeTruthy();
        });

        it("exposes the five accessible navigation buttons with a callback", () => {
            renderWithCommits();

            expect(
                screen.getByRole("group", { name: "View navigation" }),
            ).toBeTruthy();
            for (const name of [
                "Zoom in",
                "Zoom out",
                "Pan left",
                "Pan right",
                "Reset view",
            ]) {
                expect(screen.getByRole("button", { name })).toBeTruthy();
            }
        });

        it("zooms in to a strictly narrower window inside the current bounds", async () => {
            const commits = renderWithCommits();

            await fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));

            expect(commits).toHaveLength(1);
            const next = commits[0];
            if (next === undefined) {
                throw new Error("expected the zoom-in button to commit a viewport");
            }
            expect(next.durationSec).toBeLessThan(4);
            // The display floor is 2 samples == 1 s at 2 Hz.
            expect(next.durationSec).toBeGreaterThanOrEqual(1);
            expect(next.startSec).toBeGreaterThanOrEqual(0);
            expect(next.startSec + next.durationSec).toBeLessThanOrEqual(4);
        });

        it("keeps the full record when zooming out at the full record", async () => {
            const commits = renderWithCommits();

            await fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));

            expect(commits).toEqual([{ startSec: 0, durationSec: 4 }]);
        });

        it("resets a zoomed window to exactly the full bounds", async () => {
            const commits = renderWithCommits({
                viewport: { startSec: 1, durationSec: 2 },
            });

            await fireEvent.click(
                screen.getByRole("button", { name: "Reset view" }),
            );

            expect(commits).toEqual([{ startSec: 0, durationSec: 4 }]);
        });

        it("pans right without changing the duration", async () => {
            const commits = renderWithCommits({
                viewport: { startSec: 0, durationSec: 2 },
            });

            await fireEvent.click(
                screen.getByRole("button", { name: "Pan right" }),
            );

            expect(commits).toEqual([{ startSec: 0.5, durationSec: 2 }]);
        });

        it("clamps a pan at the left edge without shrinking the window", async () => {
            const commits = renderWithCommits({
                viewport: { startSec: 0, durationSec: 2 },
            });

            await fireEvent.click(
                screen.getByRole("button", { name: "Pan left" }),
            );

            expect(commits).toEqual([{ startSec: 0, durationSec: 2 }]);
        });

        it("clamps a pan at the right edge without shrinking the window", async () => {
            const commits = renderWithCommits({
                viewport: { startSec: 2, durationSec: 2 },
            });

            await fireEvent.click(
                screen.getByRole("button", { name: "Pan right" }),
            );

            expect(commits).toEqual([{ startSec: 2, durationSec: 2 }]);
        });

        describe("pointer drags are inert without layout (Phase 13 item 3)", () => {
            /**
             * jsdom's `getBoundingClientRect()` returns a zero-width rect, so
             * the view cannot map a client x to the plot. Drag *geometry* is
             * proven by the Node `navigationGeometry` gate; here we only prove
             * the guarded path emits nothing and never throws.
             */
            function canvasElement(): HTMLCanvasElement {
                const graphic = screen.getByRole("img", {
                    name: "lead-a time series, unit mV",
                });
                const surface = graphic.querySelector("canvas");
                if (surface === null) {
                    throw new Error("expected the figure to contain a canvas");
                }
                return surface;
            }

            it("emits nothing and keeps the readout idle through a full drag", async () => {
                const commits = renderWithCommits();
                const surface = canvasElement();

                await fireEvent.pointerDown(surface, { clientX: 10, clientY: 5 });
                await fireEvent.pointerMove(surface, { clientX: 200, clientY: 5 });
                await fireEvent.pointerUp(surface, { clientX: 400, clientY: 5 });

                expect(commits).toEqual([]);
                expect(screen.getByText("Cursor: \u2014")).toBeTruthy();
            });

            it("cancels a drag on pointerleave without emitting", async () => {
                const commits = renderWithCommits();
                const surface = canvasElement();

                await fireEvent.pointerDown(surface, { clientX: 10, clientY: 5 });
                await fireEvent.pointerMove(surface, { clientX: 200, clientY: 5 });
                await fireEvent.pointerLeave(surface);
                await fireEvent.pointerUp(surface, { clientX: 400, clientY: 5 });

                expect(commits).toEqual([]);
                expect(screen.getByText("Cursor: \u2014")).toBeTruthy();
            });

            it("stays inert even without a commit callback", async () => {
                render(TimeSeriesView, { props: { signal: makeSignal() } });
                const surface = canvasElement();

                await fireEvent.pointerDown(surface, { clientX: 10, clientY: 5 });
                await fireEvent.pointerMove(surface, { clientX: 300, clientY: 5 });
                await fireEvent.pointerUp(surface, { clientX: 300, clientY: 5 });

                // No navigation group and no crash on the read-only view.
                expect(
                    screen.queryByRole("group", { name: "View navigation" }),
                ).toBeNull();
                expect(screen.getByText("Cursor: \u2014")).toBeTruthy();
            });
        });

        describe("cursor annotation readout (Phase 14 item 2)", () => {
            /**
             * jsdom reports a zero-width rect, so the view cannot map a client
             * x to the plot by default. Stubbing a measurable rect lets the
             * synthetic pointer path drive the *wired* readout end to end while
             * the label's every-branch formatting stays pinned in the Node
             * `navigationGeometry` gate.
             */
            function measurableCanvas(): HTMLCanvasElement {
                const graphic = screen.getByRole("img", {
                    name: "lead-a time series, unit mV",
                });
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
                        right: 200,
                        bottom: 100,
                        width: 200,
                        height: 100,
                        toJSON: () => ({}),
                    }) as DOMRect;
                return surface;
            }

            function renderWithAnnotations(): void {
                render(TimeSeriesView, {
                    props: {
                        signal: makeSignal(),
                        annotations: makeAnnotations([[2, "A"]]),
                    },
                });
            }

            it("keeps the readout idle, with no symbol, while the pointer is away", () => {
                renderWithAnnotations();

                expect(screen.getByText("Cursor: \u2014")).toBeTruthy();
                expect(screen.queryByText(/nearest/)).toBeNull();
            });

            it("names the record's own annotation the cursor is sitting on", async () => {
                renderWithAnnotations();
                const surface = measurableCanvas();

                // Sample 2 of an 8-sample, 4 s record sits at 1 s -> x fraction
                // 0.25 -> 50 px of the stubbed 200 px plot.
                await fireEvent.pointerMove(surface, { clientX: 50, clientY: 50 });

                expect(
                    screen.getByText("Cursor: 1.00 s \u00b7 sample 2 \u00b7 nearest A"),
                ).toBeTruthy();
                // The geometry readout is unchanged by the symbol.
                expect(screen.queryByText(/cursor: 1\.00 s \u00b7 sample 3/)).toBeNull();
            });

            it("adds no symbol when the cursor is clear of every annotation", async () => {
                renderWithAnnotations();
                const surface = measurableCanvas();

                // x fraction 0.75 is half a plot away from the only annotation.
                await fireEvent.pointerMove(surface, { clientX: 150, clientY: 50 });

                expect(
                    screen.getByText("Cursor: 3.00 s \u00b7 sample 6"),
                ).toBeTruthy();
                expect(screen.queryByText(/nearest/)).toBeNull();
            });

            it("returns to the idle readout when the pointer leaves", async () => {
                renderWithAnnotations();
                const surface = measurableCanvas();

                await fireEvent.pointerMove(surface, { clientX: 50, clientY: 50 });
                await fireEvent.pointerLeave(surface);

                expect(screen.getByText("Cursor: \u2014")).toBeTruthy();
                expect(screen.queryByText(/nearest/)).toBeNull();
            });
        });
    });

    describe("annotation detail and symbol legend (Phase 15 item 3, Phase 17 item 2)", () => {
        /**
         * Same stubbed 200x100 rect as the Phase-14 slice: jsdom cannot measure
         * layout, so only the *wiring* from a pointer fraction to the wired
         * detail is exercised here. Every formatting branch stays pinned in the
         * pure Node `annotationGeometry` gate. The legend toggles are read back
         * through the module-level helpers above.
         */
        function measurableCanvas(): HTMLCanvasElement {
            const graphic = screen.getByRole("img", {
                name: "lead-a time series, unit mV",
            });
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
                    right: 200,
                    bottom: 100,
                    width: 200,
                    height: 100,
                    toJSON: () => ({}),
                }) as DOMRect;
            return surface;
        }

        it("shows the idle annotation detail until a marker is hovered", () => {
            render(TimeSeriesView, {
                props: {
                    signal: makeSignal(),
                    annotations: makeAnnotations([[2, "A"]]),
                },
            });

            expect(detailLine()).toBe("Annotation: \u2014");
        });

        it("names the hovered annotation's own symbol and auxNote in the detail line", async () => {
            render(TimeSeriesView, {
                props: {
                    signal: makeSignal(),
                    annotations: [annotated(2, "A", "premature beat")],
                },
            });
            const surface = measurableCanvas();

            // Sample 2 of the 8-sample, 4 s record sits at 1 s -> x fraction
            // 0.25 -> 50 px of the stubbed 200 px plot.
            await fireEvent.pointerMove(surface, { clientX: 50, clientY: 50 });

            expect(detailLine()).toBe(
                "Annotation: A \u00b7 sample 2 \u00b7 premature beat",
            );
        });

        it("offers the window's distinct symbols as legend toggles", () => {
            render(TimeSeriesView, {
                props: {
                    signal: makeSignal(),
                    annotations: makeAnnotations([
                        [0, "N"],
                        [2, "A"],
                        [6, "V"],
                    ]),
                },
            });

            expect(legendSymbols()).toEqual(["A", "N", "V"]);
            expect(pressedSymbols()).toEqual([]);
        });

        it("narrows the summary to a pressed symbol, keeping every toggle", async () => {
            render(TimeSeriesView, {
                props: {
                    signal: makeSignal(),
                    annotations: makeAnnotations([
                        [0, "N"],
                        [2, "A"],
                        [6, "V"],
                    ]),
                },
            });

            await fireEvent.click(legendToggle("A"));

            expect(screen.getByText("Annotations: 1 in view")).toBeTruthy();
            expect(pressedSymbols()).toEqual(["A"]);
            // Toggles still come from the unfiltered window, so a selection can
            // never hide its own off-switch.
            expect(legendSymbols()).toEqual(["A", "N", "V"]);
        });

        it("returns to the whole window when the pressed symbol is toggled off", async () => {
            render(TimeSeriesView, {
                props: {
                    signal: makeSignal(),
                    annotations: makeAnnotations([
                        [0, "N"],
                        [2, "A"],
                    ]),
                },
            });

            await fireEvent.click(legendToggle("A"));
            expect(screen.getByText("Annotations: 1 in view")).toBeTruthy();

            await fireEvent.click(legendToggle("A"));

            expect(screen.getByText("Annotations: 2 in view")).toBeTruthy();
            expect(pressedSymbols()).toEqual([]);
            expect(legendSymbols()).toEqual(["A", "N"]);
        });
    });

    describe("multi-symbol legend selection (Phase 17 item 2)", () => {
        /**
         * The selection is a SET with the empty set meaning "All symbols": each
         * toggle adds or removes its own symbol, the summary counts the union
         * of the pressed toggles, and the toggle set is always derived from the
         * UNFILTERED window so a selection cannot hide its off-switch. Display
         * only — nothing is detected and nothing is re-analysed.
         */
        it("shows the union of several pressed symbols, in window order", async () => {
            render(TimeSeriesView, {
                props: {
                    signal: makeSignal(),
                    annotations: makeAnnotations([
                        [0, "N"],
                        [2, "A"],
                        [6, "V"],
                    ]),
                },
            });

            await fireEvent.click(legendToggle("V"));
            await fireEvent.click(legendToggle("A"));

            // The pressed order (V then A) never leaks into what is drawn: the
            // effective selection stays in the window's own ascending order.
            expect(pressedSymbols()).toEqual(["A", "V"]);
            expect(screen.getByText("Annotations: 2 in view")).toBeTruthy();
        });

        it("counts every event whose symbol is pressed, however many", async () => {
            render(TimeSeriesView, {
                props: {
                    signal: makeSignal(),
                    annotations: makeAnnotations([
                        [0, "N"],
                        [1, "N"],
                        [2, "A"],
                        [6, "V"],
                    ]),
                },
            });

            await fireEvent.click(legendToggle("N"));
            expect(screen.getByText("Annotations: 2 in view")).toBeTruthy();

            await fireEvent.click(legendToggle("V"));
            expect(screen.getByText("Annotations: 3 in view")).toBeTruthy();
        });

        it("keeps every window symbol on offer whichever are pressed", async () => {
            render(TimeSeriesView, {
                props: {
                    signal: makeSignal(),
                    annotations: makeAnnotations([
                        [0, "N"],
                        [2, "A"],
                        [6, "V"],
                    ]),
                },
            });

            await fireEvent.click(legendToggle("A"));

            expect(legendSymbols()).toEqual(["A", "N", "V"]);
        });

        it("reports no symbol as pressed while the selection is empty (All)", () => {
            render(TimeSeriesView, {
                props: {
                    signal: makeSignal(),
                    annotations: makeAnnotations([
                        [0, "N"],
                        [2, "A"],
                    ]),
                },
            });

            expect(pressedSymbols()).toEqual([]);
            expect(screen.getByText("Annotations: 2 in view")).toBeTruthy();
        });
    });

    describe("bounded annotation list panel (Phase 17 item 3)", () => {
        /**
         * The panel lists the SAME filtered in-window events the canvas draws,
         * ascending by sample and capped at `ANNOTATION_LIST_LIMIT`. jsdom can
         * only prove the wiring: the rows mirror the selection, a row click
         * pins that row's own event through the SAME pin cell the canvas click
         * sets, and the caption states the bound. Every number and string
         * branch stays pinned in the pure Node `annotationGeometry` gate.
         */
        function longSignal(sampleCount: number): Signal {
            return {
                id: "test/long",
                channels: [
                    {
                        name: "lead-a",
                        unit: "mV",
                        data: new Float64Array(sampleCount),
                    },
                ],
                sampling: SAMPLING,
                provenance: { transforms: [] },
            };
        }

        it("lists one row per in-window event, naming its symbol, sample and note", () => {
            render(TimeSeriesView, {
                props: {
                    signal: makeSignal(),
                    annotations: [
                        annotated(0, "N", ""),
                        annotated(2, "A", "premature beat"),
                    ],
                },
            });

            expect(annotationRowLabels()).toEqual([
                "Annotation: N \u00b7 sample 0",
                "Annotation: A \u00b7 sample 2 \u00b7 premature beat",
            ]);
            expect(annotationCaption()).toBe("2 in view");
        });

        it("lists only the visible window's own events", () => {
            render(TimeSeriesView, {
                props: {
                    signal: makeSignal(),
                    annotations: [
                        annotated(0, "N", ""),
                        annotated(2, "A", "premature beat"),
                    ],
                    // 1 s of the 4 s record is samples [0, 2): the half-open
                    // end excludes the sample-2 event, exactly as the overlay
                    // and the density-capped marker mapping do.
                    viewport: { startSec: 0, durationSec: 1 },
                },
            });

            expect(annotationRowLabels()).toEqual([
                "Annotation: N \u00b7 sample 0",
            ]);
            expect(annotationCaption()).toBe("1 in view");
        });

        it("pins a clicked row's own event through the shared pin, committing no viewport", async () => {
            const committed: TimeViewport[] = [];
            render(TimeSeriesView, {
                props: {
                    signal: makeSignal(),
                    annotations: [
                        annotated(0, "N", ""),
                        annotated(2, "A", "premature beat"),
                    ],
                    onViewportCommit: (next: TimeViewport): void => {
                        committed.push(next);
                    },
                },
            });

            expect(detailLine()).toBe("Annotation: \u2014");

            const [, second] = annotationRows();
            if (second === undefined) {
                throw new Error("expected a second annotation list row");
            }
            await fireEvent.click(second);

            // A row is a DOM control, not a canvas gesture: it reuses the
            // Phase-15 pin cell and commits no window.
            expect(detailLine()).toBe(
                "Annotation: A \u00b7 sample 2 \u00b7 premature beat",
            );
            expect(second.getAttribute("aria-current")).toBe("true");
            expect(annotationRows()[0]?.getAttribute("aria-current")).toBeNull();
            expect(committed).toEqual([]);
        });

        it("shrinks the list to the symbol selection the legend drives", async () => {
            render(TimeSeriesView, {
                props: {
                    signal: makeSignal(),
                    annotations: [
                        annotated(0, "N", ""),
                        annotated(2, "A", "premature beat"),
                        annotated(6, "V", ""),
                    ],
                },
            });

            expect(annotationRowLabels()).toHaveLength(3);

            await fireEvent.click(legendToggle("N"));

            expect(annotationRowLabels()).toEqual([
                "Annotation: N \u00b7 sample 0",
            ]);
            expect(annotationCaption()).toBe("1 in view");
        });

        it("states an empty window plainly, with no rows", () => {
            render(TimeSeriesView, {
                props: { signal: makeSignal(), annotations: [] },
            });

            expect(annotationRows()).toEqual([]);
            expect(annotationCaption()).toBe("No annotations in view");
        });

        it("caps the rows at the limit and says how many are in view", () => {
            const total = ANNOTATION_LIST_LIMIT + 5;
            const annotations = Array.from({ length: total }, (_, index) =>
                annotated(index, "N", ""),
            );
            render(TimeSeriesView, {
                props: { signal: longSignal(total + 10), annotations },
            });

            expect(annotationRows()).toHaveLength(ANNOTATION_LIST_LIMIT);
            expect(annotationCaption()).toBe(
                `Showing first ${ANNOTATION_LIST_LIMIT} of ${total} in view`,
            );
        });
    });

    describe("bounded click-to-pin (Phase 15 item 4)", () => {
        /**
         * A press and release at one point is a *click* (a display selection,
         * no commit); a press moved across the plot before release is still a
         * *drag* (one window commit, the Phase-13 behaviour). jsdom cannot
         * measure layout, so the stubbed rect is what makes the gesture split
         * observable at all.
         */
        function measurableCanvas(): HTMLCanvasElement {
            const graphic = screen.getByRole("img", {
                name: "lead-a time series, unit mV",
            });
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
                    right: 200,
                    bottom: 100,
                    width: 200,
                    height: 100,
                    toJSON: () => ({}),
                }) as DOMRect;
            return surface;
        }

        /** Record every committed window so a click can be shown to commit none. */
        function commitRecorder(): {
            readonly committed: TimeViewport[];
            readonly onCommit: (next: TimeViewport) => void;
        } {
            const committed: TimeViewport[] = [];
            return {
                committed,
                onCommit: (next: TimeViewport): void => {
                    committed.push(next);
                },
            };
        }

        it("pins a clicked marker's detail and commits no viewport", async () => {
            const recorder = commitRecorder();
            render(TimeSeriesView, {
                props: {
                    signal: makeSignal(),
                    annotations: [annotated(2, "A", "premature beat")],
                    onViewportCommit: recorder.onCommit,
                },
            });
            const surface = measurableCanvas();

            // Sample 2 of the 8-sample, 4 s record sits at 1 s -> x fraction
            // 0.25 -> 50 px of the stubbed 200 px plot.
            await fireEvent.pointerDown(surface, { clientX: 50, clientY: 50 });
            await fireEvent.pointerUp(surface, { clientX: 50, clientY: 50 });

            expect(detailLine()).toBe(
                "Annotation: A \u00b7 sample 2 \u00b7 premature beat",
            );
            // A click selects for display; it is never the implicit zero-width
            // zoom of Phase 13, and it never moves the cursor readout either.
            expect(screen.getByText("Cursor: \u2014")).toBeTruthy();
            expect(recorder.committed).toEqual([]);
        });

        it("still commits exactly one window for a drag, leaving the detail idle", async () => {
            const recorder = commitRecorder();
            render(TimeSeriesView, {
                props: {
                    signal: makeSignal(),
                    annotations: makeAnnotations([]),
                    onViewportCommit: recorder.onCommit,
                },
            });
            const surface = measurableCanvas();

            await fireEvent.pointerDown(surface, { clientX: 20, clientY: 50 });
            await fireEvent.pointerMove(surface, { clientX: 120, clientY: 50 });
            await fireEvent.pointerUp(surface, { clientX: 120, clientY: 50 });

            // x fraction 0.10 -> 0.60 of a 4 s record = the 2 s window
            // [0.40 s, 2.40 s], committed once through the single commit path.
            expect(recorder.committed).toHaveLength(1);
            expect(recorder.committed[0]?.startSec).toBeCloseTo(0.4, 6);
            expect(recorder.committed[0]?.durationSec).toBeCloseTo(2, 6);
            expect(detailLine()).toBe("Annotation: \u2014");
        });

        it("clears the pin when a later click lands clear of every marker", async () => {
            render(TimeSeriesView, {
                props: {
                    signal: makeSignal(),
                    annotations: [annotated(0, "N", "")],
                },
            });
            const surface = measurableCanvas();

            await fireEvent.pointerDown(surface, { clientX: 1, clientY: 50 });
            await fireEvent.pointerUp(surface, { clientX: 1, clientY: 50 });
            expect(detailLine()).toBe("Annotation: N \u00b7 sample 0");

            // x fraction 0.50 is half a plot away from the only marker.
            await fireEvent.pointerDown(surface, { clientX: 100, clientY: 50 });
            await fireEvent.pointerUp(surface, { clientX: 100, clientY: 50 });

            expect(detailLine()).toBe("Annotation: \u2014");
        });

        it("keeps the pinned detail after the pointer leaves, while the cursor goes idle", async () => {
            render(TimeSeriesView, {
                props: {
                    signal: makeSignal(),
                    annotations: [annotated(2, "A", "premature beat")],
                },
            });
            const surface = measurableCanvas();

            await fireEvent.pointerDown(surface, { clientX: 50, clientY: 50 });
            await fireEvent.pointerUp(surface, { clientX: 50, clientY: 50 });
            await fireEvent.pointerMove(surface, { clientX: 50, clientY: 50 });
            await fireEvent.pointerLeave(surface);

            // The pin outlives the pointer; the cursor readout does not.
            expect(detailLine()).toBe(
                "Annotation: A \u00b7 sample 2 \u00b7 premature beat",
            );
            expect(screen.getByText("Cursor: \u2014")).toBeTruthy();
        });

        it("drops a pinned detail once the symbol filter excludes its marker", async () => {
            render(TimeSeriesView, {
                props: {
                    signal: makeSignal(),
                    annotations: [
                        annotated(0, "N", ""),
                        annotated(2, "A", "premature beat"),
                    ],
                },
            });
            const surface = measurableCanvas();

            await fireEvent.pointerDown(surface, { clientX: 50, clientY: 50 });
            await fireEvent.pointerUp(surface, { clientX: 50, clientY: 50 });
            expect(detailLine()).toBe(
                "Annotation: A \u00b7 sample 2 \u00b7 premature beat",
            );

            await fireEvent.click(legendToggle("N"));

            // The overlay no longer draws the pinned marker, so the detail must
            // not keep describing it: the caption never exceeds what is drawn.
            expect(detailLine()).toBe("Annotation: \u2014");
        });

        it("keeps the pin while the pointer hovers elsewhere, and the cursor keeps tracking", async () => {
            render(TimeSeriesView, {
                props: {
                    signal: makeSignal(),
                    annotations: [annotated(2, "A", "premature beat")],
                },
            });
            const surface = measurableCanvas();

            await fireEvent.pointerDown(surface, { clientX: 50, clientY: 50 });
            await fireEvent.pointerUp(surface, { clientX: 50, clientY: 50 });

            // Half a plot away from the pinned marker: the cursor readout
            // follows the pointer while the pinned detail stays put. A pin held
            // as anything but the record's own event would silently stop
            // matching the drawn list right here.
            await fireEvent.pointerMove(surface, { clientX: 150, clientY: 50 });

            expect(detailLine()).toBe(
                "Annotation: A \u00b7 sample 2 \u00b7 premature beat",
            );
            expect(
                screen.getByText("Cursor: 3.00 s \u00b7 sample 6"),
            ).toBeTruthy();
            expect(screen.queryByText(/nearest/)).toBeNull();
        });
    });
});
