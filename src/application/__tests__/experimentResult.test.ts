/**
 * Experiment result + JSON export round-trip tests (Phase 8 / ADR-007, ADR-009;
 * rules §24, §47, §49).
 *
 * An `ExperimentResult` is the portable, frozen snapshot of one evaluation run.
 * These tests pin the canonical serialization (`stableStringify` key ordering),
 * the strict `parseExperimentResult` round-trip, and the three coherence
 * invariants that make a hand-edited export fail loudly instead of parsing
 * silently: experimentId↔config, labeler↔config.evaluation, metrics↔recorded
 * windows. Metrics are always recomputed, never trusted as prose (§24).
 */
import { describe, expect, it } from 'vitest';
import { EcgError } from '../../domain/error';
import type { InterpretedSemantics } from '../../domain/ml';
import type { Provenance } from '../../domain/signal';
import { experimentIdOf, type ExperimentConfiguration } from '../experiment';
import {
    computeClassificationMetrics,
    type ClassifiedOutcome,
} from '../metrics';
import {
    describeExperimentResultProblems,
    parseExperimentResult,
    serializeExperimentResult,
    windowIdOf,
    type ExperimentResult,
    type RecordEvaluation,
    type WindowOutcome,
} from '../experimentResult';

/** The committed probe model's two declared classes (Phase 6/7). */
const BINARY = Object.freeze(['positive-mean', 'nonpositive-mean']);

const WINDOW_360_DROP = Object.freeze({
    windowLengthSamples: 360,
    strideSamples: 360,
    remainderPolicy: 'drop' as const,
});

const MODEL = Object.freeze({
    modelId: 'ecg-lab-probe-linear-mean-2',
    modelVersion: '1.0.0',
});

const LABELER = Object.freeze({
    id: 'sign-of-window-sum',
    description:
        'Ground truth = sign of the window sum; development seam-validation rule, ' +
        'not a clinical ground truth.',
});

/** The single evaluated record/channel mirrored by every fixture below. */
const RECORD_ID = 'sync';
const CHANNEL_NAME = 'lead-b';
const CHANNEL_INDEX = 1;
const WINDOW_LENGTH = 360;

/** Faithful to `recordToMillivoltSignal`: one `adc-to-millivolt` transform. */
const PROVENANCE: Readonly<Provenance> = Object.freeze({
    source: 'synthetic/sync',
    transforms: Object.freeze([
        Object.freeze({
            name: 'adc-to-millivolt',
            parameters: Object.freeze({ datasetId: 'synthetic' }),
        }),
    ]),
});

function configFor(
    overrides: Partial<ExperimentConfiguration> = {},
): ExperimentConfiguration {
    return {
        datasetId: 'synthetic',
        selection: { kind: 'records', recordIds: [RECORD_ID] },
        channelName: CHANNEL_NAME,
        window: WINDOW_360_DROP,
        model: MODEL,
        evaluation: LABELER,
        ...overrides,
    };
}

function outcomeWindow(input: {
    startSample: number;
    trueLabel: string;
    predictedLabel: string;
    predictedScore: number;
    semantics: InterpretedSemantics;
}): WindowOutcome {
    const { startSample, trueLabel, predictedLabel, predictedScore, semantics } = input;
    return {
        windowId: windowIdOf(RECORD_ID, CHANNEL_INDEX, startSample),
        recordId: RECORD_ID,
        channelIndex: CHANNEL_INDEX,
        channelName: CHANNEL_NAME,
        startSample,
        lengthSamples: WINDOW_LENGTH,
        trueLabel,
        predictedLabel,
        predictedScore,
        semantics,
    };
}

function windowsFixture(): WindowOutcome[] {
    return [
        outcomeWindow({
            startSample: 0,
            trueLabel: 'positive-mean',
            predictedLabel: 'positive-mean',
            predictedScore: 0.99,
            semantics: 'predicted-probability',
        }),
        // One honest disagreement so the metrics are non-degenerate.
        outcomeWindow({
            startSample: 360,
            trueLabel: 'positive-mean',
            predictedLabel: 'nonpositive-mean',
            predictedScore: 0.63,
            semantics: 'predicted-probability',
        }),
        outcomeWindow({
            startSample: 720,
            trueLabel: 'nonpositive-mean',
            predictedLabel: 'nonpositive-mean',
            predictedScore: 0.97,
            semantics: 'predicted-probability',
        }),
    ];
}

function outcomesOf(windows: readonly WindowOutcome[]): readonly ClassifiedOutcome[] {
    return windows.map((window) => ({
        trueLabel: window.trueLabel,
        predictedLabel: window.predictedLabel,
    }));
}

function recordEvaluation(windows: readonly WindowOutcome[]): RecordEvaluation {
    return {
        recordId: RECORD_ID,
        subjectId: RECORD_ID,
        channelName: CHANNEL_NAME,
        channelIndex: CHANNEL_INDEX,
        provenance: PROVENANCE,
        windows,
    };
}

/** A fully coherent result whose metrics are *computed* from its windows. */
function makeResult(): ExperimentResult {
    const config = configFor();
    const windows = windowsFixture();
    const metrics = computeClassificationMetrics(BINARY, outcomesOf(windows));
    return {
        experimentId: experimentIdOf(config),
        config,
        labeler: LABELER,
        softwareVersion: '0.1.0-test',
        scopeNote:
            'Unit fixture: pipeline-validation scaffold; not a clinical evaluation.',
        evaluatedAtIso: '2026-09-04T00:00:00.000Z',
        records: [recordEvaluation(windows)],
        metrics,
    };
}

/** Rebuild a JSON-safe value with every object's keys in reverse order. */
function reverseKeys<T>(value: T): T {
    if (Array.isArray(value)) {
        return value.map((entry) => reverseKeys(entry)) as unknown as T;
    }
    if (typeof value === 'object' && value !== null) {
        const source = value as Record<string, unknown>;
        const reordered: Record<string, unknown> = {};
        for (const key of Object.keys(source).reverse()) {
            reordered[key] = reverseKeys(source[key]);
        }
        return reordered as T;
    }
    return value;
}

/** Serialize a valid result, mutate the parsed plain document, re-serialize. */
function tamperedDocument(mutate: (doc: Record<string, unknown>) => void): string {
    const document = JSON.parse(
        serializeExperimentResult(makeResult()),
    ) as Record<string, unknown>;
    mutate(document);
    return JSON.stringify(document);
}

/** Parse `producer()` and assert it throws a classified `invalid-input`. */
function throwsInvalidInput(producer: () => string): EcgError {
    let caught: unknown;
    try {
        parseExperimentResult(producer());
    } catch (cause) {
        caught = cause;
    }
    expect(caught instanceof EcgError).toBe(true);
    if (!(caught instanceof EcgError)) {
        throw new Error('expected parseExperimentResult to throw an EcgError');
    }
    expect(caught.code).toBe('invalid-input');
    return caught;
}

function detailOf(error: EcgError): string {
    return error.context.detail ?? error.message;
}

describe('windowIdOf', () => {
    it('addresses a window by record, channel index and start sample', () => {
        expect(windowIdOf('sync', 1, 0)).toBe('sync/ch/1/w0');
        expect(windowIdOf('sync', 1, 360)).toBe('sync/ch/1/w360');
        expect(windowIdOf('100', 0, 0)).toBe('100/ch/0/w0');
    });
});

describe('serialize → parse round trip', () => {
    it('round-trips a valid result into a deep-equal, re-serializable document', () => {
        const original = makeResult();
        const text = serializeExperimentResult(original);
        const parsed = parseExperimentResult(text);
        expect(parsed).toEqual(original);
        expect(serializeExperimentResult(parsed)).toBe(text);
    });

    it('is byte-identical for independently constructed equivalent results', () => {
        expect(serializeExperimentResult(makeResult())).toBe(
            serializeExperimentResult(makeResult()),
        );
    });

    it('is independent of object-key insertion order', () => {
        const original = makeResult();
        const reordered = reverseKeys(original);
        expect(serializeExperimentResult(reordered)).toBe(
            serializeExperimentResult(original),
        );
    });
});

describe('describeExperimentResultProblems', () => {
    it('reports no problems for the serialized round-trip document', () => {
        const document = JSON.parse(
            serializeExperimentResult(makeResult()),
        ) as unknown;
        expect(describeExperimentResultProblems(document)).toEqual([]);
    });

    it('reports problems for non-object documents', () => {
        expect(describeExperimentResultProblems(null).length).toBeGreaterThan(0);
        expect(describeExperimentResultProblems('nope').length).toBeGreaterThan(0);
        expect(describeExperimentResultProblems([1, 2]).length).toBeGreaterThan(0);
    });
});

describe('malformed input is rejected with a classified error', () => {
    it('rejects text that is not valid JSON', () => {
        const error = throwsInvalidInput(() => '{"experimentId":');
        expect(error.message).toContain('not valid JSON');
    });

    it('rejects JSON that is not an experiment result object', () => {
        throwsInvalidInput(() => '42');
        throwsInvalidInput(() => 'null');
        throwsInvalidInput(() => '"a bare string"');
    });

    it('rejects a document missing a required section', () => {
        const error = throwsInvalidInput(() =>
            tamperedDocument((doc) => {
                doc.metrics = undefined;
            }),
        );
        expect(detailOf(error)).toContain('metrics');
    });
});

describe('structural cross-field validation', () => {
    it('rejects a window whose id does not match its record/channel/start', () => {
        const error = throwsInvalidInput(() =>
            tamperedDocument((doc) => {
                const records = doc.records as unknown as Array<
                    Record<string, unknown>
                >;
                const windows = records[0]!.windows as unknown as Array<
                    Record<string, unknown>
                >;
                windows[0]!.startSample = 1234;
            }),
        );
        expect(detailOf(error)).toContain('does not match its record/channel/start');
    });

    it('rejects duplicate window ids across the result', () => {
        const error = throwsInvalidInput(() =>
            tamperedDocument((doc) => {
                const records = doc.records as unknown as Array<
                    Record<string, unknown>
                >;
                const windows = records[0]!.windows as unknown as Array<
                    Record<string, unknown>
                >;
                const first = windows[0]!;
                records[0]!.windows = [first, first];
            }),
        );
        expect(detailOf(error)).toContain('is duplicated across the result');
    });
});

describe('coherence invariants (round-trip validation)', () => {
    it('rejects an experimentId that does not match its configuration snapshot', () => {
        const error = throwsInvalidInput(() =>
            tamperedDocument((doc) => {
                doc.experimentId = 'tampered-experiment-id';
            }),
        );
        expect(detailOf(error)).toContain('does not match the configuration');
    });

    it('rejects a labeler that differs from config.evaluation', () => {
        const error = throwsInvalidInput(() =>
            tamperedDocument((doc) => {
                doc.labeler = {
                    id: 'different-rule',
                    description: 'an unrelated ground-truth rule',
                };
            }),
        );
        expect(detailOf(error)).toContain('labeler must equal config.evaluation');
    });

    it('rejects metrics that contradict the recorded windows', () => {
        const error = throwsInvalidInput(() =>
            tamperedDocument((doc) => {
                const metrics = doc.metrics as Record<string, unknown>;
                metrics.accuracy = 0.12345;
            }),
        );
        expect(detailOf(error)).toContain('metrics do not match the recorded windows');
    });
});
