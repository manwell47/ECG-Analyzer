/**
 * Fixture layer public surface (Phase 2).
 *
 * Deterministic synthetic signal generators, a Db4 filterbank single-source,
 * property measurement helpers and the golden reference registry. Everything in
 * this layer is reproducible from a recipe and carries recorded properties so
 * later phases (DSP core, DWT) can be validated against known-good artifacts.
 *
 * Note: {@link golden} depends on Node's fs/path and is only reachable from
 * tests and the `fixtures:write` script — it is never imported by the browser
 * bundle.
 */
export * from './rng';
export * from './measure';
export * from './db4';
export * from './signals';
export * from './golden';
