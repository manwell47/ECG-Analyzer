import { beforeAll, describe, expect, it } from 'vitest';
import { basicStats } from '../measure';
import { FIXTURE_SAMPLE_RATE_HZ, generateSignal } from '../signals';
import {
    CANONICAL_SIGNAL_FIXTURES,
    DB4_FILE_FORMAT_VERSION,
    FIXTURE_GENERATOR_VERSION,
    FIXTURES_OVERWRITE,
    loadGoldenDb4File,
    loadGoldenSignalsFile,
    SIGNALS_FILE_FORMAT_VERSION,
    writeReferenceFiles,
} from '../golden';

/**
 * Golden-fixture harness regression test.
 *
 * When `FIXTURES_OVERWRITE=1` (the `fixtures:write` script) the committed files
 * are first (re)written from source; every other run compares the committed
 * files against a fresh in-memory regeneration. A fixture therefore can only
 * change by an explicit, env-gated baseline — it can never drift silently.
 *
 * All committed-file reads happen lazily inside `it()` bodies (never at
 * collection time) so a first-run generation in `beforeAll` can never race the
 * reads of this same file.
 */
beforeAll(() => {
    if (FIXTURES_OVERWRITE) {
        const result = writeReferenceFiles(true);
        expect(result).toEqual({ signalsWritten: true, db4Written: true });
    }
});

describe('signals golden file integrity', () => {
    it('declares the expected envelope metadata', () => {
        const file = loadGoldenSignalsFile();
        expect(file.formatVersion).toBe(SIGNALS_FILE_FORMAT_VERSION);
        expect(file.generatorVersion).toBe(FIXTURE_GENERATOR_VERSION);
        expect(file.sampleRateHz).toBe(FIXTURE_SAMPLE_RATE_HZ);
        expect(file.unit).toBe('mV');
        expect(file.generatedAtIso.length).toBeGreaterThan(0);
    });

    it('covers exactly the canonical fixture set, in canonical order', () => {
        const file = loadGoldenSignalsFile();
        expect(file.signals.map((s) => s.id)).toEqual(
            CANONICAL_SIGNAL_FIXTURES.map((f) => f.id),
        );
    });

    it('regenerates byte-identical samples from the recorded recipe', () => {
        const file = loadGoldenSignalsFile();
        expect(file.signals).toHaveLength(CANONICAL_SIGNAL_FIXTURES.length);
        for (let i = 0; i < CANONICAL_SIGNAL_FIXTURES.length; i += 1) {
            const canonical = CANONICAL_SIGNAL_FIXTURES[i]!;
            const committed = file.signals[i]!;
            expect(committed.id).toBe(canonical.id);
            expect(committed.recipe).toEqual(canonical.recipe);
            const regenerated = Array.from(generateSignal(canonical.recipe));
            expect(committed.samples).toEqual(regenerated);
        }
    });

    it('records properties that match a fresh measurement of the samples', () => {
        const file = loadGoldenSignalsFile();
        for (const committed of file.signals) {
            expect(committed.properties).toEqual(
                basicStats(new Float64Array(committed.samples)),
            );
        }
    });
});

describe('db4 golden file integrity', () => {
    it('declares the expected envelope metadata', () => {
        const file = loadGoldenDb4File();
        expect(file.formatVersion).toBe(DB4_FILE_FORMAT_VERSION);
        expect(file.generatorVersion).toBe(FIXTURE_GENERATOR_VERSION);
        expect(file.generatedAtIso.length).toBeGreaterThan(0);
    });
});

describe('regression guard: fixtures cannot drift silently', () => {
    it('fails loudly if committed signal count or ids diverge from source', () => {
        const file = loadGoldenSignalsFile();
        const committedIds = new Set(file.signals.map((s) => s.id));
        const canonicalIds = new Set(CANONICAL_SIGNAL_FIXTURES.map((f) => f.id));
        expect(committedIds.size).toBe(file.signals.length);
        expect(committedIds).toEqual(canonicalIds);
    });
});
