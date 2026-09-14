/**
 * Machine-learning domain contracts (Phase 6 / ADR-004).
 *
 * These types externalize every model-specific assumption (tensor contract,
 * expected sampling, normalization, output semantics) into versioned
 * `ModelMetadata` so the presentation layer never learns tensor shapes and no
 * shape-compatible tensor is ever mistaken for a scientifically compatible one.
 *
 * The raw tensors that cross into/out of an inference backend are framework-free
 * flat typed arrays plus an explicit `shape`; ONNX-specific tensor wrappers are
 * an adapter concern and never appear here.
 */

import type { Provenance } from './signal';

/** Numeric tensor element types supported by the inference contract. */
export const TENSOR_DTYPES = [
    'float32',
    'float64',
    'int8',
    'int16',
    'int32',
    'int64',
    'uint8',
    'uint16',
    'uint32',
] as const;

export type TensorDtype = (typeof TENSOR_DTYPES)[number];

export function isTensorDtype(value: unknown): value is TensorDtype {
    return (
        typeof value === 'string' && (TENSOR_DTYPES as readonly string[]).includes(value)
    );
}

/** Flat numeric data acceptable as a model tensor payload. */
export type ModelTensorData =
    | Float32Array
    | Float64Array
    | Int8Array
    | Int16Array
    | Int32Array
    | BigInt64Array
    | Uint8Array
    | Uint16Array
    | Uint32Array;

/**
 * Concrete (fully static) tensor shape: every dimension is a positive integer.
 * Dynamic `-1` dimensions belong only in a model's declared contract, never in a
 * realized input/output tensor.
 */
export interface ConcreteShape {
    readonly dims: readonly number[];
}

/** Expected input tensor of a model (as declared in metadata). */
export interface ModelInputContract {
    /** Graph input name (must match the ONNX graph input). */
    readonly name: string;
    /**
     * Declared shape; a dimension may be `-1` to denote a dynamic (batch) axis.
     * A single inference realizes every axis concretely.
     */
    readonly shape: readonly number[];
    readonly dtype: TensorDtype;
    /** Documented layout token (e.g. 'nc', 'nct'), never parsed by the UI. */
    readonly layout: string;
}

/** What the raw output numbers actually represent (rules §18, §19). */
export type OutputSemantics = 'logits' | 'probabilities' | 'model-scores';

/** Activation the model applies to produce its raw output, if any. */
export type OutputActivation = 'none' | 'softmax' | 'sigmoid';

/** Expected output tensor of a model (as declared in metadata). */
export interface ModelOutputContract {
    /** Graph output name (must match the ONNX graph output). */
    readonly name: string;
    readonly dtype: TensorDtype;
    readonly semantics: OutputSemantics;
    readonly activation: OutputActivation;
    /** Ordered class labels; `classLabels[i]` corresponds to output index `i`. */
    readonly classLabels: readonly string[];
}

/** One documented preprocessing assumption that produced model inputs. */
export interface PreprocessingAssumption {
    /** Canonical stage name, e.g. 'bandpass-0.5-40hz' or 'resample-to-360'. */
    readonly stage: string;
    /** Exact, machine-readable configuration for that stage (may be empty). */
    readonly config: Readonly<Record<string, unknown>>;
}

/** Normalization contract the model was trained with (rules §20 leakage). */
export interface ModelNormalization {
    /** Strategy name, e.g. 'none', 'zscore', 'minmax'. */
    readonly strategy: string;
    /** Where fitted parameters came from; never raw evaluation data. */
    readonly fittedFrom?: string;
}

/** Provenance of the model artifact itself (never performance claims). */
export interface ModelProvenance {
    readonly trainingDataset?: string;
    readonly methodology?: string;
    readonly limitations?: string;
}

/**
 * Externalized, versioned description of one model — the anti-SIGIL pattern.
 * Loaded and validated from a strict schema before any inference (ADR-004).
 */
export interface ModelMetadata {
    readonly modelId: string;
    readonly modelVersion: string;
    /** Task label, e.g. 'beat-classification' (informational). */
    readonly task: string;
    readonly input: ModelInputContract;
    /** Sampling the model was trained on; must match before inference. */
    readonly expectedSamplingRateHz?: number;
    /** Number of signal channels fed to the model. */
    readonly expectedChannels?: number;
    /** Samples per channel per window fed to the model. */
    readonly expectedWindowSamples?: number;
    /** The exact signal→tensor contract, stage by stage. */
    readonly preprocessingAssumptions: readonly PreprocessingAssumption[];
    readonly normalization: ModelNormalization;
    readonly output: ModelOutputContract;
    readonly provenance: ModelProvenance;
}

/**
 * A realized, concrete model input prepared from exactly the preprocessing
 * contract of one `ModelMetadata` (rules §17: what samples, what order, what
 * scale, what shape).
 */
export interface ModelInput {
    readonly modelId: string;
    readonly modelVersion: string;
    /** Graph input name this payload targets. */
    readonly tensorName: string;
    readonly dtype: TensorDtype;
    /** Concrete shape of the realized tensor. */
    readonly shape: readonly number[];
    /** Row-major flattened payload; length equals the product of `shape`. */
    readonly data: Float32Array | Float64Array;
    /**
     * Stable hex fingerprint of the metadata/preprocessing/normalization that
     * produced this input; an engine refuses inputs whose fingerprint does not
     * match the model it is about to run.
     */
    readonly preprocessingFingerprint: string;
    /** Which source windows these exact samples came from, in order. */
    readonly sourceWindowIds: readonly string[];
    /** Optional origin history of the samples (not tensor construction). */
    readonly provenance?: Provenance;
}

/** Raw, un-interpreted model output (rules §18: never assume output[0]). */
export interface ModelPrediction {
    readonly modelId: string;
    readonly modelVersion: string;
    /** Graph output name the raw values came from. */
    readonly outputName: string;
    /** Flat raw values (logits, probabilities or model-scores per metadata). */
    readonly values: Float64Array;
    /** What `values` are, exactly as declared by the model's metadata. */
    readonly semantics: OutputSemantics;
}

/** Semantics an interpreted score genuinely has (rules §19, §49). */
export type InterpretedSemantics = 'predicted-probability' | 'model-score';

/**
 * Interpreted prediction: an explicit label + score whose `semantics` states
 * whether the value is a real probability or an uncalibrated model score.
 * "Confidence" phrasing is never invented here.
 */
export interface InterpretedPrediction {
    readonly modelId: string;
    readonly modelVersion: string;
    readonly label: string;
    readonly score: number;
    readonly semantics: InterpretedSemantics;
}
