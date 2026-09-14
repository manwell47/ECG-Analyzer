# Phase 11 Audit / Completion — Browser-local real-signal ingestion (WFDB)

Recorded 2026-09-13 (Code-mode completion record). Verdict: **Phase 11 implemented
and fully green.** The full `npm run check` gate passes at the end of every item
and again as the final gate: typecheck ✓, svelte-check (0 errors / 0 warnings) ✓,
lint ✓, **57 test files / 556 tests** ✓, Vite build ✓ (**165 modules**).
**Ingestion only:** no scientific algorithm changed; the correctness gate is a
**byte-identical `SignalRecord`** across every `DatasetFileSource`
implementation, never a UI/DOM assertion and never a timing assertion (rules
§51). The browser can now read real WFDB/MIT-BIH files the user selects locally,
and nothing leaves the machine.

## Scope / approved increment

> "Portable base: `<input type=file multiple>` plus drag-drop over the Web
> `File`/`Blob` API (works everywhere, incl. jsdom tests), with the File System
> Access directory picker layered on as a progressive enhancement. Parity gate is
> hermetic: identical bytes through `InMemoryFileSource`, `NodeFileSource` (temp
> dir) and the new `WebFileSource` must yield byte-identical `SignalRecord`, plus
> an opt-in real-data test that skips when `data/raw/mitdb` is absent."

This is an **ingestion** increment, not an analysis or optimization increment. No
scientific algorithm, DSP/DWT, ML or worker code changed.

## Files added

| Purpose | File |
|---|---|
| Browser `DatasetFileSource` over the Web `File`/`Blob` API (`WebFileEntry`, `WebFileSource`, `bareFileName`, `webFileSourceFrom`) | [`src/datasets/fileSource.ts`](../src/datasets/fileSource.ts:1) |
| Source-contract tests for `WebFileSource` (UTF-8 round-trip, byte-verbatim, list, empty, missing classified, duplicate classified, path-prefix stripping) | [`src/datasets/__tests__/fileSource.test.ts`](../src/datasets/__tests__/fileSource.test.ts:1) |
| Node↔browser source-seam parity gate (byte-identical `SignalRecord`) | [`src/datasets/__tests__/source.parity.test.ts`](../src/datasets/__tests__/source.parity.test.ts:1) |
| `NodeFileSource` temp-dir coverage (listing / read / missing) | [`src/datasets/__tests__/nodeSource.test.ts`](../src/datasets/__tests__/nodeSource.test.ts:1) |
| Opt-in real-data test (skipped when `data/raw/mitdb` is absent) | [`src/datasets/__tests__/realData.integration.test.ts`](../src/datasets/__tests__/realData.integration.test.ts:1) |
| Thin, fully controlled ingestion control (file input + drop zone + optional folder button) | [`src/presentation/dataset/DatasetPicker.svelte`](../src/presentation/dataset/DatasetPicker.svelte:1) |
| Browser glue: `FileList` / directory handle → `WebFileSource` + record discovery | [`src/presentation/dataset/fileIngestion.ts`](../src/presentation/dataset/fileIngestion.ts:1) |
| Worker-backed service factory over a picked source (`createBrowserDatasetService`, `prepareBrowserDataset`) | [`src/presentation/dataset/browserDatasetService.ts`](../src/presentation/dataset/browserDatasetService.ts:1) |
| Minimal ambient File System Access types (DOM-lib gap) | [`src/presentation/dataset/fileSystemAccess.d.ts`](../src/presentation/dataset/fileSystemAccess.d.ts:1) |
| ADR-012: browser-local ingestion | [`plans/adr/ADR-012-browser-local-ingestion.md`](adr/ADR-012-browser-local-ingestion.md:1) |
| Phase 11 audit (this record) | [`plans/phase-11-audit.md`](phase-11-audit.md:1) |

**Touched:**

- [`src/datasets/index.ts`](../src/datasets/index.ts:1) — exports `./fileSource`
  (browser-safe; imports no `node:*`). `nodeSource` stays **non-exported**.
- [`src/datasets/mitbih/catalog.ts`](../src/datasets/mitbih/catalog.ts:113) —
  added `discoverMitBihRecordIds` (header-based, `RECORDS`-less). The strict
  `listMitBihRecordIds` and `catalogMitBih` are unchanged.
- [`src/datasets/mitbih/__tests__/catalog.test.ts`](../src/datasets/mitbih/__tests__/catalog.test.ts:1)
  — discovery cases (RECORDS-less dir, ordering, non-`.hea` ignored, empty).
- [`src/presentation/App.svelte`](../src/presentation/App.svelte:1) — an
  injected-factory ingestion control gated on `prepareLocalDataset !== undefined`
  (so the default markup is unchanged), `$state.raw` handles, and the
  `analyzeRecordById` refactor.
- [`src/main.ts`](../src/main.ts:34) — wires `prepareLocalFiles` / `openLocalFolder`
  via `ingestFiles` / `ingestDirectoryHandle` / `createBrowserDatasetService` /
  `pickDirectory`, and releases a superseded dataset.
- [`src/presentation/__tests__/App.test.ts`](../src/presentation/__tests__/App.test.ts:38)
  — one new file-selection case; the existing five cases are unchanged.
- [`plans/ecg-lab-architecture.md`](ecg-lab-architecture.md:279) — §J
  (seam realized), §M item 11, the decision register (+ADR-012), and the
  open-decisions raw-data note refreshed.

**Not touched (by design):** parsers
[`header.ts`](../src/datasets/mitbih/header.ts:1) / `format212.ts` / `atr.ts` and
[`adapter.ts`](../src/datasets/mitbih/adapter.ts:182);
[`source.ts`](../src/datasets/source.ts:1) /
[`nodeSource.ts`](../src/datasets/nodeSource.ts:26) /
[`load.ts`](../src/datasets/load.ts:35); all of `src/dsp/**`, `src/ml/**`,
`src/workers/**`, `src/domain/**`; and
[`vite.config.ts`](../vite.config.ts:1) / [`tsconfig.json`](../tsconfig.json:1)
(no lib/dependency change — the File System Access type gap is closed with a local
ambient declaration). Rules §30 (no duplicated science) held throughout.

## Item-by-item mapping

0. **Pre-flight** — `npm run check` green (53 files / 530 tests, 149 modules); no
   code change.
1. **`WebFileSource` + unit tests** — `fileSource.ts` + `fileSource.test.ts`;
   exported from the datasets barrel; `npm run check` green (**54 files / 541
   tests**; +11).
2. **Browser record discovery** — `discoverMitBihRecordIds` in `catalog.ts` +
   discovery cases; `npm run check` green (**54 files / 546 tests**; +5).
3. **Source-seam parity + `NodeFileSource` coverage** — `source.parity.test.ts` +
   `nodeSource.test.ts` + opt-in `realData.integration.test.ts`; `npm run check`
   green (**57 files / 555 tests**; +9; default suite passes with the raw dataset
   absent).
4. **Presentation ingestion control + browser glue** — `DatasetPicker.svelte`,
   `fileIngestion.ts`, `browserDatasetService.ts`, the ambient `.d.ts`;
   `npm run check` green (**57 files / 555 tests, 149 modules**); build confirmed
   to pull no `node:fs`.
5. **Wire into the app + extend the jsdom slice** — `App.svelte` ingestion control,
   `main.ts` factory wiring, one new `App.test.ts` case (existing five unchanged);
   `npm run check` green (**57 files / 556 tests; 165 modules**).
6. **ADR-012 + architecture update** — ADR-012 written; §J / §M item 11 / decision
   register updated; open-decisions raw-data note refreshed; `npm run check` green
   (**57 files / 556 tests, 165 modules** — docs-only, counts unchanged).
7. **Audit + final gate (this record)** — final full `npm run check` green
   (**57 files / 556 tests, 165 modules**).

## Parity evidence (the correctness gate)

The only correctness claim is that the new browser source is
**behaviour-preserving**: the same bytes parsed through a browser-only source and
through the Node/in-memory sources yield the **same** canonical `SignalRecord`.
That is pinned, not asserted:

- [`source.parity.test.ts`](../src/datasets/__tests__/source.parity.test.ts:1)
  builds identical MIT-BIH bytes (a `.hea` + a format-212 `.dat`) and reads them
  through **three** sources — [`InMemoryFileSource`](../src/datasets/source.ts:48),
  [`NodeFileSource`](../src/datasets/nodeSource.ts:26) (over a `node:os` tmpdir)
  and [`WebFileSource`](../src/datasets/fileSource.ts:56) (over Node's global
  `File`) — asserting identical `readTextFile` / `readBinaryFile` results and a
  **deep-equal `SignalRecord`** from
  [`MitBihDatasetAdapter`](../src/datasets/mitbih/adapter.ts:182), plus identical
  `recordToMillivoltSignal` output (identity, subjectId, sampling, per-channel
  samples / calibration / unit, annotations, provenance).
- [`fileSource.test.ts`](../src/datasets/__tests__/fileSource.test.ts:1) pins the
  seam contract itself (bare-name stripping, UTF-8 round-trip, verbatim bytes,
  empty file, classified `file-not-found`, classified duplicate-name error).
- [`nodeSource.test.ts`](../src/datasets/__tests__/nodeSource.test.ts:1) pins the
  Node source's tmp-dir listing / read / missing behaviours now that it has a
  sibling implementation.
- [`realData.integration.test.ts`](../src/datasets/__tests__/realData.integration.test.ts:1)
  reads a real `data/raw/mitdb` record when present and is **skipped** otherwise
  (`it.skipIf` on a filesystem probe), so the default suite never depends on the
  gitignored dataset (ADR-006).
- [`App.test.ts`](../src/presentation/__tests__/App.test.ts:271) drives the real
  `ingestFiles` → `WebFileSource` → `discoverMitBihRecordIds` → adapter → service
  path over genuine `File` objects in jsdom and asserts the picked identity and the
  stable analysis id render — the proof analysis actually resolved through the
  application service, not merely that a control appeared.

## Decisions recorded (ADR-012)

1. **The source seam is the only insertion point** — one
   [`WebFileSource`](../src/datasets/fileSource.ts:56) implements
   `DatasetFileSource`; parsers/adapter are consumed unchanged (rules §30).
2. **Portable base, File System Access as a thin enhancement** — `<input
   type=file multiple>` / drag-drop is the guaranteed, jsdom-testable floor;
   `showDirectoryPicker()` is a Chromium-only progressive enhancement nothing
   depends on.
3. **Browser discovery is header-based; the strict path stays strict** —
   [`discoverMitBihRecordIds`](../src/datasets/mitbih/catalog.ts:113) derives ids
   from `.hea` stems (sorted, deduplicated, `[]` when none); `listMitBihRecordIds`
   and `catalogMitBih` still require `RECORDS` for the CLI/validation path.
4. **Correctness gate = byte-identical `SignalRecord` across sources**, never a
   UI/DOM or timing assertion (rules §51).
5. **One service, two dataset bindings; the UI calls only the service** —
   `createBrowserDatasetService` composes the unchanged adapter with a worker
   `DspExecutor`; `App.svelte` still calls only `service.analyze` /
   `service.listRecordIds`; no UI-owned science (ADR-008/009 hold).
6. **DOM-lib type gap closed locally** — a module-local ambient declaration
   supplies the missing File System Access shapes; no new dependency and no
   tsconfig lib change.
7. **Local-first restated** — no backend, no upload, no telemetry, no
   persistence; `data/raw` / `data/processed` remain gitignored (ADR-006).
8. **Resource release** — replacing a local dataset terminates the superseded
   `BrowserDatasetService` (disposing its DSP worker); the `pagehide` listener
   releases the active service (ADR-011(h); AGENTS §15).

## What browser ingestion proves and does not prove

**Proves** — the browser can read real WFDB/MIT-BIH files the user picks locally,
and the new source is behaviour-preserving: identical bytes through
`InMemoryFileSource` / `NodeFileSource` / `WebFileSource` yield a byte-identical
`SignalRecord`, and the jsdom slice resolves the selected record through the real
application service. It proves the browser bundle still builds without `node:fs`
and that the ingestion glue is typecheck/lint/build-clean.

**Does not prove** — any claim that arbitrary user files are clinically valid, any
re-derivation of WFDB semantics (the parsers are unchanged and already gated), or
any clinical / model-quality property (rules §47/§49; ADR-009). Parity is about
the **source seam**, not about file correctness. The File System Access directory
picker is Chromium-only and not covered by any test; the portable file-input path
is the correctness-relevant floor.

## Residual risk

- **The browser-only glue is not unit-tested** —
  [`fileIngestion.ts`](../src/presentation/dataset/fileIngestion.ts:1),
  [`browserDatasetService.ts`](../src/presentation/dataset/browserDatasetService.ts:1),
  [`DatasetPicker.svelte`](../src/presentation/dataset/DatasetPicker.svelte:1) and
  the ambient `.d.ts` touch browser globals and are covered by typecheck + lint +
  build only (vitest scans `*.test.ts`). Everything they call
  (`WebFileSource`, `discoverMitBihRecordIds`, the adapter, the service) is
  Node-tested.
- **The directory-handle walk is Chromium-only and unverified by a test** — it is
  the enhancement, not the floor; the top-level-only walk is a deliberate choice
  (flat WFDB layout) that keeps bare-name uniqueness well-defined.
- **Real Firefox/Safari behaviour is validated manually** — the jsdom slice is
  faithful for the file-input path but is not a browser; end-to-end local
  ingestion is exercised by hand under `npm run dev`.

## Test counts

Final `npm run check`: **57 test files / 556 tests** (Phase-10 close: 53 / 530;
+4 files, +26 tests). Build: **165 modules** (Phase-10 close: 149; the browser
glue + ingestion control are new browser-only modules).

New test files and their contributions:

| File | Tests |
|---|---|
| [`fileSource.test.ts`](../src/datasets/__tests__/fileSource.test.ts:1) | +11 |
| [`source.parity.test.ts`](../src/datasets/__tests__/source.parity.test.ts:1) | +4 |
| [`nodeSource.test.ts`](../src/datasets/__tests__/nodeSource.test.ts:1) | +4 |
| [`realData.integration.test.ts`](../src/datasets/__tests__/realData.integration.test.ts:1) | +1 (skipIf-gated) |

Added to existing files: [`catalog.test.ts`](../src/datasets/mitbih/__tests__/catalog.test.ts:1)
(+5 discovery cases) and [`App.test.ts`](../src/presentation/__tests__/App.test.ts:271)
(+1 file-selection case; the previous five unchanged).

**Gate history:** 0 → 53/530/149 · 1 → 54/541 · 2 → 54/546 · 3 → 57/555 · 4 →
57/555/149 · 5 → 57/556/165 · 6 → 57/556/165 · 7 → 57/556/165.
