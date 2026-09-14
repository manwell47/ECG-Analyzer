/**
 * WFDB `.dat` decoder/encoder tests (Phase 5 / ADR-006).
 *
 * Pins format 212 against the wfdb reference byte triple `e3 33 f3` -> 995/1011
 * (the first samples of real record 100) and round-trips both supported
 * encodings through positive, negative and boundary 12/16-bit values.
 */
import { describe, expect, it } from 'vitest';

import { EcgError } from '../../../domain/error';
import {
    decodeFormat16Interleaved,
    decodeFormat212,
    encodeFormat16Interleaved,
    encodeFormat212,
} from '../format212';

function bytesOf(values: readonly number[]): Uint8Array {
    return Uint8Array.from(values);
}

function errorCodeOf(fn: () => unknown): string | undefined {
    try {
        fn();
    } catch (error) {
        if (error instanceof EcgError) {
            return error.code;
        }
    }
    return undefined;
}

describe('format 212 decode (golden against real record 100)', () => {
    it('decodes the reference byte triple e3 33 f3 to 995 and 1011', () => {
        const [channel0, channel1] = decodeFormat212(bytesOf([0xe3, 0x33, 0xf3]), 1);
        expect(channel0[0]).toBe(995);
        expect(channel1[0]).toBe(1011);
    });

    it('decodes 12-bit two\'s-complement negatives', () => {
        // Encode -1 and -2048 through the inverse and confirm the sign handling.
        const encoded = encodeFormat212(
            Int16Array.from([-1]),
            Int16Array.from([-2048]),
        );
        const [channel0, channel1] = decodeFormat212(encoded, 1);
        expect(channel0[0]).toBe(-1);
        expect(channel1[0]).toBe(-2048);
    });
});

describe('format 212 round trip and validation', () => {
    it('round-trips boundary values in both channels', () => {
        const channel0 = Int16Array.from([0, 1, -1, -2048, 2047]);
        const channel1 = Int16Array.from([-1, -2048, 2047, 0, 123]);
        const encoded = encodeFormat212(channel0, channel1);
        expect(encoded).toHaveLength(3 * 5);

        const [decoded0, decoded1] = decodeFormat212(encoded, 5);
        expect(Array.from(decoded0)).toEqual(Array.from(channel0));
        expect(Array.from(decoded1)).toEqual(Array.from(channel1));
    });

    it('rejects a byte length that is not 3 x frames', () => {
        expect(errorCodeOf(() => decodeFormat212(bytesOf([1, 2]), 1))).toBe(
            'invalid-input',
        );
    });

    it('rejects samples outside the 12-bit signed range on encode', () => {
        expect(
            errorCodeOf(() =>
                encodeFormat212(Int16Array.from([-2049]), Int16Array.from([0])),
            ),
        ).toBe('invalid-input');
        expect(
            errorCodeOf(() =>
                encodeFormat212(Int16Array.from([0]), Int16Array.from([2048])),
            ),
        ).toBe('invalid-input');
    });

    it('rejects unequal channel lengths on encode', () => {
        expect(
            errorCodeOf(() =>
                encodeFormat212(Int16Array.from([0, 1]), Int16Array.from([0])),
            ),
        ).toBe('invalid-input');
    });
});

describe('format 16 (little-endian interleaved)', () => {
    it('round-trips three interleaved channels', () => {
        const channels = [
            Int16Array.from([1, -2, 300, -4000]),
            Int16Array.from([5, 6, -7, 8]),
            Int16Array.from([-9, 10, -11, 12]),
        ];
        const encoded = encodeFormat16Interleaved(channels);
        expect(encoded).toHaveLength(2 * 3 * 4);

        const decoded = decodeFormat16Interleaved(encoded, 3, 4);
        expect(decoded).toHaveLength(3);
        expect(Array.from(decoded[0] ?? new Int16Array())).toEqual(
            Array.from(channels[0] ?? new Int16Array()),
        );
        expect(Array.from(decoded[2] ?? new Int16Array())).toEqual(
            Array.from(channels[2] ?? new Int16Array()),
        );
    });

    it('rejects a byte length inconsistent with channels x frames', () => {
        expect(
            errorCodeOf(() => decodeFormat16Interleaved(bytesOf([1, 2]), 2, 1)),
        ).toBe('invalid-input');
    });

    it('rejects unequal channel lengths on encode', () => {
        expect(
            errorCodeOf(() =>
                encodeFormat16Interleaved([
                    Int16Array.from([1, 2]),
                    Int16Array.from([1]),
                ]),
            ),
        ).toBe('invalid-input');
    });
});
