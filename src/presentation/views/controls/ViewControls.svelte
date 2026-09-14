<script lang="ts">
    // Thin interaction controls (Phase 7 item #11).
    //
    // A channel + viewport toolbar. It is deliberately *thin* and presentational:
    //
    // - it owns NO science configuration and holds NO state of its own — the
    //   parent (`App.svelte`, the component wired to the application service)
    //   owns the selection and passes it down through the `$props` below;
    // - the channel names and viewport presets come from the parent, which
    //   derives them ONLY from the domain-typed `AnalysisResult` the service
    //   returned (see `./presets.ts` for the window derivation);
    // - every user action is reported upward through a callback prop; the
    //   parent turns it into the `channelName` / `viewport` props of the two
    //   canvas views. "Re-run analysis" is likewise delegated to the parent so
    //   the actual service call happens in the service-wired layer, never here.
    import type { ViewportOption } from "./presets";

    interface Props {
        /** Channel names to choose from (an analyzed signal's channels). */
        channelNames: readonly string[];
        /** Currently selected channel name (must be one of `channelNames`). */
        selectedChannel: string;
        /** Called when the user picks another channel. */
        onChannelChange: (channelName: string) => void;
        /** Selectable viewport presets (full record first). */
        viewportOptions: readonly ViewportOption[];
        /** Index into `viewportOptions` of the current window. */
        selectedViewportIndex: number;
        /** Called when the user picks another viewport preset. */
        onViewportChange: (index: number) => void;
        /** Called when the user asks to re-run the analysis via the service. */
        onRerun: () => void;
        /** Disables the controls while a (re-)analysis is in flight. */
        busy?: boolean;
    }

    let {
        channelNames,
        selectedChannel,
        onChannelChange,
        viewportOptions,
        selectedViewportIndex,
        onViewportChange,
        onRerun,
        busy = false,
    }: Props = $props();

    function handleChannelChange(event: Event): void {
        onChannelChange((event.currentTarget as HTMLSelectElement).value);
    }

    function handleViewportChange(event: Event): void {
        onViewportChange(
            Number((event.currentTarget as HTMLSelectElement).value),
        );
    }
</script>

<div class="view-controls" role="group" aria-label="View controls">
    <div class="view-control">
        <span class="view-control-name">Channel</span>
        <select
            class="view-control-input"
            aria-label="Channel"
            value={selectedChannel}
            onchange={handleChannelChange}
            disabled={busy}
        >
            {#each channelNames as name (name)}
                <option value={name}>{name}</option>
            {/each}
        </select>
    </div>

    <div class="view-control">
        <span class="view-control-name">Viewport</span>
        <select
            class="view-control-input"
            aria-label="Viewport"
            value={String(selectedViewportIndex)}
            onchange={handleViewportChange}
            disabled={busy}
        >
            {#each viewportOptions as option, index (index)}
                <option value={String(index)}>{option.label}</option>
            {/each}
        </select>
    </div>

    <button
        type="button"
        class="rerun-button"
        onclick={onRerun}
        disabled={busy}
    >
        Re-run analysis
    </button>
</div>

<style>
    .view-controls {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: 0.5rem 1rem;
        padding: 0.6rem 0.8rem;
        background: #eef2f6;
        border: 1px solid #cbd2d9;
        border-radius: 4px;
    }

    .view-control {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
    }

    .view-control-name {
        font-size: 0.75rem;
        font-weight: 600;
        color: #3c4650;
    }

    .view-control-input {
        font: inherit;
        padding: 0.2rem 0.4rem;
        border: 1px solid #cbd2d9;
        border-radius: 4px;
        background: #fff;
        color: #0b2a47;
    }

    .rerun-button {
        font: inherit;
        padding: 0.25rem 0.7rem;
        border: 1px solid #0b6bcb;
        border-radius: 4px;
        background: #0b6bcb;
        color: #fff;
        cursor: pointer;
    }

    .rerun-button:disabled,
    .view-control-input:disabled {
        opacity: 0.55;
        cursor: not-allowed;
    }
</style>
