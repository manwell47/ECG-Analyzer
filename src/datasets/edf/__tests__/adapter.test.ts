/**
 * `EdfDatasetAdapter` end-to-end tests (Phase 18 item 6 / ADR-020).
 *
 * A tiny, byte-exact EDF file is assembled by the fixture builder and read
 * through the adapter: the adapter must keep the digits verbatim in the `adc`
 * unit, declare the calibration the *header* declared (never one derived from
 * the data), exclude the EDF+ annotation signal, keep the record order when
 * concatenating data records, record an out-of-range digit as provenance
 * rather than hiding it, and classify every documented error path. The last
 * block proves the record converts through the one audited ADC -> mV step.
 */
import { describe, expect, it } from 'vitest';

import { EcgError } from '../../../domain/error';
import { adcToMillivolt } from '../../../domain/units';
import { recordToMillivoltSignal } from '../../load';
import { InMemoryFileSource } from '../../source';
import { EDF_DATASET_ID, EdfDatasetAdapter } from '../adapter';
import { EDF_OUT_OF_RANGE_STEP } from '../calibration';
import {
    annotationSignal,
    buildEdfFixture,
    DEFAULT_BASELINE,
    DEFAULT_GAIN,
    edfSource,
    FIXTURE_FILE_NAME,
    FIXTURE_RECORD_ID,
} from './support';

/** Counts binary reads so we can prove the file is decoded exactly once. */
class CountingFileSource extends InMemoryFileSource {
    readonly binaryReads = new Map<string, number>();

    override async readBinaryFile(fileName: string): Promise<Uint8Array> {
        this.binaryReads.set(fileName, (this.binaryReads.get(fileName) ?? 0) + 1);
        return super.readBinaryFile(fileName);
    }
}

async function promiseErrorCode(promise: Promise<unknown>): Promise<string | undefined> {
    try {
        await promise;
    } catch (error) {
        if (error instanceof EcgError) {
            return error.code;
        }
    }
    return undefined;
}

const DIGITS = [100, -100, 1000, -1000] as const;

describe('EdfDatasetAdapter readRecord', () => {
    it('materialises a tiny EDF file into a canonical SignalRecord', async () => {
        const fixture = buildEdfFixture({ records: [[DIGITS]] });
        const adapter = new EdfDatasetAdapter(fixture.source);
        const record = await adapter.readRecord(FIXTURE_RECORD_ID);

        expect(adapter.datasetId).toBe(EDF_DATASET_ID);
        expect(record.identity).toEqual({ datasetId: 'edf', recordId: 'record' });
        expect(record.subjectId).toBe('record');
        expect(record.sampling.sampleRateHz).toBe(4);
        expect(record.sampleCount).toBe(4);
        expect(record.channels).toHaveLength(1);
        expect(record.annotations).toEqual([]);
        expect(record.comments).toEqual([]);
        expect(record.provenance).toEqual({ source: 'edf/record', transforms: [] });
    });

    it('keeps the digits verbatim and declares the file-derived channel facts', async () => {
        const fixture = buildEdfFixture({ records: [[DIGITS]] });
        const record = await new EdfDatasetAdapter(fixture.source).readRecord(
            fixture.recordId,
        );
        const channel = record.channels[0];

        expect(channel?.name).toBe('ECG');
        expect(channel?.physicalUnit).toBe('mV');
        expect(channel?.samples).toBeInstanceOf(Int16Array);
        expect(Array.from(channel?.samples ?? new Int16Array())).toEqual([...DIGITS]);
        expect(channel?.calibration).toEqual({
            gain: DEFAULT_GAIN,
            baseline: DEFAULT_BASELINE,
        });
        expect(channel?.adcZero).toBe(0);
        expect(channel?.adcResolutionBits).toBe(11);
        expect(channel?.blockSize).toBe(4);
        expect(channel?.sourceFormat).toBe('EDF');
        expect(channel?.initialValue).toBe(100);
        expect(channel?.checksum).toBe(0);
    });

    it('derives gain and baseline from the declared spans, not from the data', async () => {
        const fixture = buildEdfFixture({
            signals: [
                {
                    label: 'ECG',
                    physicalMin: -2,
                    physicalMax: 2,
                    digitalMin: -1024,
                    digitalMax: 3072,
                },
            ],
            records: [[[0, 1, 2, 3]]],
        });
        const record = await new EdfDatasetAdapter(fixture.source).readRecord(
            fixture.recordId,
        );

        expect(record.channels[0]?.calibration).toEqual({ gain: 1024, baseline: 1024 });
        expect(record.channels[0]?.adcResolutionBits).toBe(13);
    });

    it('names an unlabelled signal positionally rather than leaving it blank', async () => {
        const fixture = buildEdfFixture({
            signals: [{ label: '' }],
            records: [[[1, 2, 3, 4]]],
        });
        const record = await new EdfDatasetAdapter(fixture.source).readRecord(
            fixture.recordId,
        );

        expect(record.channels[0]?.name).toBe('channel-1');
    });

    it('takes the subject from the patient field, falling back to the record id', async () => {
        const named = buildEdfFixture({ patientId: 'Patient A' });
        expect(
            (await new EdfDatasetAdapter(named.source).readRecord(named.recordId)).subjectId,
        ).toBe('Patient A');

        const unknown = buildEdfFixture({ patientId: 'X' });
        expect(
            (await new EdfDatasetAdapter(unknown.source).readRecord(unknown.recordId))
                .subjectId,
        ).toBe('record');

        const blank = buildEdfFixture({ patientId: '' });
        expect(
            (await new EdfDatasetAdapter(blank.source).readRecord(blank.recordId)).subjectId,
        ).toBe('record');
    });

    it('carries the declared recording id into the comments', async () => {
        const fixture = buildEdfFixture({ recordingId: 'MIT-BIH export 2020' });
        const record = await new EdfDatasetAdapter(fixture.source).readRecord(
            fixture.recordId,
        );

        expect(record.comments).toEqual(['EDF recording: MIT-BIH export 2020']);
    });

    it('excludes the EDF+ annotation signal, saying so in the comments', async () => {
        const fixture = buildEdfFixture({
            signals: [{ label: 'MLII' }, { ...annotationSignal(), physicalDimension: '' }],
            recordingId: 'annotated',
        });
        const record = await new EdfDatasetAdapter(fixture.source).readRecord(
            fixture.recordId,
        );

        expect(record.channels.map((channel) => channel.name)).toEqual(['MLII']);
        expect(record.annotations).toEqual([]);
        expect(record.comments).toHaveLength(2);
        expect(record.comments[0]).toContain('"EDF Annotations"');
        expect(record.comments[0]).toContain('does not read it');
        expect(record.comments[1]).toBe('EDF recording: annotated');
    });

    it('concatenates data records in record order for every signal', async () => {
        const fixture = buildEdfFixture({
            records: [
                [[1, 2, 3, 4]],
                [[-5, -6, -7, -8]],
            ],
        });
        const record = await new EdfDatasetAdapter(fixture.source).readRecord(
            fixture.recordId,
        );

        expect(Array.from(record.channels[0]?.samples ?? new Int16Array())).toEqual([
            1, 2, 3, 4, -5, -6, -7, -8,
        ]);
        expect(record.sampleCount).toBe(8);
        expect(record.sampling.sampleRateHz).toBe(4);
    });

    it('decodes several signals side by side, one buffer each', async () => {
        const fixture = buildEdfFixture({
            signals: [{ label: 'MLII' }, { label: 'V5' }],
            records: [
                [
                    [1, 2, 3, 4],
                    [11, 12, 13, 14],
                ],
            ],
        });
        const record = await new EdfDatasetAdapter(fixture.source).readRecord(
            fixture.recordId,
        );

        expect(record.channels.map((channel) => channel.name)).toEqual(['MLII', 'V5']);
        expect(Array.from(record.channels[0]?.samples ?? new Int16Array())).toEqual([
            1, 2, 3, 4,
        ]);
        expect(Array.from(record.channels[1]?.samples ?? new Int16Array())).toEqual([
            11, 12, 13, 14,
        ]);
    });

    it('keeps a digit outside the declared range and records it as provenance', async () => {
        const fixture = buildEdfFixture({ records: [[[100, 5000, -1000, -3000]]] });
        const record = await new EdfDatasetAdapter(fixture.source).readRecord(
            fixture.recordId,
        );

        expect(Array.from(record.channels[0]?.samples ?? new Int16Array())).toEqual([
            100, 5000, -1000, -3000,
        ]);
        expect(record.provenance.transforms).toEqual([
            {
                name: EDF_OUT_OF_RANGE_STEP,
                parameters: {
                    channel: 'ECG',
                    count: 2,
                    digitalMin: -1000,
                    digitalMax: 1000,
                },
            },
        ]);
    });

    it('adds no provenance step when every digit is inside the declared range', async () => {
        const fixture = buildEdfFixture({ records: [[[1000, -1000, 0, 500]]] });
        const record = await new EdfDatasetAdapter(fixture.source).readRecord(
            fixture.recordId,
        );

        expect(record.provenance.transforms).toEqual([]);
    });

    it('decodes the file exactly once', async () => {
        const fixture = buildEdfFixture();
        const source = new CountingFileSource({
            [FIXTURE_FILE_NAME]: { bytes: fixture.bytes },
        });
        await new EdfDatasetAdapter(source).readRecord(FIXTURE_RECORD_ID);

        expect(source.binaryReads.get(FIXTURE_FILE_NAME)).toBe(1);
    });
});

describe('EdfDatasetAdapter listRecordIds', () => {
    it('lists the .edf stems, deduplicated and ascending', async () => {
        const source = edfSource({
            'b.edf': new Uint8Array(),
            'a.edf': new Uint8Array(),
            'a.EDF': new Uint8Array(),
            'notes.txt': new Uint8Array(),
            'c.hea': new Uint8Array(),
        });

        expect(await new EdfDatasetAdapter(source).listRecordIds()).toEqual(['a', 'b']);
    });

    it('yields nothing for a source holding no .edf file', async () => {
        const source = edfSource({ 'notes.txt': new Uint8Array() });

        expect(await new EdfDatasetAdapter(source).listRecordIds()).toEqual([]);
    });
});

describe('EdfDatasetAdapter error paths', () => {
    it('throws file-not-found when the .edf file is absent', async () => {
        const code = await promiseErrorCode(
            new EdfDatasetAdapter(edfSource({})).readRecord('missing'),
        );

        expect(code).toBe('file-not-found');
    });

    it('propagates a malformed header as malformed-header', async () => {
        const fixture = buildEdfFixture({ patch: { headerByteCount: '256' } });
        const code = await promiseErrorCode(
            new EdfDatasetAdapter(fixture.source).readRecord(fixture.recordId),
        );

        expect(code).toBe('malformed-header');
    });

    it('throws unsupported-format when two physiological signals share a label', async () => {
        const fixture = buildEdfFixture({ signals: [{ label: 'ECG' }, { label: 'ECG' }] });
        const code = await promiseErrorCode(
            new EdfDatasetAdapter(fixture.source).readRecord(fixture.recordId),
        );

        expect(code).toBe('unsupported-format');
    });

    it('throws unsupported-format when only the annotation signal is present', async () => {
        const fixture = buildEdfFixture({
            signals: [{ ...annotationSignal(), physicalDimension: '' }],
        });
        const code = await promiseErrorCode(
            new EdfDatasetAdapter(fixture.source).readRecord(fixture.recordId),
        );

        expect(code).toBe('unsupported-format');
    });
});

describe('EdfDatasetAdapter through the audited ADC -> mV step', () => {
    it('converts every digit with exactly the calibration the file declared', async () => {
        const digits = [1000, -1000, 777, 0];
        const fixture = buildEdfFixture({ records: [[digits]] });
        const record = await new EdfDatasetAdapter(fixture.source).readRecord(
            fixture.recordId,
        );
        const signal = recordToMillivoltSignal(record);
        const calibration = { gain: DEFAULT_GAIN, baseline: DEFAULT_BASELINE };

        expect(record.channels[0]?.calibration).toEqual(calibration);
        expect(signal.id).toBe('edf/record');
        expect(signal.channels[0]?.unit).toBe('mV');
        expect(signal.channels[0]?.data.length).toBe(digits.length);
        digits.forEach((digit, index) => {
            expect(signal.channels[0]?.data[index]).toBe(
                adcToMillivolt(digit, calibration),
            );
        });
        expect(signal.provenance.transforms.map((step) => step.name)).toContain(
            'adc-to-millivolt',
        );
    });
});
