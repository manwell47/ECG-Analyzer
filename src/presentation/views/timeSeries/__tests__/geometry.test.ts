/**
 * Pure viewport -> sample mapping / decimation tests (Phase 7 item #9).
 *
 * Node environment (no `// @vitest-environment jsdom` directive) — this module
 * is DOM-free by design, so its unit tests run in the global Node default and
 * never need a canvas. Every assertion here is about pure arithmetic over
 * arrays and sampling metadata, reusing the domain time<->sample conversions.
 */

import { describe, expect, it } from 'vitest';

import { createSamplingInfo } from '../../../../domain/sampling';
import {
    envelopeColumns,
    partitionSampleWindow,
    sampleWindowOfTime,
    visibleAmplitudeBounds,
} from '../geometry';

const HZ = 2;
const sampleRate = createSamplingInfo(HZ, 0);

describe('sampleWindowOfTime (viewport -> half-open sample window)', () => {
    it('maps the full acquisition window to [0, sampleCount)', () => {
        expect(sampleWindowOfTime({ startSec: 0, durationSec: 5 }, sampleRate, 10)).toEqual({
            startSample: 0,
            endSample: 10,
        });
    });

    it('maps an interior window with floor on the left and ceil on the right', () => {
        // Samples sit at 0.0, 0.5, 1.0, ... so [1.0, 3.0) s == samples [2, 6).
        expect(sampleWindowOfTime({ startSec: 1, durationSec: 2 }, sampleRate, 10)).toEqual({
            startSample: 2,
            endSample: 6,
        });
    });

    it('rounds fractional edges outward so coverage never shrinks silently', () => {
        // [1.25, 2.75) s -> left edge between sample 2 and 3, right edge
        // between sample 5 and 6 -> covers samples [2, 6).
        expect(
            sampleWindowOfTime({ startSec: 1.25, durationSec: 1.5 }, sampleRate, 10),
        ).toEqual({ startSample: 2, endSample: 6 });
    });

    it('clamps a window that starts before the record to sample 0', () => {
        // [10.0 s, 11.0 s) with startTimeSec 0 falls entirely before sample 0.
        expect(sampleWindowOfTime({ startSec: -1, durationSec: 0.5 }, sampleRate, 10)).toEqual({
            startSample: 0,
            endSample: 0,
        });
    });

    it('clamps a window entirely after the record to the empty tail', () => {
        expect(sampleWindowOfTime({ startSec: 100, durationSec: 1 }, sampleRate, 10)).toEqual({
            startSample: 10,
            endSample: 10,
        });
    });

    it('returns an empty window for a non-positive duration', () => {
        expect(sampleWindowOfTime({ startSec: 0, durationSec: 0 }, sampleRate, 10)).toEqual({
            startSample: 0,
            endSample: 0,
        });
        expect(sampleWindowOfTime({ startSec: 0, durationSec: -2 }, sampleRate, 10)).toEqual({
            startSample: 0,
            endSample: 0,
        });
    });

    it('respects an absolute time axis with a non-zero startTimeSec', () => {
        // startTimeSec = 10 means sample i occurs at 10 + i/2 s; asking for the
        // [10 s, 12 s) viewport must still land on samples [0, 4).
        const offset = createSamplingInfo(HZ, 10);
        expect(sampleWindowOfTime({ startSec: 10, durationSec: 2 }, offset, 10)).toEqual({
            startSample: 0,
            endSample: 4,
        });
    });

    it('rejects a non-safe-integer sample count', () => {
        expect(() =>
            sampleWindowOfTime({ startSec: 0, durationSec: 1 }, sampleRate, 1.5),
        ).toThrow(/sample count/);
    });
});

describe('partitionSampleWindow (contiguous, gap-free column buckets)', () => {
    it('covers [0, 10) exactly with four floor-rounded buckets', () => {
        const buckets = partitionSampleWindow({ startSample: 0, endSample: 10 }, 4);
        expect(buckets).toEqual([
            { startSample: 0, endSample: 2 },
            { startSample: 2, endSample: 5 },
            { startSample: 5, endSample: 7 },
            { startSample: 7, endSample: 10 },
        ]);
    });

    it('is contiguous and gap-free so the union equals the window', () => {
        const buckets = partitionSampleWindow({ startSample: 0, endSample: 10 }, 4);
        for (let index = 1; index < buckets.length; index += 1) {
            expect(buckets[index]?.startSample).toBe(buckets[index - 1]?.endSample);
        }
        expect(buckets[0]?.startSample).toBe(0);
        expect(buckets[buckets.length - 1]?.endSample).toBe(10);
    });

    it('uses a single bucket spanning the whole window for one column', () => {
        expect(partitionSampleWindow({ startSample: 2, endSample: 6 }, 1)).toEqual([
            { startSample: 2, endSample: 6 },
        ]);
    });

    it('keeps the union exact even when there are more columns than samples', () => {
        const buckets = partitionSampleWindow({ startSample: 0, endSample: 3 }, 5);
        // Empty buckets are allowed; the populated ones still tile [0, 3).
        let cursor = 0;
        for (const bucket of buckets) {
            expect(bucket.startSample).toBe(cursor);
            cursor = bucket.endSample;
        }
        expect(cursor).toBe(3);
        expect(buckets.length).toBe(5);
    });

    it('partitions an empty window to no buckets', () => {
        expect(partitionSampleWindow({ startSample: 4, endSample: 4 }, 4)).toEqual([]);
    });
});

describe('envelopeColumns (read-only min/max decimation)', () => {
    it('yields one single-sample column per sample when columnCount == length', () => {
        const data = new Float64Array([3, 1, 4, 1, 5]);
        const columns = envelopeColumns(data, { startSample: 0, endSample: 5 }, 5);
        expect(columns).toHaveLength(5);
        expect(columns[2]).toEqual({
            startSample: 2,
            endSample: 3,
            populated: true,
            min: 4,
            max: 4,
        });
    });

    it('reduces a full window to a single min/max column', () => {
        const data = new Float64Array([5, 1, 4, 3, 8, 0, 2, 9, 7, 6]);
        const columns = envelopeColumns(data, { startSample: 0, endSample: 10 }, 1);
        expect(columns).toEqual([
            { startSample: 0, endSample: 10, populated: true, min: 0, max: 9 },
        ]);
    });

    it('only considers samples inside the window (interior viewport)', () => {
        const data = new Float64Array([100, 100, 5, 1, 9, 100, 100]);
        const columns = envelopeColumns(data, { startSample: 2, endSample: 5 }, 1);
        expect(columns).toEqual([
            { startSample: 2, endSample: 5, populated: true, min: 1, max: 9 },
        ]);
    });

    it('never mutates the source data', () => {
        const data = new Float64Array([3, -2, 7, 0, 4]);
        const before = Array.from(data);
        envelopeColumns(data, { startSample: 0, endSample: 5 }, 2);
        expect(Array.from(data)).toEqual(before);
    });

    it('returns no columns for an empty window', () => {
        expect(envelopeColumns(new Float64Array([1, 2, 3]), { startSample: 1, endSample: 1 }, 4)).toEqual(
            [],
        );
    });
});

describe('visibleAmplitudeBounds (amplitude domain over populated columns)', () => {
    it('spans the true min/max across all populated columns', () => {
        const data = new Float64Array([5, 1, 4, 3, 8, 0, 2, 9, 7, 6]);
        const columns = envelopeColumns(data, { startSample: 0, endSample: 10 }, 3);
        expect(visibleAmplitudeBounds(columns)).toEqual({ populated: true, min: 0, max: 9 });
    });

    it('ignores empty columns when computing the bounds', () => {
        const data = new Float64Array([2, 4]);
        const columns = envelopeColumns(data, { startSample: 0, endSample: 2 }, 4);
        expect(visibleAmplitudeBounds(columns)).toEqual({ populated: true, min: 2, max: 4 });
    });

    it('reports an unpainted window as not populated', () => {
        expect(visibleAmplitudeBounds([])).toEqual({
            populated: false,
            min: Number.POSITIVE_INFINITY,
            max: Number.NEGATIVE_INFINITY,
        });
    });
});
