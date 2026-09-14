# ADR-006 — Dataset Abstraction

Status: Accepted
Date: 2026-09-03
Scope: Dataset ingestion and subject-aware partitioning

## Context

The initial dataset is MIT-BIH Arrhythmia (local copy in gitignored `data/raw/mitdb/`).
The application must not be coupled to MIT-BIH-specific file formats (prompt §16, §17),
and full datasets must never be required for ordinary tests. Dataset leakage and
subject-level separation are critical scientific concerns (AGENTS.md §11; rules §20, §21).

## Decision

- Introduce a **`DatasetAdapter`** interface that yields the canonical `SignalRecord` /
  `Signal` domain types. The WFDB/MIT-BIH adapter is one implementation; future datasets
  add an adapter without touching DSP/UI/ML.
- The MIT-BIH adapter parses `.hea` (format, sample rate, per-channel gain/baseline/units,
  ADC resolution), `.dat` (format-212 two-channel packed; 16-bit signed where needed), and
  `.atr` annotations as **annotation events** (never silently fused into DSP). ADC→mV
  conversion via gain/baseline is explicit, logged, and unit-tested.
- Record presence is validated against `RECORDS`; missing/inconsistent records and stray
  files are rejected with classified errors (the local copy is not assumed complete, e.g.
  record `213` lacks `.dat/.atr`).
- Data stays local-first: no biomedical signal leaves the machine by default; no cloud,
  telemetry, or uploads. `data/raw` and `data/processed` remain gitignored; only small
  licensing-appropriate derived fixtures are committed under `data/fixtures`.
- **Partitioning is subject-aware from the start**: `PartitionSpec` separates by subject
  (MIT-BIH `100..`/`200..` record subjects); window/sample-level splits are not exposed as
  the default evaluation path. Normalization fit is separated from apply to prevent
  leakage.

## Consequences

- Dataset format changes are isolated behind the adapter boundary.
- Tests never require the full dataset; fixtures are self-contained and deterministic.
- Evaluation methodology is structurally protected against leakage.

## References

- Architecture plan §J, §K, §L, Phase 5
- AGENTS.md §11, §28; `.roo/rules-code/01-medical-engineering.md` §20, §21, §36
