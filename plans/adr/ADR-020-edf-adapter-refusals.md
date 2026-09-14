# ADR-020 — The EDF/EDF+ adapter, and what it refuses (an extension-keyed format dispatch)

Status: Accepted
Date: 2026-09-14
Scope: Phase 18 Part B (item 6) — a **second**, non-WFDB `DatasetAdapter` behind the existing
[`DatasetFileSource`](../../src/datasets/source.ts:20) seam, plus a small **extension-keyed** format
dispatch so it is reachable from the picker. Additive: no science, no domain, no DSP/DWT, no ML, no
application change; no new dependency, prop, script or config; no wall-clock or pixel assertion
(rules §30/§51). The canonical channel stays **raw `Int16Array` ADC counts plus `{gain, baseline}`**
([ADR-006](ADR-006-dataset-abstraction.md:1)); mV still appears only after
[`recordToMillivoltSignal`](../../src/datasets/load.ts:35).

## Context

[ADR-006](ADR-006-dataset-abstraction.md:16) made the dataset boundary an interface — "the WFDB/MIT-BIH
adapter is one implementation; future datasets add an adapter without touching DSP/UI/ML" — and required
that ADC→mV be "explicit, logged, and unit-tested". Until now exactly one real format has exercised that
boundary, so the claim was structural but unproven: the second adapter is where an abstraction either
holds or turns out to have been WFDB in disguise.

EDF/EDF+ fits the canonical shape unusually well. A 256-byte fixed header plus one 256-byte **field-major**
block per signal declares the signal count, the record duration, the data-record count, and per signal the
label, physical dimension, physical and digital minima/maxima and samples per data record. Therefore
`gain = digitalSpan / physicalSpan` and `baseline = digitalMin − physicalMin × gain` **follow by arithmetic
on declared numbers** — nothing is assumed, and `RecordChannel.samples` being an `Int16Array` while EDF
stores signed 16-bit little-endian digital values makes the sample mapping exact and lossless.

But the canonical model is **narrower than EDF**, and that gap is where the decision lives:

1. **A second adapter is where "just make it work" tempts invention.** Every gap can be closed by
   fabricating something — rescale µV to mV, resample to a common rate, bridge an `EDF+D` gap, half-read a
   TAL, clamp an out-of-range sample. Each would produce a plausible `SignalRecord` carrying physics no
   machine recorded. The invariant this ADR protects is that a gap becomes a **classified refusal**, never
   an invention.
2. **An adapter nobody can select is a library, not a feature.** A purely additive reader with no dispatch
   would leave the EDF path unreachable from the application, so "second adapter" would be unverifiable
   through the real UI and the seam would be exercised only by its own tests — the self-consistent-and-wrong
   trap [ADR-019](ADR-019-worker-message-delivery-contract.md:30) documents, in a milder form.
3. **The WFDB path is load-bearing and pinned.** `discoverMitBihRecordIds` and the local-ingestion jsdom
   cases are existing, unedited assertions. A dispatch introduced for EDF must be provably a no-op for
   WFDB, or it silently changes behaviour the phase is forbidden from touching.

Constraints:

- **Only the four documented classified codes** (`file-not-found`, `malformed-header`, `unsupported-format`,
  `annotation-parse-error`) — no new code, and no unclassified throw.
- **`createSignalRecord`'s invariants are never the error path.** A degenerate declared range must be refused
  *by the parser, naming the field*, before assembly can fail with a vaguer invariant message.
- **No scaling, resampling or clipping inside the adapter.** The single audited ADC→mV step is
  [`recordToMillivoltSignal`](../../src/datasets/load.ts:35).
- **The WFDB path is byte-identical:** its discovery, its records and the pinned jsdom cases are untouched.
- **Fixtures stay hermetic:** `InMemoryFileSource` only, so the default suite never needs a real EDF file.

## Decision

### (a) A pure header parser whose **only** failures are classified

[`parseEdfHeader`](../../src/datasets/edf/header.ts:207) reads the fixed header and the field-major signal
blocks and either returns a fully-checked [`EdfHeader`](../../src/datasets/edf/header.ts:71) or throws an
`EcgError`. Every refusal names the offending field, so a real file's rejection is actionable rather than
opaque:

| Refusal | Code | Rejected alternative |
| --- | --- | --- |
| Version other than `"0"` | `unsupported-format` | Parse it anyway and hope the layout matches |
| Reserved tag `EDF+D` (discontinuous) | `unsupported-format` | Concatenate the records into one timeline |
| Reserved tag neither blank nor `EDF+C`/`EDF+D` | `unsupported-format` | Treat an unknown tag as plain EDF |
| Declared physical dimension other than mV (annotation signal exempt) | `unsupported-format` | Rescale µV (and anything else) to mV |
| Derived per-signal sample rates disagree | `unsupported-format` | Resample onto a common rate |
| A field blank / non-numeric / non-integer | `malformed-header` | Coerce with `Number()` and accept `NaN` |
| Fewer than 256 bytes, or fewer than the declared header bytes | `malformed-header` | Read what is there |
| Signal count `<= 0` | `malformed-header` | Return a record with no channels |
| Header byte count ≠ `256 × (signals + 1)` | `malformed-header` | Trust the declared count over the layout |
| Samples per data record `<= 0` | `malformed-header` | Skip the signal |
| Physical span `<= 0`, or digital span `<= 0` | `malformed-header` | Invent a `gain` (`createSignalRecord` would then reject the record as an invariant violation — a worse message for the same defect) |
| Data-record duration `<= 0` | `malformed-header` | Assume 1 s |
| Data-record count `< -1` | `malformed-header` | Clamp to `-1` |
| Count `-1` and the data section is not a whole number of records | `malformed-header` | Drop the remainder bytes |
| Data section disagrees with a declared count | `malformed-header` | Read `min(declared, available)` |

The `-1` (streamed/unknown) count is **derived** from the bytes present and must divide the data-record size
exactly — the format's own rule, not a heuristic.

### (b) Calibration is derived from the declared numbers, never assumed

[`edfCalibrationOf`](../../src/datasets/edf/calibration.ts:44) computes `gain`, `baseline` and
`adcResolutionBits` from the declared ranges alone. The adapter reports the *declared* facts
(`adcZero: 0`, `initialValue` the first sample, `blockSize` the declared samples per data record,
`sourceFormat` `'EDF'` or `'EDF+C'`) and states `checksum: 0` **because EDF declares none** — nothing is
invented to fill a field. The header parser refuses a degenerate span, so the record whose invariants
`createSignalRecord` checks is one whose calibration is already known finite and positive.

### (c) The adapter excludes and reports — it never rescales

[`EdfDatasetAdapter`](../../src/datasets/edf/adapter.ts:85) mirrors the MIT-BIH adapter's assembly pattern:

- **Unit.** Only a declared millivolt dimension is accepted, the same rule the MIT-BIH adapter's
  `canonicalUnitOf` applies. **Rejected:** silently rescaling µV to mV, which is a *calibration* change and
  belongs to the one audited step in [`load.ts`](../../src/datasets/load.ts:35).
- **Rate.** All signals must agree on the derived rate, because canonical
  [`SamplingInfo`](../../src/domain/sampling.ts:18) is single-rate for every channel. **Rejected:**
  resampling, which fabricates samples and is a DSP concern
  ([`src/dsp/resample.ts`](../../src/dsp/resample.ts:1)), not an adapter one.
- **Continuity.** Plain EDF and `EDF+C` are continuous and concatenate into one uniform timeline;
  `EDF+D` raises `unsupported-format`. **Rejected:** concatenating anyway, inventing a timeline no machine
  recorded.
- **Annotations.** An `EDF Annotations` signal (matched by its exact label) is not a physiological channel:
  it is excluded from the channels, the exclusion is **stated in the record's `comments`**, and the record's
  `annotations` stay **empty**. **Rejected:** a silent half-read of the TAL block, or fabricating events;
  EDF+ TAL parsing is a later increment with its own ADR.
- **Out-of-range digital values.** Samples outside the declared range are read **as declared** and never
  clipped or rescaled; the count is recorded as a provenance transform (`edf-out-of-declared-range`, with
  the channel, count and declared bounds), so the fact travels with the record instead of being hidden.
  **Rejected:** clamping, which would silently rewrite data.
- **Degenerate labels and channel sets.** A duplicate label, or a file whose only signal is the annotation
  signal, raises `unsupported-format` naming the cause — refusing rather than emitting a record whose
  channels collide or are empty.

A third `malformed-header` guard lives in the decoder
([`decodeEdfSignals`](../../src/datasets/edf/decode.ts:28)): the buffer must hold the whole declared data
section, checked **before** any decoding.

### (d) Format dispatch is extension-keyed, deterministic, and lives in a pure shared module

[`detectDatasetFormat`](../../src/datasets/dispatch.ts:59) answers from file **names** alone —
`.hea` ⇒ `'mit-bih'`, `.edf` ⇒ `'edf'`, **case-insensitively** — and refuses a selection that matches both
or neither with `unsupported-format` stating the counts. **No content sniffing, no silent preference.**

Two deliberate deviations from the plan's wording, recorded here rather than glossed:

1. The plan placed the dispatch *inside* `prepareBrowserDataset`. It is instead implemented as the pure,
   Node-testable [`src/datasets/dispatch.ts`](../../src/datasets/dispatch.ts:1), consumed by both
   [`prepareBrowserDataset`](../../src/presentation/dataset/browserDatasetService.ts:76) and the file-ingestion
   funnel, so the rule has exactly one definition and one gate.
2. [`createBrowserDatasetService`](../../src/presentation/dataset/browserDatasetService.ts:50) takes a
   **required** `format` argument, with no default, so no caller can silently analyse EDF bytes as WFDB.

**Behaviour change to record:** `ingestFiles`/`ingestDirectoryHandle` now **throw** `unsupported-format` for
a selection matching neither format or both, where they previously returned an empty record list. Verified by
search that no test or assertion depended on the empty-list path, and that the pinned jsdom cases still
destructure correctly. The now-effectively-dead "No WFDB records (.hea files) were found in the selection."
message in [`App.svelte`](../../src/presentation/App.svelte:1) and the WFDB-only picker hint are **left
untouched** — they are pinned assertions — and are recorded as residual risk for the phase audit.
[`DatasetPicker.svelte`](../../src/presentation/dataset/DatasetPicker.svelte:1) needed no change (the
`<input type="file">` has no `accept` filter, so `.edf` was already selectable).

### (e) The WFDB path is byte-identical

`discoverMitBihRecordIds`, the MIT-BIH parser, the format-212 decoder, the `.atr` reader and
[`load.ts`](../../src/datasets/load.ts:35) are unmodified, and the pinned local-ingestion jsdom cases are
unedited and green. The new code is reachable only through the dispatch and the new adapter.

## Consequences

- The adapter boundary is **demonstrated, not asserted**: a second real format now flows through
  `DatasetAdapter` into the canonical record with no DSP/UI/ML change.
- Every EDF gap is a permanent, gated refusal with a rejected alternative, so "we left it out" and "we
  forgot" cannot be confused later.
- The gate is a Node suite over hermetic `InMemoryFileSource` fixtures, whose builder
  ([`support.ts`](../../src/datasets/edf/__tests__/support.ts:1)) lays out the EDF field offsets and widths
  **independently of the parser** — a hard-coded restatement of the format, so the parser is checked against
  EDF as specified rather than against itself. Its defaults are chosen for round arithmetic (physical
  −1…1 mV over digital −1000…1000 ⇒ `gain` 1000, `baseline` 0, 11 bits), and its `patch` mechanism **throws
  on an unknown key**, so a mistyped refusal fixture cannot silently test a valid file.
- The mV rule is asserted as an **exact per-sample** identity against the record's own `calibration`
  (`data[i] === adcToMillivolt(digit, calibration)`), after asserting that `calibration` is the fixture's
  literal `{ gain, baseline }` — so the parity cannot pass vacuously and needs no non-null assertion.
- Known gaps, deliberately deferred: EDF+ **TAL annotations** (the record's `annotations` stay empty and the
  excluded signal is stated in `comments`) and **`EDF+D` discontinuities**. Both are narrow, documented
  widenings of the adapter, not silent partial reads.
- Residual risk for the phase audit: the dead WFDB-only string in `App.svelte` and the picker hint.
- The seam addition is documented in architecture §J and §M item 18, with a decision-register line.
- Item 6 gate: **64 test files / 814 tests / 173 modules**, `npm run check` exit 0.

## References

- [ADR-006](ADR-006-dataset-abstraction.md:1) — the adapter boundary and the explicit calibration rule.
- [ADR-019](ADR-019-worker-message-delivery-contract.md:30) — the "a fake believed over the platform"
  hazard, the milder form of which the reachability argument (§Context 2) guards against.
- [`plans/phase-18-plan.md`](../phase-18-plan.md:149) — Design decision 7 and Item 6.
- Architecture §J (dataset architecture), §M item 18, decision register.
