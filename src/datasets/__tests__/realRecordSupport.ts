/**
 * Shared opt-in real-record support (Phase 16 / ADR-017).
 *
 * One definition of "which real MIT-BIH record" for every opt-in real-data gate.
 * The raw dataset is gitignored (ADR-006 local-first), so on a clean clone
 * `firstCompleteRecordId()` returns `undefined` and each gate skips. This module
 * is not a test file (the Vitest `include` collects only files ending in
 * `.test.ts`) and it imports `node:fs` only through `NodeFileSource`, which is
 * deliberately not re-exported from the datasets barrel — so nothing here can
 * reach the web bundle.
 */
import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { SignalRecord } from '../../domain/record';
import type { Signal } from '../../domain/signal';
import { MitBihDatasetAdapter } from '../mitbih/adapter';
import { recordToMillivoltSignal } from '../load';
import { NodeFileSource } from '../nodeSource';

const SUPPORT_DIR = dirname(fileURLToPath(import.meta.url));

/** Absolute path of the gitignored raw MIT-BIH dataset root. */
export const MITDB_DIR = resolve(SUPPORT_DIR, '..', '..', '..', 'data', 'raw', 'mitdb');

/** Stable reason a real-data gate is skipped when the dataset is absent. */
export const REAL_RECORD_SKIP_REASON =
    'data/raw/mitdb is absent (gitignored) — opt-in real-data gate skipped';

/**
 * The first record whose `.hea`, `.dat` and `.atr` are all present, or
 * `undefined` when the raw dataset is absent / incomplete. Preferring an
 * annotated record keeps the end-to-end read (annotations included) exercised.
 * Sync on purpose, so a gate can drive `it.skipIf` at declaration time.
 */
export function firstCompleteRecordId(): string | undefined {
    if (!existsSync(MITDB_DIR)) {
        return undefined;
    }
    const names = new Set(readdirSync(MITDB_DIR));
    const stems = [...names]
        .filter((name) => name.toLowerCase().endsWith('.hea'))
        .map((name) => name.slice(0, -4))
        .sort();
    return (
        stems.find((stem) => names.has(`${stem}.dat`) && names.has(`${stem}.atr`)) ??
        stems.find((stem) => names.has(`${stem}.dat`))
    );
}

/** One real record: its canonical form and its single audited ADC → mV signal. */
export interface RealRecord {
    readonly recordId: string;
    readonly record: SignalRecord;
    readonly signal: Signal;
}

/**
 * Load the probed real record (canonical `SignalRecord` + mV `Signal`), or
 * `undefined` when the gitignored dataset is absent. The dataset is opened
 * read-only through `NodeFileSource` and never modified.
 */
export async function loadRealRecord(): Promise<RealRecord | undefined> {
    const recordId = firstCompleteRecordId();
    if (recordId === undefined) {
        return undefined;
    }
    const source = new NodeFileSource(MITDB_DIR);
    const adapter = new MitBihDatasetAdapter(source);
    const record = await adapter.readRecord(recordId);
    return { recordId, record, signal: recordToMillivoltSignal(record) };
}
