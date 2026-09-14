/**
 * Minimal record-analysis orchestration (Phase 7 item #5 / architecture E.3).
 *
 * This is the first `src/application/` slice: it owns the *workflow* that turns
 * one record into the domain-typed products the views render, and it is the
 * only layer the presentation layer may call. Dependency direction is
 * preserved exactly:
 *
 * ```
 * presentation → application → domain / dsp / datasets / workers
 * ```
 *
 * The pipeline is the inspectable, composable stage chain of architecture §E.3
 * narrowed to what scientific visualization needs (items #9/#10):
 *
 * ```
 * SignalRecord (raw ADC)
 *  → validate
 *  → recordToMillivoltSignal        (explicit ADC→mV calibration step)
 *  → [optional] filterSignal        (declared preprocessing, if any)
 *  → decomposeSignal                (periodic DWT over every channel)
 *  → AnalysisResult
 * ```
 *
 * Every intermediate is a domain type and every DSP/calibration step appends
 * to the signal's own provenance, so an `AnalysisResult` documents exactly how
 * its `signal` (and therefore its `decomposition`) was obtained — no silent
 * rescaling, no unexplained preprocessing. This module contains no science of
 * its own: it delegates to the single-sourced, tested implementations in
 * `dsp/` and `datasets/` (rules §30 — no duplicated logic, even for workers).
 *
 * `AnalysisResult` deliberately lives here, not in `domain/`: it bundles a
 * `WaveletDecomposition`, whose type is declared by `dsp/dwt`, and the domain
 * layer must not import `dsp/` (ADR-002). Its *fields* are domain-typed values
 * (`SignalRecord`, `Signal`, `WaveletDecomposition`, stable identities), which
 * is what "domain-typed result" means at this boundary.
 */

import type { DatasetAdapter } from '../datasets/types';
import { recordToMillivoltSignal } from '../datasets/load';
import { EcgError } from '../domain/error';
import type {
    RecordId,
    RecordIdentity,
    SignalRecord,
    SubjectId,
} from '../domain/record';
import type { Signal } from '../domain/signal';
import { filterTransformName, type FilterSpec } from '../dsp/filter';
import {
    dwtTransformName,
    type DwtConfig,
    type WaveletDecomposition,
} from '../dsp/dwt';
import { MAIN_THREAD_DSP_EXECUTOR, type DspExecutor } from './dspExecutor';

/** What one record analysis is asked to produce (fully explicit, validated). */
export interface RecordAnalysisOptions {
    /** Record to load through the dataset adapter. */
    readonly recordId: RecordId;
    /**
     * Optional explicit preprocessing applied *after* the ADC→mV calibration
     * and *before* the DWT. Omit to analyze the physical mV signal as-is
     * (no unexplained filters — rules forbid them without `purpose`).
     */
    readonly filter?: FilterSpec;
    /** The periodic DWT to decompose every channel with. */
    readonly dwt: DwtConfig;
}

/**
 * The domain-typed outcome of analyzing one record for visualization.
 *
 * - `sourceRecord` is the validated raw-ADC record exactly as the adapter
 *   served it (annotations and per-channel calibration remain available to the
 *   views without any downstream fusion).
 * - `signal` is the physical-unit (mV) signal the analysis actually ran on —
 *   the same signal the views plot on the time axis (`sampleIndex`/fs) — with
 *   its own provenance chain (`adc-to-millivolt` + any declared filter).
 * - `decomposition` is the periodic DWT of exactly `signal` (they share
 *   channels, sample rate and source length; an invariant asserted on build),
 *   which the DWT coefficient view renders.
 *
 * Immutable by convention: the object is frozen at the boundary and every
 * nested domain value is already frozen or immutable-by-convention.
 */
export interface AnalysisResult {
    /** Which record this analysis describes. */
    readonly identity: RecordIdentity;
    /** Subject of the analyzed record (kept for provenance/partitioning). */
    readonly subjectId: SubjectId;
    /** Raw canonical record as served by the adapter (validated, unmodified). */
    readonly sourceRecord: SignalRecord;
    /** Physical-unit signal actually analyzed (source of the decomposition). */
    readonly signal: Signal;
    /** Periodic DWT of `signal`, per channel. */
    readonly decomposition: WaveletDecomposition;
    /** Stable id of this analysis: identity + exact transform names. */
    readonly analysisId: string;
    /** ISO-8601 timestamp when this analysis was produced (reproducibility). */
    readonly generatedAtIso: string;
}

/**
 * Deterministic analysis id derived from the record identity and the exact
 * options (filter + DWT names). Independent of wall-clock time, so re-running
 * the same options yields the same id while different options never collide.
 */
export function analysisIdOf(
    identity: RecordIdentity,
    options: Readonly<RecordAnalysisOptions>,
): string {
    const base = `${identity.datasetId}/${identity.recordId}`;
    const stageNames: string[] = [];
    if (options.filter !== undefined) {
        stageNames.push(filterTransformName(options.filter));
    }
    stageNames.push(dwtTransformName(options.dwt));
    return `${base} :: ${stageNames.join(' :: ')}`;
}

/**
 * Structural invariant: the decomposition must describe exactly the `signal`
 * it was produced from. `decomposeSignal` guarantees this by construction; the
 * assert keeps future refactors from assembling a mismatched result silently.
 */
function assertCoherentAnalysis(
    signal: Signal,
    decomposition: WaveletDecomposition,
): void {
    const problems: string[] = [];
    if (decomposition.signalId !== signal.id) {
        problems.push(
            `decomposition.signalId "${decomposition.signalId}" differs from signal.id "${signal.id}"`,
        );
    }
    if (decomposition.sampling.sampleRateHz !== signal.sampling.sampleRateHz) {
        problems.push('decomposition sample rate differs from the signal sample rate');
    }
    const sourceLength = signal.channels[0]?.data.length;
    if (decomposition.sourceLengthSamples !== sourceLength) {
        problems.push(
            `decomposition.sourceLengthSamples ${decomposition.sourceLengthSamples} differs ` +
            `from the signal channel length ${String(sourceLength)}`,
        );
    }
    const signalNames = signal.channels.map((channel) => channel.name);
    const decompositionNames = decomposition.channels.map((channel) => channel.channelName);
    const namesMatch =
        signalNames.length === decompositionNames.length &&
        signalNames.every((name, index) => name === decompositionNames[index]);
    if (!namesMatch) {
        problems.push('decomposition channel names differ from the signal channel names');
    }
    if (problems.length > 0) {
        throw EcgError.invalidInput(
            `Analysis coherence check failed: ${problems.join('; ')}.`,
            {
                detail:
                    'Internal invariant: an AnalysisResult.signal and its decomposition ' +
                    'must describe the same channels, sample rate and source length.',
            },
        );
    }
}

/**
 * Assemble the frozen, domain-typed `AnalysisResult` from an already-computed
 * DSP/DWT outcome. The coherence invariant (a decomposition must describe
 * exactly the analyzed signal) is asserted here, once, for both executor paths.
 */
export function assembleAnalysis(
    sourceRecord: SignalRecord,
    options: Readonly<RecordAnalysisOptions>,
    signal: Signal,
    decomposition: WaveletDecomposition,
): AnalysisResult {
    assertCoherentAnalysis(signal, decomposition);
    return Object.freeze({
        identity: sourceRecord.identity,
        subjectId: sourceRecord.subjectId,
        sourceRecord,
        signal,
        decomposition,
        analysisId: analysisIdOf(sourceRecord.identity, options),
        generatedAtIso: new Date().toISOString(),
    });
}

/**
 * Analyze one record through the full domain-typed stage chain. Loads the
 * record via the adapter, converts to physical mV units (the explicit
 * calibration step), then hands the optional declared filter + DWT to a
 * {@link DspExecutor} (main-thread by default; a worker-backed executor runs
 * the identical DSP/DWT stage off the main thread — phase 10, item 4). Never
 * mutates anything; classified `EcgError`s propagate loudly (adapter,
 * calibration, DSP validation, or the worker envelope).
 */
export async function analyzeRecord(
    adapter: DatasetAdapter,
    options: Readonly<RecordAnalysisOptions>,
    executor: DspExecutor = MAIN_THREAD_DSP_EXECUTOR,
): Promise<AnalysisResult> {
    const sourceRecord = await adapter.readRecord(options.recordId);
    const millivoltSignal = recordToMillivoltSignal(sourceRecord);
    const execution = await executor.execute(millivoltSignal, options);
    return assembleAnalysis(sourceRecord, options, execution.signal, execution.decomposition);
}

/**
 * Thin application service owning one dataset adapter plus one DSP/DWT
 * executor. This is the object the presentation layer and `src/main.ts` hold so
 * views/interaction controls (#8/#11) always go through application
 * orchestration and never touch the adapter or DSP internals directly. The
 * executor defaults to the main thread; the browser bootstrap may inject a
 * worker-backed one (phase 10, item 4) without any change to callers.
 */
export class RecordAnalysisService {
    /** Stable dataset identity of the wrapped adapter (e.g. `synthetic`). */
    readonly datasetId: string;

    constructor(
        private readonly adapter: DatasetAdapter,
        private readonly dspExecutor: DspExecutor = MAIN_THREAD_DSP_EXECUTOR,
    ) {
        this.datasetId = adapter.datasetId;
    }

    /** List the record ids the wrapped dataset can serve. */
    async listRecordIds(): Promise<readonly RecordId[]> {
        return this.adapter.listRecordIds();
    }

    /** Analyze one record; see {@link analyzeRecord}. */
    async analyze(
        options: Readonly<RecordAnalysisOptions>,
    ): Promise<AnalysisResult> {
        return analyzeRecord(this.adapter, options, this.dspExecutor);
    }
}
