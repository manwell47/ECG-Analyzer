/**
 * Phase-3 DSP — band-limited resampling (windowed-sinc interpolation).
 *
 * Rationale (architecture §G.2; ADR-002):
 * - Resampling returns a **new `Signal` carrying a new `SamplingInfo`**; the
 *   input rate is never mutated in place and the input signal is untouched.
 * - Nearest-neighbour / linear-interpolation shortcuts are **banned** for
 *   scientific signals by the architecture. This module uses windowed-sinc
 *   (Hamming-windowed) interpolation, which is the canonical band-limited
 *   reconstruction: it is exact for any signal band-limited below the Nyquist
 *   of the *output* rate, and the anti-alias cutoff is explicit.
 * - The interpolation low-pass cutoff is `fc = 0.5 * min(1, R)` cycles per
 *   *input* sample, where `R = targetRate / sourceRate`. For downsampling
 *   (R < 1) this removes content above the output Nyquist before re-sampling
 *   (anti-alias on by construction); for upsampling (R > 1) it reconstructs
 *   the band-limited signal at the input Nyquist.
 * - Every output sample is normalised by the sum of its kernel weights, so DC
 *   is preserved exactly and window droop is cancelled.
 *
 * Edge handling is explicit (`reflect` default for smooth edges, or `zero`).
 */

import {
    createSamplingInfo,
    createSignal,
    EcgError,
    type Signal,
    type SignalChannel,
} from '../domain';
import { deriveTransformId, reflectSample, withTransform } from './helpers';

export type ResamplingEdgeMode = 'reflect' | 'zero';

export interface ResamplingSpec {
    /**
     * One-sided kernel radius in input samples. Larger is closer to the ideal
     * brick-wall filter but increases cost and edge margin. Default 8.
     */
    readonly kernelRadiusSamples?: number;
    /** How to source input samples beyond the recorded window. Default 'reflect'. */
    readonly edgeMode?: ResamplingEdgeMode;
}

export interface ResolvedResamplingSpec {
    readonly kernelRadiusSamples: number;
    readonly edgeMode: ResamplingEdgeMode;
    /** Interpolation low-pass cutoff in cycles per input sample. */
    readonly cutoffCyclesPerSample: number;
    readonly ratio: number;
}

export function resolveResamplingSpec(
    sampleRateHz: number,
    targetRateHz: number,
    spec: ResamplingSpec = {},
): ResolvedResamplingSpec {
    if (!Number.isFinite(targetRateHz) || targetRateHz <= 0) {
        throw EcgError.invalidInput(
            `Resampling target rate must be finite and > 0, received ` +
            `${String(targetRateHz)}.`,
        );
    }
    const radius = spec.kernelRadiusSamples ?? 8;
    if (!Number.isSafeInteger(radius) || radius < 2) {
        throw EcgError.invalidInput(
            `Resampling kernel radius must be an integer >= 2, received ` +
            `${String(radius)}.`,
        );
    }
    const edgeMode = spec.edgeMode ?? 'reflect';
    if (edgeMode !== 'reflect' && edgeMode !== 'zero') {
        throw EcgError.invalidInput(
            `Unsupported resampling edge mode ${JSON.stringify(edgeMode)}; ` +
            'expected "reflect" or "zero".',
        );
    }
    const ratio = targetRateHz / sampleRateHz;
    return {
        kernelRadiusSamples: radius,
        edgeMode,
        cutoffCyclesPerSample: 0.5 * Math.min(1, ratio),
        ratio,
    };
}

function sinc(x: number): number {
    if (x === 0) {
        return 1;
    }
    const px = Math.PI * x;
    return Math.sin(px) / px;
}

/**
 * Hamming-windowed sinc kernel evaluated at `x` input samples from centre.
 * `cutoffCyclesPerSample` is the interpolation low-pass cutoff.
 */
function kernelValue(
    x: number,
    cutoffCyclesPerSample: number,
    radius: number,
): number {
    const ax = Math.abs(x);
    if (ax > radius) {
        return 0;
    }
    // Hamming window scaled so it is 1 at the centre and ~0.08 at the edge.
    const w = 0.54 + 0.46 * Math.cos((Math.PI * x) / radius);
    return w * 2 * cutoffCyclesPerSample * sinc(2 * cutoffCyclesPerSample * x);
}

function resampleChannel(
    data: ArrayLike<number>,
    resolved: ResolvedResamplingSpec,
): Float64Array {
    const n = data.length;
    const { ratio, edgeMode } = resolved;
    const radius = resolved.kernelRadiusSamples;
    // Output positions m satisfy m / targetRate < n / sourceRate, i.e.
    // m < n * ratio. Round down via a small guard against float dust so exact
    // ratios (e.g. 360 -> 180) yield exact integer counts.
    const outCount = Math.max(0, Math.ceil(n * ratio - 1e-9));
    const out = new Float64Array(outCount);

    for (let m = 0; m < outCount; m += 1) {
        const tau = m / ratio; // input-sample coordinate of output m
        const centre = Math.floor(tau);
        let acc = 0;
        let weightSum = 0;
        for (let k = centre - radius; k <= centre + radius; k += 1) {
            const weight = kernelValue(
                tau - k,
                resolved.cutoffCyclesPerSample,
                radius,
            );
            if (weight === 0) {
                continue;
            }
            let source: number;
            if (edgeMode === 'zero') {
                source = k >= 0 && k < n ? data[k]! : 0;
            } else {
                source = reflectSample(data, k);
            }
            acc += source * weight;
            weightSum += weight;
        }
        // Normalise by the kernel weight sum so DC is preserved exactly and
        // window droop is cancelled. weightSum is strictly positive because the
        // centre weight is 1 at tau ~ k.
        out[m] = acc / weightSum;
    }
    return out;
}

/**
 * Resample every channel of `signal` to `targetRateHz`, returning a **new**
 * `Signal` with an updated `SamplingInfo` (rate + same start time). The input
 * is not mutated. A provenance `TransformStep` records the target rate, ratio,
 * kernel radius and edge mode.
 */
export function resampleSignal(
    signal: Signal,
    targetRateHz: number,
    spec: ResamplingSpec = {},
): Signal {
    const sampleRateHz = signal.sampling.sampleRateHz;
    const resolved = resolveResamplingSpec(sampleRateHz, targetRateHz, spec);

    const channels: SignalChannel[] = signal.channels.map((channel) => ({
        name: channel.name,
        unit: channel.unit,
        data: resampleChannel(channel.data, resolved),
    }));

    const transformName = `resample-${targetRateHz}hz`;
    return createSignal({
        id: deriveTransformId(signal.id, transformName),
        channels,
        sampling: createSamplingInfo(
            targetRateHz,
            signal.sampling.startTimeSec,
        ),
        provenance: withTransform(signal.provenance, {
            name: transformName,
            parameters: {
                fromHz: sampleRateHz,
                toHz: targetRateHz,
                ratio: resolved.ratio,
                kernelRadiusSamples: resolved.kernelRadiusSamples,
                edgeMode: resolved.edgeMode,
            },
        }),
    });
}
