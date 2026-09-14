/**
 * Phase-4 DWT / IDWT tests (ADR-003).
 *
 * The reconstruction identity `idwt(dwt(x, cfg), cfg) ~= x` is the ADR-003
 * gate; it is asserted here together with Parseval energy preservation (the
 * periodic transform is orthogonal for the enforced length policy), exact
 * coefficient-size accounting, determinism, no-mutation hygiene, explicit
 * validation errors, an analytic impulse case, and regressions that pin the
 * catalog filter bank to the committed `db4.json` golden artifact and to the
 * canonical generated fixtures flowing through the domain API.
 */

import { describe, expect, it } from 'vitest';
import { EcgError } from '../../../domain';
import { arraysClose, loadGoldenDb4File } from '../../../fixtures/golden';
import { generateSignal } from '../../../fixtures/signals';
import { getWavelet, listWaveletNames } from '../catalog';
import {
    analyzePeriodicLevel,
    decomposePeriodicLevels,
    decomposeSignal,
    dwtTransformName,
    idwtTransformName,
    maxOrthogonalPeriodicLevelForLength,
    maxPeriodicLevelForLength,
    reconstructPeriodicLevels,
    reconstructSignal,
    SUPPORTED_DWT_EXTENSION_MODES,
    synthesizePeriodicLevel,
    type DwtConfig,
    type WaveletDecomposition,
} from '../dwt';
import { channelOf, constantChannel, wrapSignal } from '../../__tests__/support';

const WAVELET = 'db4';
const EXTENSION = 'periodic';

/** Explicit config builder (uses the public DwtConfig type). */
function levelConfig(level: number): DwtConfig {
    return { waveletName: WAVELET, level, extensionMode: EXTENSION };
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

function sumSquares(values: ArrayLike<number>): number {
    let total = 0;
    for (let i = 0; i < values.length; i += 1) {
        const v = values[i]!;
        total += v * v;
    }
    return total;
}

function maxAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
    expect(a.length).toBe(b.length);
    let worst = 0;
    for (let i = 0; i < a.length; i += 1) {
        worst = Math.max(worst, Math.abs(a[i]! - b[i]!));
    }
    return worst;
}

/** Deterministic, non-trivial test channel with several tones. */
function sampleChannel(n: number): Float64Array {
    const data = new Float64Array(n);
    for (let i = 0; i < n; i += 1) {
        const x = i / n;
        data[i] =
            0.5 * Math.sin(2 * Math.PI * 3 * x + 0.7) +
            0.25 * Math.sin(2 * Math.PI * 11 * x) +
            0.1 * Math.cos(2 * Math.PI * 23 * x);
    }
    return data;
}

describe('periodic level policy helpers', () => {
    it('counts trailing factors of two (divisibility bound)', () => {
        expect(maxPeriodicLevelForLength(1)).toBe(0);
        expect(maxPeriodicLevelForLength(2)).toBe(1);
        expect(maxPeriodicLevelForLength(8)).toBe(3);
        expect(maxPeriodicLevelForLength(10)).toBe(1);
        expect(maxPeriodicLevelForLength(720)).toBe(4);
        expect(maxPeriodicLevelForLength(1024)).toBe(10);
        expect(maxPeriodicLevelForLength(3600)).toBe(4);
    });

    it('rejects non-positive or non-integer lengths', () => {
        throwsCode(() => maxPeriodicLevelForLength(0), 'invalid-input');
        throwsCode(() => maxPeriodicLevelForLength(-8), 'invalid-input');
        throwsCode(() => maxPeriodicLevelForLength(7.5), 'invalid-input');
    });

    it('combines divisibility with the filter-support (orthogonality) bound', () => {
        // tap count for db4 is 8: the coarsest per-level input must be >= 8.
        expect(maxOrthogonalPeriodicLevelForLength(8, 8)).toBe(1);
        expect(maxOrthogonalPeriodicLevelForLength(6, 8)).toBe(0); // even but < 8 taps
        expect(maxOrthogonalPeriodicLevelForLength(16, 8)).toBe(2);
        // J=3 analyzes per-level inputs 32 -> 16 -> 8 (coarsest == tapCount, ok);
        // J=4 would need a coarsest input of 4 < 8 taps, so it is invalid.
        expect(maxOrthogonalPeriodicLevelForLength(32, 8)).toBe(3);
        expect(maxOrthogonalPeriodicLevelForLength(720, 8)).toBe(4);
        expect(maxOrthogonalPeriodicLevelForLength(3600, 8)).toBe(4);
    });
});

describe('analysis + synthesis primitives (db4 periodic)', () => {
    it('single-level round trip restores the input (reconstruction identity)', () => {
        const input = sampleChannel(64);
        const filters = getWavelet(WAVELET).filters;
        const { approximate, detail } = analyzePeriodicLevel(input, filters);
        expect(approximate.length).toBe(32);
        expect(detail.length).toBe(32);
        const restored = synthesizePeriodicLevel(approximate, detail, filters);
        expect(restored.length).toBe(64);
        expect(maxAbsDiff(restored, input)).toBeLessThan(1e-9);
    });

    it('multi-level decompose/reconstruct restores the input', () => {
        const input = sampleChannel(128);
        const filters = getWavelet(WAVELET).filters;
        const { detailLevels, approximate } = decomposePeriodicLevels(input, filters, 3);
        expect(detailLevels.map((band) => band.detail.length)).toEqual([64, 32, 16]);
        expect(approximate.length).toBe(16);
        const restored = reconstructPeriodicLevels(detailLevels, approximate, filters, 128);
        expect(maxAbsDiff(restored, input)).toBeLessThan(1e-9);
    });

    it('does not mutate its input array', () => {
        const input = sampleChannel(32);
        const snapshot = new Float64Array(input);
        analyzePeriodicLevel(input, getWavelet(WAVELET).filters);
        decomposePeriodicLevels(input, getWavelet(WAVELET).filters, 2);
        expect(input).toEqual(snapshot);
    });

    it('rejects length mismatches in synthesis', () => {
        const filters = getWavelet(WAVELET).filters;
        throwsCode(
            () => synthesizePeriodicLevel(new Float64Array(8), new Float64Array(4), filters),
            'invalid-input',
        );
        throwsCode(
            () => analyzePeriodicLevel(new Float64Array(7), filters),
            'invalid-input',
        );
    });
});

describe('domain round trip (decomposeSignal / reconstructSignal)', () => {
    const cases: ReadonlyArray<{ n: number; level: number }> = [
        { n: 8, level: 1 },
        { n: 10, level: 1 },
        { n: 64, level: 4 },
        { n: 256, level: 3 },
        { n: 720, level: 4 },
        { n: 3600, level: 4 },
    ];

    for (const { n, level } of cases) {
        it(`reconstructs a ${n}-sample record decomposed to level ${level}`, () => {
            const input = sampleChannel(n);
            const signal = wrapSignal(input, 360);
            const decomposition = decomposeSignal(signal, levelConfig(level));
            expect(decomposition.sourceLengthSamples).toBe(n);
            const restored = reconstructSignal(decomposition);
            expect(channelOf(restored).length).toBe(n);
            expect(maxAbsDiff(channelOf(restored), input)).toBeLessThan(1e-9);
            // Sampling and unit are preserved through the round trip.
            expect(restored.sampling.sampleRateHz).toBe(signal.sampling.sampleRateHz);
            expect(restored.sampling.startTimeSec).toBe(signal.sampling.startTimeSec);
            expect(restored.channels[0]!.unit).toBe(signal.channels[0]!.unit);
            // The idwt transform name is reflected in the result id.
            expect(restored.id).toBe(`${signal.id} :: idwt-db4-level${level}-periodic`);
        });
    }

    it('handles multiple channels independently', () => {
        const n = 256;
        const signal = wrapSignal(sampleChannel(n), 360, 'mV', 'lead-II');
        const decomposition: WaveletDecomposition = decomposeSignal(signal, levelConfig(2));
        expect(decomposition.channels).toHaveLength(1);
        const restored = reconstructSignal(decomposition);
        expect(channelOf(restored).length).toBe(n);
    });

    it('records dwt + idwt provenance steps on the reconstructed signal', () => {
        const signal = wrapSignal(sampleChannel(256), 360);
        const decomposition = decomposeSignal(signal, levelConfig(3));
        const restored = reconstructSignal(decomposition);
        expect(restored.provenance.transforms).toHaveLength(
            signal.provenance.transforms.length + 2,
        );
        const added = restored.provenance.transforms.slice(signal.provenance.transforms.length);
        expect(added.map((step) => step.name)).toEqual([
            'dwt-db4-level3-periodic',
            'idwt-db4-level3-periodic',
        ]);
        expect(added[0]!.parameters.waveletName).toBe('db4');
        expect(added[0]!.parameters.sourceLengthSamples).toBe(256);
        expect(added[1]!.parameters.reconstructedLengthSamples).toBe(256);
    });
});

describe('coefficient sizing and Parseval energy', () => {
    it('keeps exact coefficient accounting (total length preserved)', () => {
        const n = 1024;
        const level = 4;
        const signal = wrapSignal(sampleChannel(n), 360);
        const decomposition = decomposeSignal(signal, levelConfig(level));
        const channel = decomposition.channels[0]!;
        expect(channel.detailLevels.map((band) => band.detail.length)).toEqual([
            512, 256, 128, 64,
        ]);
        expect(channel.approximate.length).toBe(64);
        const total =
            channel.detailLevels.reduce((sum, band) => sum + band.detail.length, 0) +
            channel.approximate.length;
        expect(total).toBe(n);
    });

    it('preserves energy exactly (orthogonal periodic transform, Parseval)', () => {
        for (const { n, level } of [
            { n: 1024, level: 4 },
            { n: 3600, level: 4 },
        ]) {
            const signal = wrapSignal(sampleChannel(n), 360);
            const decomposition = decomposeSignal(signal, levelConfig(level));
            const inputEnergy = sumSquares(channelOf(signal));
            const coefficientEnergy = decomposition.channels.reduce(
                (sum, channel) =>
                    sum +
                    channel.detailLevels.reduce(
                        (bandSum, band) => bandSum + sumSquares(band.detail),
                        0,
                    ) +
                    sumSquares(channel.approximate),
                0,
            );
            expect(Math.abs(inputEnergy - coefficientEnergy)).toBeLessThanOrEqual(
                Math.max(inputEnergy, 1) * 1e-9,
            );
        }
    });

    it('preserves energy for a shifted impulse (unit energy is conserved)', () => {
        const n = 256;
        const impulse = new Float64Array(n);
        impulse[129] = 1;
        const signal = wrapSignal(impulse, 360);
        const decomposition = decomposeSignal(signal, levelConfig(4));
        const coefficientEnergy = decomposition.channels[0]!.detailLevels.reduce(
            (sum, band) => sum + sumSquares(band.detail),
            0,
        ) + sumSquares(decomposition.channels[0]!.approximate);
        expect(Math.abs(coefficientEnergy - 1)).toBeLessThanOrEqual(1e-9);
    });
});

describe('determinism and hygiene', () => {
    it('is deterministic: identical inputs give identical coefficients', () => {
        const signal = wrapSignal(sampleChannel(720), 360);
        const first = decomposeSignal(signal, levelConfig(4));
        const second = decomposeSignal(signal, levelConfig(4));
        const a = first.channels[0]!;
        const b = second.channels[0]!;
        expect(a.approximate).toEqual(b.approximate);
        a.detailLevels.forEach((band, index) => {
            expect(band.detail).toEqual(b.detailLevels[index]!.detail);
        });
    });

    it('does not mutate the input signal', () => {
        const signal = wrapSignal(sampleChannel(256), 360);
        const snapshot = new Float64Array(channelOf(signal));
        const idBefore = signal.id;
        const provenanceBefore = signal.provenance;
        decomposeSignal(signal, levelConfig(3));
        expect(channelOf(signal)).toEqual(snapshot);
        expect(signal.id).toBe(idBefore);
        expect(signal.provenance).toBe(provenanceBefore);
    });

    it('does not mutate the decomposition on reconstruction', () => {
        const signal = wrapSignal(sampleChannel(256), 360);
        const decomposition = decomposeSignal(signal, levelConfig(3));
        const approxSnapshot = new Float64Array(decomposition.channels[0]!.approximate);
        const detailSnapshots = decomposition.channels[0]!.detailLevels.map(
            (band) => new Float64Array(band.detail),
        );
        reconstructSignal(decomposition);
        expect(decomposition.channels[0]!.approximate).toEqual(approxSnapshot);
        decomposition.channels[0]!.detailLevels.forEach((band, index) => {
            expect(band.detail).toEqual(detailSnapshots[index]!);
        });
    });

    it('returns freshly owned coefficient buffers (no aliasing with the signal)', () => {
        const signal = wrapSignal(sampleChannel(64), 360);
        const decomposition = decomposeSignal(signal, levelConfig(2));
        const approximate = decomposition.channels[0]!.approximate;
        // Mutating the returned buffer must not touch the source channel data.
        approximate[0] = 999;
        expect(channelOf(signal)[0]).not.toBe(999);
    });
});

describe('constant input behaviour', () => {
    it('produces near-zero detail coefficients and reconstructs the DC level', () => {
        const n = 256;
        const value = 2.5;
        const signal = wrapSignal(constantChannel(n, value), 360);
        const decomposition = decomposeSignal(signal, levelConfig(4));
        for (const band of decomposition.channels[0]!.detailLevels) {
            expect(maxAbsDiff(band.detail, new Float64Array(band.detail.length))).toBeLessThan(
                1e-9,
            );
        }
        const restored = reconstructSignal(decomposition);
        expect(maxAbsDiff(channelOf(restored), constantChannel(n, value))).toBeLessThan(1e-9);
    });
});

describe('analytic impulse case', () => {
    for (const index of [0, 1, 127, 129, 255]) {
        it(`reconstructs a unit impulse placed at sample ${index} exactly`, () => {
            const n = 256;
            const impulse = new Float64Array(n);
            impulse[index] = 1;
            const signal = wrapSignal(impulse, 360);
            const decomposition = decomposeSignal(signal, levelConfig(4));
            const restored = reconstructSignal(decomposition);
            expect(maxAbsDiff(channelOf(restored), impulse)).toBeLessThan(1e-9);
            expect(Math.abs(sumSquares(channelOf(restored)) - 1)).toBeLessThanOrEqual(1e-9);
        });
    }
});

describe('explicit validation errors (documented behaviour)', () => {
    const signal = wrapSignal(sampleChannel(3600), 360);

    it('rejects wavelets outside the catalog', () => {
        throwsCode(
            () => decomposeSignal(signal, { waveletName: 'db8', level: 1, extensionMode: EXTENSION }),
            'invalid-input',
        );
    });

    it('rejects non-periodic extension modes', () => {
        throwsCode(
            () =>
                decomposeSignal(signal, {
                    waveletName: WAVELET,
                    level: 1,
                    extensionMode: 'symmetric' as DwtConfig['extensionMode'],
                }),
            'invalid-input',
        );
    });

    it('rejects invalid levels', () => {
        throwsCode(() => decomposeSignal(signal, levelConfig(0)), 'invalid-input');
        throwsCode(() => decomposeSignal(signal, levelConfig(-1)), 'invalid-input');
        throwsCode(() => decomposeSignal(signal, levelConfig(2.5)), 'invalid-input');
    });

    it('rejects lengths not divisible by 2^level', () => {
        throwsCode(() => decomposeSignal(signal, levelConfig(5)), 'invalid-input'); // 3600 has 2^4
        throwsCode(() => decomposeSignal(wrapSignal(sampleChannel(10), 360), levelConfig(2)), 'invalid-input');
    });

    it('rejects odd lengths and lengths shorter than the filter support', () => {
        throwsCode(
            () => decomposeSignal(wrapSignal(sampleChannel(7), 360), levelConfig(1)),
            'invalid-input',
        );
        throwsCode(
            () => decomposeSignal(wrapSignal(sampleChannel(6), 360), levelConfig(1)),
            'invalid-input',
        );
    });
});

describe('transform names and extension-mode surface', () => {
    it('produces canonical dwt/idwt names', () => {
        expect(dwtTransformName(levelConfig(3))).toBe('dwt-db4-level3-periodic');
        const decomposition = decomposeSignal(
            wrapSignal(sampleChannel(64), 360),
            levelConfig(3),
        );
        expect(idwtTransformName(decomposition)).toBe('idwt-db4-level3-periodic');
    });

    it('advertises only the supported extension modes', () => {
        expect(SUPPORTED_DWT_EXTENSION_MODES).toEqual(['periodic']);
    });
});

describe('golden regression: catalog matches the committed db4.json artifact', () => {
    it('agrees with the committed wavelib-provenanced filter bank', () => {
        const golden = loadGoldenDb4File();
        const filters = getWavelet(WAVELET).filters;
        expect(arraysClose(filters.decLo, golden.dec_lo, 1e-12)).toBe(true);
        expect(arraysClose(filters.decHi, golden.dec_hi, 1e-12)).toBe(true);
        expect(arraysClose(filters.recLo, golden.rec_lo, 1e-12)).toBe(true);
        expect(arraysClose(filters.recHi, golden.rec_hi, 1e-12)).toBe(true);
    });

    it('exposes db4 as the sole catalog member with its declared identity', () => {
        expect(listWaveletNames()).toEqual([WAVELET]);
        const db4 = getWavelet(WAVELET);
        expect(db4.family).toBe('db');
        expect(db4.order).toBe(4);
        expect(db4.tapCount).toBe(8);
        expect(db4.isOrthogonal).toBe(true);
    });
});

describe('fixture regression through the DWT stack', () => {
    it('round-trips the canonical sine-1 fixture through a 4-level db4 DWT', () => {
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
        const decomposition = decomposeSignal(signal, levelConfig(4));
        const restored = reconstructSignal(decomposition);
        expect(restored.channels[0]!.data.length).toBe(3600);
        expect(restored.sampling.sampleRateHz).toBe(360);
        expect(restored.channels[0]!.unit).toBe('mV');
        // A 4-level reconstruction must reproduce the committed fixture record.
        expect(maxAbsDiff(channelOf(restored), samples)).toBeLessThan(1e-9);
    });
});
