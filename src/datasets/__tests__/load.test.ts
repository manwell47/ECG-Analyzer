/**
 * ADC -> mV load step tests (Phase 5 / ADR-006).
 *
 * `recordToMillivoltSignal` is the single audited calibration step between the
 * dataset layer's raw-ADC `SignalRecord` and the physical-unit `Signal` the DSP
 * layer consumes. These tests pin the numerics against the domain conversion
 * and the provenance step it records.
 */
import { describe, expect, it } from 'vitest';

import { EcgError } from '../../domain/error';
import { createSamplingInfo } from '../../domain/sampling';
import {
    createSignalRecord,
    type RecordChannel,
    type SignalRecord,
} from '../../domain/record';
import type { AmplitudeUnit } from '../../domain/units';
import { ADC_TO_MILLIVOLT_STEP, recordToMillivoltSignal } from '../load';

function channel(
    name: string,
    samples: readonly number[],
    physicalUnit: AmplitudeUnit = 'mV',
): RecordChannel {
    return {
        name,
        physicalUnit,
        calibration: { gain: 200, baseline: 1024 },
        adcZero: 1024,
        adcResolutionBits: 11,
        initialValue: samples[0] ?? 0,
        checksum: 0,
        blockSize: 0,
        sourceFormat: '212',
        samples: Int16Array.from(samples),
    };
}

function makeRecord(over: { channels?: RecordChannel[] } = {}): SignalRecord {
    return createSignalRecord({
        identity: { datasetId: 'mit-bih-arrhythmia', recordId: '900' },
        subjectId: '900',
        sampling: createSamplingInfo(360),
        channels: over.channels ?? [channel('MLII', [995, 1011, 1024])],
        annotations: [],
        comments: [],
        provenance: { source: 'mit-bih-arrhythmia/900', transforms: [] },
    });
}

function errorCodeOf(fn: () => unknown): string | undefined {
    try {
        fn();
    } catch (error) {
        if (error instanceof EcgError) {
            return error.code;
        }
    }
    return undefined;
}

describe('recordToMillivoltSignal', () => {
    it('converts known ADC counts to millivolts via (adc - baseline) / gain', () => {
        const record = makeRecord();
        const signal = recordToMillivoltSignal(record);

        expect(signal.id).toBe('mit-bih-arrhythmia/900');
        expect(signal.channels).toHaveLength(1);
        const data = signal.channels[0]?.data ?? new Float64Array();
        expect(data[0]).toBeCloseTo((995 - 1024) / 200, 12); // -0.145
        expect(data[1]).toBeCloseTo((1011 - 1024) / 200, 12); // -0.065
        expect(data[2]).toBe(0);
    });

    it('keeps the channel name, mV unit and sampling of the source record', () => {
        const signal = recordToMillivoltSignal(makeRecord());
        expect(signal.channels[0]?.name).toBe('MLII');
        expect(signal.channels[0]?.unit).toBe('mV');
        expect(signal.sampling.sampleRateHz).toBe(360);
    });

    it('records the adc-to-millivolt provenance step with the dataset id', () => {
        const signal = recordToMillivoltSignal(makeRecord());
        expect(signal.provenance.source).toBe('mit-bih-arrhythmia/900');
        expect(signal.provenance.transforms).toEqual([
            {
                name: ADC_TO_MILLIVOLT_STEP,
                parameters: { datasetId: 'mit-bih-arrhythmia' },
            },
        ]);
    });

    it('honours an explicit id option', () => {
        const signal = recordToMillivoltSignal(makeRecord(), { id: 'my-900' });
        expect(signal.id).toBe('my-900');
    });

    it('throws unsupported-format for a channel not calibrated to mV', () => {
        const record = makeRecord({
            channels: [channel('raw-adc', [995, 1011, 1024], 'adc')],
        });
        expect(errorCodeOf(() => recordToMillivoltSignal(record))).toBe(
            'unsupported-format',
        );
    });
});
