/**
 * DSP/DWT executor seam (Phase 10, item 4; ADR-005, ADR-011).
 *
 * `RecordAnalysisService` keeps the *workflow* (load record → ADC→mV →
 * DSP/DWT stage → assemble result) and delegates only the DSP/DWT stage to a
 * {@link DspExecutor}. Two implementations share one contract:
 *
 * - {@link MainThreadDspExecutor} runs the exact inline `filterSignal` +
 *   `decomposeSignal` chain the application always ran (the default, so
 *   existing behaviour and tests are untouched);
 * - {@link WorkerDspExecutor} relays the identical inputs over a
 *   {@link LatestOnlyDspClient}, so the whole-record DSP/DWT leaves the main
 *   thread with no duplicated science (rules §30).
 *
 * Both call the single-sourced `src/dsp` functions — on the main thread, or
 * inside the DSP worker core — so their results are byte-identical. That parity
 * is the correctness gate pinned by `workerAnalysis.parity.test.ts`
 * (relocation, not optimization).
 */

import type { Signal } from '../domain/signal';
import type { DwtConfig } from '../dsp/dwt';
import { decomposeSignal } from '../dsp/dwt';
import { filterSignal } from '../dsp/filter';
import type { FilterSpec } from '../dsp/filter';
import type { DspExecution, LatestOnlyDspClient } from '../workers';

/** The DSP-relevant inputs of one analysis the executor must act on. */
export interface DspStageRequest {
    /** Optional declared pre-DWT filter (see `FilterSpec`). */
    readonly filter?: FilterSpec;
    /** The explicit, validated DWT configuration. */
    readonly dwt: DwtConfig;
}

/**
 * The single DSP/DWT stage seam: validate → optional filter → decompose,
 * returning the analyzed signal alongside its decomposition. Implementations
 * must produce byte-identical `{ signal, decomposition }` for identical inputs.
 */
export interface DspExecutor {
    execute(
        signal: Readonly<Signal>,
        request: Readonly<DspStageRequest>,
    ): Promise<DspExecution>;
}

/** Runs the DSP/DWT stage inline on the calling thread (the historical path). */
export class MainThreadDspExecutor implements DspExecutor {
    async execute(
        signal: Readonly<Signal>,
        request: Readonly<DspStageRequest>,
    ): Promise<DspExecution> {
        const analyzed =
            request.filter === undefined ? signal : filterSignal(signal, request.filter);
        const decomposition = decomposeSignal(analyzed, request.dwt);
        return { signal: analyzed, decomposition };
    }
}

/**
 * Relays the DSP/DWT stage to a worker over a {@link LatestOnlyDspClient}. The
 * latest-only policy (supersede stale requests, drop late completions) belongs
 * to the client, so a slow analysis can never overwrite a newer one (rules
 * §31); a superseded run rejects as `request-superseded`.
 */
export class WorkerDspExecutor implements DspExecutor {
    constructor(private readonly client: LatestOnlyDspClient) { }

    execute(
        signal: Readonly<Signal>,
        request: Readonly<DspStageRequest>,
    ): Promise<DspExecution> {
        return this.client.request(signal.id, signal, request.dwt, request.filter);
    }
}

/** The default, stateless main-thread executor (no worker required). */
export const MAIN_THREAD_DSP_EXECUTOR: DspExecutor = new MainThreadDspExecutor();
