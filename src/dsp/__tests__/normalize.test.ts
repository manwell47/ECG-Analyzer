import { describe, expect, it } from 'vitest';
import {
    createSamplingInfo,
    createSignal,
    EcgError,
    type Signal,
} from '../../domain';
import {
    applyNormalization,
    fitNormalization,
    normalizeSignal,
} from '../normalize';
import { channelOf, mean, rms } from './support';

function makeSignal(
    id: string,
    channels: ReadonlyArray<{ name: string; data: Float64Array }>,
): Signal {
    return createSignal({
        id,
        channels: channels.map((channel) => ({
            name: channel.name,
            unit: 'mV' as const,
            data: channel.data,
        })),
        sampling: createSamplingInfo(360),
    });
}

function constantSignal(id: string, value: number, lengthSamples = 8): Signal {
    const data = new Float64Array(lengthSamples);
    data.fill(value);
    return makeSignal(id, [{ name: 'lead', data }]);
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

describe('min-max normalisation (per-channel)', () => {
    it('maps each channel into [0, 1] and labels the output unit normalized', () => {
        // All channels share the same length (multi-lead domain invariant).
        const signal = makeSignal('mm', [
            { name: 'a', data: new Float64Array([-2, 0, 4]) },
            { name: 'b', data: new Float64Array([10, 10, 20]) },
        ]);
        const out = normalizeSignal(signal, {
            strategy: 'min-max',
            scope: 'per-channel',
        });

        // Channel a: min -2 -> 0, max 4 -> 1.
        const a = channelOf(out);
        expect(a[0]).toBeCloseTo(0, 9);
        expect(a[1]).toBeCloseTo(2 / 6, 9);
        expect(a[2]).toBeCloseTo(1, 9);
        // Channel b: min 10 -> 0, max 20 -> 1.
        const b = out.channels[1]!.data;
        expect(b[0]).toBeCloseTo(0, 9);
        expect(b[2]).toBeCloseTo(1, 9);

        for (const ch of out.channels) {
            expect(ch.unit).toBe('normalized');
            expect(ch.name).toBeTruthy();
        }
        expect(out.sampling.sampleRateHz).toBe(360);
    });

    it('appends a provenance transform naming strategy and scope', () => {
        const out = normalizeSignal(
            makeSignal('p', [{ name: 'a', data: new Float64Array([0, 1]) }]),
            { strategy: 'min-max', scope: 'per-channel' },
        );
        const transforms = out.provenance.transforms;
        expect(transforms).toHaveLength(1);
        const step = transforms[0]!;
        expect(step.name).toBe('normalize-min-max-per-channel');
        expect(step.parameters).toMatchObject({
            strategy: 'min-max',
            scope: 'per-channel',
        });
        expect(out.id).toContain('normalize-min-max-per-channel');
    });
});

describe('z-score normalisation (per-channel)', () => {
    it('centres on 0 and scales to unit population standard deviation', () => {
        const data = new Float64Array([0, 1, 2, 3, 4]); // mean 2, std sqrt(2)
        const out = normalizeSignal(
            makeSignal('z', [{ name: 'a', data }]),
            { strategy: 'zscore', scope: 'per-channel' },
        );
        const z = channelOf(out);
        expect(Math.abs(mean(z))).toBeLessThan(1e-9);
        expect(rms(z)).toBeCloseTo(1, 6);
        // First sample (0) maps to -mean/std = -sqrt(2).
        expect(z[0]).toBeCloseTo(-Math.SQRT2, 9);
    });
});

describe('global scope combines channels before fitting', () => {
    it('broadcasts one combined statistic to every channel', () => {
        // Channel a: [-2, 4]; channel b: [100, 20]. Global min -2, max 100.
        const signal = makeSignal('g', [
            { name: 'a', data: new Float64Array([-2, 4]) },
            { name: 'b', data: new Float64Array([100, 20]) },
        ]);
        const out = normalizeSignal(signal, {
            strategy: 'min-max',
            scope: 'global',
        });
        // 100 is the global max -> 1 in every channel.
        expect(out.channels[1]!.data[0]).toBeCloseTo(1, 9);
        // -2 is the global min -> 0 in channel a.
        expect(out.channels[0]!.data[0]).toBeCloseTo(0, 9);
        // 4 maps with the *global* range: (4 + 2) / 102.
        expect(out.channels[0]!.data[1]).toBeCloseTo(6 / 102, 9);
    });

    it('records identical channel params for a global fit', () => {
        const signal = makeSignal('g2', [
            { name: 'a', data: new Float64Array([1, 2]) },
            { name: 'b', data: new Float64Array([10, 20]) },
        ]);
        const fit = fitNormalization(signal, {
            strategy: 'zscore',
            scope: 'global',
        });
        expect(fit.channelParams).toHaveLength(2);
        expect(fit.channelParams[0]).toEqual(fit.channelParams[1]);
        expect(fit.strategy).toBe('zscore');
        expect(fit.scope).toBe('global');
    });
});

describe('fit/apply separation is the structural leakage guard', () => {
    it('applyNormalization uses stored parameters and never refits on the target', () => {
        // Train partition lives in [0, 10].
        const train = makeSignal('train', [
            { name: 'a', data: new Float64Array([0, 5, 10]) },
        ]);
        const fit = fitNormalization(
            train,
            { strategy: 'min-max', scope: 'per-channel' },
            'train-fold-A',
        );
        expect(fit.fitPartitionDescription).toBe('train-fold-A');
        expect(fit.channelParams[0]).toEqual({
            kind: 'min-max',
            min: 0,
            max: 10,
        });

        // Eval partition lies entirely *outside* [0, 10]. If apply refitted on
        // the eval data, its own min/max would collapse to [0,1] — so any value
        // outside [0,1] proves the stored train parameters were used.
        const evalOut = applyNormalization(
            constantSignal('eval', 100),
            fit,
        );
        expect(channelOf(evalOut)[0]).toBeCloseTo(10, 9);
        expect(channelOf(evalOut)[1]).toBeCloseTo(10, 9);

        const evalLow = applyNormalization(constantSignal('eval2', -5), fit);
        expect(channelOf(evalLow)[0]).toBeCloseTo(-0.5, 9);

        // The provenance carries the audit trail of which partition was fit.
        const step =
            evalOut.provenance.transforms[evalOut.provenance.transforms.length - 1]!;
        expect(step.parameters).toMatchObject({
            strategy: 'min-max',
            scope: 'per-channel',
            fitPartitionDescription: 'train-fold-A',
        });
    });

    it('rejects a fit whose channel count does not match the target signal', () => {
        const train = makeSignal('tm', [
            { name: 'a', data: new Float64Array([0, 1]) },
        ]);
        const fit = fitNormalization(train, {
            strategy: 'min-max',
            scope: 'per-channel',
        });
        const twoChannels = makeSignal('two', [
            { name: 'a', data: new Float64Array([0, 1]) },
            { name: 'b', data: new Float64Array([0, 1]) },
        ]);
        throwsCode(() => applyNormalization(twoChannels, fit), 'invalid-input');
    });
});

describe('zero-variance and invalid specifications are rejected explicitly', () => {
    it('rejects a constant channel for min-max with numerical-failure', () => {
        throwsCode(
            () =>
                fitNormalization(constantSignal('c', 5), {
                    strategy: 'min-max',
                    scope: 'per-channel',
                }),
            'numerical-failure',
        );
        throwsCode(
            () =>
                normalizeSignal(constantSignal('c2', 5), {
                    strategy: 'min-max',
                    scope: 'per-channel',
                }),
            'numerical-failure',
        );
    });

    it('rejects a constant channel for zscore with numerical-failure', () => {
        throwsCode(
            () =>
                fitNormalization(constantSignal('c3', 5), {
                    strategy: 'zscore',
                    scope: 'per-channel',
                }),
            'numerical-failure',
        );
    });

    it('rejects unknown strategies and scopes', () => {
        const signal = makeSignal('v', [
            { name: 'a', data: new Float64Array([0, 1]) },
        ]);
        throwsCode(
            () =>
                fitNormalization(signal, {
                    strategy: 'robust' as never,
                    scope: 'per-channel',
                }),
            'invalid-input',
        );
        throwsCode(
            () =>
                fitNormalization(signal, {
                    strategy: 'min-max',
                    scope: 'record' as never,
                }),
            'invalid-input',
        );
    });
});

describe('hygiene', () => {
    it('does not mutate the input and is deterministic', () => {
        const signal = makeSignal('hyg', [
            { name: 'a', data: new Float64Array([-1, 0, 3]) },
        ]);
        const before = new Float64Array(channelOf(signal));

        const a = normalizeSignal(signal, {
            strategy: 'min-max',
            scope: 'per-channel',
        });
        const b = normalizeSignal(signal, {
            strategy: 'min-max',
            scope: 'per-channel',
        });

        expect(channelOf(signal)).toEqual(before);
        expect(channelOf(a)).toEqual(channelOf(b));
        expect(a.channels[0]!.data).not.toBe(signal.channels[0]!.data);
    });

    it('normalizeSignal is the whole-record convenience path (fit then apply)', () => {
        const signal = makeSignal('conv', [
            { name: 'a', data: new Float64Array([0, 4]) },
        ]);
        const direct = applyNormalization(
            signal,
            fitNormalization(signal, {
                strategy: 'min-max',
                scope: 'per-channel',
            }),
        );
        const convenience = normalizeSignal(signal, {
            strategy: 'min-max',
            scope: 'per-channel',
        });
        expect(channelOf(convenience)).toEqual(channelOf(direct));
    });
});
