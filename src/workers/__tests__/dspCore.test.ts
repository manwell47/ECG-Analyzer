/**
 * Worker-side DSP/DWT core tests (Phase 7 item #6 / ADR-005).
 *
 * `DspWorkerCore` is a thin shell: it validates the payload, applies the
 * optional pre-filter and decomposes by delegating to the shared `src/dsp` /
 * `src/domain` modules — it must contain NO duplicated scientific logic (rules
 * §30). These tests therefore prove the worker results are bit-identical to
 * direct calls of the shared modules, and that the requestId/signalId identity
 * echo is preserved on both result and error envelopes:
 *
 *  - the envelope `signalId` echoes the request tag unchanged;
 *  - when an optional filter runs, `decomposition.signalId` / `result.signal.id`
 *    carry the precise post-filter `filter-*` identity instead.
 *
 * All fixtures are hermetic (deterministic synthetic adapter), so every
 * assertion is reproducible without I/O.
 */

import { describe, expect, it } from 'vitest';

import { recordToMillivoltSignal } from '../../datasets/load';
import { generateSyntheticRecord } from '../../datasets/synthetic/adapter';
import { decomposeSignal } from '../../dsp/dwt';
import type {
    DwtChannelDecomposition,
    DwtConfig,
    WaveletDecomposition,
} from '../../dsp/dwt';
import { filterSignal } from '../../dsp/filter';
import type { FilterSpec } from '../../dsp/filter';
import type { Signal } from '../../domain/signal';
import { DspWorkerCore } from '../core';
import {
    isDspError,
    isDspRequest,
    isDspResult,
    isInferenceError,
    isInferenceRequest,
    isInferenceResult,
} from '../types';
import type { DspRequest } from '../types';

const REQUEST_ID = 'req-1';
const WAVELET = 'db4';
const EXTENSION = 'periodic';
const LEVEL = 4;
/** Default synthetic record: 360 Hz, 3600 samples, leads lead-a / lead-b. */
const RECORD_ID = 'sync';
const FS = 360;
const SOURCE_LENGTH = 3600;
/** db4 periodic level-4 detail lengths over 3600 samples. */
const DETAIL_LENGTHS = [1800, 900, 450, 225];
const APPROXIMATE_LENGTH = 225;

function dwt(level: number): DwtConfig {
    return { waveletName: WAVELET, level, extensionMode: EXTENSION };
}

/** A deterministic mV-calibrated Signal: id `synthetic/sync`, fs 360. */
function millivoltSignal(): Signal {
    const record = generateSyntheticRecord({ recordId: RECORD_ID });
    return recordToMillivoltSignal(record);
}

function makeRequest(
    signal: Readonly<Signal>,
    config: DwtConfig,
    filter?: FilterSpec,
): DspRequest {
    return filter === undefined
        ? {
            kind: 'dsp-request',
            requestId: REQUEST_ID,
            signalId: signal.id,
            signal,
            dwt: config,
        }
        : {
            kind: 'dsp-request',
            requestId: REQUEST_ID,
            signalId: signal.id,
            signal,
            filter,
            dwt: config,
        };
}

function lowpassCutoff(cutoffHz: number): FilterSpec {
    return {
        type: 'lowpass',
        cutoffHz,
        numTaps: 65,
        phaseCharacteristic: 'zero',
        purpose: 'Test pre-filter through the DSP worker core.',
    };
}

function transformNames(signal: Readonly<Signal>): string[] {
    return signal.provenance.transforms.map((step) => step.name);
}

function detailLengths(channel: DwtChannelDecomposition): number[] {
    return channel.detailLevels.map((band) => band.detail.length);
}

/** Every coefficient band of a channel, finest detail first, then approximate. */
function bandsOf(channel: DwtChannelDecomposition): Float64Array[] {
    return [...channel.detailLevels.map((band) => band.detail), channel.approximate];
}

/** The worker output must be bit-identical to a direct shared-module call. */
function expectSameDecomposition(
    actual: WaveletDecomposition,
    expected: WaveletDecomposition,
): void {
    expect(actual.signalId).toBe(expected.signalId);
    expect(actual.signalProvenance).toEqual(expected.signalProvenance);
    expect(actual.sampling).toEqual(expected.sampling);
    expect(actual.sourceLengthSamples).toBe(expected.sourceLengthSamples);
    expect(actual.waveletName).toBe(expected.waveletName);
    expect(actual.level).toBe(expected.level);
    expect(actual.extensionMode).toBe(expected.extensionMode);
    expect(actual.channels.length).toBe(expected.channels.length);

    actual.channels.forEach((channel, index) => {
        const other = expected.channels[index]!;
        expect(channel.channelName).toBe(other.channelName);
        expect(channel.unit).toBe(other.unit);
        const actualBands = bandsOf(channel);
        const expectedBands = bandsOf(other);
        expect(actualBands.length).toBe(expectedBands.length);
        actualBands.forEach((band, bandIndex) => {
            expect(Array.from(band)).toEqual(Array.from(expectedBands[bandIndex]!));
        });
    });
}

describe('DspWorkerCore', () => {
    it('decomposes an unfiltered signal and echoes the request identity', async () => {
        const signal = millivoltSignal();
        const core = new DspWorkerCore();
        const config = dwt(LEVEL);

        const envelope = await core.handle(makeRequest(signal, config));
        expect(envelope.kind).toBe('dsp-result');
        if (envelope.kind !== 'dsp-result') {
            return;
        }

        expect(envelope.requestId).toBe(REQUEST_ID);
        expect(envelope.signalId).toBe('synthetic/sync');

        // Unfiltered: the analyzed signal is the request signal itself.
        expect(envelope.signal.id).toBe('synthetic/sync');
        expect(transformNames(envelope.signal)).toEqual(['adc-to-millivolt']);

        const { decomposition } = envelope;
        expect(decomposition.signalId).toBe('synthetic/sync');
        expect(decomposition.sampling.sampleRateHz).toBe(FS);
        expect(decomposition.sourceLengthSamples).toBe(SOURCE_LENGTH);
        expect(decomposition.waveletName).toBe(WAVELET);
        expect(decomposition.level).toBe(LEVEL);
        expect(decomposition.extensionMode).toBe(EXTENSION);
        expect(decomposition.channels.map((channel) => channel.channelName)).toEqual([
            'lead-a',
            'lead-b',
        ]);
        for (const channel of decomposition.channels) {
            expect(channel.unit).toBe('mV');
            expect(channel.detailLevels.map((band) => band.level)).toEqual([1, 2, 3, 4]);
            expect(detailLengths(channel)).toEqual(DETAIL_LENGTHS);
            expect(channel.approximate.length).toBe(APPROXIMATE_LENGTH);
        }

        // The worker delegates to the shared decomposeSignal: bit-identical to a
        // direct call, so no scientific logic is duplicated in the worker.
        expectSameDecomposition(decomposition, decomposeSignal(signal, config));
    });

    it('applies an optional filter and echoes the original signalId unchanged', async () => {
        const signal = millivoltSignal();
        const core = new DspWorkerCore();
        const config = dwt(LEVEL);
        const filter = lowpassCutoff(45);

        const envelope = await core.handle(makeRequest(signal, config, filter));
        expect(envelope.kind).toBe('dsp-result');
        if (envelope.kind !== 'dsp-result') {
            return;
        }

        // The envelope signalId echoes the request tag (pre-filter identity)...
        expect(envelope.requestId).toBe(REQUEST_ID);
        expect(envelope.signalId).toBe('synthetic/sync');

        // ...while the analyzed signal and decomposition carry the precise
        // post-filter identity.
        const filteredId = 'synthetic/sync :: filter-lowpass-45hz-zero';
        expect(envelope.signal.id).toBe(filteredId);
        expect(transformNames(envelope.signal)).toEqual([
            'adc-to-millivolt',
            'filter-lowpass-45hz-zero',
        ]);
        expect(envelope.decomposition.signalId).toBe(filteredId);
        expect(detailLengths(envelope.decomposition.channels[0]!)).toEqual(
            DETAIL_LENGTHS,
        );

        // Bit-identical to the direct shared-module pipeline (filter then DWT).
        const filtered = filterSignal(signal, filter);
        expectSameDecomposition(
            envelope.decomposition,
            decomposeSignal(filtered, config),
        );
    });

    it('returns a classified dsp-error for an over-deep decomposition level', async () => {
        const signal = millivoltSignal();
        const core = new DspWorkerCore();

        const envelope = await core.handle(makeRequest(signal, dwt(10)));
        expect(envelope.kind).toBe('dsp-error');
        if (envelope.kind !== 'dsp-error') {
            return;
        }

        expect(envelope.requestId).toBe(REQUEST_ID);
        expect(envelope.signalId).toBe(signal.id);
        expect(envelope.error.code).toBe('invalid-input');
    });

    it('returns a classified dsp-error for a filter cutoff at Nyquist', async () => {
        const signal = millivoltSignal();
        const core = new DspWorkerCore();

        // fs/2 = 180 Hz for the 360 Hz synthetic record; cutoffs must be < fs/2.
        const envelope = await core.handle(
            makeRequest(signal, dwt(LEVEL), lowpassCutoff(FS / 2)),
        );
        expect(envelope.kind).toBe('dsp-error');
        if (envelope.kind !== 'dsp-error') {
            return;
        }

        expect(envelope.requestId).toBe(REQUEST_ID);
        expect(envelope.signalId).toBe(signal.id);
        expect(envelope.error.code).toBe('invalid-input');
    });

    it('returns a classified dsp-error for a structurally invalid payload', async () => {
        const signal = millivoltSignal();
        const core = new DspWorkerCore();
        const badSignal: Signal = {
            ...signal,
            sampling: { ...signal.sampling, sampleRateHz: 0 },
        };

        const envelope = await core.handle(makeRequest(badSignal, dwt(LEVEL)));
        expect(envelope.kind).toBe('dsp-error');
        if (envelope.kind !== 'dsp-error') {
            return;
        }

        expect(envelope.requestId).toBe(REQUEST_ID);
        expect(envelope.signalId).toBe(signal.id);
        expect(envelope.error.code).toBe('malformed-signal');
    });

    it('keeps envelope guards mutually exclusive across request kinds', () => {
        const signal = millivoltSignal();
        const request = makeRequest(signal, dwt(LEVEL));

        expect(isDspRequest(request)).toBe(true);
        expect(isInferenceRequest(request)).toBe(false);
        expect(isDspResult({ kind: 'dsp-result' })).toBe(true);
        expect(isInferenceResult({ kind: 'dsp-result' })).toBe(false);
        expect(isDspError({ kind: 'dsp-error' })).toBe(true);
        expect(isInferenceError({ kind: 'dsp-error' })).toBe(false);
        expect(isDspRequest({ kind: 'inference-request' })).toBe(false);
    });
});
