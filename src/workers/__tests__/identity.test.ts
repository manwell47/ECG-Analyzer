/**
 * LatestIdentityGate tests (Phase 6 / ADR-005; rules §31).
 *
 * The gate is the pure, transport-free state behind "keep only the latest
 * request": `issue` mints monotonic ids, `isCurrent` answers whether a
 * completion still belongs to the request the caller is waiting for, and
 * `reset` forgets the current identity without ever reusing a sequence number.
 */

import { describe, expect, it } from 'vitest';
import { LatestIdentityGate } from '../identity';

describe('LatestIdentityGate', () => {
    it('mints monotonic request ids in issue order', () => {
        const gate = new LatestIdentityGate();
        expect(gate.issue('sig-A')).toBe('inference-0');
        expect(gate.issue('sig-B')).toBe('inference-1');
        expect(gate.issue('sig-C')).toBe('inference-2');
    });

    it('tracks only the most recent request and its signal', () => {
        const gate = new LatestIdentityGate();
        expect(gate.currentSignalId()).toBeUndefined();

        const first = gate.issue('sig-A');
        expect(gate.isCurrent(first)).toBe(true);
        expect(gate.currentSignalId()).toBe('sig-A');

        const second = gate.issue('sig-B');
        expect(gate.isCurrent(second)).toBe(true);
        expect(gate.isCurrent(first)).toBe(false);
        expect(gate.currentSignalId()).toBe('sig-B');
    });

    it('considers unknown ids non-current', () => {
        const gate = new LatestIdentityGate();
        gate.issue('sig-A');
        expect(gate.isCurrent('inference-999')).toBe(false);
        expect(gate.isCurrent('never-issued')).toBe(false);
    });

    it('reset forgets the current identity without reusing a sequence number', () => {
        const gate = new LatestIdentityGate();
        gate.issue('sig-A');
        gate.reset();
        expect(gate.currentSignalId()).toBeUndefined();
        expect(gate.isCurrent('inference-0')).toBe(false);
        // Monotonicity is never reused after a reset.
        expect(gate.issue('sig-B')).toBe('inference-1');
    });
});
