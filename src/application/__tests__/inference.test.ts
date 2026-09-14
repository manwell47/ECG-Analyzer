/**
 * Node gate for the model-output orchestration slice (Phase 18 Part B item 7).
 *
 * This exercises `src/application/inference.ts` with the *committed* test-only
 * stub engine (`src/ml/testing/stub.ts`) and the *committed* probe metadata
 * (`src/ml/testing/probeModel.ts`), driven by a real `AnalysisResult` produced
 * by the default lab service. It pins the honest, display-relevant behaviour
 * the plan requires:
 *
 * - the declared semantics decide whether a score is a genuine
 *   `predicted-probability` or an uncalibrated `model-score` — nothing in the
 *   description ever claims a probability the metadata does not declare;
 * - a window the declared contract does not accept fails classified
 *   (`model-compatibility-failure`) instead of being resampled, padded or
 *   reshaped;
 * - a prediction inconsistent with the model identity is rejected by
 *   interpretation rather than shown as a label;
 * - ordering is deterministic and the executed tensor is exactly the copied
 *   window of the analysed signal, whose samples are never mutated;
 * - the returned description is deeply frozen and carries the candidate id it
 *   stamped onto the executed input.
 *
 * No wall-clock timing and no canvas pixels are asserted (rules §51), and the
 * stub's numeric rule carries no scientific meaning — only the contract wiring
 * is under test.
 */
import { describe, expect, it } from 'vitest';
import { EcgError } from '../../domain/error';
import type {
    ModelInput,
    ModelMetadata,
    ModelOutputContract,
    ModelPrediction,
} from '../../domain/ml';
import type { InferenceEngine } from '../../ml/engine';
import { loadProbeModelMetadata } from '../../ml/testing/probeModel';
import { createStubEngine } from '../../ml/testing/stub';
import type { AnalysisResult } from '../analysis';
import { createDefaultLabService, defaultRecordAnalysisOptions } from '../defaults';
import {
    ModelOutputService,
    candidateIdOf,
    scoreModelOutput,
} from '../inference';

/** The committed probe declares a single channel of 360 samples at 360 Hz. */
const ONE_SECOND = { startSec: 0, durationSec: 1 } as const;
const SCORED_CHANNEL = 'lead-b';

/** Run the canonical default analysis once so every case scores a real result. */
async function analysedDefaultRecord(): Promise<AnalysisResult> {
    const service = createDefaultLabService();
    return service.analyze(defaultRecordAnalysisOptions());
}

/** Load the committed probe metadata and apply a shallow patch for a variant. */
function cloneMetadata(patch: {
    readonly expectedChannels?: number;
    readonly expectedWindowSamples?: number;
    readonly output?: Partial<ModelOutputContract>;
}): ModelMetadata {
    const base = loadProbeModelMetadata();
    return {
        ...base,
        ...(patch.expectedChannels === undefined
            ? {}
            : { expectedChannels: patch.expectedChannels }),
        ...(patch.expectedWindowSamples === undefined
            ? {}
            : { expectedWindowSamples: patch.expectedWindowSamples }),
        ...(patch.output === undefined
            ? {}
            : { output: { ...base.output, ...patch.output } }),
    };
}

/** An engine that records every realized input before delegating to `inner`. */
class RecordingEngine implements InferenceEngine {
    readonly backendId = 'recording';

    readonly inputs: ModelInput[] = [];

    constructor(private readonly inner: InferenceEngine) { }

    async run(
        metadata: Readonly<ModelMetadata>,
        input: Readonly<ModelInput>,
    ): Promise<ModelPrediction> {
        this.inputs.push(input);
        return this.inner.run(metadata, input);
    }

    async dispose(): Promise<void> {
        await this.inner.dispose();
    }
}

/** An engine whose `run` is scripted, so a case can force any outcome. */
function scriptedEngine(
    run: () => Promise<ModelPrediction>,
    backendId = 'scripted',
): InferenceEngine {
    return {
        backendId,
        run,
        dispose: (): Promise<void> => Promise.resolve(),
    };
}

/** Resolve the classified error a promise rejects with, or fail the case. */
async function errorOf(promise: Promise<unknown>): Promise<EcgError> {
    try {
        await promise;
    } catch (error) {
        if (error instanceof EcgError) {
            return error;
        }
        throw error;
    }
    throw new Error('Expected the promise to reject, but it resolved.');
}

describe('scoreModelOutput (display-only model-output slice)', () => {
    it('scores exactly the committed one-second window and describes it for display', async () => {
        const analysis = await analysedDefaultRecord();
        const metadata = loadProbeModelMetadata();

        const description = await scoreModelOutput(createStubEngine(), metadata, {
            analysis,
            channelName: SCORED_CHANNEL,
            viewport: ONE_SECOND,
        });

        expect(description.modelId).toBe(metadata.modelId);
        expect(description.modelVersion).toBe(metadata.modelVersion);
        expect(description.task).toBe(metadata.task);
        expect(description.backendId).toBe('stub');
        expect(description.window).toEqual({
            channelName: SCORED_CHANNEL,
            startSample: 0,
            endSample: 360,
            sampleCount: 360,
            startSec: 0,
            endSec: 1,
            durationSec: 1,
            sampleRateHz: 360,
        });
        expect(description.candidateId).toBe(
            candidateIdOf(metadata, analysis, SCORED_CHANNEL, {
                startSample: 0,
                endSample: 360,
            }),
        );

        // The declared contract travels verbatim; nothing is re-worded.
        expect(description.input).toEqual(metadata.input);
        expect(description.output).toEqual(metadata.output);
        expect(description.preprocessingAssumptions).toEqual(
            metadata.preprocessingAssumptions,
        );
        expect(description.normalization).toEqual(metadata.normalization);
        expect(description.modelProvenance).toEqual(metadata.provenance);
        expect(description.expectedSamplingRateHz).toBe(360);
        expect(description.expectedChannels).toBe(1);
        expect(description.expectedWindowSamples).toBe(360);
        expect(description.preprocessingFingerprint.length).toBeGreaterThan(0);
    });

    it('orders the two declared classes by descending score', async () => {
        const analysis = await analysedDefaultRecord();
        const metadata = loadProbeModelMetadata();

        const description = await scoreModelOutput(createStubEngine(), metadata, {
            analysis,
            channelName: SCORED_CHANNEL,
            viewport: ONE_SECOND,
        });

        expect(description.scores).toHaveLength(2);
        // Sanity: the description only ever carries the model's own two classes.
        expect([...description.scores.map((entry) => entry.label)].sort()).toEqual(
            [...metadata.output.classLabels].sort(),
        );
        expect(description.scores[0]!.score).toBeGreaterThanOrEqual(
            description.scores[1]!.score,
        );
    });

    it('executes exactly the copied window, stamps the candidate id, and never mutates the source', async () => {
        const analysis = await analysedDefaultRecord();
        const sourceChannel = analysis.signal.channels.find(
            (channel) => channel.name === SCORED_CHANNEL,
        )!;
        const before = Float64Array.from(sourceChannel.data);
        const metadata = loadProbeModelMetadata();
        const engine = new RecordingEngine(createStubEngine());

        const description = await scoreModelOutput(engine, metadata, {
            analysis,
            channelName: SCORED_CHANNEL,
            viewport: ONE_SECOND,
        });

        expect(engine.inputs).toHaveLength(1);
        const executed = engine.inputs[0]!;
        expect(executed.modelId).toBe(metadata.modelId);
        expect(executed.modelVersion).toBe(metadata.modelVersion);
        expect(executed.tensorName).toBe(metadata.input.name);
        expect(executed.dtype).toBe('float32');
        expect(executed.shape).toEqual([360]);
        expect(executed.sourceWindowIds).toEqual([description.candidateId]);
        expect(executed.data).not.toBe(sourceChannel.data);
        expect(executed.data).toEqual(Float32Array.from(before.slice(0, 360)));

        // The analysed signal is untouched: scoring is a read, never a filter.
        expect(sourceChannel.data).toEqual(before);
    });

    it('returns a deeply frozen, display-ready description', async () => {
        const analysis = await analysedDefaultRecord();

        const description = await scoreModelOutput(
            createStubEngine(),
            loadProbeModelMetadata(),
            { analysis, channelName: SCORED_CHANNEL, viewport: ONE_SECOND },
        );

        expect(Object.isFrozen(description)).toBe(true);
        expect(Object.isFrozen(description.window)).toBe(true);
        expect(Object.isFrozen(description.scores)).toBe(true);
        for (const score of description.scores) {
            expect(Object.isFrozen(score)).toBe(true);
        }
    });

    it('mints a deterministic candidate id: the same window collides, a different window never does', async () => {
        const analysis = await analysedDefaultRecord();
        const metadata = loadProbeModelMetadata();
        const engine = createStubEngine();

        const first = await scoreModelOutput(engine, metadata, {
            analysis,
            channelName: SCORED_CHANNEL,
            viewport: ONE_SECOND,
        });
        const repeat = await scoreModelOutput(engine, metadata, {
            analysis,
            channelName: SCORED_CHANNEL,
            viewport: ONE_SECOND,
        });
        const shifted = await scoreModelOutput(engine, metadata, {
            analysis,
            channelName: SCORED_CHANNEL,
            viewport: { startSec: 1, durationSec: 1 },
        });

        expect(first.candidateId).toBe(repeat.candidateId);
        expect(shifted.candidateId).not.toBe(first.candidateId);
        expect(shifted.window.startSample).toBe(360);
        expect(shifted.window.endSample).toBe(720);
    });

    it('falls back to the first channel for an unknown name and names the channel it scored', async () => {
        const analysis = await analysedDefaultRecord();

        const unknown = await scoreModelOutput(
            createStubEngine(),
            loadProbeModelMetadata(),
            { analysis, channelName: 'does-not-exist', viewport: ONE_SECOND },
        );
        const omitted = await scoreModelOutput(
            createStubEngine(),
            loadProbeModelMetadata(),
            { analysis, viewport: ONE_SECOND },
        );

        expect(unknown.window.channelName).toBe('lead-a');
        expect(omitted.window.channelName).toBe('lead-a');
    });
});

describe('scoreModelOutput — declared semantics decide the score kind', () => {
    it('reports logits + softmax as a predicted-probability', async () => {
        const analysis = await analysedDefaultRecord();

        const description = await scoreModelOutput(
            createStubEngine(),
            loadProbeModelMetadata(),
            { analysis, channelName: SCORED_CHANNEL, viewport: ONE_SECOND },
        );

        for (const score of description.scores) {
            expect(score.semantics).toBe('predicted-probability');
            expect(score.score).toBeGreaterThanOrEqual(0);
            expect(score.score).toBeLessThanOrEqual(1);
        }
    });

    it('reports declared probabilities as a predicted-probability', async () => {
        const analysis = await analysedDefaultRecord();
        const metadata = cloneMetadata({
            output: { semantics: 'probabilities', activation: 'softmax' },
        });

        const description = await scoreModelOutput(createStubEngine(), metadata, {
            analysis,
            channelName: SCORED_CHANNEL,
            viewport: ONE_SECOND,
        });

        for (const score of description.scores) {
            expect(score.semantics).toBe('predicted-probability');
        }
    });

    it('never claims a probability when the metadata declares uncalibrated output', async () => {
        const analysis = await analysedDefaultRecord();
        // logits with no activation: the numbers are not probabilities.
        const unactivated = cloneMetadata({ output: { activation: 'none' } });
        // declared model-scores: uncalibrated by the model's own choice.
        const modelScores = cloneMetadata({
            output: { semantics: 'model-scores', activation: 'none' },
        });

        const first = await scoreModelOutput(createStubEngine(), unactivated, {
            analysis,
            channelName: SCORED_CHANNEL,
            viewport: ONE_SECOND,
        });
        const second = await scoreModelOutput(createStubEngine(), modelScores, {
            analysis,
            channelName: SCORED_CHANNEL,
            viewport: ONE_SECOND,
        });

        for (const score of [...first.scores, ...second.scores]) {
            expect(score.semantics).toBe('model-score');
        }
    });
});

describe('scoreModelOutput — honest, classified refusals', () => {
    it('refuses the whole-record window as model-compatibility instead of reshaping it', async () => {
        const analysis = await analysedDefaultRecord();

        const error = await errorOf(
            scoreModelOutput(createStubEngine(), loadProbeModelMetadata(), {
                analysis,
            }),
        );

        expect(error.code).toBe('model-compatibility-failure');
    });

    it('refuses a window whose channel count the model does not declare', async () => {
        const analysis = await analysedDefaultRecord();
        const metadata = cloneMetadata({ expectedChannels: 2 });

        const error = await errorOf(
            scoreModelOutput(createStubEngine(), metadata, {
                analysis,
                channelName: SCORED_CHANNEL,
                viewport: ONE_SECOND,
            }),
        );

        expect(error.code).toBe('model-compatibility-failure');
    });

    it('refuses a window whose length the model does not declare', async () => {
        const analysis = await analysedDefaultRecord();
        const metadata = cloneMetadata({ expectedWindowSamples: 100 });

        const error = await errorOf(
            scoreModelOutput(createStubEngine(), metadata, {
                analysis,
                channelName: SCORED_CHANNEL,
                viewport: ONE_SECOND,
            }),
        );

        expect(error.code).toBe('model-compatibility-failure');
    });

    it('refuses an empty window as invalid-input rather than widening one to fit', async () => {
        const analysis = await analysedDefaultRecord();

        const error = await errorOf(
            scoreModelOutput(createStubEngine(), loadProbeModelMetadata(), {
                analysis,
                channelName: SCORED_CHANNEL,
                viewport: { startSec: 0, durationSec: 0 },
            }),
        );

        expect(error.code).toBe('invalid-input');
        expect(error.message).toContain(SCORED_CHANNEL);
    });
});

describe('scoreModelOutput — engine and prediction failures stay classified', () => {
    it('rejects a prediction inconsistent with the model identity instead of showing a label', async () => {
        const analysis = await analysedDefaultRecord();
        const metadata = loadProbeModelMetadata();
        const engine = scriptedEngine(async () => ({
            modelId: metadata.modelId,
            modelVersion: '9.9.9', // not the version that was asked to run
            outputName: metadata.output.name,
            values: Float64Array.from([1, 0]),
            semantics: metadata.output.semantics,
        }));

        const error = await errorOf(
            scoreModelOutput(engine, metadata, {
                analysis,
                channelName: SCORED_CHANNEL,
                viewport: ONE_SECOND,
            }),
        );

        expect(error.code).toBe('inference-failure');
    });

    it('passes a classified engine error through unchanged', async () => {
        const analysis = await analysedDefaultRecord();
        const classified = EcgError.modelCompatibility(
            'engine refused the input it was handed',
        );
        const engine = scriptedEngine(() => Promise.reject(classified));

        const error = await errorOf(
            scoreModelOutput(engine, loadProbeModelMetadata(), {
                analysis,
                channelName: SCORED_CHANNEL,
                viewport: ONE_SECOND,
            }),
        );

        expect(error).toBe(classified);
    });

    it('envelopes a non-classified engine throw as inference-failure, keeping the cause', async () => {
        const analysis = await analysedDefaultRecord();
        const cause = new Error('backend exploded');
        const engine = scriptedEngine(() => Promise.reject(cause));

        const error = await errorOf(
            scoreModelOutput(engine, loadProbeModelMetadata(), {
                analysis,
                channelName: SCORED_CHANNEL,
                viewport: ONE_SECOND,
            }),
        );

        expect(error.code).toBe('inference-failure');
        expect(error.context.cause).toBe(cause);
    });
});

describe('ModelOutputService', () => {
    it('scores through the engine it owns without disposing it', async () => {
        const analysis = await analysedDefaultRecord();
        const metadata = loadProbeModelMetadata();
        const engine = createStubEngine({ backendId: 'stub-service' });
        const service = new ModelOutputService(engine, metadata);

        const description = await service.score({
            analysis,
            channelName: SCORED_CHANNEL,
            viewport: ONE_SECOND,
        });

        expect(description.backendId).toBe('stub-service');
        expect(description.scores).toHaveLength(2);
        // The engine is caller-owned: a second scoring run still works.
        const again = await service.score({
            analysis,
            channelName: SCORED_CHANNEL,
            viewport: ONE_SECOND,
        });
        expect(again.candidateId).toBe(description.candidateId);
    });
});
