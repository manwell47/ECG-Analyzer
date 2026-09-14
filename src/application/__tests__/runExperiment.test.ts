/**
 * Evaluation runner tests (Phase 8 / ADR-007, ADR-009; rules §20, §24, §47, §49).
 *
 * `runExperiment` executes one committed `ExperimentConfiguration` end-to-end
 * over the synthetic dataset (a deterministic, file-free `DatasetAdapter`),
 * driving a real `StubInferenceEngine` (ADR-004). These tests pin:
 *
 *  - plumbing — every selected record is read, the configured channel alone is
 *    windowed (other-channel windows never reach the engine), windows are cut at
 *    the configured length/stride, each realized input is a concrete 1x1x360
 *    tensor stamped with the metadata fingerprint, and provenance is captured;
 *  - oracle/metrics wiring — the labels a controllable labeler returns are
 *    recorded per window and the aggregate metrics are computed from those
 *    recorded outcomes (never fabricated), including honest `null` rates;
 *  - determinism — under a fixed clock two runs of one configuration are
 *    byte-identical after canonical serialization;
 *  - the classified error surface — unknown record (adapter `file-not-found`),
 *    engine/inference failures, model-compatibility breaks, dispose/idempotence
 *    hygiene, out-of-declared-class labels, config↔model and config↔adapter
 *    mismatches, empty options, zero-window evaluations, and unexpected
 *    non-`EcgError` backend failures bubbling unwrapped.
 *
 * The stub's numeric rule is deliberately non-scientific; tests that need a
 * guaranteed argmax steer it with `logitBias` rather than relying on signal
 * statistics.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EcgError } from '../../domain/error';
import type { ModelInput, ModelMetadata, ModelPrediction } from '../../domain/ml';
import { metadataFingerprint, type InferenceEngine } from '../../ml';
import { createStubEngine } from '../../ml/testing/stub';
import {
    DEFAULT_PARTITION_SPEC,
    SyntheticDatasetAdapter,
    assertNoSubjectLeakage,
    partitionRecords,
    recordToMillivoltSignal,
    type DatasetAdapter,
    type SyntheticRecordSpec,
} from '../../datasets';
import { segmentSignal } from '../../dsp/segment';
import type { RecordId } from '../../domain/record';
import {
    experimentIdOf,
    subjectRefsForSelfSubjects,
    type ExperimentConfiguration,
} from '../experiment';
import {
    serializeExperimentResult,
    windowIdOf,
    type ExperimentResult,
} from '../experimentResult';
import type { ClassRates, ClassificationMetrics } from '../metrics';
import {
    runExperiment,
    type GroundTruthLabeler,
    type RunExperimentOptions,
} from '../runExperiment';

// ---------------------------------------------------------------------------
// Fixtures (a committed experiment configuration over the synthetic dataset).
// ---------------------------------------------------------------------------

const WINDOW_360_DROP = Object.freeze({
    windowLengthSamples: 360,
    strideSamples: 360,
    remainderPolicy: 'drop' as const,
});

/** The model this test configuration commits to (must equal METADATA ids). */
const MODEL = Object.freeze({
    modelId: 'stub-sign-probe',
    modelVersion: '1.0.0',
});

const LABELER = Object.freeze({
    id: 'window-sum-sign',
    description:
        'Ground truth = sign of the window sum; deterministic Node-test labeler, ' +
        'not a clinical ground truth.',
});

/**
 * Test-local metadata mirroring the committed probe model's contract (360 Hz,
 * 1 channel, 360 samples/window, binary logits/softmax). `modelId` matches the
 * `MODEL` ref above so a configuration built with `MODEL` is runnable.
 */
const METADATA: Readonly<ModelMetadata> = Object.freeze({
    modelId: 'stub-sign-probe',
    modelVersion: '1.0.0',
    task: 'probe-sign-of-mean (deterministic test seam; not a physiological classifier)',
    input: Object.freeze({
        name: 'signal',
        shape: Object.freeze([-1, 1, 360]),
        dtype: 'float32',
        layout: 'nct',
    }),
    expectedSamplingRateHz: 360,
    expectedChannels: 1,
    expectedWindowSamples: 360,
    preprocessingAssumptions: Object.freeze([
        Object.freeze({ stage: 'identity-window', config: {} }),
    ]),
    normalization: Object.freeze({ strategy: 'none' }),
    output: Object.freeze({
        name: 'logits',
        dtype: 'float32',
        semantics: 'logits',
        activation: 'softmax',
        classLabels: Object.freeze(['positive-mean', 'nonpositive-mean']),
    }),
    provenance: Object.freeze({
        methodology: 'Deterministic Node test seam mirroring the committed probe.',
        limitations: 'Not a clinical classifier; synthetic windows only.',
    }),
});

/**
 * Deterministic, file-free adapter over the lab's canonical records:
 *  - 'sync'  — default two-lead record, 3600 samples → 10 windows per channel;
 *  - 'r02'   — a second default two-lead record (same geometry → 10 windows);
 *  - 'tiny'  — a short record (100 samples) with a lead-b that yields zero
 *    windows at 360 samples, for the zero-window guard.
 */
const ADAPTER = new SyntheticDatasetAdapter(
    Object.freeze({
        sync: Object.freeze({ recordId: 'sync' }),
        r02: Object.freeze({ recordId: 'r02' }),
        tiny: Object.freeze({ recordId: 'tiny', sampleCount: 100 }),
    }),
);

const SOFTWARE_VERSION = '0.0.0-test';
const SCOPE_NOTE = 'Node unit test of the evaluation runner (non-clinical).';
const DEFAULT_OPTIONS: Readonly<RunExperimentOptions> = Object.freeze({
    softwareVersion: SOFTWARE_VERSION,
    scopeNote: SCOPE_NOTE,
});

function configFor(
    overrides: Partial<ExperimentConfiguration> = {},
): ExperimentConfiguration {
    return {
        datasetId: 'synthetic',
        selection: { kind: 'records', recordIds: ['sync'] },
        channelName: 'lead-b',
        window: WINDOW_360_DROP,
        model: MODEL,
        evaluation: LABELER,
        ...overrides,
    };
}

const LEAD_B_CHANNEL_INDEX = 1;

/** Labeler that scores every window as the positive class. */
const constantPositive: GroundTruthLabeler = () => 'positive-mean';

/** Alternates the declared classes by window ordinal (parity of the start). */
const alternatingLabeler: GroundTruthLabeler = (window) =>
    (window.startSample / WINDOW_360_DROP.windowLengthSamples) % 2 === 0
        ? 'positive-mean'
        : 'nonpositive-mean';

function runFixture(
    engine: InferenceEngine,
    config: Readonly<ExperimentConfiguration>,
    labeler: GroundTruthLabeler = constantPositive,
    options: Readonly<RunExperimentOptions> = DEFAULT_OPTIONS,
    adapter: DatasetAdapter = ADAPTER,
): Promise<ExperimentResult> {
    return runExperiment(adapter, engine, METADATA, config, labeler, options);
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/**
 * A real `InferenceEngine` spy: records every realized input and counts
 * run/dispose calls while delegating inference to a wrapped backend.
 */
class RecordingEngine implements InferenceEngine {
    readonly backendId = 'recording-engine';
    readonly recordedInputs: ModelInput[] = [];
    runCount = 0;
    disposeCount = 0;

    constructor(private readonly delegate: InferenceEngine) { }

    async run(
        metadata: Readonly<ModelMetadata>,
        input: Readonly<ModelInput>,
    ): Promise<ModelPrediction> {
        this.runCount += 1;
        this.recordedInputs.push(input);
        return this.delegate.run(metadata, input);
    }

    async dispose(): Promise<void> {
        this.disposeCount += 1;
        await this.delegate.dispose();
    }
}

/** Captures the rejection (or returns undefined when the action resolves). */
async function captureRejection(action: () => Promise<unknown>): Promise<unknown> {
    let caught: unknown;
    try {
        await action();
    } catch (cause) {
        caught = cause;
    }
    return caught;
}

/** Asserts that `action` rejects with an `EcgError` of the given code. */
async function expectRejectsCode(
    action: () => Promise<unknown>,
    code: string,
): Promise<void> {
    const caught = await captureRejection(action);
    expect(caught instanceof EcgError).toBe(true);
    if (caught instanceof EcgError) {
        expect(caught.code).toBe(code);
    }
}

function rateFor(metrics: ClassificationMetrics, label: string): ClassRates {
    const rate = metrics.perClass.find((entry) => entry.label === label);
    expect(rate).toBeDefined();
    return rate!;
}

function totalWindows(result: ExperimentResult): number {
    return result.records.reduce(
        (sum, record) => sum + record.windows.length,
        0,
    );
}

afterEach(() => {
    vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Plumbing: stage chain, channel filtering, provenance, frozen boundary.
// ---------------------------------------------------------------------------

describe('runExperiment plumbing', () => {
    it('evaluates every selected record on the configured channel and returns one record group', async () => {
        const engine = new RecordingEngine(createStubEngine({ logitBias: [5, 0] }));
        const config = configFor({
            selection: { kind: 'records', recordIds: ['sync', 'r02'] },
        });

        const result = await runFixture(engine, config);

        expect(result.records.map((record) => record.recordId)).toEqual([
            'sync',
            'r02',
        ]);
        expect(result.records.map((record) => record.subjectId)).toEqual([
            'sync',
            'r02',
        ]);
        for (const record of result.records) {
            expect(record.channelName).toBe('lead-b');
            expect(record.channelIndex).toBe(LEAD_B_CHANNEL_INDEX);
            expect(record.windows).toHaveLength(10);
        }
        expect(result.records[0]!.windows[0]!.windowId).toBe(windowIdOf('sync', LEAD_B_CHANNEL_INDEX, 0));
        expect(result.records[1]!.windows[9]!.windowId).toBe(windowIdOf('r02', LEAD_B_CHANNEL_INDEX, 3240));

        // Every realized input is a concrete 1 channel x 360 samples tensor of
        // the configured channel, fingerprinted against the metadata, whose
        // source window id lines up 1:1 with a recorded outcome.
        expect(engine.runCount).toBe(20);
        for (const input of engine.recordedInputs) {
            expect(input.shape).toEqual([1, 1, 360]);
            expect(input.data).toHaveLength(360);
            expect(input.preprocessingFingerprint).toBe(metadataFingerprint(METADATA));
            expect(input.sourceWindowIds).toHaveLength(1);
        }
        const recordedWindowIds = engine.recordedInputs
            .map((input) => input.sourceWindowIds[0])
            .sort();
        const outcomeWindowIds = result.records
            .flatMap((record) => record.windows.map((window) => window.windowId))
            .sort();
        expect(recordedWindowIds).toEqual(outcomeWindowIds);
        expect(new Set(outcomeWindowIds).size).toBe(outcomeWindowIds.length);

        expect(result.metrics.total).toBe(20);
        expect(result.metrics.accuracy).toBe(1);
    });

    it('windows only the configured channel; other-channel windows never reach the engine', async () => {
        const engine = new RecordingEngine(createStubEngine({ logitBias: [5, 0] }));
        const config = configFor({ channelName: 'lead-a' });

        const result = await runFixture(engine, config);

        // 3600 samples / 360 stride = 10 windows on the configured channel only:
        // the sibling 'lead-b' windows (another 10) must not be inferred.
        expect(engine.runCount).toBe(10);
        expect(result.records).toHaveLength(1);
        const sync = result.records[0]!;
        expect(sync.channelName).toBe('lead-a');
        expect(sync.channelIndex).toBe(0);
        expect(sync.windows).toHaveLength(10);
        for (const window of sync.windows) {
            expect(window.channelIndex).toBe(0);
            expect(window.channelName).toBe('lead-a');
        }
        expect(sync.windows[0]!.windowId).toBe(windowIdOf('sync', 0, 0));
    });

    it('captures the ADC→mV provenance chain and freezes the whole result boundary', async () => {
        const engine = new RecordingEngine(createStubEngine({ logitBias: [5, 0] }));
        const config = configFor();

        const result = await runFixture(engine, config);

        expect(result.experimentId).toBe(experimentIdOf(config));
        expect(result.softwareVersion).toBe(SOFTWARE_VERSION);
        expect(result.scopeNote).toBe(SCOPE_NOTE);
        expect(result.labeler).toEqual(config.evaluation);

        const sync = result.records[0]!;
        expect(sync.provenance.source).toBe('synthetic/sync');
        expect(sync.provenance.transforms.map((step) => step.name)).toEqual([
            'adc-to-millivolt',
        ]);
        expect(sync.provenance.transforms[0]).toMatchObject({
            parameters: { datasetId: 'synthetic' },
        });

        // Window geometry: contiguous 360-sample windows, each outcome scored.
        expect(sync.windows.map((window) => window.startSample)).toEqual([
            0, 360, 720, 1080, 1440, 1800, 2160, 2520, 2880, 3240,
        ]);
        for (const window of sync.windows) {
            expect(window.lengthSamples).toBe(360);
            expect(window.channelIndex).toBe(LEAD_B_CHANNEL_INDEX);
            expect(window.predictedLabel).toBe('positive-mean');
            expect(window.semantics).toBe('predicted-probability');
            expect(window.predictedScore).toBeGreaterThan(0);
            expect(window.predictedScore).toBeLessThan(1);
        }

        // Deep, owned, frozen snapshot at the boundary.
        expect(Object.isFrozen(result)).toBe(true);
        expect(Object.isFrozen(result.config)).toBe(true);
        expect(Object.isFrozen(result.config.selection)).toBe(true);
        if (result.config.selection.kind === 'records') {
            expect(Object.isFrozen(result.config.selection.recordIds)).toBe(true);
        }
        expect(Object.isFrozen(result.records)).toBe(true);
        expect(Object.isFrozen(sync)).toBe(true);
        expect(Object.isFrozen(sync.windows)).toBe(true);
        expect(Object.isFrozen(sync.windows[0])).toBe(true);
        expect(result.config).toEqual(config);
    });
});

// ---------------------------------------------------------------------------
// Ground-truth labeler + metrics wiring.
// ---------------------------------------------------------------------------

describe('ground-truth labeler and metrics wiring', () => {
    it('records the labels a controllable labeler returns and a perfect oracle scores perfectly', async () => {
        const config = configFor({
            selection: { kind: 'records', recordIds: ['sync', 'r02'] },
        });
        const result = await runFixture(
            new RecordingEngine(createStubEngine({ logitBias: [5, 0] })),
            config,
            constantPositive,
        );

        expect(result.metrics.total).toBe(20);
        expect(result.metrics.accuracy).toBe(1);
        const positive = rateFor(result.metrics, 'positive-mean');
        expect(positive.support).toBe(20);
        expect(positive.truePositives).toBe(20);
        expect(positive.falsePositives).toBe(0);
        expect(positive.precision).toBe(1);
        expect(positive.recall).toBe(1);
    });

    it('reports an imperfect model honestly: accuracy 0.5 and null precision for the predicted-everywhere class', async () => {
        const config = configFor({
            selection: { kind: 'records', recordIds: ['sync', 'r02'] },
        });
        const result = await runFixture(
            new RecordingEngine(createStubEngine({ logitBias: [5, 0] })),
            config,
            alternatingLabeler,
        );

        // Alternating true labels over 20 windows → 10 of each declared class.
        const trueCounts: Record<string, number> = { 'positive-mean': 0, 'nonpositive-mean': 0 };
        for (const record of result.records) {
            for (const window of record.windows) {
                trueCounts[window.trueLabel]! += 1;
            }
        }
        expect(trueCounts).toEqual({ 'positive-mean': 10, 'nonpositive-mean': 10 });
        for (const window of result.records.flatMap((record) => record.windows)) {
            expect(window.predictedLabel).toBe('positive-mean');
        }

        expect(result.metrics.total).toBe(20);
        expect(result.metrics.accuracy).toBe(0.5);
        expect(result.metrics.confusion.cells).toEqual([
            [10, 0],
            [10, 0],
        ]);

        const positive = rateFor(result.metrics, 'positive-mean');
        expect(positive.support).toBe(10);
        expect(positive.truePositives).toBe(10);
        expect(positive.falseNegatives).toBe(0);
        expect(positive.falsePositives).toBe(10);
        expect(positive.precision).toBe(0.5);
        expect(positive.recall).toBe(1);
        expect(positive.specificity).toBe(0);
        expect(positive.f1).toBeCloseTo(2 / 3, 5);

        const nonpositive = rateFor(result.metrics, 'nonpositive-mean');
        expect(nonpositive.support).toBe(10);
        expect(nonpositive.truePositives).toBe(0);
        expect(nonpositive.falseNegatives).toBe(10);
        expect(nonpositive.falsePositives).toBe(0);
        expect(nonpositive.trueNegatives).toBe(10);
        expect(nonpositive.precision).toBeNull();
        expect(nonpositive.recall).toBe(0);
        expect(nonpositive.specificity).toBe(1);
        expect(nonpositive.f1).toBe(0);
    });

    it('records an argmax from the other declared class when the engine favours it', async () => {
        const config = configFor({
            selection: { kind: 'records', recordIds: ['sync', 'r02'] },
        });
        const result = await runFixture(
            new RecordingEngine(createStubEngine({ logitBias: [0, 5] })),
            config,
            constantPositive,
        );

        const outcomes = result.records.flatMap((record) => record.windows);
        expect(outcomes).toHaveLength(20);
        for (const window of outcomes) {
            expect(window.predictedLabel).toBe('nonpositive-mean');
        }
        expect(result.metrics.accuracy).toBe(0);
        const positive = rateFor(result.metrics, 'positive-mean');
        expect(positive.support).toBe(20);
        expect(positive.recall).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Determinism + result invariants.
// ---------------------------------------------------------------------------

describe('determinism and result invariants', () => {
    it('produces byte-identical canonical serializations under a fixed clock', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'));
        const engine = new RecordingEngine(createStubEngine({ logitBias: [5, 0] }));
        const config = configFor({
            selection: { kind: 'records', recordIds: ['sync', 'r02'] },
        });

        let first: ExperimentResult | undefined;
        let second: ExperimentResult | undefined;
        try {
            first = await runFixture(engine, config, alternatingLabeler);
            second = await runFixture(engine, config, alternatingLabeler);
        } finally {
            vi.useRealTimers();
        }

        expect(second).toBeDefined();
        expect(serializeExperimentResult(second!)).toBe(serializeExperimentResult(first!));
        expect(second!.evaluatedAtIso).toBe('2026-01-02T03:04:05.000Z');
        expect(second!.experimentId).toBe(experimentIdOf(config));
        expect(second!.labeler).toEqual(config.evaluation);
        expect(second!.metrics).toEqual(first!.metrics);
    });
});

// ---------------------------------------------------------------------------
// Classified error surface.
// ---------------------------------------------------------------------------

describe('classified error propagation', () => {
    it('surfaces the adapter file-not-found for an unknown record', async () => {
        const engine = createStubEngine();
        const config = configFor({
            selection: { kind: 'records', recordIds: ['missing'] },
        });
        await expectRejectsCode(
            () => runFixture(engine, config),
            'file-not-found',
        );
    });

    it('propagates an engine inference failure as inference-failure', async () => {
        class BrokenEngine implements InferenceEngine {
            readonly backendId = 'broken-engine';

            async run(): Promise<ModelPrediction> {
                throw EcgError.inference('The test backend exploded during run.');
            }

            async dispose(): Promise<void> {
                // Nothing to release.
            }
        }
        await expectRejectsCode(
            () => runFixture(new BrokenEngine(), configFor()),
            'inference-failure',
        );
    });

    it('surfaces a window length that violates the model contract as model-compatibility-failure before any inference', async () => {
        const engine = new RecordingEngine(createStubEngine());
        const config = configFor({
            window: {
                windowLengthSamples: 128,
                strideSamples: 128,
                remainderPolicy: 'drop',
            },
        });

        await expectRejectsCode(
            () => runFixture(engine, config),
            'model-compatibility-failure',
        );
        expect(engine.runCount).toBe(0);
    });

    it('never disposes the caller-owned engine, and a disposed engine fails loudly on a later run', async () => {
        const engine = new RecordingEngine(createStubEngine());
        const config = configFor();

        const result = await runFixture(engine, config);
        expect(result.metrics.total).toBe(10);
        expect(engine.disposeCount).toBe(0);

        // The caller disposes; a fresh run through the disposed backend must
        // surface its classified inference failure rather than be swallowed.
        await engine.dispose();
        expect(engine.disposeCount).toBe(1);
        await expectRejectsCode(
            () => runFixture(engine, config),
            'inference-failure',
        );
    });

    it('fails as invalid-input when the labeler returns a label outside the declared classes', async () => {
        const rogueLabeler: GroundTruthLabeler = () => 'not-a-declared-class';
        await expectRejectsCode(
            () => runFixture(createStubEngine(), configFor(), rogueLabeler),
            'invalid-input',
        );
    });

    it('fails as invalid-input when the configuration targets a different model than the metadata', async () => {
        const engine = createStubEngine();
        const config = configFor({
            model: { modelId: 'a-different-model', modelVersion: '1.0.0' },
        });
        await expectRejectsCode(() => runFixture(engine, config), 'invalid-input');
    });

    it('fails as invalid-input when the adapter serves a different dataset than the configuration declares', async () => {
        const alienAdapter: DatasetAdapter = {
            datasetId: 'alien-dataset',
            async listRecordIds(): Promise<readonly string[]> {
                return [];
            },
            async readRecord(): Promise<never> {
                throw new Error('must not be reached: dataset mismatch is checked first.');
            },
        };
        await expectRejectsCode(
            () => runFixture(createStubEngine(), configFor(), constantPositive, DEFAULT_OPTIONS, alienAdapter),
            'invalid-input',
        );
    });

    it('fails as invalid-input for an empty softwareVersion or an empty scope note', async () => {
        const engine = createStubEngine();
        const config = configFor();

        await expectRejectsCode(
            () =>
                runFixture(engine, config, constantPositive, {
                    ...DEFAULT_OPTIONS,
                    softwareVersion: '   ',
                }),
            'invalid-input',
        );
        await expectRejectsCode(
            () =>
                runFixture(engine, config, constantPositive, {
                    ...DEFAULT_OPTIONS,
                    scopeNote: '',
                }),
            'invalid-input',
        );
    });

    it('fails as invalid-input for an evaluation that would score zero windows', async () => {
        // 'tiny' is too short for a 360-sample window on its lead-b.
        const config = configFor({
            selection: { kind: 'records', recordIds: ['tiny'] },
        });
        await expectRejectsCode(
            () => runFixture(createStubEngine(), config),
            'invalid-input',
        );
    });

    it('fails as invalid-input when the configured channel is absent from a record', async () => {
        const config = configFor({ channelName: 'lead-c' });
        await expectRejectsCode(
            () => runFixture(createStubEngine(), config),
            'invalid-input',
        );
    });

    it('lets an unexpected non-EcgError from a misbehaving backend surface unwrapped', async () => {
        class BoomEngine implements InferenceEngine {
            readonly backendId = 'boom-engine';

            async run(): Promise<ModelPrediction> {
                throw new Error('kaboom');
            }

            async dispose(): Promise<void> {
                // Nothing to release.
            }
        }

        const caught = await captureRejection(() =>
            runFixture(new BoomEngine(), configFor()),
        );
        expect(caught instanceof EcgError).toBe(false);
        expect(caught).toBeInstanceOf(Error);
        if (caught instanceof Error) {
            expect(caught.message).toBe('kaboom');
        }
    });

    it('counts windows consistently across the aggregate and per-record outcome lists', async () => {
        const engine = new RecordingEngine(createStubEngine({ logitBias: [5, 0] }));
        const config = configFor({
            selection: { kind: 'records', recordIds: ['sync', 'r02'] },
        });
        const result = await runFixture(engine, config, alternatingLabeler);

        expect(totalWindows(result)).toBe(20);
        expect(result.metrics.total).toBe(totalWindows(result));
        // Every outcome feeds the aggregate metrics exactly once.
        const outcomeCount = result.records.reduce(
            (sum, record) => sum + record.windows.length,
            0,
        );
        expect(outcomeCount).toBe(result.metrics.total);
        expect(engine.runCount).toBe(outcomeCount);
    });
});

// ---------------------------------------------------------------------------
// Item 6: subject-level split runner demonstration (multi-subject fixture).
//
// Eight synthetic records (s01..s08), each its own subject (subjectId ===
// recordId) with a *distinct* lead-b frequency, so every subject yields a
// pairwise-distinct sign-of-sum oracle fingerprint. The runner is invoked with
// a `subject-partition` selection (role test) and a recording adapter, so the
// structural no-leakage evidence is the set of records actually read: it must
// be exactly the test role — never a train/validation subject. Frequencies
// were chosen against the tmp oracle (cross-checked with the seam's documented
// 1.2 Hz pattern) to avoid collisions: 0.55 duplicates 0.45 and 0.80 is too
// weak to trust near the zero boundary.
// ---------------------------------------------------------------------------

const MULTI_SUBJECT_IDS: readonly string[] = [
    's01', 's02', 's03', 's04',
    's05', 's06', 's07', 's08',
];

const LEAD_B_FREQUENCIES_HZ: Readonly<Record<string, number>> = Object.freeze({
    s01: 0.4,
    s02: 0.45,
    s03: 0.5,
    s04: 0.6,
    s05: 0.65,
    s06: 0.7,
    s07: 0.75,
    s08: 0.85,
});

const LEAD_A_DEFAULT_SPEC = Object.freeze({
    name: 'lead-a',
    gain: 200,
    baseline: 1024,
    amplitudeMv: 1.0,
    frequencyHz: 1.0,
});

/** Two-lead record: default lead-a (channel 0) + a custom lead-b (channel 1). */
function twoLeadSpec(
    recordId: RecordId,
    frequencyHz: number,
): SyntheticRecordSpec {
    return Object.freeze({
        recordId,
        leads: Object.freeze([
            LEAD_A_DEFAULT_SPEC,
            Object.freeze({
                name: 'lead-b',
                gain: 200,
                baseline: 1024,
                amplitudeMv: 1.0,
                frequencyHz,
            }),
        ]),
    });
}

function createMultiSubjectAdapter(): SyntheticDatasetAdapter {
    const specs: Record<string, SyntheticRecordSpec> = {};
    for (const recordId of MULTI_SUBJECT_IDS) {
        specs[recordId] = twoLeadSpec(recordId, LEAD_B_FREQUENCIES_HZ[recordId]!);
    }
    return new SyntheticDatasetAdapter(Object.freeze(specs));
}

const MULTI_SUBJECT_ADAPTER = createMultiSubjectAdapter();
const SOLO_ADAPTER = new SyntheticDatasetAdapter(
    Object.freeze({ solo: Object.freeze({ recordId: 'solo' }) }),
);

/** Labels the sign of the exact mV window the engine also sees. */
const signOfSumLabeler: GroundTruthLabeler = (window) => {
    let sum = 0;
    const data = window.data;
    for (let i = 0; i < data.length; i += 1) {
        sum += data[i]!;
    }
    return sum >= 0 ? 'positive-mean' : 'nonpositive-mean';
};

/** Every record is its own subject (synthetic self-subject convention). */
const MULTI_SUBJECT_REFS = subjectRefsForSelfSubjects(MULTI_SUBJECT_IDS);
const SOLO_REFS = subjectRefsForSelfSubjects(['solo']);

/** A committed subject-partition configuration for one role. */
function subjectPartitionConfigFor(
    role: 'test' | 'train',
): ExperimentConfiguration {
    return configFor({
        selection: {
            kind: 'subject-partition',
            partition: { ...DEFAULT_PARTITION_SPEC },
            role,
        },
    });
}

/**
 * A real `DatasetAdapter` spy: records every record id actually read while
 * delegating materialisation to the wrapped adapter.
 */
class RecordingReadAdapter implements DatasetAdapter {
    readonly datasetId: string;
    readonly readRecordIds: string[] = [];

    constructor(private readonly delegate: DatasetAdapter) {
        this.datasetId = delegate.datasetId;
    }

    async listRecordIds(): Promise<readonly RecordId[]> {
        return this.delegate.listRecordIds();
    }

    async readRecord(recordId: RecordId) {
        this.readRecordIds.push(recordId);
        return this.delegate.readRecord(recordId);
    }
}

/**
 * Analytic sign-of-sum oracle recomputed over the same adapter through the same
 * stage chain the runner uses (read → ADC→mV → window → sign of each window).
 */
async function analyticLeadBTrueLabels(
    adapter: DatasetAdapter,
    recordId: string,
): Promise<string[]> {
    const record = await adapter.readRecord(recordId);
    const signal = recordToMillivoltSignal(record);
    const segmentation = segmentSignal(signal, WINDOW_360_DROP);
    return segmentation.windows
        .filter((window) => window.channelIndex === LEAD_B_CHANNEL_INDEX)
        .map((window) => signOfSumLabeler(window));
}

describe('subject-partition runner demonstration (item 6: multi-subject fixture)', () => {
    it('partitions whole self-subjects deterministically, leakage-free, into every role', () => {
        const partitioned = partitionRecords(
            MULTI_SUBJECT_REFS,
            DEFAULT_PARTITION_SPEC,
        );
        // Guards do not throw: no subject spans more than one role.
        assertNoSubjectLeakage(partitioned.subjects);

        // Deterministic: partitioning the same refs again is identical.
        const again = partitionRecords(MULTI_SUBJECT_REFS, DEFAULT_PARTITION_SPEC);
        expect(again.records).toEqual(partitioned.records);

        // Every role is populated, so the split is a real train/test separation.
        expect(partitioned.records.train.length).toBeGreaterThan(0);
        expect(partitioned.records.validation.length).toBeGreaterThan(0);
        expect(partitioned.records.test.length).toBeGreaterThan(0);

        // Roles are disjoint and together cover every record exactly once.
        const all = [
            ...partitioned.records.train,
            ...partitioned.records.validation,
            ...partitioned.records.test,
        ];
        expect([...all].sort()).toEqual([...MULTI_SUBJECT_IDS].sort());

        // Self-subject convention: subjectId === recordId for every reference.
        for (const ref of MULTI_SUBJECT_REFS) {
            expect(ref.subjectId).toBe(ref.recordId);
        }
    });

    it('gives every subject 10 windows, both classes, and a pairwise-distinct oracle fingerprint', async () => {
        const fingerprints = new Map<string, string[]>();
        for (const recordId of MULTI_SUBJECT_IDS) {
            const labels = await analyticLeadBTrueLabels(
                MULTI_SUBJECT_ADAPTER,
                recordId,
            );
            expect(labels).toHaveLength(10);
            const classes = new Set(labels);
            expect(classes.has('positive-mean')).toBe(true);
            expect(classes.has('nonpositive-mean')).toBe(true);
            fingerprints.set(recordId, labels);
        }
        // Each subject is a distinguishable fingerprint: a train/test mix-up
        // would change the label pattern and become detectable by oracle.
        const encoded = new Set(
            [...fingerprints.values()].map((labels) => labels.join(',')),
        );
        expect(encoded.size).toBe(MULTI_SUBJECT_IDS.length);
    });

    it('reads only the test role (structural no-leakage) and records the analytic oracle faithfully', async () => {
        const engine = new RecordingEngine(createStubEngine({ logitBias: [5, 0] }));
        const spyAdapter = new RecordingReadAdapter(MULTI_SUBJECT_ADAPTER);
        const config = subjectPartitionConfigFor('test');
        const partitioned = partitionRecords(
            MULTI_SUBJECT_REFS,
            DEFAULT_PARTITION_SPEC,
        );
        const expectedTestIds = [...partitioned.records.test];
        expect(expectedTestIds.length).toBeGreaterThan(0);

        const result = await runFixture(
            engine,
            config,
            signOfSumLabeler,
            { ...DEFAULT_OPTIONS, recordRefs: MULTI_SUBJECT_REFS },
            spyAdapter,
        );

        // Structural no-leakage evidence: the adapter was asked to read exactly
        // the test-role records — never a train/validation subject.
        expect(spyAdapter.readRecordIds).toEqual(expectedTestIds);
        const trainAndValidation = new Set([
            ...partitioned.records.train,
            ...partitioned.records.validation,
        ]);
        for (const readId of spyAdapter.readRecordIds) {
            expect(trainAndValidation.has(readId)).toBe(false);
        }

        // Identity + a frozen config snapshot travel through the boundary.
        expect(result.experimentId).toBe(experimentIdOf(config));
        expect(result.config.selection).toEqual(config.selection);
        expect(Object.isFrozen(result.config.selection)).toBe(true);
        expect(result.records.map((record) => record.recordId)).toEqual(
            expectedTestIds,
        );

        // Every evaluated record is a self-subject on lead-b, fully windowed.
        for (const record of result.records) {
            expect(record.subjectId).toBe(record.recordId);
            expect(record.channelName).toBe('lead-b');
            expect(record.channelIndex).toBe(LEAD_B_CHANNEL_INDEX);
            expect(record.windows).toHaveLength(10);
        }

        // The recorded ground truth equals an independent analytic recompute of
        // the same adapter, and the evaluated subjects stay distinguishable.
        const recorded = new Map<string, string[]>();
        for (const record of result.records) {
            const recomputed = await analyticLeadBTrueLabels(
                MULTI_SUBJECT_ADAPTER,
                record.recordId,
            );
            const labels = record.windows.map((window) => window.trueLabel);
            expect(labels).toEqual(recomputed);
            recorded.set(record.recordId, labels);
        }
        expect(
            new Set([...recorded.values()].map((labels) => labels.join(','))).size,
        ).toBe(result.records.length);

        // Inference ran once per window; metrics are computed from the recorded
        // outcomes (honestly below perfect against the analytic oracle).
        expect(engine.runCount).toBe(20);
        expect(result.metrics.total).toBe(totalWindows(result));
        expect(result.metrics.accuracy).toBeLessThan(1);
    });

    it('single-subject edge: the lone subject lands in test; test runs and an empty train role is rejected', async () => {
        // A single subject spans the whole interval and closes it in `test`.
        const soloPartitioned = partitionRecords(SOLO_REFS, DEFAULT_PARTITION_SPEC);
        expect(soloPartitioned.records.train).toEqual([]);
        expect(soloPartitioned.records.validation).toEqual([]);
        expect(soloPartitioned.records.test).toEqual(['solo']);

        const options = { ...DEFAULT_OPTIONS, recordRefs: SOLO_REFS };
        const engine = new RecordingEngine(createStubEngine({ logitBias: [5, 0] }));
        const spyAdapter = new RecordingReadAdapter(SOLO_ADAPTER);

        const testResult = await runFixture(
            engine,
            subjectPartitionConfigFor('test'),
            signOfSumLabeler,
            options,
            spyAdapter,
        );
        expect(testResult.records.map((record) => record.recordId)).toEqual([
            'solo',
        ]);
        expect(totalWindows(testResult)).toBe(10);
        expect(spyAdapter.readRecordIds).toEqual(['solo']);

        // The empty train role must be refused loudly before any inference.
        const trainEngine = new RecordingEngine(
            createStubEngine({ logitBias: [5, 0] }),
        );
        await expectRejectsCode(
            () => runFixture(
                trainEngine,
                subjectPartitionConfigFor('train'),
                signOfSumLabeler,
                options,
                new RecordingReadAdapter(SOLO_ADAPTER),
            ),
            'invalid-input',
        );
        expect(trainEngine.runCount).toBe(0);
    });

    it('fails as invalid-input when a subject-partition configuration omits recordRefs', async () => {
        await expectRejectsCode(
            () => runFixture(
                new RecordingEngine(createStubEngine({ logitBias: [5, 0] })),
                subjectPartitionConfigFor('test'),
                signOfSumLabeler,
            ),
            'invalid-input',
        );
    });
});
