/**
 * MIT-BIH / WFDB adapter (Phase 5 / ADR-006) — public surface.
 *
 * Parsers (`.hea` header, format-212/16 `.dat` decoders, `.atr` annotations),
 * the RECORDS-validating catalog, and the `DatasetAdapter` implementation that
 * assembles them into canonical `SignalRecord`s. Everything here is browser-safe
 * (pure parsing over bytes/text supplied through a `DatasetFileSource`).
 */
export * from './header';
export * from './format212';
export * from './atr';
export * from './catalog';
export * from './adapter';
