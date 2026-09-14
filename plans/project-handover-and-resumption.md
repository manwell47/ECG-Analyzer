# Project handover and resumption

This is the single entry point for picking this repository up cold: what was frozen,
how to bring it back up, how to prove it is still green, what is still open, and the
rules that must be re-read before anything is touched.

It is a **documentation artifact**, not a gate. Nothing here is wired into
`npm run check`. Every factual statement below is either read from a file, produced by
a command run against this workspace, or explicitly labelled as unverified. Where a
number is a snapshot, it is presented as a dated observation **with the command that
produced it**, so it can be re-derived rather than believed (AGENTS.md §29: documentation
must describe the actual implementation, never an intended one).

Recorded 2026-09-14 from `c:/APPs/ECG DWT Analyzer`, at the suspension of the project.

---

## Freeze history

One row per suspension. **Append a new row at each subsequent suspension** — do not
overwrite an earlier row; the history is the point.

| Date | Commit | Branch | Gate result | Live URL status |
| --- | --- | --- | --- | --- |
| 2026-09-14 | `78c2fabf00d0d97566790b4652f728e4e737774d` (`78c2fab`) | `main` | `npm run check` **exit 0** — svelte-check **0 errors / 0 warnings**, **66 test files / 838 tests**, production build **181 modules** | `https://manwell47.github.io/ECG-Analyzer/` → **HTTP 200**; latest Pages run `head_sha` = this commit, conclusion `success` |

Both columns are dated observations produced by the commands quoted in
[Frozen state](#frozen-state) and [Verification gate](#verification-gate). They are
**not** standing facts: hashes, counts and run ids rot the moment anything lands.

---

## Frozen state

All of the following was executed in this workspace on **2026-09-14** and is quoted as
observed.

### Git

```
git rev-parse HEAD              → 78c2fabf00d0d97566790b4652f728e4e737774d
git rev-parse origin/main       → 78c2fabf00d0d97566790b4652f728e4e737774d
git status --porcelain --untracked-files=all → (no output)
git branch --show-current       → main
git remote -v                   → origin  https://github.com/manwell47/ECG-Analyzer.git  (fetch and push)
```

The working tree is **clean**: local `HEAD` and `origin/main` are the same commit and
there are no untracked files. `git log --oneline -10 --decorate` printed nine commits, so
`4558bac` ("Initial publication: ECG DWT Analyzer (Phase 18)") is the **root commit** —
this repository's history begins at publication, not at Phase 1. The most recent commits
are:

```
78c2fab (HEAD -> main, origin/main) Record the owner's decision to publish the uploaded captures (ADR-022 item 8)
ee9d9e7 Publish interface screenshots and rewrite the README
86e69f3 Record the successful GitHub Pages deployment and the entry-hash cause (ADR-023)
d965d53 Record the first GitHub Pages workflow outcome (ADR-023)
672fde6 Add GitHub Pages deployment and a double-click launcher (ADR-023)
```

### Local toolchain

```
node --version  → v24.18.0
npm  --version  → 11.16.0
```

`package-lock.json` **is present** (215,561 bytes), so `npm ci` is the correct install
command. `package.json` declares `"engines": { "node": ">=20" }`.

### Gate

`npm run check` → **exit 0**:

- `tsc --noEmit` ✓
- `svelte-check` ✓ — **0 errors / 0 warnings**
- `eslint src vite.config.ts` ✓
- `vitest run` ✓ — **66 test files / 838 tests passed**
- `vite build` ✓ — **181 modules** (Vite v6.4.3)

### Public deployment

```
curl https://manwell47.github.io/ECG-Analyzer/   → HTTP 200
```

A bare `200` is weak evidence on its own: this is a single-page app and an unknown path
is answered with the app document and a `200` as well — which is why the dev-server probe
table records a deliberate **control** row, `/src/workers/entries/nope.worker.ts` →
`200`, **667 bytes**, `text/html`
([`plans/phase-18-manual-verification.md`](phase-18-manual-verification.md:98)). The
stronger evidence is the workflow run:

```
GET /repos/manwell47/ECG-Analyzer/actions/workflows/deploy-pages.yml/runs  (anonymous)
  latest: id 34853841093, run_number 5, head_sha 78c2fabf00d0d97566790b4652f728e4e737774d,
          event push, status completed, conclusion success, created 2026-09-14T14:10:07Z
```

So the deployed artifact **can be assumed to correspond to `78c2fab`**. Two caveats, both
real: the workflow rebuilds on **every** push to `main`, so a documentation-only commit
like the one that lands this file invalidates the comparison and it must be re-checked
afterwards; and the API values above are a dated observation.

### Data present locally

`data/raw/mitdb` **exists** in this workspace (it is gitignored and is *not* in the
repository):

- **48** `.hea`, **48** `.dat`, **49** `.atr` files, plus `RECORDS`, `ANNOTATORS`,
  `SHA256SUMS.txt`, an `x_mitdb/` subfolder and stray `.xws` / `.at_` / `.at-` files.
- `data/raw` contains nothing else.
- `RECORDS` **is present** and begins `101`, `102`, `103`.

Committed under `data/` — `git ls-files data` — are exactly **seven** files, all under
`data/fixtures/`. No raw dataset byte is in the repository.

---

## Prerequisites

| Requirement | Verified value / note |
| --- | --- |
| Node.js | `>=20` per `package.json` `engines`; observed **v24.18.0** |
| npm | observed **11.16.0**; `package-lock.json` present → use `npm ci` |
| OS / shell | Windows 11, `cmd.exe`. The launcher is a `.cmd` file and **the gate has only ever been run on Windows** (`.github/workflows/deploy-pages.yml`, header comment) |
| Browser | For local use, any modern browser. **Folder** ingestion uses the File System Access API and therefore needs a Chromium-based browser; single-file ingestion works wherever the application runs ([`README.md`](../README.md:60), ADR-012) |
| Git | Not needed to *run* the app; needed to verify the freeze and to commit a change |
| Optional: local dataset | `data/raw/mitdb` — only the opt-in real-data gates need it |
| Not required | No browser automation is used anywhere (there is no Playwright and no Vitest browser mode in `devDependencies`), and the `gh` CLI is not installed in this workspace ([`plans/repository-publication-plan.md`](repository-publication-plan.md:185)) |
| Network | Needed for `npm ci` and to reach the hosted copy. The application itself is local-first; `package.json` has exactly one runtime dependency, `onnxruntime-web`, and no telemetry or cloud client (AGENTS.md §18) |

The repository directory name contains a **space** (`ECG DWT Analyzer`): quote paths in
any shell command.

---

## How to bring the project back up

Three routes. Commands that exist in `package.json` are marked ✅; anything that does not
exist there, or was not actually executed during this freeze, is marked **untested**.

### (a) The double-click launcher — [`App.cmd`](../App.cmd:1)

Double-click `App.cmd`. Read literally, it: changes to its own directory (`cd /d "%~dp0"`),
checks `where node` and `where npm` and **exits with a pause** if either is missing, runs
`npm ci` **only when `node_modules\` is absent**, then runs `call npm run dev -- --open`,
prints a "KEEP THIS WINDOW OPEN" notice, and ends with `pause`.

- No port is hard-coded anywhere in it: Vite takes the **first free port** starting at
  `5173` and prints the URL it actually chose.
- The terminal window is the dev server. Closing it stops the app.

### (b) The developer route ✅

```
npm ci
npm run dev
```

Then open the URL Vite prints (default `http://localhost:5173/`). `npm run dev` is
`vite`; add `-- --open` to open the browser automatically. **The terminal must stay
open** for the session to keep serving.

Also available ✅ (all present in `package.json`):

```
npm run typecheck       # tsc --noEmit
npm run svelte-check    # svelte-check --tsconfig ./tsconfig.json
npm run lint            # eslint src vite.config.ts
npm run test            # vitest run
npm run test:watch      # vitest
npm run bench           # vitest bench
npm run build           # vite build
npm run check           # typecheck && svelte-check && lint && test && build
npm run fixtures:write  # set FIXTURES_OVERWRITE=1&& vitest run src/fixtures
```

### (c) The production-build route

```
npm run build            # ✅ emits dist/
```

**There is no `preview` script in `package.json`.** Do not document `npm run preview`; it
does not exist and will fail. The honest alternatives:

- **`npx vite preview`** — Vite ships a `preview` sub-command, so this *should* serve
  `dist/`. It was **not executed** during this freeze and is therefore **untested** here.
  It would also **not** apply the hosted copy's base path unless the same flag is passed.
  Note that `vite preview` is a local smoke tool, not a production server.
- Serve `dist/` with any static file server of your choice (**untested**).

**Hosted-copy sub-path flag.** The GitHub Pages copy is built from
`https://manwell47.github.io/ECG-Analyzer/`, i.e. under a **sub-path**, so the build is
run as:

```
npm run build -- --base=/ECG-Analyzer/
```

The base is supplied as a **Vite CLI flag** in the workflow and
[`vite.config.ts`](../vite.config.ts:1) is deliberately **not** modified (the workflow's
header comment states this). That is why the local `npm run build` and the hosted build
are not identical artifacts.

---

## Verification gate

```
npm run check
```

It is a chain of five stages, run in order with `&&`, so the first failure stops it:

| Stage | Command | What it proves |
| --- | --- | --- |
| typecheck | `tsc --noEmit` | types are sound across the whole workspace |
| svelte-check | `svelte-check --tsconfig ./tsconfig.json` | Svelte components type-check and lint at the component level |
| lint | `eslint src vite.config.ts` | codebase rules, including the DSP/UI boundary rules |
| test | `vitest run` | the scientific and structural gates (Node, plus jsdom where opted in per file) |
| build | `vite build` | the production bundle actually compiles and emits |

**Expected at the freeze:** exit 0; svelte-check **0 errors / 0 warnings**;
**66 test files / 838 tests**; build **181 modules**.

**Rule.** A change is not done because it looks correct or because a demo signal renders.
AGENTS.md §30 (STEP 5 — VALIDATE) and §33 (definition of done) require the gate to pass,
and §56 of `.roo/rules-code/01-medical-engineering.md` requires that the toolchain is never
silenced: do not disable a check, delete a failing test, weaken a lint rule or add
`@ts-ignore` as a first resort in order to go green.

**Warning — the numbers are a snapshot.** They describe the commit in
[Freeze history](#freeze-history) on Windows. A divergence is a **finding to investigate**,
not noise to be accepted: either something landed legitimately (then the expected numbers
in this file are stale and must be updated here) or the environment differs (then say so
explicitly rather than quietly).

**Skipped is not passed.** The opt-in real-data gates (`it.skipIf`) **skip** when
`data/raw/mitdb` is absent, with the recorded reason *"data/raw/mitdb is absent
(gitignored) — opt-in real-data gate skipped"*. On a clean clone that is expected and the
suite still passes — but a skipped gate proves nothing about real data (ADR-017).

---

## Repository map

Layout verified with `dir /b /s src` (presence only — this is a map, not an exhaustive
index). The dependency direction is the one the architecture blueprint pins
([`plans/ecg-lab-architecture.md`](ecg-lab-architecture.md:109) §E.1):
`presentation → application → {domain, dsp, ml}`, and `domain → nothing`. UI must never
import DSP or ML internals; DSP and ML must never know about the UI.

| Layer | Where it lives | What it owns |
| --- | --- | --- |
| Domain | [`src/domain/`](../src/domain/index.ts:1) | `signal`, `sampling`, `units`, `record`, `numeric`, `ml`, `error` — entities, units and types; depends on nothing |
| DSP | [`src/dsp/`](../src/dsp/index.ts:1) | `filter`, `normalize`, `resample`, `segment`, and the first-class DWT subsystem [`src/dsp/dwt/`](../src/dsp/dwt/index.ts:1) |
| ML | [`src/ml/`](../src/ml/index.ts:1) | model metadata, tensor input construction, output interpretation, `onnx/` (runtime engine), `testing/` (the development probe and stubs) |
| Datasets | [`src/datasets/`](../src/datasets/index.ts:1) | the `DatasetFileSource` seam (`source`, `fileSource`, `nodeSource`), the MIT-BIH/WFDB adapter (`mitbih/`), the EDF/EDF+ adapter (`edf/`), `synthetic/`, `dispatch`, `load`, `partition`, `types` |
| Application | [`src/application/`](../src/application/index.ts:1) | orchestration: `analysis`, `dspExecutor`, `experiment`, `experimentResult`, `runExperiment`, `metrics`, `inference`, `defaults` |
| Workers | [`src/workers/`](../src/workers/index.ts:1) | the transport-free core and its binding: `port`, `bind`, `client`, `core`, `identity`, `orchestrator`, `types`, and the two entries [`entries/dsp.worker.ts`](../src/workers/entries/dsp.worker.ts:1) / [`entries/inference.worker.ts`](../src/workers/entries/inference.worker.ts:1) |
| Presentation | [`src/presentation/`](../src/presentation/App.svelte:1) | `App.svelte`, `dataset/` (ingestion + picker), `views/` (`controls/`, `dwt/`, `inference/`, `timeSeries/`), `workers/browserWorkers.ts` |
| Fixtures | [`src/fixtures/`](../src/fixtures/index.ts:1) | the deterministic reference signals (`rng`, `signals`, `db4`, `golden`, `measure`) used as regression baselines |
| Benchmarks | [`src/bench/`](../src/bench/scenarios.ts:1) | `dsp`, `pipeline`, `worker` benchmarks under the measurement-first policy (ADR-010) |
| Records | [`plans/ecg-lab-architecture.md`](ecg-lab-architecture.md:1) · [`docs/origin-brief.md`](../docs/origin-brief.md:1) | ADRs and per-phase plans/audits/checkpoints/manual-verification records; the original brief and the published screenshots |

**Entry points:** [`src/main.ts`](../src/main.ts:1) (boot and teardown),
[`src/presentation/App.svelte`](../src/presentation/App.svelte:1) (the view),
[`src/application/defaults.ts`](../src/application/defaults.ts:1) (the composition
defaults), [`src/application/index.ts`](../src/application/index.ts:1) (the application
barrel).

---

## Data: what is not in the repository

| Fact | Detail |
| --- | --- |
| Ignore rules | `.gitignore` line 4 `/data/raw/`, line 5 `/data/processed/`. Also ignored: `node_modules/`, `dist/`, `coverage/`, `/bench-results/`, logs and OS noise |
| Expected local directory | `data/raw/mitdb`, flat WFDB layout: `NNN.hea`, `NNN.dat`, optional `NNN.atr` |
| What *is* committed under `data/` | exactly seven files, all under `data/fixtures/` (`models/`: `README.md`, `.metadata.json`, `.onnx`, `generate-probe-model.py`; `reference/`: `README.md`, `db4.json`, `signals.json`) |
| How to obtain the dataset | MIT-BIH Arrhythmia Database, published by **PhysioNet** at <https://physionet.org/content/mitdb/> under the **Open Data Commons Attribution License v1.0**. Fetch it yourself into `data/raw/mitdb/`; the adapter discovers records by scanning that directory ([`README.md`](../README.md:311)) |
| Licensing / provenance (AGENTS.md §28) | The repository's own source is Apache-2.0; the dataset is **not** redistributed here and remains under its own upstream terms ([`README.md`](../README.md:430)). Any published figure that renders a recording must carry the mandatory attribution: record id, channel, "MIT-BIH Arrhythmia Database", PhysioNet, ODC-BY 1.0, source URL |
| Sensitivity (AGENTS.md §18) | `.hea` header comments can carry identifying metadata. Keep them out of screenshots, out of logs and out of any transmitted payload. **Never commit raw dataset bytes** |
| What the integration test does | [`realData.integration.test.ts`](../src/datasets/__tests__/realData.integration.test.ts:26) calls the **sync** probe [`firstCompleteRecordId()`](../src/datasets/__tests__/realRecordSupport.ts:37) at declaration time to drive `it.skipIf(recordId === undefined)`. **Present → the case runs**, asserting that the discovered ids contain the probed record, that the dataset id is the canonical MIT-BIH id, that the sampling rate is 360 Hz, that there is at least one channel, that the first channel's sample count equals the record's declared sample count, and that `provenance` records the `adc-to-millivolt` step. **Absent → the case skips** with the recorded reason string; the suite still passes |
| Which record it resolves to here | The probe sorts `.hea` stems and returns the **first** stem that has both `.dat` and `.atr`. In this workspace that is **`100`** (the listing shows `100.hea`, `100.dat`, `100.atr`) |
| Never hard-code a record id | The gates read whatever the probe returns, so a machine with a different — or no — dataset behaves correctly; record `101` is not named in any test ([`plans/phase-16-plan.md`](phase-16-plan.md:163)) |

---

## Decision register

The real filenames, with each ADR's own title. There are **23** ADRs; `ADR-023` and
`ADR-022` are the newest, and `ADR-019`/`ADR-020`/`ADR-021` were added by Phase 18.

| ADR | Title |
| --- | --- |
| [`ADR-001-core-signal-representation.md`](adr/ADR-001-core-signal-representation.md:1) | Core Signal Representation |
| [`ADR-002-dsp-architecture.md`](adr/ADR-002-dsp-architecture.md:1) | DSP Architecture |
| [`ADR-003-dwt-contract.md`](adr/ADR-003-dwt-contract.md:1) | DWT Contract |
| [`ADR-004-onnx-runtime-contract.md`](adr/ADR-004-onnx-runtime-contract.md:1) | ONNX Runtime Contract |
| [`ADR-005-browser-worker-strategy.md`](adr/ADR-005-browser-worker-strategy.md:1) | Browser Worker Strategy |
| [`ADR-006-dataset-abstraction.md`](adr/ADR-006-dataset-abstraction.md:1) | Dataset Abstraction |
| [`ADR-007-experiment-reproducibility-model.md`](adr/ADR-007-experiment-reproducibility-model.md:1) | Experiment / Reproducibility Model |
| [`ADR-008-display-selection-controls.md`](adr/ADR-008-display-selection-controls.md:1) | Display Channel/Viewport Selection & View Controls |
| [`ADR-009-application-experiment-placement.md`](adr/ADR-009-application-experiment-placement.md:1) | Experiment/Evaluation Machinery Placement & Seam-Validation Scope |
| [`ADR-010-performance-measurement-policy.md`](adr/ADR-010-performance-measurement-policy.md:1) | Performance Measurement Policy & Worker/WASM/WebGPU Decision Status |
| [`ADR-011-worker-execution-model.md`](adr/ADR-011-worker-execution-model.md:1) | Worker Execution Model (real browser glue) |
| [`ADR-012-browser-local-ingestion.md`](adr/ADR-012-browser-local-ingestion.md:1) | Browser-local real-signal ingestion (WFDB) |
| [`ADR-013-annotation-display.md`](adr/ADR-013-annotation-display.md:1) | Annotation display over the canonical record (+ the completed record selector) |
| [`ADR-014-signal-navigation.md`](adr/ADR-014-signal-navigation.md:1) | Signal navigation: cursor readout, zoom and pan (display only) |
| [`ADR-015-cursor-annotation-readout.md`](adr/ADR-015-cursor-annotation-readout.md:1) | Cursor annotation readout: the nearest annotation symbol (display only) |
| [`ADR-016-annotation-interaction.md`](adr/ADR-016-annotation-interaction.md:1) | Annotation interaction: hover detail, an optional symbol filter and a bounded click-to-pin (display only) |
| [`ADR-017-real-data-verification.md`](adr/ADR-017-real-data-verification.md:1) | Real-data verification and the opt-in gate policy (tests + docs only) |
| [`ADR-018-annotation-set-filtering.md`](adr/ADR-018-annotation-set-filtering.md:1) | Annotation set filtering, a clickable legend and a bounded annotation list (display only) |
| [`ADR-019-worker-message-delivery-contract.md`](adr/ADR-019-worker-message-delivery-contract.md:1) | The worker message delivery contract (an event-shaped `onmessage`, and a fake that imitates the platform) |
| [`ADR-020-edf-adapter-refusals.md`](adr/ADR-020-edf-adapter-refusals.md:1) | The EDF/EDF+ adapter, and what it refuses (an extension-keyed format dispatch) |
| [`ADR-021-model-output-display-rule.md`](adr/ADR-021-model-output-display-rule.md:1) | The model-output view: declared semantics, the scored window, and one application door |
| [`ADR-022-repository-publication-and-licensing.md`](adr/ADR-022-repository-publication-and-licensing.md:1) | Repository Publication and Licensing |
| [`ADR-023-public-hosting-and-public-facing-documentation.md`](adr/ADR-023-public-hosting-and-public-facing-documentation.md:1) | Public Hosting and Public-Facing Documentation |

Two items in this register are worth knowing before reading anything else: **ADR-017**
governs every real-browser observation in this repository (recorded, never a gate; a
pending row is not a pass), and **ADR-010** governs optimization (measurement first, with
WASM DWT and WebGPU still deferred).

This handover creates **no** ADR and does not modify any.

---

## Open work queue

Prioritised, and every entry is traceable to a file + line, or to a command output quoted
above. Tags: **[science]**, **[docs]**, **[infra]**, **[owner]**.

### A. Verification still owed

1. **[science] The real-browser manual pass is open.** Unobserved rows: **B3–B4, C1–C5,
   D1–D4, E1–E4, F1–F2** (Part A) and **all of Part B** (B6-1…B6-7, B7-1…B7-5) —
   [`plans/phase-18-manual-verification.md`](phase-18-manual-verification.md:229),
   [`plans/phase-18-audit.md`](phase-18-audit.md:405),
   [`plans/phase-18-checkpoint.md`](phase-18-checkpoint.md:204). Observed **passing**:
   A1–A3 and B1–B2 (as reported), plus two extra confirmations — the whole folder can be
   handed to the ingestion control, and zooming re-windows the four `db4` levels of the
   DWT coefficient view ([`phase-18-manual-verification.md`](phase-18-manual-verification.md:226),
   [:220](phase-18-manual-verification.md:220), [:282](phase-18-manual-verification.md:282)).
2. **[science] Deployed-build ONNX inference is NOT established.** The hosted copy carries
   no dataset, and whether model inference loads in the deployed build has not been
   established ([`README.md`](../README.md:411)).
3. **[owner] The manual sweep is the only path to those rows.** There is no Playwright and
   no Vitest browser mode in this repository (ADR-012's no-new-dependency precedent), so
   the live canvas, the pointer gestures and the real `MessageEvent` channel are captured
   by hand ([`plans/phase-18-audit.md`](phase-18-audit.md:407)).
4. **[docs] The pending human rows also live in two earlier records** —
   [`plans/phase-16-manual-verification.md`](phase-16-manual-verification.md:1) and
   [`plans/phase-17-manual-verification.md`](phase-17-manual-verification.md:1); publishing
   the repository did not change their status
   ([`plans/repository-publication-plan.md`](repository-publication-plan.md:187)). A
   manifest of what a human must walk is therefore spread across three documents; the
   Phase-18 one is the newest and the one to work from.

### B. Documentation drift — statements now false

These are **documentation drift only**: no code depends on them. They are recorded here
so that a future reader does not repeat them, and they were **deliberately not edited** by
this handover (the change set was constrained to this document and one README bullet).
Correcting them is its own small, reviewed increment.

5. **[docs] "Record `101` is the only complete record."** — [`plans/phase-16-plan.md`](phase-16-plan.md:57)
   (`57–62`, which also reports the directory as holding only `100.atr`, `101.*`, `102.atr`,
   `102-0.atr`), [`plans/phase-16-manual-verification.md`](phase-16-manual-verification.md:23),
   [`plans/phase-17-manual-verification.md`](phase-17-manual-verification.md:24),
   [`plans/phase-18-manual-verification.md`](phase-18-manual-verification.md:44). Observed
   2026-09-14: the directory holds **48** `.hea` files and the probe resolves to **`100`**.
   The *manual* records' claims about `101` refer to the record the human actually
   ingested, which remains accurate about that run; the "only complete record" clause no
   longer describes the directory.
6. **[docs] "no `RECORDS`."** — [`plans/phase-16-plan.md`](phase-16-plan.md:58).
   `RECORDS` **is** present; it begins `101`, `102`, `103`.
7. **[docs] "record `213` lacks `.dat/.atr`."** — [`plans/ecg-lab-architecture.md`](ecg-lab-architecture.md:103)
   and, as a parenthetical example, [`plans/adr/ADR-006-dataset-abstraction.md`](adr/ADR-006-dataset-abstraction.md:24).
   `213.atr`, `213.dat` and `213.hea` are all present. The ADR's *reason* — never assume a
   local copy is complete, validate per record — is unaffected and still binding. **ADRs
   are historical records and must not be edited.**
8. **[docs] "not a git repository."** — [`plans/ecg-lab-architecture.md`](ecg-lab-architecture.md:19),
   [`plans/repository-publication-plan.md`](repository-publication-plan.md:9),
   [`plans/phase-18-checkpoint.md`](phase-18-checkpoint.md:19). The workspace **is** a git
   repository with a public remote and a nine-commit history.
9. **[docs] "`data/fixtures/` — empty directories."** — [`plans/ecg-lab-architecture.md`](ecg-lab-architecture.md:18).
   `git ls-files data` returns seven files under `data/fixtures/`.

### C. Known limitations carried forward

10. **[science] EDF+ TAL annotations and discontinuous `EDF+D` are unsupported.** Both are
    documented refusals, not silent partial reads; the excluded `EDF Annotations` signal is
    named in the record's `comments` and `annotations` stay empty
    ([`plans/phase-18-checkpoint.md`](phase-18-checkpoint.md:216),
    [`plans/phase-18-audit.md`](phase-18-audit.md:415)).
11. **[science] The EDF gate is hermetic.** It runs over `InMemoryFileSource` fixtures and
    never reads a real `.edf`; the only real-file EDF evidence would be the (pending)
    manual rows ([`plans/phase-18-audit.md`](phase-18-audit.md:418)).
12. **[docs] A dead, WFDB-only message survives in the UI.** `App.svelte` still contains
    "No WFDB records (.hea files) were found in the selection." and the picker hint says
    WFDB. They are unreachable (the newer classified throw fires first) and are pinned
    assertions, so they were not edited ([`plans/phase-18-audit.md`](phase-18-audit.md:411)).
13. **[infra] Browser-only modules are not unit-tested.** `browserWorkers.ts`,
    `browserDatasetService.ts` and `fileIngestion.ts` are covered by typecheck, lint and
    the production build only ([`plans/phase-18-audit.md`](phase-18-audit.md:423)).
14. **[infra] The deployment workflow deliberately runs no test gate.**
    [`.github/workflows/deploy-pages.yml`](../.github/workflows/deploy-pages.yml:1) states
    in its header comment that the suite has only ever been run on Windows and that
    passing on `ubuntu-latest` is unverified — so the gate was not wired in. **Adding one
    would first require validating the suite on Linux.** A failing *build* still blocks the
    deploy.

### D. Owner actions and routed candidates

15. **[docs] Reserved but absent screenshot: `docs/screenshots/05-model-output.png`.** The
    slot is documented and **must not be linked until the file exists**
    ([`docs/screenshots/README.md`](../docs/screenshots/README.md:196)). A directory listing
    shows only the four published PNGs (`01-app-startup`, `02-open-local-record`,
    `03-time-series`, `04-dwt-coefficients`) and `README.md`.
16. **[owner] Repository description and topics were never set.** The `gh` CLI is not
    installed, so this is a GitHub web-UI step
    ([`plans/repository-publication-plan.md`](repository-publication-plan.md:185)).
17. **[owner] A routed feature request is still open:** a gloss of what the annotation
    **symbols** mean. It was routed as a candidate, never patched mid-flight, with its
    claim-shaped failure mode named — a code-to-text table that translates a symbol into a
    clinical term stops being a quotation of the file and becomes a statement about the
    patient ([`plans/phase-18-manual-verification.md`](phase-18-manual-verification.md:222),
    [:302](phase-18-manual-verification.md:302),
    [`plans/phase-18-plan.md`](phase-18-plan.md:532)).
18. **[science] Candidates named but NOT approved:** EDF+ TAL support and `EDF+D`; a
    unit-converting adapter path; any third binary format as an adapter; running the model
    over many windows (an evaluation runner, metrics or a training path); dataset-level
    partitioning or experiment wiring for the new adapter
    ([`plans/phase-18-plan.md`](phase-18-plan.md:536)).
19. **[science] WASM DWT and WebGPU inference remain deferred** under the measurement-first
    policy, and a WASM path would need a parity gate before it could be trusted
    ([`plans/phase-18-checkpoint.md`](phase-18-checkpoint.md:242), ADR-010).
20. **[owner] No next phase is proposed, approved or authorized.** Phases 1–18 are complete;
    any next increment must be authored in **Architect** mode, itemized, with a green
    `npm run check` gate per item
    ([`plans/phase-18-checkpoint.md`](phase-18-checkpoint.md:225), [:247](phase-18-checkpoint.md:247)).

---

## Guardrails to re-read before touching anything

Read [`AGENTS.md`](../AGENTS.md:1) and
[`.roo/rules-code/01-medical-engineering.md`](../.roo/rules-code/01-medical-engineering.md:1)
**before** the first edit. Both are the constitution and neither is edited here. The
sections that matter most on a resume: **§1** (mission — and "this is not a medical
device"), **§2** (the pipeline stages stay separable), **§7** (DWT is a first-class,
inspectable subsystem), **§9** (models are versioned artifacts with contracts), **§11** (no
data leakage), **§12** (validation over appearance — a feature is not done because it
looks right), **§13** (numerical correctness and explicit edge-case handling), **§23**
(dependency discipline), **§27** (no placeholder engineering), **§28** (dataset
provenance), **§30** (the development protocol), **§33** (definition of done), **§34**
(absolute prohibitions), **§38** (privacy by default).

The **never** list of AGENTS.md §34, restated because it is the one most easily violated by
enthusiasm:

- Never fabricate scientific results or model performance.
- Never make a clinical claim, or imply diagnosis, certainty, triage or treatment.
- Never hide preprocessing.
- Never silently change units or a sampling rate.
- Never silently change what enters the model.
- Never swallow a numerical error.
- Never mix UI and DSP logic.
- Never weaken a test to pass a build — and never delete one.

**ADR-017 still governs screenshots and observations.** Capturing a real recording is
permitted only with the mandatory attribution, and a published figure is an observation,
never a verification. An unperformed row is not a pass.

**AGENTS.md §47/§48/§49 apply to every word written about the model.** The only committed
model is a development probe with an analytic oracle whose agreement is true by
construction; it is not a clinical classifier, and no accuracy, sensitivity, specificity,
AUC or validation claim may be made anywhere in this repository.

---

## What not to do on resume

- **Do not rewrite the architecture because another approach looks fashionable.** AGENTS.md
  §25 requires identifying the existing behaviour, the migration cost, the regression risk
  and the measured benefit first; prefer incremental evolution.
- **Do not add a dependency casually.** AGENTS.md §23 and rules §39: search the repository
  first, then weigh bundle size, maturity, browser compatibility, licence and scientific
  trustworthiness. `package.json` has a single runtime dependency and that is deliberate.
- **Do not collapse the pipeline.** Raw signal → preprocessing → DWT → features → tensor →
  inference → display stays conceptually and technically separable (AGENTS.md §2, rules
  §17/§28).
- **Do not replace or delete working tests** to make something pass (rules §57). If a test
  is wrong, say what is wrong with it and why.
- **Do not ship placeholder or scientific-looking fake output** (AGENTS.md §27). If the
  correct algorithm is not implemented, say so; never disguise a placeholder as real
  science.
- **Do not create a new ADR during a documentation-only pass**, and do not renumber or
  rewrite an existing one.
- **Do not commit anything from `data/`** beyond the deliberate `data/fixtures/` set, and
  never commit raw dataset bytes.
- **Do not publish a figure that renders a recording without its ODC-BY 1.0 attribution**
  (ADR-022). Omitting it is a licensing and provenance defect, not a formatting nit.
- **Do not promote a manual observation into a gate**, or a gate into an observation. The
  split is the point (ADR-017).

---

## First session back: resumption protocol

1. Clone (or enter) `c:/APPs/ECG DWT Analyzer`.
2. `npm ci` — **not** `npm install`; `package-lock.json` is authoritative and the lockfile
   must not be silently changed.
3. `npm run check` and compare against [Frozen state](#frozen-state):
   **66 test files / 838 tests / 181 modules, svelte-check 0 errors / 0 warnings, exit 0.**
   - If `data/raw/mitdb` is absent, the opt-in gates **skip**. That is expected on a clean
     clone, not a failure — and it means nothing about real data.
   - A divergence is a finding: investigate it before touching anything.
4. `npm run dev` and confirm the interface renders: the default synthetic record draws a
   signal and a DWT coefficient view, with no annotation legend and the caption
   "No annotations in view".
5. Confirm the hosted copy: the URL responds, and the latest `deploy-pages.yml` run's
   `head_sha` matches local `HEAD` (a documentation-only commit also triggers a rebuild, so
   re-check after any push).
6. Choose **one** entry from the [open work queue](#open-work-queue) — typically the
   highest-value [science] row, or a [docs] drift fix.
7. Read the affected code, its consumers and the ADR that governs it **before** editing
   (AGENTS.md §30 STEP 1: do not guess the existing system).
8. Make the **smallest coherent change** that solves the actual problem; do not bundle an
   opportunistic refactor with it (AGENTS.md §3 / rules §3).
9. Validate: `npm run check`, plus the evidence the change itself requires — numerical
   assertions for DSP (never a screenshot), tensor/contract assertions for ML, an explicit
   error for every rejected input.
10. Update this document: append a row to [Freeze history](#freeze-history) (date, commit,
    branch, gate result, live URL status), delete or amend the queue entries the change
    resolved, and record anything new the change revealed.
11. **Last step, and it comes before the code, not after:** if the change alters the
    architecture or a scientific assumption, write the ADR first.

---

## Housekeeping notes

Each item below was checked during the freeze, and each is described as it was observed.

- **The stray editor tab for `commit-message.txt`.** No such file is on disk
  (`dir commit-message.txt` → "file not found"), and `git log --all -- commit-message.txt`
  is empty — it was **never tracked**. The tab referred to nothing; there is no lost commit
  message.
- **The temporary `Snapshots/` folder** used for the capture handoff is **not** on disk
  (`dir /ad Snapshots` → not found) and `git log --all -- Snapshots` is empty — it was
  never tracked. Its contents were published under [`docs/screenshots/`](../docs/screenshots/README.md:1)
  as the four attributed PNGs.
- **A `npm run dev` process may still be running** in the owner's terminal (it was used for
  the dev-server asset probes). It holds the chosen port until that window is closed;
  nothing else in the project depends on it.
- **The toolchain is Windows-first.** The launcher is `App.cmd`, the gate has only ever
  been run on Windows, and the deployment workflow consequently runs no test gate. Do not
  assume Linux/macOS parity for `npm run check`; it has not been established.
- **Timestamps** in this document are ISO-8601. Editor state, terminal scrollback and
  browser-extension behaviour are not part of the repository and are not recorded here.
