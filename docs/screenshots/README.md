# Screenshots — capture protocol

This directory holds real-browser screenshots of the application for the top-level
[`README.md`](../../README.md). It is a **protocol plus a holding area**, not a
verification artifact.

## Why this protocol exists

A screenshot shows *appearance*, not *evidence*. [`AGENTS.md`](../../AGENTS.md) §12
("validation over appearance") and
[`ADR-017`](../adr/ADR-017-real-data-verification.md) are explicit: an interactive
pass is a recorded observation, it is never a gate, and an unperformed row is not a
pass. Consequently:

- A screenshot **never** substitutes for a row in
  [`plans/phase-18-manual-verification.md`](../phase-18-manual-verification.md).
- A caption must describe what the panel shows, in the wording the software itself
  uses. It must not claim clinical validity, diagnosis, or calibrated confidence
  (rules §48, §49; [`ADR-021`](../adr/ADR-021-model-output-display-rule.md)).
- Screenshots are captured by a human in a real browser. Nothing in this repository
  generates them, and no automated test asserts on them — rules §35 forbids relying
  on snapshot-style assertions for scientific correctness.

## Capture subject — use the synthetic default

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
- no third-party dataset imagery enters the repository, so the boundary recorded in
  [`ADR-022`](../adr/ADR-022-repository-publication-and-licensing.md) stays intact;
- the figure stays valid as the default configuration evolves.

A real-record capture is possible, but it is a **governance decision, not a
cosmetic one**: it embeds a derived figure of a third-party dataset in this
repository and requires attribution (record id, channel, and the ODC-BY 1.0
source). Do not add one without deciding that explicitly.

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
  a username. If a capture needs to show ingestion, show the drop zone with files
  already selected, not the picker dialog.
- Do not capture DevTools, the terminal, the taskbar, notifications, or window
  titles.
- Do not capture a waveform from a record obtained under terms that forbid
  redistribution — and if a real record is ever shown, capture no identifying
  metadata beyond what the attribution caption states.
- Crop tightly to the application viewport. A full-desktop grab fails this rule
  regardless of what it shows.

## Naming and captions

| File | Subject | The caption must state |
| --- | --- | --- |
| `01-time-series.png` | Time-series view with the default synthetic analysis, including the amplitude/time axes | units on both axes, the record (`sync`) and that the signal is synthetic |
| `02-dwt-coefficients.png` | DWT coefficient view for `db4`, 4 levels, `periodic` | that the bands are approximate and derived from the sampling rate, the level, and the wavelet — never labelled as exact clinical frequency bands (rules §12) |
| `03-model-output.png` | Model output panel after the committed probe model has produced a prediction | that this is the **probe** model on a synthetic signal, that the value is a model score / predicted probability rather than calibrated confidence, and that it carries no clinical meaning |

Keep each PNG under roughly 300 KB. If a capture exceeds that, re-crop rather than
rescaling: a rescaled plot is no longer a faithful rendering of the interface.

## Ready-to-paste README section

Once the PNGs exist, insert this block into [`README.md`](../../README.md)
immediately after the **Status** section, in the same commit as the images:

````markdown
## Screenshots

The views below were captured from a real browser session running the default
configuration — the deterministic synthetic record `sync` (360 Hz, 3600 samples)
analysed with `db4`, 4 levels, periodic extension. Synthetic data only: no
third-party dataset imagery is included, and nothing is uploaded. These images
illustrate the interface; they are not verification evidence (ADR-017).

![Time-series view: the default synthetic record with amplitude and time axes](docs/screenshots/01-time-series.png)

![DWT coefficient view: db4 decomposition, 4 levels, periodic extension](docs/screenshots/02-dwt-coefficients.png)

![Model output panel: prediction from the committed probe model on a synthetic signal](docs/screenshots/03-model-output.png)

The DWT views show approximate frequency bands derived from the sampling rate, the
decomposition level and the wavelet — they are not labelled as exact clinical
frequency bands. The model panel shows a model score for a development probe model,
not a diagnostic finding.
````

## Why this is not in the README yet

GitHub renders a missing image as a broken picture, and
[`README.md`](../../README.md) is the first thing a reader sees. The section above
is therefore staged here and lands in the same commit as the PNGs, so the published
page is never momentarily broken.
