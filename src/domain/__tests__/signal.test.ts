import { describe, expect, it } from 'vitest';

import { EcgError } from '../error';
import { createSamplingInfo, type SamplingInfo } from '../sampling';
import type { AmplitudeUnit } from '../units';
import {
    assertValidSignal,
    createSignal,
    describeSignalProblems,
    type Provenance,
    type Signal,
    type SignalChannel,
} from '../signal';

function channel(
    name: string,
    data: number[],
    unit: AmplitudeUnit = 'adc',
): SignalChannel {
    return { name, data: Float64Array.from(data), unit };
}

interface SignalOverrides {
    id?: string;
    channels?: readonly SignalChannel[];
    sampling?: SamplingInfo;
    provenance?: Provenance;
}

function makeSignal(over: SignalOverrides = {}): Signal {
    return {
        id: over.id ?? 'test-signal',
        channels: over.channels ?? [channel('MLII', [0, 1, 2, 3])],
        sampling: over.sampling ?? createSamplingInfo(360),
        provenance: over.provenance ?? { transforms: [] },
    };
}

/** Runs `fn`, returning the classified code of any thrown EcgError. */
function errorCodeOf(fn: () => unknown): string | undefined {
    try {
        fn();
    } catch (err) {
        if (err instanceof EcgError) {
            return err.code;
        }
    }
    return undefined;
}

describe('describeSignalProblems', () => {
    it('returns no problems for a valid signal', () => {
        expect(describeSignalProblems(makeSignal())).toEqual([]);
    });

    it('flags an empty id and an empty channel set', () => {
        expect(describeSignalProblems(makeSignal({ id: ' ' }))).toContain(
            'Signal id must be a non-empty string.',
        );
        expect(
            describeSignalProblems(
                makeSignal({ channels: [] }),
            ),
        ).toContain('Signal must contain at least one channel.');
    });

    it('flags empty channel names and duplicate names', () => {
        const emptyName = describeSignalProblems(
            makeSignal({ channels: [channel('', [1])] }),
        );
        expect(emptyName.join(' ')).toContain('non-empty name');

        const duplicate = describeSignalProblems(
            makeSignal({ channels: [channel('MLII', [1]), channel('MLII', [1])] }),
        );
        expect(duplicate.join(' ')).toContain('Duplicate channel name');
    });

    it('flags unsupported units', () => {
        const badUnitChannel = {
            name: 'L',
            data: Float64Array.from([1, 2]),
            unit: 'V',
        } as unknown as SignalChannel;
        const problems = describeSignalProblems(
            makeSignal({ channels: [badUnitChannel] }),
        );
        expect(problems.join(' ')).toContain('unsupported unit');
    });

    it('flags zero-length channels and non-finite samples', () => {
        const zeroLength = describeSignalProblems(
            makeSignal({ channels: [channel('A', [])] }),
        );
        expect(zeroLength.join(' ')).toContain('zero samples');

        const nanData = channel('A', [0, Number.NaN, 2]);
        const nanProblems = describeSignalProblems(makeSignal({ channels: [nanData] }));
        expect(nanProblems.join(' ')).toContain('non-finite value at sample index 1');

        const infData = channel('A', [0, Number.POSITIVE_INFINITY]);
        const infProblems = describeSignalProblems(makeSignal({ channels: [infData] }));
        expect(infProblems.join(' ')).toContain('non-finite value at sample index 1');
    });

    it('flags unequal channel lengths', () => {
        const problems = describeSignalProblems(
            makeSignal({ channels: [channel('A', [1, 2]), channel('B', [1, 2, 3])] }),
        );
        expect(problems.join(' ')).toContain('equal sample counts');
    });

    it('flags an invalid sampling description', () => {
        const badRate = makeSignal({
            sampling: { sampleRateHz: 0, startTimeSec: 0 },
        });
        expect(describeSignalProblems(badRate).join(' ')).toContain('Sample rate');

        const badStart = makeSignal({
            sampling: { sampleRateHz: 360, startTimeSec: Number.NaN },
        });
        expect(describeSignalProblems(badStart).join(' ')).toContain(
            'Start time must be a finite number',
        );
    });
});

describe('createSignal', () => {
    it('builds a valid signal and copies channel buffers (ownership isolation)', () => {
        const source = Float64Array.from([1, 2, 3]);
        const inputChannels: SignalChannel[] = [{ name: 'MLII', data: source, unit: 'adc' }];
        const signal = createSignal({
            id: 's1',
            channels: inputChannels,
            sampling: createSamplingInfo(360),
        });

        expect(signal.id).toBe('s1');
        expect(signal.sampling.sampleRateHz).toBe(360);
        expect(signal.provenance.transforms).toEqual([]);

        // Mutating the caller's buffer must not affect the signal.
        source[0] = 999;
        expect(signal.channels[0]?.data[0]).toBe(1);
    });

    it('preserves supplied provenance', () => {
        const provenance: Provenance = {
            source: 'mitdb/100',
            transforms: [{ name: 'baseline-removal', parameters: { method: 'median' } }],
        };
        const signal = createSignal({
            id: 's1',
            channels: [channel('MLII', [1, 2, 3])],
            sampling: createSamplingInfo(360),
            provenance,
        });
        expect(signal.provenance).toEqual(provenance);
    });

    it('rejects mismatched channel lengths as malformed-signal', () => {
        const code = errorCodeOf(() =>
            createSignal({
                id: 's1',
                channels: [channel('A', [1, 2]), channel('B', [1])],
                sampling: createSamplingInfo(360),
            }),
        );
        expect(code).toBe('malformed-signal');
    });

    it('rejects duplicate channel names as malformed-signal', () => {
        const code = errorCodeOf(() =>
            createSignal({
                id: 's1',
                channels: [channel('MLII', [1]), channel('MLII', [1])],
                sampling: createSamplingInfo(360),
            }),
        );
        expect(code).toBe('malformed-signal');
    });

    it('rejects an empty id as malformed-signal', () => {
        const code = errorCodeOf(() =>
            createSignal({
                id: '',
                channels: [channel('MLII', [1])],
                sampling: createSamplingInfo(360),
            }),
        );
        expect(code).toBe('malformed-signal');
    });
});

describe('assertValidSignal', () => {
    it('does not throw for a valid signal', () => {
        const signal = createSignal({
            id: 'ok',
            channels: [channel('MLII', [1, 2, 3])],
            sampling: createSamplingInfo(250),
        });
        expect(() => assertValidSignal(signal)).not.toThrow();
    });
});
