/**
 * Application orchestration tests (Phase 7 item #5 / architecture E.1–E.3).
 *
 * `analyzeRecord` is the single application workflow the views (#9/#10) and
 * `src/main.ts` (#8) will call, so this file pins the contract: the stage chain
 * (adapter → ADC→mV → optional declared filter → periodic DWT) yields a
 * coherent, domain-typed `AnalysisResult` whose `signal`, `decomposition` and
 * provenance agree with the *exact* options requested, is deterministic under
 * re-runs, and surfaces classified `EcgError`s loudly. A thin
 * `RecordAnalysisService` wrapper is asserted to delegate faithfully.
 *
 * All fixtures are hermetic (the synthetic adapter is deterministic), so every
 * assertion is reproducible without touching `data/` or any I/O.
 */
import { describe, expect, it } from 'vitest';

import { SYNTHETIC_DATASET_ID, SyntheticDatasetAdapter } from '../../datasets/synthetic/adapter';
import { EcgError } from '../../domain/error';
import type { DwtConfig } from '../../dsp/dwt';
import type { FilterSpec } from '../../dsp/filter';
import { analysisIdOf, analyzeRecord, RecordAnalysisService } from '../analysis';
import type { RecordAnalysisOptions } from '../analysis';

const WAVELET = 'db4';
const EXTENSION = 'periodic';
const DEFAULT_LEVEL = 4;
/** Default synthetic record: 360 Hz, 3600 samples, leads lead-a / lead-b. */
const RECORD_ID = 'sync';
const SOURCE_LENGTH = 3600;

function dwt(level: number): DwtConfig {
    return { waveletName: WAVELET, level, extensionMode: EXTENSION };
}

function defaultOptions(): RecordAnalysisOptions {
    return { recordId: RECORD_ID, dwt: dwt(DEFAULT_LEVEL) };
}

function makeAdapter(): SyntheticDatasetAdapter {
    return new SyntheticDatasetAdapter({ [RECORD_ID]: { recordId: RECORD_ID } });
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

function transformNames(signal: { provenance: { transforms: readonly { readonly name: string }[] } }): string[] {
    return signal.provenance.transforms.map((step) => step.name);
}

/** Concatenate every coefficient band of a channel's decomposition in order. */
function coefficientBuffersOf(channel: {
    approximate: Float64Array;
    detailLevels: readonly { readonly detail: Float64Array }[];
}): Float64Array[] {
    return [
        ...channel.detailLevels.map((band) => band.detail),
        channel.approximate,
    ];
}

describe('analysisIdOf', () => {
    const identity = { datasetId: SYNTHETIC_DATASET_ID, recordId: RECORD_ID };

    it('is deterministic and independent of wall-clock time', () => {
        const a = analysisIdOf(identity, defaultOptions());
        const b = analysisIdOf(identity, defaultOptions());
        expect(a).toBe(b);
        expect(a).toBe('synthetic/sync :: dwt-db4-level4-periodic');
    });

    it('names the declared preprocessing stage, in pipeline order', () => {
        const noFilter = analysisIdOf(identity, defaultOptions());
        const withFilter = analysisIdOf(identity, {
            recordId: RECORD_ID,
            filter: {
                type: 'lowpass',
                cutoffHz: 45,
                numTaps: 65,
                phaseCharacteristic: 'zero',
                purpose: 'test id naming',
            },
            dwt: dwt(DEFAULT_LEVEL),
        });
        expect(withFilter).toBe(
            'synthetic/sync :: filter-lowpass-45hz-zero :: dwt-db4-level4-periodic',
        );
        expect(withFilter).not.toBe(noFilter);
    });

    it('distinguishes different DWT configurations', () => {
        expect(analysisIdOf(identity, { recordId: RECORD_ID, dwt: dwt(3) })).not.toBe(
            analysisIdOf(identity, { recordId: RECORD_ID, dwt: dwt(DEFAULT_LEVEL) }),
        );
    });
});

describe('analyzeRecord (unfiltered pipeline)', () => {
    it('returns a coherent, frozen, domain-typed result for the default synthetic record', async () => {
        const result = await analyzeRecord(makeAdapter(), defaultOptions());

        // Identity / subject are taken from the adapter-served record untouched.
        expect(result.identity).toEqual({
            datasetId: SYNTHETIC_DATASET_ID,
            recordId: RECORD_ID,
        });
        expect(result.subjectId).toBe(RECORD_ID);
        expect(result.sourceRecord.identity).toEqual(result.identity);
        expect(result.sourceRecord.channels).toHaveLength(2);

        // The analyzed signal is the physical-unit (mV) signal, ADC→mV applied.
        expect(result.signal.id).toBe('synthetic/sync');
        expect(result.signal.sampling.sampleRateHz).toBe(360);
        expect(result.signal.channels.map((c) => c.name)).toEqual(['lead-a', 'lead-b']);
        expect(result.signal.channels.map((c) => c.unit)).toEqual(['mV', 'mV']);
        for (const channel of result.signal.channels) {
            expect(channel.data).toHaveLength(SOURCE_LENGTH);
        }
        // Exactly the audited calibration step — no hidden preprocessing.
        expect(transformNames(result.signal)).toEqual(['adc-to-millivolt']);

        // The decomposition describes exactly that signal.
        const decomposition = result.decomposition;
        expect(decomposition.signalId).toBe(result.signal.id);
        expect(decomposition.sampling.sampleRateHz).toBe(360);
        expect(decomposition.sourceLengthSamples).toBe(SOURCE_LENGTH);
        expect(decomposition.waveletName).toBe(WAVELET);
        expect(decomposition.level).toBe(DEFAULT_LEVEL);
        expect(decomposition.extensionMode).toBe(EXTENSION);
        expect(decomposition.channels.map((c) => c.channelName)).toEqual(['lead-a', 'lead-b']);

        // Level-J accounting: detail j has length n/2^j, the coarsest detail and
        // the scaling band both hold n/2^J = 225 samples.
        const first = decomposition.channels[0]!;
        expect(first.unit).toBe('mV');
        expect(first.detailLevels.map((band) => band.level)).toEqual([1, 2, 3, 4]);
        expect(first.detailLevels.map((band) => band.detail.length)).toEqual([
            1800, 900, 450, 225,
        ]);
        expect(first.approximate).toHaveLength(225);
        for (const band of first.detailLevels) {
            for (const value of band.detail) {
                expect(Number.isFinite(value)).toBe(true);
            }
        }

        // Stable id and a real ISO timestamp; the whole result is frozen.
        expect(result.analysisId).toBe('synthetic/sync :: dwt-db4-level4-periodic');
        expect(result.generatedAtIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(Number.isNaN(Date.parse(result.generatedAtIso))).toBe(false);
        expect(Object.isFrozen(result)).toBe(true);
    });
});

describe('analyzeRecord determinism', () => {
    it('produces identical ids and bit-identical coefficients across re-runs', async () => {
        const adapter = makeAdapter();
        const first = await analyzeRecord(adapter, defaultOptions());
        const second = await analyzeRecord(adapter, defaultOptions());

        expect(second.analysisId).toBe(first.analysisId);
        expect(second.signal.id).toBe(first.signal.id);

        for (let i = 0; i < first.signal.channels.length; i += 1) {
            expect(Array.from(second.signal.channels[i]!.data)).toEqual(
                Array.from(first.signal.channels[i]!.data),
            );
        }

        for (let i = 0; i < first.decomposition.channels.length; i += 1) {
            const buffersA = coefficientBuffersOf(first.decomposition.channels[i]!);
            const buffersB = coefficientBuffersOf(second.decomposition.channels[i]!);
            expect(buffersA.length).toBe(buffersB.length);
            for (let b = 0; b < buffersA.length; b += 1) {
                expect(Array.from(buffersB[b]!)).toEqual(Array.from(buffersA[b]!));
            }
        }
    });
});

describe('analyzeRecord (declared filter stage)', () => {
    const lowpass: FilterSpec = {
        type: 'lowpass',
        cutoffHz: 45,
        numTaps: 65,
        phaseCharacteristic: 'zero',
        purpose: 'test the explicit pre-DWT filter stage',
    };

    it('applies the declared filter between calibration and DWT and records it', async () => {
        const result = await analyzeRecord(makeAdapter(), {
            recordId: RECORD_ID,
            filter: lowpass,
            dwt: dwt(DEFAULT_LEVEL),
        });

        // The signal actually analyzed carries the filter transform in its id
        // and provenance, after the calibration step (pipeline order).
        expect(result.signal.id).toBe('synthetic/sync :: filter-lowpass-45hz-zero');
        expect(transformNames(result.signal)).toEqual([
            'adc-to-millivolt',
            'filter-lowpass-45hz-zero',
        ]);
        expect(result.analysisId).toBe(
            'synthetic/sync :: filter-lowpass-45hz-zero :: dwt-db4-level4-periodic',
        );

        // The filter preserves length / sample rate / unit and the DWT still
        // describes exactly the filtered signal.
        expect(result.signal.sampling.sampleRateHz).toBe(360);
        for (const channel of result.signal.channels) {
            expect(channel.data).toHaveLength(SOURCE_LENGTH);
            expect(channel.unit).toBe('mV');
        }
        expect(result.decomposition.signalId).toBe(result.signal.id);
        expect(result.decomposition.sourceLengthSamples).toBe(SOURCE_LENGTH);
        expect(result.decomposition.channels[0]!.approximate).toHaveLength(225);
    });
});

describe('analyzeRecord classified error propagation', () => {
    it('surfaces adapter file-not-found for an unknown record id', async () => {
        const code = await rejectedCode(
            analyzeRecord(makeAdapter(), { recordId: 'missing', dwt: dwt(DEFAULT_LEVEL) }),
        );
        expect(code).toBe('file-not-found');
    });

    it('rejects an over-deep DWT level with invalid-input', async () => {
        // Default length 3600 supports up to level 4 for db4 (8 taps).
        const code = await rejectedCode(
            analyzeRecord(makeAdapter(), { recordId: RECORD_ID, dwt: dwt(10) }),
        );
        expect(code).toBe('invalid-input');
    });

    it('rejects a filter whose cutoff is not strictly inside the Nyquist band', async () => {
        const invalidFilter: FilterSpec = {
            type: 'lowpass',
            cutoffHz: 180, // == fs/2 for the 360 Hz default; must be strictly inside
            numTaps: 65,
            phaseCharacteristic: 'zero',
            purpose: 'invalid cutoff must fail loudly',
        };
        const code = await rejectedCode(
            analyzeRecord(makeAdapter(), {
                recordId: RECORD_ID,
                filter: invalidFilter,
                dwt: dwt(DEFAULT_LEVEL),
            }),
        );
        expect(code).toBe('invalid-input');
    });
});

describe('RecordAnalysisService', () => {
    it('exposes dataset identity, record ids and delegates analyze faithfully', async () => {
        const adapter = makeAdapter();
        const service = new RecordAnalysisService(adapter);

        expect(service.datasetId).toBe(SYNTHETIC_DATASET_ID);
        await expect(service.listRecordIds()).resolves.toEqual([RECORD_ID]);

        const direct = await analyzeRecord(adapter, defaultOptions());
        const viaService = await service.analyze(defaultOptions());

        expect(viaService.analysisId).toBe(direct.analysisId);
        expect(viaService.signal.id).toBe(direct.signal.id);
        expect(viaService.decomposition.signalId).toBe(direct.decomposition.signalId);
        expect(viaService.identity).toEqual(direct.identity);
        expect(viaService.sourceRecord.identity).toEqual(direct.sourceRecord.identity);
    });
});
