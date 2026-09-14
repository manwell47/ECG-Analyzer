/**
 * ModelInput construction tests (Phase 6 / ADR-004; rules §16, §17).
 *
 * buildModelInput packs an already-prepared window into a validated, frozen
 * tensor and stamps it with the fingerprint of the metadata that produced it.
 * It refuses any source whose sampling, channels, window length or payload
 * disagrees with the declared contract, and it copies the payload so the caller
 * cannot mutate a built input by editing the original buffer.
 */

import { describe, expect, it } from 'vitest';
import { EcgError } from '../../domain/error';
import type { ModelMetadata } from '../../domain/ml';
import { buildModelInput, type ModelInputSource } from '../input';
import { metadataFingerprint } from '../fingerprint';
import { makeMetadata } from './support';

function source(over: Partial<ModelInputSource> = {}): ModelInputSource {
    return {
        sampleRateHz: 360,
        channelCount: 1,
        windowSamples: 512,
        windowId: 'w-0',
        ...over,
    };
}

function dataOf(length: number, fill = 0.5): Float64Array {
    return new Float64Array(length).fill(fill);
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

/** A fixed-shape contract whose channel/window expectations are not declared. */
function metadataWithFixedInputShape(): ModelMetadata {
    const record = JSON.parse(
        JSON.stringify(makeMetadata({ input: { shape: [1, 1, 512] } })),
    ) as Record<string, unknown>;
    delete record.expectedChannels;
    delete record.expectedWindowSamples;
    return record as unknown as ModelMetadata;
}

describe('buildModelInput', () => {
    const metadata = makeMetadata();

    it('builds a validated float32 input stamped with the metadata fingerprint', () => {
        const result = buildModelInput({ metadata, source: source(), data: dataOf(512) });
        expect(result.modelId).toBe(metadata.modelId);
        expect(result.modelVersion).toBe(metadata.modelVersion);
        expect(result.tensorName).toBe('window');
        expect(result.dtype).toBe('float32');
        expect(result.shape).toEqual([1, 1, 512]);
        expect(result.data).toBeInstanceOf(Float32Array);
        expect(result.data.length).toBe(512);
        expect(result.preprocessingFingerprint).toBe(metadataFingerprint(metadata));
        expect(result.sourceWindowIds).toEqual(['w-0']);
        expect(Object.isFrozen(result)).toBe(true);
    });

    it('honours an explicit float64 dtype', () => {
        const result = buildModelInput({
            metadata,
            source: source(),
            data: dataOf(512),
            dtype: 'float64',
        });
        expect(result.data).toBeInstanceOf(Float64Array);
        expect(result.dtype).toBe('float64');
    });

    it('copies the payload buffer (ownership isolation)', () => {
        const raw = dataOf(512, 0.5);
        const result = buildModelInput({ metadata, source: source(), data: raw });
        raw[0] = 999;
        expect(result.data[0]).toBe(0.5);
    });

    it('rejects a source whose sampling, channels or window disagree with the contract', () => {
        throwsCode(
            () => buildModelInput({ metadata, source: source({ sampleRateHz: 361 }), data: dataOf(512) }),
            'model-compatibility-failure',
        );
        throwsCode(
            () => buildModelInput({ metadata, source: source({ channelCount: 2 }), data: dataOf(512) }),
            'model-compatibility-failure',
        );
        throwsCode(
            () => buildModelInput({ metadata, source: source({ windowSamples: 511 }), data: dataOf(512) }),
            'model-compatibility-failure',
        );
    });

    it('rejects malformed scientific source context as invalid-input', () => {
        throwsCode(
            () => buildModelInput({ metadata, source: source({ sampleRateHz: 0 }), data: dataOf(512) }),
            'invalid-input',
        );
        throwsCode(
            () => buildModelInput({ metadata, source: source({ channelCount: 0 }), data: dataOf(512) }),
            'invalid-input',
        );
        throwsCode(
            () => buildModelInput({ metadata, source: source({ windowSamples: -1 }), data: dataOf(512) }),
            'invalid-input',
        );
        throwsCode(
            () => buildModelInput({ metadata, source: source({ windowId: '   ' }), data: dataOf(512) }),
            'invalid-input',
        );
    });

    it('rejects a payload whose length does not match the declared source', () => {
        throwsCode(
            () => buildModelInput({ metadata, source: source(), data: dataOf(511) }),
            'invalid-input',
        );
    });

    it('rejects non-finite payload samples', () => {
        const bad = dataOf(512, 0.5);
        bad[10] = Number.NaN;
        throwsCode(
            () => buildModelInput({ metadata, source: source(), data: bad }),
            'invalid-input',
        );
    });

    it('rejects a payload length the declared input shape cannot represent', () => {
        const fixed = metadataWithFixedInputShape();
        throwsCode(
            () =>
                buildModelInput({
                    metadata: fixed,
                    source: source({ channelCount: 2, windowSamples: 512 }),
                    data: dataOf(1024),
                }),
            'model-compatibility-failure',
        );
    });
});
