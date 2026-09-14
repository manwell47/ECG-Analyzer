/**
 * Core signal representation (ADR-001).
 *
 * A `Signal` is an immutable-by-convention container of one or more equal-length
 * channels sharing a single `SamplingInfo`. Units are carried per channel and
 * sample rate is carried explicitly — never derived from data length.
 *
 * `createSignal` validates structure and COPIES channel buffers so that a
 * `Signal` never shares mutable memory with its producers; DSP transforms must
 * produce a *new* `Signal` rather than mutate one in place.
 */

import { EcgError } from './error';
import type { SamplingInfo } from './sampling';
import { isAmplitudeUnit, type AmplitudeUnit } from './units';

/** A single DSP operation recorded in a signal's provenance. */
export interface TransformStep {
    /** Canonical, stable transform name, e.g. 'bandpass-0.5-40hz'. */
    readonly name: string;
    /** Machine-readable parameters sufficient to reproduce the transform. */
    readonly parameters: Readonly<Record<string, unknown>>;
    /** ISO-8601 timestamp when the transform was applied (optional). */
    readonly appliedAtIso?: string;
}

/** Origin and processing history of a signal (provenance). */
export interface Provenance {
    /** Origin description, e.g. 'mitdb/100 channel MLII'. */
    readonly source?: string;
    /** Transforms applied so far, oldest first. */
    readonly transforms: readonly TransformStep[];
}

export interface SignalChannel {
    /** Channel name; unique within a signal (e.g. 'MLII' or 'lead-II'). */
    readonly name: string;
    /** Sample amplitudes. Length is in samples; never infer rate from length. */
    readonly data: Float64Array;
    /** Physical unit of `data` amplitudes. */
    readonly unit: AmplitudeUnit;
}

export interface Signal {
    /** Stable identifier, e.g. 'mitdb/100/channel/0' or a run id. */
    readonly id: string;
    /** One or more equal-length channels sharing `sampling`. */
    readonly channels: readonly SignalChannel[];
    /** Explicit sample rate + start offset for every channel. */
    readonly sampling: SamplingInfo;
    /** How this signal was obtained and what was applied to it. */
    readonly provenance: Provenance;
}

export interface CreateSignalInput {
    /** Stable identifier; must be a non-empty string. */
    readonly id: string;
    /** Channels (data is copied on construction). */
    readonly channels: readonly SignalChannel[];
    /** Shared sampling metadata for all channels. */
    readonly sampling: SamplingInfo;
    /** Defaults to an empty provenance (`{ transforms: [] }`). */
    readonly provenance?: Provenance;
}

/**
 * Return a human-oriented list of structural problems, or an empty array when
 * the signal is valid. Never throws; intended for diagnostics and for
 * {@link assertValidSignal} to aggregate into a single classified error.
 */
export function describeSignalProblems(signal: Readonly<Signal>): readonly string[] {
    const problems: string[] = [];

    if (signal.id.trim().length === 0) {
        problems.push('Signal id must be a non-empty string.');
    }

    const { sampleRateHz, startTimeSec } = signal.sampling;
    if (typeof sampleRateHz !== 'number' || !Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
        problems.push(
            `Sample rate must be a finite number > 0 Hz, received ${String(sampleRateHz)}.`,
        );
    }
    if (typeof startTimeSec !== 'number' || !Number.isFinite(startTimeSec)) {
        problems.push(
            `Start time must be a finite number of seconds, received ${String(startTimeSec)}.`,
        );
    }

    if (signal.channels.length === 0) {
        problems.push('Signal must contain at least one channel.');
        return problems;
    }

    const seenNames = new Set<string>();
    for (const channel of signal.channels) {
        if (channel.name.trim().length === 0) {
            problems.push('Every channel must have a non-empty name.');
        }
        if (!isAmplitudeUnit(channel.unit)) {
            problems.push(
                `Channel "${channel.name}" has unsupported unit ${JSON.stringify(channel.unit)}.`,
            );
        }
        if (!(channel.data instanceof Float64Array)) {
            problems.push(`Channel "${channel.name}" data must be a Float64Array.`);
            continue;
        }
        if (channel.data.length === 0) {
            problems.push(`Channel "${channel.name}" contains zero samples.`);
        }
        for (let i = 0; i < channel.data.length; i += 1) {
            if (!Number.isFinite(channel.data[i])) {
                problems.push(
                    `Channel "${channel.name}" contains a non-finite value at sample index ${i}.`,
                );
                break;
            }
        }
        if (seenNames.has(channel.name)) {
            problems.push(`Duplicate channel name "${channel.name}".`);
        }
        seenNames.add(channel.name);
    }

    const lengths = new Set(signal.channels.map((channel) => channel.data.length));
    if (lengths.size > 1) {
        problems.push(
            `All channels must have equal sample counts; found ${[...lengths].join(', ')}.`,
        );
    }

    return problems;
}

/** Throw `malformed-signal` with an aggregated report if the signal is invalid. */
export function assertValidSignal(signal: Readonly<Signal>): void {
    const problems = describeSignalProblems(signal);
    if (problems.length > 0) {
        throw EcgError.malformedSignal('Signal failed structural validation.', {
            detail: problems.join(' '),
            meta: { problems: [...problems] },
        });
    }
}

/**
 * Build a validated `Signal`. Channel data is copied into fresh `Float64Array`
 * buffers so the signal owns its memory; pass buffers you no longer mutate.
 */
export function createSignal(input: CreateSignalInput): Signal {
    const channels: readonly SignalChannel[] = Object.freeze(
        input.channels.map((channel) => ({
            name: channel.name,
            unit: channel.unit,
            data: new Float64Array(channel.data),
        })),
    );

    const signal: Signal = {
        id: input.id,
        channels,
        sampling: input.sampling,
        provenance: input.provenance ?? { transforms: [] },
    };

    assertValidSignal(signal);
    return signal;
}
