// ECG Lab application entry point (browser bootstrap).
//
// Phase 7 item #8: this file is the composition root. It wires the pieces the
// presentation layer must never construct itself — build the application
// service over the canonical synthetic defaults, find the #app mount target in
// index.html, then mount the Svelte root view. The root component receives the
// service and the initial analysis options as props and, on mount, loads the
// default fixture record through the application service and renders the
// domain-typed `AnalysisResult` as Svelte views.
//
// Dependency direction is preserved: main.ts (composition) -> application
// service -> domain / dsp / datasets. Everything below the application layer
// stays framework-free; this file is the only place that knows about DOM mount
// targets and the concrete default dataset.
import { mount } from 'svelte';

import { defaultRecordAnalysisOptions } from './application/defaults';
import { ModelOutputService } from './application/inference';
import { PROBE_MODEL_METADATA } from './ml/onnx/probeAsset';
import App from './presentation/App.svelte';
import { createBrowserDatasetService } from './presentation/dataset/browserDatasetService';
import {
    ingestDirectoryHandle,
    ingestFiles,
    isDirectoryPickerSupported,
    pickDirectory,
} from './presentation/dataset/fileIngestion';
import type { IngestedDataset } from './presentation/dataset/fileIngestion';
import {
    createWorkerBackedLabService,
    createWorkerInferenceEngine,
} from './presentation/workers/browserWorkers';

/** Locate the #app mount target; fail loudly if index.html stops providing it. */
function appTarget(): HTMLElement {
    const target = document.getElementById('app');
    if (target === null) {
        throw new Error('ECG Lab: missing #app mount target in index.html.');
    }
    return target;
}

/**
 * Prepare a local dataset (the shape `App` expects) from an already-ingested
 * source: a `RecordAnalysisService` over the adapter the ingestion glue detected
 * for the selection (MIT-BIH/WFDB or EDF/EDF+, ADR-020), with the whole-record
 * DSP/DWT stage offloaded to a dedicated worker (ADR-005/011). The returned
 * `dispose` releases that worker when the dataset is replaced.
 */
function prepareFrom(ingested: IngestedDataset) {
    const dataset = createBrowserDatasetService(ingested.source, ingested.format);
    return {
        service: dataset.service,
        recordIds: ingested.recordIds,
        dispose: () => dataset.terminate(),
    };
}

/** Ingestion factory for a multi-file `FileList`/drop selection (Phase 11). */
async function prepareLocalFiles(files: readonly File[]) {
    return prepareFrom(await ingestFiles(files));
}

/** Ingestion factory for the File System Access directory picker. */
async function openLocalFolder() {
    const handle = await pickDirectory();
    if (handle === undefined) {
        return undefined; // unsupported browser or the user cancelled
    }
    return prepareFrom(await ingestDirectoryHandle(handle));
}

/** Compose and boot the application once. */
function boot(): void {
    // Phase 10: the whole-record DSP/DWT stage and the full-record inference
    // stage each run in a dedicated worker; both are released together when the
    // page is hidden (ADR-005 resource release). Phase 11: the app additionally
    // receives a local-ingestion factory and (where the browser supports it) a
    // directory picker, so a user can open local WFDB files; `App` releases each
    // replaced dataset's own DSP worker through the returned `dispose`.
    const lab = createWorkerBackedLabService();
    const inference = createWorkerInferenceEngine();
    // Phase 18 Part B item 7: the display-only model-output panel scores the
    // *currently analysed* window through the application service, using the
    // engine that already lives in the inference worker (the probe model is
    // registered there) and the browser-safe, frozen copy of the probe's own
    // metadata. Nothing is inferred here: the panel is handed a service and the
    // model's declared contract, and reports whatever the contract refuses.
    const modelOutput = new ModelOutputService(
        inference.engine,
        PROBE_MODEL_METADATA,
    );
    window.addEventListener('pagehide', () => {
        inference.terminate();
        lab.terminate();
    });
    mount(App, {
        target: appTarget(),
        props: {
            service: lab.service,
            initialOptions: defaultRecordAnalysisOptions(),
            prepareLocalDataset: prepareLocalFiles,
            pickLocalDirectory: isDirectoryPickerSupported()
                ? openLocalFolder
                : undefined,
            modelOutput,
        },
    });
}

boot();
