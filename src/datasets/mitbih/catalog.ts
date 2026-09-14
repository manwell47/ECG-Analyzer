/**
 * MIT-BIH directory catalog + RECORDS validation (Phase 5 / ADR-006, §J).
 *
 * A `catalogMitBih(source)` call summarises every record the directory can
 * serve, without materialising any waveform:
 *
 * - it reads the canonical `RECORDS` file (throwing `file-not-found` when it is
 *   absent — validation against `RECORDS` is a Phase-5 requirement);
 * - it inventories the files present and reports, per record id, which of
 *   `.hea` / `.dat` / `.atr` exist;
 * - it parses each `.hea` header (never failing the whole catalog on one bad
 *   record) to say whether the record is `readable` by this adapter and whether
 *   it is `complete` (every declared data file is present);
 * - it surfaces `unexpectedEntries` (files that do not match a known
 *   `<record>.<hea|dat|atr>` shape nor the `RECORDS` control file, e.g. stray
 *   `.xws` or `.at_` copies) so a partially copied dataset can be diagnosed
 *   before any read.
 *
 * Only MIT-BIH's own layout is catalogued. `recordId` is the leading stem of
 * the file names (`100.hea` -> `'100'`), matching both the `RECORDS` lines and
 * the header's own record name.
 *
 * `discoverMitBihRecordIds(source)` is the tolerant sibling used by the
 * browser-local ingestion path (Phase 11 / ADR-012): it derives ids from the
 * `.hea` headers actually present, so a directory without a `RECORDS` control
 * file is still usable. The strict, `RECORDS`-validating `listMitBihRecordIds`
 * and `catalogMitBih` are unchanged.
 */
import { EcgError } from '../../domain/error';
import type { RecordId } from '../../domain/record';
import type { DatasetFileSource } from '../source';
import { parseMitBihHeader } from './header';

/** A summary of one record found (or declared) in the source directory. */
export interface MitBihCatalogEntry {
    /** Record id, e.g. `'100'`. */
    readonly recordId: RecordId;
    /** Whether the id appears in the `RECORDS` file. */
    readonly inRecords: boolean;
    /** Whether `<recordId>.hea` is present. */
    readonly hasHeader: boolean;
    /** Whether `<recordId>.dat` is present. */
    readonly hasDat: boolean;
    /** Whether `<recordId>.atr` is present. */
    readonly hasAtr: boolean;
    /** True when a header exists and every data file it declares is present. */
    readonly complete: boolean;
    /** True when the `.hea` parses to a supported, internally consistent layout. */
    readonly readable: boolean;
    /** True when an annotation file is present (not necessarily parsed). */
    readonly annotated: boolean;
    /** Human-readable reason when `readable`/`complete` are false. */
    readonly problem?: string;
}

/** Result of cataloguing one MIT-BIH directory source. */
export interface MitBihCatalog {
    /** Canonical `RECORDS` order first, then any extra header-discovered records. */
    readonly records: readonly MitBihCatalogEntry[];
    /**
     * File names that fit neither a `<record>.<hea|dat|atr>` shape nor the
     * canonical `RECORDS` control file.
     */
    readonly unexpectedEntries: readonly string[];
}

/** File extensions that belong to a MIT-BIH record (lowercase). */
export const MIT_BIH_RECORD_EXTENSIONS: readonly string[] = ['hea', 'dat', 'atr'] as const;

interface FileShape {
    readonly stem: string;
    readonly ext: string;
}

function splitFileName(fileName: string): FileShape {
    const dot = fileName.lastIndexOf('.');
    if (dot <= 0) {
        return { stem: fileName, ext: '' };
    }
    return { stem: fileName.slice(0, dot), ext: fileName.slice(dot + 1).toLowerCase() };
}

/** Read the canonical `RECORDS` file into ordered record ids. */
export async function listMitBihRecordIds(
    source: DatasetFileSource,
): Promise<readonly RecordId[]> {
    const text = await source.readTextFile('RECORDS'); // throws file-not-found
    const ids: RecordId[] = [];
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (line.length === 0 || line.startsWith('#')) {
            continue;
        }
        const id = line.split(/\s+/)[0];
        if (id !== undefined && id.length > 0) {
            ids.push(id);
        }
    }
    return ids;
}

/**
 * Discover the record ids a source can serve by the `.hea` headers it holds,
 * without requiring the canonical `RECORDS` control file (Phase 11 / ADR-012).
 *
 * This is the browser-local counterpart to the strict `listMitBihRecordIds`: a
 * directory picked through the File System Access API, or a multi-file
 * selection, often has no `RECORDS` file, so discovery falls back to the
 * headers actually present. It ignores every non-`.hea` entry, deduplicates the
 * stems, and returns them in deterministic ascending order; an empty (or
 * header-less) directory yields `[]` rather than throwing.
 */
export async function discoverMitBihRecordIds(
    source: DatasetFileSource,
): Promise<readonly RecordId[]> {
    const fileNames = await source.listFileNames();
    const ids = new Set<string>();
    for (const name of fileNames) {
        const { stem, ext } = splitFileName(name);
        if (ext === 'hea' && stem.length > 0) {
            ids.add(stem);
        }
    }
    return [...ids].sort();
}

/**
 * Inventory a MIT-BIH directory source. Never throws for a malformed record —
 * per-record problems are folded into `readable`/`complete`/`problem`. It does
 * throw `file-not-found` when the canonical `RECORDS` file is absent, since
 * validation against `RECORDS` is required.
 */
export async function catalogMitBih(source: DatasetFileSource): Promise<MitBihCatalog> {
    const declaredIds = await listMitBihRecordIds(source);
    const declaredSet = new Set(declaredIds);
    const fileNames = await source.listFileNames();

    // Inventory files: stem -> set of extensions present.
    const filesByStem = new Map<string, Set<string>>();
    const unexpectedEntries: string[] = [];
    for (const name of fileNames) {
        // The canonical `RECORDS` control file is expected (it names the
        // records rather than belonging to one), so it is not an unexpected
        // entry.
        if (name === 'RECORDS') {
            continue;
        }
        const { stem, ext } = splitFileName(name);
        if (!MIT_BIH_RECORD_EXTENSIONS.includes(ext)) {
            unexpectedEntries.push(name);
            continue;
        }
        const present = filesByStem.get(stem) ?? new Set<string>();
        present.add(ext);
        filesByStem.set(stem, present);
    }

    const hasFile = (stem: string, ext: string): boolean =>
        (filesByStem.get(stem)?.has(ext) ?? false);

    // Canonical order: RECORDS ids first, then any header-bearing extra stems.
    const recordIds: string[] = [...declaredIds];
    for (const [stem, exts] of filesByStem) {
        if (exts.has('hea') && !declaredSet.has(stem)) {
            recordIds.push(stem);
        }
    }

    const entries: MitBihCatalogEntry[] = [];
    for (const recordId of recordIds) {
        const hasHeader = hasFile(recordId, 'hea');
        const hasDat = hasFile(recordId, 'dat');
        const hasAtr = hasFile(recordId, 'atr');

        let complete = false;
        let readable = false;
        let problem: string | undefined;

        if (!hasHeader) {
            problem = 'no .hea header file present.';
        } else {
            try {
                const header = parseMitBihHeader(await source.readTextFile(`${recordId}.hea`));
                if (header.recordName !== recordId) {
                    throw EcgError.malformedHeader(
                        `Header declares record "${header.recordName}" but the file ` +
                        `is named "${recordId}.hea".`,
                    );
                }
                readable = true;
                const declaredFiles = new Set(
                    header.channels.map((channel) => channel.fileBase),
                );
                const missing = [...declaredFiles].filter(
                    (fileBase) => !fileNames.includes(fileBase),
                );
                if (missing.length > 0) {
                    problem = `missing declared data file(s): ${missing.join(', ')}.`;
                } else {
                    complete = true;
                }
            } catch (error) {
                problem =
                    error instanceof Error
                        ? error.message
                        : 'header parse failed for an unknown reason.';
            }
        }

        entries.push({
            recordId,
            inRecords: declaredSet.has(recordId),
            hasHeader,
            hasDat,
            hasAtr,
            complete,
            readable,
            annotated: hasAtr,
            ...(problem === undefined ? {} : { problem }),
        });
    }

    const frozenEntries = entries.map((entry) => Object.freeze(entry));

    return {
        records: Object.freeze(frozenEntries),
        unexpectedEntries: Object.freeze([...unexpectedEntries]),
    };
}
