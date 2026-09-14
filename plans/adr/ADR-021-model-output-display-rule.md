# ADR-021 — The model-output view: declared semantics, the scored window, and one application door

Status: Accepted
Date: 2026-09-14
Scope: Phase 18 Part B (item 7) — a **display-only** model-output panel under
`src/presentation/views/inference/`, the application service that feeds it
([`src/application/inference.ts`](../../src/application/inference.ts:1)), and one **optional** injected prop on
[`App.svelte`](../../src/presentation/App.svelte:1) with the composition root injecting the existing
worker-backed engine. Additive: no science, no DSP/DWT, no dataset or parser change, no change to any
ML *semantics* (the engine contract, the input constructor, the compatibility rules and the
interpretation rule are consumed unchanged); no new dependency, prop, script or config; no wall-clock or
pixel assertion (rules §30/§51). Nothing here detects, classifies or thresholds anything: it displays
what a model's own declared metadata says about one window ([ADR-004](ADR-004-onnx-runtime-contract.md:1),
[ADR-013](ADR-013-annotation-display.md:1)).

## Context

[ADR-004](ADR-004-onnx-runtime-contract.md:1) made the ML boundary metadata-first: a model carries a
declared input contract, a declared output contract with its activation and `classLabels`, declared
preprocessing/normalization assumptions and provenance, and
[`interpretPrediction`](../../src/ml/interpret.ts:73) turns a raw prediction into labelled values whose
`semantics` follow **only** from what that metadata declares. Through Phase 17 that slice was exercised
by Node gates and one worker, and displayed nowhere: the app's views displayed *domain* facts (annotations,
navigation, DWT levels). A model output view is the first view whose subject is a model, and that is
where the four hazards below live.

1. **A number without its declared semantics is an invented probability.** The same four-decimal value
   means a predicted probability when the metadata declares probabilities, and an uncalibrated score
   when it declares logits under no activation. A view that formats both the same way, or that silently
   softmaxes logits "so they add up to one", manufactures a claim the model never made — the failure
   [ADR-004](ADR-004-onnx-runtime-contract.md:1) and rules §47/§49 exist to prevent.
2. **The window a model scores is not necessarily the window a user sees.** The committed display
   viewport is a *display* state; a model declares an exact sample window, channel count and sample rate.
   Any gap between the two can be closed by resampling, padding, truncating or re-channelling — each
   fabricating data a machine did not record, and each hiding a genuine incompatibility behind a
   plausible-looking result (rules §16/§17: shape compatibility is not scientific compatibility).
   [ADR-001](ADR-001-core-signal-representation.md:1) adds the sharper form: a sample rate is never
   inferred from an array length.
3. **A view that talks to an engine directly re-opens the dependency direction.** `presentation → 
   application → domain / ml / dsp / datasets / workers` is enforced by review, and the worker-backed
   engine's lifecycle belongs to the composition root (it is constructed in
   [`boot()`](../../src/main.ts:74) and terminated on `pagehide`). A view importing `src/ml/**` or a
   worker would both invert that direction and duplicate orchestration that a service already owns
   (rules §30).
4. **A required prop would change a pinned slice.** The jsdom bootstrap cases render `App.svelte` with
   exactly the props they need; a new *required* prop would edit them, i.e. touch assertions the phase is
   forbidden from touching ([ADR-020](ADR-020-edf-adapter-refusals.md:1)'s "the WFDB path is pinned"
   discipline, applied to the App bootstrap).

Constraints:

- **Display only.** No threshold, no detection, no renamed label, and never the word "confidence"
  (rules §47/§49; [ADR-004](ADR-004-onnx-runtime-contract.md:1)).
- **Classified refusals only.** Every gap is one of the existing classified codes — `invalid-input`,
  `model-compatibility-failure`, `inference-failure` — and no unclassified throw reaches the view.
- **One definition per rule** (rules §30): one time→sample mapping
  ([`sampleWindowOfTime`](../../src/domain/sampling.ts:170)), one `ModelInput` constructor
  ([`buildModelInput`](../../src/ml/input.ts:61)), one compatibility rule
  ([`describeInputCompatibilityProblems`](../../src/ml/engine.ts:101)), one interpretation rule
  (`interpretPrediction`).
- **The engine is the caller's.** The service never disposes it, so one worker-backed engine can be
  scored through repeatedly (the rule [`runExperiment.ts`](../../src/application/runExperiment.ts:1)
  already follows).
- **The gates assert state, text and refusals — never a pixel or a wall clock** (rules §51).

## Decision

### (a) The declared semantics decide the word, per score

Each score carries the exact `semantics` the metadata honestly supports, and the view renders that word
beside the value. The mapping is the existing `interpretPrediction` rule, never a second one:

| Declared output contract | Word shown | Rejected alternative |
| --- | --- | --- |
| `probabilities` (activation `none`) | `predicted-probability` | — (already probabilities) |
| `logits` with `softmax`/`sigmoid` | `predicted-probability` | Formatting the raw logit and calling it a probability |
| `logits` with activation `none` | `model-score` | Applying an undeclared softmax in the view, so the numbers "look like" probabilities |
| `model-scores` | `model-score` | Renaming an uncalibrated score a probability |
| any of the above | the metadata's own `classLabels`, verbatim | Renaming labels clinically, adding a threshold, or printing "confidence" |

Ordering is `interpretPrediction`'s: descending by score with a deterministic tie-break, so two renders
of one description cannot disagree. The caption additionally states, in the view's own words, that a
development probe is not a clinical classifier — a statement about the *display*, never about the ECG
([ADR-013](ADR-013-annotation-display.md:1)'s precedent).

### (b) The displayed window **is** the scored window

[`scoreModelOutput`](../../src/application/inference.ts:207) realises exactly one half-open sample window
and says which one it was:

```
committed viewport (or the whole record)
  → sampleWindowOfTime                 (the domain's one time→sample mapping, ADR-001)
  → channel.data.slice(start, end)     (a copy; the analysed signal is never touched)
  → buildModelInput                    (windowId = candidateIdOf(...), so the tensor and the
                                        description name the same candidate)
  → describeInputCompatibilityProblems (re-asserted pre-execution boundary)
  → engine.run → interpretPrediction
  → a frozen, display-ready description
```

The rules that make it honest:

- **A mismatch is refused, never reshaped.** A declared sample rate, channel count or window length the
  realised window does not satisfy is `model-compatibility-failure` — including a declared dtype this
  service will not coerce physical-unit samples into. **Rejected:** resampling (fabricating samples, and a
  DSP concern, [`src/dsp/resample.ts`](../../src/dsp/resample.ts:1)), zero-padding or truncating to the
  declared length, and scoring a silent sub-window.
- **A window with no samples is `invalid-input`,** refused before anything runs. **Rejected:** widening
  the window until a sample fits.
- **The channel is named, including its fallback.** An unknown or omitted channel name falls back to the
  first channel — the same fallback the views use — and the description names the channel actually scored,
  so the fallback is visible rather than silent. **Rejected:** scoring another channel without saying so.
- **The window is stated in both units it exists in:** the exact `[startSample, endSample)` range and its
  seconds, at the record's own declared sample rate.
- **A refusal is a first-class display state.** The panel renders it in a `role="alert"`, and renders no
  table and no identity list beside it. This is also the honest **boot state**: the committed probe
  declares 360 samples over 1 channel at 360 Hz, while the default record is 3600 samples, so a user who
  scores the whole record sees the classified refusal — the correct display, not a defect to be worked
  around.
- **Scoring is user-initiated.** One explicit action scores the currently analysed window; a
  re-analysis, a record switch or a navigation commit does not re-run the model, so the panel never
  becomes a hidden pipeline stage.

### (c) One application door: the engine is injected, and the view renders a description

[`ModelOutputService`](../../src/application/inference.ts:339) holds an injected
[`InferenceEngine`](../../src/ml/engine.ts:23) plus the one
[`ModelMetadata`](../../src/domain/ml.ts:116) it may run, and returns the display-ready description;
[`src/application/inference.ts`](../../src/application/inference.ts:1) is therefore the only path from a
view to an engine.

- **The view owns no rule.** No window arithmetic, no score conversion, no label text: labels and
  semantics come from the description, and the view only formats the number for reading.
- **One optional prop.** `App.svelte` takes `modelOutput` the way it takes `prepareLocalDataset`; absent,
  the markup is unchanged, so the pinned jsdom bootstrap slice is untouched.
- **The composition root keeps ownership.** [`boot()`](../../src/main.ts:74) constructs
  `new ModelOutputService(inference.engine, PROBE_MODEL_METADATA)` over the *same* worker-backed handle it
  already terminates on `pagehide`, using the browser-safe frozen metadata
  ([`probeAsset.ts`](../../src/ml/onnx/probeAsset.ts:1)) — no new dependency, no Node-only import in the
  web bundle.
- **The description is frozen**, so a view cannot mutate the account it was handed.

**Rejected alternatives:** the view importing `src/ml/**` or a worker directly (inverted dependency
direction plus duplicated orchestration); a **required** prop (it would edit the pinned bootstrap cases);
the service creating or owning its own engine (it would own a lifecycle the composition root already
manages, and would need a second worker).

### (d) Two deliberate deviations from the plan's wording, recorded here rather than glossed

1. **A domain relocation, forced by the dependency direction.** The plan's "Do not touch" list forbids
   `src/domain/**`, but `src/application/**` may not import from `src/presentation/**`, and the one
   time→sample mapping lived in the time-series view. [`TimeSpan`](../../src/domain/sampling.ts:142),
   [`SampleWindow`](../../src/domain/sampling.ts:150) and
   [`sampleWindowOfTime`](../../src/domain/sampling.ts:170) were therefore **moved** — not copied — from
   [`views/timeSeries/geometry.ts`](../../src/presentation/views/timeSeries/geometry.ts:1) into
   [`src/domain/sampling.ts`](../../src/domain/sampling.ts:1), with `geometry.ts` re-exporting them
   (`export type TimeViewport = TimeSpan`) so every existing import path is unchanged and the existing
   sampling/geometry tests are unedited and green. **Rejected:** importing a view module from the
   application layer (dependency inversion), and restating the mapping inside `inference.ts`
   (rules §30 — one definition of the rule, not two).
2. **The service re-asserts the compatibility boundary.** After `buildModelInput` has accepted the
   window, `scoreModelOutput` calls `describeInputCompatibilityProblems` on the input it just built and
   refuses if anything is reported. **Rejected:** trusting the constructor alone, which would put the
   last word on compatibility in a helper rather than at the application door. For a freshly built input
   this is expected to be empty by construction: it is a guard against future edits, not a path that
   normally fires.

### (e) The existing paths are untouched

`src/dsp/**`, the DWT views, the dataset adapters and the pinned jsdom App cases are unchanged; the panel
is a **new** view rather than a re-purposing of the time-series or DWT views, and with the prop absent
`App.svelte` renders exactly what it rendered before item 7.

## Consequences

- The ML slice is now **reachable and displayed without becoming a claim**: for the first time a view
  shows a model's output, and every string it shows is either the model's own declared fact or a statement
  about the display itself.
- A refusal is a first-class display state, so the honest boot state (the 360-sample probe against the
  3600-sample default record) is visible instead of being hidden by a resize.
- Rules §16/§17 hold structurally: compatibility is decided by the metadata's declared numbers, and a
  mismatch is a classified failure rather than a shape-compatible tensor dressed up as a result.
- **Gate split.** A **Node** gate over the service
  ([`inference.test.ts`](../../src/application/__tests__/inference.test.ts:1), 17 tests) proves the
  declared-semantics mapping, the refusal codes, the deterministic ordering and the description's
  contents; a **jsdom** gate over the view
  ([`ModelOutputPanel.test.ts`](../../src/presentation/views/inference/__tests__/ModelOutputPanel.test.ts:1),
  7 tests) proves wiring only — identity/labels/scores rendered for a stub engine, the classified refusal
  rendered in `role="alert"` for an incompatible window, the in-flight state disable-and-relabel, and
  **nothing at all** rendered without an injected service — with every expected string derived from the
  metadata accessor rather than hard-coded, and `'confidence'` asserted absent in both the success and the
  refusal paths.
- Known limits, deliberately deferred: the panel is verified in a real browser only by the phase's manual
  pass, which is an observation and never a gate ([ADR-017](ADR-017-real-data-verification.md:1)); the
  probe is a development artifact, and the honest refusal it produces on a whole-record window is
  recorded as a manual-pass expectation rather than smoothed over.
- The seam addition is documented in architecture §I and §M item 18, with a decision-register line.
- Item 7 gate: **66 test files / 838 tests / 181 modules**, `npm run check` exit 0.

## References

- [ADR-001](ADR-001-core-signal-representation.md:1) — the sampling contract; a rate is never inferred
  from an array length.
- [ADR-004](ADR-004-onnx-runtime-contract.md:1) — the ONNX Runtime contract and the metadata-first rule.
- [ADR-013](ADR-013-annotation-display.md:1) — "display a declared fact, never a claim", the precedent
  this view follows.
- [ADR-017](ADR-017-real-data-verification.md:1) — the manual pass is an observation; opt-in real-data
  gates skip rather than soften.
- [ADR-019](ADR-019-worker-message-delivery-contract.md:1) — the delivery contract of the worker channel
  the injected engine runs on.
- [ADR-020](ADR-020-edf-adapter-refusals.md:1) — Part B's first increment and the same additive
  discipline (one seam, classified refusals, no science change).
- [`src/application/inference.ts`](../../src/application/inference.ts:1),
  [`src/presentation/views/inference/ModelOutputPanel.svelte`](../../src/presentation/views/inference/ModelOutputPanel.svelte:1).
- [`plans/phase-18-plan.md`](../phase-18-plan.md:375) — Design decision 8 and Item 7.
- Architecture §I (browser execution architecture), §M item 18, decision register.
