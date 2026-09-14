// Svelte configuration (Phase 7 / ADR-008).
//
// `vitePreprocess` keeps the plain-TypeScript + CSS pipeline used across the
// repo: it enables `<script lang="ts">` type stripping and any future CSS
// pre-processing without pulling extra tooling into the build. The Svelte
// compiler itself is wired through the `@sveltejs/vite-plugin-svelte` plugin
// declared in `vite.config.ts`, which is shared by the `vite` dev/build CLI and
// Vitest (jsdom test slices render real components).
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
    preprocess: vitePreprocess(),
};
