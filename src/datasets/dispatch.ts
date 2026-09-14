/**
 * Dataset-format dispatch (Phase 18 item 6 / ADR-020, architecture §J).
 *
 * The application has to accept more than one file layout through one picker,
 * so *something* must decide which `DatasetAdapter` a selection belongs to. That
 * decision is made here, as a pure function over the file names a source
 * already exposes, so it can be reasoned about and tested without a browser
 * (the browser-only module that wires a source to a service simply calls into
 * this one).
 *
 * The rule is keyed on the file extensions that *identify a record set*, never
 * on file contents and never on the order files were picked:
 *
 * - `.hea` present (and no `.edf`) → MIT-BIH / WFDB;
 * - `.edf` present (and no `.hea`) → EDF / EDF+;
 * - both → refused as `unsupported-format` (a mixed selection has no single
 *   record space, so nothing sensible can be discovered);
 * - neither → refused as `unsupported-format`, naming what was looked for.
 *
 * This is deliberately the only place a format is inferred. Downstream code
 * receives an explicit `DatasetFormat` and cannot silently fall back to one
 * adapter when it was handed files for the other.
 */
import { EcgError } from '../domain/error';
import type { RecordId } from '../domain/record';
import { EdfDatasetAdapter } from './edf/adapter';
import { MitBihDatasetAdapter } from './mitbih/adapter';
import { discoverMitBihRecordIds } from './mitbih/catalog';
import type { DatasetFileSource } from './source';
import type { DatasetAdapter } from './types';

/** The dataset layouts this build can ingest. */
export type DatasetFormat = 'mit-bih' | 'edf';

/** Extension identifying a WFDB/MIT-BIH record set. */
const MIT_BIH_EXTENSION = 'hea';

/** Extension identifying an EDF/EDF+ record. */
const EDF_EXTENSION = 'edf';

/** Count the file names carrying an extension, case-insensitively. */
function countExtension(fileNames: readonly string[], extension: string): number {
    const suffix = `.${extension}`;
    let count = 0;
    for (const name of fileNames) {
        if (name.toLowerCase().endsWith(suffix)) {
            count += 1;
        }
    }
    return count;
}

/**
 * Decide which dataset layout a set of file names belongs to.
 *
 * Refuses a mixed selection and an unrecognised one with `unsupported-format`,
 * naming the counts it saw so the message says what to change.
 */
export function detectDatasetFormat(fileNames: readonly string[]): DatasetFormat {
    const headers = countExtension(fileNames, MIT_BIH_EXTENSION);
    const records = countExtension(fileNames, EDF_EXTENSION);

    if (headers > 0 && records > 0) {
        throw EcgError.unsupportedFormat(
            `The selection mixes dataset formats: ${headers} WFDB ".hea" ` +
            `header(s) and ${records} EDF ".edf" file(s). Open one dataset at a time.`,
            { meta: { headers, records } },
        );
    }
    if (headers > 0) {
        return 'mit-bih';
    }
    if (records > 0) {
        return 'edf';
    }
    throw EcgError.unsupportedFormat(
        `The selection holds ${fileNames.length} file(s), none of them a ` +
        'recognized dataset: expected WFDB ".hea" headers (MIT-BIH) or EDF ' +
        '".edf" records.',
        { meta: { fileCount: fileNames.length } },
    );
}

/** Discover the record ids a source can serve for one known format. */
export async function discoverRecordIdsFor(
    source: DatasetFileSource,
    format: DatasetFormat,
): Promise<readonly RecordId[]> {
    switch (format) {
        case 'mit-bih':
            return discoverMitBihRecordIds(source);
        case 'edf':
            return new EdfDatasetAdapter(source).listRecordIds();
    }
}

/** Build the adapter an already-detected format calls for. */
export function createDatasetAdapter(
    source: DatasetFileSource,
    format: DatasetFormat,
): DatasetAdapter {
    switch (format) {
        case 'mit-bih':
            return new MitBihDatasetAdapter(source);
        case 'edf':
            return new EdfDatasetAdapter(source);
    }
}

/**
 * Detect the format of a source and discover its record ids in one step.
 *
 * The ids and the format are resolved together on purpose: they are the two
 * facts the composition root needs, and resolving them separately would let a
 * caller pair a format with ids discovered for another.
 */
export async function prepareDatasetSource(
    source: DatasetFileSource,
): Promise<{ readonly format: DatasetFormat; readonly recordIds: readonly RecordId[] }> {
    const format = detectDatasetFormat(await source.listFileNames());
    return { format, recordIds: await discoverRecordIdsFor(source, format) };
}
