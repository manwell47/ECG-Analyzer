/**
 * EDF / EDF+ adapter (Phase 18 item 6 / ADR-020, architecture §J).
 *
 * `EdfDatasetAdapter` is a `DatasetAdapter` over a source holding `.edf` files,
 * sharing the one `DatasetFileSource` seam MIT-BIH uses (ADR-006): no new file
 * source type, no new dependency. For a requested record it:
 *
 * 1. reads `<recordId>.edf` and parses its 256-byte fixed header plus the
 *    field-major per-signal block (`malformed-header` for a field the file
 *    states wrongly, `unsupported-format` for a format this pipeline cannot
 *    represent — see `header.ts` for the full list of refusals);
 * 2. decodes the data section once into one `Int16Array` per signal, in the
 *    `adc` amplitude unit, little-endian signed 16-bit;
 * 3. derives each signal's calibration from the *declared* physical and digital
 *    spans (`gain = digitalSpan / physicalSpan`, `baseline = digitalMin -
 *    physicalMin x gain`) and declares it for the canonical channel, which
 *    requires a `mV` physical unit — the dimension the parser already checked;
 * 4. excludes the EDF+ `EDF Annotations` signal from the channels (its TAL text
 *    is not waveform data), naming it in `comments` and leaving `annotations`
 *    empty: reading EDF+ annotation text is a later increment, and this adapter
 *    never claims to have done it;
 * 5. records any sample outside a signal's declared digital range as a
 *    provenance transform, with the channel name and the count;
 * 6. assembles a canonical `SignalRecord` with provenance `edf/<recordId>`.
 *
 * ADC -> mV conversion is NOT performed here; it is applied explicitly by
 * `src/datasets/load.ts` (`recordToMillivoltSignal`) so the ADC -> mV step
 * stays single-sourced and unit-tested (ADR-006). `readRecord` therefore takes
 * no `ReadRecordOptions`: the only option is `withAnnotations`, and there are
 * no annotations to withhold until EDF+ TAL parsing exists.
 */
import { EcgError } from '../../domain/error';
import {
    createSignalRecord,
    type RecordChannel,
    type RecordId,
    type SignalRecord,
} from '../../domain/record';
import { createSamplingInfo } from '../../domain/sampling';
import type { TransformStep } from '../../domain/signal';
import type { DatasetFileSource } from '../source';
import type { DatasetAdapter } from '../types';
import {
    countOutOfDeclaredRange,
    edfCalibrationOf,
    EDF_OUT_OF_RANGE_STEP,
} from './calibration';
import { decodeEdfSignals } from './decode';
import { parseEdfHeader } from './header';

/** Stable dataset identity of an EDF / EDF+ file source. */
export const EDF_DATASET_ID = 'edf';

/** Extension a record's binary file must carry to be discovered. */
const EDF_EXTENSION = 'edf';

/** Split a file name into its stem and its lower-cased extension. */
function splitFileName(fileName: string): { stem: string; ext: string } {
    const dot = fileName.lastIndexOf('.');
    if (dot <= 0) {
        return { stem: fileName, ext: '' };
    }
    return { stem: fileName.slice(0, dot), ext: fileName.slice(dot + 1).toLowerCase() };
}

/**
 * The subject an EDF record belongs to, from its declared patient field.
 *
 * EDF puts the subject in the patient identification field; `'X'` is EDF+'s
 * explicit "unknown", and an empty field means the same thing. In both cases
 * the record id stands in, so the channel is never empty (the canonical record
 * requires a non-empty subject).
 */
function subjectIdOf(patientId: string, recordId: RecordId): string {
    const token = patientId.trim();
    if (token.length === 0 || token.toUpperCase() === 'X') {
        return recordId;
    }
    return token;
}

/**
 * Read EDF records from a `DatasetFileSource` into canonical `SignalRecord`s.
 */
export class EdfDatasetAdapter implements DatasetAdapter {
    readonly datasetId = EDF_DATASET_ID;

    constructor(private readonly source: DatasetFileSource) { }

    /**
     * The record ids a source can serve: the `.edf` file stems present,
     * deduplicated and ascending. An empty (or `.edf`-less) source yields `[]`
     * rather than throwing, mirroring `discoverMitBihRecordIds`.
     */
    async listRecordIds(): Promise<readonly RecordId[]> {
        const fileNames = await this.source.listFileNames();
        const ids = new Set<string>();
        for (const name of fileNames) {
            const { stem, ext } = splitFileName(name);
            if (ext === EDF_EXTENSION && stem.length > 0) {
                ids.add(stem);
            }
        }
        return [...ids].sort();
    }

    async readRecord(recordId: RecordId): Promise<SignalRecord> {
        const bytes = await this.source.readBinaryFile(
            `${recordId}.${EDF_EXTENSION}`, // file-not-found if absent
        );
        const header = parseEdfHeader(bytes);
        const decoded = decodeEdfSignals(header, bytes);

        const channels: RecordChannel[] = [];
        const transforms: TransformStep[] = [];
        const names = new Set<string>();
        const annotationLabels: string[] = [];

        header.signals.forEach((signal, index) => {
            if (signal.isAnnotation) {
                annotationLabels.push(signal.label);
                return;
            }
            const samples = decoded[index];
            if (samples === undefined) {
                throw EcgError.malformedHeader(
                    `EDF record "${recordId}" produced no samples for signal ` +
                    `${index + 1} ("${signal.label}").`,
                    { meta: { recordId, signalIndex: index } },
                );
            }

            const name = signal.label.length > 0 ? signal.label : `channel-${index + 1}`;
            if (names.has(name)) {
                throw EcgError.unsupportedFormat(
                    `EDF record "${recordId}" declares more than one physiological ` +
                    `signal labelled "${name}"; the canonical record identifies ` +
                    'channels by unique names.',
                    { meta: { recordId, label: name } },
                );
            }
            names.add(name);

            const calibration = edfCalibrationOf(signal);
            channels.push({
                name,
                physicalUnit: 'mV',
                calibration: {
                    gain: calibration.gain,
                    baseline: calibration.baseline,
                },
                // EDF's digital zero is the ADC zero: the declared spans already
                // carry the whole offset in `baseline`.
                adcZero: 0,
                adcResolutionBits: calibration.adcResolutionBits,
                initialValue: samples[0] ?? 0,
                // EDF stores no checksum, blocksize or per-record encoding
                // token; the values below are the format's own, not guesses.
                checksum: 0,
                blockSize: signal.samplesPerDataRecord,
                sourceFormat: header.format,
                samples,
            });

            const outOfRange = countOutOfDeclaredRange(samples, signal);
            if (outOfRange > 0) {
                transforms.push({
                    name: EDF_OUT_OF_RANGE_STEP,
                    parameters: {
                        channel: name,
                        count: outOfRange,
                        digitalMin: signal.digitalMin,
                        digitalMax: signal.digitalMax,
                    },
                });
            }
        });

        if (channels.length === 0) {
            throw EcgError.unsupportedFormat(
                `EDF record "${recordId}" declares no physiological signal, only ` +
                'annotation channel(s); there is no waveform to represent.',
                { meta: { recordId } },
            );
        }

        const comments: string[] = [];
        if (annotationLabels.length > 0) {
            comments.push(
                `EDF annotation signal "${annotationLabels.join('", "')}" carries the ` +
                "record's event text; this adapter does not read it, so the record " +
                'is presented without annotations.',
            );
        }
        if (header.recordingId.length > 0) {
            comments.push(`EDF recording: ${header.recordingId}`);
        }

        return createSignalRecord({
            identity: { datasetId: this.datasetId, recordId },
            subjectId: subjectIdOf(header.patientId, recordId),
            sampling: createSamplingInfo(header.sampleRateHz),
            channels,
            annotations: [],
            comments,
            provenance: {
                source: `${this.datasetId}/${recordId}`,
                transforms,
            },
        });
    }
}
