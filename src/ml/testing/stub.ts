/**
 * Deterministic stub inference engine (Phase 6 / ADR-004) — TEST ONLY.
 *
 * This engine lives under `src/ml/testing/` and is intentionally NOT exported
 * from the production `src/ml/index.ts` barrel: it is a stand-in for wiring and
 * unit tests so that orchestration, input validation and output interpretation
 * can be exercised without an ONNX artifact or `onnxruntime-web`. It must never
 * be reachable from a production code path (rules §33).
 *
 * The stub is a real {@link InferenceEngine}: it validates the realized input
 * against the model metadata *before* execution exactly as a production backend
 * must, then returns a deterministic raw output that is self-consistent with the
 * metadata (logits stay logits, 'probabilities' semantics receive the declared
 * activation, 'model-scores' stay uncalibrated). Its numeric rule is arbitrary
 * and carries **no scientific meaning** — it exists only to prove that the
 * contract wiring works.
 */

import { EcgError } from '../../domain/error';
import type {
    ModelInput,
    ModelMetadata,
    ModelPrediction,
    OutputActivation,
} from '../../domain/ml';
import { assertInputCompatibleWithModel, type InferenceEngine } from '../engine';

export interface StubEngineOptions {
    /**
     * Deterministic per-class offset added to every computed logit. Lets a test
     * steer which class wins the argmax without touching the deterministic rule.
     */
    readonly logitBias?: readonly number[];
    /** Overrides the stable backend identifier (defaults to 'stub'). */
    readonly backendId?: string;
}

function applyActivation(values: Float64Array, activation: OutputActivation): Float64Array {
    if (activation === 'softmax') {
        let max = -Infinity;
        for (let index = 0; index < values.length; index += 1) {
            const value = values[index]!;
            if (value > max) {
                max = value;
            }
        }
        const exponentials = new Float64Array(values.length);
        let denominator = 0;
        for (let index = 0; index < values.length; index += 1) {
            const value = Math.exp(values[index]! - max);
            exponentials[index] = value;
            denominator += value;
        }
        for (let index = 0; index < values.length; index += 1) {
            exponentials[index] = exponentials[index]! / denominator;
        }
        return exponentials;
    }
    if (activation === 'sigmoid') {
        const transformed = new Float64Array(values.length);
        for (let index = 0; index < values.length; index += 1) {
            transformed[index] = 1 / (1 + Math.exp(-values[index]!));
        }
        return transformed;
    }
    return values;
}

export class StubInferenceEngine implements InferenceEngine {
    readonly backendId: string;

    private readonly logitBias: readonly number[];

    private disposed = false;

    constructor(options: StubEngineOptions = {}) {
        this.backendId = options.backendId ?? 'stub';
        this.logitBias = options.logitBias ?? [];
    }

    async run(
        metadata: Readonly<ModelMetadata>,
        input: Readonly<ModelInput>,
    ): Promise<ModelPrediction> {
        assertInputCompatibleWithModel(metadata, input);
        if (this.disposed) {
            throw EcgError.inference('Stub engine has been disposed and cannot run.');
        }

        const classCount = metadata.output.classLabels.length;
        const count = input.data.length;
        let sum = 0;
        let sumOfSquares = 0;
        for (let index = 0; index < count; index += 1) {
            const value = input.data[index]!;
            sum += value;
            sumOfSquares += value * value;
        }
        const mean = sum / count;
        const rms = Math.sqrt(sumOfSquares / count);

        // Deterministic, non-scientific per-class raw logits that still depend on
        // the actual payload (so tests can observe the data flowing through).
        const rawLogits = new Float64Array(classCount);
        for (let classIndex = 0; classIndex < classCount; classIndex += 1) {
            rawLogits[classIndex] =
                (this.logitBias[classIndex] ?? 0) +
                mean * 0.1 * (classIndex + 1) +
                rms * 0.05 * (classCount - classIndex);
        }

        let values: Float64Array;
        if (metadata.output.semantics === 'probabilities') {
            // The model is declared to have already applied its activation, so the
            // stub emits the activated vector to stay self-consistent.
            values = applyActivation(rawLogits, metadata.output.activation);
        } else {
            // 'logits' (interpretation applies the declared activation later) and
            // 'model-scores' (uncalibrated by declaration) pass through raw.
            values = rawLogits;
        }

        return Object.freeze({
            modelId: metadata.modelId,
            modelVersion: metadata.modelVersion,
            outputName: metadata.output.name,
            values,
            semantics: metadata.output.semantics,
        });
    }

    async dispose(): Promise<void> {
        this.disposed = true;
    }
}

/** Convenience factory returning a configured stub engine. */
export function createStubEngine(options: StubEngineOptions = {}): StubInferenceEngine {
    return new StubInferenceEngine(options);
}
