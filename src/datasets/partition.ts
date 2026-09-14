/**
 * Subject-aware dataset partitioning (Phase 5 / ADR-006, architecture §L).
 *
 * Machine-learning splits for ECG data must never leak a subject across roles:
 * contiguous heartbeats of one patient are near-duplicates, so a naive random
 * split on *recordings* lets a model memorise a subject rather than learn to
 * generalise. This module therefore partitions by *subject*:
 *
 * - `partitionSubjects` deterministically assigns whole subjects to
 *   train/validation/test (sorted ids bucketed by the requested fractions —
 *   no RNG, so a given subject list always yields the same split);
 * - `partitionRecords` maps a record list onto those subject roles;
 * - `describePartitionLeakage` / `assertNoSubjectLeakage` are explicit guards
 *   for downstream code that builds role sets independently.
 *
 * The MIT-BIH Arrhythmia Database stores one subject per record, so its
 * `subjectId` equals the `recordId` (see `MitBihDatasetAdapter`).
 */
import { EcgError } from '../domain/error';
import type { RecordId, SubjectId } from '../domain/record';

/** A dataset split role. */
export type PartitionRole = 'train' | 'validation' | 'test';

export const PARTITION_ROLES: readonly PartitionRole[] = [
    'train',
    'validation',
    'test',
] as const;

/** Fraction (0..1, sum ~ 1) of *subjects* assigned to each role. */
export interface PartitionSpec {
    readonly train: number;
    readonly validation: number;
    readonly test: number;
}

/** Conventional 70/15/15 subject split. */
export const DEFAULT_PARTITION_SPEC: Readonly<PartitionSpec> = Object.freeze({
    train: 0.7,
    validation: 0.15,
    test: 0.15,
});

/** Subjects grouped by role (each list sorted, no subject repeated across roles). */
export type RoleSubjectMap = Readonly<Record<PartitionRole, readonly SubjectId[]>>;

/** A record reference used to place a recording under its owning subject. */
export interface RecordSubjectRef {
    readonly recordId: RecordId;
    readonly subjectId: SubjectId;
}

/** Result of subject-aware partitioning of a record set. */
export interface PartitionedRecords {
    /** Role -> record ids whose subject was assigned to that role (sorted). */
    readonly records: Readonly<Record<PartitionRole, readonly RecordId[]>>;
    /** Role -> subject ids (sorted). */
    readonly subjects: RoleSubjectMap;
}

export function assertValidPartitionSpec(spec: Readonly<PartitionSpec>): void {
    for (const [role, fraction] of Object.entries(spec) as [PartitionRole, number][]) {
        if (!Number.isFinite(fraction) || fraction < 0) {
            throw EcgError.invalidInput(
                `Partition fraction for "${role}" must be a finite number >= 0, ` +
                `received ${String(fraction)}.`,
            );
        }
    }
    const total = spec.train + spec.validation + spec.test;
    if (Math.abs(total - 1) > 1e-9) {
        throw EcgError.invalidInput(
            `Partition fractions must sum to 1, received ${spec.train} + ` +
            `${spec.validation} + ${spec.test} = ${total}.`,
        );
    }
}

function cumulativeCutoffs(spec: Readonly<PartitionSpec>): [number, number] {
    return [spec.train, spec.train + spec.validation];
}

/**
 * Deterministically assign whole subjects to roles. Subjects are sorted so the
 * mapping is a pure function of the input set (no RNG); the requested fractions
 * are honoured approximately for small subject counts.
 */
export function partitionSubjects(
    subjects: readonly SubjectId[],
    spec: Readonly<PartitionSpec> = DEFAULT_PARTITION_SPEC,
): RoleSubjectMap {
    assertValidPartitionSpec(spec);
    const sorted = [...new Set(subjects)].sort();
    const [trainCut, validationCut] = cumulativeCutoffs(spec);
    const roles: Record<PartitionRole, SubjectId[]> = {
        train: [],
        validation: [],
        test: [],
    };
    sorted.forEach((subjectId, rank) => {
        const position = sorted.length === 1 ? 0 : rank / (sorted.length - 1);
        // Bucket by the fraction each subject spans. The final subject closes
        // the interval at exactly 1.
        const atEnd = rank === sorted.length - 1;
        let role: PartitionRole;
        if (!atEnd && position < trainCut) {
            role = 'train';
        } else if (!atEnd && position < validationCut) {
            role = 'validation';
        } else {
            role = 'test';
        }
        roles[role].push(subjectId);
    });
    return Object.freeze({
        train: Object.freeze(roles.train),
        validation: Object.freeze(roles.validation),
        test: Object.freeze(roles.test),
    });
}

/** Partition records by their owning subject; whole subjects never split. */
export function partitionRecords(
    refs: readonly RecordSubjectRef[],
    spec: Readonly<PartitionSpec> = DEFAULT_PARTITION_SPEC,
): PartitionedRecords {
    const subjects = refs.map((ref) => ref.subjectId);
    const subjectRoles = partitionSubjects(subjects, spec);

    const roleOf = new Map<SubjectId, PartitionRole>();
    for (const role of PARTITION_ROLES) {
        for (const subjectId of subjectRoles[role]) {
            roleOf.set(subjectId, role);
        }
    }

    const byRole: Record<PartitionRole, RecordId[]> = {
        train: [],
        validation: [],
        test: [],
    };
    for (const ref of refs) {
        const role = roleOf.get(ref.subjectId);
        if (role === undefined) {
            throw EcgError.invalidInput(
                `Subject ${ref.subjectId} (record ${ref.recordId}) was not assigned a role.`,
            );
        }
        byRole[role].push(ref.recordId);
    }
    const sortUnique = (ids: RecordId[]): readonly RecordId[] =>
        Object.freeze([...new Set(ids)].sort());

    return {
        records: Object.freeze({
            train: sortUnique(byRole.train),
            validation: sortUnique(byRole.validation),
            test: sortUnique(byRole.test),
        }),
        subjects: subjectRoles,
    };
}

/** Return problems when any subject appears in more than one role. */
export function describePartitionLeakage(
    roleSubjects: RoleSubjectMap,
): readonly string[] {
    const problems: string[] = [];
    const seenAcross: Map<SubjectId, PartitionRole> = new Map();
    for (const role of PARTITION_ROLES) {
        const subjectIds = roleSubjects[role];
        const unique = new Set(subjectIds);
        if (unique.size !== subjectIds.length) {
            problems.push(`duplicate subject id within role "${role}".`);
        }
        for (const subjectId of subjectIds) {
            const previousRole = seenAcross.get(subjectId);
            if (previousRole !== undefined && previousRole !== role) {
                problems.push(
                    `subject "${subjectId}" appears in both "${previousRole}" and "${role}".`,
                );
            }
            seenAcross.set(subjectId, role);
        }
    }
    return problems;
}

/** Throw `invalid-input` if any subject spans more than one role. */
export function assertNoSubjectLeakage(roleSubjects: RoleSubjectMap): void {
    const problems = describePartitionLeakage(roleSubjects);
    if (problems.length > 0) {
        throw EcgError.invalidInput(
            'Subject-aware partition is leaking subjects across roles.',
            { detail: problems.join(' '), meta: { problems: [...problems] } },
        );
    }
}

/**
 * Subject identity used for partitioning. For MIT-BIH each record is one
 * subject, so this returns the record's declared `subjectId` (which the adapter
 * sets equal to the `recordId`).
 */
export function subjectOfRecord(ref: {
    readonly recordId: RecordId;
    readonly subjectId: SubjectId;
}): SubjectId {
    return ref.subjectId;
}
