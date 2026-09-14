/**
 * Canonical demo defaults + browser composition factory (Phase 7 item #8) and
 * the canonical seam-probe experiment configuration (Phase 8 items 5–6).
 *
 * The bootstrap (`src/main.ts`) must not invent science configuration inline:
 * the record + DWT it hands the app are the same canonical defaults the
 * application tests pin (`src/application/__tests__/analysis.test.ts`) and the
 * jsdom smoke slice (`src/presentation/__tests__/App.test.ts`) reuse. Keeping
 * them here, one layer up from presentation, means:
 *
 * - `src/main.ts` stays a thin composition root — it only builds the service
 *   and mounts the root component;
 * - the presentation layer never hardcodes dataset/DWT details (rules forbid
 *   UI-owned science config; items #9/#10/#11 keep consuming the domain-typed
 *   `AnalysisResult` the service returns);
 * - a future "re-analyze the default record" control (#11) and the smoke test
 *   share the exact same options, so there is one source of truth.
 *
 * The factory is browser-safe: it wraps the file-free, deterministic synthetic
 * dataset adapter (ADR-006), so the app boots with zero network or filesystem
 * I/O.
 *
 * `createProbeSeamExperimentConfiguration` (below) is the single source of
 * truth for the development seam run's *configuration* (dataset, selection,
 * channel, window, committed probe model identity and ground-truth rule). It
 * deliberately holds only browser-safe literals — it cannot import the
 * Node-only `src/ml/testing/probeModel.ts` artifact accessor into the web
 * bundle — so the Node seam tests pin its model/window fields against that
 * committed artifact (see `experimentSeam.integration.test.ts`), keeping the
 * two sites from silently drifting apart.
 */
import { RecordAnalysisService } from './analysis';
import type { RecordAnalysisOptions } from './analysis';
import type { DspExecutor } from './dspExecutor';
import { SYNTHETIC_DATASET_ID, SyntheticDatasetAdapter } from '../datasets/synthetic/adapter';
import type { DwtConfig } from '../dsp/dwt';
import type { ExperimentConfiguration } from './experiment';

/** Canonical default record of the synthetic dataset (360 Hz, 3600 samples). */
export const DEFAULT_SYNTHETIC_RECORD_ID = 'sync';

/** Canonical periodic DWT for the default analysis (`db4`, 4 levels). */
export const DEFAULT_DWT_CONFIG: Readonly<DwtConfig> = Object.freeze({
    waveletName: 'db4',
    level: 4,
    extensionMode: 'periodic',
});

/**
 * Options for the canonical default record analysis the bootstrap runs on
 * mount: the default synthetic record through the default DWT, unfiltered.
 */
export function defaultRecordAnalysisOptions(): RecordAnalysisOptions {
    return {
        recordId: DEFAULT_SYNTHETIC_RECORD_ID,
        dwt: { ...DEFAULT_DWT_CONFIG },
    };
}

/**
 * Build the application service the browser bootstrap (and the jsdom smoke
 * slice) runs against: one `RecordAnalysisService` over the synthetic dataset
 * adapter configured with the canonical default record.
 *
 * The optional `executor` selects where the DSP/DWT stage runs. Omitted (the
 * jsdom smoke slice and any non-worker caller), it stays on the main thread;
 * the browser glue injects a worker-backed executor so the whole-record DSP/DWT
 * leaves the main thread — byte-identically (phase 10, item 4).
 */
export function createDefaultLabService(executor?: DspExecutor): RecordAnalysisService {
    const adapter = new SyntheticDatasetAdapter({
        [DEFAULT_SYNTHETIC_RECORD_ID]: { recordId: DEFAULT_SYNTHETIC_RECORD_ID },
    });
    return new RecordAnalysisService(adapter, executor);
}

/** Analytic sign-of-sum oracle description the seam evaluation records. */
const PROBE_SEAM_LABELER_DESCRIPTION =
    'Analytic binary sign-of-sum oracle: the ground-truth label is "positive-mean" when the sum of ' +
    'the window (ADC\u2192mV samples) is >= 0, else "nonpositive-mean", mirroring the probe graph ' +
    '[+sum, -sum] with its documented zero-sum tie to class index 0. Synthetic development oracle ' +
    'only \u2014 NOT a clinical ground truth; used solely to validate the pipeline, so its agreement ' +
    'with the probe is by construction.';

/**
 * Canonical seam-probe experiment configuration (Phase 8 items 5\u20136; one source
 * of truth). Returns the committed, re-runnable evaluation the Node seam test
 * drives with the real ONNX probe and any future runner wiring reuses:
 *
 * - dataset `synthetic`, explicit selection of the default `sync` record;
 * - channel `lead-b`, contiguous `360/360/drop` windows (equal to the probe
 *   model's 360-sample window at the lab's 360 Hz);
 * - the committed probe identity `ecg-lab-probe-linear-mean-2@1.0.0`;
 * - the analytic sign-of-sum evaluation rule.
 *
 * The returned object is a fresh, unfrozen `ExperimentConfiguration` (the
 * runner deep-freezes its own snapshot). Identity literals here are pinned by
 * the Node seam tests against `src/ml/testing/probeModel.ts` so this
 * browser-safe configuration can never silently name a different artifact.
 */
export function createProbeSeamExperimentConfiguration(): ExperimentConfiguration {
    return {
        datasetId: SYNTHETIC_DATASET_ID,
        selection: {
            kind: 'records',
            recordIds: [DEFAULT_SYNTHETIC_RECORD_ID],
        },
        channelName: 'lead-b',
        window: {
            windowLengthSamples: 360,
            strideSamples: 360,
            remainderPolicy: 'drop',
        },
        model: {
            modelId: 'ecg-lab-probe-linear-mean-2',
            modelVersion: '1.0.0',
        },
        evaluation: {
            id: 'probe-sign-of-sum',
            description: PROBE_SEAM_LABELER_DESCRIPTION,
        },
    };
}
