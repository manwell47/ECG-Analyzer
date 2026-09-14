/**
 * WFDB `.dat` binary decoders (Phase 5 / ADR-006).
 *
 * These are faithful transcriptions of the wfdb 4.3.1 pure-Python reference
 * (`wfdb/io/_signal.py`, `_blocks_to_samples`), validated numerically against
 * real MIT-BIH record 100:
 *
 *     first bytes e3 33 f3 → ch0 = 0xe3 + (0x33 & 0x0f) << 8 = 995
 *                          → ch1 = 0xf3 + (0x33 >> 4)   << 8 = 1011
 *
 * which match the header `init_value` tokens exactly (see format212.test.ts).
 *
 * Format 212 packs one sample of two interleaved channels into 3 bytes; both
 * samples are 12-bit two's complement. Format 16 is plain little-endian,
 * signed 16-bit, channels interleaved per sample.
 */
import { EcgError } from '../../domain/error';

/**
 * Decode a format-212 block into its two interleaved channel buffers.
 *
 * @param bytes  Raw `.dat` bytes; length must equal `3 * frames`.
 * @param frames Number of 2-sample (3-byte) frames = samples per channel.
 * @returns `[channel0, channel1]`, each an `Int16Array` of length `frames`
 *          holding signed raw ADC counts (12-bit two's complement range).
 */
export function decodeFormat212(
    bytes: Uint8Array,
    frames: number,
): [Int16Array, Int16Array] {
    const expectedBytes = 3 * frames;
    if (!Number.isSafeInteger(frames) || frames < 0) {
        throw EcgError.invalidInput(
            `Format-212 frame count must be a non-negative integer, ` +
            `received ${String(frames)}.`,
        );
    }
    if (bytes.length !== expectedBytes) {
        throw EcgError.invalidInput(
            `Format-212 decode expected ${expectedBytes} bytes for ${frames} ` +
            `frames but received ${bytes.length}.`,
            { meta: { frames, expectedBytes, receivedBytes: bytes.length } },
        );
    }

    const channel0 = new Int16Array(frames);
    const channel1 = new Int16Array(frames);
    for (let f = 0; f < frames; f += 1) {
        const base = 3 * f;
        const b0 = bytes[base] ?? 0;
        const b1 = bytes[base + 1] ?? 0;
        const b2 = bytes[base + 2] ?? 0;

        let sample0 = b0 + ((b1 & 0x0f) << 8);
        let sample1 = b2 + ((b1 >> 4) << 8);
        // 12-bit two's complement: 2048..4095 are negative.
        if (sample0 > 2047) sample0 -= 4096;
        if (sample1 > 2047) sample1 -= 4096;

        channel0[f] = sample0;
        channel1[f] = sample1;
    }
    return [channel0, channel1];
}

/**
 * Encode two 12-bit-signed channel buffers back into format-212 bytes.
 * Inverse of {@link decodeFormat212} for round-trip and property tests.
 */
export function encodeFormat212(
    channel0: Int16Array,
    channel1: Int16Array,
): Uint8Array {
    if (channel0.length !== channel1.length) {
        throw EcgError.invalidInput(
            'Format-212 encode requires equal-length channels.',
        );
    }
    const frames = channel0.length;
    const bytes = new Uint8Array(3 * frames);
    for (let f = 0; f < frames; f += 1) {
        const s0 = channel0[f] ?? 0;
        const s1 = channel1[f] ?? 0;
        for (const s of [s0, s1]) {
            if (!Number.isInteger(s) || s < -2048 || s > 2047) {
                throw EcgError.invalidInput(
                    `Format-212 encode requires samples in -2048..2047; ` +
                    `received ${String(s)}.`,
                );
            }
        }
        const v0 = s0 < 0 ? s0 + 4096 : s0;
        const v1 = s1 < 0 ? s1 + 4096 : s1;
        const base = 3 * f;
        bytes[base] = v0 & 0xff;
        bytes[base + 1] = ((v0 >> 8) & 0x0f) | (((v1 >> 8) & 0x0f) << 4);
        bytes[base + 2] = v1 & 0xff;
    }
    return bytes;
}

/**
 * Decode a little-endian, interleaved 16-bit signed `.dat` block.
 *
 * Samples are stored channel-major within each time step:
 * `s[0]=ch0[0], s[1]=ch1[0], s[2]=ch0[1], ...` for two channels.
 *
 * @param bytes          Raw bytes; length must equal `2 * numChannels * frames`.
 * @param numChannels    Number of interleaved channels.
 * @param frames         Samples per channel.
 * @returns One `Int16Array` per channel, in interleave order.
 */
export function decodeFormat16Interleaved(
    bytes: Uint8Array,
    numChannels: number,
    frames: number,
): readonly Int16Array[] {
    const expectedBytes = 2 * numChannels * frames;
    if (!Number.isSafeInteger(frames) || frames < 0 || numChannels < 1) {
        throw EcgError.invalidInput(
            'Format-16 decode requires >= 1 channel and a non-negative frame count.',
        );
    }
    if (bytes.length !== expectedBytes) {
        throw EcgError.invalidInput(
            `Format-16 decode expected ${expectedBytes} bytes ` +
            `(${numChannels} channels x ${frames} frames) but received ` +
            `${bytes.length}.`,
        );
    }

    const channels: Int16Array[] = [];
    for (let c = 0; c < numChannels; c += 1) {
        channels.push(new Int16Array(frames));
    }
    const view = new DataView(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength,
    );
    for (let f = 0; f < frames; f += 1) {
        for (let c = 0; c < numChannels; c += 1) {
            const offset = 2 * (f * numChannels + c);
            // DataView.getInt16 is little-endian when the flag is true.
            (channels[c] as Int16Array)[f] = view.getInt16(offset, true);
        }
    }
    return channels;
}

/**
 * Encode channel buffers into a little-endian interleaved format-16 block.
 * Inverse of {@link decodeFormat16Interleaved} for round-trip tests.
 */
export function encodeFormat16Interleaved(
    channels: readonly Int16Array[],
): Uint8Array {
    if (channels.length < 1) {
        throw EcgError.invalidInput('Format-16 encode requires >= 1 channel.');
    }
    const frames = channels[0]?.length ?? 0;
    for (const channel of channels) {
        if (channel.length !== frames) {
            throw EcgError.invalidInput(
                'Format-16 encode requires equal-length channels.',
            );
        }
    }
    const bytes = new Uint8Array(2 * channels.length * frames);
    const view = new DataView(bytes.buffer);
    for (let f = 0; f < frames; f += 1) {
        for (let c = 0; c < channels.length; c += 1) {
            const offset = 2 * (f * channels.length + c);
            view.setInt16(offset, (channels[c] as Int16Array)[f] ?? 0, true);
        }
    }
    return bytes;
}
