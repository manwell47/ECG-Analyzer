/**
 * Experiment configuration tests (Phase 8 / ADR-007, ADR-009).
 *
 * An `ExperimentConfiguration` captures everything to re-run one evaluation:
 * dataset, record selection (explicit or subject-partition + role), channel,
 * optional preprocessing, windowing, and the committed model + ground-truth
 * rule. These tests pin structural validation, the deterministic id, and the
 * subject-aware selection helpers (rules §20/§21).
 */
import { describe, expect, it } from 'vitest';
import { EcgError } from '../../domain/error';
import { DEFAULT_PARTITION_SPEC } from '../../datasets/partition';
import type { RecordSubjectRef } from '../../datasets/partition';
import {
    assertValidExperimentConfiguration,
    describeExperimentConfigurationProblems,
    experimentIdOf,
    resolveSelectedRecordIds,
    selectPartitionRecords,
    subjectRefsForSelfSubjects,
    type ExperimentConfiguration,
} from '../experiment';

const WINDOW_360_DROP = Object.freeze({
    windowLengthSamples: 360,
    strideSamples: 360,
    remainderPolicy: 'drop' as const,
});

const MODEL = Object.freeze({
    modelId: 'ecg-lab-probe-linear-mean-2',
    modelVersion: '1.0.0',
});

const LABELER = Object.freeze({
    id: 'sign-of-window-sum',
    description:
        'Ground truth = sign of the window sum; development seam-validation rule, ' +
        'not a clinical ground truth.',
});

function configFor(overrides: Partial<ExperimentConfiguration> = {}): ExperimentConfiguration {
    return {
        datasetId: 'synthetic',
        selection: { kind: 'records', recordIds: ['sync'] },
        channelName: 'lead-b',
        window: WINDOW_360_DROP,
        model: MODEL,
        evaluation: LABELER,
        ...overrides,
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

describe('configuration validation', () => {
    it('accepts a well-formed explicit-records configuration', () => {
        expect(describeExperimentConfigurationProblems(configFor())).toEqual([]);
        expect(() => assertValidExperimentConfiguration(configFor())).not.toThrow();
    });

    it('accepts a well-formed subject-partition configuration', () => {
        const config = configFor({
            selection: {
                kind: 'subject-partition',
                partition: { ...DEFAULT_PARTITION_SPEC },
                role: 'test',
            },
        });
        expect(describeExperimentConfigurationProblems(config)).toEqual([]);
    });

    it('flags missing identity fields, empty selections and empty labels', () => {
        // Note: role "train" with a valid partition spec is *not* a structural
        // problem here — a subject-partition role is only checked against the
        // subject set at selection time. The genuinely bad role is below.
        const cases: ExperimentConfiguration[] = [
            configFor({ datasetId: '' }),
            configFor({ channelName: '' }),
            configFor({ selection: { kind: 'records', recordIds: [] } }),
            configFor({ model: { modelId: '', modelVersion: '1.0.0' } }),
            configFor({ evaluation: { id: '', description: 'x' } }),
        ];
        const badRole = configFor({
            selection: {
                kind: 'subject-partition',
                partition: { ...DEFAULT_PARTITION_SPEC },
                role: 'deploy' as never,
            },
        });

        for (const config of cases) {
            expect(describeExperimentConfigurationProblems(config).length).toBeGreaterThan(0);
        }
        expect(describeExperimentConfigurationProblems(badRole).length).toBeGreaterThan(0);
    });

    it('flags a partition whose fractions do not sum to one', () => {
        const config = configFor({
            selection: {
                kind: 'subject-partition',
                partition: { train: 0.9, validation: 0.2, test: 0.1 },
                role: 'test',
            },
        });
        expect(describeExperimentConfigurationProblems(config).length).toBeGreaterThan(0);
    });

    it('flags an invalid window and an unknown selection kind', () => {
        const badWindow = configFor({
            window: {
                windowLengthSamples: 0,
                strideSamples: 360.5,
                remainderPolicy: 'truncate' as never,
            },
        });
        expect(describeExperimentConfigurationProblems(badWindow).length).toBeGreaterThan(0);

        const badSelection = configFor({ selection: { kind: 'shuffle' } as never });
        expect(describeExperimentConfigurationProblems(badSelection).length).toBeGreaterThan(0);
    });

    it('throws invalid-input through the assert for a bad configuration', () => {
        throwsCode(() => assertValidExperimentConfiguration(configFor({ channelName: '' })), 'invalid-input');
    });
});

describe('experimentIdOf', () => {
    it('is deterministic and independent of wall-clock time', () => {
        const first = experimentIdOf(configFor());
        const second = experimentIdOf(configFor());
        expect(second).toBe(first);
    });

    it('distinguishes dataset, channel, window, model and selection', () => {
        const base = experimentIdOf(configFor());
        const expectations = [
            configFor({ datasetId: 'mit-bih-arrhythmia' }),
            configFor({ channelName: 'lead-a' }),
            configFor({ window: { ...WINDOW_360_DROP, strideSamples: 180 } }),
            configFor({ model: { ...MODEL, modelVersion: '2.0.0' } }),
        ];
        for (const config of expectations) {
            expect(experimentIdOf(config)).not.toBe(base);
        }
    });

    it('distinguishes the subject-partition role in the id', () => {
        const partition = { ...DEFAULT_PARTITION_SPEC };
        const testConfig = configFor({
            selection: { kind: 'subject-partition', partition, role: 'test' },
        });
        const trainConfig = configFor({
            selection: { kind: 'subject-partition', partition, role: 'train' },
        });
        expect(experimentIdOf(testConfig)).not.toBe(experimentIdOf(trainConfig));
    });

    it('names a declared filter stage when one is present', () => {
        const unfiltered = experimentIdOf(configFor());
        const filtered = experimentIdOf(
            configFor({
                preprocessing: {
                    filter: {
                        type: 'lowpass',
                        cutoffHz: 45,
                        numTaps: 65,
                        phaseCharacteristic: 'zero',
                        purpose: 'Seam-test declared filter (not part of the probe run).',
                    },
                },
            }),
        );
        expect(filtered).not.toBe(unfiltered);
        expect(filtered).toContain('filter:');
    });
});

describe('subject-aware selection helpers', () => {
    const refs: readonly RecordSubjectRef[] = Object.freeze(
        ['r0', 'r1', 'r2', 'r3', 'r4'].map((recordId) =>
            Object.freeze({ recordId, subjectId: recordId }),
        ),
    );

    it('assigns whole subjects deterministically and returns the requested role', () => {
        const selection = {
            kind: 'subject-partition' as const,
            partition: { ...DEFAULT_PARTITION_SPEC },
            role: 'test' as const,
        };
        const { recordIds, roleSubjects } = selectPartitionRecords(refs, selection);
        expect(recordIds.length).toBeGreaterThan(0);
        expect(recordIds).toEqual(roleSubjects.test);
        // No subject appears in more than one role (the guard already threw otherwise).
        const allRoles = [
            ...roleSubjects.train,
            ...roleSubjects.validation,
            ...roleSubjects.test,
        ];
        expect(new Set(allRoles).size).toBe(allRoles.length);
    });

    it('throws invalid-input when the requested role selects no records', () => {
        const oneRef: readonly RecordSubjectRef[] = [
            Object.freeze({ recordId: 'only', subjectId: 'only' }),
        ];
        throwsCode(
            () =>
                selectPartitionRecords(oneRef, {
                    kind: 'subject-partition',
                    partition: { ...DEFAULT_PARTITION_SPEC },
                    role: 'train',
                }),
            'invalid-input',
        );
    });

    it('lands a single subject in the test role (partition edge)', () => {
        const oneRef: readonly RecordSubjectRef[] = [
            Object.freeze({ recordId: 'only', subjectId: 'only' }),
        ];
        const { recordIds, roleSubjects } = selectPartitionRecords(oneRef, {
            kind: 'subject-partition',
            partition: { ...DEFAULT_PARTITION_SPEC },
            role: 'test',
        });
        expect(recordIds).toEqual(['only']);
        expect(roleSubjects.test).toEqual(['only']);
    });

    it('resolveSelectedRecordIds honours an explicit records selection', () => {
        const config = configFor({
            selection: { kind: 'records', recordIds: ['sync'] },
        });
        const resolved = resolveSelectedRecordIds(config, refs);
        expect(resolved.recordIds).toEqual(['sync']);
        expect(resolved.roleSubjects).toBeUndefined();
    });

    it('resolveSelectedRecordIds resolves a subject-partition selection', () => {
        const config = configFor({
            selection: {
                kind: 'subject-partition',
                partition: { ...DEFAULT_PARTITION_SPEC },
                role: 'test',
            },
        });
        const resolved = resolveSelectedRecordIds(config, refs);
        expect(resolved.roleSubjects).toBeDefined();
        expect(resolved.recordIds.length).toBeGreaterThan(0);
    });

    it('subjectRefsForSelfSubjects maps each record id to itself as subject', () => {
        const refsBuilt = subjectRefsForSelfSubjects(['sync', 'other']);
        expect(refsBuilt).toEqual([
            { recordId: 'sync', subjectId: 'sync' },
            { recordId: 'other', subjectId: 'other' },
        ]);
    });
});
