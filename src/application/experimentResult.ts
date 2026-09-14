/**
 * Experiment result + JSON provenance export (Phase 8 / ADR-007, ADR-009).
 *
 * An `ExperimentResult` is the *frozen snapshot* of one evaluation run: the
 * deterministic `experimentId`, a full re-runnable configuration snapshot, the
 * ground-truth labeler that was applied, the software version, an explicit
 * scope/limitations note, an ISO timestamp, the per-record outcomes (with the
 * provenance transform chain the physical-unit signal carried), and the
 * aggregate classification metrics computed from those outcomes.
 *
 * Export integrity (rules §24 — metrics are computed, never re-imported as
 * prose, and results must travel without losing meaning):
 *  - `serializeExperimentResult` emits a **canonical, key-ordered** document
 *    (single-sourced `stableStringify` from `src/ml`, rules §30 — no duplicated
 *    serialization logic), so equivalent results serialize identically.
 *  - `parseExperimentResult` is a **strict round-trip validator**: it rejects
 *    malformed JSON/structures with a classified `invalid-input` `EcgError`,
 *    and it re-checks three coherence invariants that a hand-edited document
 *    could silently break:
 *      1. `experimentId` equals `experimentIdOf(config)` — a result's id always
 *         matches its configuration snapshot (ADR-007);
 *      2. `labeler` equals `config.evaluation` — the rule actually applied must
 *         be the rule the configuration declared;
 *      3. `metrics` equal a fresh recomputation from the recorded per-window
 *         outcomes — an exported metric that contradicts its own outcomes is
 *         incoherent and must fail loudly, never parse silently.
 *
 * `windowId` is stable and unique per record + channel + start sample, e.g.
 * `sync/ch/1/w0`, so downstream tooling can address a single window across
 * exports without ambiguity.
 */
import { EcgError } from '../domain/error';
import type { InterpretedSemantics } from '../domain/ml';
import type { RecordId, SubjectId } from '../domain/record';
import type { Provenance } from '../domain/signal';
import { stableStringify } from '../ml';
import {
    describeExperimentConfigurationProblems,
    experimentIdOf,
    type ExperimentConfiguration,
    type ExperimentLabelerRef,
} from './experiment';
import {
    computeClassificationMetrics,
    type ClassificationMetrics,
} from './metrics';

/** Stable, unique window address: `${recordId}/ch/${channelIndex}/w${startSample}`. */
export function windowIdOf(
    recordId: RecordId,
    channelIndex: number,
    startSample: number,
): string {
    return `${recordId}/ch/${channelIndex}/w${startSample}`;
}

/**
 * One classified window: where it came from, the model's interpretation, and
 * the ground-truth label it was scored against. Fields are repeated here (not
 * only on the parent `RecordEvaluation`) so each outcome row is independently
 * interpretable in a flat window table.
 */
export interface WindowOutcome {
    /** Stable window address (see {@link windowIdOf}). */
    readonly windowId: string;
    readonly recordId: RecordId;
    readonly channelIndex: number;
    readonly channelName: string;
    /** First sample of the window in the source channel. */
    readonly startSample: number;
    /** Window length in samples (always the configured window length). */
    readonly lengthSamples: number;
    /** Ground-truth label (from the evaluation's declared labeler rule). */
    readonly trueLabel: string;
    /** Label the evaluated model predicted (interpret argmax). */
    readonly predictedLabel: string;
    /** Score of `predictedLabel`; see `semantics` for what the value means. */
    readonly predictedScore: number;
    /** Honest meaning of `predictedScore` (real probability or model score). */
    readonly semantics: InterpretedSemantics;
}

/**
 * Per-record evaluation: identity, the single evaluated channel, the provenance
 * transform chain the physical-unit signal carried when windows were cut, and
 * the outcomes of every window.
 */
export interface RecordEvaluation {
    readonly recordId: RecordId;
    readonly subjectId: SubjectId;
    readonly channelName: string;
    readonly channelIndex: number;
    /** Transform chain (`recordToMillivoltSignal` + any declared filter). */
    readonly provenance: Provenance;
    readonly windows: ReadonlyArray<WindowOutcome>;
}

/**
 * The complete, immutable outcome of one experiment run. Frozen at the runner
 * boundary; the JSON document produced by {@link serializeExperimentResult} is
 * the portable form.
 */
export interface ExperimentResult {
    /** Deterministic id of the configuration that produced this result. */
    readonly experimentId: string;
    /** Snapshot of everything needed to re-run the evaluation. */
    readonly config: ExperimentConfiguration;
    /**
     * The ground-truth rule actually applied. Coherence invariant: equals
     * `config.evaluation` (see module header).
     */
    readonly labeler: ExperimentLabelerRef;
    /** Library/app version that produced the result (reproducibility). */
    readonly softwareVersion: string;
    /**
     * Explicit scope/limitations note. For seam runs this must state the
     * non-clinical, pipeline-validation scope (rules §47, §49 — never let a
     * scope-limited result read like a clinical claim).
     */
    readonly scopeNote: string;
    /** ISO-8601 timestamp of when the evaluation ran (reproducibility). */
    readonly evaluatedAtIso: string;
    /** One entry per evaluated record (window outcomes grouped per record). */
    readonly records: ReadonlyArray<RecordEvaluation>;
    /** Aggregate metrics computed from every recorded window outcome. */
    readonly metrics: ClassificationMetrics;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

function describeTransformStepProblems(
    value: unknown,
    at: string,
    problems: string[],
): void {
    if (!isPlainObject(value)) {
        problems.push(`${at} must be an object.`);
        return;
    }
    if (!isNonEmptyString(value.name)) {
        problems.push(`${at}.name must be a non-empty string.`);
    }
    if (!isPlainObject(value.parameters)) {
        problems.push(`${at}.parameters must be an object.`);
    }
    const appliedAtIso = value.appliedAtIso;
    if (appliedAtIso !== undefined) {
        if (
            typeof appliedAtIso !== 'string' ||
            Number.isNaN(Date.parse(appliedAtIso))
        ) {
            problems.push(`${at}.appliedAtIso must be an ISO-8601 timestamp when present.`);
        }
    }
}

function describeProvenanceProblems(
    value: unknown,
    at: string,
    problems: string[],
): void {
    if (!isPlainObject(value)) {
        problems.push(`${at} must be an object.`);
        return;
    }
    const source = value.source;
    if (source !== undefined && typeof source !== 'string') {
        problems.push(`${at}.source must be a string when present.`);
    }
    const transforms = value.transforms;
    if (!Array.isArray(transforms)) {
        problems.push(`${at}.transforms must be an array.`);
        return;
    }
    transforms.forEach((step, index) => {
        describeTransformStepProblems(step, `${at}.transforms[${index}]`, problems);
    });
}

function describeRecordProblems(
    value: unknown,
    at: string,
    seenRecordIds: Set<string>,
    windowIds: Set<string>,
    problems: string[],
): void {
    if (!isPlainObject(value)) {
        problems.push(`${at} must be an object.`);
        return;
    }
    const { recordId, subjectId, channelName, channelIndex, provenance, windows } = value;

    if (!isNonEmptyString(recordId)) {
        problems.push(`${at}.recordId must be a non-empty string.`);
    } else if (seenRecordIds.has(recordId)) {
        problems.push(`${at}.recordId "${recordId}" appears more than once.`);
    } else {
        seenRecordIds.add(recordId);
    }
    if (!isNonEmptyString(subjectId)) {
        problems.push(`${at}.subjectId must be a non-empty string.`);
    }
    if (!isNonEmptyString(channelName)) {
        problems.push(`${at}.channelName must be a non-empty string.`);
    }
    if (!Number.isSafeInteger(channelIndex) || (channelIndex as number) < 0) {
        problems.push(`${at}.channelIndex must be a non-negative safe integer.`);
    }

    describeProvenanceProblems(provenance, `${at}.provenance`, problems);

    if (!Array.isArray(windows)) {
        problems.push(`${at}.windows must be an array.`);
        return;
    }
    windows.forEach((window, index) => {
        const wat = `${at}.windows[${index}]`;
        if (!isPlainObject(window)) {
            problems.push(`${wat} must be an object.`);
            return;
        }
        const {
            windowId,
            recordId: windowRecordId,
            channelIndex: windowChannelIndex,
            channelName: windowChannelName,
            startSample,
            lengthSamples,
            trueLabel,
            predictedLabel,
            predictedScore,
            semantics,
        } = window;

        if (!isNonEmptyString(windowId)) {
            problems.push(`${wat}.windowId must be a non-empty string.`);
        } else if (windowIds.has(windowId)) {
            problems.push(`${wat}.windowId "${windowId}" is duplicated across the result.`);
        } else {
            windowIds.add(windowId);
        }
        if (!isNonEmptyString(windowRecordId)) {
            problems.push(`${wat}.recordId must be a non-empty string.`);
        }
        if (!isNonEmptyString(windowChannelName)) {
            problems.push(`${wat}.channelName must be a non-empty string.`);
        }
        if (!Number.isSafeInteger(windowChannelIndex) || (windowChannelIndex as number) < 0) {
            problems.push(`${wat}.channelIndex must be a non-negative safe integer.`);
        }
        if (!Number.isSafeInteger(startSample) || (startSample as number) < 0) {
            problems.push(`${wat}.startSample must be a non-negative safe integer.`);
        }
        if (!Number.isSafeInteger(lengthSamples) || (lengthSamples as number) <= 0) {
            problems.push(`${wat}.lengthSamples must be a positive safe integer.`);
        }
        if (!isNonEmptyString(trueLabel)) {
            problems.push(`${wat}.trueLabel must be a non-empty string.`);
        }
        if (!isNonEmptyString(predictedLabel)) {
            problems.push(`${wat}.predictedLabel must be a non-empty string.`);
        }
        if (typeof predictedScore !== 'number' || !Number.isFinite(predictedScore)) {
            problems.push(`${wat}.predictedScore must be a finite number.`);
        }
        if (semantics !== 'predicted-probability' && semantics !== 'model-score') {
            problems.push(
                `${wat}.semantics must be "predicted-probability" or "model-score".`,
            );
        }

        // Cross-field coherence so a hand-edited row cannot drift silently.
        if (
            isNonEmptyString(windowId) &&
            isNonEmptyString(recordId) &&
            Number.isSafeInteger(windowChannelIndex) &&
            Number.isSafeInteger(startSample)
        ) {
            const expectedWindowId = windowIdOf(
                recordId,
                windowChannelIndex as number,
                startSample as number,
            );
            if (windowId !== expectedWindowId) {
                problems.push(
                    `${wat}.windowId "${windowId}" does not match its record/channel/start ` +
                    `("${expectedWindowId}").`,
                );
            }
        }
        if (
            isNonEmptyString(recordId) &&
            isNonEmptyString(windowRecordId) &&
            windowRecordId !== recordId
        ) {
            problems.push(
                `${wat}.recordId "${windowRecordId}" differs from its parent record "${recordId}".`,
            );
        }
        if (
            isNonEmptyString(channelName) &&
            isNonEmptyString(windowChannelName) &&
            windowChannelName !== channelName
        ) {
            problems.push(
                `${wat}.channelName "${windowChannelName}" differs from its parent ` +
                `channel "${channelName}".`,
            );
        }
        if (
            Number.isSafeInteger(channelIndex) &&
            Number.isSafeInteger(windowChannelIndex) &&
            windowChannelIndex !== channelIndex
        ) {
            problems.push(
                `${wat}.channelIndex ${String(windowChannelIndex)} differs from its parent ` +
                `channel index ${String(channelIndex)}.`,
            );
        }
    });
}

/**
 * Structural + coherence problems with a parsed experiment result document, or
 * `[]` when it is a valid round-trip. Rejects malformed shapes and the three
 * coherence breaks described in the module header (id↔config, labeler↔config,
 * metrics↔windows). Used by {@link parseExperimentResult}; exported so callers
 * can inspect an untrusted document without throwing.
 */
export function describeExperimentResultProblems(value: unknown): readonly string[] {
    const problems: string[] = [];
    if (!isPlainObject(value)) {
        problems.push('Experiment result must be a JSON object.');
        return problems;
    }
    const root = value;

    const experimentId = root.experimentId;
    const experimentIdOk = isNonEmptyString(experimentId);
    if (!experimentIdOk) {
        problems.push('experimentId must be a non-empty string.');
    }
    if (!isNonEmptyString(root.softwareVersion)) {
        problems.push('softwareVersion must be a non-empty string.');
    }
    if (!isNonEmptyString(root.scopeNote)) {
        problems.push('scopeNote must be a non-empty string.');
    }
    const evaluatedAtIso = root.evaluatedAtIso;
    if (
        !isNonEmptyString(evaluatedAtIso) ||
        Number.isNaN(Date.parse(evaluatedAtIso))
    ) {
        problems.push('evaluatedAtIso must be an ISO-8601 timestamp.');
    }

    const labeler = root.labeler;
    let validatedLabeler: Readonly<Record<string, unknown>> | null = null;
    if (!isPlainObject(labeler)) {
        problems.push('labeler must be an object.');
    } else {
        const labelerId = labeler.id;
        const labelerDescription = labeler.description;
        const labelerIdOk = isNonEmptyString(labelerId);
        const labelerDescriptionOk = isNonEmptyString(labelerDescription);
        if (!labelerIdOk) {
            problems.push('labeler.id must be a non-empty string.');
        }
        if (!labelerDescriptionOk) {
            problems.push('labeler.description must be a non-empty string.');
        }
        if (labelerIdOk && labelerDescriptionOk) {
            validatedLabeler = { id: labelerId, description: labelerDescription };
        }
    }

    const config = root.config;
    if (!isPlainObject(config)) {
        problems.push('config must be an object.');
    } else {
        const configSnapshot = config as unknown as ExperimentConfiguration;
        const configProblems = describeExperimentConfigurationProblems(configSnapshot);
        for (const configProblem of configProblems) {
            problems.push(`config: ${configProblem}`);
        }
        const configIsValid = configProblems.length === 0;

        if (configIsValid && validatedLabeler !== null && experimentIdOk) {
            const expectedId = experimentIdOf(configSnapshot);
            if (experimentId !== expectedId) {
                problems.push(
                    `experimentId "${experimentId}" does not match the configuration ` +
                    `snapshot ("${expectedId}").`,
                );
            }
            const declaredLabeler = configSnapshot.evaluation;
            if (
                stableStringify(validatedLabeler) !==
                stableStringify(declaredLabeler)
            ) {
                problems.push(
                    'labeler must equal config.evaluation (the rule actually applied must ' +
                    'be the rule the configuration declared).',
                );
            }
        }
    }

    const records = root.records;
    const seenRecordIds = new Set<string>();
    const windowIds = new Set<string>();
    if (!Array.isArray(records)) {
        problems.push('records must be an array.');
    } else {
        records.forEach((record, index) => {
            describeRecordProblems(
                record,
                `records[${index}]`,
                seenRecordIds,
                windowIds,
                problems,
            );
        });
    }

    const metrics = root.metrics;
    if (!isPlainObject(metrics)) {
        problems.push('metrics must be an object.');
    } else {
        const classLabels = metrics.classLabels;
        if (
            !Array.isArray(classLabels) ||
            classLabels.length === 0 ||
            !classLabels.every(isNonEmptyString)
        ) {
            problems.push(
                'metrics.classLabels must list at least one non-empty string.',
            );
        }
    }

    // Only run the metrics↔windows recomputation when everything above is
    // already coherent, so a broken document reports its first cause clearly.
    if (problems.length === 0) {
        const classLabels = (metrics as Record<string, unknown>)
            .classLabels as unknown as readonly string[];
        const outcomes = (records as unknown as ReadonlyArray<Readonly<Record<string, unknown>>>)
            .flatMap((record) =>
                (record.windows as unknown as ReadonlyArray<
                    Readonly<Record<string, unknown>>
                >).map((window) => ({
                    trueLabel: window.trueLabel as string,
                    predictedLabel: window.predictedLabel as string,
                })),
            );
        try {
            const recomputed = computeClassificationMetrics(classLabels, outcomes);
            if (stableStringify(recomputed) !== stableStringify(metrics)) {
                problems.push(
                    'metrics do not match the recorded windows: recomputing the metrics ' +
                    'from the window outcomes produces a different result. The export is ' +
                    'incoherent.',
                );
            }
        } catch (cause) {
            problems.push(
                `metrics recomputation failed: ${cause instanceof Error ? cause.message : String(cause)
                }`,
            );
        }
    }

    return problems;
}

/**
 * Canonical, key-ordered serialization of an `ExperimentResult` (compact JSON
 * via the single-sourced {@link stableStringify}). Equivalent results produce
 * identical text regardless of object-key insertion order.
 */
export function serializeExperimentResult(
    result: Readonly<ExperimentResult>,
): string {
    return stableStringify(result);
}

/**
 * Parse and strictly validate an exported experiment result document. Throws a
 * classified `invalid-input` `EcgError` on malformed JSON or any structural /
 * coherence break reported by {@link describeExperimentResultProblems}. On
 * success the returned document round-trips: re-serializing it yields the same
 * text and it is structurally equal to the original result.
 */
export function parseExperimentResult(text: string): ExperimentResult {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text) as unknown;
    } catch (cause) {
        throw EcgError.invalidInput(
            'Invalid experiment result document: not valid JSON.',
            {
                detail: cause instanceof Error ? cause.message : String(cause),
            },
        );
    }
    const problems = describeExperimentResultProblems(parsed);
    if (problems.length > 0) {
        throw EcgError.invalidInput('Invalid experiment result document.', {
            detail: problems.join(' '),
            meta: { problems: [...problems] },
        });
    }
    return parsed as ExperimentResult;
}
