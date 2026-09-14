/**
 * Deterministic synthetic signal generators for golden fixtures.
 *
 * Each generator is a pure function of its {@link SignalRecipe}: the same
 * recipe always yields the same samples (no `Math.random()`, no hidden state,
 * no wall-clock dependence). Fixtures live in millivolts, mirroring the
 * downstream convention that the ADC→mV conversion is the only place real
 * records become physical units.
 */

import { EcgError } from '../domain/error';
import { createGaussianRng } from './rng';

/** Canonical sample rate used by fixtures (mirrors MIT-BIH, 360 Hz). */
export const FIXTURE_SAMPLE_RATE_HZ = 360;

export type SignalKind =
    | 'impulse'
    | 'constant'
    | 'sine'
    | 'multi-frequency'
    | 'chirp'
    | 'noise'
    | 'synthetic-ecg';

/**
 * A complete, self-describing recipe for one synthetic signal. Each kind
 * validates the fields it needs; the full recipe is recorded next to the
 * generated samples so every fixture is reproducible from the recipe alone.
 */
export interface SignalRecipe {
    readonly kind: SignalKind;
    /** Samples per second (> 0). */
    readonly sampleRateHz: number;
    /** Number of samples to generate (positive integer). */
    readonly length: number;
    /** Seed for stochastic kinds ('noise'); ignored by deterministic kinds. */
    readonly seed?: number;
    /** Impulse amplitude (mV). */
    readonly amplitude?: number;
    /** Impulse location as a 0-based sample index. */
    readonly atIndex?: number;
    /** DC offset / constant level (mV). */
    readonly offset?: number;
    /** Sine frequency (Hz). */
    readonly frequencyHz?: number;
    /** Sine phase at t = 0 (radians). */
    readonly phaseRad?: number;
    /** Multi-frequency component amplitudes (mV). */
    readonly amplitudes?: readonly number[];
    /** Multi-frequency component frequencies (Hz). */
    readonly frequenciesHz?: readonly number[];
    /** Chirp instantaneous-frequency sweep endpoints (Hz). */
    readonly f0Hz?: number;
    readonly f1Hz?: number;
    /** Gaussian noise standard deviation (mV). */
    readonly std?: number;
    /** Synthetic-ECG heart rate (beats per minute). */
    readonly heartRateBpm?: number;
}

function invalid(recipe: SignalRecipe, detail: string): never {
    throw EcgError.invalidInput(`Invalid ${recipe.kind} fixture recipe: ${detail}`, {
        detail,
        meta: { kind: recipe.kind },
    });
}

function assertFs(recipe: SignalRecipe): number {
    const { sampleRateHz } = recipe;
    if (typeof sampleRateHz !== 'number' || !Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
        return invalid(
            recipe,
            `sampleRateHz must be finite and > 0, got ${String(sampleRateHz)}.`,
        );
    }
    return sampleRateHz;
}

function assertLength(recipe: SignalRecipe): number {
    const { length } = recipe;
    if (typeof length !== 'number' || !Number.isSafeInteger(length) || length <= 0) {
        return invalid(recipe, `length must be a positive integer, got ${String(length)}.`);
    }
    return length;
}

function requiredFinite(recipe: SignalRecipe, value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return invalid(recipe, `${label} must be a finite number, got ${String(value)}.`);
    }
    return value;
}

function requiredInteger(recipe: SignalRecipe, value: unknown, label: string): number {
    const number = requiredFinite(recipe, value, label);
    if (!Number.isSafeInteger(number)) {
        return invalid(recipe, `${label} must be an integer, got ${String(number)}.`);
    }
    return number;
}

function generateImpulse(recipe: SignalRecipe): Float64Array {
    const length = assertLength(recipe);
    const amplitude = requiredFinite(recipe, recipe.amplitude, 'amplitude');
    const atIndex = requiredInteger(recipe, recipe.atIndex, 'atIndex');
    if (atIndex < 0 || atIndex >= length) {
        return invalid(recipe, `atIndex ${atIndex} is outside [0, ${length}).`);
    }
    const out = new Float64Array(length);
    out[atIndex] = amplitude;
    return out;
}

function generateConstant(recipe: SignalRecipe): Float64Array {
    const length = assertLength(recipe);
    const offset = requiredFinite(recipe, recipe.offset, 'offset');
    const out = new Float64Array(length);
    out.fill(offset);
    return out;
}

function generateSine(recipe: SignalRecipe): Float64Array {
    const length = assertLength(recipe);
    assertFs(recipe);
    const amplitude = requiredFinite(recipe, recipe.amplitude, 'amplitude');
    const frequencyHz = requiredFinite(recipe, recipe.frequencyHz, 'frequencyHz');
    const offset = recipe.offset === undefined ? 0 : requiredFinite(recipe, recipe.offset, 'offset');
    const phaseRad = recipe.phaseRad === undefined ? 0 : requiredFinite(recipe, recipe.phaseRad, 'phaseRad');
    const omega = 2 * Math.PI * frequencyHz;
    const out = new Float64Array(length);
    for (let i = 0; i < length; i += 1) {
        const t = i / recipe.sampleRateHz;
        out[i] = offset + amplitude * Math.sin(omega * t + phaseRad);
    }
    return out;
}

function generateMultiFrequency(recipe: SignalRecipe): Float64Array {
    const length = assertLength(recipe);
    assertFs(recipe);
    const amplitudes = recipe.amplitudes;
    const frequenciesHz = recipe.frequenciesHz;
    if (!amplitudes || amplitudes.length === 0 || !frequenciesHz) {
        return invalid(recipe, 'multi-frequency requires amplitudes[] and frequenciesHz[].');
    }
    if (amplitudes.length !== frequenciesHz.length) {
        return invalid(recipe, 'amplitudes and frequenciesHz must have equal length.');
    }
    const offset = recipe.offset === undefined ? 0 : requiredFinite(recipe, recipe.offset, 'offset');
    const out = new Float64Array(length);
    for (let i = 0; i < length; i += 1) {
        const t = i / recipe.sampleRateHz;
        let value = offset;
        for (let c = 0; c < amplitudes.length; c += 1) {
            const a = requiredFinite(recipe, amplitudes[c], `amplitudes[${c}]`);
            const f = requiredFinite(recipe, frequenciesHz[c], `frequenciesHz[${c}]`);
            value += a * Math.sin(2 * Math.PI * f * t);
        }
        out[i] = value;
    }
    return out;
}

function generateChirp(recipe: SignalRecipe): Float64Array {
    const length = assertLength(recipe);
    assertFs(recipe);
    const amplitude = requiredFinite(recipe, recipe.amplitude, 'amplitude');
    const f0Hz = requiredFinite(recipe, recipe.f0Hz, 'f0Hz');
    const f1Hz = requiredFinite(recipe, recipe.f1Hz, 'f1Hz');
    const offset = recipe.offset === undefined ? 0 : requiredFinite(recipe, recipe.offset, 'offset');
    const duration = (length - 1) / recipe.sampleRateHz;
    const sweep = (f1Hz - f0Hz) / duration;
    const out = new Float64Array(length);
    for (let i = 0; i < length; i += 1) {
        const t = i / recipe.sampleRateHz;
        const phase = 2 * Math.PI * (f0Hz * t + 0.5 * sweep * t * t);
        out[i] = offset + amplitude * Math.sin(phase);
    }
    return out;
}

function generateNoise(recipe: SignalRecipe): Float64Array {
    const length = assertLength(recipe);
    const std = requiredFinite(recipe, recipe.std, 'std');
    if (std < 0) {
        return invalid(recipe, 'std must be >= 0.');
    }
    const offset = recipe.offset === undefined ? 0 : requiredFinite(recipe, recipe.offset, 'offset');
    const seed = requiredInteger(recipe, recipe.seed, 'seed');
    const gaussian = createGaussianRng(seed);
    const out = new Float64Array(length);
    for (let i = 0; i < length; i += 1) {
        out[i] = offset + gaussian.next() * std;
    }
    return out;
}

/**
 * A compact synthetic-ECG-like beat made of five gaussian components
 * (P, Q, R, S, T) placed at fixed offsets from each R peak. It is deliberately
 * a *morphology placeholder* (valid for pipeline/regression testing), not a
 * physiologically validated ECG generator.
 */
const ECG_COMPONENTS = [
    { relSec: -0.26, sigmaSec: 0.026, ampFrac: 0.12 }, // P wave
    { relSec: -0.055, sigmaSec: 0.01, ampFrac: -0.12 }, // Q wave
    { relSec: 0, sigmaSec: 0.013, ampFrac: 1.0 }, // R peak
    { relSec: 0.045, sigmaSec: 0.01, ampFrac: -0.3 }, // S wave
    { relSec: 0.24, sigmaSec: 0.055, ampFrac: 0.35 }, // T wave
] as const;

function generateSyntheticEcg(recipe: SignalRecipe): Float64Array {
    const length = assertLength(recipe);
    const fs = assertFs(recipe);
    const heartRateBpm = requiredFinite(recipe, recipe.heartRateBpm, 'heartRateBpm');
    if (heartRateBpm <= 0) {
        return invalid(recipe, 'heartRateBpm must be > 0.');
    }
    const rAmplitude =
        recipe.amplitude === undefined
            ? 1.0
            : requiredFinite(recipe, recipe.amplitude, 'amplitude');
    const rrSamples = Math.max(1, Math.round((fs * 60) / heartRateBpm));
    const out = new Float64Array(length);

    const gaussianSpreadSigma = 5;
    for (let beat = 0; ; beat += 1) {
        const center = beat * rrSamples;
        if (center >= length) {
            break;
        }
        for (const component of ECG_COMPONENTS) {
            const centerSample = center + component.relSec * fs;
            const sigmaSamples = component.sigmaSec * fs;
            const first = Math.max(
                0,
                Math.ceil(centerSample - gaussianSpreadSigma * sigmaSamples),
            );
            const lastExclusive = Math.min(
                length,
                Math.floor(centerSample + gaussianSpreadSigma * sigmaSamples) + 1,
            );
            for (let i = first; i < lastExclusive; i += 1) {
                const distance = (i - centerSample) / sigmaSamples;
                const prior = out[i] ?? 0;
                out[i] =
                    prior + rAmplitude * component.ampFrac * Math.exp(-0.5 * distance * distance);
            }
        }
    }
    return out;
}

/**
 * Generate the samples (Float64Array, millivolts) described by `recipe`.
 * Deterministic: identical recipes yield bit-identical arrays.
 */
export function generateSignal(recipe: SignalRecipe): Float64Array {
    switch (recipe.kind) {
        case 'impulse':
            return generateImpulse(recipe);
        case 'constant':
            return generateConstant(recipe);
        case 'sine':
            return generateSine(recipe);
        case 'multi-frequency':
            return generateMultiFrequency(recipe);
        case 'chirp':
            return generateChirp(recipe);
        case 'noise':
            return generateNoise(recipe);
        case 'synthetic-ecg':
            return generateSyntheticEcg(recipe);
    }
}
