/// <reference types="vite/client" />
/// <reference types="svelte" />

/**
 * Ambient module type declarations (Phase 7 / ADR-008).
 *
 * - `vite/client` supplies `import.meta.env`, `*.module.css` and friends.
 * - `svelte` surfaces the `declare module '*.svelte'` ambient that ships inside
 *   `node_modules/svelte/types/index.d.ts` (its default export is typed via
 *   `LegacyComponentType`). That lets `tsc --noEmit` resolve `.svelte` imports
 *   as opaque component modules. svelte-check performs the real per-file
 *   component type checking; this reference only makes plain TypeScript
 *   compilation aware that a `.svelte` file is an importable module.
 */
