/**
 * `parseEdfHeader` tests (Phase 18 item 6 / ADR-020).
 *
 * An EDF header *is* the contract: the declared physical and digital spans, the
 * record duration and the per-signal sample count together decide every number
 * the pipeline will ever see, and the data section itself is opaque bytes. So
 * these tests pin the parsed structure (including the field-major per-signal
 * layout, which a naive reader gets wrong), the derived rates and sizes, and
 * then — one test per documented refusal — the classification *and* the field
 * the message names. A refusal that cannot say which field was wrong is not
 * useful to anyone holding a real file.
 */
import { describe, expect, it } from 'vitest';

import { EcgError } from '../../../domain/error';
import { parseEdfHeader } from '../header';
import { annotationSignal, buildEdfFixture, type EdfFixture } from './support';

interface Refusal {
    readonly code: string;
    readonly message: string;
}

function errorOf(bytes: Uint8Array): EcgError {
    try {
        parseEdfHeader(bytes);
    } catch (error) {
        if (error instanceof EcgError) {
            return error;
        }
        throw error;
    }
    throw new Error('parseEdfHeader accepted a file it should have refused.');
}

/** Parse a fixture expecting a refusal, and report how it was classified. */
function refusedBy(fixture: EdfFixture): Refusal {
    const error = errorOf(fixture.bytes);
    return { code: error.code, message: error.message };
}

describe('parseEdfHeader structure', () => {
    it('parses a plain single-signal EDF file into its declared facts', () => {
        const header = parseEdfHeader(buildEdfFixture().bytes);

        expect(header.version).toBe('0');
        expect(header.patientId).toBe('X');
        expect(header.recordingId).toBe('');
        expect(header.startDate).toBe('01.01.20');
        expect(header.startTime).toBe('00.00.00');
        expect(header.reservedTag).toBe('');
        expect(header.format).toBe('EDF');
        expect(header.headerByteCount).toBe(512);
        expect(header.dataRecordCount).toBe(1);
        expect(header.dataRecords).toBe(1);
        expect(header.dataRecordDurationSec).toBe(1);
        expect(header.sampleRateHz).toBe(4);
        expect(header.recordSizeBytes).toBe(8);
        expect(header.signals).toEqual([
            {
                label: 'ECG',
                transducer: '',
                physicalDimension: 'mV',
                physicalMin: -1,
                physicalMax: 1,
                digitalMin: -1000,
                digitalMax: 1000,
                prefiltering: '',
                samplesPerDataRecord: 4,
                isAnnotation: false,
            },
        ]);
    });

    it('reads the per-signal block field-major, one field across every signal', () => {
        const fixture = buildEdfFixture({
            signals: [
                {
                    label: 'MLII',
                    transducer: 'Ag/AgCl',
                    prefiltering: 'HP 0.05Hz',
                    physicalMin: -5,
                    physicalMax: 5,
                    digitalMin: -2048,
                    digitalMax: 2047,
                },
                {
                    label: 'V5',
                    transducer: 'Ag/AgCl snap',
                    prefiltering: 'LP 40Hz',
                    physicalMin: -2,
                    physicalMax: 2,
                    digitalMin: 0,
                    digitalMax: 4095,
                },
            ],
        });
        const header = parseEdfHeader(fixture.bytes);

        expect(header.headerByteCount).toBe(768);
        expect(header.recordSizeBytes).toBe(16);
        expect(header.signals.map((signal) => signal.label)).toEqual(['MLII', 'V5']);
        expect(header.signals.map((signal) => signal.physicalMin)).toEqual([-5, -2]);
        expect(header.signals.map((signal) => signal.digitalMin)).toEqual([-2048, 0]);
        expect(header.signals.map((signal) => signal.digitalMax)).toEqual([2047, 4095]);
        expect(header.signals.map((signal) => signal.prefiltering)).toEqual([
            'HP 0.05Hz',
            'LP 40Hz',
        ]);
        expect(header.signals.map((signal) => signal.transducer)).toEqual([
            'Ag/AgCl',
            'Ag/AgCl snap',
        ]);
    });

    it('accepts the EDF+C reserved tag and keeps the tag as the file wrote it', () => {
        const upper = parseEdfHeader(buildEdfFixture({ reservedTag: 'EDF+C' }).bytes);
        expect(upper.format).toBe('EDF+C');
        expect(upper.reservedTag).toBe('EDF+C');

        const lower = parseEdfHeader(buildEdfFixture({ reservedTag: 'edf+c' }).bytes);
        expect(lower.format).toBe('EDF+C');
        expect(lower.reservedTag).toBe('edf+c');
    });

    it('trims every field, reading NUL padding as whitespace', () => {
        const fixture = buildEdfFixture({
            patientId: '  Patient A  ',
            patch: { 'signal.0.label': '\u0000\u0000MLII\u0000' },
        });
        const header = parseEdfHeader(fixture.bytes);

        expect(header.patientId).toBe('Patient A');
        expect(header.signals[0]?.label).toBe('MLII');
    });

    it('derives the record count from the bytes when the file declares -1', () => {
        const fixture = buildEdfFixture({
            dataRecordCount: -1,
            records: [
                [[1, 2, 3, 4]],
                [[5, 6, 7, 8]],
                [[9, 10, 11, 12]],
            ],
        });
        const header = parseEdfHeader(fixture.bytes);

        expect(header.dataRecordCount).toBe(-1);
        expect(header.dataRecords).toBe(3);
        expect(fixture.bytes.length).toBe(512 + 3 * 8);
    });

    it('splits a multi-record file at the declared record size', () => {
        const fixture = buildEdfFixture({
            records: [
                [[1, 2, 3, 4]],
                [[5, 6, 7, 8]],
            ],
        });
        const header = parseEdfHeader(fixture.bytes);

        expect(header.dataRecordCount).toBe(2);
        expect(header.dataRecords).toBe(2);
        expect(header.recordSizeBytes).toBe(8);
        expect(header.sampleRateHz).toBe(4);
    });

    it('derives the sample rate from the declared samples per record and duration', () => {
        const header = parseEdfHeader(
            buildEdfFixture({
                dataRecordDurationSec: 4,
                signals: [{ label: 'ECG', samplesPerDataRecord: 1000 }],
                records: [[new Array<number>(1000).fill(0)]],
            }).bytes,
        );

        expect(header.sampleRateHz).toBe(250);
        expect(header.recordSizeBytes).toBe(2000);
        expect(header.dataRecords).toBe(1);
    });

    it('recognises the EDF+ annotation signal by its exact label, exempting it from the mV check', () => {
        const fixture = buildEdfFixture({
            signals: [
                { label: 'MLII' },
                { ...annotationSignal(), physicalDimension: '' },
            ],
        });
        const header = parseEdfHeader(fixture.bytes);

        expect(header.signals.map((signal) => signal.isAnnotation)).toEqual([false, true]);
        expect(header.signals[1]?.label).toBe('EDF Annotations');
        expect(header.signals[1]?.physicalDimension).toBe('');
    });

    it('never inspects the data values, even when they exceed the declared range', () => {
        const header = parseEdfHeader(
            buildEdfFixture({ records: [[[5000, -3000, 1000, -1000]]] }).bytes,
        );

        expect(header.signals[0]?.digitalMin).toBe(-1000);
        expect(header.signals[0]?.digitalMax).toBe(1000);
        expect(header.dataRecords).toBe(1);
    });
});

describe('parseEdfHeader refusals', () => {
    it('refuses a file shorter than the 256-byte fixed header', () => {
        const refusal = refusedBy(buildEdfFixture({ truncateBytes: 300 }));

        expect(refusal.code).toBe('malformed-header');
        expect(refusal.message).toContain('holds 220 byte(s)');
        expect(refusal.message).toContain('256-byte fixed header');
    });

    it('refuses a version other than "0" as unsupported-format', () => {
        const refusal = refusedBy(buildEdfFixture({ patch: { version: '1' } }));

        expect(refusal.code).toBe('unsupported-format');
        expect(refusal.message).toContain('version "1"');
        expect(refusal.message).toContain('only version "0"');
    });

    it('refuses an EDF+D (discontinuous) file as unsupported-format', () => {
        const refusal = refusedBy(buildEdfFixture({ reservedTag: 'EDF+D' }));

        expect(refusal.code).toBe('unsupported-format');
        expect(refusal.message).toContain('"EDF+D"');
        expect(refusal.message).toContain('discontinuous');
    });

    it('refuses an unknown reserved tag as unsupported-format', () => {
        const refusal = refusedBy(buildEdfFixture({ reservedTag: 'EDF+X' }));

        expect(refusal.code).toBe('unsupported-format');
        expect(refusal.message).toContain('"EDF+X"');
        expect(refusal.message).toContain('neither blank');
    });

    it('refuses a blank signal count, naming the field', () => {
        const refusal = refusedBy(buildEdfFixture({ patch: { signalCount: '' } }));

        expect(refusal.code).toBe('malformed-header');
        expect(refusal.message).toContain('blank');
        expect(refusal.message).toContain('the number of signals');
    });

    it('refuses a file declaring no signals', () => {
        const refusal = refusedBy(buildEdfFixture({ signals: [] }));

        expect(refusal.code).toBe('malformed-header');
        expect(refusal.message).toContain('0 signal(s)');
    });

    it('refuses a header byte count that disagrees with the signal count', () => {
        const refusal = refusedBy(
            buildEdfFixture({ patch: { headerByteCount: '256' } }),
        );

        expect(refusal.code).toBe('malformed-header');
        expect(refusal.message).toContain('declares 256 header byte(s)');
        expect(refusal.message).toContain('256 x (signals + 1)');
    });

    it('refuses a non-numeric header byte count, naming the field', () => {
        const refusal = refusedBy(
            buildEdfFixture({ patch: { headerByteCount: 'abc' } }),
        );

        expect(refusal.code).toBe('malformed-header');
        expect(refusal.message).toContain('the number of bytes in the header record');
        expect(refusal.message).toContain('"abc"');
        expect(refusal.message).toContain('not a number');
    });

    it('refuses a file shorter than the header block it declares', () => {
        const refusal = refusedBy(buildEdfFixture({ truncateBytes: 100 }));

        expect(refusal.code).toBe('malformed-header');
        expect(refusal.message).toContain('declares 512 header byte(s)');
        expect(refusal.message).toContain('holds only 420 byte(s)');
    });

    it('refuses a non-integer samples-per-data-record, naming the signal', () => {
        const refusal = refusedBy(
            buildEdfFixture({ patch: { 'signal.0.samplesPerDataRecord': '2.5' } }),
        );

        expect(refusal.code).toBe('malformed-header');
        expect(refusal.message).toContain('signal 1 ("ECG")');
        expect(refusal.message).toContain('"2.5"');
        expect(refusal.message).toContain('not an integer');
    });

    it('refuses a non-positive samples-per-data-record', () => {
        const refusal = refusedBy(
            buildEdfFixture({ patch: { 'signal.0.samplesPerDataRecord': '0' } }),
        );

        expect(refusal.code).toBe('malformed-header');
        expect(refusal.message).toContain('0 sample(s) per data record');
        expect(refusal.message).toContain('at least one is required');
    });

    it('refuses a physical dimension other than mV', () => {
        const refusal = refusedBy(
            buildEdfFixture({
                signals: [{ label: 'ECG', physicalDimension: 'uV' }],
            }),
        );

        expect(refusal.code).toBe('unsupported-format');
        expect(refusal.message).toContain('physical dimension "uV"');
        expect(refusal.message).toContain('millivolts');
    });

    it('refuses a blank physical dimension on a physiological signal', () => {
        const refusal = refusedBy(
            buildEdfFixture({
                signals: [{ label: 'ECG', physicalDimension: '' }],
            }),
        );

        expect(refusal.code).toBe('unsupported-format');
        expect(refusal.message).toContain('signal 1 ("ECG")');
        expect(refusal.message).toContain('millivolts');
    });

    it('refuses a non-positive physical span', () => {
        const refusal = refusedBy(
            buildEdfFixture({
                signals: [{ label: 'ECG', physicalMin: 1, physicalMax: 1 }],
            }),
        );

        expect(refusal.code).toBe('malformed-header');
        expect(refusal.message).toContain('a span of 0');
        expect(refusal.message).toContain('positive physical span');
    });

    it('refuses a non-positive digital span', () => {
        const refusal = refusedBy(
            buildEdfFixture({
                signals: [{ label: 'ECG', digitalMin: 1000, digitalMax: -1000 }],
            }),
        );

        expect(refusal.code).toBe('malformed-header');
        expect(refusal.message).toContain('a span of -2000');
        expect(refusal.message).toContain('positive digital span');
    });

    it('refuses a non-positive data-record duration', () => {
        const refusal = refusedBy(buildEdfFixture({ dataRecordDurationSec: 0 }));

        expect(refusal.code).toBe('malformed-header');
        expect(refusal.message).toContain('duration of 0 second(s)');
        expect(refusal.message).toContain('positive duration');
    });

    it('refuses signals whose derived sample rates disagree', () => {
        const refusal = refusedBy(
            buildEdfFixture({
                signals: [
                    { label: 'MLII', samplesPerDataRecord: 4 },
                    { label: 'V5', samplesPerDataRecord: 8 },
                ],
            }),
        );

        expect(refusal.code).toBe('unsupported-format');
        expect(refusal.message).toContain('sample rates disagree');
        expect(refusal.message).toContain('4 Hz ("MLII")');
        expect(refusal.message).toContain('8 Hz ("V5")');
    });

    it('refuses a declared record count the data section does not hold', () => {
        const refusal = refusedBy(buildEdfFixture({ dataRecordCount: 2 }));

        expect(refusal.code).toBe('malformed-header');
        expect(refusal.message).toContain('declares 2 data record(s)');
        expect(refusal.message).toContain('holds 8 byte(s)');
    });

    it('refuses a declared record count below -1', () => {
        const refusal = refusedBy(
            buildEdfFixture({ patch: { dataRecordCount: '-2' } }),
        );

        expect(refusal.code).toBe('malformed-header');
        expect(refusal.message).toContain('-2 data record(s)');
        expect(refusal.message).toContain('only -1 (unknown)');
    });

    it('refuses an unknown record count whose data section is not whole records', () => {
        const refusal = refusedBy(
            buildEdfFixture({ dataRecordCount: -1, trailingBytes: 1 }),
        );

        expect(refusal.code).toBe('malformed-header');
        expect(refusal.message).toContain('not a whole number of 8-byte data records');
    });
});
