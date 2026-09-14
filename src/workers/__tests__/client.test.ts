/**
 * Latest-only inference client tests (Phase 6 / ADR-005; rules §31).
 *
 * The client keeps ONLY the latest pending request meaningful: issuing a newer
 * request rejects older in-flight requests as `request-superseded`, and a
 * completion for a superseded/unknown request is dropped so a slow "ECG A"
 * result can never resolve a newer "ECG B" request. Transport is an in-memory
 * fake implementing {@link InferenceClientTransport}.
 */

import { describe, expect, it } from 'vitest';
import { EcgError } from '../../domain/error';
import type { ModelPrediction } from '../../domain/ml';
import { LatestOnlyInferenceClient, type InferenceClientTransport } from '../client';
import type {
    InferenceError,
    InferenceRequest,
    InferenceResult,
} from '../types';
import { makeMetadata, makePrediction, makeRawInput } from '../../ml/__tests__/support';

const metadata = makeMetadata();
const input = makeRawInput(metadata);

class RecordingTransport implements InferenceClientTransport {
    readonly sent: InferenceRequest[] = [];

    // This client only ever issues inference requests, so the recorder narrows
    // the transport payload to InferenceRequest (valid under method bivariance).
    postMessage(message: InferenceRequest): void {
        this.sent.push(message);
    }
}

function setup(): { transport: RecordingTransport; client: LatestOnlyInferenceClient } {
    const transport = new RecordingTransport();
    return { transport, client: new LatestOnlyInferenceClient(transport) };
}

function resultOf(
    requestId: string,
    signalId: string,
    prediction: ModelPrediction,
): InferenceResult {
    return { kind: 'inference-result', requestId, signalId, prediction };
}

function failureOf(requestId: string, signalId: string): InferenceError {
    return {
        kind: 'inference-error',
        requestId,
        signalId,
        error: { code: 'inference-failure', message: 'worker failed' },
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

describe('LatestOnlyInferenceClient', () => {
    it('posts a request envelope that echoes identities and keeps the latest signal', () => {
        const { transport, client } = setup();
        void client.request('mitbih-cnn', '1.0.0', 'sig-A', input);

        expect(transport.sent).toHaveLength(1);
        const sent = transport.sent[0]!;
        expect(sent.kind).toBe('inference-request');
        expect(sent.requestId).toBe('inference-0');
        expect(sent.signalId).toBe('sig-A');
        expect(sent.modelId).toBe('mitbih-cnn');
        expect(sent.modelVersion).toBe('1.0.0');
        expect(sent.input).toBe(input);
        expect(client.currentSignalId()).toBe('sig-A');
    });

    it('mints monotonic ids and supersedes older in-flight requests', async () => {
        const { transport, client } = setup();
        const older = client.request('m', '1', 'sig-A', input);
        const newer = client.request('m', '1', 'sig-B', input);

        await rejectsCode(older, 'request-superseded');
        expect(transport.sent.map((message) => message.requestId)).toEqual([
            'inference-0',
            'inference-1',
        ]);
        expect(client.currentSignalId()).toBe('sig-B');

        const resolved = makePrediction(metadata);
        client.handleWorkerMessage(resultOf(transport.sent[1]!.requestId, 'sig-B', resolved));
        await expect(newer).resolves.toBe(resolved);
    });

    it('resolves the current request when its result arrives', async () => {
        const { transport, client } = setup();
        const pending = client.request('m', '1', 'sig-A', input);
        const prediction = makePrediction(metadata, {
            values: new Float64Array(metadata.output.classLabels.length).fill(0.25),
        });

        client.handleWorkerMessage(resultOf(transport.sent[0]!.requestId, 'sig-A', prediction));
        await expect(pending).resolves.toBe(prediction);
    });

    it('rejects when the worker reports a classified error', async () => {
        const { transport, client } = setup();
        const pending = client.request('m', '1', 'sig-A', input);

        client.handleWorkerMessage(failureOf(transport.sent[0]!.requestId, 'sig-A'));
        await rejectsCode(pending, 'inference-failure');
    });

    it('drops completions for unknown request ids without throwing', async () => {
        const { transport, client } = setup();
        const pending = client.request('m', '1', 'sig-A', input);

        const unknown = makePrediction(metadata);
        expect(() =>
            client.handleWorkerMessage(resultOf('inference-99', 'sig-A', unknown)),
        ).not.toThrow();
        expect(client.currentSignalId()).toBe('sig-A');

        const genuine = makePrediction(metadata, {
            values: new Float64Array(metadata.output.classLabels.length).fill(0.75),
        });
        client.handleWorkerMessage(resultOf(transport.sent[0]!.requestId, 'sig-A', genuine));
        await expect(pending).resolves.toBe(genuine);
    });

    it('lets a stale result for a superseded request never resolve the new one', async () => {
        const { transport, client } = setup();
        const firstPromise = client.request('m', '1', 'sig-A', input);
        const secondPromise = client.request('m', '1', 'sig-B', input);
        await rejectsCode(firstPromise, 'request-superseded');

        // A slow "ECG A" result arrives after "ECG B" was issued: it is dropped.
        const stale = makePrediction(metadata, {
            values: new Float64Array(metadata.output.classLabels.length).fill(0.1),
        });
        client.handleWorkerMessage(resultOf(transport.sent[0]!.requestId, 'sig-A', stale));

        const fresh = makePrediction(metadata, {
            values: new Float64Array(metadata.output.classLabels.length).fill(0.9),
        });
        client.handleWorkerMessage(resultOf(transport.sent[1]!.requestId, 'sig-B', fresh));
        await expect(secondPromise).resolves.toBe(fresh);
    });

    it('aborts pending requests on dispose and refuses new ones', async () => {
        const { client } = setup();
        const pending = client.request('m', '1', 'sig-A', input);
        expect(client.currentSignalId()).toBe('sig-A');

        client.dispose();
        await rejectsCode(pending, 'request-superseded');
        expect(client.currentSignalId()).toBeUndefined();
        throwsCode(() => client.request('m', '1', 'sig-C', input), 'inference-failure');
    });
});
