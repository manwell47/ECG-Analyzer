/**
 * MIT-BIH Arrhythmia Database adapter (Phase 5 / ADR-006, architecture §J).
 *
 * `MitBihDatasetAdapter` is a `DatasetAdapter` over a directory of WFDB files.
 * For a requested record it:
 *
 * 1. parses `<recordId>.hea` into a validated `MitBihHeader` (malformed headers
 *    throw `malformed-header`; the header's own record name must match the
 *    requested id);
 * 2. groups the header's channels by their declared `.dat` file, reads each
 *    file once, and decodes format 212 (two packed 12-bit channels, 3 bytes per
 *    frame) or format 16 (little-endian interleaved) into raw `Int16Array` ADC
 *    samples, checking file lengths against the header's sample count;
 * 3. reads `<recordId>.atr` (when annotations are requested and the file is
 *    present) into canonical `AnnotationEvent`s; a *missing* annotation file
 *    degrades to no annotations, while a *malformed* one throws
 *    `annotation-parse-error`;
 * 4. assembles a canonical `SignalRecord` (see `src/domain/record.ts`): raw ADC
 *    samples, per-channel calibration (gain/baseline), declared metadata, and
 *    provenance `mit-bih-arrhythmia/<recordId>`.
 *
 * `listRecordIds()` returns the canonical order from the `RECORDS` file
 * (throwing `file-not-found` when that file is absent).
 *
 * ADC -> mV conversion is NOT performed here; it is applied explicitly by
 * `src/datasets/load.ts` (`recordToMillivoltSignal`) so the ADC -> mV step is
 * single-sourced, logged and unit-tested (ADR-006).
 */
import { createSamplingInfo } from '../../domain/sampling';
import { EcgError } from '../../domain/error';
import {
    createSignalRecord,
    type AnnotationEvent,
    type RecordChannel,
    type RecordId,
    type SignalRecord,
} from '../../domain/record';
import type { AmplitudeUnit } from '../../domain/units';
import type { DatasetAdapter, ReadRecordOptions } from '../types';
import type { DatasetFileSource } from '../source';
import { parseMitBihAtr } from './atr';
import { listMitBihRecordIds } from './catalog';
import {
    decodeFormat16Interleaved,
    decodeFormat212,
} from './format212';
import { parseMitBihHeader, type MitBihHeader } from './header';

/** Stable dataset identity of the MIT-BIH Arrhythmia Database. */
export const MIT_BIH_DATASET_ID = 'mit-bih-arrhythmia';

/** The header units token must map to a canonical amplitude unit ('mV'). */
function canonicalUnitOf(unitsToken: string, recordId: RecordId): AmplitudeUnit {
    const normalized = unitsToken.trim().toLowerCase();
    if (normalized === 'mv') {
        return 'mV';
    }
    throw EcgError.unsupportedFormat(
        `Record ${recordId} declares physical unit ${JSON.stringify(unitsToken)}, ` +
        'which the canonical model cannot represent as an amplitude unit.',
        { meta: { recordId, declaredUnits: unitsToken } },
    );
}

function requiredDataLength(format: number, numChannels: number, frames: number): number {
    if (format === 212) {
        return 3 * frames;
    }
    if (format === 16) {
        return 2 * numChannels * frames;
    }
    throw EcgError.unsupportedFormat(
        `Cannot size data for unsupported WFDB format ${format}.`,
        { meta: { format } },
    );
}

/** Map a decoded channel group back onto the header descriptors that use it. */
function channelsForGroup(
    header: MitBihHeader,
    fileBase: string,
    bytes: Uint8Array,
    decodedByIndex: (Int16Array | undefined)[],
): void {
    const group = header.channels
        .map((descriptor, index) => ({ descriptor, index }))
        .filter(({ descriptor }) => descriptor.fileBase === fileBase);
    if (group.length === 0) {
        throw EcgError.malformedHeader(
            `Data file "${fileBase}" is not referenced by any header channel.`,
        );
    }

    const format = group[0]?.descriptor.format;
    if (format === undefined) {
        throw EcgError.malformedHeader(`Data file "${fileBase}" has no channel format.`);
    }
    const uniform = group.every(({ descriptor }) => descriptor.format === format);
    if (!uniform) {
        throw EcgError.malformedHeader(
            `Data file "${fileBase}" is shared by channels with mixed formats.`,
        );
    }

    const declaredFrames = header.samplesPerSignal;
    let frames: number;
    if (format === 212) {
        if (group.length !== 2) {
            throw EcgError.malformedHeader(
                `Format-212 data file "${fileBase}" must pack exactly two channels, ` +
                `but ${group.length} header channel(s) reference it.`,
                { meta: { fileBase, count: group.length } },
            );
        }
        frames = declaredFrames > 0 ? declaredFrames : Math.floor(bytes.length / 3);
    } else {
        frames =
            declaredFrames > 0
                ? declaredFrames
                : Math.floor(bytes.length / (2 * group.length));
    }

    const expectedBytes = requiredDataLength(format, group.length, frames);
    if (bytes.length !== expectedBytes) {
        throw EcgError.malformedHeader(
            `Data file "${fileBase}" holds ${bytes.length} bytes but the header ` +
            `implies ${expectedBytes} (${frames} frames x format ${format}).`,
            { meta: { fileBase, receivedBytes: bytes.length, expectedBytes, frames } },
        );
    }

    if (format === 212) {
        const [channel0, channel1] = decodeFormat212(bytes, frames);
        const index0 = group[0]?.index;
        const index1 = group[1]?.index;
        if (index0 === undefined || index1 === undefined) {
            throw EcgError.malformedHeader(`Data file "${fileBase}" channel indexing is broken.`);
        }
        decodedByIndex[index0] = channel0;
        decodedByIndex[index1] = channel1;
        return;
    }

    const channels = decodeFormat16Interleaved(bytes, group.length, frames);
    channels.forEach((channel, position) => {
        const index = group[position]?.index;
        if (index === undefined) {
            throw EcgError.malformedHeader(
                `Data file "${fileBase}" produced more channels than the header declares.`,
            );
        }
        decodedByIndex[index] = channel;
    });
}

async function readAnnotations(
    source: DatasetFileSource,
    recordId: RecordId,
    enabled: boolean,
): Promise<readonly AnnotationEvent[]> {
    if (!enabled) {
        return Object.freeze([]);
    }
    let bytes: Uint8Array;
    try {
        bytes = await source.readBinaryFile(`${recordId}.atr`);
    } catch (error) {
        // A missing annotation file is not an error: annotations are optional
        // reference data, and absence is reported honestly as an empty list.
        if (error instanceof EcgError && error.code === 'file-not-found') {
            return Object.freeze([]);
        }
        throw error;
    }
    return parseMitBihAtr(bytes).annotations;
}

/**
 * Read a MIT-BIH record from a directory-backed source into a canonical
 * `SignalRecord`.
 */
export class MitBihDatasetAdapter implements DatasetAdapter {
    readonly datasetId = MIT_BIH_DATASET_ID;

    constructor(private readonly source: DatasetFileSource) { }

    async listRecordIds(): Promise<readonly RecordId[]> {
        return listMitBihRecordIds(this.source);
    }

    async readRecord(
        recordId: RecordId,
        options?: Readonly<ReadRecordOptions>,
    ): Promise<SignalRecord> {
        const header = parseMitBihHeader(
            await this.source.readTextFile(`${recordId}.hea`), // file-not-found if absent
        );
        if (header.recordName !== recordId) {
            throw EcgError.malformedHeader(
                `Record "${recordId}" was requested but its header declares ` +
                `record "${header.recordName}".`,
                { meta: { requested: recordId, declared: header.recordName } },
            );
        }

        // Decode each distinct data file once; map results back onto channels.
        const decodedByIndex: (Int16Array | undefined)[] = new Array(
            header.channels.length,
        );
        const seenFiles = new Set<string>();
        for (const descriptor of header.channels) {
            if (seenFiles.has(descriptor.fileBase)) {
                continue;
            }
            seenFiles.add(descriptor.fileBase);
            const bytes = await this.source.readBinaryFile(descriptor.fileBase);
            channelsForGroup(header, descriptor.fileBase, bytes, decodedByIndex);
        }

        const channels: RecordChannel[] = header.channels.map((descriptor, index) => {
            const samples = decodedByIndex[index];
            if (samples === undefined) {
                throw EcgError.malformedHeader(
                    `Record "${recordId}" produced no samples for channel ${index} ` +
                    `(${descriptor.sigName.trim() || 'unnamed'}).`,
                );
            }
            const sigName = descriptor.sigName.trim();
            return {
                name: sigName.length > 0 ? sigName : `channel-${index + 1}`,
                physicalUnit: canonicalUnitOf(descriptor.units, recordId),
                calibration: {
                    gain: descriptor.adcGain,
                    baseline: descriptor.baseline,
                },
                adcZero: descriptor.adcZero,
                adcResolutionBits: descriptor.adcRes,
                initialValue: descriptor.initValue,
                checksum: descriptor.checksum,
                blockSize: descriptor.blockSize,
                sourceFormat: String(descriptor.format),
                samples,
            };
        });

        const withAnnotations = options?.withAnnotations !== false;
        const annotations = await readAnnotations(this.source, recordId, withAnnotations);

        return createSignalRecord({
            identity: { datasetId: this.datasetId, recordId },
            subjectId: recordId, // MIT-BIH: each record is a distinct subject.
            sampling: createSamplingInfo(header.sampleRateHz),
            channels,
            annotations,
            comments: header.comments,
            provenance: {
                source: `${this.datasetId}/${recordId}`,
                transforms: [],
            },
        });
    }
}
