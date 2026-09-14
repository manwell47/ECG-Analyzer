/**
 * Browser probe-asset parity (Phase 10, item 5; ADR-004, ADR-005, ADR-011).
 *
 * The web bundle loads the committed probe through `src/ml/onnx/probeAsset.ts`
 * (Vite `?url` + frozen metadata literals), while the Node seam tests load the
 * same artifact through `src/ml/testing/probeModel.ts`. This test pins the two
 * together so the browser bundle can never silently name a different model or
 * contract:
 *
 *  - the metadata literal is structurally valid and deep-equals the committed
 *    metadata parsed by the Node accessor;
 *  - the emitted URL names the committed `.onnx` file;
 *  - the committed bytes match the recorded length and SHA-256 (recomputed here
 *    independently, not merely trusted from the Node guard).
 *
 * Static integrity only — no wall-clock/timing assertion (rules §51). The Vite
 * `?url` value is a dev/build URL and is not fetchable from Node, so the bytes
 * are read through the Node accessor that names the same file.
 */

import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { describeModelMetadataProblems } from '../../metadata';
import {
    PROBE_MODEL_ID,
    PROBE_MODEL_ONNX_BYTE_LENGTH,
    PROBE_MODEL_ONNX_SHA256,
    describeProbeModelProblems,
    loadProbeModelBytes,
    loadProbeModelMetadata,
} from '../../testing/probeModel';
import { PROBE_MODEL_METADATA, PROBE_MODEL_URL } from '../probeAsset';

describe('probeAsset parity with the committed probe model', () => {
    it('exposes a structurally valid, frozen, browser-safe metadata literal', () => {
        expect(describeModelMetadataProblems(PROBE_MODEL_METADATA)).toEqual([]);
        expect(Object.isFrozen(PROBE_MODEL_METADATA)).toBe(true);
        expect(PROBE_MODEL_METADATA.modelId).toBe(PROBE_MODEL_ID);
    });

    it('matches the committed metadata parsed by the Node accessor', () => {
        expect(PROBE_MODEL_METADATA).toEqual(loadProbeModelMetadata());
    });

    it('resolves the URL to the committed .onnx artifact', () => {
        expect(typeof PROBE_MODEL_URL).toBe('string');
        expect(PROBE_MODEL_URL).toContain(`${PROBE_MODEL_ID}.onnx`);
    });

    it('records the committed artifact byte length and SHA-256', () => {
        const bytes = loadProbeModelBytes();
        expect(bytes.byteLength).toBe(PROBE_MODEL_ONNX_BYTE_LENGTH);
        const digest = createHash('sha256').update(bytes).digest('hex');
        expect(digest).toBe(PROBE_MODEL_ONNX_SHA256);
        expect(describeProbeModelProblems()).toEqual([]);
    });
});
