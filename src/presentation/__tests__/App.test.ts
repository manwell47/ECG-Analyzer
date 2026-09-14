// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from '../App.svelte';
import { RecordAnalysisService } from '../../application/analysis';
import {
    createDefaultLabService,
    defaultRecordAnalysisOptions,
} from '../../application/defaults';
import { MitBihDatasetAdapter } from '../../datasets/mitbih/adapter';
import { encodeFormat212 } from '../../datasets/mitbih/format212';
import { ingestFiles } from '../dataset/fileIngestion';

/**
 * Root-view bootstrap + interaction slice (Phase 7 items #8–#11).
 *
 * Runs under jsdom via the `// @vitest-environment jsdom` file directive (the
 * global default is Node; there is no `environmentMatchGlobs` anymore — it is
 * deprecated in Vitest 3). It renders the real root component the browser
 * bootstrap mounts (`src/main.ts`), backed by the *same* composition the
 * bootstrap uses (`createDefaultLabService` over the canonical synthetic
 * defaults). On mount the component analyzes the default fixture record
 * through the application service and renders the domain-typed result:
 *
 * - a Svelte app mounts and drives the loading/ready states;
 * - the default fixture record loads end to end through `RecordAnalysisService`
 *   (synthetic adapter -> ADC->mV -> periodic DWT -> `AnalysisResult`), exposing
 *   the record identity and the stable analysis id (item #8);
 * - thin interaction controls (item #11) pick the *selected* channel and time
 *   window that the single canvas time-series view (item #9) and the single
 *   canvas DWT coefficient view (item #10) draw;
 * - "Re-run analysis" re-invokes the application service with the same options,
 *   which is the literal item-#11 service wiring;
 * - the Phase 11 local-ingestion control opens real WFDB `File`s, discovers their
 *   record ids and analyzes the picked record through the same application
 *   service (the synthetic boot record and every existing assertion unchanged);
 * - the Phase 12 annotation overlay: a picked record's own annotation events
 *   reach the time-series view through the service result and are summarised in
 *   its caption (display only — the analysis never fuses them into the signal);
 *   when the selection holds more than one discovered record, the Record
 *   combobox re-analyzes another one through the same service and resets the
 *   display selection (first channel / full window).
 *
 * This is a UI interaction slice only — it never re-asserts numeric correctness
 * (that is the application/DSP gate). `cleanup` runs here in this explicit
 * `afterEach`, mirroring the stack slice; the testing-library global
 * `autoCleanup` stays disabled repo-wide.
 */
describe('App root bootstrap + interaction controls (jsdom slice)', () => {
    beforeEach(() => {
        // jsdom ships no canvas implementation; stubbing getContext to return
        // null runs the guarded, markup-only render path of the embedded views
        // without "Not implemented" virtual-console noise.
        HTMLCanvasElement.prototype.getContext = () => null;
    });

    afterEach(() => {
        cleanup();
    });

    /** The prepared-dataset shape `App` expects from its ingestion factory. */
    interface PreparedLocalDataset {
        service: RecordAnalysisService;
        recordIds: readonly string[];
        dispose: () => void;
    }

    /**
     * The real browser ingestion path minus the worker: `ingestFiles` builds the
     * `WebFileSource` over the picked `File`s and discovers record ids from the
     * `.hea` headers, then a main-thread `RecordAnalysisService` runs the
     * canonical DWT. (jsdom has no `Worker`, so the worker-backed factory the
     * composition root injects cannot itself be exercised here.)
     */
    async function prepareLocalFiles(
        files: readonly File[],
    ): Promise<PreparedLocalDataset> {
        const { source, recordIds } = await ingestFiles(files);
        const service = new RecordAnalysisService(
            new MitBihDatasetAdapter(source),
        );
        return { service, recordIds, dispose: () => undefined };
    }

    function mountApp(
        service: RecordAnalysisService = createDefaultLabService(),
        prepareLocalDataset?:
            | ((files: readonly File[]) => Promise<PreparedLocalDataset>)
            | undefined,
    ): void {
        render(App, {
            props: {
                service,
                initialOptions: defaultRecordAnalysisOptions(),
                prepareLocalDataset,
            },
        });
    }

    /** The single rendered DWT coefficient figure (there is exactly one). */
    function dwtFigure(): HTMLElement | null {
        return screen.getByText('DWT coefficients').closest('figure');
    }

    it('loads the default fixture record through the service and renders its identity', async () => {
        mountApp();

        // Ready only once the async analysis resolves; findByText polls.
        expect(await screen.findByText('synthetic / sync')).toBeTruthy();
        // The exact stable analysis id proves the canonical DWT options ran.
        expect(screen.getByText('synthetic/sync :: dwt-db4-level4-periodic')).toBeTruthy();
        // The canvas time-series view labels the sample rate from the
        // domain-typed signal.
        expect(screen.getByText('Sample rate: 360 Hz')).toBeTruthy();
        expect(screen.getByText('db4')).toBeTruthy();
        expect(screen.getByText('periodic')).toBeTruthy();
        expect(screen.getByText('4')).toBeTruthy();
    });

    it('renders the controls and the default first channel through both canvas views', async () => {
        mountApp();

        await screen.findByText('synthetic/sync :: dwt-db4-level4-periodic');

        // Item #11: the interaction controls are present once a result exists.
        expect(screen.getByRole('combobox', { name: 'Channel' })).toBeTruthy();
        expect(screen.getByRole('combobox', { name: 'Viewport' })).toBeTruthy();
        expect(
            screen.getByRole('button', { name: 'Re-run analysis' }),
        ).toBeTruthy();

        // The time-series view draws the selected (default, first) channel as a
        // labelled canvas with its unit/rate/count (item #9).
        expect(
            screen.getByRole('img', {
                name: 'lead-a time series, unit mV',
            }),
        ).toBeTruthy();
        expect(screen.queryByRole('img', { name: /lead-b/ })).toBeNull();
        expect(screen.getByText('Unit: mV')).toBeTruthy();
        expect(screen.getByText('Sample rate: 360 Hz')).toBeTruthy();
        expect(screen.getByText('3600 samples')).toBeTruthy();

        // Exactly ONE DWT coefficient view now (item #11 supersedes the item #10
        // per-channel loop): the selected channel only, with its band legend.
        expect(screen.getAllByText('DWT coefficients')).toHaveLength(1);
        expect(screen.getAllByText('Approximation')).toHaveLength(1);
        const dwt = dwtFigure();
        expect(dwt?.textContent).toContain('lead-a');
        expect(dwt?.textContent).not.toContain('lead-b');
        expect(screen.getAllByText('\u2248 90-180 Hz \u00b7 1800 coefficients')).toHaveLength(1);
        expect(screen.getAllByText('\u2248 45-90 Hz \u00b7 900 coefficients')).toHaveLength(1);
        expect(screen.getAllByText('\u2248 22.5-45 Hz \u00b7 450 coefficients')).toHaveLength(1);
        expect(screen.getAllByText('\u2248 11.25-22.5 Hz \u00b7 225 coefficients')).toHaveLength(1);
        expect(screen.getAllByText('\u2248 0-11.25 Hz \u00b7 225 coefficients')).toHaveLength(1);
    });

    it('switches the selected channel through the Channel combobox in both views', async () => {
        mountApp();

        await screen.findByText('synthetic/sync :: dwt-db4-level4-periodic');

        const channelSelect = screen.getByRole('combobox', {
            name: 'Channel',
        });
        fireEvent.change(channelSelect, { target: { value: 'lead-b' } });

        // The time-series view now draws lead-b (its figure is the only "img").
        expect(
            await screen.findByRole('img', {
                name: 'lead-b time series, unit mV',
            }),
        ).toBeTruthy();
        expect(screen.queryByRole('img', { name: /lead-a/ })).toBeNull();
        // And the single DWT figure switched channel too. (Plain getByText for
        // 'lead-a' would still match the Channel <option>, so scope to the
        // figures/canvases to prove the drawing choice changed.)
        expect(dwtFigure()?.textContent).toContain('lead-b');
        expect(dwtFigure()?.textContent).not.toContain('lead-a');
    });

    it('narrows the visible window through the Viewport combobox in both views', async () => {
        mountApp();

        await screen.findByText('synthetic/sync :: dwt-db4-level4-periodic');

        const viewportSelect = screen.getByRole('combobox', {
            name: 'Viewport',
        });
        // The canonical record is exactly 10.0 s at 360 Hz (3600 samples), so
        // the second quarter preset is labelled 2.50-5.00 s (en dash).
        const quarter = Array.from(
            viewportSelect.querySelectorAll('option'),
        ).find((option) => option.textContent === '2.50\u20135.00 s');
        expect(quarter).toBeTruthy();

        fireEvent.change(viewportSelect, {
            target: { value: quarter!.value },
        });

        // Both the time-series caption and the DWT caption report the window.
        const windows = await screen.findAllByText(
            't = 2.50 s \u2192 5.00 s',
        );
        expect(windows).toHaveLength(2);
    });

    it('re-runs the default analysis through the service on "Re-run analysis"', async () => {
        const service = createDefaultLabService();
        const analyzeSpy = vi.spyOn(service, 'analyze');

        mountApp(service);

        // Initial mount triggers exactly one service analysis.
        await screen.findByText('synthetic / sync');
        expect(analyzeSpy).toHaveBeenCalledTimes(1);

        // Clicking the re-run control asks the service again with the same
        // options (the item-#11 wiring; the UI never recomputes science).
        fireEvent.click(
            screen.getByRole('button', { name: 'Re-run analysis' }),
        );
        await screen.findByText('synthetic / sync');
        expect(analyzeSpy).toHaveBeenCalledTimes(2);
        expect(analyzeSpy).toHaveBeenCalledWith(
            defaultRecordAnalysisOptions(),
        );
    });

    // ---- Phase 11 / ADR-012: local WFDB ingestion -------------------------

    /** A minimal, fully synthetic format-212 MIT-BIH record (two channels). */
    const LOCAL_RECORD_ID = '700';
    const LOCAL_FRAMES = 1024; // a multiple of 16: the canonical db4/4 accepts it
    /**
     * A second picked record with a distinct id, a shorter acquisition and no
     * `.atr`: it proves record *switching* (and that the display selection is
     * reset per analysis) without touching production selection code.
     */
    const SECOND_RECORD_ID = '701';
    const SECOND_FRAMES = 512;

    function localHeader(
        recordId: string = LOCAL_RECORD_ID,
        frames: number = LOCAL_FRAMES,
    ): string {
        return [
            `${recordId} 2 360 ${frames}`,
            `${recordId}.dat 212 200 11 1024 995 0 0 MLII`,
            `${recordId}.dat 212 200 11 1024 1011 0 0 V5`,
        ].join('\n');
    }

    function localChannels(
        frames: number = LOCAL_FRAMES,
        baselines: readonly [number, number] = [995, 1011],
    ): readonly [Int16Array, Int16Array] {
        const channel0 = new Int16Array(frames);
        const channel1 = new Int16Array(frames);
        for (let index = 0; index < frames; index += 1) {
            channel0[index] = baselines[0] + (index % 40);
            channel1[index] = baselines[1] - (index % 32);
        }
        return [channel0, channel1];
    }

    /**
     * Builds `.atr` bytes from raw WFDB byte pairs. The annotation layer is
     * parse-only (no encoder exists), so tests hand-write the pairs exactly as
     * `src/datasets/mitbih/atr.ts` reads them.
     */
    function pairBytes(pairs: readonly (readonly [number, number])[]): Uint8Array {
        const bytes = new Uint8Array(pairs.length * 2);
        pairs.forEach((pair, index) => {
            bytes[2 * index] = pair[0];
            bytes[2 * index + 1] = pair[1];
        });
        return bytes;
    }

    /**
     * A minimal hand-built `.atr` for the local record. A core pair carries the
     * 10-bit sample *difference* in its low byte plus the low 2 bits of its high
     * byte, and the annotation store in the high byte's remaining bits
     * (`high >> 2`; 1 = 'N', 5 = 'V'). The final `[0, 0]` pair is the EOF marker
     * the parser stops at, so the two events land on samples 3 and 500.
     */
    function localAnnotations(): Uint8Array {
        return pairBytes([
            [3, 4], // +3 samples -> 'N' at sample 3
            [241, 21], // +497 samples -> 'V' at sample 500
            [0, 0], // EOF marker
        ]);
    }

    /** A tight `ArrayBuffer` copy so the bytes satisfy `BlobPart` exactly. */
    function toBlobPart(bytes: Uint8Array): ArrayBuffer {
        return bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer;
    }

    /**
     * One record's picked `${id}.hea` + `${id}.dat` files, plus its `${id}.atr`
     * when the record declares annotations (the parser degrades a missing `.atr`
     * to no annotations, so the unannotated record simply omits it).
     */
    function localRecordFiles(
        recordId: string,
        frames: number,
        annotations?: Uint8Array,
    ): File[] {
        const [channel0, channel1] = localChannels(frames);
        const files = [
            new File([localHeader(recordId, frames)], `${recordId}.hea`, {
                type: 'text/plain',
            }),
            new File(
                [toBlobPart(encodeFormat212(channel0, channel1))],
                `${recordId}.dat`,
                { type: 'application/octet-stream' },
            ),
        ];
        if (annotations !== undefined) {
            files.push(
                new File([toBlobPart(annotations)], `${recordId}.atr`, {
                    type: 'application/octet-stream',
                }),
            );
        }
        return files;
    }

    /** Both discoverable records of one local selection, in id order. */
    function localFiles(): File[] {
        return [
            ...localRecordFiles(
                LOCAL_RECORD_ID,
                LOCAL_FRAMES,
                localAnnotations(),
            ),
            ...localRecordFiles(SECOND_RECORD_ID, SECOND_FRAMES),
        ];
    }

    it('opens local WFDB files, discovers the record and analyzes it through the service', async () => {
        mountApp(createDefaultLabService(), prepareLocalFiles);

        // The synthetic boot record loads first, exactly as before.
        await screen.findByText('synthetic / sync');

        const input = screen.getByLabelText(
            'Open local WFDB files',
        ) as HTMLInputElement;
        Object.defineProperty(input, 'files', {
            value: localFiles(),
            configurable: true,
        });
        await fireEvent.change(input);

        // The picked record's identity renders once its analysis resolves...
        expect(
            await screen.findByText('mit-bih-arrhythmia / 700'),
        ).toBeTruthy();
        expect(
            screen.getByText(
                'mit-bih-arrhythmia/700 :: dwt-db4-level4-periodic',
            ),
        ).toBeTruthy();
        // ...and the discovered record is offered for re-selection.
        expect(
            screen.getByRole('combobox', { name: 'Record' }),
        ).toBeTruthy();
        expect(screen.getByRole('option', { name: '700' })).toBeTruthy();
    });

    // ---- Phase 12: annotation overlay -------------------------------------

    it('overlays the picked record annotations in the time-series caption', async () => {
        mountApp(createDefaultLabService(), prepareLocalFiles);

        // The synthetic boot record declares no annotations at all.
        await screen.findByText('synthetic / sync');
        expect(screen.getByText('Annotations: none')).toBeTruthy();

        const input = screen.getByLabelText(
            'Open local WFDB files',
        ) as HTMLInputElement;
        Object.defineProperty(input, 'files', {
            value: localFiles(),
            configurable: true,
        });
        await fireEvent.change(input);

        await screen.findByText('mit-bih-arrhythmia / 700');

        // ...while the picked record's own events travelled through the
        // service result into the view (display only, ADR-013): both events are
        // inside the default full-record viewport and keep distinct symbols.
        expect(await screen.findByText('Annotations: 2 in view')).toBeTruthy();
        // The window's own distinct symbols drive the Phase-17 legend toggles
        // (the Phase-15 `Symbols:` caption is now the control itself).
        const legend = screen.getByRole('group', {
            name: 'Symbol selection',
        });
        expect(
            Array.from(legend.querySelectorAll('button'), (b) => b.textContent),
        ).toEqual(['N', 'V']);
        expect(screen.queryByText('Annotations: none')).toBeNull();
    });

    // ---- Phase 12: multi-record selection --------------------------------

    it('switches to another discovered record through the Record combobox', async () => {
        mountApp(createDefaultLabService(), prepareLocalFiles);

        await screen.findByText('synthetic / sync');

        const input = screen.getByLabelText(
            'Open local WFDB files',
        ) as HTMLInputElement;
        Object.defineProperty(input, 'files', {
            value: localFiles(),
            configurable: true,
        });
        await fireEvent.change(input);

        // Discovery order is deterministic: the first id is analyzed on ingest
        // and both ids are offered for re-selection.
        await screen.findByText('mit-bih-arrhythmia / 700');
        expect(screen.getByRole('option', { name: '701' })).toBeTruthy();

        // Move the display selection off its default first, so the reset below
        // is actually observable rather than coincidentally identical.
        fireEvent.change(screen.getByRole('combobox', { name: 'Channel' }), {
            target: { value: 'V5' },
        });
        fireEvent.change(screen.getByRole('combobox', { name: 'Viewport' }), {
            target: { value: '2' },
        });
        expect(
            (
                screen.getByRole('combobox', {
                    name: 'Channel',
                }) as HTMLSelectElement
            ).value,
        ).toBe('V5');

        const recordSelect = screen.getByRole('combobox', {
            name: 'Record',
        }) as HTMLSelectElement;
        expect(recordSelect.value).toBe(LOCAL_RECORD_ID);
        fireEvent.change(recordSelect, {
            target: { value: SECOND_RECORD_ID },
        });

        // The second record's identity and stable analysis id replace the
        // first's: the switch really went through the application service.
        expect(
            await screen.findByText('mit-bih-arrhythmia / 701'),
        ).toBeTruthy();
        expect(
            screen.getByText(
                'mit-bih-arrhythmia/701 :: dwt-db4-level4-periodic',
            ),
        ).toBeTruthy();
        expect(screen.queryByText('mit-bih-arrhythmia / 700')).toBeNull();

        // ...and the display selection is reset exactly like a fresh analysis
        // (first channel + full record) for the new record's own 512 samples.
        expect(
            (
                screen.getByRole('combobox', {
                    name: 'Channel',
                }) as HTMLSelectElement
            ).value,
        ).toBe('MLII');
        expect(
            (
                screen.getByRole('combobox', {
                    name: 'Viewport',
                }) as HTMLSelectElement
            ).value,
        ).toBe('0');
        expect(
            screen.getByRole('img', { name: 'MLII time series, unit mV' }),
        ).toBeTruthy();
        expect(screen.getByText('512 samples')).toBeTruthy();
        // The second record ships no `.atr`, so the overlay reports none.
        expect(screen.getByText('Annotations: none')).toBeTruthy();
    });

    // ---- Phase 13: display navigation (custom viewport) -------------------

    describe('display navigation (Phase 13 item 4)', () => {
        function viewportSelect(): HTMLSelectElement {
            return screen.getByRole('combobox', {
                name: 'Viewport',
            }) as HTMLSelectElement;
        }

        function optionLabels(select: HTMLSelectElement): string[] {
            return Array.from(select.querySelectorAll('option')).map(
                (option) => option.textContent ?? '',
            );
        }

        it('leaves the Viewport combobox at the base presets by default', async () => {
            mountApp();

            await screen.findByText('synthetic/sync :: dwt-db4-level4-periodic');

            const select = viewportSelect();
            expect(optionLabels(select)).toEqual([
                'Full record',
                '0.00\u20132.50 s',
                '2.50\u20135.00 s',
                '5.00\u20137.50 s',
                '7.50\u201310.00 s',
            ]);
            expect(screen.queryByText('Custom (zoomed)')).toBeNull();
            expect(select.value).toBe('0');
        });

        it('adds and selects a Custom (zoomed) option when the view zooms in', async () => {
            mountApp();

            await screen.findByText('synthetic/sync :: dwt-db4-level4-periodic');
            // The default window is the full record in both canvas captions.
            expect(screen.getAllByText('t = 0.00 s \u2192 10.00 s')).toHaveLength(2);

            fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));

            // The display-only window is appended after the presets and becomes
            // the selected option...
            expect(await screen.findByText('Custom (zoomed)')).toBeTruthy();
            const select = viewportSelect();
            expect(optionLabels(select)).toHaveLength(6);
            expect(select.value).toBe('5');
            // ...and both captions now report the narrowed window (the zoom
            // keeps the record's centre, so the full 0-10 s window becomes the
            // 2.5-7.5 s one; the caption prints start -> end).
            expect(screen.getAllByText('t = 2.50 s \u2192 7.50 s')).toHaveLength(2);
            expect(screen.queryByText('t = 0.00 s \u2192 10.00 s')).toBeNull();
        });

        it('returns the select to Full record and restores the window on Reset view', async () => {
            mountApp();

            await screen.findByText('synthetic/sync :: dwt-db4-level4-periodic');
            fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
            await screen.findByText('Custom (zoomed)');

            fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));

            // The reset commit lands exactly on the record's full window, so both
            // captions return to it and the custom option is cleared rather than
            // kept as a second, identical full window.
            expect(
                await screen.findAllByText('t = 0.00 s \u2192 10.00 s'),
            ).toHaveLength(2);
            expect(viewportSelect().value).toBe('0');
            expect(screen.queryByText('Custom (zoomed)')).toBeNull();
        });

        it('clears the custom zoom when another record is analyzed', async () => {
            mountApp(createDefaultLabService(), prepareLocalFiles);

            await screen.findByText('synthetic / sync');
            fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
            expect(await screen.findByText('Custom (zoomed)')).toBeTruthy();

            const input = screen.getByLabelText(
                'Open local WFDB files',
            ) as HTMLInputElement;
            Object.defineProperty(input, 'files', {
                value: localFiles(),
                configurable: true,
            });
            await fireEvent.change(input);
            await screen.findByText('mit-bih-arrhythmia / 700');

            expect(screen.queryByText('Custom (zoomed)')).toBeNull();
            expect(viewportSelect().value).toBe('0');
        });

        it('never re-invokes the analysis service from a navigation action', async () => {
            const service = createDefaultLabService();
            const analyzeSpy = vi.spyOn(service, 'analyze');

            mountApp(service);

            await screen.findByText('synthetic / sync');
            expect(analyzeSpy).toHaveBeenCalledTimes(1);

            fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
            await screen.findByText('Custom (zoomed)');
            fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
            fireEvent.click(screen.getByRole('button', { name: 'Pan right' }));
            fireEvent.click(screen.getByRole('button', { name: 'Pan left' }));
            fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));

            expect(analyzeSpy).toHaveBeenCalledTimes(1);
        });
    });
});
