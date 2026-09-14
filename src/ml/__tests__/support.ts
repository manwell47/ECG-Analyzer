/**
 * Shared factories for the Phase-6 ML tests. Not a test file itself.
 */

import type {
    ModelInput,
    ModelInputContract,
    ModelMetadata,
    ModelNormalization,
    ModelOutputContract,
    ModelPrediction,
    ModelProvenance,
    PreprocessingAssumption,
} from '../../domain/ml';
import { realizeShape } from '../engine';
import { metadataFingerprint } from '../fingerprint';

export const CLASS_LABELS = ['N', 'S', 'V', 'F', 'Q'] as const;

export const DEFAULT_ASSUMPTIONS: readonly PreprocessingAssumption[] = [
    { stage: 'bandpass-0.5-40hz', config: { lowHz: 0.5, highHz: 40, order: 4 } },
    { stage: 'resample-to-360', config: {} },
    { stage: 'segment-512', config: {} },
];

export interface MetadataOverrides {
    modelId?: string;
    modelVersion?: string;
    task?: string;
    input?: Partial<ModelInputContract>;
    output?: Partial<ModelOutputContract>;
    normalization?: Partial<ModelNormalization>;
    provenance?: Partial<ModelProvenance>;
    preprocessingAssumptions?: readonly PreprocessingAssumption[];
    expectedSamplingRateHz?: number;
    expectedChannels?: number;
    expectedWindowSamples?: number;
}

/** A valid, deterministic `ModelMetadata` for a 1-lead 360 Hz beat classifier. */
export function makeMetadata(over: MetadataOverrides = {}): ModelMetadata {
    return {
        modelId: over.modelId ?? 'mitbih-cnn',
        modelVersion: over.modelVersion ?? '1.0.0',
        task: over.task ?? 'beat-classification',
        expectedSamplingRateHz: over.expectedSamplingRateHz ?? 360,
        expectedChannels: over.expectedChannels ?? 1,
        expectedWindowSamples: over.expectedWindowSamples ?? 512,
        input: {
            name: over.input?.name ?? 'window',
            shape: over.input?.shape ?? [-1, 1, 512],
            dtype: over.input?.dtype ?? 'float32',
            layout: over.input?.layout ?? 'nct',
        },
        preprocessingAssumptions: over.preprocessingAssumptions ?? DEFAULT_ASSUMPTIONS,
        normalization: {
            strategy: over.normalization?.strategy ?? 'zscore',
            fittedFrom: over.normalization?.fittedFrom ?? 'mitbih-train',
        },
        output: {
            name: over.output?.name ?? 'classes',
            dtype: over.output?.dtype ?? 'float32',
            semantics: over.output?.semantics ?? 'logits',
            activation: over.output?.activation ?? 'softmax',
            classLabels: over.output?.classLabels ?? [...CLASS_LABELS],
        },
        provenance: {
            trainingDataset: 'MIT-BIH Arrhythmia Database (test-only fixture)',
            methodology: 'Deterministic synthetic contract for Phase-6 tests.',
            limitations: 'Not a real trained model; used only to exercise the contract layer.',
        },
    };
}

export interface RawInputOverrides {
    modelId?: string;
    modelVersion?: string;
    tensorName?: string;
    dtype?: 'float32' | 'float64';
    shape?: readonly number[];
    data?: Float64Array;
    preprocessingFingerprint?: string;
    sourceWindowIds?: readonly string[];
}

/**
 * A realized `ModelInput` literal for one window, defaulting every field to be
 * compatible with `metadata` (correct fingerprint, shape, name, identity). Pass
 * overrides to simulate a specific incompatibility.
 */
export function makeRawInput(
    metadata: Readonly<ModelMetadata>,
    over: RawInputOverrides = {},
): ModelInput {
    const channels = metadata.expectedChannels ?? 1;
    const windowSamples = metadata.expectedWindowSamples ?? 512;
    const elementCount = channels * windowSamples;
    const shape =
        over.shape ??
        realizeShape(metadata.input.shape, elementCount) ??
        [channels, windowSamples];
    const data = over.data ?? new Float64Array(elementCount).fill(0.5);
    return Object.freeze({
        modelId: over.modelId ?? metadata.modelId,
        modelVersion: over.modelVersion ?? metadata.modelVersion,
        tensorName: over.tensorName ?? metadata.input.name,
        dtype: over.dtype ?? metadata.input.dtype === 'float64' ? 'float64' : 'float32',
        shape: Object.freeze([...shape]),
        data,
        preprocessingFingerprint: over.preprocessingFingerprint ?? metadataFingerprint(metadata),
        sourceWindowIds: Object.freeze(over.sourceWindowIds ?? ['w-0']),
    });
}

export interface PredictionOverrides {
    modelId?: string;
    modelVersion?: string;
    outputName?: string;
    values?: Float64Array;
    semantics?: ModelPrediction['semantics'];
}

/** A raw prediction for `metadata`, matching its declared output contract. */
export function makePrediction(
    metadata: Readonly<ModelMetadata>,
    over: PredictionOverrides = {},
): ModelPrediction {
    const classCount = metadata.output.classLabels.length;
    return Object.freeze({
        modelId: over.modelId ?? metadata.modelId,
        modelVersion: over.modelVersion ?? metadata.modelVersion,
        outputName: over.outputName ?? metadata.output.name,
        values: over.values ?? new Float64Array(classCount).fill(0),
        semantics: over.semantics ?? metadata.output.semantics,
    });
}

/** Aggregate a raw prediction's scores: [label, value][] after interpretation. */
export function toScores(interpreted: readonly { label: string; score: number }[]): string {
    return interpreted.map((entry) => `${entry.label}:${entry.score}`).join('|');
}
