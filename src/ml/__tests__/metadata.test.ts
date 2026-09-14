/**
 * ModelMetadata schema validator tests (Phase 6 / ADR-004).
 *
 * The validator is the load-time gate for externalized model metadata: it must
 * report every structural problem without throwing, aggregate them into a single
 * classified `model-loading-failure` on assert, and round-trip JSON faithfully.
 */

import { describe, expect, it } from 'vitest';
import { EcgError } from '../../domain/error';
import {
    assertValidModelMetadata,
    describeModelMetadataProblems,
    parseModelMetadataJson,
} from '../metadata';
import { makeMetadata } from './support';

/** A deeply-plain, JSON-shaped metadata record with one override applied. */
function rawRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const record = JSON.parse(JSON.stringify(makeMetadata())) as Record<string, unknown>;
    return { ...record, ...overrides };
}

function problemsOf(value: unknown): string {
    return describeModelMetadataProblems(value).join('\n');
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

describe('describeModelMetadataProblems', () => {
    it('accepts a well-formed metadata document without problems', () => {
        expect(describeModelMetadataProblems(makeMetadata())).toEqual([]);
    });

    it('flags non-object payloads', () => {
        expect(problemsOf(null)).toMatch(/ModelMetadata must be a JSON object/);
        expect(problemsOf([])).toMatch(/ModelMetadata must be a JSON object/);
        expect(problemsOf('metadata')).toMatch(/ModelMetadata must be a JSON object/);
    });

    it('requires identity fields to be non-empty strings', () => {
        expect(problemsOf(rawRecord({ modelId: '' }))).toMatch(
            /modelId must be a non-empty string/,
        );
        expect(problemsOf(rawRecord({ modelId: '   ' }))).toMatch(
            /modelId must be a non-empty string/,
        );
        expect(problemsOf(rawRecord({ modelVersion: '' }))).toMatch(
            /modelVersion must be a non-empty string/,
        );
        expect(problemsOf(rawRecord({ task: '' }))).toMatch(
            /task must be a non-empty string/,
        );
    });

    it('validates the optional expected sampling/channel/window fields', () => {
        expect(problemsOf(rawRecord({ expectedSamplingRateHz: 0 }))).toMatch(
            /expectedSamplingRateHz must be a finite number > 0/,
        );
        expect(problemsOf(rawRecord({ expectedSamplingRateHz: Number.NaN }))).toMatch(
            /expectedSamplingRateHz must be a finite number > 0/,
        );
        expect(problemsOf(rawRecord({ expectedChannels: 0 }))).toMatch(
            /expectedChannels must be a positive integer/,
        );
        expect(problemsOf(rawRecord({ expectedWindowSamples: 1.5 }))).toMatch(
            /expectedWindowSamples must be a positive integer/,
        );
    });

    it('reports every structural input problem', () => {
        expect(problemsOf(rawRecord({ input: 'window' }))).toMatch(/input must be an object/);
        expect(
            problemsOf(
                rawRecord({
                    input: { name: '', shape: [-1, 1, 512], dtype: 'float32', layout: 'nct' },
                }),
            ),
        ).toMatch(/input\.name must be a non-empty string/);
        expect(
            problemsOf(
                rawRecord({ input: { name: 'window', shape: [], dtype: 'float32', layout: 'nct' } }),
            ),
        ).toMatch(/input\.shape must be a non-empty array of dimensions/);
        expect(
            problemsOf(
                rawRecord({
                    input: { name: 'window', shape: [0, 1, 512], dtype: 'float32', layout: 'nct' },
                }),
            ),
        ).toMatch(/input\.shape\[0\] must be an integer/);
        expect(
            problemsOf(
                rawRecord({
                    input: { name: 'window', shape: [1.5, 1, 512], dtype: 'float32', layout: 'nct' },
                }),
            ),
        ).toMatch(/input\.shape\[0\] must be an integer/);
        expect(
            problemsOf(
                rawRecord({
                    input: {
                        name: 'window',
                        shape: [-1, 1, 512],
                        dtype: 'float16',
                        layout: 'nct',
                    },
                }),
            ),
        ).toMatch(/input\.dtype must be one of the supported tensor dtypes/);
        expect(
            problemsOf(
                rawRecord({
                    input: { name: 'window', shape: [-1, 1, 512], dtype: 'float32', layout: '' },
                }),
            ),
        ).toMatch(/input\.layout must be a non-empty documented layout token/);
    });

    it('reports every structural output problem', () => {
        expect(
            problemsOf(
                rawRecord({
                    output: {
                        name: 'classes',
                        dtype: 'float32',
                        semantics: 'ranking',
                        activation: 'softmax',
                        classLabels: ['N'],
                    },
                }),
            ),
        ).toMatch(/semantics must be 'logits', 'probabilities' or 'model-scores'/);
        expect(
            problemsOf(
                rawRecord({
                    output: {
                        name: 'classes',
                        dtype: 'float32',
                        semantics: 'logits',
                        activation: 'relu',
                        classLabels: ['N'],
                    },
                }),
            ),
        ).toMatch(/activation must be 'none', 'softmax' or 'sigmoid'/);
        expect(
            problemsOf(
                rawRecord({
                    output: {
                        name: 'classes',
                        dtype: 'float32',
                        semantics: 'logits',
                        activation: 'softmax',
                        classLabels: [],
                    },
                }),
            ),
        ).toMatch(/classLabels must be a non-empty array of ordered class labels/);
        expect(
            problemsOf(
                rawRecord({
                    output: {
                        name: 'classes',
                        dtype: 'float32',
                        semantics: 'logits',
                        activation: 'softmax',
                        classLabels: ['N', ''],
                    },
                }),
            ),
        ).toMatch(/classLabels\[1\] must be a non-empty string/);
    });

    it('reports structural problems in preprocessing assumptions and normalization', () => {
        expect(problemsOf(rawRecord({ preprocessingAssumptions: 'nope' }))).toMatch(
            /preprocessingAssumptions must be an array/,
        );
        expect(
            problemsOf(
                rawRecord({
                    preprocessingAssumptions: [
                        { stage: 'bandpass-0.5-40hz', config: { lowHz: 0.5 } },
                        { stage: '', config: {} },
                    ],
                }),
            ),
        ).toMatch(/preprocessingAssumptions\[1\]\.stage must be a non-empty string/);
        expect(problemsOf(rawRecord({ normalization: 'zscore' }))).toMatch(
            /normalization must be an object/,
        );
        expect(problemsOf(rawRecord({ normalization: { strategy: '' } }))).toMatch(
            /normalization\.strategy must be a non-empty string/,
        );
    });

    it('reports structural problems in provenance when present', () => {
        expect(problemsOf(rawRecord({ provenance: 'none' }))).toMatch(
            /provenance must be an object when present/,
        );
        expect(
            problemsOf(
                rawRecord({ provenance: { trainingDataset: 5, methodology: 'm', limitations: 'l' } }),
            ),
        ).toMatch(/provenance\.trainingDataset must be a non-empty string when present/);
    });
});

describe('assertValidModelMetadata', () => {
    it('does not throw for a valid metadata document', () => {
        expect(() => assertValidModelMetadata(makeMetadata())).not.toThrow();
    });

    it('throws a single classified model-loading-failure aggregating problems', () => {
        let caught: unknown;
        try {
            assertValidModelMetadata(rawRecord({ modelId: '', modelVersion: '' }));
        } catch (cause) {
            caught = cause;
        }
        expect(caught instanceof EcgError).toBe(true);
        if (caught instanceof EcgError) {
            expect(caught.code).toBe('model-loading-failure');
            const problems = caught.context.meta?.problems;
            expect(Array.isArray(problems)).toBe(true);
            expect((problems as unknown[]).length).toBeGreaterThan(0);
        }
    });
});

describe('parseModelMetadataJson', () => {
    it('round-trips a valid JSON metadata document', () => {
        const source = makeMetadata();
        const parsed = parseModelMetadataJson(JSON.stringify(source));
        expect(parsed.modelId).toBe(source.modelId);
        expect(parsed.modelVersion).toBe(source.modelVersion);
        expect(parsed.task).toBe(source.task);
        expect(parsed.expectedSamplingRateHz).toBe(360);
        expect(parsed.input).toEqual({
            name: 'window',
            shape: [-1, 1, 512],
            dtype: 'float32',
            layout: 'nct',
        });
        expect(parsed.output.classLabels).toEqual(['N', 'S', 'V', 'F', 'Q']);
        expect(parsed.normalization).toEqual({
            strategy: 'zscore',
            fittedFrom: 'mitbih-train',
        });
        expect(parsed.provenance.trainingDataset).toBe(source.provenance.trainingDataset);
    });

    it('defaults optional provenance and fittedFrom when absent', () => {
        const record = rawRecord();
        const normalization = record.normalization as Record<string, unknown>;
        delete normalization.fittedFrom;
        delete record.provenance;
        const parsed = parseModelMetadataJson(JSON.stringify(record));
        expect(parsed.normalization.fittedFrom).toBeUndefined();
        expect(parsed.provenance.trainingDataset).toBeUndefined();
        expect(describeModelMetadataProblems(parsed)).toEqual([]);
    });

    it('defaults a missing per-stage config to an empty object', () => {
        const record = rawRecord({ preprocessingAssumptions: [{ stage: 'segment-512' }] });
        const parsed = parseModelMetadataJson(JSON.stringify(record));
        expect(parsed.preprocessingAssumptions[0]?.config).toEqual({});
    });

    it('rejects text that is not valid JSON as model-loading-failure', () => {
        throwsCode(() => parseModelMetadataJson('{ not json'), 'model-loading-failure');
    });

    it('rejects valid JSON that fails the schema as model-loading-failure', () => {
        const record = rawRecord();
        delete record.modelId;
        throwsCode(() => parseModelMetadataJson(JSON.stringify(record)), 'model-loading-failure');
    });
});
