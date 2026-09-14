# AGENTS.md — Medical Signal AI Platform

## 0. STATUS OF THIS DOCUMENT

This document defines the non-negotiable engineering principles, architectural constraints, quality requirements and development protocol for this repository.

These rules have higher priority than convenience, implementation speed, aesthetic preferences, or assumptions made during coding.

The project must be treated as a serious scientific software prototype, not as a disposable AI demo.

When a task conflicts with these rules, preserve these rules unless the project owner explicitly overrides them.

---

# 1. PROJECT MISSION

Build a technically rigorous, modular and reproducible platform for biomedical signal processing and machine-learning experimentation.

The system is intended for:

* signal acquisition/import
* signal inspection
* preprocessing
* multiscale signal analysis
* feature extraction
* machine-learning inference
* visualization
* experimentation
* validation
* reproducibility

The system is NOT a medical diagnostic device.

Never represent model predictions as medical diagnoses, clinical recommendations, treatment recommendations, or definitive conclusions about a patient.

All patient-facing or potentially clinical interpretations must be avoided unless explicitly designed, validated and regulated as such.

The application must use terminology such as:

* model prediction
* classification
* signal quality
* anomaly score
* probability
* confidence
* experimental result

rather than:

* diagnosis
* disease confirmed
* patient has X
* medical decision

unless the context is explicitly discussing the underlying scientific literature.

---

# 2. CORE ENGINEERING PRINCIPLE

The application is fundamentally a SIGNAL PROCESSING system with machine learning integrated into it.

Machine learning must NEVER be treated as a black box glued onto a UI.

The conceptual architecture is:

```
SIGNAL
   ↓
ACQUISITION / IMPORT
   ↓
VALIDATION
   ↓
PREPROCESSING
   ↓
MULTISCALE / DWT ANALYSIS
   ↓
FEATURE / REPRESENTATION GENERATION
   ↓
ML / ONNX INFERENCE
   ↓
POSTPROCESSING
   ↓
VISUALIZATION
   ↓
EXPERIMENT / EVALUATION
```

Every stage must remain conceptually and technically separable.

Do not collapse these stages into a single function, component or opaque pipeline.

---

# 3. ARCHITECTURAL RULE: SEPARATION OF CONCERNS

The codebase must maintain clear boundaries between:

## Domain

Scientific concepts and data structures.

Examples:

* Signal
* SamplingRate
* Channel
* Window
* WaveletDecomposition
* FeatureVector
* Prediction
* ModelMetadata
* EvaluationResult

Domain logic must not depend on UI frameworks.

## Signal Processing

DSP algorithms and deterministic transformations.

Examples:

* filtering
* normalization
* resampling
* detrending
* segmentation
* DWT
* inverse DWT
* feature extraction

DSP modules must be deterministic wherever mathematically possible.

## Machine Learning

Responsibilities include:

* model loading
* model metadata
* tensor preparation
* inference
* postprocessing
* model compatibility validation

The ML layer must not know about UI components.

## Application / orchestration

Responsible for coordinating domain, DSP and ML.

It must not contain presentation logic.

## Presentation

Responsible exclusively for:

* visualization
* interaction
* state presentation
* user controls
* errors
* accessibility

UI components must never implement DSP algorithms directly.

---

# 4. DATA FLOW MUST BE EXPLICIT

Every transformation of a signal must have an explicit representation.

Never pass anonymous arrays through multiple layers when their semantic meaning matters.

Bad:

```
process(data)
```

Preferred conceptual model:

```
process(ecgSignal)
```

where the object contains enough metadata to understand:

* number of channels
* sample rate
* duration
* units
* source
* channel names
* preprocessing state

Scientific data must carry provenance whenever practical.

---

# 5. UNITS ARE SACRED

Never silently mix:

* Hz
* kHz
* seconds
* milliseconds
* samples
* mV
* V
* normalized amplitude

Every conversion must be explicit.

Sampling frequency must NEVER be inferred from array length.

Time-domain values and sample indices must never be confused.

When converting between physical units and array indices, use explicit utility functions.

---

# 6. SAMPLING THEORY

Any operation involving sampling must respect signal-processing fundamentals.

Do not:

* arbitrarily resample signals
* use undocumented interpolation
* downsample without anti-aliasing considerations
* alter sample rates silently
* perform frequency-domain analysis without considering the sampling frequency

When a transformation changes the effective sampling rate, that fact must be represented explicitly.

---

# 7. DWT IS A FIRST-CLASS COMPONENT

Wavelet processing is not a decorative visualization feature.

The DWT implementation must be isolated, testable and scientifically inspectable.

The system must explicitly represent:

* mother wavelet
* decomposition level
* approximation coefficients
* detail coefficients
* boundary handling
* signal length handling
* reconstructed signal where applicable

Never hide important DWT configuration in UI components.

Never hard-code unexplained wavelet parameters.

Every scientifically relevant parameter must have a defined source.

---

# 8. REPRODUCIBILITY

Any experiment must be reproducible.

The system should be capable of recording:

* dataset
* record identifier
* channel
* sampling frequency
* preprocessing parameters
* wavelet
* decomposition level
* feature configuration
* model identifier
* model version
* inference configuration
* software version

Never allow experiments to depend on undocumented implicit state.

---

# 9. MACHINE LEARNING / ONNX

ONNX models must be treated as versioned scientific artifacts.

Every model must have metadata describing at minimum:

* model name
* model version
* input shape
* input dtype
* expected sampling rate
* expected channel configuration
* preprocessing assumptions
* output labels
* training dataset
* training methodology when known
* model limitations

The application must validate model compatibility before inference.

Never assume that a model's tensor shape alone proves compatibility.

Never silently adapt incompatible data.

An incompatible model must fail explicitly with a useful error.

---

# 10. TRAINING AND INFERENCE MUST BE SEPARATED

Training code and inference code must be conceptually independent.

The runtime application must NEVER contain hidden training logic.

Training artifacts should be reproducible independently of the frontend.

The ONNX runtime is an inference environment, not the training environment.

If training is required, it belongs in a dedicated pipeline.

---

# 11. NO DATA LEAKAGE

This is a scientific project.

Dataset leakage is considered a critical defect.

Do not:

* normalize using information from the test set
* split individual windows from the same patient across train/test without justification
* tune preprocessing parameters on the test set
* choose a model based on test performance and report that same result as final evaluation

When datasets contain subjects/patients, prefer subject-level separation where scientifically appropriate.

Evaluation methodology must be documented.

---

# 12. VALIDATION OVER APPEARANCE

A feature is not considered complete because:

* it looks correct
* the UI works
* the model returns a prediction
* a demo signal produces plausible output

A feature is complete only when its underlying behavior can be validated.

Every important scientific function must have tests.

Examples:

* DWT decomposition/reconstruction
* filtering
* resampling
* segmentation
* feature extraction
* tensor generation
* model output interpretation

Prefer numerical assertions over screenshot-based assertions.

---

# 13. NUMERICAL CORRECTNESS

Signal-processing code must prioritize mathematical correctness over cleverness.

Avoid unnecessary abstractions around numerical operations.

Document algorithms when implementation details are non-obvious.

For every non-trivial algorithm, make the following clear:

* input
* output
* assumptions
* units
* edge cases
* numerical limitations

Do not silently swallow NaN, Infinity, empty arrays or invalid sample rates.

Invalid numerical states must be detected early.

---

# 14. PERFORMANCE

The UI must remain responsive during:

* signal loading
* DWT computation
* filtering
* feature extraction
* ONNX inference
* large dataset processing

CPU-heavy operations must not block the main UI thread unnecessarily.

Use workers/background execution where appropriate.

Do not optimize prematurely.

First establish:

1. correctness
2. measurability
3. profiling
4. optimization

Never sacrifice scientific correctness for small performance gains without explicit justification.

---

# 15. MEMORY AND DATA OWNERSHIP

Biomedical signals can become large.

Avoid unnecessary copies of large arrays.

Avoid repeatedly converting:

```
Array → TypedArray → Array → Tensor → Array
```

without reason.

Make ownership and lifecycle of large numerical buffers understandable.

Release resources explicitly when the underlying runtime requires it.

---

# 16. ERROR HANDLING

Errors must be explicit, classified and actionable.

At minimum distinguish:

* invalid input
* unsupported format
* incompatible sampling rate
* malformed signal
* numerical failure
* model loading failure
* model compatibility failure
* inference failure
* visualization failure

Never use generic:

```
"Something went wrong"
```

when a more useful explanation is available.

Never silently recover from scientifically meaningful errors.

---

# 17. LOGGING

Logs must help reproduce problems.

Useful diagnostic context includes:

* signal length
* sample rate
* channel
* preprocessing configuration
* model identifier
* execution stage
* error type

Never log sensitive patient-identifying information.

---

# 18. PRIVACY BY DEFAULT

Biomedical data must be considered sensitive.

The default architecture should favor local processing.

Do not transmit biomedical signals externally unless the user explicitly enables such behavior.

Do not introduce analytics, telemetry or cloud AI dependencies that cause biomedical data to leave the machine without explicit documentation and consent.

Prefer:

```
local data
    ↓
local processing
    ↓
local inference
```

whenever technically feasible.

---

# 19. UI PRINCIPLES

The UI should communicate scientific information, not merely decorate it.

Visualizations must preserve:

* temporal relationships
* amplitude relationships
* frequency relationships
* channel identity
* units
* scale

Never manipulate visual scale in a way that makes signals appear more significant than they are.

When displaying probabilities or confidence values, make clear what they represent.

Do not imply clinical certainty.

The UI should make it easy to inspect intermediate stages:

```
raw signal
↓
filtered signal
↓
DWT
↓
features
↓
model input
↓
model output
```

The user should be able to understand what the system actually did.

---

# 20. SCIENTIFIC TRANSPARENCY

Important transformations should be inspectable.

Whenever practical, allow users to inspect:

* raw signal
* processed signal
* wavelet coefficients
* segmentation
* extracted features
* model output

Avoid opaque "AI magic".

The application should answer:

```
What data entered the model?
What preprocessing occurred?
Which model was used?
What did the model output?
How should that output be interpreted?
What are the limitations?
```

---

# 21. TESTING PYRAMID

Implement testing at several levels:

### Unit tests

For deterministic scientific functions.

### Integration tests

For:

```
signal → preprocessing → DWT → features → inference
```

### Regression tests

For known signals and known outputs.

### UI tests

Only where UI behavior is important.

Do not replace scientific tests with visual UI tests.

---

# 22. GOLDEN DATA

Maintain small deterministic reference signals for testing.

Examples:

* impulse
* sine wave
* multi-frequency signal
* constant signal
* synthetic ECG morphology
* noisy signal

Expected mathematical properties must be recorded.

When changing DSP code, compare against these references.

---

# 23. DEPENDENCY DISCIPLINE

Do not add dependencies casually.

Before adding a dependency:

1. determine whether the functionality already exists
2. evaluate bundle size
3. evaluate maintenance quality
4. evaluate browser/runtime compatibility
5. evaluate licensing
6. evaluate whether the dependency is actually necessary

Prefer mature, focused dependencies.

Avoid dependency accumulation.

---

# 24. TYPE SAFETY

Use the strongest practical type system available.

Scientific data structures must be explicitly typed.

Avoid:

* `any`
* implicit coercion
* magic objects
* stringly-typed state
* unvalidated external input

External data must be validated at boundaries.

---

# 25. ARCHITECTURAL STABILITY

Do not rewrite working architecture merely because another approach looks fashionable.

Before introducing a major architectural change, identify:

* existing dependency graph
* current behavior
* migration cost
* regression risk
* measurable benefit

Prefer incremental evolution.

---

# 26. BACKWARDS COMPATIBILITY

Existing working functionality must not be broken casually.

When modifying an existing module:

1. understand current behavior
2. identify consumers
3. preserve public contracts where possible
4. add regression tests
5. modify incrementally

Do not perform broad rewrites without architectural justification.

---

# 27. NO PLACEHOLDER ENGINEERING

Do not leave fake implementations disguised as finished functionality.

Forbidden:

* fake model predictions
* hardcoded metrics presented as computed metrics
* random data masquerading as biomedical data
* mocked scientific output in production paths
* placeholder algorithms silently used in real analysis

Mocks are acceptable only inside tests and development tooling, and must be clearly isolated.

---

# 28. DATASET PROVENANCE

Every external biomedical dataset must have documented provenance.

Record:

* official dataset name
* source
* version
* license
* access requirements
* preprocessing performed
* known limitations

Do not redistribute datasets when licensing does not permit it.

Never commit large biomedical datasets into the repository unless licensing and repository strategy explicitly allow it.

---

# 29. DOCUMENTATION

The repository must explain:

* architecture
* scientific pipeline
* development setup
* model format
* datasets
* preprocessing
* testing
* reproducibility
* limitations
* privacy considerations

Documentation should describe the actual implementation.

Never write documentation for functionality that does not exist.

---

# 30. DEVELOPMENT PROTOCOL

For any non-trivial task, follow this sequence:

## STEP 1 — INSPECT

Read the relevant existing code before modifying it.

Understand:

* architecture
* dependencies
* data flow
* tests
* current implementation

Do not guess.

## STEP 2 — MODEL

Form a precise mental model of the problem.

Identify:

* affected layers
* invariants
* data structures
* edge cases
* compatibility requirements

## STEP 3 — PLAN

Before implementation, define the smallest coherent change that satisfies the requirement.

Prefer incremental changes.

## STEP 4 — IMPLEMENT

Implement cleanly and explicitly.

Do not mix unrelated refactors with feature work.

## STEP 5 — VALIDATE

Run:

* type checking
* linting
* unit tests
* integration tests where applicable
* build

## STEP 6 — REVIEW

Inspect the resulting diff for:

* unintended changes
* scientific errors
* duplicated logic
* hidden assumptions
* dead code
* regressions

## STEP 7 — DOCUMENT

Update documentation whenever behavior, architecture or scientific assumptions changed.

---

# 31. AGENT BEHAVIOR

The coding agent must act as a senior software engineer and scientific computing engineer.

Do not optimize for producing the largest amount of code.

Optimize for:

```
correctness
maintainability
reproducibility
scientific validity
explicitness
testability
```

When uncertain:

* inspect the code
* inspect documentation
* inspect types
* inspect tests
* inspect package APIs
* state assumptions

Never invent APIs, model formats, dataset properties or scientific facts.

---

# 32. BEFORE CODING

For complex tasks, first provide:

### Understanding

What the existing system currently does.

### Proposed architecture

What will change and where.

### Risks

Potential scientific, architectural or compatibility risks.

### Validation

How the implementation will be proven correct.

Then implement.

Do not ask unnecessary questions when the repository already contains enough information to determine the answer.

---

# 33. DEFINITION OF DONE

A task is complete only when:

* implementation works
* architecture remains coherent
* scientific assumptions are explicit
* types are correct
* errors are handled
* tests exist where appropriate
* existing functionality remains intact
* build succeeds
* documentation reflects reality

"Works on my machine" is not considered sufficient validation.

---

# 34. ABSOLUTE PROHIBITIONS

Never:

* fabricate scientific results
* fabricate model performance
* claim clinical validity without evidence
* hide preprocessing
* silently modify units
* silently change sampling rates
* silently change model inputs
* swallow numerical errors
* introduce cloud processing of biomedical data without explicit justification
* mix UI and DSP logic
* put scientific constants in arbitrary UI components
* remove tests merely to make the build pass
* disable type checking to bypass an implementation problem
* rewrite the architecture simply because implementation became inconvenient

---

# 35. FINAL PRINCIPLE

The quality standard is:

```
"Could another competent engineer reproduce,
 inspect, test and challenge what this software does?"
```

If the answer is no, the implementation is not finished.
