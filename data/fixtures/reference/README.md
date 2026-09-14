# Golden Reference Fixtures

Committed golden artifacts for the ECG Signal Processing & AI Analysis
Laboratory. These small, license-appropriate files are **part of the
repository** (unlike `/data/raw/` and `/data/processed/`, which are gitignored)
and are regenerated deterministically from source under an explicit, env-gated
workflow.

## Files

| File            | Contents                                                                 |
| --------------- | ------------------------------------------------------------------------ |
| `signals.json`  | Seven deterministic synthetic signals (samples in mV) + full recipes + recorded measured properties. |
| `db4.json`      | The Db4 (Daubechies order-4) filterbank (analysis low/high, reconstruction low/high) + verified invariants + provenance. |

## How the fixtures are produced

Every signal is a pure function of its **recipe** (see
[`signals.ts`](../../src/fixtures/signals.ts)):

- generators use no `Math.random()`; stochastic kinds (`noise`) draw from a
  seeded mulberry32 / Box–Muller stream ([`rng.ts`](../../src/fixtures/rng.ts)),
- the reference sample rate is 360 Hz (mirroring MIT-BIH) and amplitudes are in
  millivolts,
- each entry records the measured `properties` ([`measure.ts`](../../src/fixtures/measure.ts)),
  independent of any downstream implementation being validated.

The canonical fixture set and file format live in
[`golden.ts`](../../src/fixtures/golden.ts). Regenerating the committed files is
deliberate and explicit:

```text
npm run fixtures:write
```

(equivalent to `FIXTURES_OVERWRITE=1 vitest run src/fixtures`). Every normal
test run instead **regenerates the fixtures in memory and compares them against
these committed bytes** ([`golden.test.ts`](../../src/fixtures/__tests__/golden.test.ts)),
so a fixture can never drift silently.

## Fixture catalogue

| id                  | kind             | length | notes                                             |
| ------------------- | ---------------- | ------ | ------------------------------------------------- |
| `impulse-1`         | impulse          | 720    | amplitude 1.0 mV at sample 5                       |
| `constant-1`        | constant         | 360    | DC level 0.5 mV                                    |
| `sine-1`            | sine             | 3601   | 1 Hz, A = 1.0 mV, 10 whole cycles + boundary sample |
| `multi-frequency-1` | multi-frequency  | 3600   | tones 1 / 3 / 5 Hz at A = 1.0 / 0.5 / 0.25 mV     |
| `chirp-1`           | chirp            | 3600   | A = 1.0 mV, 0.5 → 20 Hz                            |
| `noise-1`           | noise            | 2048   | σ = 0.05 mV, seed `20260903`                       |
| `synthetic-ecg-1`   | synthetic-ecg    | 2160   | 60 bpm, A = 1.0 mV (morphology placeholder)        |

## Db4 provenance

The decomposition low-pass taps are the canonical Daubechies-4 `dec_lo` values
in the ordering used by wavelib, PyWavelets and MATLAB `db4`. They were
cross-read from the wavelib-derived SIGIL `WaveletProcessor.cpp` embedded Db4
taps (reference-only project at `C:/APPs/steganography`) and agree with the
literature to ~1e-12. The high-pass is derived as the quadrature-mirror filter,
and the reconstruction filters are time-reversed analysis filters
([`db4.ts`](../../src/fixtures/db4.ts)); orthonormality invariants are asserted
by [`db4.test.ts`](../../src/fixtures/__tests__/db4.test.ts).

## DWT reference-capture status

`signals.json` + `db4.json` provide *inputs* and *filterbank coefficients*, not
yet end-to-end DWT decomposition vectors. Numerical DWT outputs captured from
the native **wavelib** C library remain a **Phase-4 external-capture gate**:
those vectors must be produced by a real wavelib build (a C toolchain is not
available in this environment) and recorded with provenance. No such outputs
have been fabricated; until then, DWT validation in later phases is anchored to
this filterbank and analytically known transforms (e.g. the Db4 orthonormality
invariants above).
