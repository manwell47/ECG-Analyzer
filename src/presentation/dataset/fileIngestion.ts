/**
 * Browser-local WFDB ingestion glue (Phase 11 / ADR-012, architecture §J).
 *
 * This module turns the two portable browser selection mechanisms into the very
 * same `DatasetFileSource` seam every MIT-BIH parser/adapter already consumes,
 * so no parser, adapter or DSP code changes and the adapter stays
 * source-agnostic (rules §30):
 *
 * - an `<input type="file" multiple>` / drag-and-drop `FileList` (works in every
 *   browser, and is the accessible, keyboard-reachable path); and
 * - a File System Access directory handle (Chromium-only progressive
 *   enhancement) walked through `handle.values()`.
 *
 * Both funnels end in [`WebFileSource`](../../datasets/fileSource.ts:56), which
 * strips any directory prefix so the seam's "bare file names" contract holds.
 * The selection's *format* is then detected from the extensions it holds and its
 * record ids discovered for that format, both by the pure dispatch in
 * [`prepareDatasetSource`](../../datasets/dispatch.ts:1) (Phase 18 / ADR-020):
 * MIT-BIH ids come from the `.hea` headers present rather than a `RECORDS`
 * control file, because a locally picked directory usually has none (the strict
 * `RECORDS` path stays the CLI/validation default), while EDF ids are the
 * `.edf` stems present. A selection of neither kind — or a mixture of both — is
 * refused as a classified `unsupported-format` instead of silently yielding [].
 *
 * Browser-only by construction: it imports no `node:*` built-in and is covered
 * by typecheck, lint and the production build, not by vitest (which only scans
 * `*.test.ts`). Everything it returns is an ordinary, testable dataset source.
 */

import type { RecordId } from '../../domain/record';
import {
    prepareDatasetSource,
    WebFileSource,
    type DatasetFormat,
} from '../../datasets';

/** A picked local dataset: its file source, its layout and the ids it serves. */
export interface IngestedDataset {
    /** The (bare-named) file-source seam over the user's selection. */
    readonly source: WebFileSource;
    /** Record ids discovered for the detected format, sorted. */
    readonly recordIds: readonly RecordId[];
    /** The layout the selection was detected as (`'mit-bih'` or `'edf'`). */
    readonly format: DatasetFormat;
}

/**
 * Build a {@link WebFileSource} over a multi-file selection. A `FileList` from
 * an input/drop and a plain `File[]` both reduce to the same entries; duplicate
 * bare names are rejected by the source itself (classified `invalid-input`).
 */
export function webFileSourceFromFiles(files: FileList | readonly File[]): WebFileSource {
    return new WebFileSource(Array.from(files));
}

/**
 * Build a {@link WebFileSource} by walking a picked directory's **top-level**
 * file entries. The WFDB recording layout is flat (one `RECORDS`/`.hea`/`.dat`/
 * `.atr` set per directory), so sub-directories are deliberately not descended
 * — that keeps the bare-name uniqueness the source enforces well-defined.
 */
export async function webFileSourceFromDirectoryHandle(
    handle: FileSystemDirectoryHandle,
): Promise<WebFileSource> {
    const entries: File[] = [];
    for await (const entry of handle.values()) {
        if (entry.kind === 'file') {
            entries.push(await entry.getFile());
        }
    }
    return new WebFileSource(entries);
}

/**
 * Detect a source's format and discover the record ids it serves.
 *
 * One shared funnel so both selection mechanisms behave identically: the format
 * is resolved once, from the same file list the ids are discovered from, and a
 * selection belonging to neither format (or to both) is refused here rather than
 * surfacing later as an empty, unexplained record list.
 */
async function ingest(source: WebFileSource): Promise<IngestedDataset> {
    const { format, recordIds } = await prepareDatasetSource(source);
    return { source, recordIds, format };
}

/** Ingest a multi-file selection and discover the record ids it contains. */
export async function ingestFiles(
    files: FileList | readonly File[],
): Promise<IngestedDataset> {
    return ingest(webFileSourceFromFiles(files));
}

/** Ingest a picked directory handle and discover the record ids it contains. */
export async function ingestDirectoryHandle(
    handle: FileSystemDirectoryHandle,
): Promise<IngestedDataset> {
    return ingest(await webFileSourceFromDirectoryHandle(handle));
}

/** Whether this browser exposes the (Chromium-only) directory picker. */
export function isDirectoryPickerSupported(): boolean {
    return typeof showDirectoryPicker === 'function';
}

/**
 * Open the native directory picker and return the chosen directory handle.
 * Returns `undefined` when the browser does not support the API **or** the user
 * cancels the dialog (an `AbortError`), so the caller can treat both as "no
 * selection" without a special case. Any other failure propagates.
 */
export async function pickDirectory(): Promise<FileSystemDirectoryHandle | undefined> {
    if (!isDirectoryPickerSupported()) {
        return undefined;
    }
    try {
        return await showDirectoryPicker({ mode: 'read' });
    } catch (error) {
        if (isAbortError(error)) {
            return undefined;
        }
        throw error;
    }
}

/** Whether a rejected picker promise is the user cancelling the dialog. */
function isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
}
