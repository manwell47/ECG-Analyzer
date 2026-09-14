/**
 * Inference dedicated-worker entry (Phase 10, items 3 & 5; ADR-005, ADR-011).
 *
 * The thinnest possible worker shell: it constructs the shared
 * {@link InferenceWorkerCore} (a registry of loaded models that delegates every
 * `run` to the registered `InferenceEngine`, so no inference logic lives here —
 * rules §30) and binds it to the worker's global port with
 * {@link bindInferenceCore}. The binder answers every inbound
 * `inference-request` with one `inference-result`/`inference-error` envelope.
 *
 * Full-record inference leaves the main thread here (item 5): before the binder
 * starts serving, this entry fetches the committed development probe model from
 * its browser-loadable Vite asset URL (`src/ml/onnx/probeAsset.ts`) and registers
 * the real ONNX Runtime Web engine, so the ONNX session and every `run` execute
 * inside this worker. The main thread therefore never imports `onnxruntime-web`
 * nor the Node-only `src/ml/testing/probeModel.ts` accessor. A registration
 * failure is logged but not fatal: the binder still serves, and every request
 * then fails loudly as a classified `model-loading-failure` (no model
 * registered) rather than hanging.
 *
 * TypeScript note: as with the DSP entry, the global `self` is narrowed to the
 * local {@link WorkerPort} surface by one documented cast (DOM lib, no
 * `webworker` lib). Not executed by vitest; covered by typecheck, lint and the
 * Vite `?worker` build.
 */

import { PROBE_MODEL_METADATA, PROBE_MODEL_URL } from '../../ml/onnx/probeAsset';
import { createOnnxWebEngine } from '../../ml/onnx/ortWebEngine';
import { bindInferenceCore } from '../bind';
import { InferenceWorkerCore } from '../core';
import type { WorkerPort } from '../port';

/** The worker's global scope, narrowed to the transport surface the binder needs. */
const port = self as unknown as WorkerPort;

const core = new InferenceWorkerCore();

/**
 * Fetch the committed probe `.onnx` through its emitted asset URL and register
 * the real ONNX Web engine under the probe's declared identity.
 */
async function registerProbeModel(): Promise<void> {
    const response = await fetch(PROBE_MODEL_URL);
    if (!response.ok) {
        throw new Error(`Failed to fetch the probe model asset (HTTP ${response.status}).`);
    }
    const modelBytes = new Uint8Array(await response.arrayBuffer());
    const engine = await createOnnxWebEngine({
        metadata: PROBE_MODEL_METADATA,
        modelBytes,
    });
    core.register(PROBE_MODEL_METADATA.modelId, PROBE_MODEL_METADATA.modelVersion, {
        metadata: PROBE_MODEL_METADATA,
        engine,
    });
}

void (async (): Promise<void> => {
    try {
        await registerProbeModel();
    } catch (cause) {
        console.error(
            '[inference.worker] Failed to register the development probe engine.',
            cause,
        );
    }
    bindInferenceCore(port, core);
})();
