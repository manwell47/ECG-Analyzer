// @vitest-environment jsdom
/**
 * Canvas DWT coefficient view smoke slice (Phase 7 item #10).
 *
 * jsdom has no real 2d context, so `getContext("2d")` returns null and the
 * component deliberately degrades to markup-only. These tests assert the
 * markup surface a user sees (channel title, source/window caption, the stacked
 * per-lane legend with approximate octave bands + coefficient counts) and that
 * the view mounts safely without a canvas implementation. They never assert on
 * drawn pixels — the band/stride/decimation correctness is the pure Node
 * `coefficientGeometry.test.ts` gate.
 *
 * Fixture: fs = 8 Hz, 64 source samples, level 3, two channels. After `j`
 * levels a band holds 64 / 2^j coefficients, and each band spans 2^j original
 * samples. Approximate octave bands (ADR-003, fs/level derivation only):
 *   Level 1 detail [2, 4) Hz -> 32 coefficients (2-4 Hz)
 *   Level 2 detail [1, 2) Hz -> 16 coefficients (1-2 Hz)
 *   Level 3 detail [0.5, 1) Hz -> 8 coefficients (0.5-1 Hz)
 *   Approximation [0, 0.5) Hz -> 8 coefficients (0-0.5 Hz)
 */

import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import DwtCoefficientView from "../DwtCoefficientView.svelte";
import type {
    DwtChannelDecomposition,
    DwtChannelLevel,
    WaveletDecomposition,
} from "../../../../dsp/dwt/dwt";
import { createSamplingInfo } from "../../../../domain/sampling";

const SAMPLING = createSamplingInfo(8, 0);
const SOURCE_LENGTH_SAMPLES = 64;
const LEVEL = 3;

/** Deterministic coefficient buffer; only lengths are read by the view. */
function filled(length: number): Float64Array {
    const values = new Float64Array(length);
    for (let index = 0; index < length; index++) {
        values[index] = index % 2 === 0 ? 1.5 : -1.5;
    }
    return values;
}

function detailLevel(level: number): DwtChannelLevel {
    return { level, detail: filled(SOURCE_LENGTH_SAMPLES / 2 ** level) };
}

function makeChannel(channelName: string): DwtChannelDecomposition {
    return {
        channelName,
        unit: "mV",
        detailLevels: [detailLevel(1), detailLevel(2), detailLevel(3)],
        approximate: filled(SOURCE_LENGTH_SAMPLES / 2 ** LEVEL),
    };
}

function makeDecomposition(): WaveletDecomposition {
    return {
        signalId: "test/ecg",
        signalProvenance: { transforms: [] },
        sampling: SAMPLING,
        sourceLengthSamples: SOURCE_LENGTH_SAMPLES,
        waveletName: "db4",
        level: LEVEL,
        extensionMode: "periodic",
        channels: [makeChannel("lead-a"), makeChannel("lead-b")],
    };
}

describe("DwtCoefficientView (jsdom slice)", () => {
    beforeEach(() => {
        // jsdom ships no canvas implementation; stubbing getContext to return
        // null runs the component's guarded, markup-only path without jsdom
        // printing "Not implemented" virtual-console noise on every mount.
        HTMLCanvasElement.prototype.getContext = () => null;
    });

    afterEach(() => {
        cleanup();
    });

    it("renders the default first channel with captions and the full lane legend", () => {
        render(DwtCoefficientView, {
            props: { decomposition: makeDecomposition() },
        });

        // The figure carries the caption text; the canvas is the decorative
        // drawing surface inside it (default = first channel).
        const figure = screen.getByText("lead-a").closest("figure");
        expect(figure).toBeTruthy();
        expect(figure?.querySelector("canvas")).toBeTruthy();

        expect(screen.getByText("DWT coefficients")).toBeTruthy();
        expect(screen.getByText("Source: 64 samples at 8 Hz")).toBeTruthy();
        // Full-record default viewport: [0, 8.00) s at 8 Hz over 64 samples.
        expect(screen.getByText("t = 0.00 s \u2192 8.00 s")).toBeTruthy();

        // Finest detail (level 1) is listed first; the approximation is last.
        expect(screen.getByText("Level 1 detail")).toBeTruthy();
        expect(screen.getByText("Level 2 detail")).toBeTruthy();
        expect(screen.getByText("Level 3 detail")).toBeTruthy();
        expect(screen.getByText("Approximation")).toBeTruthy();

        // Approximate fs/level octave bands with per-lane coefficient counts.
        expect(screen.getByText("\u2248 2-4 Hz \u00b7 32 coefficients")).toBeTruthy();
        expect(screen.getByText("\u2248 1-2 Hz \u00b7 16 coefficients")).toBeTruthy();
        expect(screen.getByText("\u2248 0.5-1 Hz \u00b7 8 coefficients")).toBeTruthy();
        expect(screen.getByText("\u2248 0-0.5 Hz \u00b7 8 coefficients")).toBeTruthy();
    });

    it("selects the requested channel by name", () => {
        render(DwtCoefficientView, {
            props: { decomposition: makeDecomposition(), channelName: "lead-b" },
        });

        expect(screen.getByText("lead-b")).toBeTruthy();
        expect(screen.queryByText("lead-a")).toBeNull();
    });

    it("falls back to the first channel for an unknown channel name", () => {
        render(DwtCoefficientView, {
            props: {
                decomposition: makeDecomposition(),
                channelName: "does-not-exist",
            },
        });

        expect(screen.getByText("lead-a")).toBeTruthy();
        expect(screen.queryByText("lead-b")).toBeNull();
    });

    it("honours an explicit viewport in the caption window", () => {
        render(DwtCoefficientView, {
            props: {
                decomposition: makeDecomposition(),
                viewport: { startSec: 2, durationSec: 2 },
            },
        });

        // [2.00, 4.00) s of the 64-sample / 8 Hz source record.
        expect(screen.getByText("t = 2.00 s \u2192 4.00 s")).toBeTruthy();
        expect(screen.getByText("Source: 64 samples at 8 Hz")).toBeTruthy();
    });

    it("renders a status instead of a canvas when the decomposition has no channels", () => {
        const empty: WaveletDecomposition = {
            ...makeDecomposition(),
            channels: [],
        };
        render(DwtCoefficientView, { props: { decomposition: empty } });

        expect(
            screen.getByText("No channel available to render the DWT coefficient view."),
        ).toBeTruthy();
        expect(screen.queryByText("DWT coefficients")).toBeNull();
    });
});
