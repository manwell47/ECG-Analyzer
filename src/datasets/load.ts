/**
 * Materialising canonical records into the DSP pipeline (Phase 5 / ADR-006).
 *
 * A `DatasetAdapter` yields raw-ADC `SignalRecord`s; DSP and ML operate on
 * physical-unit `Signal`s. The conversion between the two is a *calibration
 * step*, not a silent re-scale, so it lives in exactly one audited function
 * (`recordToMillivoltSignal`) that:
 *
 * - refuses channels it cannot faithfully convert (only channels whose declared
 *   physical unit is `mV` — calibration `gain` is defined as ADC counts per mV,
 *   see `src/domain/units.ts`);
 * - applies `adcToMillivolt` per sample (single-sourced domain conversion);
 * - records the step in the resulting signal's provenance as
 *   `adc-to-millivolt`, so any downstream analysis can prove it ran on physical
 *   units.
 */
import { EcgError } from '../domain/error';
import type { SignalRecord } from '../domain/record';
import {
    createSignal,
    type Provenance,
    type Signal,
    type SignalChannel,
} from '../domain/signal';
import { adcToMillivolt } from '../domain/units';

/** Canonical provenance name of the ADC -> mV calibration step. */
export const ADC_TO_MILLIVOLT_STEP = 'adc-to-millivolt';

/**
 * Convert every `mV`-calibrated channel of a record into a physical-unit
 * `Signal`. Throws `unsupported-format` if any channel is not calibrated to
 * millivolts.
 */
export function recordToMillivoltSignal(
    record: Readonly<SignalRecord>,
    options: { readonly id?: string } = {},
): Signal {
    const fallbackId = `${record.identity.datasetId}/${record.identity.recordId}`;
    const id = options.id === undefined || options.id.trim().length === 0
        ? fallbackId
        : options.id;

    const channels: SignalChannel[] = record.channels.map((channel) => {
        if (channel.physicalUnit !== 'mV') {
            throw EcgError.unsupportedFormat(
                `Channel "${channel.name}" is calibrated to ${channel.physicalUnit}; ` +
                'recordToMillivoltSignal only converts mV-calibrated channels.',
                { meta: { channel: channel.name, physicalUnit: channel.physicalUnit } },
            );
        }
        const calibration = channel.calibration;
        const data = new Float64Array(channel.samples.length);
        for (let i = 0; i < channel.samples.length; i += 1) {
            data[i] = adcToMillivolt(channel.samples[i] ?? 0, calibration);
        }
        return { name: channel.name, data, unit: 'mV' };
    });

    const provenance: Provenance = {
        source: record.provenance.source ?? fallbackId,
        transforms: [
            ...record.provenance.transforms,
            {
                name: ADC_TO_MILLIVOLT_STEP,
                parameters: { datasetId: record.identity.datasetId },
            },
        ],
    };

    return createSignal({
        id,
        channels,
        sampling: record.sampling,
        provenance,
    });
}
