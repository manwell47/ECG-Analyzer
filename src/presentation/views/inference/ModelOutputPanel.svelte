<script lang="ts">
    // Display-only model-output panel (Phase 18 Part B item 7).
    //
    // This component renders the application layer's `ModelOutputDescription`
    // verbatim and nothing else: it invents no science, computes no numbers, and
    // makes no claim the model's own metadata does not make. Pressing the button
    // asks the injected `ModelOutputService` to score *the selected channel and
    // the committed window* of the current analysis; whatever comes back is
    // shown as-is:
    //
    // - the model's own identity, task and backend, plus the exact candidate it
    //   scored (model @ version :: analysis :: channel :: [start, end));
    // - the declared input tensor and output contract;
    // - one row per label with the score and the semantics the metadata
    //   honestly supports ('predicted-probability' only when the declared output
    //   genuinely is a probability, otherwise an uncalibrated 'model-score');
    // - the model's own provenance limitations, which for the committed probe
    //   state plainly that it is a development artifact with no clinical meaning.
    //
    // The word "confidence" never appears here (rules §47/§49, ADR-004): the
    // panel shows a probability or an uncalibrated score, never a claim of
    // certainty. A window the declared contract does not accept is reported as
    // its classified refusal — it is never resampled, padded or reshaped to fit.
    //
    // Without an injected service the panel renders nothing at all, so the
    // default markup is unchanged when the composition root does not wire one.
    import type { AnalysisResult } from "../../../application/analysis";
    import type {
        ModelOutputDescription,
        ModelOutputService,
    } from "../../../application/inference";
    import { EcgError } from "../../../domain/error";
    import type { TimeSpan } from "../../../domain/sampling";

    interface Props {
        /**
         * Application service that scores one window. Omitted — the jsdom
         * bootstrap slice, or any host that wires no engine — the panel renders
         * nothing.
         */
        service?: ModelOutputService | undefined;
        /** The analysis whose selected window is scored. */
        analysis: AnalysisResult;
        /** Selected channel name; the service falls back to the first channel. */
        channelName?: string | undefined;
        /** Committed display window; omitted, the whole record is scored. */
        viewport?: TimeSpan | undefined;
    }

    let {
        service = undefined,
        analysis,
        channelName = undefined,
        viewport = undefined,
    }: Props = $props();

    let description = $state<ModelOutputDescription | null>(null);
    let failureMessage = $state<string | null>(null);
    let scoring = $state(false);

    /** Honest, non-clinical framing shown with every output (rules §47). */
    const CLINICAL_DISCLAIMER =
        "Display of a model artifact, not a diagnosis: this output has no clinical " +
        "meaning and must never be used to inform a medical or scientific conclusion.";

    /** Score the selected channel + committed window through the service. */
    async function scoreWindow(): Promise<void> {
        const target = service;
        if (target === undefined) {
            return;
        }
        scoring = true;
        failureMessage = null;
        try {
            description = await target.score({
                analysis,
                channelName,
                viewport,
            });
        } catch (error) {
            description = null;
            failureMessage = describeFailure(error);
        } finally {
            scoring = false;
        }
    }

    function describeFailure(error: unknown): string {
        if (error instanceof EcgError) {
            return `${error.name} (${error.code}): ${error.message}`;
        }
        return error instanceof Error ? error.message : String(error);
    }

    /** One line naming exactly which samples were scored, and over what time. */
    function windowSummary(entry: ModelOutputDescription): string {
        const window = entry.window;
        return (
            `${window.channelName} samples [${window.startSample}, ${window.endSample}) ` +
            `= ${window.startSec}s to ${window.endSec}s at ${window.sampleRateHz} Hz`
        );
    }
</script>

{#if service !== undefined}
    <div class="model-output">
        <button
            type="button"
            onclick={() => void scoreWindow()}
            disabled={scoring}
        >
            {scoring ? "Scoring…" : "Score this window"}
        </button>

        {#if failureMessage !== null}
            <p role="alert">{failureMessage}</p>
        {:else if description !== null}
            <dl class="identity">
                <div>
                    <dt>Model</dt>
                    <dd>
                        <code
                            >{description.modelId}@{description.modelVersion}</code
                        >
                    </dd>
                </div>
                <div>
                    <dt>Task</dt>
                    <dd>{description.task}</dd>
                </div>
                <div>
                    <dt>Backend</dt>
                    <dd><code>{description.backendId}</code></dd>
                </div>
                <div>
                    <dt>Candidate</dt>
                    <dd><code>{description.candidateId}</code></dd>
                </div>
                <div>
                    <dt>Window scored</dt>
                    <dd>{windowSummary(description)}</dd>
                </div>
                <div>
                    <dt>Input tensor</dt>
                    <dd>
                        <code>{description.input.name}</code>
                        [{description.input.shape.join(", ")}]
                        {description.input.dtype}
                    </dd>
                </div>
                <div>
                    <dt>Declared output</dt>
                    <dd>
                        {description.output.semantics}
                        (activation {description.output.activation})
                    </dd>
                </div>
                <div>
                    <dt>Normalization</dt>
                    <dd>{description.normalization.strategy}</dd>
                </div>
            </dl>

            <table>
                <caption>Model output per label</caption>
                <thead>
                    <tr>
                        <th scope="col">Label</th>
                        <th scope="col">Value</th>
                        <th scope="col">Semantics</th>
                    </tr>
                </thead>
                <tbody>
                    {#each description.scores as score (score.label)}
                        <tr>
                            <td>{score.label}</td>
                            <td>{score.score.toFixed(4)}</td>
                            <td>{score.semantics}</td>
                        </tr>
                    {/each}
                </tbody>
            </table>

            {#if description.preprocessingAssumptions.length > 0}
                <p class="assumptions">
                    Declared preprocessing:
                    {description.preprocessingAssumptions
                        .map((assumption) => assumption.stage)
                        .join(", ")}
                </p>
            {/if}

            {#if description.modelProvenance.limitations !== undefined}
                <p class="provenance">
                    {description.modelProvenance.limitations}
                </p>
            {/if}
            <p class="disclaimer">{CLINICAL_DISCLAIMER}</p>
        {/if}
    </div>
{/if}

<style>
    .model-output {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }

    .identity {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 0.25rem 1rem;
        margin: 0;
    }

    .identity div {
        display: contents;
    }

    .identity dt {
        font-weight: 600;
    }

    .identity dd {
        margin: 0;
        overflow-wrap: anywhere;
    }

    table {
        border-collapse: collapse;
    }

    caption {
        text-align: left;
        font-weight: 600;
    }

    th,
    td {
        border: 1px solid currentColor;
        padding: 0.25rem 0.5rem;
        text-align: left;
    }

    .assumptions,
    .provenance,
    .disclaimer {
        margin: 0;
        max-width: 60ch;
    }

    .disclaimer {
        font-style: italic;
    }
</style>
