import { describe, expect, it } from 'vitest';

import { ERROR_CODES, EcgError, isErrorCode } from '../error';

describe('error taxonomy', () => {
    it('declares the full, stable set of error codes', () => {
        expect(ERROR_CODES).toEqual([
            'invalid-input',
            'unsupported-format',
            'incompatible-sample-rate',
            'malformed-signal',
            'numerical-failure',
            'dsp-failure',
            'model-loading-failure',
            'model-compatibility-failure',
            'inference-failure',
            'request-superseded',
            'visualization-failure',
            // Dataset ingestion (Phase 5 / ADR-006).
            'file-not-found',
            'malformed-header',
            'annotation-parse-error',
        ]);
    });

    it('isErrorCode discriminates between codes and non-codes', () => {
        expect(isErrorCode('malformed-signal')).toBe(true);
        expect(isErrorCode('invalid-input')).toBe(true);
        expect(isErrorCode('not-a-real-code')).toBe(false);
        expect(isErrorCode(42)).toBe(false);
        expect(isErrorCode(undefined)).toBe(false);
    });

    it('constructs an EcgError carrying code, name, message and context', () => {
        const err = new EcgError('invalid-input', 'boom', { detail: 'extra info' });

        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(EcgError);
        expect(err.name).toBe('EcgError');
        expect(err.code).toBe('invalid-input');
        expect(err.message).toBe('boom');
        expect(err.context).toEqual({ detail: 'extra info' });
    });

    it('defaults context to an empty object', () => {
        const err = new EcgError('malformed-signal', 'x');
        expect(err.context).toEqual({});
    });

    it('static factories set the matching code', () => {
        expect(EcgError.invalidInput('m').code).toBe('invalid-input');
        expect(EcgError.malformedSignal('m').code).toBe('malformed-signal');
        expect(EcgError.incompatibleSampleRate('m').code).toBe(
            'incompatible-sample-rate',
        );
        expect(EcgError.modelLoading('m').code).toBe('model-loading-failure');
        expect(EcgError.modelCompatibility('m').code).toBe('model-compatibility-failure');
        expect(EcgError.inference('m').code).toBe('inference-failure');
        expect(EcgError.dsp('m').code).toBe('dsp-failure');
        expect(EcgError.requestSuperseded('m').code).toBe('request-superseded');
    });

    it('propagates an optional cause for diagnostics', () => {
        const root = new Error('root cause');
        const err = new EcgError('numerical-failure', 'outer', { cause: root });
        expect(err.cause).toBe(root);
    });
});
