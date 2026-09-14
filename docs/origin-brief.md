# ARCHITECT INITIALIZATION — ECG LAB

You are the **Principal Software Architect and Senior Scientific Computing Engineer** for this repository.

Before doing anything else:

1. Read `AGENTS.md`.
2. Read `.roo/rules-code/01-medical-engineering.md`.
3. Treat both files as binding project constraints.
4. Inspect the existing repository thoroughly before proposing implementation changes.

Do not duplicate those documents in your response.

Your task is to establish a stable, scientifically defensible architecture that future Code-mode agents can implement incrementally.

---

# 1. PRODUCT DEFINITION

We are evolving the existing project into a:

# ECG Signal Processing & AI Analysis Laboratory

The product is a **browser-first web application**.

The target execution model is:

```text
Browser
│
├── Scientific UI
│
├── Web Workers
│
├── DSP
│
├── DWT
│
└── ONNX Runtime Web
       │
       ├── WASM / CPU
       └── WebGPU when appropriate
```

The default architecture must be:

**local-first and privacy-preserving.**

Biomedical signal data should remain on the user's machine whenever technically feasible.

A backend/server is NOT required for the core processing pipeline.

Do not introduce a backend merely because it would simplify implementation.

---

# 2. EXISTING PROJECT CONTINUITY

This project originates from an existing DWT + ONNX signal-processing application.

The current repository is valuable existing work.

Do not assume it should be rewritten.

Your first responsibility is to determine:

* what can be reused
* what should be isolated
* what should be refactored
* what should eventually be replaced
* what should remain untouched

The goal is to evolve the existing system rather than start a parallel application unnecessarily.

---

# 3. REPOSITORY AUDIT

Do not write application code yet.

Inspect the repository thoroughly.

Determine:

* framework
* language
* build system
* package manager
* application entry points
* state management
* existing DSP modules
* existing DWT implementation
* existing ONNX implementation
* visualization stack
* worker architecture
* data loading
* persistence
* tests
* CI
* configuration
* error handling
* performance-sensitive code
* current domain models
* existing abstractions

Read implementations rather than inferring behavior from filenames.

Identify the real data flow.

---

# 4. AUDIT SIGIL DWT COMPONENTS

Give special attention to the existing DWT and signal-processing infrastructure.

For each relevant module determine:

* scientific responsibility
* input semantics
* output semantics
* numerical behavior
* dependencies
* test coverage
* reuse potential
* architectural coupling

Preserve valuable DSP work whenever possible.

Do not replace an existing implementation merely because another library is more fashionable.

If replacement is recommended, explain the technical/scientific reason.

---

# 5. PRODUCT ARCHITECTURE

The target system should conceptually follow:

```text
Signal acquisition/import
        ↓
Signal validation
        ↓
Preprocessing
        ↓
DWT / multiscale analysis
        ↓
Segmentation
        ↓
Feature / representation generation
        ↓
Model input construction
        ↓
ONNX inference
        ↓
Postprocessing
        ↓
Scientific visualization
        ↓
Experiment / evaluation
```

Each stage must remain independently understandable and testable.

Do not create one monolithic "analyzeECG()" pipeline.

---

# 6. CORE ARCHITECTURAL BOUNDARIES

Establish explicit boundaries between:

## Domain

Scientific concepts and semantic data structures.

## DSP

Signal transformations and numerical processing.

## ML

Model artifacts, tensor preparation, inference and prediction interpretation.

## Application

Workflow orchestration.

## Presentation

Visualization and interaction.

The dependency direction must prevent:

* UI → direct DSP implementation
* UI → direct ONNX tensor manipulation
* DSP → framework-specific UI code
* Domain → frontend framework
* model metadata → chart components

Equivalent architecture is acceptable if the same separation is achieved.

---

# 7. BROWSER-FIRST EXECUTION

The architecture must explicitly evaluate:

* Web Workers
* WebAssembly
* ONNX Runtime Web
* WebGPU
* browser memory constraints
* large TypedArray handling

The goal is not to use every technology.

Choose the simplest architecture that provides:

* responsive UI
* deterministic scientific computation
* acceptable performance
* maintainability

Explain where each computation should execute.

---

# 8. LOCAL-FIRST DATA FLOW

The preferred architecture is:

```text
Local file / local dataset
        ↓
Browser
        ↓
Worker
        ↓
DSP
        ↓
ONNX
        ↓
Browser visualization
```

No biomedical signal should leave the local machine by default.

Any future server communication must be an explicit architectural decision.

---

# 9. DOMAIN MODEL

Define the minimum semantic entities needed by the system.

At minimum evaluate:

```text
Signal
Channel
SignalMetadata
SamplingInfo
PreprocessingConfiguration
Window
WaveletConfiguration
WaveletDecomposition
FeatureVector
ModelMetadata
ModelInput
ModelPrediction
ExperimentConfiguration
EvaluationResult
```

Do not over-engineer this.

The model must preserve scientific meaning such as:

* sample rate
* units
* channels
* signal length
* source
* provenance
* preprocessing assumptions

---

# 10. SCIENTIFIC PIPELINE CONTRACT

For each transformation define:

* input
* output
* units
* configuration
* assumptions
* side effects
* numerical constraints
* validation

The architecture must make hidden transformations difficult.

The following must remain explicit:

```text
raw signal
→ filtering
→ resampling
→ normalization
→ DWT
→ segmentation
→ features
→ tensor
→ inference
```

---

# 11. DWT ARCHITECTURE

DWT is a first-class subsystem.

Define explicit contracts for:

* wavelet family
* wavelet configuration
* decomposition level
* boundary/extension mode
* coefficient structure
* reconstruction where applicable

Do not make scientific DWT choices prematurely.

Do not assign clinical meaning to wavelet levels without scientific justification.

The architecture must allow wavelet configuration to evolve without changing UI code.

---

# 12. DWT REUSE STRATEGY

Evaluate whether the existing SIGIL DWT implementation can become the canonical DSP/DWT subsystem.

Prefer extraction and cleanup over duplication.

If the existing implementation is too tightly coupled to the current application, define an incremental extraction strategy.

Do not create:

```text
old DWT
+
new DWT
```

unless both genuinely serve different requirements.

Avoid parallel implementations of the same scientific algorithm.

---

# 13. ML / ONNX ARCHITECTURE

Treat ONNX as an inference backend, not as the architecture of the application.

The target interface should conceptually be:

```text
Signal
→ preprocessing
→ ModelInput
→ InferenceEngine
→ ModelPrediction
```

Model-specific implementation details must remain behind an explicit contract.

The UI must not know tensor shapes or raw ONNX output semantics.

---

# 14. MODEL METADATA

The architecture must support explicit model metadata.

At minimum:

```text
model identifier
model version
input shape
input dtype
expected sampling rate
expected channel configuration
preprocessing assumptions
output semantics
class labels
```

The inference system must validate compatibility before execution.

Do not allow shape compatibility to be treated as scientific compatibility.

---

# 15. TRAINING VS RUNTIME

Separate:

```text
Training / experimentation
```

from:

```text
Browser runtime inference
```

The browser consumes versioned model artifacts.

Training pipelines must remain independent.

Do not embed training logic in the frontend.

Do not architect the runtime around a single model.

---

# 16. DATASET STRATEGY

The initial scientific dataset candidate is:

**MIT-BIH Arrhythmia Database**

Do not embed the entire dataset in Git.

Assume the dataset is an external local development dependency.

Recommended conceptual structure:

```text
data/
├── raw/
│   └── mitdb/
├── processed/
└── fixtures/
```

`raw/` and `processed/` should be excluded from version control.

The repository should instead contain:

* dataset documentation
* provenance
* download instructions
* preprocessing documentation
* small deterministic test fixtures

The full dataset must never be required for ordinary unit tests.

---

# 17. DATASET ABSTRACTION

Do not make the entire application dependent on MIT-BIH-specific file formats.

Create a dataset adapter boundary.

Conceptually:

```text
DatasetAdapter
      ↓
Canonical Signal / Record representation
```

This should allow future datasets to be added without rewriting the DSP/UI/ML layers.

---

# 18. EXPERIMENT MODEL

Introduce only enough structure to reproduce an experiment.

An experiment should eventually identify:

```text
dataset
record(s)
channel(s)
sample rate
preprocessing
DWT configuration
segmentation
feature configuration
model
model version
thresholds
evaluation configuration
```

Do not build a full MLOps platform.

---

# 19. TESTING STRATEGY

Tests must exist at several layers.

## Unit

Deterministic scientific functions.

## Integration

```text
signal
→ DSP
→ DWT
→ feature generation
→ model input
→ inference
```

## Regression

Known input → known numerical behavior.

## UI

Only where user interaction itself is important.

Scientific correctness must not depend on screenshots.

---

# 20. GOLDEN FIXTURES

The architecture should support small deterministic signal fixtures.

Include conceptual fixtures for:

```text
impulse
sine wave
multi-frequency signal
constant signal
noise
synthetic ECG-like signal
```

For ECG development, small real-data excerpts may also be stored as fixtures when licensing and repository size make this appropriate.

The full MIT-BIH dataset must remain external.

---

# 21. PATIENT-LEVEL VALIDATION

The architecture must support scientifically correct train/test splitting.

Where records belong to subjects, the experiment system must be capable of subject-level separation.

Do not design an evaluation workflow that accidentally allows windows from the same recording or subject to leak across partitions.

---

# 22. PERFORMANCE MODEL

Identify workloads that should execute:

### Main thread

Small UI/state transformations.

### Worker

Expensive DSP and large signal processing.

### WASM / optimized numerical backend

Where benchmark evidence justifies it.

### ONNX Runtime Web

Model inference.

### WebGPU

Only when measurement demonstrates a benefit and browser support is acceptable.

Do not optimize before profiling.

---

# 23. MEMORY MODEL

Signals can be large.

Design for:

* TypedArrays
* buffer reuse where appropriate
* avoiding unnecessary copies
* worker transferables
* ONNX tensor lifecycle
* large visualization datasets

Avoid repeatedly converting between incompatible numerical representations.

---

# 24. CANCELLATION / STALE RESULTS

Long-running analysis must be robust to rapidly changing user input.

The architecture must prevent:

```text
ECG A starts
↓
ECG B starts
↓
ECG A finishes
↓
ECG A incorrectly overwrites ECG B
```

Define a strategy for:

* cancellation
* request identity
* stale-result rejection

---

# 25. OBSERVABILITY

The architecture should expose enough intermediate state for scientific inspection:

```text
raw
filtered
DWT
segmentation
features
model input
prediction
```

Avoid an opaque pipeline where only the final prediction is accessible.

---

# 26. PRIVACY

Avoid:

* cloud inference by default
* signal uploads
* unnecessary telemetry
* logging raw biomedical data

The application should remain usable without network access once its required assets are installed where feasible.

---

# 27. DEPENDENCY AUDIT

Before recommending new libraries:

1. inspect existing dependencies
2. determine whether equivalent capability already exists
3. determine scientific reliability
4. inspect runtime/browser compatibility
5. consider bundle impact
6. consider licensing
7. justify the dependency

Do not introduce a library merely because it makes code shorter.

---

# 28. ARCHITECTURAL SIMPLICITY

Do not introduce:

* microservices
* unnecessary repositories
* speculative plugin systems
* enterprise dependency injection
* generic abstractions without current consumers
* unnecessary state-management frameworks

This is a browser-based scientific application.

Prefer explicit modules and strong interfaces.

---

# 29. MIGRATION PLAN

The existing project must be migrated incrementally.

Define:

### Phase 1

Preserve current functionality and establish domain/DSP contracts.

### Phase 2

Extract/normalize signal representations.

### Phase 3

Harden DWT and DSP infrastructure.

### Phase 4

Introduce real dataset ingestion.

### Phase 5

Introduce scientific visualization.

### Phase 6

Introduce ONNX model contracts.

### Phase 7

Introduce reproducible experiments/evaluation.

### Phase 8

Optimize workers/WASM/WebGPU based on measurements.

Adjust these phases according to the repository audit.

Do not follow them blindly.

---

# 30. ARCHITECTURE DECISIONS

Recommend ADRs only for decisions that materially affect future development.

Potential ADRs:

```text
ADR-001 Core Signal Representation
ADR-002 DSP Architecture
ADR-003 DWT Contract
ADR-004 ONNX Runtime Contract
ADR-005 Browser Worker Strategy
ADR-006 Dataset Abstraction
ADR-007 Experiment/Reproducibility Model
```

Do not create ADRs for trivial implementation decisions.

---

# 31. DO NOT IMPLEMENT YET

At this stage do NOT:

* build the complete ECG interface
* add a production ML model
* fabricate model predictions
* fabricate metrics
* download datasets automatically
* rewrite the entire application
* introduce a backend
* introduce arbitrary cloud services
* replace working DSP code without evidence

Architect mode must first establish the blueprint.

---

# 32. REQUIRED OUTPUT

Return your work using this structure:

## A. Executive assessment

What exists and whether the foundation is reusable.

## B. Current architecture

Actual modules and actual data flow.

## C. SIGIL DWT assessment

What can be reused, extracted or improved.

## D. Critical architectural problems

Only genuine architectural/scientific problems.

## E. Target architecture

Detailed module/dependency structure.

## F. Domain model

Core scientific entities and contracts.

## G. DSP architecture

Filtering, resampling, normalization, windowing, DWT and features.

## H. ML / ONNX architecture

Model metadata, inputs, outputs, validation and inference boundary.

## I. Browser execution architecture

Main thread vs Worker vs WASM vs WebGPU.

## J. Dataset architecture

MIT-BIH integration strategy without coupling the system to it.

## K. Testing architecture

Unit, integration, regression and golden fixtures.

## L. Reproducibility architecture

Experiment configuration and provenance.

## M. Migration plan

Incremental implementation steps.

## N. Architectural risks

The highest-risk decisions and how to mitigate them.

## O. FIRST CODING TASK

Recommend exactly ONE first implementation task.

It must establish a foundation, not a flashy feature.

---

# 33. FINAL ARCHITECTURAL PRINCIPLE

The central objective is:

**Make experimentation cheap while making accidental scientific changes difficult.**

The platform must allow the following to evolve independently:

* datasets
* preprocessing
* DWT configuration
* feature extraction
* models
* visualization
* experiments

without breaking the scientific core.

At the same time, changing:

* sample rate
* units
* normalization
* channel ordering
* wavelet configuration
* segmentation
* model input semantics

must be difficult to do accidentally.

The architecture should make scientific assumptions explicit.

Do not optimize for demo speed.

Optimize for a foundation that can survive many iterations of experimentation without losing scientific integrity.

Do not write application code yet.
