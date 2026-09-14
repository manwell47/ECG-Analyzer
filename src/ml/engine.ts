/**
 * InferenceEngine boundary (Phase 6 / ADR-004).
 *
 * All inference flows through the {@link InferenceEngine} interface; ONNX
 * Runtime Web is one backend *behind* this interface and the UI never sees raw
 * tensor semantics. The engine validates a realized {@link ModelInput} against
 * the {@link ModelMetadata} it is about to run **before** executing: identity,
 * tensor name, dtype, shape (contract wildcards honoured), element count and
 * the preprocessing/normalization fingerprint. Incompatible inputs fail loudly
 * as `model-compatibility-failure` — data is never silently reshaped or
 * adapted to satisfy a dimension (rules §16; ADR-004).
 */

import { EcgError } from '../domain/error';
import type { ModelInput, ModelMetadata, ModelPrediction } from '../domain/ml';
import { metadataFingerprint } from './fingerprint';

/**
 * An inference backend. Implementations are responsible for calling
 * {@link assertInputCompatibleWithModel} before running, and for owning the
 * lifecycle of any underlying session/worker resources.
 */
export interface InferenceEngine {
    /** Stable backend identifier, e.g. 'stub' or 'onnx-web'. */
    readonly backendId: string;
    /**
     * Run a validated `ModelInput` against the model described by `metadata`.
     * Must refuse (loudly) any input that is not compatible with `metadata`.
     */
    run(metadata: Readonly<ModelMetadata>, input: Readonly<ModelInput>): Promise<ModelPrediction>;
    /** Release any session/worker resources owned by the backend. */
    dispose(): Promise<void>;
}

/** A concrete shape must have only positive dimensions (never -1). */
export function isConcreteShape(shape: readonly number[]): boolean {
    return shape.every((dimension) => Number.isInteger(dimension) && dimension >= 1);
}

/** Product of concrete shape dimensions (undefined when a dim is dynamic). */
export function tensorElementCount(shape: readonly number[]): number | undefined {
    if (!isConcreteShape(shape)) {
        return undefined;
    }
    return shape.reduce((product, dimension) => product * dimension, 1);
}

/**
 * Realize a contract shape (possibly with dynamic `-1` batch axes) against a
 * known flat element count, or return `undefined` when the count cannot be
 * represented. Every dynamic axis receives the same implied extent.
 */
export function realizeShape(
    contractShape: readonly number[],
    elementCount: number,
): readonly number[] | undefined {
    let fixed = 1;
    let dynamicCount = 0;
    for (const dimension of contractShape) {
        if (dimension === -1) {
            dynamicCount += 1;
        } else if (Number.isInteger(dimension) && dimension >= 1) {
            fixed *= dimension;
        } else {
            return undefined;
        }
    }
    if (dynamicCount === 0) {
        return fixed === elementCount ? [...contractShape] : undefined;
    }
    if (elementCount % fixed !== 0) {
        return undefined;
    }
    const implied = elementCount / fixed;
    if (!Number.isInteger(implied)) {
        return undefined;
    }
    return contractShape.map((dimension) => (dimension === -1 ? implied : dimension));
}

function shapeMismatch(contract: readonly number[], actual: readonly number[]): string | null {
    if (contract.length !== actual.length) {
        return `declared rank ${contract.length} but the input has rank ${actual.length}`;
    }
    for (let index = 0; index < contract.length; index += 1) {
        const declared = contract[index];
        const realized = actual[index];
        if (declared === -1 || declared === realized) {
            continue;
        }
        return `declared dimension ${index} = ${declared} but the input has ${realized}`;
    }
    return null;
}

/**
 * Return a human-oriented list of compatibility problems between a realized
 * `ModelInput` and the `ModelMetadata` an engine is about to run, or an empty
 * array when the input may be executed. Never throws.
 */
export function describeInputCompatibilityProblems(
    metadata: Readonly<ModelMetadata>,
    input: Readonly<ModelInput>,
): readonly string[] {
    const problems: string[] = [];

    if (input.modelId !== metadata.modelId) {
        problems.push(`input targets model "${input.modelId}" but the engine was given "${metadata.modelId}".`);
    }
    if (input.modelVersion !== metadata.modelVersion) {
        problems.push(`input targets version "${input.modelVersion}" but the engine was given "${metadata.modelVersion}".`);
    }
    if (input.tensorName !== metadata.input.name) {
        problems.push(`input feeds tensor "${input.tensorName}" but the model declares "${metadata.input.name}".`);
    }
    if (input.dtype !== metadata.input.dtype) {
        problems.push(`input dtype is ${input.dtype} but the model declares ${metadata.input.dtype}.`);
    }
    if (!isConcreteShape(input.shape)) {
        problems.push('input shape must be fully concrete (no dynamic -1 axes).');
    }
    const mismatch = shapeMismatch(metadata.input.shape, input.shape);
    if (mismatch !== null) {
        problems.push(`input shape is incompatible: ${mismatch}.`);
    }
    const elementCount = tensorElementCount(input.shape);
    if (elementCount !== undefined && elementCount !== input.data.length) {
        problems.push(
            `input shape implies ${elementCount} elements but the payload holds ${input.data.length}.`,
        );
    }
    const expectedFingerprint = metadataFingerprint(metadata);
    if (input.preprocessingFingerprint !== expectedFingerprint) {
        problems.push(
            'input preprocessing/normalization fingerprint does not match this model metadata.',
        );
    }

    return problems;
}

/**
 * Validate a realized input before execution and throw a single classified
 * `model-compatibility-failure` when it is not compatible with `metadata`.
 * Shape compatibility alone is never treated as scientific compatibility.
 */
export function assertInputCompatibleWithModel(
    metadata: Readonly<ModelMetadata>,
    input: Readonly<ModelInput>,
): void {
    const problems = describeInputCompatibilityProblems(metadata, input);
    if (problems.length > 0) {
        throw EcgError.modelCompatibility('Model input failed pre-execution validation.', {
            detail: problems.join(' '),
            meta: { problems: [...problems] },
        });
    }
}
