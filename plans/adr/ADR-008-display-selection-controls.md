# ADR-008 — Display Channel/Viewport Selection & View Controls

Status: Accepted
Date: 2026-09-04
Scope: Presentation layer (Phase 7 item #11): how the user chooses which
analyzed channel and which time window the canvas views draw, and how that
choice is wired to the application service.

## Context

Phase 7 delivers the first real browser presentation. Item #9 added a canvas
time-series view and item #10 a canvas DWT coefficient view, both driven purely
by domain-typed results ([`AnalysisResult`](../../src/application/analysis.ts:87))
returned by the application service ([`RecordAnalysisService`](../../src/application/analysis.ts:204)).
Item #11 asks for thin interaction controls to select the channel and viewport
shown in those two views.

Three governing constraints shape the decision:

- **Dependency direction and science ownership.** `presentation → application →
  domain / dsp / datasets / workers`; the UI never owns science configuration
  and never reaches into DSP internals. Configuration lives one layer up in
  [`src/application/defaults.ts`](../../src/application/defaults.ts:1).
- **The analysis is always full-record over every channel.**
  [`RecordAnalysisOptions`](../../src/application/analysis.ts:58) carries no
  channel or viewport fields, so a channel/window choice cannot be an analysis
  parameter — it can only be a *display* choice over the single returned result.
- **Views are display-only and never mutate data** (items #9/#10); their captions
  and figure titles repeat the channel identity and window.
- **UI tests are interaction tests.** The jsdom slices assert behavior (which
  image/caption is shown, how often the service is asked to analyze), never
  numerical correctness — that gate stays in the pure, Node-level tests.

The Svelte presentation stack (Svelte 5 runes + `@testing-library/svelte` in
jsdom) was adopted in Phase 7 item #7, which reserved **ADR-008** for the
presentation decision; this record is that ADR, focused on the interaction /
display-selection decision item #11 introduced.

### Considered alternative

An earlier item-#10 sketch rendered *every* channel as its own DWT canvas (a
per-channel `#each` over `result.decomposition.channels`). That duplicates the
lane legend per channel, multiplies canvases, and gives the two sibling views no
shared notion of "the selected channel", making consistent channel/channel-2
switching awkward.

## Decision

- **Selection is a pure display concern.** The controls never change what is
  analyzed: `service.analyze(initialOptions)` always covers the whole record and
  every channel, and the channel/viewport controls only pick which channel and
  which time window of the returned `AnalysisResult` the views draw.
- **One selected channel feeds both views.** [`App.svelte`](../../src/presentation/App.svelte:1)
  (the only component wired to the service) owns the selection and renders the
  *same* selected channel through the time-series view and the DWT coefficient
  view — superseding item #10's per-channel DWT `#each` loop. Switching the
  Channel combobox therefore updates both figures together.
- **The toolbar is a thin, fully controlled child.**
  [`ViewControls.svelte`](../../src/presentation/views/controls/ViewControls.svelte:1)
  owns no state, makes no service call and contains no science configuration. It
  receives `channelNames`, `selectedChannel`, `viewportOptions`,
  `selectedViewportIndex` plus callback props (`onChannelChange`,
  `onViewportChange`, `onRerun`) and a `busy` flag, and reports every
  interaction upward; the parent turns the callbacks into the
  `channelName`/`viewport` props of the two canvas views.
- **Viewport presets come from a pure module fed only by sampling facts.**
  [`viewportPresets`](../../src/presentation/views/controls/presets.ts:42) builds
  the selectable windows from the signal's own [`SamplingInfo`](../../src/domain/sampling.ts:18)
  and sample count only — index 0 is always "Full record", followed by
  `DEFAULT_VIEWPORT_SEGMENTS = 4` equal contiguous sub-windows. Every
  duration/edge conversion goes through the domain ([`durationSecOf`](../../src/domain/sampling.ts:52));
  no hardcoded durations and no sample arithmetic live in the module.
- **Stale selections can never reach the views.** [`App.svelte`](../../src/presentation/App.svelte:117)
  validates the stored channel name against the resolved result and falls back
  to the first channel, mirroring each view's own unknown-channel fallback; the
  viewport index is clamped to the option list.
- **"Re-run analysis" re-invokes the service, not the view layer.** The button's
  handler calls [`loadDefaultAnalysis()`](../../src/presentation/App.svelte:67),
  which asks `service.analyze(initialOptions)` again with the *same* options —
  the literal wiring [`defaults.ts`](../../src/application/defaults.ts:15)
  anticipated for "a future 're-analyze the default record' control". The actual
  service call therefore happens only in the service-wired layer.
- **Views keep their display-only contract.** Each canvas view accepts a
  `channelName?` and a `viewport?` ([`TimeViewport`](../../src/presentation/views/timeSeries/geometry.ts:31),
  `{startSec, durationSec}`) and maps the window onto samples/coefficient
  indices with its own pure helpers; both render the same
  `t = X.XX s → Y.YY s` window caption so the two figures always agree.

## Consequences

- Consistent, single-selector interaction: one Channel + one Viewport choice
  drives both figures; there is a single source of truth for "the selected
  channel" in the app component.
- Clean separation is preserved: science configuration never moves into
  presentation, the viewport/geometry math stays in pure Node-tested helpers,
  and `ViewControls` remains trivially testable as a controlled component.
- Re-runs are reproducible and observable: they use the identical canonical
  options the bootstrap used, so a jsdom test can spy on `service.analyze` and
  assert call count and arguments.
- The display-selection vocabulary (channel name + time viewport) now exists
  once in the app and is shared by both canvas views, ready for future
  pan/zoom or channel-affinity features to reuse.

## References

- Phase 7 checklist items #9/#10/#11 and the Svelte-stack note
  ([`plans/phase-7-handoff.md`](../phase-7-handoff.md:80))
- [`src/presentation/App.svelte`](../../src/presentation/App.svelte:1) — selection
  owner + the only component wired to the service
- [`src/presentation/views/controls/ViewControls.svelte`](../../src/presentation/views/controls/ViewControls.svelte:1)
  and [`src/presentation/views/controls/presets.ts`](../../src/presentation/views/controls/presets.ts:1)
- [`src/application/analysis.ts`](../../src/application/analysis.ts:58)
  ([`RecordAnalysisOptions`](../../src/application/analysis.ts:58) has no
  channel/viewport fields) and
  [`src/application/defaults.ts`](../../src/application/defaults.ts:41)
  (canonical options; single source of truth)
- [`src/domain/sampling.ts`](../../src/domain/sampling.ts:52) (`durationSecOf`) —
  the only time/duration definition in the codebase (ADR-001)
- [`src/presentation/views/timeSeries/geometry.ts`](../../src/presentation/views/timeSeries/geometry.ts:31)
  (`TimeViewport`) and the pure view helpers it shares with the DWT view
- jsdom interaction slices: [`App.test.ts`](../../src/presentation/__tests__/App.test.ts:1),
  [`ViewControls.test.ts`](../../src/presentation/views/controls/__tests__/ViewControls.test.ts:1),
  [`presets.test.ts`](../../src/presentation/views/controls/__tests__/presets.test.ts:1)
- ADR-001 (signal/sampling conventions), ADR-003 (DWT contract), ADR-006
  (dataset abstraction) — domain facts the controls are derived from
