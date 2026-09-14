import { describe, expect, it } from 'vitest';
import {
    createSamplingInfo,
    createSignal,
    EcgError,
    type Signal,
} from '../../domain';
import { segmentSignal, type RemainderPolicy } from '../segment';

function indexedSignal(lengthSamples: number, channelCount: number): Signal {
    const channels: Array<{ name: string; unit: 'mV'; data: Float64Array }> = [];
    for (let c = 0; c < channelCount; c += 1) {
        const data = new Float64Array(lengthSamples);
        // Each sample's value encodes its own index, so window contents can be
        // asserted against the source position.
        for (let i = 0; i < lengthSamples; i += 1) {
            data[i] = i;
        }
        channels.push({ name: `ch${c}`, unit: 'mV', data });
    }
    return createSignal({
        id: 'seg-indexed',
        channels,
        sampling: createSamplingInfo(360),
    });
}

function throwsCode(fn: () => unknown, code: string): void {
    let caught: unknown;
    try {
        fn();
    } catch (error) {
        caught = error;
    }
    expect(caught).toBeInstanceOf(EcgError);
    expect((caught as EcgError).code).toBe(code);
}

describe('validation', () => {
    const signal = indexedSignal(360, 1);

    it('rejects non-positive or non-integral window and stride lengths', () => {
        throwsCode(
            () =>
                segmentSignal(signal, {
                    windowLengthSamples: 0,
                    strideSamples: 64,
                    remainderPolicy: 'drop',
                }),
            'invalid-input',
        );
        throwsCode(
            () =>
                segmentSignal(signal, {
                    windowLengthSamples: 128,
                    strideSamples: 0,
                    remainderPolicy: 'drop',
                }),
            'invalid-input',
        );
        throwsCode(
            () =>
                segmentSignal(signal, {
                    windowLengthSamples: 2.5,
                    strideSamples: 64,
                    remainderPolicy: 'drop',
                }),
            'invalid-input',
        );
    });

    it('rejects unknown remainder policies', () => {
        throwsCode(
            () =>
                segmentSignal(signal, {
                    windowLengthSamples: 128,
                    strideSamples: 64,
                    remainderPolicy: 'none' as RemainderPolicy,
                }),
            'invalid-input',
        );
    });
});

describe('drop remainder policy', () => {
    it('drops the short tail and reports exactly how many samples were dropped', () => {
        // 360 samples, window 128, stride 64:
        // full windows at 0, 64, 128, 192; the next start (256) would need
        // samples up to 384 > 360, so the tail of 360 - 256 = 104 is dropped.
        const result = segmentSignal(indexedSignal(360, 1), {
            windowLengthSamples: 128,
            strideSamples: 64,
            remainderPolicy: 'drop',
        });

        expect(result.windows).toHaveLength(4);
        expect(result.fullWindowCount).toBe(4);
        expect(result.paddedWindowCount).toBe(0);
        expect(result.droppedRemainderSamples).toBe(104);
        expect(result.signalId).toBe('seg-indexed');
        expect(result.windowLengthSamples).toBe(128);
        expect(result.strideSamples).toBe(64);

        const starts = result.windows.map((w) => w.startSample);
        expect(starts).toEqual([0, 64, 128, 192]);

        for (const w of result.windows) {
            expect(w.channelIndex).toBe(0);
            expect(w.lengthSamples).toBe(128);
            expect(w.sourceSampleCount).toBe(128);
            expect(w.isPartial).toBe(false);
            // data[k] should equal source sample index startSample + k.
            for (let k = 0; k < w.lengthSamples; k += 1) {
                expect(w.data[k]).toBe(w.startSample + k);
            }
        }
    });

    it('leaves nothing to drop when the record divides evenly', () => {
        const result = segmentSignal(indexedSignal(400, 1), {
            windowLengthSamples: 100,
            strideSamples: 100,
            remainderPolicy: 'drop',
        });
        expect(result.fullWindowCount).toBe(4);
        expect(result.droppedRemainderSamples).toBe(0);
        expect(result.windows).toHaveLength(4);
        expect(result.windows.map((w) => w.startSample)).toEqual([
            0, 100, 200, 300,
        ]);
    });
});

describe('pad-zero remainder policy', () => {
    it('keeps the short tail zero-padded to the full window length', () => {
        // 360 samples, window 128, stride 128: full windows at 0 and 128, then
        // a partial window starting at 256 holding 360 - 256 = 104 real samples.
        const result = segmentSignal(indexedSignal(360, 1), {
            windowLengthSamples: 128,
            strideSamples: 128,
            remainderPolicy: 'pad-zero',
        });

        expect(result.windows).toHaveLength(3);
        expect(result.fullWindowCount).toBe(2);
        expect(result.paddedWindowCount).toBe(1);
        expect(result.droppedRemainderSamples).toBe(0);

        const partial = result.windows[2]!;
        expect(partial.startSample).toBe(256);
        expect(partial.isPartial).toBe(true);
        expect(partial.lengthSamples).toBe(128);
        expect(partial.sourceSampleCount).toBe(104);
        for (let k = 0; k < partial.sourceSampleCount; k += 1) {
            expect(partial.data[k]).toBe(256 + k);
        }
        for (let k = partial.sourceSampleCount; k < 128; k += 1) {
            expect(partial.data[k]).toBe(0);
        }

        // Full windows carry no padding.
        for (let i = 0; i < 2; i += 1) {
            expect(result.windows[i]!.isPartial).toBe(false);
            expect(result.windows[i]!.sourceSampleCount).toBe(128);
        }
    });
});

describe('error remainder policy', () => {
    it('throws when any trailing remainder would arise', () => {
        throwsCode(
            () =>
                segmentSignal(indexedSignal(360, 1), {
                    windowLengthSamples: 128,
                    strideSamples: 128,
                    remainderPolicy: 'error',
                }),
            'invalid-input',
        );
    });

    it('succeeds when the record divides evenly', () => {
        const result = segmentSignal(indexedSignal(400, 1), {
            windowLengthSamples: 100,
            strideSamples: 100,
            remainderPolicy: 'error',
        });
        expect(result.fullWindowCount).toBe(4);
        expect(result.droppedRemainderSamples).toBe(0);
    });
});

describe('multi-channel segmentation and immutability', () => {
    it('segments every channel and tags each window with its channel', () => {
        const result = segmentSignal(indexedSignal(360, 2), {
            windowLengthSamples: 128,
            strideSamples: 64,
            remainderPolicy: 'drop',
        });
        // 4 full windows per channel (see the single-channel drop test).
        expect(result.fullWindowCount).toBe(8);
        expect(result.windows).toHaveLength(8);

        const byChannel = result.windows.slice(0, 4).map((w) => w.channelIndex);
        expect(byChannel).toEqual([0, 0, 0, 0]);
        const secondChannel = result.windows.slice(4, 8).map((w) => w.channelIndex);
        expect(secondChannel).toEqual([1, 1, 1, 1]);

        // Both channels start at the same sample offsets.
        const offsets = [0, 64, 128, 192];
        result.windows.slice(0, 4).forEach((w, i) => {
            expect(w.startSample).toBe(offsets[i]);
        });
        result.windows.slice(4, 8).forEach((w, i) => {
            expect(w.startSample).toBe(offsets[i]);
        });
    });

    it('copies window data and never mutates the source signal', () => {
        const source = indexedSignal(360, 1);
        const before = new Float64Array(source.channels[0]!.data);
        const result = segmentSignal(source, {
            windowLengthSamples: 128,
            strideSamples: 64,
            remainderPolicy: 'drop',
        });

        expect(source.channels[0]!.data).toEqual(before);

        // Mutating a returned window must not affect the source buffer.
        const w0 = result.windows[0]!;
        expect(w0.data).not.toBe(source.channels[0]!.data);
        w0.data.fill(-999);
        expect(source.channels[0]!.data[0]).toBe(0);
        expect(source.channels[0]!.data[127]).toBe(127);
    });
});
