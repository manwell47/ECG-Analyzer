/**
 * Browser-loadable probe-model asset (Phase 10, item 5; ADR-004, ADR-005,
 * ADR-011).
 *
 * The Node-only accessor `src/ml/testing/probeModel.ts` (fs/crypto) must never
 * enter the web bundle, so this module is its browser-safe counterpart: it
 * imports the committed `.onnx` with Vite's `?url` transform (the bundler emits
 * the asset and hands back a URL the worker can `fetch`) and re-states the
 * committed probe's `ModelMetadata` as a frozen literal.
 *
 * The literal is NOT a second source of truth. The Node parity test
 * `src/ml/onnx/__tests__/probeAsset.parity.test.ts` asserts it deep-equals the
 * metadata parsed by `probeModel.ts`, that the URL names the committed artifact,
 * and that the committed bytes match the recorded length + SHA-256 — so the
 * browser bundle can never silently name a different model or contract (the same
 * drift-proofing pattern as `createProbeSeamExperimentConfiguration`).
 *
 * The probe is a development seam-validation artifact (ADR-009): it has no
 * clinical or physiological meaning and makes no model-quality claim.
 */

import type { ModelMetadata } from '../../domain/ml';
import probeModelUrl from '../../../data/fixtures/models/ecg-lab-probe-linear-mean-2.onnx?url';

/** Vite-resolved URL of the committed probe model, fetched inside the worker. */
export const PROBE_MODEL_URL: string = probeModelUrl;

/**
 * The committed probe model's contract as a browser-safe literal. Kept separate
 * from the export so it is contextually typed against `ModelMetadata` (the
 * literal `dtype`/`semantics`/`activation` tokens are then checked against their
 * unions rather than widened to `string`).
 */
const PROBE_MODEL_METADATA_LITERAL: ModelMetadata = {
    modelId: 'ecg-lab-probe-linear-mean-2',
    modelVersion: '1.0.0',
    task: 'probe-sign-of-mean (development seam-validation; not a physiological classifier)',
    input: {
        name: 'signal',
        shape: [360],
        dtype: 'float32',
        layout: 'samples',
    },
    expectedSamplingRateHz: 360,
    expectedChannels: 1,
    expectedWindowSamples: 360,
    preprocessingAssumptions: [
        {
            stage: 'identity-window',
            config: {
                channelCount: 1,
                windowSamples: 360,
                sampleRateHz: 360,
                note: 'Probe consumes the raw prepared window with no filtering, resampling or segmentation.',
            },
        },
    ],
    normalization: { strategy: 'none' },
    output: {
        name: 'logits',
        dtype: 'float32',
        semantics: 'logits',
        activation: 'softmax',
        classLabels: ['positive-mean', 'nonpositive-mean'],
    },
    provenance: {
        trainingDataset: 'Not trained - synthetic deterministic probe, no data involved',
        methodology:
            'One-layer deterministic graph (opset 13): output logits = [+sum, -sum] of the float32 ' +
            'input window; softmax argmax is the sign of the window mean. Built by onnx 1.22.0 via ' +
            'generate-probe-model.py; purpose is to exercise the ONNX Runtime Web seam end-to-end ' +
            '(Signal -> ModelInput -> session -> interpret). It is a test oracle, not a scientific model.',
        limitations:
            'Development seam-validation probe only. Has no physiological or clinical meaning and must ' +
            'never be used to inform any medical or scientific conclusion.',
    },
};

/** Frozen, browser-safe copy of the committed probe model's contract. */
export const PROBE_MODEL_METADATA: Readonly<ModelMetadata> = Object.freeze(
    PROBE_MODEL_METADATA_LITERAL,
);
