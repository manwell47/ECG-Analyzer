/**
 * Browser dataset file source tests (Phase 11 / ADR-012, architecture §J).
 *
 * `WebFileSource` is the browser-side `DatasetFileSource` over the Web
 * `File`/`Blob` API. These tests pin the same contract as
 * [`source.test.ts`](source.test.ts:1) (text/binary round trips, verbatim
 * bytes, listing, empty entries and classified missing-file errors) plus the
 * two browser-specific guarantees: directory prefixes are stripped to bare
 * names, and duplicate bare names are rejected as a classified ambiguity.
 */
import { describe, expect, it } from 'vitest';

import { EcgError } from '../../domain/error';
import { WebFileSource, bareFileName, webFileSourceFrom } from '../fileSource';
import type { WebFileEntry } from '../fileSource';

const encoder = new TextEncoder();

function entry(name: string, bytes: Uint8Array): WebFileEntry {
    return {
        name,
        arrayBuffer: async (): Promise<ArrayBuffer> => bytes.slice().buffer,
    };
}

function textEntry(name: string, text: string): WebFileEntry {
    return entry(name, encoder.encode(text));
}

function buildSource(entries: readonly WebFileEntry[]): WebFileSource {
    return new WebFileSource(entries);
}

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

function constructErrorCode(fn: () => unknown): string | undefined {
    try {
        fn();
    } catch (error) {
        if (error instanceof EcgError) {
            return error.code;
        }
    }
    return undefined;
}

describe('WebFileSource text files', () => {
    it('round-trips UTF-8 text including non-ASCII content', async () => {
        const source = buildSource([textEntry('notes.txt', 'héllo — 世界 ✓')]);

        await expect(source.readTextFile('notes.txt')).resolves.toBe(
            'héllo — 世界 ✓',
        );
    });

    it('lists every file name the source can serve', async () => {
        const source = buildSource([
            textEntry('a.txt', '1'),
            textEntry('b.dat', '2'),
        ]);

        const names = await source.listFileNames();
        expect([...names].sort()).toEqual(['a.txt', 'b.dat']);
    });
});

describe('WebFileSource binary files', () => {
    it('returns the exact stored bytes verbatim', async () => {
        const source = buildSource([entry('100.dat', Uint8Array.of(1, 2, 3, 255))]);

        const got = await source.readBinaryFile('100.dat');
        expect(Array.from(got)).toEqual([1, 2, 3, 255]);
    });

    it('decodes text from the same bytes a binary read sees', async () => {
        const source = buildSource([textEntry('100.hea', '100 2 360 6')]);

        const binary = await source.readBinaryFile('100.hea');
        expect(Array.from(binary)).toEqual(
            Array.from(encoder.encode('100 2 360 6')),
        );
        await expect(source.readTextFile('100.hea')).resolves.toBe('100 2 360 6');
    });

    it('treats an empty entry as an empty file', async () => {
        const source = buildSource([entry('empty', new Uint8Array())]);

        expect(await source.readBinaryFile('empty')).toHaveLength(0);
        await expect(source.readTextFile('empty')).resolves.toBe('');
    });
});

describe('WebFileSource bare names', () => {
    it('strips a relative directory prefix from produced names', async () => {
        const source = buildSource([
            textEntry('mitdb/100.hea', 'header'),
            entry('mitdb/100.dat', Uint8Array.of(9)),
        ]);

        const names = await source.listFileNames();
        expect([...names].sort()).toEqual(['100.dat', '100.hea']);
        await expect(source.readTextFile('100.hea')).resolves.toBe('header');
        expect(Array.from(await source.readBinaryFile('100.dat'))).toEqual([9]);
    });

    it('normalises Windows separators', async () => {
        const source = buildSource([
            textEntry('data\\raw\\mitdb\\100.hea', 'header'),
        ]);

        expect(await source.listFileNames()).toEqual(['100.hea']);
        await expect(source.readTextFile('100.hea')).resolves.toBe('header');
    });

    it('bareFileName keeps a name that has no directory prefix', () => {
        expect(bareFileName('100.hea')).toBe('100.hea');
        expect(bareFileName('a/b/100.hea')).toBe('100.hea');
        expect(bareFileName('a\\b\\100.hea')).toBe('100.hea');
    });
});

describe('WebFileSource ambiguity and missing files', () => {
    it('rejects duplicate bare names with a classified ambiguity', () => {
        const code = constructErrorCode(() =>
            buildSource([textEntry('a/100.hea', 'x'), textEntry('b/100.hea', 'y')]),
        );

        expect(code).toBe('invalid-input');
    });

    it('throws file-not-found for missing text and binary reads', async () => {
        const source = buildSource([]);

        expect(await promiseErrorCode(source.readTextFile('nope.txt'))).toBe(
            'file-not-found',
        );
        expect(await promiseErrorCode(source.readBinaryFile('nope.dat'))).toBe(
            'file-not-found',
        );
    });
});

describe('WebFileSource over a real Web File', () => {
    it('accepts the global File surface (Node and browsers)', async () => {
        const source = webFileSourceFrom([
            new File([encoder.encode('héllo')], '100.hea'),
        ]);

        await expect(source.readTextFile('100.hea')).resolves.toBe('héllo');
        expect(await source.listFileNames()).toEqual(['100.hea']);
    });
});
