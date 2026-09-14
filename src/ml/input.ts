/**
 * ModelInput construction (Phase 6 / ADR-004; rules §17).
 *
 * A `ModelInput` is realized from a *prepared* window: samples that have already
 * been filtered/resampled/segmented/normalized by the DSP layer exactly as the
 * model's metadata prescribes. This module does not contain DSP; it is the
 * last, inspectable step that packs an already-correctly-prepared window into a
 * tensor and stamps it with the preprocessing fingerprint of the metadata that
 * produced it.
 *
 * The builder refuses, loudly, any source window whose sample rate, channel
 * count or window length is not what the metadata declares — shape compatibility
 * is never treated as scientific compatibility (rules §16).
 */

import { EcgError } from '../domain/error';
import type { ModelInput, ModelMetadata } from '../domain/ml';
import { realizeShape } from './engine';
import { metadataFingerprint } from './fingerprint';
import { assertValidModelMetadata } from './metadata';

/** Scientific context of a prepared window, known at DSP time (not a tensor). */
export interface ModelInputSource {
    /** Sample rate of the prepared window (Hz). */
    readonly sampleRateHz: number;
    /** Number of channels present in the prepared window. */
    readonly channelCount: number;
    /** Samples per channel in the prepared window. */
    readonly windowSamples: number;
    /** Stable identity of the source window(s) these exact samples came from. */
    readonly windowId: string;
}

export interface BuildModelInputOptions {
    /** The metadata whose contract produced the prepared window. */
    readonly metadata: Readonly<ModelMetadata>;
    /** Scientific context of the prepared window (validated, not trusted). */
    readonly source: ModelInputSource;
    /**
     * Row-major flattened window data of length `channelCount * windowSamples`
     * in exactly the layout/order the metadata declares. Copied on build.
     */
    readonly data: Float64Array;
    /** Payload dtype; defaults to 'float32'. */
    readonly dtype?: 'float32' | 'float64';
}

function ratesEqual(a: number, b: number): boolean {
    return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
}

function isPositiveInteger(value: number): boolean {
    return Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

/**
 * Build a validated, self-describing `ModelInput` for one prepared window.
 * Every mismatch between the prepared window and the model's declared contract
 * fails loudly; the returned input owns its payload buffer.
 */
export function buildModelInput(options: BuildModelInputOptions): ModelInput {
    const { metadata, source, dtype = 'float32' } = options;
    assertValidModelMetadata(metadata);

    if (!isPositiveInteger(source.sampleRateHz)) {
        throw EcgError.invalidInput('Source sample rate must be a finite positive number of Hz.');
    }
    if (!isPositiveInteger(source.channelCount)) {
        throw EcgError.invalidInput('Source channel count must be a positive integer.');
    }
    if (!isPositiveInteger(source.windowSamples)) {
        throw EcgError.invalidInput('Source window length must be a positive integer of samples.');
    }
    if (source.windowId.trim().length === 0) {
        throw EcgError.invalidInput('Source window id must be a non-empty string.');
    }

    if (metadata.expectedSamplingRateHz !== undefined && !ratesEqual(metadata.expectedSamplingRateHz, source.sampleRateHz)) {
        throw EcgError.modelCompatibility(
            `Prepared window sample rate ${source.sampleRateHz} Hz does not match the model's declared ${metadata.expectedSamplingRateHz} Hz.`,
        );
    }
    if (metadata.expectedChannels !== undefined && metadata.expectedChannels !== source.channelCount) {
        throw EcgError.modelCompatibility(
            `Prepared window has ${source.channelCount} channel(s) but the model declares ${metadata.expectedChannels}.`,
        );
    }
    if (metadata.expectedWindowSamples !== undefined && metadata.expectedWindowSamples !== source.windowSamples) {
        throw EcgError.modelCompatibility(
            `Prepared window is ${source.windowSamples} samples/channel but the model declares ${metadata.expectedWindowSamples}.`,
        );
    }

    const expectedLength = source.channelCount * source.windowSamples;
    if (options.data.length !== expectedLength) {
        throw EcgError.invalidInput(
            `Prepared window holds ${options.data.length} samples but ${source.channelCount} channel(s) x ${source.windowSamples} samples requires ${expectedLength}.`,
        );
    }
    for (let index = 0; index < options.data.length; index += 1) {
        if (!Number.isFinite(options.data[index])) {
            throw EcgError.invalidInput(
                `Prepared window contains a non-finite value at flat index ${index}; a model must never receive NaN/Infinity.`,
            );
        }
    }

    const shape = realizeShape(metadata.input.shape, options.data.length);
    if (shape === undefined) {
        throw EcgError.modelCompatibility(
            `Prepared window length ${options.data.length} cannot be represented by the model's declared input shape [${metadata.input.shape.join(', ')}].`,
        );
    }

    const payload: Float32Array | Float64Array =
        dtype === 'float64' ? new Float64Array(options.data) : new Float32Array(options.data);

    return Object.freeze({
        modelId: metadata.modelId,
        modelVersion: metadata.modelVersion,
        tensorName: metadata.input.name,
        dtype,
        shape: Object.freeze([...shape]),
        data: payload,
        preprocessingFingerprint: metadataFingerprint(metadata),
        sourceWindowIds: Object.freeze([source.windowId]),
    });
}
