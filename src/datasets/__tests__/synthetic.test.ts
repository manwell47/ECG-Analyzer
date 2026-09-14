/**
 * Synthetic dataset adapter tests (Phase 5 / ADR-006, architecture §J).
 *
 * The synthetic adapter is the hermetic boundary proof: `generateSyntheticRecord`
 * must be a pure function of its spec (deterministic, no RNG), produce canonical
 * mV-calibrated `SignalRecord`s, and the adapter must obey the `DatasetAdapter`
 * contract (stable id list, classified errors).
 */
import { describe, expect, it } from 'vitest';

import { EcgError } from '../../domain/error';
import {
    generateSyntheticRecord,
    SYNTHETIC_DATASET_ID,
    SyntheticDatasetAdapter,
    type SyntheticRecordSpec,
} from '../synthetic/adapter';

function samplesOf(channel: { samples: Int16Array } | undefined): number[] {
    return Array.from(channel?.samples ?? new Int16Array());
}

async function promiseErrorCode(
    promise: Promise<unknown>,
): Promise<string | undefined> {
    try {
        await promise;
    } catch (error) {
        if (error instanceof EcgError) {
            return error.code;
        }
    }
    return undefined;
}

describe('generateSyntheticRecord (default spec)', () => {
    const spec = (recordId = 'syn-1'): SyntheticRecordSpec => ({ recordId });

    it('is deterministic: repeated calls give bit-identical records', () => {
        const a = generateSyntheticRecord(spec());
        const b = generateSyntheticRecord(spec());

        expect(a.channels).toHaveLength(2);
        expect(b.channels).toHaveLength(2);
        expect(a.channels[0]?.name).toBe('lead-a');
        expect(a.channels[1]?.name).toBe('lead-b');

        for (let i = 0; i < a.channels.length; i += 1) {
            expect(a.channels[i]?.name).toBe(b.channels[i]?.name);
            expect(samplesOf(a.channels[i])).toEqual(samplesOf(b.channels[i]));
        }
    });

    it('builds a canonical, mV-calibrated record with the documented shape', () => {
        const record = generateSyntheticRecord(spec('syn-1'));

        expect(record.identity).toEqual({
            datasetId: SYNTHETIC_DATASET_ID,
            recordId: 'syn-1',
        });
        expect(record.subjectId).toBe('syn-1');
        expect(record.sampling.sampleRateHz).toBe(360);
        expect(record.sampleCount).toBe(3600);
        expect(record.annotations).toEqual([]);
        expect(record.comments).toEqual([]);
        expect(record.channels).toHaveLength(2);

        const ch0 = record.channels[0];
        expect(ch0?.physicalUnit).toBe('mV');
        expect(ch0?.calibration).toEqual({ gain: 200, baseline: 1024 });
        expect(ch0?.adcZero).toBe(1024);
        expect(ch0?.adcResolutionBits).toBe(11);
        expect(ch0?.sourceFormat).toBe('synthetic');
        expect(ch0?.samples).toBeInstanceOf(Int16Array);
        expect(ch0?.samples).toHaveLength(3600);
    });

    it('starts at the ADC baseline (t = 0 is zero amplitude) and stays bounded', () => {
        const record = generateSyntheticRecord(spec());

        for (const channel of record.channels) {
            expect(channel.samples[0]).toBe(1024);
            for (const value of channel.samples) {
                expect(value).toBeGreaterThanOrEqual(824);
                expect(value).toBeLessThanOrEqual(1224);
            }
        }
    });
});

describe('generateSyntheticRecord (custom spec)', () => {
    it('honours a single custom lead, sample rate and sample count', () => {
        const record = generateSyntheticRecord({
            recordId: 'tone-1',
            sampleRateHz: 250,
            sampleCount: 250,
            leads: [
                {
                    name: 'custom',
                    gain: 1000,
                    baseline: 2048,
                    amplitudeMv: 0.5,
                    frequencyHz: 5,
                },
            ],
        });

        expect(record.sampling.sampleRateHz).toBe(250);
        expect(record.sampleCount).toBe(250);
        expect(record.channels).toHaveLength(1);

        const ch0 = record.channels[0];
        expect(ch0?.name).toBe('custom');
        expect(ch0?.samples).toHaveLength(250);
        expect(ch0?.calibration).toEqual({ gain: 1000, baseline: 2048 });
        expect(ch0?.samples[0]).toBe(2048);
    });
});

describe('SyntheticDatasetAdapter', () => {
    const specs: Record<string, SyntheticRecordSpec> = {
        b: { recordId: 'b' },
        a: { recordId: 'a' },
    };
    const adapter = new SyntheticDatasetAdapter(specs);

    it('reports the stable synthetic dataset identity', () => {
        expect(adapter.datasetId).toBe(SYNTHETIC_DATASET_ID);
    });

    it('lists record ids in canonical sorted order', async () => {
        await expect(adapter.listRecordIds()).resolves.toEqual(['a', 'b']);
    });

    it('materialises a record whose identity matches the requested id', async () => {
        const record = await adapter.readRecord('a');

        expect(record.identity.datasetId).toBe(SYNTHETIC_DATASET_ID);
        expect(record.identity.recordId).toBe('a');
        expect(record.subjectId).toBe('a');
        expect(record.sampleCount).toBe(3600);
        expect(record.channels).toHaveLength(2);
    });

    it('throws file-not-found for an unknown record id', async () => {
        const code = await promiseErrorCode(adapter.readRecord('missing'));
        expect(code).toBe('file-not-found');
    });
});
