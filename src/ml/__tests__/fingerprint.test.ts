/**
 * Deterministic preprocessing/normalization fingerprint tests (Phase 6 / ADR-004).
 *
 * The fingerprint is the anti-SIGIL glue: inputs are stamped with the exact
 * input-producing contract of the metadata that prepared them, and an engine
 * refuses an input whose fingerprint does not match the model it was asked to
 * run. It must be deterministic, key-order independent, and sensitive to every
 * contract field that changes what a tensor means.
 */

import { describe, expect, it } from 'vitest';
import type { ModelMetadata } from '../../domain/ml';
import { fnv1a, metadataFingerprint, stableStringify } from '../fingerprint';
import { makeMetadata } from './support';

describe('stableStringify', () => {
    it('serializes objects independently of key order', () => {
        const left = stableStringify({ a: 1, b: [1, 2, { x: true }], c: 'text' });
        const right = stableStringify({ c: 'text', b: [1, 2, { x: true }], a: 1 });
        expect(left).toBe(right);
    });

    it('is deterministic across calls', () => {
        const value = { z: [1, { k: 'v' }, null], a: false, n: 2.5 };
        expect(stableStringify(value)).toBe(stableStringify(value));
    });

    it('keeps array order significant and renders primitives canonically', () => {
        expect(stableStringify(['a', 'b'])).toBe(stableStringify(['a', 'b']));
        expect(stableStringify(['a', 'b'])).not.toBe(stableStringify(['b', 'a']));
        expect(stableStringify(null)).toBe('null');
        expect(stableStringify(true)).toBe('true');
        expect(stableStringify(3.5)).toBe('3.5');
    });
});

describe('fnv1a', () => {
    it('returns the canonical FNV-1a offset-basis hash for the empty string', () => {
        expect(fnv1a('')).toBe('811c9dc5');
    });

    it('always renders 8 lowercase hex characters', () => {
        const samples = ['', 'a', 'preprocessing', 'mitbih-cnn@1.0.0', 'z'.repeat(1000)];
        for (const sample of samples) {
            expect(fnv1a(sample)).toMatch(/^[0-9a-f]{8}$/);
        }
    });

    it('is deterministic and sensitive to its input', () => {
        expect(fnv1a('window')).toBe(fnv1a('window'));
        expect(fnv1a('window')).not.toBe(fnv1a('classes'));
    });
});

describe('metadataFingerprint', () => {
    const baseline = metadataFingerprint(makeMetadata());

    it('is deterministic for identical metadata', () => {
        expect(metadataFingerprint(makeMetadata())).toBe(baseline);
    });

    it('changes when any input-producing contract field changes', () => {
        const variants: ReadonlyArray<readonly [string, ModelMetadata]> = [
            ['modelId', makeMetadata({ modelId: 'other-cnn' })],
            ['modelVersion', makeMetadata({ modelVersion: '2.0.0' })],
            ['task', makeMetadata({ task: 'rhythm-classification' })],
            ['input name', makeMetadata({ input: { name: 'ecg' } })],
            ['input dtype', makeMetadata({ input: { dtype: 'float64' } })],
            ['input layout', makeMetadata({ input: { layout: 'nc' } })],
            ['input shape', makeMetadata({ input: { shape: [-1, 1, 256] } })],
            ['expected sampling', makeMetadata({ expectedSamplingRateHz: 250 })],
            ['expected channels', makeMetadata({ expectedChannels: 2 })],
            ['expected window', makeMetadata({ expectedWindowSamples: 256 })],
            [
                'preprocessing stage',
                makeMetadata({
                    preprocessingAssumptions: [
                        { stage: 'bandpass-0.3-45hz', config: { lowHz: 0.3, highHz: 45, order: 4 } },
                        { stage: 'resample-to-360', config: {} },
                        { stage: 'segment-512', config: {} },
                    ],
                }),
            ],
            [
                'preprocessing config',
                makeMetadata({
                    preprocessingAssumptions: [
                        { stage: 'bandpass-0.5-40hz', config: { lowHz: 0.5, highHz: 40, order: 6 } },
                        { stage: 'resample-to-360', config: {} },
                        { stage: 'segment-512', config: {} },
                    ],
                }),
            ],
            [
                'normalization strategy',
                makeMetadata({ normalization: { strategy: 'minmax', fittedFrom: 'mitbih-train' } }),
            ],
            [
                'normalization fittedFrom',
                makeMetadata({ normalization: { strategy: 'zscore', fittedFrom: 'other-split' } }),
            ],
        ];
        for (const [description, metadata] of variants) {
            expect(metadataFingerprint(metadata), description).not.toBe(baseline);
        }
    });

    it('ignores the output contract and provenance (input-producing contract only)', () => {
        const metadata = makeMetadata();
        expect(
            metadataFingerprint(
                makeMetadata({ output: { semantics: 'probabilities', activation: 'softmax' } }),
            ),
        ).toBe(baseline);
        expect(
            metadataFingerprint({
                ...metadata,
                output: { ...metadata.output, classLabels: ['Q', 'F', 'V', 'S', 'N'] },
            }),
        ).toBe(baseline);
        expect(
            metadataFingerprint({
                ...metadata,
                provenance: { trainingDataset: 'an unrelated dataset' },
            }),
        ).toBe(baseline);
    });

    it('distinguishes two unrelated documents', () => {
        const other = makeMetadata({
            modelId: 'resnet-ecg',
            expectedSamplingRateHz: 250,
            expectedWindowSamples: 250,
        });
        expect(metadataFingerprint(other)).not.toBe(baseline);
    });
});
