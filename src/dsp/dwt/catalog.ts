/**
 * Phase-4 wavelet catalog (ADR-003).
 *
 * The catalog is the single, validated way to resolve a wavelet *name* into the
 * filter bank used by the DWT/IDWT. It is seeded from the committed Db4 filter
 * bank (`src/fixtures/db4.ts`), whose coefficients were sourced from the
 * wavelib (BSD-3) reference and cross-verified against the literature to
 * ~1e-12; `src/fixtures/db4.ts` is itself regression-tested against the
 * committed `data/fixtures/reference/db4.json` golden artifact.
 *
 * ADR-003 intends a Daubechies family (db1..dbN) catalog. Only db4 is seeded in
 * Phase 4 because it is the only member whose coefficients carry committed
 * wavelib provenance; additional members require coefficient capture from the
 * wavelib reference plus a committed, provenance-tracked fixture before they
 * may be enabled here (rules: no unexplained / unverified constants).
 *
 * Layering: this module imports the pure coefficient module `src/fixtures/db4`
 * (no Node I/O) so it remains browser-bundle-safe and shared verbatim by main
 * thread and workers. It never imports ml/presentation/framework (ADR-002).
 */

import { EcgError } from '../../domain';
import {
    DB4_DEC_HI,
    DB4_DEC_LO,
    DB4_NAME,
    DB4_ORDER,
    DB4_REC_HI,
    DB4_REC_LO,
    DB4_TAP_COUNT,
} from '../../fixtures/db4';

/** Analysis (decomposition) and synthesis (reconstruction) filter bank. */
export interface WaveletFilters {
    /** Analysis low-pass (scaling) taps, `dec_lo` — length `tapCount`. */
    readonly decLo: readonly number[];
    /** Analysis high-pass (wavelet) taps, `dec_hi` — length `tapCount`. */
    readonly decHi: readonly number[];
    /** Synthesis low-pass taps, `rec_lo` — length `tapCount`. */
    readonly recLo: readonly number[];
    /** Synthesis high-pass taps, `rec_hi` — length `tapCount`. */
    readonly recHi: readonly number[];
}

export interface WaveletDefinition {
    /** Stable catalog name, e.g. `db4`. */
    readonly name: string;
    /** Wavelet family. `db` = Daubechies (compact support, orthogonal). */
    readonly family: 'db';
    /** Vanishing-moment order (4 for db4). */
    readonly order: number;
    /** Number of taps per filter (8 for db4). */
    readonly tapCount: number;
    /** Orthogonal wavelets give an energy-preserving (Parseval) transform. */
    readonly isOrthogonal: true;
    readonly filters: WaveletFilters;
}

/**
 * The wavelets currently in the catalog. Only members with committed,
 * wavelib-provenanced coefficients are listed (see module docstring).
 */
export const SUPPORTED_WAVELET_NAMES: readonly string[] = Object.freeze([DB4_NAME]);

function isSupportedWaveletName(name: string): boolean {
    return (SUPPORTED_WAVELET_NAMES as readonly string[]).includes(name);
}

const db4: WaveletDefinition = {
    name: DB4_NAME,
    family: 'db',
    order: DB4_ORDER,
    tapCount: DB4_TAP_COUNT,
    isOrthogonal: true,
    filters: {
        decLo: DB4_DEC_LO,
        decHi: DB4_DEC_HI,
        recLo: DB4_REC_LO,
        recHi: DB4_REC_HI,
    },
};

/**
 * Resolve a wavelet name to its definition, throwing `invalid-input` for any
 * name that is not in the catalog (never silently falling back).
 */
export function getWavelet(name: string): WaveletDefinition {
    if (!isSupportedWaveletName(name)) {
        throw EcgError.invalidInput(
            `Unsupported wavelet ${JSON.stringify(name)}. The catalog currently ` +
            `contains: ${SUPPORTED_WAVELET_NAMES.join(', ')}. Additional members ` +
            'require committed, wavelib-provenanced coefficients (ADR-003).',
        );
    }
    return db4;
}

/** Stable list of catalog wavelet names, in display order. */
export function listWaveletNames(): readonly string[] {
    return SUPPORTED_WAVELET_NAMES;
}
