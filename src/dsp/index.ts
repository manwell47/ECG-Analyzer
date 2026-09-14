/**
 * DSP subsystem (Phase 3 + Phase 4) — public surface.
 *
 * Pure functions over domain `Signal` types (ADR-002). Everything here is
 * deterministic, never mutates its input, and returns new domain types with
 * provenance appended. This module must never be imported by `ml/`,
 * `presentation/`, or any framework layer.
 */
export * from './helpers';
export * from './filter';
export * from './normalize';
export * from './resample';
export * from './segment';
export * from './dwt';
