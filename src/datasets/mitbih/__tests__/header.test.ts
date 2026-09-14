/**
 * `.hea` header parser tests (Phase 5 / ADR-006).
 *
 * Pins the parser against the *real* MIT-BIH record 100 header (fixture,
 * read verbatim from data/raw/mitdb/100.hea) plus the wfdb defaulting grammar
 * the adapter depends on: absent baseline -> adc_zero, absent units -> 'mV',
 * and an adc_gain of 0 meaning 200.
 */
import { describe, expect, it } from 'vitest';

import { EcgError } from '../../../domain/error';
import { parseMitBihHeader } from '../header';

/** Verbatim content of data/raw/mitdb/100.hea. */
const REAL_100_HEA = [
    '100 2 360 650000',
    '100.dat 212 200 11 1024 995 -22131 0 MLII',
    '100.dat 212 200 11 1024 1011 20052 0 V5',
    '# 69 M 1085 1629 x1',
    '# Aldomet, Inderal',
].join('\n');

function headerError(text: string): string | undefined {
    try {
        parseMitBihHeader(text);
    } catch (error) {
        if (error instanceof EcgError) {
            return error.code;
        }
    }
    return undefined;
}

describe('real MIT-BIH record 100 header (fixture)', () => {
    const header = parseMitBihHeader(REAL_100_HEA);

    it('parses the record line verbatim', () => {
        expect(header.recordName).toBe('100');
        expect(header.numSignals).toBe(2);
        expect(header.sampleRateHz).toBe(360);
        expect(header.samplesPerSignal).toBe(650000);
        expect(header.baseTime).toBeNull();
        expect(header.baseDate).toBeNull();
    });

    it('exposes exactly the two declared channels in file order', () => {
        expect(header.channels).toHaveLength(2);
        expect(header.channels.map((channel) => channel.sigName)).toEqual([
            'MLII',
            'V5',
        ]);
    });

    it('decodes channel 0 metadata (MLII)', () => {
        const channel = header.channels[0];
        expect(channel?.fileBase).toBe('100.dat');
        expect(channel?.format).toBe(212);
        expect(channel?.adcGain).toBe(200);
        expect(channel?.adcZero).toBe(1024);
        // Absent baseline defaults to adc_zero.
        expect(channel?.baseline).toBe(1024);
        expect(channel?.units).toBe('mV');
        expect(channel?.adcRes).toBe(11);
        expect(channel?.initValue).toBe(995);
        expect(channel?.checksum).toBe(-22131);
        expect(channel?.blockSize).toBe(0);
        expect(channel?.sampsPerFrame).toBe(1);
    });

    it('decodes channel 1 metadata (V5)', () => {
        const channel = header.channels[1];
        expect(channel?.initValue).toBe(1011);
        expect(channel?.checksum).toBe(20052);
        expect(channel?.baseline).toBe(1024);
        expect(channel?.adcGain).toBe(200);
        expect(channel?.adcRes).toBe(11);
    });

    it('preserves comment lines (the patient demographics line is not dropped)', () => {
        expect(header.comments).toEqual([
            '# 69 M 1085 1629 x1',
            '# Aldomet, Inderal',
        ]);
    });

    it('accepts CRLF line endings', () => {
        const crlf = parseMitBihHeader(REAL_100_HEA.replace(/\n/g, '\r\n'));
        expect(crlf.channels).toHaveLength(2);
        expect(crlf.comments).toEqual(header.comments);
    });
});

describe('wfdb defaulting grammar', () => {
    it('reads an attached (baseline)/units pair distinct from adc_zero', () => {
        const text = [
            'y 1 250 4',
            'y.dat 212 200(1000)/mV 11 1024 5 0 0 II',
        ].join('\n');
        const header = parseMitBihHeader(text);
        const channel = header.channels[0];
        expect(channel?.adcGain).toBe(200);
        expect(channel?.baseline).toBe(1000);
        expect(channel?.adcZero).toBe(1024);
        expect(channel?.units).toBe('mV');
        expect(channel?.sigName).toBe('II');
    });

    it('defaults an absent units token to mV', () => {
        const text = [
            'z 1 250 4',
            'z.dat 212 200 11 1024 0 0 0 II',
        ].join('\n');
        const channel = parseMitBihHeader(text).channels[0];
        expect(channel?.units).toBe('mV');
        expect(channel?.baseline).toBe(1024);
    });

    it('normalises an adc_gain of 0 to 200 (wfdb convention)', () => {
        const text = [
            'g 1 250 4',
            'g.dat 212 0 11 1024 0 0 0',
        ].join('\n');
        const channel = parseMitBihHeader(text).channels[0];
        expect(channel?.adcGain).toBe(200);
    });

    it('captures an optional base time and base date token', () => {
        const text = [
            'w 1 250 10 12:23:00 07/08/91',
            'w.dat 212 200 11 1024 0 0 0',
        ].join('\n');
        const header = parseMitBihHeader(text);
        expect(header.baseTime).toBe('12:23:00');
        expect(header.baseDate).toBe('07/08/91');
    });
});

describe('explicit validation errors (documented behaviour)', () => {
    it('rejects an empty header with malformed-header', () => {
        expect(headerError('')).toBe('malformed-header');
    });

    it('rejects a header with no signal lines', () => {
        expect(headerError('100 2 360 650000')).toBe('malformed-header');
    });

    it('rejects a mismatch between declared and present signal counts', () => {
        const text = [
            '100 3 360 10',
            '100.dat 212 200 11 1024 0 0 0 MLII',
            '100.dat 212 200 11 1024 0 0 0 V5',
        ].join('\n');
        expect(headerError(text)).toBe('malformed-header');
    });

    it('rejects a negative gain', () => {
        const text = [
            'n 1 250 4',
            'n.dat 212 -200 11 1024 0 0 0',
        ].join('\n');
        expect(headerError(text)).toBe('malformed-header');
    });

    it('rejects a non-numeric or non-positive sampling frequency', () => {
        const nonNumeric = ['n 1 abc 4', 'n.dat 212 200 11 1024 0 0 0'].join('\n');
        const nonPositive = ['n 1 0 4', 'n.dat 212 200 11 1024 0 0 0'].join('\n');
        expect(headerError(nonNumeric)).toBe('malformed-header');
        expect(headerError(nonPositive)).toBe('malformed-header');
    });

    it('rejects an unsupported WFDB format with unsupported-format', () => {
        const text = [
            'u 1 250 4',
            'u.dat 80 200 11 1024 0 0 0',
        ].join('\n');
        expect(headerError(text)).toBe('unsupported-format');
    });
});
