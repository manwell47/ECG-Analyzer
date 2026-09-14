import { describe, expect, it } from 'vitest';
import { basicStats, estimateFrequencyHzZeroCrossing } from '../measure';
import {
    FIXTURE_SAMPLE_RATE_HZ,
    generateSignal,
    type SignalRecipe,
} from '../signals';

function sum(samples: Float64Array): number {
    let total = 0;
    for (let i = 0; i < samples.length; i += 1) {
        total += samples[i]!;
    }
    return total;
}

/** Number of contiguous regions where the signal exceeds `level`. */
function countRegionsAbove(samples: Float64Array, level: number): number {
    let regions = samples[0]! >= level ? 1 : 0;
    for (let i = 1; i < samples.length; i += 1) {
        if (samples[i - 1]! < level && samples[i]! >= level) {
            regions += 1;
        }
    }
    return regions;
}

describe('determinism', () => {
    const recipes: readonly SignalRecipe[] = [
        { kind: 'impulse', sampleRateHz: 360, length: 100, amplitude: 1, atIndex: 4 },
        { kind: 'constant', sampleRateHz: 360, length: 100, offset: 0.5 },
        { kind: 'sine', sampleRateHz: 360, length: 721, amplitude: 1, frequencyHz: 1 },
        {
            kind: 'multi-frequency',
            sampleRateHz: 360,
            length: 720,
            amplitudes: [1, 0.5],
            frequenciesHz: [1, 2],
        },
        { kind: 'chirp', sampleRateHz: 360, length: 720, amplitude: 1, f0Hz: 0.5, f1Hz: 10 },
        { kind: 'noise', sampleRateHz: 360, length: 512, std: 0.05, seed: 1 },
        { kind: 'synthetic-ecg', sampleRateHz: 360, length: 720, heartRateBpm: 60, amplitude: 1 },
    ];

    it('regenerates identical samples for identical recipes', () => {
        for (const recipe of recipes) {
            expect(generateSignal(recipe)).toEqual(generateSignal(recipe));
        }
    });

    it('rejects recipes whose declared properties cannot be honoured', () => {
        expect(() =>
            generateSignal({ kind: 'impulse', sampleRateHz: 360, length: 8, amplitude: 1, atIndex: 8 }),
        ).toThrow();
        expect(() =>
            generateSignal({ kind: 'noise', sampleRateHz: 360, length: 8, std: 0.05 }),
        ).toThrow(); // seed required
        expect(() =>
            generateSignal({ kind: 'sine', sampleRateHz: 0, length: 8, amplitude: 1, frequencyHz: 1 }),
        ).toThrow();
    });
});

describe('impulse fixture property', () => {
    it('places a single peak of the requested amplitude at the requested index', () => {
        const samples = generateSignal({
            kind: 'impulse',
            sampleRateHz: FIXTURE_SAMPLE_RATE_HZ,
            length: 720,
            amplitude: 1.0,
            atIndex: 5,
        });
        const stats = basicStats(samples);
        expect(stats.max).toBe(1.0);
        expect(stats.min).toBe(0);
        expect(stats.peakAbsIndex).toBe(5);
        expect(stats.peakAbsValue).toBe(1.0);
        expect(stats.mean).toBeCloseTo(1 / 720, 12);
        expect(sum(samples)).toBeCloseTo(1, 12);
        expect(samples[5]).toBe(1.0);
        expect(samples[4]).toBe(0);
        expect(samples[6]).toBe(0);
    });
});

describe('constant fixture property', () => {
    it('is flat at the requested DC level', () => {
        const samples = generateSignal({
            kind: 'constant',
            sampleRateHz: FIXTURE_SAMPLE_RATE_HZ,
            length: 360,
            offset: 0.5,
        });
        const stats = basicStats(samples);
        expect(stats.min).toBe(0.5);
        expect(stats.max).toBe(0.5);
        expect(stats.mean).toBe(0.5);
        expect(stats.rms).toBe(0.5);
        expect(sum(samples)).toBeCloseTo(0.5 * 360, 12);
    });
});

describe('sine fixture property', () => {
    const recipe: SignalRecipe = {
        kind: 'sine',
        sampleRateHz: FIXTURE_SAMPLE_RATE_HZ,
        // Exactly 10 whole cycles at 1 Hz (no clipped boundary cycle).
        length: 3600,
        amplitude: 1.0,
        frequencyHz: 1,
        phaseRad: 0,
        offset: 0,
    };

    it('has the claimed RMS (A/sqrt(2)) over whole cycles', () => {
        const samples = generateSignal(recipe);
        const stats = basicStats(samples);
        expect(stats.rms).toBeCloseTo(1 / Math.sqrt(2), 6);
    });

    it('measures back at the claimed fundamental frequency', () => {
        const samples = generateSignal(recipe);
        const measured = estimateFrequencyHzZeroCrossing(
            samples,
            FIXTURE_SAMPLE_RATE_HZ,
        );
        expect(measured).toBeCloseTo(1, 6);
    });

    it('is bounded by the amplitude', () => {
        const samples = generateSignal(recipe);
        const stats = basicStats(samples);
        expect(stats.max).toBeLessThanOrEqual(1 + 1e-9);
        expect(stats.min).toBeGreaterThanOrEqual(-1 - 1e-9);
        expect(stats.peakAbsValue).toBeCloseTo(1, 6);
    });
});

describe('multi-frequency fixture property', () => {
    it('has RMS sqrt(sum(a_i^2)/2) over whole cycles of all tones', () => {
        const samples = generateSignal({
            kind: 'multi-frequency',
            sampleRateHz: FIXTURE_SAMPLE_RATE_HZ,
            length: 3600,
            amplitudes: [1.0, 0.5, 0.25],
            frequenciesHz: [1, 3, 5],
        });
        const stats = basicStats(samples);
        const expectedRms = Math.sqrt(
            (1.0 * 1.0 + 0.5 * 0.5 + 0.25 * 0.25) / 2,
        );
        expect(stats.rms).toBeCloseTo(expectedRms, 4);
        expect(stats.peakAbsValue).toBeLessThanOrEqual(1.0 + 0.5 + 0.25);
    });
});

describe('chirp fixture property', () => {
    it('sweeps within the declared amplitude envelope', () => {
        const samples = generateSignal({
            kind: 'chirp',
            sampleRateHz: FIXTURE_SAMPLE_RATE_HZ,
            length: 3600,
            amplitude: 1.0,
            f0Hz: 0.5,
            f1Hz: 20,
        });
        const stats = basicStats(samples);
        expect(stats.max).toBeLessThanOrEqual(1 + 1e-9);
        expect(stats.min).toBeGreaterThanOrEqual(-1 - 1e-9);
        // A well-sampled chirp reaches near the full unit amplitude somewhere.
        expect(stats.peakAbsValue).toBeGreaterThan(0.9);
    });
});

describe('noise fixture property', () => {
    it('has near-zero mean and RMS close to the requested std', () => {
        const samples = generateSignal({
            kind: 'noise',
            sampleRateHz: FIXTURE_SAMPLE_RATE_HZ,
            length: 2048,
            std: 0.05,
            seed: 20260903,
        });
        const stats = basicStats(samples);
        expect(Math.abs(stats.mean)).toBeLessThan(0.005);
        expect(stats.rms).toBeCloseTo(0.05, 2);
        expect(Number.isFinite(stats.peakAbsValue)).toBe(true);
    });
});

describe('synthetic-ecg fixture property', () => {
    it('places one R peak per beat at the declared heart rate', () => {
        const fs = FIXTURE_SAMPLE_RATE_HZ;
        const heartRateBpm = 60;
        const rrSamples = Math.round((fs * 60) / heartRateBpm); // 360
        const samples = generateSignal({
            kind: 'synthetic-ecg',
            sampleRateHz: fs,
            length: 2160,
            heartRateBpm,
            amplitude: 1.0,
        });
        const stats = basicStats(samples);
        // R-peak dominates the morphology → peak is the R amplitude at a beat center.
        expect(stats.peakAbsValue).toBeCloseTo(1.0, 3);
        expect(stats.peakAbsIndex % rrSamples).toBe(0);
        // 6 s at 60 bpm = 6 beats; each beat's R complex rises once above 0.5
        // (the first beat starts at a peak, so count its already-above region).
        expect(countRegionsAbove(samples, 0.5)).toBe(6);
    });
});
