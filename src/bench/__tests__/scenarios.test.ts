/**
 * Phase 9 scenario-operand tests (architecture §M.9; rules §51).
 *
 * Shape-only and determinism assertions over `src/bench/scenarios.ts`. These
 * tests deliberately assert input *shape* and *determinism* only — never
 * runtime duration. Timing is machine-dependent and never a CI gate (rules
 * §51); throughput belongs exclusively to the `*.bench.ts` harness and the
 * committed baseline snapshot.
 *
 * Building the operands here is cheap and pure: each size is one deterministic
 * in-memory synthetic record converted to mV. No DSP transform is executed in
 * these tests.
 */
import { describe, expect, it } from 'vitest';

import type { Signal } from '../../domain/signal';
import { assertValidSignal } from '../../domain/signal';
import { maxOrthogonalPeriodicLevelForLength } from '../../dsp/dwt/dwt';
import { DB4_TAP_COUNT } from '../../fixtures/db4';
import {
    allScenarios,
    BENCH_RESAMPLE_TARGET_RATE_HZ,
    BENCH_SAMPLE_RATE_HZ,
    BENCH_SIZES_SAMPLES,
    BENCH_WINDOW_CONFIG,
    scenarioForSize,
} from '../scenarios';

/** The exact canonical sizes the plan commits to (3600..650000 samples). */
const DECLARED_SIZES: readonly number[] = [3600, 36000, 360000, 650000];

/** Element-wise identity of two signals' channel samples (typed arrays). */
function expectIdenticalSamples(a: Signal, b: Signal): void {
    expect(a.channels).toHaveLength(b.channels.length);
    for (let channelIndex = 0; channelIndex < a.channels.length; channelIndex += 1) {
        const left = a.channels[channelIndex]!;
        const right = b.channels[channelIndex]!;
        expect(left.name).toBe(right.name);
        expect(left.unit).toBe(right.unit);
        expect(left.data.length).toBe(right.data.length);
        for (let sample = 0; sample < left.data.length; sample += 1) {
            expect(left.data[sample]).toBe(right.data[sample]);
        }
    }
}

describe('benchmark scenario size set', () => {
    it('declares the canonical sizes including the full-record operand', () => {
        expect([...BENCH_SIZES_SAMPLES]).toEqual([...DECLARED_SIZES]);
        expect(BENCH_SIZES_SAMPLES).toContain(650000);
    });

    it('builds one scenario per declared size, in the declared order', () => {
        expect(allScenarios().map((scenario) => scenario.sizeSamples)).toEqual([
            ...DECLARED_SIZES,
        ]);
    });

    it('rejects undeclared sizes instead of silently synthesising ad-hoc inputs', () => {
        expect(() => scenarioForSize(1234)).toThrow(RangeError);
    });
});

describe('benchmark scenario operand shape', () => {
    it.each(DECLARED_SIZES)(
        'size %i: a two-channel mV signal of that exact length at 360 Hz',
        (size) => {
            const scenario = scenarioForSize(size);
            expect(scenario.sizeSamples).toBe(size);
            expect(scenario.signal.sampling.sampleRateHz).toBe(BENCH_SAMPLE_RATE_HZ);
            expect(scenario.signal.channels).toHaveLength(2);
            for (const channel of scenario.signal.channels) {
                expect(channel.unit).toBe('mV');
                expect(channel.data).toHaveLength(size);
            }
        },
    );

    it('configures a representative zero-phase lowpass for every scenario', () => {
        for (const scenario of allScenarios()) {
            expect(scenario.filterSpec.type).toBe('lowpass');
            expect(scenario.filterSpec.phaseCharacteristic).toBe('zero');
            expect(scenario.filterSpec.numTaps).toBeGreaterThanOrEqual(5);
            expect(scenario.filterSpec.numTaps % 2).toBe(1);
            expect(scenario.filterSpec.cutoffHz).toBe(40);
        }
    });

    it('configures a periodic-Db4 level that satisfies the orthogonal length policy', () => {
        // Deepest orthogonal periodic level for db4 (tapCount 8) per size,
        // independently reasoned: 3600=2^4*225, 36000=2^5*1125,
        // 360000=2^6*5625, 650000=2^4*5^5*13.
        const expectedLevels: Readonly<Record<number, number>> = {
            3600: 4,
            36000: 5,
            360000: 6,
            650000: 4,
        };
        for (const scenario of allScenarios()) {
            expect(scenario.dwtConfig.waveletName).toBe('db4');
            expect(scenario.dwtConfig.extensionMode).toBe('periodic');
            expect(scenario.dwtConfig.level).toBe(
                expectedLevels[scenario.sizeSamples],
            );
            expect(scenario.dwtConfig.level).toBeGreaterThanOrEqual(1);
            expect(scenario.dwtConfig.level).toBeLessThanOrEqual(
                maxOrthogonalPeriodicLevelForLength(
                    scenario.sizeSamples,
                    DB4_TAP_COUNT,
                ),
            );
        }
    });

    it('configures a 360-sample window and the 360 -> 128 resample operand', () => {
        for (const scenario of allScenarios()) {
            expect(scenario.windowConfig.windowLengthSamples).toBe(
                BENCH_WINDOW_CONFIG.windowLengthSamples,
            );
            expect(scenario.windowConfig.windowLengthSamples).toBe(
                BENCH_SAMPLE_RATE_HZ,
            );
            expect(scenario.windowConfig.strideSamples).toBe(
                BENCH_SAMPLE_RATE_HZ,
            );
            expect(scenario.windowConfig.remainderPolicy).toBe('drop');
            expect(scenario.resampleTargetRateHz).toBe(
                BENCH_RESAMPLE_TARGET_RATE_HZ,
            );
        }
    });

    it('produces structurally valid signals (existing assert helper, no throw)', () => {
        for (const scenario of allScenarios()) {
            expect(() => assertValidSignal(scenario.signal)).not.toThrow();
        }
    });
});

describe('benchmark scenario determinism and memoization', () => {
    it('rebuilding a size yields bit-identical samples (pure deterministic build)', () => {
        // Cheapest representative sizes — determinism is a property of the
        // generator (already unit-tested), exercised here on the operand path.
        for (const size of [3600, 36000]) {
            const first = scenarioForSize(size);
            const second = scenarioForSize(size);
            expect(first.signal.id).toBe(second.signal.id);
            expectIdenticalSamples(first.signal, second.signal);
        }
    });

    it('memoises allScenarios: repeated access returns the same operand objects', () => {
        const scenarios = allScenarios();
        expect(allScenarios()).toBe(scenarios);
        expect(allScenarios()[0]).toBe(scenarios[0]);
    });

    it('keeps the full-record operand present and internally consistent', () => {
        const scenarios = allScenarios();
        const fullRecord = scenarios[3]!;
        expect(fullRecord.sizeSamples).toBe(650000);
        expect(fullRecord.signal.channels[0]!.data).toHaveLength(650000);
        expect(fullRecord.signal.channels[1]!.data).toHaveLength(650000);
    });
});
