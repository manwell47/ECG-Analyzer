/**
 * Explicit output interpretation (Phase 6 / ADR-004; rules §18, §19, §49).
 *
 * An engine returns a raw {@link ModelPrediction}: flat numbers plus a declared
 * semantics. Those numbers may be logits (unbounded, un-interpretable directly),
 * already probabilities, or uncalibrated model scores. Only this module turns
 * them into {@link InterpretedPrediction}s with an explicit label and a score
 * whose `semantics` states truthfully whether it is a real probability or an
 * uncalibrated score. "Confidence" phrasing is never invented here and the UI
 * never performs this conversion itself.
 *
 * Conversion rules (deterministic, no silent assumptions):
 *  - `semantics: 'probabilities'` → values are already probabilities.
 *  - `semantics: 'logits'`        → a declared `activation` of `softmax` /
 *    `sigmoid` converts them into probabilities; `activation: 'none'` means the
 *    model does not claim a probability, so the raw logits are surfaced honestly
 *    as uncalibrated `model-score`s rather than fabricated probabilities.
 *  - `semantics: 'model-scores'`  → values are uncalibrated by declaration.
 *
 * Results are returned in descending score order (deterministic tie-break by
 * declared class order), so `result[0]` is always the argmax prediction.
 */

import { EcgError } from '../domain/error';
import type {
    InterpretedPrediction,
    InterpretedSemantics,
    ModelMetadata,
    ModelPrediction,
} from '../domain/ml';
import { assertValidModelMetadata } from './metadata';

/** Numerically stable softmax over a full logit vector (a probability simplex). */
function stableSoftmax(logits: Float64Array): Float64Array {
    let max = -Infinity;
    for (let index = 0; index < logits.length; index += 1) {
        const logit = logits[index]!;
        if (logit > max) {
            max = logit;
        }
    }
    const exponentials = new Float64Array(logits.length);
    let denominator = 0;
    for (let index = 0; index < logits.length; index += 1) {
        const value = Math.exp(logits[index]! - max);
        exponentials[index] = value;
        denominator += value;
    }
    for (let index = 0; index < logits.length; index += 1) {
        exponentials[index] = exponentials[index]! / denominator;
    }
    return exponentials;
}

/** Elementwise sigmoid (independent Bernoulli probabilities per class). */
function sigmoid(values: Float64Array): Float64Array {
    const transformed = new Float64Array(values.length);
    for (let index = 0; index < values.length; index += 1) {
        transformed[index] = 1 / (1 + Math.exp(-values[index]!));
    }
    return transformed;
}

/**
 * Convert a raw {@link ModelPrediction} into one {@link InterpretedPrediction}
 * per declared class, ordered by descending score (deterministic on ties).
 *
 * Any inconsistency between the prediction and the authoritative metadata
 * (identity, output name, declared semantics, class count) or a non-finite raw
 * value fails loudly as an `inference-failure` — an engine that produced it is
 * broken and its output must never reach a user as a label.
 */
export function interpretPrediction(
    metadata: Readonly<ModelMetadata>,
    prediction: Readonly<ModelPrediction>,
): readonly InterpretedPrediction[] {
    assertValidModelMetadata(metadata);

    if (prediction.modelId !== metadata.modelId) {
        throw EcgError.inference(
            `Cannot interpret output of model "${prediction.modelId}" against metadata for "${metadata.modelId}".`,
        );
    }
    if (prediction.modelVersion !== metadata.modelVersion) {
        throw EcgError.inference(
            `Cannot interpret output of model version "${prediction.modelVersion}" against metadata for "${metadata.modelVersion}".`,
        );
    }
    if (prediction.outputName !== metadata.output.name) {
        throw EcgError.inference(
            `Prediction came from output "${prediction.outputName}" but the model declares "${metadata.output.name}".`,
        );
    }
    if (prediction.semantics !== metadata.output.semantics) {
        throw EcgError.inference(
            `Prediction is declared ${prediction.semantics} but the model metadata declares ${metadata.output.semantics}.`,
        );
    }

    const { classLabels, activation } = metadata.output;
    if (prediction.values.length !== classLabels.length) {
        throw EcgError.inference(
            `Prediction carries ${prediction.values.length} value(s) but the model declares ${classLabels.length} class label(s).`,
        );
    }
    for (let index = 0; index < prediction.values.length; index += 1) {
        if (!Number.isFinite(prediction.values[index])) {
            throw EcgError.inference(
                `Prediction contains a non-finite value at class index ${index}; a model output must be finite to be interpreted.`,
            );
        }
    }

    const declaredSemantics = metadata.output.semantics;
    let scores: Float64Array;
    let resultSemantics: InterpretedSemantics;

    if (declaredSemantics === 'probabilities') {
        // Values are already probabilities (softmax or sigmoid baked into the
        // model). activation is informational; no conversion is performed.
        scores = new Float64Array(prediction.values);
        resultSemantics = 'predicted-probability';
    } else if (declaredSemantics === 'logits') {
        if (activation === 'softmax') {
            scores = stableSoftmax(prediction.values);
            resultSemantics = 'predicted-probability';
        } else if (activation === 'sigmoid') {
            scores = sigmoid(prediction.values);
            resultSemantics = 'predicted-probability';
        } else {
            // logits with no declared activation: no honest way to claim a
            // probability. Surface the raw logits as uncalibrated model-scores.
            scores = new Float64Array(prediction.values);
            resultSemantics = 'model-score';
        }
    } else {
        // 'model-scores': uncalibrated by declaration. Never relabel as a
        // probability, even when an activation was declared.
        scores = new Float64Array(prediction.values);
        resultSemantics = 'model-score';
    }

    const ordered = classLabels.map((label, index) => ({
        index,
        label,
        score: scores[index]!,
    }));
    ordered.sort((a, b) => {
        if (b.score !== a.score) {
            return b.score - a.score;
        }
        return a.index - b.index;
    });

    return ordered.map((entry) =>
        Object.freeze({
            modelId: metadata.modelId,
            modelVersion: metadata.modelVersion,
            label: entry.label,
            score: entry.score,
            semantics: resultSemantics,
        }),
    );
}
