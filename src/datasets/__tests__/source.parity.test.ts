/**
 * Source-seam parity gate — Node↔browser (Phase 11 / ADR-012).
 *
 * The dataset seam is behaviour-preserving: the *same bytes* served through
 * every `DatasetFileSource` implementation must yield the *same* canonical
 * `SignalRecord`. This is the correctness gate for browser-local ingestion —
 * never a DOM or timing assertion (rules §51).
 *
 * One identical MIT-BIH record (`.hea` + format-212 `.dat` + `.atr`, plus the
 * `RECORDS` control file) is read through three genuinely different sources:
 *
 * - `InMemoryFileSource` — the hermetic fixture source;
 * - `NodeFileSource` — the `node:fs` source over a real `node:os` temp dir;
 * - `WebFileSource` — the browser source, here over Node's global `File`.
 *
 * The test asserts identical text/binary reads and a deep-equal `SignalRecord`
 * from [`MitBihDatasetAdapter`](../mitbih/adapter.ts) plus identical
 * `recordToMillivoltSignal` output, anchored to concrete expected values so
 * parity cannot pass vacuously.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { SignalRecord } from '../../domain/record';
import type { Signal } from '../../domain/signal';
import { encodeFormat212 } from '../mitbih/format212';
import { MitBihDatasetAdapter, MIT_BIH_DATASET_ID } from '../mitbih/adapter';
import { recordToMillivoltSignal } from '../load';
import { WebFileSource } from '../fileSource';
import { NodeFileSource } from '../nodeSource';
import { InMemoryFileSource } from '../source';
import type { DatasetFileSource } from '../source';

const HEADER_900 = [
    '900 2 360 6',
    '900.dat 212 200 11 1024 995 0 0 MLII',
    '900.dat 212 200 11 1024 1011 0 0 V5',
    '# synthetic parity fixture record 900',
].join('\n');

const RECORDS_TEXT = '900\n';
const CH0 = Int16Array.from([995, 1000, 1024, 1000, 995, 1024]);
const CH1 = Int16Array.from([1011, 1011, 1024, 1011, 1011, 1024]);
const DAT_BYTES = encodeFormat212(CH0, CH1);
const ATR_BYTES = pairBytes([
    [3, 4],
    [0, 0],
]);

function pairBytes(pairs: readonly (readonly [number, number])[]): Uint8Array {
    const bytes = new Uint8Array(pairs.length * 2);
    pairs.forEach((pair, index) => {
        bytes[2 * index] = pair[0];
        bytes[2 * index + 1] = pair[1];
    });
    return bytes;
}

function expectSameBytes(actual: Uint8Array, expected: Uint8Array): void {
    expect(actual.length).toBe(expected.length);
    expect(Array.from(actual)).toEqual(Array.from(expected));
}

/**
 * Copy bytes into a fresh, plain `ArrayBuffer` so they are a `BlobPart`
 * regardless of the source view's backing buffer type (`ArrayBufferLike`).
 */
function toBlobPart(bytes: Uint8Array): BlobPart {
    const copy = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(copy).set(bytes);
    return copy;
}

function inMemorySource(): InMemoryFileSource {
    return new InMemoryFileSource({
        RECORDS: { text: RECORDS_TEXT },
        '900.hea': { text: HEADER_900 },
        '900.dat': { bytes: DAT_BYTES },
        '900.atr': { bytes: ATR_BYTES },
    });
}

function webSource(): WebFileSource {
    const encoder = new TextEncoder();
    return new WebFileSource([
        new File([toBlobPart(encoder.encode(RECORDS_TEXT))], 'RECORDS'),
        new File([toBlobPart(encoder.encode(HEADER_900))], '900.hea'),
        new File([toBlobPart(DAT_BYTES)], '900.dat'),
        new File([toBlobPart(ATR_BYTES)], '900.atr'),
    ]);
}

describe('source seam parity across InMemoryFileSource / NodeFileSource / WebFileSource', () => {
    let dir = '';
    let nodeSource: NodeFileSource;

    beforeAll(async () => {
        dir = await mkdtemp(join(tmpdir(), 'ecg-source-parity-'));
        await writeFile(join(dir, 'RECORDS'), RECORDS_TEXT, 'utf8');
        await writeFile(join(dir, '900.hea'), HEADER_900, 'utf8');
        await writeFile(join(dir, '900.dat'), DAT_BYTES);
        await writeFile(join(dir, '900.atr'), ATR_BYTES);
        nodeSource = new NodeFileSource(dir);
    });

    afterAll(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    function allSources(): readonly {
        readonly name: string;
        readonly source: DatasetFileSource;
    }[] {
        return [
            { name: 'InMemoryFileSource', source: inMemorySource() },
            { name: 'NodeFileSource', source: nodeSource },
            { name: 'WebFileSource', source: webSource() },
        ];
    }

    it('reports the same file inventory from every source', async () => {
        for (const { name, source } of allSources()) {
            expect([...(await source.listFileNames())].sort(), name).toEqual([
                '900.atr',
                '900.dat',
                '900.hea',
                'RECORDS',
            ]);
        }
    });

    it('reads text identically from every source', async () => {
        for (const { name, source } of allSources()) {
            expect(await source.readTextFile('900.hea'), name).toBe(HEADER_900);
            expect(await source.readTextFile('RECORDS'), name).toBe(RECORDS_TEXT);
        }
    });

    it('reads binary byte-for-byte identically from every source', async () => {
        for (const { source } of allSources()) {
            expectSameBytes(await source.readBinaryFile('900.dat'), DAT_BYTES);
            expectSameBytes(await source.readBinaryFile('900.atr'), ATR_BYTES);
        }
    });

    it('materialises a deep-equal SignalRecord and mV Signal from every source', async () => {
        const records: SignalRecord[] = [];
        const signals: Signal[] = [];

        for (const { name, source } of allSources()) {
            const adapter = new MitBihDatasetAdapter(source);
            expect(adapter.datasetId, name).toBe(MIT_BIH_DATASET_ID);
            expect(await adapter.listRecordIds(), name).toEqual(['900']);
            const record = await adapter.readRecord('900');
            records.push(record);
            signals.push(recordToMillivoltSignal(record));
        }

        const [reference, ...others] = records;
        const [referenceSignal, ...otherSignals] = signals;
        expect(reference).toBeDefined();
        expect(referenceSignal).toBeDefined();

        // Anchor to concrete expected values so parity cannot pass vacuously.
        expect(reference?.identity).toEqual({
            datasetId: 'mit-bih-arrhythmia',
            recordId: '900',
        });
        expect(reference?.subjectId).toBe('900');
        expect(reference?.sampling.sampleRateHz).toBe(360);
        expect(reference?.sampleCount).toBe(6);
        expect(reference?.annotations).toEqual([
            { sampleIndex: 3, code: 1, symbol: 'N', auxNote: '' },
        ]);
        const [firstChannel] = reference?.channels ?? [];
        expect(Array.from(firstChannel?.samples ?? [])).toEqual(Array.from(CH0));
        expect(firstChannel?.calibration).toEqual({ gain: 200, baseline: 1024 });

        // The gate itself: every other source is deep-equal to the reference.
        others.forEach((record, index) => {
            expect(record).toEqual(reference);
            expect(record.channels.length).toBe(2);
            expect(otherSignals[index]).toEqual(referenceSignal);
        });

        const [firstSignalChannel] = referenceSignal?.channels ?? [];
        expect(firstSignalChannel?.unit).toBe('mV');
        expect(firstSignalChannel?.data[0]).toBeCloseTo((995 - 1024) / 200, 12);
        expect(
            referenceSignal?.provenance.transforms.map((step) => step.name),
        ).toContain('adc-to-millivolt');
    });
});
