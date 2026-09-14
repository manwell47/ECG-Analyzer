/**
 * Viewport-preset derivation (Phase 7 item #11) — pure Node tests.
 *
 * These check the shape of the selectable viewport list the interaction control
 * offers (full record first, contiguous equal sub-windows after, stable labels)
 * and that the preset slicing reuses the domain duration conversion rather than
 * guessing. They do NOT assert anything about drawn pixels or DSP numerics —
 * they are ordinary unit tests of a tiny pure helper, kept apart from the
 * jsdom interaction behavior slice (`ViewControls.test.ts`).
 */

import { describe, expect, it } from 'vitest';

import { createSamplingInfo } from '../../../../domain/sampling';
import { DEFAULT_VIEWPORT_SEGMENTS, viewportPresets } from '../presets';

describe('viewportPresets', () => {
    const SAMPLING = createSamplingInfo(2, 0);

    it('leads with the whole acquisition window as the "Full record" option', () => {
        const presets = viewportPresets(SAMPLING, 8);

        expect(presets[0]).toEqual({
            label: 'Full record',
            viewport: { startSec: 0, durationSec: 4 },
        });
    });

    it('tiles the full window into the default count of contiguous sub-windows', () => {
        const presets = viewportPresets(SAMPLING, 8);

        // 8 samples at 2 Hz => 4 s; four equal quarters tile the full window.
        // (The full record is presets[0]; the sub-windows are presets[1..].)
        expect(presets).toHaveLength(1 + DEFAULT_VIEWPORT_SEGMENTS);
        const full = presets[0]!.viewport;
        const quarters = presets.slice(1).map((option) => option.viewport);

        expect(quarters).toHaveLength(DEFAULT_VIEWPORT_SEGMENTS);
        // The first quarter starts where the full window starts (startTimeSec).
        expect(quarters[0]!.startSec).toBeCloseTo(full.startSec, 9);
        // Every quarter has the same (equal) duration.
        for (const quarter of quarters) {
            expect(quarter.durationSec).toBeCloseTo(
                full.durationSec / DEFAULT_VIEWPORT_SEGMENTS,
                9,
            );
        }
        // Consecutive quarters are contiguous and gap-free: each starts exactly
        // where the previous one ended.
        for (let index = 1; index < quarters.length; index += 1) {
            const previous = quarters[index - 1]!;
            const current = quarters[index]!;
            expect(current.startSec).toBeCloseTo(
                previous.startSec + previous.durationSec,
                9,
            );
        }
        // The last quarter ends exactly at the end of the full window.
        const last = quarters[quarters.length - 1]!;
        expect(last.startSec + last.durationSec).toBeCloseTo(
            full.startSec + full.durationSec,
            9,
        );
    });

    it('labels sub-windows with their stable start–end range in seconds', () => {
        const presets = viewportPresets(SAMPLING, 8, 2);

        // 4 s record split in two => 2 s each, labelled with en-dash ranges.
        expect(presets.map((option) => option.label)).toEqual([
            'Full record',
            '0.00\u20132.00 s',
            '2.00\u20134.00 s',
        ]);
    });

    it('honours a non-zero record start on the time axis', () => {
        const offsetSampling = createSamplingInfo(10, 100);
        const presets = viewportPresets(offsetSampling, 100, 1);

        expect(presets[0]).toEqual({
            label: 'Full record',
            viewport: { startSec: 100, durationSec: 10 },
        });
        // The single sub-window tiles [100, 110) -> label offset by startTimeSec.
        expect(presets[1]).toEqual({
            label: '100.00\u2013110.00 s',
            viewport: { startSec: 100, durationSec: 10 },
        });
    });

    it('returns no presets when the record has no samples to zoom into', () => {
        expect(viewportPresets(SAMPLING, 0)).toEqual([]);
    });

    it('rejects an invalid segment count', () => {
        expect(() => viewportPresets(SAMPLING, 8, 0)).toThrow();
        expect(() => viewportPresets(SAMPLING, 8, -1)).toThrow();
        expect(() => viewportPresets(SAMPLING, 8, 2.5)).toThrow();
    });

    it('rejects a non-integer or negative sample count through the domain validator', () => {
        expect(() => viewportPresets(SAMPLING, 8.5)).toThrow();
        expect(() => viewportPresets(SAMPLING, -8)).toThrow();
    });
});
