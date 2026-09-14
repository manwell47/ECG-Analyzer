/**
 * Golden reference fixture registry + persistence.
 *
 * `data/fixtures/reference/*.json` are the *committed golden artifacts* for this
 * laboratory: deterministic signals and the Db4 filterbank, each with a recorded
 * recipe so the artifact can be regenerated from source alone. Writing them is a
 * deliberate, env-gated act (`FIXTURES_OVERWRITE=1`); normal test runs only
 * *regenerate in memory* and compare against the committed bytes. This keeps the
 * golden files honest: a test cannot pass by silently rewriting history.
 *
 * Layering note: this module imports only from the fixture generators and the
 * domain-adjacent measurement helpers. It is intentionally *not* part of the
 * browser bundle — it exists so tests and the `fixtures:write` script share one
 * source of truth for what "the fixtures" are.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    DB4_DEC_HI,
    DB4_DEC_LO,
    DB4_NAME,
    DB4_ORDER,
    DB4_REC_HI,
    DB4_REC_LO,
    DB4_TAP_COUNT,
    sum,
    sumSquares,
} from './db4';
import { basicStats, type BasicStats } from './measure';
import {
    FIXTURE_SAMPLE_RATE_HZ,
    generateSignal,
    type SignalRecipe,
} from './signals';

/** Directory holding the committed golden artifacts. */
export const FIXTURE_ROOT = join(process.cwd(), 'data', 'fixtures', 'reference');
export const DB4_FILE = join(FIXTURE_ROOT, 'db4.json');
export const SIGNALS_FILE = join(FIXTURE_ROOT, 'signals.json');

/** Overwrite gate: fixtures only change when this is set to `1`. */
export const FIXTURES_OVERWRITE = process.env.FIXTURES_OVERWRITE === '1';

/** Distinguish schema changes from sample changes when we re-baseline. */
export const SIGNALS_FILE_FORMAT_VERSION = 1;
export const DB4_FILE_FORMAT_VERSION = 1;

/** Human/script-facing identity of the fixture generator that produced a file. */
export const FIXTURE_GENERATOR_VERSION = 'ecg-lab-fixtures/1.0.0';

export interface CanonicalSignalFixture {
    readonly id: string;
    readonly recipe: SignalRecipe;
}

/**
 * The canonical signal fixture set. All share the laboratory's reference sample
 * rate (360 Hz, mirroring MIT-BIH) and millivolt amplitude convention.
 */
export const CANONICAL_SIGNAL_FIXTURES: readonly CanonicalSignalFixture[] =
    Object.freeze([
        {
            id: 'impulse-1',
            recipe: {
                kind: 'impulse',
                sampleRateHz: FIXTURE_SAMPLE_RATE_HZ,
                length: 720,
                amplitude: 1.0,
                atIndex: 5,
            },
        },
        {
            id: 'constant-1',
            recipe: {
                kind: 'constant',
                sampleRateHz: FIXTURE_SAMPLE_RATE_HZ,
                length: 360,
                offset: 0.5,
            },
        },
        {
            id: 'sine-1',
            recipe: {
                kind: 'sine',
                sampleRateHz: FIXTURE_SAMPLE_RATE_HZ,
                // Exactly 10 full cycles at 1 Hz (360 samples/cycle). Whole-cycle
                // windows make both recorded properties exact: RMS = A/sqrt(2) and
                // the zero-crossing estimator returns fs / meanGap = 1 Hz.
                length: 3600,
                amplitude: 1.0,
                frequencyHz: 1,
                phaseRad: 0,
                offset: 0,
            },
        },
        {
            id: 'multi-frequency-1',
            recipe: {
                kind: 'multi-frequency',
                sampleRateHz: FIXTURE_SAMPLE_RATE_HZ,
                length: 3600,
                amplitudes: [1.0, 0.5, 0.25],
                frequenciesHz: [1, 3, 5],
            },
        },
        {
            id: 'chirp-1',
            recipe: {
                kind: 'chirp',
                sampleRateHz: FIXTURE_SAMPLE_RATE_HZ,
                length: 3600,
                amplitude: 1.0,
                f0Hz: 0.5,
                f1Hz: 20,
            },
        },
        {
            id: 'noise-1',
            recipe: {
                kind: 'noise',
                sampleRateHz: FIXTURE_SAMPLE_RATE_HZ,
                length: 2048,
                std: 0.05,
                seed: 20260903,
            },
        },
        {
            id: 'synthetic-ecg-1',
            recipe: {
                kind: 'synthetic-ecg',
                sampleRateHz: FIXTURE_SAMPLE_RATE_HZ,
                length: 2160,
                heartRateBpm: 60,
                amplitude: 1.0,
            },
        },
    ]);

export interface GoldenSignal {
    readonly id: string;
    readonly recipe: SignalRecipe;
    /** Recorded measured properties of the generated samples (independent of any implementation). */
    readonly properties: BasicStats;
    /** Samples in millivolts. */
    readonly samples: readonly number[];
}

export interface GoldenSignalsFile {
    readonly formatVersion: number;
    readonly generatorVersion: string;
    readonly sampleRateHz: number;
    readonly unit: 'mV';
    /** ISO-8601 timestamp of generation. Excluded from integrity comparisons. */
    readonly generatedAtIso: string;
    readonly signals: readonly GoldenSignal[];
}

export interface GoldenDb4Invariants {
    readonly sumDecLo: number;
    readonly sumSquaresDecLo: number;
    readonly sumDecHi: number;
    readonly sumSquaresDecHi: number;
}

export interface GoldenDb4File {
    readonly formatVersion: number;
    readonly generatorVersion: string;
    readonly wavelet: string;
    readonly order: number;
    readonly tapCount: number;
    /** ISO-8601 timestamp of generation. Excluded from integrity comparisons. */
    readonly generatedAtIso: string;
    /** Provenance note: where the taps come from and how they were verified. */
    readonly provenance: string;
    readonly dec_lo: readonly number[];
    readonly dec_hi: readonly number[];
    readonly rec_lo: readonly number[];
    readonly rec_hi: readonly number[];
    readonly invariants: GoldenDb4Invariants;
}

/** Generate one canonical fixture into samples + measured properties. */
export function generateSignalFixture(
    fixture: CanonicalSignalFixture,
): { samples: Float64Array; properties: BasicStats } {
    const samples = generateSignal(fixture.recipe);
    return { samples, properties: basicStats(samples) };
}

/**
 * Pure builder for the signals golden file. `generatedAtIso` is supplied by the
 * caller so the builder stays deterministic and unit-testable.
 */
export function buildGoldenSignalsFile(
    generatedAtIso: string,
): GoldenSignalsFile {
    const signals: GoldenSignal[] = [];
    for (const fixture of CANONICAL_SIGNAL_FIXTURES) {
        const { samples, properties } = generateSignalFixture(fixture);
        signals.push({
            id: fixture.id,
            recipe: fixture.recipe,
            properties,
            samples: Array.from(samples),
        });
    }
    return {
        formatVersion: SIGNALS_FILE_FORMAT_VERSION,
        generatorVersion: FIXTURE_GENERATOR_VERSION,
        sampleRateHz: FIXTURE_SAMPLE_RATE_HZ,
        unit: 'mV',
        generatedAtIso,
        signals,
    };
}

/** Pure builder for the Db4 golden file. */
export function buildGoldenDb4File(generatedAtIso: string): GoldenDb4File {
    return {
        formatVersion: DB4_FILE_FORMAT_VERSION,
        generatorVersion: FIXTURE_GENERATOR_VERSION,
        wavelet: DB4_NAME,
        order: DB4_ORDER,
        tapCount: DB4_TAP_COUNT,
        generatedAtIso,
        provenance:
            'Daubechies-4 decomposition filters, literature-standard tap ' +
            'ordering (as used by wavelib, PyWavelets and MATLAB db4). Cross-read ' +
            'from the wavelib-derived SIGIL WaveletProcessor.cpp Db4 taps; ' +
            'high/low + reconstruction pairs derived here via QMF. Numerical DWT ' +
            'decomposition reference vectors against the native wavelib library are ' +
            'a Phase-4 external-capture gate (not fabricated in the meantime).',
        dec_lo: Array.from(DB4_DEC_LO),
        dec_hi: Array.from(DB4_DEC_HI),
        rec_lo: Array.from(DB4_REC_LO),
        rec_hi: Array.from(DB4_REC_HI),
        invariants: {
            sumDecLo: sum(DB4_DEC_LO),
            sumSquaresDecLo: sumSquares(DB4_DEC_LO),
            sumDecHi: sum(DB4_DEC_HI),
            sumSquaresDecHi: sumSquares(DB4_DEC_HI),
        },
    };
}

function writeJson(absolutePath: string, value: unknown): void {
    const payload = `${JSON.stringify(value, null, 2)}\n`;
    mkdirSync(FIXTURE_ROOT, { recursive: true });
    writeFileSync(absolutePath, payload, { encoding: 'utf8' });
}

function readJson<T>(absolutePath: string): T {
    const raw = readFileSync(absolutePath, { encoding: 'utf8' });
    return JSON.parse(raw) as T;
}

/**
 * Persist both golden files. No-op when `overwrite` is false (the default) so a
 * stray test run can never rewrite committed artifacts. Returns what it did.
 */
export function writeReferenceFiles(
    overwrite = FIXTURES_OVERWRITE,
): { signalsWritten: boolean; db4Written: boolean } {
    if (!overwrite) {
        return { signalsWritten: false, db4Written: false };
    }
    const generatedAtIso = new Date().toISOString();
    writeJson(SIGNALS_FILE, buildGoldenSignalsFile(generatedAtIso));
    writeJson(DB4_FILE, buildGoldenDb4File(generatedAtIso));
    return { signalsWritten: true, db4Written: true };
}

/** Read the committed signals golden file. */
export function loadGoldenSignalsFile(): GoldenSignalsFile {
    return readJson<GoldenSignalsFile>(SIGNALS_FILE);
}

/** Read the committed Db4 golden file. */
export function loadGoldenDb4File(): GoldenDb4File {
    return readJson<GoldenDb4File>(DB4_FILE);
}

/** True when every finite element is within `absTol` (default 1e-9). */
export function arraysClose(
    actual: readonly number[],
    expected: readonly number[],
    absTol = 1e-9,
): boolean {
    if (actual.length !== expected.length) {
        return false;
    }
    for (let i = 0; i < actual.length; i += 1) {
        const a = actual[i]!;
        const b = expected[i]!;
        if (Number.isNaN(a) || Number.isNaN(b)) {
            if (Number.isNaN(a) && Number.isNaN(b)) {
                continue;
            }
            return false;
        }
        if (!(Math.abs(a - b) <= absTol)) {
            return false;
        }
    }
    return true;
}
