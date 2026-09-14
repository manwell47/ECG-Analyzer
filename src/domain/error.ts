/**
 * Classified error taxonomy for the ECG Lab domain.
 *
 * Every failure carries a stable, machine-readable `code` so callers can branch
 * on the *class* of failure without string-matching message text, and so no
 * scientific operation can silently degrade into a wrong-but-returned result.
 *
 * The taxonomy is exhaustive and stable up-front (see AGENTS.md rules on error
 * handling); codes for subsystems not yet implemented (models, visualization)
 * are declared here so interfaces that reference them compile from day one.
 */

export const ERROR_CODES = [
    'invalid-input',
    'unsupported-format',
    'incompatible-sample-rate',
    'malformed-signal',
    'numerical-failure',
    // DSP/DWT worker execution (Phase 7 / ADR-005): an unexpected worker-side
    // failure that is not one of the classified DSP errors listed above.
    'dsp-failure',
    'model-loading-failure',
    'model-compatibility-failure',
    'inference-failure',
    // Inference orchestration (Phase 6 / ADR-005): overtaken before completing.
    'request-superseded',
    'visualization-failure',
    // Dataset ingestion (Phase 5 / ADR-006).
    'file-not-found',
    'malformed-header',
    'annotation-parse-error',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export function isErrorCode(value: unknown): value is ErrorCode {
    return (
        typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value)
    );
}

export interface EcgErrorContext {
    /** Optional human-readable detail for diagnostics and logs. */
    readonly detail?: string;
    /** Optional machine-readable metadata, e.g. `{ sampleRateHz: 0 }`. */
    readonly meta?: Readonly<Record<string, unknown>>;
    /** Optional originating cause (an Error or any other thrown value). */
    readonly cause?: unknown;
}

export class EcgError extends Error {
    readonly code: ErrorCode;
    readonly context: Readonly<EcgErrorContext>;

    constructor(code: ErrorCode, message: string, context: EcgErrorContext = {}) {
        super(message, context.cause === undefined ? undefined : { cause: context.cause });
        this.name = 'EcgError';
        this.code = code;
        this.context = context;
    }

    static invalidInput(message: string, context: EcgErrorContext = {}): EcgError {
        return new EcgError('invalid-input', message, context);
    }

    static malformedSignal(message: string, context: EcgErrorContext = {}): EcgError {
        return new EcgError('malformed-signal', message, context);
    }

    static incompatibleSampleRate(
        message: string,
        context: EcgErrorContext = {},
    ): EcgError {
        return new EcgError('incompatible-sample-rate', message, context);
    }

    /** A required dataset file (RECORDS, .hea, .dat, .atr) is absent. */
    static fileNotFound(message: string, context: EcgErrorContext = {}): EcgError {
        return new EcgError('file-not-found', message, context);
    }

    /** A WFDB/MIT-BIH header (.hea) is unparsable or internally inconsistent. */
    static malformedHeader(message: string, context: EcgErrorContext = {}): EcgError {
        return new EcgError('malformed-header', message, context);
    }

    /** A WFDB annotation file (.atr/.at_/.atq) is truncated or unparsable. */
    static annotationParse(message: string, context: EcgErrorContext = {}): EcgError {
        return new EcgError('annotation-parse-error', message, context);
    }

    /** A recognized source is structurally fine but uses an unsupported encoding. */
    static unsupportedFormat(message: string, context: EcgErrorContext = {}): EcgError {
        return new EcgError('unsupported-format', message, context);
    }

    /** A model artifact or its metadata could not be loaded/validated (Phase 6). */
    static modelLoading(message: string, context: EcgErrorContext = {}): EcgError {
        return new EcgError('model-loading-failure', message, context);
    }

    /** Realized data is not scientifically compatible with a model's contract. */
    static modelCompatibility(message: string, context: EcgErrorContext = {}): EcgError {
        return new EcgError('model-compatibility-failure', message, context);
    }

    /** An inference backend failed while executing a validated input. */
    static inference(message: string, context: EcgErrorContext = {}): EcgError {
        return new EcgError('inference-failure', message, context);
    }

    /**
     * A DSP/DWT worker failed in an unexpected way that is not one of the
     * classified DSP errors (`invalid-input`, `malformed-signal`, ...). Phase 7 /
     * ADR-005: DSP modules only ever throw classified EcgErrors, so this code is
     * the honest envelope class for any non-EcgError worker failure — mirroring
     * how `inference-failure` covers unexpected inference-engine failures.
     */
    static dsp(message: string, context: EcgErrorContext = {}): EcgError {
        return new EcgError('dsp-failure', message, context);
    }

    /**
     * A newer request overtook this one before it completed (Phase 6 /
     * ADR-005): the orchestrator keeps only the latest identity and rejects
     * superseded in-flight requests instead of letting stale results through.
     */
    static requestSuperseded(message: string, context: EcgErrorContext = {}): EcgError {
        return new EcgError('request-superseded', message, context);
    }
}
