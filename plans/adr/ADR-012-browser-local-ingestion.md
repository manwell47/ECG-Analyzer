# ADR-012 — Browser-local real-signal ingestion (WFDB)

Status: Accepted
Date: 2026-09-13
Scope: Phase 11 — read real WFDB/MIT-BIH files the user picks **locally in the
browser** through the existing `DatasetFileSource` seam. **Ingestion only** — no
parser, adapter, DSP/DWT, ML or worker algorithm changes; the correctness gate is
a **byte-identical `SignalRecord`** across every source implementation.

## Context

ADR-006 fixed the dataset boundary: the whole app depends on the canonical
`SignalRecord`, and `DatasetFileSource`
([`source.ts`](../../src/datasets/source.ts:20)) is the three-method seam
(`readTextFile`, `readBinaryFile`, `listFileNames`) that every MIT-BIH parser and
the adapter consume. Two implementations existed:

- [`InMemoryFileSource`](../../src/datasets/source.ts:48) — the hermetic fixture
  source used by every test;
- [`NodeFileSource`](../../src/datasets/nodeSource.ts:26) — the `node:fs` source,
  deliberately **not** re-exported from
  [`src/datasets/index.ts`](../../src/datasets/index.ts:1) so Vite never bundles
  `node:fs`.

The seam's own header anticipated "a future WASM/OPFS or remote source" dropping
in without touching the parsers. The gap, until now, was that the **browser could
only load the synthetic fixture**: the real MIT-BIH adapter was unreachable on the
web because no browser-side source existed. Filling that gap forces four decisions
the project had not yet recorded: how the browser selects files, how a
`RECORDS`-less selection is discovered, how the browser-only DOM type gap is
typed, and what exactly proves the new source is behaviour-preserving.

Constraints:

- **No science change** (rules §30): the parsers/adapter are consumed unchanged;
  the browser source adds no parsing and no DSP/DWT/ML logic.
- **Local-first** (ADR-006): no backend, no upload, no telemetry, no persistence —
  the bytes the user selects never leave the machine.
- **Portable floor, not a Chromium-only feature** (rules §56): the ingestion path
  must work in every browser **and** be exercisable in jsdom (which has no File
  System Access API and no `Worker`).
- **Parity, not UI or timing** is the gate: parsing identical bytes through every
  source must yield the identical canonical `SignalRecord` (cf. ADR-011's
  byte-identical worker gate); a wall-clock or DOM assertion is never the
  correctness proof.
- **No new dependency, no tsconfig lib change.**

## Decision

### (a) The source seam is the only insertion point

Add exactly **one** implementation of the existing seam —
[`WebFileSource`](../../src/datasets/fileSource.ts:56)
(`implements DatasetFileSource`) over the Web `File`/`Blob` API. Its input is a
minimal structural type so every producer funnels through one class:

```ts
export interface WebFileEntry {
    readonly name: string;
    arrayBuffer(): Promise<ArrayBuffer>;
}
```

A real `File` satisfies `WebFileEntry` directly, and Node defines a global
`File`/`Blob` with the same surface, so the class is **Node-testable and runs
unchanged in the browser**. Text uses `TextDecoder`; binary is
`new Uint8Array(await entry.arrayBuffer())`; a missing name throws the same
classified `file-not-found` shape as `InMemoryFileSource`; **duplicate bare
names** throw a classified `invalid-input` (an ambiguous dataset directory must
fail loudly, never silently shadow a record file). Names are bare: any directory
prefix a producer includes (`webkitRelativePath`, a walked handle path, a Windows
separator) is stripped by
[`bareFileName`](../../src/datasets/fileSource.ts:37), preserving the seam's
"file names are bare" contract. A `webFileSourceFrom(entries)` convenience
factory ([`fileSource.ts`](../../src/datasets/fileSource.ts:98)) mirrors the
`new InMemoryFileSource(...)` ergonomics. The module imports no `node:*`
built-in, so it is safe to export from the datasets barrel and to bundle for the
browser.

### (b) Portable base, File System Access as a thin progressive enhancement

Two selection mechanisms reduce to the **same** `WebFileSource`:

- **The guaranteed floor** — `<input type="file" multiple>` and a drop zone over
  the Web `File`/`Blob` API. It works in every browser, is keyboard-reachable,
  and is the path the jsdom slice exercises (jsdom implements `File`/`FileList`).
- **The enhancement** — a File System Access directory picker
  (`showDirectoryPicker()`), walked into entries and fed to the identical source.
  It is Chromium-only and therefore opt-in: no test depends on it, and when it is
  unsupported the control simply is not offered.

The browser glue lives in
[`fileIngestion.ts`](../../src/presentation/dataset/fileIngestion.ts:1):
[`webFileSourceFromFiles`](../../src/presentation/dataset/fileIngestion.ts:42)
and
[`webFileSourceFromDirectoryHandle`](../../src/presentation/dataset/fileIngestion.ts:52)
build the source, while
[`ingestFiles`](../../src/presentation/dataset/fileIngestion.ts:65) /
[`ingestDirectoryHandle`](../../src/presentation/dataset/fileIngestion.ts:73)
also discover the record ids;
[`pickDirectory`](../../src/presentation/dataset/fileIngestion.ts:91) returns
`undefined` on both "unsupported" and user cancellation (`AbortError`) so the
caller has no special case, and
[`isDirectoryPickerSupported`](../../src/presentation/dataset/fileIngestion.ts:81)
gates the enhancement. The WFDB recording layout is flat, so the handle walk
reads **top-level file entries only** — that keeps bare-name uniqueness
well-defined. The directory walk is the one browser-only capability that cannot
be unit-tested in jsdom; it is typecheck/lint/build-verified and validated
manually, and it is not the floor.

### (c) Browser record discovery is header-based; the strict path stays strict

`listMitBihRecordIds(source)` (the canonical `RECORDS` reader that throws
`file-not-found` when the control file is absent) is a Phase-5 validation
requirement and is **unchanged**; `catalogMitBih` stays strict for the same
reason. A locally picked folder or a multi-file selection usually carries **no
`RECORDS`**, so a separate pure helper is added:

```ts
export async function discoverMitBihRecordIds(
    source: DatasetFileSource,
): Promise<readonly RecordId[]>;
```

[`discoverMitBihRecordIds`](../../src/datasets/mitbih/catalog.ts:113) derives ids
from the `.hea` stems present, ignores every non-`.hea` entry, deduplicates the
stems and returns them in deterministic ascending order; an empty (or
header-less) selection yields `[]` rather than throwing. This is a **discovery**
relaxation, not a validation relaxation: the adapter's strict per-record
validation on `readRecord` is untouched, so a malformed or incomplete record
still fails loudly and classified. The CLI/validation path keeps requiring
`RECORDS`.

### (d) Correctness gate: byte-identical `SignalRecord` across sources

`src/datasets/__tests__/source.parity.test.ts` builds identical MIT-BIH bytes (a
`.hea` + a format-212 `.dat`) and reads them through **three** sources —
`InMemoryFileSource`, `NodeFileSource` (over a `node:os` tmpdir) and
`WebFileSource` (over Node's global `File`) — asserting identical
`readTextFile`/`readBinaryFile` results and a **deep-equal `SignalRecord`** from
`MitBihDatasetAdapter`, plus identical `recordToMillivoltSignal` output.
`src/datasets/__tests__/nodeSource.test.ts` pins the tmp-dir
listing/read/missing behaviours now that the Node source has a sibling. An
**opt-in** `src/datasets/__tests__/realData.integration.test.ts` reads one real
`data/raw/mitdb` record when present and is otherwise **skipped** (`it.skipIf` on
a filesystem probe), so the default suite never depends on the gitignored
dataset. This byte-identical parity — never a UI/DOM assertion and never a
timing — is the gate that proves the new source is behaviour-preserving.

### (e) One service, two dataset bindings; the UI calls only the service

`main.ts` keeps booting the synthetic default over the worker-backed
`DspExecutor` (unchanged). A browser factory builds the **same**
`RecordAnalysisService` over the picked source:
[`createBrowserDatasetService`](../../src/presentation/dataset/browserDatasetService.ts:42)
composes the unchanged `MitBihDatasetAdapter` with a dedicated DSP worker
(mirroring [`browserWorkers.ts`](../../src/presentation/workers/browserWorkers.ts:103)),
and
[`prepareBrowserDataset`](../../src/presentation/dataset/browserDatasetService.ts:67)
returns the shape the UI needs (a service + the discovered ids + a release hook).
The presentation layer gains a thin, **fully controlled** ingestion control —
[`DatasetPicker.svelte`](../../src/presentation/dataset/DatasetPicker.svelte:1)
— that emits the selected `File[]`, and `App.svelte` still calls **only**
`service.analyze` / `service.listRecordIds`. The canonical DWT stays
`db4 / 4 / periodic`; a real record too short to host it surfaces the existing
classified `invalid-input` error rather than any new UI-owned science decision
(ADR-008/009 hold). No science configuration is invented in the UI.

### (f) DOM-lib type gap handled by a local ambient declaration

TypeScript's `lib.dom.d.ts` declares `FileSystemDirectoryHandle` /
`FileSystemFileHandle` but **not** `values()` nor `showDirectoryPicker`. Rather
than add a lib/dependency, a tiny module-local ambient declaration
([`fileSystemAccess.d.ts`](../../src/presentation/dataset/fileSystemAccess.d.ts:1))
supplies the minimal shapes, merged into the existing handle interfaces plus one
new global. `tsconfig.json` is unchanged — no `webworker`/extra lib and no new
dependency (the same "keep the shared code DOM-lib-typed, add no conflicting lib"
stance as ADR-011(f)).

### (g) Local-first restated

Ingestion reads bytes the user selected on their own machine and feeds them to
the in-tab analysis pipeline. There is **no backend, no upload, no telemetry, no
persistence**: no file bytes are stored anywhere by the app, and `data/raw` /
`data/processed` remain gitignored (ADR-006). Browser ingestion changes *where the
bytes come from*, not *where they go*.

### (h) Resource release

Replacing a local dataset releases the previous one: `main.ts` calls
`terminate()` on the superseded `BrowserDatasetService` (which disposes the DSP
worker) before adopting a new selection, and the existing `pagehide` listener
releases the active service on context teardown — no worker leaks across a
dataset change (ADR-011(h); AGENTS §15).

## Consequences

- The browser can analyze **real WFDB/MIT-BIH records the user selects locally**,
  without a backend and without anything leaving the machine; the historical
  "browser can only load the synthetic fixture" gap is closed.
- **The science is unchanged.** Parsers, adapter, DSP/DWT and ML are consumed
  unchanged; the new source is a seam implementation, and the byte-identical
  `SignalRecord` parity test — not any UI assertion — proves it.
- **Bundle stays node-safe.** `WebFileSource` imports no `node:*` and is
  exported; `NodeFileSource` stays unexported, so the build still cannot pull
  `node:fs` into the web bundle (confirmed in the build check).
- **Testability split is explicit.** `WebFileSource` and
  `discoverMitBihRecordIds` are Node-testable (global `File`; pure helper) and are
  covered by the default suite, including the cross-source parity gate. The
  browser-only glue (`fileIngestion.ts`, `browserDatasetService.ts`,
  `DatasetPicker.svelte`, the ambient `.d.ts`) is typecheck/lint/build-verified —
  not vitest-covered, because vitest only scans `*.test.ts` — and the directory
  handle walk is additionally validated manually under `npm run dev`.
- **Ranked guarantees, honestly stated:** the `<input type=file>` / drag-drop path
  is the guaranteed portable floor; the File System Access directory picker is a
  Chromium-only progressive enhancement, and no correctness claim depends on it.
- **What it does not prove:** parity proves the *source seam* is
  behaviour-preserving; it does **not** claim arbitrary user files are clinically
  valid, does not re-derive WFDB semantics (the parsers are unchanged and already
  gated), and adds no clinical/model-quality claim (rules §47/§49; ADR-009).
- **No new dependency and no tsconfig change** were required; the DOM gap was
  closed with a local ambient declaration.

## References

- Architecture plan §J (dataset architecture — seam realization), §M item 11
  (Phase 11), decision register (ADR-012)
- [`plans/phase-11-plan.md`](../../plans/phase-11-plan.md) — approved scope and
  item-by-item gates
- ADR-006 (dataset abstraction — the seam this implements), ADR-008/ADR-009
  (selection is a display concern; no UI-owned science), ADR-011 (the
  byte-identical parity gate pattern this mirrors)
- Rules §30 (no duplicated science), §56 (green check gate); AGENTS §11/§15
  (local-first data; resource release)
