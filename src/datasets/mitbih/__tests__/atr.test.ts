/**
 * `.atr` annotation parser tests (Phase 5 / ADR-006).
 *
 * The first block pins the parser against a 24-byte prefix of the *real*
 * data/raw/mitdb/100.atr that ends on a clean annotation boundary; wfdb 4.3.1
 * decodes it to events at samples [18, 77, 370, 662, 946, 1231, 1515, 1809].
 *
 * The remaining blocks exercise the grammar hermetically with a small encoder:
 * NOTANN/definition stripping, the `## time resolution` note, custom label
 * definitions, large SKIP offsets, and truncation error paths.
 */
import { describe, expect, it } from 'vitest';

import { EcgError } from '../../../domain/error';
import type { AnnotationEvent } from '../../../domain/record';
import { parseMitBihAtr } from '../atr';

/**
 * Leading bytes of data/raw/mitdb/100.atr (pair layout): rhythm `+` at sample
 * 18 with note `(N`, seven `N` beats, ending before the APC that follows.
 */
const REAL_100_ATR_PREFIX = [
    0x12, 0x70, 0x03, 0xfc, 0x28, 0x4e, 0x00, 0x00,
    0x3b, 0x04, 0x25, 0x05, 0x24, 0x05, 0x1c, 0x05,
    0x1d, 0x05, 0x1c, 0x05, 0x26, 0x05, 0xeb, 0x20,
];

/** One synthetic annotation for the hermetic encoder below. */
interface SyntheticAtrEntry {
    /** Absolute sample index (entries must be ascending). */
    readonly at: number;
    /** Numeric label store (0 NOTANN, 1 'N', 5 'V', 22 NOTE, ...). */
    readonly code: number;
    /** Optional AUX note text. */
    readonly aux?: string;
}

function pairBytes(pairs: readonly (readonly [number, number])[]): Uint8Array {
    const bytes = new Uint8Array(pairs.length * 2);
    pairs.forEach((pair, index) => {
        bytes[2 * index] = pair[0];
        bytes[2 * index + 1] = pair[1];
    });
    return bytes;
}

/** Flatten note text into byte pairs (two chars per pair; zero-padded when odd). */
function notePairs(note: string): [number, number][] {
    const codes = Array.from(note, (ch) => ch.charCodeAt(0) & 0xff);
    if (codes.length % 2 === 1) {
        codes.push(0); // Odd notes pad with a final byte the reader drops.
    }
    const pairs: [number, number][] = [];
    for (let i = 0; i < codes.length; i += 2) {
        pairs.push([codes[i] ?? 0, codes[i + 1] ?? 0]);
    }
    return pairs;
}

/**
 * Encode entries into `.atr` bytes mirroring the parser's grammar:
 * core pair `lo = diff & 0xff`, `hi = (code << 2) | ((diff >> 8) & 3)`;
 * diffs above 1023 become a SKIP (59) entry spanning the next two pairs;
 * AUX notes as `[len, 252]` followed by the note pairs; file ends on a `0` pair.
 */
function encodeAtr(entries: readonly SyntheticAtrEntry[]): Uint8Array {
    const pairs: [number, number][] = [];
    let previous = 0;
    for (const entry of entries) {
        let diff = entry.at - previous;
        if (diff > 1023) {
            if (diff > 0x7fffffff) {
                throw new Error('synthetic atr diff exceeds signed 32-bit range.');
            }
            // SKIP pair (low byte unused), then the value across two pairs.
            pairs.push([0, 59 << 2]);
            const value = diff;
            pairs.push([(value >>> 16) & 0xff, (value >>> 24) & 0xff]);
            pairs.push([value & 0xff, (value >>> 8) & 0xff]);
            diff = 0;
        } else if (diff < 0) {
            throw new Error('synthetic atr requires ascending sample indices.');
        }
        pairs.push([diff & 0xff, (entry.code << 2) | ((diff >> 8) & 3)]);
        if (entry.aux !== undefined) {
            pairs.push([entry.aux.length & 0xff, 63 << 2]); // AUX header.
            pairs.push(...notePairs(entry.aux));
        }
        previous = entry.at;
    }
    pairs.push([0, 0]); // EOF marker pair.
    return pairBytes(pairs);
}

function toPlain(events: readonly AnnotationEvent[]): { s: number; c: number; sym: string; aux: string }[] {
    return events.map((event) => ({
        s: event.sampleIndex,
        c: event.code ?? -1,
        sym: event.symbol,
        aux: event.auxNote,
    }));
}

function errorCodeOf(bytes: Uint8Array): string | undefined {
    try {
        parseMitBihAtr(bytes);
    } catch (error) {
        if (error instanceof EcgError) {
            return error.code;
        }
    }
    return undefined;
}

describe('real MIT-BIH record 100 annotation prefix (fixture)', () => {
    const result = parseMitBihAtr(Uint8Array.from(REAL_100_ATR_PREFIX));

    it('reproduces the verified wfdb event samples', () => {
        expect(result.annotations.map((event) => event.sampleIndex)).toEqual([
            18, 77, 370, 662, 946, 1231, 1515, 1809,
        ]);
    });

    it('assigns the canonical symbols and numeric codes', () => {
        expect(result.annotations.map((event) => event.symbol)).toEqual([
            '+',
            'N',
            'N',
            'N',
            'N',
            'N',
            'N',
            'N',
        ]);
        expect(result.annotations[0]?.code).toBe(28);
        expect(result.annotations[1]?.code).toBe(1);
    });

    it('keeps the rhythm note verbatim, trailing NUL pad included', () => {
        expect(result.annotations[0]?.auxNote).toBe('(N\x00');
        expect(result.annotations[1]?.auxNote).toBe('');
    });
});

describe('NOTANN and definition stripping', () => {
    it('drops NOTANN (code 0) and definition annotations but keeps real beats', () => {
        const bytes = encodeAtr([
            { at: 0, code: 22, aux: '## time resolution: 128' },
            { at: 10, code: 0 }, // NOTANN.
            { at: 20, code: 1 }, // 'N'.
            { at: 30, code: 5 }, // 'V'.
        ]);
        const result = parseMitBihAtr(bytes);
        expect(result.fs).toBe(128);
        expect(toPlain(result.annotations)).toEqual([
            { s: 20, c: 1, sym: 'N', aux: '' },
            { s: 30, c: 5, sym: 'V', aux: '' },
        ]);
    });
});

describe('definition notes', () => {
    it('declares the annotation sampling rate from a time-resolution note', () => {
        const bytes = encodeAtr([
            { at: 0, code: 22, aux: '## time resolution: 128' },
            { at: 100, code: 1 },
        ]);
        const result = parseMitBihAtr(bytes);
        expect(result.fs).toBe(128);
    });

    it('parses custom label definitions and overlays them on real events', () => {
        const bytes = encodeAtr([
            { at: 0, code: 22, aux: '## annotation type definitions' },
            { at: 0, code: 22, aux: '48 QM mystery-beat' },
            { at: 0, code: 22, aux: '## end of definitions' },
            { at: 100, code: 48 },
            { at: 200, code: 1 },
            { at: 300, code: 5 },
        ]);
        const result = parseMitBihAtr(bytes);
        expect(result.customLabels).toEqual([
            { code: 48, symbol: 'QM', description: 'mystery-beat' },
        ]);
        expect(toPlain(result.annotations)).toEqual([
            { s: 100, c: 48, sym: 'QM', aux: '' },
            { s: 200, c: 1, sym: 'N', aux: '' },
            { s: 300, c: 5, sym: 'V', aux: '' },
        ]);
    });
});

describe('SKIP offsets and error paths', () => {
    it('jumps a large absolute sample offset through a SKIP entry', () => {
        const bytes = encodeAtr([{ at: 2995, code: 1 }]);
        const result = parseMitBihAtr(bytes);
        expect(result.annotations.map((event) => event.sampleIndex)).toEqual([
            2995,
        ]);
        expect(result.annotations[0]?.symbol).toBe('N');
    });

    it('treats an empty file as having no annotations', () => {
        const result = parseMitBihAtr(new Uint8Array());
        expect(result.annotations).toEqual([]);
        expect(result.customLabels).toEqual([]);
    });

    it('rejects an odd-length annotation file with annotation-parse-error', () => {
        expect(errorCodeOf(Uint8Array.from([1, 2, 3]))).toBe(
            'annotation-parse-error',
        );
    });
});
