// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';

import type { AnalysisResult } from '../../../../application/analysis';
import {
    createDefaultLabService,
    defaultRecordAnalysisOptions,
} from '../../../../application/defaults';
import {
    ModelOutputService,
    candidateIdOf,
} from '../../../../application/inference';
import type { InferenceEngine } from '../../../../ml/engine';
import { loadProbeModelMetadata } from '../../../../ml/testing/probeModel';
import { createStubEngine } from '../../../../ml/testing/stub';
import ModelOutputPanel from '../ModelOutputPanel.svelte';

/**
 * Display-only model-output panel (Phase 18 Part B item 7) — jsdom wiring slice.
 *
 * The panel is a *display*: it asks the injected `ModelOutputService` to score
 * the selected channel and the committed window and renders the application
 * layer's `ModelOutputDescription` verbatim. This slice therefore asserts only
 * what the wiring can be wrong about:
 *
 * - without an injected service the panel renders nothing (the default markup
 *   stays inert, and no button exists to press);
 * - a real `ModelOutputService` over the deterministic stub engine and the real
 *   probe metadata scores the exact 1 s window and shows the model's own
 *   identity, task, backend, candidate id, window summary and declared input /
 *   output contract — every value read back from the metadata, never invented;
 * - one table row per declared label, each with a formatted value and the
 *   semantics the metadata honestly supports (never a claim of certainty);
 * - an unknown channel name falls back to the model's first channel;
 * - the declared preprocessing assumptions and the model's own provenance
 *   limitations reach the page;
 * - a window the declared contract does not accept is reported as its
 *   classified refusal, with no output table rendered;
 * - the in-flight state disables the button and says it is scoring.
 *
 * The word "confidence" is asserted absent wherever output is shown (rules
 * §47/§49). No numeric correctness is re-asserted here (that is the
 * application-layer Node gate, `src/application/__tests__/inference.test.ts`)
 * and no timing is measured (rules §51). `cleanup` runs in this explicit
 * `afterEach`, mirroring the other jsdom slices; the testing-library global
 * `autoCleanup` stays disabled repo-wide.
 */
describe('ModelOutputPanel (display-only model output)', () => {
    afterEach(() => {
        cleanup();
    });

    const ONE_SECOND = { startSec: 0, durationSec: 1 } as const;
    const SCORED_CHANNEL = 'lead-b';

    /** The commitment the panel is handed: the canonical default analysis. */
    async function analysedDefaultRecord(): Promise<AnalysisResult> {
        return createDefaultLabService().analyze(defaultRecordAnalysisOptions());
    }

    /** The real application service over the caller's engine + probe metadata. */
    function panelService(engine: InferenceEngine): ModelOutputService {
        return new ModelOutputService(engine, loadProbeModelMetadata());
    }

    function renderPanel(
        analysis: AnalysisResult,
        options: {
            readonly service?: ModelOutputService | undefined;
            readonly channelName?: string | undefined;
            readonly viewport?: { readonly startSec: number; readonly durationSec: number } | undefined;
        } = {},
    ): void {
        render(ModelOutputPanel, {
            props: {
                analysis,
                service: options.service,
                channelName: options.channelName,
                viewport: options.viewport,
            },
        });
    }

    function normalized(text: string): string {
        return text.replace(/\s+/g, ' ').trim();
    }

    function identityList(): HTMLElement {
        const list = document.querySelector('dl.identity');
        if (!(list instanceof HTMLElement)) {
            throw new Error('The panel rendered no model identity list.');
        }
        return list;
    }

    /** The value the panel shows for one `<dt>` label of the identity list. */
    function identityEntry(label: string): string {
        const term = [...identityList().querySelectorAll('dt')].find(
            (candidate) => normalized(candidate.textContent ?? '') === label,
        );
        if (term === undefined) {
            throw new Error(`The panel rendered no "${label}" entry.`);
        }
        return normalized(term.nextElementSibling?.textContent ?? '');
    }

    async function scoreOnce(): Promise<void> {
        await fireEvent.click(
            screen.getByRole('button', { name: 'Score this window' }),
        );
    }

    it('renders nothing at all without an injected service', async () => {
        const analysis = await analysedDefaultRecord();

        renderPanel(analysis, {
            channelName: SCORED_CHANNEL,
            viewport: ONE_SECOND,
        });

        expect(screen.queryByRole('button')).toBeNull();
        expect(document.querySelector('dl.identity')).toBeNull();
        expect(document.querySelector('table')).toBeNull();
        expect((document.body.textContent ?? '').trim()).toBe('');
    });

    it("scores the committed window and shows the model's own identity and declared contract", async () => {
        const analysis = await analysedDefaultRecord();
        const metadata = loadProbeModelMetadata();
        const engine = createStubEngine();

        renderPanel(analysis, {
            service: panelService(engine),
            channelName: SCORED_CHANNEL,
            viewport: ONE_SECOND,
        });
        await scoreOnce();
        await screen.findByText('Model output per label');

        expect(identityEntry('Model')).toBe(
            `${metadata.modelId}@${metadata.modelVersion}`,
        );
        expect(identityEntry('Task')).toBe(metadata.task);
        expect(identityEntry('Backend')).toBe(engine.backendId);
        expect(identityEntry('Candidate')).toBe(
            candidateIdOf(metadata, analysis, SCORED_CHANNEL, {
                startSample: 0,
                endSample: 360,
            }),
        );
        expect(identityEntry('Window scored')).toBe(
            'lead-b samples [0, 360) = 0s to 1s at 360 Hz',
        );
        expect(identityEntry('Input tensor')).toBe(
            `${metadata.input.name} [${metadata.input.shape.join(', ')}] ${metadata.input.dtype}`,
        );
        expect(identityEntry('Declared output')).toBe(
            `${metadata.output.semantics} (activation ${metadata.output.activation})`,
        );
        expect(identityEntry('Normalization')).toBe(
            metadata.normalization.strategy,
        );
    });

    it('shows one row per declared label with the formatted value and the declared semantics', async () => {
        const analysis = await analysedDefaultRecord();
        const metadata = loadProbeModelMetadata();

        renderPanel(analysis, {
            service: panelService(createStubEngine()),
            channelName: SCORED_CHANNEL,
            viewport: ONE_SECOND,
        });
        await scoreOnce();
        await screen.findByText('Model output per label');

        const rows = [...document.querySelectorAll('tbody tr')];
        expect(rows).toHaveLength(metadata.output.classLabels.length);

        const cells = rows.map((row) =>
            [...row.querySelectorAll('td')].map((cell) =>
                normalized(cell.textContent ?? ''),
            ),
        );
        expect(cells.map((row) => row[0]).sort()).toEqual(
            [...metadata.output.classLabels].sort(),
        );
        cells.forEach((row) => {
            // A four-decimal display of the model's own number, never a claim.
            expect(row[1]).toMatch(/^-?\d+\.\d{4}$/);
            // logits + softmax is the one declared shape that genuinely is a
            // probability; anything else must stay an uncalibrated score.
            expect(row[2]).toBe('predicted-probability');
        });

        expect(screen.getByText(/not a diagnosis/)).toBeTruthy();
        expect((document.body.textContent ?? '').toLowerCase()).not.toContain(
            'confidence',
        );
    });

    it("shows the declared preprocessing assumptions and the model's own provenance limitations", async () => {
        const analysis = await analysedDefaultRecord();
        const metadata = loadProbeModelMetadata();
        const limitations = metadata.provenance.limitations;
        if (limitations === undefined) {
            throw new Error('The probe metadata declares no provenance limitations.');
        }
        const stages = metadata.preprocessingAssumptions.map((entry) => entry.stage);
        expect(stages.length).toBeGreaterThan(0);

        renderPanel(analysis, {
            service: panelService(createStubEngine()),
            channelName: SCORED_CHANNEL,
            viewport: ONE_SECOND,
        });
        await scoreOnce();
        await screen.findByText('Model output per label');

        expect(screen.getByText(limitations)).toBeTruthy();
        const assumptions = screen.getByText(/Declared preprocessing:/);
        stages.forEach((stage) => {
            expect(assumptions.textContent ?? '').toContain(stage);
        });
    });

    it("falls back to the model's first channel when the selected name is unknown", async () => {
        const analysis = await analysedDefaultRecord();
        const metadata = loadProbeModelMetadata();

        renderPanel(analysis, {
            service: panelService(createStubEngine()),
            channelName: 'not-a-channel',
            viewport: ONE_SECOND,
        });
        await scoreOnce();
        await screen.findByText('Model output per label');

        expect(identityEntry('Window scored')).toContain('lead-a');
        expect(identityEntry('Candidate')).toBe(
            candidateIdOf(metadata, analysis, 'lead-a', {
                startSample: 0,
                endSample: 360,
            }),
        );
    });

    it('reports the classified refusal for a window the declared contract does not accept', async () => {
        const analysis = await analysedDefaultRecord();
        const metadata = loadProbeModelMetadata();

        // No viewport: the whole record (3600 samples/channel) is scored, which
        // the probe's declared 360-sample window does not accept. The panel must
        // report the refusal, never resample or pad the window to fit.
        renderPanel(analysis, {
            service: panelService(createStubEngine()),
            channelName: SCORED_CHANNEL,
        });
        await scoreOnce();

        const alert = await screen.findByRole('alert');
        expect(alert.textContent ?? '').toContain('model-compatibility-failure');
        expect(alert.textContent ?? '').toContain(
            String(metadata.expectedWindowSamples),
        );
        expect(document.querySelector('table')).toBeNull();
        expect(document.querySelector('dl.identity')).toBeNull();
        expect((document.body.textContent ?? '').toLowerCase()).not.toContain(
            'confidence',
        );
    });

    it('disables the button and says it is scoring while the engine is still running', async () => {
        const analysis = await analysedDefaultRecord();
        const stub = createStubEngine();
        let release: (() => void) | undefined;
        const deferred: InferenceEngine = {
            backendId: 'deferred',
            run: (metadata, input) =>
                new Promise((resolve, reject) => {
                    release = () => {
                        void stub.run(metadata, input).then(resolve, reject);
                    };
                }),
            dispose: () => Promise.resolve(),
        };

        renderPanel(analysis, {
            service: panelService(deferred),
            channelName: SCORED_CHANNEL,
            viewport: ONE_SECOND,
        });

        await scoreOnce();

        const pending = screen.getByRole('button', { name: 'Scoring…' });
        expect((pending as HTMLButtonElement).disabled).toBe(true);
        expect(document.querySelector('dl.identity')).toBeNull();

        if (release === undefined) {
            throw new Error('The deferred engine was never asked to score.');
        }
        release();

        await screen.findByText('Model output per label');
        expect(
            screen.getByRole('button', { name: 'Score this window' }),
        ).toBeTruthy();
    });
});
