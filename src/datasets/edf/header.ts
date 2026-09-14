/**
 * EDF / EDF+ fixed-header parser (Phase 18 item 6 / ADR-020, architecture §J).
 *
 * An EDF file opens with a 256-byte fixed header followed by one 256-byte
 * *field-major* block per signal: every signal's label, then every signal's
 * physical dimension, then every signal's physical minimum, and so on. That
 * layout is read here verbatim — nothing is inferred from the data section
 * except the one thing EDF itself leaves open: a declared data-record count of
 * `-1` ("unknown"), whose real count is derived from the bytes actually present
 * and must divide the data-record size exactly.
 *
 * The parser is pure (bytes in, structure out) and refuses rather than invents,
 * so the canonical `SignalRecord` it feeds only ever sees numbers the file
 * declared. Every refusal is classified (ADR-020):
 *
 * - `malformed-header` — a blank or non-numeric field, a signal count that is
 *   not positive, a header byte count disagreeing with the signal count, a
 *   non-positive samples-per-data-record, a non-positive physical or digital
 *   span, a non-positive record duration, a data section that is not a whole
 *   number of data records, or a data-record count below `-1`;
 * - `unsupported-format` — a version other than `"0"`, a reserved tag that is
 *   neither blank nor `EDF+C`/`EDF+D`, an `EDF+D` (discontinuous) file, a
 *   physical dimension other than `mV` on a physiological signal, or signals
 *   whose derived sample rates disagree (the canonical `SamplingInfo` is
 *   single-rate for the whole record).
 *
 * `EDF Annotations` is recognised by its exact label so the adapter can exclude
 * it from the channels; it declares no physical dimension, so it is exempt from
 * the dimension check. EDF is a 7-bit ASCII format: bytes are decoded one to
 * one (a NUL is read as padding whitespace), and every field is trimmed.
 */
import { EcgError } from '../../domain/error';

/** Length of the fixed header that opens every EDF file, in bytes. */
export const EDF_FIXED_HEADER_BYTES = 256;

/** Length of one signal's header block, in bytes (one block per signal). */
export const EDF_SIGNAL_HEADER_BYTES = 256;

/** The exact label EDF+ gives its annotation-only signal. */
export const EDF_ANNOTATION_LABEL = 'EDF Annotations';

/** The continuous EDF/EDF+ variants this parser accepts. */
export type EdfFormat = 'EDF' | 'EDF+C';

/** One signal's declared header facts, exactly as the file states them. */
export interface EdfSignalDescriptor {
    /** Signal label, trimmed (e.g. `'MLII'`, `'EDF Annotations'`). */
    readonly label: string;
    /** Transducer type string, trimmed (advisory; may be empty). */
    readonly transducer: string;
    /** Declared physical dimension, trimmed (e.g. `'mV'`). */
    readonly physicalDimension: string;
    /** Lowest declared physical value. */
    readonly physicalMin: number;
    /** Highest declared physical value. */
    readonly physicalMax: number;
    /** Lowest declared digital value. */
    readonly digitalMin: number;
    /** Highest declared digital value. */
    readonly digitalMax: number;
    /** Pre-filtering description, trimmed (advisory; may be empty). */
    readonly prefiltering: string;
    /** Samples this signal stores in one data record (always > 0). */
    readonly samplesPerDataRecord: number;
    /** Whether this signal is the EDF+ annotation channel, not a waveform. */
    readonly isAnnotation: boolean;
}

/** A parsed, validated EDF/EDF+ header plus the resolved data-section layout. */
export interface EdfHeader {
    readonly version: string;
    /** Patient identification field, trimmed (may be empty or `'X'`). */
    readonly patientId: string;
    /** Recording identification field, trimmed (may be empty). */
    readonly recordingId: string;
    /** Start date as declared, `dd.mm.yy`, trimmed. */
    readonly startDate: string;
    /** Start time as declared, `hh.mm.ss`, trimmed. */
    readonly startTime: string;
    /** Reserved-field tag as declared (`''`, `'EDF+C'` or `'EDF+D'`), trimmed. */
    readonly reservedTag: string;
    /** Resolved continuous variant: `'EDF'` for a blank tag, else `'EDF+C'`. */
    readonly format: EdfFormat;
    /** Declared header length in bytes (always `256 x (signals + 1)`). */
    readonly headerByteCount: number;
    /** Data-record count as declared (`-1` means "unknown"). */
    readonly dataRecordCount: number;
    /** Resolved data-record count, derived from the bytes when declared `-1`. */
    readonly dataRecords: number;
    /** Declared duration of one data record, in seconds. */
    readonly dataRecordDurationSec: number;
    /** Derived rate shared by every signal: samples-per-record / duration. */
    readonly sampleRateHz: number;
    /** Bytes one data record occupies (`sum(samplesPerDataRecord) x 2`). */
    readonly recordSizeBytes: number;
    /** One descriptor per declared signal, in declaration order. */
    readonly signals: readonly EdfSignalDescriptor[];
}

/** One field of the field-major per-signal block, with its byte width. */
const SIGNAL_FIELDS = [
    { name: 'label', width: 16 },
    { name: 'transducer', width: 80 },
    { name: 'physicalDimension', width: 8 },
    { name: 'physicalMin', width: 8 },
    { name: 'physicalMax', width: 8 },
    { name: 'digitalMin', width: 8 },
    { name: 'digitalMax', width: 8 },
    { name: 'prefiltering', width: 80 },
    { name: 'samplesPerDataRecord', width: 8 },
    { name: 'reserved', width: 32 },
] as const;

type EdfSignalFieldName = (typeof SIGNAL_FIELDS)[number]['name'];

/**
 * Byte offset of every per-signal field's block, given the signal count.
 * Offsets are field-major: a field's block spans every signal before the next
 * field's block begins.
 */
function fieldOffsets(
    signalCount: number,
): Readonly<Record<EdfSignalFieldName, number>> {
    const offsets = {} as Record<EdfSignalFieldName, number>;
    let cursor = EDF_FIXED_HEADER_BYTES;
    for (const field of SIGNAL_FIELDS) {
        offsets[field.name] = cursor;
        cursor += field.width * signalCount;
    }
    return offsets;
}

/** Decode a byte range as the 7-bit ASCII text EDF is defined in. */
function readAscii(bytes: Uint8Array, start: number, length: number): string {
    const end = Math.min(start + length, bytes.length);
    let text = '';
    for (let index = start; index < end; index += 1) {
        const byte = bytes[index] ?? 0;
        // A NUL is padding, not data: read it as a space so trimming removes it
        // instead of leaving it inside a label or a numeric field.
        text += byte === 0 ? ' ' : String.fromCharCode(byte);
    }
    return text.trim();
}

/** Parse a required numeric field, naming it (and its signal) when it fails. */
function requiredNumber(token: string, field: string, where: string): number {
    if (token.length === 0) {
        throw EcgError.malformedHeader(
            `EDF ${where} declares a blank ${field} field.`,
            { meta: { field, where } },
        );
    }
    const value = Number(token);
    if (!Number.isFinite(value)) {
        throw EcgError.malformedHeader(
            `EDF ${where} declares ${field} ${JSON.stringify(token)}, ` +
            'which is not a number.',
            { meta: { field, where, declared: token } },
        );
    }
    return value;
}

/** Parse a required integer field (EDF's counts and spans are integers). */
function requiredInteger(token: string, field: string, where: string): number {
    const value = requiredNumber(token, field, where);
    if (!Number.isSafeInteger(value)) {
        throw EcgError.malformedHeader(
            `EDF ${where} declares ${field} ${JSON.stringify(token)}, ` +
            'which is not an integer.',
            { meta: { field, where, declared: token } },
        );
    }
    return value;
}

/** Resolve the reserved-field tag, refusing discontinuity and unknown tags. */
function formatOf(reservedTag: string): EdfFormat {
    const token = reservedTag.toUpperCase();
    if (token.length === 0) {
        return 'EDF';
    }
    if (token === 'EDF+C') {
        return 'EDF+C';
    }
    if (token === 'EDF+D') {
        throw EcgError.unsupportedFormat(
            'EDF file declares the reserved tag "EDF+D", a discontinuous ' +
            'recording whose inter-record gaps cannot be represented by the ' +
            'canonical single-timeline SamplingInfo.',
            { meta: { reserved: reservedTag } },
        );
    }
    throw EcgError.unsupportedFormat(
        `EDF file declares the reserved tag ${JSON.stringify(reservedTag)}, ` +
        'which is neither blank (plain EDF) nor "EDF+C"/"EDF+D".',
        { meta: { reserved: reservedTag } },
    );
}

/**
 * Parse the fixed header and the field-major per-signal block of an EDF/EDF+
 * file, validating the data-section layout against the bytes actually present.
 */
export function parseEdfHeader(bytes: Uint8Array): EdfHeader {
    if (bytes.length < EDF_FIXED_HEADER_BYTES) {
        throw EcgError.malformedHeader(
            `EDF file holds ${bytes.length} byte(s), fewer than the ` +
            `${EDF_FIXED_HEADER_BYTES}-byte fixed header.`,
            { meta: { byteLength: bytes.length } },
        );
    }

    const version = readAscii(bytes, 0, 8);
    if (version !== '0') {
        throw EcgError.unsupportedFormat(
            `EDF file declares version ${JSON.stringify(version)}; only ` +
            'version "0" (EDF and EDF+) is recognized.',
            { meta: { version } },
        );
    }

    const patientId = readAscii(bytes, 8, 80);
    const recordingId = readAscii(bytes, 88, 80);
    const startDate = readAscii(bytes, 168, 8);
    const startTime = readAscii(bytes, 176, 8);
    const reservedTag = readAscii(bytes, 192, 44);
    const format = formatOf(reservedTag);

    const signalCount = requiredInteger(
        readAscii(bytes, 252, 4),
        'the number of signals',
        'the file',
    );
    if (signalCount <= 0) {
        throw EcgError.malformedHeader(
            `EDF file declares ${signalCount} signal(s); at least one signal ` +
            'header block is required.',
            { meta: { signalCount } },
        );
    }

    const headerByteCount = requiredInteger(
        readAscii(bytes, 184, 8),
        'the number of bytes in the header record',
        'the file',
    );
    const expectedHeaderByteCount = EDF_FIXED_HEADER_BYTES * (signalCount + 1);
    if (headerByteCount !== expectedHeaderByteCount) {
        throw EcgError.malformedHeader(
            `EDF file declares ${headerByteCount} header byte(s) for ` +
            `${signalCount} signal(s), but ${signalCount} signal block(s) ` +
            `require ${expectedHeaderByteCount} (256 x (signals + 1)).`,
            { meta: { headerByteCount, expectedHeaderByteCount, signalCount } },
        );
    }
    if (bytes.length < headerByteCount) {
        throw EcgError.malformedHeader(
            `EDF file declares ${headerByteCount} header byte(s) but holds ` +
            `only ${bytes.length} byte(s).`,
            { meta: { headerByteCount, byteLength: bytes.length } },
        );
    }

    const offsets = fieldOffsets(signalCount);
    const signals: EdfSignalDescriptor[] = [];
    for (let index = 0; index < signalCount; index += 1) {
        const label = readAscii(bytes, offsets.label + index * 16, 16);
        const where = `signal ${index + 1}${label.length > 0 ? ` ("${label}")` : ''}`;
        const isAnnotation = label === EDF_ANNOTATION_LABEL;
        const physicalDimension = readAscii(
            bytes,
            offsets.physicalDimension + index * 8,
            8,
        );
        if (!isAnnotation && physicalDimension.toUpperCase() !== 'MV') {
            throw EcgError.unsupportedFormat(
                `EDF ${where} declares physical dimension ` +
                `${JSON.stringify(physicalDimension)}; only millivolts ("mV") ` +
                'can be represented as a canonical amplitude unit.',
                { meta: { label, physicalDimension, signalIndex: index } },
            );
        }

        const samplesPerDataRecord = requiredInteger(
            readAscii(bytes, offsets.samplesPerDataRecord + index * 8, 8),
            'the number of samples in a data record',
            where,
        );
        if (samplesPerDataRecord <= 0) {
            throw EcgError.malformedHeader(
                `EDF ${where} declares ${samplesPerDataRecord} sample(s) per ` +
                'data record; at least one is required.',
                { meta: { label, samplesPerDataRecord, signalIndex: index } },
            );
        }

        const physicalMin = requiredNumber(
            readAscii(bytes, offsets.physicalMin + index * 8, 8),
            'the physical minimum',
            where,
        );
        const physicalMax = requiredNumber(
            readAscii(bytes, offsets.physicalMax + index * 8, 8),
            'the physical maximum',
            where,
        );
        const digitalMin = requiredInteger(
            readAscii(bytes, offsets.digitalMin + index * 8, 8),
            'the digital minimum',
            where,
        );
        const digitalMax = requiredInteger(
            readAscii(bytes, offsets.digitalMax + index * 8, 8),
            'the digital maximum',
            where,
        );

        const physicalSpan = physicalMax - physicalMin;
        if (physicalSpan <= 0) {
            throw EcgError.malformedHeader(
                `EDF ${where} declares physical minimum ${physicalMin} and ` +
                `maximum ${physicalMax}, a span of ${physicalSpan}; a positive ` +
                'physical span is required to derive the ADC gain.',
                { meta: { label, physicalMin, physicalMax, signalIndex: index } },
            );
        }
        const digitalSpan = digitalMax - digitalMin;
        if (digitalSpan <= 0) {
            throw EcgError.malformedHeader(
                `EDF ${where} declares digital minimum ${digitalMin} and ` +
                `maximum ${digitalMax}, a span of ${digitalSpan}; a positive ` +
                'digital span is required to derive the ADC gain.',
                { meta: { label, digitalMin, digitalMax, signalIndex: index } },
            );
        }

        signals.push(
            Object.freeze({
                label,
                transducer: readAscii(bytes, offsets.transducer + index * 80, 80),
                physicalDimension,
                physicalMin,
                physicalMax,
                digitalMin,
                digitalMax,
                prefiltering: readAscii(
                    bytes,
                    offsets.prefiltering + index * 80,
                    80,
                ),
                samplesPerDataRecord,
                isAnnotation,
            }),
        );
    }

    const dataRecordDurationSec = requiredNumber(
        readAscii(bytes, 244, 8),
        'the duration of a data record',
        'the file',
    );
    if (dataRecordDurationSec <= 0) {
        throw EcgError.malformedHeader(
            `EDF file declares a data-record duration of ` +
            `${dataRecordDurationSec} second(s); a positive duration is ` +
            'required to derive the sample rate.',
            { meta: { dataRecordDurationSec } },
        );
    }

    const reference = signals[0];
    if (reference === undefined) {
        // Unreachable: signalCount > 0 above guarantees at least one signal.
        throw EcgError.malformedHeader('EDF file declares no signal blocks.');
    }
    const uniform = signals.every(
        (signal) =>
            signal.samplesPerDataRecord === reference.samplesPerDataRecord,
    );
    if (!uniform) {
        const declared = signals
            .map(
                (signal) =>
                    `${signal.samplesPerDataRecord / dataRecordDurationSec} Hz ` +
                    `("${signal.label}")`,
            )
            .join(', ');
        throw EcgError.unsupportedFormat(
            'EDF file declares signals whose sample rates disagree ' +
            `(${declared}); the canonical SamplingInfo is single-rate for the ` +
            'whole record.',
            { meta: { dataRecordDurationSec } },
        );
    }

    const sampleRateHz = reference.samplesPerDataRecord / dataRecordDurationSec;
    const recordSizeBytes =
        signals.reduce(
            (total, signal) => total + signal.samplesPerDataRecord,
            0,
        ) * 2;
    const dataBytes = bytes.length - headerByteCount;

    const dataRecordCount = requiredInteger(
        readAscii(bytes, 236, 8),
        'the number of data records',
        'the file',
    );
    if (dataRecordCount < -1) {
        throw EcgError.malformedHeader(
            `EDF file declares ${dataRecordCount} data record(s); only -1 ` +
            '(unknown) or a non-negative count is valid.',
            { meta: { dataRecordCount } },
        );
    }

    let dataRecords: number;
    if (dataRecordCount === -1) {
        if (dataBytes % recordSizeBytes !== 0) {
            throw EcgError.malformedHeader(
                'EDF file declares an unknown data-record count and its data ' +
                `section holds ${dataBytes} byte(s), which is not a whole ` +
                `number of ${recordSizeBytes}-byte data records.`,
                { meta: { dataBytes, recordSizeBytes } },
            );
        }
        dataRecords = dataBytes / recordSizeBytes;
    } else {
        const expectedDataBytes = dataRecordCount * recordSizeBytes;
        if (dataBytes !== expectedDataBytes) {
            throw EcgError.malformedHeader(
                `EDF file declares ${dataRecordCount} data record(s) of ` +
                `${recordSizeBytes} byte(s) (${expectedDataBytes} bytes) but ` +
                `its data section holds ${dataBytes} byte(s).`,
                {
                    meta: {
                        dataRecordCount,
                        recordSizeBytes,
                        expectedDataBytes,
                        dataBytes,
                    },
                },
            );
        }
        dataRecords = dataRecordCount;
    }

    return Object.freeze({
        version,
        patientId,
        recordingId,
        startDate,
        startTime,
        reservedTag,
        format,
        headerByteCount,
        dataRecordCount,
        dataRecords,
        dataRecordDurationSec,
        sampleRateHz,
        recordSizeBytes,
        signals: Object.freeze(signals),
    });
}
