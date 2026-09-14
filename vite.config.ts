// Vite configuration (Phase 7 / ADR-008) — the single config read by both the
// `vite` CLI (dev server + production build) and Vitest (test runner).
//
// `defineConfig` is imported from 'vitest/config' because it is a typed
// superset of Vite's own defineConfig that also understands the `test` block;
// Vite itself simply ignores that unknown key at runtime. Keeping one config
// guarantees that the Svelte plugin is present for every pipeline that has to
// compile `.svelte` files (dev, build, and the jsdom test slices).
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [
        svelte(),
        // Testing-library's Svelte vitest helper (Phase 7 / ADR-008). Its
        // config hook only runs while VITEST is set, so the `vite` dev server
        // and production build ignore it. It prepends the `browser` export
        // condition so `import ... from 'svelte'` inside jsdom slices resolves
        // to Svelte's DOM build (index-client), not its SSR build. autoCleanup
        // is disabled: that mode injects a GLOBAL vitest setup file whose
        // beforeEach/afterEach would also run for the Node-only numeric
        // suites; each jsdom slice instead cleans up explicitly in its own
        // afterEach (see src/presentation/testing/__tests__/svelteStack.test.ts).
        svelteTesting({ autoCleanup: false }),
    ],
    // Phase 10 (ADR-005 worker offload): the inference worker statically imports
    // the probe registration path, which dynamically imports `onnxruntime-web`.
    // That dynamic import makes the worker bundle a code-splitting build, and
    // Rollup forbids the default IIFE worker format for code-split output, so we
    // emit ES-module workers. Vite's `?worker` wrapper then constructs them with
    // `{ type: 'module' }`; the DSP worker is unaffected in behaviour.
    worker: {
        format: 'es',
    },
    build: {
        // The committed probe model is a 543-byte binary; left to Vite's default
        // 4 kB inline limit it would be folded into the worker chunk as a data
        // URL. Keep it a real, separately cacheable `.onnx` asset instead
        // (phase 10, item 5) so the worker streams it via `fetch` in both dev
        // and production. Every other asset keeps the default inline policy.
        assetsInlineLimit: (filePath: string) =>
            filePath.endsWith('.onnx') ? false : undefined,
    },
    test: {
        // Scientific/numeric suites stay on the fast, DOM-free Node
        // environment. Only the presentation test slices mount real Svelte
        // components; those opt into jsdom per file via the
        // `@vitest-environment jsdom` directive at the top of the test (see
        // src/presentation/testing/__tests__/svelteStack.test.ts).
        environment: 'node',
        include: ['src/**/*.test.ts'],
        // Benchmark harness (Phase 9): `vitest bench` runs ONLY the explicit
        // `src/bench/**/*.bench.ts` files. The default bench include would also
        // sweep `*.bench.*`/`*.benchmark.*` outside this folder, and because
        // `test.include` confines `vitest run` to `*.test.ts`, bench files are
        // never part of `npm run check`'s test step. Bench timing is
        // machine-dependent (rules §51) and is deliberately NOT a CI gate.
        benchmark: {
            include: ['src/bench/**/*.bench.ts'],
        },
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html'],
            include: ['src/**/*.ts'],
            exclude: ['src/**/*.test.ts', 'src/main.ts', 'src/**/index.ts'],
        },
    },
});
