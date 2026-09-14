<script lang="ts">
    // Canvas DWT coefficient view (Phase 7 item #10).
    //
    // Renders ONE channel of a `WaveletDecomposition` as stacked coefficient
    // lanes on a <canvas>, driven entirely by domain/DSP types:
    //
    // - the lane order is finest detail (level 1) at the top down to the final
    //   approximation at the bottom, following `DwtChannelDecomposition`;
    // - every lane is placed on the source signal's own time axis: coefficient
    //   index -> original sample via `coefficientStrideSamples`, then the
    //   domain's sample -> seconds conversion — no arithmetic is re-implemented
    //   here (all of it lives in `./coefficientGeometry.ts`);
    // - the octave frequency band shown per lane is derived ONLY from the
    //   sample rate and the level and is flagged approximate (ADR-003) — the
    //   legend and captions say so and never make a clinical-band claim;
    // - coefficient `Float64Array`s are only ever READ (never written): each
    //   lane is decimated to one min/max column per x pixel.
    //
    // The view is display-only: it owns no science configuration and calls no
    // service. The parent decides which decomposition/channel/viewport to show
    // — item #11 wires those choices as interaction controls.
    import type {
        DwtChannelDecomposition,
        WaveletDecomposition,
    } from "../../../dsp/dwt/dwt";
    import type { SamplingInfo } from "../../../domain/sampling";
    import { durationSecOf, timeSecOfSample } from "../../../domain/sampling";
    import {
        sampleWindowOfTime,
        type TimeViewport,
    } from "../timeSeries/geometry";
    import {
        approximationFrequencyBandHz,
        coefficientAmplitudeBounds,
        coefficientEnvelopeColumns,
        coefficientIndexRangeOfWindow,
        coefficientStrideSamples,
        detailFrequencyBandHz,
        formatFrequencyHz,
        type FrequencyBandHz,
    } from "./coefficientGeometry";

    interface Props {
        /** Full decomposition to read a channel from; never mutated. */
        decomposition: WaveletDecomposition;
        /** Channel to draw; defaults to the decomposition's first channel. */
        channelName?: string;
        /** Visible source-time window; defaults to the full record. */
        viewport?: TimeViewport;
        /** Canvas pixel width. */
        width?: number;
        /** Canvas pixel height. */
        height?: number;
    }

    let {
        decomposition,
        channelName,
        viewport,
        width = 720,
        height = 240,
    }: Props = $props();

    const LANE_COLORS: readonly string[] = [
        "#2563eb",
        "#0ea5e9",
        "#06b6d4",
        "#10b981",
        "#f59e0b",
    ];

    interface LaneRow {
        readonly name: string;
        readonly level: number;
        readonly data: Float64Array;
        readonly band: FrequencyBandHz;
        readonly color: string;
    }

    let canvas = $state<HTMLCanvasElement | undefined>(undefined);

    let channel = $derived.by((): DwtChannelDecomposition | null => {
        const named =
            channelName === undefined
                ? undefined
                : decomposition.channels.find(
                      (candidate) => candidate.channelName === channelName,
                  );
        return named ?? decomposition.channels[0] ?? null;
    });

    let sampling = $derived<SamplingInfo>(decomposition.sampling);
    let sampleRateHz = $derived(sampling.sampleRateHz);
    let sourceLengthSamples = $derived(decomposition.sourceLengthSamples);

    let lanes = $derived.by((): LaneRow[] => {
        if (channel === null) {
            return [];
        }
        const rows: LaneRow[] = [];
        channel.detailLevels.forEach((band, index) => {
            rows.push({
                name: `Level ${band.level} detail`,
                level: band.level,
                data: band.detail,
                band: detailFrequencyBandHz(band.level, sampleRateHz),
                color:
                    LANE_COLORS[index % LANE_COLORS.length] ?? LANE_COLORS[0]!,
            });
        });
        rows.push({
            name: "Approximation",
            level: decomposition.level,
            data: channel.approximate,
            band: approximationFrequencyBandHz(
                decomposition.level,
                sampleRateHz,
            ),
            color:
                LANE_COLORS[rows.length % LANE_COLORS.length] ??
                LANE_COLORS[0]!,
        });
        return rows;
    });

    let resolvedViewport = $derived.by((): TimeViewport | null => {
        if (viewport !== undefined) {
            return viewport;
        }
        if (channel === null) {
            return null;
        }
        return {
            startSec: sampling.startTimeSec,
            durationSec: durationSecOf(sourceLengthSamples, sampleRateHz),
        };
    });

    let visibleStartSec = $derived(
        resolvedViewport === null ? 0 : resolvedViewport.startSec,
    );
    let visibleEndSec = $derived(
        resolvedViewport === null
            ? 0
            : resolvedViewport.startSec + resolvedViewport.durationSec,
    );

    let windowText = $derived(
        resolvedViewport === null
            ? ""
            : `t = ${visibleStartSec.toFixed(2)} s \u2192 ${visibleEndSec.toFixed(2)} s`,
    );
    let sourceText = $derived(
        channel === null
            ? ""
            : `Source: ${sourceLengthSamples} samples at ${sampleRateHz} Hz`,
    );

    $effect(() => {
        const surface = canvas;
        if (surface === undefined) {
            return;
        }
        if (
            channel === null ||
            resolvedViewport === null ||
            lanes.length === 0
        ) {
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
        drawLanes(
            context,
            sampling,
            sourceLengthSamples,
            resolvedViewport,
            lanes,
            width,
            height,
        );
    });

    /** Draw all stacked lanes over the whole surface. Read-only on the data. */
    function drawLanes(
        context: CanvasRenderingContext2D,
        samplingInfo: SamplingInfo,
        recordSamples: number,
        view: TimeViewport,
        rows: readonly LaneRow[],
        pixelWidth: number,
        pixelHeight: number,
    ): void {
        context.clearRect(0, 0, pixelWidth, pixelHeight);
        const sampleWindow = sampleWindowOfTime(
            view,
            samplingInfo,
            recordSamples,
        );
        if (
            rows.length === 0 ||
            sampleWindow.endSample <= sampleWindow.startSample
        ) {
            return;
        }
        context.fillStyle = "#fbfcfe";
        context.fillRect(0, 0, pixelWidth, pixelHeight);

        const laneHeight = pixelHeight / rows.length;
        rows.forEach((row, rowIndex) => {
            const top = rowIndex * laneHeight;
            drawLane(
                context,
                row,
                rowIndex,
                top,
                laneHeight,
                samplingInfo,
                view,
                sampleWindow,
                pixelWidth,
            );
            if (rowIndex < rows.length - 1) {
                context.strokeStyle = "#cbd2d9";
                context.lineWidth = 1;
                context.beginPath();
                context.moveTo(0, top + laneHeight + 0.5);
                context.lineTo(pixelWidth, top + laneHeight + 0.5);
                context.stroke();
            }
        });
    }

    /** Decimate one coefficient lane and draw its min/max envelope. */
    function drawLane(
        context: CanvasRenderingContext2D,
        row: LaneRow,
        rowIndex: number,
        top: number,
        laneHeight: number,
        samplingInfo: SamplingInfo,
        view: TimeViewport,
        sampleWindow: ReturnType<typeof sampleWindowOfTime>,
        pixelWidth: number,
    ): void {
        if (rowIndex % 2 === 1) {
            context.fillStyle = "#f1f4f8";
            context.fillRect(0, top, pixelWidth, laneHeight);
        }

        const stride = coefficientStrideSamples(row.level);
        const range = coefficientIndexRangeOfWindow(
            sampleWindow,
            row.level,
            row.data.length,
        );
        const columns = coefficientEnvelopeColumns(
            row.data,
            range,
            Math.max(1, Math.floor(pixelWidth)),
        );
        const bounds = coefficientAmplitudeBounds(columns);

        if (!bounds.populated) {
            drawLaneLabel(context, row, top, pixelWidth);
            return;
        }

        const domain = paddedDomain(bounds);
        const xOfTime = (timeSec: number): number =>
            ((timeSec - view.startSec) / view.durationSec) * pixelWidth;
        const yOfValue = (value: number): number => {
            const fraction = (value - domain.min) / (domain.max - domain.min);
            return top + laneHeight * (1 - fraction);
        };

        if (domain.min < 0 && domain.max > 0) {
            context.strokeStyle = "#d7dde3";
            context.lineWidth = 1;
            context.beginPath();
            context.moveTo(0, yOfValue(0));
            context.lineTo(pixelWidth, yOfValue(0));
            context.stroke();
        }

        context.strokeStyle = row.color;
        context.lineWidth = 1;
        context.beginPath();
        for (const column of columns) {
            if (!column.populated) {
                continue;
            }
            // Column bounds are coefficient indices; multiply by the stride to
            // land back on the original sample grid shared by every lane.
            const leftTime = timeSecOfSample(
                column.startSample * stride,
                samplingInfo,
            );
            const rightTime = timeSecOfSample(
                column.endSample * stride,
                samplingInfo,
            );
            const x = xOfTime((leftTime + rightTime) / 2);
            context.moveTo(x + 0.5, yOfValue(column.max));
            context.lineTo(x + 0.5, yOfValue(column.min));
        }
        context.stroke();

        drawLaneLabel(context, row, top, pixelWidth);
    }

    function drawLaneLabel(
        context: CanvasRenderingContext2D,
        row: LaneRow,
        top: number,
        pixelWidth: number,
    ): void {
        context.fillStyle = "#5a6470";
        context.font = "11px system-ui, sans-serif";
        context.textAlign = "left";
        context.fillText(row.name, 6, top + 13);
        context.textAlign = "right";
        context.fillText(describeBand(row, false), pixelWidth - 6, top + 13);
        context.textAlign = "left";
    }

    /** Expand the visible min/max into a padded drawing domain (never empty). */
    function paddedDomain(bounds: {
        readonly min: number;
        readonly max: number;
    }): {
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

    /** "≈ low-high Hz" (short) or "≈ low-high Hz · N coefficients" (legend). */
    function describeBand(row: LaneRow, withCount: boolean): string {
        const bandText =
            `\u2248 ${formatFrequencyHz(row.band.lowHz)}-` +
            `${formatFrequencyHz(row.band.highHz)} Hz`;
        return withCount
            ? `${bandText} \u00b7 ${row.data.length} coefficients`
            : bandText;
    }
</script>

{#if channel === null || lanes.length === 0}
    <p class="view-status" role="status">
        No channel available to render the DWT coefficient view.
    </p>
{:else}
    <figure class="dwt-view">
        <canvas aria-hidden="true" bind:this={canvas} {width} {height}></canvas>
        <figcaption>
            <span class="dwt-title">{channel.channelName}</span>
            <span class="dwt-kind">DWT coefficients</span>
            <span class="dwt-source">{sourceText}</span>
            <span class="dwt-window">{windowText}</span>
        </figcaption>
    </figure>
    <ol class="dwt-legend" aria-label="DWT coefficient bands (approximate)">
        {#each lanes as lane (lane.name)}
            <li>
                <span class="lane-name">{lane.name}</span>
                <span class="lane-band">{describeBand(lane, true)}</span>
            </li>
        {/each}
    </ol>
    <p class="dwt-note">
        Band frequencies are derived from the sample rate and level and are
        approximate (ADR-003) &mdash; not clinical-band claims.
    </p>
{/if}

<style>
    .dwt-view {
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

    .dwt-title {
        font-weight: 700;
        color: #0b2a47;
    }

    .dwt-legend {
        margin: 0.5rem 0 0;
        padding: 0.4rem 0.6rem;
        list-style: none;
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem 1rem;
        font-size: 0.8rem;
        color: #3c4650;
        border-left: 3px solid #cbd2d9;
    }

    .dwt-legend .lane-name {
        font-weight: 600;
        color: #0b2a47;
    }

    .dwt-legend .lane-band {
        margin-left: 0.35rem;
        color: #5a6470;
    }

    .dwt-note {
        margin: 0.4rem 0 0;
        font-size: 0.8rem;
        font-style: italic;
        color: #5a6470;
    }

    .view-status {
        font-style: italic;
        color: #5a6470;
    }
</style>
