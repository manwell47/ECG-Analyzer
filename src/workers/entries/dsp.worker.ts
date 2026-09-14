/**
 * DSP/DWT dedicated-worker entry (Phase 10, item 3; ADR-005, ADR-011).
 *
 * The thinnest possible worker shell: it constructs the shared
 * {@link DspWorkerCore} (which delegates to `src/dsp` / `src/domain`, so no
 * scientific logic lives here — rules §30) and binds it to the worker's global
 * port with {@link bindDspCore}. The binder answers every inbound `dsp-request`
 * with one `dsp-result`/`dsp-error` envelope.
 *
 * TypeScript note: this project's `tsconfig` deliberately ships the DOM lib
 * (not `webworker`) so the *entire* `src` graph typechecks under one config.
 * A `DedicatedWorkerGlobalScope` is therefore reached by a single documented
 * cast of the global `self` to the local {@link WorkerPort} surface, which is
 * exactly the surface the binder consumes. The entry file is not executed by
 * vitest; it is covered by typecheck, lint and the Vite `?worker` build.
 */

import { bindDspCore } from '../bind';
import { DspWorkerCore } from '../core';
import type { WorkerPort } from '../port';

/** The worker's global scope, narrowed to the transport surface the binder needs. */
const port = self as unknown as WorkerPort;

bindDspCore(port, new DspWorkerCore());
