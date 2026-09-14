/**
 * Minimal ambient declarations for the File System Access API pieces the
 * browser ingestion glue uses (Phase 11 / ADR-012, architecture §J).
 *
 * The TypeScript DOM lib already ships the handle *interfaces*
 * (`FileSystemHandle` / `FileSystemDirectoryHandle` / `FileSystemFileHandle`)
 * and their `getFile()` accessor, but it omits two pieces of the shipping API
 * the browser-local ingestion path needs:
 *
 * 1. `FileSystemDirectoryHandle.values()` — the async entry iterator used to
 *    walk a directory the user picked. The DOM lib's directory interface only
 *    declares `getDirectoryHandle` / `getFileHandle` / `removeEntry` /
 *    `resolve`, none of which enumerates a directory whose entry names are not
 *    already known.
 * 2. `showDirectoryPicker()` — the global entry point for the optional
 *    "Open folder" progressive enhancement (Chromium/Edge only).
 *
 * This file has no top-level `import`/`export`, so it is a global script and
 * the declarations below merge into the DOM lib's global scope (a matching
 * interface name is merged, never shadowed). The project keeps its DOM-only
 * `lib` and adds **no** dependency or `tsconfig` change (plan Item 4); a full
 * File System Access type package would be a heavier fix for two small shapes.
 *
 * Availability is a runtime concern, not a type-system one: callers must gate
 * `showDirectoryPicker` behind a `typeof` feature test (see
 * [`fileIngestion.ts`](./fileIngestion.ts:1)). The declaration only states the
 * shape a supporting browser provides.
 */

interface FileSystemDirectoryHandle {
    /**
     * Iterate the directory's entries (files and sub-directories). Shipping
     * Chromium/Edge implement this; it is absent from the DOM lib's interface.
     */
    values(): AsyncIterableIterator<FileSystemFileHandle | FileSystemDirectoryHandle>;
}

/** Options for {@link showDirectoryPicker}; only the read-only subset is used. */
interface DirectoryPickerOptions {
    /** Where the picker opens; a hint only. */
    startIn?: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';
    /** Permission mode; ingestion only ever reads, so `'read'` is requested. */
    mode?: 'read' | 'readwrite';
    /** Optional app-defined picker identity. */
    id?: string;
}

/**
 * Show the native directory picker. Browser-only and optional: feature test
 * with `typeof showDirectoryPicker === 'function'` before calling.
 */
declare function showDirectoryPicker(
    options?: DirectoryPickerOptions,
): Promise<FileSystemDirectoryHandle>;
