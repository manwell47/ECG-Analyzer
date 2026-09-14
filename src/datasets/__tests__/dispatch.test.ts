/**
 * Dataset-format dispatch tests (Phase 18 item 6 / ADR-020).
 *
 * Two file layouts now arrive through one picker, so exactly one place decides
 * which adapter a selection belongs to. That decision is pure and keyed on the
 * file extensions that identify a record set, so it is pinned here directly:
 * each layout is recognised, a mixed selection and an unrecognised one are both
 * refused with a message that names what was seen, and the ids are discovered
 * for the same format the adapter is built for.
 */
import { describe, expect, it } from 'vitest';

import { EcgError } from '../../domain/error';
import { InMemoryFileSource } from '../source';
import {
    createDatasetAdapter,
    detectDatasetFormat,
    discoverRecordIdsFor,
    prepareDatasetSource,
} from '../dispatch';
import { EDF_DATASET_ID, EdfDatasetAdapter } from '../edf';
import { MIT_BIH_DATASET_ID, MitBihDatasetAdapter } from '../mitbih';

interface Refusal {
    readonly code: string;
    readonly message: string;
}

function refusalOf(run: () => unknown): Refusal {
    try {
        run();
    } catch (error) {
        if (error instanceof EcgError) {
            return { code: error.code, message: error.message };
        }
        throw error;
    }
    throw new Error('expected a classified refusal.');
}

describe('detectDatasetFormat', () => {
    it('recognises a WFDB selection by its .hea header', () => {
        expect(detectDatasetFormat(['101.hea', '101.dat', '101.atr'])).toBe('mit-bih');
    });

    it('recognises an EDF selection by its .edf record', () => {
        expect(detectDatasetFormat(['record.edf'])).toBe('edf');
    });

    it('reads the extension case-insensitively', () => {
        expect(detectDatasetFormat(['101.HEA'])).toBe('mit-bih');
        expect(detectDatasetFormat(['record.EDF'])).toBe('edf');
    });

    it('refuses a selection mixing both formats, naming the counts it saw', () => {
        const refusal = refusalOf(() => detectDatasetFormat(['101.hea', 'record.edf']));

        expect(refusal.code).toBe('unsupported-format');
        expect(refusal.message).toContain('mixes dataset formats');
        expect(refusal.message).toContain('1 WFDB ".hea" header(s)');
        expect(refusal.message).toContain('1 EDF ".edf" file(s)');
    });

    it('refuses a selection with neither format, naming what was looked for', () => {
        const refusal = refusalOf(() => detectDatasetFormat(['notes.txt']));

        expect(refusal.code).toBe('unsupported-format');
        expect(refusal.message).toContain('holds 1 file(s)');
        expect(refusal.message).toContain('".hea"');
        expect(refusal.message).toContain('".edf"');
    });

    it('refuses an empty selection', () => {
        const refusal = refusalOf(() => detectDatasetFormat([]));

        expect(refusal.code).toBe('unsupported-format');
        expect(refusal.message).toContain('holds 0 file(s)');
    });
});

describe('discoverRecordIdsFor', () => {
    it('discovers WFDB record ids from the .hea file names', async () => {
        const source = new InMemoryFileSource({
            'b.hea': { text: 'b 1 360 1\nb.dat 212 200 11 1024 0 0 0 ECG' },
            'a.hea': { text: 'a 1 360 1\na.dat 212 200 11 1024 0 0 0 ECG' },
            'notes.txt': { text: 'ignored' },
        });

        expect(await discoverRecordIdsFor(source, 'mit-bih')).toEqual(['a', 'b']);
    });

    it('discovers EDF record ids from the .edf file names', async () => {
        const source = new InMemoryFileSource({
            'b.edf': { bytes: new Uint8Array() },
            'a.edf': { bytes: new Uint8Array() },
        });

        expect(await discoverRecordIdsFor(source, 'edf')).toEqual(['a', 'b']);
    });
});

describe('createDatasetAdapter', () => {
    it('builds the MIT-BIH adapter for the WFDB format', () => {
        const adapter = createDatasetAdapter(new InMemoryFileSource({}), 'mit-bih');

        expect(adapter).toBeInstanceOf(MitBihDatasetAdapter);
        expect(adapter.datasetId).toBe(MIT_BIH_DATASET_ID);
    });

    it('builds the EDF adapter for the EDF format', () => {
        const adapter = createDatasetAdapter(new InMemoryFileSource({}), 'edf');

        expect(adapter).toBeInstanceOf(EdfDatasetAdapter);
        expect(adapter.datasetId).toBe(EDF_DATASET_ID);
    });
});

describe('prepareDatasetSource', () => {
    it('returns the detected format together with its own record ids', async () => {
        const source = new InMemoryFileSource({
            'record.edf': { bytes: new Uint8Array() },
            'other.edf': { bytes: new Uint8Array() },
        });

        expect(await prepareDatasetSource(source)).toEqual({
            format: 'edf',
            recordIds: ['other', 'record'],
        });
    });

    it('refuses a selection it cannot classify, before discovering anything', async () => {
        const promise = prepareDatasetSource(
            new InMemoryFileSource({ 'notes.txt': { text: '' } }),
        );

        await expect(promise).rejects.toBeInstanceOf(EcgError);
        await expect(promise).rejects.toMatchObject({ code: 'unsupported-format' });
    });
});
