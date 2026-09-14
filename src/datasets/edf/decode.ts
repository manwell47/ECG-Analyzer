/**
 * EDF data-section decoding (Phase 18 item 6 / ADR-020, architecture §J).
 *
 * The data section is a sequence of equal-size data records; each record holds
 * every signal's samples in declaration order, each sample a little-endian
 * signed 16-bit integer. One pass over the records therefore fills one
 * `Int16Array` per signal: a file with N signals is decoded once, never N
 * times, and the channel buffers come out already aligned sample-for-sample.
 *
 * The EDF+ annotation signal stores text (TAL), not samples: it decodes to
 * `undefined` and the adapter excludes it from the channels. This module never
 * reads that text — EDF+ annotation parsing is a later increment, and an empty
 * `annotations` list is the honest outcome until then.
 *
 * No scaling happens here: each buffer holds the digits the file stored, in the
 * `adc` amplitude unit the dataset seam requires.
 */
import { EcgError } from '../../domain/error';
import type { EdfHeader } from './header';

/**
 * Decode every non-annotation signal of a parsed EDF header.
 *
 * The returned array is positional: index `i` holds the samples of
 * `header.signals[i]`, or `undefined` when that signal is the annotation
 * channel. Buffers are empty when the file declares no data records.
 */
export function decodeEdfSignals(
    header: EdfHeader,
    bytes: Uint8Array,
): readonly (Int16Array | undefined)[] {
    const { signals, dataRecords, headerByteCount } = header;

    const requiredBytes = headerByteCount + dataRecords * header.recordSizeBytes;
    if (bytes.length < requiredBytes) {
        throw EcgError.malformedHeader(
            `EDF data section holds ${bytes.length - headerByteCount} byte(s) ` +
            `but ${dataRecords} data record(s) require ${requiredBytes - headerByteCount}.`,
            { meta: { dataRecords, requiredBytes, byteLength: bytes.length } },
        );
    }

    const buffers: (Int16Array | undefined)[] = signals.map((signal) =>
        signal.isAnnotation
            ? undefined
            : new Int16Array(dataRecords * signal.samplesPerDataRecord),
    );

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = headerByteCount;
    for (let record = 0; record < dataRecords; record += 1) {
        for (let index = 0; index < signals.length; index += 1) {
            const signal = signals[index];
            if (signal === undefined) {
                continue;
            }
            const perRecord = signal.samplesPerDataRecord;
            const buffer = buffers[index];
            if (buffer === undefined) {
                // The annotation channel's bytes are stepped over, not read.
                offset += perRecord * 2;
                continue;
            }
            const base = record * perRecord;
            for (let sample = 0; sample < perRecord; sample += 1) {
                buffer[base + sample] = view.getInt16(offset, true);
                offset += 2;
            }
        }
    }
    return buffers;
}
