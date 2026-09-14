/**
 * `MitBihDatasetAdapter` end-to-end tests (Phase 5 / ADR-006).
 *
 * A tiny, fully synthetic format-212 record is assembled from a `.hea` header
 * and an encoded `.dat`; the adapter must turn it into a canonical
 * `SignalRecord` (raw ADC + calibration metadata), read each shared data file
 * exactly once, degrade a missing `.atr` to no annotations, and classify the
 * documented error paths.
 */
import { describe, expect, it } from 'vitest';

import { EcgError } from '../../../domain/error';
import { encodeFormat212 } from '../format212';
import { MitBihDatasetAdapter, MIT_BIH_DATASET_ID } from '../adapter';
import { InMemoryFileSource } from '../../source';
import { recordToMillivoltSignal } from '../../load';

const HEADER_900 = [
    '900 2 360 6',
    '900.dat 212 200 11 1024 995 0 0 MLII',
    '900.dat 212 200 11 1024 1011 0 0 V5',
    '# synthetic fixture record 900',
].join('\n');

const CH0 = Int16Array.from([995, 1000, 1024, 1000, 995, 1024]);
const CH1 = Int16Array.from([1011, 1011, 1024, 1011, 1011, 1024]);

function pairBytes(pairs: readonly (readonly [number, number])[]): Uint8Array {
    const bytes = new Uint8Array(pairs.length * 2);
    pairs.forEach((pair, index) => {
        bytes[2 * index] = pair[0];
        bytes[2 * index + 1] = pair[1];
    });
    return bytes;
}

/** Counts binary reads so we can prove each data file is decoded exactly once. */
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

describe('MitBihDatasetAdapter readRecord', () => {
    it('materialises a tiny format-212 record into a canonical SignalRecord', async () => {
        const source = new CountingFileSource({
            '900.hea': { text: HEADER_900 },
            '900.dat': { bytes: encodeFormat212(CH0, CH1) },
        });
        const adapter = new MitBihDatasetAdapter(source);
        const record = await adapter.readRecord('900');

        expect(adapter.datasetId).toBe(MIT_BIH_DATASET_ID);
        expect(record.identity).toEqual({
            datasetId: 'mit-bih-arrhythmia',
            recordId: '900',
        });
        expect(record.subjectId).toBe('900');
        expect(record.sampling.sampleRateHz).toBe(360);
        expect(record.sampleCount).toBe(6);
        expect(record.channels).toHaveLength(2);
        expect(record.comments).toEqual(['# synthetic fixture record 900']);
        expect(record.annotations).toEqual([]);
        expect(record.provenance).toEqual({
            source: 'mit-bih-arrhythmia/900',
            transforms: [],
        });
    });

    it('maps header descriptors to channels with mV calibration metadata', async () => {
        const source = new InMemoryFileSource({
            '900.hea': { text: HEADER_900 },
            '900.dat': { bytes: encodeFormat212(CH0, CH1) },
        });
        const record = await new MitBihDatasetAdapter(source).readRecord('900');

        const channel0 = record.channels[0];
        const channel1 = record.channels[1];
        expect(channel0?.name).toBe('MLII');
        expect(channel1?.name).toBe('V5');
        expect(channel0?.physicalUnit).toBe('mV');
        expect(channel1?.physicalUnit).toBe('mV');
        expect(channel0?.calibration).toEqual({ gain: 200, baseline: 1024 });
        expect(channel1?.calibration).toEqual({ gain: 200, baseline: 1024 });
        expect(channel0?.adcZero).toBe(1024);
        expect(channel0?.adcResolutionBits).toBe(11);
        expect(channel0?.initialValue).toBe(995);
        expect(channel1?.initialValue).toBe(1011);
        expect(channel0?.sourceFormat).toBe('212');
        expect(Array.from(channel0?.samples ?? new Int16Array())).toEqual(
            Array.from(CH0),
        );
        expect(Array.from(channel1?.samples ?? new Int16Array())).toEqual(
            Array.from(CH1),
        );
    });

    it('decodes each shared data file exactly once', async () => {
        const source = new CountingFileSource({
            '900.hea': { text: HEADER_900 },
            '900.dat': { bytes: encodeFormat212(CH0, CH1) },
        });
        await new MitBihDatasetAdapter(source).readRecord('900');
        expect(source.binaryReads.get('900.dat')).toBe(1);
    });

    it('reads annotations by default and omits them with withAnnotations:false', async () => {
        const base = {
            '900.hea': { text: HEADER_900 },
            '900.dat': { bytes: encodeFormat212(CH0, CH1) },
            // One 'N' beat at sample 3.
            '900.atr': { bytes: pairBytes([[3, 4], [0, 0]]) },
        };
        const withAnnotations = await new MitBihDatasetAdapter(
            new InMemoryFileSource(base),
        ).readRecord('900');
        expect(withAnnotations.annotations).toEqual([
            { sampleIndex: 3, code: 1, symbol: 'N', auxNote: '' },
        ]);

        const without = await new MitBihDatasetAdapter(
            new InMemoryFileSource(base),
        ).readRecord('900', { withAnnotations: false });
        expect(without.annotations).toEqual([]);
    });

    it('converts the record through the audited ADC -> mV step', async () => {
        const source = new InMemoryFileSource({
            '900.hea': { text: HEADER_900 },
            '900.dat': { bytes: encodeFormat212(CH0, CH1) },
        });
        const record = await new MitBihDatasetAdapter(source).readRecord('900');
        const signal = recordToMillivoltSignal(record);

        expect(signal.id).toBe('mit-bih-arrhythmia/900');
        expect(signal.channels[0]?.unit).toBe('mV');
        expect(signal.channels[0]?.data[0]).toBeCloseTo((995 - 1024) / 200, 12);
        expect(signal.channels[0]?.data[1]).toBeCloseTo((1000 - 1024) / 200, 12);
        expect(signal.channels[0]?.data[2]).toBe(0);
        expect(
            signal.provenance.transforms.map((step) => step.name),
        ).toContain('adc-to-millivolt');
    });
});

describe('MitBihDatasetAdapter error paths', () => {
    it('returns the canonical list from RECORDS', async () => {
        const source = new InMemoryFileSource({
            RECORDS: { text: '900\n' },
        });
        expect(await new MitBihDatasetAdapter(source).listRecordIds()).toEqual([
            '900',
        ]);
    });

    it('throws file-not-found when the .hea file is absent', async () => {
        const adapter = new MitBihDatasetAdapter(new InMemoryFileSource({}));
        expect(await promiseErrorCode(adapter.readRecord('900'))).toBe(
            'file-not-found',
        );
    });

    it('throws malformed-header when the header declares a different record', async () => {
        const mismatchHeader = HEADER_900.replace('900 2 360 6', '901 2 360 6');
        const source = new InMemoryFileSource({
            '900.hea': { text: mismatchHeader },
        });
        const adapter = new MitBihDatasetAdapter(source);
        expect(await promiseErrorCode(adapter.readRecord('900'))).toBe(
            'malformed-header',
        );
    });

    it('throws unsupported-format for a header with an unrecognised encoding', async () => {
        const unsupported = HEADER_900.replace('900.dat 212', '900.dat 80');
        const source = new InMemoryFileSource({
            '900.hea': { text: unsupported },
        });
        const adapter = new MitBihDatasetAdapter(source);
        expect(await promiseErrorCode(adapter.readRecord('900'))).toBe(
            'unsupported-format',
        );
    });

    it('throws annotation-parse-error for a malformed .atr file', async () => {
        const source = new InMemoryFileSource({
            '900.hea': { text: HEADER_900 },
            '900.dat': { bytes: encodeFormat212(CH0, CH1) },
            '900.atr': { bytes: Uint8Array.from([1]) }, // odd byte length.
        });
        const adapter = new MitBihDatasetAdapter(source);
        expect(await promiseErrorCode(adapter.readRecord('900'))).toBe(
            'annotation-parse-error',
        );
    });
});
