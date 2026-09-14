/**
 * Browser {@link DatasetFileSource} over the Web `File`/`Blob` API (Phase 11 /
 * ADR-012, architecture §J).
 *
 * This is the browser-side counterpart of `nodeSource.ts`: it reads the bytes a
 * user selected locally (`<input type="file">`, drag-and-drop, or a File System
 * Access directory handle walked by the presentation layer) and exposes them
 * through the same three-method seam every MIT-BIH parser/adapter already
 * consumes. No parser, adapter or DSP code changes; the adapter stays
 * source-agnostic.
 *
 * Browser safety: this module imports no Node built-in, so it is safe to export
 * from `src/datasets/index.ts` and to bundle for the browser. It is also
 * testable in Node, because Node defines a global `File`/`Blob` with the same
 * `name` + `arrayBuffer()` surface.
 *
 * File names are bare (e.g. `100.hea`); any directory prefix a producer happens
 * to include (`webkitRelativePath`, a walked handle path, a Windows separator)
 * is stripped here so the seam's "file names are bare" contract holds.
 */
import { EcgError } from '../domain/error';
import type { DatasetFileSource } from './source';

/**
 * The minimal structural view of a Web `File`/`Blob` this source needs. A real
 * `File` satisfies it directly; the File System Access helper and tests may
 * supply an equivalent object.
 */
export interface WebFileEntry {
    /** File name as the producer knows it (any directory prefix is stripped). */
    readonly name: string;
    /** Read the file's bytes verbatim. */
    arrayBuffer(): Promise<ArrayBuffer>;
}

/** Final path segment of a producer-supplied name, normalising separators. */
export function bareFileName(name: string): string {
    const normalized = name.replace(/\\/g, '/');
    const slash = normalized.lastIndexOf('/');
    return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

function missingFile(fileName: string): EcgError {
    return EcgError.fileNotFound(
        `Dataset file "${fileName}" was not found in the source.`,
        { meta: { fileName } },
    );
}

/**
 * {@link DatasetFileSource} over Web `File`/`Blob` entries. Bytes are read
 * lazily from each entry on demand (`arrayBuffer()`), so nothing is copied up
 * front. Duplicate bare names are rejected at construction: an ambiguous
 * selection must fail loudly rather than silently shadow a record file.
 */
export class WebFileSource implements DatasetFileSource {
    private readonly entries: ReadonlyMap<string, WebFileEntry>;
    private readonly decoder = new TextDecoder();

    constructor(entries: readonly WebFileEntry[]) {
        const byName = new Map<string, WebFileEntry>();
        for (const entry of entries) {
            const name = bareFileName(entry.name);
            if (byName.has(name)) {
                throw EcgError.invalidInput(
                    `Dataset selection contains more than one file named "${name}"; ` +
                    'file names must be unique within a dataset directory.',
                    { meta: { fileName: name } },
                );
            }
            byName.set(name, entry);
        }
        this.entries = byName;
    }

    async readTextFile(fileName: string): Promise<string> {
        return this.decoder.decode(await this.binaryOf(fileName));
    }

    async readBinaryFile(fileName: string): Promise<Uint8Array> {
        return this.binaryOf(fileName);
    }

    async listFileNames(): Promise<readonly string[]> {
        return [...this.entries.keys()];
    }

    private async binaryOf(fileName: string): Promise<Uint8Array> {
        const entry = this.entries.get(fileName);
        if (entry === undefined) {
            throw missingFile(fileName);
        }
        return new Uint8Array(await entry.arrayBuffer());
    }
}

/** Convenience factory mirroring the `new InMemoryFileSource(...)` ergonomics. */
export function webFileSourceFrom(entries: readonly WebFileEntry[]): WebFileSource {
    return new WebFileSource(entries);
}
