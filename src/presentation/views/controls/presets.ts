/**
 * Viewport presets for the interaction controls (Phase 7 item #11).
 *
 * The channel + viewport controls in `ViewControls.svelte` are thin: they only
 * pick which *channel* and which *time window* the already-analyzed
 * `AnalysisResult` is drawn with. These helpers build the selectable viewport
 * options from the signal's own `SamplingInfo` and sample count — never from a
 * hardcoded duration or science configuration. Every duration/edge conversion
 * goes through the domain (`src/domain/sampling.ts`, `durationSecOf`), so this
 * module only *slices* the acquisition window into presentation presets:
 *
 * - index 0 is always the whole acquisition window ("Full record");
 * - the following `segmentCount` options tile that window contiguously (equal
 *   sub-windows), so choosing one just narrows the visible time axis.
 *
 * The views then map each preset's time edges onto samples with their own
 * window helpers; this module never does sample arithmetic.
 */

import { EcgError } from '../../../domain/error';
import type { SamplingInfo } from '../../../domain/sampling';
import { durationSecOf } from '../../../domain/sampling';
import type { TimeViewport } from '../timeSeries/geometry';

/** One selectable viewport: the control shows `label`, the view draws `viewport`. */
export interface ViewportOption {
    readonly label: string;
    readonly viewport: TimeViewport;
}

/** How many equal sub-windows (besides the full record) a preset list offers. */
export const DEFAULT_VIEWPORT_SEGMENTS = 4;

/**
 * Build the ordered list of viewport presets for a record: the full acquisition
 * window followed by `segmentCount` contiguous sub-windows of equal duration.
 *
 * Returns an empty list when the record has no samples (nothing to zoom into).
 * Rejects an invalid segment count and lets `durationSecOf` reject an invalid
 * sample count / sample rate (domain validation, never re-implemented).
 */
export function viewportPresets(
    sampling: SamplingInfo,
    sampleCount: number,
    segmentCount: number = DEFAULT_VIEWPORT_SEGMENTS,
): readonly ViewportOption[] {
    if (!Number.isSafeInteger(segmentCount) || segmentCount <= 0) {
        throw EcgError.invalidInput(
            `Viewport segment count must be a positive safe integer, received ${String(segmentCount)}.`,
        );
    }
    if (sampleCount === 0) {
        return [];
    }
    const totalDurationSec = durationSecOf(sampleCount, sampling.sampleRateHz);
    if (!(totalDurationSec > 0)) {
        return [];
    }

    const full: ViewportOption = {
        label: 'Full record',
        viewport: {
            startSec: sampling.startTimeSec,
            durationSec: totalDurationSec,
        },
    };

    const options: ViewportOption[] = [full];
    const segmentDurationSec = totalDurationSec / segmentCount;
    for (let index = 1; index <= segmentCount; index += 1) {
        const startSec = sampling.startTimeSec + (index - 1) * segmentDurationSec;
        const endSec = startSec + segmentDurationSec;
        options.push({
            label: `${startSec.toFixed(2)}\u2013${endSec.toFixed(2)} s`,
            viewport: { startSec, durationSec: segmentDurationSec },
        });
    }
    return options;
}
