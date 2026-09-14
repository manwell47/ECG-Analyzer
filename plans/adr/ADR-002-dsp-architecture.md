# ADR-002 — DSP Architecture

Status: Accepted
Date: 2026-09-03
Scope: Signal-processing subsystem

## Context

The rules mandate a strict separation between Domain, DSP, ML, Application, and
Presentation (AGENTS.md §3), pure functions for deterministic transforms (rules §42),
immutability of inputs (rules §43), and an explicit scientific pipeline that is never
collapsed into one opaque call (AGENTS.md §2). DSP must never depend on UI or ML
internals, and must never contain framework code.

## Decision

DSP is a dedicated module layer (`src/dsp`) of **pure functions**, each operating on
domain types and returning new domain types:

```
filterSignal(signal, FilterSpec)     -> Signal        (never in-place rate change)
resample(signal, rate, ResamplingSpec) -> Signal      (new SamplingInfo)
normalize(signal, NormalizationSpec) -> NormalizedSignal
segment(signal, WindowConfig)        -> Window[]
dwt(signal, WaveletConfiguration)    -> WaveletDecomposition
idwt(decomposition)                  -> Signal
extractFeatures(decomp, FeatureConfig) -> FeatureVector
```

Contracts: DSP never imports `ml/`, `presentation/`, or any framework; DSP never
mutates inputs; every config object is strongly typed and validated against the signal's
`SamplingInfo` (cutoffs vs fs, target rate, normalization strategy). Numerical guards
reject empty/short/odd/NaN/Infinity/zero-variance/invalid-fs inputs explicitly.
Visualization never reuses DSP buffers for drawing.

## Consequences

- Every stage is independently unit-testable and inspectable (observability §25).
- Impossible to call DSP from a React component or hide a filter in a UI handler.
- Determinism is the default; worker/main duplication is structurally avoided because the
  same module runs everywhere.

## References

- Architecture plan §E.1, §E.3, §G
- AGENTS.md §2, §3, §4; `.roo/rules-code/01-medical-engineering.md` §4, §6, §8, §9, §42, §43
