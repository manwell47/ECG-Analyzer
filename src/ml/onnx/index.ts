/**
 * ONNX Web backend barrel (Phase 6 / ADR-004, ADR-005).
 *
 * Deliberately NOT re-exported from the production `src/ml/index.ts`: importing
 * this barrel must stay an explicit, guarded act by the browser/worker wiring
 * (Phase 6 keeps the adapter compiled but not installed or exercised).
 */
export { createOnnxWebEngine, type OnnxWebEngineOptions } from './ortWebEngine';
