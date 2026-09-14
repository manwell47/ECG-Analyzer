/**
 * Hermetic EDF / EDF+ fixture builder (Phase 18 item 6 / ADR-020).
 *
 * EDF is a byte-exact binary format, so a fixture cannot be a readable string
 * constant the way a WFDB `.hea` can: the 256-byte fixed header and the
 * field-major per-signal block have to be laid out at exact offsets. This
 * builder does that layout explicitly, in one place, so every test file states
 * only what it is actually testing (a label, a span, a record count) and never
 * repeats byte arithmetic.
 *
 * It mirrors `header.ts` on purpose — same field order, same widths — so a
 * fixture asserts the parser against the format as specified rather than
 * against a helper that shares the parser's own mistakes. Nothing here imports
 * a parser function; the widths below are the EDF spec's own numbers.
 *
 * The defaults are chosen for round arithmetic, not for physiological
 * realism: one 4-sample data record of one second (4 Hz), one signal labelled
 * `ECG`, physical span `-1 .. 1` mV over digital span `-1000 .. 1000`, which
 * derives `gain = 1000` and `baseline = 0`. Every default can be overridden,
 * and `patch` writes raw ASCII over any single field afterwards, which is how
 * the refusal tests state exactly one wrong thing about an otherwise valid
 * file.
 */
import { InMemoryFileSource, type InMemoryFileEntry } from '../../source';
import { EDF_FIXED_HEADER_BYTES, EDF_ANNOTATION_LABEL } from '../header';

/** Default samples one signal stores in a data record. */
export const DEFAULT_SAMPLES_PER_RECORD = 4;

/** Default duration of one data record, in seconds (so the default rate is 4 Hz). */
export const DEFAULT_DURATION_SEC = 1;

/** Default declared physical minimum, in mV. */
export const DEFAULT_PHYSICAL_MIN = -1;

/** Default declared physical maximum, in mV. */
export const DEFAULT_PHYSICAL_MAX = 1;

/** Default declared digital minimum. */
export const DEFAULT_DIGITAL_MIN = -1000;

/** Default declared digital maximum. */
export const DEFAULT_DIGITAL_MAX = 1000;

/**
 * Gain the defaults derive: `(1000 - -1000) / (1 - -1) = 1000`.
 * Exported so tests assert a *derived* number, never a copied one.
 */
export const DEFAULT_GAIN = 1000;

/** Baseline the defaults derive: `-1000 - (-1 x 1000) = 0`. */
export const DEFAULT_BASELINE = 0;

/** Record id of the file name the fixture serves by default. */
export const FIXTURE_RECORD_ID = 'record';

/** File name the fixture serves by default. */
export const FIXTURE_FILE_NAME = `${FIXTURE_RECORD_ID}.edf`;

/** One fixed-header field: its byte offset, width and ASCII name. */
const FIXED_FIELDS = [
    { name: 'version', offset: 0, width: 8 },
    { name: 'patientId', offset: 8, width: 80 },
    { name: 'recordingId', offset: 88, width: 80 },
    { name: 'startDate', offset: 168, width: 8 },
    { name: 'startTime', offset: 176, width: 8 },
    { name: 'headerByteCount', offset: 184, width: 8 },
    { name: 'reservedTag', offset: 192, width: 44 },
    { name: 'dataRecordCount', offset: 236, width: 8 },
    { name: 'dataRecordDurationSec', offset: 244, width: 8 },
    { name: 'signalCount', offset: 252, width: 4 },
] as const;

/** One per-signal field's byte width (the parser's own table, restated). */
const SIGNAL_FIELD_WIDTH: Readonly<Record<string, number>> = {
    label: 16,
    transducer: 80,
    physicalDimension: 8,
    physicalMin: 8,
    physicalMax: 8,
    digitalMin: 8,
    digitalMax: 8,
    prefiltering: 80,
    samplesPerDataRecord: 8,
    reserved: 32,
};

/**
 * Per-signal field order. EDF is field-major: every signal's label comes
 * before any signal's dimension, so this order *is* the layout.
 */
const SIGNAL_FIELD_ORDER: readonly string[] = [
    'label',
    'transducer',
    'physicalDimension',
    'physicalMin',
    'physicalMax',
    'digitalMin',
    'digitalMax',
    'prefiltering',
    'samplesPerDataRecord',
    'reserved',
];

/** A signal's declared facts; every field falls back to the default above. */
export interface EdfSignalSpec {
    readonly label?: string;
    readonly transducer?: string;
    readonly physicalDimension?: string;
    readonly physicalMin?: number;
    readonly physicalMax?: number;
    readonly digitalMin?: number;
    readonly digitalMax?: number;
    readonly prefiltering?: string;
    readonly samplesPerDataRecord?: number;
}

/** Everything a fixture can state; omitted fields take the defaults. */
export interface EdfFixtureSpec {
    readonly version?: string;
    readonly patientId?: string;
    readonly recordingId?: string;
    readonly startDate?: string;
    readonly startTime?: string;
    /** Reserved-field tag: `''` (plain EDF) by default, else `'EDF+C'`. */
    readonly reservedTag?: string;
    /** Data-record count to declare; defaults to the records actually built. */
    readonly dataRecordCount?: number;
    readonly dataRecordDurationSec?: number;
    /** One signal by default; pass `[]` to declare none. */
    readonly signals?: readonly EdfSignalSpec[];
    /**
     * Sample values as `[record][signal][sample]`. Defaults to one record of
     * zeroes for every signal (which still occupies its declared bytes).
     */
    readonly records?: readonly (readonly (readonly number[])[])[];
    /**
     * Raw ASCII written over a field after the layout, keyed by fixed field
     * name (`'headerByteCount'`) or `'signal.<index>.<field>'`. An unknown key
     * throws, so a typo cannot quietly do nothing.
     */
    readonly patch?: Readonly<Record<string, string>>;
    /** Extra bytes appended after the data section. */
    readonly trailingBytes?: number;
    /** Bytes removed from the end of the assembled file. */
    readonly truncateBytes?: number;
    /** File name to serve from `source`; default `'record.edf'`. */
    readonly fileName?: string;
}

/** An assembled fixture plus the facts it declared. */
export interface EdfFixture {
    /** The assembled bytes, after any trailing/truncation knob. */
    readonly bytes: Uint8Array;
    /** The file name this fixture is served under. */
    readonly fileName: string;
    /** Record id derived from `fileName` (its stem). */
    readonly recordId: string;
    readonly signalCount: number;
    /** `256 x (signals + 1)`, as a file would declare it. */
    readonly headerByteCount: number;
    /** Bytes one data record occupies. */
    readonly recordSizeBytes: number;
    /** Records actually laid out in the data section. */
    readonly dataRecords: number;
    /** The count the header declares (may differ, for refusal tests). */
    readonly declaredDataRecordCount: number;
    readonly dataRecordDurationSec: number;
    readonly samplesPerDataRecord: readonly number[];
    /** A source serving exactly these bytes under `fileName`. */
    readonly source: InMemoryFileSource;
}

/** Write `text` as 7-bit ASCII into a fixed-width field, space-padded. */
function writeAscii(
    target: Uint8Array,
    offset: number,
    width: number,
    text: string,
): void {
    for (let index = 0; index < width; index += 1) {
        target[offset + index] = index < text.length ? text.charCodeAt(index) : 0x20;
    }
}

/** Byte offset of every per-signal field block, field-major. */
function signalFieldOffsets(
    signalCount: number,
): Readonly<Record<string, number>> {
    const offsets: Record<string, number> = {};
    let cursor = EDF_FIXED_HEADER_BYTES;
    for (const name of SIGNAL_FIELD_ORDER) {
        offsets[name] = cursor;
        cursor += (SIGNAL_FIELD_WIDTH[name] ?? 0) * signalCount;
    }
    return offsets;
}

/** Write one signal's field, given the field-major offsets. */
function writeSignalField(
    target: Uint8Array,
    offsets: Readonly<Record<string, number>>,
    name: string,
    index: number,
    text: string,
): void {
    const width = SIGNAL_FIELD_WIDTH[name] ?? 0;
    writeAscii(target, (offsets[name] ?? 0) + index * width, width, text);
}

/** One data record of zeroes matching the declared per-signal sample counts. */
function zeroRecord(samplesPerDataRecord: readonly number[]): number[][] {
    return samplesPerDataRecord.map((count) => new Array<number>(count).fill(0));
}

/** Write `[record][signal][sample]` as little-endian signed 16-bit integers. */
function writeRecords(
    target: Uint8Array,
    offset: number,
    records: readonly (readonly (readonly number[])[])[],
    samplesPerDataRecord: readonly number[],
): void {
    const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
    let cursor = offset;
    for (const record of records) {
        for (let signal = 0; signal < samplesPerDataRecord.length; signal += 1) {
            const values = record[signal] ?? [];
            const count = samplesPerDataRecord[signal] ?? 0;
            for (let sample = 0; sample < count; sample += 1) {
                view.setInt16(cursor, values[sample] ?? 0, true);
                cursor += 2;
            }
        }
    }
}

/** Apply the raw-field overrides, refusing a key that names no field. */
function applyPatch(
    target: Uint8Array,
    offsets: Readonly<Record<string, number>>,
    patch: Readonly<Record<string, string>>,
): void {
    for (const [key, text] of Object.entries(patch)) {
        const signalMatch = /^signal\.(\d+)\.([A-Za-z]+)$/.exec(key);
        if (signalMatch !== null) {
            const index = Number(signalMatch[1] ?? '');
            const name = signalMatch[2] ?? '';
            if (!SIGNAL_FIELD_ORDER.includes(name)) {
                throw new Error(`EDF fixture patch names no signal field: "${key}".`);
            }
            writeSignalField(target, offsets, name, index, text);
            continue;
        }
        const field = FIXED_FIELDS.find((candidate) => candidate.name === key);
        if (field === undefined) {
            throw new Error(`EDF fixture patch names no fixed field: "${key}".`);
        }
        writeAscii(target, field.offset, field.width, text);
    }
}

/** Serve raw byte blobs as the files of an in-memory source. */
export function edfSource(
    entries: Readonly<Record<string, Uint8Array>>,
): InMemoryFileSource {
    const files: Record<string, InMemoryFileEntry> = {};
    for (const [name, bytes] of Object.entries(entries)) {
        files[name] = { bytes };
    }
    return new InMemoryFileSource(files);
}

/**
 * Assemble one EDF / EDF+ file and serve it from an in-memory source.
 *
 * The returned `bytes` are the same bytes `source` serves, so a test can parse
 * the header directly and still read the record through the adapter.
 */
export function buildEdfFixture(spec: EdfFixtureSpec = {}): EdfFixture {
    const signals = spec.signals ?? [{ label: 'ECG' }];
    const signalCount = signals.length;
    const headerByteCount = EDF_FIXED_HEADER_BYTES * (signalCount + 1);
    const samplesPerDataRecord = signals.map(
        (signal) => signal.samplesPerDataRecord ?? DEFAULT_SAMPLES_PER_RECORD,
    );
    const recordSizeBytes =
        samplesPerDataRecord.reduce((total, count) => total + count, 0) * 2;

    const records = spec.records ?? [zeroRecord(samplesPerDataRecord)];
    const dataRecords = records.length;
    const declaredDataRecordCount = spec.dataRecordCount ?? dataRecords;
    const dataRecordDurationSec =
        spec.dataRecordDurationSec ?? DEFAULT_DURATION_SEC;

    const bytes = new Uint8Array(
        headerByteCount + dataRecords * recordSizeBytes,
    );

    const fixed: Record<string, string> = {
        version: spec.version ?? '0',
        patientId: spec.patientId ?? 'X',
        recordingId: spec.recordingId ?? '',
        startDate: spec.startDate ?? '01.01.20',
        startTime: spec.startTime ?? '00.00.00',
        headerByteCount: String(headerByteCount),
        reservedTag: spec.reservedTag ?? '',
        dataRecordCount: String(declaredDataRecordCount),
        dataRecordDurationSec: String(dataRecordDurationSec),
        signalCount: String(signalCount),
    };
    for (const field of FIXED_FIELDS) {
        writeAscii(bytes, field.offset, field.width, fixed[field.name] ?? '');
    }

    const offsets = signalFieldOffsets(signalCount);
    signals.forEach((signal, index) => {
        writeSignalField(bytes, offsets, 'label', index, signal.label ?? '');
        writeSignalField(bytes, offsets, 'transducer', index, signal.transducer ?? '');
        writeSignalField(
            bytes,
            offsets,
            'physicalDimension',
            index,
            signal.physicalDimension ?? 'mV',
        );
        writeSignalField(
            bytes,
            offsets,
            'physicalMin',
            index,
            String(signal.physicalMin ?? DEFAULT_PHYSICAL_MIN),
        );
        writeSignalField(
            bytes,
            offsets,
            'physicalMax',
            index,
            String(signal.physicalMax ?? DEFAULT_PHYSICAL_MAX),
        );
        writeSignalField(
            bytes,
            offsets,
            'digitalMin',
            index,
            String(signal.digitalMin ?? DEFAULT_DIGITAL_MIN),
        );
        writeSignalField(
            bytes,
            offsets,
            'digitalMax',
            index,
            String(signal.digitalMax ?? DEFAULT_DIGITAL_MAX),
        );
        writeSignalField(
            bytes,
            offsets,
            'prefiltering',
            index,
            signal.prefiltering ?? '',
        );
        writeSignalField(
            bytes,
            offsets,
            'samplesPerDataRecord',
            index,
            String(signal.samplesPerDataRecord ?? DEFAULT_SAMPLES_PER_RECORD),
        );
        writeSignalField(bytes, offsets, 'reserved', index, '');
    });

    writeRecords(bytes, headerByteCount, records, samplesPerDataRecord);
    applyPatch(bytes, offsets, spec.patch ?? {});

    const trailingBytes = spec.trailingBytes ?? 0;
    let result: Uint8Array = bytes;
    if (trailingBytes > 0) {
        const extended = new Uint8Array(bytes.length + trailingBytes);
        extended.set(bytes, 0);
        result = extended;
    }
    const truncateBytes = spec.truncateBytes ?? 0;
    if (truncateBytes > 0) {
        result = result.subarray(0, Math.max(0, result.length - truncateBytes));
    }

    const fileName = spec.fileName ?? FIXTURE_FILE_NAME;
    const dot = fileName.lastIndexOf('.');

    return {
        bytes: result,
        fileName,
        recordId: dot > 0 ? fileName.slice(0, dot) : fileName,
        signalCount,
        headerByteCount,
        recordSizeBytes,
        dataRecords,
        declaredDataRecordCount,
        dataRecordDurationSec,
        samplesPerDataRecord,
        source: edfSource({ [fileName]: result }),
    };
}

/** A signal spec that declares the EDF+ annotation channel. */
export function annotationSignal(): EdfSignalSpec {
    return { label: EDF_ANNOTATION_LABEL };
}
