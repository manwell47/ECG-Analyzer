/**
 * MIT-BIH / WFDB `.atr` annotation parser (Phase 5 / ADR-006).
 *
 * Faithful transcription of the wfdb 4.3.1 reference (`wfdb/io/annotation.py`:
 * `load_byte_pairs` + `proc_ann_bytes` + `proc_core_fields` +
 * `proc_extra_field` + `get_special_inds` + `interpret_defintion_annotations`).
 *
 * Grammar (bytes are consumed as N x 2 byte-pairs):
 *
 * - The file ends with a `0` byte-pair; parsing stops at the final pair.
 * - Each annotation begins with a core pair carrying a 10-bit sample *difference*
 *   (low byte + 2 low bits of the high byte) and a 6-bit `label_store`
 *   (`high >> 2`).
 * - One or more leading SKIP pairs (`label_store == 59`) accumulate a signed
 *   32-bit sample offset stored across the following two pairs (two's
 *   complement) — verified against real 100.atr's rhythm annotations.
 * - Extra fields with `label_store > 59` follow a core pair and belong to the
 *   annotation just read: 60 NUM, 61 SUB and 62 CHAN consume one pair each;
 *   63 AUX reads `byte0` bytes of note text from the following pairs (stored
 *   two-per-pair, the last byte dropped when the note length is odd). AUX text
 *   is kept verbatim — MIT-BIH embeds a trailing NUL pad (e.g. `'(N\x00'`),
 *   exactly as wfdb returns it.
 * - After decoding, `label_store == 0` (NOTANN) and definition annotations
 *   (`sample == 0 && label_store == 22`) are removed. Definition notes may
 *   declare the annotation sampling rate (`## time resolution: N`) or custom
 *   label mappings (`## annotation type definitions` ... `## end of
 *   definitions`), which overlay the standard store -> symbol table.
 *
 * The store -> symbol table mirrors wfdb's `ann_labels` exactly (0=' ' NOTANN,
 * 1='N', 5='V', 8='A', 28='+', ...). Undefined stores map to the empty symbol.
 */
import type { AnnotationEvent } from '../../domain/record';
import { EcgError } from '../../domain/error';

/** Result of parsing one `.atr` file. */
export interface MitBihAtrParseResult {
    /** Real annotation events, ascending sample index, definition/NOTANN removed. */
    readonly annotations: readonly AnnotationEvent[];
    /** Sampling rate declared inside the file's definition notes, if any. */
    readonly fs?: number;
    /** Custom store->symbol definitions found in the file (usually none). */
    readonly customLabels: readonly { code: number; symbol: string; description: string }[];
}

const AUX_TEXT = 63;
const NUM = 60;
const SUB = 61;
const CHAN = 62;
const SKIP = 59;
const NOTE = 22;

/** Standard MIT-BIH store -> symbol table (indexed by `label_store`). */
const STORE_SYMBOLS: readonly string[] = Object.freeze([
    ' ', // 0  NOTANN
    'N', // 1  NORMAL
    'L', // 2  LBBB
    'R', // 3  RBBB
    'a', // 4  ABERR
    'V', // 5  PVC
    'F', // 6  FUSION
    'J', // 7  NPC
    'A', // 8  APC
    'S', // 9  SVPB
    'E', // 10 VESC
    'j', // 11 NESC
    '/', // 12 PACE
    'Q', // 13 UNKNOWN
    '~', // 14 NOISE
    '', //  15 (undefined)
    '|', // 16 ARFCT
    '', //  17 (undefined)
    's', // 18 STCH
    'T', // 19 TCH
    '*', // 20 SYSTOLE
    'D', // 21 DIASTOLE
    '"', // 22 NOTE
    '=', // 23 MEASURE
    'p', // 24 PWAVE
    'B', // 25 BBB
    '^', // 26 PACESP
    't', // 27 TWAVE
    '+', // 28 RHYTHM
    'u', // 29 UWAVE
    '?', // 30 LEARN
    '!', // 31 FLWAV
    '[', // 32 VFON
    ']', // 33 VFOFF
    'e', // 34 AESC
    'n', // 35 SVESC
    '@', // 36 LINK
    'x', // 37 NAPC
    'f', // 38 PFUS
    '(', // 39 WFON
    ')', // 40 WFOFF
    'r', // 41 RONT
    '', //  42 (undefined)
    '', //  43 (undefined)
    '', //  44 (undefined)
    '', //  45 (undefined)
    '', //  46 (undefined)
    '', //  47 (undefined)
    '', //  48 (undefined)
    '', //  49 (undefined)
    '', //  50 (undefined)
    '', //  51 (undefined)
    '', //  52 (undefined)
    '', //  53 (undefined)
    '', //  54 (undefined)
    '', //  55 (undefined)
    '', //  56 (undefined)
    '', //  57 (undefined)
    '', //  58 (undefined)
    '', //  59 SKIP (never a real annotation)
    '', //  60 NUM (extra field, never a real annotation)
    '', //  61 SUB (extra field, never a real annotation)
    '', //  62 CHAN (extra field, never a real annotation)
    '', //  63 AUX (extra field, never a real annotation)
]);

interface RawAnnotation {
    readonly sampleIndex: number;
    readonly code: number;
    readonly auxNote: string;
}

function bytePair(bytes: Uint8Array, pairIndex: number): [number, number] {
    const lo = bytes[2 * pairIndex] ?? 0;
    const hi = bytes[2 * pairIndex + 1] ?? 0;
    return [lo, hi];
}

function storeOf(pair: readonly [number, number]): number {
    return pair[1] >> 2;
}

/**
 * Parse MIT-BIH annotation bytes into canonical events.
 *
 * @throws `EcgError` with code `annotation-parse-error` when the byte stream is
 *         truncated mid-annotation (a file well-formed to wfdb never triggers
 *         this; the throw guards against silently dropping trailing data).
 */
export function parseMitBihAtr(bytes: Uint8Array): MitBihAtrParseResult {
    if (bytes.length % 2 !== 0) {
        throw EcgError.annotationParse(
            `Annotation file byte length ${bytes.length} is odd; expected ` +
            'an even number of bytes (byte pairs).',
            { meta: { byteLength: bytes.length } },
        );
    }
    const pairCount = bytes.length / 2;
    if (pairCount === 0) {
        return { annotations: [], customLabels: [] };
    }

    // --- Stage 1: decode core + extra fields into raw annotations. ----------
    const samples: number[] = [];
    const codes: number[] = [];
    const auxNotes: string[] = [];

    let bpi = 0;
    let sampleTotal = 0;

    const readAux = (atPair: number, length: number): string => {
        const notePairs = Math.ceil(length / 2);
        const byteStart = 2 * (atPair + 1);
        const totalBytes = 2 * notePairs;
        let note = '';
        for (let j = 0; j < totalBytes; j += 1) {
            // Odd-length notes are padded to a whole number of pairs; the final
            // pad byte is dropped (wfdb semantics).
            if (length % 2 === 1 && j === totalBytes - 1) {
                break;
            }
            const pos = byteStart + j;
            if (pos >= bytes.length) {
                throw EcgError.annotationParse(
                    'Annotation note runs past the end of the file.',
                );
            }
            note += String.fromCharCode(bytes[pos] ?? 0);
        }
        return note;
    };

    // wfdb stops at the final pair, which is the EOF 0 marker.
    while (bpi < pairCount - 1) {
        // --- Core fields (with optional leading SKIP pairs). ---
        let sampleDiff = 0;

        while (bpi < pairCount - 1 && storeOf(bytePair(bytes, bpi)) === SKIP) {
            // SKIP carries a signed 32-bit dt across the next two pairs.
            if (bpi + 2 >= pairCount) {
                throw EcgError.annotationParse(
                    'Annotation SKIP entry is truncated before its time delta.',
                );
            }
            const [a0, a1] = bytePair(bytes, bpi + 1);
            const [c0, c1] = bytePair(bytes, bpi + 2);

            let skipDiff =
                (a0 << 16) + (a1 << 24) + c0 + (c1 << 8);
            // 32-bit two's complement.
            if (skipDiff > 2147483647) {
                skipDiff -= 4294967296;
            }
            sampleDiff += skipDiff;
            bpi += 3;
        }

        if (bpi >= pairCount - 1) {
            break;
        }
        const [lo, hi] = bytePair(bytes, bpi);
        const code = hi >> 2;
        sampleDiff += lo + 256 * (hi & 3);
        sampleTotal += sampleDiff;
        bpi += 1;

        samples.push(sampleTotal);
        codes.push(code);

        // --- Extra fields belonging to this annotation. ---
        let auxNote = '';
        let current = bpi < pairCount ? storeOf(bytePair(bytes, bpi)) : 0;
        while (current > 59 && bpi < pairCount) {
            if (current === AUX_TEXT) {
                // The AUX pair's low byte is the note length; its high byte is
                // the AUX store (63) and is not used as a length.
                const [lenLo] = bytePair(bytes, bpi);
                auxNote = readAux(bpi, lenLo);
                const notePairs = Math.ceil(lenLo / 2);
                bpi += 1 + notePairs;
            } else if (current === NUM || current === SUB || current === CHAN) {
                // Value carried in the pair's low byte; not stored by the
                // canonical model, but the pair must still be consumed.
                bpi += 1;
            } else {
                throw EcgError.annotationParse(
                    `Annotation file contains an unrecognised extra field ` +
                    `code ${current}.`,
                    { meta: { code: current, pairIndex: bpi } },
                );
            }
            current = bpi < pairCount ? storeOf(bytePair(bytes, bpi)) : 0;
        }
        auxNotes.push(auxNote);
    }

    const rawAnnotations: RawAnnotation[] = samples.map((sampleIndex, i) => ({
        sampleIndex,
        code: codes[i] ?? 0,
        auxNote: auxNotes[i] ?? '',
    }));

    // --- Stage 2: strip NOTANN + definition annotations; read definitions. --
    const definitionIndices: number[] = [];
    const kept: RawAnnotation[] = [];
    rawAnnotations.forEach((annotation, index) => {
        if (annotation.code === 0) {
            return; // NOTANN — not a real annotation.
        }
        if (annotation.sampleIndex === 0 && annotation.code === NOTE) {
            definitionIndices.push(index);
            return;
        }
        kept.push(annotation);
    });

    let declaredFs: number | undefined;
    const customLabels: { code: number; symbol: string; description: string }[] = [];

    const definitionNotes = definitionIndices.map((i) => rawAnnotations[i]?.auxNote ?? '');
    let i = 0;
    while (i < definitionNotes.length) {
        const note = definitionNotes[i] ?? '';
        if (note.startsWith('## ')) {
            if (declaredFs === undefined) {
                const fsMatch = /^## time resolution: (\d+\.?\d*)$/.exec(note.trim());
                if (fsMatch !== null) {
                    const parsed = Number.parseFloat(fsMatch[1] ?? '');
                    if (Number.isFinite(parsed)) declaredFs = parsed;
                } else if (note.trim() === '## annotation type definitions') {
                    i += 1;
                    while (
                        i < definitionNotes.length &&
                        (definitionNotes[i] ?? '').trim() !== '## end of definitions'
                    ) {
                        const customMatch = /^(\d+) (\S+) (.+)$/.exec(
                            (definitionNotes[i] ?? '').trim(),
                        );
                        if (customMatch !== null) {
                            customLabels.push({
                                code: Number.parseInt(customMatch[1] ?? '', 10),
                                symbol: customMatch[2] ?? '',
                                description: customMatch[3] ?? '',
                            });
                        }
                        i += 1;
                    }
                }
            }
        }
        i += 1;
    }

    // --- Stage 3: map store -> symbol (custom labels overlay the standard table).
    const symbolByCode = new Map<number, string>(
        customLabels.map((entry) => [entry.code, entry.symbol]),
    );
    const symbolOf = (code: number): string => {
        const custom = symbolByCode.get(code);
        if (custom !== undefined) return custom;
        return STORE_SYMBOLS[code] ?? '';
    };

    const annotations: readonly AnnotationEvent[] = Object.freeze(
        kept.map((annotation) =>
            Object.freeze({
                sampleIndex: annotation.sampleIndex,
                code: annotation.code,
                symbol: symbolOf(annotation.code),
                auxNote: annotation.auxNote,
            } as AnnotationEvent),
        ),
    );

    return {
        annotations,
        ...(declaredFs === undefined ? {} : { fs: declaredFs }),
        customLabels: Object.freeze([...customLabels]),
    };
}
