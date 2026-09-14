# ADR-001 — Core Signal Representation

Status: Accepted
Date: 2026-09-03
Scope: Domain model foundation

## Context

Biomedical signals carry scientific meaning — sample rate, units, channels, duration,
source, provenance — that must survive the entire pipeline. Passing raw arrays between
stages silently discards this meaning (AGENTS.md §4, §5; rules §5, §27). The most
frequently violated constraint is treating sample rate or units as implied.

## Decision

Every signal crosses an API boundary as a typed `Signal` composed of `SignalChannel[]`
plus `SamplingInfo` and `Provenance`. `SamplingInfo` explicitly carries `sampleRateHz`,
`startTimeSec`, and `durationSec`; it is **never derived from array length**. Amplitude
`Units` (mV / ADC / normalized) are attached to each channel and every conversion between
them is an explicit, tested function (`signalDomain` utilities). Raw ADC data is retained
in `SignalRecord` so the ADC→mV conversion is auditable rather than lossy. All domain
entities are strongly typed, immutable-by-convention pure data.

Transformed signals return new semantic types (`PreprocessedSignal`, `WaveletDecomposition`,
`ModelInput`, ...) rather than mutating or re-tagging the same array.

## Consequences

- Unit/rate corruption becomes a compile-time or early-runtime error, not a silent bug.
- Cross-layer values are always domain objects; DSP/ML/UI never see anonymous arrays.
- Slightly more ceremony per function signature; accepted in exchange for invariants the
  project constitution demands.
- Enables later provenance capture with a stable attach point.

## References

- Architecture plan §E.2, §F
- AGENTS.md §4, §5; `.roo/rules-code/01-medical-engineering.md` §5, §6, §14, §41
