/**
 * Shared DSP helpers (Phase 3).
 *
 * These are internal utilities used by the pure DSP primitives: provenance
 * appending (so every transform is recorded on the returned `Signal`, per the
 * architecture E.3 chain-of-history rule) and deterministic out-of-range sample
 * access with reflection, used for smooth filter/resampler edges.
 *
 * `dsp` never imports `ml/`, `application/`, `presentation/`, or any framework
 * (ADR-002). Everything here is pure and free of I/O.
 */

import type { Provenance, TransformStep } from '../domain';

/**
 * Return a copy of `provenance` with `step` appended to the transform history
 * (oldest first). The original object is not mutated.
 */
export function withTransform(
    provenance: Provenance,
    step: TransformStep,
): Provenance {
    return {
        source: provenance.source,
        transforms: [...provenance.transforms, step],
    };
}

/**
 * Read `values[index]` treating the array as *reflected* at both boundaries
 * (no edge sample is duplicated; mirroring is about the boundary line halfway
 * between samples). Deterministic and smooth — preferred over zero-padding for
 * filter warm-up and resampler edges.
 */
export function reflectSample(
    values: ArrayLike<number>,
    index: number,
): number {
    const n = values.length;
    if (n === 0) {
        throw new Error('reflectSample requires at least one sample.');
    }
    let i = index;
    if (i < 0) {
        // Reflect about -0.5: index -1 -> 0, -2 -> 1, ...
        i = -i - 1;
    } else if (i >= n) {
        // Reflect about n - 0.5: index n -> n - 1, n + 1 -> n - 2, ...
        i = 2 * n - i - 1;
    }
    if (i < 0 || i >= n) {
        // Extreme overhang: keep folding until back in range (finite loop).
        i = ((i % n) + n) % n;
    }
    return values[i]!;
}

/**
 * Deterministic per-step transform name derived from a stable base id and the
 * canonical transform name, e.g. `mitdb/100 :: filter-lowpass-40hz`.
 */
export function deriveTransformId(baseId: string, transformName: string): string {
    return `${baseId} :: ${transformName}`;
}
