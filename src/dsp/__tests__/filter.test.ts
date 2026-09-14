import { describe, expect, it } from 'vitest';
import { EcgError } from '../../domain';
import { generateSignal } from '../../fixtures/signals';
import { filterSignal, designFirFilter, type FilterSpec } from '../filter';
import {
    bestLagSamples,
    channelOf,
    constantChannel,
    mean,
    toneChannel,
    wrapSignal,
} from './support';

const FS = 360;
const N = 3600;
const TAPS = 101;
const M = (TAPS - 1) / 2; // group delay in samples

/** Single-frequency amplitude estimate over an analysis window. */
function amplitudeAt(
    data: ArrayLike<number>,
    fs: number,
    freqHz: number,
    from: number,
    to: number,
): number {
    let re = 0;
    let im = 0;
    for (let i = from; i < to; i += 1) {
        const phase = (2 * Math.PI * freqHz * i) / fs;
        re += data[i]! * Math.cos(phase);
        im += data[i]! * Math.sin(phase);
    }
    const count = to - from;
    return (2 * Math.sqrt(re * re + im * im)) / count;
}

/** Whole-number-of-cycles analysis window well inside the record. */
function analysisWindow(fs: number, freqHz: number, n: number): { from: number; to: number } {
    const period = Math.round(fs / freqHz);
    const margin = 4 * TAPS;
    const from = Math.max(0, margin);
    const maxCycles = Math.floor((n - 2 * margin) / period);
    return { from, to: from + maxCycles * period };
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

const lowpassSpec = (phase: FilterSpec['phaseCharacteristic']): FilterSpec => ({
    type: 'lowpass',
    cutoffHz: 40,
    numTaps: TAPS,
    phaseCharacteristic: phase,
    purpose: 'test lowpass',
});

describe('filter design validation', () => {
    it('requires an odd tap count >= 5', () => {
        throwsCode(
            () => designFirFilter({ ...lowpassSpec('forward'), numTaps: 40 }, FS),
            'invalid-input',
        );
        throwsCode(
            () => designFirFilter({ ...lowpassSpec('forward'), numTaps: 3 }, FS),
            'invalid-input',
        );
    });

    it('rejects cutoffs outside (0, fs/2)', () => {
        throwsCode(
            () => designFirFilter({ ...lowpassSpec('forward'), cutoffHz: 0 }, FS),
            'invalid-input',
        );
        throwsCode(
            () => designFirFilter({ ...lowpassSpec('forward'), cutoffHz: 180 }, FS),
            'invalid-input',
        );
        throwsCode(
            () => designFirFilter({ ...lowpassSpec('forward'), cutoffHz: 200 }, FS),
            'invalid-input',
        );
    });

    it('rejects unordered bandpass cutoffs', () => {
        throwsCode(
            () =>
                designFirFilter(
                    {
                        ...lowpassSpec('forward'),
                        type: 'bandpass',
                        cutoffHz: [20, 5],
                    },
                    FS,
                ),
            'invalid-input',
        );
    });
});

describe('lowpass windowed-sinc (forward)', () => {
    it('passes an in-band tone and stops an out-of-band tone', () => {
        const inBand = wrapSignal(toneChannel(FS, 3, 1, N), FS);
        const outBand = wrapSignal(toneChannel(FS, 90, 1, N), FS);

        const passOut = filterSignal(inBand, lowpassSpec('forward'));
        const stopOut = filterSignal(outBand, lowpassSpec('forward'));

        const winPass = analysisWindow(FS, 3, N);
        const winStop = analysisWindow(FS, 90, N);
        const gainPass =
            amplitudeAt(channelOf(passOut), FS, 3, winPass.from, winPass.to) /
            amplitudeAt(channelOf(inBand), FS, 3, winPass.from, winPass.to);
        const gainStop =
            amplitudeAt(channelOf(stopOut), FS, 90, winStop.from, winStop.to) /
            amplitudeAt(channelOf(outBand), FS, 90, winStop.from, winStop.to);

        expect(gainPass).toBeGreaterThan(0.97);
        expect(gainPass).toBeLessThan(1.03);
        expect(gainStop).toBeLessThan(0.02);
    });

    it('has the expected integer group delay (linear phase)', () => {
        const signal = wrapSignal(toneChannel(FS, 20, 1, N), FS);
        const out = filterSignal(signal, lowpassSpec('forward'));
        const outData = channelOf(out);
        const inData = channelOf(signal);
        const win = analysisWindow(FS, 20, N);
        const candidates: number[] = [];
        for (let lag = M - 3; lag <= M + 3; lag += 1) {
            candidates.push(lag);
        }
        const { lag } = bestLagSamples(
            outData,
            inData,
            win.from,
            win.to,
            candidates,
        );
        expect(lag).toBe(M);
    });
});

describe('zero-phase (filtfilt) lowpass', () => {
    it('introduces no group delay on an in-band tone', () => {
        const signal = wrapSignal(toneChannel(FS, 20, 1, N), FS);
        const out = filterSignal(signal, lowpassSpec('zero'));
        const outData = channelOf(out);
        const inData = channelOf(signal);
        const win = analysisWindow(FS, 20, N);
        const candidates = [-2, -1, 0, 1, 2];
        const { lag } = bestLagSamples(
            outData,
            inData,
            win.from,
            win.to,
            candidates,
        );
        expect(lag).toBe(0);
    });

    it('still stops an out-of-band tone', () => {
        const signal = wrapSignal(toneChannel(FS, 90, 1, N), FS);
        const out = filterSignal(signal, lowpassSpec('zero'));
        const win = analysisWindow(FS, 90, N);
        const gain =
            amplitudeAt(channelOf(out), FS, 90, win.from, win.to) /
            amplitudeAt(channelOf(signal), FS, 90, win.from, win.to);
        expect(gain).toBeLessThan(0.001);
    });
});

describe('highpass (baseline removal)', () => {
    const hpSpec: FilterSpec = {
        type: 'highpass',
        cutoffHz: 0.5,
        numTaps: TAPS,
        phaseCharacteristic: 'forward',
        purpose: 'test baseline removal',
    };

    it('removes a DC/constant offset', () => {
        const signal = wrapSignal(constantChannel(N, 0.5), FS);
        const out = filterSignal(signal, hpSpec);
        // Interior mean is ~0 (filter has exactly zero DC gain).
        expect(Math.abs(mean(channelOf(out), 200, N - 200))).toBeLessThan(1e-9);
    });

    it('passes an above-cutoff tone', () => {
        const signal = wrapSignal(toneChannel(FS, 30, 0.4, N), FS);
        const out = filterSignal(signal, hpSpec);
        const win = analysisWindow(FS, 30, N);
        const gain =
            amplitudeAt(channelOf(out), FS, 30, win.from, win.to) /
            amplitudeAt(channelOf(signal), FS, 30, win.from, win.to);
        expect(gain).toBeGreaterThan(0.97);
        expect(gain).toBeLessThan(1.03);
    });
});

describe('bandpass windowed-sinc', () => {
    const bpSpec: FilterSpec = {
        type: 'bandpass',
        cutoffHz: [8, 45],
        numTaps: TAPS,
        phaseCharacteristic: 'forward',
        purpose: 'test bandpass',
    };

    it('passes a mid-band tone', () => {
        const signal = wrapSignal(toneChannel(FS, 20, 0.5, N), FS);
        const out = filterSignal(signal, bpSpec);
        const win = analysisWindow(FS, 20, N);
        const gain =
            amplitudeAt(channelOf(out), FS, 20, win.from, win.to) /
            amplitudeAt(channelOf(signal), FS, 20, win.from, win.to);
        expect(gain).toBeGreaterThan(0.9);
        expect(gain).toBeLessThan(1.1);
    });

    it('rejects DC and an out-of-band tone', () => {
        const dc = wrapSignal(constantChannel(N, 0.5), FS);
        const dcOut = filterSignal(dc, bpSpec);
        expect(Math.abs(mean(channelOf(dcOut), 200, N - 200))).toBeLessThan(1e-9);

        const tone = wrapSignal(toneChannel(FS, 90, 0.5, N), FS);
        const toneOut = filterSignal(tone, bpSpec);
        const win = analysisWindow(FS, 90, N);
        const gain =
            amplitudeAt(channelOf(toneOut), FS, 90, win.from, win.to) /
            amplitudeAt(channelOf(tone), FS, 90, win.from, win.to);
        expect(gain).toBeLessThan(0.05);
    });
});

describe('filterSignal hygiene', () => {
    it('does not mutate its input and preserves unit, rate and provenance', () => {
        const original = wrapSignal(toneChannel(FS, 3, 1, N), FS);
        const before = new Float64Array(channelOf(original));
        const spec = lowpassSpec('zero');
        const out = filterSignal(original, spec);

        expect(channelOf(original)).toEqual(before);
        expect(out.sampling.sampleRateHz).toBe(FS);
        expect(out.sampling.startTimeSec).toBe(original.sampling.startTimeSec);
        expect(out.channels[0]!.unit).toBe(original.channels[0]!.unit);
        expect(out.channels[0]!.data.length).toBe(N);

        const transforms = out.provenance.transforms;
        expect(transforms).toHaveLength(original.provenance.transforms.length + 1);
        const last = transforms[transforms.length - 1]!;
        expect(last.name).toContain('filter-lowpass');
        expect(last.parameters).toMatchObject({ numTaps: TAPS, sampleRateHz: FS });
    });

    it('is deterministic: same input and spec produce identical taps and output', () => {
        const signal = wrapSignal(toneChannel(FS, 3, 1, N), FS);
        const spec = lowpassSpec('zero');
        const a = designFirFilter(spec, FS);
        const b = designFirFilter(spec, FS);
        expect(a.coefficients).toEqual(b.coefficients);
        expect(channelOf(filterSignal(signal, spec))).toEqual(
            channelOf(filterSignal(signal, spec)),
        );
    });
});

describe('fixture regression through DSP', () => {
    it('passes the committed sine-1 fixture through a zero-phase low-pass with ~unity in-band gain', () => {
        // Regenerate in memory from the canonical recipe (matches the
        // committed golden fixture), then push it through a zero-phase 40 Hz
        // low-pass. A 1 Hz tone sits deep in the pass-band, so the whole
        // committed record should emerge with ~unity gain — a wiring
        // regression proving committed fixtures flow through the DSP stack
        // with sampling, unit and provenance intact. (A 1 Hz tone cannot be
        // separated from DC by a low-order band-pass whose lower edge is at
        // 0.5 Hz; near-DC cutoffs need very high order, which is a filter
        // design concern covered by the dedicated suites, not this pipeline
        // regression.)
        const recipe = {
            kind: 'sine' as const,
            sampleRateHz: 360,
            length: 3600,
            amplitude: 1.0,
            frequencyHz: 1,
            phaseRad: 0,
            offset: 0,
        };
        const samples = generateSignal(recipe);
        const signal = wrapSignal(samples, 360);
        const spec: FilterSpec = {
            type: 'lowpass',
            cutoffHz: 40,
            numTaps: TAPS,
            phaseCharacteristic: 'zero',
            purpose: 'fixture regression low-pass',
        };
        const out = filterSignal(signal, spec);
        const win = analysisWindow(360, 1, 3600);
        const gain =
            amplitudeAt(channelOf(out), 360, 1, win.from, win.to) /
            amplitudeAt(channelOf(signal), 360, 1, win.from, win.to);
        expect(gain).toBeGreaterThan(0.97);
        expect(gain).toBeLessThan(1.03);
        expect(out.sampling.sampleRateHz).toBe(signal.sampling.sampleRateHz);
        expect(out.sampling.startTimeSec).toBe(signal.sampling.startTimeSec);
        expect(out.channels[0]!.unit).toBe(signal.channels[0]!.unit);
    });
});
