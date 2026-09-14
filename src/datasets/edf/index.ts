/**
 * EDF / EDF+ dataset adapter (Phase 18 item 6 / ADR-020, architecture §J).
 *
 * Browser-safe: nothing here touches Node built-ins, so the modules are
 * re-exported from the `src/datasets/index.ts` barrel alongside the MIT-BIH and
 * synthetic adapters.
 */
export * from './header';
export * from './calibration';
export * from './decode';
export * from './adapter';
