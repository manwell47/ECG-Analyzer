/**
 * Opt-in real MIT-BIH data integration (Phase 11 / ADR-012).
 *
 * This exercises the *same* browser-safe seam (`NodeFileSource` →
 * `discoverMitBihRecordIds` → `MitBihDatasetAdapter` → `recordToMillivoltSignal`)
 * against a genuine record under `data/raw/mitdb`.
 *
 * The raw dataset is gitignored (ADR-006 local-first), so on a clean clone the
 * directory is absent and this test **skips** — that skip is expected and the
 * default suite never depends on real data. When the directory is present (a
 * developer machine, or CI with the dataset staged), the record is read end to
 * end and the canonical invariants are asserted.
 */
import { describe, expect, it } from 'vitest';

import { discoverMitBihRecordIds } from '../mitbih/catalog';
import { MitBihDatasetAdapter, MIT_BIH_DATASET_ID } from '../mitbih/adapter';
import { NodeFileSource } from '../nodeSource';
import { recordToMillivoltSignal } from '../load';
import { MITDB_DIR, firstCompleteRecordId } from './realRecordSupport';

const recordId = firstCompleteRecordId();

describe('real MIT-BIH data (opt-in integration)', () => {
    // Expected to skip on a clean clone where the gitignored dataset is absent.
    it.skipIf(recordId === undefined)(
        'discovers and reads a real MIT-BIH record end-to-end through the seam',
        async () => {
            if (recordId === undefined) {
                return;
            }
            const source = new NodeFileSource(MITDB_DIR);

            const discovered = await discoverMitBihRecordIds(source);
            expect(discovered).toContain(recordId);

            const adapter = new MitBihDatasetAdapter(source);
            expect(adapter.datasetId).toBe(MIT_BIH_DATASET_ID);
            const record = await adapter.readRecord(recordId);

            expect(record.identity).toEqual({
                datasetId: MIT_BIH_DATASET_ID,
                recordId,
            });
            expect(record.sampling.sampleRateHz).toBe(360);
            expect(record.channels.length).toBeGreaterThan(0);

            const [firstChannel] = record.channels;
            expect(firstChannel?.samples.length).toBe(record.sampleCount);
            expect(mmValues(record).length).toBe(record.channels.length);
        },
    );
});

/** Convert the record to a physical-unit signal (single audited ADC→mV step). */
function mmValues(record: Parameters<typeof recordToMillivoltSignal>[0]): Float64Array[] {
    const signal = recordToMillivoltSignal(record);
    expect(signal.provenance.transforms.map((step) => step.name)).toContain(
        'adc-to-millivolt',
    );
    return signal.channels.map((channel) => channel.data);
}
