/**
 * Model-output orchestration: score one window of an already-analysed signal
 * through an injected inference engine, and describe the result for display
 * (Phase 18 Part B item 7).
 *
 * This is the second orchestration slice in `src/application/` and it obeys the
 * same dependency rule as `analysis.ts`:
 *
 * ```
 * presentation → application → domain / ml / dsp / datasets / workers
 * ```
 *
 * The stage chain is deliberately short and inspectable:
 *
 * ```
 * AnalysisResult + selected channel + committed viewport
 *  → sampleWindowOfTime                (the domain's one time -> sample mapping)
 *  → a copy of exactly those samples    (the analysed signal is never touched)
 *  → buildModelInput                    (the one ModelInput constructor)
 *  → describeInputCompatibilityProblems (classified refusal — never a reshape)
 *  → engine.run                         (caller-owned engine; never disposed here)
 *  → interpretPrediction                (declared semantics decide probability
 *                                        vs uncalibrated score)
 *  → ModelOutputDescription             (display-ready, frozen)
 * ```
 *
 * What this module deliberately does NOT do:
 * - it never resamples, pads, truncates or reshapes a window to fit a model. A
 *   window the declared contract does not accept is a classified
 *   `model-compatibility-failure`, because a shape-compatible tensor is not a
 *   scientifically compatible one (rules §16);
 * - it never invents a probability. The `semantics` of every score is exactly
 *   what the declared metadata honestly supports;
 * - it never disposes the engine: the caller owns the engine lifecycle (the
 *   same rule `runExperiment.ts` follows), so one worker-backed engine can be
 *   scored through repeatedly.
 *
 * The returned description is *display-ready*: the model's own identity, its
 * declared input/output contract, its declared preprocessing/normalization and
 * provenance, the identity of the window that was scored, and the per-label
 * scores with their honest `semantics`. No field of it is a claim the model's
 * own metadata does not make.
 */

import { EcgError } from '../domain/error';
import type {
    InterpretedSemantics,
    ModelInputContract,
    ModelMetadata,
    ModelNormalization,
    ModelOutputContract,
    ModelProvenance,
    ModelPrediction,
    PreprocessingAssumption,
} from '../domain/ml';
import type { SampleWindow, SamplingInfo, TimeSpan } from '../domain/sampling';
import {
    durationSecOf,
    sampleWindowOfTime,
    timeSecOfSample,
} from '../domain/sampling';
import type { Signal, SignalChannel } from '../domain/signal';
import type { InferenceEngine } from '../ml/engine';
import { describeInputCompatibilityProblems } from '../ml/engine';
import { buildModelInput } from '../ml/input';
import { interpretPrediction } from '../ml/interpret';
import { assertValidModelMetadata } from '../ml/metadata';
import type { AnalysisResult } from './analysis';

/** Which channel, and which window, of an analysed record to score. */
export interface ModelScoreRequest {
    /** The analysis whose signal is scored; its identity travels in the result. */
    readonly analysis: Readonly<AnalysisResult>;
    /**
     * Channel name to score. When omitted — or when the signal carries no such
     * channel — the first channel is scored, the same fallback the views use.
     * The description always names the channel that was actually scored, so the
     * fallback is visible rather than silent.
     */
    readonly channelName?: string | undefined;
    /**
     * Committed display viewport to score, in seconds. When omitted the whole
     * record is scored — which a fixed-window model may legitimately refuse; the
     * refusal is reported, never worked around.
     */
    readonly viewport?: TimeSpan | undefined;
}

/** The exact half-open sample window that was scored, plus its time extent. */
export interface ScoredWindow {
    /** Name of the channel these samples came from. */
    readonly channelName: string;
    /** First scored sample (inclusive). */
    readonly startSample: number;
    /** One past the last scored sample (exclusive). */
    readonly endSample: number;
    /** Number of scored samples (`endSample - startSample`). */
    readonly sampleCount: number;
    /** Time (seconds) of `startSample`. */
    readonly startSec: number;
    /** Time (seconds) of `endSample` (the first sample *after* the window). */
    readonly endSec: number;
    readonly durationSec: number;
    readonly sampleRateHz: number;
}

/** One labelled score with the semantics the metadata honestly supports. */
export interface ModelOutputScore {
    readonly label: string;
    readonly score: number;
    /**
     * `'predicted-probability'` only when the metadata declared values that are
     * genuinely probabilities; otherwise an uncalibrated `'model-score'`.
     */
    readonly semantics: InterpretedSemantics;
}

/**
 * A frozen, display-ready account of one model run: what ran, on exactly which
 * window, and what its own metadata said the numbers mean.
 */
export interface ModelOutputDescription {
    readonly modelId: string;
    readonly modelVersion: string;
    /** The model's own task label, verbatim (e.g. 'beat-classification'). */
    readonly task: string;
    /** Backend that executed the run (e.g. 'stub', 'onnx-web'). */
    readonly backendId: string;
    /**
     * Stable identity of the scored candidate — exactly the window id stamped
     * onto the executed `ModelInput.sourceWindowIds[0]`.
     */
    readonly candidateId: string;
    readonly window: ScoredWindow;
    readonly input: ModelInputContract;
    readonly output: ModelOutputContract;
    readonly expectedSamplingRateHz?: number | undefined;
    readonly expectedChannels?: number | undefined;
    readonly expectedWindowSamples?: number | undefined;
    readonly preprocessingAssumptions: readonly PreprocessingAssumption[];
    readonly normalization: ModelNormalization;
    readonly modelProvenance: ModelProvenance;
    /** Fingerprint of the metadata whose contract produced the executed input. */
    readonly preprocessingFingerprint: string;
    /** Per-label scores, ordered by descending score (deterministic on ties). */
    readonly scores: readonly ModelOutputScore[];
}

/** The channel to score: the named one when present, else the first. */
function selectChannel(
    signal: Readonly<Signal>,
    channelName: string | undefined,
): SignalChannel {
    const first = signal.channels[0];
    if (first === undefined) {
        throw EcgError.invalidInput(
            'The analysed signal has no channels to score.',
            { detail: 'An inference window requires at least one channel of samples.' },
        );
    }
    if (channelName === undefined) {
        return first;
    }
    return signal.channels.find((channel) => channel.name === channelName) ?? first;
}

/** The span covering every sample of a channel, in the analysis' own time base. */
function wholeRecordSpan(
    sampling: SamplingInfo,
    sampleCount: number,
): TimeSpan {
    return {
        startSec: sampling.startTimeSec,
        durationSec: durationSecOf(sampleCount, sampling.sampleRateHz),
    };
}

/**
 * Deterministic identity of one scored candidate: the model version, the
 * analysis it was scored against, and the exact half-open sample window. It is
 * independent of wall-clock time, so re-scoring the same window is the same
 * candidate while a different window never collides.
 */
export function candidateIdOf(
    metadata: Readonly<ModelMetadata>,
    analysis: Readonly<AnalysisResult>,
    channelName: string,
    window: SampleWindow,
): string {
    return (
        `${metadata.modelId}@${metadata.modelVersion} :: ${analysis.analysisId} :: ` +
        `${channelName} :: [${window.startSample}, ${window.endSample})`
    );
}

/**
 * Score one window of an analysed signal with `engine`, and describe the result
 * for display.
 *
 * Every refusal is classified and happens *before* the model runs: a window
 * that the metadata's declared contract does not accept, an empty window, or an
 * input tensor dtype this service cannot honestly realise. An engine failure is
 * re-thrown as its own classified error (a non-classified throw is enveloped as
 * `inference-failure`), and an inconsistent prediction is rejected by
 * `interpretPrediction` rather than shown as a label.
 */
export async function scoreModelOutput(
    engine: InferenceEngine,
    metadata: Readonly<ModelMetadata>,
    request: Readonly<ModelScoreRequest>,
): Promise<ModelOutputDescription> {
    assertValidModelMetadata(metadata);

    const { analysis } = request;
    const channel = selectChannel(analysis.signal, request.channelName);
    const sampling = analysis.signal.sampling;
    const totalSamples = channel.data.length;
    const span = request.viewport ?? wholeRecordSpan(sampling, totalSamples);

    const sampleWindow = sampleWindowOfTime(span, sampling, totalSamples);
    const windowSamples = sampleWindow.endSample - sampleWindow.startSample;
    if (windowSamples === 0) {
        throw EcgError.invalidInput(
            `The selected window covers no samples of channel "${channel.name}" ` +
            `(${span.startSec}s + ${span.durationSec}s at ${sampling.sampleRateHz} Hz).`,
            {
                detail:
                    'A model window must contain at least one sample; nothing was ' +
                    'executed and no window was widened to make one fit.',
            },
        );
    }

    const declaredDtype = metadata.input.dtype;
    if (declaredDtype !== 'float32' && declaredDtype !== 'float64') {
        throw EcgError.modelCompatibility(
            `Model "${metadata.modelId}" declares a ${declaredDtype} input tensor; ` +
            'this service realises windows only as float32 or float64.',
            {
                detail:
                    'Casting physical-unit samples to an integer dtype would change ' +
                    'the values the model reads, so it is refused rather than coerced.',
            },
        );
    }

    const data = channel.data.slice(
        sampleWindow.startSample,
        sampleWindow.endSample,
    );
    const candidateId = candidateIdOf(metadata, analysis, channel.name, sampleWindow);

    const input = buildModelInput({
        metadata,
        source: {
            sampleRateHz: sampling.sampleRateHz,
            channelCount: 1,
            windowSamples,
            windowId: candidateId,
        },
        data,
        dtype: declaredDtype,
    });

    // The engine's own pre-execution boundary, re-asserted here: the description
    // is only ever built from an input that a compatible engine accepts. For a
    // freshly built input this is expected to be empty by construction — it is a
    // guard against future edits, not a path that normally fires.
    const problems = describeInputCompatibilityProblems(metadata, input);
    if (problems.length > 0) {
        throw EcgError.modelCompatibility(
            'The realised window failed pre-execution validation.',
            {
                detail: problems.join(' '),
                meta: { problems: [...problems] },
            },
        );
    }

    let prediction: ModelPrediction;
    try {
        prediction = await engine.run(metadata, input);
    } catch (error) {
        if (error instanceof EcgError) {
            throw error;
        }
        throw EcgError.inference(
            'The inference backend failed while scoring the selected window.',
            { cause: error },
        );
    }

    const interpreted = interpretPrediction(metadata, prediction);

    return Object.freeze({
        modelId: metadata.modelId,
        modelVersion: metadata.modelVersion,
        task: metadata.task,
        backendId: engine.backendId,
        candidateId,
        window: Object.freeze({
            channelName: channel.name,
            startSample: sampleWindow.startSample,
            endSample: sampleWindow.endSample,
            sampleCount: windowSamples,
            startSec: timeSecOfSample(sampleWindow.startSample, sampling),
            endSec: timeSecOfSample(sampleWindow.endSample, sampling),
            durationSec: durationSecOf(windowSamples, sampling.sampleRateHz),
            sampleRateHz: sampling.sampleRateHz,
        }),
        input: metadata.input,
        output: metadata.output,
        expectedSamplingRateHz: metadata.expectedSamplingRateHz,
        expectedChannels: metadata.expectedChannels,
        expectedWindowSamples: metadata.expectedWindowSamples,
        preprocessingAssumptions: metadata.preprocessingAssumptions,
        normalization: metadata.normalization,
        modelProvenance: metadata.provenance,
        preprocessingFingerprint: input.preprocessingFingerprint,
        scores: Object.freeze(
            interpreted.map((entry) =>
                Object.freeze({
                    label: entry.label,
                    score: entry.score,
                    semantics: entry.semantics,
                }),
            ),
        ),
    });
}

/**
 * Thin application service owning one inference engine plus the one model it
 * may run. This is the object `src/main.ts` holds so a view can score the
 * currently analysed window through application orchestration, never by
 * touching an engine, the ml helpers or a dataset adapter directly. The engine
 * is the caller's: this service never disposes it.
 */
export class ModelOutputService {
    constructor(
        private readonly engine: InferenceEngine,
        private readonly metadata: Readonly<ModelMetadata>,
    ) { }

    /** Score one window; see {@link scoreModelOutput}. */
    async score(
        request: Readonly<ModelScoreRequest>,
    ): Promise<ModelOutputDescription> {
        return scoreModelOutput(this.engine, this.metadata, request);
    }
}
