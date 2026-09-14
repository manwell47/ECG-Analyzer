/**
 * MIT-BIH catalog / RECORDS validation tests (Phase 5 / ADR-006, §J).
 *
 * The catalog must (a) throw `file-not-found` when the canonical `RECORDS` file
 * is absent, (b) report `readable`/`complete`/`annotated` per record without
 * ever throwing on one malformed record, (c) keep `RECORDS` order first and
 * surface unrecognised files as `unexpectedEntries`.
 */
import { describe, expect, it } from 'vitest';

import { EcgError } from '../../../domain/error';
import { catalogMitBih, discoverMitBihRecordIds, listMitBihRecordIds } from '../catalog';
import { WebFileSource } from '../../fileSource';
import type { WebFileEntry } from '../../fileSource';
import { InMemoryFileSource } from '../../source';

const RECORD_100_HEA = [
    '100 2 360 650000',
    '100.dat 212 200 11 1024 995 -22131 0 MLII',
    '100.dat 212 200 11 1024 1011 20052 0 V5',
].join('\n');

const RECORD_101_HEA = [
    '101 2 360 650000',
    '101.dat 212 200 11 1024 0 0 0 MLII',
    '101.dat 212 200 11 1024 0 0 0 V5',
].join('\n');

// Declares a data file (102.dat) that is deliberately absent from the source.
const RECORD_102_HEA = [
    '102 1 360 650000',
    '102.dat 16 200 11 1024 0 0 0 II',
].join('\n');

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

describe('listMitBihRecordIds (RECORDS reader)', () => {
    it('returns declared ids in file order, skipping comments and blank lines', async () => {
        const source = new InMemoryFileSource({
            RECORDS: { text: '# subset of MIT-BIH\n\n100 extra-token\n101\n' },
        });
        expect(await listMitBihRecordIds(source)).toEqual(['100', '101']);
    });

    it('throws file-not-found when RECORDS is absent', async () => {
        const source = new InMemoryFileSource({});
        expect(await promiseErrorCode(listMitBihRecordIds(source))).toBe(
            'file-not-found',
        );
    });
});

describe('discoverMitBihRecordIds (header discovery, no RECORDS)', () => {
    const emptyEntry = (name: string): WebFileEntry => ({
        name,
        arrayBuffer: async () => new ArrayBuffer(0),
    });

    it('derives ids from .hea stems in a directory with no RECORDS file', async () => {
        const source = new InMemoryFileSource({
            '100.hea': { text: RECORD_100_HEA },
            '100.dat': { text: '' },
            '101.hea': { text: RECORD_101_HEA },
            '101.dat': { text: '' },
        });
        expect(await discoverMitBihRecordIds(source)).toEqual(['100', '101']);
    });

    it('returns ids in deterministic ascending order, deduplicated across extension case', async () => {
        const source = new InMemoryFileSource({
            '203.hea': { text: '' },
            '100.hea': { text: '' },
            '101.HEA': { text: '' },
            '101.hea': { text: '' },
        });
        expect(await discoverMitBihRecordIds(source)).toEqual(['100', '101', '203']);
    });

    it('ignores every non-.hea entry, including RECORDS and stray files', async () => {
        const source = new InMemoryFileSource({
            RECORDS: { text: '100\n' },
            '100.dat': { text: '' },
            '100.atr': { text: '' },
            'stray.xws': { text: '' },
            'notes.txt': { text: '' },
        });
        expect(await discoverMitBihRecordIds(source)).toEqual([]);
    });

    it('returns an empty list for an empty directory (never an error)', async () => {
        expect(await discoverMitBihRecordIds(new InMemoryFileSource({}))).toEqual([]);
    });

    it('discovers over a browser WebFileSource exactly as over an in-memory source', async () => {
        const source = new WebFileSource([emptyEntry('100.hea'), emptyEntry('100.dat')]);
        expect(await discoverMitBihRecordIds(source)).toEqual(['100']);
    });
});

describe('catalogMitBih', () => {
    it('reports flags per record with RECORDS order first, then extra headers', async () => {
        const source = new InMemoryFileSource({
            RECORDS: { text: '100\n101\n' },
            '100.hea': { text: RECORD_100_HEA },
            '100.dat': { text: '' },
            '100.atr': { text: '' },
            '101.hea': { text: RECORD_101_HEA },
            '101.dat': { text: '' },
            '102.hea': { text: RECORD_102_HEA },
            'stray.xws': { text: '' },
        });
        const catalog = await catalogMitBih(source);

        expect(catalog.records.map((entry) => entry.recordId)).toEqual([
            '100',
            '101',
            '102',
        ]);
        expect(catalog.unexpectedEntries).toEqual(['stray.xws']);

        const record100 = catalog.records[0];
        expect(record100).toMatchObject({
            recordId: '100',
            inRecords: true,
            hasHeader: true,
            hasDat: true,
            hasAtr: true,
            complete: true,
            readable: true,
            annotated: true,
        });

        const record101 = catalog.records[1];
        expect(record101).toMatchObject({
            recordId: '101',
            inRecords: true,
            hasDat: true,
            hasAtr: false,
            complete: true,
            readable: true,
            annotated: false,
        });

        const record102 = catalog.records[2];
        expect(record102).toMatchObject({
            recordId: '102',
            inRecords: false,
            hasDat: false,
            complete: false,
            readable: true,
            annotated: false,
        });
        expect(record102?.problem).toMatch(/missing declared data file/);
    });

    it('folds a malformed header into the per-record problem, never throwing', async () => {
        const source = new InMemoryFileSource({
            RECORDS: { text: 'bad\n' },
            'bad.hea': { text: 'bad not-a-valid-header' },
            'bad.dat': { text: '' },
        });
        const catalog = await catalogMitBih(source);
        expect(catalog.records).toHaveLength(1);
        expect(catalog.records[0]).toMatchObject({
            recordId: 'bad',
            readable: false,
            complete: false,
        });
        expect(catalog.records[0]?.problem).toBeDefined();
    });

    it('throws file-not-found when RECORDS is absent', async () => {
        const source = new InMemoryFileSource({
            '100.hea': { text: RECORD_100_HEA },
        });
        expect(await promiseErrorCode(catalogMitBih(source))).toBe('file-not-found');
    });
});
