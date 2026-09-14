/**
 * Browser dataset service factory (Phase 11 / ADR-012, architecture §J).
 *
 * Given any {@link DatasetFileSource} the ingestion glue produced from a local
 * selection, this builds the *same* `RecordAnalysisService` the app already
 * uses for the synthetic boot record — the only differences are the dataset
 * adapter (MIT-BIH/WFDB or EDF/EDF+, chosen by the caller's detected
 * `DatasetFormat` through the pure dispatch of ADR-020) and that the
 * whole-record DSP/DWT stage runs in the browser worker, exactly as
 * [`browserWorkers.ts`](../workers/browserWorkers.ts:103) composes the default
 * service.
 *
 * It mirrors [`browserWorkers.ts`](../workers/browserWorkers.ts:1) deliberately:
 * the service/worker wiring lives in one place per dataset, the DSP/DWT stage is
 * offloaded byte-identically (ADR-011 parity), and the returned handle owns the
 * worker's release. Nothing here re-implements parsing or science — the adapter
 * and parsers are consumed unchanged (rules §30), and the application layer
 * still owns the workflow.
 *
 * Browser-only by construction: no `node:*` import; covered by typecheck, lint
 * and the production build rather than by vitest.
 */

import { RecordAnalysisService } from '../../application/analysis';
import { WorkerDspExecutor } from '../../application/dspExecutor';
import type { RecordId } from '../../domain/record';
import {
    createDatasetAdapter,
    prepareDatasetSource,
    type DatasetFileSource,
    type DatasetFormat,
} from '../../datasets';
import { createDspWorker } from '../workers/browserWorkers';

/** A live MIT-BIH-backed analysis service plus a release hook for its worker. */
export interface BrowserDatasetService {
    readonly service: RecordAnalysisService;
    /** Dispose the service's DSP worker and release its resources (idempotent). */
    terminate(): void;
}

/**
 * Compose a `RecordAnalysisService` over a picked source of the given format,
 * with the whole-record DSP/DWT stage offloaded to a dedicated worker
 * (ADR-005/ADR-011). The format is a required argument, never a default: the
 * adapter for a selection is chosen once, by name, at the point the selection is
 * made (ADR-020), so no caller can silently analyse EDF bytes as WFDB.
 * Callers must `terminate()` the returned handle when they replace the dataset.
 */
export function createBrowserDatasetService(
    source: DatasetFileSource,
    format: DatasetFormat,
): BrowserDatasetService {
    const dsp = createDspWorker();
    const adapter = createDatasetAdapter(source, format);
    return {
        service: new RecordAnalysisService(adapter, new WorkerDspExecutor(dsp.dsp)),
        terminate: () => dsp.terminate(),
    };
}

/** A prepared local dataset: its service, discovered ids and worker release. */
export interface PreparedBrowserDataset {
    readonly service: RecordAnalysisService;
    /** Record ids discovered for the detected format, sorted. */
    readonly recordIds: readonly RecordId[];
    /** Dispose the service's DSP worker and release its resources (idempotent). */
    terminate(): void;
}

/**
 * Detect a source's format, discover the record ids it holds and build the
 * worker-backed service over it in one step — the shape the ingestion UI needs:
 * a service to analyze through plus the ids to offer.
 */
export async function prepareBrowserDataset(
    source: DatasetFileSource,
): Promise<PreparedBrowserDataset> {
    const { format, recordIds } = await prepareDatasetSource(source);
    const dataset = createBrowserDatasetService(source, format);
    return {
        service: dataset.service,
        recordIds,
        terminate: () => dataset.terminate(),
    };
}
