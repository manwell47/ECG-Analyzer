/**
 * Deterministic preprocessing/normalization fingerprint (Phase 6 / ADR-004).
 *
 * `ModelMetadata` carries the *exact* contract that turns a signal into a
 * `ModelInput` (sampling, channels, window length, preprocessing assumptions,
 * normalization). Two pieces of metadata are only interchangeable if that
 * contract is byte-identical, so every realized input stamps itself with a
 * stable fingerprint of the metadata that produced it. An engine refuses to run
 * an input whose fingerprint does not match the model it was asked to run —
 * this makes "same shape, different preprocessing" a loud failure instead of a
 * silent scientific mismatch (rules §16; ADR-004).
 *
 * The hash is a plain FNV-1a over a canonicalized serialization: deterministic
 * across runs, platforms and object-key order, and free of external
 * dependencies.
 */

import type { ModelMetadata } from '../domain/ml';

/** Canonical, order-independent serialization of JSON-ish values. */
export function stableStringify(value: unknown): string {
    if (value === null) {
        return 'null';
    }
    if (typeof value === 'string') {
        return JSON.stringify(value);
    }
    if (typeof value === 'number') {
        return Number.isFinite(value) ? String(value) : 'null';
    }
    if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
    }
    if (Array.isArray(value)) {
        return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
    }
    if (typeof value === 'object') {
        const record = value as Record<string, unknown>;
        const keys = Object.keys(record).sort();
        const body = keys
            .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
            .join(',');
        return `{${body}}`;
    }
    return JSON.stringify(String(value));
}

/** FNV-1a 32-bit over a string, rendered as 8 lowercase hex characters. */
export function fnv1a(input: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Stable fingerprint of the input-producing contract of a `ModelMetadata`.
 * Any change to model identity, expected sampling/channels/window, tensor
 * contract, preprocessing assumptions or normalization changes the fingerprint,
 * so inputs prepared under an older contract can never slip into a newer model.
 */
export function metadataFingerprint(metadata: Readonly<ModelMetadata>): string {
    const parts: string[] = [
        metadata.modelId,
        metadata.modelVersion,
        metadata.task,
        metadata.input.name,
        metadata.input.dtype,
        metadata.input.layout,
        metadata.input.shape.join(','),
        metadata.expectedSamplingRateHz === undefined ? '' : String(metadata.expectedSamplingRateHz),
        metadata.expectedChannels === undefined ? '' : String(metadata.expectedChannels),
        metadata.expectedWindowSamples === undefined ? '' : String(metadata.expectedWindowSamples),
        ...metadata.preprocessingAssumptions.map((assumption) =>
            `${assumption.stage}:${stableStringify(assumption.config)}`,
        ),
        metadata.normalization.strategy,
        metadata.normalization.fittedFrom ?? '',
    ];

    return fnv1a(parts.join('\u0000'));
}
