/**
 * ML contract layer barrel (Phase 6 / ADR-004).
 *
 * Exposes the *inference boundary*: metadata schema validation, fingerprinting,
 * ModelInput construction, the InferenceEngine interface + pre-execution
 * compatibility validation, and explicit output interpretation. This is the
 * production surface. It deliberately does NOT export:
 *  - `testing/` (the stub engine is test-only, rules §33), and
 *  - `onnx/` (the ORT-web adapter is guarded behind a lazy browser-only import
 *    and must be imported explicitly by worker/browser wiring, never here).
 */
export { metadataFingerprint, fnv1a, stableStringify } from './fingerprint';
export {
    assertValidModelMetadata,
    describeModelMetadataProblems,
    parseModelMetadataJson,
} from './metadata';
export { buildModelInput, type BuildModelInputOptions, type ModelInputSource } from './input';
export {
    assertInputCompatibleWithModel,
    describeInputCompatibilityProblems,
    isConcreteShape,
    realizeShape,
    tensorElementCount,
    type InferenceEngine,
} from './engine';
export { interpretPrediction } from './interpret';
