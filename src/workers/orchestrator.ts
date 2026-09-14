/**
 * Shared latest-only request orchestrator (Phase 10 / ADR-005, ADR-011; rules
 * §30, §31).
 *
 * Both worker clients — `LatestOnlyInferenceClient` (Phase 6) and
 * `LatestOnlyDspClient` (Phase 10) — drive exactly the same state machine, so it
 * lives here ONCE (rules §30: no duplicated orchestration):
 *
 *  - minting a monotonic `requestId` per call via {@link LatestIdentityGate};
 *  - issuing a newer request immediately rejects every older in-flight request
 *    as `request-superseded` (it can never complete — the worker only ever sees
 *    the newest identity as current);
 *  - a completion whose `requestId` is no longer pending/current is dropped
 *    silently, so a slow "ECG A" result can never resolve the newer "ECG B"
 *    request (rules §31);
 *  - `dispose` aborts every pending request and stops accepting new ones.
 *
 * Transport-free by construction: the orchestrator never touches a port — the
 * clients post the envelope the orchestrator mints and feed the orchestrator the
 * completions they receive. This keeps the whole latest-only policy unit-testable
 * in Node with in-memory transports.
 */

import { EcgError } from '../domain/error';
import { LatestIdentityGate } from './identity';

/** Per-client wording/identity the shared orchestrator needs. */
export interface LatestOnlyLabels {
    /** Prefix for minted request ids, e.g. `inference` or `dsp`. */
    readonly requestIdPrefix: string;
    /** Build the error thrown when a request is issued after dispose. */
    readonly disposedError: () => EcgError;
}

interface PendingEntry<TResult> {
    readonly signalId: string;
    resolve(value: TResult): void;
    reject(reason: unknown): void;
}

export class LatestOnlyOrchestrator<TResult> {
    private readonly labels: LatestOnlyLabels;

    private readonly gate: LatestIdentityGate;

    private readonly pending = new Map<string, PendingEntry<TResult>>();

    private disposed = false;

    constructor(labels: LatestOnlyLabels, gate?: LatestIdentityGate) {
        this.labels = labels;
        this.gate = gate ?? new LatestIdentityGate(labels.requestIdPrefix);
    }

    /** The signal identity of the most recent request, if any. */
    currentSignalId(): string | undefined {
        return this.gate.currentSignalId();
    }

    /**
     * Mint a request identity, supersede older in-flight requests, and return
     * the id to tag the outbound envelope with plus the promise the completion
     * will settle. Throws the client's disposed error once disposed.
     */
    issue(signalId: string): { requestId: string; promise: Promise<TResult> } {
        if (this.disposed) {
            throw this.labels.disposedError();
        }
        const requestId = this.gate.issue(signalId);
        this.supersedeOthers(requestId, signalId);

        const promise = new Promise<TResult>((resolve, reject) => {
            this.pending.set(requestId, { signalId, resolve, reject });
        });
        return { requestId, promise };
    }

    /** Resolve the pending request with `value`; drop unknown/stale completions. */
    resolveRequest(requestId: string, value: TResult): void {
        const entry = this.claim(requestId);
        if (entry !== null) {
            entry.resolve(value);
        }
    }

    /** Reject the pending request with `error`; drop unknown/stale completions. */
    rejectRequest(requestId: string, error: EcgError): void {
        const entry = this.claim(requestId);
        if (entry !== null) {
            entry.reject(error);
        }
    }

    /** Abort every in-flight request and stop accepting new ones. */
    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        for (const [requestId, entry] of this.pending) {
            this.pending.delete(requestId);
            entry.reject(
                EcgError.requestSuperseded(
                    `Request ${requestId} was abandoned because the client was disposed.`,
                ),
            );
        }
        this.gate.reset();
    }

    /** Remove and return the current entry for `requestId`, or null to drop it. */
    private claim(requestId: string): PendingEntry<TResult> | null {
        if (this.disposed) {
            return null;
        }
        const entry = this.pending.get(requestId);
        if (entry === undefined) {
            // Unknown or already-superseded request: drop the stale completion.
            return null;
        }
        this.pending.delete(requestId);
        if (!this.gate.isCurrent(requestId)) {
            // Defensive: pending but not current (should be rare) → reject stale.
            entry.reject(
                EcgError.requestSuperseded(
                    `Request ${requestId} is no longer current and was rejected as stale.`,
                ),
            );
            return null;
        }
        return entry;
    }

    private supersedeOthers(currentRequestId: string, signalId: string): void {
        for (const [requestId, entry] of this.pending) {
            if (requestId === currentRequestId) {
                continue;
            }
            this.pending.delete(requestId);
            entry.reject(
                EcgError.requestSuperseded(
                    `Request ${requestId} (signal "${entry.signalId}") was superseded by ${currentRequestId} (signal "${signalId}") before it completed.`,
                ),
            );
        }
    }
}
