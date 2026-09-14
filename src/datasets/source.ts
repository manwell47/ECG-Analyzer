/**
 * Raw dataset file access (Phase 5 / ADR-006, architecture §J).
 *
 * `DatasetFileSource` is the narrow file-I/O seam that every `DatasetAdapter`
 * is built on. Keeping it an explicit interface means:
 *
 * - the MIT-BIH adapter can be tested hermetically against `InMemoryFileSource`
 *   (no real files, deterministic, committed fixtures only);
 * - the browser build never needs node built-ins — the node:fs implementation
 *   lives in `nodeSource.ts`, which is deliberately NOT re-exported from the
 *   dataset barrel (`index.ts`) so Vite never pulls it in;
 * - a future WASM/OPFS or remote source can drop in without touching parsers.
 *
 * File names are bare (e.g. `100.hea`); any directory rooting is the source's
 * responsibility.
 */
import { EcgError } from '../domain/error';

/** Raw, adapter-agnostic access to one dataset directory of files. */
export interface DatasetFileSource {
    /** Read a UTF-8 text file (headers, RECORDS, comments). */
    readTextFile(fileName: string): Promise<string>;
    /** Read a binary file verbatim (`.dat` signals, `.atr` annotations). */
    readBinaryFile(fileName: string): Promise<Uint8Array>;
    /** List every file name the source can serve, in any order. */
    listFileNames(): Promise<readonly string[]>;
}

/** One entry of an {@link InMemoryFileSource}; supply text or raw bytes. */
export interface InMemoryFileEntry {
    /** UTF-8 text content (used when `bytes` is omitted). */
    readonly text?: string;
    /** Raw byte content; takes precedence over `text`. */
    readonly bytes?: Uint8Array;
}

function missingFile(fileName: string): EcgError {
    return EcgError.fileNotFound(
        `Dataset file "${fileName}" was not found in the source.`,
        { meta: { fileName } },
    );
}

/**
 * In-memory {@link DatasetFileSource} for hermetic tests and committed fixture
 * adapters. Deterministic; never touches the file system.
 */
export class InMemoryFileSource implements DatasetFileSource {
    private readonly files: ReadonlyMap<string, Uint8Array>;
    private readonly encoder = new TextEncoder();
    private readonly decoder = new TextDecoder();

    constructor(entries: Readonly<Record<string, InMemoryFileEntry>>) {
        const files = new Map<string, Uint8Array>();
        for (const [name, entry] of Object.entries(entries)) {
            const bytes =
                entry.bytes ??
                (entry.text === undefined
                    ? new Uint8Array()
                    : this.encoder.encode(entry.text));
            files.set(name, bytes);
        }
        this.files = files;
    }

    async readTextFile(fileName: string): Promise<string> {
        const bytes = this.files.get(fileName);
        if (bytes === undefined) {
            throw missingFile(fileName);
        }
        return this.decoder.decode(bytes);
    }

    async readBinaryFile(fileName: string): Promise<Uint8Array> {
        const bytes = this.files.get(fileName);
        if (bytes === undefined) {
            throw missingFile(fileName);
        }
        return bytes;
    }

    async listFileNames(): Promise<readonly string[]> {
        return [...this.files.keys()];
    }
}
