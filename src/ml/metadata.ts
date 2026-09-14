/**
 * ModelMetadata strict schema validation (Phase 6 / ADR-004).
 *
 * `ModelMetadata` is an externalized, versioned scientific contract that ships
 * beside a model artifact and is validated at load. This module is the "strict
 * schema" gate: it accepts `unknown` (e.g. freshly `JSON.parse`d metadata) and
 * reports every structural problem without throwing, or aggregates them into a
 * single classified `model-loading-failure` via {@link assertValidModelMetadata}.
 *
 * Validation here is deliberately structural (types, required fields, shape
 * well-formedness). Runtime compatibility of a *realized* input against this
 * contract is enforced separately by the inference boundary (see `engine.ts`).
 */

import { EcgError } from '../domain/error';
import {
    isTensorDtype,
    type ModelMetadata,
    type ModelOutputContract,
    type PreprocessingAssumption,
    type TensorDtype,
} from '../domain/ml';

const OUTPUT_SEMANTICS = new Set(['logits', 'probabilities', 'model-scores']);
const OUTPUT_ACTIVATIONS = new Set(['none', 'softmax', 'sigmoid']);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

/** A well-formed metadata shape dimension: integer and either -1 or >= 1. */
function isValidDimension(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && (value === -1 || value >= 1);
}

function isValidPositiveInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function isPlainConfig(value: unknown): value is Readonly<Record<string, unknown>> {
    if (!isRecord(value)) {
        return false;
    }
    return Object.values(value).every(
        (field) =>
            typeof field === 'string' ||
            typeof field === 'number' ||
            typeof field === 'boolean' ||
            field === null ||
            isRecord(field) ||
            Array.isArray(field),
    );
}

function describeTensorContract(
    problems: string[],
    path: string,
    value: unknown,
): value is { name: string; shape: number[]; dtype: TensorDtype; layout: string } {
    if (!isRecord(value)) {
        problems.push(`${path} must be an object.`);
        return false;
    }
    const { name, shape, dtype, layout } = value;
    if (!isNonEmptyString(name)) {
        problems.push(`${path}.name must be a non-empty string.`);
    }
    if (!Array.isArray(shape) || shape.length === 0) {
        problems.push(`${path}.shape must be a non-empty array of dimensions.`);
    } else {
        shape.forEach((dimension, index) => {
            if (!isValidDimension(dimension)) {
                problems.push(
                    `${path}.shape[${index}] must be an integer (-1 for a dynamic axis, or >= 1), received ${String(dimension)}.`,
                );
            }
        });
    }
    if (!isTensorDtype(dtype)) {
        problems.push(`${path}.dtype must be one of the supported tensor dtypes, received ${JSON.stringify(dtype)}.`);
    }
    if (!isNonEmptyString(layout)) {
        problems.push(`${path}.layout must be a non-empty documented layout token.`);
    }
    return true;
}

function describeOutputContract(problems: string[], path: string, value: unknown): void {
    if (!isRecord(value)) {
        problems.push(`${path} must be an object.`);
        return;
    }
    const { name, dtype, semantics, activation, classLabels } = value;
    if (!isNonEmptyString(name)) {
        problems.push(`${path}.name must be a non-empty string.`);
    }
    if (!isTensorDtype(dtype)) {
        problems.push(`${path}.dtype must be a supported tensor dtype.`);
    }
    if (typeof semantics !== 'string' || !OUTPUT_SEMANTICS.has(semantics)) {
        problems.push(
            `${path}.semantics must be 'logits', 'probabilities' or 'model-scores', received ${JSON.stringify(semantics)}.`,
        );
    }
    if (typeof activation !== 'string' || !OUTPUT_ACTIVATIONS.has(activation)) {
        problems.push(
            `${path}.activation must be 'none', 'softmax' or 'sigmoid', received ${JSON.stringify(activation)}.`,
        );
    }
    if (!Array.isArray(classLabels) || classLabels.length === 0) {
        problems.push(`${path}.classLabels must be a non-empty array of ordered class labels.`);
    } else {
        classLabels.forEach((label, index) => {
            if (!isNonEmptyString(label)) {
                problems.push(`${path}.classLabels[${index}] must be a non-empty string.`);
            }
        });
    }
}

/**
 * Return a human-oriented list of structural problems in an arbitrary value
 * intended to be `ModelMetadata`, or an empty array when it is well-formed.
 * Never throws.
 */
export function describeModelMetadataProblems(value: unknown): readonly string[] {
    const problems: string[] = [];
    if (!isRecord(value)) {
        problems.push('ModelMetadata must be a JSON object.');
        return problems;
    }

    const { modelId, modelVersion, task, input, expectedSamplingRateHz, expectedChannels, expectedWindowSamples, preprocessingAssumptions, normalization, output, provenance } = value;

    if (!isNonEmptyString(modelId)) {
        problems.push('modelId must be a non-empty string.');
    }
    if (!isNonEmptyString(modelVersion)) {
        problems.push('modelVersion must be a non-empty string.');
    }
    if (!isNonEmptyString(task)) {
        problems.push('task must be a non-empty string.');
    }

    if (typeof expectedSamplingRateHz !== 'undefined' && !(typeof expectedSamplingRateHz === 'number' && Number.isFinite(expectedSamplingRateHz) && expectedSamplingRateHz > 0)) {
        problems.push('expectedSamplingRateHz must be a finite number > 0 when present.');
    }
    if (typeof expectedChannels !== 'undefined' && !isValidPositiveInteger(expectedChannels)) {
        problems.push('expectedChannels must be a positive integer when present.');
    }
    if (typeof expectedWindowSamples !== 'undefined' && !isValidPositiveInteger(expectedWindowSamples)) {
        problems.push('expectedWindowSamples must be a positive integer when present.');
    }

    describeTensorContract(problems, 'input', input);
    describeOutputContract(problems, 'output', output);

    if (!Array.isArray(preprocessingAssumptions)) {
        problems.push('preprocessingAssumptions must be an array.');
    } else {
        preprocessingAssumptions.forEach((assumption, index) => {
            const path = `preprocessingAssumptions[${index}]`;
            if (!isRecord(assumption)) {
                problems.push(`${path} must be an object.`);
                return;
            }
            if (!isNonEmptyString(assumption.stage)) {
                problems.push(`${path}.stage must be a non-empty string.`);
            }
            if (typeof assumption.config !== 'undefined' && !isPlainConfig(assumption.config)) {
                problems.push(`${path}.config must be a flat object of scalar/JSON values.`);
            }
        });
    }

    if (!isRecord(normalization)) {
        problems.push('normalization must be an object.');
    } else {
        if (!isNonEmptyString(normalization.strategy)) {
            problems.push('normalization.strategy must be a non-empty string.');
        }
        if (typeof normalization.fittedFrom !== 'undefined' && !isNonEmptyString(normalization.fittedFrom)) {
            problems.push('normalization.fittedFrom must be a non-empty string when present.');
        }
    }

    if (typeof provenance !== 'undefined' && !isRecord(provenance)) {
        problems.push('provenance must be an object when present.');
    } else if (isRecord(provenance)) {
        for (const field of ['trainingDataset', 'methodology', 'limitations'] as const) {
            const entry = provenance[field];
            if (typeof entry !== 'undefined' && !isNonEmptyString(entry)) {
                problems.push(`provenance.${field} must be a non-empty string when present.`);
            }
        }
    }

    return problems;
}

/**
 * Validate `ModelMetadata` at load time and throw a single classified
 * `model-loading-failure` (aggregating every problem) when it is malformed.
 */
export function assertValidModelMetadata(value: unknown): asserts value is ModelMetadata {
    const problems = describeModelMetadataProblems(value);
    if (problems.length > 0) {
        throw EcgError.modelLoading('Model metadata failed schema validation.', {
            detail: problems.join(' '),
            meta: { problems: [...problems] },
        });
    }
}

/**
 * Load a `ModelMetadata` document from its JSON text: parse, validate strictly,
 * and return the typed contract. Any parse or schema failure surfaces as a
 * classified error so a malformed metadata file can never reach an engine.
 */
export function parseModelMetadataJson(text: string): ModelMetadata {
    let raw: unknown;
    try {
        raw = JSON.parse(text) as unknown;
    } catch (cause) {
        throw EcgError.modelLoading('Model metadata is not valid JSON.', {
            cause: cause instanceof Error ? cause : undefined,
        });
    }

    assertValidModelMetadata(raw);

    // `raw` has been narrowed to `ModelMetadata` by the assertion above; widen
    // back through `unknown` to read the individual fields defensively.
    const record = raw as unknown as Record<string, unknown>;
    const input = record.input as {
        name: string;
        shape: number[];
        dtype: TensorDtype;
        layout: string;
    };
    const output = record.output as ModelOutputContract;
    const assumptions = (record.preprocessingAssumptions as unknown[]).map((entry) => {
        const assumption = entry as Partial<PreprocessingAssumption>;
        return { stage: assumption.stage as string, config: assumption.config ?? {} };
    });
    const normalization = record.normalization as { strategy: string; fittedFrom?: string };
    const provenanceRecord =
        record.provenance === undefined
            ? undefined
            : (record.provenance as Record<string, unknown>);

    return {
        modelId: record.modelId as string,
        modelVersion: record.modelVersion as string,
        task: record.task as string,
        input,
        expectedSamplingRateHz:
            record.expectedSamplingRateHz === undefined
                ? undefined
                : (record.expectedSamplingRateHz as number),
        expectedChannels:
            record.expectedChannels === undefined
                ? undefined
                : (record.expectedChannels as number),
        expectedWindowSamples:
            record.expectedWindowSamples === undefined
                ? undefined
                : (record.expectedWindowSamples as number),
        preprocessingAssumptions: assumptions,
        normalization: {
            strategy: normalization.strategy,
            fittedFrom:
                normalization.fittedFrom === undefined ? undefined : normalization.fittedFrom,
        },
        output,
        provenance: {
            trainingDataset: optionalString(provenanceRecord, 'trainingDataset'),
            methodology: optionalString(provenanceRecord, 'methodology'),
            limitations: optionalString(provenanceRecord, 'limitations'),
        },
    };
}

function optionalString(
    record: Record<string, unknown> | undefined,
    key: string,
): string | undefined {
    const entry = record?.[key];
    return typeof entry === 'string' && entry.trim().length > 0 ? entry : undefined;
}
