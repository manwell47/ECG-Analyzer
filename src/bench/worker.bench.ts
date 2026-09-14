/**
 * Phase 10 worker-offload measurement harness (architecture §M.10; ADR-005,
 * ADR-010, ADR-011; rules §50, §51, §52).
 *
 * MEASUREMENT-ONLY. NO OPTIMIZATION. NO CI GATE.
 *
 * This file records the *engineering* cost of the two ways the identical
 * DSP/DWT stage can run over the fixed deterministic scenario set in
 * `./scenarios.ts` (3600..650000 samples @ 360 Hz):
 *
 *  1. `main-thread DspExecutor` — `MAIN_THREAD_DSP_EXECUTOR.execute(signal,
 *     { dwt })`, the exact inline `decomposeSignal` chain the application ran
 *     before Phase 10. This is the "before" side of the before/after pair and
 *     is the Phase-9 baseline path.
 *  2. `Node loopback` — the *real production* worker glue, in a single Node
 *     process: `bindDspCore` on one in-memory `WorkerPort` `⇄`
 *     `LatestOnlyDspClient` on the other, wired only by `queueMicrotask`
 *     hops. Each sample issues one whole-record request and awaits its reply,
 *     so it measures the SAME `decomposeSignal` work plus the envelope/latest-
 *     only/promise-scheduling overhead of the offload machinery.
 *
 * `NOT A BROWSER` (stated on purpose): the loopback performs NO structured
 * clone, NO serialization, NO cross-thread scheduling and NO real `postMessage`
 * task boundary — those costs do not exist in-process. The loopback number is
 * therefore a *lower bound* on the real in-browser handoff overhead, and the
 * point of the pair is not "worker is faster" (it is not: the algorithm is
 * unchanged) but to show the messaging machinery is small next to the DSP work
 * and that the win of offload is main-thread availability, never a faster
 * algorithm (rules §30 — relocation, not optimization).
 *
 * What this does NOT prove: nothing about model quality or clinical behaviour
 * (rules §47/§49; ADR-009). It measures engineering throughput only. Timing is
 * machine-dependent and is never a pass/fail criterion (rules §51); this file
 * is local (`npm run bench`) and is deliberately outside `npm run check`.
 *
 * Methodology: operands come from the shared, memoized, deterministic
 * `allScenarios()`; the loopback channel is created once at collection time and
 * reused for every sample (exactly like a live worker). tinybench stops a case
 * once BOTH its `time` budget and its minimum `iterations` have elapsed, so the
 * full-record sizes collect few expensive samples while the small sizes collect
 * many cheap ones.
 */
import { bench, describe } from 'vitest';

import { MAIN_THREAD_DSP_EXECUTOR } from '../application/dspExecutor';
import {
    bindDspCore,
    DspWorkerCore,
    LatestOnlyDspClient,
    type WorkerClientTransport,
    type WorkerInboundMessage,
    type WorkerOutboundMessage,
    type WorkerPort,
} from '../workers';
import {
    allScenarios,
    BENCH_SAMPLE_RATE_HZ,
    type BenchScenario,
} from './scenarios';

/**
 * Per-size budget. One sample is one whole-record `decomposeSignal`, so the
 * larger sizes collect only a handful of samples (each is a tens-to-hundreds-
 * of-milliseconds operation).
 */
const WORKER_BENCH_TIMING: Readonly<
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
    const timing = WORKER_BENCH_TIMING[sizeSamples];
    if (timing === undefined) {
        throw new RangeError(
            `No worker benchmark budget declared for ${sizeSamples} samples.`,
        );
    }
    return timing;
}

/** Short, stable bench suffix describing the operand size. */
function sizeLabel(scenario: BenchScenario): string {
    return `${scenario.sizeSamples} samples (${scenario.label})`;
}

// ---------------------------------------------------------------------------
// Node loopback channel — the real glue, in one process.
//
// The request hop and the reply hop are each a `queueMicrotask`, which is all
// the in-process stand-in for two `postMessage` deliveries. No structured
// clone happens: the SAME object references cross the "port" (documented
// above). `bindDspCore` / `LatestOnlyDspClient` are the exact production
// binder and client — no orchestration is re-implemented here (rules §30).
// ---------------------------------------------------------------------------

interface LoopbackDspChannel {
    readonly client: LatestOnlyDspClient;
    /** Dispose the client and detach the binder (idempotent). */
    dispose(): void;
}

function createLoopbackDspChannel(): LoopbackDspChannel {
    // The worker half posts its replies to the main half through this single
    // slot, filled once the client exists (the real construction order). A
    // `const` holder keeps the binding immutable; only the slot is assigned.
    const relay: { toMain: (message: WorkerOutboundMessage) => void } = {
        toMain: () => {
            throw new Error('loopback channel posted before it was wired');
        },
    };
    const workerPort: WorkerPort = {
        onmessage: null,
        postMessage(message: WorkerOutboundMessage): void {
            queueMicrotask(() => relay.toMain(message));
        },
    };
    const transport: WorkerClientTransport = {
        postMessage(message: WorkerInboundMessage): void {
            // Same platform shape as a real worker: the event carries the
            // envelope on `data` (DEFECT-001, ADR-019).
            queueMicrotask(() => workerPort.onmessage?.({ data: message }));
        },
    };
    const client = new LatestOnlyDspClient(transport);
    relay.toMain = (message) => client.handleWorkerMessage(message);
    const detach = bindDspCore(workerPort, new DspWorkerCore());
    return {
        client,
        dispose(): void {
            client.dispose();
            detach();
        },
    };
}

// ---------------------------------------------------------------------------
// 1) Before — the main-thread executor (the Phase-9 baseline path).
// ---------------------------------------------------------------------------

describe('DSP/DWT stage — main-thread executor (before: inline, Phase-9 path)', () => {
    for (const scenario of allScenarios()) {
        bench(
            `main-thread DspExecutor.execute (db4 level ${scenario.dwtConfig.level}) — ${sizeLabel(scenario)}`,
            async () => {
                await MAIN_THREAD_DSP_EXECUTOR.execute(scenario.signal, {
                    dwt: scenario.dwtConfig,
                });
            },
            timingFor(scenario.sizeSamples),
        );
    }
});

// ---------------------------------------------------------------------------
// 2) After — the identical work relayed through the production worker glue in
//    a Node loopback (NOT a browser; a lower bound on real handoff cost).
// ---------------------------------------------------------------------------

describe(`DSP/DWT stage — Node loopback (bindDspCore ⇄ LatestOnlyDspClient) @ ${BENCH_SAMPLE_RATE_HZ} Hz — NOT a browser`, () => {
    const channel = createLoopbackDspChannel();
    for (const scenario of allScenarios()) {
        bench(
            `worker loopback request (db4 level ${scenario.dwtConfig.level}) — ${sizeLabel(scenario)}`,
            async () => {
                await channel.client.request(
                    scenario.signal.id,
                    scenario.signal,
                    scenario.dwtConfig,
                );
            },
            timingFor(scenario.sizeSamples),
        );
    }
});
