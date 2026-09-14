# Screenshots — capture protocol and published set

Real-browser screenshots of the application, referenced from the top-level
[`README.md`](../../README.md). This document is two things at once:

- the **capture protocol** — what may be captured, and under which privacy and
  licensing constraints; and
- the **record of what was actually published**, including the places where the
  published set diverges from the plan that preceded the captures.

It is a protocol and a provenance record, not a verification artifact.

## Why this protocol exists

A screenshot shows *appearance*, not *evidence*. [`AGENTS.md`](../../AGENTS.md) §12
("validation over appearance") and
[`ADR-017`](../../plans/adr/ADR-017-real-data-verification.md) are explicit: an interactive
pass is a recorded observation, it is never a gate, and an unperformed row is not a
pass. Consequently:

- A screenshot **never** substitutes for a row in
  [`plans/phase-18-manual-verification.md`](../../plans/phase-18-manual-verification.md).
- A caption must describe what the panel shows, in the wording the software itself
  uses. It must not claim clinical validity, diagnosis, or calibrated confidence
  (rules §48, §49; [`ADR-021`](../../plans/adr/ADR-021-model-output-display-rule.md)).
- Screenshots are captured by a human in a real browser. Nothing in this repository
  generates them, and no automated test asserts on them — rules §35 forbids relying
  on snapshot-style assertions for scientific correctness.
- Nothing in the figure may be read as a measurement of model quality. The published
  figures contain no accuracy, sensitivity, specificity or validation claim, and none
  may be added to a caption.

## Capture subject

On a fresh clone the application boots on the deterministic **synthetic** dataset
with no dataset file, no folder access and no network I/O. From
[`src/application/defaults.ts`](../../src/application/defaults.ts:40):

| Setting | Value |
| --- | --- |
| Record | `sync` (canonical default of the synthetic dataset) |
| Sampling rate / length | 360 Hz, 3600 samples |
| Wavelet | `db4`, 4 levels, `periodic` extension |
| Filtering | none (the default analysis is unfiltered) |

Capturing that state is preferable because:

- anyone can reproduce the exact figure after `npm install && npm run dev`, with no
  access to a licensed dataset;
- the repository then contains no third-party dataset imagery at all, which is the
  narrower governance position — a real-record figure is permitted (see below), but
  as an attributed exception rather than as the default;
- the figure stays valid as the default configuration evolves.

The published set is not confined to that default: three of the four figures show a
real MIT-BIH record, which is why the attribution conditions below are load-bearing
rather than decorative.

### A real-record capture is permitted, with attribution

Capturing a real PhysioNet recording **is** allowed. The project owner granted that
explicitly on 2026-09-14, and the grant is recorded in
[`ADR-022`](../../plans/adr/ADR-022-repository-publication-and-licensing.md) under the rules
§61 override protocol. The permission is conditional, and the conditions are part of
the decision rather than decoration:

- **Attribution is mandatory**, in both the caption and the surrounding prose: the
  record identifier, the channel name, "MIT-BIH Arrhythmia Database", PhysioNet, the
  ODC-BY 1.0 licence and the source URL. Publishing a derived figure without it is a
  licensing and provenance defect (AGENTS.md §28).
- **Name the record and channel you actually load** — read them off the panel in
  front of you, never off an older document. `data/raw/mitdb` is fetched by the user
  rather than committed, so its contents differ between machines, and so does the
  record the application opens by default. Earlier plans in this repository describe a
  partial local copy whose only complete record was `101`;
  [`firstCompleteRecordId()`](../../src/datasets/__tests__/realRecordSupport.ts:37)
  instead takes the lexicographically first complete stem. The set published below was
  verified by reading the loaded record off the rendered interface: record `100`,
  channel `MLII`, 360 Hz, 650 000 samples. That is a fact about the checkout that
  produced these four files, not a fact about *your* checkout.
- **No patient metadata may be visible.** The MIT-BIH `.hea` header comments carry
  demographic and medication information — record `100`'s comments, for instance,
  state age/sex/height/weight and two drug names. Header text, metadata tables and
  annotation-derived patient information must never enter the frame.
- **The figure count is bounded by the decision.** `ADR-022` item 8 was first
  written for *one* attributed dataset-derived figure, while the published set
  contains three. The project owner resolved that gap on 2026-09-14 by instructing
  that the uploaded captures be published, and item 8 has since been amended to admit
  this set while restating the same three conditions unchanged. The three
  dataset-derived figures named in this file — `02-open-local-record.png`,
  `03-time-series.png` and `04-dwt-coefficients.png` — are therefore the authorised
  set; a further one would need a new owner decision recorded in item 8.

## Procedure (Windows 11, human, real browser)

1. In the repository root run `npm run dev` and note the local URL it prints.
2. Open that URL in a **Chromium-based** browser. Use a real browser, not a
   headless or jsdom environment — the point of the capture is the rendered
   application.
3. Hard-reload (`Ctrl+Shift+R`) so the capture shows the current build, and let the
   default analysis finish before capturing.
4. Set the window to a normal desktop size (roughly 1600×900 or comparable) rather
   than a maximised 4K window; text stays legible and the file stays small.
5. Capture only the application region with `Win+Shift+S` (Snipping Tool) — do
   **not** capture the whole desktop.
6. Save the PNG into this directory using the exact filenames listed below. The
   README links are written against these names; a different name means a broken
   image.

## Privacy rules while capturing

Biomedical data and the local environment are both sensitive
([`AGENTS.md`](../../AGENTS.md) §17–§18; rules §38):

- **Never** capture the operating-system file or folder picker: it exposes a local
  path such as `C:\Users\<name>\…`, which leaks the machine's directory layout and
  a username. If a capture needs to show ingestion, show the in-page file input or the
  drop zone with files already chosen — the application's own picker renders inside
  the page and exposes no path.
- Do not capture DevTools, the terminal, the taskbar, notifications, or window
  titles.
- Do not capture a waveform from a record whose terms forbid redistribution. For the
  permitted MIT-BIH capture the ODC-BY 1.0 attribution is mandatory, and identifying
  metadata — in particular the `.hea` header comments — must stay out of the frame.
- Crop tightly to the application viewport. A full-desktop grab fails this rule
  regardless of what it shows.

## Size and framing

Keep each PNG under roughly 300 KB, and keep the frame inside the application
viewport rather than the desktop. If a capture exceeds the size budget, re-crop
rather than rescale: a rescaled plot is no longer a faithful rendering of the
interface, and a rescaled axis is a claim about scale that the figure cannot support.
None of the published four required correction — all are between 82 KB and 103 KB, and
none has the dimensions of a full-screen grab.

## The published set

All four figures are attributed where they render dataset data, and all four were
captured by a human in a real browser with the application's own panels visible. The
"caption must state" column is a requirement on the caption in
[`README.md`](../../README.md), not a suggestion.

| File | Captured from | Subject | The caption must state |
| --- | --- | --- | --- |
| `01-app-startup.png` | `Captura de pantalla 2026-09-14 153611.png` | First paint on the deterministic synthetic default: record summary `synthetic / sync`, channel `lead-a`, viewport `Full record` | that the signal is synthetic (`sync`), the sampling rate, and the units on both axes (time as `sampleIndex / fs` in seconds; amplitude in mV) |
| `02-open-local-record.png` | `Captura de pantalla 2026-09-14 152318.png` | The "Local dataset (WFDB)" panel with four files chosen through the in-page input, and the loaded record summary | that the files were chosen through the in-page picker and read in the browser (nothing uploaded, no local path shown), plus the attribution block for the MIT-BIH record |
| `03-time-series.png` | `Captura de pantalla 2026-09-14 152346.png` | Time-series view of the real record, channel `MLII`, viewport `Full record` | the record id and channel, the sampling rate and duration, that the annotation markers are the dataset's own reference annotations overlaid display-only, the units, and the attribution block |
| `04-dwt-coefficients.png` | `Captura de pantalla 2026-09-14 152406.png` | DWT coefficient view for `db4`, 4 levels, `periodic`, with its nominal dyadic bands | that the bands are approximate, derived arithmetically from the sampling rate and the level, that they are not clinical frequency bands (rules §12), and the attribution block |

### What each figure was verified to show

Verification method: the four files were inspected programmatically (byte size, pixel
dimensions) and their rendered text was extracted with OCR on the actual pixels, then
cross-checked against the Svelte templates and geometry helpers that produce those
strings. The statements below are what the images were found to contain.

- **`01-app-startup.png`** (89 693 bytes, 957 × 909). Heading "ECG Signal Processing &
  AI Analysis Laboratory"; the "Local dataset (WFDB)" panel with its empty in-page
  file input; record summary `synthetic / sync` with `Subject sync`; an analysis id of
  the form `<dataset>/<record> :: dwt-db4-level4-periodic`; view controls with channel
  `lead-a` and viewport `Full record`; and the time-series view with its canvas note.
  No real data and no model panel appear in this frame.
- **`02-open-local-record.png`** (88 907 bytes, 958 × 701). The ingestion panel with
  four files already chosen, the discovered-record list showing the MIT-BIH record
  `100`, the loaded record summary `mit-bih-arrhythmia / 100`, and the view controls
  with channel `MLII` and viewport `Full record`. The browser file-input strings are
  the *page's own* control: no operating-system picker, no path and no file name from
  the local disk appear anywhere in the frame.
- **`03-time-series.png`** (82 141 bytes, 945 × 684). Time-series view with the
  readout `MLII Unit:mV Sample rate: 360 Hz 650000 samples t = 0.00 s 1805.56 s
  Annotations: 2274 in View (1554 merged) Cursor:— Annotation:—`, the symbol legend
  `Symbols: + A I N V`, and the bounded annotation list (`Showing first 200 of 2274 in
  View`). Amplitude is therefore in millivolts, time is derived from the sample rate,
  and the recorder's cursor and annotation readouts are both empty in this frame.
- **`04-dwt-coefficients.png`** (102 487 bytes, 944 × 734). DWT coefficient view with
  `Wavelet db4`, `Level 4`, `Extension periodic`; the level-1 detail band labelled
  `≈ 90-180 Hz` over 325 000 coefficients; the remaining detail bands `≈ 45-90`,
  `≈ 22.5-45`, `≈ 11.25-22.5 Hz` and the approximation `≈ 0-11.25 Hz`; the source noted
  as 650 000 samples at 360 Hz; the on-screen disclaimer that band frequencies are
  derived from the sample rate and level and are approximate, not clinical-band
  claims; and the "Model output (development probe)" panel showing its control, with
  **no score displayed** — this frame does not depict a completed inference.

The band labels were checked against
[`coefficientGeometry.ts`](../../src/presentation/views/dwt/coefficientGeometry.ts:136),
where `detailFrequencyBandHz(level, fs)` is `[fs / 2^(j+1), fs / 2^j]` and
`approximationFrequencyBandHz` is `[0, fs / 2^(level+1)]` — at 360 Hz, 4 levels, that
is exactly the series above.

Every figure satisfies the privacy rules: no operating-system picker, no local path,
no window title, no taskbar, no DevTools, and no `.hea` header metadata. The `Subject`
row renders the record's subject identifier, which for MIT-BIH is the record id, so it
duplicates `100` rather than revealing demographic data.

## Reserved slot — `05-model-output.png` (not yet captured)

`05-model-output.png` is **reserved and currently unused**. It is documented here so
the next capture does not collide with the numbering, and so nobody adds it to
[`README.md`](../../README.md) by anticipation:

- The name must **not** be linked from [`README.md`](../../README.md), or from anywhere
  else, until the file exists. A link to a missing file renders as a broken image.
- The capture it is reserved for is the probe model's output panel *after* a committed
  window has been scored on the synthetic default. The caption must state that this is
  the development probe model on a synthetic signal, that the value is a model score
  or predicted probability rather than calibrated confidence, that the model's own
  metadata describes it as a seam-validation oracle rather than a physiological
  classifier, and that it carries no clinical meaning.
- The published set contains no such figure: `04-dwt-coefficients.png` shows the model
  panel with its control unrun. No claim about deployed inference may be made from any
  published figure.

## Divergence from the pre-capture plan

The plan that preceded the captures allocated `01-time-series.png`,
`02-dwt-coefficients.png`, `03-model-output.png` and an optional `04-real-record.png`,
expecting a synthetic record analysed one panel at a time plus at most one real-record
figure. The captures took a different route: they record a session that starts on the
synthetic default and then loads a real record, so the set is organised by *step of the
workflow* rather than by *panel*.

What was decided, and why:

- **The table was revised to match the images; the images were not renamed to match the
  plan.** The plan predated the captures and is not the artifact of record. Renaming
  real-record figures `01`–`04` to fit a synthetic-panel table would have produced four
  misleading filenames and captions that contradict the pixels.
- **`04-real-record.png` was superseded rather than reused.** Three of the four figures
  (`02`, `03`, `04`) show real MIT-BIH data, so a single name implying one real-record
  figure would misdescribe the set. The real-data captures are identified by their
  subject in the table and all carry the attribution block.
- **The reserved `05-model-output.png` slot is new, and the old `03-model-output.png`
  slot is retired.** No capture in the published set shows a completed probe
  prediction, so the reserved name was moved to the first free index to keep the
  published sequence gap-free while still reserving the capture that is missing.
- **The gap against `ADR-022` item 8 is closed by an owner decision.**
  [`ADR-022`](../../plans/adr/ADR-022-repository-publication-and-licensing.md) item 8 was written
  for exactly one attributed dataset-derived figure; the published set contains three. On
  2026-09-14 the project owner instructed that the uploaded captures be published, and that
  instruction is what widened the scope: item 8 has been amended to admit this set and to
  restate the same three conditions, binding any further dataset-derived figure to a new owner
  decision recorded there. The sequence stays honest — the item admitted one, reality ran ahead
  of the plan, and the decision was brought up to date rather than the figures being cut back
  to fit a stale limit.

## Attribution conditions for the published figures

The three figures that render MIT-BIH data carry the following attribution in
[`README.md`](../../README.md), satisfying the three conditions of `ADR-022` item 8:

- **Record identifier and channel** — record `100`, channel `MLII`, MIT-BIH Arrhythmia
  Database.
- **Dataset, source and licence** — MIT-BIH Arrhythmia Database, PhysioNet,
  `https://physionet.org/content/mitdb/`, Open Data Commons Attribution License v1.0,
  `https://opendatacommons.org/licenses/by/1-0/`.
- **Indication of modification, and no patient metadata in frame** — the dataset is not
  redistributed by this repository; the figures are interface renderings produced by
  this application from a locally fetched copy, and the `.hea` header comments (age,
  sex, height, weight, medication) do not appear in any frame.
- **No raw dataset bytes enter the repository** — the committed files are PNG renderings
  of the interface, not recordings.

## Why the staged "ready-to-paste" section is gone

Earlier revisions of this document carried a staged markdown block titled
"Ready-to-paste README section", held here because GitHub renders a missing image as a
broken picture. That staging block has been **deleted**, not updated:

- The section it staged is now live in [`README.md`](../../README.md), in the same
  commit as the four PNGs, so the reason for staging it no longer exists.
- Keeping a second copy of the same prose in this file would create two sources of
  truth for the same captions, and the copy here would be the one that drifts — the
  staged block already described three synthetic panels that the captures did not
  produce, which is precisely how it fell out of date the first time.

The captions in [`README.md`](../../README.md) are authoritative; the requirements they
must satisfy are the "caption must state" column above.

## Reproducing these figures

Any of them can be reproduced from a clean clone: `npm install`, `npm run dev`, open the
printed URL in a Chromium-based browser. The synthetic figure needs no dataset at all.
The real-record figures additionally need a local MIT-BIH copy under `data/raw/mitdb/`
fetched by you — the record shown will be whichever record your copy contains, which may
not be `100`, and the caption must follow whatever the panel then displays.
