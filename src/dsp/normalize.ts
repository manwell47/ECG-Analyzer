/**
 * Phase-3 DSP — amplitude normalisation with a structural leakage guard.
 *
 * Rationale (architecture §G.3; rules §13):
 * - The scientific rule is that normalisation statistics must never be fitted
 *   on the same data they are applied to in evaluation. That is enforced here
 *   *structurally*: {@link fitNormalization} and {@link applyNormalization} are
 *   separate pure functions. `fitNormalization(signal, spec)` returns a
 *   {@link NormalizationFit}; `applyNormalization(signal, fit)` applies the
 *   *stored* parameters and never recomputes them from the signal it is given.
 *   {@link normalizeSignal} is the convenience whole-record path (fit + apply
 *   on one signal) and is documented as only appropriate when the whole record
 *   is the fit partition (e.g. visual inspection), never for evaluation.
 * - Output is a new `Signal` in unit `'normalized'`; the input is never
 *   mutated and its `SamplingInfo` is preserved.
 *
 * Strategies: `min-max` (linear map into [0, 1]) and `zscore`
 * ((x - mean) / std). Scope: `per-channel` (statistics per channel) or
 * `global` (statistics over all channels of the fitted record together).
 * Zero-variance fits are rejected explicitly (rules §13) rather than silently
 * producing NaN or a degenerate mapping.
 */

import {
    createSignal,
    EcgError,
    type Signal,
    type SignalChannel,
} from '../domain';
import { deriveTransformId, withTransform } from './helpers';

export type NormalizationStrategy = 'min-max' | 'zscore';
export type NormalizationScope = 'per-channel' | 'global';

export interface NormalizationSpec {
    readonly strategy: NormalizationStrategy;
    readonly scope: NormalizationScope;
}

/** Fitted statistics for one channel. */
export interface MinMaxParams {
    readonly kind: 'min-max';
    readonly min: number;
    readonly max: number;
}
export interface ZScoreParams {
    readonly kind: 'zscore';
    readonly mean: number;
    readonly std: number;
}
export type NormalizationParams = MinMaxParams | ZScoreParams;

/**
 * A stored normalisation fit. `channelParams` is aligned to the channels of
 * the signal it was fitted on; for `global` scope every entry carries the same
 * combined statistic (kept per channel so apply is a uniform loop).
 */
export interface NormalizationFit {
    readonly strategy: NormalizationStrategy;
    readonly scope: NormalizationScope;
    readonly channelParams: readonly NormalizationParams[];
    /** Which partition produced the fit (audit trail for leakage review). */
    readonly fitPartitionDescription: string;
}

export function normalizationTransformName(
    spec: NormalizationSpec,
): string {
    return `normalize-${spec.strategy}-${spec.scope}`;
}

function requireScope(scope: NormalizationScope): void {
    if (scope !== 'per-channel' && scope !== 'global') {
        throw EcgError.invalidInput(
            `Unsupported normalisation scope ${JSON.stringify(scope)}; ` +
            'expected "per-channel" or "global".',
        );
    }
}

function requireStrategy(strategy: NormalizationStrategy): void {
    if (strategy !== 'min-max' && strategy !== 'zscore') {
        throw EcgError.invalidInput(
            `Unsupported normalisation strategy ${JSON.stringify(strategy)}; ` +
            'expected "min-max" or "zscore".',
        );
    }
}

function minMaxParamsFor(values: ArrayLike<number>): MinMaxParams {
    const n = values.length;
    if (n === 0) {
        throw EcgError.invalidInput(
            'Cannot fit normalisation on an empty channel.',
        );
    }
    let min = values[0]!;
    let max = values[0]!;
    for (let i = 1; i < n; i += 1) {
        const value = values[i]!;
        if (value < min) {
            min = value;
        }
        if (value > max) {
            max = value;
        }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
        throw EcgError.invalidInput(
            'Cannot fit min-max normalisation on non-finite samples.',
        );
    }
    if (max === min) {
        throw new EcgError(
            'numerical-failure',
            'Cannot fit min-max normalisation: zero-variance data ' +
            `(min == max == ${min}). Normalise at the source or choose a robust strategy.`,
        );
    }
    return { kind: 'min-max', min, max };
}

function zScoreParamsFor(values: ArrayLike<number>): ZScoreParams {
    const n = values.length;
    if (n === 0) {
        throw EcgError.invalidInput(
            'Cannot fit normalisation on an empty channel.',
        );
    }
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i += 1) {
        const value = values[i]!;
        sum += value;
        sumSq += value * value;
    }
    const mean = sum / n;
    // Population std (divide by n): the canonical z-score definition.
    const variance = Math.max(0, sumSq / n - mean * mean);
    const std = Math.sqrt(variance);
    if (!Number.isFinite(mean) || !Number.isFinite(std)) {
        throw EcgError.invalidInput(
            'Cannot fit z-score normalisation on non-finite samples.',
        );
    }
    if (std === 0) {
        throw new EcgError(
            'numerical-failure',
            'Cannot fit z-score normalisation: zero variance ' +
            `(constant channel at ${mean}).`,
        );
    }
    return { kind: 'zscore', mean, std };
}

/**
 * Fit normalisation parameters from `signal`. This is the *only* place
 * statistics are computed; the returned fit can be applied to disjoint data.
 */
export function fitNormalization(
    signal: Signal,
    spec: NormalizationSpec,
    fitPartitionDescription = 'unknown',
): NormalizationFit {
    requireStrategy(spec.strategy);
    requireScope(spec.scope);

    const channelParams: NormalizationParams[] = [];
    if (spec.scope === 'global') {
        // Concatenate every channel and fit once; broadcast to all channels.
        const combined: number[] = [];
        for (const channel of signal.channels) {
            for (let i = 0; i < channel.data.length; i += 1) {
                combined.push(channel.data[i]!);
            }
        }
        const globalParams =
            spec.strategy === 'min-max'
                ? minMaxParamsFor(combined)
                : zScoreParamsFor(combined);
        for (let c = 0; c < signal.channels.length; c += 1) {
            channelParams.push(
                spec.strategy === 'min-max'
                    ? { ...(globalParams as MinMaxParams) }
                    : { ...(globalParams as ZScoreParams) },
            );
        }
    } else {
        for (const channel of signal.channels) {
            channelParams.push(
                spec.strategy === 'min-max'
                    ? minMaxParamsFor(channel.data)
                    : zScoreParamsFor(channel.data),
            );
        }
    }

    return {
        strategy: spec.strategy,
        scope: spec.scope,
        channelParams,
        fitPartitionDescription,
    };
}

function applyParams(value: number, params: NormalizationParams): number {
    switch (params.kind) {
        case 'min-max':
            return (value - params.min) / (params.max - params.min);
        case 'zscore':
            return (value - params.mean) / params.std;
    }
}

/**
 * Apply a stored fit to `signal` without recomputing any statistic from this
 * signal. Channel count must match the fit. The output unit is `'normalized'`.
 */
export function applyNormalization(
    signal: Signal,
    fit: NormalizationFit,
): Signal {
    requireStrategy(fit.strategy);
    requireScope(fit.scope);
    if (fit.channelParams.length !== signal.channels.length) {
        throw EcgError.invalidInput(
            `Normalisation fit has ${fit.channelParams.length} channel ` +
            `parameter(s) but the signal has ${signal.channels.length}; ` +
            'cannot apply a fit produced on different channels.',
        );
    }

    const channels: SignalChannel[] = signal.channels.map((channel, index) => {
        const params = fit.channelParams[index]!;
        const data = new Float64Array(channel.data.length);
        for (let i = 0; i < channel.data.length; i += 1) {
            data[i] = applyParams(channel.data[i]!, params);
        }
        return { name: channel.name, unit: 'normalized', data };
    });

    const transformName = normalizationTransformName(fit);
    return createSignal({
        id: deriveTransformId(signal.id, transformName),
        channels,
        sampling: signal.sampling,
        provenance: withTransform(signal.provenance, {
            name: transformName,
            parameters: {
                strategy: fit.strategy,
                scope: fit.scope,
                fitPartitionDescription: fit.fitPartitionDescription,
            },
        }),
    });
}

/**
 * Whole-record convenience path: fit on `signal`, then apply to the same
 * `signal`. Only correct when the entire signal is legitimately the fit
 * partition (e.g. inspection, or a record being normalised before model input
 * with a fit that is recorded in provenance). For train/evaluation splits use
 * {@link fitNormalization} on training data and {@link applyNormalization} on
 * evaluation data — never this function across the boundary.
 */
export function normalizeSignal(
    signal: Signal,
    spec: NormalizationSpec,
    fitPartitionDescription = 'whole-record',
): Signal {
    const fit = fitNormalization(signal, spec, fitPartitionDescription);
    return applyNormalization(signal, fit);
}
