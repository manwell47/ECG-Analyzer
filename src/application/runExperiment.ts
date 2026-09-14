/**
 * Experiment evaluation runner (Phase 8 / ADR-007, ADR-009; rules §17, §24,
 * §30, §47, §49).
 *
 * `runExperiment` executes one committed {@link ExperimentConfiguration}
 * end-to-end and returns a frozen {@link ExperimentResult}. Per selected
 * record the stage chain is:
 *
 * ```
 * SignalRecord (raw ADC)
 *  → adapter.readRecord
 *  → recordToMillivoltSignal   (explicit ADC→mV calibration; provenance)
 *  → [optional] filterSignal   (declared preprocessing, if any)
 *  → segmentSignal             (configured window over every channel)
 *  → windows of the configured channel (original channelIndex preserved)
 *  → buildModelInput           (validated ModelInput, contract-checked)
 *  → engine.run                (caller-owned inference backend)
 *  → interpretPrediction[0]    (argmax interpretation, rules §18/§19)
 *  → labeler(window)           (caller ground truth)  → WindowOutcome
 *  → computeClassificationMetrics (metrics are computed, never fabricated)
 * ```
 *
 * Layering (architecture §E.3, §L): the runner lives in `src/application/` and
 * composes only the single-sourced, browser-safe implementations in `datasets/`,
 * `dsp/`, `ml/` (metadata, input packing, interpretation) and the neighbouring
 * `application/` experiment modules — no duplicated science (rules §30). It
 * never imports `ml/testing/` or `ml/onnx/`; those Node-only seams are entered
 * exclusively from Node test code.
 *
 * Lifecycle & honesty:
 *  - The runner is pure orchestration and NEVER disposes the engine — the
 *    caller owns the engine lifecycle (dispose hygiene is exercised by tests).
 *  - Metrics are recomputed from the recorded per-window outcomes by
 *    `metrics.ts`; nothing is fabricated, hard-coded or imported as prose (§24).
 *  - Every classified failure propagates loudly: an unknown record surfaces the
 *    adapter's `file-not-found`; engine/compatibility failures surface as
 *    `inference-failure` / `model-compatibility-failure`; a config that claims a
 *    different model than the metadata, an unknown channel, a labeler returning
 *    a label the model never declared, and an evaluation that would score zero
 *    windows all fail as `invalid-input`. An unexpected non-`EcgError` from a
 *    misbehaving caller-owned backend also surfaces rather than being swallowed.
 *  - The result is frozen at the boundary with a deep, owned snapshot of the
 *    configuration and an explicit, mandatory scope note so a scope-limited
 *    (e.g. seam) result can never read like a clinical claim (§47, §49).
 */
import { EcgError } from '../domain/error';
import type { ModelMetadata } from '../domain/ml';
import type { RecordSubjectRef } from '../datasets/partition';
import { recordToMillivoltSignal } from '../datasets/load';
import type { DatasetAdapter } from '../datasets/types';
import { filterSignal } from '../dsp/filter';
import { segmentSignal, type SignalWindow } from '../dsp/segment';
import type { InferenceEngine } from '../ml/engine';
import { buildModelInput } from '../ml/input';
import { interpretPrediction } from '../ml/interpret';
import { assertValidModelMetadata } from '../ml/metadata';
import {
    assertValidExperimentConfiguration,
    experimentIdOf,
    resolveSelectedRecordIds,
    type ExperimentConfiguration,
    type ExperimentSelection,
} from './experiment';
import {
    windowIdOf,
    type ExperimentResult,
    type RecordEvaluation,
    type WindowOutcome,
} from './experimentResult';
import { computeClassificationMetrics } from './metrics';

/**
 * Ground-truth rule the runner scores each window against. A labeler maps one
 * segmented window to a label string that must be one of the model's declared
 * `metadata.output.classLabels` (checked loudly per window).
 */
export type GroundTruthLabeler = (window: Readonly<SignalWindow>) => string;

/** Options controlling one evaluation run. */
export interface RunExperimentOptions {
    /** Library/app version that produced the result (reproducibility). */
    readonly softwareVersion: string;
    /**
     * Mandatory, explicit scope/limitations note (rules §47/§49 — honest
     * framing: a scope-limited result must never read like a clinical claim).
     */
    readonly scopeNote: string;
    /**
     * Subject-aware record references used only when
     * `config.selection.kind === 'subject-partition'` (each record's owning
     * subject). Ignored for an explicit `records` selection.
     */
    readonly recordRefs?: readonly RecordSubjectRef[];
}

function requireNonEmptyString(value: string, label: string): void {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw EcgError.invalidInput(`${label} must be a non-empty string.`);
    }
}

/** A deep, owned, frozen snapshot of the configuration (never the caller's object). */
function snapshotConfig(config: Readonly<ExperimentConfiguration>): ExperimentConfiguration {
    let selection: ExperimentSelection;
    if (config.selection.kind === 'records') {
        selection = Object.freeze({
            kind: 'records' as const,
            recordIds: Object.freeze([...config.selection.recordIds]),
        });
    } else {
        selection = Object.freeze({
            kind: 'subject-partition' as const,
            partition: Object.freeze({ ...config.selection.partition }),
            role: config.selection.role,
        });
    }

    const preprocessing =
        config.preprocessing === undefined
            ? undefined
            : Object.freeze({
                ...config.preprocessing,
                filter:
                    config.preprocessing.filter === undefined
                        ? undefined
                        : Object.freeze({
                            ...config.preprocessing.filter,
                            cutoffHz:
                                typeof config.preprocessing.filter.cutoffHz === 'number'
                                    ? config.preprocessing.filter.cutoffHz
                                    : Object.freeze(
                                        [...config.preprocessing.filter.cutoffHz] as [number, number],
                                    ),
                        }),
            });

    return Object.freeze({
        datasetId: config.datasetId,
        selection,
        channelName: config.channelName,
        ...(preprocessing === undefined ? {} : { preprocessing }),
        window: Object.freeze({ ...config.window }),
        model: Object.freeze({ ...config.model }),
        evaluation: Object.freeze({ ...config.evaluation }),
    });
}

/**
 * Run one configured evaluation over every selected record. See the module
 * header for the exact stage chain and the classified error surface. The
 * caller retains ownership of `engine` (never disposed here) and of the
 * adapter. Returns a frozen `ExperimentResult`.
 */
export async function runExperiment(
    adapter: DatasetAdapter,
    engine: InferenceEngine,
    metadata: Readonly<ModelMetadata>,
    config: Readonly<ExperimentConfiguration>,
    labeler: GroundTruthLabeler,
    options: Readonly<RunExperimentOptions>,
): Promise<ExperimentResult> {
    // ---- Pre-flight: refuse an incoherent run before touching data. ----
    assertValidExperimentConfiguration(config);
    assertValidModelMetadata(metadata);
    requireNonEmptyString(options.softwareVersion, 'options.softwareVersion');
    requireNonEmptyString(options.scopeNote, 'options.scopeNote');

    if (adapter.datasetId !== config.datasetId) {
        throw EcgError.invalidInput(
            `Adapter serves dataset "${adapter.datasetId}" but the configuration declares ` +
            `"${config.datasetId}"; an evaluation may only read from its declared dataset.`,
            {
                meta: {
                    adapterDatasetId: adapter.datasetId,
                    configuredDatasetId: config.datasetId,
                },
            },
        );
    }
    if (
        config.model.modelId !== metadata.modelId ||
        config.model.modelVersion !== metadata.modelVersion
    ) {
        throw EcgError.invalidInput(
            `Configuration targets model ${config.model.modelId}@${config.model.modelVersion} ` +
            `but the supplied metadata describes ${metadata.modelId}@${metadata.modelVersion}; ` +
            'an evaluation may only run the exact model artifact its configuration declares.',
            {
                meta: {
                    configuredModel: {
                        modelId: config.model.modelId,
                        modelVersion: config.model.modelVersion,
                    },
                    metadataModel: { modelId: metadata.modelId, modelVersion: metadata.modelVersion },
                },
            },
        );
    }

    const { recordIds } = resolveSelectedRecordIds(config, options.recordRefs ?? []);

    const declaredClassLabels = metadata.output.classLabels;
    const declaredClassSet = new Set<string>(declaredClassLabels);

    const records: RecordEvaluation[] = [];
    let windowOutcomeCount = 0;

    for (const recordId of recordIds) {
        const sourceRecord = await adapter.readRecord(recordId);
        const millivoltSignal = recordToMillivoltSignal(sourceRecord);
        const signal =
            config.preprocessing?.filter === undefined
                ? millivoltSignal
                : filterSignal(millivoltSignal, config.preprocessing.filter);

        const channelIndex = signal.channels.findIndex(
            (channel) => channel.name === config.channelName,
        );
        if (channelIndex === -1) {
            throw EcgError.invalidInput(
                `Record "${recordId}" has no channel named "${config.channelName}".`,
                {
                    meta: {
                        recordId,
                        channelName: config.channelName,
                        availableChannels: signal.channels.map((channel) => channel.name),
                    },
                },
            );
        }

        const segmentation = segmentSignal(signal, config.window);
        const channelWindows = segmentation.windows.filter(
            (window) => window.channelIndex === channelIndex,
        );

        const outcomes: WindowOutcome[] = [];
        for (const window of channelWindows) {
            const windowId = windowIdOf(recordId, channelIndex, window.startSample);
            const input = buildModelInput({
                metadata,
                source: {
                    sampleRateHz: signal.sampling.sampleRateHz,
                    channelCount: 1,
                    windowSamples: window.lengthSamples,
                    windowId,
                },
                data: window.data,
            });
            const prediction = await engine.run(metadata, input);
            const interpreted = interpretPrediction(metadata, prediction);
            const argmax = interpreted[0];
            if (argmax === undefined) {
                // Unreachable while metadata declares a non-empty class list; kept
                // explicit so no undefined can ever reach a recorded outcome.
                throw EcgError.inference(
                    `Model "${metadata.modelId}" declared no interpretable class for window ${windowId}.`,
                    { meta: { recordId, windowId } },
                );
            }

            const trueLabel = labeler(window);
            if (!declaredClassSet.has(trueLabel)) {
                throw EcgError.invalidInput(
                    `Ground-truth labeler returned "${trueLabel}" for window ${windowId}, which is ` +
                    `not one of the model's declared classes [${declaredClassLabels.join(', ')}].`,
                    { meta: { recordId, windowId, label: trueLabel } },
                );
            }

            outcomes.push(
                Object.freeze({
                    windowId,
                    recordId,
                    channelIndex,
                    channelName: config.channelName,
                    startSample: window.startSample,
                    lengthSamples: window.lengthSamples,
                    trueLabel,
                    predictedLabel: argmax.label,
                    predictedScore: argmax.score,
                    semantics: argmax.semantics,
                }),
            );
        }

        windowOutcomeCount += outcomes.length;
        records.push(
            Object.freeze({
                recordId,
                subjectId: sourceRecord.subjectId,
                channelName: config.channelName,
                channelIndex,
                provenance: signal.provenance,
                windows: Object.freeze(outcomes),
            }),
        );
    }

    if (windowOutcomeCount === 0) {
        throw EcgError.invalidInput(
            'Evaluation produced zero windows; there is nothing to score. ' +
            'Check the channel name and that every selected record is long enough for the window.',
            {
                meta: {
                    recordIds: [...recordIds],
                    channelName: config.channelName,
                    window: { ...config.window },
                },
            },
        );
    }

    const allOutcomes = records.flatMap((record) => record.windows);
    const metrics = computeClassificationMetrics(declaredClassLabels, allOutcomes);
    const labelerSnapshot = Object.freeze({ ...config.evaluation });

    return Object.freeze({
        experimentId: experimentIdOf(config),
        config: snapshotConfig(config),
        labeler: labelerSnapshot,
        softwareVersion: options.softwareVersion,
        scopeNote: options.scopeNote,
        evaluatedAtIso: new Date().toISOString(),
        records: Object.freeze(records),
        metrics,
    });
}
