/**
 * Dataset boundary contracts (Phase 5 / ADR-006, architecture §E.2, §J).
 *
 * A `DatasetAdapter` is the *only* way a downstream layer obtains data: it
 * turns raw, format-specific files into the canonical, format-agnostic
 * `SignalRecord` defined in the domain layer. The domain stays free of WFDB
 * vocabulary; anything MIT-BIH-shaped (`.hea`, `.dat`, `.atr`) lives behind
 * this boundary.
 */
import type { DatasetId, RecordId, SignalRecord } from '../domain/record';

/** Options controlling how a record is materialised. */
export interface ReadRecordOptions {
    /**
     * Whether to parse and attach annotation events (e.g. `.atr`). Defaults to
     * `true`. Set `false` to skip annotation files when only the waveform is
     * needed.
     */
    readonly withAnnotations?: boolean;
}

/**
 * A dataset that can be browsed and read into canonical `SignalRecord`s.
 *
 * Implementations are immutable, stateless-after-construction and safe to
 * share across reads; they never cache mutable signal buffers.
 */
export interface DatasetAdapter {
    /** Stable dataset identity reported on every record (e.g. `mit-bih-arrhythmia`). */
    readonly datasetId: DatasetId;
    /** The record identifiers this dataset can serve (canonical order). */
    listRecordIds(): Promise<readonly RecordId[]>;
    /**
     * Materialise one record. Throws a classified `EcgError`:
     * `file-not-found` (missing file), `malformed-header` (unparsable or
     * internally inconsistent header/data), `unsupported-format` (unrecognised
     * encoding), or `annotation-parse-error` (unparsable annotation file).
     */
    readRecord(
        recordId: RecordId,
        options?: Readonly<ReadRecordOptions>,
    ): Promise<SignalRecord>;
}
