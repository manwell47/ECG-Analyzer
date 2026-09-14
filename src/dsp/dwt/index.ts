/**
 * Phase-4 DWT / IDWT (ADR-003) — public surface.
 *
 * Wavelet catalog resolution and the periodic DWT / IDWT decomposition and
 * reconstruction primitives, exposed through both the low-level array API and
 * the domain `Signal` API. Everything is pure, deterministic and browser-safe
 * (no I/O). Only the `db4` wavelet and periodic extension are seeded in
 * Phase 4; see `./catalog` and `./dwt` module docstrings for the explicit
 * length policy and the deferred external wavelib-capture gate.
 */
export * from './catalog';
export * from './dwt';
