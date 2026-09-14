<script lang="ts">
    // Thin, controlled local-dataset picker (Phase 11 / ADR-012).
    //
    // Like the view controls, it is deliberately *thin* and presentational: it
    // owns NO state beyond a transient "dragging" highlight and NO dataset
    // logic. It reports the user's intent upward through callback props:
    //
    // - `<input type="file" multiple>` and a drag-and-drop zone both emit the
    //   selected `File[]` through `onFilesSelected` (the portable base that
    //   works in every browser and is keyboard reachable);
    // - an optional "Open folder" button (only rendered when the parent passes
    //   `onOpenFolder`) reports a request to use the Chromium-only File System
    //   Access directory picker — the parent decides whether the browser
    //   supports it and drives the actual `showDirectoryPicker` call.
    //
    // The parent (`App.svelte`, the service-wired layer) turns a selection into
    // a source, discovers records and re-analyzes — never this component. It
    // therefore holds no dataset/DWT details, mirroring `ViewControls.svelte`.
    interface Props {
        /** Called with the files the user selected or dropped. */
        onFilesSelected: (files: readonly File[]) => void;
        /**
         * Called when the user asks to open a folder through the File System
         * Access picker. Omitted, the "Open folder" button is not rendered.
         */
        onOpenFolder?: (() => void) | undefined;
        /** Disables every control while an ingestion/analysis is in flight. */
        busy?: boolean;
    }

    let {
        onFilesSelected,
        onOpenFolder = undefined,
        busy = false,
    }: Props = $props();

    let dragging = $state(false);

    function emitFiles(files: readonly File[]): void {
        if (files.length > 0) {
            onFilesSelected(files);
        }
    }

    function handleInputChange(event: Event): void {
        const input = event.currentTarget as HTMLInputElement;
        emitFiles(Array.from(input.files ?? []));
        // Clear the value so re-picking the same files fires `change` again.
        input.value = "";
    }

    function handleDragOver(event: DragEvent): void {
        // Required so the browser allows the drop (and shows the copy cursor).
        event.preventDefault();
        dragging = true;
    }

    function handleDragLeave(): void {
        dragging = false;
    }

    function handleDrop(event: DragEvent): void {
        event.preventDefault();
        dragging = false;
        emitFiles(Array.from(event.dataTransfer?.files ?? []));
    }
</script>

<div class="dataset-picker" role="group" aria-label="Local dataset">
    <label class="picker-input">
        <span class="picker-name">Open local WFDB files</span>
        <input
            type="file"
            multiple
            aria-label="Open local WFDB files"
            onchange={handleInputChange}
            disabled={busy}
        />
    </label>

    <div
        class="drop-zone"
        class:dragging
        role="group"
        aria-label="Drop WFDB files here"
        ondragover={handleDragOver}
        ondragleave={handleDragLeave}
        ondrop={handleDrop}
    >
        Drop <code>.hea</code> / <code>.dat</code> / <code>.atr</code> files here
    </div>

    {#if onOpenFolder !== undefined}
        <button
            type="button"
            class="folder-button"
            onclick={onOpenFolder}
            disabled={busy}
        >
            Open folder
        </button>
    {/if}
</div>

<style>
    .dataset-picker {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: 0.5rem 1rem;
        padding: 0.6rem 0.8rem;
        background: #eef2f6;
        border: 1px solid #cbd2d9;
        border-radius: 4px;
    }

    .picker-input {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
    }

    .picker-name {
        font-size: 0.75rem;
        font-weight: 600;
        color: #3c4650;
    }

    .drop-zone {
        display: flex;
        align-items: center;
        min-height: 2.4rem;
        padding: 0.3rem 0.9rem;
        border: 1px dashed #9aa5b1;
        border-radius: 4px;
        background: #fff;
        color: #3c4650;
        font-size: 0.85rem;
    }

    .drop-zone.dragging {
        border-color: #0b6bcb;
        background: #e3f0ff;
        color: #0b2a47;
    }

    .drop-zone code {
        font-size: 0.8rem;
    }

    .folder-button {
        font: inherit;
        padding: 0.25rem 0.7rem;
        border: 1px solid #0b6bcb;
        border-radius: 4px;
        background: #fff;
        color: #0b6bcb;
        cursor: pointer;
    }

    .folder-button:disabled {
        opacity: 0.55;
        cursor: not-allowed;
    }
</style>
