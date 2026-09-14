/**
 * Phase 9 DSP baseline harness (architecture §M.9; rules §50, §51, §52).
 *
 * Measurement-only: this file measures engineering throughput of the pure,
 * deterministic DSP core over the fixed scenario set in `./scenarios.ts`
 * (3600..650000 samples). It performs NO optimization and NO model/clinic
 * evaluation — throughput figures here are machine-dependent and are used to
 * drive later, evidence-based optimization decisions (ADR-010), never as a CI
 * gate (rules §51). The ~16.7 ms UI frame budget (rules §52) is the reference
 * point the policy doc derives from these numbers.
 *
 * Methodology: each bench runs one full, real DSP transform over a memoized
 * deterministic operand. Per-bench `iterations`/`time` are chosen per size so
 * the heavy full-record benches stay bounded while the small ones collect
 * enough samples (tinybench stops once BOTH `time` elapsed AND `iterations`
 * samples were taken). Numbers are captured with `--outputJson` into the
 * gitignored `/bench-results/` directory for the committed baseline snapshot.
 */
import { bench, describe } from 'vitest';

import { designFirFilter, filterSignal } from '../dsp/filter';
import { normalizeSignal } from '../dsp/normalize';
import { resampleSignal } from '../dsp/resample';
import { segmentSignal } from '../dsp/segment';
import { decomposeSignal, reconstructSignal } from '../dsp/dwt/dwt';
import {
    allScenarios,
    BENCH_SAMPLE_RATE_HZ,
    type BenchScenario,
} from './scenarios';

/**
 * Per-size bench budget. tinybench runs until both `time` (ms) has elapsed and
 * at least `iterations` samples have been taken, so small sizes collect many
 * cheap samples while full-record sizes stop after a few expensive ones.
 */
const BENCH_TIMING: Readonly<
    Record<number, { readonly iterations: number; readonly time: number }>
> = {
    3600: { iterations: 60, time: 200 },
    36000: { iterations: 40, time: 200 },
    360000: { iterations: 12, time: 200 },
    650000: { iterations: 5, time: 200 },
};

function timingFor(sizeSamples: number): {
    readonly iterations: number;
    readonly time: number;
} {
    const timing = BENCH_TIMING[sizeSamples];
    if (timing === undefined) {
        throw new RangeError(
            `No benchmark budget declared for ${sizeSamples} samples.`,
        );
    }
    return timing;
}

/** Short, stable bench suffix describing the operand size. */
function sizeLabel(scenario: BenchScenario): string {
    return `${scenario.sizeSamples} samples (${scenario.label})`;
}

describe('filter: design (constant) and zero-phase lowpass over whole records', () => {
    const representative = allScenarios()[0]!;

    bench(
        `design ${representative.filterSpec.numTaps}-tap ${representative.filterSpec.type} @ ${BENCH_SAMPLE_RATE_HZ} Hz`,
        () => {
            designFirFilter(representative.filterSpec, BENCH_SAMPLE_RATE_HZ);
        },
        { iterations: 20, time: 150 },
    );

    for (const scenario of allScenarios()) {
        bench(`filterSignal (zero-phase) — ${sizeLabel(scenario)}`, () => {
            filterSignal(scenario.signal, scenario.filterSpec);
        }, timingFor(scenario.sizeSamples));
    }
});

describe('normalize: per-channel z-score fit + apply over whole records', () => {
    for (const scenario of allScenarios()) {
        bench(`normalizeSignal (zscore) — ${sizeLabel(scenario)}`, () => {
            normalizeSignal(scenario.signal, scenario.normalizationSpec);
        }, timingFor(scenario.sizeSamples));
    }
});

describe('segment: non-overlapping 360-sample windows over whole records', () => {
    for (const scenario of allScenarios()) {
        bench(`segmentSignal (360/360) — ${sizeLabel(scenario)}`, () => {
            segmentSignal(scenario.signal, scenario.windowConfig);
        }, timingFor(scenario.sizeSamples));
    }
});

describe('DWT db4 periodic decompose (and full round-trip)', () => {
    for (const scenario of allScenarios()) {
        const level = scenario.dwtConfig.level;
        bench(
            `decomposeSignal (db4 level ${level}) — ${sizeLabel(scenario)}`,
            () => {
                decomposeSignal(scenario.signal, scenario.dwtConfig);
            },
            timingFor(scenario.sizeSamples),
        );
        bench(
            `decompose + reconstruct (db4 level ${level}) — ${sizeLabel(scenario)}`,
            () => {
                const decomposition = decomposeSignal(
                    scenario.signal,
                    scenario.dwtConfig,
                );
                reconstructSignal(decomposition);
            },
            timingFor(scenario.sizeSamples),
        );
    }
});

describe('resample: whole records 360 -> 128 Hz', () => {
    for (const scenario of allScenarios()) {
        bench(
            `resampleSignal (${BENCH_SAMPLE_RATE_HZ}->${scenario.resampleTargetRateHz} Hz) — ${sizeLabel(scenario)}`,
            () => {
                resampleSignal(
                    scenario.signal,
                    scenario.resampleTargetRateHz,
                    scenario.resampleSpec,
                );
            },
            timingFor(scenario.sizeSamples),
        );
    }
});
