# Phase 8 Audit / Completion — Experiment & Evaluation Machinery

Recorded 2026-09-04 (Code-mode completion record). Verdict: **Phase 8
implemented and fully green.** The full `npm run check` gate passes at the end
of every item and again as the final gate: typecheck ✓, svelte-check (0 errors /
0 warnings) ✓, lint ✓, **48 test files / 492 tests** ✓, Vite build ✓ (135
modules). `src/application/__tests__/runExperiment.test.ts` grew to 24 tests
with the Item 6 multi-subject runner demonstration.

## Scope / approved increment

Build the experiment/evaluation machinery and prove it end-to-end via the
probe-model sign-of-mean oracle on synthetic `sync`: canonical configuration +
validation, per-record runner over `DatasetAdapter`, subject-level split runner,
classification metrics, deep-frozen `ExperimentResult` snapshot, and canonical
JSON provenance export. Library/application slice with tests only — no new UI.

## Files added (Items 1–6)

| Purpose | File |
|---|---|
| Metrics (confusion matrix, `ClassRates`, `ClassificationMetrics`) | [`src/application/metrics.ts`](../src/application/metrics.ts:1) |
| Experiment configuration, selection, validation, `experimentIdOf`, subject-selection resolution | [`src/application/experiment.ts`](../src/application/experiment.ts:1) |
| `ExperimentResult` snapshot, `RecordEvaluation`, `WindowOutcome`, canonical serialize/parse | [`src/application/experimentResult.ts`](../src/application/experimentResult.ts:1) |
| Runner `runExperiment` + `GroundTruthLabeler` + `RunExperimentOptions` | [`src/application/runExperiment.ts`](../src/application/runExperiment.ts:1) |
| Canonical probe-seam config factory (`createProbeSeamExperimentConfiguration`) | [`src/application/defaults.ts`](../src/application/defaults.ts:95) |
| Public barrel exports as machinery landed | [`src/application/index.ts`](../src/application/index.ts:1) |
| Tests: `metrics`, `experiment`, `experimentResult`, `runExperiment` (incl. Item 6 fixture), `experimentSeam.integration` | [`src/application/__tests__/`](../src/application/__tests__/) |

Layer rule enforced throughout: `application/` imports `domain/`, `dsp/`,
`datasets/`, `ml/` — never `ml/testing/` or `ml/onnx/`. Node-only seams enter
only via Node seam tests/demos (recorded as **ADR-009**).

## Item-by-item mapping

1. Metrics module + tests — green.
2. `experiment.ts` configuration model (canonical `records` selection first) +
   validation + deterministic `experimentIdOf` + tests — green.
3. `experimentResult.ts` frozen snapshot + canonical serialization /
   `parseExperimentResult` strict round-trip + coherence invariants + tests —
   green.
4. `runExperiment.ts` per-record runner (read → ADC→mV with provenance →
   windowing → channel filter → `buildModelInput` → engine → interpret argmax →
   labeler → `WindowOutcome`) + classified error propagation + tests — green.
5. Node seam end-to-end over the **real committed ONNX probe**
   (`data/fixtures/models/ecg-lab-probe-linear-mean-2.onnx` + metadata) via
   `createOnnxWebEngine` on synthetic `sync` lead-b (`360/360/drop` → 10
   windows), with determinism, canonical round-trip, and the mandatory
   seam-validation scope note — [`src/application/__tests__/experimentSeam.integration.test.ts`](../src/application/__tests__/experimentSeam.integration.test.ts:1) — green.
6. Subject-level split runner demonstration: 8 synthetic records (each its own
   self-subject, `subjectId = recordId`), distinct lead-b frequencies →
   pairwise-distinct oracle fingerprints, `partitionRecords` + role `test` +
   `assertNoSubjectLeakage`; a `RecordingReadAdapter` spy asserts `readRecord`
   was called only for the selected role (structural no-leakage); the
   single-subject → `test` edge and empty-train rejection; all roles disjoint and
   covering. New fixture + 5 tests appended to
   [`src/application/__tests__/runExperiment.test.ts`](../src/application/__tests__/runExperiment.test.ts:816)
   (now 24 tests). Canonical `createProbeSeamExperimentConfiguration` factory
   re-verifies the default jsdom smoke slices stay green — green.
7. **Docs + final gate (this record).** ADR-009 written; architecture decision
   register, §F domain list and §M Phase 8 cross-reference updated; final full
   `npm run check` green (see status line above).

## What the seam run proves and does not prove

The Item 5 seam test ([`experimentSeam.integration.test.ts`](../src/application/__tests__/experimentSeam.integration.test.ts:1))
drives the real committed probe bytes through the full `runExperiment`
pipeline.

**Proves** — the evaluation pipeline is wired end-to-end over a real committed
ONNX model: record read → ADC→mV with provenance → windowing →
`buildModelInput` → real session → `interpretPrediction` → analytic labeler →
computed metrics → canonical export; deterministic across two runs; export
round-trips through strict parsing.

**Does NOT prove** — any predictive performance or medical/diagnostic property.
The only committed model is a development seam-validation probe whose graph
emits `logits = [+Σ, −Σ]` (argmax = sign of window mean; zero-sum tie → class
index 0, `positive-mean`), and the ground-truth labeler is the *same* analytic
sign-of-sum rule, so agreement is near-perfect **by construction**. All such
runs carry the mandated wording **seam-validation scope — not clinical** (rules
§47/§49; ADR-007/ADR-009). Reported metrics are always computed from documented
evaluations; `scopeNote` is mandatory and non-empty.

## Cross-cutting notes / recorded seams

- **ADR-007 conformant:** config captures everything needed to re-run; result
  carries config snapshot + software version + full provenance chain; metrics
  are computed, never fabricated.
- **ADR-009 recorded:** placement (`PartitionSpec` in `datasets/`;
  `ExperimentConfiguration` / `ExperimentResult` / metrics / runner in
  `application/`) and the seam-validation non-clinical scope.
- **Open by design (unchanged):** no scientific model is committed — the probe
  is the only artifact, and future real-model evaluation re-runs the same gate.
  Phase-6 seam #3 (real browser `Worker` wiring) remains open as before.
- The single-subject partition edge lands in role `test`, so the seam demo can
  also be described as a one-subject `test`-role evaluation (phase-8 plan
  reminder).
