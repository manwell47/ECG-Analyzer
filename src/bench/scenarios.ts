/**
 * Phase 9 benchmark operands (architecture §M.9; rules §50, §51, §52).
 *
 * Measurement-only baseline harness inputs, built deterministically and
 * entirely in memory — no data files, no I/O and no RNG (ADR-006 synthetic
 * adapter). Two builds of the same size yield bit-identical operands, so
 * `vitest bench` numbers are reproducible and comparable across runs and
 * machines.
 *
 * Scope discipline (the approved Phase 9 increment): this module only *builds
 * inputs*. It performs no DSP and no timing. Timing is machine-dependent and
 * is deliberately never a CI gate (rules §51); the companion `*.bench.ts`
 * files measure throughput, and the committed policy/baseline/ADR documents
 * record the decisions those numbers drive.
 *
 * The scenario set is fixed: 3600 (10 s), 36 000 (100 s), 360 000 (1000 s)
 * and ~650 000 (full-record-size, ≈ 30 min at 360 Hz) samples per channel.
 * DSP operand configs are representative and constant across sizes; only the
 * raw signal length and the periodic-Db4 level vary per size.
 */
import {
    generateSyntheticRecord,
} from '../datasets/synthetic/adapter';
import { recordToMillivoltSignal } from '../datasets/load';
import { assertValidSignal, type Signal } from '../domain/signal';
import type { FilterSpec } from '../dsp/filter';
import type { NormalizationSpec } from '../dsp/normalize';
import type { ResamplingSpec } from '../dsp/resample';
import {
    maxOrthogonalPeriodicLevelForLength,
    type DwtConfig,
} from '../dsp/dwt/dwt';
import type { WindowConfig } from '../dsp/segment';
import { DB4_NAME, DB4_TAP_COUNT } from '../fixtures/db4';

/** Canonical sample rate (Hz) of every scenario signal. */
export const BENCH_SAMPLE_RATE_HZ = 360;

/**
 * Canonical deterministic input sizes, samples per channel. Frozen so every
 * run, machine and future phase measures the same set.
 */
export const BENCH_SIZES_SAMPLES: readonly number[] = Object.freeze([
    3600,
    36000,
    360000,
    650000,
]);

/** Representative zero-phase lowpass (40 Hz) at 360 Hz — constant operand. */
export const BENCH_FILTER_SPEC: FilterSpec = Object.freeze({
    type: 'lowpass',
    cutoffHz: 40,
    numTaps: 65,
    phaseCharacteristic: 'zero',
    purpose:
        'Phase 9 baseline operand: representative morphology-preserving zero-phase lowpass.',
});

/** Representative per-channel z-score normalization — constant operand. */
export const BENCH_NORMALIZATION_SPEC: NormalizationSpec = Object.freeze({
    strategy: 'zscore',
    scope: 'per-channel',
});

/** Non-overlapping 360-sample (1 s at 360 Hz) windows; trailing tail dropped. */
export const BENCH_WINDOW_CONFIG: WindowConfig = Object.freeze({
    windowLengthSamples: 360,
    strideSamples: 360,
    remainderPolicy: 'drop',
});

/** Representative downsample target (360 -> 128 Hz) — constant operand. */
export const BENCH_RESAMPLE_TARGET_RATE_HZ = 128;

/** Representative resampling options (kernel radius default, reflected edges). */
export const BENCH_RESAMPLE_SPEC: ResamplingSpec = Object.freeze({
    edgeMode: 'reflect',
});

/** Concise human labels (inspection only — never a timing gate). */
const SCENARIO_LABELS: Readonly<Record<number, string>> = {
    3600: '10 s',
    36000: '100 s',
    360000: '1000 s',
    650000: 'full-record-size (~30 min)',
};

/** One ready-to-measure operand for a canonical size. */
export interface BenchScenario {
    /** Samples per channel of the raw signal. */
    readonly sizeSamples: number;
    /** Human-readable duration label (never a timing gate). */
    readonly label: string;
    /** Deterministic raw mV signal (two synthetic channels, ADC-derived). */
    readonly signal: Signal;
    readonly filterSpec: FilterSpec;
    /** Periodic Db4 at the deepest orthogonal level this size supports. */
    readonly dwtConfig: DwtConfig;
    readonly normalizationSpec: NormalizationSpec;
    readonly windowConfig: WindowConfig;
    readonly resampleTargetRateHz: number;
    readonly resampleSpec: ResamplingSpec;
}

function labelFor(sizeSamples: number): string {
    const label = SCENARIO_LABELS[sizeSamples];
    if (label === undefined) {
        throw new RangeError(
            `No benchmark scenario label for ${sizeSamples} samples; ` +
            'scenario inputs are a fixed deterministic set.',
        );
    }
    return label;
}

/** Build one operand from scratch: pure, deterministic, in-memory. */
function buildScenario(sizeSamples: number): BenchScenario {
    const record = generateSyntheticRecord({
        recordId: `bench-${sizeSamples}`,
        sampleRateHz: BENCH_SAMPLE_RATE_HZ,
        sampleCount: sizeSamples,
    });
    const signal = recordToMillivoltSignal(record, {
        id: `bench/${BENCH_SAMPLE_RATE_HZ}hz/${sizeSamples}`,
    });
    // Fail fast here rather than inside a timed benchmark loop: every operand
    // handed to the harness must already be structurally valid.
    assertValidSignal(signal);

    const dwtConfig: DwtConfig = {
        waveletName: DB4_NAME,
        level: maxOrthogonalPeriodicLevelForLength(sizeSamples, DB4_TAP_COUNT),
        extensionMode: 'periodic',
    };

    return {
        sizeSamples,
        label: labelFor(sizeSamples),
        signal,
        filterSpec: BENCH_FILTER_SPEC,
        dwtConfig,
        normalizationSpec: BENCH_NORMALIZATION_SPEC,
        windowConfig: BENCH_WINDOW_CONFIG,
        resampleTargetRateHz: BENCH_RESAMPLE_TARGET_RATE_HZ,
        resampleSpec: BENCH_RESAMPLE_SPEC,
    };
}

/**
 * Build the operand for a canonical size. Two calls yield bit-identical
 * results (pure build, no cache); prefer {@link allScenarios} when the same
 * operand should be shared across many benchmark iterations.
 */
export function scenarioForSize(sizeSamples: number): BenchScenario {
    if (!BENCH_SIZES_SAMPLES.includes(sizeSamples)) {
        throw new RangeError(
            `${sizeSamples} is not a declared benchmark size ` +
            `(${BENCH_SIZES_SAMPLES.join(', ')} samples); scenario inputs are a ` +
            'fixed deterministic set, never ad-hoc sizes.',
        );
    }
    return buildScenario(sizeSamples);
}

let memoizedScenarios: readonly BenchScenario[] | undefined;

/**
 * One operand per canonical size, built once and then shared. This is the
 * entry point for the `*.bench.ts` files so the heavy full-record operand is
 * synthesised exactly once per process.
 */
export function allScenarios(): readonly BenchScenario[] {
    if (memoizedScenarios === undefined) {
        memoizedScenarios = BENCH_SIZES_SAMPLES.map(buildScenario);
    }
    return memoizedScenarios;
}
