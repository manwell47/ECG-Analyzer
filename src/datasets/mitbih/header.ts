/**
 * MIT-BIH / WFDB `.hea` header parser (Phase 5 / ADR-006).
 *
 * Faithful transcription of the wfdb 4.3.1 reference (`wfdb/io/_header.py`,
 * `_parse_record_line` / `_parse_signal_lines` + `wfdb/io/header.py` regexes),
 * restricted to the grammar MIT-BIH actually uses.
 *
 * Key semantics reproduced here (each pinned by header.test.ts against the real
 * record 100 header):
 *
 * - The record line is `record_name n_sig sample_rate samples_per_signal`
 *   (optional trailing base_time/base_date are preserved verbatim, not parsed).
 * - A signal line's numeric fields appear in the order
 *   `adc_gain (baseline) /units adc_res adc_zero init_value checksum block_size sig_name`.
 *   Baseline and units are only present when *attached* to the gain token
 *   (`200(1024)/mV`); in the plain MIT-BIH layout they are absent.
 * - **Absent `baseline` defaults to `adc_zero`**; absent `units` defaults to
 *   `'mV'`; an `adc_gain` of `0` means `200` (wfdb conventions).
 * - `samps_per_frame`/`skew`/`byte_offset` may be attached to the format token
 *   (`212x2:0+0`); MIT-BIH uses none, so they default (`samps_per_frame = 1`).
 *
 * Comment lines (starting with `#`) are captured verbatim (trimmed) and
 * surfaced on the parsed header — never dropped, because `# 69 M 1085 1629 x1`
 * is the patient demographics line.
 */
import { EcgError } from '../../domain/error';

/** WFDB numeric encodings the MIT-BIH adapter understands. */
export type MitBihSupportedFormat = 212 | 16;

/** Formats recognised by this parser (others raise `unsupported-format`). */
export const MIT_BIH_SUPPORTED_FORMATS: readonly number[] = [212, 16];

/** One parsed signal (channel) line of a `.hea` file. */
export interface MitBihChannelDescriptor {
    /** Bare data file name, e.g. `'100.dat'`. */
    readonly fileBase: string;
    /** WFDB sample format code, e.g. `212` or `16`. */
    readonly format: number;
    /** Samples per frame (default 1). */
    readonly sampsPerFrame: number;
    /** Inter-channel skew in samples (null when not declared). */
    readonly skew: number | null;
    /** Byte offset to the start of this signal (null when not declared). */
    readonly byteOffset: number | null;
    /** ADC counts per physical unit (0 is normalised to 200). */
    readonly adcGain: number;
    /** ADC value of zero amplitude (defaults to `adcZero` when absent). */
    readonly baseline: number;
    /** Physical units string (defaults to `'mV'`). */
    readonly units: string;
    /** Declared ADC resolution in bits. */
    readonly adcRes: number;
    /** ADC value corresponding to digital zero. */
    readonly adcZero: number;
    /** Declared value of the first stored sample. */
    readonly initValue: number;
    /** Declared 16-bit checksum of this channel's samples. */
    readonly checksum: number;
    /** Block size hint (0 when absent). */
    readonly blockSize: number;
    /** Channel/lead description ('' when absent). */
    readonly sigName: string;
}

/** A fully parsed, internally validated MIT-BIH `.hea` file. */
export interface MitBihHeader {
    /** Record name declared on the record line, e.g. `'100'`. */
    readonly recordName: string;
    /** Number of signals; must equal `channels.length`. */
    readonly numSignals: number;
    /** Sampling frequency in Hz (360 for MIT-BIH). */
    readonly sampleRateHz: number;
    /** Declared samples per signal (650000 for MIT-BIH). */
    readonly samplesPerSignal: number;
    /** Raw base-time token when present (MIT-BIH has none). */
    readonly baseTime: string | null;
    /** Raw base-date token when present (MIT-BIH has none). */
    readonly baseDate: string | null;
    /** One descriptor per signal line, in file order. */
    readonly channels: readonly MitBihChannelDescriptor[];
    /** Verbatim (trimmed) `#` comment lines, including the `#`. */
    readonly comments: readonly string[];
}

const INT_RE = /^-?\d+$/;

function parseIntField(token: string | undefined, label: string, lineNo: number): number {
    if (token === undefined || !INT_RE.test(token)) {
        throw EcgError.malformedHeader(
            `Expected ${label} to be an integer on signal line ${lineNo}; ` +
            `received ${JSON.stringify(token ?? '(missing)')}.`,
        );
    }
    return Number.parseInt(token, 10);
}

function parseRecordLine(line: string): {
    recordName: string;
    numSignals: number;
    sampleRateHz: number;
    samplesPerSignal: number;
    baseTime: string | null;
    baseDate: string | null;
} {
    const tokens = line.trim().split(/\s+/);
    const recordToken = tokens[0];
    if (recordToken === undefined) {
        throw EcgError.malformedHeader('Record line is empty.');
    }
    // Optional `/n_seg` may trail the record name (`100` / `100/3`).
    const [recordName] = recordToken.split('/');
    if (recordName === undefined || recordName.length === 0) {
        throw EcgError.malformedHeader(
            `Record line has an empty record name: ${JSON.stringify(line)}.`,
        );
    }

    const numSignals = parseIntField(tokens[1], 'number of signals', 1);
    const fsToken = tokens[2];
    if (fsToken === undefined || !/^-?\d*\.?\d*$/.test(fsToken) || fsToken.length === 0) {
        throw EcgError.malformedHeader(
            `Expected a sampling frequency on the record line; ` +
            `received ${JSON.stringify(fsToken ?? '(missing)')}.`,
        );
    }
    const sampleRateHz = Number.parseFloat(fsToken);
    if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
        throw EcgError.malformedHeader(
            `Record sampling frequency must be > 0, received ${fsToken}.`,
        );
    }

    const sigLenToken = tokens[3];
    const samplesPerSignal =
        sigLenToken === undefined || sigLenToken.length === 0
            ? 0
            : parseIntField(sigLenToken, 'samples per signal', 1);

    return {
        recordName,
        numSignals,
        sampleRateHz,
        samplesPerSignal,
        baseTime: tokens[4] ?? null,
        baseDate: tokens[5] ?? null,
    };
}

/**
 * Parse one signal line into a channel descriptor. Numeric fields after the
 * gain token are, in order: `adc_res adc_zero init_value checksum [block_size] [sig_name]`
 * (MIT-BIH always declares all of these; block_size is typically `0`).
 */
function parseSignalLine(line: string, channelIndex: number): MitBihChannelDescriptor {
    const lineNo = channelIndex + 2;
    const tokens = line.trim().split(/\s+/);
    const fileBase = tokens[0];
    const fmtToken = tokens[1];
    const gainToken = tokens[2];
    if (fileBase === undefined || fmtToken === undefined || gainToken === undefined) {
        throw EcgError.malformedHeader(
            `Signal line ${lineNo} is missing required fields (file name, format, gain).`,
        );
    }

    // Format token with optional `x{samps_per_frame}` `:{skew}` `+{byte_offset}` suffix.
    const fmtMatch = /^(\d+)(?:x(\d+))?(?::(-?\d+))?(?:\+(\d+))?$/.exec(fmtToken);
    if (fmtMatch === null) {
        throw EcgError.malformedHeader(
            `Signal line ${lineNo} has an unparsable format token ${JSON.stringify(fmtToken)}.`,
        );
    }
    const format = Number.parseInt(fmtMatch[1] ?? '', 10);
    if (!MIT_BIH_SUPPORTED_FORMATS.includes(format)) {
        throw EcgError.unsupportedFormat(
            `Signal line ${lineNo} uses unsupported WFDB format ${format} ` +
            `(supported: ${MIT_BIH_SUPPORTED_FORMATS.join(', ')}).`,
            { meta: { channel: channelIndex, format } },
        );
    }
    const sampsPerFrame =
        fmtMatch[2] === undefined ? 1 : Number.parseInt(fmtMatch[2], 10);
    const skew = fmtMatch[3] === undefined ? null : Number.parseInt(fmtMatch[3], 10);
    const byteOffset =
        fmtMatch[4] === undefined ? null : Number.parseInt(fmtMatch[4], 10);

    // Gain token with optional attached `(baseline)` and/or `/units`.
    const gainMatch =
        /^(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?:\((-?\d+)\))?(?:\/(\S*))?$/.exec(
            gainToken,
        );
    if (gainMatch === null) {
        throw EcgError.malformedHeader(
            `Signal line ${lineNo} has an unparsable gain token ` +
            `${JSON.stringify(gainToken)}.`,
        );
    }
    let adcGain = Number.parseFloat(gainMatch[1] ?? '');
    if (!Number.isFinite(adcGain) || adcGain < 0) {
        throw EcgError.malformedHeader(
            `Signal line ${lineNo} gain must be a finite number >= 0, ` +
            `received ${gainMatch[1]}.`,
        );
    }
    if (adcGain === 0) adcGain = 200; // wfdb convention: 0 means 200.
    const parenBaseline =
        gainMatch[2] === undefined ? null : Number.parseInt(gainMatch[2], 10);
    const unitsToken = gainMatch[3];

    // Remaining numeric fields: adc_res adc_zero init_value checksum [block_size] [sig_name].
    const rest = tokens.slice(3);
    const adcRes = parseIntField(rest[0], 'adc resolution', lineNo);
    const adcZero = parseIntField(rest[1], 'adc zero', lineNo);
    const initValue = parseIntField(rest[2], 'initial value', lineNo);
    const checksum = parseIntField(rest[3], 'checksum', lineNo);

    let blockSize = 0;
    let sigName = '';
    const afterRequired = rest.slice(4);
    if (afterRequired.length > 0 && INT_RE.test(afterRequired[0] ?? '')) {
        blockSize = Number.parseInt(afterRequired[0] ?? '', 10);
        sigName = afterRequired.slice(1).join(' ').trim();
    } else if (afterRequired.length > 0) {
        sigName = afterRequired.join(' ').trim();
    }

    // wfdb defaulting: absent baseline -> adc_zero; absent units -> 'mV'.
    const baseline = parenBaseline === null ? adcZero : parenBaseline;
    const units = unitsToken === undefined || unitsToken.length === 0 ? 'mV' : unitsToken;

    return {
        fileBase,
        format,
        sampsPerFrame,
        skew,
        byteOffset,
        adcGain,
        baseline,
        units,
        adcRes,
        adcZero,
        initValue,
        checksum,
        blockSize,
        sigName,
    };
}

/**
 * Parse and structurally validate a `.hea` file's text.
 *
 * @throws `EcgError` with code `malformed-header` for structural/syntax
 *         problems and `unsupported-format` for unrecognised WFDB formats.
 */
export function parseMitBihHeader(text: string): MitBihHeader {
    const headerLines: string[] = [];
    const comments: string[] = [];
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (line.startsWith('#')) {
            comments.push(line);
        } else if (line.length > 0) {
            headerLines.push(line);
        }
    }

    const recordLine = headerLines[0];
    if (recordLine === undefined) {
        throw EcgError.malformedHeader('Header contains no record line.');
    }
    const signalLines = headerLines.slice(1);
    if (signalLines.length === 0) {
        throw EcgError.malformedHeader('Header declares no signal lines.');
    }

    const record = parseRecordLine(recordLine);
    const channels = signalLines.map(parseSignalLine);

    // Internal consistency.
    if (record.numSignals !== channels.length) {
        throw EcgError.malformedHeader(
            `Record line declares ${record.numSignals} signals but the file ` +
            `contains ${channels.length} signal lines.`,
            { meta: { declared: record.numSignals, found: channels.length } },
        );
    }

    return {
        recordName: record.recordName,
        numSignals: record.numSignals,
        sampleRateHz: record.sampleRateHz,
        samplesPerSignal: record.samplesPerSignal,
        baseTime: record.baseTime,
        baseDate: record.baseDate,
        channels,
        comments: Object.freeze([...comments]),
    };
}
