/**
 * Classification metrics (Phase 8 / ADR-007; rules §24, §47, §49).
 *
 * The single source of truth for the numbers an evaluation result reports. It
 * is pure, framework-free and deterministic: given a fixed declared class set
 * and a fixed outcome sequence it always produces the same numbers, and it
 * never mutates its inputs.
 *
 * Metric honesty rules that this module encodes structurally:
 *  - Every reported rate is **computed** from recorded per-window/per-record
 *    outcomes — never fabricated, hard-coded or imported as a benchmark
 *    (rules §24, §47).
 *  - A rate whose denominator is zero is reported as `null`, never as a
 *    made-up 0 or NaN — e.g. `precision` of a class that is predicted nowhere
 *    is `null`, not 0.
 *  - Accuracy is always reported alongside the full per-class picture (rules
 *    §24: never accuracy alone when imbalance matters).
 *  - An outcome whose true or predicted label is not in the declared class set
 *    fails loudly as `invalid-input`: it means the evaluation mixed a label the
 *    model (or its oracle) never declared, which must never slip silently into
 *    a confusion matrix.
 */
import { EcgError } from '../domain/error';

/**
 * One classified decision: the declared (ground-truth) label of a window and
 * the label the evaluated model predicted for it.
 */
export interface ClassifiedOutcome {
    readonly trueLabel: string;
    readonly predictedLabel: string;
}

/** An immutable confusion matrix over a declared, stable class order. */
export interface ConfusionMatrix {
    /** Declared classes in a stable order (row and column order agree). */
    readonly classLabels: readonly string[];
    /** Counts indexed [trueIndex][predictedIndex]. */
    readonly cells: ReadonlyArray<ReadonlyArray<number>>;
}

/** Per-class rates over the whole evaluation. `null` = undefined denominator. */
export interface ClassRates {
    readonly label: string;
    /** Number of windows whose true label is this class (row sum). */
    readonly support: number;
    readonly truePositives: number;
    readonly falseNegatives: number;
    readonly falsePositives: number;
    readonly trueNegatives: number;
    readonly precision: number | null;
    readonly recall: number | null;
    readonly specificity: number | null;
    readonly f1: number | null;
}

/** Aggregate classification metrics, one per declared class + overall. */
export interface ClassificationMetrics {
    readonly classLabels: readonly string[];
    /** Number of classified windows this summary describes. */
    readonly total: number;
    /** Correct / total, `null` for an empty evaluation. */
    readonly accuracy: number | null;
    readonly perClass: ReadonlyArray<ClassRates>;
    readonly confusion: ConfusionMatrix;
}

/** Throws `invalid-input` unless `classLabels` are declared, unique and non-empty. */
function assertDeclaredClassLabels(classLabels: readonly string[]): void {
    if (classLabels.length === 0) {
        throw EcgError.invalidInput(
            'Cannot compute classification metrics without at least one declared class label.',
        );
    }
    const seen = new Set<string>();
    for (const label of classLabels) {
        if (typeof label !== 'string' || label.length === 0) {
            throw EcgError.invalidInput(
                'Declared class labels must be non-empty strings.',
            );
        }
        if (seen.has(label)) {
            throw EcgError.invalidInput(
                `Declared class labels must be unique; "${label}" appears more than once.`,
            );
        }
        seen.add(label);
    }
}

/**
 * Tally `outcomes` into a confusion matrix over `classLabels`. Throws
 * `invalid-input` when an outcome references a label outside the declared set.
 */
export function computeConfusionMatrix(
    classLabels: readonly string[],
    outcomes: ReadonlyArray<Readonly<ClassifiedOutcome>>,
): ConfusionMatrix {
    assertDeclaredClassLabels(classLabels);

    const declared = new Set<string>(classLabels);
    for (const outcome of outcomes) {
        if (!declared.has(outcome.trueLabel)) {
            throw EcgError.invalidInput(
                `True label "${outcome.trueLabel}" is not one of the declared classes ` +
                `[${classLabels.join(', ')}].`,
            );
        }
        if (!declared.has(outcome.predictedLabel)) {
            throw EcgError.invalidInput(
                `Predicted label "${outcome.predictedLabel}" is not one of the declared classes ` +
                `[${classLabels.join(', ')}].`,
            );
        }
    }

    const indexOf = new Map<string, number>();
    classLabels.forEach((label, index) => indexOf.set(label, index));

    const cells = classLabels.map(() => classLabels.map(() => 0));
    for (const outcome of outcomes) {
        const trueIndex = indexOf.get(outcome.trueLabel)!;
        const predictedIndex = indexOf.get(outcome.predictedLabel)!;
        cells[trueIndex]![predictedIndex]! += 1;
    }

    return Object.freeze({
        classLabels: Object.freeze([...classLabels]),
        cells: Object.freeze(
            cells.map((row) => Object.freeze(row) as ReadonlyArray<number>),
        ),
    });
}

/** `numerator / denominator`, or `null` when the denominator is zero. */
function ratioOrNull(numerator: number, denominator: number): number | null {
    return denominator === 0 ? null : numerator / denominator;
}

/**
 * Compute full classification metrics from declared classes and outcomes.
 *
 * `accuracy` is the overall correct fraction (`null` for an empty evaluation);
 * `perClass` reports the confusion-derived rates with `null` wherever the
 * denominator is undefined, so no fabricated zero is ever reported as a real
 * rate. Nothing is ever mutated and the result is frozen.
 */
export function computeClassificationMetrics(
    classLabels: readonly string[],
    outcomes: ReadonlyArray<Readonly<ClassifiedOutcome>>,
): ClassificationMetrics {
    const confusion = computeConfusionMatrix(classLabels, outcomes);
    const { cells } = confusion;
    const total = outcomes.length;

    const perClass = classLabels.map((label, index) => {
        let rowSum = 0;
        for (const cell of cells[index]!) {
            rowSum += cell;
        }
        let columnSum = 0;
        for (let trueIndex = 0; trueIndex < cells.length; trueIndex += 1) {
            columnSum += cells[trueIndex]![index]!;
        }
        const truePositives = cells[index]![index]!;
        const falseNegatives = rowSum - truePositives;
        const falsePositives = columnSum - truePositives;
        const trueNegatives = total - truePositives - falseNegatives - falsePositives;

        const precision = ratioOrNull(truePositives, truePositives + falsePositives);
        const recall = ratioOrNull(truePositives, truePositives + falseNegatives);
        const specificity = ratioOrNull(trueNegatives, trueNegatives + falsePositives);
        const f1Denominator = 2 * truePositives + falsePositives + falseNegatives;
        const f1 =
            f1Denominator === 0 ? null : (2 * truePositives) / f1Denominator;

        return Object.freeze({
            label,
            support: rowSum,
            truePositives,
            falseNegatives,
            falsePositives,
            trueNegatives,
            precision,
            recall,
            specificity,
            f1,
        });
    });

    let correct = 0;
    for (let index = 0; index < cells.length; index += 1) {
        correct += cells[index]![index]!;
    }

    return Object.freeze({
        classLabels: confusion.classLabels,
        total,
        accuracy: total === 0 ? null : correct / total,
        perClass: Object.freeze(perClass as ReadonlyArray<ClassRates>),
        confusion,
    });
}
