/**
 * Worker-backed DSP parity gate (Phase 10, item 4; ADR-005, ADR-011).
 *
 * The whole point of the offload is *relocation, not optimization*: the
 * main-thread path and the worker path must produce byte-identical
 * `AnalysisResult`s. This Node test wires a real `LatestOnlyDspClient` to a real
 * `DspWorkerCore` through an in-memory loopback port (no browser), runs the same
 * analysis both ways and compares every produced double's raw bytes.
 *
 * It also pins the latest-only contract end-to-end: when two analyses race, the
 * superseded run rejects as `request-superseded` rather than resolving a stale
 * result (rules §31).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SyntheticDatasetAdapter } from '../../datasets/synthetic/adapter';
import { EcgError } from '../../domain/error';
import type { DwtConfig } from '../../dsp/dwt';
import type { FilterSpec } from '../../dsp/filter';
import { bindDspCore, DspWorkerCore, LatestOnlyDspClient } from '../../workers';
import type { WorkerClientTransport, WorkerPort } from '../../workers';
import { analyzeRecord, RecordAnalysisService } from '../analysis';
import type { AnalysisResult, RecordAnalysisOptions } from '../analysis';
import { MainThreadDspExecutor, WorkerDspExecutor } from '../dspExecutor';

const RECORD_ID = 'sync';
const DWT: DwtConfig = { waveletName: 'db4', level: 4, extensionMode: 'periodic' };
const LOWPASS: FilterSpec = {
    type: 'lowpass',
    cutoffHz: 45,
    numTaps: 65,
    phaseCharacteristic: 'zero',
    purpose: 'worker parity gate',
};

function makeAdapter(): SyntheticDatasetAdapter {
    return new SyntheticDatasetAdapter({ [RECORD_ID]: { recordId: RECORD_ID } });
}

function unfiltered(): RecordAnalysisOptions {
    return { recordId: RECORD_ID, dwt: DWT };
}

function filtered(): RecordAnalysisOptions {
    return { recordId: RECORD_ID, filter: LOWPASS, dwt: DWT };
}

/**
 * Wire a real `LatestOnlyDspClient` to a real `DspWorkerCore` through an
 * in-memory loopback port: the transport hands main-thread messages to the
 * binder's `onmessage` in the platform's own shape (an event carrying the
 * envelope on `data`), and the core's posted envelopes straight back to the
 * client — exactly the browser data flow, minus the browser.
 */
function workerBackedExecutor(): WorkerDspExecutor {
    let client: LatestOnlyDspClient | null = null;
    const port: WorkerPort = {
        onmessage: null,
        postMessage: (message): void => {
            client?.handleWorkerMessage(message);
        },
    };
    const transport: WorkerClientTransport = {
        postMessage: (message): void => {
            // The platform hands the binder an event, not the bare envelope.
            port.onmessage?.({ data: message });
        },
    };
    bindDspCore(port, new DspWorkerCore());
    client = new LatestOnlyDspClient(transport);
    return new WorkerDspExecutor(client);
}

/** Raw bytes of a double buffer (the strongest "byte-identical" comparison). */
function bytesOf(view: Float64Array): number[] {
    return Array.from(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
}

/** Every coefficient band of a channel, in canonical order (details then approx). */
function coefficientBuffersOf(channel: {
    approximate: Float64Array;
    detailLevels: readonly { readonly detail: Float64Array }[];
}): Float64Array[] {
    return [...channel.detailLevels.map((band) => band.detail), channel.approximate];
}

function expectByteIdentical(worker: AnalysisResult, main: AnalysisResult): void {
    expect(worker.identity).toStrictEqual(main.identity);
    expect(worker.subjectId).toBe(main.subjectId);
    expect(worker.analysisId).toBe(main.analysisId);
    expect(worker.generatedAtIso).toBe(main.generatedAtIso);
    expect(worker.sourceRecord.identity).toStrictEqual(main.sourceRecord.identity);

    expect(worker.signal.id).toBe(main.signal.id);
    expect(worker.signal.provenance).toStrictEqual(main.signal.provenance);
    expect(worker.signal.channels.map((channel) => channel.name)).toEqual(
        main.signal.channels.map((channel) => channel.name),
    );
    worker.signal.channels.forEach((channel, index) => {
        const other = main.signal.channels[index]!;
        expect(channel.unit).toBe(other.unit);
        expect(bytesOf(channel.data)).toEqual(bytesOf(other.data));
    });

    expect(worker.decomposition.signalId).toBe(main.decomposition.signalId);
    expect(worker.decomposition.waveletName).toBe(main.decomposition.waveletName);
    expect(worker.decomposition.level).toBe(main.decomposition.level);
    expect(worker.decomposition.extensionMode).toBe(main.decomposition.extensionMode);
    expect(worker.decomposition.sourceLengthSamples).toBe(main.decomposition.sourceLengthSamples);
    worker.decomposition.channels.forEach((channel, index) => {
        const other = main.decomposition.channels[index]!;
        expect(channel.channelName).toBe(other.channelName);
        expect(channel.unit).toBe(other.unit);
        expect(channel.detailLevels.map((band) => band.level)).toEqual(
            other.detailLevels.map((band) => band.level),
        );
        const bandsA = coefficientBuffersOf(channel);
        const bandsB = coefficientBuffersOf(other);
        expect(bandsA.length).toBe(bandsB.length);
        bandsA.forEach((buffer, band) => {
            expect(bytesOf(buffer)).toEqual(bytesOf(bandsB[band]!));
        });
    });
}

/** Resolve the classified error code of a rejection (undefined if not EcgError). */
async function rejectedCode(promise: Promise<unknown>): Promise<string | undefined> {
    try {
        await promise;
    } catch (error) {
        if (error instanceof EcgError) {
            return error.code;
        }
    }
    return undefined;
}

describe('worker DSP parity (in-memory loopback → real DspWorkerCore)', () => {
    beforeEach(() => {
        // A fixed clock makes `generatedAtIso` comparable between both paths.
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-13T00:00:00.000Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('unfiltered: the worker path is byte-identical to the main-thread path', async () => {
        const adapter = makeAdapter();
        const main = await analyzeRecord(adapter, unfiltered(), new MainThreadDspExecutor());
        const worker = await analyzeRecord(adapter, unfiltered(), workerBackedExecutor());
        expectByteIdentical(worker, main);
    });

    it('filtered: the worker path is byte-identical to the main-thread path', async () => {
        const adapter = makeAdapter();
        const main = await analyzeRecord(adapter, filtered(), new MainThreadDspExecutor());
        const worker = await analyzeRecord(adapter, filtered(), workerBackedExecutor());
        expectByteIdentical(worker, main);
    });

    it('resolves through the worker-backed service like the inline service', async () => {
        const adapter = makeAdapter();
        const service = new RecordAnalysisService(adapter, workerBackedExecutor());
        const result = await service.analyze(unfiltered());
        expect(result.analysisId).toBe('synthetic/sync :: dwt-db4-level4-periodic');
        expect(result.signal.id).toBe('synthetic/sync');
    });

    it('rejects the superseded run as request-superseded when two analyses race', async () => {
        const adapter = makeAdapter();
        const service = new RecordAnalysisService(adapter, workerBackedExecutor());

        const first = service.analyze(unfiltered());
        const second = service.analyze(unfiltered());
        first.catch(() => undefined); // handled explicitly below

        expect(await rejectedCode(first)).toBe('request-superseded');
        await expect(second).resolves.toBeDefined();
    });
});
