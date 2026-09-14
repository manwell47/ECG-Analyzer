/**
 * `NodeFileSource` temporary-directory tests (Phase 11 / ADR-012).
 *
 * `NodeFileSource` is the `node:fs` implementation of `DatasetFileSource`, used
 * by CLI/dev tooling and by the source-seam parity gate — never by the browser
 * bundle (it is deliberately not re-exported from the dataset barrel). These
 * tests pin its contract against a real temporary directory: it lists exactly
 * the files present, reads UTF-8 text losslessly, reads binary byte-for-byte
 * (including values >= 0x80), and classifies a missing read as `file-not-found`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { EcgError } from '../../domain/error';
import { NodeFileSource } from '../nodeSource';

const BINARY = Uint8Array.from([0, 1, 2, 127, 128, 253, 254, 255]);
const TEXT = 'héllo wörld — π — Δ\n';

async function promiseErrorCode(promise: Promise<unknown>): Promise<string | undefined> {
    try {
        await promise;
    } catch (error) {
        if (error instanceof EcgError) {
            return error.code;
        }
    }
    return undefined;
}

describe('NodeFileSource (temporary directory)', () => {
    let dir = '';
    let source: NodeFileSource;

    beforeAll(async () => {
        dir = await mkdtemp(join(tmpdir(), 'ecg-nodesource-'));
        await writeFile(join(dir, 'note.hea'), TEXT, 'utf8');
        await writeFile(join(dir, 'blob.dat'), BINARY);
        source = new NodeFileSource(dir);
    });

    afterAll(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it('lists exactly the files present in the root directory', async () => {
        expect([...(await source.listFileNames())].sort()).toEqual([
            'blob.dat',
            'note.hea',
        ]);
    });

    it('reads UTF-8 text losslessly, including non-ASCII content', async () => {
        expect(await source.readTextFile('note.hea')).toBe(TEXT);
    });

    it('reads binary verbatim, including bytes >= 0x80', async () => {
        expect(Array.from(await source.readBinaryFile('blob.dat'))).toEqual(
            Array.from(BINARY),
        );
    });

    it('throws file-not-found for missing text and binary reads', async () => {
        expect(await promiseErrorCode(source.readTextFile('absent.hea'))).toBe(
            'file-not-found',
        );
        expect(await promiseErrorCode(source.readBinaryFile('absent.dat'))).toBe(
            'file-not-found',
        );
    });
});
