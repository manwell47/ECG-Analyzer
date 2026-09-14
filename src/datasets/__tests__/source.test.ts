/**
 * In-memory dataset file source tests (Phase 5 / ADR-006, architecture §J).
 *
 * `DatasetFileSource` is the narrow file-I/O seam every adapter is built on.
 * `InMemoryFileSource` is the hermetic, deterministic implementation used by
 * tests and committed fixtures. These tests pin down its exact contract:
 * text/binary round trips, raw-bytes precedence, instance identity for binary
 * reads, empty entries and classified missing-file errors.
 */
import { describe, expect, it } from 'vitest';

import { EcgError } from '../../domain/error';
import { InMemoryFileSource } from '../source';

async function promiseErrorCode(
    promise: Promise<unknown>,
): Promise<string | undefined> {
    try {
        await promise;
    } catch (error) {
        if (error instanceof EcgError) {
            return error.code;
        }
    }
    return undefined;
}

describe('InMemoryFileSource text files', () => {
    it('round-trips UTF-8 text including non-ASCII content', async () => {
        const source = new InMemoryFileSource({
            'notes.txt': { text: 'héllo — 世界 ✓' },
        });

        await expect(source.readTextFile('notes.txt')).resolves.toBe(
            'héllo — 世界 ✓',
        );
    });

    it('lists every file name the source can serve', async () => {
        const source = new InMemoryFileSource({
            'a.txt': { text: '1' },
            'b.dat': { text: '2' },
        });

        const names = await source.listFileNames();
        expect([...names].sort()).toEqual(['a.txt', 'b.dat']);
    });
});

describe('InMemoryFileSource binary files', () => {
    it('returns the exact stored Uint8Array instance (no defensive copy)', async () => {
        const bytes = Uint8Array.of(1, 2, 3, 255);
        const source = new InMemoryFileSource({ '100.dat': { bytes } });

        const got = await source.readBinaryFile('100.dat');
        expect(got).toBe(bytes);
    });

    it('gives raw bytes precedence over text for the same entry', async () => {
        const source = new InMemoryFileSource({
            '100.hea': {
                text: 'this text is ignored',
                bytes: Uint8Array.of(49, 48, 48), // ASCII "100"
            },
        });

        const binary = await source.readBinaryFile('100.hea');
        expect(Array.from(binary)).toEqual([49, 48, 48]);

        // A text read of the same entry also yields the bytes, not the text.
        await expect(source.readTextFile('100.hea')).resolves.toBe('100');
    });

    it('treats an empty entry as an empty file', async () => {
        const source = new InMemoryFileSource({ empty: {} });

        const bytes = await source.readBinaryFile('empty');
        expect(bytes).toBeInstanceOf(Uint8Array);
        expect(bytes).toHaveLength(0);

        await expect(source.readTextFile('empty')).resolves.toBe('');
    });
});

describe('InMemoryFileSource missing files', () => {
    it('throws file-not-found for missing text and binary reads', async () => {
        const source = new InMemoryFileSource({});

        const textCode = await promiseErrorCode(
            source.readTextFile('nope.txt'),
        );
        const binaryCode = await promiseErrorCode(
            source.readBinaryFile('nope.dat'),
        );

        expect(textCode).toBe('file-not-found');
        expect(binaryCode).toBe('file-not-found');
    });
});
