/**
 * Experiment configuration (Phase 8 / ADR-007, architecture §L, ADR-009).
 *
 * An `ExperimentConfiguration` captures *everything needed to re-run one
 * evaluation* — dataset, how records are selected (explicit ids, or a
 * subject-aware partition + role), which channel to window, the (optional)
 * declared preprocessing, the windowing, and which committed model + ground
 * truth rule the evaluation consumes. It deliberately bundles DSP types
 * (`WindowConfig`, optional `FilterSpec`), so — like `RecordAnalysisOptions`
 * — it lives in `src/application/`, not `domain/` (ADR-002 forbids the domain
 * importing DSP; ADR-009 records the placement).
 *
 * Selection is a first-class field so an experiment can declare that it is a
 * *subject-partitioned* evaluation (`selection.kind === 'subject-partition'`):
 * whole subjects are assigned to roles deterministically (no RNG) and
 * `assertNoSubjectLeakage` guards the outcome, per rules §21 and §20 — a model
 * may only ever be evaluated on a role it never trained on.
 *
 * The module is pure and framework-free. It contains no science of its own:
 * the authoritative numeric checks still run in `dsp/` and `ml/` at execution
 * time; `describeExperimentConfigurationProblems` is a pre-flight + JSON-boundary
 * guard so a misconfigured or hand-edited snapshot fails early and loudly.
 */
import { EcgError } from '../domain/error';
import type { DatasetId, RecordId, SubjectId } from '../domain/record';
import type { FilterSpec } from '../dsp/filter';
import { filterTransformName } from '../dsp/filter';
import type { WindowConfig } from '../dsp/segment';
import {
    PARTITION_ROLES,
    assertNoSubjectLeakage,
    assertValidPartitionSpec,
    partitionRecords,
    type PartitionRole,
    type PartitionSpec,
    type PartitionedRecords,
    type RecordSubjectRef,
    type RoleSubjectMap,
} from '../datasets/partition';

/** An explicit list of records to evaluate (no implicit partition). */
export interface RecordsSelection {
    readonly kind: 'records';
    readonly recordIds: readonly RecordId[];
}

/** Evaluate the records whose subject was assigned to one partition role. */
export interface SubjectPartitionSelection {
    readonly kind: 'subject-partition';
    readonly partition: PartitionSpec;
    readonly role: PartitionRole;
}

export type ExperimentSelection = RecordsSelection | SubjectPartitionSelection;

/** The committed model artifact an experiment consumes (id + version). */
export interface ExperimentModelRef {
    readonly modelId: string;
    readonly modelVersion: string;
}

/**
 * Ground-truth rule an evaluation scores the model against. `id` is a stable,
 * machine-readable name recorded in every exported result; `description` states
 * exactly what the rule is (and, for the probe seam, that it is *not* a
 * clinical ground truth).
 */
export interface ExperimentLabelerRef {
    readonly id: string;
    readonly description: string;
}

/** Optional preprocessing applied after ADC→mV and before windowing. */
export interface ExperimentPreprocessing {
    /** Omit for an identity pipeline (the probe expects raw windows). */
    readonly filter?: FilterSpec;
}

/**
 * A complete, re-runnable experiment. `experimentId` is *derived* from this
 * object (see {@link experimentIdOf}), never stored redundantly, so a result's
 * id always matches its configuration snapshot.
 */
export interface ExperimentConfiguration {
    readonly datasetId: DatasetId;
    /** Which records to evaluate (explicit or a subject-partition + role). */
    readonly selection: ExperimentSelection;
    /** Name of the single channel whose windows are evaluated. */
    readonly channelName: string;
    /** Omit (or an empty object) for an identity pipeline. */
    readonly preprocessing?: ExperimentPreprocessing;
    /** Deterministic windowing applied to the selected channel. */
    readonly window: WindowConfig;
    readonly model: ExperimentModelRef;
    readonly evaluation: ExperimentLabelerRef;
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

function validWindowConfig(
    value: Readonly<WindowConfig>,
    problems: string[],
): void {
    const windowLengthSamples = value?.windowLengthSamples;
    if (!Number.isSafeInteger(windowLengthSamples) || windowLengthSamples <= 0) {
        problems.push(
            `window.windowLengthSamples must be a positive safe integer, received ` +
            `${String(windowLengthSamples)}.`,
        );
    }
    const strideSamples = value?.strideSamples;
    if (!Number.isSafeInteger(strideSamples) || strideSamples <= 0) {
        problems.push(
            `window.strideSamples must be a positive safe integer, received ` +
            `${String(strideSamples)}.`,
        );
    }
    const policy = value?.remainderPolicy;
    if (policy !== 'drop' && policy !== 'pad-zero' && policy !== 'error') {
        problems.push(
            `window.remainderPolicy must be "drop", "pad-zero" or "error", ` +
            `received ${JSON.stringify(policy)}.`,
        );
    }
}

/**
 * Structural problems with an `ExperimentConfiguration`, or `[]` when it is
 * well formed. Checks are the pre-flight/JSON-boundary guard; the authoritative
 * numeric DSP checks still run at execution time.
 */
export function describeExperimentConfigurationProblems(
    config: Readonly<ExperimentConfiguration>,
): readonly string[] {
    const problems: string[] = [];

    if (!isNonEmptyString(config?.datasetId)) {
        problems.push('datasetId must be a non-empty string.');
    }
    if (!isNonEmptyString(config?.channelName)) {
        problems.push('channelName must be a non-empty string.');
    }

    const selection = config?.selection;
    if (selection?.kind === 'records') {
        const recordIds = selection.recordIds;
        if (!Array.isArray(recordIds) || recordIds.length === 0) {
            problems.push('selection.recordIds must list at least one record id.');
        } else {
            recordIds.forEach((recordId, index) => {
                if (!isNonEmptyString(recordId)) {
                    problems.push(
                        `selection.recordIds[${index}] must be a non-empty string.`,
                    );
                }
            });
        }
    } else if (selection?.kind === 'subject-partition') {
        if (!(PARTITION_ROLES as readonly string[]).includes(selection.role)) {
            problems.push(
                `selection.role "${String(selection.role)}" is not a partition role.`,
            );
        }
        try {
            assertValidPartitionSpec(selection.partition);
        } catch (cause) {
            problems.push(
                cause instanceof Error
                    ? `selection.partition: ${cause.message}`
                    : 'selection.partition is not a valid partition spec.',
            );
        }
    } else {
        problems.push(
            'selection.kind must be either "records" or "subject-partition".',
        );
    }

    if (config?.window !== undefined) {
        validWindowConfig(config.window, problems);
    } else {
        problems.push('window must be present.');
    }

    if (!isNonEmptyString(config?.model?.modelId)) {
        problems.push('model.modelId must be a non-empty string.');
    }
    if (!isNonEmptyString(config?.model?.modelVersion)) {
        problems.push('model.modelVersion must be a non-empty string.');
    }
    if (!isNonEmptyString(config?.evaluation?.id)) {
        problems.push('evaluation.id must be a non-empty string.');
    }
    if (!isNonEmptyString(config?.evaluation?.description)) {
        problems.push('evaluation.description must be a non-empty string.');
    }

    return problems;
}

/** Throw `invalid-input` unless `config` is structurally well formed. */
export function assertValidExperimentConfiguration(
    config: Readonly<ExperimentConfiguration>,
): void {
    const problems = describeExperimentConfigurationProblems(config);
    if (problems.length > 0) {
        throw EcgError.invalidInput('Invalid experiment configuration.', {
            detail: problems.join(' '),
            meta: { problems: [...problems] },
        });
    }
}

function selectionName(selection: ExperimentSelection): string {
    if (selection.kind === 'records') {
        return `records[${selection.recordIds.join(',')}]`;
    }
    const { partition, role } = selection;
    const fractions = `${partition.train}/${partition.validation}/${partition.test}`;
    return `subject-partition:role=${role}(${fractions})`;
}

function windowName(window: WindowConfig): string {
    return `w${window.windowLengthSamples}s${window.strideSamples}-${window.remainderPolicy}`;
}

/**
 * Deterministic experiment id derived from the configuration's identity fields
 * (analysisIdOf precedent). Independent of wall-clock time and of the *data* a
 * dataset currently holds for a subject-partition selection — only the declared
 * spec + role shape the id — so re-running the same configuration yields the
 * same id while different configurations never collide.
 */
export function experimentIdOf(
    config: Readonly<ExperimentConfiguration>,
): string {
    const stages: string[] = [
        selectionName(config.selection),
        config.channelName,
        `${config.model.modelId}@${config.model.modelVersion}`,
        windowName(config.window),
        `gt:${config.evaluation.id}`,
    ];
    if (config.preprocessing?.filter !== undefined) {
        stages.push(`filter:${filterTransformName(config.preprocessing.filter)}`);
    }
    return `${config.datasetId} :: ${stages.join(' :: ')}`;
}

/**
 * Resolve a subject-partition selection against a known set of subject-aware
 * record references: partition whole subjects deterministically, assert no
 * subject leaks across roles, and return the records assigned to the requested
 * role. Pure — no records are read; the caller supplies the references from
 * dataset-level identity knowledge (for this lab, `subjectId === recordId`).
 */
export function selectPartitionRecords(
    refs: readonly RecordSubjectRef[],
    selection: Readonly<SubjectPartitionSelection>,
): {
    readonly recordIds: readonly RecordId[];
    readonly roleSubjects: RoleSubjectMap;
    readonly partitioned: PartitionedRecords;
} {
    const partitioned = partitionRecords(refs, selection.partition);
    assertNoSubjectLeakage(partitioned.subjects);
    const recordIds = partitioned.records[selection.role];
    if (recordIds.length === 0) {
        throw EcgError.invalidInput(
            `Subject-partition role "${selection.role}" selected no records from the ` +
            `provided subject set; the evaluation would run on zero windows.`,
        );
    }
    return { recordIds, roleSubjects: partitioned.subjects, partitioned };
}

/** The concrete record ids a configuration selects, for the runner. */
export function resolveSelectedRecordIds(
    config: Readonly<ExperimentConfiguration>,
    refs: readonly RecordSubjectRef[],
): { readonly recordIds: readonly RecordId[]; readonly roleSubjects?: RoleSubjectMap } {
    assertValidExperimentConfiguration(config);
    if (config.selection.kind === 'records') {
        return { recordIds: [...config.selection.recordIds] };
    }
    const selected = selectPartitionRecords(refs, config.selection);
    return {
        recordIds: selected.recordIds,
        roleSubjects: selected.roleSubjects,
    };
}

/**
 * Convenience for this lab's datasets where each record is one subject
 * (`subjectId === recordId`, true of synthetic and MIT-BIH): turn a plain
 * record-id list into subject refs without reading any signal.
 */
export function subjectRefsForSelfSubjects(
    recordIds: readonly RecordId[],
): readonly RecordSubjectRef[] {
    return recordIds.map((recordId) =>
        Object.freeze({
            recordId,
            subjectId: recordId as SubjectId,
        }),
    );
}
