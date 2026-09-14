/**
 * Latest-identity gate (Phase 6 / ADR-005; rules §31).
 *
 * The orchestrator must keep only the most recent request identity and reject
 * completions that belong to superseded requests. `LatestIdentityGate` is the
 * pure, transport-free state behind that rule: `issue` mints a monotonic
 * `requestId` (so "latest" is always well-defined, even if a slow worker returns
 * results out of order), and `isCurrent` answers whether a completion is still
 * the one the caller is waiting for.
 */

export class LatestIdentityGate {
    private nextSequence = 0;

    private latestRequestId: string | null = null;

    private latestSignalId: string | undefined;

    private readonly requestIdPrefix: string;

    /**
     * `requestIdPrefix` labels the kind of work this gate mints identities for
     * (e.g. `inference`, `dsp`). The default preserves the Phase-6 inference ids
     * (`inference-0`, `inference-1`, ...), so existing callers are unchanged;
     * the DSP client passes `dsp` so its ids are self-describing.
     */
    constructor(requestIdPrefix = 'inference') {
        this.requestIdPrefix = requestIdPrefix;
    }

    /**
     * Mint the next request identity for `signalId`. This request becomes the
     * sole current one; any previously issued request is now superseded.
     */
    issue(signalId: string): string {
        const requestId = `${this.requestIdPrefix}-${this.nextSequence}`;
        this.nextSequence += 1;
        this.latestRequestId = requestId;
        this.latestSignalId = signalId;
        return requestId;
    }

    /** True only for the most recently issued request. */
    isCurrent(requestId: string): boolean {
        return this.latestRequestId !== null && requestId === this.latestRequestId;
    }

    /** The signal identity of the current (latest) request, if any. */
    currentSignalId(): string | undefined {
        return this.latestSignalId;
    }

    /** Forget the current identity (e.g. after dispose); nothing is current. */
    reset(): void {
        this.latestRequestId = null;
        this.latestSignalId = undefined;
    }
}
