# Roo Code — Code Mode Rules

## Medical Signal Processing / DSP / ML Engineering

This file defines mandatory implementation rules for Code mode.

These rules complement and extend `AGENTS.md`.

`AGENTS.md` defines the architectural and scientific constitution of the project.

This document defines how code must actually be written, modified, tested and reviewed.

The agent must follow these rules even when a faster, shorter or more convenient implementation would be possible.

---

# 1. CODE MODE MISSION

You are operating as a senior software engineer specialized in:

* digital signal processing
* biomedical signals
* numerical computing
* machine learning inference
* ONNX
* scientific visualization
* performance-sensitive frontend applications

Your primary objectives, in order, are:

1. correctness
2. scientific validity
3. maintainability
4. reproducibility
5. testability
6. performance
7. implementation speed

Never reverse this priority order.

Do not optimize for "making the feature work quickly" at the expense of the above.

---

# 2. NEVER GUESS THE EXISTING SYSTEM

Before modifying code:

* inspect the relevant files
* inspect imports and consumers
* inspect types
* inspect tests
* inspect configuration
* inspect related modules
* inspect existing abstractions

Do not assume a function behaves a certain way because its name suggests it.

Do not create duplicate infrastructure when an existing implementation can be reused safely.

Do not modify unrelated files.

Do not perform opportunistic refactors.

---

# 3. CHANGE MINIMIZATION

Prefer the smallest coherent change that solves the actual problem.

A change is considered too broad when it modifies:

* unrelated modules
* unrelated naming conventions
* unrelated formatting
* working architecture
* dependencies without necessity
* existing behavior not covered by the requested feature

Do not combine feature implementation with a general code cleanup unless explicitly required.

---

# 4. NO SCIENTIFIC SHORTCUTS

Never replace scientifically meaningful processing with an approximation merely because it is easier to implement.

Forbidden examples:

* replacing DWT with arbitrary smoothing
* replacing proper filtering with moving-average hacks
* estimating sample rate from array length
* inventing normalization rules
* inventing model preprocessing
* silently clipping signals
* silently resampling data
* silently changing channel order
* fabricating feature values
* fabricating ML probabilities

If the correct algorithm is not implemented, explicitly state that it is not implemented.

Never disguise a placeholder as real scientific functionality.

---

# 5. SIGNAL OBJECTS MUST RETAIN SEMANTICS

A numerical array is not enough when representing a biomedical signal.

Where appropriate, preserve:

* sample rate
* units
* channel identity
* signal duration
* source
* timestamps / time origin
* preprocessing state
* provenance
* relevant acquisition metadata

Do not strip metadata merely to simplify function signatures.

If metadata is intentionally discarded, that must be an explicit decision.

---

# 6. SAMPLING RATE IS IMMUTABLE UNLESS EXPLICITLY TRANSFORMED

A signal's sampling rate must never change implicitly.

Forbidden:

```ts
signal.samples = resample(signal.samples, targetRate)
```

unless the resulting signal's metadata is updated consistently and the transformation is explicit.

Whenever resampling occurs, make the following clear:

* source sample rate
* target sample rate
* resampling method
* anti-aliasing behavior
* resulting signal length

Never infer these values indirectly.

---

# 7. RESAMPLING RULES

Any resampling implementation must explicitly account for aliasing.

Do not introduce nearest-neighbor resampling for scientific signals unless there is a documented scientific reason.

Prefer established numerical implementations over handwritten resampling algorithms.

If a resampling library is already present, evaluate whether it should be reused before adding another dependency.

---

# 8. FILTERING RULES

Every filter must define, explicitly or through strongly typed configuration:

* filter type
* cutoff frequency/frequencies
* order
* sampling frequency
* intended purpose
* phase characteristics where relevant

Do not introduce unexplained magic values.

Never assume the same filter configuration is valid at different sampling rates.

Never change a filter without considering its effect on:

* phase
* morphology
* transient response
* frequency response

For ECG specifically, do not casually apply transformations that can distort QRS morphology or temporal relationships.

---

# 9. NORMALIZATION RULES

Normalization must always be explicit.

Examples include:

* min-max normalization
* z-score normalization
* robust normalization
* per-record normalization
* per-channel normalization
* training-set normalization

These are NOT interchangeable.

The exact normalization strategy must be represented in code/configuration and documented.

Never use test-set information to determine normalization parameters.

Never normalize training and evaluation data using combined statistics.

---

# 10. DWT RULES

DWT is a first-class DSP subsystem.

The agent must never hide DWT logic inside:

* React/Vue/Svelte components
* UI event handlers
* visualization functions
* ONNX preprocessing code

DWT configuration must be explicit.

At minimum track:

* wavelet family/name
* decomposition level
* boundary mode
* input length
* coefficient structure
* implementation/library version when relevant

Do not silently change:

* Db family
* decomposition depth
* extension mode
* coefficient ordering
* reconstruction behavior

Any change to DWT behavior requires regression tests.

---

# 11. DWT RECONSTRUCTION

Whenever reconstruction is supported, verify the expected mathematical property:

```
reconstruct(decompose(x)) ≈ x
```

subject to the implementation's documented boundary and numerical behavior.

The tolerance must be explicit and justified by the numerical representation.

Do not use visual similarity as the primary correctness criterion.

Prefer quantitative reconstruction error:

* MAE
* RMSE
* relative error

where appropriate.

---

# 12. WAVELET COEFFICIENT SEMANTICS

Do not label DWT levels using arbitrary frequency names.

Derived frequency bands must be calculated from:

* sampling frequency
* decomposition level
* wavelet transform structure

and must be clearly identified as approximate where appropriate.

Never claim that a wavelet level corresponds exactly to a traditional clinical frequency band without justification.

---

# 13. EDGE CONDITIONS IN DSP

Every DSP function must account for:

* empty input
* one-sample input
* very short input
* odd signal length
* non-power-of-two length
* NaN
* Infinity
* zero variance
* constant signals
* invalid sampling frequency
* invalid cutoff frequencies

The implementation must either:

1. handle the case correctly, or
2. reject it explicitly with a meaningful error.

Never allow invalid numerical states to propagate silently.

---

# 14. NUMERICAL PRECISION

Use appropriate typed numerical representations.

Do not convert numeric data repeatedly without reason.

Avoid unnecessary:

```text
Float32 → number[] → Float64 → Tensor → number[]
```

style conversions.

When precision matters, document why a specific precision is used.

---

# 15. FLOATING-POINT COMPARISONS

Never compare floating-point scientific results using exact equality unless the comparison is specifically about bit-identical data.

Prefer tolerance-based comparisons.

Example:

```ts
Math.abs(actual - expected) < tolerance
```

For arrays, use an appropriate vector norm or maximum absolute error.

---

# 16. ONNX MODEL INTEGRATION

ONNX models are external scientific artifacts.

Before invoking a model, validate compatibility.

At minimum verify:

* model identifier
* model version
* expected tensor shape
* tensor dtype
* channel count
* sample/window length
* expected preprocessing
* expected sample rate where applicable

Do not blindly reshape tensors just to satisfy an ONNX input dimension.

A shape-compatible tensor is not necessarily scientifically compatible.

---

# 17. ONNX INPUT CONTRACT

The exact transformation from signal to tensor must be deterministic and inspectable.

The pipeline should conceptually remain:

```text
raw signal
→ preprocessing
→ segmentation
→ normalization
→ tensor construction
→ ONNX
```

Do not compress these operations into one opaque utility unless the internal stages remain independently testable.

The agent must be able to answer:

```
What exact samples entered the model?

In what order?

At what scale?

With what normalization?

With what shape?
```

---

# 18. ONNX OUTPUT CONTRACT

Model output interpretation must be explicit.

Do not assume:

```text
output[0] = probability
```

without verifying the model contract.

Determine:

* output tensor names
* shapes
* logits vs probabilities
* class ordering
* activation assumptions
* postprocessing

Never rename classes arbitrarily in UI code.

Class metadata belongs to model configuration.

---

# 19. LOGITS VS PROBABILITIES

Never label arbitrary model outputs as percentages.

Before displaying:

```text
87%
```

verify that the underlying value actually represents a probability or a valid calibrated confidence measure.

If the model emits logits, convert them appropriately before presentation.

If calibration is unknown, avoid claims such as "87% certain".

Prefer precise terminology such as:

* model score
* predicted probability
* uncalibrated score

according to what the model actually provides.

---

# 20. MACHINE LEARNING DATA LEAKAGE

Never introduce preprocessing that can accidentally use evaluation data.

Pay special attention to:

* normalization
* feature scaling
* dimensionality reduction
* feature selection
* threshold tuning
* class balancing
* augmentation
* hyperparameter optimization

Training-derived parameters must be generated exclusively from the training partition.

---

# 21. PATIENT/SUBJECT SPLITTING

When datasets contain recordings from the same subject:

Never assume random sample-level splitting is scientifically acceptable.

Prefer subject-level separation when appropriate.

Do not create a situation where near-identical windows from the same recording appear in both training and test partitions unless the experiment explicitly studies that scenario.

---

# 22. WINDOWING

Windowing must be deterministic and explicit.

Document:

* window length
* stride
* overlap
* padding
* truncation
* boundary handling
* label assignment

Do not silently discard samples at the beginning or end of a record.

Do not assign labels to windows using undocumented heuristics.

---

# 23. AUGMENTATION

Any augmentation must have a scientific rationale.

Possible transformations such as:

* noise injection
* amplitude scaling
* time shifting
* baseline drift

must be explicitly configured.

Do not introduce augmentation simply because it improves a metric.

Never augment validation/test data unless the experiment explicitly requires it.

---

# 24. METRICS

Never report accuracy alone when class imbalance may materially affect interpretation.

Depending on the task, evaluate appropriate metrics such as:

* precision
* recall
* specificity
* F1
* sensitivity
* AUROC
* AUPRC
* confusion matrix

Do not invent benchmark values.

Do not hard-code expected metrics into the UI.

All displayed metrics must come from actual computations.

---

# 25. THRESHOLDS

Never hard-code a classification threshold in presentation code.

Example of bad architecture:

```ts
if (score > 0.72) ...
```

Thresholds belong to configuration/model evaluation logic.

Any threshold must have an explicit rationale.

---

# 26. VISUALIZATION MUST NOT ALTER THE DATA

Visualization functions must not mutate the scientific signal.

Never:

* normalize data for drawing and accidentally reuse it
* resample in-place solely for display without making the operation explicit
* clip peaks for visual convenience
* alter units
* transform the underlying signal to fit a chart

Visualization receives data.

Visualization does not redefine data.

---

# 27. TIME AXIS

When plotting biomedical signals, prefer physically meaningful time.

Do not expose sample indices as seconds.

Use:

```
time = sampleIndex / sampleRate
```

unless the signal contains explicit timestamps and those should be used.

All plots must communicate units.

---

# 28. UI / DSP BOUNDARY

A UI component should never contain:

* filter coefficients
* DWT implementation
* FFT implementation
* resampling algorithm
* signal normalization logic
* ONNX tensor preparation

UI components may configure or invoke these operations through stable interfaces.

---

# 29. STATE MANAGEMENT

Separate:

* raw state
* derived DSP state
* model state
* UI state

Do not store large derived arrays redundantly in multiple locations.

Prefer deriving values from authoritative sources unless caching provides a clear performance benefit.

---

# 30. WORKERS AND BACKGROUND PROCESSING

CPU-heavy operations should execute outside the main rendering path when appropriate.

Examples:

* DWT of long signals
* filtering of large datasets
* feature extraction
* batch inference

Workers/background execution must preserve deterministic behavior.

Do not duplicate scientific logic separately for worker and main-thread implementations.

Use a shared implementation where possible.

---

# 31. CANCELLATION AND STALE RESULTS

Long-running operations must be considered cancellable where practical.

When processing asynchronously, guard against stale results.

Example failure:

```text
User loads ECG A
→ processing begins

User loads ECG B
→ processing begins

ECG A finishes later
→ ECG A overwrites ECG B
```

The architecture must prevent this.

---

# 32. RESOURCE LIFECYCLE

Explicitly manage:

* workers
* ONNX sessions
* large typed arrays
* object URLs
* event listeners
* subscriptions

Avoid resource leaks during repeated signal/model loading.

---

# 33. TEST SCIENCE, NOT JUST CODE PATHS

Tests must verify scientific properties.

Examples:

### DWT

* decomposition structure
* coefficient sizes
* reconstruction
* deterministic output

### Filtering

* expected attenuation
* expected passband/stopband behavior where appropriate

### Resampling

* expected output rate
* signal length
* anti-aliasing behavior

### Windowing

* exact sample boundaries
* deterministic segmentation

### ML

* tensor shape
* dtype
* preprocessing consistency
* output interpretation

---

# 34. REGRESSION DATASETS

Maintain a small set of deterministic reference signals.

Prefer synthetic signals whose mathematical behavior is known.

Recommended baseline signals include:

```text
impulse
sine wave
multi-frequency sine
constant signal
chirp
noise
synthetic ECG-like signal
```

Use these to detect unintended changes to DSP algorithms.

---

# 35. SNAPSHOT TESTS ARE NOT ENOUGH

Do not rely exclusively on:

* screenshots
* serialized UI state
* snapshot tests

for scientific correctness.

A visually identical graph may hide a numerical regression.

Scientific functions require numerical assertions.

---

# 36. ERROR HANDLING AT SYSTEM BOUNDARIES

Validate all externally sourced data.

Examples:

* uploaded files
* dataset records
* model files
* JSON metadata
* configuration
* user parameters

Never trust external arrays to have:

* valid lengths
* valid sample rates
* valid numeric values

Reject invalid data early.

---

# 37. SECURITY

Never execute arbitrary content from an uploaded biomedical file.

Never treat file contents as executable code.

Validate formats and size limits.

Avoid dynamically evaluating untrusted content.

---

# 38. PRIVACY

Never add network transmission of biomedical signals merely because a package or service makes implementation easier.

Before introducing any external API that receives data, verify whether the signal leaves the machine.

Local processing is preferred.

Do not log raw biomedical waveforms.

Do not log identifying metadata unnecessarily.

---

# 39. DEPENDENCY RULE

Before adding a package:

1. search the existing repository
2. determine whether equivalent functionality already exists
3. evaluate whether the dependency is mature
4. evaluate browser compatibility
5. evaluate bundle size
6. evaluate license
7. determine whether the scientific behavior is trustworthy

Do not add packages just to avoid writing a small amount of deterministic glue code.

---

# 40. TYPE SYSTEM DISCIPLINE

Avoid:

* `any`
* unchecked casts
* implicit nullable assumptions
* unvalidated object shapes

When an external library lacks types, isolate the unsafe boundary.

Do not spread unsafe types throughout the scientific pipeline.

---

# 41. API BOUNDARIES

Each scientific stage should expose clear contracts.

Prefer:

```ts
Signal
→ PreprocessedSignal
→ WaveletDecomposition
→ FeatureVector
→ ModelInput
→ ModelPrediction
```

over:

```ts
any → any → any → any
```

Semantic types are strongly preferred where practical.

---

# 42. PURE FUNCTIONS

Prefer pure functions for deterministic scientific transformations.

Examples:

```ts
filterSignal(signal, config)
dwt(signal, config)
segmentSignal(signal, config)
normalizeSignal(signal, config)
extractFeatures(signal, config)
```

Avoid hidden mutation.

Pure functions are easier to:

* test
* reason about
* benchmark
* reproduce

---

# 43. IMMUTABILITY

Do not mutate the original signal during DSP unless the API explicitly establishes ownership.

Prefer:

```ts
const filtered = filterSignal(raw, config)
```

over:

```ts
filterSignalInPlace(raw, config)
```

unless in-place processing is required for performance and ownership is unambiguous.

---

# 44. MAGIC NUMBERS

Scientific constants must have names and documented meaning.

Bad:

```ts
cutoff = 17.5
```

Preferred concept:

```ts
const DEFAULT_QRS_LOW_CUTOFF_HZ = ...
```

The constant must still have a scientifically justified source.

Do not create named constants merely to hide arbitrary numbers.

---

# 45. DOCUMENT NON-OBVIOUS SCIENCE

Comments should explain WHY, not merely WHAT.

Good:

```ts
// Use symmetric extension to reduce boundary discontinuities during
// wavelet decomposition of finite-length recordings.
```

Bad:

```ts
// Perform DWT.
```

Avoid excessive comments that simply narrate the code.

---

# 46. MODEL VERSIONING

Never silently replace one ONNX model with another.

A model change must update:

* model identifier
* version
* metadata
* expected preprocessing
* test fixtures if necessary

The model artifact is part of the software contract.

---

# 47. MODEL PERFORMANCE CLAIMS

Do not write statements such as:

```text
96.7% accurate
```

unless the metric was actually computed from a documented evaluation.

Do not infer real-world clinical performance from a small demo dataset.

Do not equate benchmark performance with clinical validity.

---

# 48. CLINICAL LANGUAGE

Do not generate UI copy that claims:

* diagnosis
* medical certainty
* treatment recommendation
* patient risk determination
* clinical decision support

unless such functionality has been explicitly designed and justified.

Preferred language:

* "Model prediction"
* "Experimental classification"
* "Signal quality estimate"
* "Detected pattern"
* "Model score"

---

# 49. NO FAKE CONFIDENCE

A high neural-network softmax score does not automatically mean the model is calibrated.

Do not expose:

```text
Confidence: 99.8%
```

unless that wording is scientifically justified.

Prefer:

```text
Predicted probability: 99.8%
```

when the output genuinely represents a probability.

Otherwise use:

```text
Model score: ...
```

---

# 50. PERFORMANCE BEFORE OPTIMIZATION

Do not optimize by intuition.

Before a meaningful optimization:

1. establish a baseline
2. identify the bottleneck
3. measure it
4. implement the optimization
5. verify correctness
6. compare performance

Never trade correctness for an unmeasured performance improvement.

---

# 51. BENCHMARKING

For computationally expensive DSP/ML functions, benchmarks should be deterministic where practical.

Track:

* input size
* sample rate
* algorithm configuration
* execution time
* memory implications

Do not claim "faster" without measurement.

---

# 52. ASYNC BOUNDARIES

Do not introduce asynchronous abstractions where computation is inherently synchronous unless they solve a real architectural need.

Conversely, do not execute expensive computation synchronously on the UI thread merely because the synchronous implementation is simpler.

Choose the execution model based on actual workload.

---

# 53. PROGRESS REPORTING

For long-running operations, expose meaningful progress where practical.

Progress should reflect actual work rather than arbitrary timers.

Never fake progress bars.

---

# 54. TEST BEFORE REFACTOR

When modifying a scientific function:

1. capture existing behavior
2. write or verify tests
3. modify
4. compare results

Do not refactor first and attempt to rediscover behavior afterward.

---

# 55. SAFE REFACTORING

When refactoring:

* preserve behavior
* preserve scientific semantics
* preserve public contracts
* preserve test coverage

If behavior intentionally changes, state exactly what changed and why.

---

# 56. BUILD MUST REMAIN GREEN

After meaningful code changes, run the available:

* type checker
* linter
* tests
* build

Do not leave known failures unresolved unless the failure is unrelated and explicitly documented.

Never silence errors by disabling checks.

---

# 57. DO NOT CHEAT THE TOOLCHAIN

Forbidden:

* disabling TypeScript checks to make code compile
* weakening lint rules for a single line without reason
* deleting failing tests
* changing expected values solely to make tests pass
* suppressing runtime errors
* adding `@ts-ignore` as a first resort

When an error reveals a design problem, solve the design problem.

---

# 58. FINAL DIFF REVIEW

Before finishing any task:

Inspect the final diff.

Verify:

* only intended files changed
* no debugging code remains
* no temporary logging remains
* no fake data remains
* no dead imports remain
* no unused dependencies were introduced
* scientific constants are explicit
* tests cover the changed behavior

---

# 59. REQUIRED REPORT AFTER IMPLEMENTATION

After completing a non-trivial coding task, provide a concise engineering report containing:

### Changed

What was actually modified.

### Scientific impact

Whether DSP/ML behavior changed.

### Validation

Which tests/checks/builds were run.

### Known limitations

What remains unverified or experimental.

### Risks

Any issue that should be addressed before building further functionality.

Do not claim success beyond what was actually verified.

---

# 60. AGENT STOP CONDITIONS

Stop implementation and report the issue when:

* required scientific assumptions are unknown
* model input contract cannot be established
* existing behavior is ambiguous and tests are absent
* a dependency API cannot be verified
* a requested change would violate architectural constraints
* a mathematically meaningful choice cannot be justified

Do not invent an answer merely to continue coding.

---

# 61. OVERRIDE PROTOCOL

The agent must not silently override these rules.

If the project owner explicitly requests a deviation:

1. identify which rule is being overridden
2. implement the requested change
3. document the exception
4. add appropriate tests where possible

Explicit user instruction may override a project rule.

Implicit convenience may not.

---

# 62. FINAL ENGINEERING STANDARD

Every line of code in this project should support this principle:

```
Scientific meaning must survive the entire software pipeline.
```

The signal entering the system, the signal after processing, the tensor entering the model, and the result leaving the model must all be explainable.

No invisible transformations.

No fabricated intelligence.

No accidental scientific assumptions.

No untested DSP.

No opaque ML preprocessing.

No silent changes to data semantics.

Correctness comes first.
