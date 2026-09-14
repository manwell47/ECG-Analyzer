# ADR-023 — Public Hosting and Public-Facing Documentation

Status: Accepted
Date: 2026-09-14
Scope: Distribution and public surface

## Context

ADR-022 published the source tree at `https://github.com/manwell47/ECG-Analyzer`
under Apache-2.0 with LF-normalised history, no redistributed datasets and no
telemetry. A git repository is reachable by anyone who can use git; it is not
reachable by anyone who cannot. The project owner asked for two things a
repository alone does not provide: a URL that opens the application directly in
a browser, and a way to start the application on a local machine without opening
a terminal.

Three constitutional constraints bear on that request. Privacy must be
default-on and local processing must be preferred (AGENTS.md §18; rules §38), so
hosting the application must not become a route by which signal data leaves the
machine. Architectural stability and backwards compatibility rank above a
deployment convenience (AGENTS.md §25, §26), so publishing must not perturb the
development pipeline. Dependency discipline applies to everything added
(AGENTS.md §23; rules §39), including a launcher script. And no placeholder may
be shipped (AGENTS.md §27).

The deployment mechanism is decided here rather than improvised, because the
choice fixes how the application is built, what the public URL guarantees, and
what the owner must still configure by hand.

## Decision

1. **(a) The application is hosted statically on GitHub Pages** at
   `https://manwell47.github.io/ECG-Analyzer/`, explicitly authorised by the
   project owner on 2026-09-14. `.github/workflows/deploy-pages.yml` builds the
   site on `ubuntu-latest` and deploys it with the official
   `actions/configure-pages`, `actions/upload-pages-artifact` and
   `actions/deploy-pages` actions, triggered on push to `main` and on
   `workflow_dispatch`. `permissions` are limited to `contents: read`,
   `pages: write` and `id-token: write`; the `pages` concurrency group runs one
   deployment at a time with `cancel-in-progress: false`, because an interrupted
   deployment can leave the site half-updated and a queued run is preferable.
2. **(b) The `/ECG-Analyzer/` sub-path is a build-time CLI argument, not a
   configuration change.** The workflow runs
   `npm run build -- --base=/ECG-Analyzer/`. `vite.config.ts`, `package.json`,
   `tsconfig.json` and everything under `src/` are untouched, so `npm run dev`,
   `npm test` and a plain `npm run build` keep their existing `/` base. The
   deployment concern is confined to the deploy step (AGENTS.md §25, §26).
3. **(c) Privacy analysis.** Only build output is served: `dist/` contains
   compiled JavaScript, CSS, the committed probe `.onnx` and the ONNX Runtime
   WASM binary. No signal data, no telemetry, no analytics and no cloud
   inference are introduced; every visitor's signal is processed entirely in
   their own browser and nothing is uploaded. The residual exposure is the
   ordinary web-server logging that GitHub performs for any Pages site (IP
   address and User-Agent), which is outside this application's control. No
   patient data can reach the host because the application has no upload path.
   This is a hosting decision, not a change to the privacy posture: the
   local-first guarantee in AGENTS.md §18 is unaffected.
4. **(d) The local launcher adds no dependency and publishes nothing.**
   `App.cmd` at the repository root is a double-clickable entry point: it
   verifies `node` and `npm` exist and prints an actionable message if not, runs
   `npm ci` only when `node_modules` is absent, then runs
   `npm run dev -- --open`. No port is hard-coded — Vite selects the first free
   port and `--open` opens the browser — because 5173 is already occupied on the
   owner's machine and forcing it would fail. The script is a convenience
   wrapper over the existing npm scripts, not a second way to run the
   application.
5. **(e) The deployment workflow performs no scientific validation and applies
   no test gate.** It installs dependencies with `npm ci` and builds; nothing
   else. The reason is explicit: the suite has only ever been executed on
   Windows, and whether it passes on `ubuntu-latest` is unverified. Making the
   published URL depend on that unverified assumption would make the site
   fragile for a reason unrelated to the artifact being published. A build
   failure still blocks deployment, so what is published is always a
   successfully compiled artifact.
6. **(f) Public-facing documentation may be polished, but must never make
   clinical, accuracy, validation or performance claims** (AGENTS.md §1, §34;
   rules §47, §48). This constraint binds the README rewrite that a later
   subtask will perform: it may describe architecture, pipeline and usage, and
   it must not state or imply diagnostic capability, model accuracy, clinical
   validity or benchmark performance.
7. **There is exactly one deployment mechanism.** No `gh-pages` branch and no
   committed `dist/` (which remains git-ignored). The published site is always
   the direct output of the workflow run.

## Consequences

- **The sub-path build was verified statically.** `npm run build --
  --base=/ECG-Analyzer/` succeeded with 181 modules transformed (unchanged from
  the plain build). `dist/index.html` references
  `/ECG-Analyzer/assets/index-Cr4s7SMa.js` and
  `/ECG-Analyzer/assets/index-C01abYeI.css`. A full audit of every
  `/ECG-Analyzer/...` reference across the emitted HTML, CSS and JavaScript
  found exactly six, and all six exist: the two above, plus
  `assets/dsp.worker-C8ScdWi1.js`, `assets/inference.worker-sRezLjrx.js`,
  `assets/ecg-lab-probe-linear-mean-2-DdYE4umo.onnx` and
  `assets/ort-wasm-simd-threaded.jsep-D-icqfN-.wasm`. (The hash-suffixed names
  are content hashes of this build.)
- **Asset reference forms, as actually emitted.**
  - The committed probe model is referenced as a plain absolute URL,
    `"/ECG-Analyzer/assets/ecg-lab-probe-linear-mean-2-DdYE4umo.onnx"`, held in
    a variable inside the emitted inference worker and passed to `fetch()`. It
    is resolved against the document origin, so it is independent of the
    worker's own script URL.
  - Both dedicated workers are constructed with absolute URLs
    (`new Worker("/ECG-Analyzer/assets/inference.worker-sRezLjrx.js", …)`).
  - The ONNX Runtime WASM binary is referenced as an absolute path
    `/ECG-Analyzer/assets/ort-wasm-simd-threaded.jsep-D-icqfN-.wasm` passed as
    the first argument to `new URL(…, import.meta.url)` — i.e. it is emitted
    into a module-relative resolution call but with a root-absolute path, so
    the resolution base is irrelevant; the result is the origin-absolute URL of
    an existing asset. This appears twice in
    `dist/assets/ort.bundle.min-C982Pftf.js`: once as the runtime default wasm
    location and once where ONNX Runtime assigns
    `env.wasm.wasmPaths = { wasm: … }` before messaging its proxy worker.
  - The ONNX Runtime JavaScript chunk is loaded by a *relative* dynamic import
    (`import("./ort.bundle.min-C982Pftf.js")`) from the inference worker in the
    same `assets/` directory, so it resolves correctly at the sub-path.
  - Caveat, recorded because it is not cosmetic: the bundle also retains ONNX
    Runtime's other default, a plain script-directory string concatenation
    (`… + "ort-wasm-simd-threaded.jsep.wasm"`), which Vite does not rewrite and
    which would not match the hash-suffixed emitted filename. Which branch
    executes at run time cannot be decided by reading the bundle.
- **Consequently, whether inference loads in the deployed application is NOT
  established here.** Only the static facts above were verified. A real-browser
  pass at `https://manwell47.github.io/ECG-Analyzer/` exercising the probe
  inference path remains pending, and per ADR-017 it is a recorded observation,
  never an automated gate. No inference behaviour should be described as
  working until that observation is recorded.
- **Publishing redistributes the ONNX Runtime WASM binary**, so its attribution
  matters. `NOTICE` already listed `onnxruntime-web` (MIT) before this ADR, in
  the third-party software section; no change was required and none was made.
- **The published artifact is dominated by a single file**: the WASM binary is
  ~27.8 MB (~6.6 MB gzipped). This is within GitHub Pages' limits and is the
  documented cost of browser-local ONNX inference; it is noted so the figure is
  not mistaken for a build defect later.
- **First-run failure mode, expected, documented and now observed.** Until the
  owner sets **Settings → Pages → Source = "GitHub Actions"**, the deploy step
  cannot find a Pages site and the workflow run fails. This is expected on first
  publication and is not a defect in the workflow. The remediation is to set
  that source and re-run the failed workflow; no commit is needed.
- **Outcome (2026-09-14).** Pushing `672fde6` triggered run `34851198976`
  (`Deploy to GitHub Pages`, event `push`, branch `main`), which completed with
  `conclusion: failure`. Steps 1–5 succeeded — `Set up job`, `Checkout`,
  `Set up Node`, `Install dependencies` (`npm ci`) and
  `Build the static site under the repository sub-path`
  (`npm run build -- --base=/ECG-Analyzer/`) — then step 6 `Configure Pages`
  failed and steps 7–8 were skipped. The failure annotations read:

  ```text
  HttpError: Not Found - https://docs.github.com/rest/pages/pages#get-a-apiname-pages-site
  HttpError :: Get Pages site failed. Please verify that the repository has Pages
  enabled and configured to build using GitHub Actions, or consider exploring the
  `enablement` parameter for this action.
  ```

  `GET /repos/manwell47/ECG-Analyzer/pages` returned `404` independently at that
  time, consistent with Pages not yet being enabled. This is the documented
  first-run state: the workflow failed loudly instead of publishing under a
  broken configuration.
- **Owner remediation performed (2026-09-14).** The owner enabled Pages for the
  repository and selected the **"GitHub Actions"** build source, as required by
  the failure message above, and authorised proceeding. This is recorded as the
  owner's report rather than as an independently verified setting: the anonymous
  `GET /repos/manwell47/ECG-Analyzer/pages` request still returns `404` after the
  change, and that endpoint may require authentication regardless of state, so it
  cannot discriminate between "disabled" and "enabled". The authoritative check
  was therefore the next workflow run, which is recorded below: it passed
  `Configure Pages`, and the live URL was then verified to serve the build.
- **Outcome (2026-09-14), second run.** Pushing `d965d53` triggered run
  `34851802345` (event `push`, branch `main`), which completed with
  `conclusion: success`. All eight steps succeeded: `Set up job`, `Checkout`,
  `Set up Node`, `Install dependencies` (`npm ci`), `Build the static site under
  the repository sub-path`, `Configure Pages`, `Upload the build artifact` and
  `Deploy to GitHub Pages`. The publication is therefore established.
- **Live URL verified over HTTP (2026-09-14).** `GET
  https://manwell47.github.io/ECG-Analyzer/` returned `200` with `699` bytes and
  references `/ECG-Analyzer/assets/index-Bl0-PYdx.js` and
  `/ECG-Analyzer/assets/index-CxGJqhzD.css`; both returned `200` (`140321` and
  `5105` bytes). The served entry chunk names the same worker assets as the local
  build — `dsp.worker-C8ScdWi1.js` and `inference.worker-sRezLjrx.js`, both `200`
  — the inference worker names `ort.bundle.min-C982Pftf.js` (`200`, `414088`
  bytes) and `ecg-lab-probe-linear-mean-2-DdYE4umo.onnx` (`200`, `543` bytes,
  `application/octet-stream`), and the hashed WASM binary
  `ort-wasm-simd-threaded.jsep-D-icqfN-.wasm` returned `200` as
  `application/wasm` with `27797172` bytes. Every asset the deployed page
  references therefore exists at the path by which it is referenced.
- **What that verification does not establish.** It is an HTTP-level check of
  file presence, path resolution and content type only. No browser loaded the
  page in this task, so whether the application boots, whether the workers start,
  and whether ONNX inference produces output in the deployed environment remain
  unverified; per ADR-017 that is a recorded real-browser observation, never an
  automated gate.
- **Local and CI hashes differ for the two Svelte-compiled entry assets, with the
  cause established.** The local sub-path build emits `index-C01abYeI.css` and
  `index-Cr4s7SMa.js`, while CI emitted `index-CxGJqhzD.css` and
  `index-Bl0-PYdx.js`; the other five assets (both workers, the ORT chunk, the
  WASM binary and the ONNX fixture) have byte-identical hashes in both builds. The
  difference is Svelte's scoped-CSS class suffix, which is derived from the source
  file's absolute path and therefore from the build machine
  (`.svelte-1umj2h3` locally versus `.svelte-t7s451` in CI): a byte-level
  comparison of the two stylesheets diverges first at byte 23, inside the very
  first scoped selector. Version drift is excluded — the lockfile and the
  installed tree agree exactly (`svelte 5.57.0`, `vite 6.4.3`,
  `@sveltejs/vite-plugin-svelte 5.1.1`, `rollup 4.63.1`, `esbuild 0.25.12`) — as
  are line endings (every artifact contains zero CR bytes) and the base path (both
  builds used `/ECG-Analyzer/`). Nothing scientific depends on these names, each
  build is internally self-consistent, and the local build is deterministic (two
  runs produced identical hashes). Recorded so that a future local-versus-CI hash
  comparison is not mistaken for a regression.
- **Every push to `main` redeploys.** Since the trigger is a push to `main`, a
  change that does not affect the application — this ADR included — rebuilds and
  republishes the site. Accepted: the redeploy is cheap (about a minute) and keeps
  the URL from drifting behind the branch. A build failure on `main` leaves the
  previous deployment serving, because `deploy-pages` never runs when an earlier
  step fails — the behaviour run `34851198976` already demonstrated.
- **The same run narrowed one assumption in decision (e).** `npm ci` and the
  sub-path build both executed successfully on `ubuntu-latest`, so the artifact
  that would be published is now known to compile on the CI platform and not
  only on Windows. The test suite still has not been run there, so the decision
  to omit a test gate continues to rest on an untested assumption — a narrower
  one than before.
- The run's annotations also carried a non-fatal warning that
  `actions/checkout@v4`, `actions/setup-node@v4` and `actions/configure-pages@v5`
  target Node.js 20 and are being forced to run on Node.js 24. It did not fail
  the run and did not affect the steps that succeeded. No action version was
  changed in response, the versions being fixed by design here. Recorded so a
  recurrence is recognised rather than re-investigated.
- **The launcher is CRLF in the working tree.** `.gitattributes` gains
  `*.cmd text eol=crlf` alongside the existing `* text=auto eol=lf`, so the
  batch file is stored LF-normalised like every other text file but checked out
  with CRLF, the form `cmd.exe` expects around labels and `goto`. Verified
  after writing: `App.cmd` is 2123 bytes with 66 CR and 66 LF.
- The quality gate is unchanged: no file under `src/`, and neither
  `vite.config.ts`, `package.json` nor `tsconfig.json`, was modified, so the
  66 test files / 838 tests / 181 build modules baseline is expected to hold and
  is re-run as evidence rather than assumed.
- `.github/workflows/` is now part of the published repository, which is
  consistent with ADR-022 item 3: the engineering record is part of the
  deliverable.
- The editor's bundled GitHub Actions schema reports
  `Value 'github-pages' is not valid` on the `environment.name` field. This was
  investigated and is a schema limitation, not a workflow defect: the same
  diagnostic appears for any environment name (verified with `production` in a
  scratch workflow, since deleted). GitHub Actions itself treats the name as a
  free-form string, and `github-pages` is the name `actions/deploy-pages`
  expects. Recorded so the warning is not re-investigated.

## References

- AGENTS.md §1 (not a medical device), §18 (privacy by default), §23 (dependency
  discipline), §25 (architectural stability), §26 (backwards compatibility),
  §27 (no placeholder engineering), §30 (development protocol), §34 (absolute
  prohibitions)
- `.roo/rules-code/01-medical-engineering.md` §18 (static assets), §38 (privacy),
  §39 (dependency rule), §47 (no unmeasured performance claims), §48 (clinical
  language), §61 (override protocol)
- ADR-017 (manual real-browser verification is a recorded observation, never a gate)
- ADR-022 (repository publication and licensing; privacy, dataset and licensing basis)
- `.github/workflows/deploy-pages.yml`, `App.cmd`, `.gitattributes`, `NOTICE`
- `package.json` (`dev`, `build` scripts; the sub-path flag is layered on top)
