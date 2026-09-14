/**
 * ONNX Runtime Web inference backend (ADR-004, ADR-005).
 *
 * Phase 7 installed `onnxruntime-web` (which re-exports `onnxruntime-common`, the
 * package that ships the real declarations), so this adapter is now typed against
 * the REAL package surface — the former hand-written ambient declaration in this
 * directory has been deleted. The adapter is still GUARDED against eager loading:
 * the production barrel and ordinary Node code paths must not import this module
 * at load time, so the package is only ever reached through the lazy dynamic
 * `import('onnxruntime-web')` inside {@link createOnnxWebEngine} (ADR-005). It
 * typechecks against the real package and is exercised by a real-session Node
 * integration test (Phase 7 item #4).
 *
 * It implements the {@link InferenceEngine} boundary like any other backend:
 * validation before execution, loud failure, owned session lifecycle. ONNX
 * tensor wrappers are an adapter concern and never cross this boundary.
 */

import { EcgError } from '../../domain/error';
import type { ModelInput, ModelMetadata, ModelPrediction } from '../../domain/ml';
import { assertInputCompatibleWithModel, type InferenceEngine } from '../engine';
import { assertValidModelMetadata } from '../metadata';
import type {
    Env,
    InferenceSession,
    InferenceSessionFactory,
    TensorConstructor,
} from 'onnxruntime-web';

/**
 * The lazily imported `onnxruntime-web` runtime surface this adapter touches.
 *
 * Typed with the real named exports of `onnxruntime-web` (which re-exports
 * `onnxruntime-common`), so the module object stays fully typed while the package
 * itself is only ever loaded by the dynamic import below — never statically.
 */
type OrtModule = {
    readonly Tensor: TensorConstructor;
    readonly InferenceSession: InferenceSessionFactory;
    readonly env: Env;
};
/** An instantiated ONNX session (type-only; never statically imported). */
type OrtSession = InferenceSession;

export interface OnnxWebEngineOptions {
    /** The validated contract the session was created for. */
    readonly metadata: Readonly<ModelMetadata>;
    /** Raw ONNX model bytes (`.onnx`), e.g. fetched into the browser. */
    readonly modelBytes: Uint8Array | ArrayBuffer;
    /** Optional execution providers; ORT Web defaults apply when omitted. */
    readonly executionProviders?: readonly string[];
    /** Optional WASM thread count for the (global) ORT Web environment. */
    readonly numThreads?: number;
    /** Optional WASM proxy toggle for the (global) ORT Web environment. */
    readonly proxyWasm?: boolean;
}

/** Load ORT Web only on first use; its absence fails loudly and specifically. */
async function loadOrtModule(): Promise<OrtModule> {
    try {
        return await import('onnxruntime-web');
    } catch (cause) {
        throw EcgError.modelLoading(
            'onnxruntime-web is not available in this environment. The ONNX Web backend loads lazily and only runs where the package is installed (a browser or worker); it is never imported by tests or Node code paths.',
            { cause: cause instanceof Error ? cause : undefined },
        );
    }
}

/** Copy arbitrary model bytes into a freshly owned `ArrayBuffer`. */
function asArrayBuffer(bytes: Uint8Array | ArrayBuffer): ArrayBuffer {
    if (bytes instanceof ArrayBuffer) {
        return bytes;
    }
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer as ArrayBuffer;
}

/** ORT Web emits float32 tensors; widen to the contract's Float64Array values. */
function toFloat64(data: Float32Array | Float64Array): Float64Array {
    return data instanceof Float64Array ? new Float64Array(data) : Float64Array.from(data);
}

class OrtWebInferenceEngine implements InferenceEngine {
    readonly backendId = 'onnx-web';

    private readonly ort: OrtModule;

    private readonly session: OrtSession;

    private readonly metadata: Readonly<ModelMetadata>;

    private disposed = false;

    constructor(ort: OrtModule, session: OrtSession, metadata: Readonly<ModelMetadata>) {
        this.ort = ort;
        this.session = session;
        this.metadata = metadata;
    }

    async run(
        metadata: Readonly<ModelMetadata>,
        input: Readonly<ModelInput>,
    ): Promise<ModelPrediction> {
        assertInputCompatibleWithModel(metadata, input);
        if (this.disposed) {
            throw EcgError.inference('The ONNX Web engine has been disposed and cannot run.');
        }
        if (
            metadata.modelId !== this.metadata.modelId ||
            metadata.modelVersion !== this.metadata.modelVersion
        ) {
            throw EcgError.modelCompatibility(
                'The metadata handed to run() does not match the model this ONNX Web session was created for.',
            );
        }
        if (metadata.input.dtype !== 'float32' || metadata.output.dtype !== 'float32') {
            throw EcgError.modelCompatibility(
                'The ONNX Web backend currently requires float32 input and output tensors; other dtypes are not realized through ModelInput yet.',
            );
        }

        const tensor = new this.ort.Tensor(
            'float32',
            input.data as Float32Array,
            Array.from(input.shape),
        );

        let results;
        try {
            results = await this.session.run(
                { [input.tensorName]: tensor },
                [metadata.output.name],
            );
        } catch (cause) {
            throw EcgError.inference('ONNX Runtime Web failed while running the session.', {
                cause: cause instanceof Error ? cause : undefined,
            });
        }

        const outputTensor = results[metadata.output.name];
        if (outputTensor === undefined) {
            throw EcgError.inference(
                `ONNX session produced no tensor for output "${metadata.output.name}".`,
            );
        }

        const values = toFloat64(outputTensor.data as Float32Array | Float64Array);
        return Object.freeze({
            modelId: metadata.modelId,
            modelVersion: metadata.modelVersion,
            outputName: metadata.output.name,
            values,
            semantics: metadata.output.semantics,
        });
    }

    async dispose(): Promise<void> {
        if (!this.disposed) {
            this.disposed = true;
            await this.session.release();
        }
    }
}

/**
 * Create an ONNX Web inference backend for one model. Loads `onnxruntime-web`
 * lazily (guarded), configures the global WASM environment, and instantiates a
 * session over `modelBytes`. Any load/session failure is a classified
 * `model-loading-failure`; scientific incompatibility remains a
 * `model-compatibility-failure` at run time.
 */
export async function createOnnxWebEngine(
    options: OnnxWebEngineOptions,
): Promise<InferenceEngine> {
    assertValidModelMetadata(options.metadata);
    const ort = await loadOrtModule();
    if (options.numThreads !== undefined) {
        ort.env.wasm.numThreads = options.numThreads;
    }
    if (options.proxyWasm !== undefined) {
        ort.env.wasm.proxy = options.proxyWasm;
    }

    let session: OrtSession;
    try {
        session = await ort.InferenceSession.create(asArrayBuffer(options.modelBytes), {
            executionProviders: options.executionProviders,
        });
    } catch (cause) {
        throw EcgError.modelLoading(
            'Failed to create an ONNX Runtime Web inference session from the model bytes.',
            { cause: cause instanceof Error ? cause : undefined },
        );
    }

    return new OrtWebInferenceEngine(ort, session, options.metadata);
}
