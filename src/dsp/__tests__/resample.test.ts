import { describe, expect, it } from 'vitest';
import {
    createSamplingInfo,
    createSignal,
    EcgError,
    type Signal,
} from '../../domain';
import { estimateFrequencyHzZeroCrossing } from '../../fixtures/measure';
import { resampleSignal, type ResamplingSpec } from '../resample';
import { maxAbs, rms } from './support';

const FS = 360;

function toneSignal(
    fs: number,
    frequencyHz: number,
    seconds: number,
    startTimeSec = 0,
): Signal {
    const n = Math.round(fs * seconds);
    const data = new Float64Array(n);
    const omega = (2 * Math.PI * frequencyHz) / fs;
    for (let i = 0; i < n; i += 1) {
        data[i] = Math.sin(omega * i);
    }
    return createSignal({
        id: `tone-${fs}-${frequencyHz}hz`,
        channels: [{ name: 'lead', unit: 'mV', data }],
        sampling: createSamplingInfo(fs, startTimeSec),
    });
}

function constantSignal(fs: number, seconds: number, value: number): Signal {
    const data = new Float64Array(Math.round(fs * seconds));
    data.fill(value);
    return createSignal({
        id: `const-${fs}`,
        channels: [{ name: 'lead', unit: 'mV', data }],
        sampling: createSamplingInfo(fs),
    });
}

/** Interior copy of a signal's data, excluding the resampler edge margins. */
function interior(values: ArrayLike<number>, keepFraction: number): Float64Array {
    const n = values.length;
    const from = Math.floor((n * (1 - keepFraction)) / 2);
    const to = n - from;
    const out = new Float64Array(to - from);
    for (let i = from; i < to; i += 1) {
        out[i - from] = values[i]!;
    }
    return out;
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

describe('band-limited upsampling', () => {
    it('360 -> 720 Hz: doubles the sample count, preserves a 1 Hz tone and start time', () => {
        const source = toneSignal(FS, 1, 10, 1.25);
        const out = resampleSignal(source, 720);

        expect(out.sampling.sampleRateHz).toBe(720);
        expect(out.sampling.startTimeSec).toBe(1.25);
        expect(out.channels[0]!.unit).toBe('mV');
        const data = out.channels[0]!.data;
        expect(data.length).toBe(3600 * 2); // exact doubling

        const mid = interior(data, 0.5);
        expect(estimateFrequencyHzZeroCrossing(mid, 720)).toBeCloseTo(1, 2);
        // Interior covers whole cycles: RMS of a unit sine is 1/sqrt(2).
        expect(rms(data, 1800, 5400)).toBeCloseTo(Math.SQRT1_2, 2);
    });
});

describe('band-limited downsampling', () => {
    it('360 -> 180 Hz: halves the sample count and preserves a 1 Hz tone', () => {
        const source = toneSignal(FS, 1, 10);
        const out = resampleSignal(source, 180);

        expect(out.sampling.sampleRateHz).toBe(180);
        const data = out.channels[0]!.data;
        expect(data.length).toBe(3600 / 2); // exact halving

        const mid = interior(data, 0.5);
        expect(estimateFrequencyHzZeroCrossing(mid, 180)).toBeCloseTo(1, 2);
        expect(rms(data, 450, 1350)).toBeCloseTo(Math.SQRT1_2, 2);
    });
});

describe('DC and energy are preserved', () => {
    it('upsampling and downsampling keep a constant exactly (window normalisation)', () => {
        for (const [target, expectedLength] of [
            [720, 7200],
            [180, 1800],
        ] as const) {
            const source = constantSignal(FS, 10, 0.5);
            const out = resampleSignal(source, target);
            expect(out.channels[0]!.data.length).toBe(expectedLength);
            expect(
                maxAbs(
                    out.channels[0]!.data,
                    0,
                    out.channels[0]!.data.length,
                ),
            ).toBeCloseTo(0.5, 9);
        }
    });
});

describe('edge mode and determinism', () => {
    it('defaults to reflect and equals an explicit reflect spec', () => {
        const source = toneSignal(FS, 1, 10);
        const reflectExplicit = resampleSignal(source, 720, { edgeMode: 'reflect' });
        const defaultSpec = resampleSignal(source, 720);
        expect(defaultSpec.channels[0]!.data).toEqual(
            reflectExplicit.channels[0]!.data,
        );
    });

    it('zero edge mode also runs and produces a finite interior', () => {
        const source = toneSignal(FS, 1, 10);
        const out = resampleSignal(source, 720, { edgeMode: 'zero' });
        const data = out.channels[0]!.data;
        for (let i = 0; i < data.length; i += 1) {
            expect(Number.isFinite(data[i]!)).toBe(true);
        }
        expect(rms(data, 1800, 5400)).toBeCloseTo(Math.SQRT1_2, 1);
    });

    it('is deterministic and does not mutate the input', () => {
        const source = toneSignal(FS, 1, 10);
        const before = new Float64Array(source.channels[0]!.data);
        const a = resampleSignal(source, 500);
        const b = resampleSignal(source, 500);
        expect(a.channels[0]!.data).toEqual(b.channels[0]!.data);
        expect(source.channels[0]!.data).toEqual(before);
    });

    it('records resampling parameters in provenance', () => {
        const source = toneSignal(FS, 1, 10);
        const out = resampleSignal(source, 500, { kernelRadiusSamples: 12 });
        const step = out.provenance.transforms[out.provenance.transforms.length - 1]!;
        expect(step.name).toBe('resample-500hz');
        expect(step.parameters).toMatchObject({
            fromHz: 360,
            toHz: 500,
            ratio: 500 / 360,
            kernelRadiusSamples: 12,
            edgeMode: 'reflect',
        });
        expect(out.id).toContain('resample-500hz');
    });
});

describe('validation', () => {
    const source = toneSignal(FS, 1, 10);

    it('rejects non-positive and non-finite target rates', () => {
        throwsCode(() => resampleSignal(source, 0), 'invalid-input');
        throwsCode(() => resampleSignal(source, -100), 'invalid-input');
        throwsCode(() => resampleSignal(source, Number.NaN), 'invalid-input');
        throwsCode(() => resampleSignal(source, Infinity), 'invalid-input');
    });

    it('rejects kernel radii below 2 or non-integral', () => {
        throwsCode(
            () => resampleSignal(source, 720, { kernelRadiusSamples: 1 }),
            'invalid-input',
        );
        throwsCode(
            () => resampleSignal(source, 720, { kernelRadiusSamples: 2.5 }),
            'invalid-input',
        );
    });

    it('rejects unknown edge modes', () => {
        throwsCode(
            () =>
                resampleSignal(source, 720, {
                    edgeMode: 'nearest' as ResamplingSpec['edgeMode'],
                }),
            'invalid-input',
        );
    });
});
