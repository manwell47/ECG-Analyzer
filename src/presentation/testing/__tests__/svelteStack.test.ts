// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import ProbeButton from '../ProbeButton.svelte';

/**
 * Svelte presentation stack smoke slice (Phase 7 / ADR-008).
 *
 * Runs under jsdom via the `// @vitest-environment jsdom` file directive:
 * the global default is Node, so every DOM slice opts into jsdom explicitly
 * (there is no global `environmentMatchGlobs` anymore — it is deprecated in
 * Vitest 3). It proves the whole adopted stack end to end: the Svelte plugin
 * compiles a real `.svelte` file under Vitest, testing-library renders it
 * into a DOM, and a dispatched event reaches a runes-mode handler. Node-only
 * suites are untouched: `cleanup` runs only here, in this explicit
 * `afterEach` (the testing-library `autoCleanup` global setup is disabled for
 * that reason).
 */
describe('Svelte presentation stack (jsdom slice)', () => {
    afterEach(() => {
        cleanup();
    });

    it('renders a runes-mode component into the jsdom document', () => {
        render(ProbeButton, { props: { label: 'clicks' } });

        const button = screen.getByRole('button');
        expect(button).toBeTruthy();
        expect(button.textContent).toBe('clicks: 0');
    });

    it('reacts to a dispatched click through Svelte runes state', async () => {
        render(ProbeButton, { props: { label: 'clicks' } });

        const button = screen.getByRole('button');
        await fireEvent.click(button);
        expect(button.textContent).toBe('clicks: 1');
    });

    it('starts each test from a clean document (explicit cleanup works)', () => {
        render(ProbeButton, { props: { label: 'clicks' } });

        const button = screen.getByRole('button');
        expect(button.textContent).toBe('clicks: 0');
        expect(screen.queryAllByRole('button')).toHaveLength(1);
    });
});
