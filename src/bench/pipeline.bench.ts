/**
 * Phase 9 pipeline baseline harness (architecture §M.9; rules §47, §49, §50,
 * §51, §52).
 *
 * SEAM-VALIDATION SCOPE — NOT CLINICAL.
 *
 * Measurement-only, like `dsp.bench.ts`: this file measures engineering
 * throughput of the real ML/pipeline path over the fixed deterministic
 * scenario set in `./scenarios.ts` (3600..650000 samples). It performs NO
 * optimization and NO model-performance evaluation; throughput figures here are
 * machine-dependent and drive later, evidence-based optimization decisions
 * (ADR-010), never a CI gate (rules §51).
 *
 * What is measured:
 *  1. `buildModelInput` packing — for each scenario size, one pass builds the
 *     model input for every contiguous 360-sample `lead-b` window of that
 *     record (10 / 100 / 1000 / 1805 windows), against the committed probe
 *     metadata contract (the only committed model), float32 payload — exactly
 *     the packing the real pipeline performs per window.
 *  2. A `runExperiment` seam — one full evaluation per scenario size over a
 *     long synthetic record driven by the REAL committed ONNX probe
 *     (`loadProbeModelBytes` + `createOnnxWebEngine`, the Phase-8 seam path).
 *     Each timed sample is one complete `runExperiment` (record read → ADC→mV
 *     → segmentation → packing → real session inference → interpretation →
 *     analytic sign-of-sum ground truth → metrics → frozen result), so the
 *     recorded mean ms / window count yields windows-per-second. The 3600-size
 *     seam reads the canonical `sync` record (10 windows) — the Phase-8 pinned
 *     10-window anchor reproduced verbatim as this file's correctness
 *     reference; larger sizes use dedicated `bench-*` synthetic records of the
 *     same deterministic shape.
 *
 * What this does NOT prove: predictive performance. The only committed model
 * is a development seam-validation probe whose graph emits `logits = [+Σ, −Σ]`
 * (see the probe metadata limitations); its sign-of-sum oracle agrees with the
 * analytic ground-truth rule by construction. This bench exists only to record
 * engineering throughput of the evaluation pipeline (rules §47/§49 are
 * honoured by this wording, never omitted).
 *
 * Methodology: operands are deterministic and in-memory; records are
 * re-synthesised identically on every read (no I/O, ADR-006). Bench
 * `iterations`/`time` are chosen per size so the full-record seam runs stay
 * bounded (tinybench stops once BOTH `time` elapsed AND `iterations` samples
 * were taken); the seam benches additionally pin a single warm-up run. The
 * vitest bench runner does not execute suite `beforeAll`/`afterAll` hooks, so
 * the seam engine is created lazily on its first invocation (that first call
 * lands inside a warm-up sample whose timings are discarded) and is
 * deliberately not disposed: this is a single-shot bench process and the ORT
 * Web WASM allocation is reclaimed on process exit. Raw numbers are captured
 * with `--outputJson` into the gitignored `/bench-results/` directory for the
 * committed baseline snapshot.
 */
import { bench, describe } from 'vitest';

import type { ExperimentConfiguration } from '../application/experiment';
import { runExperiment, type GroundTruthLabeler, type RunExperimentOptions } from '../application/runExperiment';
import {
    createProbeSeamExperimentConfiguration,
    DEFAULT_SYNTHETIC_RECORD_ID,
} from '../application/defaults';
import { SyntheticDatasetAdapter } from '../datasets/synthetic/adapter';
import type { ModelMetadata } from '../domain/ml';
import { segmentSignal } from '../dsp/segment';
import type { InferenceEngine } from '../ml/engine';
import { buildModelInput } from '../ml/input';
import { assertValidModelMetadata } from '../ml/metadata';
import { createOnnxWebEngine } from '../ml/onnx/ortWebEngine';
import {
    loadProbeModelBytes,
    loadProbeModelMetadata,
    PROBE_MODEL_CHANNELS,
    PROBE_MODEL_ID,
    PROBE_MODEL_VERSION,
    PROBE_MODEL_WINDOW_SAMPLES,
} from '../ml/testing/probeModel';
import {
    allScenarios,
    BENCH_SAMPLE_RATE_HZ,
    type BenchScenario,
} from './scenarios';

/**
 * Per-size packing budget. Each bench sample packs every window of that
 * record, so larger records do more work per sample; `iterations` stays
 * highest on the cheap 3600/36000 records where one pass is a few hundred
 * windows at most.
 */
const PACK_BUDGETS: Readonly<
    Record<number, { readonly iterations: number; readonly time: number }>
> = {
    3600: { iterations: 60, time: 200 },
    36000: { iterations: 60, time: 200 },
    360000: { iterations: 30, time: 200 },
    650000: { iterations: 15, time: 200 },
};

/**
 * Per-size seam budget. Each sample is one COMPLETE `runExperiment` over a real
 * ONNX session, so the full-record sizes get a single sample plus a single
 * warm-up run while the 10-window anchor collects several.
 */
const SEAM_BUDGETS: Readonly<
    Record<number, { readonly iterations: number; readonly time: number }>
> = {
    3600: { iterations: 6, time: 200 },
    36000: { iterations: 4, time: 200 },
    360000: { iterations: 1, time: 200 },
    650000: { iterations: 1, time: 200 },
};

/** Seam benches also pin warm-up to one full run (bounded wall time). */
function seamBudgetFor(sizeSamples: number): {
    readonly iterations: number;
    readonly time: number;
    readonly warmupTime: number;
    readonly warmupIterations: number;
} {
    const budget = SEAM_BUDGETS[sizeSamples];
    if (budget === undefined) {
        throw new RangeError(
            `No seam benchmark budget declared for ${sizeSamples} samples.`,
        );
    }
    return { ...budget, warmupTime: 100, warmupIterations: 1 };
}

function packBudgetFor(sizeSamples: number): {
    readonly iterations: number;
    readonly time: number;
} {
    const budget = PACK_BUDGETS[sizeSamples];
    if (budget === undefined) {
        throw new RangeError(
            `No packing benchmark budget declared for ${sizeSamples} samples.`,
        );
    }
    return budget;
}

/** Short, stable bench suffix describing the operand size. */
function sizeLabel(scenario: BenchScenario): string {
    return `${scenario.sizeSamples} samples (${scenario.label})`;
}

/** Contiguous 360-sample windows a full record yields (drop policy). */
function windowCountOf(scenario: BenchScenario): number {
    return Math.floor(
        scenario.sizeSamples / scenario.windowConfig.windowLengthSamples,
    );
}

// ---------------------------------------------------------------------------
// Committed probe artifact access (metadata for packing, engine for the seam).
// ---------------------------------------------------------------------------

let metadataCache: ModelMetadata | undefined;

/** Strictly validated committed probe metadata, loaded at most once. */
function probeMetadata(): ModelMetadata {
    if (metadataCache === undefined) {
        metadataCache = loadProbeModelMetadata();
        assertValidModelMetadata(metadataCache);
    }
    return metadataCache;
}

let seamEngine: InferenceEngine | undefined;

/**
 * Lazy, memoised seam engine over the committed probe model. vitest bench mode
 * does not run suite hooks, so the session is created on the first seam sample
 * that needs it — that call happens inside a warm-up run, whose timings are
 * discarded — and is then reused for every measured sample across all sizes.
 * It is deliberately not disposed: the bench is a single-shot process and ORT
 * Web's WASM memory is reclaimed at exit (there is no reliable afterAll hook
 * in benchmark mode).
 */
async function ensureSeamEngine(): Promise<InferenceEngine> {
    if (seamEngine === undefined) {
        seamEngine = await createOnnxWebEngine({
            metadata: probeMetadata(),
            modelBytes: loadProbeModelBytes(),
        });
    }
    return seamEngine;
}

// ---------------------------------------------------------------------------
// Deterministic, in-memory record registry for the seam (one record per size).
// The 3600 size IS the canonical 'sync' default record — the Phase-8 pinned
// 10-window seam anchor — reproduced verbatim; larger sizes are dedicated
// bench records of the identical deterministic shape.
// ---------------------------------------------------------------------------

const SEAM_RECORD_ID_BY_SIZE: Readonly<Record<number, string>> = Object.freeze({
    3600: DEFAULT_SYNTHETIC_RECORD_ID,
    36000: 'bench-36000',
    360000: 'bench-360000',
    650000: 'bench-650000',
});

function seamRecordIdFor(sizeSamples: number): string {
    const recordId = SEAM_RECORD_ID_BY_SIZE[sizeSamples];
    if (recordId === undefined) {
        throw new RangeError(
            `No seam record declared for ${sizeSamples} samples.`,
        );
    }
    return recordId;
}

const SEAM_ADAPTER = new SyntheticDatasetAdapter({
    [DEFAULT_SYNTHETIC_RECORD_ID]: { recordId: DEFAULT_SYNTHETIC_RECORD_ID },
    'bench-36000': { recordId: 'bench-36000', sampleCount: 36000 },
    'bench-360000': { recordId: 'bench-360000', sampleCount: 360000 },
    'bench-650000': { recordId: 'bench-650000', sampleCount: 650000 },
});

/** One seam evaluation configuration: the canonical probe config, per size. */
function seamConfigFor(sizeSamples: number): ExperimentConfiguration {
    const base = createProbeSeamExperimentConfiguration();
    return {
        ...base,
        selection: {
            kind: 'records' as const,
            recordIds: [seamRecordIdFor(sizeSamples)],
        },
    };
}

/** Analytic sign-of-sum oracle, identical to the Phase-8 seam correctness anchor. */
const signOfSumLabeler: GroundTruthLabeler = (window) => {
    let sum = 0;
    const data = window.data;
    for (let i = 0; i < data.length; i += 1) {
        sum += data[i]!;
    }
    return sum >= 0 ? 'positive-mean' : 'nonpositive-mean';
};

const SEAM_SOFTWARE_VERSION = '0.0.0-phase-9-throughput-bench';

/** Mandatory scope note (rules §47/§49): what this throughput seam is and is not. */
const SEAM_SCOPE_NOTE =
    'Phase 9 engineering-throughput seam (seam-validation scope, NOT a clinical ' +
    'or model-performance result). One full runExperiment per scenario size over a deterministic ' +
    'synthetic record, driven by the real committed ONNX probe ' +
    `(${PROBE_MODEL_ID} v${PROBE_MODEL_VERSION}, channel lead-b, 360/360/drop windows). ` +
    'The probe sign-of-mean oracle agrees with the analytic sign-of-sum ground truth by ' +
    'construction, so this bench records pipeline throughput (windows per second), never accuracy. ' +
    'Numbers are a machine snapshot for ADR-010, never a CI gate. No medical or scientific ' +
    'conclusion may be drawn from this result.';

const SEAM_OPTIONS: RunExperimentOptions = {
    softwareVersion: SEAM_SOFTWARE_VERSION,
    scopeNote: SEAM_SCOPE_NOTE,
};

// ---------------------------------------------------------------------------
// Model-input packing operands: contiguous 360-sample lead-b windows, derived
// once per size from the shared deterministic scenario signal by the exact
// segmentation the pipeline uses (then filtered to the configured channel).
// ---------------------------------------------------------------------------

interface PreparedWindow {
    readonly windowId: string;
    readonly data: Float64Array;
}

const leadBWindowCache = new Map<number, readonly PreparedWindow[]>();

function leadBWindowsFor(scenario: BenchScenario): readonly PreparedWindow[] {
    const cached = leadBWindowCache.get(scenario.sizeSamples);
    if (cached !== undefined) {
        return cached;
    }
    const segmented = segmentSignal(scenario.signal, scenario.windowConfig);
    const windows = segmented.windows
        .filter((window) => window.channelIndex === 1)
        .map((window) => ({
            windowId: `${scenario.signal.id}/ch/1/w${window.startSample}`,
            data: window.data,
        }));
    leadBWindowCache.set(scenario.sizeSamples, windows);
    return windows;
}

// ---------------------------------------------------------------------------
// 1) Model-input packing (float32), per size. One sample packs every window of
//    the record; mean ms / window count gives per-window packing time.
// ---------------------------------------------------------------------------

describe('pipeline: buildModelInput (float32, lead-b) over every 360-sample window', () => {
    const metadata = probeMetadata();

    for (const scenario of allScenarios()) {
        const count = windowCountOf(scenario);
        bench(
            `buildModelInput (float32, 1x360) — ${count} windows — ${sizeLabel(scenario)}`,
            () => {
                const windows = leadBWindowsFor(scenario);
                for (const prepared of windows) {
                    buildModelInput({
                        metadata,
                        source: {
                            sampleRateHz: BENCH_SAMPLE_RATE_HZ,
                            channelCount: PROBE_MODEL_CHANNELS,
                            windowSamples: PROBE_MODEL_WINDOW_SAMPLES,
                            windowId: prepared.windowId,
                        },
                        data: prepared.data,
                        dtype: 'float32',
                    });
                }
            },
            packBudgetFor(scenario.sizeSamples),
        );
    }
});

// ---------------------------------------------------------------------------
// 2) runExperiment seam over the real ONNX probe, per size. One sample is one
//    complete evaluation; windows/second is derived in the baseline snapshot.
// ---------------------------------------------------------------------------

describe('pipeline: runExperiment seam (real ONNX probe) — windows per second', () => {
    const metadata = probeMetadata();

    for (const scenario of allScenarios()) {
        const count = windowCountOf(scenario);
        const config = seamConfigFor(scenario.sizeSamples);
        bench(
            `runExperiment seam (real ONNX, sign-of-sum) — ${count} windows — ${sizeLabel(scenario)}`,
            async () => {
                const engine = await ensureSeamEngine();
                await runExperiment(
                    SEAM_ADAPTER,
                    engine,
                    metadata,
                    config,
                    signOfSumLabeler,
                    SEAM_OPTIONS,
                );
            },
            seamBudgetFor(scenario.sizeSamples),
        );
    }
});
