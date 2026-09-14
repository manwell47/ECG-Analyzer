/**
 * Phase-3 DSP — deterministic windowing / segmentation.
 *
 * Rationale (architecture §G.4 and §E.3):
 * - `Window` boundaries are expressed in **explicit integer sample indices**
 *   (startSample / lengthSamples), never seconds (architecture §177).
 * - Segmentation is deterministic and *nothing is silently discarded*: the
 *   result reports exactly how many trailing samples were dropped or, when the
 *   policy is `pad-zero`, materialises a final zero-padded partial window that
 *   records how many of its samples are real.
 * - Windows are produced per channel (each carries `channelIndex`); the sample
 *   data is copied so no window aliases the source signal's buffers (ADR-001
 *   immutability-by-convention, ADR-002 "never mutates inputs").
 */

import { EcgError, type Signal } from '../domain';

export type RemainderPolicy = 'drop' | 'pad-zero' | 'error';

export interface WindowConfig {
    /** Length of every returned window in samples (>= 1). */
    readonly windowLengthSamples: number;
    /** Advance between window starts in samples (>= 1). */
    readonly strideSamples: number;
    /**
     * What to do with the final, short window at the end of a record:
     * - `drop`     — discard it, but report `droppedRemainderSamples`.
     * - `pad-zero` — keep it, zero-padded to the full length (`isPartial`).
     * - `error`    — throw if any trailing remainder would arise.
     */
    readonly remainderPolicy: RemainderPolicy;
}

export interface SignalWindow {
    /** Channel this window belongs to (index into the source signal). */
    readonly channelIndex: number;
    /** First sample of the window in the source channel. */
    readonly startSample: number;
    /** Window length in samples (always `windowLengthSamples`). */
    readonly lengthSamples: number;
    /**
     * True only for the final window when `remainderPolicy === 'pad-zero'`
     * created it from a short tail.
     */
    readonly isPartial: boolean;
    /** Source samples actually present in this window (== length unless partial). */
    readonly sourceSampleCount: number;
    /** Snapshot copy of the samples (unit of the source channel). */
    readonly data: Float64Array;
}

export interface SegmentationResult {
    readonly signalId: string;
    readonly windowLengthSamples: number;
    readonly strideSamples: number;
    /** Windows across all channels (filter by `channelIndex` to isolate one). */
    readonly windows: readonly SignalWindow[];
    readonly fullWindowCount: number;
    readonly paddedWindowCount: number;
    /** Trailing samples left after the last full window on each channel (0 when `pad-zero`). */
    readonly droppedRemainderSamples: number;
}

function requirePositiveInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw EcgError.invalidInput(
            `Expected ${label} to be a positive safe integer, received ` +
            `${String(value)}.`,
        );
    }
}

/**
 * Segment every channel of `signal` into windows of a fixed sample length and
 * stride. Returns per-channel windows (flat list with `channelIndex`); see
 * {@link SegmentationResult}. The source signal is not modified.
 */
export function segmentSignal(
    signal: Signal,
    config: WindowConfig,
): SegmentationResult {
    requirePositiveInteger(config.windowLengthSamples, 'windowLengthSamples');
    requirePositiveInteger(config.strideSamples, 'strideSamples');
    if (
        config.remainderPolicy !== 'drop' &&
        config.remainderPolicy !== 'pad-zero' &&
        config.remainderPolicy !== 'error'
    ) {
        throw EcgError.invalidInput(
            `Unsupported remainderPolicy ${JSON.stringify(config.remainderPolicy)}; ` +
            'expected "drop", "pad-zero" or "error".',
        );
    }

    const width = config.windowLengthSamples;
    const stride = config.strideSamples;
    const windows: SignalWindow[] = [];
    let fullWindowCount = 0;
    let paddedWindowCount = 0;
    let droppedRemainderSamples = 0;

    for (let c = 0; c < signal.channels.length; c += 1) {
        const channel = signal.channels[c]!;
        const data = channel.data;
        const n = data.length;

        let start = 0;
        while (start < n) {
            const end = start + width;
            if (end <= n) {
                // Full window.
                const dataCopy = data.slice(start, end);
                windows.push({
                    channelIndex: c,
                    startSample: start,
                    lengthSamples: width,
                    isPartial: false,
                    sourceSampleCount: width,
                    data: dataCopy,
                });
                fullWindowCount += 1;
                start += stride;
                continue;
            }

            // Short tail.
            const sourceCount = n - start;
            if (config.remainderPolicy === 'drop') {
                droppedRemainderSamples += sourceCount;
                break;
            }
            if (config.remainderPolicy === 'error') {
                throw EcgError.invalidInput(
                    `Segmentation leaves a trailing remainder of ${sourceCount} ` +
                    `sample(s) on channel "${channel.name}" (window ${width}, ` +
                    `stride ${stride}, length ${n}); remainderPolicy is "error".`,
                );
            }
            // pad-zero: keep the tail, padded to the full window length.
            const padded = new Float64Array(width);
            for (let i = 0; i < sourceCount; i += 1) {
                padded[i] = data[start + i]!;
            }
            windows.push({
                channelIndex: c,
                startSample: start,
                lengthSamples: width,
                isPartial: true,
                sourceSampleCount: sourceCount,
                data: padded,
            });
            paddedWindowCount += 1;
            break;
        }
    }

    return {
        signalId: signal.id,
        windowLengthSamples: width,
        strideSamples: stride,
        windows,
        fullWindowCount,
        paddedWindowCount,
        droppedRemainderSamples,
    };
}
