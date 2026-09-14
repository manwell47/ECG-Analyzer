/**
 * Shared numeric validation helpers.
 *
 * Signal-processing inputs are rejectable at the boundary: NaN and infinite
 * sample values, non-positive sample rates, and non-finite gains must fail
 * loudly rather than propagate silently through filters or transforms.
 */
import { EcgError } from './error';

export function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

/** Throws `invalid-input` unless `value` is a finite number. */
export function assertFiniteNumber(value: number, label: string): void {
    if (!isFiniteNumber(value)) {
        throw EcgError.invalidInput(
            `Expected ${label} to be a finite number, received ${String(value)}.`,
        );
    }
}

/** Throws `invalid-input` unless `value` is a finite number strictly greater than zero. */
export function assertPositiveNumber(value: number, label: string): void {
    if (!isFiniteNumber(value) || value <= 0) {
        throw EcgError.invalidInput(
            `Expected ${label} to be a finite number > 0, received ${String(value)}.`,
        );
    }
}
