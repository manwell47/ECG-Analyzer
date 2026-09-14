/**
 * Canonical dataset record representation (Phase 5 / ADR-006, architecture §F).
 *
 * A `SignalRecord` is the immutable-by-convention container produced by the
 * `DatasetAdapter` boundary. It differs from `Signal` (src/domain/signal.ts):
 *
 * - channels retain **raw ADC integer samples** (`Int16Array`, amplitude unit
 *   `adc`) together with the per-channel calibration that turns those counts
 *   into physical units — so ADC → mV conversion stays explicit, auditable and
 *   unit-tested and nothing downstream can silently assume a scale;
 * - it carries dataset identity (`datasetId`/`recordId`), a `subjectId` used
 *   for leakage-free subject-aware partitioning, the declared per-channel
 *   metadata from the source header, and `.atr`-style **annotation events**
 *   that are never silently fused into DSP;
 * - `sampling`/`provenance` mirror `Signal` so an adapter can cheaply derive a
 *   physical-unit `Signal` (see `src/datasets`).
 *
 * The domain layer stays format-agnostic: WFDB field names are an adapter
 * concern. This file only declares the canonical model + its invariants.
 */

import { EcgError } from './error';
import type { SamplingInfo } from './sampling';
import type { Provenance } from './signal';
import { isAmplitudeUnit, type AmplitudeUnit, type GainCalibration } from './units';

/** Stable name of a dataset, e.g. `'mit-bih-arrhythmia'`. */
export type DatasetId = string;

/** Record identifier within a dataset, e.g. `'100'`. */
export type RecordId = string;

/** Subject identifier used for subject-aware partitioning, e.g. `'100'`. */
export type SubjectId = string;

/** Uniquely identifies one record within one dataset. */
export interface RecordIdentity {
    readonly datasetId: DatasetId;
    readonly recordId: RecordId;
}

/**
 * One annotation event extracted from a record's reference annotation file
 * (e.g. `.atr`). Kept as data — never merged into DSP ground truth.
 */
export interface AnnotationEvent {
    /** Absolute sample index within the record (integer >= 0). */
    readonly sampleIndex: number;
    /** Canonical symbol/class code, e.g. `'N'`, `'V'`, `'A'`, `'+'`. */
    readonly symbol: string;
    /** Raw numeric code as stored by the source (optional, format-specific). */
    readonly code?: number;
    /** Auxiliary note text from the source; empty string when absent. */
    readonly auxNote: string;
}

/**
 * One channel of a `SignalRecord`: calibration metadata + the raw ADC buffer.
 * All channels of a record share one `SamplingInfo` and one sample count.
 */
export interface RecordChannel {
    /** Channel/lead name; unique within the record (e.g. `'MLII'`, `'V5'`). */
    readonly name: string;
    /** Physical unit the calibration maps ADC counts into (e.g. `'mV'`). */
    readonly physicalUnit: AmplitudeUnit;
    /** ADC counts per physical unit (`gain`) and zero-amplitude ADC (`baseline`). */
    readonly calibration: GainCalibration;
    /** ADC value corresponding to digital zero (used to default baseline). */
    readonly adcZero: number;
    /** Declared ADC resolution in bits (e.g. 11 for format 212). */
    readonly adcResolutionBits: number;
    /** Declared value of the first stored sample (diagnostic). */
    readonly initialValue: number;
    /** Declared 16-bit checksum of the channel samples (diagnostic, unverified). */
    readonly checksum: number;
    /** Declared blocksize hint from the source header (diagnostic). */
    readonly blockSize: number;
    /** Source encoding descriptor (e.g. `'212'`); informational only. */
    readonly sourceFormat: string;
    /** Raw ADC samples, amplitude unit `adc`, prior to any scaling. */
    readonly samples: Int16Array;
}

/** Canonical dataset record: identity, subject, sampling, ADC channels, events. */
export interface SignalRecord {
    readonly identity: RecordIdentity;
    /** Subject this record belongs to (used for subject-aware partitioning). */
    readonly subjectId: SubjectId;
    readonly sampling: SamplingInfo;
    /** One entry per source channel; all share `sampleCount` samples. */
    readonly channels: readonly RecordChannel[];
    /** Number of samples per channel (all channels are equal length). */
    readonly sampleCount: number;
    /** Annotation events sorted by ascending `sampleIndex`. */
    readonly annotations: readonly AnnotationEvent[];
    /** Verbatim source comment lines (e.g. `.hea` lines starting with `#`). */
    readonly comments: readonly string[];
    readonly provenance: Provenance;
}

export interface CreateSignalRecordInput {
    readonly identity: RecordIdentity;
    readonly subjectId: SubjectId;
    readonly sampling: SamplingInfo;
    /** Channel buffers are copied on construction. */
    readonly channels: readonly RecordChannel[];
    readonly annotations?: readonly AnnotationEvent[];
    readonly comments?: readonly string[];
    readonly provenance?: Provenance;
}

function isNonEmptyString(value: string, label: string): string | null {
    if (value.trim().length === 0) {
        return `${label} must be a non-empty string.`;
    }
    return null;
}

/**
 * Return a human-oriented list of structural problems, or an empty array when
 * the record is valid. Never throws; aggregates into a classified error via
 * {@link assertValidSignalRecord}.
 */
export function describeSignalRecordProblems(
    record: Readonly<SignalRecord>,
): readonly string[] {
    const problems: string[] = [];
    const add = (label: string, problem: string): void => {
        problems.push(`${label}: ${problem}`);
    };

    const idProblem = isNonEmptyString(record.identity.datasetId, 'datasetId');
    if (idProblem) add('identity', idProblem);
    const recProblem = isNonEmptyString(record.identity.recordId, 'recordId');
    if (recProblem) add('identity', recProblem);
    const subjProblem = isNonEmptyString(record.subjectId, 'subjectId');
    if (subjProblem) add('identity', subjProblem);

    const { sampleRateHz, startTimeSec } = record.sampling;
    if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
        add(
            'sampling',
            `sample rate must be a finite number > 0 Hz, received ${String(sampleRateHz)}.`,
        );
    }
    if (!Number.isFinite(startTimeSec)) {
        add(
            'sampling',
            `start time must be finite, received ${String(startTimeSec)}.`,
        );
    }

    if (record.channels.length === 0) {
        problems.push('channels: a record must contain at least one channel.');
        return problems;
    }

    const seenNames = new Set<string>();
    let expectedLength: number | undefined;
    for (const channel of record.channels) {
        const label = `channel "${channel.name}"`;
        if (channel.name.trim().length === 0) {
            add(label, 'name must be a non-empty string.');
        }
        if (!isAmplitudeUnit(channel.physicalUnit)) {
            add(
                label,
                `unsupported physical unit ${JSON.stringify(channel.physicalUnit)}.`,
            );
        }
        if (!Number.isFinite(channel.calibration.gain) || channel.calibration.gain <= 0) {
            add(label, 'gain must be a finite number > 0.');
        }
        if (!Number.isFinite(channel.calibration.baseline)) {
            add(label, 'baseline must be a finite number.');
        }

        if (!(channel.samples instanceof Int16Array)) {
            add(label, 'samples must be an Int16Array of raw ADC counts.');
            continue;
        }
        if (expectedLength === undefined) {
            expectedLength = channel.samples.length;
        } else if (channel.samples.length !== expectedLength) {
            add(
                label,
                `sample count ${channel.samples.length} differs from other channels ` +
                `(${expectedLength}).`,
            );
        }
        if (seenNames.has(channel.name)) {
            add(label, 'duplicate channel name.');
        }
        seenNames.add(channel.name);
    }

    const firstLength = record.channels[0]?.samples.length;
    if (firstLength !== undefined && firstLength !== record.sampleCount) {
        problems.push(
            `record.sampleCount (${record.sampleCount}) must equal the per-channel ` +
            `sample count (${firstLength}).`,
        );
    }

    let previousIndex = -1;
    for (const annotation of record.annotations) {
        if (
            !Number.isSafeInteger(annotation.sampleIndex) ||
            annotation.sampleIndex < 0
        ) {
            add(
                'annotations',
                `sample index must be a non-negative integer, received ` +
                `${String(annotation.sampleIndex)}.`,
            );
        }
        if (annotation.symbol.length === 0) {
            add('annotations', 'every event must carry a non-empty symbol.');
        }
        if (annotation.sampleIndex < previousIndex) {
            add(
                'annotations',
                'events must be sorted by ascending sample index ' +
                `(found ${annotation.sampleIndex} after ${previousIndex}).`,
            );
        }
        previousIndex = annotation.sampleIndex;
    }

    return problems;
}

/** Throw `malformed-signal` with an aggregated report if the record is invalid. */
export function assertValidSignalRecord(record: Readonly<SignalRecord>): void {
    const problems = describeSignalRecordProblems(record);
    if (problems.length > 0) {
        throw EcgError.malformedSignal('SignalRecord failed structural validation.', {
            detail: problems.join(' '),
            meta: { problems: [...problems] },
        });
    }
}

/**
 * Build a validated, immutable-by-convention `SignalRecord`. ADC buffers are
 * copied into fresh `Int16Array`s, annotations are sorted and frozen, and the
 * object graph is frozen so later mutation requires deliberate circumvention.
 */
export function createSignalRecord(input: CreateSignalRecordInput): SignalRecord {
    const channels: readonly RecordChannel[] = Object.freeze(
        input.channels.map((channel) => ({
            name: channel.name,
            physicalUnit: channel.physicalUnit,
            calibration: {
                gain: channel.calibration.gain,
                baseline: channel.calibration.baseline,
            },
            adcZero: channel.adcZero,
            adcResolutionBits: channel.adcResolutionBits,
            initialValue: channel.initialValue,
            checksum: channel.checksum,
            blockSize: channel.blockSize,
            sourceFormat: channel.sourceFormat,
            samples: new Int16Array(channel.samples),
        })),
    );

    const annotations: readonly AnnotationEvent[] = Object.freeze(
        [...(input.annotations ?? [])]
            .map((annotation) => Object.freeze({ ...annotation }))
            .sort((a, b) => a.sampleIndex - b.sampleIndex),
    );

    const comments: readonly string[] = Object.freeze([...(input.comments ?? [])]);

    const record: SignalRecord = {
        identity: {
            datasetId: input.identity.datasetId,
            recordId: input.identity.recordId,
        },
        subjectId: input.subjectId,
        sampling: {
            sampleRateHz: input.sampling.sampleRateHz,
            startTimeSec: input.sampling.startTimeSec,
        },
        channels,
        sampleCount: channels[0]?.samples.length ?? 0,
        annotations,
        comments,
        provenance: input.provenance ?? { transforms: [] },
    };

    assertValidSignalRecord(record);
    return Object.freeze(record);
}
