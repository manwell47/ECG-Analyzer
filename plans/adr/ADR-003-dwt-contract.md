# ADR-003 — DWT Contract

Status: Accepted
Date: 2026-09-03
Scope: Wavelet subsystem and validation strategy

## Context

DWT is a first-class subsystem (AGENTS.md §7; rules §10–§12). The SIGIL reference project
at C:/APPs/steganography implements Db4 in native C++ (JUCE/float/streaming) and vendors
wavelib (BSD-3) — a generic C wavelet library with per/sym extension and J-level DWT.
Neither runs in a browser TypeScript target, and SIGIL's single-level float32 block DWT
does not match whole-record multilevel analysis semantics. Rules §30 forbid duplicating
scientific logic across main-thread and worker runtimes.

## Decision

- Implement a **TypeScript DWT/IDWT** in `src/dsp/dwt` that is deterministic, pure, and
  shared verbatim by main thread and workers. Configuration (family, level, extension
  mode, length handling) is explicit and validated; never hard-coded in UI.
- Seed the wavelet catalog (starting orthogonal Daubechies db1..dbN) with **coefficients
  sourced from wavelib** and captured in `data/fixtures/reference/`.
- **Validate against wavelib as the external scientific reference**: golden DWT outputs
  for deterministic signals are generated once from wavelib and committed as numeric
  fixtures; the TS implementation must match within documented tolerance. Any DWT behavior
  change requires rerunning regression fixtures.
- Gate correctness on the reconstruction identity `idwt(dwt(x,cfg),cfg) ≈ x` within an
  explicit, justified tolerance, plus coefficient-size and determinism assertions.
- Level→frequency band mapping is derived only from fs and level, flagged approximate;
  no clinical-band claims without scientific justification.
- WASM (compiling wavelib) is deferred to a measurement-driven optimization phase, not the
  initial architecture.

## Consequences

- No parallel browser DWT implementations; single shared scientific core.
- Every wavelet decision is auditable and revertible by fixture regression.
- Slight initial porting effort; repaid by cross-validation independent of a C toolchain
  in CI.

## References

- Architecture plan §C, §E.1, §G.1, §K, Phase 2/4
- AGENTS.md §7; `.roo/rules-code/01-medical-engineering.md` §10, §11, §12, §33
