/**
 * Seam end-to-end demonstration (Phase 8 item 5 / ADR-007, ADR-009; rules §24,
 * §30, §47, §49).
 *
 * SEAM-VALIDATION SCOPE — NOT CLINICAL.
 *
 * This Node test drives the *real* committed ONNX probe artifact
 * (`data/fixtures/models/ecg-lab-probe-linear-mean-2.onnx` + matching
 * metadata) through the full `runExperiment` evaluation pipeline over the
 * synthetic, deterministic `sync` record (channel `lead-b`, windows
 * `360/360/drop`). It mirrors the Phase 6/7 real-session integration pattern:
 * load probe metadata/bytes → `createOnnxWebEngine` → inject as the
 * `InferenceEngine` → run the configured evaluation → inspect the frozen
 * `ExperimentResult`.
 *
 * What the run proves: the *evaluation pipeline* (record read → ADC→mV with
 * provenance → windowing → `buildModelInput` → real ONNX session →
 * `interpretPrediction` → labeler ground truth → computed metrics → canonical
 * export) works end-to-end over a real committed model.
 *
 * What it does NOT prove: predictive performance. The only committed model is
 * a development seam-validation probe whose graph emits `logits = [+Σ, −Σ]`,
 * so `softmax argmax` is the sign of the window mean (metadata methodology;
 * zero sum ties to class index 0, `positive-mean`). The ground-truth labeler
 * is the *same analytic sign-of-sum rule*, so agreement is near-perfect **by
 * construction** (rules §47/§49 are honoured by this wording, never omitted).
 * `lead-b` is a 1.2 Hz tone: each 1 s window spans 1.2 cycles, so per-window
 * means are robustly non-zero with a deterministic sign pattern across the 10
 * windows — unlike `lead-a` (1.0 Hz, whole periods) which sits on the ~zero
 * tie boundary. Channel choice and oracle identity are documented in the
 * exported `scopeNote`, which is mandatory and non-empty.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModelMetadata } from '../../domain/ml';
import { SyntheticDatasetAdapter } from '../../datasets/synthetic/adapter';
import type { InferenceEngine } from '../../ml/engine';
import { assertValidModelMetadata } from '../../ml/metadata';
import { createOnnxWebEngine } from '../../ml/onnx/ortWebEngine';
import {
    loadProbeModelBytes,
    loadProbeModelMetadata,
    PROBE_MODEL_CLASS_LABELS,
    PROBE_MODEL_ID,
    PROBE_MODEL_VERSION,
    PROBE_MODEL_WINDOW_SAMPLES,
} from '../../ml/testing/probeModel';
import {
    createProbeSeamExperimentConfiguration,
    DEFAULT_SYNTHETIC_RECORD_ID,
} from '../defaults';
import { experimentIdOf } from '../experiment';
import {
    parseExperimentResult,
    serializeExperimentResult,
    type ExperimentResult,
} from '../experimentResult';
import type { ClassRates, ClassificationMetrics } from '../metrics';
import { runExperiment, type GroundTruthLabeler } from '../runExperiment';

// ---------------------------------------------------------------------------
// Fixtures — one committed, re-runnable seam evaluation over synthetic 'sync'.
// ---------------------------------------------------------------------------

const SOFTWARE_VERSION = '0.0.0-seam-validation-test';

/** Mandatory scope note (rules §47/§49): what the seam run is and is not. */
const SCOPE_NOTE =
    'Seam-validation demonstration only. The real ONNX probe ' +
    `(${PROBE_MODEL_ID} v${PROBE_MODEL_VERSION}) sign-of-mean oracle is evaluated against the ` +
    'analytic sign-of-sum oracle over the synthetic "sync" record (channel lead-b, ' +
    '360/360/drop windows); agreement is near-perfect by construction, so this run validates the ' +
    'evaluation pipeline (input packing, real-session inference, interpretation, metrics, export, ' +
    'determinism) — NOT model predictive performance. The probe is a development seam-validation ' +
    'artifact with no physiological or clinical meaning (see its metadata limitations); no medical ' +
    'or scientific conclusion may be drawn from this result.';

/** The single synthetic record the seam run evaluates (3600 samples/channel). */
const ADAPTER = new SyntheticDatasetAdapter({
    [DEFAULT_SYNTHETIC_RECORD_ID]: { recordId: DEFAULT_SYNTHETIC_RECORD_ID },
});

/**
 * The canonical seam configuration is built by the shared factory in
 * `defaults.ts` (one source of truth), never duplicated here. Test 1 pins the
 * factory's model/window identity fields against the committed probe.
 */
function seamConfig() {
    return createProbeSeamExperimentConfiguration();
}

/**
 * The ground-truth labeler is the analytic sign-of-sum oracle computed over
 * the exact mV window the engine also sees. Boundary: sum >= 0 → positive-mean
 * (matching the documented tie-break to class index 0).
 */
const signOfSumLabeler: GroundTruthLabeler = (window) => {
    let sum = 0;
    const data = window.data;
    for (let i = 0; i < data.length; i += 1) {
        sum += data[i]!;
    }
    return sum >= 0 ? 'positive-mean' : 'nonpositive-mean';
};

async function runSeam(engine: InferenceEngine): Promise<ExperimentResult> {
    return runExperiment(ADAPTER, engine, metadata, seamConfig(), signOfSumLabeler, {
        softwareVersion: SOFTWARE_VERSION,
        scopeNote: SCOPE_NOTE,
    });
}

function rateFor(metrics: ClassificationMetrics, label: string): ClassRates {
    const found = metrics.perClass.find((entry) => entry.label === label);
    if (found === undefined) {
        throw new Error(`No per-class rates for "${label}".`);
    }
    return found;
}

let metadata: ModelMetadata;
let engine: InferenceEngine;

describe('seam end-to-end (real ONNX probe over synthetic sync lead-b)', () => {
    beforeAll(async () => {
        metadata = loadProbeModelMetadata();
        assertValidModelMetadata(metadata);
        engine = await createOnnxWebEngine({
            metadata,
            modelBytes: loadProbeModelBytes(),
        });
    });

    afterAll(async () => {
        await engine?.dispose();
    });

    it('evaluates 10 lead-b windows with the real session; predictions match the analytic sign oracle', async () => {
        const config = createProbeSeamExperimentConfiguration();
        const result = await runSeam(engine);

        // The canonical factory carries the committed probe's identity fields
        // (single source of truth — pinned against the probeModel constants).
        expect(config.model).toEqual({
            modelId: PROBE_MODEL_ID,
            modelVersion: PROBE_MODEL_VERSION,
        });
        expect(config.window).toEqual({
            windowLengthSamples: PROBE_MODEL_WINDOW_SAMPLES,
            strideSamples: PROBE_MODEL_WINDOW_SAMPLES,
            remainderPolicy: 'drop',
        });

        // Identity + declared inputs carried through the frozen boundary.
        expect(result.experimentId).toBe(experimentIdOf(config));
        expect(result.config).toEqual(config);
        expect(result.labeler).toEqual(config.evaluation);
        expect(result.softwareVersion).toBe(SOFTWARE_VERSION);
        expect(result.scopeNote).toBe(SCOPE_NOTE);
        expect(result.evaluatedAtIso).toMatch(
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
        );

        // One record, fully windowed: 3600 samples / 360 stride = 10 windows.
        expect(result.records).toHaveLength(1);
        const sync = result.records[0]!;
        expect(sync.recordId).toBe(DEFAULT_SYNTHETIC_RECORD_ID);
        expect(sync.subjectId).toBe(DEFAULT_SYNTHETIC_RECORD_ID);
        expect(sync.channelName).toBe('lead-b');
        expect(sync.channelIndex).toBe(1);
        expect(sync.provenance.source).toBe('synthetic/sync');
        expect(sync.provenance.transforms.map((step) => step.name)).toEqual([
            'adc-to-millivolt',
        ]);

        const windows = sync.windows;
        expect(windows).toHaveLength(10);
        expect(windows.map((window) => window.startSample)).toEqual([
            0, 360, 720, 1080, 1440, 1800, 2160, 2520, 2880, 3240,
        ]);

        // Independently derived analytic oracle pattern (computed from the lead-b
        // waveform: 1.2 Hz over 1 s windows → deterministic, robustly non-zero
        // per-window means). Windows 0,1,2,5,6,7 have positive means; 3,4,8,9
        // negative. This pins the actual data the engine saw, not just label
        // plumbing.
        const positiveMeanIndexes = new Set([0, 1, 2, 5, 6, 7]);
        const expectedOracle = (index: number): string =>
            positiveMeanIndexes.has(index) ? 'positive-mean' : 'nonpositive-mean';

        windows.forEach((window, index) => {
            expect(window.lengthSamples).toBe(PROBE_MODEL_WINDOW_SAMPLES);
            expect(window.channelIndex).toBe(1);
            expect(window.channelName).toBe('lead-b');
            expect(window.windowId).toBe(
                `${DEFAULT_SYNTHETIC_RECORD_ID}/ch/${window.channelIndex}/w${window.startSample}`,
            );
            // The recorded ground truth is the analytic oracle output, and the
            // real ONNX session's argmax agrees with it on every window.
            expect(window.trueLabel).toBe(expectedOracle(index));
            expect(window.predictedLabel).toBe(expectedOracle(index));
            expect(window.trueLabel).toBe(window.predictedLabel);
            expect(window.semantics).toBe('predicted-probability');
            expect(window.predictedScore).toBeGreaterThanOrEqual(0.5);
            expect(window.predictedScore).toBeLessThanOrEqual(1);
        });

        // Metrics are computed from the recorded windows (never fabricated):
        // 6 positive-mean + 4 nonpositive-mean windows, all correct → accuracy 1,
        // a diagonal confusion matrix and defined (non-null) per-class rates.
        expect(result.metrics.total).toBe(10);
        expect(result.metrics.accuracy).toBe(1);
        expect(result.metrics.classLabels).toEqual([...PROBE_MODEL_CLASS_LABELS]);
        expect(result.metrics.confusion.cells).toEqual([
            [6, 0],
            [0, 4],
        ]);

        const positive = rateFor(result.metrics, 'positive-mean');
        expect(positive.support).toBe(6);
        expect(positive.precision).toBe(1);
        expect(positive.recall).toBe(1);
        expect(positive.specificity).toBe(1);
        expect(positive.f1).toBe(1);

        const nonpositive = rateFor(result.metrics, 'nonpositive-mean');
        expect(nonpositive.support).toBe(4);
        expect(nonpositive.precision).toBe(1);
        expect(nonpositive.recall).toBe(1);
        expect(nonpositive.specificity).toBe(1);
        expect(nonpositive.f1).toBe(1);

        // No rate is fabricated as null while its class is present.
        for (const entry of result.metrics.perClass) {
            expect(entry.precision).not.toBeNull();
            expect(entry.recall).not.toBeNull();
            expect(entry.specificity).not.toBeNull();
            expect(entry.f1).not.toBeNull();
        }
    });

    it('is deterministic across two runs: identical ids, windows, scores and metrics', async () => {
        const first = await runSeam(engine);
        const second = await runSeam(engine);

        expect(first.experimentId).toBe(second.experimentId);
        expect(first.records).toEqual(second.records);
        expect(first.metrics).toEqual(second.metrics);

        // Exact (not tolerance) agreement of every predicted score across runs.
        const firstScores = first.records
            .flatMap((record) => record.windows)
            .map((window) => window.predictedScore);
        const secondScores = second.records
            .flatMap((record) => record.windows)
            .map((window) => window.predictedScore);
        expect(secondScores).toEqual(firstScores);
    });

    it('export round-trips through canonical serialization and strict parsing', async () => {
        const result = await runSeam(engine);

        const text = serializeExperimentResult(result);
        const parsed = parseExperimentResult(text);

        // Canonical key-ordered serialization is stable across the round trip…
        expect(serializeExperimentResult(parsed)).toBe(text);
        // …and the parsed document is structurally identical to the frozen result.
        expect(parsed).toEqual(result);

        // Strict parsing refuses malformed documents with a classified error.
        expect(() => parseExperimentResult('{ "experimentId": ')).toThrow(
            'Invalid experiment result document',
        );
    });
});
