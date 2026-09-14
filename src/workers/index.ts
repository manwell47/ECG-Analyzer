/**
 * Worker orchestration barrel (Phase 6–7 / ADR-005).
 *
 * Envelope protocol + latest-only orchestration shared by the main thread and
 * the worker, spanning the inference (Phase 6) and DSP/DWT (Phase 7) request
 * kinds. The browser `Worker` glue itself belongs to the presentation wiring (a
 * later phase); this layer is transport-free so it is fully testable in Node.
 */
export { LatestIdentityGate } from './identity';
export {
    DspWorkerCore,
    InferenceWorkerCore,
    type RegisteredModel,
} from './core';
export { bindDspCore, bindInferenceCore } from './bind';
export type { WorkerPort } from './port';
export {
    LatestOnlyDspClient,
    LatestOnlyInferenceClient,
    type DspExecution,
    type InferenceClientTransport,
    type WorkerClientTransport,
} from './client';
export {
    isDspError,
    isDspRequest,
    isDspResult,
    isInferenceError,
    isInferenceRequest,
    isInferenceResult,
    type DspError,
    type DspRequest,
    type DspResult,
    type InferenceError,
    type InferenceRequest,
    type InferenceResult,
    type WorkerInboundMessage,
    type WorkerOutboundMessage,
} from './types';
