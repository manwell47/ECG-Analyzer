// @vitest-environment jsdom
/**
 * Interaction-control toolbar slice (Phase 7 item #11).
 *
 * `ViewControls.svelte` is deliberately thin and fully controlled: it holds no
 * state and calls no service — every user action is reported upward through a
 * callback prop for the parent (`App.svelte`) to turn into the `channelName` /
 * `viewport` props of the two canvas views, and "Re-run analysis" is delegated
 * to the parent so the actual service call stays in the service-wired layer.
 *
 * These jsdom tests therefore assert only *interaction behaviour*: that the
 * toolbar renders the passed options, that changing a combobox reports the
 * chosen channel name / viewport index upward, that clicking the button invokes
 * `onRerun`, and that `busy` disables everything. They never touch DSP numerics
 * or drawn pixels (that is the Node/geometry gate); no canvas is involved here
 * at all, so no `getContext` stub is needed.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import ViewControls from "../ViewControls.svelte";
import type { ViewportOption } from "../presets";
import { viewportPresets } from "../presets";
import { createSamplingInfo } from "../../../../domain/sampling";

const CHANNEL_NAMES = ["lead-a", "lead-b"];

/** Five presets: the full record plus four equal 1 s quarters of a 4 s record. */
function makeViewportOptions(): readonly ViewportOption[] {
    return viewportPresets(createSamplingInfo(2, 0), 8);
}

describe("ViewControls (jsdom slice)", () => {
    afterEach(() => {
        cleanup();
    });

    it("renders the channel + viewport comboboxes and the re-run button", () => {
        render(ViewControls, {
            props: {
                channelNames: CHANNEL_NAMES,
                selectedChannel: "lead-a",
                onChannelChange: vi.fn(),
                viewportOptions: makeViewportOptions(),
                selectedViewportIndex: 0,
                onViewportChange: vi.fn(),
                onRerun: vi.fn(),
            },
        });

        // Accessible combobox names come from aria-label (the visible caption
        // spans are not <label>s, so they do not double-up the accessible name).
        const channelSelect = screen.getByRole("combobox", { name: "Channel" });
        const viewportSelect = screen.getByRole("combobox", { name: "Viewport" });

        const channelOptions = channelSelect.querySelectorAll("option");
        expect(Array.from(channelOptions).map((option) => option.value)).toEqual(
            CHANNEL_NAMES,
        );
        // The selectable viewport list matches the passed presets, full first.
        const viewportOptions = makeViewportOptions();
        const viewportChoices = viewportSelect.querySelectorAll("option");
        expect(viewportChoices).toHaveLength(viewportOptions.length);
        expect(viewportChoices[0]?.textContent).toBe("Full record");
        expect(
            Array.from(viewportChoices).map((option) => option.textContent),
        ).toEqual(viewportOptions.map((option) => option.label));

        expect(
            screen.getByRole("button", { name: "Re-run analysis" }),
        ).toBeTruthy();
    });

    it("reports a channel selection upward with the chosen name", () => {
        const onChannelChange = vi.fn();
        render(ViewControls, {
            props: {
                channelNames: CHANNEL_NAMES,
                selectedChannel: "lead-a",
                onChannelChange,
                viewportOptions: makeViewportOptions(),
                selectedViewportIndex: 0,
                onViewportChange: vi.fn(),
                onRerun: vi.fn(),
            },
        });

        fireEvent.change(screen.getByRole("combobox", { name: "Channel" }), {
            target: { value: "lead-b" },
        });

        expect(onChannelChange).toHaveBeenCalledTimes(1);
        expect(onChannelChange).toHaveBeenCalledWith("lead-b");
    });

    it("reports a viewport selection upward as the preset index", () => {
        const onViewportChange = vi.fn();
        render(ViewControls, {
            props: {
                channelNames: CHANNEL_NAMES,
                selectedChannel: "lead-a",
                onChannelChange: vi.fn(),
                viewportOptions: makeViewportOptions(),
                selectedViewportIndex: 0,
                onViewportChange,
                onRerun: vi.fn(),
            },
        });

        fireEvent.change(screen.getByRole("combobox", { name: "Viewport" }), {
            target: { value: "2" },
        });

        expect(onViewportChange).toHaveBeenCalledTimes(1);
        expect(onViewportChange).toHaveBeenCalledWith(2);
    });

    it("reports the re-run request upward through onRerun", () => {
        const onRerun = vi.fn();
        render(ViewControls, {
            props: {
                channelNames: CHANNEL_NAMES,
                selectedChannel: "lead-a",
                onChannelChange: vi.fn(),
                viewportOptions: makeViewportOptions(),
                selectedViewportIndex: 0,
                onViewportChange: vi.fn(),
                onRerun,
            },
        });

        fireEvent.click(
            screen.getByRole("button", { name: "Re-run analysis" }),
        );

        expect(onRerun).toHaveBeenCalledTimes(1);
    });

    it("disables every control while a (re-)analysis is busy", () => {
        render(ViewControls, {
            props: {
                channelNames: CHANNEL_NAMES,
                selectedChannel: "lead-a",
                onChannelChange: vi.fn(),
                viewportOptions: makeViewportOptions(),
                selectedViewportIndex: 0,
                onViewportChange: vi.fn(),
                onRerun: vi.fn(),
                busy: true,
            },
        });

        const channelSelect = screen.getByRole("combobox", {
            name: "Channel",
        }) as HTMLSelectElement;
        const viewportSelect = screen.getByRole("combobox", {
            name: "Viewport",
        }) as HTMLSelectElement;
        const rerunButton = screen.getByRole("button", {
            name: "Re-run analysis",
        }) as HTMLButtonElement;

        expect(channelSelect.disabled).toBe(true);
        expect(viewportSelect.disabled).toBe(true);
        expect(rerunButton.disabled).toBe(true);
    });
});
