<script lang="ts">
    // Svelte 5 runes-mode stack probe (Phase 7 / ADR-008).
    //
    // The smallest component that exercises the whole presentation test path:
    // vite-plugin-svelte compilation under Vitest, runes reactivity ($props and
    // $state), and a DOM event handler dispatched through testing-library.
    // Items #8-#11 replace this probe with the real application views; it is
    // deliberately kept DOM-trivial and side-effect free.
    interface Props {
        label: string;
    }

    let { label }: Props = $props();
    let clicks = $state(0);

    function increment(): void {
        clicks += 1;
    }
</script>

<button type="button" onclick={increment}>
    {label}: {clicks}
</button>
