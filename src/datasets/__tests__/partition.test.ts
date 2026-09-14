/**
 * Subject-aware partition tests (Phase 5 / ADR-006, architecture §L).
 *
 * Partitioning must be deterministic (no RNG), leak-free (no subject in more
 * than one role), and record-consistent (every recording of a subject follows
 * that subject into exactly one role).
 */
import { describe, expect, it } from 'vitest';

import { EcgError } from '../../domain/error';
import {
    assertNoSubjectLeakage,
    assertValidPartitionSpec,
    DEFAULT_PARTITION_SPEC,
    describePartitionLeakage,
    partitionRecords,
    partitionSubjects,
    PARTITION_ROLES,
    subjectOfRecord,
    type RoleSubjectMap,
} from '../partition';

function errorCodeOf(fn: () => unknown): string | undefined {
    try {
        fn();
    } catch (error) {
        if (error instanceof EcgError) {
            return error.code;
        }
    }
    return undefined;
}

function allSubjects(map: RoleSubjectMap): string[] {
    const out: string[] = [];
    for (const role of PARTITION_ROLES) {
        out.push(...map[role]);
    }
    return out;
}

function roleCounts(map: RoleSubjectMap): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const role of PARTITION_ROLES) {
        counts[role] = map[role].length;
    }
    return counts;
}

describe('partitionSubjects', () => {
    const subjects = Array.from({ length: 20 }, (_, i) => `p${i}`);

    it('is deterministic: identical inputs give identical splits', () => {
        const first = partitionSubjects(subjects);
        const second = partitionSubjects(subjects);
        expect(first).toEqual(second);
    });

    it('assigns every subject exactly once across the three roles', () => {
        const map = partitionSubjects(subjects);
        const assigned = allSubjects(map);
        expect([...assigned].sort()).toEqual([...subjects].sort());
        expect(new Set(assigned).size).toBe(subjects.length);
    });

    it('keeps the default spec at 70/15/15', () => {
        expect(DEFAULT_PARTITION_SPEC).toEqual({
            train: 0.7,
            validation: 0.15,
            test: 0.15,
        });
    });

    it('fills every role for a sufficiently large subject set', () => {
        const map = partitionSubjects(
            Array.from({ length: 8 }, (_, i) => `s${i}`),
        );
        const counts = roleCounts(map);
        expect(counts.train).toBeGreaterThan(0);
        expect(counts.validation).toBeGreaterThan(0);
        expect(counts.test).toBeGreaterThan(0);
    });

    it('rejects invalid specs with invalid-input', () => {
        expect(
            errorCodeOf(() => partitionSubjects(subjects, {
                train: 0.5,
                validation: 0.5,
                test: 0.2,
            })),
        ).toBe('invalid-input');
        expect(
            errorCodeOf(() => partitionSubjects(subjects, {
                train: -0.1,
                validation: 0.6,
                test: 0.5,
            })),
        ).toBe('invalid-input');
        expect(
            errorCodeOf(() =>
                assertValidPartitionSpec({
                    train: Number.NaN,
                    validation: 0.5,
                    test: 0.5,
                }),
            ),
        ).toBe('invalid-input');
    });
});

describe('partitionRecords', () => {
    const refs = [
        { recordId: 'r1', subjectId: 's1' },
        { recordId: 'r2', subjectId: 's1' }, // Same subject as r1.
        { recordId: 'r3', subjectId: 's2' },
        { recordId: 'r4', subjectId: 's3' },
        { recordId: 'r5', subjectId: 's4' },
        { recordId: 'r6', subjectId: 's5' },
        { recordId: 'r7', subjectId: 's6' },
        { recordId: 'r8', subjectId: 's7' },
    ];

    it('keeps every recording of one subject in the same role', () => {
        const result = partitionRecords(refs);
        const subjectRoles = partitionSubjects(refs.map((ref) => ref.subjectId));
        const roleOf = (subjectId: string) =>
            PARTITION_ROLES.find((role) =>
                subjectRoles[role].includes(subjectId),
            ) ?? 'test';

        const roleOfS1 = roleOf('s1');
        const recordsOfS1 = result.records[roleOfS1];

        // Records of the same subject (s1 owns r1 and r2) always travel together.
        expect(recordsOfS1).toContain('r1');
        expect(recordsOfS1).toContain('r2');

        // A subject in a different role never leaks into s1's role: with the
        // default 70/15/15 split over seven sorted subjects, s1 falls in the
        // leading (train) bucket while the trailing subject s7 always closes the
        // interval in `test`, so the two roles are guaranteed distinct here.
        expect(roleOf('s7')).not.toBe(roleOfS1);
        expect(recordsOfS1).not.toContain('r8'); // r8 belongs to s7
    });

    it('partitions every record exactly once and reports role -> subjects', () => {
        const result = partitionRecords(refs);
        const assigned = [...result.records.train, ...result.records.validation, ...result.records.test];
        expect([...assigned].sort()).toEqual(
            refs.map((ref) => ref.recordId).sort(),
        );
        expect(result.subjects).toEqual(
            partitionSubjects(refs.map((ref) => ref.subjectId)),
        );
    });

    it('is deterministic across calls', () => {
        expect(partitionRecords(refs)).toEqual(partitionRecords(refs));
    });
});

describe('leakage guards', () => {
    it('reports no problems for a clean role map', () => {
        const clean: RoleSubjectMap = {
            train: ['a', 'b'],
            validation: ['c'],
            test: ['d'],
        };
        expect(describePartitionLeakage(clean)).toEqual([]);
        expect(() => assertNoSubjectLeakage(clean)).not.toThrow();
    });

    it('reports duplicates within a role and subjects spanning roles', () => {
        const leaky: RoleSubjectMap = {
            train: ['a', 'b', 'a'],
            validation: ['b', 'c'],
            test: ['d', 'c'],
        };
        const problems = describePartitionLeakage(leaky);
        expect(problems.some((problem) => problem.includes('duplicate subject'))).toBe(
            true,
        );
        expect(
            problems.some((problem) => problem.includes('appears in both')),
        ).toBe(true);
        expect(errorCodeOf(() => assertNoSubjectLeakage(leaky))).toBe('invalid-input');
    });
});

describe('subjectOfRecord', () => {
    it('returns the owning subject of a record reference', () => {
        expect(subjectOfRecord({ recordId: 'r1', subjectId: 's7' })).toBe('s7');
    });
});
