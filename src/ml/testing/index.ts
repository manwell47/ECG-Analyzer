/**
 * Test-only ML helpers barrel.
 *
 * NOT part of the production surface (never imported from `src/ml/index.ts`);
 * only tests and worker-core unit tests pull the deterministic stub engine from
 * here (rules §33).
 */
export { StubInferenceEngine, createStubEngine, type StubEngineOptions } from './stub';
export * from './probeModel';
