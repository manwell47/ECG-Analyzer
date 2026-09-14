/**
 * Domain invariant layer (Phase 1) — public surface.
 *
 * Units, sampling metadata, the core signal representation, numeric guards, the
 * classified error taxonomy, and the ML inference contracts. Downstream layers
 * (DSP, ML, datasets) build on this API and must not reach past it into raw,
 * unitless numbers.
 */
export * from './error';
export * from './numeric';
export * from './units';
export * from './sampling';
export * from './signal';
export * from './record';
export * from './ml';
