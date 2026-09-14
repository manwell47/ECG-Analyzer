/**
 * node:fs {@link DatasetFileSource} for CLI/dev tooling only (Phase 5 / ADR-006).
 *
 * This file intentionally imports Node built-ins and is therefore NOT re-exported
 * from `src/datasets/index.ts`: Vite and the browser bundle must never pull in
 * `node:fs` (architecture §E.2 / ADR-005 browser-worker strategy). It is used by
 * the `data/raw` fixture pipeline and by future offline/CLI evaluation, never by
 * the in-browser application.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EcgError } from '../domain/error';
import type { DatasetFileSource } from './source';

function toFileNotFound(fileName: string, error: unknown): Error {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return EcgError.fileNotFound(
            `Dataset file "${fileName}" was not found under the source root.`,
            { meta: { fileName }, cause: error },
        );
    }
    return error instanceof Error ? error : new Error(String(error));
}

/** A directory-backed {@link DatasetFileSource}. */
export class NodeFileSource implements DatasetFileSource {
    constructor(private readonly rootDir: string) { }

    async listFileNames(): Promise<readonly string[]> {
        return readdir(this.rootDir);
    }

    async readTextFile(fileName: string): Promise<string> {
        try {
            return await readFile(join(this.rootDir, fileName), 'utf8');
        } catch (error) {
            throw toFileNotFound(fileName, error);
        }
    }

    async readBinaryFile(fileName: string): Promise<Uint8Array> {
        try {
            const buffer = await readFile(join(this.rootDir, fileName));
            return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        } catch (error) {
            throw toFileNotFound(fileName, error);
        }
    }
}
