/**
 * Latest-only DSP client tests (Phase 10 / ADR-005, ADR-011; rules §30, §31).
 *
 * Mirror of `client.test.ts` for the DSP request kind: the client keeps ONLY the
 * latest pending request meaningful (issuing a newer one rejects older in-flight
 * requests as `request-superseded`; a completion for a superseded/unknown
 * request is dropped so a slow "ECG A" result can never resolve a newer "ECG B"
 * request). It also never lets an inference envelope complete a DSP request
 * (rules §30). Transport is an in-memory fake implementing
 * {@link WorkerClientTransport}.
 *
 * All fixtures are hermetic (deterministic synthetic adapter) — no I/O.
 */

import { describe, expect, it } from 'vitest';
import { EcgError } from '../../domain/error';
import type { ErrorCode } from '../../domain/error';
import type { Signal } from '../../domain/signal';
import { recordToMillivoltSignal } from '../../datasets/load';
import { generateSyntheticRecord } from '../../datasets/synthetic/adapter';
import { decomposeSignal } from '../../dsp/dwt';
import type { DwtConfig, WaveletDecomposition } from '../../dsp/dwt';
import type { FilterSpec } from '../../dsp/filter';
import { makeMetadata, makePrediction } from '../../ml/__tests__/support';
import { LatestOnlyDspClient, type DspExecution, type WorkerClientTransport } from '../client';
import type { DspError, DspRequest, DspResult, InferenceResult } from '../types';

const DWT: DwtConfig = { waveletName: 'db4', level: 4, extensionMode: 'periodic' };
const signal: Signal = recordToMillivoltSignal(generateSyntheticRecord({ recordId: 'sync' }));
const decomposition: WaveletDecomposition = decomposeSignal(signal, DWT);

const LOWPASS: FilterSpec = {
    type: 'lowpass',
    cutoffHz: 40,
    numTaps: 41,
    phaseCharacteristic: 'zero',
    purpose: 'dsp client test',
};

class RecordingTransport implements WorkerClientTransport {
    readonly sent: DspRequest[] = [];

    // This client only ever issues dsp requests, so the recorder narrows the
    // transport payload to DspRequest (valid under method bivariance).
    postMessage(message: DspRequest): void {
        this.sent.push(message);
    }
}

function setup(): { transport: RecordingTransport; client: LatestOnlyDspClient } {
    const transport = new RecordingTransport();
    return { transport, client: new LatestOnlyDspClient(transport) };
}

function execution(): DspExecution {
    return { signal, decomposition };
}

function resultOf(requestId: string, signalId: string, payload: DspExecution): DspResult {
    return {
        kind: 'dsp-result',
        requestId,
        signalId,
        signal: payload.signal,
        decomposition: payload.decomposition,
    };
}

function failureOf(
    requestId: string,
    signalId: string,
    code: ErrorCode = 'invalid-input',
): DspError {
    return {
        kind: 'dsp-error',
        requestId,
        signalId,
        error: { code, message: 'worker failed' },
    };
}

function throwsCode(fn: () => unknown, code: string): void {
    let caught: unknown;
    try {
        fn();
    } catch (cause) {
        caught = cause;
    }
    expect(caught instanceof EcgError).toBe(true);
    if (caught instanceof EcgError) {
        expect(caught.code).toBe(code);
    }
}

async function rejectsCode(promise: Promise<unknown>, code: string): Promise<void> {
    let caught: unknown;
    try {
        await promise;
    } catch (cause) {
        caught = cause;
    }
    expect(caught instanceof EcgError).toBe(true);
    if (caught instanceof EcgError) {
        expect(caught.code).toBe(code);
    }
}

describe('LatestOnlyDspClient', () => {
    it('posts a dsp-request envelope that echoes identities and keeps the latest signal', () => {
        const { transport, client } = setup();
        void client.request('sig-A', signal, DWT);

        expect(transport.sent).toHaveLength(1);
        const sent = transport.sent[0]!;
        expect(sent.kind).toBe('dsp-request');
        expect(sent.requestId).toBe('dsp-0');
        expect(sent.signalId).toBe('sig-A');
        expect(sent.signal).toBe(signal);
        expect(sent.dwt).toBe(DWT);
        expect(sent.filter).toBeUndefined();
        expect(client.currentSignalId()).toBe('sig-A');
    });

    it('carries an optional pre-filter unchanged when provided', () => {
        const { transport, client } = setup();
        void client.request('sig-A', signal, DWT, LOWPASS);

        expect(transport.sent[0]!.filter).toBe(LOWPASS);
    });

    it('mints monotonic ids and supersedes older in-flight requests', async () => {
        const { transport, client } = setup();
        const older = client.request('sig-A', signal, DWT);
        const newer = client.request('sig-B', signal, DWT);

        await rejectsCode(older, 'request-superseded');
        expect(transport.sent.map((message) => message.requestId)).toEqual(['dsp-0', 'dsp-1']);
        expect(client.currentSignalId()).toBe('sig-B');

        const resolved = execution();
        client.handleWorkerMessage(resultOf(transport.sent[1]!.requestId, 'sig-B', resolved));
        await expect(newer).resolves.toStrictEqual(resolved);
    });

    it('resolves the current request with the analyzed signal and decomposition', async () => {
        const { transport, client } = setup();
        const pending = client.request('sig-A', signal, DWT);
        const resolved = execution();

        client.handleWorkerMessage(resultOf(transport.sent[0]!.requestId, 'sig-A', resolved));
        await expect(pending).resolves.toStrictEqual(resolved);
    });

    it('rejects when the worker reports a classified error', async () => {
        const { transport, client } = setup();
        const pending = client.request('sig-A', signal, DWT);

        client.handleWorkerMessage(
            failureOf(transport.sent[0]!.requestId, 'sig-A', 'malformed-signal'),
        );
        await rejectsCode(pending, 'malformed-signal');
    });

    it('drops completions for unknown request ids without throwing', async () => {
        const { transport, client } = setup();
        const pending = client.request('sig-A', signal, DWT);

        expect(() =>
            client.handleWorkerMessage(resultOf('dsp-99', 'sig-A', execution())),
        ).not.toThrow();
        expect(client.currentSignalId()).toBe('sig-A');

        const genuine = execution();
        client.handleWorkerMessage(resultOf(transport.sent[0]!.requestId, 'sig-A', genuine));
        await expect(pending).resolves.toStrictEqual(genuine);
    });

    it('lets a stale result for a superseded request never resolve the new one', async () => {
        const { transport, client } = setup();
        const firstPromise = client.request('sig-A', signal, DWT);
        const secondPromise = client.request('sig-B', signal, DWT);
        await rejectsCode(firstPromise, 'request-superseded');

        // A slow "ECG A" result arrives after "ECG B" was issued: it is dropped.
        client.handleWorkerMessage(
            resultOf(transport.sent[0]!.requestId, 'sig-A', execution()),
        );

        const fresh = execution();
        client.handleWorkerMessage(resultOf(transport.sent[1]!.requestId, 'sig-B', fresh));
        await expect(secondPromise).resolves.toStrictEqual(fresh);
    });

    it('never lets an inference envelope complete a dsp request', async () => {
        const { transport, client } = setup();
        const pending = client.request('sig-A', signal, DWT);

        const metadata = makeMetadata();
        const inferenceEnvelope: InferenceResult = {
            kind: 'inference-result',
            // Same id on purpose: the kind guard must reject it regardless.
            requestId: transport.sent[0]!.requestId,
            signalId: 'sig-A',
            prediction: makePrediction(metadata),
        };
        client.handleWorkerMessage(inferenceEnvelope);

        const genuine = execution();
        client.handleWorkerMessage(resultOf(transport.sent[0]!.requestId, 'sig-A', genuine));
        await expect(pending).resolves.toStrictEqual(genuine);
    });

    it('aborts pending requests on dispose and refuses new ones', async () => {
        const { client } = setup();
        const pending = client.request('sig-A', signal, DWT);
        expect(client.currentSignalId()).toBe('sig-A');

        client.dispose();
        await rejectsCode(pending, 'request-superseded');
        expect(client.currentSignalId()).toBeUndefined();
        throwsCode(() => client.request('sig-C', signal, DWT), 'dsp-failure');
    });
});
