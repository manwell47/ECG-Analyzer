/**
 * Application orchestration layer (Phase 7 / architecture E.1–E.3) — public
 * surface.
 *
 * The only layer the presentation layer may call. It composes domain,
 * datasets and DSP into workflow results (`AnalysisResult`) that views consume,
 * keeping scientific modules framework-free and preserving the strict
 * dependency direction `presentation → application → domain/dsp/datasets/workers`.
 *
 * This directory is intentionally minimal at Phase 7; orchestration for
 * workers (ADR-005 identity/echo) and ML runs is added as those phases land.
 */
export * from './analysis';
export * from './defaults';
export * from './dspExecutor';
export * from './experiment';
export * from './experimentResult';
export * from './inference';
export * from './metrics';
export * from './runExperiment';
