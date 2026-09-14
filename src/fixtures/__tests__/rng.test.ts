import { describe, expect, it } from 'vitest';
import { createGaussianRng, createUniformRng } from '../rng';

describe('createUniformRng (mulberry32)', () => {
    it('is deterministic for a fixed seed', () => {
        const a = createUniformRng(20260903);
        const b = createUniformRng(20260903);
        for (let i = 0; i < 2000; i += 1) {
            expect(a.next()).toBe(b.next());
        }
    });

    it('draws values in [0, 1)', () => {
        const rng = createUniformRng(1);
        for (let i = 0; i < 20_000; i += 1) {
            const value = rng.next();
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThan(1);
        }
    });

    it('produces different streams for different seeds', () => {
        const first = Array.from({ length: 64 }, () => createUniformRng(1).next());
        const second = Array.from({ length: 64 }, () => createUniformRng(2).next());
        expect(first).not.toEqual(second);
    });
});

describe('createGaussianRng (Box–Muller)', () => {
    it('is deterministic for a fixed seed', () => {
        const a = createGaussianRng(7);
        const b = createGaussianRng(7);
        for (let i = 0; i < 2000; i += 1) {
            expect(a.next()).toBe(b.next());
        }
    });

    it('is deterministic across the cached-spare boundary', () => {
        // Box–Muller emits two draws per two uniforms (one cached). Make sure the
        // spare cache does not leak state between two identically seeded streams.
        const oddCount = createGaussianRng(99);
        oddCount.next();
        const a = oddCount;
        const b = createGaussianRng(99);
        b.next();
        for (let i = 0; i < 500; i += 1) {
            expect(a.next()).toBe(b.next());
        }
    });

    it('draws from an approximately standard normal distribution', () => {
        const rng = createGaussianRng(20260903);
        const n = 50_000;
        let sum = 0;
        let sumSq = 0;
        for (let i = 0; i < n; i += 1) {
            const value = rng.next();
            sum += value;
            sumSq += value * value;
        }
        const mean = sum / n;
        const variance = sumSq / n - mean * mean;
        // Standard error of the mean ~ 1/sqrt(50000) ~ 0.0045; 3-sigma < 0.014.
        expect(mean).toBeCloseTo(0, 1);
        expect(Math.sqrt(variance)).toBeCloseTo(1, 1);
    });
});
