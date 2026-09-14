/**
 * Synthetic dataset adapter (Phase 5 / ADR-006) — hermetic boundary proof.
 *
 * The synthetic adapter implements the exact `DatasetAdapter` contract with no
 * files and no I/O: `generateSyntheticRecord` deterministically synthesises a
 * canonical, mV-calibrated `SignalRecord` (a small set of analytic leads scaled
 * through an explicit ADC calibration). It exists so that:
 *
 * - downstream phases (DSP integration, ML training, visualisation) can run
 *   against the real `SignalRecord` shape without any downloaded dataset;
 * - the dataset boundary is proven implementable — an adapter is a pure
 *   `recordId -> SignalRecord` mapping plus a stable id list, nothing more.
 *
 * The generator is a pure function of its spec: two calls with the same spec
 * yield bit-identical records (see synthetic.test.ts). It deliberately uses
 * no randomness; adding noise later must go through the committed RNG
 * (`src/fixtures/rng.ts`) so results stay reproducible.
 */
import { createSamplingInfo } from '../../domain/sampling';
import { EcgError } from '../../domain/error';
import {
    createSignalRecord,
    type RecordChannel,
    type RecordId,
    type SignalRecord,
} from '../../domain/record';
import type { DatasetAdapter } from '../types';

/** Stable dataset identity of the synthetic dataset. */
export const SYNTHETIC_DATASET_ID = 'synthetic';

/** One analytic lead to synthesise. */
export interface SyntheticLeadSpec {
    /** Channel name; unique within the record. */
    readonly name: string;
    /** ADC counts per mV (the calibration's `gain`). */
    readonly gain: number;
    /** ADC value of zero amplitude (the calibration's `baseline`). */
    readonly baseline: number;
    /** Peak amplitude of the lead, in mV. */
    readonly amplitudeMv: number;
    /** Fundamental frequency of the lead, in Hz. */
    readonly frequencyHz: number;
    /** Phase offset in radians (default 0). */
    readonly phaseRad?: number;
}

/** Everything needed to generate one record. */
export interface SyntheticRecordSpec {
    readonly recordId: RecordId;
    /** Sampling rate in Hz (default 360). */
    readonly sampleRateHz?: number;
    /** Samples per channel (default 3600 = 10 s at 360 Hz). */
    readonly sampleCount?: number;
    /** One lead per channel (default: two analytic leads). */
    readonly leads?: readonly SyntheticLeadSpec[];
}

function sampleValueMv(lead: SyntheticLeadSpec, t: number): number {
    const phase = lead.phaseRad ?? 0;
    // Two detuned harmonics keep the waveform from being a pure tone while
    // remaining analytic and deterministic.
    const fundamental = Math.sin(2 * Math.PI * lead.frequencyHz * t + phase);
    const second = 0.5 * Math.sin(4 * Math.PI * lead.frequencyHz * t + 2 * phase);
    return lead.amplitudeMv * (0.6 * fundamental + 0.4 * second);
}

function defaultLeads(): readonly SyntheticLeadSpec[] {
    return [
        { name: 'lead-a', gain: 200, baseline: 1024, amplitudeMv: 1.0, frequencyHz: 1.0 },
        { name: 'lead-b', gain: 200, baseline: 1024, amplitudeMv: 1.0, frequencyHz: 1.2 },
    ];
}

/** Build a validated, deterministic synthetic `SignalRecord`. */
export function generateSyntheticRecord(spec: SyntheticRecordSpec): SignalRecord {
    const sampleRateHz = spec.sampleRateHz ?? 360;
    const sampleCount = spec.sampleCount ?? 3600;
    const leads = spec.leads ?? defaultLeads();

    const channels: RecordChannel[] = leads.map((lead) => {
        const samples = new Int16Array(sampleCount);
        for (let i = 0; i < sampleCount; i += 1) {
            const millivolt = sampleValueMv(lead, i / sampleRateHz);
            // Quantise to raw ADC counts exactly as acquisition hardware would.
            samples[i] = Math.round(millivolt * lead.gain + lead.baseline);
        }
        return {
            name: lead.name,
            physicalUnit: 'mV',
            calibration: { gain: lead.gain, baseline: lead.baseline },
            adcZero: lead.baseline,
            adcResolutionBits: 11,
            initialValue: samples[0] ?? 0,
            checksum: 0,
            blockSize: 0,
            sourceFormat: 'synthetic',
            samples,
        };
    });

    return createSignalRecord({
        identity: { datasetId: SYNTHETIC_DATASET_ID, recordId: spec.recordId },
        subjectId: spec.recordId,
        sampling: createSamplingInfo(sampleRateHz),
        channels,
        annotations: [],
        comments: [],
        provenance: {
            source: `${SYNTHETIC_DATASET_ID}/${spec.recordId}`,
            transforms: [],
        },
    });
}

/**
 * A stateless, deterministic `DatasetAdapter` over a registry of synthetic
 * specs. Records are recomputed (identically) on every read.
 */
export class SyntheticDatasetAdapter implements DatasetAdapter {
    readonly datasetId = SYNTHETIC_DATASET_ID;

    constructor(private readonly specs: Readonly<Record<RecordId, SyntheticRecordSpec>>) { }

    async listRecordIds(): Promise<readonly RecordId[]> {
        return Object.keys(this.specs).sort();
    }

    async readRecord(recordId: RecordId): Promise<SignalRecord> {
        const spec = this.specs[recordId];
        if (spec === undefined) {
            throw EcgError.fileNotFound(
                `Synthetic record "${recordId}" is not in the adapter registry.`,
                { meta: { recordId } },
            );
        }
        return generateSyntheticRecord(spec);
    }
}
