/**
 * Dataset ingestion subsystem (Phase 5 / ADR-006) — public surface.
 *
 * The `DatasetAdapter` boundary plus its concrete adapters (MIT-BIH/WFDB, EDF /
 * EDF+ and a synthetic, file-free one), the format dispatch that chooses between
 * the file-backed ones, the hermetic in-memory file source, and the
 * subject-aware partition helpers. Everything exported here is browser-safe:
 *
 * - parsers consume `Uint8Array`/`string` through a `DatasetFileSource`;
 * - the node:fs implementation (`./nodeSource`) is deliberately NOT re-exported
 *   so Vite never pulls Node built-ins into the web bundle;
 * - the browser implementation (`./fileSource`, Phase 11 / ADR-012) IS exported:
 *   it is built on the Web `File`/`Blob` API and imports no Node built-in;
 * - `./dispatch` (Phase 18 / ADR-020) picks the adapter for a selection from the
 *   file names alone; it is pure, so it is Node-gated even though its callers
 *   are browser-only;
 * - adapters yield canonical, raw-ADC `SignalRecord`s; ADC -> mV conversion
 *   stays explicit in `./load`.
 */
export * from './types';
export * from './source';
export * from './fileSource';
export * from './partition';
export * from './load';
export * from './mitbih';
export * from './edf';
export * from './synthetic';
export * from './dispatch';
