/**
 * Deterministic pseudo-random number generation for scientific fixtures.
 *
 * Every stochastic synthetic signal must be reproducible across platforms,
 * runs and machines. All draws come from an integer-seeded mulberry32 uniform
 * stream (Box–Muller for gaussian draws). `Math.random()` is never used in
 * fixture generation.
 */

export interface UniformRng {
    /** Next uniform draw in [0, 1). */
    next(): number;
}

/** mulberry32 — deterministic, seedable, adequate for synthetic fixtures. */
export function createUniformRng(seed: number): UniformRng {
    let state = seed >>> 0;
    return {
        next(): number {
            state = (state + 0x6d2b79f5) >>> 0;
            let t = state;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        },
    };
}

export interface GaussianRng {
    /** Next draw from N(0,1). */
    next(): number;
}

/** Standard-normal draws via Box–Muller over a seeded uniform stream. */
export function createGaussianRng(seed: number): GaussianRng {
    const uniform = createUniformRng(seed);
    let spare: number | null = null;
    return {
        next(): number {
            if (spare !== null) {
                const cached = spare;
                spare = null;
                return cached;
            }
            // Box–Muller needs u1 in (0,1]; guard the measure-zero draw of exactly 0.
            let u1 = uniform.next();
            while (u1 === 0) {
                u1 = uniform.next();
            }
            const u2 = uniform.next();
            const radius = Math.sqrt(-2 * Math.log(u1));
            const theta = 2 * Math.PI * u2;
            spare = radius * Math.sin(theta);
            return radius * Math.cos(theta);
        },
    };
}
