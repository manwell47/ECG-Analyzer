/**
 * Worker core ⇄ port binder tests (Phase 10 item 1 / ADR-005, ADR-011).
 *
 * `bindDspCore` / `bindInferenceCore` are pure dispatch: guard the inbound
 * envelope kind, delegate to the matching core's `handle`, post the returned
 * envelope. These tests drive them through an in-memory {@link WorkerPort} (no
 * real `Worker`), proving:
 *
 *  - a bound DSP core answers a `dsp-request` with a `dsp-result` bit-identical
 *    to a direct shared-module call, and a classified `dsp-error` on failure;
 *  - a bound inference core answers a registered `inference-request` with an
 *    `inference-result` and an unregistered one with a classified
 *    `inference-error`;
 *  - the two binders are mutually exclusive (each ignores the other's kind and
 *    any unknown message), so no science crosses request kinds (rules §30);
 *  - the delivery contract is the platform's, not the fake's: a binder is driven
 *    by an event whose `data` carries the envelope, and a bare payload, a
 *    foreign `data` or a missing one is discarded (ADR-019, DEFECT-001);
 *  - the returned disposer detaches the handler.
 *
 * All fixtures are hermetic (deterministic synthetic adapter) — no I/O.
 */

import { describe, expect, it } from 'vitest';

import { recordToMillivoltSignal } from '../../datasets/load';
import { generateSyntheticRecord } from '../../datasets/synthetic/adapter';
import { decomposeSignal } from '../../dsp/dwt';
import type { DwtConfig, WaveletDecomposition } from '../../dsp/dwt';
import { makeMetadata, makeRawInput } from '../../ml/__tests__/support';
import { createStubEngine } from '../../ml/testing/stub';
import { bindDspCore, bindInferenceCore } from '../bind';
import { DspWorkerCore, InferenceWorkerCore } from '../core';
import type { WorkerPort } from '../port';
import { isDspError, isDspResult, isInferenceError, isInferenceResult } from '../types';
import type { DspRequest, InferenceRequest, WorkerOutboundMessage } from '../types';

const WAVELET = 'db4';
const EXTENSION = 'periodic';
/** Default synthetic record: 360 Hz, 3600 samples. */
const RECORD_ID = 'sync';

function dwt(level: number): DwtConfig {
    return { waveletName: WAVELET, level, extensionMode: EXTENSION };
}

interface PortHarness {
    readonly port: WorkerPort;
    readonly sent: WorkerOutboundMessage[];
    /**
     * Deliver one payload the way the platform would: the binder's handler is
     * invoked with an event carrying the payload on `data`, never with the bare
     * payload itself (DEFECT-001, ADR-019).
     */
    receive(message: unknown): void;
}

/**
 * Wrap an inbound envelope the way the platform does — an event whose `data`
 * holds the envelope. Modelling this is what keeps the fake honest: a
 * payload-shaped fake silently defines a contract no real worker honours
 * (DEFECT-001, ADR-019).
 */
function deliver(data: unknown): { readonly data: unknown } {
    return { data };
}

/** One worker-side end of an in-memory channel that records every posted envelope. */
function harness(): PortHarness {
    const sent: WorkerOutboundMessage[] = [];
    const port: WorkerPort = {
        onmessage: null,
        postMessage(message: WorkerOutboundMessage): void {
            sent.push(message);
        },
    };
    return {
        port,
        sent,
        receive: (message: unknown): void => {
            port.onmessage?.(deliver(message));
        },
    };
}

/** Let the async `handle(...).then(post)` chain drain before asserting. */
function flush(): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
}

function dspRequest(level: number): DspRequest {
    const signal = recordToMillivoltSignal(generateSyntheticRecord({ recordId: RECORD_ID }));
    return {
        kind: 'dsp-request',
        requestId: 'req-dsp-1',
        signalId: 'sig-dsp-1',
        signal,
        dwt: dwt(level),
    };
}

function inferenceRequest(modelId: string, modelVersion: string): InferenceRequest {
    const metadata = makeMetadata({ modelId, modelVersion });
    return {
        kind: 'inference-request',
        requestId: 'req-inf-1',
        signalId: 'sig-inf-1',
        modelId,
        modelVersion,
        input: makeRawInput(metadata),
    };
}

/** Every coefficient band of every channel, finest detail first, then approximate. */
function bandsOf(decomposition: WaveletDecomposition): Float64Array[][] {
    return decomposition.channels.map((channel) => [
        ...channel.detailLevels.map((band) => band.detail),
        channel.approximate,
    ]);
}

describe('bindDspCore', () => {
    it('answers a dsp-request with a dsp-result bit-identical to a direct call', async () => {
        const { port, sent, receive } = harness();
        bindDspCore(port, new DspWorkerCore());

        const request = dspRequest(4);
        receive(request);
        await flush();

        expect(sent).toHaveLength(1);
        const envelope = sent[0]!;
        expect(isDspResult(envelope)).toBe(true);
        if (!isDspResult(envelope)) {
            return;
        }
        expect(envelope.requestId).toBe(request.requestId);
        expect(envelope.signalId).toBe(request.signalId);

        const expected = decomposeSignal(request.signal, request.dwt);
        expect(envelope.decomposition.signalId).toBe(expected.signalId);
        expect(envelope.signal.id).toBe(expected.signalId);

        const actualBands = bandsOf(envelope.decomposition);
        const expectedBands = bandsOf(expected);
        actualBands.forEach((channelBands, index) => {
            channelBands.forEach((band, bandIndex) => {
                expect(Array.from(band)).toEqual(Array.from(expectedBands[index]![bandIndex]!));
            });
        });
    });

    it('answers a failing dsp-request with a classified dsp-error', async () => {
        const { port, sent, receive } = harness();
        bindDspCore(port, new DspWorkerCore());

        // Level 10 is too deep for the 3600-sample default record.
        const request = dspRequest(10);
        receive(request);
        await flush();

        const envelope = sent[0]!;
        expect(isDspError(envelope)).toBe(true);
        if (!isDspError(envelope)) {
            return;
        }
        expect(envelope.requestId).toBe(request.requestId);
        expect(envelope.signalId).toBe(request.signalId);
        expect(envelope.error.code).toBe('invalid-input');
    });

    it('ignores inference-requests and unknown messages', async () => {
        const { port, sent, receive } = harness();
        bindDspCore(port, new DspWorkerCore());

        receive(inferenceRequest('m', '1.0.0'));
        receive({ kind: 'something-else' });
        receive(null);
        await flush();

        expect(sent).toHaveLength(0);
    });

    it('detaches the handler through the returned disposer', async () => {
        const { port, sent, receive } = harness();
        const dispose = bindDspCore(port, new DspWorkerCore());

        dispose();
        expect(port.onmessage).toBeNull();

        receive(dspRequest(4));
        await flush();
        expect(sent).toHaveLength(0);
    });
});

describe('bindInferenceCore', () => {
    it('answers a registered inference-request with an inference-result', async () => {
        const { port, sent, receive } = harness();
        const core = new InferenceWorkerCore();
        const metadata = makeMetadata();
        core.register(metadata.modelId, metadata.modelVersion, {
            metadata,
            engine: createStubEngine(),
        });
        bindInferenceCore(port, core);

        const request = inferenceRequest(metadata.modelId, metadata.modelVersion);
        receive(request);
        await flush();

        const envelope = sent[0]!;
        expect(isInferenceResult(envelope)).toBe(true);
        if (!isInferenceResult(envelope)) {
            return;
        }
        expect(envelope.requestId).toBe(request.requestId);
        expect(envelope.signalId).toBe(request.signalId);
        expect(envelope.prediction.modelId).toBe(metadata.modelId);
    });

    it('answers an unregistered inference-request with a classified inference-error', async () => {
        const { port, sent, receive } = harness();
        bindInferenceCore(port, new InferenceWorkerCore());

        const request = inferenceRequest('missing', '1.0.0');
        receive(request);
        await flush();

        const envelope = sent[0]!;
        expect(isInferenceError(envelope)).toBe(true);
        if (!isInferenceError(envelope)) {
            return;
        }
        expect(envelope.requestId).toBe(request.requestId);
        expect(envelope.signalId).toBe(request.signalId);
        expect(envelope.error.code).toBe('model-loading-failure');
    });

    it('ignores dsp-requests and unknown messages', async () => {
        const { port, sent, receive } = harness();
        bindInferenceCore(port, new InferenceWorkerCore());

        receive(dspRequest(4));
        receive({ kind: 'something-else' });
        await flush();

        expect(sent).toHaveLength(0);
    });
});

describe('worker-side delivery contract (ADR-019, DEFECT-001)', () => {
    it('answers a platform-shaped dsp-request with one dsp-result identical to a direct call', async () => {
        const { port, sent } = harness();
        bindDspCore(port, new DspWorkerCore());

        const request = dspRequest(4);
        // Spelled out here rather than routed through the harness: this case
        // pins the platform's delivery shape itself, so no helper can quietly
        // reinterpret it (DEFECT-001).
        port.onmessage?.({ data: request });
        await flush();

        expect(sent).toHaveLength(1);
        const envelope = sent[0]!;
        expect(isDspResult(envelope)).toBe(true);
        if (!isDspResult(envelope)) {
            return;
        }
        expect(envelope.requestId).toBe(request.requestId);
        expect(envelope.signalId).toBe(request.signalId);

        const expected = decomposeSignal(request.signal, request.dwt);
        const actualBands = bandsOf(envelope.decomposition);
        const expectedBands = bandsOf(expected);
        expect(actualBands).toHaveLength(expectedBands.length);
        actualBands.forEach((channelBands, index) => {
            channelBands.forEach((band, bandIndex) => {
                expect(Array.from(band)).toEqual(Array.from(expectedBands[index]![bandIndex]!));
            });
        });
    });

    it('answers a platform-shaped inference-request with an inference-result', async () => {
        const { port, sent } = harness();
        const core = new InferenceWorkerCore();
        const metadata = makeMetadata();
        core.register(metadata.modelId, metadata.modelVersion, {
            metadata,
            engine: createStubEngine(),
        });
        bindInferenceCore(port, core);

        const request = inferenceRequest(metadata.modelId, metadata.modelVersion);
        port.onmessage?.({ data: request });
        await flush();

        expect(sent).toHaveLength(1);
        const envelope = sent[0]!;
        expect(isInferenceResult(envelope)).toBe(true);
        if (!isInferenceResult(envelope)) {
            return;
        }
        expect(envelope.requestId).toBe(request.requestId);
        expect(envelope.prediction.modelId).toBe(metadata.modelId);
    });

    it('discards a foreign kind, an unknown payload and a missing data field', async () => {
        const dsp = harness();
        const inference = harness();
        bindDspCore(dsp.port, new DspWorkerCore());
        bindInferenceCore(inference.port, new InferenceWorkerCore());

        // An event that carries no `data` at all cannot occur through the
        // platform, but a foreign sender or a malformed post can reach the
        // handler, so the cast models that and the binder must stay silent.
        const withoutData = {} as { readonly data: unknown };
        const events = [
            deliver(dspRequest(4).kind),
            deliver({ kind: 'something-else' }),
            deliver(null),
            deliver('not-an-envelope'),
            withoutData,
        ];
        events.forEach((event) => {
            dsp.port.onmessage?.(event);
            inference.port.onmessage?.(event);
        });
        await flush();

        expect(dsp.sent).toHaveLength(0);
        expect(inference.sent).toHaveLength(0);

        // Silence above must mean "discarded", never "detached": both binders
        // still answer the next well-formed request.
        dsp.receive(dspRequest(4));
        inference.receive(inferenceRequest('missing', '1.0.0'));
        await flush();

        expect(dsp.sent).toHaveLength(1);
        expect(inference.sent).toHaveLength(1);
        expect(isDspResult(dsp.sent[0]!)).toBe(true);
        expect(isInferenceError(inference.sent[0]!)).toBe(true);
    });

    it('installs a handler that takes the platform event, not the payload', () => {
        const { port } = harness();
        const dispose = bindDspCore(port, new DspWorkerCore());

        expect(port.onmessage).toBeTypeOf('function');
        // Compile-time gate (ADR-019): the installed handler's parameter is the
        // platform event, so handing it the bare payload is a type error. If
        // `WorkerPort.onmessage` ever regresses to the payload shape, this
        // `@ts-expect-error` becomes unused and `tsc` fails the gate — exactly
        // the regression that shipped DEFECT-001 past 750 green tests. The call
        // is inert at run time either way, since the guard reads `event.data`.
        // @ts-expect-error a bare payload is not the platform delivery shape.
        port.onmessage?.(dspRequest(1));

        // One assertion of the shared contract suffices: both binders take the
        // same `WorkerPort`.
        dispose();
        expect(port.onmessage).toBeNull();
    });
});
