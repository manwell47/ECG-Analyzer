<script lang="ts">
    // ECG Lab root application view (Phase 7 items #8, #9, #10 and #11).
    //
    // `src/main.ts` is the composition root: it builds the `RecordAnalysisService`
    // over the canonical defaults (`src/application/defaults.ts`) and hands both
    // the service and the initial options to this component as props. On mount
    // the component loads the default fixture record through the application
    // service (the only layer presentation may call) and renders the
    // domain-typed `AnalysisResult` as Svelte views:
    //
    // - a record / analysis identity summary (item #8);
    // - thin channel + viewport interaction controls (item #11), whose viewport
    //   presets are sliced from the result's own sampling facts by the pure
    //   `views/controls/presets.ts` helper, plus a "Re-run analysis" control
    //   that asks the application service to analyze the default record again;
    // - a canvas time-series view (item #9) of the *selected* channel/window,
    //   whose pure viewport/sample mapping lives in `views/timeSeries/geometry.ts`;
    // - a canvas DWT coefficient view (item #10) of the same *selected*
    //   channel/window, whose pure band/stride helpers live in
    //   `views/dwt/coefficientGeometry.ts`;
    // - a display-only model-output panel (Phase 18 Part B item 7): when the
    //   composition root injects a model-output service, the user can ask it to
    //   score the *selected* channel and committed window and the panel shows
    //   the model's own declared contract, per-label scores and honest
    //   semantics. It is a display of a model artifact — never a detection, and
    //   never a claim of certainty;
    // - a local WFDB ingestion control (Phase 11 / ADR-012): when the
    //   composition root injects a preparation factory, the user can open local
    //   MIT-BIH files and re-analyze a discovered record through the application
    //   service. The synthetic boot record and every science path are unchanged;
    // - display navigation (Phase 13 / ADR-014): the time-series view reports a
    //   committed zoom/pan window through `onViewportCommit`; this component
    //   stores it as `customViewport`, appends a "Custom (zoomed)" option after
    //   the presets and draws that window in *both* canvas views. It is a
    //   display-only re-window of the one analysis result — the service is never
    //   re-invoked, and a commit that lands exactly on the full record clears the
    //   custom window again.
    //
    // Selection is a pure display concern over the one analysis result: the
    // analysis itself is always full-record over every channel (the service
    // options carry no channel/window fields), so the controls only pick which
    // channel and which time window of that result the two views draw. No
    // science configuration lives here — the component only reads what the
    // service returns and formats it for display.
    import { onDestroy, onMount } from "svelte";

    import type {
        AnalysisResult,
        RecordAnalysisOptions,
        RecordAnalysisService,
    } from "../application/analysis";
    import { EcgError } from "../domain/error";
    import type { RecordId } from "../domain/record";
    import DatasetPicker from "./dataset/DatasetPicker.svelte";
    import ViewControls from "./views/controls/ViewControls.svelte";
    import {
        viewportPresets,
        type ViewportOption,
    } from "./views/controls/presets";
    import type { ModelOutputService } from "../application/inference";
    import DwtCoefficientView from "./views/dwt/DwtCoefficientView.svelte";
    import ModelOutputPanel from "./views/inference/ModelOutputPanel.svelte";
    import TimeSeriesView from "./views/timeSeries/TimeSeriesView.svelte";
    import type { TimeViewport } from "./views/timeSeries/geometry";

    /**
     * A local dataset prepared from the user's file selection: the service to
     * analyze through, the record ids discovered, and a release hook for the
     * owned (worker-backed) resources. Built by the composition root, which
     * alone knows the concrete ingestion + worker wiring.
     */
    interface PreparedLocalDataset {
        readonly service: RecordAnalysisService;
        readonly recordIds: readonly RecordId[];
        readonly dispose: () => void;
    }

    interface Props {
        /** Application service owning the dataset (injected by the composition root). */
        service: RecordAnalysisService;
        /** Record + DWT the bootstrap asks the service to analyze on mount. */
        initialOptions: RecordAnalysisOptions;
        /**
         * Optional local-ingestion factory (Phase 11 / ADR-012). When injected,
         * the component renders the local-dataset control and this factory turns
         * a file selection into a prepared dataset. Omitted (e.g. the jsdom
         * bootstrap slice), the control is hidden and only the injected synthetic
         * service is used — so the default markup is unchanged.
         */
        prepareLocalDataset?:
            | ((files: readonly File[]) => Promise<PreparedLocalDataset>)
            | undefined;
        /**
         * Optional directory-picker hook (Chromium progressive enhancement).
         * When injected, the picker offers an "Open folder" button and this
         * factory returns the prepared dataset (or `undefined` when cancelled).
         */
        pickLocalDirectory?:
            | (() => Promise<PreparedLocalDataset | undefined>)
            | undefined;
        /**
         * Optional model-output service (Phase 18 Part B item 7). When injected,
         * the component renders a display-only panel that asks the application
         * service to score the selected channel and committed window and shows
         * the model's own declared contract and per-label output. Omitted (e.g.
         * the jsdom bootstrap slice), the panel and its heading are absent, so
         * the default markup is unchanged.
         */
        modelOutput?: ModelOutputService | undefined;
    }

    let {
        service,
        initialOptions,
        prepareLocalDataset = undefined,
        pickLocalDirectory = undefined,
        modelOutput = undefined,
    }: Props = $props();

    let result = $state<AnalysisResult | null>(null);
    let failureMessage = $state<string | null>(null);
    let busy = $state(true);

    // Local ingestion state (Phase 11 / ADR-012). `ingestedService` starts null:
    // the component analyzes through the injected bootstrap service until the
    // user opens local files, then through that dataset's service. These opaque
    // service/handle instances are held with `$state.raw` so they are never
    // deep-proxied (only reassignment needs to be reactive).
    let ingestedService = $state.raw<RecordAnalysisService | null>(null);
    let ingestedDispose = $state.raw<(() => void) | null>(null);
    let recordIds = $state<readonly RecordId[]>([]);
    let selectedRecordId = $state<RecordId | null>(null);
    let ingesting = $state(false);

    // The user's display selection over the analyzed result. Reset to the
    // first channel / full record whenever a (re-)analysis resolves.
    let selectedChannelName = $state<string | null>(null);
    let selectedViewportIndex = $state(0);

    // A window committed by the time-series view's own navigation (Phase 13 /
    // ADR-014): a display-only re-window of the *same* analysis result, held
    // apart from the preset index so returning to a preset is a plain clear.
    // `null` means "no custom zoom" (the preset index decides the window).
    let customViewport = $state<TimeViewport | null>(null);

    onMount(() => {
        void analyzeRecordById(initialOptions.recordId);
    });

    onDestroy(() => {
        releaseIngestedDataset();
    });

    /**
     * Analyze one record of the *active* dataset with the bootstrap's DWT /
     * preprocessing options and render the result. This is the single place the
     * component calls the application service (never computing science itself).
     */
    async function analyzeRecordById(recordId: RecordId): Promise<void> {
        busy = true;
        failureMessage = null;
        try {
            const analyzed = await serviceForAnalysis().analyze({
                ...initialOptions,
                recordId,
            });
            result = analyzed;
            selectedChannelName = analyzed.signal.channels[0]?.name ?? null;
            selectedViewportIndex = 0;
            customViewport = null;
        } catch (error) {
            result = null;
            failureMessage = describeFailure(error);
        } finally {
            busy = false;
        }
    }

    /** The service every analysis goes through (the two lines of state above). */
    function serviceForAnalysis(): RecordAnalysisService {
        return ingestedService ?? service;
    }

    /** Release the currently-ingested dataset's owned resources, at most once. */
    function releaseIngestedDataset(): void {
        const dispose = ingestedDispose;
        ingestedDispose = null;
        dispose?.();
    }

    /** Turn a user file selection into the active dataset and analyze it. */
    async function handleFilesSelected(files: readonly File[]): Promise<void> {
        const prepare = prepareLocalDataset;
        if (prepare === undefined || files.length === 0) {
            return;
        }
        await ingest(() => prepare(files));
    }

    /** Ingest through the directory picker (progressive enhancement). */
    async function handleOpenFolder(): Promise<void> {
        const pick = pickLocalDirectory;
        if (pick === undefined) {
            return;
        }
        await ingest(pick);
    }

    /**
     * Shared ingestion flow: prepare the dataset through the injected factory,
     * swap it in (releasing any previous one), then analyze its first record
     * through the application service.
     */
    async function ingest(
        prepare: () => Promise<PreparedLocalDataset | undefined>,
    ): Promise<void> {
        ingesting = true;
        failureMessage = null;
        try {
            const prepared = await prepare();
            if (prepared === undefined) {
                return; // user cancelled the directory dialog
            }
            releaseIngestedDataset();
            ingestedService = prepared.service;
            ingestedDispose = prepared.dispose;
            recordIds = prepared.recordIds;
            const first = prepared.recordIds[0];
            if (first === undefined) {
                selectedRecordId = null;
                result = null;
                failureMessage =
                    "No WFDB records (.hea files) were found in the selection.";
                return;
            }
            selectedRecordId = first;
            await analyzeRecordById(first);
        } catch (error) {
            result = null;
            failureMessage = describeFailure(error);
        } finally {
            ingesting = false;
        }
    }

    function handleRecordChange(event: Event): void {
        const value = (event.currentTarget as HTMLSelectElement).value;
        if (value.length === 0) {
            return;
        }
        selectedRecordId = value;
        void analyzeRecordById(value);
    }

    function describeFailure(error: unknown): string {
        if (error instanceof EcgError) {
            return `${error.name} (${error.code}): ${error.message}`;
        }
        return error instanceof Error ? error.message : String(error);
    }

    // ----- Display selection derived from the domain-typed result -----------

    let channelNames = $derived.by((): readonly string[] => {
        const analyzed = result;
        return analyzed === null
            ? []
            : analyzed.signal.channels.map((channel) => channel.name);
    });

    let viewportOptions = $derived.by((): readonly ViewportOption[] => {
        const analyzed = result;
        if (analyzed === null) {
            return [];
        }
        const firstChannel = analyzed.signal.channels[0];
        if (firstChannel === undefined) {
            return [];
        }
        return viewportPresets(
            analyzed.signal.sampling,
            firstChannel.data.length,
        );
    });

    // Validate the stored selection against the result so an out-of-date name
    // (e.g. from a previous record) can never reach the views; fall back to the
    // first channel, mirroring each view's own unknown-channel fallback.
    let activeChannelName = $derived.by((): string | null => {
        const analyzed = result;
        if (analyzed === null) {
            return null;
        }
        const selected = selectedChannelName;
        if (
            selected !== null &&
            analyzed.signal.channels.some(
                (channel) => channel.name === selected,
            )
        ) {
            return selected;
        }
        return analyzed.signal.channels[0]?.name ?? null;
    });

    // The committed custom window as a selectable option, appended *after* the
    // presets (Phase 13 / ADR-014). It exists only while a custom zoom does and
    // a record is loaded, so the base preset list is unchanged otherwise (the
    // default-markup promise).
    let customViewportOption = $derived.by((): ViewportOption | null => {
        const viewport = customViewport;
        if (viewport === null || viewportOptions.length === 0) {
            return null;
        }
        return { label: "Custom (zoomed)", viewport };
    });

    // What the Viewport combobox renders: the presets, plus the custom window
    // when it exists. `ViewControls`/`presets.ts` stay unmodified.
    let displayedViewportOptions = $derived.by(
        (): readonly ViewportOption[] => {
            const options = viewportOptions;
            const custom = customViewportOption;
            return custom === null ? options : [...options, custom];
        },
    );

    // The index the combobox reports as selected (the custom window sits last).
    let effectiveViewportIndex = $derived(
        customViewportOption === null
            ? selectedViewportIndex
            : viewportOptions.length,
    );

    // The window both canvas views draw. A custom commit takes precedence over
    // the preset index; it is the same analyzed signal, only re-windowed.
    let activeViewport = $derived.by((): TimeViewport | undefined => {
        const custom = customViewportOption;
        if (custom !== null) {
            return custom.viewport;
        }
        const options = viewportOptions;
        if (options.length === 0) {
            return undefined;
        }
        const option = options[selectedViewportIndex] ?? options[0];
        return option?.viewport;
    });

    function handleChannelChange(channelName: string): void {
        selectedChannelName = channelName;
    }

    /** True when `viewport` is exactly the record's full acquisition window. */
    function isFullViewport(viewport: TimeViewport): boolean {
        const full = viewportOptions[0]?.viewport;
        return (
            full !== undefined &&
            viewport.startSec === full.startSec &&
            viewport.durationSec === full.durationSec
        );
    }

    /**
     * A window committed by the time-series view's navigation (buttons or a
     * drag, Phase 13 / ADR-014). A commit that lands exactly on the full record
     * — the view's own "Reset view", or zooming all the way back out — clears
     * the custom window and returns the combobox to "Full record"; anything
     * else is stored as the custom window. The service is never re-invoked.
     */
    function handleViewportCommit(viewport: TimeViewport): void {
        if (isFullViewport(viewport)) {
            customViewport = null;
            selectedViewportIndex = 0;
            return;
        }
        customViewport = viewport;
    }

    /**
     * Picking a preset is a plain display selection that also drops any custom
     * zoom (the presets always describe the analyzed record, never the
     * re-windowed custom window). Re-picking the custom option keeps it.
     */
    function handleViewportChange(index: number): void {
        if (customViewportOption !== null && index === viewportOptions.length) {
            return;
        }
        customViewport = null;
        selectedViewportIndex = index;
    }

    function handleRerun(): void {
        void analyzeRecordById(selectedRecordId ?? initialOptions.recordId);
    }
</script>

<main>
    <header>
        <h1>ECG Signal Processing & AI Analysis Laboratory</h1>
        <p>
            The default synthetic record is analyzed through the application
            service and rendered as domain-typed Svelte views (Phase 7): thin
            interaction controls choose which analyzed channel and which time
            window the canvas time-series and DWT coefficient views show (item
            #11), and a re-run control asks the service to analyze the default
            record again with the same options.
        </p>
    </header>

    {#if prepareLocalDataset !== undefined}
        <section aria-labelledby="local-dataset-heading">
            <h2 id="local-dataset-heading">Local dataset (WFDB)</h2>
            <p class="view-note">
                Open local MIT-BIH / WFDB files (a <code>.hea</code> header and
                its <code>.dat</code> data) to analyze a real record. Files are read
                in the browser and never uploaded or persisted; the synthetic boot
                record stays selected until you choose otherwise.
            </p>
            <DatasetPicker
                onFilesSelected={(files) => void handleFilesSelected(files)}
                onOpenFolder={pickLocalDirectory === undefined
                    ? undefined
                    : () => void handleOpenFolder()}
                busy={ingesting}
            />
            {#if recordIds.length > 0}
                <div class="record-picker">
                    <label for="record-select">Record</label>
                    <select
                        id="record-select"
                        value={selectedRecordId ?? ""}
                        onchange={handleRecordChange}
                        disabled={ingesting}
                    >
                        {#each recordIds as recordId (recordId)}
                            <option value={recordId}>{recordId}</option>
                        {/each}
                    </select>
                    <span class="record-count">
                        {recordIds.length} record{recordIds.length === 1
                            ? ""
                            : "s"} discovered
                    </span>
                </div>
            {/if}
        </section>
    {/if}

    {#if busy}
        <p role="status">Analyzing default record&hellip;</p>
    {:else if failureMessage !== null}
        <p role="alert">{failureMessage}</p>
    {:else if result !== null}
        <section aria-labelledby="record-summary-heading">
            <h2 id="record-summary-heading">
                {result.identity.datasetId} / {result.identity.recordId}
            </h2>
            <p>Subject <code>{result.subjectId}</code></p>
            <p>Analysis <code>{result.analysisId}</code></p>
            <p>
                Generated <time datetime={result.generatedAtIso}
                    >{result.generatedAtIso}</time
                >
            </p>
        </section>

        <section aria-labelledby="view-controls-heading">
            <h3 id="view-controls-heading">View controls</h3>
            <p class="view-note">
                Choose which analyzed channel and which time window the two
                canvas views below draw. The options are derived only from the
                domain-typed result (channel names + sampling facts); the
                analysis itself always covers the whole record. Navigating the
                time-series plot (zoom / pan / reset) adds a "Custom (zoomed)"
                option for that display-only window — the analysis is never
                re-run.
            </p>
            <ViewControls
                {channelNames}
                selectedChannel={activeChannelName ?? ""}
                onChannelChange={handleChannelChange}
                viewportOptions={displayedViewportOptions}
                selectedViewportIndex={effectiveViewportIndex}
                onViewportChange={handleViewportChange}
                onRerun={handleRerun}
                {busy}
            />
        </section>

        <section aria-labelledby="time-series-heading">
            <h3 id="time-series-heading">Time-series view (signal)</h3>
            <p class="view-note">
                Canvas rendering of the analyzed signal's selected channel. The
                time axis is the domain convention sampleIndex / fs and
                amplitude is shown in the channel's own unit; the source data is
                never mutated. The analyzed record's own annotation events (when
                its source provides them) are overlaid as display-only markers
                and are never fused into the signal.
            </p>
            <TimeSeriesView
                signal={result.signal}
                channelName={activeChannelName ?? undefined}
                viewport={activeViewport}
                annotations={result.sourceRecord.annotations}
                onViewportCommit={handleViewportCommit}
            />
        </section>

        <section aria-labelledby="dwt-view-heading">
            <h3 id="dwt-view-heading">DWT coefficient view</h3>
            <p class="view-note">
                One stacked-lane canvas for the selected channel, driven by the
                domain-typed <code>WaveletDecomposition</code>: detail
                coefficients from finest (level 1) down to the final
                approximation. Every lane is labelled with its approximate
                octave band (derived from the sample rate and level only,
                ADR-003) and coefficient count; the source data is never
                mutated.
            </p>
            <dl>
                <div>
                    <dt>Wavelet</dt>
                    <dd>{result.decomposition.waveletName}</dd>
                </div>
                <div>
                    <dt>Level</dt>
                    <dd>{result.decomposition.level}</dd>
                </div>
                <div>
                    <dt>Extension</dt>
                    <dd>{result.decomposition.extensionMode}</dd>
                </div>
            </dl>
            <DwtCoefficientView
                decomposition={result.decomposition}
                channelName={activeChannelName ?? undefined}
                viewport={activeViewport}
            />
        </section>

        {#if modelOutput !== undefined}
            <section aria-labelledby="model-output-heading">
                <h3 id="model-output-heading">
                    Model output (development probe)
                </h3>
                <p class="view-note">
                    Scores the selected channel and committed window through the
                    injected model-output service and shows what the model's own
                    metadata says the numbers mean. The window is scored exactly
                    as displayed — it is never resampled, padded or reshaped to
                    fit, so a window the declared contract does not accept is
                    reported as a classified refusal instead of being adjusted.
                </p>
                <ModelOutputPanel
                    service={modelOutput}
                    analysis={result}
                    channelName={activeChannelName ?? undefined}
                    viewport={activeViewport}
                />
            </section>
        {/if}
    {/if}
</main>
